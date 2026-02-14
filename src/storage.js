/**
 * Storage Module - Database operations for syncing account data
 * 
 * Responsibilities:
 * - Run lifecycle management (create, complete, fail)
 * - Account upsert with cumulative metrics
 * - Metrics snapshot creation
 * - Selected accounts recording
 * - Error summary generation
 * 
 * Transaction boundaries:
 * - Each account upsert is a single transaction
 * - Run status updates are atomic
 */

const { query, getClient, close } = require('./db');

class Storage {
  constructor(options = {}) {
    this.logger = options.logger || console;
  }

  /**
   * Create a new run record
   * @param {Object} config - Run configuration
   * @returns {string} - Run ID
   */
  async createRun(config) {
    const result = await query(
      `INSERT INTO runs (status, config) VALUES ($1, $2) RETURNING id`,
      ['running', JSON.stringify(config)]
    );
    const runId = result.rows[0].id;
    this.logger.info(`[Storage] Created run: ${runId}`);
    return runId;
  }

  /**
   * Complete a run with statistics
   * @param {string} runId - Run ID
   * @param {Object} stats - Run statistics
   */
  async completeRun(runId, stats) {
    await query(
      `UPDATE runs SET status = $1, completed_at = NOW(), stats = $2 WHERE id = $3`,
      ['completed', JSON.stringify(stats), runId]
    );
    this.logger.info(`[Storage] Completed run: ${runId}`);
  }

  /**
   * Fail a run with error message
   * @param {string} runId - Run ID
   * @param {string} errorMessage - Error message
   */
  async failRun(runId, errorMessage) {
    await query(
      `UPDATE runs SET status = $1, completed_at = NOW(), error_message = $2 WHERE id = $3`,
      ['failed', errorMessage, runId]
    );
    this.logger.error(`[Storage] Failed run: ${runId} - ${errorMessage}`);
  }

