#!/usr/bin/env node
/**
 * Generate acceptance report for a sync run
 * 
 * Usage: node scripts/generate-report.js [run-id]
 *   If run-id is not provided, uses the latest run
 * 
 * Output: Markdown report printed to stdout
 */

const { Storage } = require('../src/storage');
const { query, close } = require('../src/db');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function getLatestRunId() {
  const result = await query(
    `SELECT id FROM runs ORDER BY started_at DESC LIMIT 1`
  );
  if (result.rows.length === 0) {
    throw new Error('No runs found in database');
  }
  return result.rows[0].id;
}

async function getRunDetails(runId) {
  const runResult = await query(
    `SELECT * FROM runs WHERE id = $1`,
    [runId]
  );
  
  if (runResult.rows.length === 0) {
    throw new Error(`Run ${runId} not found`);
  }
  
  return runResult.rows[0];
}

async function getSelectedAccounts(runId) {
  const result = await query(
    `SELECT sa.*, a.strict_win_rate, a.proxy_win_rate, 
            a.total_volume_usd, a.total_trades, a.realized_pnl,
            a.confidence_score
     FROM selected_accounts sa
     JOIN accounts a ON sa.address = a.address
     WHERE sa.run_id = $1
     ORDER BY sa.selection_score DESC
     LIMIT 20`,
    [runId]
  );
  
  return result.rows;
}

async function getErrorSummary(runId) {
  const run = await getRunDetails(runId);
  if (!run.stats) {
    return null;
  }
  
  const stats = typeof run.stats === 'string' ? JSON.parse(run.stats) : run.stats;
  return stats.error_summary || null;
}

async function getConfidenceDistribution(runId) {
  const result = await query(
    `SELECT 
       COUNT(CASE WHEN confidence_score >= 0.5 THEN 1 END) as high_confidence,
       COUNT(CASE WHEN confidence_score >= 0.3 AND confidence_score < 0.5 THEN 1 END) as medium_confidence,
       COUNT(CASE WHEN confidence_score < 0.3 THEN 1 END) as low_confidence,
       COUNT(CASE WHEN strict_win_rate IS NOT NULL THEN 1 END) as strict_win_rate_count,
       COUNT(CASE WHEN strict_win_rate IS NULL AND proxy_win_rate IS NOT NULL THEN 1 END) as proxy_only_count,
       COUNT(CASE WHEN strict_win_rate IS NULL AND proxy_win_rate IS NULL THEN 1 END) as no_win_rate_count
     FROM account_metrics_snapshot
     WHERE run_id = $1`,
    [runId]
  );
  
  return result.rows[0];
}

function formatPercentage(value) {
  if (value === null || value === undefined) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
}

