import { describe, expect, it } from 'vitest';
import { insertSkill, matchingSkills, slashQuery } from '@/features/send-command/lib/slash-skills.js';

const skills = [
  { name: 'review', description: 'Review changes', invocation: '/review' },
  { name: 'tools:build', description: 'Build the project', invocation: '/tools:build' },
];

describe('skill completion in the composer', () => {
  it('offers completion for the slash token under the caret, at the start or in the middle of the text', () => {
    expect(slashQuery('/', 1)).toBe('');
    expect(slashQuery('/tools:bu', 9)).toBe('tools:bu');
    expect(slashQuery('explain /review', 15)).toBe('review');
    expect(slashQuery('explain /re and more', 11)).toBe('re');
    expect(slashQuery('объясни /ревью', 14)).toBe('ревью');
    expect(slashQuery('/review arguments', 17)).toBeNull();
    expect(slashQuery('/review arguments', 4)).toBe('rev');
    // A slash inside a word or a path is no skill.
    expect(slashQuery('open src/app', 12)).toBeNull();
    expect(slashQuery('run /usr/bin', 12)).toBeNull();
  });

  it('filters real skill metadata without inventing command names', () => {
    expect(matchingSkills(skills, 'TOOLS')).toEqual([skills[1]]);
    expect(matchingSkills(skills, 'changes')).toEqual([skills[0]]);
    expect(matchingSkills(skills, 'unavailable')).toEqual([]);
  });

  it('inserts the invocation and retains arguments without submitting anything', () => {
    expect(insertSkill('/rev', '/review', 4)).toEqual({ text: '/review ', caret: 8 });

    expect(insertSkill('/rev existing arguments', '/review', 4)).toEqual({
      text: '/review existing arguments',
      caret: 8,
    });

    expect(insertSkill('/tools:bu', '/tools:build', 9)).toEqual({ text: '/tools:build ', caret: 13 });

    expect(insertSkill('please /rev then stop', '/review', 11)).toEqual({
      text: 'please /review then stop',
      caret: 15,
    });

    expect(insertSkill('please /re', '/review', 10)).toEqual({ text: 'please /review ', caret: 15 });
  });
});
