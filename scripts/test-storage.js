/**
 * Test script for Storage module
 * Run: node scripts/test-storage.js
 */

const { Storage } = require('../src/storage');
const { query, close } = require('../src/db');

async function testStorage() {
  console.log('=== Storage Module Test ===\n');
  
  const storage = new Storage({ logger: console });
  
  try {
    // Test 1: Create run
    console.log('Test 1: Create run...');
    const runId = await storage.createRun({
      minTrades: 10,
      minVolume: 100,
      minWinRate: 0.5
    });
    console.log(`✓ Created run: ${runId}`);
    
    // Test 2: Upsert account (new)
    console.log('\nTest 2: Upsert new account...');
    const newAccount = {
      address: '0xtest123456789abcdef',
      totalTrades: 50,
      totalVolumeUsd: 5000,
      positionsCount: 10,
      closedPositions: 5,
      winCount: 4,
      lossCount: 1,
      strictWinRate: 0.8,
      proxyWinRate: 0.75,
      realizedPnl: 1000,
      confidenceScore: 0.5,
      discoveryMethod: 'test'
    };
    const result1 = await storage.upsertAccount(runId, newAccount);
    console.log(`✓ Upserted account: ${result1.address}, isNew: ${result1.isNew}`);
    
    // Test 3: Upsert account (update)
    console.log('\nTest 3: Update existing account...');
    const updatedAccount = { ...newAccount, totalTrades: 60 };
    const result2 = await storage.upsertAccount(runId, updatedAccount);
    console.log(`✓ Updated account: ${result2.address}, isNew: ${result2.isNew}`);
    
    // Test 4: Create metrics snapshot
    console.log('\nTest 4: Create metrics snapshot...');
    await storage.createMetricsSnapshot(runId, {
      address: newAccount.address,
      totalTrades: 50,
      totalVolumeUsd: 5000,
      realizedPnl: 1000,
      winCount: 4,
      lossCount: 1,
      closedPositions: 5,
      confidenceScore: 0.5,
      strictWinRate: 0.8,
      proxyWinRate: 0.75,
      compositeScore: 0.65,
      positionsCount: 10,
      activityCount: 50
    });
    console.log('✓ Created metrics snapshot');
    
    // Test 5: Record selected accounts
    console.log('\nTest 5: Record selected accounts...');
    await storage.recordSelectedAccounts(runId, [
      {
        address: newAccount.address,
        reasonTags: ['high_winrate', 'profitable'],
        compositeScore: 0.65,
        strictWinRate: 0.8,
        totalTrades: 50,
        totalVolumeUsd: 5000,
        realizedPnl: 1000
      }
    ]);
    console.log('✓ Recorded 1 selected account');
    
    // Test 6: Generate error summary
    console.log('\nTest 6: Generate error summary...');
    const errors = [
      { address: '0xabc1', type: 'api_failure', message: 'Timeout' },
      { address: '0xabc2', type: 'api_failure', message: 'Rate limit' },
      { address: '0xabc3', type: 'parse_error', message: 'Invalid JSON' }
    ];
    const errorSummary = storage.generateErrorSummary(errors);
    console.log('✓ Error summary:');
    console.log(`  - Has errors: ${errorSummary.hasErrors}`);
    console.log(`  - Error count: ${errorSummary.errorCount}`);
    console.log(`  - Errors by type: ${JSON.stringify(errorSummary.errorsByType)}`);
    
    // Test 7: Get run stats
    console.log('\nTest 7: Get run stats...');
    const stats = await storage.getRunStats(runId);
    console.log(`✓ Run stats:`);
    console.log(`  - Status: ${stats.run.status}`);
    console.log(`  - Selected count: ${stats.selectedCount}`);
    console.log(`  - Snapshot count: ${stats.snapshotCount}`);
    
    // Test 8: Complete run
    console.log('\nTest 8: Complete run...');
    await storage.completeRun(runId, {
      accounts_processed: 1,
      accounts_selected: 1
    });
    console.log('✓ Completed run');
    
    // Test 9: Add seed addresses
    console.log('\nTest 9: Add seed addresses...');
    const seedResult = await storage.addSeedAddresses(
      ['0xseed1', '0xseed2'],
      'test'
    );
    console.log(`✓ Added ${seedResult.added} seed addresses, ${seedResult.duplicates} duplicates`);
    
    console.log('\n=== All tests passed! ===');
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await close();
  }
}

// Run tests
testStorage();
