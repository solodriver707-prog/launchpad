// signed wallet messages carry the site they were signed on (SIWS-style first line), so a signature made on a look-alike
// site doesn't work here. Older messages without the line are accepted only if they were signed before LEGACY_SIG_UNTIL.
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
export const SITES = (process.env.SITE_DOMAINS || 'treid.fun,www.treid.fun,solodriver707-prog.github.io,localhost:8123,127.0.0.1:8123').split(',').map((s) => s.trim()).filter(Boolean);
const LEGACY_UNTIL = Date.parse(process.env.LEGACY_SIG_UNTIL || '2026-11-01T00:00:00Z');
export const signedText = (domain, msg) => `${domain} wants you to sign:\n${msg}`;
export function verifySig(msg, sig, wallet, ts) {
  let s, k; try { s = bs58.decode(String(sig || '')); k = new PublicKey(wallet).toBytes(); } catch { return false; }
  const ok = (m) => { try { return ed25519.verify(s, new TextEncoder().encode(m), k); } catch { return false; } };
  if (SITES.some((d) => ok(signedText(d, msg)))) return true;
  return Number(ts) < LEGACY_UNTIL && ok(msg);
}

// ---- sign in once: one wallet signature → a 24 h session token (HMAC by the server), so posting doesn't need a wallet popup each time ----
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
// SESSION_SECRET (≥ 32 random chars) must be set in the server env; the derived fallback only keeps old setups running and is reported loudly
const SECRET = process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 ? process.env.SESSION_SECRET : createHash('sha256').update('treid-session|' + (process.env.OPS_SECRET || '') + '|' + (process.env.PARTNER || '')).digest('hex');
if (!(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32)) console.error('!! SESSION_SECRET is missing or shorter than 32 characters — set it in the server env (sign-in tokens use a derived fallback until then)');
export const hmac = (s) => createHmac('sha256', SECRET).update(s).digest('base64url');
// seals made before SESSION_SECRET was set (callouts backed up to IPFS) still verify after it changes
const LEGACY_SECRET = createHash('sha256').update('treid-session|' + (process.env.OPS_SECRET || '') + '|' + (process.env.PARTNER || '')).digest('hex');
export function sealMatches(given, data) { const g = Buffer.from(String(given || '')); return [SECRET, LEGACY_SECRET].some((k) => { const w = Buffer.from('h:' + createHmac('sha256', k).update(data).digest('base64url')); return w.length === g.length && timingSafeEqual(w, g); }); }
export const signInMessage = (wallet, ts) => `treid: sign in — ${wallet} — ${ts}`;
export function issueSession({ wallet, ts, sig }) {
  if (!(Math.abs(Date.now() - +ts) <= 2 * 60e3)) throw new Error('signature expired — try again');
  if (!verifySig(signInMessage(wallet, ts), sig, wallet, ts)) throw new Error('bad signature');
  const exp = Date.now() + 24 * 36e5; return { token: `${wallet}.${exp}.${hmac(wallet + '|' + exp)}`, exp };
}
export function checkSession(token) {   // → wallet, or null
  const [w, exp, mac] = String(token || '').split('.'); if (!w || !(+exp > Date.now()) || !mac) return null;
  const want = Buffer.from(hmac(w + '|' + exp)), got = Buffer.from(mac); return want.length === got.length && timingSafeEqual(want, got) ? w : null;
}
