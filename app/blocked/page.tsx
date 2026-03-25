import { signOut } from "@/auth";

export default function BlockedPage() {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">접근 권한 없음</h1>
          <p className="text-sm text-gray-600">
            이 계정은 서비스 이용 권한이 없습니다.
          </p>
          <p className="text-xs text-gray-400">
            문제가 있다면 관리자에게 문의하세요.
          </p>
        </div>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            로그인 페이지로 돌아가기
          </button>
        </form>
      </div>
    </main>
  );
}
