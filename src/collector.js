/**
 * Collector Module - Polymarket Data API Client
 * 
 * Features:
 * - Rate limiting (150-200 req/10s)
 * - Exponential backoff on 429/5xx errors
 * - Pagination support
 * - Structured logging
 * 
 * Endpoints:
 * - GET /trades - Recent trades (discover trader addresses)
 * - GET /positions?user=<addr> - Account positions
 * - GET /closed-positions?user=<addr> - Closed positions for win rate
 * - GET /activity?user=<addr> - Account activity history
 */

const axios = require('axios');

// Rate limiter configuration
const RATE_LIMITS = {
  trades: { maxRequests: 200, windowMs: 10000 },     // 200 req/10s
  positions: { maxRequests: 150, windowMs: 10000 },   // 150 req/10s
  closedPositions: { maxRequests: 150, windowMs: 10000 },
  activity: { maxRequests: 150, windowMs: 10000 }
};

// Request queue for rate limiting
class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.queue = [];
    this.lastRequestTime = 0;
  }

  async acquire() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = this.windowMs / this.limit;

    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      await this.sleep(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Exponential backoff retry handler
class RetryHandler {
  constructor(maxRetries = 5, baseDelayMs = 1000) {
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
  }

  async executeWithRetry(fn, endpoint) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        // Check if retryable
        const status = error.response?.status;
        const isRetryable = !status || status === 429 || status >= 500;
        
        if (!isRetryable || attempt === this.maxRetries) {
          console.error(`[Collector] ${endpoint} failed after ${attempt + 1} attempts:`, error.message);
          throw error;
        }
        
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const delay = this.baseDelayMs * Math.pow(2, attempt);
        console.warn(`[Collector] ${endpoint} retry ${attempt + 1}/${this.maxRetries} after ${delay}ms (status: ${status})`);
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main Collector class
class PolymarketCollector {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://data-api.polymarket.com';
    this.rateLimiters = {
      trades: new RateLimiter(RATE_LIMITS.trades.maxRequests, RATE_LIMITS.trades.windowMs),
      positions: new RateLimiter(RATE_LIMITS.positions.maxRequests, RATE_LIMITS.positions.windowMs),
      closedPositions: new RateLimiter(RATE_LIMITS.closedPositions.maxRequests, RATE_LIMITS.closedPositions.windowMs),
      activity: new RateLimiter(RATE_LIMITS.activity.maxRequests, RATE_LIMITS.activity.windowMs)
    };
    this.retryHandler = new RetryHandler(options.maxRetries || 5, options.retryDelayMs || 1000);
    this.logger = options.logger || console;
  }

  /**
   * Fetch recent trades to discover trader addresses
   * @param {Object} options - Pagination options
   * @param {number} options.limit - Number of trades to fetch (max 1000)
   * @param {string} options.cursor - Pagination cursor
   * @returns {Object} - { trades, nextCursor, count }
   */
  async fetchTrades(options = {}) {
    const limit = Math.min(options.limit || 100, 1000);
    const cursor = options.cursor || '';
    
    const endpoint = 'trades';
    const rateLimiter = this.rateLimiter = this.rateLimiters.trades;
    
    await rateLimiter.acquire();
    
    const result = await this.retryHandler.executeWithRetry(async () => {
      const params = { limit };
      if (cursor) params.cursor = cursor;
      
      this.logger.info(`[Collector] Fetching ${endpoint} with params:`, params);
      
      const response = await axios.get(`${this.baseUrl}/${endpoint}`, { params });
      
      return {
        trades: response.data,
        nextCursor: response.data.next_cursor || null,
        count: response.data.count || response.data.length
      };
    }, endpoint);
    
    this.logger.info(`[Collector] Fetched ${result.count} trades, nextCursor: ${result.nextCursor}`);
    
    return result;
  }

  /**
   * Fetch positions for a specific address
   * @param {string} address - Trader address (0x...)
   * @param {Object} options - Query options
   * @returns {Array} - Position array
   */
  async fetchPositions(address, options = {}) {
    const endpoint = 'positions';
    const rateLimiter = this.rateLimiters.positions;
    
    await rateLimiter.acquire();
    
    const result = await this.retryHandler.executeWithRetry(async () => {
      const params = { user: address };
      if (options.limit) params.limit = options.limit;
      
      this.logger.info(`[Collector] Fetching positions for ${address}`);
      
      const response = await axios.get(`${this.baseUrl}/${endpoint}`, { params });
      
      return response.data;
    }, `${endpoint}:${address}`);
    
    this.logger.info(`[Collector] Got ${result.length} positions for ${address}`);
    
    return result;
  }

  /**
   * Fetch closed positions for a specific address (for strict win rate)
   * @param {string} address - Trader address (0x...)
   * @param {Object} options - Query options
   * @param {number} options.windowDays - Filter to last N days (optional)
   * @returns {Array} - Closed position array
   */
  async fetchClosedPositions(address, options = {}) {
    const endpoint = 'closed-positions';
    const rateLimiter = this.rateLimiters.closedPositions;
    
    // Calculate timestamp filter if windowDays is specified
    let timeFilter = null;
    if (options.windowDays) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const sinceSeconds = nowSeconds - (options.windowDays * 24 * 60 * 60);
      timeFilter = sinceSeconds;
    }
    
    await rateLimiter.acquire();
    
    const result = await this.retryHandler.executeWithRetry(async () => {
      const params = { user: address };
      if (options.limit) params.limit = options.limit;
      if (timeFilter) params.after = timeFilter;
      
      this.logger.info(`[Collector] Fetching closed positions for ${address}${timeFilter ? ` (last ${options.windowDays}d)` : ''}`);
      
      const response = await axios.get(`${this.baseUrl}/${endpoint}`, { params });
      
      return response.data;
    }, `${endpoint}:${address}`);
    
    this.logger.info(`[Collector] Got ${result.length} closed positions for ${address}${timeFilter ? ` (filtered to last ${options.windowDays}d)` : ''}`);
    
    return result;
  }

  /**
   * Fetch activity for a specific address
   * @param {string} address - Trader address (0x...)
   * @param {Object} options - Query options (limit, before, after, windowDays)
   * @param {number} options.windowDays - Filter to last N days (optional)
   * @returns {Array} - Activity array
   */
  async fetchActivity(address, options = {}) {
    const endpoint = 'activity';
    const rateLimiter = this.rateLimiters.activity;
    
    // Calculate timestamp filter if windowDays is specified
    let timeFilter = null;
    if (options.windowDays) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const sinceSeconds = nowSeconds - (options.windowDays * 24 * 60 * 60);
      timeFilter = sinceSeconds;
    }
    
    await rateLimiter.acquire();
    
    const result = await this.retryHandler.executeWithRetry(async () => {
      const params = { user: address };
      if (options.limit) params.limit = options.limit;
      if (options.before) params.before = options.before;
      if (options.after) params.after = options.after;
      if (timeFilter) params.after = timeFilter;
      
      this.logger.info(`[Collector] Fetching activity for ${address}${timeFilter ? ` (last ${options.windowDays}d)` : ''}`);
      
      const response = await axios.get(`${this.baseUrl}/${endpoint}`, { params });
      
      return response.data;
    }, `${endpoint}:${address}`);
    
    this.logger.info(`[Collector] Got ${result.length} activity records for ${address}${timeFilter ? ` (filtered to last ${options.windowDays}d)` : ''}`);
    
    return result;
  }

  /**
   * Discover trader addresses from recent trades
   * @param {number} numTrades - Number of trades to scan
   * @returns {Set} - Set of unique trader addresses
   */
  async discoverTradersFromTrades(numTrades = 1000) {
    const traders = new Set();
    let cursor = '';
    let fetched = 0;
    
    this.logger.info(`[Collector] Discovering traders from ${numTrades} trades...`);
    
    while (fetched < numTrades) {
      const batchSize = Math.min(1000, numTrades - fetched);
      const result = await this.fetchTrades({ limit: batchSize, cursor });
      
      for (const trade of result.trades) {
        if (trade.proxyWallet) {
          traders.add(trade.proxyWallet);
        }
      }
      
      fetched += result.count;
      
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    
    this.logger.info(`[Collector] Discovered ${traders.size} unique traders`);
    
    return traders;
  }

  /**
   * Fetch complete metrics for an address
   * Uses Promise.allSettled to support partial success
   * @param {string} address - Trader address
   * @param {Object} options - Options including windowDays for time filtering
   * @returns {Object} - Complete metrics (may have partial data)
   */
  async fetchAccountMetrics(address, options = {}) {
    const windowDays = options.windowDays || null;
    this.logger.info(`[Collector] Fetching complete metrics for ${address}${windowDays ? ` (last ${windowDays}d)` : ''}`);
    
    // Use Promise.allSettled to support partial success
    const results = await Promise.allSettled([
      this.fetchPositions(address),
      this.fetchClosedPositions(address, { windowDays }),
      this.fetchActivity(address, { limit: 100, windowDays })
    ]);
    
    // Extract results, handling partial failures
    const positions = results[0].status === 'fulfilled' ? results[0].value : [];
    const closedPositions = results[1].status === 'fulfilled' ? results[1].value : [];
    const activity = results[2].status === 'fulfilled' ? results[2].value : [];
    
    // Log any failures
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const endpoints = ['positions', 'closedPositions', 'activity'];
        this.logger.warn(`[Collector] ${endpoints[i]} failed for ${address}: ${r.reason.message}`);
      }
    });
    
    // Calculate metrics
    const metrics = this.calculateMetrics(address, positions, closedPositions, activity);
    
    // Add partial success flag
    metrics._partialSuccess = results.some(r => r.status === 'rejected');
    metrics._failedEndpoints = results
      .map((r, i) => r.status === 'rejected' ? ['positions', 'closedPositions', 'activity'][i] : null)
      .filter(Boolean);
    
    this.logger.info(`[Collector] Metrics calculated for ${address}: winRate=${metrics.strictWinRate}, volume=${metrics.totalVolumeUsd}`);
    
    return metrics;
  }

  /**
   * Calculate account metrics from raw data
   * 
   * Win rate calculation rules (per data-source-report):
   * - realizedPnl > 0 = WIN
   * - realizedPnl < 0 = LOSS  
   * - realizedPnl == 0 = NEUTRAL (not counted in numerator or denominator)
   */
  calculateMetrics(address, positions, closedPositions, activity) {
    // From closed positions - strict win rate
    // Exclude neutral (realizedPnl == 0) from calculation
    const wins = closedPositions.filter(p => p.realizedPnl > 0).length;
    const losses = closedPositions.filter(p => p.realizedPnl < 0).length;
    const neutral = closedPositions.filter(p => p.realizedPnl === 0).length;
    const totalClosed = wins + losses;  // Exclude neutral from denominator
    
    const strictWinRate = totalClosed > 0 ? wins / totalClosed : null;
    const confidenceScore = positions.length > 0 ? totalClosed / positions.length : 0;
    
    // From activity - total volume
    const totalVolumeUsd = activity.reduce((sum, a) => sum + (a.usdcSize || 0), 0);
    const totalTrades = activity.length;
    
    // From positions - realized PnL
    const realizedPnl = positions.reduce((sum, p) => sum + (p.realizedPnl || 0), 0);
    
    // Proxy win rate from current positions
    const proxyWins = positions.filter(p => p.cashPnl > 0).length;
    const proxyWinRate = positions.length > 0 ? proxyWins / positions.length : null;
    
    return {
      address,
      totalTrades,
      totalVolumeUsd,
      realizedPnl,
      strictWinRate,
      proxyWinRate,
      confidenceScore,
      winCount: wins,
      lossCount: losses,
      closedPositions: totalClosed,
      positionsCount: positions.length,
      activityCount: activity.length,
      // Raw data for debugging
      _positions: positions,
      _closedPositions: closedPositions,
      _activity: activity
    };
  }
}

module.exports = { PolymarketCollector, RateLimiter, RetryHandler };
