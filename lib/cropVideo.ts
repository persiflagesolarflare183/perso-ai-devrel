/**
 * FFmpeg-wasm 기반 영상 크롭 유틸리티.
 *
 * - MediaRecorder 방식(실시간 녹화)과 달리 재인코딩 없이 컨테이너만 재구성하므로
 *   60초 클립 기준 ~1-2초에 처리 완료.
 * - WASM (~24 MB)은 최초 1회만 CDN에서 내려받고 이후 브라우저가 캐시.
 * - MP4 / WebM / QuickTime 모두 지원.
 */

// Module-level singleton: FFmpeg 인스턴스를 한 번만 로드
let _instance: unknown = null;
let _loadPromise: Promise<unknown> | null = null;

async function getFFmpeg() {
  if (_instance && (_instance as any).loaded) return _instance as any;

  if (!_loadPromise) {
    _loadPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ffmpeg = new FFmpeg();
      const base = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
      _instance = ffmpeg;
      return ffmpeg;
    })();
  }

  return _loadPromise;
}

/**
 * 영상 파일의 [startSec, endSec] 구간을 크롭한 Blob 반환.
 * `-c copy` 플래그로 재인코딩 없이 처리 → 거의 즉시 완료.
 */
export async function cropVideoFast(
  file: File,
  startSec: number,
  endSec: number,
): Promise<Blob> {
  const ffmpeg = await getFFmpeg() as any;
  const { fetchFile } = await import("@ffmpeg/util");

  const ext = file.type.includes("webm") ? "webm" : "mp4";
  const inputName = `input.${ext}`;
  const outputName = `output.${ext}`;

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  await ffmpeg.exec([
    "-i", inputName,
    "-ss", String(startSec),
    "-t",  String(endSec - startSec),
    "-c",  "copy",
    "-avoid_negative_ts", "make_zero",
    outputName,
  ]);

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  // SharedArrayBuffer일 수 있으므로 명시적으로 ArrayBuffer로 복사
  const arrayBuffer = data.buffer.slice(0) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: file.type || `video/${ext}` });
}
