/**
 * Main runner entry point
 * 
 * Usage: npm run sync -- [options]
 * Options:
 *   --min-trades <n>      Minimum trade count (default: 50)
 *   --min-volume <v>      Minimum volume in USD (default: 5000)
 *   --min-winrate <r>     Minimum win rate (default: 0.58)
 *   --top-n <n>           Number of top accounts to select (default: 100)
 *   --seed-file <path>    Path to seed addresses file
 *   --discover <n>        Discover N traders from recent trades
 * 
 * Transaction boundaries:
 * - Run creation is atomic
 * - Each account upsert is a single transaction
 * - Selected accounts batch is a single transaction
 * - Run completion/failure is atomic
 * 
 * Partial failure strategy:
 * - If an account fails to fetch, it's logged and skipped (not blocking)
 * - If storage fails for an account, the run continues with other accounts
 * - Error summary is generated at the end and stored in run stats
 */

const { PolymarketCollector } = require('./collector');
const { AccountScorer } = require('./scorer');
const { AccountSelector } = require('./selector');
const { Storage } = require('./storage');
const { close } = require('./db');
require('dotenv').config();

const VERSION = '1.0.0';

function showHelp() {
  console.log(`
polymarket-winner-scanner v${VERSION}

Usage: npm run sync -- [options]

Options:
  --min-trades <n>       Minimum trade count (default: 50)
  --min-volume <v>       Minimum volume in USD (default: 5000)
  --min-winrate <r>      Minimum win rate 0-1 (default: 0.58)
  --min-confidence <r>   Minimum confidence score (default: 0.1)
  --top-n <n>            Number of top accounts to select (default: 100)
  --discover <n>         Discover N traders from trades (default: 100)
  --seed-file <path>     Load additional seed addresses from file
  --help, -h             Show this help message

Examples:
  npm run sync
  npm run sync -- --discover 500 --min-winrate 0.6
  npm run sync -- --seed-file ./seed-addresses.txt

Environment variables (see .env.example):
  MIN_TRADES, MIN_VOLUME_USD, MIN_WIN_RATE, MIN_CONFIDENCE, TOP_N, DISCOVER_TRADERS
`);
  process.exit(0);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    minTrades: parseInt(process.env.MIN_TRADES || '50'),
    minVolumeUsd: parseFloat(process.env.MIN_VOLUME_USD || '5000'),
    minWinRate: parseFloat(process.env.MIN_WIN_RATE || '0.58'),
    minConfidence: parseFloat(process.env.MIN_CONFIDENCE || '0.1'),
    minPnl: parseFloat(process.env.MIN_PNL || '0'),
    topN: parseInt(process.env.TOP_N || '100'),
    seedFile: null,
    discoverTraders: parseInt(process.env.DISCOVER_TRADERS || '100'),
    windowDays: parseInt(process.env.WINDOW_DAYS || '0') || null,
    maxActivityPages: parseInt(process.env.MAX_ACTIVITY_PAGES || '5')
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        showHelp();
        break;
      case '--min-trades':
        config.minTrades = parseInt(args[++i]);
        break;
      case '--min-volume':
        config.minVolumeUsd = parseFloat(args[++i]);
        break;
      case '--min-winrate':
        config.minWinRate = parseFloat(args[++i]);
        break;
      case '--min-confidence':
        config.minConfidence = parseFloat(args[++i]);
        break;
      case '--top-n':
        config.topN = parseInt(args[++i]);
        break;
      case '--seed-file':
        config.seedFile = args[++i];
        break;
      case '--discover':
        config.discoverTraders = parseInt(args[++i]);
        break;
      case '--window-days':
        config.windowDays = parseInt(args[++i]);
        break;
      case '--min-pnl':
        config.minPnl = parseFloat(args[++i]);
        break;
      case '--max-activity-pages':
        config.maxActivityPages = parseInt(args[++i]);
        break;
    }
  }
  
  return config;
}

/**
 * Load seed addresses from file or database
 * @param {Storage} storage - Storage instance
 * @param {Object} config - Configuration
 * @returns {Array} - Array of addresses
 */
async function loadAddresses(storage, config) {
  let addresses = [];
  
  // Load from database first
  const dbAddresses = await storage.loadSeedAddresses();
  addresses = [...dbAddresses];
  
  // Load from file if specified
  if (config.seedFile) {
    const fs = require('fs');
    const fileContent = fs.readFileSync(config.seedFile, 'utf8');
    const fileAddresses = fileContent.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('0x'));
    addresses = [...new Set([...addresses, ...fileAddresses])];
    console.log(`[Runner] Loaded ${fileAddresses.length} addresses from file`);
  }
  
  return addresses;
}

/**
 * Main sync function
 */
