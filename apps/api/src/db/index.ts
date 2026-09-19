import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env.js";
import * as schema from "./schema.js";

const client = postgres(env.DATABASE_URL, { max: 10 });
export const db = drizzle(client, { schema });
export type Db = typeof db;

export async function runMigrations() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: path.resolve(here, "../../drizzle") });
}

export async function closeDb() {
  await client.end({ timeout: 5 });
}
