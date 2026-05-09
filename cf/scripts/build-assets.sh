#!/usr/bin/env bash
# Build static assets for the CF Worker deployment.
#
# Copies client/ and obsidian/ from the main project into cf/public/,
# which is served as CF Pages static assets (wrangler.toml [assets]).
#
# Run from the cf/ directory:
#   bash scripts/build-assets.sh
#
# Or via npm:
#   npm run build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MAIN_DIR="$(cd "$CF_DIR/.." && pwd)"
PUBLIC_DIR="$CF_DIR/public"

echo "obsidian-web CF — building assets"
echo "  main project : $MAIN_DIR"
echo "  output       : $PUBLIC_DIR"

# ── Verify obsidian/ exists ────────────────────────────────────────────────
if [[ ! -f "$MAIN_DIR/obsidian/app.js" ]]; then
  echo ""
  echo "ERROR: obsidian/ directory not found or incomplete."
  echo "Run first: node $MAIN_DIR/scripts/update-obsidian.js"
  exit 1
fi

# ── Clean and recreate public/ ─────────────────────────────────────────────
rm -rf "$PUBLIC_DIR"
mkdir -p "$PUBLIC_DIR"

# ── Copy client shims and boot script ─────────────────────────────────────
echo "  copying client/..."
cp -r "$MAIN_DIR/client" "$PUBLIC_DIR/client"

# ── Copy obsidian renderer ─────────────────────────────────────────────────
echo "  copying obsidian/..."
cp -r "$MAIN_DIR/obsidian" "$PUBLIC_DIR/obsidian"

# ── Mirror resource dirs at root level (obsidian fetches /i18n/*, /lib/*, …)
echo "  copying resource dirs..."
for dir in i18n lib public sandbox; do
  if [[ -d "$MAIN_DIR/obsidian/$dir" ]]; then
    cp -r "$MAIN_DIR/obsidian/$dir" "$PUBLIC_DIR/$dir"
  fi
done

# Worker scripts served at root (critical for metadata indexer)
cp "$MAIN_DIR/obsidian/worker.js" "$PUBLIC_DIR/worker.js"
cp "$MAIN_DIR/obsidian/sim.js"    "$PUBLIC_DIR/sim.js"

# ── index.html: inject vault=demo so boot.js skips /starter ───────────────
echo "  patching index.html..."
cp "$MAIN_DIR/client/index.html" "$PUBLIC_DIR/index.html"

# Insert localStorage.setItem before boot.js loads.
INJECTION='  <script>localStorage.setItem(\x27obsidian-web:lastVaultId\x27,\x27demo\x27);<\/script>'
sed -i "s|<script src=\"/client/boot\.js|${INJECTION}\n  <script src=\"/client/boot.js|" \
  "$PUBLIC_DIR/index.html"

# Replace ?v=<anything> on /client/ script tags with a build timestamp so
# browsers always pick up updated files after a new deploy.
BUST=$(date +%s)
echo "  cache buster: $BUST"
sed -i "s|/client/\([^\"]*\)?v=[^\"&]*\"|/client/\1?v=${BUST}\"|g" "$PUBLIC_DIR/index.html"

cp "$MAIN_DIR/client/starter.html" "$PUBLIC_DIR/starter.html"
sed -i "s|/client/\([^\"]*\)?v=[^\"&]*\"|/client/\1?v=${BUST}\"|g" "$PUBLIC_DIR/starter.html"

# ── Summary ────────────────────────────────────────────────────────────────
FILE_COUNT=$(find "$PUBLIC_DIR" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$PUBLIC_DIR" 2>/dev/null | cut -f1)

echo ""
echo "Done."
echo "  files : $FILE_COUNT"
echo "  size  : $TOTAL_SIZE"
echo ""
echo "Next:"
echo "  wrangler deploy          # deploy to Cloudflare"
echo "  wrangler dev             # local dev (limited DO support)"
