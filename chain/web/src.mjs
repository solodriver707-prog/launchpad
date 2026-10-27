// treid browser chain module → bundled to chain.js (window.TreidChain). Builds real DBC transactions; the wallet only signs.
import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import bs58lib from 'bs58';
const bs58enc = (b) => (bs58lib.default || bs58lib).encode(b instanceof Uint8Array ? b : Uint8Array.from(b));
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createBurnCheckedInstruction, getMint, getExtensionTypes, ExtensionType, getTransferFeeConfig } from '@solana/spl-token';
import BN from 'bn.js';
import { DynamicBondingCurveClient, buildCurveWithMarketCap, TokenType, TokenDecimal, TokenAuthorityOption, BaseFeeMode, CollectFeeMode,
  MigrationOption, MigrationFeeOption, MigratedCollectFeeMode, DammV2DynamicFeeMode, ActivationType, deriveDbcPoolAddress, deriveDammV1MigrationMetadataAddress, SwapMode, getCurrentPoint, deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm, calculateTransferFeeExcludedAmount } from '@meteora-ag/cp-amm-sdk';

// ---- treid rules (must match chain/scripts/01_launch.mjs) ----
export const RULES = { minTrapBps: 5000, minTrapSecs: 30, trapSteps: 3, feePlainBps: 100, feeTaxedBps: 50, maxTaxBps: 1000, creatorFeePct: 50, mc0Sol: 20, mc1Sol: 60, supply: 1e9, decimals: 6 };
const conns = {}; const C = (rpc) => conns[rpc] || (conns[rpc] = new Connection(rpc, 'confirmed'));
const client = (rpc) => new DynamicBondingCurveClient(C(rpc), 'confirmed');
const amms = {}; const ammC = (rpc) => amms[rpc] || (amms[rpc] = new CpAmm(C(rpc)));
const DAMM_CFG = DAMM_V2_MIGRATION_FEE_ADDRESS[6], DBC_PROGRAM = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');   // treid curves migrate into Meteora's customizable DAMM v2 config
const pk = (x) => (x instanceof PublicKey ? x : new PublicKey(x));

