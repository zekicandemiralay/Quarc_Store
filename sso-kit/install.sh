#!/usr/bin/env bash
# Copies (or refreshes) the Quarc Store SSO kit into a Quarc app repo.
#
#   bash sso-kit/install.sh ../Quarc_Music
#
# Safe to re-run after the kit changes: it only overwrites the kit's own
# files. The one-time wiring (registering the plugin, the manifest <queries>,
# the authStore hooks, the login button) is described in sso-kit/README.md.
set -euo pipefail

KIT="$(cd "$(dirname "$0")" && pwd)"
APP="${1:?Usage: bash sso-kit/install.sh <path-to-app-repo>}"
CONFIG="$APP/mobile/capacitor.config.json"
[ -f "$CONFIG" ] || { echo "Not a Quarc app with an Android build: $CONFIG missing" >&2; exit 1; }

PKG=$(grep -o '"appId"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG" | sed 's/.*"\([^"]*\)"$/\1/')
case "$PKG" in
  *cleaning*) echo "This app is not part of the Quarc Store system — not installing." >&2; exit 1 ;;
esac
JAVA_DIR="$APP/mobile/android/app/src/main/java/$(echo "$PKG" | tr . /)"
[ -d "$JAVA_DIR" ] || { echo "Java package dir not found: $JAVA_DIR" >&2; exit 1; }

sed "s/^package com\.quarc\.example;/package $PKG;/" "$KIT/android/QuarcSsoPlugin.java" > "$JAVA_DIR/QuarcSsoPlugin.java"
mkdir -p "$APP/frontend/src/lib" "$APP/frontend/src/components"
cp "$KIT/web/storeSso.js" "$APP/frontend/src/lib/storeSso.js"
cp "$KIT/web/StoreLoginButton.jsx" "$APP/frontend/src/components/StoreLoginButton.jsx"
cp "$KIT/web/RequiredUpdateGate.jsx" "$APP/frontend/src/components/RequiredUpdateGate.jsx"
cp "$KIT/web/StorePromo.jsx" "$APP/frontend/src/components/StorePromo.jsx"

echo "Quarc Store SSO kit → $APP ($PKG)"
echo "  $JAVA_DIR/QuarcSsoPlugin.java"
echo "  $APP/frontend/src/lib/storeSso.js"
echo "  $APP/frontend/src/components/StoreLoginButton.jsx"
echo "  $APP/frontend/src/components/RequiredUpdateGate.jsx"
echo "  $APP/frontend/src/components/StorePromo.jsx"
grep -q "QuarcSsoPlugin" "$JAVA_DIR/MainActivity.java" || echo "  TODO: registerPlugin(QuarcSsoPlugin.class) in MainActivity"
grep -q "com.quarc.store" "$APP/mobile/android/app/src/main/AndroidManifest.xml" || echo "  TODO: <queries><package android:name=\"com.quarc.store\" /></queries> in AndroidManifest.xml"
grep -q "syncFromStore" "$APP/frontend/src/store/authStore.js" || echo "  TODO: hook syncFromStore/watchStoreSession into authStore.js"
grep -q "RequiredUpdateGate" "$APP/frontend/src/main.jsx" || echo "  TODO: <RequiredUpdateGate packageName=\"$PKG\" /> next to <App /> in main.jsx"
