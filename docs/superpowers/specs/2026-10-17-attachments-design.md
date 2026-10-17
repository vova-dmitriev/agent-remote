# Attachments and page Storybook coverage

## Intent

Support file/image selection, sending and viewing in the existing Telegram Mini App without breaking text chat, virtualization, language switching or source ownership. Complete Storybook states for every current page and the attachment workflow. The user has authorized continuous implementation; existing no-commit/no-paid-service instructions remain binding.

## Shared contract

Export `AttachmentDescriptor` and `attachmentSchema` from `@protocol`: `{id,name,mimeType,byteLength,sha256,kind:'image'|'file'}`. No filesystem path or public URL is sent to the browser. Limits: `MAX_ATTACHMENT_BYTES=10*1024*1024`, `MAX_ATTACHMENTS=5`, `MAX_MESSAGE_ATTACHMENT_BYTES=20*1024*1024`, `ATTACHMENT_TTL_MS=24*60*60*1000`; server owner quota50MiB. Descriptor names1..255, mimeType1..128, sha256 lowercase64hex; byteLength1..10MiB.

`HistoryMessage.attachments?: AttachmentDescriptor[]`; media-only messages have empty text. Prompt actions keep `text:string` and gain `attachments?:AttachmentDescriptor[]`; at least valid text or one attachment is required, duplicates and total size>20MiB are rejected. Client and daemon commands use the same descriptors. The relay resolves every descriptor against canonical stored metadata and owner/device/session before dispatch. Source generation is checked again immediately before effect after asynchronous download.

`CapabilitySet.attachments?: {images:'native'|'reference',files:'reference'}`. Absence means unavailable. Codex CLI/Desktop advertise native images and file references only when writable; managed Claude PTY/cmux advertise reference mode. Native hook observation and current Desktop AX send do not advertise uploads. Viewing is independent of prompt ability.

## Relay storage and API

Private PostgreSQL bytea storage keeps deployment free and self-contained. Bind each attachment to owner, device and stable session; current source generation is validated at upload/command, but reconnect does not invalidate an already uploaded draft for that same stable session. Revoke removes access immediately. Quota is serialized using the owner's row lock; expired rows are pruned. Never log bytes or private names.

- `POST /sessions/:sessionId/attachments` with app bearer token; binary body, `x-upload-id` UUID, `x-file-name` encodedURIComponent name, `x-session-generation`, Content-Type.
- `GET /sessions/:sessionId/attachments/:attachmentId` with app bearer token returns private bytes.
- Same device-token APIs under `/device/sessions/:sessionId/attachments[/:attachmentId]` for companion transfer/export.
- Upload returns canonical descriptor. Same upload ID + exact bytes/metadata is idempotent; mismatched reuse conflicts. No automatic model-command retries.
- Enforce10MiB/file,50MiB/owner, bounded parallel body buffers, binary sniff for supported PNG/JPEG/WebP/GIF previews. Other files download as octet-stream with attachment disposition; never execute HTML/SVG. Auth errors use safe codes, nosniff/no-store headers. Authenticate before consuming bytes; JSON files remain binary rather than passing through global JSON middleware.

## Companion

Prepared attachment API: `PreparedAttachment={descriptor:AttachmentDescriptor,path:string}` in a daemon-only module. Dispatcher `prepareAttachments?:(session:Session,attachments:AttachmentDescriptor[])=>Promise<PreparedAttachment[]>` downloads canonical owned blobs into generated0700/0600 private paths, verifies size/hash, and rechecks TTL/connection/generation/status before source dispatch. `SourceAdapter.sendPrompt(binding,text,attachments?)` and its driver accept the prepared list.

Codex uses native `localImage` inputs for images and explicit plain-text file references for generic documents. Desktop follower forwards the same inputs. Managed Claude drivers inject references into the existing bracketed-paste user prompt; never write JSON into the terminal or spawn a second conversation. Do not claim bytes were read solely because dispatch returned success.

Retain a bounded mapping of prepared paths and augmented text to original user text/descriptors for round-trip history, including image-only messages. Export explicitly embedded native image/document bytes and supported native image input/output records from existing source history, with deterministic source/session identities, safe regular-file reads and the same upload limits. Never parse arbitrary model text/Markdown/tool arguments into file downloads or fetch arbitrary source URLs. Missing/truncated original bytes are unavailable, not fabricated files. Claude JSONL media requires a deliberate bounded larger-line/chunk strategy; existing text limits remain65536.

## Mini App

Composer: attach button, multiple file picker, clipboard images and drag/drop where supported, removable pending chips/thumbnails, progress/busy/error/retry states, image-only send. Drafts remain per session and survive language changes; logout/revoke abort transfers and discard files. Uploaded source files are passed only with the selected exact session command. Unknown command outcomes retain the original attachment IDs and command ID.

Messages: thumbnails open an accessible image dialog; files show name/type/size and download. Authenticated blob fetches create short-lived object URLs with cleanup. Viewer/loading/error/expired states are translated RU/EN and fit mobile/dark/short viewports. Preserve measured virtualization and message navigation after image dimensions change. Render no arbitrary remote HTML or executable file content.

Use FSD boundaries, maximum200 frontend/E2E lines and6non-index files per directory, static test IDs, enforced logical blank lines, shared primitives and theme tokens. Every page/reusable attachment component receives isolated synthetic Storybook states. Story play functions perform interactions only; assertions remain in test/spec files.

## Verification

RED/GREEN protocol, relay upload/download/auth/quota/idempotency/revoke, safe companion hash/path/TTL/race, native input mapping and history media extraction. Browser E2E uses real daemon/relay/storage for image/file send, removal, image-only, preview/download, failures, language and source capability differences. All existing tests and frontend gates stay green. Native image acceptance requires a dedicated synthetic CLI/Mac test, not a path-echo claim. Document AX/unsupported records as source boundaries. No private chat fixtures, actual Telegram test messages or commits.
