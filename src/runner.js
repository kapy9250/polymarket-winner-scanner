/**
 * Main runner entry point
 * 
 * Usage: npm run sync -- [options]
 * Options:
 *   --min-trades <n>      Minimum trade count (default: 50)
 *   --min-volume <v>      Minimum volume in USD (default: 5000)
 *   --min-winrate <r>     Minimum win rate (default: 0.58)
 *   --seed-file <path>    Path to seed addresses file
 */

const { query, getClient, close } = require('./db');
require('dotenv').config();

// Placeholder modules (to be implemented in later steps)
// const collector = require('./collector');
// const scorer = require('./scorer');
// const selector = require('./selector');

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    minTrades: parseInt(process.env.MIN_TRADES || '50'),
    minVolumeUsd: parseFloat(process.env.MIN_VOLUME_USD || '5000'),
    minWinRate: parseFloat(process.env.MIN_WIN_RATE || '0.58'),
    seedFile: null
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--min-trades':
        config.minTrades = parseInt(args[++i]);
        break;
      case '--min-volume':
        config.minVolumeUsd = parseFloat(args[++i]);
        break;
      case '--min-winrate':
        config.minWinRate = parseFloat(args[++i]);
        break;
      case '--seed-file':
        config.seedFile = args[++i];
        break;
    }
  }
  
  return config;
}

async function createRun(config) {
  const result = await query(
    `INSERT INTO runs (status, config) VALUES ($1, $2) RETURNING id`,
    ['running', JSON.stringify(config)]
  );
  return result.rows[0].id;
}

async function completeRun(runId, stats) {
  await query(
    `UPDATE runs SET status = $1, completed_at = NOW(), stats = $2 WHERE id = $3`,
    ['completed', JSON.stringify(stats), runId]
  );
}

async function failRun(runId, errorMessage) {
  await query(
    `UPDATE runs SET status = $1, completed_at = NOW(), error_message = $2 WHERE id = $3`,
    ['failed', errorMessage, runId]
  );
}

async function main() {
  const config = parseArgs();
  console.log('Starting sync with config:', config);
  
  let runId;
  try {
    runId = await createRun(config);
    console.log('Created run:', runId);
    
    // TODO: Implement sync pipeline
    // 1. Load seed addresses
    // 2. Collect account data from Polymarket API
    // 3. Calculate metrics (scorer)
    // 4. Select accounts based on criteria
    // 5. Store results
    
    console.log('Sync pipeline not yet implemented - this is Step 1 (schema only)');
    
    const stats = {
      accounts_processed: 0,
      accounts_selected: 0,
      config_used: config
    };
    
    await completeRun(runId, stats);
    console.log('Run completed:', runId);
    
  } catch (error) {
    console.error('Sync failed:', error);
    if (runId) {
      await failRun(runId, error.message);
    }
    process.exit(1);
  } finally {
    await close();
  }
}

main();
