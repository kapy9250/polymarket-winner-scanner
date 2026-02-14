#!/usr/bin/env node
/**
 * Run scanner with automatic acceptance report generation
 * 
 * Usage: npm run sync:report -- [runner-options]
 * 
 * This script:
 * 1. Runs the main scanner with provided options
 * 2. Captures the run ID
 * 3. Generates an acceptance report after completion
 * 4. Saves report to file
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Storage } = require('../src/storage');
const { close } = require('../src/db');
require('dotenv').config();

// Parse arguments (pass through to runner)
const args = process.argv.slice(2);

// Check if help is requested
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Polymarket Winner Scanner - Run with Report

Usage: node scripts/run-with-report.js [runner-options]

Runner Options:
  --min-trades <n>      Minimum trade count (default: 50)
  --min-volume <v>      Minimum volume in USD (default: 5000)
  --min-winrate <r>     Minimum win rate (default: 0.58)
  --min-confidence <c>  Minimum confidence score (default: 0.1)
  --top-n <n>           Number of top accounts to select (default: 100)
  --seed-file <path>    Path to seed addresses file
  --discover <n>        Discover N traders from recent trades
  --dry-run             Test run without writing to database
  --help, -h            Show this help message

Report Options:
  --report-file <path>  Save report to specified file (default: ./reports/run-{id}.md)
  --no-report           Skip report generation
  --email <address>     Email report (not implemented)

Examples:
  node scripts/run-with-report.js --min-trades 100 --min-volume 10000
  node scripts/run-with-report.js --discover 200 --report-file ./latest-report.md
  node scripts/run-with-report.js --dry-run --no-report
`);
  process.exit(0);
}

// Extract report-specific options
const reportFileIndex = args.indexOf('--report-file');
let reportFilePath = null;
if (reportFileIndex !== -1) {
  reportFilePath = args[reportFileIndex + 1];
  args.splice(reportFileIndex, 2); // Remove from runner args
}

const noReport = args.includes('--no-report');
if (noReport) {
  args.splice(args.indexOf('--no-report'), 1);
}

const dryRun = args.includes('--dry-run');
if (dryRun) {
  args.splice(args.indexOf('--dry-run'), 1);
  console.log('[Run-With-Report] Dry run mode - no database writes');
}

async function getLatestRunId() {
  const { query } = require('../src/db');
  const result = await query(
    `SELECT id FROM runs ORDER BY started_at DESC LIMIT 1`
  );
  if (result.rows.length === 0) {
    throw new Error('No runs found in database');
  }
  return result.rows[0].id;
}

async function generateReport(runId, outputPath) {
  console.log(`[Run-With-Report] Generating acceptance report for run ${runId}...`);
  
  // Use the generate-report script
  const generateReportScript = path.join(__dirname, 'generate-report.js');
  
  try {
    const reportContent = execSync(
      `node "${generateReportScript}" "${runId}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    // Ensure reports directory exists
    const reportsDir = path.dirname(outputPath);
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    // Save to file
    fs.writeFileSync(outputPath, reportContent, 'utf8');
    console.log(`[Run-With-Report] Report saved to: ${outputPath}`);
    
    // Also output to console (first 50 lines)
    console.log('\n=== Report Summary (first 50 lines) ===');
    const lines = reportContent.split('\n').slice(0, 50);
    console.log(lines.join('\n'));
    if (reportContent.split('\n').length > 50) {
      console.log('... (full report saved to file)');
    }
    console.log('=====================================\n');
    
  } catch (error) {
    console.error(`[Run-With-Report] Failed to generate report: ${error.message}`);
    if (error.stderr) {
      console.error(`[Run-With-Report] stderr: ${error.stderr.toString()}`);
    }
  }
}

async function main() {
  console.log('[Run-With-Report] Starting Polymarket Winner Scanner with report generation\n');
  
  // Build command for runner
  const runnerScript = path.join(__dirname, '..', 'src', 'runner.js');
  const command = 'node';
  const commandArgs = [runnerScript, ...args];
  
  if (dryRun) {
    commandArgs.push('--dry-run');
    console.log('[Run-With-Report] Note: --dry-run passed to runner (if supported)');
  }
  
  console.log(`[Run-With-Report] Executing: node ${commandArgs.join(' ')}`);
  console.log('[Run-With-Report]'.padEnd(80, '='));
  
  let runId = null;
  let runSuccessful = false;
  
  try {
    // Run the scanner
    const scannerProcess = spawn(command, commandArgs, {
      stdio: 'inherit', // Pass through stdout/stderr
      shell: false
    });
    
    // Wait for completion
    await new Promise((resolve, reject) => {
      scannerProcess.on('close', (code) => {
        if (code === 0) {
          runSuccessful = true;
          resolve();
        } else {
          reject(new Error(`Scanner exited with code ${code}`));
        }
      });
      
      scannerProcess.on('error', (err) => {
        reject(err);
      });
    });
    
    console.log('[Run-With-Report]'.padEnd(80, '='));
    
    if (runSuccessful) {
      console.log('[Run-With-Report] Scanner completed successfully');
      
      // Get the run ID of the just-completed run
      try {
        runId = await getLatestRunId();
        console.log(`[Run-With-Report] Detected run ID: ${runId}`);
        
        // Generate report unless disabled
        if (!noReport) {
          const defaultReportDir = path.join(process.cwd(), 'reports');
          if (!reportFilePath) {
            // Generate default filename
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `report-${runId.substring(0, 8)}-${timestamp}.md`;
            reportFilePath = path.join(defaultReportDir, filename);
          }
          
          await generateReport(runId, reportFilePath);
        } else {
          console.log('[Run-With-Report] Report generation disabled (--no-report)');
        }
        
      } catch (error) {
        console.error(`[Run-With-Report] Could not determine run ID: ${error.message}`);
        console.error('[Run-With-Report] Report generation skipped');
      }
      
    } else {
      console.error('[Run-With-Report] Scanner failed - skipping report generation');
    }
    
  } catch (error) {
    console.error(`[Run-With-Report] Error: ${error.message}`);
    process.exit(1);
  } finally {
    try {
      await close();
    } catch (err) {
      // Ignore close errors
    }
  }
  
  console.log('[Run-With-Report] Done');
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('[Run-With-Report] Unhandled rejection:', error);
  process.exit(1);
});

main();