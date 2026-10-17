import { MarkdownNodeType } from '../domain/markdown.js';
import { fromMarkdown } from 'mdast-util-from-markdown';

// Only generated tags reach Telegram. Raw Markdown HTML is always literal text.
const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const escapeAttribute = (value: string) => escapeHtml(value).replaceAll('"', '&quot;');

function unicodePrefix(value: string, limit: number): string {
  const end = value.charCodeAt(limit - 1);

  return value.slice(0, end >= 0xd800 && end <= 0xdbff ? limit - 1 : limit);
}

export function notificationTitle(value: string): string {
  const title = value.replace(/\s+/g, ' ').trim();

  return escapeHtml(title.length > 100 ? unicodePrefix(title, 99) + '…' : title);
}

// Reserve room for every closing tag and an ellipsis before emitting any token.
// The raw HTML bound is stricter than Telegram's 4096-character decoded bound,
// leaving enough room for the escaped 100-character session title and header.
class TelegramHtml {
  private html = '';
  private textLength = 0;
  private closing: string[] = [];
  private closingLength = 0;
  stopped = false;

  text(value: string) {
    if (this.stopped) {
      return;
    }

    for (const character of value) {
      const escaped = escapeHtml(character);

      if (
        this.textLength + character.length > 1499 ||
        this.html.length + escaped.length + this.closingLength + 1 > 3500
      ) {
        this.truncate();

        return;
      }

      this.html += escaped;
      this.textLength += character.length;
    }
  }

  wrap(tag: string, render: () => void, attributes = '') {
    if (this.stopped) {
      return;
    }

    const opening = `<${tag}${attributes}>`;
    const closing = `</${tag}>`;

    if (this.html.length + opening.length + closing.length + this.closingLength + 1 > 3500) {
      this.truncate();

      return;
    }

    this.html += opening;
    this.closing.push(closing);
    this.closingLength += closing.length;
    render();
    this.html += this.closing.pop()!;
    this.closingLength -= closing.length;
  }

  truncate() {
    if (!this.stopped) {
      this.html += '…';
    }

    this.stopped = true;
  }

  finish() {
    return this.html.trim();
  }
}

type MarkdownNode = {
  type: string;
  value?: string | undefined;
  alt?: string | null | undefined;
  url?: string | undefined;
  identifier?: string | undefined;
  ordered?: boolean | null | undefined;
  start?: number | null | undefined;
  children?: MarkdownNode[] | undefined;
};

// Telegram forbids code/pre overlapping styles or links. Keep the code entity
// and flatten its enclosing style/link rather than sending invalid nesting.
function containsCode(node: MarkdownNode, depth = 0): boolean {
  return (
    depth > 64 ||
    node.type === MarkdownNodeType.InlineCode ||
    node.type === MarkdownNodeType.Code ||
    (node.children ?? []).some((child) => containsCode(child, depth + 1))
  );
}

function safeLink(value: string | undefined): string | undefined {
  if (!value || value.length > 1024) {
    return;
  }

  try {
    const url = new URL(value);

    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      return;
    }

    return value;
  } catch {
    return;
  }
}

/** Render CommonMark into the subset supported by Telegram sendMessage HTML. */
export function notificationPreview(markdown: string): string {
  const source = unicodePrefix(markdown, 100_000);
  const ast = fromMarkdown(source);
  const definitions = new Map<string, string>();

  for (const node of ast.children) {
    if (node.type === MarkdownNodeType.Definition) {
      definitions.set(node.identifier, node.url);
    }
  }

  const output = new TelegramHtml();

  function children(node: MarkdownNode, separator = '', depth = 0) {
    for (const [index, child] of (node.children ?? []).entries()) {
      if (output.stopped) {
        break;
      }

      if (child.type === MarkdownNodeType.Definition) {
        continue;
      }

      if (index && separator) {
        output.text(separator);
      }

      render(child, depth + 1);
    }
  }

  function render(node: MarkdownNode, depth = 0) {
    if (output.stopped) {
      return;
    }

    if (depth > 64) {
      output.truncate();

      return;
    }

    const content = () => children(node, '', depth);

    switch (node.type) {
      case MarkdownNodeType.Root:
      case MarkdownNodeType.Blockquote:
      case MarkdownNodeType.ListItem:
        children(node, '\n\n', depth);
        break;
      case MarkdownNodeType.Paragraph:
        content();
        break;
      case MarkdownNodeType.Heading:
      case MarkdownNodeType.Strong:
        if (containsCode(node)) {
          content();
        } else {
          output.wrap('b', content);
        }

        break;
      case MarkdownNodeType.Emphasis:
        if (containsCode(node)) {
          content();
        } else {
          output.wrap('i', content);
        }

        break;
      case MarkdownNodeType.InlineCode:
        output.wrap('code', () => output.text(node.value ?? ''));
        break;
      case MarkdownNodeType.Code:
        output.wrap('pre', () => output.text(node.value ?? ''));
        break;
      case MarkdownNodeType.Break:
        output.text('\n');
        break;
      case MarkdownNodeType.ThematicBreak:
        output.text('—');
        break;
      case MarkdownNodeType.Image:
      case MarkdownNodeType.ImageReference:
        output.text(node.alt ?? '');
        break;
      case MarkdownNodeType.Link:

      // Falls through: both link variants use the same safe URL renderer.
      case MarkdownNodeType.LinkReference: {
        const url = safeLink(
          node.type === MarkdownNodeType.Link ? node.url : definitions.get(node.identifier ?? ''),
        );

        if (url && !containsCode(node)) {
          output.wrap('a', content, ` href="${escapeAttribute(url)}"`);
        } else {
          content();
        }

        break;
      }

      case MarkdownNodeType.List:
        for (const [index, item] of (node.children ?? []).entries()) {
          if (output.stopped) {
            break;
          }

          if (index) {
            output.text('\n');
          }

          output.text(node.ordered ? `${(node.start ?? 1) + index}. ` : '• ');
          render(item, depth + 1);
        }

        break;
      case MarkdownNodeType.Definition:
        break;

      default:
        if (node.value !== undefined) {
          output.text(node.value);
        } else {
          content();
        }
    }
  }

  render(ast);

  if (source.length < markdown.length) {
    output.truncate();
  }

  return output.finish();
}
