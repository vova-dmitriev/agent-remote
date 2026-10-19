import { Language, ThemePreference } from './preferences-values.js';
import { z } from 'zod';

export const LANGUAGE_PREFERENCES = [Language.Ru, Language.En] as const;
export const THEME_PREFERENCES = [ThemePreference.Auto, ThemePreference.Light, ThemePreference.Dark] as const;
export const languagePreferenceSchema = z.enum(Language);
export const themePreferenceSchema = z.enum(ThemePreference);
export const accountPreferencesSchema = z.strictObject({
  language: languagePreferenceSchema.nullable(),
  theme: themePreferenceSchema.nullable(),
});
export const preferencePatchSchema = z
  .strictObject({
    language: languagePreferenceSchema.optional(),
    theme: themePreferenceSchema.optional(),
  })
  .refine((value) => value.language !== undefined || value.theme !== undefined);

export type AccountPreferences = z.infer<typeof accountPreferencesSchema>;
export type PreferencePatch = z.infer<typeof preferencePatchSchema>;
