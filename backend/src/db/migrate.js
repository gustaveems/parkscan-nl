import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getPool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "..", "..", "sql", "schema.sql");

export async function runMigrations() {
  const pool = getPool();
  if (!pool) return false;
  const sql = await readFile(SCHEMA_PATH, "utf8");
  const client = await pool.connect();
  try {
    await client.query(sql);
    return true;
  } finally {
    client.release();
  }
}
