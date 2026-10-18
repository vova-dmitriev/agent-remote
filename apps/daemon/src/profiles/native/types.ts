export interface ProfileNativeOptions {
  executable: string;
  apiFetch?: typeof fetch;
  prefixArguments?: readonly string[];
}
