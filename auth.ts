import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isWhitelisted } from "@/lib/whitelist";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: "/login",
    error: "/blocked",
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email;
      if (!email) return false;

      const allowed = await isWhitelisted(email);
      // returning false → Auth.js denies sign-in and redirects to pages.error (/blocked)
      // no session is created for non-whitelisted users
      return allowed;
    },
  },
});
