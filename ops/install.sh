#!/usr/bin/env bash
set -euo pipefail

# Lightsail Ubuntu quick installer (read-only scanner).
# - Installs Node 20 via nvm
# - Installs npm deps
# - Creates required runtime directories
#
# Assumptions:
# - You are running on Ubuntu with curl available
# - You have cloned this repo already

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Repo: ${REPO_DIR}"

sudo apt-get update -y
sudo apt-get install -y curl ca-certificates build-essential

# Install nvm (idempotent-ish). Pin a stable nvm release for repeatability.
export NVM_DIR="${HOME}/.nvm"
if [ ! -d "${NVM_DIR}" ]; then
  mkdir -p "${NVM_DIR}"
fi

if [ ! -s "${NVM_DIR}/nvm.sh" ]; then
  echo "Installing nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi

# shellcheck disable=SC1090
source "${NVM_DIR}/nvm.sh"

echo "Installing Node 20..."
nvm install 20
nvm use 20

cd "${REPO_DIR}"

echo "Installing npm dependencies..."
npm install --no-audit --no-fund

echo "Creating runtime directories..."
mkdir -p data/raw data/out data/db logs

echo "Done."

