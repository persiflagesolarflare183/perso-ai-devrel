import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DubForm from "./DubForm";

export default async function DubPage() {
  // Double-check session server-side (proxy covers redirects, this covers direct API abuse)
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Audio Dubbing</h1>
        <p className="mt-1 text-sm text-gray-500">
          Signed in as {session.user?.email}
        </p>
      </div>

      {/* TODO: video support — add video upload + ffmpeg extraction step here when needed */}

      <DubForm />
    </main>
  );
}
