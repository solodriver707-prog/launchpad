// treid ops wallet (hot): fee claimer + Token-2022 withheld-tax authority of every treid coin.
// It only works on coins where something happened (trades since the last look), so cost and RPC use follow real activity:
//   · partner fees → claimed straight to the treasury once they're worth ≥ $1
//   · coin tax → harvested once it's worth ≥ $5 (at most hourly per coin), split holders / burn / dev, receipts on-chain
//   · spare SOL → swept to the treasury (never what's owed to creators mid-payout)
import { Keypair, PublicKey, TransactionInstruction, SystemProgram, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, unpackAccount, getTransferFeeAmount, getMint, getTransferFeeConfig, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, createBurnCheckedInstruction, createCloseAccountInstruction, createWithdrawWithheldTokensFromAccountsInstruction, createWithdrawWithheldTokensFromMintInstruction, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import { createHash } from 'node:crypto';
import { withLock } from './lock.mjs';
import { SwapMode, getCurrentPoint, deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import { sendTx, getTxRetry, fetchT, landOrExpire, JUP } from './txutil.mjs';

// OPS_SECRET: a real keypair (JSON array or base58). A plain string is accepted ONLY off mainnet (seeded key, for dev/test).
export function opsKeypair(secret, { mainnet = false } = {}) {
  if (!secret) return null; const s = secret.trim();
  if (s.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  try { const b = bs58.decode(s); if (b.length === 64) return Keypair.fromSecretKey(b); } catch {}
  if (mainnet) throw new Error('OPS_SECRET must be a full 64-byte keypair on mainnet (generated offline and backed up)');
  return Keypair.fromSeed(createHash('sha256').update('treid-ops:' + s).digest());
}
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), memoIx = (t) => new TransactionInstruction({ keys: [], programId: MEMO, data: Buffer.from(t) });
const WSOL = 'So11111111111111111111111111111111111111112', START = Date.now() - 7 * 864e5;   // after a restart: re-check fees of coins traded in the last week
// what a reward swap delivered to ops: SOL = lamport change + the fee ops paid; a token = ops' balance change in that mint
function rwOut(t, owner, rw) {
  if (rw === 'So11111111111111111111111111111111111111112') { const keys = t.transaction.message.staticAccountKeys || t.transaction.message.accountKeys, i = keys.findIndex((k) => k.equals(owner)); return i < 0 ? 0 : Math.max(0, t.meta.postBalances[i] - t.meta.preBalances[i] + (i === 0 ? t.meta.fee : 0)); }
  const tb = (arr) => (arr || []).filter((b) => b.mint === rw && b.owner === owner.toBase58()).reduce((a, b) => a + Number(b.uiTokenAmount.amount), 0);
  return Math.max(0, tb(t.meta.postTokenBalances) - tb(t.meta.preTokenBalances));
}
export { rwOut };
const DEC = 6, HARVEST_USD = 5, SHARE_USD = 0.05, FEE_USD = 1, MAX_ACCTS = 200;
const parseSplit = (uri) => { let pair = false, rw = null; try { const u = new URL(uri), s = u.searchParams.get('s'), r = u.searchParams.get('r') || ''; pair = r === 'p';   // r=p: holders paid in the pair token · r=<mint>: in that token
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r)) rw = r;
    if (s) { const p = s.split('.').map(Number); if (p.length === 3 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 100) && p[0] + p[1] + p[2] === 100) return { h: p[0], b: p[1], d: p[2], pair, rw }; } } catch {} return { h: 70, b: 20, d: 10, pair, rw }; };

