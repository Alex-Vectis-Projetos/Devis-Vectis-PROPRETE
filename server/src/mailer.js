'use strict';

const sec = require('./security');

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const SCOPE = 'openid email https://www.googleapis.com/auth/gmail.send';
const KV_KEY = 'google_gmail_tokens';

class MailError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function loginCodeMessage({ to, code, ttlMinutes }) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#070707;font-family:Arial,Helvetica,sans-serif;color:#f7f3ea">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#070707"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#121110;border:1px solid #6b5316;border-radius:14px">
<tr><td style="padding:28px 28px 8px;font-size:22px;font-weight:700;letter-spacing:.18em;color:#e0aa27">VECTIS</td></tr>
<tr><td style="padding:8px 28px 0;font-size:16px;line-height:1.5">Voici votre code de connexion à l'espace d'administration :</td></tr>
<tr><td align="center" style="padding:22px 28px"><div style="display:inline-block;padding:14px 26px;border:1px solid #e0aa27;border-radius:10px;font-size:34px;font-weight:700;letter-spacing:.3em;color:#f6d36a;background:#0a0a09">${escapeHtml(spaced)}</div></td></tr>
<tr><td style="padding:0 28px 8px;font-size:14px;line-height:1.5;color:#cfc9b9">Ce code est valable ${escapeHtml(ttlMinutes)} minutes et ne peut être utilisé qu'une seule fois.</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:13px;line-height:1.5;color:#a8a396">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message. Personne ne peut se connecter sans ce code.</td></tr>
</table></td></tr></table></body></html>`;
  return {
    subject: 'Votre code de connexion VECTIS',
    html,
    to,
  };
}

/**
 * Gmail API sender using Google OAuth Authorization Code Flow.
 * Only the encrypted refresh token is persisted.
 */
class GmailMailer {
  constructor({ db, config, keys, fetchImpl = globalThis.fetch, now = Date.now }) {
    this.db = db;
    this.config = config;
    this.keys = keys;
    this.fetch = fetchImpl;
    this.now = now;
    this.tokens = null;
    this.access = null;
    this.refreshing = null;
  }

  async init() {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(KV_KEY);
    if (!row) return;
    try {
      this.tokens = sec.decryptJson(this.keys.tokenKey, row.value);
    } catch (_) {
      this.tokens = null;
    }
  }

  configured() {
    return !!(this.config.googleClientId && this.config.googleClientSecret);
  }

  ready() {
    return this.configured() && !!(this.tokens && this.tokens.refreshToken);
  }

  redirectUri() {
    return `${this.config.publicOrigin}/api/mail/oauth/callback`;
  }

  startOAuthFlow({ state }) {
    if (!this.configured()) throw new MailError('mail_not_configured');
    if (!state || typeof state !== 'string') throw new MailError('invalid_oauth_state');

    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: this.config.googleClientId,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString();

    return { authorizationUrl: url.toString() };
  }

  async form(url, params) {
    const res = await this.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    let json = {};
    try {
      json = await res.json();
    } catch (_) {
      // Ignore non-JSON error responses.
    }
    return { ok: res.ok, status: res.status, json };
  }

  persist() {
    if (!this.tokens) {
      this.db.prepare('DELETE FROM kv WHERE key = ?').run(KV_KEY);
      return;
    }
    this.db.prepare(
      'INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(KV_KEY, sec.encryptJson(this.keys.tokenKey, this.tokens), this.now());
  }

  async completeOAuthFlow({ code }) {
    if (!this.configured()) throw new MailError('mail_not_configured');
    if (!code || typeof code !== 'string') throw new MailError('invalid_oauth_code');

    const r = await this.form(GOOGLE_TOKEN, {
      code,
      client_id: this.config.googleClientId,
      client_secret: this.config.googleClientSecret,
      redirect_uri: this.redirectUri(),
      grant_type: 'authorization_code',
    });

    if (!r.ok || !r.json.access_token) {
      throw new MailError('google_oauth_exchange_failed');
    }

    const grantedScopes = String(r.json.scope || '').split(/\s+/);
    if (!grantedScopes.includes('https://www.googleapis.com/auth/gmail.send')) {
      throw new MailError('gmail_send_scope_missing');
    }

    const profileRes = await this.fetch(GOOGLE_USERINFO, {
      headers: { Authorization: `Bearer ${r.json.access_token}` },
    });
    if (!profileRes.ok) throw new MailError('google_profile_unavailable');

    const profile = await profileRes.json();
    const account = String(profile.email || '').trim().toLowerCase();

    if (profile.email_verified !== true || account !== this.config.mailSender) {
      throw new MailError('wrong_account');
    }

    if (!r.json.refresh_token && !(this.tokens && this.tokens.refreshToken)) {
      throw new MailError('no_refresh_token');
    }

    this.tokens = {
      refreshToken: r.json.refresh_token || this.tokens.refreshToken,
      account,
    };
    this.access = {
      token: r.json.access_token,
      expiresAt: this.now() + Number(r.json.expires_in || 3600) * 1000,
    };
    this.persist();

    return { status: 'connected', account };
  }

  async accessToken() {
    if (this.access && this.access.expiresAt - this.now() > 60 * 1000) {
      return this.access.token;
    }
    if (!this.ready()) throw new MailError('mail_not_connected');

    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async refresh() {
    const r = await this.form(GOOGLE_TOKEN, {
      grant_type: 'refresh_token',
      client_id: this.config.googleClientId,
      client_secret: this.config.googleClientSecret,
      refresh_token: this.tokens.refreshToken,
    });

    if (!r.ok || !r.json.access_token) {
      if (r.json.error === 'invalid_grant') {
        this.tokens = null;
        this.access = null;
        this.persist();
        throw new MailError('mail_authorization_revoked');
      }
      throw new MailError('token_refresh_failed');
    }

    this.access = {
      token: r.json.access_token,
      expiresAt: this.now() + Number(r.json.expires_in || 3600) * 1000,
    };

    if (r.json.refresh_token && r.json.refresh_token !== this.tokens.refreshToken) {
      this.tokens = { ...this.tokens, refreshToken: r.json.refresh_token };
      this.persist();
    }

    return this.access.token;
  }

  async sendLoginCode({ to, code, ttlMinutes }) {
    const message = loginCodeMessage({ to, code, ttlMinutes });
    const mime = [
      `To: ${message.to}`,
      `Subject: =?UTF-8?B?${Buffer.from(message.subject, 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(message.html, 'utf8').toString('base64'),
    ].join('\r\n');

    await this._send(mime);
  }

  /** Sends a complete RFC 822 message through the Gmail API. Throws MailError on any failure. */
  async _send(mime) {
    const token = await this.accessToken();
    const res = await this.fetch(GMAIL_SEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url') }),
    });

    if (!res.ok) {
      if (res.status === 401) this.access = null;
      let googleReason = null;
      try {
        const body = await res.json();
        const candidate = body?.error?.errors?.[0]?.reason || body?.error?.status;
        if (typeof candidate === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(candidate)) {
          googleReason = candidate;
        } else if (candidate) {
          googleReason = 'google_api_error';
        }
      } catch (_) {}
      const err = new MailError('gmail_send_failed_' + res.status);
      err.googleReason = googleReason;
      throw err;
    }
  }

  /** Sends one quote e-mail (HTML + optional attachments). `message` comes from quotes.buildQuoteMessages(). */
  async sendQuote(message) {
    await this._send(buildMime(message));
  }
}

/** multipart/mixed message with an HTML body and base64 attachments. Header values never contain line breaks. */
function buildMime({ to, replyTo, subject, html, attachments = [] }) {
  const clean = (v) => String(v).replace(/[\r\n]+/g, ' ').trim();
  const enc = (v) => `=?UTF-8?B?${Buffer.from(clean(v), 'utf8').toString('base64')}?=`;
  const fn = (v) => (/^[\x20-\x7e]+$/.test(clean(v)) ? clean(v) : enc(v));
  const wrap = (buf) => buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
  const boundary = '=_vectis_' + require('node:crypto').randomBytes(12).toString('hex');
  const lines = [`To: ${clean(to)}`];
  if (replyTo) lines.push(`Reply-To: ${clean(replyTo)}`);
  lines.push(`Subject: ${enc(subject)}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '');
  lines.push(`--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(html, 'utf8')));
  for (const a of attachments) {
    const name = clean(a.name).replace(/["\\]/g, '_');
    lines.push(`--${boundary}`, `Content-Type: ${clean(a.mime)}; name="${fn(name)}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${fn(name)}"`, '', wrap(a.data));
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

module.exports = { GmailMailer, MailError, loginCodeMessage, buildMime, SCOPE };
