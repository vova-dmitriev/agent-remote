import type { HistoryMessage } from '@protocol';

export const conversation: HistoryMessage[] = Array.from({ length: 35 }, (_, index) => ({
  id: 'navigation-' + index,
  role: index % 2 ? 'assistant' : 'user',
  text:
    index === 1
      ? '# Synthetic answer\n\n**Formatted text** with `inline code`.\n\n```typescript\nconst answer: number = 42;\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n\n<script>window.markdownExecuted = true</script>\n\n[Unsafe](javascript:alert(1))\n\n![Synthetic](https://images.invalid/private.png)'
      : `Synthetic message ${index + 1}.\n\nA long paragraph to exercise scrolling and message navigation. `.repeat(
          3,
        ),
  occurredAt: 1700000000000 + index,
}));
