'use strict';

const crypto = require('node:crypto');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Derives independent keys from the single secret in api.env. */
function deriveKeys(secret) {
  const derive = (label) =>
    Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), Buffer.from('devis-vectis:' + label), 32));
  return {
    codePepper: derive('login-code'),
    csrfKey: derive('csrf'),
    ipPepper: derive('ip-hash'),
    tokenKey: derive('mail-token-store'),
  };
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Six-digit code from the OS CSPRNG, zero padded. */
function randomCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(String(value)).digest('hex');
}

/** Login codes are stored only as an HMAC bound to the e-mail address. */
function hashCode(pepper, email, code) {
  return hmac(pepper, `${email}\u0000${code}`);
}

function hashIp(pepper, ip) {
  return hmac(pepper, ip || 'unknown').slice(0, 32);
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** AES-256-GCM. Layout: iv(12) | tag(16) | ciphertext, base64. */
function encryptJson(key, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function decryptJson(key, blob) {
  const raw = Buffer.from(blob, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const dec = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

module.exports = {
  deriveKeys,
  normalizeEmail,
  randomCode,
  randomToken,
  sha256,
  hmac,
  hashCode,
  hashIp,
  safeEqualHex,
  encryptJson,
  decryptJson,
};
