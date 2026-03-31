# Dubago

Google OAuth 로그인과 이메일 화이트리스트 기반 접근 제어를 갖춘 AI 더빙 웹 서비스, **Dubago**입니다.

---

## 1. 서비스 소개 및 주요 기능

오디오 또는 영상 파일을 업로드하고 목표 언어를 선택하면, 음성 전사(STT) → 번역 → 음성 합성(TTS) 파이프라인을 거쳐 더빙 오디오를 생성합니다. 더빙 오디오는 원본 발화 타이밍에 맞춰 재생되며, 더빙된 영상(자막 burn-in 포함)을 WebM으로 다운로드할 수 있습니다.

Google 계정으로 로그인하며, Turso DB에 등록된 이메일만 서비스를 이용할 수 있습니다. 미등록 계정은 로그인 시 세션 생성 없이 `/blocked` 페이지로 이동합니다.

### 주요 기능

- **Google OAuth 로그인 + Turso 화이트리스트 접근 제어** — 미등록 이메일은 세션 없이 차단
- **오디오 파일 업로드** — MP3, WAV, M4A, FLAC, OGG 등 `audio/*` 형식
- **영상 파일 업로드** — MP4, WebM, QuickTime — 오디오 트랙을 클라이언트에서 추출하여 더빙 파이프라인에 전달
- **구간 크롭 슬라이더** — 최대 60초 구간을 자유롭게 선택. FFmpeg WASM으로 영상을 재인코딩 없이 1~2초 내 크롭
- **음성 타이밍 싱크** — ElevenLabs Scribe 단어 타임스탬프 기반으로 발화 세그먼트를 분리하고, 각 세그먼트의 TTS를 원본 발화 시각에 배치. `OfflineAudioContext`로 크롭 구간 길이와 정확히 일치하는 WAV 조립
- **원본 / 더빙 패널 분리** — 원본 영상(항상 원본 파일 유지)과 더빙 영상(음소거 + 더빙 오디오 동기화)을 나란히 표시
- **자막 토글** — 번역 텍스트를 영상 플레이어 위에 오버레이. ON/OFF 실시간 전환
- **더빙 영상 다운로드** — 캔버스에 영상 프레임을 직접 그리고 자막을 burn-in하여 WebM(vp9+opus)으로 저장
- **더빙 오디오 다운로드** — WAV 파일로 저장
- **60초 클라이언트 전처리** — 60초 초과 파일은 기기에서 앞 60초만 추출 후 업로드
- **클라이언트 파일 유효성 검사** — 미지원 MIME 타입 및 500 MB 초과 파일은 업로드 전 즉시 오류 표시
- **단계별 진행 상태 표시** — 파일 확인 → 오디오 추출 → 전사 → 번역 → 음성 합성 → 영상 크롭 각 단계별 안내
- **ElevenLabs Scribe v1 자동 전사 (STT)** — 원본 언어 자동 감지, 단어 수준 타임스탬프 수집
- **DeepL 일괄 번역** — 발화 세그먼트 전체를 단일 요청으로 번역
- **ElevenLabs `eleven_multilingual_v2` 음성 합성 (TTS)** — 세그먼트별 병렬 TTS 생성
- **인메모리 레이트 리밋** — 사용자당 10분에 10회 제한 (API 크레딧 남용 방지)

### 파일 업로드 동작

| 파일 유형 | 길이 | 클라이언트 처리 | 서버 수신 |
|---|---|---|---|
| 오디오 | ≤ 60초 | 없음 — 원본 그대로 | 원본 파일 |
| 오디오 | > 60초 | 앞 60초 추출 → WAV 인코딩 | WAV (≈ 2.5 MB) |
| 영상 | 임의 | 선택 구간 오디오 추출 → WAV 인코딩 | WAV (≈ 2.5 MB) |

서버는 항상 오디오만 수신합니다. 영상 원본은 서버로 전송되지 않습니다.

### 아키텍처 선택 이유

