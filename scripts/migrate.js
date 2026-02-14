/**
 * Migration Runner
 * Usage: node scripts/migrate.js [--reset]
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_CONFIG = {
  host: process.env.DB_HOST || '192.168.26.208',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'clawdbot',
  password: process.env.DB_PASSWORD || 'ClawdBot_DB_2024',
  database: process.env.DB_NAME || 'polymarket_scanner'
};

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

async function runMigrations() {
  const client = new Client(DB_CONFIG);
  
  try {
    await client.connect();
    console.log('Connected to database:', DB_CONFIG.database);
    
    // Check if schema_migrations table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'schema_migrations'
      );
    `);
    
    const migrationsTableExists = tableCheck.rows[0].exists;
    
    // Get applied migrations
    let appliedMigrations = [];
    if (migrationsTableExists) {
      const result = await client.query('SELECT version FROM schema_migrations ORDER BY version');
      appliedMigrations = result.rows.map(r => r.version);
    }
    
    // Get migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    console.log('Found migrations:', files.map(f => f.replace('.sql', '')).join(', '));
    console.log('Applied migrations:', appliedMigrations.join(', ') || 'none');
    
    // Apply pending migrations
    for (const file of files) {
      const version = file.replace('.sql', '').split('_')[0];
      
      if (appliedMigrations.includes(version)) {
        console.log(`Skipping ${file} (already applied)`);
        continue;
      }
      
      console.log(`Applying ${file}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`✓ Applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    
    console.log('All migrations applied successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

async function resetDatabase() {
  const client = new Client({ ...DB_CONFIG, database: 'postgres' });
  
  try {
    await client.connect();
    console.log('Resetting database:', DB_CONFIG.database);
    
    // Terminate existing connections
    await client.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = '${DB_CONFIG.database}'
      AND pid <> pg_backend_pid();
    `);
    
    // Drop and recreate database
    await client.query(`DROP DATABASE IF EXISTS ${DB_CONFIG.database}`);
    await client.query(`CREATE DATABASE ${DB_CONFIG.database}`);
    
    console.log('Database reset complete. Running migrations...');
    
    await client.end();
    
    // Run migrations on new database
    await runMigrations();
    
  } catch (error) {
    console.error('Reset failed:', error.message);
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);
if (args.includes('--reset')) {
  resetDatabase();
} else {
  runMigrations();
}
