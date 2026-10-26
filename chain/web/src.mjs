// treid browser chain module → bundled to chain.js (window.TreidChain). Builds real DBC transactions; the wallet only signs.
import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import bs58lib from 'bs58';
const bs58enc = (b) => (bs58lib.default || bs58lib).encode(b instanceof Uint8Array ? b : Uint8Array.from(b));
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint, getExtensionTypes, ExtensionType, getTransferFeeConfig } from '@solana/spl-token';
import BN from 'bn.js';
import { DynamicBondingCurveClient, buildCurveWithMarketCap, TokenType, TokenDecimal, TokenAuthorityOption, BaseFeeMode, CollectFeeMode,
  MigrationOption, MigrationFeeOption, MigratedCollectFeeMode, DammV2DynamicFeeMode, ActivationType, deriveDbcPoolAddress, deriveDammV1MigrationMetadataAddress, SwapMode, getCurrentPoint } from '@meteora-ag/dynamic-bonding-curve-sdk';

// ---- treid rules (must match chain/scripts/01_launch.mjs) ----
export const RULES = { minTrapBps: 5000, minTrapSecs: 30, trapSteps: 3, feePlainBps: 100, feeTaxedBps: 50, maxTaxBps: 1000, creatorFeePct: 50, mc0Sol: 20, mc1Sol: 60, supply: 1e9, decimals: 6 };
const conns = {}; const C = (rpc) => conns[rpc] || (conns[rpc] = new Connection(rpc, 'confirmed'));
const client = (rpc) => new DynamicBondingCurveClient(C(rpc), 'confirmed');
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
export async function quoteInfo({ rpc, mint }) {
  const k = rpc + mint; if (qCache[k]) return qCache[k];
  const m = pk(mint); if (m.equals(NATIVE_MINT)) return (qCache[k] = { mint: NATIVE_MINT.toBase58(), decimals: 9, program: 'spl', native: true, ok: true });
  const ai = await C(rpc).getAccountInfo(m); if (!ai) return { mint: m.toBase58(), ok: false, reason: 'No token found at this address on this network' };
  const is22 = ai.owner.equals(TOKEN_2022_PROGRAM_ID); if (!is22 && !ai.owner.equals(TOKEN_PROGRAM_ID)) return { mint: m.toBase58(), ok: false, reason: 'This address is not a token mint' };
  const mi = await getMint(C(rpc), m, 'confirmed', is22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID); const out = { mint: m.toBase58(), decimals: mi.decimals, program: is22 ? 'token2022' : 'spl', ok: true };
  if (mi.freezeAuthority) out.warn = 'This token has a freeze authority — its issuer can freeze holders';
  if (is22) { const ext = getExtensionTypes(mi.tlvData); const tf = getTransferFeeConfig(mi);
    if (tf && (tf.newerTransferFee.transferFeeBasisPoints > 0 || tf.olderTransferFee.transferFeeBasisPoints > 0)) return { ...out, ok: false, reason: 'Tokens with a transfer tax can’t be used as a pair' };
    const bad = ext.filter((e) => !ALLOWED_EXT.has(e) && e !== ExtensionType.TransferFeeConfig); if (bad.length) return { ...out, ok: false, reason: 'This token type needs extra approval from Meteora — not supported yet' }; }
  return (qCache[k] = out);
}
async function finish(rpc, txs, payer, keypairs) {
  const { blockhash, lastValidBlockHeight } = await C(rpc).getLatestBlockhash('confirmed');
  for (const tx of txs) {
    tx.feePayer = payer; tx.recentBlockhash = blockhash;
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
async function poolCtx(rpc, pool) {
  const cl = client(rpc), vpw = await cl.state.getPool(pk(pool)); if (!vpw) throw new Error('Pool not found');
  const vp = vpw.poolState || vpw, cfg = await cl.state.getPoolConfig(vp.config), cp = await getCurrentPoint(C(rpc), cfg.activationType);
  const qi = await quoteInfo({ rpc, mint: cfg.quoteMint.toBase58() });
  return { cl, vpw: vpw.poolState ? vpw : { poolState: vp }, vp, cfg, cp, qd: qi.decimals };
}
// side 'buy': amount in SOL; side 'sell': amount in tokens
export async function quote({ rpc, pool, side, amount, slippageBps = 500 }) {
  const { cl, vpw, cfg, cp, qd } = await poolCtx(rpc, pool), sell = side === 'sell';
  const amountIn = new BN(Math.floor(amount * (sell ? 10 ** RULES.decimals : 10 ** qd)));
  const q = cl.pool.swapQuote2({ virtualPool: vpw, config: cfg, swapBaseForQuote: sell, amountIn, slippageBps, hasReferral: false, currentPoint: cp, swapMode: SwapMode.ExactIn });
  const outRaw = q.outputAmount || q.amountOut || new BN(0), minRaw = q.minimumAmountOut || new BN(0), fee = q.tradingFee || q.fee || new BN(0);
  const div = sell ? 10 ** qd : 10 ** RULES.decimals;
  return { out: Number(outRaw.toString()) / div, minOut: Number(minRaw.toString()) / div, feeSol: Number(fee.toString()) / 10 ** qd, quoteDecimals: qd, quoteMint: cfg.quoteMint.toBase58(), amountIn: amountIn.toString(), minRaw: minRaw.toString() };
}
export async function buildSwap({ rpc, owner, pool, side, amount, slippageBps = 500 }) {
  owner = pk(owner); const q = await quote({ rpc, pool, side, amount, slippageBps }), cl = client(rpc);
  const tx = await cl.pool.swap2({ owner, pool: pk(pool), swapBaseForQuote: side === 'sell', referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: new BN(q.amountIn), minimumAmountOut: new BN(q.minRaw) });
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
  for (const b of signed) {
    const raw = b instanceof Uint8Array ? b : Uint8Array.from(b);
    const sig = await C(rpc).sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed' });
    const tx = Transaction.from(raw); const r = await C(rpc).confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash, lastValidBlockHeight: lastValidBlockHeight || (await C(rpc).getBlockHeight()) + 150 }, 'confirmed');
    if (r.value.err) throw new Error('Transaction failed: ' + JSON.stringify(r.value.err));
    sigs.push(sig);
  }
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
export async function buildClaimCreator({ rpc, creator, pool }) {
  creator = pk(creator); const vpw = await client(rpc).state.getPool(pk(pool)); const vp = vpw.poolState || vpw;
  if (vp.creator.toBase58() !== creator.toBase58()) throw new Error('Only the coin creator can claim these rewards');
  const amt = new BN(vp.creatorQuoteFee.toString()); if (amt.isZero()) throw new Error('Nothing to claim yet');
  const tx = await client(rpc).creator.claimCreatorTradingFee({ creator, payer: creator, pool: pk(pool), maxBaseAmount: new BN(0), maxQuoteAmount: amt });
  const out = await finish(rpc, [tx], creator, []), cfg = await client(rpc).state.getPoolConfig(vp.config), qi = await quoteInfo({ rpc, mint: cfg.quoteMint.toBase58() }); return { ...out, amount: Number(amt.toString()) / 10 ** qi.decimals };
}
export const b58 = (bytes) => bs58enc(bytes);
