#!/usr/bin/env bash
set -euo pipefail
cd /workspace/FILEFORGE-AI
export XDG_DATA_HOME=/workspace/.local/share
export XDG_CACHE_HOME=/tmp/fileforge-cache
export XDG_STATE_HOME=/tmp/fileforge-state
pnpm install --frozen-lockfile
pnpm db:generate
node --import tsx scripts/init-local-env.ts
NODE_ENV=production pnpm build
