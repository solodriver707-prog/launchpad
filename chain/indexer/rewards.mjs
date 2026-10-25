// treid creator-rewards escrow. The ops wallet is the pool "creator" of new coins, so it claims the creator fee share and
// applies the rules: active dev → paid every cycle · 48h idle → paused (missed rewards → buyback & burn of the coin)
// · 7d idle or sold ≥70% of peak bag → dev out: 50% buyback & burn, 50% takeover fund · fund unclaimed after 14d → treid grants.
// Every action carries an on-chain memo ("treid:<kind>:<mint>:<lamports>") so the ledger can be rebuilt from chain after a restart.
import { PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount, createBurnCheckedInstruction } from '@solana/spl-token';
import { SwapMode, getCurrentPoint } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import BN from 'bn.js';
import { withLock } from './lock.mjs';

export const RULES = { idleFreezeMs: 48 * 3600e3, idleOutMs: 7 * 864e5, soldOut: 70, fundDays: 14 };
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const memo = (s) => new TransactionInstruction({ keys: [], programId: MEMO, data: Buffer.from(s) });
export const pingMessage = (mint, ts) => `treid: I'm still here — ${mint} — ${ts}`;

export function startRewards({ conn, dbc, ops, treasury, q, q1, run, log = console.log }) {
  run(`CREATE TABLE IF NOT EXISTS rlog(sig TEXT, i INT, mint TEXT, kind TEXT, lamports INT, ts INT, PRIMARY KEY(sig, i))`);
  const send = (ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [ops], { commitment: 'confirmed' });
  const record = (sig, items) => items.forEach((it, i) => run('INSERT OR IGNORE INTO rlog VALUES(?,?,?,?,?,?)', sig, i, it.mint, it.kind, it.lamports, Date.now()));
  // rebuild ledger from the ops wallet's own memo history
  async function rebuild() {
    let before, n = 0;
    while (true) { const page = await conn.getSignaturesForAddress(ops.publicKey, { limit: 1000, before }, 'confirmed'); if (!page.length) break;
      for (const x of page) { if (x.err || q1('SELECT 1 FROM rlog WHERE sig=?', x.signature)) continue; const t = await conn.getTransaction(x.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null); if (!t) continue;
        const items = (t.meta.logMessages || []).map((l) => (l.match(/Memo \(len \d+\): "(treid:[^"]+)"/) || [])[1]).filter(Boolean).map((m) => { const [, kind, mint, lam] = m.split(':'); return { kind, mint, lamports: +lam || 0 }; });
        items.forEach((it, i) => run('INSERT OR IGNORE INTO rlog VALUES(?,?,?,?,?,?)', x.signature, i, it.mint, it.kind, it.lamports, (x.blockTime || 0) * 1000)); n += items.length; }
      if (page.length < 1000) break; before = page[page.length - 1].signature; }
    log('rewards ledger rebuilt:', n, 'entries');
  }
  const sum = (mint, kind) => q1('SELECT COALESCE(SUM(lamports),0) s FROM rlog WHERE mint=? AND kind=?', mint, kind).s;
  function devActivity(c) {
    const tr = q('SELECT side, tokens, ts FROM trades WHERE mint=? AND wallet=? ORDER BY ts, slot', c.mint, c.creator);
    let bal = 0, peak = 0, lastTrade = 0; for (const x of tr) { bal = Math.max(0, bal + (x.side === 'buy' ? x.tokens : -x.tokens)); peak = Math.max(peak, bal); lastTrade = x.ts; }
    const lastPing = q1(`SELECT MAX(ts) t FROM rlog WHERE mint=? AND kind='ping'`, c.mint).t || 0, last = Math.max(c.created_at || 0, lastTrade, lastPing);
    return { bal, peak, sold: peak > 0 ? (peak - bal) / peak * 100 : 0, last, idle: Date.now() - last };
  }
  // state is derived, never stored: same answer after any restart
  function state(c) {
    const a = devActivity(c), outAt = q1(`SELECT MIN(ts) t FROM rlog WHERE mint=? AND kind='out'`, c.mint).t;
    let st = 'active', why = null;
    if (outAt) st = 'out'; else if (a.sold >= RULES.soldOut) { st = 'out'; why = 'sold'; } else if (a.idle >= RULES.idleOutMs) { st = 'out'; why = 'idle'; } else if (a.idle >= RULES.idleFreezeMs) st = 'frozen';
    const fund = sum(c.mint, 'fund') - sum(c.mint, 'grant') - sum(c.mint, 'cto');
    return { ...a, state: st, why, outAt: outAt || null, paid: sum(c.mint, 'pay'), buyback: sum(c.mint, 'buyback'), burnedTokens: sum(c.mint, 'burntok'), fund, granted: sum(c.mint, 'grant'), fundEndsAt: outAt ? outAt + RULES.fundDays * 864e5 : null };
  }
  async function buybackBurn(c, lamports) {
    const mint = new PublicKey(c.mint), ata = getAssociatedTokenAddressSync(mint, ops.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const vpw = await dbc.state.getPool(new PublicKey(c.pool)), cfg = await dbc.state.getPoolConfig(vpw.poolState.config), cp = await getCurrentPoint(conn, cfg.activationType);
    const qt = dbc.pool.swapQuote2({ virtualPool: vpw, config: cfg, swapBaseForQuote: false, amountIn: new BN(lamports), slippageBps: 1000, hasReferral: false, currentPoint: cp, swapMode: SwapMode.ExactIn });
    const tx = await dbc.pool.swap2({ owner: ops.publicKey, pool: new PublicKey(c.pool), swapBaseForQuote: false, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: new BN(lamports), minimumAmountOut: qt.minimumAmountOut || new BN(0) });
    tx.add(memo(`treid:buyback:${c.mint}:${lamports}`)); const s1 = await sendAndConfirmTransaction(conn, tx, [ops], { commitment: 'confirmed' }); record(s1, [{ mint: c.mint, kind: 'buyback', lamports }]);
    const got = (await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount;   // under the ops lock the ATA only holds bought-back tokens → burn all of it
    if (got > 0n) { const s2 = await send([createBurnCheckedInstruction(ata, mint, ops.publicKey, got, 6, [], TOKEN_2022_PROGRAM_ID), memo(`treid:burntok:${c.mint}:${got}`)]); record(s2, [{ mint: c.mint, kind: 'burntok', lamports: Number(got) }]); }
    log('rewards buyback', c.symbol, (lamports / 1e9).toFixed(4), 'SOL → burned', (Number(got) / 1e6).toFixed(0), 'tokens');
  }
  async function cycleCoin(c) {
    const vpw = await dbc.state.getPool(new PublicKey(c.pool)); const vp = vpw?.poolState; if (!vp || vp.creator.toBase58() !== ops.publicKey.toBase58()) return;
    const st = state(c);
    if (st.state === 'out' && !st.outAt) { const s = await send([memo(`treid:out:${c.mint}:0`)]); record(s, [{ mint: c.mint, kind: 'out', lamports: 0 }]); log('rewards dev out', c.symbol, st.why); }
    // 1) claim the creator share of trading fees into the ops wallet
    const fee = Number(vp.creatorQuoteFee.toString());
    if (fee >= 2e6) {
      const tx = await dbc.creator.claimCreatorTradingFee({ creator: ops.publicKey, payer: ops.publicKey, pool: new PublicKey(c.pool), maxBaseAmount: new BN(0), maxQuoteAmount: new BN(fee) });
      tx.add(memo(`treid:claim:${c.mint}:${fee}`)); const s = await sendAndConfirmTransaction(conn, tx, [ops], { commitment: 'confirmed' }); record(s, [{ mint: c.mint, kind: 'claim', lamports: fee }]);
      // 2) apply the rules to what was just claimed
      if (st.state === 'active') { const s2 = await send([SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: new PublicKey(c.creator), lamports: fee }), memo(`treid:pay:${c.mint}:${fee}`)]); record(s2, [{ mint: c.mint, kind: 'pay', lamports: fee }]); log('rewards paid', c.symbol, (fee / 1e9).toFixed(4), 'SOL to dev'); }
      else if (st.state === 'frozen') await buybackBurn(c, fee);
      else { const half = Math.floor(fee / 2); await buybackBurn(c, half); const s3 = await send([memo(`treid:fund:${c.mint}:${fee - half}`)]); record(s3, [{ mint: c.mint, kind: 'fund', lamports: fee - half }]); }
    }
    // 3) takeover window over with no takeover → treid grants
    const st2 = state(c);
    if (st2.state === 'out' && st2.fund > 0 && st2.fundEndsAt && Date.now() > st2.fundEndsAt) { const s4 = await send([SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: new PublicKey(treasury), lamports: st2.fund }), memo(`treid:grant:${c.mint}:${st2.fund}`)]); record(s4, [{ mint: c.mint, kind: 'grant', lamports: st2.fund }]); log('rewards fund → grants', c.symbol, (st2.fund / 1e9).toFixed(4)); }
  }
  const cycle = () => withLock(cycleAll);
  async function cycleAll() { for (const c of q('SELECT * FROM coins')) { try { await cycleCoin(c); } catch (e) { log('rewards err', c.symbol, e.message.slice(0, 140)); } } }
  // "I'm still here": dev signs a message in their wallet (free); ops stamps it on-chain so it survives restarts
  async function ping({ mint, wallet, ts, sig }) {
    const c = q1('SELECT * FROM coins WHERE mint=?', mint); if (!c) throw new Error('unknown coin'); if (wallet !== c.creator) throw new Error('only the creator can check in');
    if (Math.abs(Date.now() - ts) > 10 * 60e3) throw new Error('signature expired');
    if (!ed25519.verify(bs58.decode(sig), new TextEncoder().encode(pingMessage(mint, ts)), new PublicKey(wallet).toBytes())) throw new Error('bad signature');
    if (state(c).state === 'out') throw new Error('dev is already out');
    const s = await withLock(() => send([memo(`treid:ping:${mint}:0`)])); record(s, [{ mint, kind: 'ping', lamports: 0 }]); return { ok: true };
  }
  return { rebuild, cycle, state, ping, logFor: (mint) => q('SELECT sig, kind, lamports, ts FROM rlog WHERE mint=? ORDER BY ts DESC LIMIT 30', mint) };
}