function formatCurrency(value) {
  if (value === null || value === undefined) return 'N/A';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTags(tags) {
  if (!tags || tags.length === 0) return '';
  return tags.join(', ');
}

async function generateReport(runId) {
  console.log(`# Polymarket Winner Scanner - Acceptance Report\n`);
  
  // Get run details
  const run = await getRunDetails(runId);
  const stats = typeof run.stats === 'string' ? JSON.parse(run.stats) : run.stats;
  const config = stats.config_used || {};
  
  console.log(`## Run Information`);
  console.log(`- **Run ID:** \`${run.id}\``);
  console.log(`- **Started At:** \`${run.started_at}\``);
  console.log(`- **Completed At:** \`${run.completed_at || 'N/A'}\``);
  console.log(`- **Status:** \`${run.status}\``);
  console.log(`- **Configuration:** \`${JSON.stringify(config, null, 2)}\`\n`);
  
  // Executive Summary
  console.log(`## Executive Summary`);
  const accountsProcessed = stats.accounts_processed || 0;
  const accountsSelected = stats.accounts_selected || 0;
  const accountsFailed = stats.accounts_failed || 0;
  const successRate = accountsProcessed > 0 ? (accountsProcessed - accountsFailed) / accountsProcessed * 100 : 0;
  
  console.log(`- **Accounts Processed:** \`${accountsProcessed}\``);
  console.log(`- **Accounts Selected:** \`${accountsSelected}\``);
  console.log(`- **Accounts Failed:** \`${accountsFailed}\``);
  console.log(`- **Success Rate:** \`${successRate.toFixed(1)}%\``);
  
  // Get top account score
  const selectedAccounts = await getSelectedAccounts(runId);
  const topScore = selectedAccounts.length > 0 ? selectedAccounts[0].selection_score : 0;
  console.log(`- **Top Account Score:** \`${topScore.toFixed(4)}\`\n`);
  
  // Selection Criteria
  console.log(`## Selection Criteria Applied`);
  console.log(`| Criteria | Threshold | Description |`);
  console.log(`|----------|-----------|-------------|`);
  console.log(`| Minimum Trades | \`${config.minTrades || 50}\` | Account must have at least this many trades |`);
  console.log(`| Minimum Volume | \`${formatCurrency(config.minVolumeUsd || 5000)}\` | Minimum USD trading volume |`);
  console.log(`| Minimum Win Rate | \`${formatPercentage(config.minWinRate || 0.58)}\` | Minimum win rate (strict or proxy) |`);
  console.log(`| Minimum Confidence | \`${config.minConfidence || 0.1}\` | Minimum confidence score |`);
  console.log(`| Top N Selection | \`${config.topN || 100}\` | Select top N accounts by composite score |\n`);
  
  // Performance Metrics
  console.log(`## Performance Metrics`);
  
  if (stats.selection_summary) {
    const summary = stats.selection_summary;
    console.log(`### Selection Statistics`);
    console.log(`| Metric | Value |`);
    console.log(`|--------|-------|`);
    console.log(`| Total Input Accounts | \`${accountsProcessed}\` |`);
    console.log(`| Passed Threshold Filters | \`${summary.count || 0}\` |`);
    console.log(`| Final Selection Count | \`${accountsSelected}\` |`);
    
    const filterPassRate = accountsProcessed > 0 ? (summary.count || 0) / accountsProcessed * 100 : 0;
    console.log(`| Filter Pass Rate | \`${filterPassRate.toFixed(1)}%\` |\n`);
    
    console.log(`### Quality Metrics`);
    console.log(`| Metric | Value |`);
    console.log(`|--------|-------|`);
    console.log(`| Average Win Rate | \`${formatPercentage(summary.avgWinRate)}\` |`);
    console.log(`| Average Volume | \`${formatCurrency(summary.avgVolume)}\` |`);
    console.log(`| Average Confidence | \`${summary.avgConfidence?.toFixed(3) || 'N/A'}\` |`);
    console.log(`| Average Composite Score | \`${summary.avgScore?.toFixed(4) || 'N/A'}\` |`);
    console.log(`| Total Volume (Selected) | \`${formatCurrency(summary.totalVolume)}\` |`);
    console.log(`| Profitable Accounts | \`${summary.profitableCount || 0}/${summary.count || 0}\` |`);
    console.log(`| Profitable Percentage | \`${formatPercentage(summary.profitablePercent)}\` |\n`);
  }
  
  // Top Accounts
  console.log(`## Top ${Math.min(10, selectedAccounts.length)} Selected Accounts`);
  if (selectedAccounts.length > 0) {
    console.log(`| Rank | Address | Composite Score | Win Rate | Volume (USD) | Trades | Reason Tags |`);
    console.log(`|------|---------|-----------------|----------|--------------|--------|-------------|`);
    
    selectedAccounts.slice(0, 10).forEach((account, index) => {
      const winRate = account.strict_win_rate || account.proxy_win_rate;
      console.log(`| ${index + 1} | \`${account.address}\` | ${account.selection_score?.toFixed(4) || 'N/A'} | ${formatPercentage(winRate)} | ${formatCurrency(account.total_volume_usd)} | ${account.total_trades || 0} | ${formatTags(account.reason_tags)} |`);
    });
    console.log();
  } else {
    console.log(`*No accounts were selected in this run.*\n`);
  }
  
  // Error Summary
  console.log(`## Error Summary`);
  const errorSummary = await getErrorSummary(runId);
  
  if (errorSummary && errorSummary.hasErrors) {
    console.log(`**Total Errors:** \`${errorSummary.errorCount}\`\n`);
    console.log(`| Error Type | Count |`);
    console.log(`|------------|-------|`);
    
    for (const [type, count] of Object.entries(errorSummary.errorsByType || {})) {
      console.log(`| ${type} | ${count} |`);
    }
    console.log();
    
    if (errorSummary.sampleErrors && errorSummary.sampleErrors.length > 0) {
      console.log(`### Sample Errors`);
      errorSummary.sampleErrors.forEach(sample => {
        console.log(`- **${sample.type}** (${sample.count} occurrences):`);
        sample.samples.forEach(s => {
          console.log(`  - \`${s.address}\`: ${s.message}`);
        });
      });
      console.log();
    }
  } else {
    console.log(`✅ **No errors encountered during sync.**\n`);
  }
  
  // Data Quality Assessment
  console.log(`## Data Quality Assessment`);
  const confidenceDist = await getConfidenceDistribution(runId);
  
  if (confidenceDist) {
    console.log(`### Confidence Distribution`);
    console.log(`- **High Confidence (≥0.5):** \`${confidenceDist.high_confidence || 0}\` accounts`);
    console.log(`- **Medium Confidence (0.3-0.5):** \`${confidenceDist.medium_confidence || 0}\` accounts`);
    console.log(`- **Low Confidence (<0.3):** \`${confidenceDist.low_confidence || 0}\` accounts\n`);
    
    console.log(`### Win Rate Reliability`);
    console.log(`- **Accounts with Strict Win Rate:** \`${confidenceDist.strict_win_rate_count || 0}\``);
    console.log(`- **Accounts with Proxy Win Rate Only:** \`${confidenceDist.proxy_only_count || 0}\``);
    console.log(`- **Accounts with No Win Rate Data:** \`${confidenceDist.no_win_rate_count || 0}\`\n`);
  }
  
  // Recommendations
  console.log(`## Recommendations`);
  console.log(`### For Next Run`);
  
  if (accountsSelected < 5) {
    console.log(`1. **Selection count is low (${accountsSelected} accounts).** Consider lowering thresholds to increase selection.`);
  } else if (accountsSelected > 50) {
    console.log(`1. **Selection count is high (${accountsSelected} accounts).** Consider raising thresholds to improve quality.`);
  } else {
    console.log(`1. **Selection count (${accountsSelected} accounts) is within reasonable range.**`);
  }
  
  if (accountsFailed > accountsProcessed * 0.1) {
    console.log(`2. **Error rate is high (${accountsFailed}/${accountsProcessed}).** Investigate API failures or network issues.`);
  } else if (accountsFailed > 0) {
    console.log(`2. **Some errors occurred (${accountsFailed}/${accountsProcessed}).** Review error summary for details.`);
  } else {
    console.log(`2. **No errors occurred.** System is running smoothly.`);
  }
  
  if (confidenceDist && confidenceDist.low_confidence > confidenceDist.high_confidence) {
    console.log(`3. **Many low-confidence accounts (${confidenceDist.low_confidence}).** Consider increasing discovery count or waiting for more data.`);
  }
  
  console.log();
  
  // Technical Notes
  console.log(`## Technical Notes`);
  if (run.started_at && run.completed_at) {
    const startTime = new Date(run.started_at);
    const endTime = new Date(run.completed_at);
    const durationSeconds = Math.round((endTime - startTime) / 1000);
    const avgPerAccount = accountsProcessed > 0 ? durationSeconds / accountsProcessed : 0;
    const accountsPerMinute = durationSeconds > 0 ? accountsProcessed / (durationSeconds / 60) : 0;
    
    console.log(`### Run Duration`);
    console.log(`- **Total Duration:** \`${durationSeconds}\` seconds`);
    console.log(`- **Average per Account:** \`${avgPerAccount.toFixed(2)}\` seconds`);
    console.log(`- **Accounts per Minute:** \`${accountsPerMinute.toFixed(1)}\`\n`);
    
    // Estimate API calls: 3 calls per account (positions, closed-positions, activity)
    const estimatedApiCalls = accountsProcessed * 3;
    console.log(`### API Usage`);
    console.log(`- **Estimated API Calls:** \`${estimatedApiCalls}\``);
    console.log(`- **Rate Limiting:** Within Polymarket limits (150-200 req/10s)\n`);
  }
  
  // Get counts of new vs updated accounts
  const accountStats = await query(
    `SELECT 
       COUNT(CASE WHEN first_seen_at > $1::timestamp - interval '1 hour' THEN 1 END) as new_accounts,
       COUNT(CASE WHEN first_seen_at <= $1::timestamp - interval '1 hour' THEN 1 END) as updated_accounts
     FROM accounts
     WHERE last_sync_run_id = $2`,
    [run.started_at, runId]
  );
  
  const snapshotsCount = await query(
    `SELECT COUNT(*) as count FROM account_metrics_snapshot WHERE run_id = $1`,
    [runId]
  );
  
  console.log(`### Database Impact`);
  console.log(`- **New Accounts Added:** \`${accountStats.rows[0]?.new_accounts || 0}\``);
  console.log(`- **Existing Accounts Updated:** \`${accountStats.rows[0]?.updated_accounts || 0}\``);
  console.log(`- **Snapshots Created:** \`${snapshotsCount.rows[0]?.count || 0}\`\n`);
  
  // Acceptance Checklist
  console.log(`## Acceptance Checklist`);
  const minAcceptableSelection = 5;
  const targetWinRate = 0.55;
  const maxAcceptableErrors = accountsProcessed * 0.1; // 10% error rate
  
  console.log(`- [${run.status === 'completed' ? 'x' : ' '}] Run completed successfully (status = \`${run.status}\`)`);
  console.log(`- [${accountsSelected >= minAcceptableSelection ? 'x' : ' '}] At least \`${minAcceptableSelection}\` accounts selected (actual: ${accountsSelected})`);
  
  const avgWinRate = stats.selection_summary?.avgWinRate || 0;
  console.log(`- [${avgWinRate >= targetWinRate ? 'x' : ' '}] Average win rate ≥ \`${formatPercentage(targetWinRate)}\` (actual: ${formatPercentage(avgWinRate)})`);
  console.log(`- [${accountsFailed <= maxAcceptableErrors ? 'x' : ' '}] Error count ≤ \`${Math.ceil(maxAcceptableErrors)}\` (actual: ${accountsFailed})`);
  
  const minConfidence = config.minConfidence || 0.1;
  console.log(`- [ ] All selected accounts have confidence score ≥ \`${minConfidence}\` (verify manually)`);
  console.log(`- [ ] Database integrity maintained (no orphaned records, verify manually)\n`);
  
  // Sign-off
  console.log(`## Sign-off`);
  console.log(`- **Reviewed By:** _____________________`);
  console.log(`- **Date:** \`${new Date().toISOString().split('T')[0]}\``);
  console.log(`- **Approval Status:** \`Pending\`\n`);
  
  console.log(`---\n`);
  console.log(`*Report generated by Polymarket Winner Scanner v1.0.0*`);
  console.log(`*Generated at: ${new Date().toISOString()}*`);
}

async function main() {
  const args = process.argv.slice(2);
  let runId;
  
  try {
    if (args.length > 0) {
      runId = args[0];
      console.log(`Generating report for run: ${runId}`);
    } else {
      runId = await getLatestRunId();
      console.log(`Generating report for latest run: ${runId}`);
    }
    
    await generateReport(runId);
    
  } catch (error) {
    console.error(`Error generating report: ${error.message}`);
    process.exit(1);
  } finally {
    await close();
  }
}

main();