#!/usr/bin/env bash
# Apply NFSU1 browser overlays as unified diffs + copied page sources.
# Usage: tools/apply_browser_profile.sh --upstream work/upstream/nfsu2-web
#        tools/apply_browser_profile.sh --upstream ... --revert
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM=""
REVERT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upstream) UPSTREAM="$(cd "$2" && pwd)"; shift 2 ;;
    --revert) REVERT=1; shift ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$UPSTREAM" ]] || { echo "error: --upstream is required" >&2; exit 2; }
STATE="$UPSTREAM/.nfsu1-browser-profile"
PATCH_ROOT="$ROOT/patches/nfsu2-web"

# Reverse dry-runs give false "already applied" results with fuzz, so every
# target is restored from its pristine backup before patching forward.
restore_originals() {
  local patch rel
  while IFS= read -r -d '' patch; do
    rel="${patch#"$PATCH_ROOT"/}"
    rel="${rel%.patch}"
    [[ -f "$STATE/$rel" ]] && cp "$STATE/$rel" "$UPSTREAM/$rel"
  done < <(find "$PATCH_ROOT/web" -name '*.patch' -print0 | sort -z)
}

apply_patches() {
  local patch
  while IFS= read -r -d '' patch; do
    patch -p1 -d "$UPSTREAM" -N --no-backup-if-mismatch -r - -i "$patch"
  done < <(find "$PATCH_ROOT/web" -name '*.patch' -print0 | sort -z)
}

copy_host() {
  install -d "$UPSTREAM/web/src/app" "$UPSTREAM/web/src/gpu"
  install -m 0644 "$ROOT/browser/menu.ts" "$UPSTREAM/web/src/app/menu.ts"
  install -m 0644 "$ROOT/browser/keyboard.ts" "$UPSTREAM/web/src/app/keyboard.ts"
  install -m 0644 "$ROOT/browser/touch.ts" "$UPSTREAM/web/src/app/touch.ts"
  install -m 0644 "$ROOT/browser/astc.ts" "$UPSTREAM/web/src/gpu/astc.ts"
}

remove_host() {
  rm -f "$UPSTREAM/web/src/app/menu.ts" "$UPSTREAM/web/src/app/keyboard.ts" "$UPSTREAM/web/src/app/touch.ts" "$UPSTREAM/web/src/gpu/astc.ts"
}

if [[ "$REVERT" -eq 1 ]]; then
  restore_originals
  remove_host
  rm -f "$STATE/state.json"
  echo "Reverted NFSU1 browser patches under $UPSTREAM"
  exit 0
fi

mkdir -p "$STATE"
while IFS= read -r -d '' patch; do
  rel="${patch#"$PATCH_ROOT"/}"
  rel="${rel%.patch}"
  backup="$STATE/$rel"
  if [[ ! -f "$backup" ]]; then
    mkdir -p "$(dirname "$backup")"
    cp "$UPSTREAM/$rel" "$backup"
  fi
done < <(find "$PATCH_ROOT/web" -name '*.patch' -print0 | sort -z)

restore_originals
apply_patches
copy_host
python3 - <<PY
import hashlib, json
from pathlib import Path
state = {
  "kind": "nfsu1-browser-patches",
  "upstream_commit": "31da468582c3de14fd6f4233831f62816e2df83d",
  "patches": sorted(p.relative_to(Path("$PATCH_ROOT")).as_posix()
                    for p in Path("$PATCH_ROOT/web").rglob("*.patch")),
}
Path("$STATE/state.json").write_text(json.dumps(state, indent=2) + "\n")
print(f"Applied NFSU1 browser patches to $UPSTREAM")
PY
