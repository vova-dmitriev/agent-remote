import type { en } from "./dictionaries/en"

export type { Language } from "@protocol"
export type MessageKey = keyof typeof en
export type Dictionary = Record<MessageKey, string>
export type Translate = (key: MessageKey, parameters?: Record<string, string | number>) => string
