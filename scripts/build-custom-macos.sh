#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: the personal macOS build must run on macOS" >&2
  exit 1
fi
if [[ "$(uname -m)" != "arm64" ]]; then
  echo "error: this script builds the local arm64 release and must run on Apple Silicon" >&2
  exit 1
fi

PRODUCT_NAME="Parallel Code Custom"
OUTPUT_DIR="${CUSTOM_BUILD_OUTPUT:-$ROOT_DIR/release/custom-macos-arm64}"
PREFERRED_IDENTITY="PasteBar Lite Local Code Signing"
REQUESTED_IDENTITY="${CUSTOM_SIGN_IDENTITY:-$PREFERRED_IDENTITY}"

resolve_identity() {
  if [[ "$REQUESTED_IDENTITY" == "-" ]]; then
    printf '%s' '-'
    return
  fi
  if security find-identity -v -p codesigning 2>/dev/null | grep -Fq "\"$REQUESTED_IDENTITY\""; then
    printf '%s' "$REQUESTED_IDENTITY"
    return
  fi
  echo "warning: code-signing identity '$REQUESTED_IDENTITY' was not found; using ad-hoc signing" >&2
  printf '%s' '-'
}

SIGN_IDENTITY="$(resolve_identity)"

echo "==> Building Parallel Code Custom ${npm_package_version:-$(node -p "require('./package.json').version")}"
echo "==> Output: $OUTPUT_DIR"
echo "==> Signing identity: $SIGN_IDENTITY"

npm run build:frontend
npm run build:remote
npm run compile
npm run build:mcp

rm -rf "$OUTPUT_DIR"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder \
  --mac \
  --arm64 \
  --dir \
  --publish never \
  --config.directories.output="$OUTPUT_DIR" \
  --config.mac.identity=null \
  --config.mac.notarize=false

APP_PATH="$(find "$OUTPUT_DIR" -maxdepth 3 -type d -name "$PRODUCT_NAME.app" -print -quit)"
if [[ -z "$APP_PATH" ]]; then
  echo "error: electron-builder did not produce $PRODUCT_NAME.app" >&2
  exit 1
fi

# Electron Builder deliberately emits an unsigned directory above. Signing here
# makes the chosen local identity and ad-hoc fallback explicit and repeatable.
xattr -cr "$APP_PATH"
codesign \
  --force \
  --deep \
  --timestamp=none \
  --options runtime \
  --entitlements "$ROOT_DIR/build/entitlements.mac.plist" \
  --sign "$SIGN_IDENTITY" \
  "$APP_PATH"

codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo
printf 'Built and verified: %s\n' "$APP_PATH"
if [[ "$SIGN_IDENTITY" == "-" ]]; then
  echo "Signature: ad-hoc (local fallback; not suitable for public distribution)"
else
  echo "Signature: $SIGN_IDENTITY (local personal identity; not notarized)"
fi
