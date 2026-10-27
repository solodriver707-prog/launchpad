// treid creator rewards + community takeover (CTO).
// The ops wallet is the pool "creator" of treid coins; the creator's trading fees stay in the Meteora pool until paid out.
//   era "dev" / "cto" (a creator wallet is in charge):
//     active → paid automatically once ≥ $1 has built up, or on demand ("Claim now", from $1)
//     48h idle → paused: the fees are claimed and used to buy back & burn the coin
//     7d idle, or ≥70% of the bag gone (sold, transferred away, or both) → out
//   era "out": 50% buyback & burn, 50% treid platform · holders can elect a new lead (applicant ≥1%, support ≥10% held for 24h)
// After graduation the same rules apply to the creator's half of the DAMM v2 pool fees (ops holds both permanently locked LP positions:
// the first one is treid's share, the second the creator's). If Meteora's keeper hasn't migrated a finished curve after GRAD_WAIT, ops does it.
// Money rule: every payout is two steps — (1) claim from the pool into ops, (2) pass on EXACTLY the amount that step 1 received.
// Both steps leave on-chain memos, so an interrupted payout is found and finished after any restart (reconcile).
// Memo format: "treid:<kind>:<mint>:<amount>[:<extra>]" — only memos in transactions PAID BY OPS count.
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, NATIVE_MINT, unpackAccount, getTransferFeeAmount, getAssociatedTokenAddressSync, createBurnCheckedInstruction, createTransferCheckedInstruction, createCloseAccountInstruction, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { SwapMode, getCurrentPoint, deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm, getUnClaimLpFee } from '@meteora-ag/cp-amm-sdk';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import BN from 'bn.js';
import { withLock , HALT, halt, canWrite } from './lock.mjs';
import { sendTx as sendTx0, getTxRetry } from './txutil.mjs';
const sendTx = (...a) => { if (HALT.on) throw new Error('ops halted'); return sendTx0(...a); };   // nothing leaves the ops wallet once the ledger is broken
import { rwOut } from './ops.mjs';
import { verifySig } from './sig.mjs';

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
const DAMM_CFG = DAMM_V2_MIGRATION_FEE_ADDRESS[6], GRAD_WAIT_MS = +(process.env.GRAD_WAIT_MIN ?? 10) * 60e3;   // the "customizable" DAMM v2 config treid coins migrate into
const num = (x) => Number(x?.toString?.() ?? x ?? 0);

