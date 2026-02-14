# Polymarket Data Source Feasibility Report

**Step 0 - P0 闸门产出**  
**Author:** Sockey  
**Date:** 2026-02-14

---

## 1. 核心发现

### 1.1 API 可用性 ✅

| API 端点 | 认证要求 | 限流 | 可用字段 |
|---------|---------|------|---------|
| `GET /trades` | 无需认证 | 200 req/10s | proxyWallet, side, size, price, timestamp, title, outcome, conditionId |
| `GET /positions?user=<addr>` | 无需认证 | 150 req/10s | proxyWallet, size, avgPrice, currentValue, cashPnl, realizedPnl, outcome, conditionId |
| `GET /activity?user=<addr>` | 无需认证 | 150 req/10s | proxyWallet, timestamp, type, size, usdcSize, price, side, outcome |
| `GET /closed-positions` | 无需认证 | 150 req/10s | 同 positions，增加 resolvedAt |

### 1.2 胜率计算可行性

**可获取字段 (proxy_win_rate 支撑)**:
- `side` (BUY/SELL) - 判断交易方向
- `size` - 交易数量
- `price` - 成交价格
- `outcome` - 交易结果 (Yes/No)
- `cashPnl` / `realizedPnl` - 直接的盈亏数据
- `closed-positions` - 已结算头寸，可严格判定 win/loss

**strict_win_rate 计算路径**:
1. 调用 `/closed-positions?user=<addr>` 获取已结算头寸
2. 对每个 position: `outcome == winner ? win : loss`
3. `strict_win_rate = wins / (wins + losses)`

**proxy_win_rate 计算路径**:
1. 调用 `/positions?user=<addr>` 获取当前持仓
2. 结合 `cashPnl` + `avgPrice` + `curPrice` 估算未实现盈亏
3. 配合历史 `activity` 计算已实现盈亏

### 1.3 关键限制 ⚠️

**`/closed-positions` 端点验证** ✅
```
curl "https://data-api.polymarket.com/closed-positions?user=0xd0d6053c..."
```
返回已结算头寸，包含 `realizedPnl` 字段，可直接用于 strict_win_rate 计算。

**无公开的 "top traders" 列表**:
- Polymarket 没有暴露 "所有交易者" 或 "热门交易者" API
- 需要自行收集交易者地址:
  - 方案A: 从 `/trades` 实时流中提取 proxyWallet (需要持续监听)
  - 方案B: 从热门 market 的历史交易中提取
  - 方案C: 使用种子地址列表开始 (如已知活跃交易者)

---

## 2. 限流实测

| 端点 | 官方限制 | 实测结果 |
|------|---------|---------|
| `/trades` | 200/10s | ✅ 未触发限流 |
| `/positions` | 150/10s | ✅ 正常返回 |
| `/activity` | 150/10s | ✅ 正常返回 |

**建议**:
- 批量采集时每账户请求间隔 > 100ms (10 req/s)
- 使用指数退避处理 429/5xx 错误

---

## 3. 字段映射表

### 3.1 /trades 响应字段

| 字段 | 类型 | 用于指标 | 备注 |
|------|------|---------|------|
| proxyWallet | string | 账户标识 | 目标地址 |
| side | string | 交易方向 | BUY/SELL |
| size | number | 交易量 | shares 数量 |
| price | number | 交易价格 | USDC per share |
| timestamp | number | 时间序列 | Unix timestamp |
| title | string | 市场信息 | market 名称 |
| outcome | string | 交易结果 | Yes/No |
| conditionId | string | 市场标识 | 用于关联市场结果 |

### 3.2 /positions 响应字段

| 字段 | 类型 | 用于指标 | 备注 |
|------|------|---------|------|
| proxyWallet | string | 账户标识 | |
| size | number | 持仓量 | |
| avgPrice | number | 平均成本 | |
| currentValue | number | 当前价值 | |
| cashPnl | number | 未实现盈亏 | |
| realizedPnl | number | 已实现盈亏 | **关键** |
| curPrice | number | 当前价格 | |
| outcome | string | 持仓方向 | Yes/No |
| conditionId | string | 市场ID | |

---

