import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { transcribe, textToSpeech } from "@/lib/elevenlabs";
import { translate } from "@/lib/translate";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";

// Allow up to 60 s for the full STT → translate → TTS pipeline
export const maxDuration = 60;

export async function POST(request: Request) {
  // Auth guard — proxy already handles redirects, but API routes need an explicit check
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const targetLanguage = formData.get("targetLanguage") as string | null;

    if (!audioFile || !targetLanguage) {
      return NextResponse.json(
        { error: "Missing required fields: audio and targetLanguage" },
        { status: 400 }
      );
    }

    const validLang = SUPPORTED_LANGUAGES.find((l) => l.code === targetLanguage);
    if (!validLang) {
      return NextResponse.json({ error: "Unsupported target language" }, { status: 400 });
    }

    // 1. Read audio into buffer
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

    // 2. Transcribe with ElevenLabs Scribe
    const { text: transcript, languageCode } = await transcribe(
      audioBuffer,
      audioFile.name || "audio.mp3",
      audioFile.type || "audio/mpeg"
    );

    if (!transcript.trim()) {
      return NextResponse.json(
        { error: "Transcription returned empty text. Check the audio file." },
        { status: 422 }
      );
    }

    // 3. Translate with DeepL
    const translation = await translate(transcript, validLang.code);

    // 4. Generate dubbed speech with ElevenLabs TTS
    const ttsBuffer = await textToSpeech(translation);

    // Return transcript, translation, and audio as base64 so the client can
    // build a Blob URL without a second round-trip
    return NextResponse.json({
      transcript,
      translation,
      detectedLanguage: languageCode,
      audio: ttsBuffer.toString("base64"),
      mimeType: "audio/mpeg",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[/api/dub]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
