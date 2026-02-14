-- Migration: 001_init
-- Description: Initial schema for polymarket-winner-scanner
-- Date: 2026-02-14

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Table: runs
-- Purpose: Track each sync run's metadata and status
-- ============================================================================
CREATE TABLE IF NOT EXISTS runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    config JSONB,  -- Store run parameters (min_trades, min_volume, min_winrate, etc.)
    error_message TEXT,
    stats JSONB,   -- Summary stats: accounts_processed, accounts_selected, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX idx_runs_status ON runs(status);

-- ============================================================================
-- Table: accounts
-- Purpose: Account master data with cumulative metrics
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounts (
    address VARCHAR(42) PRIMARY KEY,  -- Ethereum address format (0x...)
    
    -- Metadata
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sync_run_id UUID REFERENCES runs(id),
    
    -- Cumulative metrics (updated on each sync)
    total_trades INTEGER NOT NULL DEFAULT 0,
    total_volume_usd DECIMAL(20, 4) NOT NULL DEFAULT 0,
    total_positions INTEGER NOT NULL DEFAULT 0,
    closed_positions INTEGER NOT NULL DEFAULT 0,
    win_count INTEGER NOT NULL DEFAULT 0,
    loss_count INTEGER NOT NULL DEFAULT 0,
    
    -- Derived metrics
    strict_win_rate DECIMAL(6, 4),  -- wins / (wins + losses) for closed positions
    proxy_win_rate DECIMAL(6, 4),   -- estimated from cashPnl
    realized_pnl DECIMAL(20, 4) NOT NULL DEFAULT 0,
    confidence_score DECIMAL(6, 4), -- closed_positions / total_positions
    
    -- Source tracking
    discovery_method VARCHAR(50),  -- 'trades_stream', 'seed_list', 'market_scrape'
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_accounts_strict_win_rate ON accounts(strict_win_rate DESC) WHERE strict_win_rate IS NOT NULL;
CREATE INDEX idx_accounts_total_volume ON accounts(total_volume_usd DESC);
CREATE INDEX idx_accounts_last_seen ON accounts(last_seen_at DESC);

-- ============================================================================
-- Table: account_metrics_snapshot
-- Purpose: Snapshot of account metrics at each run (for historical tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS account_metrics_snapshot (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    address VARCHAR(42) NOT NULL REFERENCES accounts(address),
    
    -- Snapshot metrics
    strict_win_rate DECIMAL(6, 4),
    proxy_win_rate DECIMAL(6, 4),
    total_trades INTEGER NOT NULL DEFAULT 0,
    total_volume_usd DECIMAL(20, 4) NOT NULL DEFAULT 0,
    realized_pnl DECIMAL(20, 4) NOT NULL DEFAULT 0,
    win_count INTEGER NOT NULL DEFAULT 0,
    loss_count INTEGER NOT NULL DEFAULT 0,
    closed_positions INTEGER NOT NULL DEFAULT 0,
    confidence_score DECIMAL(6, 4),
    
    -- Composite score (configurable formula)
    score DECIMAL(10, 4),
    
    -- Raw API response counts (for debugging/replay)
    positions_count INTEGER,
    activity_count INTEGER,
    trades_count INTEGER,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(run_id, address)
);

CREATE INDEX idx_snapshot_run_id ON account_metrics_snapshot(run_id);
CREATE INDEX idx_snapshot_address ON account_metrics_snapshot(address);
CREATE INDEX idx_snapshot_score ON account_metrics_snapshot(score DESC);

-- ============================================================================
-- Table: selected_accounts
-- Purpose: Store accounts that passed selection criteria for each run
-- ============================================================================
CREATE TABLE IF NOT EXISTS selected_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    address VARCHAR(42) NOT NULL REFERENCES accounts(address),
    
    -- Selection metadata
    reason_tags TEXT[],  -- ['high_winrate', 'high_volume', 'consistent']
    selection_score DECIMAL(10, 4),
    
    -- Metrics at selection time
    strict_win_rate DECIMAL(6, 4),
    total_trades INTEGER,
    total_volume_usd DECIMAL(20, 4),
    realized_pnl DECIMAL(20, 4),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(run_id, address)
);

CREATE INDEX idx_selected_run_id ON selected_accounts(run_id);
CREATE INDEX idx_selected_address ON selected_accounts(address);

-- ============================================================================
-- Table: raw_trades (optional - for storing raw trade data)
-- Purpose: Store raw trade data for deeper analysis
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) NOT NULL REFERENCES accounts(address),
    
    -- Trade data from API
    condition_id VARCHAR(100),
    market_title TEXT,
    outcome VARCHAR(50),
    side VARCHAR(10) CHECK (side IN ('BUY', 'SELL')),
    size DECIMAL(20, 8),
    price DECIMAL(10, 6),
    usdc_size DECIMAL(20, 4),
    timestamp TIMESTAMPTZ,
    
    -- Tracking
    run_id UUID REFERENCES runs(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_raw_trades_address ON raw_trades(address);
CREATE INDEX idx_raw_trades_condition ON raw_trades(condition_id);
CREATE INDEX idx_raw_trades_timestamp ON raw_trades(timestamp DESC);

-- ============================================================================
-- Table: raw_positions (optional - for storing position snapshots)
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) NOT NULL REFERENCES accounts(address),
    
    -- Position data from API
    condition_id VARCHAR(100),
    outcome VARCHAR(50),
    size DECIMAL(20, 8),
    avg_price DECIMAL(10, 6),
    current_value DECIMAL(20, 4),
    cash_pnl DECIMAL(20, 4),
    realized_pnl DECIMAL(20, 4),
    cur_price DECIMAL(10, 6),
    
    -- Settlement tracking
    is_closed BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    
    -- Tracking
    run_id UUID REFERENCES runs(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_raw_positions_address ON raw_positions(address);
CREATE INDEX idx_raw_positions_condition ON raw_positions(condition_id);
CREATE INDEX idx_raw_positions_closed ON raw_positions(is_closed);

-- ============================================================================
-- Seed addresses table (for managing seed address lists)
-- ============================================================================
CREATE TABLE IF NOT EXISTS seed_addresses (
    address VARCHAR(42) PRIMARY KEY,
    source VARCHAR(100),  -- 'manual', 'community', 'api_discovered'
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Views
-- ============================================================================

-- View: Top accounts by win rate (with minimum thresholds)
CREATE OR REPLACE VIEW v_top_accounts AS
SELECT 
    address,
    strict_win_rate,
    proxy_win_rate,
    total_trades,
    total_volume_usd,
    realized_pnl,
    win_count,
    loss_count,
    closed_positions,
    confidence_score,
    last_seen_at
FROM accounts
WHERE 
    total_trades >= 10
    AND total_volume_usd >= 100
    AND strict_win_rate IS NOT NULL
ORDER BY strict_win_rate DESC, total_volume_usd DESC;

-- View: Recent sync runs
CREATE OR REPLACE VIEW v_recent_runs AS
SELECT 
    id,
    started_at,
    completed_at,
    status,
    stats->>'accounts_processed' AS accounts_processed,
    stats->>'accounts_selected' AS accounts_selected,
    EXTRACT(EPOCH FROM (completed_at - started_at)) AS duration_seconds
FROM runs
ORDER BY started_at DESC
LIMIT 20;

-- ============================================================================
-- Migration tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(20) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('001');
