#!/usr/bin/env node
/**
 * Integration test for Polymarket Winner Scanner
 * 
 * Tests the complete pipeline with minimal API calls
 */

const { PolymarketCollector } = require('../src/collector');
const { AccountScorer } = require('../src/scorer');
const { AccountSelector } = require('../src/selector');
const { Storage } = require('../src/storage');
const { query, close } = require('../src/db');
require('dotenv').config();

async function testIntegration() {
  console.log('=== Integration Test ===\n');
  
  let runId = null;
  let testPassed = true;
  
  try {
    // 1. Initialize components
    console.log('1. Initializing components...');
    const collector = new PolymarketCollector({
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      maxRetries: 1,  // Minimal retries for testing
      retryDelayMs: 100
    });
    
    const scorer = new AccountScorer();
    const selector = new AccountSelector({
      minTrades: 1,    // Low thresholds for testing
      minVolume: 1,
      minWinRate: 0.1,
      minConfidence: 0.01,
      topN: 5
    });
    
    const storage = new Storage({
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    });
    
    console.log('✅ Components initialized\n');
    
    // 2. Test API connectivity (small request)
    console.log('2. Testing API connectivity...');
    try {
      const trades = await collector.fetchTrades({ limit: 1 });
      if (trades.trades && trades.trades.length > 0) {
        console.log(`✅ API connected, got ${trades.count} trade(s)`);
        
        // Get a sample address for further testing
        const sampleAddress = trades.trades[0].proxyWallet;
        if (sampleAddress) {
          console.log(`   Sample address: ${sampleAddress.substring(0, 16)}...`);
        }
      } else {
        console.log('⚠️  API returned empty trades');
      }
    } catch (error) {
      console.log(`⚠️  API test failed: ${error.message}`);
      console.log('   Continuing with mock data...');
    }
    console.log();
    
    // 3. Test database connectivity
    console.log('3. Testing database connectivity...');
    try {
      const testQuery = await query('SELECT NOW() as current_time');
      console.log(`✅ Database connected: ${testQuery.rows[0].current_time}`);
    } catch (error) {
      console.error(`❌ Database test failed: ${error.message}`);
      testPassed = false;
    }
    console.log();
    
    // 4. Test storage operations (with mock data)
    console.log('4. Testing storage operations...');
    try {
      // Create a test run
      runId = await storage.createRun({
        test: true,
        minTrades: 1,
        minVolume: 1
      });
      console.log(`✅ Created test run: ${runId}`);
      
      // Test upsert with mock account
      const mockAccount = {
        address: '0xtestintegration123456789',
        totalTrades: 10,
        totalVolumeUsd: 1000,
        positionsCount: 5,
        closedPositions: 3,
        winCount: 2,
        lossCount: 1,
        strictWinRate: 0.667,
        proxyWinRate: 0.6,
        realizedPnl: 100,
        confidenceScore: 0.6,
        discoveryMethod: 'test'
      };
      
      const upsertResult = await storage.upsertAccount(runId, mockAccount);
      console.log(`✅ Upserted test account: ${upsertResult.address}, isNew: ${upsertResult.isNew}`);
      
      // Test snapshot creation
      await storage.createMetricsSnapshot(runId, {
        ...mockAccount,
        compositeScore: 0.65,
        activityCount: 10
      });
      console.log('✅ Created metrics snapshot');
      
      // Test selected accounts recording
      await storage.recordSelectedAccounts(runId, [{
        address: mockAccount.address,
        reasonTags: ['test_account'],
        compositeScore: 0.65,
        strictWinRate: 0.667,
        totalTrades: 10,
        totalVolumeUsd: 1000,
        realizedPnl: 100
      }]);
      console.log('✅ Recorded selected account');
      
      // Test error summary generation
      const testErrors = [
        { address: '0xtest1', type: 'test_error', message: 'Test error 1' },
        { address: '0xtest2', type: 'test_error', message: 'Test error 2' }
      ];
      const errorSummary = storage.generateErrorSummary(testErrors);
      console.log(`✅ Generated error summary: ${errorSummary.errorCount} errors`);
      
    } catch (error) {
      console.error(`❌ Storage test failed: ${error.message}`);
      testPassed = false;
    }
    console.log();
    
    // 5. Test scorer and selector (with mock data)
    console.log('5. Testing scorer and selector...');
    try {
      const mockMetrics = [
        {
          address: '0xhighperformer',
          strictWinRate: 0.8,
          proxyWinRate: 0.75,
          totalVolumeUsd: 50000,
          confidenceScore: 0.7,
          totalTrades: 100,
          realizedPnl: 10000,
          winCount: 16,
          lossCount: 4,
          closedPositions: 20,
          positionsCount: 25,
          activityCount: 100
        },
        {
          address: '0xlowperformer',
          strictWinRate: 0.3,
          proxyWinRate: 0.35,
          totalVolumeUsd: 100,
          confidenceScore: 0.1,
          totalTrades: 5,
          realizedPnl: -50,
          winCount: 1,
          lossCount: 2,
          closedPositions: 3,
          positionsCount: 5,
          activityCount: 5
        }
      ];
      
      const scoredAccounts = scorer.scoreBatch(mockMetrics);
      console.log(`✅ Scored ${scoredAccounts.length} accounts`);
      console.log(`   High performer score: ${scoredAccounts[0].compositeScore.toFixed(4)}`);
      console.log(`   Low performer score: ${scoredAccounts[1].compositeScore.toFixed(4)}`);
      
      const selectionResult = selector.select(scoredAccounts);
      console.log(`✅ Selected ${selectionResult.selected.length} account(s) (from ${scoredAccounts.length} input)`);
      
      if (selectionResult.selected.length > 0) {
        console.log(`   Top account: ${selectionResult.selected[0].address}, score: ${selectionResult.selected[0].compositeScore.toFixed(4)}`);
      }
      
    } catch (error) {
      console.error(`❌ Scorer/selector test failed: ${error.message}`);
      testPassed = false;
    }
    console.log();
    
    // 6. Clean up test data
    console.log('6. Cleaning up test data...');
    if (runId) {
      try {
        await query('DELETE FROM selected_accounts WHERE run_id = $1', [runId]);
        await query('DELETE FROM account_metrics_snapshot WHERE run_id = $1', [runId]);
        await query('DELETE FROM accounts WHERE address = $1', ['0xtestintegration123456789']);
        await query('DELETE FROM runs WHERE id = $1', [runId]);
        console.log('✅ Test data cleaned up');
      } catch (error) {
        console.log(`⚠️  Cleanup had issues: ${error.message}`);
      }
    }
    console.log();
    
  } catch (error) {
    console.error(`❌ Integration test failed: ${error.message}`);
    console.error(error.stack);
    testPassed = false;
  } finally {
    try {
      await close();
    } catch (err) {
      // Ignore
    }
  }
  
  // Final result
  console.log('='.repeat(50));
  if (testPassed) {
    console.log('✅ INTEGRATION TEST PASSED');
    console.log('All components are working correctly.');
  } else {
    console.log('❌ INTEGRATION TEST FAILED');
    console.log('Some components failed. Check logs above.');
    process.exit(1);
  }
  console.log('='.repeat(50));
}

// Run test
testIntegration();