export function startOps({ conn, dbc, ops, treasury, q, q1, run, mainnet = false, rewardOk = async () => false, quoteUsd = () => 150, poolAuthority, log = console.log, everyMs = 10 * 60e3, liabilities = () => 0, devState = (c) => ({ state: 'active', creator: c.creator }), ready = () => true }) {
  const send = (ixs) => sendTx(conn, ixs, [ops]), amm = new CpAmm(conn), DAMM_CFG = DAMM_V2_MIGRATION_FEE_ADDRESS[6];
  const rec = (sig, i, mint, kind, amt, extra = null) => { try { run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', sig, i, mint, kind, Number(amt), Date.now(), extra); } catch {} };
  const qmOf = (c) => new PublicKey(c.quote_mint || WSOL), isSol = (c) => !c.quote_mint || c.quote_mint === WSOL;
  // pair-token payouts: quote that was bought for holders but not yet paid out (from the on-chain receipts → survives restarts)
  const pendingQ = (mint) => pendingPair(mint);
  const sumK = (mint, kind) => q1('SELECT COALESCE(SUM(lamports),0) s FROM rlog WHERE mint=? AND kind=?', mint, kind)?.s || 0;
  const pendingPair = (mint) => Math.max(0, sumK(mint, 'taxswap') - sumK(mint, 'taxholdq') - sumK(mint, 'taxconv'));
  const pendingRw = (mint) => Math.max(0, sumK(mint, 'taxrw') - sumK(mint, 'taxholdr'));
  const pendingSol = () => q(`SELECT DISTINCT mint FROM rlog WHERE kind IN ('taxswap','taxrw')`).reduce((a, r) => { const c = q1('SELECT quote_mint, uri FROM coins WHERE mint=?', r.mint); if (!c) return a;
    return a + ((!c.quote_mint || c.quote_mint === WSOL) ? pendingPair(r.mint) : 0) + (parseSplit(c.uri).rw === WSOL ? pendingRw(r.mint) : 0); }, 0);
  // a third reward token: the pair-token proceeds are swapped through Jupiter (mainnet), with our receipt memo inside the same transaction
  async function convertTo(c, rw) {
    if (!mainnet) throw new Error('reward-token swaps need Jupiter (mainnet)'); if (!(await rewardOk(rw))) throw new Error('reward token not allowed');
    const amt = pendingPair(c.mint), inM = qmOf(c).toBase58(); if (amt <= 0) return 0;
    const qr = await (await fetchT(`${JUP}/swap/v1/quote?inputMint=${inM}&outputMint=${rw}&amount=${amt}&slippageBps=300&maxAccounts=40`)).json();
    if (!qr?.outAmount || qr.outputMint !== rw || qr.inputMint !== inM || String(qr.inAmount) !== String(amt)) throw new Error('no route');
    const sw = await (await fetchT(JUP + '/swap/v1/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: qr, userPublicKey: ops.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }) })).json();
    const vt = VersionedTransaction.deserialize(Buffer.from(sw.swapTransaction, 'base64')); if (!vt.message.staticAccountKeys[0].equals(ops.publicKey)) throw new Error('route not paid by ops');
    const luts = (await Promise.all(vt.message.addressTableLookups.map((l) => conn.getAddressLookupTable(l.accountKey)))).map((r) => r.value);
    const msg = TransactionMessage.decompile(vt.message, { addressLookupTableAccounts: luts }); msg.instructions.push(memoIx(`treid:taxconv:${c.mint}:${amt}:${rw}`));
    const vt2 = new VersionedTransaction(msg.compileToV0Message(luts)); vt2.sign([ops]);
    // never sign away more SOL than the swap itself can need (the route comes from an outside API)
    const pre = await conn.getBalance(ops.publicKey), sim = await conn.simulateTransaction(vt2, { sigVerify: false, accounts: { encoding: 'base64', addresses: [ops.publicKey.toBase58()] } });
    if (sim.value.err) throw new Error('route simulation failed'); const post = sim.value.accounts?.[0]?.lamports ?? 0, maxLoss = (inM === WSOL ? amt : 0) + 0.01e9; if (pre - post > maxLoss) throw new Error('route would spend too much SOL — refused');
    const sig = await landOrExpire(conn, vt2.serialize(), bs58.encode(vt2.signatures[0]), sw.lastValidBlockHeight);   // final answer only: landed, or expired and can never land
    const t = await getTxRetry(conn, sig); if (!t || t.meta.err) throw new Error('reward swap failed');
    const out = rwOut(t, ops.publicKey, rw); rec(sig, 0, c.mint, 'taxconv', amt, rw); rec(sig, 1, c.mint, 'taxrw', out, rw);
    log('ops   swapped', amt, c.quote_symbol || 'SOL', 'units →', out, 'of', rw.slice(0, 6), '(holder reward)', c.symbol); return out;
  }
  // sell the holders' share of the tax for the pair token, on the coin's own pool; returns exactly what left the pool's quote vault
  async function sellForQuote(c, amt) {
    const mint = new PublicKey(c.mint), vpw = await dbc.state.getPool(new PublicKey(c.pool)), vp = vpw.poolState || vpw, slip = 300 + (c.tax_bps || 0);
    let ixs, vault;
    if (Number(vp.isMigrated?.toString?.() ?? vp.isMigrated) > 0) {
      const pool = deriveDammV2PoolAddress(DAMM_CFG, mint, qmOf(c)), ps = await amm.fetchPoolState(pool); if (ps.tokenAMint.toBase58() !== c.mint) throw new Error('graduated pool mismatch');
      const qt = amm.getQuote2({ inputTokenMint: ps.tokenAMint, slippage: 0, poolState: ps, currentPoint: await getCurrentPoint(conn, Number(ps.activationType)), hasReferral: false, tokenADecimal: DEC, tokenBDecimal: c.quote_dec ?? 9, swapMode: 0, amountIn: new BN(amt.toString()) });
      const minOut = BigInt(qt.outputAmount.toString()) * BigInt(10000 - slip) / 10000n, qprog = (await conn.getAccountInfo(qmOf(c))).owner;
      ixs = (await amm.swap2({ payer: ops.publicKey, pool, inputTokenMint: ps.tokenAMint, outputTokenMint: ps.tokenBMint, amountIn: new BN(amt.toString()), minimumAmountOut: new BN(minOut.toString()), tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault, tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAProgram: TOKEN_2022_PROGRAM_ID, tokenBProgram: qprog, referralTokenAccount: null, swapMode: 0 })).instructions; vault = ps.tokenBVault;
    } else {
      const cfg = await dbc.state.getPoolConfig(vp.config); if (BigInt(vp.quoteReserve.toString()) >= BigInt(cfg.migrationQuoteThreshold.toString())) throw new Error('curve finished — waiting for migration');
      const qt = dbc.pool.swapQuote2({ virtualPool: vpw.poolState ? vpw : { poolState: vp }, config: cfg, swapBaseForQuote: true, amountIn: new BN(amt.toString()), slippageBps: slip, hasReferral: false, currentPoint: await getCurrentPoint(conn, cfg.activationType), swapMode: SwapMode.ExactIn });
      ixs = (await dbc.pool.swap2({ owner: ops.publicKey, pool: new PublicKey(c.pool), swapBaseForQuote: true, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: new BN(amt.toString()), minimumAmountOut: qt.minimumAmountOut || new BN(0) })).instructions; vault = vp.quoteVault;
    }
    const sg = await send([...ixs, memoIx(`treid:taxswap:${c.mint}:0:${vault.toBase58()}`)]);
    const t = await getTxRetry(conn, sg), keys = t.transaction.message.getAccountKeys({ accountKeysFromLookups: t.meta.loadedAddresses }), vi = [...Array(keys.length).keys()].find((i) => keys.get(i).equals(vault));
    const bal = (arr) => BigInt((arr || []).find((b) => b.accountIndex === vi)?.uiTokenAmount.amount || 0), out = vi == null ? 0n : bal(t.meta.preTokenBalances) - bal(t.meta.postTokenBalances);
    rec(sg, 0, c.mint, 'taxswap', out, vault.toBase58()); return out;
  }
  // pay pending pair-token rewards pro rata to the holder list (SOL straight to wallets; tokens only into accounts that already exist)
  async function payQuote(c, hs, px, rw = null) {   // rw: pay the third reward token instead of the pair token
    let left = BigInt(rw ? pendingRw(c.mint) : pendingQ(c.mint)); if (left <= 0n || !hs.length) return { paid: 0n, n: 0 };
    const QM = rw ? new PublicKey(rw) : qmOf(c), sol = QM.equals(new PublicKey(WSOL)), qai = sol ? null : await conn.getAccountInfo(QM), qprog = qai ? qai.owner : null;
    const qd = sol ? 9 : rw ? (await getMint(conn, QM, 'confirmed', qprog)).decimals : (c.quote_dec ?? 9);
    const qusd = rw ? (quoteUsd(c) || 0) * (sumK(c.mint, 'taxconv') / 10 ** (c.quote_dec ?? 9)) / Math.max(1e-18, sumK(c.mint, 'taxrw') / 10 ** qd) : (quoteUsd(c) || 0);   // reward price = what we paid for it
    let elig = hs.map((h) => ({ ...h, dst: sol ? h.owner : getAssociatedTokenAddressSync(QM, h.owner, true, qprog) }));
    if (!sol) { const ok = []; for (let i = 0; i < elig.length; i += 100) { const infos = await conn.getMultipleAccountsInfo(elig.slice(i, i + 100).map((h) => h.dst)); infos.forEach((ai, j) => { if (ai) ok.push(elig[i + j]); }); } elig = ok; }
    const tot = elig.reduce((a, h) => a + h.total, 0n); if (tot <= 0n) return { paid: 0n, n: 0 };
    const minAmt = qusd > 0 ? BigInt(Math.ceil(SHARE_USD / qusd * 10 ** qd)) : BigInt(Number.MAX_SAFE_INTEGER), src = sol ? null : getAssociatedTokenAddressSync(QM, ops.publicKey, false, qprog);
    const shares = elig.map((h) => ({ to: h.dst, amt: left * h.total / tot })).filter((x) => x.amt >= minAmt);
    const ix = (x) => (sol ? SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: x.to, lamports: x.amt }) : createTransferCheckedInstruction(src, QM, x.to, ops.publicKey, x.amt, qd, [], qprog));
    let paid = 0n, n = 0;
    const kind = rw ? 'taxholdr' : 'taxholdq', batchSend = async (b) => { const amt = b.reduce((a, x) => a + x.amt, 0n), sg = await send([...b.map(ix), memoIx(`treid:${kind}:${c.mint}:${amt}:${b.length}`)]); rec(sg, 0, c.mint, kind, amt, String(b.length)); paid += amt; n += b.length; };
    for (let i = 0; i < shares.length; i += 16) { const b = shares.slice(i, i + 16);
      try { await batchSend(b); } catch (e) { if (e.unconfirmed) { log('ops   pair payout unconfirmed — stopping, next round pays the rest', c.symbol); break; }
        for (const x of b) { try { await batchSend([x]); } catch (e2) { if (e2.unconfirmed) return { paid, n }; } } } }   // a share that can't be paid (e.g. empty wallet) waits for the next round
    log('ops   holders paid', (Number(paid) / 10 ** qd).toFixed(6), rw ? rw.slice(0, 6) : (c.quote_symbol || 'SOL'), 'to', n, c.symbol); return { paid, n };
  }
  const lastTradeTs = (mint) => q1('SELECT MAX(ts) t FROM trades WHERE mint=?', mint)?.t || 0;
  const lastPx = (mint) => q1('SELECT price_usd FROM trades WHERE mint=? ORDER BY ts DESC LIMIT 1', mint)?.price_usd || 0;
  const seenFee = new Map(), seenTax = new Map();   // when each coin was last looked at

  async function claimFees() {
    for (const c of q('SELECT * FROM coins')) {
      const lt = lastTradeTs(c.mint), ls = seenFee.get(c.mint) || START; if (lt <= ls) continue;   // fees only grow with trades: nothing traded since the last look → nothing to claim
      try { const vpw = await dbc.state.getPool(new PublicKey(c.pool)), vp = vpw?.poolState || vpw; if (!vp) continue;
        if (c.config) { const cfg = await dbc.state.getPoolConfig(vp.config); if (cfg.feeClaimer.toBase58() !== ops.publicKey.toBase58()) { seenFee.set(c.mint, Date.now()); continue; } }
        const fee = Number(vp.partnerQuoteFee.toString()) / 10 ** (c.quote_dec ?? 9); if (fee * (quoteUsd(c) || 0) < FEE_USD) { seenFee.set(c.mint, Date.now()); continue; }
        // claimed INTO ops (a claim "to the treasury" would open a coin account for the treasury and pay its rent, for every coin), then:
        // SOL → the sweep forwards it; other pair tokens → passed on to the treasury in the same transaction, exact amount
        const amt = BigInt(vp.partnerQuoteFee.toString()), mint = new PublicKey(c.mint), tx = await dbc.partner.claimPartnerTradingFeeToReceiver({ pool: new PublicKey(c.pool), feeClaimer: ops.publicKey, payer: ops.publicKey, maxBaseAmount: new BN(0), maxQuoteAmount: new BN(amt.toString()), receiver: ops.publicKey });
        const qm = new PublicKey(c.quote_mint || WSOL); if (!qm.equals(new PublicKey(WSOL))) { const qprog = (await conn.getAccountInfo(qm)).owner, dst = getAssociatedTokenAddressSync(qm, new PublicKey(treasury), true, qprog);
          tx.add(createAssociatedTokenAccountIdempotentInstruction(ops.publicKey, dst, new PublicKey(treasury), qm, qprog), createTransferCheckedInstruction(getAssociatedTokenAddressSync(qm, ops.publicKey, false, qprog), qm, dst, ops.publicKey, amt, c.quote_dec ?? 6, [], qprog)); }
        const ata = getAssociatedTokenAddressSync(mint, ops.publicKey, false, TOKEN_2022_PROGRAM_ID), ai = await conn.getAccountInfo(ata); let closeOk = !ai;
        if (ai) { try { const a = unpackAccount(ata, ai, TOKEN_2022_PROGRAM_ID); closeOk = a.amount === 0n && !(getTransferFeeAmount(a)?.withheldAmount > 0n); } catch {} }
        if (closeOk) tx.add(createCloseAccountInstruction(ata, ops.publicKey, ops.publicKey, [], TOKEN_2022_PROGRAM_ID));   // the claim opens ops' coin account; close it again, rent back
        tx.add(memoIx(`treid:pfee:${c.mint}:${amt}`));
        await send(tx); seenFee.set(c.mint, Date.now()); log('ops   claimed', fee.toFixed(4), c.quote_symbol || 'SOL', 'from', c.symbol, '→ treasury');
      } catch (e) { log('ops   claim err', c.symbol, e.message.slice(0, 120)); }
    }
  }
  // the biggest 200 real wallets (never the curve, pools/PDAs, ops or the dev), one entry per wallet, paid into its biggest account
  function holdersOf(accs, skip) { const byOwner = new Map();
    for (const a of accs) { const o = a.owner.toBase58(); if (a.amount <= 0n || skip.has(o) || !PublicKey.isOnCurve(a.owner.toBytes())) continue; const e = byOwner.get(o) || { to: a.address, owner: a.owner, big: 0n, total: 0n }; e.total += a.amount; if (a.amount > e.big) { e.big = a.amount; e.to = a.address; } byOwner.set(o, e); }
    return [...byOwner.values()].sort((x, y) => (y.total > x.total ? 1 : -1)).slice(0, MAX_ACCTS); }
  async function holderList(c) { const accs = (await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: c.mint } }] })).map((a) => { try { return unpackAccount(a.pubkey, a.account, TOKEN_2022_PROGRAM_ID); } catch { return null; } }).filter(Boolean);
    let devTo = c.creator; try { devTo = devState(c).creator || c.creator; } catch {} return holdersOf(accs, new Set([poolAuthority, ops.publicKey.toBase58(), c.creator, devTo])); }
  async function taxCycle(c) {
    const mint = new PublicKey(c.mint), opsAta = getAssociatedTokenAddressSync(mint, ops.publicKey, false, TOKEN_2022_PROGRAM_ID), px = lastPx(c.mint);
    if (!(px > 0)) return null;
    const accs = (await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: c.mint } }] })).map((a) => { try { return unpackAccount(a.pubkey, a.account, TOKEN_2022_PROGRAM_ID); } catch { return null; } }).filter(Boolean);
    const wa = (a) => getTransferFeeAmount(a)?.withheldAmount || 0n, withheld = accs.filter((a) => wa(a) > 0n).sort((x, y) => (wa(y) > wa(x) ? 1 : -1)).slice(0, MAX_ACCTS);
    const mintInfo = await getMint(conn, mint, 'confirmed', TOKEN_2022_PROGRAM_ID), inMint = getTransferFeeConfig(mintInfo)?.withheldAmount || 0n;   // tax anyone "harvested to the mint" is collected too
    const opsAcc = accs.find((a) => a.address.equals(opsAta)), stranded = opsAcc ? opsAcc.amount : 0n;   // tokens left in ops from an interrupted cycle are distributed now
    const total = withheld.reduce((s, a) => s + wa(a), 0n) + inMint + stranded;
    if (Number(total) / 10 ** DEC * px < HARVEST_USD) return null;   // not worth the transactions yet
    if (!opsAcc) await send([createAssociatedTokenAccountIdempotentInstruction(ops.publicKey, opsAta, ops.publicKey, mint, TOKEN_2022_PROGRAM_ID)]);
    for (let i = 0; i < withheld.length; i += 24) await send([createWithdrawWithheldTokensFromAccountsInstruction(mint, opsAta, ops.publicKey, [], withheld.slice(i, i + 24).map((a) => a.address), TOKEN_2022_PROGRAM_ID)]);   // 24 accounts per tx (size limit)
    if (inMint > 0n) await send([createWithdrawWithheldTokensFromMintInstruction(mint, opsAta, ops.publicKey, [], TOKEN_2022_PROGRAM_ID)]);
    const got = (await getAccount(conn, opsAta, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount; if (got <= 0n) return null;   // the WHOLE balance: harvest + anything stranded earlier
    const f0 = (x) => (Number(x) / 10 ** DEC).toFixed(0), sp = parseSplit(c.uri);
    const rwT = sp.rw && sp.rw !== qmOf(c).toBase58() ? sp.rw : null, inPair = sp.pair || !!sp.rw;   // rwT: a third token (not the pair)
    if (inPair && (pendingQ(c.mint) > 0 || (rwT && pendingRw(c.mint) > 0))) { const hl = await holderList(c);   // leftovers from an earlier round first
      if (rwT && pendingRw(c.mint) > 0) await payQuote(c, hl, px, rwT).catch(() => {}); if (!rwT && pendingQ(c.mint) > 0) await payQuote(c, hl, px).catch(() => {}); }
    const burnAmt = got * BigInt(sp.b) / 100n, devAmt = got * BigInt(sp.d) / 100n; let holdAmt = got - burnAmt - devAmt;
    let devBurn = false, devTo = c.creator; try { const ds = devState(c); devBurn = ds.era === 'out' || ds.state !== 'active'; devTo = ds.creator || c.creator; } catch {}
    if (devAmt > 0n && !devBurn) { const devAta = getAssociatedTokenAddressSync(mint, new PublicKey(devTo), false, TOKEN_2022_PROGRAM_ID); if (!(await conn.getAccountInfo(devAta))) devBurn = true;   // ops never opens accounts for others
      else await send([createTransferCheckedInstruction(opsAta, mint, devAta, ops.publicKey, devAmt, DEC, [], TOKEN_2022_PROGRAM_ID)]); }
    const hs = holdersOf(accs, new Set([poolAuthority, ops.publicKey.toBase58(), c.creator, devTo])), held = hs.reduce((s, a) => s + a.total, 0n), minAmt = BigInt(Math.ceil(SHARE_USD / px * 10 ** DEC));
    let paid = 0n, n = 0, aborted = false, inQuote = false;
    if (inPair && holdAmt > 0n && held > 0n) {   // holders chose the pair token: sell their share on the coin's pool, then pay it out
      try { const out = await sellForQuote(c, holdAmt); inQuote = true; log('ops   sold', f0(holdAmt), 'tokens for', (Number(out) / 10 ** (c.quote_dec ?? 9)).toFixed(6), c.quote_symbol || 'SOL', '(holders)', c.symbol); }
      catch (e) { if (e.unconfirmed) { aborted = true; inQuote = false; holdAmt = 0n; log('ops   pair sale status unknown — holders wait for the next round', c.symbol); }   // never pay twice
        else log('ops   pair sale failed — paying holders in the coin this round', c.symbol, e.message.slice(0, 80)); } }
    if (inQuote) { let viaRw = false;
      let unsure = false; if (rwT) { try { await convertTo(c, rwT); viaRw = true; } catch (e) { if (e.unconfirmed) unsure = true; log('ops   reward swap', unsure ? 'status unknown — holders wait for the next round' : 'failed — paying holders in ' + (c.quote_symbol || 'SOL') + ' this round', c.symbol, e.message.slice(0, 80)); } }
      const r = unsure ? { paid: 0n, n: 0 } : await payQuote(c, hs, px, viaRw ? rwT : null).catch((e) => { log('ops   pair payout later', c.symbol, e.message.slice(0, 80)); return { paid: 0n, n: 0 }; }); n = r.n; }
    else if (holdAmt > 0n && held > 0n) {
      const shares = hs.map((a) => ({ to: a.to, amt: holdAmt * a.total / held })).filter((x) => x.amt >= minAmt), ix = (x) => createTransferCheckedInstruction(opsAta, mint, x.to, ops.publicKey, x.amt, DEC, [], TOKEN_2022_PROGRAM_ID);
      for (let i = 0; i < shares.length; i += 16) { const batch = shares.slice(i, i + 16);   // 16 transfers per tx (fits the size limit with the compute budget)
        try { await send(batch.map(ix)); paid += batch.reduce((s, x) => s + x.amt, 0n); n += batch.length; }
        catch (e) { if (e.unconfirmed) { aborted = true; log('ops   batch unconfirmed — stopping, next cycle redistributes what is left', c.symbol); break; }   // never resend a batch that may have landed
          for (const x of batch) { try { await send([ix(x)]); paid += x.amt; n++; } catch (e2) { if (e2.unconfirmed) { aborted = true; break; } log('ops   skip holder', x.to.toBase58().slice(0, 6), e2.message.slice(0, 60)); } } } }
    }
    const now = (await getAccount(conn, opsAta, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, toBurn = aborted ? (burnAmt + (devBurn ? devAmt : 0n) < now ? burnAmt + (devBurn ? devAmt : 0n) : now) : now;   // normally everything still here (burn share + unpaid dust + inactive creator's share); after an unsure batch, only the burn part — holders get the rest next cycle
    const devPaid = devBurn ? 0n : devAmt, ixs = [];
    if (toBurn > 0n) ixs.push(createBurnCheckedInstruction(opsAta, mint, ops.publicKey, toBurn, DEC, [], TOKEN_2022_PROGRAM_ID));
    ixs.push(...[['taxburn', toBurn, null], ['taxdev', devPaid, devBurn ? null : devTo], ['taxhold', paid, String(n)]].map(([k, a, x]) => memoIx(`treid:${k}:${c.mint}:${a}` + (x ? ':' + x : ''))));
    const sg = await send(ixs);
    [['taxburn', toBurn, null], ['taxdev', devPaid, devBurn ? null : devTo], ['taxhold', paid, String(n)]].forEach(([k, a, x], i) => { try { run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', sg, i, c.mint, k, Number(a), Date.now(), x); } catch {} });
    try { const a = await getAccount(conn, opsAta, 'confirmed', TOKEN_2022_PROGRAM_ID); if (a.amount === 0n && !(getTransferFeeAmount(a)?.withheldAmount > 0n)) await send([createCloseAccountInstruction(opsAta, ops.publicKey, ops.publicKey, [], TOKEN_2022_PROGRAM_ID)]); } catch {}   // rent back to ops
    const f = (x) => (Number(x) / 10 ** DEC).toFixed(0);
    log('ops   tax', c.symbol, 'harvested', f(got), 'burn', f(toBurn), 'dev', devBurn ? 'burned' : f(devAmt), 'holders', f(paid), 'to', n);
    return { got };
  }
  async function sweep() {
    const bal = await conn.getBalance(ops.publicKey), keep = 0.2e9 + liabilities() + pendingSol();   // never sweep SOL that is owed to creators or holders
    if (treasury && bal > keep + 0.1e9) { const amt = bal - keep; await send([SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: new PublicKey(treasury), lamports: amt })]); log('ops   swept', (amt / 1e9).toFixed(4), 'SOL to treasury'); }
  }
  let busy = false;
  async function cycle() {
    if (busy || !ready()) return; busy = true;
    try { await claimFees();
      for (const c of q('SELECT * FROM coins WHERE tax_bps > 0')) {
        const lt = lastTradeTs(c.mint), ls = seenTax.get(c.mint) || 0; if (!(lt > ls && Date.now() - ls > 36e5) && Date.now() - ls < 7 * 864e5) continue;   // hourly at most, only after new trades (weekly fallback: plain wallet-to-wallet transfers pay tax too)
        try { const cfg = await dbc.state.getPoolConfig(new PublicKey(c.config)); if (cfg.feeClaimer.toBase58() === ops.publicKey.toBase58()) await taxCycle(c); seenTax.set(c.mint, Date.now()); } catch (e) { log('ops   tax err', c.symbol, e.message.slice(0, 140)); } }
      await sweep();
    } catch (e) { log('ops   cycle err', e.message); } finally { busy = false; }
  }
  let queued = false; const locked = () => { if (queued) return; queued = true; withLock(cycle).finally(() => { queued = false; }); }; setTimeout(locked, 30e3); setInterval(locked, everyMs);
  return { cycle };
}
