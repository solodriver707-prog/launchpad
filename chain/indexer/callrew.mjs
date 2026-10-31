// Callout rewards. A buy made on treid from a callout carries the memo "treid:co:<callout id>" inside the buyer's OWN signed
// transaction (nobody can add it to someone else's trade afterwards). The caller earns CO_SHARE of treid's fee on that trade,
// paid daily in SOL from the ops wallet.
// It is funded only by fees the trade really paid: wash trading to farm it always loses (a 1% fee paid, ~0.1% back).
// Ledger: earnings = coattr rows; payouts = ops transactions with memo "treid:copay:<wallet>:<lamports>:<day>" (rlog kind 'copay',
// rebuilt from chain on startup like every other ops payout), so a restart never pays twice.
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { sendTx, getTxRetry } from './txutil.mjs';
import { HALT, halt, withLock, canWrite } from './lock.mjs';

const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const memoIx = (s) => new TransactionInstruction({ keys: [], programId: MEMO, data: Buffer.from(s) });
export const CO_SHARE = Math.min(0.5, Math.max(0, +(process.env.CALLOUT_SHARE_PCT ?? 25) / 100));   // share of TREID'S fee (not of the trade)
const WINDOW_MS = 72 * 3600e3;   // a callout earns from buys made within 72h of posting it
const PAY_USD = 1, PER_TX = 5, KEEP = 0.2e9;
const day = (ts) => new Date(ts).toISOString().slice(0, 10);

// the callout id from the trade's own memo (top-level instruction of the memo program), or null
export function coMemoOf(tx, keys) {
  for (const ix of tx.transaction.message.compiledInstructions || []) {
    if (!keys.get(ix.programIdIndex)?.equals(MEMO)) continue;
    const m = /^treid:co:(\d{1,12})$/.exec(Buffer.from(ix.data).toString('utf8')); if (m) return +m[1];
  }
  return null;
}

