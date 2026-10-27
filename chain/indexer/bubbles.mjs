// bubble map: who funded each top holder (first SOL that ever arrived in the wallet), clustered into connected groups.
// Funders never change, so every lookup is stored forever; a slow background queue fills them in (a few RPC calls per wallet).
import { PublicKey } from '@solana/web3.js';

const SYS = '11111111111111111111111111111111';
export function startBubbles({ conn, q, q1, run, holdersCached }) {
  run(`CREATE TABLE IF NOT EXISTS funders(wallet TEXT PRIMARY KEY, funder TEXT, sol REAL, ts INT, kind TEXT, at INT)`);   // kind: ok | old (too many txs to find the first) | none
  run(`CREATE TABLE IF NOT EXISTS hubs(addr TEXT PRIMARY KEY, busy INT, at INT)`);   // busy funders (exchanges, bots) never link wallets together
  const queue = [], queued = new Set(); let active = 0;
  const CONC = 2, MAX_TOP = 100;

  async function firstFunding(w) {
    const sigs = await conn.getSignaturesForAddress(new PublicKey(w), { limit: 1000 });
    if (sigs.length >= 1000) return { kind: 'old' };   // an established wallet — its first funding is too far back to matter
    const oldest = sigs.filter((s) => !s.err).reverse().slice(0, 4);   // the first few successful txs, oldest first
    for (const s of oldest) {
      const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
      if (!tx) continue;
      const ixs = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions || []).flatMap((x) => x.instructions)];
      for (const ix of ixs) { const pi = ix.parsed; if (ix.programId?.toBase58?.() !== SYS || !pi || !/^transfer/.test(pi.type)) continue;
        if (pi.info?.destination === w && pi.info.source && pi.info.source !== w) return { kind: 'ok', funder: pi.info.source, sol: (pi.info.lamports || 0) / 1e9, ts: (tx.blockTime || 0) * 1000 }; }
    }
    return { kind: 'none' };
  }
  async function isHub(a) {
    const h = q1('SELECT busy FROM hubs WHERE addr=?', a); if (h) return !!h.busy;
    let busy = 0; try { busy = (await conn.getSignaturesForAddress(new PublicKey(a), { limit: 1000 })).length >= 1000 ? 1 : 0; } catch { return false; }
    run('INSERT OR REPLACE INTO hubs(addr,busy,at) VALUES(?,?,?)', a, busy, Date.now()); return !!busy;
  }
  function pump() {
    while (active < CONC && queue.length) {
      const w = queue.shift(); active++;
      firstFunding(w).then(async (r) => { if (r.kind === 'ok') await isHub(r.funder);
        run('INSERT OR REPLACE INTO funders(wallet,funder,sol,ts,kind,at) VALUES(?,?,?,?,?,?)', w, r.funder || null, r.sol || 0, r.ts || 0, r.kind, Date.now()); })
        .catch(() => {}).finally(() => { active--; queued.delete(w); setTimeout(pump, 250); });
    }
  }
  function want(w) { if (queued.has(w) || queue.length > 3000) return; queued.add(w); queue.push(w); pump(); }

  async function map(mint) {
    const coin = q1('SELECT creator, created_slot FROM coins WHERE mint=?', mint); if (!coin) return null;
    const all = await holdersCached(mint), hs = all.filter((h) => !h.curve).slice(0, MAX_TOP), set = new Set(hs.map((h) => h.wallet));
    const fund = new Map(); let missing = 0;
    for (const h of hs) { const f = q1('SELECT funder, sol, ts, kind FROM funders WHERE wallet=?', h.wallet); if (f) fund.set(h.wallet, f); else { missing++; want(h.wallet); } }
    const hubs = new Map(), hubOf = (a) => { if (!hubs.has(a)) hubs.set(a, !!q1('SELECT busy FROM hubs WHERE addr=?', a)?.busy); return hubs.get(a); };
    // union-find over the evidence
    const par = new Map(hs.map((h) => [h.wallet, h.wallet])), find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; }, join = (a, b) => { a = find(a); b = find(b); if (a !== b) par.set(a, b); };
    const links = [], byFunder = new Map();
    for (const [w, f] of fund) { if (f.kind !== 'ok' || !f.funder) continue;
      if (set.has(f.funder)) { links.push({ a: f.funder, b: w, k: 'fund', sol: f.sol }); join(f.funder, w); continue; }   // funded straight by another holder
      if (hubOf(f.funder)) continue; (byFunder.get(f.funder) || byFunder.set(f.funder, []).get(f.funder)).push(w); }
    for (const [src, ws] of byFunder) if (ws.length > 1) { for (let i = 1; i < ws.length; i++) { links.push({ a: ws[0], b: ws[i], k: 'shared', via: src }); join(ws[0], ws[i]); } }
    const bun = q("SELECT wallet, slot FROM trades WHERE mint=? AND bundle=1 AND side='buy'", mint), bySlot = new Map();
    for (const b of bun) if (set.has(b.wallet)) (bySlot.get(b.slot) || bySlot.set(b.slot, []).get(b.slot)).push(b.wallet);
    for (const [, ws] of bySlot) { const u = [...new Set(ws)]; for (let i = 1; i < u.length; i++) { links.push({ a: u[0], b: u[i], k: 'bundle' }); join(u[0], u[i]); } }
    const snip = new Set(q("SELECT DISTINCT wallet FROM trades WHERE mint=? AND sniper=1", mint).map((x) => x.wallet));
    const groups = new Map(); for (const h of hs) { const r = find(h.wallet); (groups.get(r) || groups.set(r, []).get(r)).push(h.wallet); }
    let cid = 0; const cl = new Map(), clusters = [];
    for (const [, ws] of [...groups].sort((x, y) => y[1].length - x[1].length)) if (ws.length > 1) { const id = ++cid; ws.forEach((w) => cl.set(w, id)); clusters.push({ id, n: ws.length, pct: ws.reduce((a, w) => a + (hs.find((h) => h.wallet === w)?.pct || 0), 0) }); }
    return { mint, done: missing === 0, missing, queue: queue.length,
      holders: hs.map((h) => { const f = fund.get(h.wallet); return { w: h.wallet, pct: h.pct, dev: h.wallet === coin.creator, sn: snip.has(h.wallet), c: cl.get(h.wallet) || 0, f: f ? { k: f.kind, by: f.funder || null, sol: f.sol || 0, ts: f.ts || 0, hub: f.funder ? hubOf(f.funder) : false } : null }; }),
      links, clusters: clusters.sort((x, y) => y.pct - x.pct) };
  }
  return { map };
}