export function curveFor({ taxBps = 0, trapBps = 5000, trapSecs = 30, quoteDecimals = 9, mc0 = RULES.mc0Sol, mc1 = RULES.mc1Sol }) {
  const trap = Math.min(9000, Math.max(RULES.minTrapBps, trapBps | 0)), secs = Math.max(RULES.minTrapSecs, trapSecs | 0), tax = Math.min(RULES.maxTaxBps, Math.max(0, taxBps | 0));
  return buildCurveWithMarketCap({
    token: { tokenType: TokenType.Token2022, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: quoteDecimals, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: RULES.supply, leftover: 0 },
    fee: { baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: trap, endingFeeBps: tax > 0 ? RULES.feeTaxedBps : RULES.feePlainBps, numberOfPeriod: RULES.trapSteps, totalDuration: secs } },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: RULES.creatorFeePct, poolCreationFee: 0, enableFirstSwapWithMinFee: true },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.Customizable, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.Compounding, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: 50, compoundingFeeBps: 0 } },
    liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 50, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp, initialMarketCap: mc0, migrationMarketCap: mc1,
  });
}
// ---- pair (quote) tokens ----
const qCache = {};
const ALLOWED_EXT = new Set([ExtensionType.MetadataPointer, ExtensionType.TokenMetadata, ExtensionType.ImmutableOwner]);
export async function quoteInfo({ rpc, mint, reward = false }) {   // reward: only checks that holders can be paid in it (plain transfers)
  const k = rpc + mint + (reward ? '|r' : ''); if (qCache[k]) return qCache[k];
  const m = pk(mint); if (m.equals(NATIVE_MINT)) return (qCache[k] = { mint: NATIVE_MINT.toBase58(), decimals: 9, program: 'spl', native: true, ok: true });
  const ai = await C(rpc).getAccountInfo(m); if (!ai) return { mint: m.toBase58(), ok: false, reason: 'No token found at this address on this network' };
  const is22 = ai.owner.equals(TOKEN_2022_PROGRAM_ID); if (!is22 && !ai.owner.equals(TOKEN_PROGRAM_ID)) return { mint: m.toBase58(), ok: false, reason: 'This address is not a token mint' };
  const mi = await getMint(C(rpc), m, 'confirmed', is22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID); const out = { mint: m.toBase58(), decimals: mi.decimals, program: is22 ? 'token2022' : 'spl', ok: true };
  if (mi.freezeAuthority) out.warn = 'This token has a freeze authority — its issuer can freeze holders';
  if (is22) { const ext = getExtensionTypes(mi.tlvData); const tf = getTransferFeeConfig(mi);
    if (tf && (tf.newerTransferFee.transferFeeBasisPoints > 0 || tf.olderTransferFee.transferFeeBasisPoints > 0)) return { ...out, ok: false, reason: 'Tokens with a transfer tax can’t be used as a pair' };
    const bad = ext.filter((e) => !ALLOWED_EXT.has(e) && e !== ExtensionType.TransferFeeConfig);
    if (reward) { if (bad.includes(ExtensionType.TransferHook) || bad.includes(ExtensionType.NonTransferable)) return { ...out, ok: false, reason: 'This token can’t be sent to holders' };
      const w = []; if (bad.includes(ExtensionType.PermanentDelegate)) w.push('its issuer can move tokens from any account'); if (bad.includes(ExtensionType.PausableConfig)) w.push('its issuer can pause transfers (payouts would wait)');
      if (w.length) out.warn = [out.warn, w.join('; ')].filter(Boolean).join(' · '); return (qCache[k] = out); }
    if (bad.includes(ExtensionType.TransferHook)) return { ...out, ok: false, reason: 'Tokens with a transfer hook can’t be used as a pair' };
    if (bad.length) { const [b] = PublicKey.findProgramAddressSync([Buffer.from('token_badge'), m.toBuffer()], DBC_PROGRAM), bi = await C(rpc).getAccountInfo(b);   // Meteora's approval (e.g. tokenized stocks)
      if (!bi || !bi.owner.equals(DBC_PROGRAM)) return { ...out, ok: false, reason: 'This token type needs approval from Meteora first — not supported yet' };
      const w = []; if (bad.includes(ExtensionType.PermanentDelegate)) w.push('its issuer can move tokens from any account'); if (bad.includes(ExtensionType.PausableConfig)) w.push('its issuer can pause all transfers (trading would stop)');
      if (bad.includes(ExtensionType.ScaledUiAmountConfig)) w.push('its displayed amount can change (splits/dividends)');
      out.badge = true; out.warn = [out.warn, 'Meteora-approved pair' + (w.length ? ' — ' + w.join('; ') : '')].filter(Boolean).join(' · '); } }
  return (qCache[k] = out);
}
// every wallet transaction states its compute budget (measured by simulation, +20%) and a small priority fee: wallets can predict it
// (fewer "could be malicious" warnings) and it lands on a busy mainnet. A tx that depends on an earlier one can't be simulated → safe default.
const PRIO_UL = 50_000;   // micro-lamports per CU (≈0.00001 SOL on a 200k-CU tx)
async function budget(rpc, tx) {
  if (tx.instructions.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId))) return;
  let units = 400_000;
  try { const sim = await C(rpc).simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
    if (!sim.value.err && sim.value.unitsConsumed) units = Math.min(1_400_000, Math.ceil(sim.value.unitsConsumed * 1.2) + 5000); } catch {}
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIO_UL })];
  tx.instructions.unshift(...ixs);
  try { if (tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length > 1232) tx.instructions.splice(0, 2); } catch { tx.instructions.splice(0, 2); }   // already at the size limit: leave it as it was
}
async function finish(rpc, txs, payer, keypairs) {
  const { blockhash, lastValidBlockHeight } = await C(rpc).getLatestBlockhash('confirmed');
  for (const tx of txs) {
    tx.feePayer = payer; tx.recentBlockhash = blockhash;
    await budget(rpc, tx);
  }
  return { bytes: txs.map((t) => t.serialize({ requireAllSignatures: false, verifySignatures: false })), lastValidBlockHeight, cosigners: keypairs.map((k) => Array.from(k.secretKey)) };
}
// create config + coin (+ optional dev first buy, never hit by the trap) — returns unsigned-by-wallet tx bytes
export async function buildCreate({ rpc, payer, partner, treasury, name, symbol, uri, taxBps = 0, trapBps = 5000, trapSecs = 30, devBuySol = 0, mintSecret = null, extraFeeSol = 0, escrow = null, quoteMint = null, mc0 = null, mc1 = null }) {
  payer = pk(payer); partner = pk(partner); treasury = treasury ? pk(treasury) : partner;
  const qi = await quoteInfo({ rpc, mint: quoteMint || NATIVE_MINT }); if (!qi.ok) throw new Error(qi.reason); const QM = pk(qi.mint);
  const cl = client(rpc), cfg = Keypair.generate(), mint = mintSecret ? Keypair.fromSecretKey(Uint8Array.from(mintSecret)) : Keypair.generate(), curve = curveFor({ taxBps, trapBps, trapSecs, quoteDecimals: qi.decimals, mc0: mc0 || RULES.mc0Sol, mc1: mc1 || RULES.mc1Sol });
  const common = { payer, config: cfg.publicKey, feeClaimer: partner, leftoverReceiver: treasury, quoteMint: QM, ...curve,
    transferFeeParameters: taxBps > 0 ? { transferFeeBasisPoints: Math.min(RULES.maxTaxBps, taxBps), withheldAuthority: 0, migratedTransferFeeAuthorityOption: 0 } : null,
    preCreatePoolParam: { name: String(name).slice(0, 32), symbol: String(symbol).slice(0, 10), uri: String(uri).split('MINT'.repeat(11)).join(mint.publicKey.toBase58()).slice(0, 200), poolCreator: payer, baseMint: mint.publicKey } };
  let txs;
  if (devBuySol > 0) { const r = await cl.partner.createConfigAndPoolWithFirstBuy({ ...common, firstBuyParam: { buyer: payer, buyAmount: new BN(Math.round(devBuySol * 10 ** qi.decimals)), minimumAmountOut: new BN(0), referralTokenAccount: null } }); txs = [r.createConfigTx, r.createPoolWithFirstBuyTx]; }
  else txs = [await cl.partner.createConfigAndPool(common)];
  // treid rewards escrow: hand the pool's creator role (creator fee claims) to the treid ops wallet in the same tx — the dev stays the real creator off-chain
  if (escrow) { const poolPk = deriveDbcPoolAddress(QM, mint.publicKey, cfg.publicKey), tp = await cl.creator.program.methods.transferPoolCreator().accountsPartial({ virtualPool: poolPk, newCreator: pk(escrow), config: cfg.publicKey, creator: payer }).remainingAccounts([{ isSigner: false, isWritable: false, pubkey: deriveDammV1MigrationMetadataAddress(poolPk) }]).transaction();   // pool doesn't exist yet → build the ix directly
    const last = txs[txs.length - 1], trial = new Transaction().add(...last.instructions, ...tp.instructions); trial.feePayer = payer; trial.recentBlockhash = '11111111111111111111111111111111';
    let fits = true; try { fits = trial.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232; } catch { fits = false; }
    if (fits) last.add(...tp.instructions); else txs.push(new Transaction().add(...tp.instructions)); }
  if (extraFeeSol > 0) txs[0].add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: treasury, lamports: Math.round(extraFeeSol * 1e9) }));   // custom address fee
  const out = await finish(rpc, txs, payer, [cfg, mint]);
  return { ...out, uri: common.preCreatePoolParam.uri, mint: mint.publicKey.toBase58(), config: cfg.publicKey.toBase58(), pool: deriveDbcPoolAddress(QM, mint.publicKey, cfg.publicKey).toBase58(), quoteMint: qi.mint, quoteDecimals: qi.decimals };
}
// the site never trusts a pool address from the server: before any quote or trade it checks ON-CHAIN that the pool is this coin's
// pool, made with a treid config (fee claimer = treid, fixed supply, locked LP, no vesting, quote-side fees)
function treidCfgOk(cfg, partners) { const n = (x) => Number(x?.toString?.() ?? x), lv = cfg.lockedVestingConfig;
  return partners.includes(cfg.feeClaimer.toBase58()) && n(cfg.tokenType) === 1 && n(cfg.tokenDecimal) === 6 && n(cfg.fixedTokenSupplyFlag) === 1 && n(cfg.tokenUpdateAuthority) === 1
    && n(cfg.creatorLiquidityPercentage) === 0 && n(cfg.partnerLiquidityPercentage) === 0 && n(lv.amountPerPeriod) === 0 && n(lv.cliffUnlockAmount) === 0 && n(cfg.collectFeeMode) === 0 && n(cfg.transferFeeBasisPoints) <= 1000; }
