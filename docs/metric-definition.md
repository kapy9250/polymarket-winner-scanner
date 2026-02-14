# Metric Definitions

This document defines the calculation rules for all metrics used in polymarket-winner-scanner.

## Win Rate Metrics

### strict_win_rate

**Definition**: The ratio of winning closed positions to total decided closed positions.

**Calculation**:
```
strict_win_rate = wins / (wins + losses)
```

Where:
- `wins` = count of closed positions where `realizedPnl > 0`
- `losses` = count of closed positions where `realizedPnl < 0`
- **Neutral positions** (`realizedPnl === 0`) are EXCLUDED from both numerator and denominator

**Data Source**: `/closed-positions` API endpoint

**Example**:
- Account has 10 closed positions
- 6 positions with `realizedPnl > 0` (wins)
- 3 positions with `realizedPnl < 0` (losses)
- 1 position with `realizedPnl === 0` (neutral, excluded)
- `strict_win_rate = 6 / (6 + 3) = 0.667` (66.7%)

### proxy_win_rate

**Definition**: Estimated win rate based on current open positions' unrealized PnL.

**Calculation**:
```
proxy_win_rate = proxy_wins / total_positions
```

Where:
- `proxy_wins` = count of open positions where `cashPnl > 0`
- `total_positions` = total count of open positions

**Data Source**: `/positions` API endpoint

**Note**: This is an estimation for accounts with insufficient closed position data.

---

## Confidence Score

### confidence_score

**Definition**: Ratio of decided (closed) positions to total positions, indicating data reliability.

**Calculation**:
```
confidence_score = decided_positions / total_positions
```

Where:
- `decided_positions` = `wins + losses` (excludes neutral positions)
- `total_positions` = all positions (open + closed)

**Data Sources**: `/positions` and `/closed-positions` API endpoints

**Interpretation**:
- High confidence (≥ 0.5): Account has substantial historical data
- Medium confidence (0.3-0.5): Mix of historical and active positions
- Low confidence (< 0.3): Mostly active positions, limited track record

**Important**: This calculation EXCLUDES neutral positions (`realizedPnl === 0`) from the numerator, consistent with `strict_win_rate` calculation.

---

## Volume Metrics

### total_volume_usd

**Definition**: Total trading volume in USDC across all transactions.

**Calculation**:
```
total_volume_usd = sum(usdcSize) for all activities
```

**Data Source**: `/activity` API endpoint

### total_trades

**Definition**: Total number of trading transactions (BUY + SELL).

**Calculation**:
```
total_trades = count of activity records
```

**Data Source**: `/activity` API endpoint

---

## PnL Metrics

### realized_pnl

**Definition**: Total realized profit/loss across all positions.

**Calculation**:
```
realized_pnl = sum(realizedPnl) for all positions
```

**Data Source**: `/positions` API endpoint

---

## Composite Score

### composite_score

**Definition**: Weighted combination of key metrics for ranking accounts.

**Calculation**:
```
composite_score = (win_rate_weight × effective_win_rate) +
                  (volume_weight × normalized_volume) +
                  (confidence_weight × confidence_score)
```

Default weights:
- `win_rate_weight` = 0.5
- `volume_weight` = 0.3
- `confidence_weight` = 0.2

Where:
- `effective_win_rate` = `strict_win_rate` if available, otherwise `proxy_win_rate`
- `normalized_volume` = `log10(total_volume_usd + 1) / log10(1,000,001)` (capped at $1M)

---

## Selection Thresholds

Default thresholds for account selection:

| Metric | Default | Description |
|--------|---------|-------------|
| min_trades | 50 | Minimum number of trades |
| min_volume_usd | 5000 | Minimum volume in USD |
| min_win_rate | 0.58 | Minimum win rate (58%) |
| min_confidence | 0.1 | Minimum confidence score |
| top_n | 100 | Number of top accounts to select |

**Important**: If both `strict_win_rate` and `proxy_win_rate` are `null`, the account does NOT pass the `min_win_rate` threshold, regardless of the threshold value.

---

## Reason Tags

Accounts are tagged based on their characteristics:

| Tag | Criteria |
|-----|----------|
| `high_winrate` | `strict_win_rate >= 0.6` |
| `medium_winrate` | `strict_win_rate >= 0.5` |
| `high_volume` | `total_volume_usd >= 10000` |
| `medium_volume` | `total_volume_usd >= 1000` |
| `high_confidence` | `confidence_score >= 0.5` |
| `medium_confidence` | `confidence_score >= 0.3` |
| `active_trader` | `total_trades >= 100` |
| `regular_trader` | `total_trades >= 20` |
| `profitable` | `realized_pnl > 0` |
| `loss_making` | `realized_pnl < 0` |
| `consistent_winner` | `strict_win_rate >= 0.55` AND `closed_positions >= 10` |
