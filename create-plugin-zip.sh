#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SLUG="markdown-post-editor"
BUILD_DIR="$SCRIPT_DIR/.build-plugin-zip"
STAGING_DIR="$BUILD_DIR/$PLUGIN_SLUG"
ZIP_PATH="$SCRIPT_DIR/$PLUGIN_SLUG.zip"

rm -rf "$BUILD_DIR"
rm -f "$ZIP_PATH"

mkdir -p "$STAGING_DIR/includes" "$STAGING_DIR/assets"

cp "$SCRIPT_DIR/$PLUGIN_SLUG/markdown-post-editor.php" "$STAGING_DIR/"
cp "$SCRIPT_DIR/LICENSE" "$STAGING_DIR/"
cp -R "$SCRIPT_DIR/$PLUGIN_SLUG/includes/." "$STAGING_DIR/includes/"
cp -R "$SCRIPT_DIR/$PLUGIN_SLUG/assets/." "$STAGING_DIR/assets/"

(
  cd "$BUILD_DIR"
  zip -qr "$ZIP_PATH" "$PLUGIN_SLUG"
)

rm -rf "$BUILD_DIR"

echo "Created $ZIP_PATH"
