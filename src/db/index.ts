import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config";
import * as schema from "./schema";

const dbPath = config.DATABASE_URL;
if (dbPath !== ":memory:") {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    // ignore
  }
}

const sqlite = new Database(dbPath);
if (dbPath !== ":memory:") {
  sqlite.exec("PRAGMA journal_mode = WAL;");
}
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
export { schema };

/**
 * Apply migrations programmatically. Used by the server boot path (esp. for
 * `:memory:` and local development) so callers don't have to run a separate
 * `db:migrate` step. In production we still recommend the explicit script.
 */
export async function ensureSchema(): Promise<void> {
  const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
  try {
    migrate(db, { migrationsFolder: "./drizzle" });
  } catch (err) {
    // Migrations folder may be missing in minimal builds; create the tables
    // manually as a safety net so the server can still boot.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("ENOENT")) throw err;
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS technical_users (
        id TEXT PRIMARY KEY,
        tax_number TEXT NOT NULL,
        login TEXT NOT NULL,
        password TEXT NOT NULL,
        sign_key TEXT NOT NULL,
        exchange_key TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL UNIQUE,
        request_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        technical_user_id TEXT NOT NULL,
        request_timestamp TEXT NOT NULL,
        finished_at TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS invoice_ops (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        index_in_batch INTEGER NOT NULL,
        operation TEXT NOT NULL,
        invoice_number TEXT,
        invoice_data_base64 TEXT,
        electronic_invoice_hash TEXT,
        completeness_indicator INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        request_id TEXT NOT NULL,
        http_status INTEGER,
        duration_ms INTEGER,
        success INTEGER NOT NULL,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
}