## 4. 样本账户数据

### Sample 1: 0xd0d6053c3c37e727402d84c14069780d360993aa

**positions 摘要** (部分):
```json
{
  "proxyWallet": "0xd0d6053c3c37e727402d84c14069780d360993aa",
  "outcome": "Down",
  "size": 18183.8368,
  "avgPrice": 0.3293,
  "currentValue": 18174.7449,
  "cashPnl": 12185.0254,
  "percentPnl": 203.4323,
  "realizedPnl": 0
}
```

**closed-positions 摘要** (部分):
```json
{
  "outcome": "Up",
  "realizedPnl": 23567.227979,
  "totalBought": 36887.251318,
  "title": "Bitcoin Up or Down - January 19, 5AM ET"
}
```

**activity 摘要** (最新5笔):
- 多次 BUY Down outcome
- 单笔最大: 10.329406 shares @ $0.15

### Sample 2: 0xcbbb3e23d4d519891673f8bb023b8736fb4ed63e

**positions 摘要**:
```json
{
  "proxyWallet": "0xcbbb3e23d4d519891673f8bb023b8736fb4ed63e",
  "outcome": "Down",
  "size": 309.7035,
  "avgPrice": 0.0454,
  "cashPnl": -14.063,
  "realizedPnl": 0
}
```

### Sample 3: 0x5924ca480d8b08cd5f3e5811fa378c4082475af6

**positions 摘要**:
```json
{
  "proxyWallet": "0x5924ca480d8b08cd5f3e5811fa378c4082475af6",
  "outcome": "Up",
  "size": 1504.6869,
  "avgPrice": 0.01,
  "realizedPnl": 263.2588
}
```

### Sample 4: 0x7d9113a6ea6cb01071a8a82656d888a483413f1a

**positions 摘要**:
```json
{
  "proxyWallet": "0x7d9113a6ea6cb01071a8a82656d888a483413f1a",
  "outcome": "Down",
  "size": 52.5,
  "avgPrice": 0.15,
  "realizedPnl": 0
}
```

### Sample 5: 0x715aa266e1d4bf28c452cc8e9250788a7c91774a

**positions 摘要**:
```json
{
  "proxyWallet": "0x715aa266e1d4bf28c452cc8e9250788a7c91774a",
  "outcome": "Up",
  "size": 100.0,
  "avgPrice": 0.5,
  "realizedPnl": 0
}
```

---

## 5. 结论与建议

### ✅ 可行性: PASS

1. **数据源可用**: Polymarket Data API 公开可用，无需认证即可获取账户交易/持仓数据
2. **胜率可算**: `/closed-positions` 可获取已结算头寸，支持 strict_win_rate 计算
3. **限流可承受**: 150-200 req/10s 的限制对于批量采集可管理

### ⚠️ 主要挑战

1. **交易者发现**: 无 Top Traders API，需要通过监听 `/trades` 或种子地址池启动
2. **历史深度**: `/trades` 默认返回近期数据，全量历史需要分页或长期采集

### 📋 建议的指标口径

| 指标 | 定义 | 数据来源 |
|------|------|---------|
| strict_win_rate | wins / (wins + losses) 已结算 | /closed-positions |
| proxy_win_rate | 基于 cashPnl > 0 判断 | /positions + /activity |
| total_trades | BUY + SELL 总笔数 | /activity |
| total_volume_usd | sum(usdcSize) | /activity |
| realized_pnl | sum(realizedPnl) | /positions |
| confidence_score | closed_positions / total_positions | 数据完整度 |

**多结果市场 (Multi-Outcome) 处理规则**:
- 当前样本中 `outcome: "Down"` 表明存在多元市场（非二元 Yes/No）
- **win 判定**: 当 `realizedPnl > 0` 时，无论 outcome 值，都视为 win
- **loss 判定**: 当 `realizedPnl < 0` 时，视为 loss
- **中性判定**: `realizedPnl == 0` 时不计入分子/分母（或计入中性计数）

### 下一步

- [ ] 使用种子地址列表启动采集
- [ ] 实现 collector 模块: 轮询 /trades 提取新交易者地址
- [ ] 扩展 positions/activity 采集能力