- **클라이언트 전처리:** Vercel 서버리스 함수 요청 크기 한계(4.5 MB) 내에서 동작하도록, 긴 파일은 기기에서 앞 60초만 추출합니다. 60초 스테레오 WAV는 약 5 MB 이내로 이 한계에 맞습니다.
- **FFmpeg WASM 영상 크롭:** `@ffmpeg/ffmpeg` + CDN 로드 WASM으로 `-c copy` 옵션(재인코딩 없음)을 사용해 60초 클립을 1~2초 내에 크롭합니다. MediaRecorder 방식(실시간 녹화, 60초 대기) 대비 대기 시간을 대폭 줄입니다.
- **서버가 오디오만 수신:** 더빙 파이프라인(STT → 번역 → TTS)은 오디오만 처리하므로 영상 원본을 서버로 보낼 이유가 없습니다.
- **타이밍 싱크 클라이언트 조립:** Vercel 함수 타임아웃(60초) 안에서 여러 TTS 결과를 조립하려면 서버 왕복 없이 클라이언트에서 `OfflineAudioContext`로 직접 조립하는 편이 안정적입니다.

---

## 2. 사용한 기술 스택

| 분류 | 기술 |
|---|---|
| 프레임워크 | Next.js 16.2.1 (App Router) |
| 언어 | TypeScript 5 |
| UI | React 19, Tailwind CSS 4, Syne (Google Fonts) |
| 인증 | Auth.js v5 (next-auth@beta), Google OAuth |
| DB | Turso (libSQL) — 화이트리스트 이메일 저장 |
| STT | ElevenLabs Scribe v1 (단어 타임스탬프 포함) |
| 번역 | DeepL API (일괄 번역) |
| TTS | ElevenLabs `eleven_multilingual_v2` (세그먼트별 병렬) |
| 영상 크롭 | FFmpeg WASM (`@ffmpeg/ffmpeg`, `@ffmpeg/core@0.12.6`) |
| 오디오 처리 | 브라우저 내장 Web Audio API (`AudioContext`, `OfflineAudioContext`) |
| 영상 다운로드 | Canvas API + MediaRecorder (WebM/vp9+opus) |
| 배포 | Vercel |

---

## 3. 로컬 실행 방법

### 환경 변수

프로젝트 루트에 `.env.local` 파일을 생성하고 아래 값을 입력하세요.

```bash
# Auth.js — npx auth secret 으로 생성
AUTH_SECRET=

# Google OAuth — Google Cloud Console → APIs & Services → Credentials
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Turso
TURSO_DATABASE_URL=     # libsql://your-db-name.turso.io
TURSO_AUTH_TOKEN=       # turso db tokens create <db-name>

# ElevenLabs
ELEVENLABS_API_KEY=     # elevenlabs.io → Profile → API Key
ELEVENLABS_VOICE_ID=    # Voice Lab에서 본인 소유 보이스 ID (필수, 기본값 없음)

# DeepL
DEEPL_API_KEY=          # deepl.com/pro-api 무료 키 (끝이 :fx)
```

### 외부 서비스 설정

