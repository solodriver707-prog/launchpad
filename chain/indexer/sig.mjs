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
// SESSION_SECRET (≥ 32 random chars) must be set in the server env. On mainnet there is NO fallback: without it sign-in is refused
// (a key derived from other env values is guessable if they leak or are unset). Devnet/local: a derived key keeps dev setups working.
const MAINNET = process.env.CLUSTER === 'mainnet' || /mainnet/.test(process.env.RPC || '');
const GOOD = !!(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32);
// seals made before SESSION_SECRET was set (callouts backed up to IPFS) — accepted ONLY when restoring that backup, never for new posts/likes
const LEGACY_SECRET = createHash('sha256').update('treid-session|' + (process.env.OPS_SECRET || '') + '|' + (process.env.PARTNER || '')).digest('hex');
const SECRET = GOOD ? process.env.SESSION_SECRET : MAINNET ? null : LEGACY_SECRET;
if (!GOOD) console.error(MAINNET ? '!! SESSION_SECRET is missing or shorter than 32 characters — SIGN-IN IS DISABLED on mainnet until it is set (callouts still work with a wallet signature per post)'
  : '!! SESSION_SECRET is missing or shorter than 32 characters — devnet: using a derived key; set it before mainnet');
export const sessionsOn = () => !!SECRET;
export const hmac = (s) => { if (!SECRET) throw new Error('sign-in is unavailable right now — sign the post with your wallet'); return createHmac('sha256', SECRET).update(s).digest('base64url'); };
const macEq = (k, data, given) => { const w = Buffer.from('h:' + createHmac('sha256', k).update(data).digest('base64url')); return w.length === given.length && timingSafeEqual(w, given); };
// { legacy: true } only from the IPFS restore path
export function sealMatches(given, data, { legacy = false } = {}) { const g = Buffer.from(String(given || '')); return (!!SECRET && macEq(SECRET, data, g)) || (legacy && macEq(LEGACY_SECRET, data, g)); }
export const signInMessage = (wallet, ts) => `treid: sign in — ${wallet} — ${ts}`;
export function issueSession({ wallet, ts, sig }) {
  if (!SECRET) throw new Error('sign-in is unavailable right now — sign each post with your wallet instead');
  if (!(Math.abs(Date.now() - +ts) <= 2 * 60e3)) throw new Error('signature expired — try again');
  if (!verifySig(signInMessage(wallet, ts), sig, wallet, ts)) throw new Error('bad signature');
  const exp = Date.now() + 24 * 36e5; return { token: `${wallet}.${exp}.${hmac(wallet + '|' + exp)}`, exp };
}
export function checkSession(token) {   // → wallet, or null
  if (!SECRET) return null;
  const [w, exp, mac] = String(token || '').split('.'); if (!w || !(+exp > Date.now()) || !mac) return null;
  const want = Buffer.from(hmac(w + '|' + exp)), got = Buffer.from(mac); return want.length === got.length && timingSafeEqual(want, got) ? w : null;
}
