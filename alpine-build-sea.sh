#!/bin/sh
set -eu

ENTRY="${1:-server.js}"
APP="${2:-bplus-search}"    # no extension; Linux/macos binary
BUNDLE="bundle.cjs"
BLOB="sea-prep.blob"
CONFIG="sea-config.json"

echo "Entry: $ENTRY"
echo "App:   $APP"

# Detect OS without $OSTYPE (not set in BusyBox/sh)
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"  # "linux" or "darwin" (macOS)

# 1) Bundle to CJS with safe globals for SEA
npx esbuild "$ENTRY" \
  --bundle \
  --platform=node \
  --format=cjs \
  --outfile="$BUNDLE" \
  --banner:js="__dirname = (typeof __dirname !== 'undefined' && __dirname) || process.cwd(); __filename = (typeof __filename !== 'undefined' && __filename) || '/virtual/app.js';" \
  --define:import.meta.url="'file:///virtual/app.js'" \
  --external:better-sqlite3 \
  --external:node-gyp-build \
  --external:node-gyp-build-optional-packages

# 2) Generate sea-config.json (embed public/index.html if present)
if [ -f "public/index.html" ]; then
  cat > "$CONFIG" <<EOF
{
  "main": "./$BUNDLE",
  "output": "./$BLOB",
  "useCodeCache": true,
  "assets": {
    "public/index.html": "./public/index.html"
  }
}
EOF
else
  cat > "$CONFIG" <<EOF
{
  "main": "./$BUNDLE",
  "output": "./$BLOB",
  "useCodeCache": true,
  "assets": {}
}
EOF
fi

# 3) Build SEA blob
node --experimental-sea-config "$CONFIG"

# 4) Copy Node runtime -> your app (must be the *same* Node used above; on Alpine use musl build)
cp "$(command -v node)" "$APP"

# 5) On macOS, remove sig before injection
if [ "$OS" = "darwin" ]; then
  codesign --remove-signature "$APP" 2>/dev/null || true
fi

# 6) Inject blob (same flags for Linux & macOS, but macOS needs the segment name)
if [ "$OS" = "darwin" ]; then
  npx postject "$APP" NODE_SEA_BLOB "$BLOB" \
    --macho-segment-name NODE_SEA \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
else
  npx postject "$APP" NODE_SEA_BLOB "$BLOB" \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
fi

echo "✔ Built $APP"
echo "Run with: ./$(basename "$APP")"
