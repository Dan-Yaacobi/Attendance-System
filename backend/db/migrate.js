require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');
const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS migrations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function runMigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const migrationsDir = path.join(__dirname, 'migrations');

  try {
    await pool.query(MIGRATIONS_TABLE_SQL);
    console.log('Ensured migrations table exists');

    const files = await fs.readdir(migrationsDir);
    const migrationFiles = files
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    const executedResult = await pool.query('SELECT name FROM migrations');
    const executedMigrations = new Set(executedResult.rows.map((row) => row.name));

    for (const file of migrationFiles) {
      if (executedMigrations.has(file)) {
        console.log(`Skipping already executed migration: ${file}`);
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, 'utf8');
      const client = await pool.connect();

      try {
        console.log(`Running migration: ${file}`);
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Migration completed: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Migration failed: ${file}`);
        throw error;
      } finally {
        client.release();
      }
    }

    console.log('All migrations are up to date');
  } catch (error) {
    console.error('Migration runner failed', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runMigrations();
