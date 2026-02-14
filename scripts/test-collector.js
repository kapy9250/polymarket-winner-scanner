/**
 * Test script for Collector module
 * Run: node scripts/test-collector.js
 */

const { PolymarketCollector } = require('../src/collector');

async function testCollector() {
  console.log('=== Collector Module Test ===\n');
  
  const collector = new PolymarketCollector({
    logger: console,
    maxRetries: 3,
    retryDelayMs: 500
  });
  
  try {
    // Test 1: Fetch recent trades
    console.log('Test 1: Fetch recent trades...');
    const tradesResult = await collector.fetchTrades({ limit: 10 });
    console.log(`✓ Got ${tradesResult.count} trades`);
    console.log(`  Sample: ${tradesResult.trades[0]?.proxyWallet}`);
    
    // Test 2: Discover traders
    console.log('\nTest 2: Discover traders from 50 trades...');
    const traders = await collector.discoverTradersFromTrades(50);
    console.log(`✓ Discovered ${traders.size} unique traders`);
    
    // Test 3: Fetch positions for a sample address
    if (traders.size > 0) {
      const sampleAddr = [...traders][0];
      console.log(`\nTest 3: Fetch positions for ${sampleAddr}...`);
      const positions = await collector.fetchPositions(sampleAddr);
      console.log(`✓ Got ${positions.length} positions`);
    }
    
    // Test 4: Fetch closed positions
    if (traders.size > 0) {
      const sampleAddr = [...traders][0];
      console.log(`\nTest 4: Fetch closed positions for ${sampleAddr}...`);
      const closedPos = await collector.fetchClosedPositions(sampleAddr);
      console.log(`✓ Got ${closedPos.length} closed positions`);
    }
    
    // Test 5: Fetch complete metrics
    if (traders.size > 0) {
      const sampleAddr = [...traders][0];
      console.log(`\nTest 5: Fetch complete metrics for ${sampleAddr}...`);
      const metrics = await collector.fetchAccountMetrics(sampleAddr);
      console.log(`✓ Metrics:`);
      console.log(`  - strictWinRate: ${metrics.strictWinRate}`);
      console.log(`  - proxyWinRate: ${metrics.proxyWinRate}`);
      console.log(`  - totalTrades: ${metrics.totalTrades}`);
      console.log(`  - totalVolumeUsd: ${metrics.totalVolumeUsd}`);
      console.log(`  - realizedPnl: ${metrics.realizedPnl}`);
      console.log(`  - confidenceScore: ${metrics.confidenceScore}`);
    }
    
    console.log('\n=== All tests passed! ===');
    
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

// Run tests
testCollector();
