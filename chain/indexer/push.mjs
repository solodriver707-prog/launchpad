// Web Push (RFC 8030 / 8291 aes128gcm / 8292 VAPID) with node:crypto only — no extra dependency on the server that holds the hot key.
// Notifications: big moves + graduation of watchlist coins, your holder rewards, callouts from wallets you follow.
// Set VAPID_PUBLIC + VAPID_PRIVATE (base64url, from `npx web-push generate-vapid-keys`) and VAPID_SUBJECT (mailto: or https:) in Render.
import crypto from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// only real push services (the endpoint comes from a browser — never let it point the server anywhere else)
const PUSH_HOST = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com|wns2-[a-z0-9-]+\.notify\.windows\.com)$/i;
export function okEndpoint(ep) { try { const u = new URL(ep); return u.protocol === 'https:' && !u.port && PUSH_HOST.test(u.hostname) && ep.length < 1000; } catch { return false; } }

// RFC 8291: encrypt one message for one subscription (single record, aes128gcm)
export function encrypt(payload, p256dh, auth, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const ua = unb64u(p256dh), sec = unb64u(auth); if (ua.length !== 65 || ua[0] !== 4 || sec.length < 16) throw new Error('bad subscription keys');
  const e = ecdh || crypto.createECDH('prime256v1'); if (!ecdh) e.generateKeys(); const as = e.getPublicKey(), shared = e.computeSecret(ua);
  const ikm = hmac(hmac(sec, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm), cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce), ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, as, ct]);
}
// the matching decrypt (used by the self-test only)
export function decrypt(body, uaEcdh, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], as = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen), ua = uaEcdh.getPublicKey(), sec = unb64u(auth);
  const ikm = hmac(hmac(sec, uaEcdh.computeSecret(as)), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm), cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]); let i = pt.length - 1; while (i >= 0 && pt[i] === 0) i--; if (pt[i] !== 2) throw new Error('bad padding'); return pt.subarray(0, i).toString();
}
export function vapidKey(pub, priv) {
  const P = unb64u(pub), d = unb64u(priv); if (P.length !== 65 || P[0] !== 4 || d.length !== 32) throw new Error('VAPID keys must be base64url: public 65 bytes, private 32 bytes');
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(P.subarray(1, 33)), y: b64u(P.subarray(33)), d: b64u(d) }, format: 'jwk' });
}
export function vapidAuth(endpoint, key, pub, subject) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const data = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' + b64u(JSON.stringify({ aud, exp: now + 12 * 3600, sub: subject }));
  return 'vapid t=' + data + '.' + b64u(crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' })) + ', k=' + pub;
}