async function poolCtx(rpc, pool, expect) {
  const cl = client(rpc), vpw = await cl.state.getPool(pk(pool)); if (!vpw) throw new Error('Pool not found');
  const vp = vpw.poolState || vpw, cfg = await cl.state.getPoolConfig(vp.config), cp = await getCurrentPoint(C(rpc), cfg.activationType);
  if (expect) { if (vp.baseMint.toBase58() !== expect.mint) throw new Error('Pool doesn’t belong to this coin — refusing');
    if (!treidCfgOk(cfg, expect.partners || [])) throw new Error('This pool isn’t a treid pool — refusing'); }
  const qi = await quoteInfo({ rpc, mint: cfg.quoteMint.toBase58() });
  let damm = null;   // graduated: trades go to the coin's DAMM v2 pool — address derived from the curve, contents checked
  if (Number(vp.isMigrated?.toString?.() ?? vp.isMigrated) > 0) { const ap = deriveDammV2PoolAddress(DAMM_CFG, vp.baseMint, cfg.quoteMint), ps = await ammC(rpc).fetchPoolState(ap);
    if (!ps.tokenAMint.equals(vp.baseMint) || !ps.tokenBMint.equals(cfg.quoteMint)) throw new Error('Graduated pool doesn’t match this coin — refusing');
    const [mi, ep] = await Promise.all([getMint(C(rpc), vp.baseMint, 'confirmed', TOKEN_2022_PROGRAM_ID), C(rpc).getEpochInfo()]);
    damm = { pool: ap, ps, cp: await getCurrentPoint(C(rpc), Number(ps.activationType)), coin: { mint: mi, currentEpoch: ep.epoch }, qprog: qi.program === 'token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID }; }
  else if (BigInt(vp.quoteReserve.toString()) >= BigInt(cfg.migrationQuoteThreshold.toString())) throw new Error('The curve is full — trading opens on Meteora in a few minutes');
  return { cl, vpw: vpw.poolState ? vpw : { poolState: vp }, vp, cfg, cp, qd: qi.decimals, damm };
}
// the pool's real pair token, read on-chain after the pool checks (never the server's word for it)
export async function poolQuote({ rpc, pool, expect }) { const { cfg, qd } = await poolCtx(rpc, pool, expect); return { mint: cfg.quoteMint.toBase58(), decimals: qd }; }
// side 'buy': amount in SOL; side 'sell': amount in tokens
export async function quote({ rpc, pool, side, amount, slippageBps = 500, expect = null }) {
  const { cl, vpw, cfg, cp, qd, damm } = await poolCtx(rpc, pool, expect), sell = side === 'sell';
  const amountIn = new BN(Math.floor(amount * (sell ? 10 ** RULES.decimals : 10 ** qd)));
  const div = sell ? 10 ** qd : 10 ** RULES.decimals;
  if (damm) {   // graduated: quote on the DAMM v2 pool, with the coin's transfer tax on whichever side it applies
    const { ps } = damm, q = ammC(rpc).getQuote2({ inputTokenMint: sell ? ps.tokenAMint : ps.tokenBMint, slippage: slippageBps, poolState: ps, currentPoint: damm.cp, hasReferral: false, tokenADecimal: RULES.decimals, tokenBDecimal: qd,
      swapMode: 0, amountIn, inputTokenInfo: sell ? damm.coin : undefined, outputTokenInfo: sell ? undefined : damm.coin });
    const outRaw = sell ? new BN(q.outputAmount.toString()) : calculateTransferFeeExcludedAmount(new BN(q.outputAmount.toString()), damm.coin.mint, damm.coin.currentEpoch).amount, minRaw = new BN(q.minimumAmountOut.toString()), fee = ['claimingFee', 'protocolFee', 'compoundingFee', 'referralFee'].reduce((a, k) => a + Number(q[k]?.toString?.() || 0), 0);
    return { out: Number(outRaw.toString()) / div, minOut: Number(minRaw.toString()) / div, feeSol: fee / 10 ** qd, quoteDecimals: qd, quoteMint: cfg.quoteMint.toBase58(), amountIn: amountIn.toString(), minRaw: minRaw.toString(), graduated: true };
  }
  const mode = sell ? SwapMode.ExactIn : SwapMode.PartialFill;   // a buy that would overfill the curve fills it exactly and refunds the rest
  const q = cl.pool.swapQuote2({ virtualPool: vpw, config: cfg, swapBaseForQuote: sell, amountIn, slippageBps, hasReferral: false, currentPoint: cp, swapMode: mode });
  const outRaw = q.outputAmount || q.amountOut || new BN(0), minRaw = q.minimumAmountOut || new BN(0), fee = q.tradingFee || q.fee || new BN(0);
  return { out: Number(outRaw.toString()) / div, minOut: Number(minRaw.toString()) / div, feeSol: Number(fee.toString()) / 10 ** qd, quoteDecimals: qd, quoteMint: cfg.quoteMint.toBase58(), amountIn: amountIn.toString(), minRaw: minRaw.toString(), mode };
}
export async function buildSwap({ rpc, owner, pool, side, amount, slippageBps = 500, expect = null }) {
  owner = pk(owner); const q = await quote({ rpc, pool, side, amount, slippageBps, expect }), cl = client(rpc);
  let tx;
  if (q.graduated) { const { damm } = await poolCtx(rpc, pool, expect), ps = damm.ps, sell = side === 'sell';
    tx = await ammC(rpc).swap2({ payer: owner, pool: damm.pool, inputTokenMint: sell ? ps.tokenAMint : ps.tokenBMint, outputTokenMint: sell ? ps.tokenBMint : ps.tokenAMint, amountIn: new BN(q.amountIn), minimumAmountOut: new BN(q.minRaw),
      tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault, tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAProgram: TOKEN_2022_PROGRAM_ID, tokenBProgram: damm.qprog, referralTokenAccount: null, swapMode: 0 }); }
  else tx = await cl.pool.swap2({ owner, pool: pk(pool), swapBaseForQuote: side === 'sell', referralTokenAccount: null, swapMode: q.mode, amountIn: new BN(q.amountIn), minimumAmountOut: new BN(q.minRaw) });
  const out = await finish(rpc, [tx], owner, []);
  return { ...out, quote: q };
}
export async function tokenBalance({ rpc, owner, mint }) {
  if (pk(mint).equals(NATIVE_MINT)) return (await C(rpc).getBalance(pk(owner))) / 1e9;
  const r = await C(rpc).getParsedTokenAccountsByOwner(pk(owner), { mint: pk(mint) });
  return r.value.reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
}
// send wallet-signed transactions in order, waiting for each
export async function sendAll({ rpc, signed, lastValidBlockHeight }) {
  const sigs = [];
  try { for (const b of signed) {
    const raw = b instanceof Uint8Array ? b : Uint8Array.from(b);
    const sig = await C(rpc).sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed' });
    const tx = Transaction.from(raw); const r = await C(rpc).confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash, lastValidBlockHeight: lastValidBlockHeight || (await C(rpc).getBlockHeight()) + 150 }, 'confirmed');
    if (r.value.err) throw new Error('Transaction failed: ' + JSON.stringify(r.value.err));
    sigs.push(sig);
  } } catch (e) { e.sent = sigs.length; e.expired = /blockhash not found|block height exceeded|expired/i.test(String(e?.message || e)); throw e; }
  return sigs;
}
export const version = 1;

