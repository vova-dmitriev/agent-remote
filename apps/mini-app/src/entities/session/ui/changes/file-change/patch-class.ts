/** Patch overrides on top of the rendered-Markdown scope (`message-markdown`); class names stay literal for Tailwind's scanner. */
export const patchClass = [
  "[&_pre]:mt-0 [&_pre]:mb-2 [&_pre]:overflow-x-auto [&_pre]:bg-code [&_pre]:px-0 [&_pre]:py-2 [&_pre]:text-[0.75rem] [&_pre]:leading-[1.6] [&_pre]:[tab-size:2]",
  "[&>:last-child]:mb-0 [&_code]:block [&_code]:min-w-max [&_pre_code]:text-[0.8rem]",
  "[&_:is(.hljs-comment,.hljs-quote)]:text-[color-mix(in_srgb,var(--markdown-syntax-comment)_80%,var(--foreground))]",
  "[&_:is(.hljs-number,.hljs-attr,.hljs-symbol,.hljs-bullet)]:text-[color-mix(in_srgb,var(--markdown-syntax-number)_80%,var(--foreground))]",
  String.raw`[&_:is(.hljs-title,.hljs-built\_in,.hljs-section,.hljs-selector-class)]:text-[color-mix(in_srgb,var(--markdown-syntax-title)_80%,var(--foreground))]`,
  "[&_:is(.hljs-string,.hljs-regexp,.hljs-addition,.hljs-meta_.hljs-string)]:text-[color-mix(in_srgb,var(--markdown-syntax-string)_80%,var(--foreground))]",
].join(" ")