export function startPush({ q, q1, run, pub, priv, subject, log = console.log }) {
  run('CREATE TABLE IF NOT EXISTS pushsub(ep TEXT PRIMARY KEY, p256dh TEXT, auth TEXT, wallet TEXT, watch TEXT, follow TEXT, moves INT, rewards INT, callouts INT, at INT)');
  let key = null; try { if (pub && priv) key = vapidKey(pub, priv); } catch (e) { log('!! push disabled:', e.message); }
  if (!key) { if (!pub) log('push   off (set VAPID_PUBLIC / VAPID_PRIVATE / VAPID_SUBJECT to turn on notifications)'); return { on: false, publicKey: null, save() { throw new Error('notifications are not enabled on this server'); }, drop() {}, onEvent() {} }; }
  const SUBJ = /^(mailto:|https:)/.test(subject || '') ? subject : 'mailto:hello@treid.fun';
  const isAddr = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s), addrs = (a, n) => [...new Set((Array.isArray(a) ? a : []).map(String).filter(isAddr))].slice(0, n);

  function save(b) {
    const s = b && b.sub, ep = String(s?.endpoint || ''), k = s?.keys || {};
    if (!okEndpoint(ep)) throw new Error('unsupported push service'); encrypt('x', k.p256dh, k.auth);   // validates the keys
    const wallet = isAddr(String(b.wallet || '')) ? String(b.wallet) : null;
    if (!q1('SELECT 1 FROM pushsub WHERE ep=?', ep) && q1('SELECT COUNT(*) n FROM pushsub').n >= 200000) throw new Error('notifications are full right now');
    run('INSERT OR REPLACE INTO pushsub(ep,p256dh,auth,wallet,watch,follow,moves,rewards,callouts,at) VALUES(?,?,?,?,?,?,?,?,?,?)', ep, String(k.p256dh), String(k.auth), wallet,
      JSON.stringify(addrs(b.watch, 300)), JSON.stringify(addrs(b.follow, 300)), b.moves === false ? 0 : 1, b.rewards === false || !wallet ? 0 : 1, b.callouts === false ? 0 : 1, Date.now());
    return { ok: true };
  }
  function drop(ep) { run('DELETE FROM pushsub WHERE ep=?', String(ep || '')); return { ok: true }; }

  // sending: a small queue (4 at a time); a subscription the push service says is gone (404/410) is deleted
  const queue = []; let active = 0;
  function send(row, msg) { if (queue.length < 20000) queue.push([row, msg]); pump(); }
  function pump() { while (active < 4 && queue.length) { const [row, msg] = queue.shift(); active++; deliver(row, msg).catch(() => {}).finally(() => { active--; pump(); }); } }
  async function deliver(row, msg) {
    const body = encrypt(JSON.stringify(msg), row.p256dh, row.auth);
    const r = await fetch(row.ep, { method: 'POST', body, signal: AbortSignal.timeout(10e3), redirect: 'error',
      headers: { TTL: String(msg.ttl || 6 * 3600), Urgency: msg.urgency || 'normal', ...(msg.topic ? { Topic: String(msg.topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidAuth(row.ep, key, pub, SUBJ) } });
    if (r.status === 404 || r.status === 410) drop(row.ep); else if (r.status >= 400) log('push  ', r.status, new URL(row.ep).hostname);
  }
  const sym = (mint) => q1('SELECT symbol FROM coins WHERE mint=?', mint)?.symbol || mint.slice(0, 4);
  const watchers = (mint) => q("SELECT * FROM pushsub WHERE moves=1 AND instr(watch, ?) > 0 LIMIT 20000", '"' + mint + '"');
  const fmtUsd = (v) => '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0));

  // watchlist moves: ±25% from the last level we told people about (per coin, at most every 20 min); a stale level just resets
  const anchor = new Map(), MOVE = +(process.env.PUSH_MOVE_PCT || 25) / 100;
  function onTrade(ev) {
    const mc = +ev.mcap_usd || 0; if (!(mc > 0)) return; const a = anchor.get(ev.mint), now = Date.now();
    if (!a || now - a.at > 6 * 36e5) { anchor.set(ev.mint, { mc, at: now }); return; }
    const ch = mc / a.mc - 1; if (Math.abs(ch) < MOVE || now - a.at < 20 * 60e3) return;
    anchor.set(ev.mint, { mc, at: now }); const s = sym(ev.mint), up = ch > 0;
    for (const row of watchers(ev.mint)) send(row, { title: (up ? '🚀 $' : '📉 $') + s + ' ' + (up ? '+' : '') + (ch * 100).toFixed(0) + '%', body: 'Market cap ' + fmtUsd(mc) + ' · on your watchlist', path: '#/coin/' + ev.mint, tag: 'mv-' + ev.mint, topic: 'mv' + ev.mint.slice(0, 20) });
  }
  function onGrad(ev) { const s = sym(ev.mint); for (const row of watchers(ev.mint)) send(row, { title: '🎓 $' + s + ' graduated', body: 'It now trades on Meteora', path: '#/coin/' + ev.mint, tag: 'gr-' + ev.mint }); }
  function onCallout(ev) {
    if (!isAddr(String(ev.wallet || '')) || ev.reply != null) return; const s = sym(ev.mint), txt = String(ev.text || '').replace(/\s+/g, ' ').slice(0, 140) || '📷 image';
    for (const row of q("SELECT * FROM pushsub WHERE callouts=1 AND instr(follow, ?) > 0 LIMIT 20000", '"' + ev.wallet + '"')) if (row.wallet !== ev.wallet)
      send(row, { title: '🔥 ' + ev.wallet.slice(0, 4) + '…' + ev.wallet.slice(-4) + ' called $' + s, body: txt, path: '#/callout/' + ev.mint + '/' + ev.id, tag: 'co-' + ev.id });
  }
  // holder rewards: read from the payout receipts table (never touches the money code); one notification per wallet per round
  let lastTs = Date.now();
  setInterval(() => { try {
    const rows = q('SELECT h.wallet, h.mint, h.token, h.amt, h.dec, h.ts FROM hpay h WHERE h.ts > ? ORDER BY h.ts LIMIT 5000', lastTs); if (!rows.length) return; lastTs = rows[rows.length - 1].ts;
    const by = new Map(); for (const r of rows) { const a = by.get(r.wallet) || []; a.push(r); by.set(r.wallet, a); }
    for (const [w, list] of by) { const subs = q('SELECT * FROM pushsub WHERE rewards=1 AND wallet=? LIMIT 20', w); if (!subs.length) continue;
      const r0 = list[0], tok = r0.token === 'So11111111111111111111111111111111111111112' ? 'SOL' : '$' + sym(r0.token), amt = list.filter((x) => x.token === r0.token).reduce((s, x) => s + x.amt / 10 ** (x.dec ?? 6), 0);
      const msg = { title: '🎁 Holder rewards received', body: (amt >= 1 ? amt.toLocaleString('en', { maximumFractionDigits: 2 }) : amt.toPrecision(3)) + ' ' + tok + ' from $' + sym(r0.mint) + (list.length > 1 && new Set(list.map((x) => x.mint)).size > 1 ? ' and more' : ''), path: '#/coin/' + r0.mint, tag: 'rw-' + w };
      for (const row of subs) send(row, msg); }
  } catch {} }, 60e3);
  function onEvent(ev) { try { if (ev.type === 'trade') onTrade(ev); else if (ev.type === 'grad') onGrad(ev); else if (ev.type === 'callout') onCallout(ev); } catch (e) { log('push err', String(e?.message || e).slice(0, 100)); } }
  log('push   on,', q1('SELECT COUNT(*) n FROM pushsub').n, 'subscriptions');
  return { on: true, publicKey: pub, save, drop, onEvent, send };
}
