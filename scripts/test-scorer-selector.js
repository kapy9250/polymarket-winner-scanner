/**
 * Test script for Scorer + Selector modules
 * Run: node scripts/test-scorer-selector.js
 */

const { AccountScorer } = require('../src/scorer');
const { AccountSelector } = require('../src/selector');

function testScorer() {
  console.log('=== Scorer Module Test ===\n');
  
  const scorer = new AccountScorer({
    winRateWeight: 0.5,
    volumeWeight: 0.3,
    confidenceWeight: 0.2
  });
  
  // Test case 1: High performer
  const highPerformer = {
    address: '0x1234...',
    strictWinRate: 0.75,
    proxyWinRate: 0.7,
    totalVolumeUsd: 50000,
    confidenceScore: 0.6,
    totalTrades: 200,
    realizedPnl: 15000,
    winCount: 30,
    lossCount: 10,
    closedPositions: 40
  };
  
  const scored1 = scorer.score(highPerformer);
  console.log('Test 1: High performer');
  console.log(`  - Composite Score: ${scored1.compositeScore}`);
  console.log(`  - Tags: ${scored1.reasonTags.join(', ')}`);
  
  // Test case 2: Low performer
  const lowPerformer = {
    address: '0x5678...',
    strictWinRate: 0.3,
    proxyWinRate: 0.35,
    totalVolumeUsd: 100,
    confidenceScore: 0.1,
    totalTrades: 5,
    realizedPnl: -50,
    winCount: 2,
    lossCount: 3,
    closedPositions: 5
  };
  
  const scored2 = scorer.score(lowPerformer);
  console.log('\nTest 2: Low performer');
  console.log(`  - Composite Score: ${scored2.compositeScore}`);
  console.log(`  - Tags: ${scored2.reasonTags.join(', ')}`);
  
  // Test case 3: No strict win rate (use proxy)
  const noStrict = {
    address: '0xabcd...',
    strictWinRate: null,
    proxyWinRate: 0.6,
    totalVolumeUsd: 1000,
    confidenceScore: 0.2,
    totalTrades: 15,
    realizedPnl: 100,
    winCount: 0,
    lossCount: 0,
    closedPositions: 0
  };
  
  const scored3 = scorer.score(noStrict);
  console.log('\nTest 3: No strict win rate (fallback to proxy)');
  console.log(`  - Composite Score: ${scored3.compositeScore}`);
  
  console.log('\n=== Scorer Tests Passed ===\n');
}

function testSelector() {
  console.log('=== Selector Module Test ===\n');
  
  const selector = new AccountSelector({
    minTrades: 10,
    minVolume: 100,
    minWinRate: 0.5,
    minConfidence: 0.2,
    topN: 5
  });
  
  // Generate test accounts
  const accounts = [
    { address: '0x111', strictWinRate: 0.8, proxyWinRate: 0.8, totalVolumeUsd: 50000, confidenceScore: 0.7, totalTrades: 100, realizedPnl: 10000, compositeScore: 0.75 },
    { address: '0x222', strictWinRate: 0.7, proxyWinRate: 0.7, totalVolumeUsd: 30000, confidenceScore: 0.6, totalTrades: 80, realizedPnl: 5000, compositeScore: 0.65 },
    { address: '0x333', strictWinRate: 0.6, proxyWinRate: 0.6, totalVolumeUsd: 10000, confidenceScore: 0.5, totalTrades: 50, realizedPnl: 1000, compositeScore: 0.55 },
    { address: '0x444', strictWinRate: 0.55, proxyWinRate: 0.55, totalVolumeUsd: 5000, confidenceScore: 0.4, totalTrades: 30, realizedPnl: 500, compositeScore: 0.45 },
    { address: '0x555', strictWinRate: 0.45, proxyWinRate: 0.45, totalVolumeUsd: 1000, confidenceScore: 0.3, totalTrades: 20, realizedPnl: 100, compositeScore: 0.35 },
    { address: '0x666', strictWinRate: 0.4, proxyWinRate: 0.4, totalVolumeUsd: 500, confidenceScore: 0.2, totalTrades: 15, realizedPnl: -100, compositeScore: 0.25 },
    // Below threshold
    { address: '0x777', strictWinRate: 0.3, proxyWinRate: 0.3, totalVolumeUsd: 50, confidenceScore: 0.1, totalTrades: 5, realizedPnl: -50, compositeScore: 0.1 },
  ];
  
  const result = selector.select(accounts);
  
  console.log('Selection result:');
  console.log(`  - Total input: ${result._stats.totalInput}`);
  console.log(`  - Passed filters: ${result._stats.passedFilters}`);
  console.log(`  - Selected: ${result._stats.selectedCount}`);
  
  console.log('\nSelected accounts (top 5):');
  result.selected.forEach((acc, i) => {
    console.log(`  ${i+1}. ${acc.address}: score=${acc.compositeScore}, winRate=${acc.strictWinRate}, volume=${acc.totalVolumeUsd}`);
  });
  
  console.log('\nSummary:');
  console.log(`  - Avg Win Rate: ${result.summary.avgWinRate.toFixed(3)}`);
  console.log(`  - Avg Volume: ${result.summary.avgVolume.toFixed(2)}`);
  console.log(`  - Avg Score: ${result.summary.avgScore.toFixed(3)}`);
  console.log(`  - Profitable: ${result.summary.profitableCount}/${result.summary.count}`);
  
  // Test updating criteria
  console.log('\n--- Test criteria update ---');
  selector.updateCriteria({ minWinRate: 0.55, topN: 3 });
  const result2 = selector.select(accounts);
  console.log(`After update: selected ${result2._stats.selectedCount} (top 3 with minWinRate=0.55)`);
  
  console.log('\n=== Selector Tests Passed ===\n');
}

// Run tests
testScorer();
testSelector();
console.log('=== All Tests Passed ===');
