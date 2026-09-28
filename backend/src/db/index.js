import { memoryStore } from "./memoryStore.js";
import { pgStore } from "./pgStore.js";
import { getPool, shutdownPool } from "./pool.js";
import { runMigrations } from "./migrate.js";

let activeStore = memoryStore;

export function getStore() {
  return activeStore;
}

export async function initStore() {
  if (!process.env.DATABASE_URL) {
    console.log("[db] DATABASE_URL not set — using in-memory store");
    activeStore = memoryStore;
    return activeStore;
  }

  const pool = getPool();
  try {
    await pool.query("SELECT 1");
    await runMigrations();
    activeStore = pgStore;
    console.log(`[db] connected to Postgres — using persistent store`);
  } catch (err) {
    console.warn(
      `[db] Postgres unavailable (${err.message}) — falling back to in-memory store`,
    );
    await shutdownPool();
    activeStore = memoryStore;
  }
  return activeStore;
}

export { shutdownPool };
