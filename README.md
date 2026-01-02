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


