/**
 * Database connection utilities
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || '192.168.26.208',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'clawdbot',
  password: process.env.DB_PASSWORD || 'ClawdBot_DB_2024',
  database: process.env.DB_NAME || 'polymarket_scanner',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Execute a query
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 */
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
  return result;
}

/**
 * Get a client from the pool
 */
async function getClient() {
  const client = await pool.connect();
  return client;
}

/**
 * Close the pool
 */
async function close() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  getClient,
  close
};
