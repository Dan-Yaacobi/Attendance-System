const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error);
});

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    console.error('Database query failed', {
      message: error.message,
      query: text
    });
    throw error;
  }
}

module.exports = {
  pool,
  query
};
