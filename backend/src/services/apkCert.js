// Reads the signing certificate out of an APK and returns its SHA-256 —
// the same value Android reports for an installed app
// (PackageManager signing info → Signature.toByteArray() → SHA-256).
//
// Quarc Store uses this to decide which apps on a device may receive a
// login: a caller claiming to be com.quarc.music only gets one if it's
// signed with the same key as the official Quarc Music release.
//
// Supports APK Signature Scheme v2 and v3 (every APK built by Android
// Gradle Plugin 3+ has at least v2), parsed directly — no dependencies.

const crypto = require('crypto');

const EOCD_SIG = 0x06054b50;
const SIG_BLOCK_MAGIC = 'APK Sig Block 42';
const V2_ID = 0x7109871a;
const V3_ID = 0xf05368c0;
const V31_ID = 0x1b93ad61;

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  remaining() {
    return this.buf.length - this.pos;
  }
  u32() {
    if (this.remaining() < 4) throw new Error('Truncated APK signature data');
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  /** A uint32-length-prefixed slice. */
  lp() {
    const len = this.u32();
    if (len > this.remaining()) throw new Error('Corrupt length prefix in APK signature data');
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return new Reader(out);
  }
  bytes() {
    return this.buf;
  }
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('Not a ZIP/APK file (no end-of-central-directory record)');
}

function signingBlockPairs(buf) {
  const eocd = findEocd(buf);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset < 32 || cdOffset > buf.length) throw new Error('Invalid central directory offset');
  if (buf.toString('latin1', cdOffset - 16, cdOffset) !== SIG_BLOCK_MAGIC) {
    throw new Error('APK has no v2/v3 signing block (only v1/JAR-signed APKs are not supported)');
  }
  const sizeInFooter = Number(buf.readBigUInt64LE(cdOffset - 24));
  const blockStart = cdOffset - sizeInFooter - 8;
  if (blockStart < 0) throw new Error('Invalid APK signing block size');
  const sizeInHeader = Number(buf.readBigUInt64LE(blockStart));
  if (sizeInHeader !== sizeInFooter) throw new Error('APK signing block sizes disagree');

  const pairs = new Map();
  let p = blockStart + 8;
  const end = cdOffset - 24;
  while (p < end) {
    const len = Number(buf.readBigUInt64LE(p));
    p += 8;
    if (len < 4 || p + len > end) throw new Error('Corrupt APK signing block entry');
    const id = buf.readUInt32LE(p);
    pairs.set(id, buf.subarray(p + 4, p + len));
    p += len;
  }
  return pairs;
}

/** First certificate (DER) of the first signer of a v2/v3 block. */
function firstCertFromSchemeBlock(value) {
  const signers = new Reader(value).lp();
  const signer = signers.lp();
  const signedData = signer.lp();
  signedData.lp(); // digests
  const certs = signedData.lp();
  const cert = certs.lp();
  return cert.bytes();
}

/**
 * @param {Buffer} apk the whole APK file
 * @returns {string} lowercase hex SHA-256 of the signing certificate
 */
function apkSigningCertSha256(apk) {
  const pairs = signingBlockPairs(apk);
  // v3.1 / v3 reflect key rotation; v2 is the original key. Android
  // reports the *current* signer for an installed app, so prefer v3.x.
  const block = pairs.get(V31_ID) || pairs.get(V3_ID) || pairs.get(V2_ID);
  if (!block) throw new Error('APK signing block has no v2/v3 signature');
  const der = firstCertFromSchemeBlock(block);
  return crypto.createHash('sha256').update(der).digest('hex');
}

/** Normalises "AA:BB:..." / "aabb..." to lowercase hex without separators. */
function normalizeFingerprint(fp) {
  if (typeof fp !== 'string') return null;
  const hex = fp.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  return hex.length === 64 ? hex : null;
}

async function fetchApkCert(url, { timeoutMs = 120000, maxBytes = 300 * 1024 * 1024 } = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'quarc-store', Accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error('APK too large');
  const buf = Buffer.from(await res.arrayBuffer());
  return apkSigningCertSha256(buf);
}

module.exports = { apkSigningCertSha256, fetchApkCert, normalizeFingerprint };
