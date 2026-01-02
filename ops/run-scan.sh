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

LOG_FILE="${REPO_DIR}/logs/scan.log"

{
  echo "$(date -Is) INFO run-scan.sh starting"
  set +e
  npm run scan:once
  code=$?
  set -e
  echo "$(date -Is) INFO run-scan.sh done (exit=${code})"
  exit "${code}"
} >>"${LOG_FILE}" 2>&1

