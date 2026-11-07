'use strict';

const sec = require('./security');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access';
const KV_KEY = 'ms_graph_tokens';
const DEFAULT_VERIFICATION_URI = 'https://www.microsoft.com/link';
const VERIFICATION_HOSTS = new Set(['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com', 'login.live.com']);

/** Only an https page on a Microsoft sign-in host may be shown to the administrator. */
function safeVerificationUri(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol === 'https:' && !u.username && !u.password && !u.port && VERIFICATION_HOSTS.has(u.hostname)) return u.toString();
  } catch (_) {
    /* fall through */
  }
  return DEFAULT_VERIFICATION_URI;
}

class MailError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: to } }],
  };
}

/**
 * Sends mail through Microsoft Graph with a delegated OAuth token (Mail.Send, offline_access).
 * No account password is ever stored. Only an encrypted refresh token lives in the database.
 */
class GraphMailer {
  constructor({ db, config, keys, fetchImpl = globalThis.fetch, now = Date.now }) {
    this.db = db;
    this.config = config;
    this.keys = keys;
    this.fetch = fetchImpl;
    this.now = now;
    this.tokens = null; // { refreshToken, account }
    this.access = null; // { token, expiresAt }
    this.pending = null; // { deviceCode, expiresAt, interval }
    this.refreshing = null;
  }

  async init() {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(KV_KEY);
    if (!row) return;
    try {
      this.tokens = sec.decryptJson(this.keys.tokenKey, row.value);
    } catch (_) {
      this.tokens = null; // unreadable (key changed): the mailbox has to be connected again
    }
  }

  configured() {
    return !!this.config.msClientId;
  }

  ready() {
    return this.configured() && !!(this.tokens && this.tokens.refreshToken);
  }

  endpoint(name) {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.config.msTenant)}/oauth2/v2.0/${name}`;
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
      /* non JSON error page */
    }
    return { ok: res.ok, status: res.status, json };
  }

  persist() {
    if (!this.tokens) {
      this.db.prepare('DELETE FROM kv WHERE key = ?').run(KV_KEY);
      return;
    }
    this.db
      .prepare(
        'INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      )
      .run(KV_KEY, sec.encryptJson(this.keys.tokenKey, this.tokens), this.now());
  }

  // ----- one-time authorization of the mailbox (device code flow) -----

  async startDeviceFlow() {
    if (!this.configured()) throw new MailError('mail_not_configured');
    // A pending authorization is never replaced: asking again returns the same code until it expires.
    if (this.pending && this.now() < this.pending.expiresAt) {
      return {
        userCode: this.pending.userCode,
        verificationUri: this.pending.verificationUri,
        expiresIn: Math.max(1, Math.round((this.pending.expiresAt - this.now()) / 1000)),
        interval: this.pending.interval,
        resumed: true,
      };
    }
    const r = await this.form(this.endpoint('devicecode'), { client_id: this.config.msClientId, scope: SCOPE });
    if (!r.ok || !r.json.device_code) throw new MailError('device_flow_unavailable');
    this.pending = {
      deviceCode: r.json.device_code,
      userCode: String(r.json.user_code || ''),
      verificationUri: safeVerificationUri(r.json.verification_uri),
      expiresAt: this.now() + Number(r.json.expires_in || 900) * 1000,
      interval: Number(r.json.interval || 5),
      lastPollAt: this.now(),
    };
    return {
      userCode: this.pending.userCode,
      verificationUri: this.pending.verificationUri,
      expiresIn: Number(r.json.expires_in || 900),
      interval: this.pending.interval,
      resumed: false,
    };
  }

  async pollDeviceFlow() {
    if (!this.pending) return { status: 'idle' };
    if (this.now() > this.pending.expiresAt) {
      this.pending = null;
      return { status: 'error', reason: 'expired' };
    }
    // Never poll Microsoft faster than the interval it asked for, whatever the clients do.
    if (this.now() - this.pending.lastPollAt < this.pending.interval * 1000) return { status: 'pending' };
    this.pending.lastPollAt = this.now();
    const r = await this.form(this.endpoint('token'), {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: this.config.msClientId,
      device_code: this.pending.deviceCode,
    });
    if (!r.ok) {
      const err = r.json.error;
      if (err === 'authorization_pending' || err === 'slow_down') {
        if (err === 'slow_down') this.pending.interval += 5;
        return { status: 'pending' };
      }
      this.pending = null;
      return { status: 'error', reason: err || 'token_error' };
    }

    const accessToken = r.json.access_token;
    const me = await this.fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!me.ok) {
      this.pending = null;
      return { status: 'error', reason: 'profile_unavailable' };
    }
    const profile = await me.json();
    const account = String(profile.mail || profile.userPrincipalName || '').toLowerCase();
    if (!r.json.refresh_token || account !== this.config.mailSender) {
      this.pending = null;
      return { status: 'error', reason: account !== this.config.mailSender ? 'wrong_account' : 'no_refresh_token' };
    }

    this.tokens = { refreshToken: r.json.refresh_token, account };
    this.access = { token: accessToken, expiresAt: this.now() + Number(r.json.expires_in || 3600) * 1000 };
    this.persist();
    this.pending = null;
    return { status: 'connected', account };
  }

  // ----- sending -----

  async accessToken() {
    if (this.access && this.access.expiresAt - this.now() > 60 * 1000) return this.access.token;
    if (!this.ready()) throw new MailError('mail_not_connected');
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async refresh() {
    const r = await this.form(this.endpoint('token'), {
      grant_type: 'refresh_token',
      client_id: this.config.msClientId,
      refresh_token: this.tokens.refreshToken,
      scope: SCOPE,
    });
    if (!r.ok) {
      if (r.json.error === 'invalid_grant') {
        this.tokens = null;
        this.access = null;
        this.persist();
        throw new MailError('mail_authorization_revoked');
      }
      throw new MailError('token_refresh_failed');
    }
    this.access = { token: r.json.access_token, expiresAt: this.now() + Number(r.json.expires_in || 3600) * 1000 };
    if (r.json.refresh_token && r.json.refresh_token !== this.tokens.refreshToken) {
      this.tokens = { ...this.tokens, refreshToken: r.json.refresh_token };
      this.persist();
    }
    return this.access.token;
  }

  async sendLoginCode({ to, code, ttlMinutes }) {
    const token = await this.accessToken();
    const res = await this.fetch(`${GRAPH}/me/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: loginCodeMessage({ to, code, ttlMinutes }), saveToSentItems: false }),
    });
    if (res.status !== 202) {
      if (res.status === 401) this.access = null;
      throw new MailError('graph_send_failed_' + res.status);
    }
  }
}

module.exports = { GraphMailer, MailError, loginCodeMessage, safeVerificationUri, SCOPE };
