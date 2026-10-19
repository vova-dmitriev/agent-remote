export const Language = {
  Ru: 'ru',
  En: 'en',
} as const;

export type Language = (typeof Language)[keyof typeof Language];

export const ThemePreference = {
  Auto: 'auto',
  Light: 'light',
  Dark: 'dark',
} as const;

export type ThemePreference = (typeof ThemePreference)[keyof typeof ThemePreference];

export const ColorScheme = {
  Light: 'light',
  Dark: 'dark',
} as const;

export type ColorScheme = (typeof ColorScheme)[keyof typeof ColorScheme];
