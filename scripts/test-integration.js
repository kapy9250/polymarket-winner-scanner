/**
 * Integration Test Suite
 * 
 * Tests all components end-to-end:
 * - Database connection
 * - Collector API calls
 * - Scorer calculations
 * - Selector filtering
 * - Storage operations
 * 
 * Run: npm run test:integration
 */

const { query, close } = require('../src/db');
const { PolymarketCollector } = require('../src/collector');
const { AccountScorer } = require('../src/scorer');
const { AccountSelector } = require('../src/selector');
const { Storage } = require('../src/storage');

const TEST_RUN_ID = 'test-' + Date.now();

async function testDatabaseConnection() {
  console.log('\n[TEST 1] Database Connection...');
  try {
    const result = await query('SELECT NOW()');
    console.log('  ✅ Database connected:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('  ❌ Database connection failed:', error.message);
    return false;
  }
}

async function testCollector() {
  console.log('\n[TEST 2] Collector Module...');
  try {
    const collector = new PolymarketCollector({ logger: console, maxRetries: 2 });
    
    // Test trades discovery
    const trades = await collector.fetchTrades({ limit: 5 });
    console.log(`  ✅ Fetched ${trades.count} trades`);
    
    if (trades.trades.length > 0 && trades.trades[0].proxyWallet) {
      const testAddress = trades.trades[0].proxyWallet;
      console.log(`  ✅ Found test address: ${testAddress.slice(0, 10)}...`);
      return { success: true, testAddress };
    }
    
    return { success: true, testAddress: null };
  } catch (error) {
    console.error('  ❌ Collector test failed:', error.message);
    return { success: false, testAddress: null };
  }
}

async function testScorer() {
  console.log('\n[TEST 3] Scorer Module...');
  try {
    const scorer = new AccountScorer();
    
    const testAccount = {
      address: '0xtest123',
      strictWinRate: 0.75,
      totalVolumeUsd: 10000,
      confidenceScore: 0.5,
      totalTrades: 50,
      realizedPnl: 1000,
      winCount: 15,
      lossCount: 5,
      closedPositions: 20
    };
    
    const scored = scorer.score(testAccount);
    console.log(`  ✅ Scored account: ${scored.compositeScore.toFixed(4)}`);
    console.log(`  ✅ Tags: ${scored.reasonTags.join(', ')}`);
    return true;
  } catch (error) {
    console.error('  ❌ Scorer test failed:', error.message);
    return false;
  }
}

async function testSelector() {
  console.log('\n[TEST 4] Selector Module...');
  try {
    const selector = new AccountSelector({
      minTrades: 10,
      minVolume: 100,
      minWinRate: 0.5
    });
    
    const testAccounts = [
      { address: '0x1', strictWinRate: 0.8, totalVolumeUsd: 1000, confidenceScore: 0.5, totalTrades: 50, realizedPnl: 100, compositeScore: 0.7 },
      { address: '0x2', strictWinRate: 0.6, totalVolumeUsd: 500, confidenceScore: 0.3, totalTrades: 30, realizedPnl: 50, compositeScore: 0.5 },
      { address: '0x3', strictWinRate: 0.3, totalVolumeUsd: 50, confidenceScore: 0.1, totalTrades: 5, realizedPnl: -10, compositeScore: 0.2 }
    ];
    
    const result = selector.select(testAccounts);
    console.log(`  ✅ Selected ${result.selected.length} from ${result._stats.totalInput} accounts`);
    console.log(`  ✅ Passed filters: ${result._stats.passedFilters}`);
    return true;
  } catch (error) {
    console.error('  ❌ Selector test failed:', error.message);
    return false;
  }
}

async function testStorage() {
  console.log('\n[TEST 5] Storage Module...');
  try {
    const storage = new Storage({ logger: console });
    
    // Test error summary generation
    const errors = [
      { address: '0xabc', type: 'api_failure', message: 'Timeout' },
      { address: '0xdef', type: 'api_failure', message: 'Rate limit' }
    ];
    const summary = storage.generateErrorSummary(errors);
    console.log(`  ✅ Error summary: ${summary.errorCount} errors, ${Object.keys(summary.errorsByType).length} types`);
    
    // Test seed addresses
    const seeds = await storage.loadSeedAddresses();
    console.log(`  ✅ Loaded ${seeds.length} seed addresses`);
    
    return true;
  } catch (error) {
    console.error('  ❌ Storage test failed:', error.message);
    return false;
  }
}

async function testNullWinRateHandling() {
  console.log('\n[TEST 6] Null Win Rate Handling...');
  try {
    const selector = new AccountSelector({ minWinRate: 0.5 });
    
    const accountsWithNullWinRate = [
      { address: '0x1', strictWinRate: null, proxyWinRate: null, totalVolumeUsd: 1000, confidenceScore: 0.5, totalTrades: 50, compositeScore: 0.5 },
      { address: '0x2', strictWinRate: 0.8, proxyWinRate: 0.8, totalVolumeUsd: 1000, confidenceScore: 0.5, totalTrades: 50, compositeScore: 0.7 }
    ];
    
    const result = selector.select(accountsWithNullWinRate);
    
    // Account with null win rate should NOT pass
    const nullAccountSelected = result.selected.find(a => a.address === '0x1');
    if (nullAccountSelected) {
      console.error('  ❌ Account with null win rate incorrectly selected');
      return false;
    }
    
    // Account with valid win rate should pass
    const validAccountSelected = result.selected.find(a => a.address === '0x2');
    if (!validAccountSelected) {
      console.error('  ❌ Account with valid win rate not selected');
      return false;
    }
    
    console.log('  ✅ Null win rate handling correct: account with null win rate rejected');
    return true;
  } catch (error) {
    console.error('  ❌ Null win rate test failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('========================================');
  console.log('  Integration Test Suite');
  console.log('========================================');
  
  const results = [];
  
  results.push({ name: 'Database Connection', passed: await testDatabaseConnection() });
  
  const collectorResult = await testCollector();
  results.push({ name: 'Collector Module', passed: collectorResult.success });
  
  results.push({ name: 'Scorer Module', passed: await testScorer() });
  results.push({ name: 'Selector Module', passed: await testSelector() });
  results.push({ name: 'Storage Module', passed: await testStorage() });
  results.push({ name: 'Null Win Rate Handling', passed: await testNullWinRateHandling() });
  
  console.log('\n========================================');
  console.log('  Test Results Summary');
  console.log('========================================');
  
  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}: ${result.name}`);
    if (!result.passed) allPassed = false;
  }
  
  console.log('========================================');
  
  if (allPassed) {
    console.log('\n✅ ALL TESTS PASSED\n');
  } else {
    console.log('\n❌ SOME TESTS FAILED\n');
  }
  
  await close();
  process.exit(allPassed ? 0 : 1);
}

runAllTests();
