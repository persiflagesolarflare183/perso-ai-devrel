import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5 py-10 relative overflow-hidden bg-[#f5f4f0]">

      {/* Dot grid */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, #c4c3be 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          opacity: 0.45,
        }}
      />
      {/* Color wash */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 15% 20%, rgba(219,234,254,0.55) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 85% 80%, rgba(236,252,203,0.4) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center w-full max-w-[440px]">

        {/* Wordmark */}
        <div className="flex items-center gap-2.5 mb-12">
          <span className="font-[family-name:var(--font-syne)] text-[18px] font-bold tracking-tight text-[#1a1917]">
            Dubago
          </span>
        </div>

        {/* Headline */}
        <h1
          className="font-[family-name:var(--font-syne)] text-center font-extrabold leading-[1.05] tracking-tight text-[#1a1917] mb-4"
          style={{ fontSize: "clamp(34px, 6vw, 52px)" }}
        >
          목소리를<br />
          <em className="not-italic text-blue-600">언어의 경계</em> 너머로.
        </h1>

        {/* Subtitle */}
        <p className="text-[15px] text-[#57534e] text-center leading-[1.65] mb-10">
          오디오·영상을 업로드하면<br />
          원하는 언어로 자연스럽게 더빙해드립니다.
        </p>

        {/* Feature chips */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {[
            { color: "bg-blue-500", label: "ElevenLabs STT 자동 전사" },
            { color: "bg-violet-500", label: "DeepL 10개 언어 번역" },
            { color: "bg-green-500", label: "ElevenLabs TTS 음성 합성" },
          ].map(({ color, label }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 bg-white border border-[#e4e3df] rounded-full px-3.5 py-1.5 text-[13px] font-medium text-[#57534e] shadow-[0_1px_2px_rgba(0,0,0,0.04)] whitespace-nowrap"
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
              {label}
            </div>
          ))}
        </div>

        {/* Login card */}
        <div className="w-full bg-white border border-[#e4e3df] rounded-2xl p-8 shadow-[0_2px_6px_rgba(0,0,0,0.05),0_16px_48px_rgba(0,0,0,0.1)]">
          <p className="text-[15px] font-semibold text-[#1a1917] mb-1">시작하기</p>
          <p className="text-[13px] text-[#a8a29e] leading-[1.55] mb-6">
            로그인하면 파일을 업로드하고 바로 더빙을 생성할 수 있어요.
          </p>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2.5 bg-white border-[1.5px] border-[#d0cfc9] rounded-xl px-5 py-3.5 text-sm font-medium text-[#1a1917] hover:border-blue-600 hover:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] hover:bg-[#fafaf8] transition-all"
            >
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] flex-shrink-0">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Google로 로그인
            </button>
          </form>
        </div>

        {/* Stats strip */}
        <div className="w-full mt-9 bg-white border border-[#e4e3df] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex">
          {[
            { num: "10+", lbl: "지원 언어" },
            { num: "60s", lbl: "최대 길이" },
            { num: "~30s", lbl: "처리 시간" },
          ].map(({ num, lbl }, i) => (
            <div
              key={lbl}
              className={`flex-1 text-center py-4 px-3 ${i < 2 ? "border-r border-[#e4e3df]" : ""}`}
            >
              <p className="font-[family-name:var(--font-syne)] text-[22px] font-bold tracking-tight text-blue-600">
                {num}
              </p>
              <p className="text-[11px] font-medium text-[#a8a29e] mt-0.5">{lbl}</p>
            </div>
          ))}
        </div>

      </div>
    </main>
  );
}