// ---- vanity mint addresses: multi-threaded grinder (web workers running this same bundle) ----
const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function suffixOk(suf) { return suf.split('').every((ch) => ALPH.includes(ch) || ALPH.includes(ch.toLowerCase()) || ALPH.includes(ch.toUpperCase())); }
function matcher(suf, ignoreCase) {   // base58 suffix of k chars == (pubkey as big number) mod 58^k → check without full encoding
  const k = suf.length, M = 58 ** k; let res = [0];
  for (const ch of suf) { const vs = new Set([ch]); if (ignoreCase) { vs.add(ch.toLowerCase()); vs.add(ch.toUpperCase()); }
    const ds = [...vs].map((c) => ALPH.indexOf(c)).filter((i) => i >= 0); const nx = []; for (const r of res) for (const d of ds) nx.push(r * 58 + d); res = nx; }
  const set = new Set(res); return (pkb) => { let r = 0; for (let i = 0; i < pkb.length; i++) r = (r * 256 + pkb[i]) % M; return set.has(r); };
}
export function attemptsFor(suf, ignoreCase = true) { let n = 1; for (const ch of suf) { let v = 0; for (const c of new Set(ignoreCase ? [ch, ch.toLowerCase(), ch.toUpperCase()] : [ch])) if (ALPH.includes(c)) v++; n *= 58 / Math.max(1, v); } return Math.round(n); }
function grindChunk(test, n) { const sk = new Uint8Array(32); for (let i = 0; i < n; i++) { crypto.getRandomValues(sk); const pub = ed25519.getPublicKey(sk); if (test(pub)) { const full = new Uint8Array(64); full.set(sk); full.set(pub, 32); return full; } } return null; }
const SELF_URL = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
const IS_WORKER = typeof window === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof importScripts === 'function';
if (IS_WORKER) {
  let stop = false;
  self.onmessage = (e) => { if (e.data && e.data.stop) { stop = true; return; } if (!e.data || !e.data.suf) return; stop = false; const test = matcher(e.data.suf, e.data.ic !== false);
    const loop = () => { if (stop) return; const hit = grindChunk(test, 400); if (hit) { self.postMessage({ hit: Array.from(hit) }); return; } self.postMessage({ n: 400 }); setTimeout(loop, 0); }; loop(); };
}
export function grind(suf, { ignoreCase = true, onProgress, threads } = {}) {
  if (!suffixOk(suf)) return Promise.reject(new Error('Address endings can’t use 0, O, I or l'));
  const n = Math.max(1, Math.min(8, threads || ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1)), expected = attemptsFor(suf, ignoreCase);
  let tried = 0, done = false; const ws = [];
  return new Promise((resolve, reject) => {
    const finish = (err, val) => { if (done) return; done = true; ws.forEach((w) => { try { w.postMessage({ stop: true }); w.terminate(); } catch (e) {} }); err ? reject(err) : resolve(val); };
    let ok = false; try { for (let i = 0; i < n; i++) { const w = new Worker(SELF_URL); ws.push(w); w.onmessage = (e) => { if (e.data.hit) { const kp = Keypair.fromSecretKey(Uint8Array.from(e.data.hit)); finish(null, { secret: Array.from(kp.secretKey), address: kp.publicKey.toBase58(), tried }); } else { tried += e.data.n; onProgress && onProgress(tried, expected); } }; w.onerror = () => {}; w.postMessage({ suf, ic: ignoreCase }); } ok = ws.length > 0; } catch (e) { ok = false; }
    if (!ok) { const test = matcher(suf, ignoreCase); const loop = () => { if (done) return; const hit = grindChunk(test, 300); tried += 300; onProgress && onProgress(tried, expected); if (hit) { const kp = Keypair.fromSecretKey(hit); finish(null, { secret: Array.from(kp.secretKey), address: kp.publicKey.toBase58(), tried }); } else setTimeout(loop, 0); }; loop(); }
    grind.cancel = () => finish(new Error('cancelled'));
  });
}

