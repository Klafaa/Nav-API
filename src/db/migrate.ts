import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config";

const dbPath = config.DATABASE_URL;
if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}
const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

console.log(`[migrate] applying migrations to ${dbPath}`);
migrate(db, { migrationsFolder: "./drizzle" });
console.log("[migrate] done");
