"use client";

import { useState, useRef, useEffect } from "react";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";

type Status = "idle" | "loading" | "done" | "error";

interface DubResult {
  transcript: string;
  translation: string;
  audio: string; // base64
  mimeType: string;
}

export default function DubForm() {
  const [file, setFile] = useState<File | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<string>(SUPPORTED_LANGUAGES[0].code);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<DubResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // Track blob URL so we can revoke it on next run / unmount
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const buildBlobUrl = (base64: string, mimeType: string): string => {
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mimeType }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    // Clean up previous blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    setStatus("loading");
    setError(null);
    setResult(null);
    setAudioUrl(null);

    const form = new FormData();
    form.append("audio", file);
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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* File input */}
      <div>
        <label className="block text-sm font-medium mb-1">
          Audio file <span className="text-gray-400 font-normal">(mp3, wav, m4a, …)</span>
        </label>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        {file && (
          <p className="mt-1 text-xs text-gray-500">
            {file.name} — {(file.size / 1024).toFixed(1)} KB
          </p>
        )}
      </div>

      {/* Language selector */}
      <div>
        <label className="block text-sm font-medium mb-1">Target language</label>
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
      <button
        type="submit"
        disabled={!file || status === "loading"}
        className="self-start rounded-md bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      >
        {status === "loading" ? "Processing…" : "Dub audio"}
      </button>

      {/* Loading feedback */}
      {status === "loading" && (
        <p className="text-sm text-gray-500">
          Transcribing → translating to {selectedLabel} → generating speech…
          <br />
          This usually takes 15–45 seconds depending on audio length.
        </p>
      )}

      {/* Error */}
      {status === "error" && error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Results */}
      {status === "done" && result && (
        <div className="flex flex-col gap-5 pt-2">
          <div>
            <h2 className="text-sm font-semibold mb-1">Transcript (original)</h2>
            <p className="whitespace-pre-wrap rounded border bg-gray-50 p-3 text-sm leading-relaxed">
              {result.transcript}
            </p>
          </div>

          <div>
            <h2 className="text-sm font-semibold mb-1">Translation → {selectedLabel}</h2>
            <p className="whitespace-pre-wrap rounded border bg-gray-50 p-3 text-sm leading-relaxed">
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
              className="mt-3 rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100"
            >
              Download MP3
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
