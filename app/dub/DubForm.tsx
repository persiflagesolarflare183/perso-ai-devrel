"use client";

import { useState, useRef, useEffect } from "react";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";

const CROP_LIMIT_SEC = 60;
const MAX_FILE_MB = 500;

/** Returns a Korean error string if the file is invalid, null if OK. */
function validateFile(file: File): string | null {
  const sizeMB = file.size / 1024 / 1024;
  if (sizeMB > MAX_FILE_MB) {
    return `파일이 너무 큽니다 (${Math.round(sizeMB)} MB). ${MAX_FILE_MB} MB 이하 파일을 사용해 주세요.`;
  }
  const isAudio = file.type.startsWith("audio/");
  const isVideo = ["video/mp4", "video/webm", "video/quicktime"].includes(file.type);
  if (!isAudio && !isVideo) {
    return (
      `지원하지 않는 파일 형식입니다 (${file.type || "알 수 없음"}).\n` +
      "오디오: MP3, WAV, M4A, FLAC, OGG 등 / 영상: MP4, WebM 파일을 사용해 주세요."
    );
  }
  return null;
}

type Status = "idle" | "loading" | "done" | "error";

interface DubResult {
  transcript: string;
  translation: string;
  detectedLanguage: string | null;
  audio: string; // base64
  mimeType: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  ko: "한국어", en: "영어", ja: "일본어", zh: "중국어",
  es: "스페인어", fr: "프랑스어", de: "독일어",
  pt: "포르투갈어", it: "이탈리아어", ru: "러시아어",
};

// ── Client-side media helpers ─────────────────────────────────────────────────

/**
 * Encode an AudioBuffer as 16-bit PCM WAV.
 * 60 s mono 22 050 Hz → ≈ 2.5 MB — well under Vercel's 4.5 MB request limit.
 * No external library — pure DataView.
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
  v.setUint32(16, 16, true);      // chunk size
  v.setUint16(20, 1, true);       // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * bps, true);
  v.setUint16(32, numCh * bps, true);
  v.setUint16(34, 16, true);      // bits per sample
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
 * Extract audio from an audio OR video file, optionally cropping to maxSec.
 * Pass maxSec = Infinity to extract the full duration without cropping.
 *
 * How it works:
 *   1. AudioContext.decodeAudioData(file.arrayBuffer())
 *      Modern browsers can decode the audio track from common video containers
 *      (MP4/AAC, WebM/Opus) the same way they decode audio files — no ffmpeg.
 *   2. OfflineAudioContext (1 ch, 22 050 Hz) renders the crop + mix-to-mono +
 *      resample in a single pass. Does NOT touch audio hardware, so iOS Safari
 *      does not apply the user-gesture lock.
 *   3. encodeWAV() writes a PCM WAV Blob (~2.5 MB for 60 s).
 *
 * Browser support:
 *   Chrome/Edge Android 57+   ✅ MP4, WebM
 *   iOS Safari 14.5+           ✅ MP4/AAC (most iOS-recorded videos)
 *   Firefox Android 4+         ✅ WebM (Vorbis/Opus), MP4 in most builds
 *
 * Limitations:
 *   - Reads entire file into memory before processing. Not suitable for files
 *     several hundred MB or larger on low-memory devices.
 *   - WebM/Vorbis: not supported on Safari (video recorded on iOS is MP4).
 *   - Video with no audio track: decodeAudioData throws — caller shows error.
 *
 * Must be called inside a user-gesture handler (form submit satisfies this).
 */
