#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_DIR="${ROOT_DIR}/.docker-sync"
FAHRER_SRC="${ROOT_DIR}"
KOORDINATEN_SRC="${ROOT_DIR}/../koordinaten-app-lokal"
ADMIN_SRC="${ROOT_DIR}/../admin-app-lokal"
SHARED_ICON_SRC="${ROOT_DIR}/../Icon"
SHARED_BRANDING_SRC="${ROOT_DIR}/../branding"

mkdir -p "${SYNC_DIR}/fahrer" "${SYNC_DIR}/koordinaten" "${SYNC_DIR}/admin"

hydrate_one() {
  local src="$1"

  # Force iCloud/APFS "dataless" files to be materialized locally before Docker reads them.
  find "$src" -type f \
    ! -path "$src/node_modules/*" \
    ! -path "$src/dist/*" \
    ! -path "$src/.git/*" \
    ! -path "$src/.docker-sync/*" \
    -print0 | while IFS= read -r -d '' file; do
      cat "$file" > /dev/null || true
    done
}

sync_one() {
  local src="$1"
  local dst="$2"

  if [ ! -d "$src" ]; then
    echo "Missing source directory: $src" >&2
    exit 1
  fi

  hydrate_one "$src"

  rsync -a --delete --delete-delay --delay-updates \
    --exclude node_modules \
    --exclude dist \
    --exclude .git \
    --exclude .docker-sync \
    --exclude icon \
    --exclude branding \
    --exclude public/icon \
    "$src/" "$dst/"

  hydrate_one "$dst"

  # Ensure synced sources are readable by container users (node/root) on macOS Docker mounts.
  chmod -R u+rwX,go+rX "$dst"
}

sync_shared_dir() {
  local src="$1"
  shift

  if [ ! -d "$src" ]; then
    return 0
  fi

  # Shared directories can also live on iCloud/APFS; materialize first.
  hydrate_one "$src"

  for dst in "$@"; do
    mkdir -p "$dst"
    rsync -a --delete --delete-delay --delay-updates "$src/" "$dst/"
    hydrate_one "$dst"
    chmod -R u+rwX,go+rX "$dst"
  done
}

sync_one "${FAHRER_SRC}" "${SYNC_DIR}/fahrer"
sync_one "${KOORDINATEN_SRC}" "${SYNC_DIR}/koordinaten"
sync_one "${ADMIN_SRC}" "${SYNC_DIR}/admin"

sync_shared_dir "${SHARED_ICON_SRC}" "${SYNC_DIR}/fahrer/icon" "${SYNC_DIR}/koordinaten/icon" "${SYNC_DIR}/admin/icon"
# Vite serves static assets from /public; keep real files for stable /icon/* URLs.
sync_shared_dir "${SHARED_ICON_SRC}" "${SYNC_DIR}/fahrer/public/icon" "${SYNC_DIR}/koordinaten/public/icon" "${SYNC_DIR}/admin/public/icon"
sync_shared_dir "${SHARED_BRANDING_SRC}" "${SYNC_DIR}/fahrer/branding" "${SYNC_DIR}/koordinaten/branding" "${SYNC_DIR}/admin/branding"

echo "Docker sources synced to ${SYNC_DIR}"
