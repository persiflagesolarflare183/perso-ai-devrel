import { turso } from "./turso";

export async function isWhitelisted(email: string): Promise<boolean> {
  const result = await turso.execute({
    sql: "SELECT 1 FROM whitelist WHERE email = ? LIMIT 1",
    args: [email.toLowerCase().trim()],
  });
  return result.rows.length > 0;
}