async function main() {
  const config = parseArgs();
  console.log('[Runner] Starting sync with config:', config);
  
  // Initialize modules
  const collector = new PolymarketCollector({
    logger: console,
    maxRetries: 3,
    retryDelayMs: 500
  });
  
  const scorer = new AccountScorer({
    winRateWeight: 0.5,
    volumeWeight: 0.3,
    confidenceWeight: 0.2
  });
  
  const selector = new AccountSelector({
    minTrades: config.minTrades,
    minVolume: config.minVolumeUsd,
    minWinRate: config.minWinRate,
    minConfidence: config.minConfidence,
    minPnl: config.minPnl,
    topN: config.topN
  });
  
  const storage = new Storage({
    logger: console
  });
  
  let runId;
  const errors = [];
  const processedAccounts = [];
  
  try {
    // Step 1: Create run
    runId = await storage.createRun(config);
    console.log(`[Runner] Created run: ${runId}`);
    
    // Step 2: Get addresses to process
    let addresses = await loadAddresses(storage, config);
    console.log(`[Runner] Loaded ${addresses.length} seed addresses`);
    
    // Step 3: Discover new traders if needed
    if (addresses.length === 0 || config.discoverTraders > 0) {
      console.log(`[Runner] Discovering traders from ${config.discoverTraders} trades...`);
      const discoveredAddresses = await collector.discoverTradersFromTrades(config.discoverTraders);
      addresses = [...new Set([...addresses, ...discoveredAddresses])];
      console.log(`[Runner] Total addresses to process: ${addresses.length}`);
    }
    
    // Step 4: Two-phase collection
    const windowDays = config.windowDays;
    const maxActivityPages = config.maxActivityPages || 5;
    console.log(`[Runner] Starting two-phase collection${windowDays ? ` (last ${windowDays} days)` : ''}...`);
    
    const metricsResults = [];
    const phase1Candidates = addresses.length;
    let phase1Passed = 0;
    let phase2Enriched = 0;
    
    // Phase 1: Lightweight screening (closed-positions only)
    console.log(`[Runner] Phase1: Lightweight screening (${addresses.length} candidates)...`);
    const phase1Results = [];
    
    for (const address of addresses) {
      try {
        const basicMetrics = await collector.fetchBasic90dMetrics(address, { windowDays });
        phase1Results.push({ address, metrics: basicMetrics });
      } catch (error) {
        errors.push({ address, type: 'phase1_failure', message: error.message });
      }
    }
    
    // Phase 1 filter: winRate >= minWinRate AND realizedPnl >= minPnl
    const phase1PassList = phase1Results.filter(r => {
      const m = r.metrics;
      const winRate = m.strictWinRate ?? 0;
      const passes = winRate >= config.minWinRate && m.realizedPnl >= config.minPnl;
      if (passes) phase1Passed++;
      return passes;
    });
    
    console.log(`[Runner] Phase1: ${phase1Passed}/${phase1Candidates} passed (winRate>=${config.minWinRate}, pnl>=${config.minPnl})`);
    
    // Phase 2: Enrich with activity (only for Phase1 passed)
    console.log(`[Runner] Phase2: Enriching ${phase1PassList.length} candidates with activity...`);
    
    for (const item of phase1PassList) {
      try {
        const enrichedMetrics = await collector.enrichWithActivity(item.address, item.metrics, {
          windowDays,
          maxActivityPages
        });
        
        // Calculate confidence score from closed positions
        enrichedMetrics.confidenceScore = enrichedMetrics._closedPositionsCount > 0 
          ? enrichedMetrics.totalTrades / enrichedMetrics._closedPositionsCount 
          : 0;
        
        metricsResults.push(enrichedMetrics);
        phase2Enriched++;
      } catch (error) {
        // If phase2 fails, use phase1 data
        metricsResults.push(item.metrics);
        errors.push({ address: item.address, type: 'phase2_failure', message: error.message });
      }
    }
    
    console.log(`[Runner] Phase2: ${phase2Enriched} enriched, ${metricsResults.length} total accounts (${errors.length} failed)`);
    
    // Step 5: Score accounts
    console.log('[Runner] Scoring accounts...');
    const scoredAccounts = scorer.scoreBatch(metricsResults);
    
    // Step 6: Select top accounts
    console.log('[Runner] Selecting top accounts...');
    const selectionResult = selector.select(scoredAccounts);
    console.log(`[Runner] Selected ${selectionResult.selected.length} accounts (from ${selectionResult._stats.passedFilters} passed filters)`);
    
    // Step 7: Store results
    console.log('[Runner] Storing results...');
    
    // Upsert all accounts
    for (const account of scoredAccounts) {
      try {
        await storage.upsertAccount(runId, account);
        await storage.createMetricsSnapshot(runId, account);
        processedAccounts.push(account.address);
      } catch (error) {
        errors.push({
          address: account.address,
          type: 'storage_failure',
          message: error.message
        });
      }
    }
    
    // Record selected accounts
    if (selectionResult.selected.length > 0) {
      await storage.recordSelectedAccounts(runId, selectionResult.selected);
    }
    
    // Step 8: Complete run with statistics
    const errorSummary = storage.generateErrorSummary(errors);
    const stats = {
      accounts_processed: processedAccounts.length,
      accounts_selected: selectionResult.selected.length,
      accounts_failed: errors.length,
      selection_summary: selectionResult.summary,
      error_summary: errorSummary,
      config_used: config
    };
    
    await storage.completeRun(runId, stats);
    
    // Final output
    console.log('\n========== Sync Complete ==========');
    console.log(`Run ID: ${runId}`);
    console.log(`Accounts processed: ${processedAccounts.length}`);
    console.log(`Accounts selected: ${selectionResult.selected.length}`);
    console.log(`Accounts failed: ${errors.length}`);
    console.log(`Average win rate: ${(selectionResult.summary.avgWinRate * 100).toFixed(1)}%`);
    console.log(`Average volume: $${selectionResult.summary.avgVolume.toFixed(2)}`);
    console.log(`Average score: ${selectionResult.summary.avgScore.toFixed(4)}`);
    
    if (errorSummary.hasErrors) {
      console.log('\nError Summary:');
      for (const [type, count] of Object.entries(errorSummary.errorsByType)) {
        console.log(`  - ${type}: ${count}`);
      }
    }
    
    console.log('====================================\n');
    
  } catch (error) {
    console.error('[Runner] Sync failed:', error);
    if (runId) {
      await storage.failRun(runId, error.message);
    }
    process.exit(1);
  } finally {
    await close();
  }
}

main();
