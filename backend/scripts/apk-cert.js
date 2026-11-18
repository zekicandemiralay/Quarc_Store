#!/usr/bin/env node
// Prints the signing-certificate SHA-256 of an APK — the value Quarc Store
// uses to verify that an app asking for a login is the genuine one.
//
// Usage:
//   node scripts/apk-cert.js path/to/app.apk
//   node scripts/apk-cert.js https://github.com/.../Quarc-Music-Android.apk
//
// Useful for local debug builds: paste the result into Store → Admin →
// Catalog → (app) → "Extra signing fingerprints" so a debug-signed build can
// use single sign-on too.

const fs = require('fs');
const { apkSigningCertSha256, fetchApkCert } = require('../src/services/apkCert');

(async () => {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/apk-cert.js <apk file or URL>');
    process.exit(1);
  }
  try {
    const sha = /^https?:\/\//.test(target)
      ? await fetchApkCert(target)
      : apkSigningCertSha256(fs.readFileSync(target));
    console.log(sha);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
