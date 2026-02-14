/**
 * Selector Module - Filter and select top accounts based on criteria
 * 
 * Responsibilities:
 * - Apply configurable thresholds (min_trades, min_volume, min_winrate, min_pnl)
 * - Support 90-day window metrics filtering
 * - Select top N accounts by composite score
 */

class AccountSelector {
  /**
   * @param {Object} options - Selection criteria
   * @param {number} options.minTrades - Minimum number of trades
   * @param {number} options.minVolume - Minimum volume in USD
   * @param {number} options.minWinRate - Minimum win rate (0-1)
   * @param {number} options.minConfidence - Minimum confidence score (0-1)
   * @param {number} options.minPnl - Minimum realized PnL (default: 0)
   * @param {number} options.topN - Number of top accounts to select
   * @param {boolean} options.use90dMetrics - Use 90-day metrics for filtering
   */
  constructor(options = {}) {
    this.minTrades = options.minTrades ?? 10;
    this.minVolume = options.minVolume ?? 100;
    this.minWinRate = options.minWinRate ?? 0.8;
    this.minConfidence = options.minConfidence ?? 0.1;
    this.minPnl = options.minPnl ?? 0;
    this.topN = options.topN ?? 100;
    this.use90dMetrics = options.use90dMetrics ?? false;
  }

  /**
   * Apply filters and select accounts
   * @param {Array} scoredAccounts - Array of scored accounts from scorer
   * @returns {Object} - Selection result with filtered and top accounts
   */
  select(scoredAccounts) {
    // Phase 1: Apply minimum thresholds
    const filtered = scoredAccounts.filter(account => {
      // Use 90-day metrics if enabled and available
      const winRate = this.use90dMetrics 
        ? (account.winRate90d ?? account.strictWinRate ?? account.proxyWinRate)
        : (account.strictWinRate ?? account.proxyWinRate);
      
      const trades = this.use90dMetrics 
        ? (account.trades90d ?? account.totalTrades)
        : account.totalTrades;
      
      const volume = this.use90dMetrics 
        ? (account.volume90d ?? account.totalVolumeUsd)
        : account.totalVolumeUsd;
      
      const pnl = this.use90dMetrics 
        ? (account.realizedPnl90d ?? account.realizedPnl)
        : account.realizedPnl;
      
      // Win rate check: must not be null
      const passesWinRate = winRate !== null && winRate >= this.minWinRate;
      
      // PnL check: must be >= minPnl (default 0, meaning profitable)
      const passesPnl = pnl !== undefined && pnl >= this.minPnl;
      
      return (
        trades >= this.minTrades &&
        volume >= this.minVolume &&
        passesWinRate &&
        account.confidenceScore >= this.minConfidence &&
        passesPnl
      );
    });

    // Phase 2: Sort by composite score and take top N
    const sorted = [...filtered].sort((a, b) => 
      b.compositeScore - a.compositeScore
    );
    const topAccounts = sorted.slice(0, this.topN);

    // Phase 3: Generate summary statistics
    const summary = this.generateSummary(topAccounts);

    return {
      // Selected accounts
      selected: topAccounts,
      
      // Statistics
      summary,
      
      // Debug info
      _stats: {
        totalInput: scoredAccounts.length,
        passedFilters: filtered.length,
        selectedCount: topAccounts.length,
        criteria: {
          minTrades: this.minTrades,
          minVolume: this.minVolume,
          minWinRate: this.minWinRate,
          minConfidence: this.minConfidence,
          minPnl: this.minPnl,
          topN: this.topN,
          use90dMetrics: this.use90dMetrics
        }
      }
    };
  }

  /**
   * Generate summary statistics for selected accounts
   * @param {Array} accounts - Selected accounts
   * @returns {Object} - Summary statistics
   */
  generateSummary(accounts) {
    if (accounts.length === 0) {
      return {
        count: 0,
        avgWinRate: 0,
        avgVolume: 0,
        avgScore: 0,
        totalVolume: 0,
        profitableCount: 0
      };
    }

    const winRates = accounts.map(a => a.strictWinRate ?? a.proxyWinRate ?? 0);
    const volumes = accounts.map(a => a.totalVolumeUsd);
    const scores = accounts.map(a => a.compositeScore);
    const profitable = accounts.filter(a => a.realizedPnl > 0).length;

    return {
      count: accounts.length,
      avgWinRate: winRates.reduce((a, b) => a + b, 0) / accounts.length,
      avgVolume: volumes.reduce((a, b) => a + b, 0) / accounts.length,
      avgScore: scores.reduce((a, b) => a + b, 0) / accounts.length,
      totalVolume: volumes.reduce((a, b) => a + b, 0),
      profitableCount: profitable,
      profitablePercent: profitable / accounts.length
    };
  }

  /**
   * Get selection criteria as object
   * @returns {Object} - Current selection criteria
   */
  getCriteria() {
    return {
      minTrades: this.minTrades,
      minVolume: this.minVolume,
      minWinRate: this.minWinRate,
      minConfidence: this.minConfidence,
      topN: this.topN
    };
  }

  /**
   * Update selection criteria
   * @param {Object} criteria - New criteria
   */
  updateCriteria(criteria) {
    if (criteria.minTrades !== undefined) this.minTrades = criteria.minTrades;
    if (criteria.minVolume !== undefined) this.minVolume = criteria.minVolume;
    if (criteria.minWinRate !== undefined) this.minWinRate = criteria.minWinRate;
    if (criteria.minConfidence !== undefined) this.minConfidence = criteria.minConfidence;
    if (criteria.topN !== undefined) this.topN = criteria.topN;
  }
}

module.exports = { AccountSelector };
