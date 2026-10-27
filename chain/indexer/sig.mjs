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
