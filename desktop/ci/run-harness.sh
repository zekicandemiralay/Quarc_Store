#!/bin/bash
# The real Mac Store app, end to end (CI on macOS, after `npm install` in desktop/ and a built frontend):
# builds the app with its window pointed at ci/harness.html instead of the Quarc server (ci/harness.conf.json),
# giving that page exactly the commands the real server page gets (capabilities/macos.json, its address
# swapped), then lets the page install the latest Quarc Notes from GitHub into /Applications, open it, remove
# it, and try what must be refused. Fails if any check in the page fails or it never reports.
set -euo pipefail
cd "$(dirname "$0")/.."
TAURI=src-tauri

case "$(uname -m)" in arm64) ARCH=arm64; FILE=_aarch64.dmg ;; *) ARCH=x64; FILE=_x64.dmg ;; esac
AUTH=()
[ -n "${GH_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $GH_TOKEN")
REL=$(curl -fsSL ${AUTH[@]+"${AUTH[@]}"} https://api.github.com/repos/zekicandemiralay/Quarc_Notes/releases/latest)
export NOTES_VERSION=$(echo "$REL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tag_name.replace(/^v/,"")))')
export NOTES_DMG_URL=$(echo "$REL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).assets.find(a=>a.name.endsWith(process.argv[1])).browser_download_url))' "$FILE")
export STORE_VERSION=$(node -p 'require("./src-tauri/tauri.conf.json").version')
export EXPECT_ARCH=$ARCH NOTES_PATH="/Applications/Quarc Notes.app" RESULT_FILE="${RUNNER_TEMP:-/tmp}/harness-result.json"
echo "Store $STORE_VERSION ($ARCH) will install Quarc Notes $NOTES_VERSION from $NOTES_DMG_URL"

# The test page's address gets the real Mac page's permissions, nothing more.
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync("src-tauri/capabilities/macos.json", "utf8"));
c.identifier = "ci-harness"; delete c.platforms; c.remote.urls = ["http://localhost:8765/*"];
fs.writeFileSync("src-tauri/capabilities/ci-harness.json", JSON.stringify(c, null, 2));'
# A plain-http test page on this machine (the real page is https).
cat > $TAURI/Info.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>
PLIST
trap 'rm -f $TAURI/capabilities/ci-harness.json $TAURI/Info.plist' EXIT
npx tauri build --bundles app --config ci/harness.conf.json
APP="$TAURI/target/release/bundle/macos/Quarc Store.app"

rm -f "$RESULT_FILE"
rm -rf "$NOTES_PATH"
node ci/serve.mjs &
SERVER=$!
sleep 1
"$APP/Contents/MacOS/quarc-store" &
STORE=$!
for _ in $(seq 1 480); do [ -s "$RESULT_FILE" ] && break; sleep 0.5; done
kill $STORE $SERVER 2>/dev/null || true
rm -rf "$NOTES_PATH"

[ -s "$RESULT_FILE" ] || { echo "::error::The test page never reported (did the window load it, and could it reach the app?)"; exit 1; }
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const bad = r.filter((x) => !x.ok);
console.log(`${r.length - bad.length} passed, ${bad.length} failed`);
for (const b of bad) console.log(`::error::${b.name}: ${b.detail}`);
process.exit(bad.length || r.length < 20 ? 1 : 0);' "$RESULT_FILE"
