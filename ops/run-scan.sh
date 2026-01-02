#!/usr/bin/env bash
set -euo pipefail

# Cron-safe wrapper for running a single scan.
# - cd's into repo
# - runs npm run scan:once
# - appends stdout/stderr to logs/scan.log (in addition to in-app file logger)
#
# Note: scan itself writes the heartbeat at data/db/last_scan.json on success.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_DIR}"

mkdir -p logs data/raw data/out data/db

# Wrapper log (do NOT write into logs/scan.log to avoid duplicating in-app logs).
LOG_FILE="${REPO_DIR}/logs/run-scan.log"

{
  echo "$(date -Is) INFO run-scan.sh starting"
  set +e
  # Keep memory bounded on small instances. Override via crontab if desired.
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=384}" \
  MAX_MARKETS="${MAX_MARKETS:-2000}" \
  GAMMA_PAGE_LIMIT="${GAMMA_PAGE_LIMIT:-4}" \
  GAMMA_LIMIT="${GAMMA_LIMIT:-500}" \
  PAPER_TRADE="${PAPER_TRADE:-1}" \
  npm run scan:once
  code=$?
  set -e
  echo "$(date -Is) INFO run-scan.sh done (exit=${code})"
  exit "${code}"
} >>"${LOG_FILE}" 2>&1

