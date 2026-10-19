# Third-party notices

Ниже — источники архитектуры и адаптации локальных модулей. Реализация переписана на TypeScript под Node.js; upstream приложения целиком не включены.

## CCGram

- Source: https://github.com/jsayubi/ccgram/tree/75b38e1bab4af411b40b4e589d050786eb65ceca
- Files reviewed: `src/utils/pty-session-manager.ts`, `src/utils/transcript-reader.ts`, `permission-hook.ts`.
- Local modules: `apps/daemon/src/code/pty-session-manager.ts`, `apps/daemon/src/code/transcript/transcript-reader.ts`, `apps/daemon/src/commands/permission-broker.ts`.
- Changes: generation/lease binding, bounded incremental JSONL reader, one-shot transport-neutral broker; removed raw output logs, cwd/name matching, kill-on-name-collision, Telegram polling and persistent permission changes.

MIT License

Copyright (c) 2026 JS Ayubi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## cmux-tui

- Source: https://github.com/W4M-ai/cmux-tui/tree/bb0fea83d2fcdb5f172e651cf0f4d81a37329eb8
- File reviewed: `src/index.ts`.
- Local module: `apps/daemon/src/cmux/client.ts`.
- Changes: Node.js `execFile` instead of Bun; UUID-only explicit targets, literal stdin paste, bounded screen output and process timeout. No OpenTUI/macros copied.

MIT License

Copyright (c) 2025-present W4M AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Runtime dependency

`node-pty@1.1.0` is used as a dependency, not vendored. Its license and copyright notices remain in the installed package. See https://github.com/microsoft/node-pty/blob/1.1.0/LICENSE.

No cc-tg-hub UI, HAPI server, Python bridge, official cmux source or GPL/AGPL source is included in this implementation.

## shadcn/ui

Shared Button/Input/Textarea/Skeleton primitives were adapted from the reference application, preserving the shadcn composition pattern. Local changes add typed test attributes and semantic color tokens.

Source/license: https://github.com/shadcn-ui/ui/blob/main/LICENSE.md

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
