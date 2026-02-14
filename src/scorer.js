/**
 * Scorer Module - Calculate and score trader metrics
 * 
 * Responsibilities:
 * - Calculate strict_win_rate, proxy_win_rate from collected data
 * - Apply scoring formula (weighted composite score)
 * - Support configurable thresholds
 */

class AccountScorer {
  /**
   * @param {Object} options - Scoring configuration
   * @param {number} options.winRateWeight - Weight for win rate (default: 0.5)
   * @param {number} options.volumeWeight - Weight for volume (default: 0.3)
   * @param {number} options.confidenceWeight - Weight for confidence (default: 0.2)
   */
  constructor(options = {}) {
    this.winRateWeight = options.winRateWeight ?? 0.5;
    this.volumeWeight = options.volumeWeight ?? 0.3;
    this.confidenceWeight = options.confidenceWeight ?? 0.2;
  }

  /**
   * Calculate composite score for an account
   * @param {Object} metrics - Account metrics from collector
   * @returns {Object} - Scored metrics
   */
  score(metrics) {
    const {
      // 90-day metrics (preferred)
      winRate90d,
      volume90d,
      trades90d,
      realizedPnl90d,
      winCount90d,
      lossCount90d,
      closedPositions90d,
      
      // Original metrics (fallback)
      strictWinRate,
      proxyWinRate,
      totalVolumeUsd,
      confidenceScore,
      totalTrades,
      realizedPnl,
      winCount,
      lossCount,
      closedPositions,
      
      // Window info
      windowDays
    } = metrics;

    // Use 90-day metrics if available, otherwise fallback to original
    const effectiveWinRate = winRate90d ?? strictWinRate ?? proxyWinRate ?? 0;
    const effectiveVolume = volume90d ?? totalVolumeUsd ?? 0;
    const effectiveTrades = trades90d ?? totalTrades ?? 0;
    const effectivePnl = realizedPnl90d ?? realizedPnl ?? 0;
    const effectiveWinCount = winCount90d ?? winCount ?? 0;
    const effectiveLossCount = lossCount90d ?? lossCount ?? 0;
    const effectiveClosedPositions = closedPositions90d ?? closedPositions ?? 0;

    // Normalize volume (log scale to handle wide range)
    const normalizedVolume = this.normalizeVolume(effectiveVolume);

    // Calculate composite score
    // Score = a * win_rate + b * log_volume + c * confidence
    const compositeScore = 
      this.winRateWeight * (effectiveWinRate ?? 0) +
      this.volumeWeight * normalizedVolume +
      this.confidenceWeight * (confidenceScore ?? 0);

    // Determine reason tags based on metrics
    const reasonTags = this.determineReasonTags(metrics);

    return {
      // Identifiers
      address: metrics.address,
      
      // 90-day metrics (NEW)
      winRate90d: winRate90d ?? null,
      volume90d: volume90d ?? 0,
      trades90d: trades90d ?? 0,
      realizedPnl90d: realizedPnl90d ?? 0,
      
      // Original metrics (backward compatible)
      strictWinRate: strictWinRate ?? null,
      proxyWinRate: proxyWinRate ?? null,
      totalTrades: effectiveTrades,
      totalVolumeUsd: effectiveVolume,
      realizedPnl: effectivePnl,
      confidenceScore: confidenceScore ?? 0,
      
      // Win/Loss counts
      winCount: effectiveWinCount,
      lossCount: effectiveLossCount,
      closedPositions: effectiveClosedPositions,
      
      // Score
      compositeScore: Math.round(compositeScore * 10000) / 10000,
      
      // Tags
      reasonTags,
      
      // Window info
      windowDays: windowDays ?? 90,
      
      // Metadata
      scoreBreakdown: {
        winRateContribution: (effectiveWinRate ?? 0) * this.winRateWeight,
        volumeContribution: normalizedVolume * this.volumeWeight,
        confidenceContribution: (confidenceScore ?? 0) * this.confidenceWeight
      }
    };
  }

  /**
   * Normalize volume using log scale
   * @param {number} volume - Volume in USD
   * @returns {number} - Normalized value 0-1
   */
  normalizeVolume(volume) {
    if (!volume || volume <= 0) return 0;
    // Log base 10, capped at $1M for normalization
    const logVolume = Math.log10(volume + 1);
    const maxLogVolume = Math.log10(1000000 + 1);  // 1M
    return Math.min(logVolume / maxLogVolume, 1);
  }

  /**
   * Determine reason tags based on account characteristics
   * @param {Object} metrics - Account metrics
   * @returns {Array} - Reason tags
   */
  determineReasonTags(metrics) {
    const tags = [];
    
    if (metrics.strictWinRate >= 0.6) tags.push('high_winrate');
    else if (metrics.strictWinRate >= 0.5) tags.push('medium_winrate');
    
    if (metrics.totalVolumeUsd >= 10000) tags.push('high_volume');
    else if (metrics.totalVolumeUsd >= 1000) tags.push('medium_volume');
    
    if (metrics.confidenceScore >= 0.5) tags.push('high_confidence');
    else if (metrics.confidenceScore >= 0.3) tags.push('medium_confidence');
    
    if (metrics.totalTrades >= 100) tags.push('active_trader');
    else if (metrics.totalTrades >= 20) tags.push('regular_trader');
    
    if (metrics.realizedPnl > 0) tags.push('profitable');
    else if (metrics.realizedPnl < 0) tags.push('loss_making');
    
    // Consistency: high win rate across multiple positions
    if (metrics.strictWinRate >= 0.55 && metrics.closedPositions >= 10) {
      tags.push('consistent_winner');
    }
    
    return tags;
  }

  /**
   * Score multiple accounts
   * @param {Array} metricsArray - Array of account metrics
   * @returns {Array} - Array of scored accounts
   */
  scoreBatch(metricsArray) {
    return metricsArray.map(m => this.score(m));
  }
}

module.exports = { AccountScorer };
