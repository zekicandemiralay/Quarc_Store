// The Windows Store installs the release's "-setup.exe". A release also has an .msi, and GitHub does
// not promise an order, so the catalog has to pick the .exe whichever comes first.
// Run: node test/windows-asset.test.js   (also part of npm test)

const assert = require('assert');
const { shapeRelease } = require('../src/services/catalog');

const asset = (name) => ({ name, url: `https://github.com/x/y/releases/download/v1/${name}`, size: 1, platform: name.endsWith('.msi') || name.endsWith('.exe') ? 'windows' : name.endsWith('.apk') ? 'android' : 'other' });
const row = (...names) => ({ tag: 'v1', version: '1', name: 'v1', body: '', published_at: '2026-01-01', html_url: '', assets_json: JSON.stringify(names.map(asset)) });

for (const order of [
  ['App_1_x64-setup.exe', 'App_1_x64_en-US.msi'],
  ['App_1_x64_en-US.msi', 'App_1_x64-setup.exe'],
  ['App.apk', 'App_1_x64_en-US.msi', 'App_1_x64-setup.exe'],
]) {
  const { assets } = shapeRelease(row(...order));
  assert.equal(assets.windows.name, 'App_1_x64-setup.exe', `picks the setup.exe for ${order.join(' + ')}`);
}
// Only an .msi: still listed (it is a Windows download), the Windows Store just won't install it.
assert.equal(shapeRelease(row('App_1_x64_en-US.msi')).assets.windows.name, 'App_1_x64_en-US.msi');
// Android is unaffected.
assert.equal(shapeRelease(row('App.apk', 'App_1_x64-setup.exe')).assets.android.name, 'App.apk');
console.log('  ✓ Windows catalog entry is the -setup.exe, in any order');
