# Storybook coverage

Run `npm run storybook` from the repository root and open `http://127.0.0.1:6006`.
Run `npm run test-storybook` for browser rendering, interaction and accessibility checks.

## Pages and application compositions

| Surface                      | Covered states                                                                                                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in page                 | Signed out; Russian; English; dark theme.                                                                                                                                                                                                                                    |
| Sessions page                | Loaded with all six sources; loading skeletons; connected empty; all six session statuses; expanded connections/settings; pairing introduction; manual code; pending pairing; offline pairing; English; dark theme.                                                          |
| Session sources              | Claude Code CLI; Claude Desktop Code; Claude Desktop Chat; cmux; Codex CLI; Codex Desktop.                                                                                                                                                                                   |
| Session history              | Loaded; empty; observed/inferred source labels; interactive history/terminal tabs; terminal snapshot; waiting for terminal snapshot.                                                                                                                                         |
| Session availability         | Idle; running; waiting for input; ended; unknown; command busy; read only; native observation/setup required; relay offline; reconnecting; device offline.                                                                                                                   |
| Session permissions          | Pending; command busy; relay offline; expired request.                                                                                                                                                                                                                       |
| Session errors               | Codex model unavailable; authentication required; network error; failed turn.                                                                                                                                                                                                |
| Application shell            | Online; offline; connecting; expired authentication; command receipt; local pairing confirmation; compact session shell; English; dark theme.                                                                                                                                |
| Full application composition | Sign-in required; loading; sessions; connected empty; pairing; pairing error; local pairing confirmation; Claude session; Codex session; offline sessions/pairing/session; pending permission; uncertain delivery; checking delivery; delivery receipt; English; dark theme. |
| Full mobile composition      | 390 × 844 sign-in, sessions, session and pending permission; English/dark Codex session; 390 × 540 viewport with a multiline draft.                                                                                                                                          |

The application stories compose the real `ApplicationShell`, `CommandNotice`, page and feature components.
They do not mount `RemoteApplication` or its authenticated transport hooks.
Story-only controllers supply explicit public component props; they do not add state flags to product components.

## Existing reusable components

Stories also cover buttons, inputs, labels, textarea, skeletons, language and theme switching,
Markdown/code, session cards, composer drafts and observation states, command notices,
pairing interaction, device access, permissions, message bubbles, message navigation,
message previews and virtualized session feeds.

Language and theme use shared Radix dropdown primitives with selected indicators, icons, keyboard navigation and viewport collision handling. Stories cover both closed and open menus in both themes, including automatic appearance. The compact session shell has light and dark cases with language, theme and logout controls absent; the main shell retains those controls. The shared theme provider applies Storybook's selected theme without relying on a real Telegram host.

The top session actions menu has closed, open, busy, offline, ended, English and dark states. Interrupt is absent from the composer. History skeletons have direct feed, session page and complete application compositions; the empty state is reserved for a successful empty history response.

Device access adds grouped Desktop connections and mixed ready/disconnected states, including English and dark variants. Counts describe connections; the main session list remains separate. Repeated connectors do not repeat the application heading, and distinct failure reasons remain visible.

## Isolation and verification

All sessions, devices, identifiers, messages and terminal text are synthetic.
MSW handles only `http://api.storybook.local`; stories never connect to the real relay,
Telegram, native agent applications or local personal sessions.
Page composition controllers are local fixtures with no transport calls.
The existing pairing interaction uses the isolated MSW endpoint.

Story `play` functions perform interactions only and use imported test-ID constants.
Assertions remain outside `*.stories.*`.
Language and theme toolbars apply to every story; named English/dark cases provide direct links.

Page stories verify visual states, not transport authorization, protocol behavior or native integrations.
Browser tests do not replace server, daemon or end-to-end tests.

Initial page expansion verification: 124 browser story cases passed across 23 files;
Storybook static build passed. All six source sessions, six session statuses and five
connector state fixtures also passed the shared protocol schemas. Mobile screenshots
were inspected at 390 × 844 and 390 × 540.

## Attachment components

| Component          | Stories                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Attachment card    | Image, File, Viewer, Loading, Expired, Failed, DarkEnglish, LongFileName                   |
| Image viewer       | Open, Dark                                                                                 |
| Pending attachment | Uploading, Ready, Failed, Document, Locked                                                 |
| Attachment picker  | Empty, SelectedImage, Multiple, Uploading, Failed, Retry, Remove, WithTextDark, CountLimit |

These 24 additional cases use synthetic bytes and isolated attachment access functions.
Viewer, thumbnail, upload progress, failures, retry/removal, file metadata, locked drafts
and dark/mobile layouts render the real reusable components. Picker interactions retain
the no-assertions-in-stories rule. Transport ownership, cancellation and delivery outcomes
are checked in `tests/e2e/attachments/` and the protocol/relay/companion suites.

Earlier Storybook verification: 180 cases across 32 story files passed. Production source gates and TypeScript also passed with account preferences, dropdowns, safe session actions, history skeletons and grouped connections.

SessionAvailability includes online, offline, open details, English and dark states.
SessionCard includes known/unknown/long native model values. Compact application
shell stories omit the redundant app header inside conversations. All theme-aware
stories use the shared cool neutral/blue palette tokens; browser accessibility
checks cover contrast and keyboard/touch interactions remain in test/spec files.

## Accounts and keys

The shared Accounts page covers English, dark, empty, loading and offline states.
It also covers recovery after a lost reply, an untrusted recipient and denied access.
Profile cards show verified identities, disabled/removing profiles and operation progress.
Creation, provider sign-in and credential entry use separate synthetic stories.

Current verification: **291 cases across 52 story files passed**. README account screenshots come from `pages-accounts--accounts-and-keys`, with reserved `example.invalid` identities. Stories use no credentials, real provider sign-ins or production sessions. Browser and native tests separately verify encryption, uncertain-write recovery, cancellation and ownership.