// add the app-side signatures (mint / config keys) after the wallet has signed
export function cosign(signed, cosigners = []) {
  const kps = cosigners.map((s) => Keypair.fromSecretKey(Uint8Array.from(s)));
  return signed.map((b) => { const tx = Transaction.from(b instanceof Uint8Array ? b : Uint8Array.from(b));
    const need = new Set(tx.signatures.map((x) => x.publicKey.toBase58())); const mine = kps.filter((k) => need.has(k.publicKey.toBase58()));
    if (mine.length) tx.partialSign(...mine); return tx.serialize({ requireAllSignatures: true, verifySignatures: false }); });
}

// ---- creator rewards: read + claim the creator's share of trading fees (SOL) ----
export async function creatorFees({ rpc, pool }) {
  const vpw = await client(rpc).state.getPool(pk(pool)); const vp = vpw.poolState || vpw, cfg = await client(rpc).state.getPoolConfig(vp.config), qi = await quoteInfo({ rpc, mint: cfg.quoteMint.toBase58() }), D = 10 ** qi.decimals;
  return { quoteMint: qi.mint, unclaimed: Number(vp.creatorQuoteFee.toString()) / D, creator: vp.creator.toBase58(), partnerUnclaimed: Number(vp.partnerQuoteFee.toString()) / D };
}
// sanity-check a swap transaction from Jupiter's API before the wallet signs it: user pays, only known programs are called
const JUP_OK = new Set(['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'ComputeBudget111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', '11111111111111111111111111111111']);
export async function checkSwapTx(bytes, owner, rpc) {
  const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes)), m = tx.message, me = pk(owner);
  const alts = []; for (const l of m.addressTableLookups || []) { const r = await C(rpc).getAddressLookupTable(l.accountKey); if (!r.value) throw new Error('Swap uses an unknown lookup table — refusing'); alts.push(r.value); }
  const keys = m.getAccountKeys({ addressLookupTableAccounts: alts }), key = (i) => keys.get(i), wsol = getAssociatedTokenAddressSync(NATIVE_MINT, me, true, TOKEN_PROGRAM_ID);
  if (!m.staticAccountKeys[0]?.equals(me)) throw new Error('Swap transaction is not paid by your wallet — refusing to sign');
  for (const ix of m.compiledInstructions) { const p = key(ix.programIdIndex)?.toBase58(), d = Buffer.from(ix.data), a = ix.accountKeyIndexes.map(key), bad = (why) => { throw new Error('Swap transaction looks wrong (' + why + ') — refusing to sign'); };
    if (!p || !JUP_OK.has(p)) bad('unexpected program');
    if (p === '11111111111111111111111111111111') { if (d.readUInt32LE(0) !== 2 || !a[0]?.equals(me) || !a[1]?.equals(wsol)) bad('SOL transfer'); }   // only wrapping your own SOL
    if (p === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' && !a[2]?.equals(me)) bad('account for someone else');
    if (p === TOKEN_PROGRAM_ID.toBase58() || p === TOKEN_2022_PROGRAM_ID.toBase58()) { const op = d[0];   // sync (17) or close (9) of your own account only
      if (!(op === 17 || (op === 9 && a[1]?.equals(me) && a[2]?.equals(me)))) bad('token instruction'); } }
  return true;
}
// burn your own tokens of a treid coin (permanent) — with a memo so it's recognisable on-chain
export async function buildBurn({ rpc, owner, mint, amount }) {
  owner = pk(owner); const m = pk(mint), raw = BigInt(Math.floor(amount * 10 ** RULES.decimals)); if (raw <= 0n) throw new Error('Nothing to burn');
  const ata = getAssociatedTokenAddressSync(m, owner, false, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction().add(createBurnCheckedInstruction(ata, m, owner, raw, RULES.decimals, [], TOKEN_2022_PROGRAM_ID), new TransactionInstruction({ keys: [], programId: pk('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Buffer.from(`treid:burn:${m.toBase58()}:${raw}`) }));
  return { ...(await finish(rpc, [tx], owner, [])), tokens: Number(raw) / 10 ** RULES.decimals };
}
export async function buildClaimCreator({ rpc, creator, pool }) {
  creator = pk(creator); const vpw = await client(rpc).state.getPool(pk(pool)); const vp = vpw.poolState || vpw;
  if (vp.creator.toBase58() !== creator.toBase58()) throw new Error('Only the coin creator can claim these rewards');
  const amt = new BN(vp.creatorQuoteFee.toString()); if (amt.isZero()) throw new Error('Nothing to claim yet');
  const tx = await client(rpc).creator.claimCreatorTradingFee({ creator, payer: creator, pool: pk(pool), maxBaseAmount: new BN(0), maxQuoteAmount: amt });
  const out = await finish(rpc, [tx], creator, []), cfg = await client(rpc).state.getPoolConfig(vp.config), qi = await quoteInfo({ rpc, mint: cfg.quoteMint.toBase58() }); return { ...out, amount: Number(amt.toString()) / 10 ** qi.decimals };
}
export const b58 = (bytes) => bs58enc(bytes);