  /**
   * Upsert account with cumulative metrics
   * Single transaction for atomic update
   * @param {string} runId - Run ID
   * @param {Object} account - Account data with metrics
   * @returns {Object} - { address, isNew, updated }
   */
  async upsertAccount(runId, account) {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      
      // Check if account exists
      const existingResult = await client.query(
        `SELECT * FROM accounts WHERE address = $1`,
        [account.address]
      );
      
      const isNew = existingResult.rows.length === 0;
      let result;
      
      if (isNew) {
        // Insert new account
        result = await client.query(
          `INSERT INTO accounts (
            address, first_seen_at, last_seen_at, last_sync_run_id,
            total_trades, total_volume_usd, total_positions, closed_positions,
            win_count, loss_count, strict_win_rate, proxy_win_rate,
            realized_pnl, confidence_score, discovery_method
          ) VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING *`,
          [
            account.address,
            runId,
            account.totalTrades || 0,
            account.totalVolumeUsd || 0,
            account.positionsCount || 0,
            account.closedPositions || 0,
            account.winCount || 0,
            account.lossCount || 0,
            account.strictWinRate,
            account.proxyWinRate,
            account.realizedPnl || 0,
            account.confidenceScore || 0,
            account.discoveryMethod || 'trades_stream'
          ]
        );
        this.logger.info(`[Storage] Inserted new account: ${account.address}`);
      } else {
        // Update existing account
        result = await client.query(
          `UPDATE accounts SET
            last_seen_at = NOW(),
            last_sync_run_id = $1,
            total_trades = $2,
            total_volume_usd = $3,
            total_positions = $4,
            closed_positions = $5,
            win_count = $6,
            loss_count = $7,
            strict_win_rate = $8,
            proxy_win_rate = $9,
            realized_pnl = $10,
            confidence_score = $11,
            updated_at = NOW()
          WHERE address = $12
          RETURNING *`,
          [
            runId,
            account.totalTrades || 0,
            account.totalVolumeUsd || 0,
            account.positionsCount || 0,
            account.closedPositions || 0,
            account.winCount || 0,
            account.lossCount || 0,
            account.strictWinRate,
            account.proxyWinRate,
            account.realizedPnl || 0,
            account.confidenceScore || 0,
            account.address
          ]
        );
        this.logger.info(`[Storage] Updated account: ${account.address}`);
      }
      
      await client.query('COMMIT');
      
      return {
        address: account.address,
        isNew,
        updated: true
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`[Storage] Failed to upsert account ${account.address}: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create metrics snapshot for a run
   * @param {string} runId - Run ID
   * @param {Object} account - Account with scored metrics
   */
  async createMetricsSnapshot(runId, account) {
    try {
      await query(
        `INSERT INTO account_metrics_snapshot (
          run_id, address, strict_win_rate, proxy_win_rate,
          total_trades, total_volume_usd, realized_pnl,
          win_count, loss_count, closed_positions, confidence_score, score,
          positions_count, activity_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (run_id, address) DO UPDATE SET
          strict_win_rate = EXCLUDED.strict_win_rate,
          proxy_win_rate = EXCLUDED.proxy_win_rate,
          total_trades = EXCLUDED.total_trades,
          total_volume_usd = EXCLUDED.total_volume_usd,
          realized_pnl = EXCLUDED.realized_pnl,
          win_count = EXCLUDED.win_count,
          loss_count = EXCLUDED.loss_count,
          closed_positions = EXCLUDED.closed_positions,
          confidence_score = EXCLUDED.confidence_score,
          score = EXCLUDED.score`,
        [
          runId,
          account.address,
          account.strictWinRate,
          account.proxyWinRate,
          account.totalTrades || 0,
          account.totalVolumeUsd || 0,
          account.realizedPnl || 0,
          account.winCount || 0,
          account.lossCount || 0,
          account.closedPositions || 0,
          account.confidenceScore || 0,
          account.compositeScore || 0,
          account.positionsCount || 0,
          account.activityCount || 0
        ]
      );
      this.logger.info(`[Storage] Created snapshot for ${account.address}`);
    } catch (error) {
      this.logger.error(`[Storage] Failed to create snapshot for ${account.address}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Record selected accounts for a run
   * @param {string} runId - Run ID
   * @param {Array} selectedAccounts - Selected accounts with scores and tags
   */
  async recordSelectedAccounts(runId, selectedAccounts) {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      
      for (const account of selectedAccounts) {
        await client.query(
          `INSERT INTO selected_accounts (
            run_id, address, reason_tags, selection_score,
            strict_win_rate, total_trades, total_volume_usd, realized_pnl
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (run_id, address) DO UPDATE SET
            reason_tags = EXCLUDED.reason_tags,
            selection_score = EXCLUDED.selection_score,
            strict_win_rate = EXCLUDED.strict_win_rate,
            total_trades = EXCLUDED.total_trades,
            total_volume_usd = EXCLUDED.total_volume_usd,
            realized_pnl = EXCLUDED.realized_pnl`,
          [
            runId,
            account.address,
            account.reasonTags || [],
            account.compositeScore || 0,
            account.strictWinRate,
            account.totalTrades || 0,
            account.totalVolumeUsd || 0,
            account.realizedPnl || 0
          ]
        );
      }
      
      await client.query('COMMIT');
      this.logger.info(`[Storage] Recorded ${selectedAccounts.length} selected accounts for run ${runId}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`[Storage] Failed to record selected accounts: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Generate error summary from error array
   * @param {Array} errors - Array of error objects { address, type, message }
   * @returns {Object} - Error summary
   * 
   * Example output:
   * {
   *   hasErrors: true,
   *   errorCount: 15,
   *   errorsByType: { 'api_failure': 10, 'parse_error': 5 },
   *   sampleErrors: [
   *     { type: 'api_failure', count: 10, samples: [{ address: '0x...', message: '...' }] }
   *   ]
   * }
   */
  generateErrorSummary(errors) {
    if (!errors || errors.length === 0) {
      return {
        hasErrors: false,
        errorCount: 0,
        errorsByType: {},
        sampleErrors: []
      };
    }

    // Group errors by type
    const errorsByType = {};
    for (const error of errors) {
      const type = error.type || 'unknown';
      if (!errorsByType[type]) {
        errorsByType[type] = [];
      }
      errorsByType[type].push(error);
    }

    // Get sample errors (max 5 per type)
    const sampleErrors = [];
    for (const [type, typeErrors] of Object.entries(errorsByType)) {
      sampleErrors.push({
        type,
        count: typeErrors.length,
        samples: typeErrors.slice(0, 5).map(e => ({
          address: e.address,
          message: e.message
        }))
      });
    }

    return {
      hasErrors: true,
      errorCount: errors.length,
      errorsByType: Object.fromEntries(
        Object.entries(errorsByType).map(([k, v]) => [k, v.length])
      ),
      sampleErrors
    };
  }

  /**
   * Get run statistics
   * @param {string} runId - Run ID
   * @returns {Object} - Run statistics
   */
  async getRunStats(runId) {
    const runResult = await query(
      `SELECT * FROM runs WHERE id = $1`,
      [runId]
    );
    
    const selectedResult = await query(
      `SELECT COUNT(*) as count FROM selected_accounts WHERE run_id = $1`,
      [runId]
    );
    
    const snapshotResult = await query(
      `SELECT COUNT(*) as count FROM account_metrics_snapshot WHERE run_id = $1`,
      [runId]
    );

    return {
      run: runResult.rows[0],
      selectedCount: parseInt(selectedResult.rows[0].count),
      snapshotCount: parseInt(snapshotResult.rows[0].count)
    };
  }

  /**
   * Load seed addresses from database
   * @returns {Array} - Array of seed addresses
   */
  async loadSeedAddresses() {
    const result = await query(
      `SELECT address FROM seed_addresses WHERE is_active = true`
    );
    return result.rows.map(r => r.address);
  }

  /**
   * Add seed addresses to database
   * @param {Array} addresses - Array of addresses
   * @param {string} source - Source of addresses
   * @returns {Object} - { added, duplicates }
   */
  async addSeedAddresses(addresses, source = 'manual') {
    const client = await getClient();
    let addedCount = 0;
    let duplicateCount = 0;
    
    try {
      await client.query('BEGIN');
      
      for (const address of addresses) {
        try {
          await client.query(
            `INSERT INTO seed_addresses (address, source) VALUES ($1, $2)`,
            [address, source]
          );
          addedCount++;
        } catch (err) {
          // Duplicate key error
          if (err.code === '23505') {
            duplicateCount++;
          } else {
            throw err;
          }
        }
      }
      
      await client.query('COMMIT');
      
      return { added: addedCount, duplicates: duplicateCount };
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { Storage };