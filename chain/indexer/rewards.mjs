// treid creator rewards + community takeover (CTO).
// The ops wallet is the pool "creator" of treid coins; the creator's trading fees stay in the Meteora pool until paid out.
//   era "dev" / "cto" (a creator wallet is in charge):
//     active → paid automatically once ≥ $1 has built up, or on demand ("Claim now", from $1)
//     48h idle → paused: the fees are claimed and used to buy back & burn the coin
//     7d idle, or ≥70% of the bag gone (sold, transferred away, or both) → out
//   era "out": 50% buyback & burn, 50% treid platform · holders can elect a new lead (applicant ≥1%, support ≥10% held for 24h)
// Money rule: every payout is two steps — (1) claim from the pool into ops, (2) pass on EXACTLY the amount that step 1 received.
// Both steps leave on-chain memos, so an interrupted payout is found and finished after any restart (reconcile).
// Memo format: "treid:<kind>:<mint>:<amount>[:<extra>]" — only memos in transactions PAID BY OPS count.
import { PublicKey, Transaction, TransactionInstruction, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, NATIVE_MINT, unpackAccount, getTransferFeeAmount, getAssociatedTokenAddressSync, createBurnCheckedInstruction, createTransferCheckedInstruction, createCloseAccountInstruction, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { SwapMode, getCurrentPoint } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import BN from 'bn.js';
import { withLock } from './lock.mjs';
import { sendTx, getTxRetry, fetchT } from './txutil.mjs';

export const RULES = { idleFreezeMs: 48 * 3600e3, idleOutMs: 7 * 864e5, soldOut: 70, ctoApplyPct: 1, ctoSupportPct: 10, ctoHoldMs: 24 * 36e5 };
const SUPPLY = 1e9, MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const memo = (s) => new TransactionInstruction({ keys: [], programId: MEMO, data: Buffer.from(s) });
export const pingMessage = (mint, ts) => `treid: I'm still here — ${mint} — ${ts}`;
export const claimMessage = (mint, ts) => `treid: claim — ${mint} — ${ts}`;
export const applyMessage = (mint, ts, plan) => `treid: lead takeover — ${mint} — ${ts}\n${plan}`;
export const voteMessage = (mint, applicant, ts) => `treid: support takeover by ${applicant} — ${mint} — ${ts}`;
const PAY_USD = 1, ACTION_USD = 0.5, CLAIM_USD = 1;   // a payout must be worth far more than its two network fees
const cleanPlan = (p) => String(p || '').replace(/["\\\n\r|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function startRewards({ conn, dbc, ops, treasury, q, q1, run, balances, quoteUsd = () => 150, mainnet = false, log = console.log }) {
  const units = (c, usd) => { const p = quoteUsd(c) || 0, d = 10 ** (c.quote_dec ?? 9); return p > 0 ? Math.ceil(usd / p * d) : Infinity; };   // no price → never act
  run(`CREATE TABLE IF NOT EXISTS rlog(sig TEXT, i INT, mint TEXT, kind TEXT, lamports INT, ts INT, PRIMARY KEY(sig, i))`);
  try { run('ALTER TABLE rlog ADD COLUMN extra TEXT'); } catch {}
  run(`CREATE TABLE IF NOT EXISTS rpeak(mint TEXT, wallet TEXT, since INT, peak REAL, PRIMARY KEY(mint, wallet, since))`);   // biggest bag seen per era (kept on a persistent disk)
  run(`CREATE TABLE IF NOT EXISTS ctovotes(mint TEXT, round INT, voter TEXT, applicant TEXT, ts INT, sig TEXT, PRIMARY KEY(mint, round, voter))`);   // off-chain: votes cost ops nothing
  const record = (sig, items) => items.forEach((it, i) => run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', sig, i, it.mint, it.kind, it.lamports, Date.now(), it.extra ?? null));
  const stamp = async (mint, kind, lamports = 0, extra = null, more = []) => { const s = await sendTx(conn, [...more, memo(`treid:${kind}:${mint}:${lamports}` + (extra ? ':' + extra : ''))], [ops]); record(s, [{ mint, kind, lamports, extra }]); return s; };
  const verify = (msg, sig, wallet) => { try { return ed25519.verify(bs58.decode(sig), new TextEncoder().encode(msg), new PublicKey(wallet).toBytes()); } catch { return false; } };
  const fresh = (ts) => { if (!(Math.abs(Date.now() - ts) <= 2 * 60e3)) throw new Error('signature expired — try again'); };
  const usedSig = new Map(), lastAct = new Map();
  const guard = (kind, wallet, sig) => { const now = Date.now(); for (const [k, t] of usedSig) if (now - t > 5 * 60e3) usedSig.delete(k);
    if (usedSig.has(sig)) throw new Error('this signature was already used'); const k = kind + '|' + wallet; if (now - (lastAct.get(k) || 0) < 30e3) throw new Error('slow down — try again in a few seconds');
    usedSig.set(sig, now); lastAct.set(k, now); };
  let READY = false;   // nothing that moves money or reads the ledger runs before the ledger is fully rebuilt
  const needReady = () => { if (!READY) throw new Error('the server is still starting up — try again in a minute'); };

  // ---- ledger: the ops wallet's own memo history ----
  async function rebuild() {
    let before, n = 0;
    while (true) { const page = await conn.getSignaturesForAddress(ops.publicKey, { limit: 1000, before }, 'confirmed'); if (!page.length) break;
      for (const x of page) { if (x.err || q1('SELECT 1 FROM rlog WHERE sig=?', x.signature)) continue;
        const t = await getTxRetry(conn, x.signature, 4); if (!t) throw new Error('ledger rebuild: could not read ' + x.signature.slice(0, 10) + ' — will retry');   // never start with a hole in the ledger
        const msg = t.transaction.message, keys = msg.getAccountKeys ? msg.getAccountKeys({ accountKeysFromLookups: t.meta.loadedAddresses }) : null, key = (i) => (keys ? keys.get(i) : msg.accountKeys[i]);
        if (!key(0) || !key(0).equals(ops.publicKey)) continue;   // only transactions PAID BY ops
        const items = (msg.compiledInstructions || []).filter((ix) => key(ix.programIdIndex)?.equals(MEMO)).map((ix) => Buffer.from(ix.data).toString('utf8')).filter((m) => m.startsWith('treid:')).map((m) => { const p = m.split(':'); return { kind: p[1], mint: p[2], lamports: +p[3] || 0, extra: p.length > 4 ? p.slice(4).join(':') : null }; });
        items.forEach((it, i) => run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', x.signature, i, it.mint, it.kind, it.lamports, (x.blockTime || 0) * 1000, it.extra)); n += items.length; }
      if (page.length < 1000) break; before = page[page.length - 1].signature; }
    READY = true; log('rewards ledger rebuilt:', n, 'entries');
  }
  const sum = (mint, kind, since = 0) => q1('SELECT COALESCE(SUM(lamports),0) s FROM rlog WHERE mint=? AND kind=? AND ts>=?', mint, kind, since).s;
  const lastOf = (mint, kind) => q1('SELECT ts, lamports, extra FROM rlog WHERE mint=? AND kind=? ORDER BY ts DESC LIMIT 1', mint, kind);

  // ---- who is in charge ----
  function era(c) {
    const out = lastOf(c.mint, 'out'), cto = lastOf(c.mint, 'cto');
    if (cto && cto.ts > (out?.ts || 0)) return { type: 'cto', wallet: cto.extra, start: cto.ts, startBag: (cto.lamports || 0) / 1e6 };
    if (out) return { type: 'out', start: out.ts };
    return { type: 'dev', wallet: c.creator, start: c.created_at || 0 };
  }
  // 70% rule on the creator's/lead's REAL wallet balance (all their token accounts added up), peak kept in the DB
  const balNow = new Map();
  function activity(c, wallet, since, startBag = null) {
    const tr = q('SELECT side, tokens, ts FROM trades WHERE mint=? AND wallet=? ORDER BY ts, slot', c.mint, wallet);
    let bal = 0, peak = startBag ?? null, lastTrade = 0, sold = 0;
    for (const x of tr) { if (x.ts >= since && peak === null) peak = bal; bal = Math.max(0, bal + (x.side === 'buy' ? x.tokens : -x.tokens)); if (x.ts >= since) { lastTrade = x.ts; if (x.side === 'sell') sold += x.tokens; peak = Math.max(peak, bal); } }
    if (peak === null) peak = bal;
    let burned = 0; try { burned = q1('SELECT COALESCE(SUM(tok),0) s FROM uburn WHERE mint=? AND wallet=? AND ts>=?', c.mint, wallet, since).s; } catch {}   // burning your own tokens is not selling
    const k = c.mint + '|' + wallet, cur = (balNow.has(k) ? balNow.get(k) : bal) + burned, stored = q1('SELECT peak FROM rpeak WHERE mint=? AND wallet=? AND since=?', c.mint, wallet, since)?.peak || 0;
    peak = Math.max(peak, cur, stored); if (peak > stored) run('INSERT OR REPLACE INTO rpeak VALUES(?,?,?,?)', c.mint, wallet, since, peak);
    const drop = peak > 0 ? (peak - cur) / peak * 100 : 0, soldPct = peak > 0 ? Math.min(100, sold / peak * 100) : 0;   // dump-and-rebuy between checks still counts
    const lastPing = q1(`SELECT MAX(ts) t FROM rlog WHERE mint=? AND kind='ping' AND ts>=? AND (extra IS NULL OR extra=?)`, c.mint, since, wallet).t || 0, last = Math.max(since, lastTrade, lastPing);
    return { bal: cur, peak, sold: Math.max(drop, soldPct), last, idle: Date.now() - last };
  }
  function state(c) {
    const e = era(c);
    const base = { era: e.type, creator: e.wallet || null, fund: 0, paid: sum(c.mint, 'pay'), buyback: sum(c.mint, 'buyback'), burnedTokens: sum(c.mint, 'burntok'), granted: sum(c.mint, 'platform'), lastPay: lastOf(c.mint, 'pay')?.ts || 0 };
    if (e.type === 'out') return { ...base, state: 'out', outAt: e.start, idle: 0, sold: 0, last: e.start };
    const a = activity(c, e.wallet, e.start, e.type === 'cto' ? e.startBag : null); let st = 'active', why = null;
    if (a.sold >= RULES.soldOut) { st = 'out'; why = 'sold'; } else if (a.idle >= RULES.idleOutMs) { st = 'out'; why = 'idle'; } else if (a.idle >= RULES.idleFreezeMs) st = 'frozen';
    const r = { ...base, ...a, paid: sum(c.mint, 'pay', e.start), state: st, why, outAt: null };
    if (e.type === 'cto') r.cto = { lead: e.wallet, at: e.start, fund: 0, paid: 0, vested: 0, owed: 0 };
    return r;
  }

  // ---- step 1: claim from the pool into ops (memo "claimx" says what the claim is for) ----
  const pending = new Map();   // claim sigs whose confirmation timed out: checked again every cycle
  const quoteOf = (c) => new PublicKey(c.quote_mint || NATIVE_MINT.toBase58());
  async function claim(c, amount, dest, purpose) {
    const cl = await dbc.creator.claimCreatorTradingFee({ creator: ops.publicKey, payer: ops.publicKey, pool: new PublicKey(c.pool), maxBaseAmount: new BN(0), maxQuoteAmount: new BN(amount) });
    const tx = new Transaction().add(...cl.instructions, memo(`treid:claimx:${c.mint}:${amount}:${dest}|${purpose}`));
    try { const s = await sendTx(conn, tx, [ops]); record(s, [{ mint: c.mint, kind: 'claimx', lamports: amount, extra: `${dest}|${purpose}` }]); return s; }
    catch (e) { if (e.unconfirmed) { pending.set(e.signature, { mint: c.mint, amount, dest, purpose, at: Date.now() }); log('rewards claim unconfirmed, will check', e.signature.slice(0, 10)); } throw e; }
  }
  // how much a confirmed claim actually moved into ops (SOL: lamport change + fee; tokens: ops' token balance change)
  async function claimedBy(c, sig) {   // exactly what left the pool's quote vault in that claim tx
    const t = await getTxRetry(conn, sig); if (!t || t.meta.err) return 0;
    const vpw = await dbc.state.getPool(new PublicKey(c.pool)), vault = (vpw.poolState || vpw).quoteVault.toBase58();
    const keys = t.transaction.message.getAccountKeys({ accountKeysFromLookups: t.meta.loadedAddresses }), idx = [...Array(keys.length).keys()].find((i) => keys.get(i).toBase58() === vault);
    if (idx == null) return 0; const amt = (arr) => Number((arr || []).find((b) => b.accountIndex === idx)?.uiTokenAmount.amount || 0);
    return Math.max(0, amt(t.meta.preTokenBalances) - amt(t.meta.postTokenBalances));
  }
  // ops' token account for a coin is only needed for a moment: close it when it's empty so its rent comes back
  async function closeIfEmpty(c) { const ata = getAssociatedTokenAddressSync(new PublicKey(c.mint), ops.publicKey, false, TOKEN_2022_PROGRAM_ID), ai = await conn.getAccountInfo(ata); if (!ai) return null;
    try { const a = unpackAccount(ata, ai, TOKEN_2022_PROGRAM_ID); if (a.amount === 0n && !(getTransferFeeAmount(a)?.withheldAmount > 0n)) return createCloseAccountInstruction(ata, ops.publicKey, ops.publicKey, [], TOKEN_2022_PROGRAM_ID); } catch {} return null; }
  // ---- step 2: pass the exact claimed amount on ----
  async function transferExact(c, amount, dest, kind, claimSig) {
    const QM = quoteOf(c), rcv = new PublicKey(dest), ixs = [];
    if (QM.equals(NATIVE_MINT)) ixs.push(SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: rcv, lamports: amount }));
    else { const qprog = (await conn.getAccountInfo(QM)).owner, dst = getAssociatedTokenAddressSync(QM, rcv, true, qprog), src = getAssociatedTokenAddressSync(QM, ops.publicKey, false, qprog);
      if (!(await conn.getAccountInfo(dst))) { if (dest === treasury) ixs.push(createAssociatedTokenAccountIdempotentInstruction(ops.publicKey, dst, rcv, QM, qprog));   // only ever for treid's own treasury
        else throw new Error(`receiver has no ${c.quote_symbol || 'pair token'} account yet — add ${c.quote_symbol || 'it'} to the wallet; the payout waits`); }
      ixs.push(createTransferCheckedInstruction(src, QM, dst, ops.publicKey, BigInt(amount), c.quote_dec ?? 6, [], qprog)); }
    ixs.push(memo(`treid:${kind}:${c.mint}:${amount}:${dest}|${claimSig}`)); const cl0 = await closeIfEmpty(c); if (cl0) ixs.push(cl0);
    const s = await sendTx(conn, ixs, [ops]); record(s, [{ mint: c.mint, kind, lamports: amount, extra: `${dest}|${claimSig}` }]);
    log('rewards', kind, c.symbol, (amount / 10 ** (c.quote_dec ?? 9)).toFixed(4), c.quote_symbol || 'SOL', '→', dest.slice(0, 6)); return s;
  }
  async function buybackExact(c, amount, claimSig) {
    const mint = new PublicKey(c.mint), ata = getAssociatedTokenAddressSync(mint, ops.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const vpw = await dbc.state.getPool(new PublicKey(c.pool)), vp = vpw.poolState || vpw, cfg = await dbc.state.getPoolConfig(vp.config);
    const done = vp.isMigrated || BigInt(vp.quoteReserve.toString()) >= BigInt(cfg.migrationQuoteThreshold.toString());
    let sig;
    if (!done) {   // still on the curve: swap on the DBC pool, 2% slippage over the coin's own tax
      const cp = await getCurrentPoint(conn, cfg.activationType), slip = 200 + Math.round((c.tax_bps || 0));
      const qt = dbc.pool.swapQuote2({ virtualPool: vpw.poolState ? vpw : { poolState: vp }, config: cfg, swapBaseForQuote: false, amountIn: new BN(amount), slippageBps: slip, hasReferral: false, currentPoint: cp, swapMode: SwapMode.ExactIn });
      const sw = await dbc.pool.swap2({ owner: ops.publicKey, pool: new PublicKey(c.pool), swapBaseForQuote: false, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: new BN(amount), minimumAmountOut: qt.minimumAmountOut || new BN(0) });
      sig = await sendTx(conn, new Transaction().add(...sw.instructions, memo(`treid:buyback:${c.mint}:${amount}:${claimSig}`)), [ops]);
    } else {   // graduated: buy through Jupiter (it routes to the coin's DAMM pool)
      if (!mainnet) throw new Error('graduated pool: buyback needs Jupiter (mainnet only) — will retry');
      const qr = await (await fetchT(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${quoteOf(c).toBase58()}&outputMint=${c.mint}&amount=${amount}&slippageBps=${300 + (c.tax_bps || 0)}`)).json();
      if (!qr?.outAmount || qr.outputMint !== c.mint) throw new Error('no Jupiter route for buyback');
      const sw = await (await fetchT('https://lite-api.jup.ag/swap/v1/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: qr, userPublicKey: ops.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }) })).json();
      const vt = VersionedTransaction.deserialize(Buffer.from(sw.swapTransaction, 'base64')); if (!vt.message.staticAccountKeys[0].equals(ops.publicKey)) throw new Error('jupiter tx not paid by ops');
      vt.sign([ops]); sig = await conn.sendRawTransaction(vt.serialize(), { maxRetries: 3 }); await conn.confirmTransaction(sig, 'confirmed');
      await stamp(c.mint, 'buyback', amount, claimSig);
    }
    if (!done) record(sig, [{ mint: c.mint, kind: 'buyback', lamports: amount, extra: claimSig }]);
    const t = await getTxRetry(conn, sig), tb = (arr) => (arr || []).filter((b) => b.mint === c.mint && b.owner === ops.publicKey.toBase58()).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const got = t ? tb(t.meta.postTokenBalances) - tb(t.meta.preTokenBalances) : 0n;   // burn exactly what this swap bought
    if (got > 0n) await stamp(c.mint, 'burntok', Number(got), null, [createBurnCheckedInstruction(ata, mint, ops.publicKey, got, 6, [], TOKEN_2022_PROGRAM_ID)]);
    const cl1 = await closeIfEmpty(c); if (cl1) await sendTx(conn, [cl1], [ops]).catch(() => {});   // empty again → close it, rent back to ops
    log('rewards buyback', c.symbol, (amount / 10 ** (c.quote_dec ?? 9)).toFixed(4), c.quote_symbol || 'SOL', '→ burned', (Number(got) / 1e6).toFixed(0), 'tokens');
  }
  // finish every claim whose step 2 hasn't happened (crash, timeout, missing receiver account, failed buyback…)
  const settledSet = () => new Set(q(`SELECT extra FROM rlog WHERE kind IN ('pay','platform','buyback','pay0') AND extra IS NOT NULL`).map((r) => String(r.extra).split('|').pop()));
  async function reconcile() {
    for (const [sig, p] of pending) { const st = (await conn.getSignatureStatus(sig, { searchTransactionHistory: true }).catch(() => null))?.value;
      if (st && !st.err && st.confirmationStatus) { record(sig, [{ mint: p.mint, kind: 'claimx', lamports: p.amount, extra: `${p.dest}|${p.purpose}` }]); pending.delete(sig); }
      else if (st?.err || Date.now() - p.at > 10 * 60e3) pending.delete(sig); }   // failed or long expired → nothing was claimed
    const done = settledSet();
    for (const r of q(`SELECT sig, mint, lamports, extra FROM rlog WHERE kind='claimx' ORDER BY ts`)) { if (done.has(r.sig)) continue;
      const c = q1('SELECT * FROM coins WHERE mint=?', r.mint); if (!c) continue; const [dest, purpose] = String(r.extra || '').split('|');
      try { const got = await claimedBy(c, r.sig);
        if (got <= 0) { record(r.sig + ':0', [{ mint: c.mint, kind: 'pay0', lamports: 0, extra: r.sig }]); continue; }   // the pool had nothing left — mark done (local only)
        if (purpose === 'buyback') await buybackExact(c, got, r.sig); else await transferExact(c, got, dest, purpose === 'platform' ? 'platform' : 'pay', r.sig);
      } catch (e) { log('rewards settle later', c.symbol, purpose, e.message.slice(0, 100)); } }
  }
  // SOL that sits in ops waiting for step 2 (never swept to the treasury)
  function liabilities() {
    const done = settledSet(); let tot = 0;
    for (const r of q(`SELECT sig, mint, lamports FROM rlog WHERE kind='claimx'`)) { if (done.has(r.sig)) continue; const c = q1('SELECT quote_mint FROM coins WHERE mint=?', r.mint); if (!c || !c.quote_mint || c.quote_mint === NATIVE_MINT.toBase58()) tot += r.lamports; }
    for (const p of pending.values()) tot += p.amount; return tot;
  }
  async function payout(c, amount, dest, purpose) { const s = await claim(c, amount, dest, purpose); await reconcileOne(c, s, dest, purpose); return s; }
  async function reconcileOne(c, sig, dest, purpose) { const got = await claimedBy(c, sig); if (got <= 0) return; if (purpose === 'buyback') await buybackExact(c, got, sig); else await transferExact(c, got, dest, purpose === 'platform' ? 'platform' : 'pay', sig); }

  // ---- community takeover ----
  let balCache = new Map();
  async function bals(mint, fresh = false) { const h = balCache.get(mint); if (!fresh && h && Date.now() - h.at < 60e3) return h.m; const m = await balances(mint); balCache.set(mint, { at: Date.now(), m }); return m; }
  const pastLeads = (c) => new Set([c.creator, ...q(`SELECT extra FROM rlog WHERE mint=? AND kind='cto'`, c.mint).map((r) => r.extra)]);
  const held = new Map();   // since when an applicant has continuously had enough support, per round (resets on restart = safer)
  async function applications(c) {
    const e = era(c); if (e.type !== 'out') return [];
    const apps = q(`SELECT extra, ts FROM rlog WHERE mint=? AND kind='ctoapply' AND ts>=? ORDER BY ts`, c.mint, e.start), votes = q('SELECT voter, applicant FROM ctovotes WHERE mint=? AND round=?', c.mint, e.start);
    const m = await bals(c.mint), banned = pastLeads(c), seen = new Set();
    return apps.map((a) => { const [wallet, ...plan] = (a.extra || '').split('|'); return { wallet, plan: plan.join(' '), at: a.ts }; }).filter((a) => !seen.has(a.wallet) && seen.add(a.wallet) && !banned.has(a.wallet))
      .map((a) => { const sup = new Set([a.wallet]); for (const v of votes) if (v.applicant === a.wallet && !banned.has(v.voter)) sup.add(v.voter);
        const tok = [...sup].reduce((s, w) => s + (m.get(w) || 0), 0), own = m.get(a.wallet) || 0;
        return { ...a, supporters: sup.size, supportPct: tok / SUPPLY * 100, ownPct: own / SUPPLY * 100, eligible: own / SUPPLY * 100 >= RULES.ctoApplyPct }; })
      .sort((x, y) => y.supportPct - x.supportPct);
  }
  async function tryApprove(c) {
    const e = era(c); if (e.type !== 'out') return null;
    await bals(c.mint, true); const apps = await applications(c), now = Date.now();
    for (const a of apps) { const k = c.mint + '|' + e.start + '|' + a.wallet; if (a.eligible && a.supportPct >= RULES.ctoSupportPct) { if (!held.has(k)) held.set(k, now); } else held.delete(k); }
    const best = apps.find((a) => { const k = c.mint + '|' + e.start + '|' + a.wallet; return held.has(k) && now - held.get(k) >= RULES.ctoHoldMs; }); if (!best) return null;
    const bag = Math.round(((await bals(c.mint)).get(best.wallet) || 0) * 1e6);   // the lead's real bag at approval = their starting peak
    await stamp(c.mint, 'cto', bag, best.wallet); log('rewards CTO approved', c.symbol, '→', best.wallet.slice(0, 6), best.supportPct.toFixed(1) + '%'); return best;
  }

  // ---- the cycle: only coins where something happened, plus a slow sweep of the rest ----
  const lastDone = new Map();
  function due(c) {
    const lt = q1('SELECT MAX(ts) t FROM trades WHERE mint=?', c.mint)?.t || 0, ld = lastDone.get(c.mint) || 0;
    if (lt > ld) return true;                                   // new trades since we last looked
    if (Date.now() - ld > 6 * 36e5) return true;                // everything else: every 6h
    const st = state(c); return st.era !== 'out' && (st.state !== (lastDone.get(c.mint + '|st') || 'active'));   // a state change by time (idle → paused/out)
  }
  async function cycleCoin(c) {
    const vpw = await dbc.state.getPool(new PublicKey(c.pool)), vp = vpw?.poolState || vpw; if (!vp || vp.creator.toBase58() !== ops.publicKey.toBase58()) { lastDone.set(c.mint, Date.now()); return; }
    const e = era(c); if (e.wallet) { const m = await bals(c.mint, true); balNow.set(c.mint + '|' + e.wallet, m.get(e.wallet) || 0); }
    let st = state(c);
    if (st.era !== 'out' && st.state === 'out') { await stamp(c.mint, 'out', 0, st.creator); log('rewards creator out', c.symbol, st.why); st = state(c); }
    if (st.era === 'out') { if (await tryApprove(c)) st = state(c); }
    const inPool = Number(vp.creatorQuoteFee.toString());
    if (st.era !== 'out' && st.state === 'active') { if (inPool >= units(c, PAY_USD)) await payout(c, inPool, st.creator, 'pay'); }
    else if (st.era !== 'out' && st.state === 'frozen') { if (inPool >= units(c, ACTION_USD)) await payout(c, inPool, 'burn', 'buyback'); }   // claimed NOW, so a later check-in can't collect the idle period's fees
    else if (st.era === 'out' && inPool >= units(c, ACTION_USD)) { const half = Math.floor(inPool / 2); await payout(c, inPool - half, treasury, 'platform'); await payout(c, half, 'burn', 'buyback').catch((er) => log('rewards buyback later', c.symbol, er.message.slice(0, 80))); }
    lastDone.set(c.mint, Date.now()); lastDone.set(c.mint + '|st', state(c).state);
  }
  let cycQueued = false;
  const cycle = () => { if (!READY || cycQueued) return; cycQueued = true; return withLock(async () => {
    try { await reconcile(); } catch (e) { log('rewards reconcile err', e.message.slice(0, 120)); }
    for (const c of q('SELECT * FROM coins')) { try { if (due(c)) await cycleCoin(c); } catch (e) { log('rewards err', c.symbol, e.message.slice(0, 140)); } }
  }).finally(() => { cycQueued = false; }); };
  const coin = (mint) => { const c = q1('SELECT * FROM coins WHERE mint=?', mint); if (!c) throw new Error('unknown coin'); return c; };

  async function ping({ mint, wallet, ts, sig }) {
    needReady(); const c = coin(mint), st = state(c); fresh(ts); if (!verify(pingMessage(mint, ts), sig, wallet)) throw new Error('bad signature'); guard('ping', wallet, sig);
    if (st.era === 'out' || st.state === 'out') throw new Error('creator is already out'); if (wallet !== st.creator) throw new Error('only the current creator can check in');
    const lastP = q1(`SELECT MAX(ts) t FROM rlog WHERE mint=? AND kind='ping'`, mint).t || 0; if (st.state === 'active' && Date.now() - lastP < 12 * 36e5) return { ok: true, already: true };   // on-chain at most every 12h while active
    await withLock(() => stamp(mint, 'ping', 0, wallet)); lastDone.delete(mint); return { ok: true };
  }
  async function claimNow({ mint, wallet, ts, sig }) {
    needReady(); const c = coin(mint); fresh(ts); if (!verify(claimMessage(mint, ts), sig, wallet)) throw new Error('bad signature'); guard('claim', wallet, sig);
    return withLock(async () => { const st = state(c); if (wallet !== st.creator) throw new Error('only the current creator can claim');
      if (st.state !== 'active') throw new Error(st.state === 'frozen' ? 'payouts are paused — tap “I’m still here” first' : 'creator is out');
      const vpw = await dbc.state.getPool(new PublicKey(c.pool)), inPool = Number((vpw.poolState || vpw).creatorQuoteFee.toString());
      if (inPool < units(c, CLAIM_USD)) throw new Error('claims start at $1 — keep building fees');
      const before = sum(c.mint, 'pay'); const s = await payout(c, inPool, wallet, 'pay'); const paid = sum(c.mint, 'pay') - before;
      return { ok: true, sol: paid / 10 ** (c.quote_dec ?? 9), quote: c.quote_symbol || 'SOL', sig: s }; });
  }
  async function ctoApply({ mint, wallet, ts, sig, plan }) {
    needReady(); const c = coin(mint), p = cleanPlan(plan); fresh(ts); if (p.length < 10) throw new Error('write a short plan (10+ characters)');
    if (!verify(applyMessage(mint, ts, String(plan || '').slice(0, 240)), sig, wallet) && !verify(applyMessage(mint, ts, p), sig, wallet)) throw new Error('bad signature'); guard('apply', wallet, sig);
    const e = era(c); if (e.type !== 'out') throw new Error('takeovers open only when the creator is out'); if (pastLeads(c).has(wallet)) throw new Error('this wallet can’t lead this coin');
    if (q1(`SELECT 1 FROM rlog WHERE mint=? AND kind='ctoapply' AND ts>=? AND extra LIKE ?`, mint, e.start, wallet + '|%')) throw new Error('you already applied');
    const own = (await bals(mint)).get(wallet) || 0; if (own / SUPPLY * 100 < RULES.ctoApplyPct) throw new Error(`you need at least ${RULES.ctoApplyPct}% of the supply to apply`);
    await withLock(() => stamp(mint, 'ctoapply', 0, wallet + '|' + p)); return { ok: true };
  }
  async function ctoVote({ mint, applicant, wallet, ts, sig }) {
    needReady(); const c = coin(mint); fresh(ts); if (!verify(voteMessage(mint, applicant, ts), sig, wallet)) throw new Error('bad signature'); guard('vote', wallet, sig);
    const e = era(c); if (e.type !== 'out') throw new Error('no takeover vote is open'); if (pastLeads(c).has(wallet)) throw new Error('this wallet can’t vote here');
    const prev = q1('SELECT applicant, ts FROM ctovotes WHERE mint=? AND round=? AND voter=?', mint, e.start, wallet);
    if (prev?.applicant === applicant) return { ok: true, approved: false, already: true }; if (prev && Date.now() - prev.ts < 6 * 36e5) throw new Error('you can change your vote once every 6 hours');
    if (!((await bals(mint)).get(wallet) > 0)) throw new Error('only holders can support a takeover');
    run('INSERT OR REPLACE INTO ctovotes VALUES(?,?,?,?,?,?)', mint, e.start, wallet, applicant, Date.now(), sig);   // signed, stored; balances are re-checked every cycle for 24h
    return { ok: true, approved: false };
  }
  return { rebuild, cycle, state, era, applications, ping, claimNow, ctoApply, ctoVote, liabilities, ready: () => READY,
    logFor: (mint) => q(`SELECT sig, kind, lamports, ts, extra FROM rlog WHERE mint=? AND kind NOT IN ('ctoapply','claimx','pay0') ORDER BY ts DESC LIMIT 30`, mint) };
}