async function extractAndCropAudio(file: File, maxSec: number): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();

  // Step 1 — decode audio track. Close AudioContext immediately after to
  // release mobile audio hardware resources.
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    await ctx.close();
  }
  // AudioBuffer objects survive AudioContext.close() — decoded is still valid.

  // Step 2 — render crop/extract via OfflineAudioContext.
  const cropDuration = Math.min(decoded.duration, maxSec);
  const outRate = 22050;
  const outSamples = Math.ceil(outRate * cropDuration);
  const offCtx = new OfflineAudioContext(1, outSamples, outRate);

  const src = offCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offCtx.destination);
  src.start(0);
  // offCtx renders exactly outSamples frames; any remaining source data is
  // discarded automatically.

  const rendered = await offCtx.startRendering();

  // Step 3 — encode to WAV.
  return encodeWAV(rendered);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DubForm() {
  const [file, setFile] = useState<File | null>(null);
  // Duration probed from file metadata on select — no full decode needed.
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<string>(SUPPORTED_LANGUAGES[0].code);
  const [status, setStatus] = useState<Status>("idle");
  // -1 = not loading; 0 = 파일 확인 중; 1 = 추출/전처리 중; 2 = 서버 처리 중
  const [step, setStep] = useState<number>(-1);
  const [result, setResult] = useState<DubResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  /**
   * Probe duration from file metadata without full decode.
   * Uses <video> element for video files — iOS Safari reads video metadata
   * more reliably from a <video> element than from <audio>.
   */
  const selectFile = async (selected: File | null) => {
    setFile(selected);
    setFileDuration(null);
    setResult(null);
    setError(null);
    setStatus("idle");
    setAudioUrl(null);
    if (!selected) return;

    const url = URL.createObjectURL(selected);
    const isVid = selected.type.startsWith("video/");
    const el = document.createElement(isVid ? "video" : "audio") as
      | HTMLVideoElement
      | HTMLAudioElement;
    el.preload = "metadata";
    el.src = url;

    await new Promise<void>((resolve) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => resolve(); // graceful: unknown duration → no warning shown
    });
    URL.revokeObjectURL(url);

    // Infinity can occur for some streaming/live formats — treat as unknown.
    if (Number.isFinite(el.duration)) {
      setFileDuration(el.duration);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await selectFile(e.target.files?.[0] ?? null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    await selectFile(e.dataTransfer.files[0] ?? null);
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

    // Client-side validation before any processing
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      setStatus("error");
      return;
    }

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    setStatus("loading");
    setStep(0); // 파일 확인 중
    setError(null);
    setResult(null);
    setAudioUrl(null);

    const isVideo = file.type.startsWith("video/");
    const needsCrop = fileDuration !== null && fileDuration > CROP_LIMIT_SEC;

    let uploadBlob: Blob = file;
    let uploadFilename = file.name;

    if (isVideo) {
      // ── Video path ─────────────────────────────────────────────────────────
      // Always extract audio from video — the server only accepts audio; we
      // must never send a raw video file to /api/dub.
      // On extraction failure we hard-stop and show an error instead of
      // silently uploading the video (which the server cannot process).
      setStep(1); // 음성 추출 중

      try {
        uploadBlob = await extractAndCropAudio(
          file,
          needsCrop ? CROP_LIMIT_SEC : Infinity,
        );
        uploadFilename = "extracted_audio.wav";
      } catch (extractErr) {
        console.error("[video extract] failed:", extractErr);
        setError(
          "이 영상에서 오디오를 추출하지 못했습니다. " +
            "MP4 또는 WebM 파일인지 확인하거나, 오디오 파일을 직접 업로드해 보세요.\n" +
            "MOV·HEVC 등 일부 코덱은 현재 브라우저가 지원하지 않을 수 있습니다.",
        );
        setStatus("error");
        setStep(-1);
        return; // hard stop — do not attempt to upload raw video
      }
    } else if (needsCrop) {
      // ── Long audio path ────────────────────────────────────────────────────
      setStep(1); // 음원 전처리 중
      try {
        uploadBlob = await extractAndCropAudio(file, CROP_LIMIT_SEC);
        uploadFilename = "cropped_audio.wav";
      } catch (cropErr) {
        // Crop failed but the file is still audio — fall back to original so
        // the server can attempt transcription directly.
        console.warn("[audio crop] failed, falling back to original:", cropErr);
        uploadBlob = file;
        uploadFilename = file.name;
      }
    }
    // else: short audio — send original file as-is (fast path, no processing).

    setStep(2); // 서버 처리 중

    const form = new FormData();
    form.append("audio", uploadBlob, uploadFilename);
    form.append("targetLanguage", targetLanguage);

    try {
      const res = await fetch("/api/dub", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? `서버 오류 (${res.status}). 잠시 후 다시 시도해 주세요.`);
      }

      const url = buildBlobUrl(data.audio, data.mimeType);
      blobUrlRef.current = url;
      setAudioUrl(url);
      setResult(data);
      setStatus("done");
      setStep(-1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      setError(message);
      setStatus("error");
      setStep(-1);
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

  const isVideoFile = file?.type.startsWith("video/") ?? false;
  const willCrop = fileDuration !== null && fileDuration > CROP_LIMIT_SEC;
  const durationLabel =
    fileDuration !== null
      ? fileDuration < 60
        ? `${Math.round(fileDuration)}초`
        : `${Math.floor(fileDuration / 60)}분 ${Math.round(fileDuration % 60)}초`
      : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">

      {/* ── Step 1: File upload ──────────────────────────────────────────────── */}
      <div className="bg-white border border-[#e4e3df] rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-7 h-7 rounded-lg bg-[rgba(37,99,235,0.1)] text-blue-600 text-[13px] font-bold flex items-center justify-center flex-shrink-0">
            01
          </span>
          <div>
            <p className="text-sm font-semibold text-[#1a1917]">파일 선택</p>
            <p className="text-xs text-[#a8a29e]">오디오 또는 영상 파일을 업로드하세요</p>
          </div>
        </div>

        {!file ? (
          <label
            className={`flex flex-col items-center gap-3 w-full cursor-pointer rounded-xl border-[1.5px] border-dashed py-8 px-4 text-center transition-all duration-150 ${
              isDragging
                ? "border-blue-400 bg-[rgba(37,99,235,0.06)]"
                : "border-[#d0cfc9] hover:border-blue-500 hover:bg-[rgba(37,99,235,0.04)]"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className={`w-11 h-11 rounded-xl border flex items-center justify-center text-xl transition-all ${
              isDragging ? "bg-[rgba(37,99,235,0.07)] border-[rgba(37,99,235,0.25)]" : "bg-[#f5f4f0] border-[#e4e3df]"
            }`}>
              🎵
            </div>
            <div>
              <p className="text-sm font-medium text-[#1a1917] mb-0.5">
                {isDragging ? "여기에 놓으세요" : (
                  <><span className="text-blue-600">파일 선택</span> 또는 드래그 앤 드롭</>
                )}
              </p>
              <p className="text-xs text-[#a8a29e]">60초 초과 시 앞 60초만 처리됩니다</p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {["MP3", "WAV", "M4A", "FLAC", "OGG", "MP4", "WebM"].map((f) => (
                <span key={f} className="bg-[#f5f4f0] border border-[#e4e3df] rounded-md px-2 py-0.5 text-[11px] font-medium text-[#a8a29e] tracking-wide">
                  {f}
                </span>
              ))}
            </div>
            <input
              type="file"
              accept="audio/*,video/mp4,video/webm,video/quicktime"
              onChange={handleFileChange}
              className="sr-only"
            />
          </label>
        ) : (
          <div className="flex items-center gap-3 bg-[rgba(37,99,235,0.06)] border border-[rgba(37,99,235,0.2)] rounded-xl px-4 py-3.5">
            <span className="text-2xl">{isVideoFile ? "🎬" : "🎵"}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#1a1917] truncate">{file.name}</p>
              <p className="text-xs text-[#a8a29e]">
                {(file.size / 1024 / 1024).toFixed(1)} MB
                {durationLabel && ` · ${durationLabel}`}
                {isVideoFile && " · 영상"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => selectFile(null)}
              className="text-[#a8a29e] hover:text-[#1a1917] hover:bg-black/5 rounded-lg p-1.5 transition-colors text-xl leading-none"
            >
              ×
            </button>
          </div>
        )}

        {willCrop && (
          <div className="flex items-start gap-2 mt-3 bg-[#fff7ed] border border-[#fed7aa] rounded-xl px-3.5 py-2.5 text-sm text-[#92400e] leading-relaxed">
            <span className="text-base flex-shrink-0 mt-0.5">⚠️</span>
            <span>
              {isVideoFile
                ? "영상이 1분을 초과하여 앞 60초의 오디오만 처리합니다."
                : "파일이 1분을 초과하여 앞 60초만 처리합니다."}
            </span>
          </div>
        )}
      </div>

      {/* ── Step 2: Language ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#e4e3df] rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-7 h-7 rounded-lg bg-[rgba(37,99,235,0.1)] text-blue-600 text-[13px] font-bold flex items-center justify-center flex-shrink-0">
            02
          </span>
          <div>
            <p className="text-sm font-semibold text-[#1a1917]">목표 언어</p>
            <p className="text-xs text-[#a8a29e]">원본 언어는 자동으로 감지됩니다</p>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_40px_1fr] items-end gap-2">
          <div>
            <label className="block text-[11px] font-medium text-[#a8a29e] uppercase tracking-widest mb-1.5">
              원본
            </label>
            <div className="w-full border border-[#e4e3df] rounded-xl px-3 py-2.5 text-sm font-medium text-[#a8a29e] bg-[#f5f4f0] select-none">
              자동 감지
            </div>
          </div>
          <div className="flex items-center justify-center h-[42px] text-[#a8a29e] text-base">
            →
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#a8a29e] uppercase tracking-widest mb-1.5">
              목표
            </label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="w-full border-[1.5px] border-[#e4e3df] rounded-xl px-3 py-2.5 text-sm font-medium text-[#1a1917] bg-[#f5f4f0] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none cursor-pointer transition-all appearance-none"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Generate button ───────────────────────────────────────────────────── */}
      <button
        type="submit"
        disabled={!file || status === "loading"}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-[#93c5fd] text-white rounded-2xl px-6 py-4 text-[15px] font-semibold transition-all hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(37,99,235,0.28)] active:translate-y-0 disabled:cursor-not-allowed"
      >
        {status === "loading" ? (
          <>
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            처리 중…
          </>
        ) : (
          "더빙 생성"
        )}
      </button>
      {status !== "loading" && (
        <p className="text-center text-xs text-[#a8a29e]">보통 15~45초 정도 소요됩니다</p>
      )}

      {/* ── Loading card ──────────────────────────────────────────────────────── */}
      {status === "loading" && (
        <div className="bg-white border border-[#e4e3df] rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.06)]">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 rounded-full border-[3px] border-[#e4e3df] border-t-blue-600 animate-spin" />
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-sm font-semibold text-[#1a1917]">
                {step === 0 && "파일 확인 중…"}
                {step === 1 && (isVideoFile ? "영상에서 오디오 추출 중…" : "음원 전처리 중…")}
                {step === 2 && "서버에서 처리 중…"}
              </p>
              {step === 2 && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1">
                  <span className="text-xs font-medium text-blue-500">음성 전사</span>
                  <span className="text-xs text-[#a8a29e]">→</span>
                  <span className="text-xs font-medium text-blue-500">{selectedLabel} 번역</span>
                  <span className="text-xs text-[#a8a29e]">→</span>
                  <span className="text-xs font-medium text-blue-500">음성 합성</span>
                </div>
              )}
              <p className="text-xs text-[#a8a29e] mt-0.5">오디오 길이에 따라 15~45초 소요됩니다</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────────── */}
      {status === "error" && error && (
        <div className="bg-white border border-red-100 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-sm font-semibold text-red-700 mb-1">오류가 발생했습니다</p>
          <p className="whitespace-pre-wrap text-sm text-red-600">{error}</p>
          <p className="mt-2.5 text-xs text-red-400">
            다른 파일 형식으로 시도하거나, 더 짧은 오디오 파일을 업로드해 보세요.
          </p>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────────────── */}
      {status === "done" && result && (
        <div className="bg-white border border-[#e4e3df] rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.06)]">
          <div className="flex items-center gap-2.5 mb-5">
            <span className="w-7 h-7 rounded-full bg-[#dcfce7] text-green-600 flex items-center justify-center text-sm flex-shrink-0">
              ✓
            </span>
            <div>
              <p className="text-sm font-semibold text-[#1a1917]">더빙 완료</p>
              <p className="text-xs text-[#a8a29e]">{selectedLabel}로 더빙되었습니다</p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {/* Transcript */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#a8a29e]">
                  원문 전사
                  {result.detectedLanguage && (
                    <span className="ml-2 normal-case text-blue-400">
                      {LANGUAGE_NAMES[result.detectedLanguage] ?? result.detectedLanguage}
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob([result.transcript], { type: "text/plain" }));
                    a.download = "transcript.txt";
                    a.click();
                  }}
                  className="text-xs text-[#a8a29e] hover:text-blue-500 transition-colors"
                >
                  ↓ txt
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#57534e] bg-[#f5f4f0] rounded-xl px-4 py-3">
                {result.transcript}
              </p>
            </div>

            <div className="h-px bg-[#e4e3df]" />

            {/* Translation */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#a8a29e]">
                  번역 — {selectedLabel}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob([result.translation], { type: "text/plain" }));
                    a.download = `translation_${targetLanguage.toLowerCase()}.txt`;
                    a.click();
                  }}
                  className="text-xs text-[#a8a29e] hover:text-blue-500 transition-colors"
                >
                  ↓ txt
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#57534e] bg-[#f5f4f0] rounded-xl px-4 py-3">
                {result.translation}
              </p>
            </div>

            <div className="h-px bg-[#e4e3df]" />

            {/* Audio */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#a8a29e] mb-2.5">
                더빙 오디오
              </p>
              {audioUrl && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio controls src={audioUrl} className="w-full mb-3" />
              )}
              <button
                type="button"
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 bg-[#f5f4f0] border-[1.5px] border-[#d0cfc9] rounded-xl px-4 py-3 text-sm font-medium text-[#1a1917] hover:border-blue-500 hover:bg-[rgba(37,99,235,0.04)] hover:text-blue-600 transition-all"
              >
                ↓ MP3 다운로드
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset */}
      {status === "done" && (
        <button
          type="button"
          onClick={() => selectFile(null)}
          className="w-full rounded-xl border border-[#e4e3df] py-2.5 text-sm font-medium text-[#a8a29e] hover:border-[#d0cfc9] hover:text-[#57534e] transition-colors"
        >
          다시 더빙하기
        </button>
      )}
    </form>
  );
}
