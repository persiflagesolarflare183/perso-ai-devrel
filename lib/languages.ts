// Supported target languages for dubbing.
// These are DeepL language codes — safe to import on the client side.
export const SUPPORTED_LANGUAGES = [
  { code: "KO", label: "Korean" },
  { code: "JA", label: "Japanese" },
  { code: "ZH", label: "Chinese (Simplified)" },
  { code: "ES", label: "Spanish" },
  { code: "FR", label: "French" },
  { code: "DE", label: "German" },
  { code: "PT-PT", label: "Portuguese" },
  { code: "IT", label: "Italian" },
  { code: "RU", label: "Russian" },
  { code: "EN-US", label: "English" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];
