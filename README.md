# polymarket-winner-scanner

Internal project: scan high-winrate, high-volume Polymarket accounts and sync to PostgreSQL.

## Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Collector  │───▶│   Scorer    │───▶│  Selector   │───▶│   Storage   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
  Polymarket API    Calculate metrics   Apply filters      PostgreSQL
  /trades           win_rate, volume    min_trades,        runs
  /positions        pnl, score          min_volume,        accounts
  /activity                             min_winrate        account_metrics_snapshot
                                                          selected_accounts
```

## Database Schema

### Core Tables

- **runs**: Track each sync run's metadata and status
- **accounts**: Account master data with cumulative metrics
- **account_metrics_snapshot**: Snapshot of account metrics at each run
- **selected_accounts**: Accounts that passed selection criteria

### Optional Tables

- **raw_trades**: Store raw trade data for deeper analysis
- **raw_positions**: Store position snapshots

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Run migrations (creates database if needed)
npm run db:migrate

# Run sync with default settings
npm run sync

# Or run sync with custom thresholds
npm run sync -- --min-trades 100 --min-volume 10000 --min-winrate 0.6 --top-n 50

# Run sync with automatic acceptance report generation
npm run sync:report -- --min-trades 50 --min-volume 5000

# Generate report for a specific run
npm run report -- <run-id>

# Or generate report for the latest run
npm run report
```

## Development Status

| Step | Description | Status |
|------|-------------|--------|
| 0 | Data source feasibility | ✅ Done |
| 1 | DB schema + migrations | ✅ Done |
| 2 | Collector module | ✅ Done |
| 3 | Scorer module | ✅ Done |
| 4 | Selector module | ✅ Done |
| 5 | Storage module + integration | ✅ Done |
| 6 | One-click sync + acceptance reports | ✅ Done |

**Project Status: ✅ Complete**

## Metrics

| Metric | Definition | Source |
|--------|------------|--------|
| strict_win_rate | wins / (wins + losses) for closed positions | /closed-positions |
| proxy_win_rate | estimated from cashPnl > 0 | /positions + /activity |
| total_trades | BUY + SELL transaction count | /activity |
| total_volume_usd | sum(usdcSize) | /activity |
| realized_pnl | sum(realizedPnl) | /positions |
| confidence_score | closed_positions / total_positions | calculated |

## Configuration

Environment variables (see `.env.example` for full list):

| Variable | Default | Description |
|----------|---------|-------------|
| DB_HOST | 192.168.26.208 | PostgreSQL host |
| DB_PORT | 5432 | PostgreSQL port |
| DB_USER | clawdbot | Database user |
| DB_PASSWORD | - | Database password |
| DB_NAME | polymarket_scanner | Database name |
| MIN_TRADES | 50 | Minimum trades threshold |
| MIN_VOLUME_USD | 5000 | Minimum volume threshold |
| MIN_WIN_RATE | 0.58 | Minimum win rate threshold |
| MIN_CONFIDENCE | 0.1 | Minimum confidence score |
| TOP_N | 100 | Number of top accounts to select |
| DISCOVER_TRADERS | 100 | Discover N traders from recent trades |
| MAX_RETRIES | 5 | API retry attempts |
| RETRY_DELAY_MS | 1000 | Base retry delay in milliseconds |

### Command Line Arguments

Override environment variables at runtime:

```bash
# Basic usage with custom thresholds
npm run sync -- --min-trades 100 --min-volume 10000 --min-winrate 0.6 --top-n 50

# Discover 200 traders and seed with addresses file
npm run sync -- --discover 200 --seed-file ./seed_addresses.txt

# Use only seed addresses (no discovery)
npm run sync -- --discover 0
```

## One-Click Sync Script

The scanner includes a complete one-click sync solution:

### Basic Sync
```bash
npm run sync
```
Runs the full pipeline:
1. Loads seed addresses from database/file
2. Discovers new traders from recent trades (optional)
3. Collects metrics via Polymarket API
4. Scores accounts based on win rate, volume, confidence
5. Selects top accounts meeting thresholds
6. Stores results to PostgreSQL
7. Outputs summary statistics

### Sync with Acceptance Report
```bash
npm run sync:report -- --min-trades 50 --min-volume 5000
```
Runs the sync and automatically generates a detailed acceptance report in Markdown format, saved to `./reports/` directory.

### Report Generation
```bash
# Generate report for latest run
npm run report

# Generate report for specific run
npm run report -- 123e4567-e89b-12d3-a456-426614174000
```

Reports include:
- Run metadata and configuration
- Performance metrics and statistics
- Top selected accounts with scores
- Error summary and data quality assessment
- Recommendations for next run
- Acceptance checklist

## Testing

```bash
# Run all tests
npm test

# Run individual component tests
npm run test:collector
npm run test:scorer
npm run test:storage

# Run integration test
npm run test:integration
```

## Database Operations

```bash
# Run migrations
npm run db:migrate

# Reset database (warning: drops all data)
npm run db:reset

## Project Structure

```
polymarket-winner-scanner/
├── db/
│   └── migrations/               # SQL migrations (001_init.sql)
├── docs/
│   ├── data-source-report.md     # API feasibility analysis
│   └── metric-definition.md      # Metric calculation definitions
├── scripts/
│   ├── migrate.js                # Migration runner
│   ├── generate-report.js        # Acceptance report generator
│   ├── run-with-report.js        # Sync with automatic report
│   ├── test-collector.js         # Collector module tests
│   ├── test-scorer-selector.js   # Scorer/selector tests
│   ├── test-storage.js           # Storage module tests
│   └── test-integration.js       # End-to-end integration test
├── src/
│   ├── collector.js              # Polymarket API client with rate limiting
│   ├── scorer.js                 # Account scoring with composite formula
│   ├── selector.js               # Threshold filtering and top-N selection
│   ├── storage.js                # Database operations and run management
│   ├── runner.js                 # Main sync pipeline
│   └── db.js                     # PostgreSQL connection utilities
├── .env.example                  # Environment configuration template
├── .gitignore
├── USAGE.md                      # Detailed usage guide
├── acceptance-report-template.md # Report template
├── package.json                  # Dependencies and scripts
└── README.md                     # This file
```
