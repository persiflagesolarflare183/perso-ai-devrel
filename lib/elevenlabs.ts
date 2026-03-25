const ELEVENLABS_API = "https://api.elevenlabs.io";

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Missing ELEVENLABS_API_KEY environment variable");
  return key;
}

function voiceId(): string {
  const id = process.env.ELEVENLABS_VOICE_ID;
  if (!id) {
    throw new Error(
      "ELEVENLABS_VOICE_ID is not set. " +
        "Add a voice ID from your ElevenLabs account to .env.local. " +
        "See: https://elevenlabs.io/app/voice-lab"
    );
  }
  return id;
}

/**
 * Transcribe an audio buffer using ElevenLabs Scribe (STT).
 * Returns the transcribed text.
 */
export async function transcribe(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), filename);
  form.append("model_id", "scribe_v1");

  const res = await fetch(`${ELEVENLABS_API}/v1/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs STT error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}

/**
 * Generate speech from text using ElevenLabs TTS (multilingual v2).
 * Returns raw mp3 bytes as a Buffer.
 */
export async function textToSpeech(text: string): Promise<Buffer> {
  const res = await fetch(`${ELEVENLABS_API}/v1/text-to-speech/${voiceId()}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 402) {
      throw new Error(
        "The selected ElevenLabs voice is not available on your current plan (402 paid_plan_required). " +
          "Go to elevenlabs.io/app/voice-lab, open a voice you own or cloned, and copy its Voice ID into ELEVENLABS_VOICE_ID."
      );
    }
    throw new Error(`ElevenLabs TTS error ${res.status}: ${body}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
