import { describe, expect, it } from 'vitest';
import { insertSkill, matchingSkills, slashQuery } from '@/features/send-command/lib/slash-skills.js';

const skills = [
  { name: 'review', description: 'Review changes', invocation: '/review' },
  { name: 'tools:build', description: 'Build the project', invocation: '/tools:build' },
];

describe('skill completion in the composer', () => {
  it('offers completion only for the leading slash token under the caret', () => {
    expect(slashQuery('/', 1)).toBe('');
    expect(slashQuery('/tools:bu', 9)).toBe('tools:bu');
    expect(slashQuery('explain /review', 15)).toBeNull();
    expect(slashQuery('/review arguments', 17)).toBeNull();
    expect(slashQuery('/review arguments', 4)).toBe('rev');
  });

  it('filters real skill metadata without inventing command names', () => {
    expect(matchingSkills(skills, 'TOOLS')).toEqual([skills[1]]);
    expect(matchingSkills(skills, 'changes')).toEqual([skills[0]]);
    expect(matchingSkills(skills, 'unavailable')).toEqual([]);
  });

  it('inserts the invocation and retains arguments without submitting anything', () => {
    expect(insertSkill('/rev', '/review')).toEqual({ text: '/review ', caret: 8 });

    expect(insertSkill('/rev existing arguments', '/review')).toEqual({
      text: '/review existing arguments',
      caret: 8,
    });

    expect(insertSkill('/tools:bu', '/tools:build')).toEqual({ text: '/tools:build ', caret: 13 });
  });
});
