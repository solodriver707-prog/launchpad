// "Sign in with X" for claiming creator fees sent to an X handle — instead of a public post.
// Plain OAuth 2.0 (authorization code + PKCE) straight with X: no third party in between.
// Render env (never in the repo): X_CLIENT_ID, X_CLIENT_SECRET. Callback to register in the X developer app: <PUBLIC_URL>/api/xauth/cb
// Flow: the wallet signs "treid: link X @handle to <wallet>" (checked by rewards.linkCheck) → we send the browser to X →
// X sends it back here with a code → we ask X who signed in → if it is @handle, rewards.linkCommit stamps the link on-chain.
import { randomBytes, createHash } from 'node:crypto';
import { fetchT } from './txutil.mjs';

const CID = process.env.X_CLIENT_ID || '', SEC = process.env.X_CLIENT_SECRET || '';
export const xauthOn = () => !!(CID && SEC);
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pend = new Map();   // state → { L, verifier, ret, exp } (10 min, in memory: a restart just means "try again")
const TTL = 10 * 60e3;
const sweep = () => { const now = Date.now(); for (const [k, v] of pend) if (v.exp < now) pend.delete(k); };

// where the browser may be sent back to: only our own site (no open redirect)
export function retOk(ret, sites) {
  try { const r = new URL(String(ret)); if (r.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(r.hostname)) return null;
    if (!sites.some((d) => d === r.host)) return null; const h = /^#\/coin\/[A-Za-z0-9]{1,60}$/.test(r.hash) ? r.hash : ''; return { base: r.origin + r.pathname, hash: h }; } catch { return null; }
}

export function xStart({ L, ret, cb }) {
  if (!xauthOn()) throw new Error('Sign in with X is not set up yet — use a post instead');
  sweep(); if (pend.size > 2000) throw new Error('too many sign-ins right now — try again in a few minutes');
  const state = b64u(randomBytes(24)), verifier = b64u(randomBytes(48)), challenge = b64u(createHash('sha256').update(verifier).digest());
  pend.set(state, { L, verifier, ret, exp: Date.now() + TTL });
  const q = new URLSearchParams({ response_type: 'code', client_id: CID, redirect_uri: cb, scope: 'users.read tweet.read', state, code_challenge: challenge, code_challenge_method: 'S256' });
  return 'https://x.com/i/oauth2/authorize?' + q.toString();
}

// → { ret, L, handle } on success; throws with a short public reason otherwise (ret attached when known)
export async function xFinish({ state, code, error, cb }) {
  const P = pend.get(String(state || '')); pend.delete(String(state || ''));
  if (!P || P.exp < Date.now()) throw Object.assign(new Error('expired'), { ret: P?.ret });
  if (error || !code) throw Object.assign(new Error('cancelled'), { ret: P.ret });
  const basic = Buffer.from(encodeURIComponent(CID) + ':' + encodeURIComponent(SEC)).toString('base64');
  const tr = await fetchT('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + basic },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: String(code), redirect_uri: cb, code_verifier: P.verifier, client_id: CID }).toString() }, 12e3).catch(() => null);
  const tj = tr && tr.ok ? await tr.json().catch(() => null) : null; if (!tj?.access_token) throw Object.assign(new Error('x-failed'), { ret: P.ret });
  const ur = await fetchT('https://api.x.com/2/users/me', { headers: { authorization: 'Bearer ' + tj.access_token } }, 12e3).catch(() => null);
  const uj = ur && ur.ok ? await ur.json().catch(() => null) : null;
  // we only needed the username: give the token straight back
  fetchT('https://api.x.com/2/oauth2/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + basic }, body: new URLSearchParams({ token: tj.access_token, token_type_hint: 'access_token', client_id: CID }).toString() }, 8e3).catch(() => {});
  const who = String(uj?.data?.username || ''); if (!who) throw Object.assign(new Error('x-failed'), { ret: P.ret });
  if (who.toLowerCase() !== P.L.handle.toLowerCase()) throw Object.assign(new Error('wrong-account'), { ret: P.ret, who });
  return { ret: P.ret, L: P.L, handle: who };
}
