import { createClient } from "@libsql/client";

// Validated at runtime when a request is made; avoids breaking next build
export const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
