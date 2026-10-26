// treid creator-rewards escrow + community takeover (CTO).
// The ops wallet is the pool "creator" of new coins, but treid never holds the money: fees stay in the Meteora pool and
// every claim goes straight to its destination.
//   era "dev" / "cto" (a creator wallet is in charge):
//     active → paid pool→creator automatically (≥0.01 SOL or daily) or on demand
//     48h idle → paused, rewards buy back & burn the coin · 7d idle or ≥70% of peak bag gone (sold, transferred away, or both) → out
//   era "out": 50% buyback & burn, 50% treid platform (no community fund — nothing to farm) · holders can elect a new lead:
//     applicant holds ≥1% · supporters (incl. applicant) hold ≥10% of supply → CTO; the lead earns future rewards under the same rules
// Every action carries an on-chain memo "treid:<kind>:<mint>:<lamports>[:<extra>]" → the ledger is rebuilt from chain on start.
import { PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount, createBurnCheckedInstruction } from '@solana/spl-token';
import { SwapMode, getCurrentPoint } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import BN from 'bn.js';
import { withLock } from './lock.mjs';

export const RULES = { idleFreezeMs: 48 * 3600e3, idleOutMs: 7 * 864e5, soldOut: 70, fundDays: 14, ctoApplyPct: 1, ctoSupportPct: 10, ctoVestDays: 30 };
const SUPPLY = 1e9, MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const memo = (s) => new TransactionInstruction({ keys: [], programId: MEMO, data: Buffer.from(s) });
export const pingMessage = (mint, ts) => `treid: I'm still here — ${mint} — ${ts}`;
export const claimMessage = (mint, ts) => `treid: claim — ${mint} — ${ts}`;
export const applyMessage = (mint, ts, plan) => `treid: lead takeover — ${mint} — ${ts}\n${plan}`;
export const voteMessage = (mint, applicant, ts) => `treid: support takeover by ${applicant} — ${mint} — ${ts}`;
const PAY_USD = 1, PAY_DAILY_USD = 0.1, MIN_ACTION_USD = 0.2;   // auto-pay from $1 (or ≥$0.10 once a day); buybacks from $0.20
const cleanPlan = (p) => String(p || '').replace(/["\\\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);

export function startRewards({ conn, dbc, ops, treasury, q, q1, run, balances, quoteUsd = () => 150, log = console.log }) {
  // amounts are in the pair token's base units; thresholds are in USD so they mean the same for SOL, USDC, gold…
  const units = (c, usd) => { const p = quoteUsd(c) || 0, d = 10 ** (c.quote_dec ?? 9); return p > 0 ? Math.ceil(usd / p * d) : Infinity; };
  run(`CREATE TABLE IF NOT EXISTS rlog(sig TEXT, i INT, mint TEXT, kind TEXT, lamports INT, ts INT, PRIMARY KEY(sig, i))`);
  try { run('ALTER TABLE rlog ADD COLUMN extra TEXT'); } catch {}
  const send = (ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [ops], { commitment: 'confirmed' });
  const record = (sig, items) => items.forEach((it, i) => run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', sig, i, it.mint, it.kind, it.lamports, Date.now(), it.extra || null));
  const stamp = async (mint, kind, lamports = 0, extra = null, more = []) => { const s = await send([...more, memo(`treid:${kind}:${mint}:${lamports}` + (extra ? ':' + extra : ''))]); record(s, [{ mint, kind, lamports, extra }]); return s; };
  const verify = (msg, sig, wallet) => ed25519.verify(bs58.decode(sig), new TextEncoder().encode(msg), new PublicKey(wallet).toBytes());
  const fresh = (ts) => { if (!(Math.abs(Date.now() - ts) <= 2 * 60e3)) throw new Error('signature expired — try again'); };
  // anti-replay + anti-spam: each signature works once, each wallet can act once per 30s per action
  const usedSig = new Map(), lastAct = new Map();
  const guard = (kind, wallet, sig) => { const now = Date.now(); for (const [k, t] of usedSig) if (now - t > 5 * 60e3) usedSig.delete(k);
    if (usedSig.has(sig)) throw new Error('this signature was already used'); const k = kind + '|' + wallet; if (now - (lastAct.get(k) || 0) < 30e3) throw new Error('slow down — try again in a few seconds');
    usedSig.set(sig, now); lastAct.set(k, now); };
  const VOTE_WINDOW = 24 * 36e5;   // a takeover can only be approved after its application has been open this long (balances re-checked then)

  async function rebuild() {   // ledger = the ops wallet's own memo history
    let before, n = 0;
    while (true) { const page = await conn.getSignaturesForAddress(ops.publicKey, { limit: 1000, before }, 'confirmed'); if (!page.length) break;
      for (const x of page) { if (x.err || q1('SELECT 1 FROM rlog WHERE sig=?', x.signature)) continue; const t = await conn.getTransaction(x.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null); if (!t) continue;
        const msg = t.transaction.message, keys = msg.getAccountKeys ? msg.getAccountKeys({ accountKeysFromLookups: t.meta.loadedAddresses }) : null, key = (i) => (keys ? keys.get(i) : msg.accountKeys[i]);
        if (!key(0) || !key(0).equals(ops.publicKey)) continue;   // only the ops wallet's OWN transactions (fee payer = ops) — anyone can send memos to ops
        const items = (msg.compiledInstructions || []).filter((ix) => key(ix.programIdIndex).equals(MEMO)).map((ix) => Buffer.from(ix.data).toString('utf8')).filter((m) => m.startsWith('treid:')).map((m) => { const p = m.split(':'); return { kind: p[1], mint: p[2], lamports: +p[3] || 0, extra: p.length > 4 ? p.slice(4).join(':') : null }; });
        items.forEach((it, i) => run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', x.signature, i, it.mint, it.kind, it.lamports, (x.blockTime || 0) * 1000, it.extra)); n += items.length; }
      if (page.length < 1000) break; before = page[page.length - 1].signature; }
    log('rewards ledger rebuilt:', n, 'entries');
  }
  const sum = (mint, kind, since = 0) => q1('SELECT COALESCE(SUM(lamports),0) s FROM rlog WHERE mint=? AND kind=? AND ts>=?', mint, kind, since).s;
  const lastOf = (mint, kind) => q1('SELECT ts, lamports, extra FROM rlog WHERE mint=? AND kind=? ORDER BY ts DESC LIMIT 1', mint, kind);
  // who is in charge right now
  function era(c) {
    const out = lastOf(c.mint, 'out'), cto = lastOf(c.mint, 'cto');
    if (cto && cto.ts > (out?.ts || 0)) return { type: 'cto', wallet: cto.extra, start: cto.ts, fund: cto.lamports };
    if (out) return { type: 'out', start: out.ts };
    return { type: 'dev', wallet: c.creator, start: c.created_at || 0 };
  }
  // live on-chain balances (sold OR transferred away both count) — refreshed each cycle
  const balNow = new Map(), peakSeen = new Map();
  function activity(c, wallet, since) {
    const tr = q('SELECT side, tokens, ts FROM trades WHERE mint=? AND wallet=? ORDER BY ts, slot', c.mint, wallet);
    let bal = 0, peak = null, lastTrade = 0;   // peak = biggest bag held since this era started (starting from the bag held at that moment)
    for (const x of tr) { if (x.ts >= since && peak === null) peak = bal; bal = Math.max(0, bal + (x.side === 'buy' ? x.tokens : -x.tokens)); if (x.ts >= since) { lastTrade = x.ts; peak = Math.max(peak, bal); } }
    if (peak === null) peak = bal;
    const k = c.mint + '|' + wallet + '|' + since, cur = balNow.has(c.mint + '|' + wallet) ? balNow.get(c.mint + '|' + wallet) : bal;   // real wallet balance: sells + transfers out
    peak = Math.max(peak, cur, peakSeen.get(k) || 0); peakSeen.set(k, peak); bal = cur;
    const lastPing = q1(`SELECT MAX(ts) t FROM rlog WHERE mint=? AND kind='ping' AND ts>=? AND (extra IS NULL OR extra=?)`, c.mint, since, wallet).t || 0, last = Math.max(since, lastTrade, lastPing);
    return { bal, peak, sold: peak > 0 ? (peak - bal) / peak * 100 : 0, last, idle: Date.now() - last };
  }
  // state is derived from trades + memos, never stored → identical after any restart
  function state(c) {
    const e = era(c), fund = sum(c.mint, 'fund') - sum(c.mint, 'grant') - sum(c.mint, 'ctopay');   // reserved INSIDE the pool
    const base = { era: e.type, creator: e.wallet || null, fund, paid: sum(c.mint, 'pay'), buyback: sum(c.mint, 'buyback'), burnedTokens: sum(c.mint, 'burntok'), granted: sum(c.mint, 'grant') + sum(c.mint, 'platform'), lastPay: lastOf(c.mint, 'pay')?.ts || 0 };
    if (e.type === 'out') return { ...base, state: 'out', outAt: e.start, fundEndsAt: e.start + RULES.fundDays * 864e5, idle: 0, sold: 0, last: e.start };
    const a = activity(c, e.wallet, e.start); let st = 'active', why = null;
    if (a.sold >= RULES.soldOut) { st = 'out'; why = 'sold'; } else if (a.idle >= RULES.idleOutMs) { st = 'out'; why = 'idle'; } else if (a.idle >= RULES.idleFreezeMs) st = 'frozen';
    const r = { ...base, ...a, paid: sum(c.mint, 'pay', e.start), state: st, why, outAt: null, fundEndsAt: null };   // paid to the CURRENT creator / lead
    if (e.type === 'cto') { const paid = sum(c.mint, 'ctopay', e.start), vested = Math.floor(e.fund * Math.min(1, (Date.now() - e.start) / (RULES.ctoVestDays * 864e5))); r.cto = { lead: e.wallet, at: e.start, fund: e.fund, paid, vested, owed: Math.max(0, vested - paid) }; }
    return r;
  }
  async function buybackBurn(c, lamports) {
    const mint = new PublicKey(c.mint), ata = getAssociatedTokenAddressSync(mint, ops.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const vpw = await dbc.state.getPool(new PublicKey(c.pool)), cfg = await dbc.state.getPoolConfig(vpw.poolState.config), cp = await getCurrentPoint(conn, cfg.activationType);
    const qt = dbc.pool.swapQuote2({ virtualPool: vpw, config: cfg, swapBaseForQuote: false, amountIn: new BN(lamports), slippageBps: 1000, hasReferral: false, currentPoint: cp, swapMode: SwapMode.ExactIn });
    const sw = await dbc.pool.swap2({ owner: ops.publicKey, pool: new PublicKey(c.pool), swapBaseForQuote: false, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: new BN(lamports), minimumAmountOut: qt.minimumAmountOut || new BN(0) });
    const cl = await dbc.creator.claimCreatorTradingFee({ creator: ops.publicKey, payer: ops.publicKey, pool: new PublicKey(c.pool), maxBaseAmount: new BN(0), maxQuoteAmount: new BN(lamports) });
    const before = await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID).then((a) => a.amount).catch(() => 0n);
    const full = new Transaction().add(...cl.instructions, ...sw.instructions, memo(`treid:buyback:${c.mint}:${lamports}`));   // claim + swap in ONE tx
    const s1 = await sendAndConfirmTransaction(conn, full, [ops], { commitment: 'confirmed' }); record(s1, [{ mint: c.mint, kind: 'buyback', lamports }]);
    const got = (await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount - before;   // burn only what this swap bought
    if (got > 0n) await stamp(c.mint, 'burntok', Number(got), null, [createBurnCheckedInstruction(ata, mint, ops.publicKey, got, 6, [], TOKEN_2022_PROGRAM_ID)]);
    log('rewards buyback', c.symbol, (lamports / 10 ** (c.quote_dec ?? 9)).toFixed(4), c.quote_symbol || 'SOL', '→ burned', (Number(got) / 1e6).toFixed(0), 'tokens');
  }
  async function payFromPool(c, lamports, receiver, kind) {   // straight pool → receiver, the SOL never touches the ops wallet
    const tx = await dbc.creator.claimCreatorTradingFeeToReceiver({ creator: ops.publicKey, payer: ops.publicKey, pool: new PublicKey(c.pool), maxBaseAmount: new BN(0), maxQuoteAmount: new BN(lamports), receiver: new PublicKey(receiver) });
    tx.add(memo(`treid:${kind}:${c.mint}:${lamports}:${receiver}`)); const s = await sendAndConfirmTransaction(conn, tx, [ops], { commitment: 'confirmed' }); record(s, [{ mint: c.mint, kind, lamports, extra: receiver }]);
    log('rewards', kind, c.symbol, (lamports / 10 ** (c.quote_dec ?? 9)).toFixed(4), c.quote_symbol || 'SOL', 'pool →', receiver.slice(0, 6)); return s;
  }
  // ---- community takeover ----
  let balCache = new Map();
  async function bals(mint) { const h = balCache.get(mint); if (h && Date.now() - h.at < 30e3) return h.m; const m = await balances(mint); balCache.set(mint, { at: Date.now(), m }); return m; }
  const pastLeads = (c) => new Set([c.creator, ...q(`SELECT extra FROM rlog WHERE mint=? AND kind='cto'`, c.mint).map((r) => r.extra)]);
  async function applications(c) {
    const e = era(c); if (e.type !== 'out') return [];
    const apps = q(`SELECT extra, ts FROM rlog WHERE mint=? AND kind='ctoapply' AND ts>=? ORDER BY ts`, c.mint, e.start), votes = q(`SELECT extra, ts FROM rlog WHERE mint=? AND kind='ctovote' AND ts>=? ORDER BY ts`, c.mint, e.start);
    const m = await bals(c.mint), banned = pastLeads(c), latest = new Map();   // one vote per wallet: the latest counts
    for (const v of votes) { const [voter, applicant] = (v.extra || '').split('|'); latest.set(voter, applicant); }
    const seen = new Set();
    return apps.map((a) => { const [wallet, ...plan] = (a.extra || '').split('|'); return { wallet, plan: plan.join('|'), at: a.ts }; }).filter((a) => !seen.has(a.wallet) && seen.add(a.wallet) && !banned.has(a.wallet))
      .map((a) => { const sup = new Set([a.wallet]); for (const [voter, ap] of latest) if (ap === a.wallet && !banned.has(voter)) sup.add(voter);
        const tok = [...sup].reduce((s, w) => s + (m.get(w) || 0), 0), own = m.get(a.wallet) || 0;
        return { ...a, supporters: sup.size, supportPct: tok / SUPPLY * 100, ownPct: own / SUPPLY * 100, eligible: own / SUPPLY * 100 >= RULES.ctoApplyPct }; })
      .sort((x, y) => y.supportPct - x.supportPct);
  }
  async function tryApprove(c) {
    const st = state(c); if (st.era !== 'out') return null;
    balCache.delete(c.mint); const best = (await applications(c)).find((a) => a.eligible && a.supportPct >= RULES.ctoSupportPct && Date.now() - a.at >= VOTE_WINDOW); if (!best) return null;
    await stamp(c.mint, 'cto', Math.max(0, st.fund), best.wallet); log('rewards CTO approved', c.symbol, '→', best.wallet.slice(0, 6), (best.supportPct).toFixed(1) + '%'); return best;
  }
  async function cycleCoin(c) {
    const vp = (await dbc.state.getPool(new PublicKey(c.pool)))?.poolState; if (!vp || vp.creator.toBase58() !== ops.publicKey.toBase58()) return;
    try { const e = era(c); if (e.wallet) { balCache.delete(c.mint); const m = await bals(c.mint); balNow.set(c.mint + '|' + e.wallet, m.get(e.wallet) || 0); } } catch {}
    let st = state(c);
    if (st.era !== 'out' && st.state === 'out') { await stamp(c.mint, 'out', 0, st.creator); log('rewards creator out', c.symbol, st.why); balCache.delete(c.mint); st = state(c); }
    if (st.era === 'out') { if (await tryApprove(c)) st = state(c); }
    const inPool = Number(vp.creatorQuoteFee.toString()), free = Math.max(0, inPool - st.fund);
    const minA = units(c, MIN_ACTION_USD);
    if (st.era !== 'out' && st.state === 'active') { if (free >= units(c, PAY_USD) || (free >= units(c, PAY_DAILY_USD) && Date.now() - st.lastPay > 864e5)) await payFromPool(c, free, st.creator, 'pay'); }
    else if (st.era !== 'out' && st.state === 'frozen') { if (free >= minA) await buybackBurn(c, free); }
    else if (st.era === 'out' && free >= minA) { const half = Math.floor(free / 2); await buybackBurn(c, half); await payFromPool(c, free - half, treasury, 'platform'); }
    // CTO lead: fund vests over 30 days, paid from the pool (only while the lead is in good standing)
    const s2 = state(c);
    if (s2.cto && s2.state === 'active' && s2.cto.owed >= minA) await payFromPool(c, Math.min(s2.cto.owed, s2.fund), s2.cto.lead, 'ctopay');
    // takeover window over with no takeover → the fund goes to the treid platform
    if (s2.era === 'out' && s2.fund > 0 && Date.now() > s2.fundEndsAt) await payFromPool(c, s2.fund, treasury, 'grant');
  }
  const cycle = () => withLock(async () => { for (const c of q('SELECT * FROM coins')) { try { await cycleCoin(c); } catch (e) { log('rewards err', c.symbol, e.message.slice(0, 140)); } } });
  const coin = (mint) => { const c = q1('SELECT * FROM coins WHERE mint=?', mint); if (!c) throw new Error('unknown coin'); return c; };
  async function ping({ mint, wallet, ts, sig }) {
    const c = coin(mint), st = state(c); fresh(ts); if (!verify(pingMessage(mint, ts), sig, wallet)) throw new Error('bad signature'); guard('ping', wallet, sig);
    if (st.era === 'out' || st.state === 'out') throw new Error('creator is already out'); if (wallet !== st.creator) throw new Error('only the current creator can check in');
    await withLock(() => stamp(mint, 'ping', 0, wallet)); return { ok: true };
  }
  async function claimNow({ mint, wallet, ts, sig }) {
    const c = coin(mint); fresh(ts); if (!verify(claimMessage(mint, ts), sig, wallet)) throw new Error('bad signature'); guard('claim', wallet, sig);
    return withLock(async () => { const st = state(c); if (wallet !== st.creator) throw new Error('only the current creator can claim');
      if (st.state !== 'active') throw new Error(st.state === 'frozen' ? 'payouts are paused — tap “I’m still here” first' : 'creator is out');
      const vp = (await dbc.state.getPool(new PublicKey(c.pool))).poolState, free = Math.max(0, Number(vp.creatorQuoteFee.toString()) - st.fund);
      if (free < units(c, 0.01)) throw new Error('nothing to claim yet'); const s = await payFromPool(c, free, wallet, 'pay'); return { ok: true, sol: free / 10 ** (c.quote_dec ?? 9), quote: c.quote_symbol || 'SOL', sig: s }; });
  }
  async function ctoApply({ mint, wallet, ts, sig, plan }) {
    const c = coin(mint), p = cleanPlan(plan); fresh(ts); if (p.length < 10) throw new Error('write a short plan (10+ characters)');
    if (!verify(applyMessage(mint, ts, String(plan || '').slice(0, 240)), sig, wallet) && !verify(applyMessage(mint, ts, p), sig, wallet)) throw new Error('bad signature'); guard('apply', wallet, sig);
    if (q1(`SELECT 1 FROM rlog WHERE mint=? AND kind='ctoapply' AND ts>=? AND extra LIKE ?`, mint, era(c).start || 0, wallet + '|%')) throw new Error('you already applied');
    if (state(c).era !== 'out') throw new Error('takeovers open only when the creator is out'); if (pastLeads(c).has(wallet)) throw new Error('this wallet can’t lead this coin');
    balCache.delete(mint); const own = (await bals(mint)).get(wallet) || 0; if (own / SUPPLY * 100 < RULES.ctoApplyPct) throw new Error(`you need at least ${RULES.ctoApplyPct}% of the supply to apply`);
    await withLock(() => stamp(mint, 'ctoapply', 0, wallet + '|' + p)); return { ok: true };
  }
  async function ctoVote({ mint, applicant, wallet, ts, sig }) {
    const c = coin(mint); fresh(ts); if (!verify(voteMessage(mint, applicant, ts), sig, wallet)) throw new Error('bad signature'); guard('vote', wallet, sig);
    const prev = q1(`SELECT extra FROM rlog WHERE mint=? AND kind='ctovote' AND ts>=? AND extra LIKE ? ORDER BY ts DESC LIMIT 1`, mint, era(c).start || 0, wallet + '|%'); if (prev && prev.extra === wallet + '|' + applicant) return { ok: true, approved: false, already: true };
    if (state(c).era !== 'out') throw new Error('no takeover vote is open'); if (pastLeads(c).has(wallet)) throw new Error('this wallet can’t vote here');
    balCache.delete(mint); if (!((await bals(mint)).get(wallet) > 0)) throw new Error('only holders can support a takeover');
    await withLock(() => stamp(mint, 'ctovote', 0, wallet + '|' + applicant)); return { ok: true, approved: false };   // approval happens in the cycle, after the voting window, with balances re-checked
  }
  return { rebuild, cycle, state, era, applications, ping, claimNow, ctoApply, ctoVote, logFor: (mint) => q(`SELECT sig, kind, lamports, ts, extra FROM rlog WHERE mint=? AND kind NOT IN ('ctovote','ctoapply') ORDER BY ts DESC LIMIT 30`, mint) };
}
