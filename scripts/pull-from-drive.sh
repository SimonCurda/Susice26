#!/usr/bin/env bash
# Sync raw hackathon data (big files: Sentinel GeoTIFF/.NC, portal ZIPs) from
# the shared Google Drive into data/raw/ — which is gitignored on purpose.
#
# One-time setup (do this on your own laptop, needs any browser):
#   1. install rclone  (brew install rclone / winget install Rclone.Rclone / apt install rclone)
#   2. rclone config
#      → n (new remote) → name: gdrive → type: drive → client_id/secret: empty (Enter)
#      → scope: 1 (drive) → everything else default → auto config → login in browser
# After that, run:
#   ./scripts/pull-from-drive.sh                      # uses remote "gdrive", path "Hackathon-Data/raw"
#   ./scripts/pull-from-drive.sh gdrive Sub/teamX/raw # custom remote/path
#
# Why this script: nobody has to click through hundreds of Drive folders —
# rclone recursively copies the whole subtree with one command.
set -euo pipefail

REMOTE="${1:-gdrive}"
SRC="${2:-Hackathon-Data/raw}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/data/raw"

echo "Syncing ${REMOTE}:${SRC} → ${DEST}"
mkdir -p "${DEST}"

rclone copy "${REMOTE}:${SRC}" "${DEST}" \
  --progress \
  --checkers 8 \
  --transfers 4

COUNT=$(find "${DEST}" -type f | wc -l | tr -d ' ')
SIZE=$(du -sh "${DEST}" | cut -f1)

echo "Done. ${COUNT} files, ${SIZE} in data/raw (gitignored — raw data NEVER goes into git)."
echo "Next step: run the processing scripts (see README 'Google Drive ↔ repo ↔ Vercel') to produce the small JSONs that ARE committed."