**Google OAuth** — [Google Cloud Console](https://console.cloud.google.com) → Credentials → OAuth 2.0 클라이언트 생성 → 리디렉션 URI에 `http://localhost:3000/api/auth/callback/google` 추가

**Turso** — DB 생성 후 아래 SQL 실행

```bash
turso db create <db-name> && turso db shell <db-name>
```
```sql
CREATE TABLE whitelist (email TEXT PRIMARY KEY NOT NULL);
INSERT INTO whitelist (email) VALUES ('your@email.com');
```

**ElevenLabs** — `elevenlabs.io/app/voice-lab` → 본인 계정 소유 보이스의 Voice ID 복사 → `ELEVENLABS_VOICE_ID`에 입력  
Voice Library의 타인 보이스는 무료 플랜에서 402 오류 발생합니다.

**DeepL** — `deepl.com/pro-api` 무료 계정 생성 → API 키 복사

### 설치 및 실행

```bash
npm install
npm run dev
```

`http://localhost:3000` 접속 시 자동으로 `/login`으로 이동합니다.

---

## 4. 배포된 서비스 URL

**[https://perso-ai-devrel.vercel.app](https://perso-ai-devrel.vercel.app/login)**

GitHub `main` 브랜치 push 시 Vercel이 자동으로 빌드·배포합니다. Vercel 프로젝트 Settings → Environment Variables에 위 환경 변수 8개를 모두 입력하고, Google Cloud Console에 Vercel 도메인의 리디렉션 URI도 추가해야 합니다.

---

## 5. 코딩 에이전트 활용 방법 및 노하우

Claude Code를 아키텍처 설계·코드 작성·디버깅·문서화 전 과정에서 활용했습니다. 각 단계를 명확한 요청 단위로 나눠 진행하고, 결과를 직접 실행해 검증하는 방식으로 작업했습니다.

**잘 처리한 작업**

- **Next.js 16 breaking change 파악:** 구현 전 `node_modules/next/dist/docs/`를 직접 읽어 `middleware.ts` → `proxy.ts` 변경, `cookies()` async 필수화 등을 확인하고 코드에 반영했습니다.
- **Auth 구조 설계:** `signIn` 콜백에서 `return "/blocked"`(문자열)는 세션 생성 후 리다이렉트한다는 점을 스스로 지적하고, `return false` + `pages.error: "/blocked"` 구조로 수정해 차단 계정에 세션이 생성되지 않도록 했습니다.
- **영상 크롭 성능 개선:** MediaRecorder 방식(실시간 60초 대기)에서 FFmpeg WASM(`-c copy`, 재인코딩 없음)으로 전환해 대기 시간을 1~2초로 단축하는 구조를 설계·구현했습니다.
- **음성 타이밍 싱크 파이프라인:** ElevenLabs 단어 타임스탬프 → 묵음 기반 세그먼트 분리 → DeepL 일괄 번역 → 병렬 TTS → `OfflineAudioContext` 조립 전 과정을 서버/클라이언트 역할을 나눠 구현했습니다.
- **영상 다운로드 오디오 문제 디버깅:** `AudioContext` suspended 상태, `video/mp4` 오디오 누락, 모노 채널 드롭 등 여러 브라우저 미디어 API 이슈를 순차적으로 식별하고 수정했습니다. 최종적으로 `audio.captureStream()` 직접 추출 + WebM/vp9+opus 코덱 명시 + 스테레오 WAV 조합으로 해결했습니다.
- **자막 burn-in 다운로드:** Canvas RAF 루프에서 영상 프레임과 자막 텍스트를 함께 그려 WebM으로 녹화하는 방식을 구현했습니다.

**사람이 직접 확인한 작업**

- Google Cloud Console OAuth 클라이언트 설정 및 리디렉션 URI 등록
- Turso 계정 생성, DB 생성, 화이트리스트 이메일 입력
- ElevenLabs 무료 플랜 호환 보이스 ID 확인 및 입력
- ElevenLabs 플랜 업그레이드 후 API 키 동작 여부 확인
- 전체 더빙 흐름 로컬 및 배포 환경 동작 검증

**겪은 문제와 해결**

- **ElevenLabs 429 오류 오인:** HTTP 429(레이트 리밋)를 크레딧 소진(402)으로 잘못 매핑해 "크레딧 부족" 메시지가 표시됐습니다. 상태 코드별 매핑을 수정했습니다.
- **AudioContext suspended 블로킹:** Web Audio API로 원본 오디오를 무음 처리하려 했으나, `createMediaElementSource` 후 suspended 상태의 AudioContext가 영상 재생 자체를 막았습니다. 단순 force-mute 방식으로 되돌려 해결했습니다.
- **다운로드 영상 무음:** `new AudioContext()`를 `await` 이후에 생성하면 user gesture 컨텍스트가 만료되어 suspended 상태로 시작합니다. AudioContext 생성 시점을 버튼 클릭 직후로 앞당기고, `audio.captureStream()`으로 Web Audio 경로를 우회해 해결했습니다.

**노하우**

- "먼저 계획만 세우고, 즉시 코드 수정은 하지 않기" 방식이 효과적이었습니다. 인증·DB·배포처럼 되돌리기 어려운 영역은 구조를 먼저 검토한 뒤 구현했습니다.
- 브라우저 미디어 API(Web Audio, MediaRecorder, captureStream)는 브라우저별·컨텍스트별 동작이 달라서 코드만으로는 검증이 어렵습니다. 반드시 실기기에서 직접 확인해야 합니다.
- 코딩 에이전트는 원인 분석과 코드 수정은 빠르지만, 실제 오디오/영상 출력 품질과 브라우저 호환성은 사람이 직접 재생해봐야 합니다.

---

## 한계점 및 고려사항

- 영상 다운로드는 WebM 형식으로만 제공됩니다. iOS Safari는 WebM 재생을 지원하지 않으므로 오디오(WAV) 다운로드를 사용해야 합니다.
- FFmpeg WASM(약 24 MB)은 최초 실행 시 CDN에서 다운로드하며 10~30초 소요될 수 있습니다. 이후 브라우저 캐시에 저장됩니다.
- 500 MB 초과 파일은 클라이언트에서 업로드 전 차단됩니다. 그 이하여도 수백 MB 이상 파일은 저사양 모바일에서 메모리 부족으로 실패할 수 있습니다.
- 영상 오디오 추출 브라우저 지원: Chrome/Android MP4·WebM ✅, iOS Safari MP4/AAC ✅, MOV·HEVC 등 일부 코덱은 브라우저에 따라 실패할 수 있습니다.
- 화자 분리(diarization) 및 보이스 클로닝 미지원 — 출력 음성은 `ELEVENLABS_VOICE_ID`에 설정한 단일 보이스입니다.
- 서버리스 함수 타임아웃은 60초입니다. 발화 세그먼트가 매우 많으면 병렬 TTS 합성이 타임아웃될 수 있습니다.
- 모바일 실기기 테스트는 iOS Safari, Android Chrome 최소 2종에서 직접 확인을 권장합니다.

---

## 수동 테스트 체크리스트

로컬(`npm run dev`) 또는 배포 환경에서 아래 항목을 확인하세요.

### 기본 흐름

| # | 시나리오 | 기대 동작 |
|---|---|---|
| 1 | **오디오 ≤ 60초** 업로드 → 더빙 생성 | 원본 파일 그대로 서버 전송, 전사·번역·TTS 정상 완료 |
| 2 | **오디오 > 60초** 업로드 | 파일 선택 직후 황색 경고 표시. 제출 시 단계별 진행 후 더빙 완료 |
| 3 | **영상(MP4)** 업로드 → 구간 슬라이더 조절 → 더빙 | 선택 구간 오디오 추출 → 더빙 완료, 영상 크롭도 1~2초 내 완료 |
| 4 | 결과 확인 | 원문 전사(감지 언어 표시)·번역 텍스트·더빙 재생·WAV 다운로드·TXT 다운로드 모두 정상 |
| 5 | **더빙 영상 재생** | 영상 재생 시 더빙 음성이 원본 발화 타이밍에 맞춰 재생됨 |
| 6 | **자막 토글** | ON 시 영상 위에 번역 자막 표시, OFF 시 사라짐 |
| 7 | **더빙 영상 다운로드** | WebM 파일 다운로드, 영상+더빙 오디오+자막 burn-in 포함 확인 |
| 8 | **원본/더빙 패널** | 원본 패널 영상이 더빙 처리 후에도 원본 그대로 유지됨 |
| 9 | 비허가 계정 로그인 | `/blocked` 페이지 이동, 세션 미생성 |
| 10 | 로그아웃 | `/login` 리다이렉트, 이후 `/dub` 직접 접근 시 `/login` 리다이렉트 |
| 11 | **드래그 앤 드롭** | 드롭존 드래그 시 파란 테두리 표시 → 드롭 시 파일 선택됨 |
| 12 | **다시 더빙하기** | 결과 하단 버튼 클릭 시 폼 초기 상태로 리셋 |

### 모바일

| # | 환경 | 확인 항목 |
|---|---|---|
| 13 | **Android Chrome** | MP4 영상 업로드 → 구간 크롭 → 더빙 재생 → 다운로드 |
| 14 | **iPhone Safari** | MP4 영상(카메라 촬영본) 업로드 → 더빙 완료 → 오디오 다운로드 |
| 15 | **iPhone Safari** | MOV 파일 업로드 시 오류 메시지 표시 (조용히 실패하지 않음) |

### 오류 처리 및 유효성 검사

| # | 시나리오 | 기대 동작 |
|---|---|---|
| 16 | 지원되지 않는 영상 코덱(MOV 등) 업로드 | 추출 실패 오류 메시지 (코덱 안내 포함), 서버 미전송 |
| 17 | `.docx` 등 미지원 파일 형식 제출 | 즉시 "지원하지 않는 파일 형식" 오류 표시, 서버 미전송 |
| 18 | **500 MB 초과** 파일 제출 | 즉시 파일 크기 초과 오류 표시 (MB 수치 포함), 서버 미전송 |
| 19 | ElevenLabs 레이트 리밋 도달 | "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." 표시 |
| 20 | 10분 내 11회 이상 요청 | 429 레이트 리밋 응답, 안내 메시지 표시 |
