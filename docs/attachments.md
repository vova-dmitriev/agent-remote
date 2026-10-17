# Mini App attachments

Files travel through the existing authenticated relay to the selected Mac session. PostgreSQL stores the private bytes; no storage subscription, public file URL or model API key is required. The Mac must stay online for delivery to the agent.

## Source support

| Source                                | Images                                 | Other files                                    |
| ------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| Codex CLI and Mac application         | Native local-image input               | Explicit private file references in the prompt |
| Managed Claude Code terminal and cmux | Private image references in the prompt | Private file references in the prompt          |
| Ordinary Claude Code hooks            | View supported history records         | No remote attachment input                     |
| Claude Desktop Accessibility          | No advertised attachment input         | No advertised attachment input                 |

The source must advertise attachment input and be ready for a message. A successful dispatch means the input reached that source; the agent's answer establishes whether it actually read the file.

## Privacy and limits

- At most five attachments and 20 MiB per message; at most 10 MiB per file.
- Each owner has a 50 MiB relay quota. Bytes expire after 24 hours and are pruned automatically.
- Uploads and downloads require an authenticated owner or the paired device token, bound to the same device and session. Revocation removes access immediately.
- The companion verifies SHA-256 and size before using files in private generated paths. Filesystem paths never appear in attachment metadata sent to the browser.
- PNG, JPEG, GIF and WebP can be previewed. Other formats, including HTML and SVG, download as files rather than executable inline content.

The image/file picker keeps pending selections per session. Removing a draft attachment does not send it to the agent. A command with an unknown delivery outcome retains its original command and attachment IDs so an explicit retry cannot create another agent turn.

## Existing history

Only complete explicit native media records can be exported: embedded Claude image/document bytes and supported Codex image inputs/outputs. Text paths, Markdown links and tool arguments are not scanned for files; arbitrary remote URLs are never fetched. Missing, unsupported or truncated originals cannot be reconstructed from chat text.

On macOS, explicit native image paths may use the system `/tmp` and `/var` aliases for `/private/tmp` and `/private/var`. These aliases are accepted with exact canonical-path matching; additional file or directory symlinks remain blocked. Ordinary model text containing a file path never grants access to that file.

## Verification

`tests/attachment-contract.test.ts`, `tests/attachment-storage.test.ts` and `tests/attachment-http.test.ts` exercise the wire schema and real PostgreSQL/HTTP boundary. Additional companion, browser and source acceptance coverage is recorded in [the product matrix](e2e-coverage.md). [Storybook coverage](storybook-coverage.md) describes isolated page and attachment states.

Installed Codex CLI acceptance verified the actual image color and file contents in a disposable thread. Managed Claude Code 2.1.302 separately passed a full real relay/companion/PTY turn that identified a synthetic image color and read a random marker file. Both tests used disposable sources. Existing Codex Desktop history-image observation was verified against an actual native JPEG: authenticated public download matched the original bytes after import. The separate Desktop attachment-input probe could not establish ownership of its disposable thread (`DESKTOP_SYNTHETIC_OWNER_MISSING`); native Desktop input acceptance is not claimed. Desktop adapter forwarding remains covered by controlled protocol tests.

## Native attachment message presentation

The Mini App recognizes the bounded, leading `Files mentioned by the user` envelope produced by the native client and displays the actual request with ordinary attachment cards. Internal local paths, `Image attachment`, safety boilerplate, browser context and `My request` headings are omitted from chat and message marker previews. Source text and agent input remain unchanged; quoted examples, assistant messages and unrecognized prose are preserved. Request indentation and Markdown line breaks are retained.

Only existing authenticated attachment descriptors produce image previews or downloads. Text paths never grant filesystem access. When an original has no available attachment descriptor, the UI keeps its filename in a compact unavailable-file card instead of silently dropping the reference. Synthetic integration coverage verifies image/file rendering, opening, authenticated downloads and marker previews.

## Image viewer

Images open in a modal covering the full Mini App viewport. The toolbar provides zoom in/out, the current percentage, fit to viewport, original 1:1 size, authenticated download and close. Enlarged images support pointer dragging, two-finger pinch and wheel zoom around the pointer. Closing restores focus without scrolling the conversation; reopening starts fitted to the available viewport. The viewer reuses the authenticated attachment blob and never embeds bearer credentials in image or download URLs.