export function startCalloutRewards({ conn, ops, q, q1, run, solUsd = () => 0, mainnet = false, ready = () => true, otherLiab = () => 0, log = console.log }) {
  run(`CREATE TABLE IF NOT EXISTS coattr(sig TEXT PRIMARY KEY, co INT, caller TEXT, trader TEXT, mint TEXT, lam INT, fee_lam INT, usd REAL, ts INT)`);
  run('CREATE INDEX IF NOT EXISTS coattr_caller ON coattr(caller)');
  const paidTo = (w) => q1("SELECT COALESCE(SUM(lamports),0) s FROM rlog WHERE kind='copay' AND mint=?", w)?.s || 0;
  const earned = (w) => q1('SELECT COALESCE(SUM(lam),0) s FROM coattr WHERE caller=?', w)?.s || 0;
  const owedOf = (w) => Math.max(0, earned(w) - paidTo(w));
  const owedAll = () => q('SELECT caller, SUM(lam) e FROM coattr GROUP BY caller').reduce((a, r) => a + Math.max(0, r.e - paidTo(r.caller)), 0);

  // called by the indexer for every buy that carried a callout memo. treidFeeLam: treid's own part of this trade's fee, in lamports.
  function attr({ sig, id, trader, coin, treidFeeLam, usd, ts, sys = false }) {
    try {
      if (sys || !(treidFeeLam > 0) || (coin.quote_mint && coin.quote_mint !== 'So11111111111111111111111111111111111111112')) return null;   // SOL pairs only: their fees arrive in ops as SOL
      const c = q1('SELECT id, mint, wallet, ts FROM callouts WHERE id=?', id); if (!c || c.mint !== coin.mint) return null;   // the callout must be about THIS coin
      if (c.wallet === trader || c.wallet === coin.creator || trader === coin.creator) return null;   // not your own buy; the dev already earns creator fees
      if (!(ts >= c.ts && ts - c.ts <= WINDOW_MS)) return null;
      const lam = Math.floor(treidFeeLam * CO_SHARE); if (lam <= 0) return null;
      const r = run('INSERT OR IGNORE INTO coattr(sig,co,caller,trader,mint,lam,fee_lam,usd,ts) VALUES(?,?,?,?,?,?,?,?,?)', sig, id, c.wallet, trader, coin.mint, lam, Math.floor(treidFeeLam), usd || 0, ts);
      return r.changes ? { caller: c.wallet, lam } : null;
    } catch (e) { log('callout reward attr err', String(e?.message || e).slice(0, 100)); return null; }
  }

  function stats(w) {
    const r = q1('SELECT COUNT(*) n, COUNT(DISTINCT trader) t, COALESCE(SUM(usd),0) v, COALESCE(SUM(lam),0) e FROM coattr WHERE caller=?', w);
    const lp = q1("SELECT MAX(ts) t FROM rlog WHERE kind='copay' AND mint=?", w)?.t || null;
    return { wallet: w, buys: r.n, buyers: r.t, volume_usd: Math.round(r.v * 100) / 100, earned_sol: r.e / 1e9, paid_sol: paidTo(w) / 1e9, owed_sol: Math.max(0, r.e - paidTo(w)) / 1e9, last_paid: lp, share: CO_SHARE };
  }
  const top = (days = 30) => q('SELECT caller, COUNT(*) n, COUNT(DISTINCT trader) t, SUM(usd) v, SUM(lam) e FROM coattr WHERE ts>=? GROUP BY caller ORDER BY e DESC LIMIT 20', Date.now() - days * 864e5)
    .map((r) => ({ wallet: r.caller, buys: r.n, buyers: r.t, volume_usd: Math.round(r.v * 100) / 100, earned_sol: r.e / 1e9 }));
  const byCallout = (ids) => { const out = {}; for (const id of ids.slice(0, 300)) { const r = q1('SELECT COUNT(*) n, COALESCE(SUM(lam),0) e FROM coattr WHERE co=?', id); if (r.n) out[id] = { buys: r.n, earned_sol: r.e / 1e9 }; } return out; };

  // ---- daily payout (once per UTC day, after the ledger is rebuilt), in the same one-at-a-time lock as every ops action ----
  async function payout() {
    if (!ops || (!mainnet && !process.env.CALLOUT_PAY_DEVNET)) return; if (HALT.on || !ready() || !canWrite(run)) return;
    const today = day(Date.now()); if (q1("SELECT v FROM kv WHERE k='copay_day'")?.v === today) return;
    const px = solUsd(); if (!(px > 0)) return;
    const due = q('SELECT caller, SUM(lam) e FROM coattr WHERE ts < ? GROUP BY caller', Date.parse(today)).map((r) => ({ w: r.caller, lam: Math.max(0, r.e - paidTo(r.caller)) }))   // only buys from before today: a day's total is final
      .filter((x) => x.lam / 1e9 * px >= PAY_USD).sort((a, b) => b.lam - a.lam);
    let paid = 0, n = 0;
    for (let i = 0; i < due.length; i += PER_TX) {
      if (HALT.on) return; const batch = due.slice(i, i + PER_TX), sum = batch.reduce((a, x) => a + x.lam, 0);
      const bal = await conn.getBalance(ops.publicKey); if (bal - KEEP - otherLiab() < sum) { log('!! callout rewards: ops wallet short of SOL for today’s payouts — will retry'); return; }
      const ixs = []; for (const x of batch) ixs.push(SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: new PublicKey(x.w), lamports: x.lam }), memoIx(`treid:copay:${x.w}:${x.lam}:${today}`));
      let sig;
      try { sig = await sendTx(conn, ixs, [ops]); }
      catch (e) { if (e.unconfirmed) { halt('unknown outcome: callout payout'); log('!! callout payout status unknown — stopping; the ledger rebuild on restart settles it'); setTimeout(() => process.exit(1), 20e3); return; }
        log('callout payout batch failed (nothing sent):', String(e?.message || e).slice(0, 100)); return; }
      try { batch.forEach((x, k) => run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', sig, k, x.w, 'copay', x.lam, Date.now(), today)); } catch (e) { halt(e.message); throw e; }
      paid += sum; n += batch.length;
    }
    run("INSERT OR REPLACE INTO kv(k,v) VALUES('copay_day',?)", today);
    if (n) log('callout rewards paid:', n, 'callers,', (paid / 1e9).toFixed(4), 'SOL');
  }
  setInterval(() => { withLock(payout).catch((e) => log('callout payout err', String(e?.message || e).slice(0, 120))); }, 15 * 60e3);
  return { attr, stats, top, byCallout, owed: owedAll, owedOf, payout };
}