export function startRewards({ conn, dbc, ops, treasury, q, q1, run, balances, quoteUsd = () => 150, mainnet = false, log = console.log }) {
  const amm = new CpAmm(conn);
  const units = (c, usd) => { const p = quoteUsd(c) || 0, d = 10 ** (c.quote_dec ?? 9); return p > 0 ? Math.ceil(usd / p * d) : Infinity; };   // no price → never act
  run(`CREATE TABLE IF NOT EXISTS rlog(sig TEXT, i INT, mint TEXT, kind TEXT, lamports INT, ts INT, PRIMARY KEY(sig, i))`);
  try { run('ALTER TABLE rlog ADD COLUMN extra TEXT'); } catch {}
  run(`CREATE TABLE IF NOT EXISTS rpeak(mint TEXT, wallet TEXT, since INT, peak REAL, PRIMARY KEY(mint, wallet, since))`);   // biggest bag seen per era (kept on a persistent disk)
  run('CREATE TABLE IF NOT EXISTS rscan(sig TEXT PRIMARY KEY)');   // ops-wallet txs already read by the ledger rebuild
  run(`CREATE TABLE IF NOT EXISTS ctovotes(mint TEXT, round INT, voter TEXT, applicant TEXT, ts INT, sig TEXT, PRIMARY KEY(mint, round, voter))`);   // off-chain: votes cost ops nothing
  const record = (sig, items) => { try { items.forEach((it, i) => run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', sig, i, it.mint, it.kind, it.lamports, Date.now(), it.extra ?? null)); } catch (e) { halt(e.message); throw e; } };
  const stamp = async (mint, kind, lamports = 0, extra = null, more = []) => { const s = await sendTx(conn, [...more, memo(`treid:${kind}:${mint}:${lamports}` + (extra ? ':' + extra : ''))], [ops]); record(s, [{ mint, kind, lamports, extra }]); return s; };
  const verify = (msg, sig, wallet, ts) => verifySig(msg, sig, wallet, ts);   // site line + legacy window (sig.mjs)
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
      for (const x of page) { if (x.err || q1('SELECT 1 FROM rlog WHERE sig=?', x.signature) || q1('SELECT 1 FROM rscan WHERE sig=?', x.signature)) continue;   // each tx is read once, ever (persistent disk)
        const t = await getTxRetry(conn, x.signature, 4); if (!t) throw new Error('ledger rebuild: could not read ' + x.signature.slice(0, 10) + ' — will retry');   // never start with a hole in the ledger
        const msg = t.transaction.message, keys = msg.getAccountKeys ? msg.getAccountKeys({ accountKeysFromLookups: t.meta.loadedAddresses }) : null, key = (i) => (keys ? keys.get(i) : msg.accountKeys[i]);
        if (!key(0) || !key(0).equals(ops.publicKey)) { run('INSERT OR IGNORE INTO rscan VALUES(?)', x.signature); continue; }   // only transactions PAID BY ops
        const items = (msg.compiledInstructions || []).filter((ix) => key(ix.programIdIndex)?.equals(MEMO)).map((ix) => Buffer.from(ix.data).toString('utf8')).filter((m) => m.startsWith('treid:')).map((m) => { const p = m.split(':'); return { kind: p[1], mint: p[2], lamports: +p[3] || 0, extra: p.length > 4 ? p.slice(4).join(':') : null }; });
        for (const it of items) if (it.kind === 'taxswap' && it.extra) {   // pair-token sale for holders: the receipt is what left the pool's quote vault
          const vi = [...Array(keys ? keys.length : msg.accountKeys.length).keys()].find((i) => key(i)?.toBase58() === it.extra), bal = (arr) => Number((arr || []).find((b) => b.accountIndex === vi)?.uiTokenAmount.amount || 0);
          it.lamports = vi == null ? 0 : Math.max(0, bal(t.meta.preTokenBalances) - bal(t.meta.postTokenBalances)); }
        for (const it of [...items]) if (it.kind === 'tbuy') { items.push({ kind: 'tburn', mint: it.mint, lamports: +(it.extra || 0) || 0, extra: null }, { kind: 'tleft', mint: it.mint, lamports: rwOut(t, ops.publicKey, it.mint), extra: null }); it.extra = null; }   // $TREID buyback: burned in-tx + what stayed
        for (const it of [...items]) if (it.kind === 'taxconv' && it.extra) items.push({ kind: 'taxrw', mint: it.mint, lamports: rwOut(t, ops.publicKey, it.extra), extra: it.extra });   // what that reward swap delivered
        items.forEach((it, i) => run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', x.signature, i, it.mint, it.kind, it.lamports, (x.blockTime || 0) * 1000, it.extra)); n += items.length;
        run('INSERT OR IGNORE INTO rscan VALUES(?)', x.signature); }
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
  const qprogOf = async (c) => (await conn.getAccountInfo(quoteOf(c))).owner;
  // the graduated pool + ops' two locked LP positions, in a fixed order: [0] = treid's share, [1] = the creator's share
  async function dammCtx(c) {
    const pool = c.damm ? new PublicKey(c.damm) : deriveDammV2PoolAddress(DAMM_CFG, new PublicKey(c.mint), quoteOf(c)), ps = await amm.fetchPoolState(pool);
    if (ps.tokenAMint.toBase58() !== c.mint || !ps.tokenBMint.equals(quoteOf(c))) throw new Error('graduated pool does not match the coin');
    const pos = (await amm.getUserPositionByPool(pool, ops.publicKey)).sort((a, b) => (a.position.toBase58() < b.position.toBase58() ? -1 : 1));
    return { pool, ps, pos, fee: (i) => (pos[i] ? num(getUnClaimLpFee(ps, pos[i].positionState).feeTokenB) : 0) };
  }
  // src: 'dbc' = creator fees still in the bonding curve · 'dammP' / 'dammC' = treid's / the creator's graduated LP position
  async function claim(c, amount, dest, purpose, src = 'dbc') {
    let ixs;
    if (src === 'dbc') ixs = (await dbc.creator.claimCreatorTradingFee({ creator: ops.publicKey, payer: ops.publicKey, pool: new PublicKey(c.pool), maxBaseAmount: new BN(0), maxQuoteAmount: new BN(amount) })).instructions;
    else { const d = await dammCtx(c), p = d.pos[src === 'dammP' ? 0 : 1]; if (!p) throw new Error('LP position not found');
      ixs = (await amm.claimPositionFee2({ receiver: ops.publicKey, owner: ops.publicKey, feePayer: ops.publicKey, pool: d.pool, position: p.position, positionNftAccount: p.positionNftAccount, tokenAVault: d.ps.tokenAVault, tokenBVault: d.ps.tokenBVault,
        tokenAMint: d.ps.tokenAMint, tokenBMint: d.ps.tokenBMint, tokenAProgram: TOKEN_2022_PROGRAM_ID, tokenBProgram: await qprogOf(c) })).instructions; }
    const extra = `${dest}|${purpose}` + (src === 'dbc' ? '' : '|' + src), tx = new Transaction().add(...ixs, memo(`treid:claimx:${c.mint}:${amount}:${extra}`));
    try { const s = await sendTx(conn, tx, [ops]); record(s, [{ mint: c.mint, kind: 'claimx', lamports: amount, extra }]); return s; }
    catch (e) { if (e.unconfirmed) { pending.set(e.signature, { mint: c.mint, amount, extra, at: Date.now() }); log('rewards claim unconfirmed, will check', e.signature.slice(0, 10)); } throw e; }
  }
  // how much a confirmed claim actually moved into ops (SOL: lamport change + fee; tokens: ops' token balance change)
  async function claimedBy(c, sig, src = 'dbc') {   // exactly what left the pool's quote vault in that claim tx
    const t = await getTxRetry(conn, sig); if (!t) throw new Error('claim receipt not readable yet — retry later'); if (t.meta.err) return 0;   // unread ≠ empty: never mark a real claim as done
    let vault; if (src === 'dbc') { const vpw = await dbc.state.getPool(new PublicKey(c.pool)); vault = (vpw.poolState || vpw).quoteVault.toBase58(); } else vault = (await dammCtx(c)).ps.tokenBVault.toBase58();
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
    const migrated = num(vp.isMigrated) > 0, done = migrated || BigInt(vp.quoteReserve.toString()) >= BigInt(cfg.migrationQuoteThreshold.toString());
    let sig;
    if (!done) {   // still on the curve: swap on the DBC pool, 2% slippage over the coin's own tax
      const cp = await getCurrentPoint(conn, cfg.activationType), slip = 200 + Math.round((c.tax_bps || 0));
      const qt = dbc.pool.swapQuote2({ virtualPool: vpw.poolState ? vpw : { poolState: vp }, config: cfg, swapBaseForQuote: false, amountIn: new BN(amount), slippageBps: slip, hasReferral: false, currentPoint: cp, swapMode: SwapMode.ExactIn });
      const sw = await dbc.pool.swap2({ owner: ops.publicKey, pool: new PublicKey(c.pool), swapBaseForQuote: false, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: new BN(amount), minimumAmountOut: qt.minimumAmountOut || new BN(0) });
      sig = await sendTx(conn, new Transaction().add(...sw.instructions, memo(`treid:buyback:${c.mint}:${amount}:${claimSig}`)), [ops]);
    } else if (migrated) {   // graduated: swap on the coin's own DAMM v2 pool (where its liquidity lives), same slippage rule
      const d = await dammCtx(c), cp = await getCurrentPoint(conn, d.ps.activationType);
      const qt = amm.getQuote2({ inputTokenMint: d.ps.tokenBMint, slippage: 0, poolState: d.ps, currentPoint: cp, hasReferral: false, tokenADecimal: 6, tokenBDecimal: c.quote_dec ?? 9, swapMode: 0, amountIn: new BN(amount) });
      const minOut = BigInt(qt.outputAmount.toString()) * BigInt(10000 - 200 - (c.tax_bps || 0)) / 10000n;
      const sw = await amm.swap2({ payer: ops.publicKey, pool: d.pool, inputTokenMint: d.ps.tokenBMint, outputTokenMint: d.ps.tokenAMint, amountIn: new BN(amount), minimumAmountOut: new BN(minOut.toString()), tokenAVault: d.ps.tokenAVault, tokenBVault: d.ps.tokenBVault,
        tokenAMint: d.ps.tokenAMint, tokenBMint: d.ps.tokenBMint, tokenAProgram: TOKEN_2022_PROGRAM_ID, tokenBProgram: await qprogOf(c), referralTokenAccount: null, swapMode: 0 });
      sig = await sendTx(conn, new Transaction().add(...sw.instructions, memo(`treid:buyback:${c.mint}:${amount}:${claimSig}`)), [ops]);
    } else throw new Error('curve finished — buyback waits for the migration');
    record(sig, [{ mint: c.mint, kind: 'buyback', lamports: amount, extra: claimSig }]);
    const t = await getTxRetry(conn, sig), tb = (arr) => (arr || []).filter((b) => b.mint === c.mint && b.owner === ops.publicKey.toBase58()).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const got = t ? tb(t.meta.postTokenBalances) - tb(t.meta.preTokenBalances) : 0n;   // burn exactly what this swap bought
    if (got > 0n) await stamp(c.mint, 'burntok', Number(got), null, [createBurnCheckedInstruction(ata, mint, ops.publicKey, got, 6, [], TOKEN_2022_PROGRAM_ID)]);
    const cl1 = await closeIfEmpty(c); if (cl1) await sendTx(conn, [cl1], [ops]).catch(() => {});   // empty again → close it, rent back to ops
    log('rewards buyback', c.symbol, (amount / 10 ** (c.quote_dec ?? 9)).toFixed(4), c.quote_symbol || 'SOL', '→ burned', (Number(got) / 1e6).toFixed(0), 'tokens');
  }
  // finish every claim whose step 2 hasn't happened (crash, timeout, missing receiver account, failed buyback…)
  const settledSet = () => new Set(q(`SELECT extra FROM rlog WHERE kind IN ('pay','platform','buyback','pay0') AND extra IS NOT NULL`).map((r) => String(r.extra).split('|').pop()));
  const isSettled = (sig, purpose, done) => (purpose === 'split' ? done.has(sig + '#p') && done.has(sig + '#b') : done.has(sig));
  async function settle(c, sig, extra, done = settledSet()) {   // step 2 for one claim — each part only once, even after a crash halfway
    const [dest, purpose, src = 'dbc'] = String(extra || '').split('|'), got = await claimedBy(c, sig, src);
    if (got <= 0) { (purpose === 'split' ? ['#p', '#b'] : ['']).forEach((x) => record(sig + ':0' + x, [{ mint: c.mint, kind: 'pay0', lamports: 0, extra: sig + x }])); return; }   // the pool had nothing to give — mark done
    if (purpose === 'split') { const half = Math.floor(got / 2);
      if (!done.has(sig + '#p')) await transferExact(c, got - half, treasury, 'platform', sig + '#p');
      if (half > 0 && !done.has(sig + '#b')) await buybackExact(c, half, sig + '#b'); else if (!done.has(sig + '#b')) record(sig + ':b0', [{ mint: c.mint, kind: 'pay0', lamports: 0, extra: sig + '#b' }]); }
    else if (purpose === 'buyback') await buybackExact(c, got, sig);
    else await transferExact(c, got, dest, purpose === 'platform' ? 'platform' : 'pay', sig);
  }
  async function reconcile() {
    for (const [sig, p] of pending) { const st = (await conn.getSignatureStatus(sig, { searchTransactionHistory: true }).catch(() => null))?.value;
      if (st && !st.err && st.confirmationStatus) { record(sig, [{ mint: p.mint, kind: 'claimx', lamports: p.amount, extra: p.extra }]); pending.delete(sig); }
      else if (st?.err || Date.now() - p.at > 10 * 60e3) pending.delete(sig); }   // failed or long expired → nothing was claimed
    const done = settledSet();
    for (const r of q(`SELECT sig, mint, lamports, extra FROM rlog WHERE kind='claimx' ORDER BY ts`)) { const purpose = String(r.extra || '').split('|')[1]; if (isSettled(r.sig, purpose, done)) continue;
      const c = q1('SELECT * FROM coins WHERE mint=?', r.mint); if (!c) continue;
      try { await settle(c, r.sig, r.extra, done); } catch (e) { log('rewards settle later', c.symbol, purpose, e.message.slice(0, 100)); } }
  }
  // SOL that sits in ops waiting for step 2 (never swept to the treasury)
  function liabilities() {
    const done = settledSet(); let tot = 0;
    for (const r of q(`SELECT sig, mint, lamports, extra FROM rlog WHERE kind='claimx'`)) { if (isSettled(r.sig, String(r.extra || '').split('|')[1], done)) continue; const c = q1('SELECT quote_mint FROM coins WHERE mint=?', r.mint); if (!c || !c.quote_mint || c.quote_mint === NATIVE_MINT.toBase58()) tot += r.lamports; }
    for (const p of pending.values()) tot += p.amount; return tot;
  }
  // fees still in the curve: the claimable amount is known exactly (only ops can claim it, it only grows), so claim N and pass N on
  // in ONE transaction — half the fees, and nothing can be left half-done. (LP-position fees can't be capped, so they keep two steps.)
  async function payAtomic(c, amount, dest, kind) {
    const QM = quoteOf(c), rcv = new PublicKey(dest), ixs = [...(await dbc.creator.claimCreatorTradingFee({ creator: ops.publicKey, payer: ops.publicKey, pool: new PublicKey(c.pool), maxBaseAmount: new BN(0), maxQuoteAmount: new BN(amount) })).instructions];
    if (QM.equals(NATIVE_MINT)) ixs.push(SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: rcv, lamports: amount }));
    else { const qprog = await qprogOf(c), dst = getAssociatedTokenAddressSync(QM, rcv, true, qprog);
      if (!(await conn.getAccountInfo(dst))) { if (dest === treasury) ixs.push(createAssociatedTokenAccountIdempotentInstruction(ops.publicKey, dst, rcv, QM, qprog)); else throw new Error(`receiver has no ${c.quote_symbol || 'pair token'} account yet — add ${c.quote_symbol || 'it'} to the wallet; the payout waits`); }
      ixs.push(createTransferCheckedInstruction(getAssociatedTokenAddressSync(QM, ops.publicKey, false, qprog), QM, dst, ops.publicKey, BigInt(amount), c.quote_dec ?? 6, [], qprog)); }
    const ata = getAssociatedTokenAddressSync(new PublicKey(c.mint), ops.publicKey, false, TOKEN_2022_PROGRAM_ID), had = await conn.getAccountInfo(ata), cl0 = had ? await closeIfEmpty(c) : createCloseAccountInstruction(ata, ops.publicKey, ops.publicKey, [], TOKEN_2022_PROGRAM_ID);
    if (cl0) ixs.push(cl0);   // the claim opens ops' coin account: close it in the same tx, rent back
    ixs.push(memo(`treid:${kind}:${c.mint}:${amount}:${dest}|atomic`));
    const s = await sendTx(conn, ixs, [ops]); record(s, [{ mint: c.mint, kind, lamports: amount, extra: `${dest}|atomic` }]);
    log('rewards', kind, c.symbol, (amount / 10 ** (c.quote_dec ?? 9)).toFixed(4), c.quote_symbol || 'SOL', '→', dest.slice(0, 6), '(1 tx)'); return s;
  }
  async function payout(c, amount, dest, purpose, src = 'dbc') { if (src === 'dbc' && (purpose === 'pay' || purpose === 'platform')) return payAtomic(c, amount, dest, purpose);
    const s = await claim(c, amount, dest, purpose, src); await settle(c, s, `${dest}|${purpose}` + (src === 'dbc' ? '' : '|' + src)); return s; }
  // the creator's fees, wherever they are: still in the curve, and (after graduation) the creator's LP position
  async function creatorSources(c, vp) {
    const out = [['dbc', num(vp.creatorQuoteFee)]]; let platform = 0;
    if (num(vp.isMigrated) > 0) { const d = await dammCtx(c).catch((e) => { log('rewards damm', c.symbol, e.message.slice(0, 80)); return null; }); if (d && d.pos.length === 2) { platform = d.fee(0); out.push(['dammC', d.fee(1)]); } }
    return { list: out, platform };
  }
  async function maybeMigrate(c, vp, cfg) {   // Meteora's keeper normally migrates a finished curve within minutes; ops only steps in when it hasn't
    if (num(vp.isMigrated) > 0 || BigInt(vp.quoteReserve.toString()) < BigInt(cfg.migrationQuoteThreshold.toString())) return false;
    const fin = num(vp.finishCurveTimestamp) * 1000; if (!fin || Date.now() - fin < GRAD_WAIT_MS) return false;
    const gradUsd = Number(cfg.migrationQuoteThreshold.toString()) / 10 ** (c.quote_dec ?? 9) * (quoteUsd(c) || 0); if (gradUsd < 3000) return false;   // ops only pays the migration rent for real graduations, never for a toy curve
    const r = await dbc.migration.migrateToDammV2({ pool: new PublicKey(c.pool), dammConfig: DAMM_CFG, payer: ops.publicKey });
    const s = await sendTx(conn, r.transaction, [ops, r.firstPositionNftKeypair, r.secondPositionNftKeypair]);   // no memo: the migration tx is already at the size limit
    record(s, [{ mint: c.mint, kind: 'migrate', lamports: 0 }]); log('rewards migrated', c.symbol, 'to DAMM v2'); return true;
  }

  async function walletBal(mint, wallet) {   // all of one wallet's token accounts for this coin, added up (1 RPC call)
    const r = await conn.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: new PublicKey(mint) }, 'confirmed');
    return r.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.amount) / 1e6, 0);
  }
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
    if (!q1(`SELECT 1 FROM rlog WHERE mint=? AND kind='ctoapply' AND ts>=?`, c.mint, e.start)) return null;   // nobody applied → no holder scan
    await bals(c.mint, true); const apps = await applications(c), now = Date.now();
    for (const a of apps) { const k = c.mint + '|' + e.start + '|' + a.wallet; if (a.eligible && a.supportPct >= RULES.ctoSupportPct) { if (!held.has(k)) held.set(k, now); } else held.delete(k); }
    const best = apps.find((a) => { const k = c.mint + '|' + e.start + '|' + a.wallet; return held.has(k) && now - held.get(k) >= RULES.ctoHoldMs; }); if (!best) return null;
    const bag = Math.round(((await bals(c.mint)).get(best.wallet) || 0) * 1e6);   // the lead's real bag at approval = their starting peak
    await stamp(c.mint, 'cto', bag, best.wallet); log('rewards CTO approved', c.symbol, '→', best.wallet.slice(0, 6), best.supportPct.toFixed(1) + '%'); return best;
  }

  // ---- the cycle: only coins where something happened, plus a slow sweep of the rest ----
  const lastDone = new Map(), cfgCache = new Map();
  function due(c) {
    const lt = q1('SELECT MAX(ts) t FROM trades WHERE mint=?', c.mint)?.t || 0, ld = lastDone.get(c.mint) || 0;
    if (lt > ld) return true;                                   // new trades since we last looked
    if (!c.damm && (q1('SELECT progress p FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 1', c.mint)?.p || 0) >= 100) return true;   // finished curve: watch until migrated
    if (Date.now() - ld > 6 * 36e5) { const e = era(c); if (e.type !== 'out') return true;   // creator in charge: idle timers run → every 6h
      return !!q1(`SELECT 1 FROM rlog WHERE mint=? AND kind='ctoapply' AND ts>=?`, c.mint, e.start); }   // out & no trades: fees can't grow; only a takeover vote needs a look
    const st = state(c); return st.era !== 'out' && (st.state !== (lastDone.get(c.mint + '|st') || 'active'));   // a state change by time (idle → paused/out)
  }
  async function cycleCoin(c) {
    const vpw = await dbc.state.getPool(new PublicKey(c.pool)), vp = vpw?.poolState || vpw; if (!vp || vp.creator.toBase58() !== ops.publicKey.toBase58()) { lastDone.set(c.mint, Date.now()); return; }
    const cfg = cfgCache.get(c.mint) || await dbc.state.getPoolConfig(vp.config); cfgCache.set(c.mint, cfg); if (await maybeMigrate(c, vp, cfg).catch((er) => { log('rewards migrate err', c.symbol, er.message.slice(0, 100)); return false; })) return;   // fees are picked up next cycle
    const e = era(c); if (e.wallet) balNow.set(c.mint + '|' + e.wallet, await walletBal(c.mint, e.wallet));
    let st = state(c);
    if (st.era !== 'out' && st.state === 'out') { await stamp(c.mint, 'out', 0, st.creator); log('rewards creator out', c.symbol, st.why); st = state(c); }
    if (st.era === 'out') { if (await tryApprove(c)) st = state(c); }
    const src = await creatorSources(c, vp);
    if (src.platform >= units(c, PAY_USD)) await payout(c, src.platform, treasury, 'platform', 'dammP');   // treid's LP share → treasury
    for (const [from, inPool] of src.list) {
      if (st.era !== 'out' && st.state === 'active') { if (inPool >= units(c, PAY_USD)) await payout(c, inPool, st.creator, 'pay', from); }
      else if (st.era !== 'out' && st.state === 'frozen') { if (inPool >= units(c, ACTION_USD)) await payout(c, inPool, 'burn', 'buyback', from); }   // claimed NOW, so a later check-in can't collect the idle period's fees
      else if (st.era === 'out' && inPool >= units(c, ACTION_USD)) await payout(c, inPool, treasury, 'split', from);   // one claim: half treid, half buyback & burn
    }
    lastDone.set(c.mint, Date.now()); lastDone.set(c.mint + '|st', state(c).state);
  }
  let cycQueued = false;
  const cycle = () => { if (!READY || cycQueued || HALT.on || !canWrite(run)) return; cycQueued = true; return withLock(async () => {
    try { await reconcile(); } catch (e) { log('rewards reconcile err', e.message.slice(0, 120)); }
    for (const c of q('SELECT * FROM coins')) { try { if (due(c)) await cycleCoin(c); } catch (e) { log('rewards err', c.symbol, e.message.slice(0, 140)); } }
  }).finally(() => { cycQueued = false; }); };
  const coin = (mint) => { const c = q1('SELECT * FROM coins WHERE mint=?', mint); if (!c) throw new Error('unknown coin'); return c; };

  async function ping({ mint, wallet, ts, sig }) {
    needReady(); const c = coin(mint), st = state(c); fresh(ts); if (!verify(pingMessage(mint, ts), sig, wallet, ts)) throw new Error('bad signature'); guard('ping', wallet, sig);
    if (st.era === 'out' || st.state === 'out') throw new Error('creator is already out'); if (wallet !== st.creator) throw new Error('only the current creator can check in');
    const lastP = q1(`SELECT MAX(ts) t FROM rlog WHERE mint=? AND kind='ping'`, mint).t || 0; if (st.state === 'active' && Date.now() - lastP < 12 * 36e5) return { ok: true, already: true };   // on-chain at most every 12h while active
    await withLock(() => stamp(mint, 'ping', 0, wallet)); lastDone.delete(mint); return { ok: true };
  }
  async function claimNow({ mint, wallet, ts, sig }) {
    needReady(); const c = coin(mint); fresh(ts); if (!verify(claimMessage(mint, ts), sig, wallet, ts)) throw new Error('bad signature'); guard('claim', wallet, sig);
    return withLock(async () => { const st = state(c); if (wallet !== st.creator) throw new Error('only the current creator can claim');
      if (st.state !== 'active') throw new Error(st.state === 'frozen' ? 'payouts are paused — tap “I’m still here” first' : 'creator is out');
      const vpw = await dbc.state.getPool(new PublicKey(c.pool)), src = await creatorSources(c, vpw.poolState || vpw), inPool = src.list.reduce((a, x) => a + x[1], 0);
      if (inPool < units(c, CLAIM_USD)) throw new Error('claims start at $1 — keep building fees');
      const before = sum(c.mint, 'pay'); let s = null; for (const [from, amt] of src.list) if (amt >= units(c, 0.05)) s = await payout(c, amt, wallet, 'pay', from); const paid = sum(c.mint, 'pay') - before;
      return { ok: true, sol: paid / 10 ** (c.quote_dec ?? 9), quote: c.quote_symbol || 'SOL', sig: s }; });
  }
  async function ctoApply({ mint, wallet, ts, sig, plan }) {
    needReady(); const c = coin(mint), p = cleanPlan(plan); fresh(ts); if (p.length < 10) throw new Error('write a short plan (10+ characters)');
    if (!verify(applyMessage(mint, ts, String(plan || '').slice(0, 240)), sig, wallet, ts) && !verify(applyMessage(mint, ts, p), sig, wallet, ts)) throw new Error('bad signature'); guard('apply', wallet, sig);
    const e = era(c); if (e.type !== 'out') throw new Error('takeovers open only when the creator is out'); if (pastLeads(c).has(wallet)) throw new Error('this wallet can’t lead this coin');
    if (q1(`SELECT 1 FROM rlog WHERE mint=? AND kind='ctoapply' AND ts>=? AND extra LIKE ?`, mint, e.start, wallet + '|%')) throw new Error('you already applied');
    const own = (await bals(mint)).get(wallet) || 0; if (own / SUPPLY * 100 < RULES.ctoApplyPct) throw new Error(`you need at least ${RULES.ctoApplyPct}% of the supply to apply`);
    await withLock(() => stamp(mint, 'ctoapply', 0, wallet + '|' + p)); return { ok: true };
  }
  async function ctoVote({ mint, applicant, wallet, ts, sig }) {
    needReady(); const c = coin(mint); fresh(ts); if (!verify(voteMessage(mint, applicant, ts), sig, wallet, ts)) throw new Error('bad signature'); guard('vote', wallet, sig);
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
