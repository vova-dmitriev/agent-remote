export const MarkdownNodeType = {
  InlineCode: 'inlineCode',
  Code: 'code',
  Definition: 'definition',
  Root: 'root',
  Blockquote: 'blockquote',
  ListItem: 'listItem',
  Paragraph: 'paragraph',
  Heading: 'heading',
  Strong: 'strong',
  Emphasis: 'emphasis',
  Break: 'break',
  ThematicBreak: 'thematicBreak',
  Image: 'image',
  ImageReference: 'imageReference',
  Link: 'link',
  LinkReference: 'linkReference',
  List: 'list',
} as const;

export type MarkdownNodeType = (typeof MarkdownNodeType)[keyof typeof MarkdownNodeType];
