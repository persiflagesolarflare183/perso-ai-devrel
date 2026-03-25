"use client";

import { useState, useRef, useEffect } from "react";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";

const CROP_LIMIT_SEC = 60;

type Status = "idle" | "loading" | "done" | "error";

interface DubResult {
  transcript: string;
  translation: string;
  audio: string; // base64
  mimeType: string;
}

// ── Client-side audio helpers ─────────────────────────────────────────────────

/**
 * Encode an AudioBuffer as a 16-bit PCM WAV Blob.
 * No external library — pure DataView write.
 * A 60-second mono 22 050 Hz buffer produces ≈ 2.5 MB, well under the
 * 4.5 MB Vercel request limit.
 */
function encodeWAV(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const numSamples = buffer.length;
  const bps = 2; // 16-bit PCM
  const dataLen = numCh * numSamples * bps;
  const ab = new ArrayBuffer(44 + dataLen);
  const v = new DataView(ab);

  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  v.setUint32(16, 16, true);       // chunk size
  v.setUint16(20, 1, true);        // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * bps, true);
  v.setUint16(32, numCh * bps, true);
  v.setUint16(34, 16, true);       // bits per sample
  ws(36, "data");
  v.setUint32(40, dataLen, true);

  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/**
 * Crop an audio File to the first maxSec seconds on the client.
 *
 * Strategy:
 *   1. AudioContext.decodeAudioData  — decode the source file in memory
 *   2. OfflineAudioContext (1 ch, 22 050 Hz) — render crop + mix-to-mono +
 *      downsample in a single pass (browser handles resampling)
 *   3. encodeWAV — write PCM WAV Blob, no library
 *
 * Why OfflineAudioContext:
 *   - Does NOT require audio hardware, so iOS Safari does not restrict it
 *   - Handles resampling automatically
 *   - Output is deterministic and synchronous once startRendering resolves
 *
 * Must be called inside a user-gesture handler (form submit satisfies this).
 * Supported: Chrome Android 57+, iOS Safari 14.5+, Firefox Android 4+.
 */
async function cropAudio(file: File, maxSec: number): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();

  // Step 1 — decode (AudioContext needed; close immediately after to free
  // audio hardware resources on mobile)
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    await ctx.close();
  }

  // Step 2 — render cropped + mono + 22 050 Hz via OfflineAudioContext
  // AudioBuffer objects survive AudioContext.close(), so decoded is still valid
  const cropDuration = Math.min(decoded.duration, maxSec);
  const outRate = 22050;
  const outSamples = Math.ceil(outRate * cropDuration);
  const offCtx = new OfflineAudioContext(1, outSamples, outRate);

  const src = offCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offCtx.destination);
  src.start(0);
  // offCtx renders exactly outSamples frames; extra source data is discarded

  const rendered = await offCtx.startRendering();

  // Step 3 — WAV encode
  return encodeWAV(rendered);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DubForm() {
  const [file, setFile] = useState<File | null>(null);
  // Duration from <audio> metadata — cheap, no full decode
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<string>(SUPPORTED_LANGUAGES[0].code);
  const [status, setStatus] = useState<Status>("idle");
  // Non-empty string = show this text in the loading box instead of pipeline steps
  const [loadingLabel, setLoadingLabel] = useState<string>("");
  const [result, setResult] = useState<DubResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  /**
   * On file select, probe duration via <audio> metadata.
   * This reads only the file header — no full decode, fast on mobile.
   * Sets fileDuration so the warning can appear before the user submits.
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setFileDuration(null);
    if (!selected) return;

    const url = URL.createObjectURL(selected);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = url;
    await new Promise<void>((resolve) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => resolve(); // graceful: unknown duration → no crop
    });
    URL.revokeObjectURL(url);

    // Infinity can occur for some streaming formats; treat as unknown
    if (Number.isFinite(audio.duration)) {
      setFileDuration(audio.duration);
    }
  };

  const buildBlobUrl = (base64: string, mimeType: string): string => {
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mimeType }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    setStatus("loading");
    setLoadingLabel("");
    setError(null);
    setResult(null);
    setAudioUrl(null);

    // ── Client-side crop ────────────────────────────────────────────────────
    // Crop only when duration is known AND exceeds the limit.
    // If duration is unknown (null), we skip cropping and send the original.
    let uploadBlob: Blob = file;
    let uploadFilename = file.name;

    const needsCrop = fileDuration !== null && fileDuration > CROP_LIMIT_SEC;
    if (needsCrop) {
      setLoadingLabel("음원 전처리 중 (앞 60초 추출)…");
      try {
        uploadBlob = await cropAudio(file, CROP_LIMIT_SEC);
        // Output is WAV; the server passes mimeType to ElevenLabs STT which
        // accepts WAV natively
        uploadFilename = "cropped_audio.wav";
      } catch (cropErr) {
        // Crop failed (e.g. unsupported codec, OOM on low-end device).
        // Fall back to original file so the rest of the flow can still proceed.
        console.warn("[crop] failed, falling back to original file:", cropErr);
        uploadBlob = file;
        uploadFilename = file.name;
      }
      setLoadingLabel(""); // switch loading box back to pipeline steps text
    }
    // ────────────────────────────────────────────────────────────────────────

    const form = new FormData();
    form.append("audio", uploadBlob, uploadFilename);
    form.append("targetLanguage", targetLanguage);

    try {
      const res = await fetch("/api/dub", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }

      const url = buildBlobUrl(data.audio, data.mimeType);
      blobUrlRef.current = url;
      setAudioUrl(url);
      setResult(data);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `dubbed_${targetLanguage.toLowerCase()}.mp3`;
    a.click();
  };

  const selectedLabel =
    SUPPORTED_LANGUAGES.find((l) => l.code === targetLanguage)?.label ?? targetLanguage;

  const willCrop = fileDuration !== null && fileDuration > CROP_LIMIT_SEC;
  const durationLabel =
    fileDuration !== null
      ? fileDuration < 60
        ? `${Math.round(fileDuration)}초`
        : `${Math.floor(fileDuration / 60)}분 ${Math.round(fileDuration % 60)}초`
      : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* File upload */}
      <div>
        <label className="block text-sm font-medium mb-1">Audio file</label>
        <p className="text-xs text-gray-500 mb-2">
          Accepts MP3, WAV, M4A, FLAC, OGG, and other common audio formats.
          Audio longer than 60 seconds will be cropped to the first 60 seconds
          on your device before upload.
        </p>
        <input
          type="file"
          accept="audio/*"
          onChange={handleFileChange}
          className="block w-full text-sm"
        />
        {file && (
          <div className="mt-1.5 space-y-0.5">
            <p className="text-xs text-gray-400">
              Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              {durationLabel && ` · ${durationLabel}`}
            </p>
            {willCrop && (
              <p className="text-xs font-medium text-amber-600">
                업로드 파일이 1분을 초과하여 앞 60초만 처리합니다.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Language selector */}
      <div>
        <label className="block text-sm font-medium mb-1">Target language</label>
        <p className="text-xs text-gray-500 mb-2">
          The audio will be transcribed, translated, and re-spoken in this language.
        </p>
        <select
          value={targetLanguage}
          onChange={(e) => setTargetLanguage(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm w-full max-w-xs"
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </div>

      {/* Submit */}
      <div>
        <button
          type="submit"
          disabled={!file || status === "loading"}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "loading" ? "Processing…" : "Generate dubbed audio"}
        </button>
      </div>

      {/* Loading — two phases: crop (if needed) then pipeline */}
      {status === "loading" && (
        <div className="rounded-md border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
          <p className="font-medium">Working on it…</p>
          {loadingLabel ? (
            <p className="mt-1 text-blue-600">{loadingLabel}</p>
          ) : (
            <>
              <p className="mt-1 text-blue-600">
                Step 1: Transcribing audio &rarr; Step 2: Translating to{" "}
                {selectedLabel} &rarr; Step 3: Generating speech
              </p>
              <p className="mt-1 text-xs text-blue-500">
                This usually takes 15–45 seconds depending on audio length.
              </p>
            </>
          )}
        </div>
      )}

      {/* Error */}
      {status === "error" && error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium mb-1">Something went wrong</p>
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Results */}
      {status === "done" && result && (
        <>
          <hr className="border-gray-200" />

          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-sm font-semibold mb-1">Original transcript</h2>
              <p className="whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-sm leading-relaxed text-gray-800">
                {result.transcript}
              </p>
            </div>

            <div>
              <h2 className="text-sm font-semibold mb-1">
                Translation &mdash; {selectedLabel}
              </h2>
              <p className="whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-sm leading-relaxed text-gray-800">
                {result.translation}
              </p>
            </div>

            <div>
              <h2 className="text-sm font-semibold mb-2">Dubbed audio</h2>
              {audioUrl && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio controls src={audioUrl} className="w-full" />
              )}
              <button
                type="button"
                onClick={handleDownload}
                className="mt-3 rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                ↓ Download MP3
              </button>
            </div>
          </div>
        </>
      )}
    </form>
  );
}
