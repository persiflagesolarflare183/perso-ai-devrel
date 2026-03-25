import { signOut } from "@/auth";

export default function BlockedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold text-red-600">Access Denied</h1>
      <p className="text-gray-700">Your email is not authorized to access this application.</p>
      <p className="text-sm text-gray-500">
        Contact the administrator if you believe this is a mistake.
      </p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-6 py-2 text-gray-700 hover:bg-gray-100"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
