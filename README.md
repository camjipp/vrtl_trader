## Vrtl_Trader (Polymarket structural scanner)

Local, read-only CLI that scans Polymarket markets and identifies **structural** inefficiencies (not prediction, not latency).

### Goals (current milestone)
- Fetch open Polymarket markets over direct HTTP (no auth, no websockets).
- Save raw responses under `data/raw/`.
- Normalize markets into “families” (especially bucket/range markets like `10–12`, `12-14`).
- Emit normalized JSON under `data/normalized/`.

### Quickstart

```bash
npm install
npm run scan
```

### Output
- **Raw**: `data/raw/gamma_markets_latest.json`
- **Normalized families**: `data/normalized/families_latest.json`

### Paper arbitrage mode

The executable-arbitrage path is intentionally paper-only. Enable it with:

```bash
PAPER_ARB=1 npm run scan:once
```

This fetches public CLOB order books for binary YES/NO markets, looks for bundle-long arbitrage
where buying both sides costs less than the guaranteed `$1` payout after conservative taker-fee
accounting, and writes local paper results only:

- **Order books**: `data/raw/orderbooks_raw.json`
- **Paper state**: `data/db/paper_arb_state.json`
- **Paper events**: `data/db/paper_arb_trades.jsonl`
- **Dashboard summary**: `data/out/dashboard.json`

Useful paper settings:

- `ORDERBOOK_MAX_MARKETS` limits how many binary markets receive CLOB book lookups.
- `PAPER_ARB_BANKROLL_USD` controls starting paper bankroll.
- `PAPER_ARB_MAX_TRADE_USD` caps each simulated bundle entry.
- `PAPER_ARB_MAX_EXPOSURE_USD` caps total open paper exposure.
- `PAPER_ARB_MIN_EDGE` and `PAPER_ARB_MIN_PROFIT_USD` control entry strictness.
- `PAPER_ARB_TAKER_FEE_RATE` defaults to a conservative `0.05`.

Summarize the paper ledger:

```bash
npm run arb:report
```

Open the local dashboard:

```bash
npm run dashboard
```

Then visit `http://127.0.0.1:8787`.

### Supabase sync

The fast trading loop stays local to the worker. Supabase is a best-effort mirror for
history, dashboards, and alerts. If Supabase is not configured or a write fails, scans
continue and local JSON/JSONL files remain authoritative.

Tables:

- `bot_scans`
- `arb_opportunities`
- `paper_arb_trades`
- `paper_arb_positions`
- `bot_heartbeats`

Worker env vars:

```bash
SUPABASE_URL=https://llsiphmlwqrxhaxgziid.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-side key only>
BOT_WORKER_ID=lightsail-vrtl-1
```

Do not put the service-role key in Vercel client code or commit it to git.

### Vercel command console

The Vercel UI is read-only. It calls a serverless API route in `api/dashboard.js`,
which reads Supabase using Vercel server-side environment variables. The browser
never receives the service-role key.

Vercel environment variables:

```bash
SUPABASE_URL=https://llsiphmlwqrxhaxgziid.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-side key only>
```

Deploy shape:

- `public/` serves the command-console UI.
- `api/dashboard.js` reads Supabase.
- `vercel.json` disables caching for API responses.

### Notes
- This is **not** a trading bot. No orders are placed.
- API shapes can evolve; the ingestion step stores raw JSON so we can adapt normalization safely.

### Lightsail Quickstart (Ubuntu, always-on)

This project is designed to run **read-only** on a small server via cron.

#### Install

```bash
sudo apt-get update -y
sudo apt-get install -y git
git clone <your-repo-url> Vrtl_Trader
cd Vrtl_Trader
chmod +x ops/*.sh
./ops/install.sh
```

#### Run once (manual smoke test)

```bash
cd ~/Vrtl_Trader
SCAN_MAX_PAGES=10 SCAN_LIMIT_PER_PAGE=200 npm run scan:once
cat data/db/last_scan.json
tail -n 50 logs/scan.log
```

#### Set up cron

Edit your crontab:

```bash
crontab -e
```

Paste and update the repo path in `ops/cron.txt` (or copy the lines directly):

- Scan every 15 minutes using the wrapper:
  - `./ops/run-scan.sh`
- Run the report daily at 9pm:
  - `npm run report:once`

#### Operational files
- **Log file**: `logs/scan.log` (appended every run)
- **Heartbeat**: `data/db/last_scan.json`
- **Evaluation DB (JSONL)**: `data/db/family_scores.jsonl`
