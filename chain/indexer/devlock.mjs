// "Locked launch": the creator's launch buy sits in a Jupiter/Meteora Lock escrow (audited program, no cancel, no recipient change).
// Everything here is read from chain — a coin only gets the badge when an escrow with these exact properties exists:
//   recipient = creator, creator (signer who funded it) = coin creator, mint = the coin, cancel mode NONE, update-recipient mode NONE, never cancelled.
import { PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';

export const LOCK_PROGRAM = new PublicKey('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn');
const DISC = createHash('sha256').update('account:VestingEscrow').digest().subarray(0, 8);
const u64 = (b, o) => b.readBigUInt64LE(o);

// one escrow account → its schedule and how much is still inside (raw units, 6 decimals)
export function decodeEscrow(pubkey, data) {
  if (data.length < 208 || !data.subarray(0, 8).equals(DISC)) return null;
  const pk = (o) => new PublicKey(data.subarray(o, o + 32)).toBase58();
  const e = { escrow: pubkey, recipient: pk(8), mint: pk(40), creator: pk(72), updMode: data[137], cancelMode: data[138],
    cliff: Number(u64(data, 144)), freq: Number(u64(data, 152)), cliffAmt: u64(data, 160), per: u64(data, 168), n: Number(u64(data, 176)),
    claimed: u64(data, 184), start: Number(u64(data, 192)), cancelledAt: Number(u64(data, 200)) };
  e.total = e.cliffAmt + e.per * BigInt(e.n); e.end = e.cliff + e.n * e.freq;
  return e;
}
// re-work an escrow's schedule for "now" (the cache can be minutes old; unlocking moves with the clock)
function at(e, now) {
  const periods = now < e.cliff || !e.freq ? 0 : Math.min(e.n, Math.floor((now - e.cliff) / e.freq));
  const unlocked = now < e.cliff ? 0n : e.cliffAmt + e.per * BigInt(periods);
  return { ...e, unlocked, locked: e.total - unlocked, inside: e.total - e.claimed };
}
function summary(list, now = Math.floor(Date.now() / 1000)) {
  if (!list || !list.length) return null; list = list.map((e) => at(e, now));
  const sum = (k) => Number(list.reduce((s, e) => s + e[k], 0n)) / 1e6, start = list.reduce((m, e) => Math.min(m, e.start), Infinity), end = list.reduce((m, e) => Math.max(m, e.end), 0);
  return { escrows: list.map((e) => e.escrow), total: sum('total'), locked: sum('locked'), inside: sum('inside'), claimed: sum('claimed'),
    start, unlockStart: list.reduce((m, e) => Math.min(m, e.cliff), Infinity), unlockEnd: end, days: Math.round((end - start) / 86400) };
}
// all valid escrows the coin creator made for their own coin (raw), and the same added up
export async function escrowsOf(conn, mint, creator) {
  const accs = await conn.getProgramAccounts(LOCK_PROGRAM, { commitment: 'confirmed', filters: [
    { memcmp: { offset: 0, bytes: bs58.encode(DISC) } }, { memcmp: { offset: 8, bytes: creator } }, { memcmp: { offset: 40, bytes: mint } }] });
  const list = [];
  for (const a of accs) {
    const e = decodeEscrow(a.pubkey.toBase58(), a.account.data);
    if (!e || e.recipient !== creator || e.creator !== creator || e.mint !== mint || e.cancelMode !== 0 || e.updMode !== 0 || e.cancelledAt !== 0 || e.total <= 0n) continue;
    list.push(e);
  }
  return list;
}
export const readLocks = async (conn, mint, creator) => summary(await escrowsOf(conn, mint, creator));

// cached per coin, refreshed in the background (stats() is synchronous). Only coins launched with the lock flag (lk= in the metadata URI) are scanned.
export function lockCache(conn) {
  const C = new Map(); let run = 0;
  const wants = (c) => { try { return !!new URL(c.uri).searchParams.get('lk'); } catch { return false; } };
  function get(c, fresh = false) {
    if (!c || !wants(c)) return null;
    const h = C.get(c.mint), age = h ? Date.now() - h.ts : Infinity, ttl = fresh ? 30e3 : 5 * 60e3;
    if (age > ttl && !h?.busy && run < 3) {
      const e = h || { ts: 0, list: null }; e.busy = true; C.set(c.mint, e); run++;
      escrowsOf(conn, c.mint, c.creator).then((list) => C.set(c.mint, { ts: Date.now(), list })).catch(() => { e.busy = false; e.ts = Date.now() - ttl + 20e3; }).finally(() => { run--; });
    }
    return summary(C.get(c.mint)?.list);
  }
  async function fresh(c) { if (!wants(c)) return null; const list = await escrowsOf(conn, c.mint, c.creator); C.set(c.mint, { ts: Date.now(), list }); return summary(list); }
  return { get, wants, fresh, bust: (mint) => C.delete(mint) };
}
