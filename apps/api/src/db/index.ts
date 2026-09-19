import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env.js";
import * as schema from "./schema.js";

// Serverless Postgres (Neon) drops idle connections; recycle ours first so polls never hit a dead socket.
const client = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  connect_timeout: 30,
  onnotice: () => undefined,
});
export const db = drizzle(client, { schema });
export type Db = typeof db;

export async function runMigrations() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: path.resolve(here, "../../drizzle") });
}

export async function closeDb() {
  await client.end({ timeout: 5 });
}
