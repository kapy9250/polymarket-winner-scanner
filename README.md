# polymarket-winner-scanner

Internal project: scan high-winrate, high-volume Polymarket accounts and sync to PostgreSQL.

## Quick Start (One Command)

```bash
# Setup (first time only)
npm install
npm run db:migrate

# Run sync - discover traders and find top performers
npm run sync
```

That's it! The sync will:
1. Discover recent traders from Polymarket
2. Fetch their metrics (positions, activity, win rate)
3. Score and rank accounts
4. Store results in PostgreSQL

## CLI Options

```bash
npm run sync -- [options]

Options:
  --min-trades <n>       Minimum trade count (default: 50)
  --min-volume <v>       Minimum volume in USD (default: 5000)
  --min-winrate <r>      Minimum win rate 0-1 (default: 0.58)
  --min-confidence <r>   Minimum confidence score (default: 0.1)
  --top-n <n>            Number of top accounts to select (default: 100)
  --discover <n>         Discover N traders from trades (default: 100)
  --seed-file <path>     Load additional seed addresses from file
```

Example:
```bash
npm run sync -- --discover 500 --min-trades 30 --min-volume 1000 --min-winrate 0.55
```

## Expected Output

```
[Runner] Starting sync with config: { minTrades: 50, minVolumeUsd: 5000, ... }
[Runner] Created run: abc123-def456-...
[Runner] Loaded 0 seed addresses
[Runner] Discovering traders from 100 trades...
[Runner] Total addresses to process: 32
[Runner] Collecting metrics for addresses...
[Runner] Collected metrics for 28 accounts (4 failed)
[Runner] Scoring accounts...
[Runner] Selecting top accounts...
[Runner] Selected 5 accounts (from 8 passed filters)
[Runner] Storing results...

========== Sync Complete ==========
Run ID: abc123-def456-...
Accounts processed: 28
Accounts selected: 5
Accounts failed: 4
Average win rate: 62.5%
Average volume: $15234.50
Average score: 0.5823
====================================
```

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
  /closed-positions                     min_winrate        account_metrics_snapshot
  /activity                                                selected_accounts
```

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `runs` | Sync run metadata and status |
| `accounts` | Account master data with cumulative metrics |
| `account_metrics_snapshot` | Historical metrics per run |
| `selected_accounts` | Accounts that passed selection criteria |

### Query Examples

```sql
-- Get top accounts from latest run
SELECT * FROM v_top_accounts LIMIT 10;

-- Get selected accounts from a specific run
SELECT sa.*, a.strict_win_rate, a.total_volume_usd
FROM selected_accounts sa
JOIN accounts a ON sa.address = a.address
WHERE sa.run_id = '<run_id>'
ORDER BY sa.selection_score DESC;

-- View recent runs
SELECT * FROM v_recent_runs;
```

## Metrics

| Metric | Definition | Source |
|--------|------------|--------|
| strict_win_rate | wins / (wins + losses) - excludes neutral | /closed-positions |
| proxy_win_rate | estimated from cashPnl > 0 | /positions |
| total_trades | BUY + SELL transaction count | /activity |
| total_volume_usd | sum(usdcSize) | /activity |
| realized_pnl | sum(realizedPnl) | /positions |
| confidence_score | decided_positions / total_positions | calculated |
| composite_score | weighted score for ranking | calculated |

See [docs/metric-definition.md](docs/metric-definition.md) for detailed calculations.

## Configuration

Environment variables (`.env`):

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
| MIN_CONFIDENCE | 0.1 | Minimum confidence threshold |
| TOP_N | 100 | Max accounts to select |
| DISCOVER_TRADERS | 100 | Traders to discover per run |

## Project Structure

```
polymarket-winner-scanner/
├── db/migrations/          # SQL migrations
├── docs/
│   ├── data-source-report.md
│   ├── metric-definition.md
│   └── acceptance-report-template.md
├── scripts/
│   ├── migrate.js          # Migration runner
│   ├── test-collector.js
│   ├── test-scorer-selector.js
│   └── test-storage.js
├── src/
│   ├── db.js               # Database utilities
│   ├── runner.js           # Main CLI entry
│   ├── collector.js        # Polymarket API client
│   ├── scorer.js           # Metrics calculation
│   ├── selector.js         # Account filtering
│   └── storage.js          # Database operations
├── seed-addresses.txt      # Optional seed addresses
├── .env.example
├── package.json
└── README.md
```

## Testing

```bash
# Unit tests
npm run test:collector
npm run test:scorer
npm run test:storage

# Database reset
npm run db:reset
```

## Development Status

| Step | Description | Status |
|------|-------------|--------|
| 0 | Data source feasibility | ✅ Done |
| 1 | DB schema + migrations | ✅ Done |
| 2 | Collector module | ✅ Done |
| 3 | Scorer + Selector | ✅ Done |
| 4 | Storage + Runner integration | ✅ Done |
| 5 | CLI + documentation | ✅ Done |

## Error Handling

- **Partial failures**: Individual account failures don't block the entire run
- **Error summary**: All errors are categorized and stored in run stats
- **Retry logic**: API failures are retried with exponential backoff
- **Transaction isolation**: Each account upsert is a separate transaction

## Acceptance Report

After each sync run, an acceptance report can be generated using the template in `docs/acceptance-report-template.md`. The report includes:
- Run summary statistics
- Top selected accounts
- Error summary
- Configuration used

## License

MIT (Internal Project)
