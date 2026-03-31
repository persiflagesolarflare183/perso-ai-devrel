import type { LanguageCode } from "./languages";

/**
 * Translate text using DeepL.
 * Free-tier keys end with `:fx` and use api-free.deepl.com.
 * Pro keys use api.deepl.com.
 *
 * Required env var: DEEPL_API_KEY
 */
export async function translate(text: string, targetLang: LanguageCode): Promise<string> {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error("Missing DEEPL_API_KEY environment variable");

  const base = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";

  const res = await fetch(`${base}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: [text], target_lang: targetLang }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 456) throw new Error("DEEPL_QUOTA");
    if (res.status === 429) throw new Error("DEEPL_RATE_LIMIT");
    if (res.status === 403) throw new Error("DEEPL_AUTH");
    throw new Error(`DeepL error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { translations: { text: string }[] };
  return data.translations[0].text;
}

/**
 * Translate multiple texts in a single DeepL request.
 * Preserves order of input texts.
 */
export async function translateBatch(texts: string[], targetLang: LanguageCode): Promise<string[]> {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error("Missing DEEPL_API_KEY environment variable");

  const base = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";

  const res = await fetch(`${base}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: texts, target_lang: targetLang }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 456) throw new Error("DEEPL_QUOTA");
    if (res.status === 429) throw new Error("DEEPL_RATE_LIMIT");
    if (res.status === 403) throw new Error("DEEPL_AUTH");
    throw new Error(`DeepL error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { translations: { text: string }[] };
  return data.translations.map((t) => t.text);
}
