import pg from "pg";

const { Pool, types } = pg;

// Numeric values default to strings in node-postgres to preserve precision.
// We only ever compare / format them for money, so coerce to number here.
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

let pool = null;

export function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) return null;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (err) => {
    console.error("[db] pool error:", err.message);
  });
  return pool;
}

export async function shutdownPool() {
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    // best effort
  } finally {
    pool = null;
  }
}
