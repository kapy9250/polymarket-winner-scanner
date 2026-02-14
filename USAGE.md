# Polymarket Winner Scanner - Usage Guide

## Quick Start

### 1. Setup Environment
```bash
# Clone the repository
git clone https://github.com/kapy9250/polymarket-winner-scanner.git
cd polymarket-winner-scanner

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your database credentials
# DB_HOST, DB_USER, DB_PASSWORD, etc.
```

### 2. Initialize Database
```bash
# Reset and create database (use with caution - will drop existing data)
npm run db:reset

# Or run migrations only
npm run db:migrate
```

### 3. Run Scanner
```bash
# Run with default settings
npm run sync

# Or directly
node src/runner.js
```

## Configuration

### Environment Variables (.env)
| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | 192.168.26.208 | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_USER` | clawdbot | Database user |
| `DB_PASSWORD` | ClawdBot_DB_2024 | Database password |
| `DB_NAME` | polymarket_scanner | Database name |
| `MIN_TRADES` | 50 | Minimum number of trades |
| `MIN_VOLUME_USD` | 5000 | Minimum volume in USD |
| `MIN_WIN_RATE` | 0.58 | Minimum win rate (58%) |
| `MIN_CONFIDENCE` | 0.1 | Minimum confidence score |
| `TOP_N` | 100 | Number of top accounts to select |
| `DISCOVER_TRADERS` | 100 | Discover N traders from recent trades |
| `MAX_RETRIES` | 5 | API retry attempts |
| `RETRY_DELAY_MS` | 1000 | Base retry delay in milliseconds |
| `WIN_RATE_WEIGHT` | 0.5 | Scoring weight for win rate |
| `VOLUME_WEIGHT` | 0.3 | Scoring weight for volume |
| `CONFIDENCE_WEIGHT` | 0.2 | Scoring weight for confidence |

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

## Workflow

### Full Pipeline
The scanner executes the following steps automatically:

1. **Create Run** - Start tracking with unique run ID
2. **Load Addresses** - From database seed table and/or seed file
3. **Discover Traders** - Optional: scan recent trades for new addresses
4. **Collect Metrics** - Fetch positions, activity, closed positions via Polymarket API
5. **Score Accounts** - Calculate composite score based on win rate, volume, confidence
6. **Select Top Accounts** - Apply thresholds and select top N by score
7. **Store Results** - Update accounts, create snapshots, record selections
8. **Complete Run** - Generate statistics and error summary

### Output Example
```
[Runner] Starting sync with config: { minTrades: 50, minVolumeUsd: 5000, ... }
[Runner] Created run: 123e4567-e89b-12d3-a456-426614174000
[Runner] Loaded 50 seed addresses
[Runner] Discovering traders from 100 trades...
[Runner] Total addresses to process: 132
[Runner] Collecting metrics for addresses...
[Runner] Collected metrics for 125 accounts (7 failed)
[Runner] Scoring accounts...
[Runner] Selecting top accounts...
[Runner] Selected 35 accounts (from 80 passed filters)
[Runner] Storing results...

========== Sync Complete ==========
Run ID: 123e4567-e89b-12d3-a456-426614174000
Accounts processed: 125
Accounts selected: 35
Accounts failed: 7
Average win rate: 64.2%
Average volume: $12,450.75
Average score: 0.6723

Error Summary:
  - api_failure: 5
  - storage_failure: 2
====================================
```

## Database Schema

### Key Tables
- `runs` - Sync run metadata and statistics
- `accounts` - Account master data with cumulative metrics
- `account_metrics_snapshot` - Historical metrics per run
- `selected_accounts` - Selected accounts per run
- `seed_addresses` - Seed address pool for scanning
- `raw_trades`, `raw_positions` - Optional raw data storage

### Useful Queries
```sql
-- Get latest run statistics
SELECT * FROM runs ORDER BY started_at DESC LIMIT 1;

-- View selected accounts from latest run
SELECT sa.address, sa.selection_score, sa.reason_tags, 
       a.strict_win_rate, a.total_volume_usd, a.total_trades
FROM selected_accounts sa
JOIN accounts a ON sa.address = a.address
WHERE sa.run_id = (SELECT id FROM runs ORDER BY started_at DESC LIMIT 1)
ORDER BY sa.selection_score DESC;

-- View top accounts by win rate
SELECT * FROM v_top_accounts LIMIT 10;

-- View recent sync performance
SELECT * FROM v_recent_runs;
```

## Monitoring and Maintenance

### Log Files
The scanner logs to stdout. For production:
```bash
# Redirect to file
npm run sync > scanner.log 2>&1

# Or use a process manager like PM2
pm2 start npm --name "polymarket-scanner" -- run sync
```

### Error Handling
- **Partial failures** are expected and handled gracefully
- Failed accounts are logged and included in error summary
- Run continues with remaining accounts
- Error summary is stored in `runs.stats.error_summary`

### Performance Considerations
- API rate limiting: 150-200 requests per 10 seconds per endpoint
- Default settings process ~100-200 accounts per run
- Database connections are pooled and reused
- Each account upsert is a separate transaction for resilience

## Integration Examples

### Cron Job (Daily Scan)
```bash
# Add to crontab - run daily at 2 AM
0 2 * * * cd /path/to/polymarket-winner-scanner && npm run sync >> /var/log/polymarket-scanner.log 2>&1
```

### Docker Container
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["npm", "run", "sync"]
```

### CI/CD Pipeline
```yaml
# Example GitHub Actions workflow
name: Daily Scanner Run
on:
  schedule:
    - cron: '0 2 * * *'
jobs:
  run-scanner:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm ci
      - name: Run scanner
        run: npm run sync
        env:
          DB_HOST: ${{ secrets.DB_HOST }}
          DB_USER: ${{ secrets.DB_USER }}
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
```

## Troubleshooting

### Common Issues
1. **Database connection failed**
   - Check `.env` credentials
   - Verify PostgreSQL is running
   - Ensure network access to database host

2. **API rate limiting errors**
   - Reduce number of addresses processed
   - Increase `RETRY_DELAY_MS`
   - Process in smaller batches

3. **No accounts selected**
   - Adjust thresholds (`MIN_TRADES`, `MIN_WIN_RATE`)
   - Increase `DISCOVER_TRADERS`
   - Add seed addresses to `seed_addresses` table

### Debug Mode
```bash
# Add debug logging
LOG_LEVEL=debug npm run sync

# Or trace specific modules
DEBUG=collector,scorer npm run sync
```

## Support
- Documentation: [docs/](docs/) directory
- Metric Definitions: [docs/metric-definition.md](docs/metric-definition.md)
- Data Source Report: [docs/data-source-report.md](docs/data-source-report.md)
- Issues: GitHub Issues page