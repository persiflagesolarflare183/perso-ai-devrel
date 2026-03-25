import { auth } from "@/auth";
import { signOut } from "@/auth";
import { redirect } from "next/navigation";
import DubForm from "./DubForm";

export default async function DubPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto w-full max-w-xl px-4 py-10 sm:py-14">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">AI Dubbing</h1>
            <p className="mt-0.5 text-xs text-gray-400">
              오디오 또는 영상을 업로드하고 목표 언어를 선택하면 더빙된 오디오를 생성합니다.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <p className="text-xs text-gray-400">{session.user?.email}</p>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600 transition-colors"
              >
                로그아웃
              </button>
            </form>
          </div>
        </div>

        <DubForm />
      </main>
    </div>
  );
}
