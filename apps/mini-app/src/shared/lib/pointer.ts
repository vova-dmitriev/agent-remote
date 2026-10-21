/** The pointer types the app tells apart (`PointerEvent.pointerType`): a mouse hovers, a finger only taps. */
export const PointerKind = { Mouse: "mouse", Touch: "touch" } as const

export type PointerKind = (typeof PointerKind)[keyof typeof PointerKind]
