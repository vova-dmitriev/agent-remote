export const LocalControl = { Health: 'health' } as const;
export type LocalControl = (typeof LocalControl)[keyof typeof LocalControl];
