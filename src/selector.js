/**
 * Selector Module - Filter and select top accounts based on criteria
 * 
 * Responsibilities:
 * - Apply configurable thresholds (min_trades, min_volume, min_winrate)
 * - Select top N accounts by composite score
 * - Support dry-run mode for testing
 */

class AccountSelector {
  /**
   * @param {Object} options - Selection criteria
   * @param {number} options.minTrades - Minimum number of trades
   * @param {number} options.minVolume - Minimum volume in USD
   * @param {number} options.minWinRate - Minimum win rate (0-1)
   * @param {number} options.minConfidence - Minimum confidence score (0-1)
   * @param {number} options.minPnl - Minimum realized PnL (default: 0, i.e., profitable only)
   * @param {number} options.topN - Number of top accounts to select
   */
  constructor(options = {}) {
    this.minTrades = options.minTrades ?? 10;
    this.minVolume = options.minVolume ?? 100;
    this.minWinRate = options.minWinRate ?? 0.5;
    this.minConfidence = options.minConfidence ?? 0.1;
    this.minPnl = options.minPnl ?? 0;  // Default: profitable only
    this.topN = options.topN ?? 100;
  }

  /**
   * Apply filters and select accounts
   * @param {Array} scoredAccounts - Array of scored accounts from scorer
   * @returns {Object} - Selection result with filtered and top accounts
   */
  select(scoredAccounts) {
    // Phase 1: Apply minimum thresholds
    const filtered = scoredAccounts.filter(account => {
      // Use strict_win_rate if available, otherwise proxy_win_rate
      const winRate = account.strictWinRate ?? account.proxyWinRate;
      
      // Fix: If both win rates are null, the account does not pass the win rate threshold
      // This prevents accounts with no win rate data from passing when minWinRate > 0
      const passesWinRate = winRate !== null && winRate >= this.minWinRate;
      
      // PnL filter: use totalPnl (realized + cash) for accurate profitability
      const passesPnl = (account.totalPnl ?? account.realizedPnl ?? 0) >= this.minPnl;
      
      return (
        account.totalTrades >= this.minTrades &&
        account.totalVolumeUsd >= this.minVolume &&
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
          topN: this.topN
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
