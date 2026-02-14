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

# Run sync
npm run sync -- --min-trades 50 --min-volume 5000 --min-winrate 0.58
```

## Development Status

| Step | Description | Status |
|------|-------------|--------|
| 0 | Data source feasibility | ✅ Done |
| 1 | DB schema + migrations | 🚧 In Progress |
| 2 | Collector module | ⏳ Pending |
| 3 | Scorer module | ⏳ Pending |
| 4 | Selector module | ⏳ Pending |
| 5 | CLI runner + testing | ⏳ Pending |

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

Environment variables (see `.env.example`):

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

## Project Structure

```
polymarket-winner-scanner/
├── db/
│   └── migrations/       # SQL migrations
├── docs/
│   └── data-source-report.md
├── scripts/
│   └── migrate.js        # Migration runner
├── src/
│   ├── db.js             # Database utilities
│   ├── runner.js         # Main entry point
│   ├── collector.js      # (TODO) API data collection
│   ├── scorer.js         # (TODO) Metrics calculation
│   └── selector.js       # (TODO) Account selection
├── .env.example
├── package.json
└── README.md
```
