// treid browser chain module → bundled to chain.js (window.TreidChain). Builds real DBC transactions; the wallet only signs.
import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';
import { DynamicBondingCurveClient, buildCurveWithMarketCap, TokenType, TokenDecimal, TokenAuthorityOption, BaseFeeMode, CollectFeeMode,
  MigrationOption, MigrationFeeOption, MigratedCollectFeeMode, DammV2DynamicFeeMode, ActivationType, deriveDbcPoolAddress, SwapMode, getCurrentPoint } from '@meteora-ag/dynamic-bonding-curve-sdk';

// ---- treid rules (must match chain/scripts/01_launch.mjs) ----
export const RULES = { minTrapBps: 5000, minTrapSecs: 30, trapSteps: 3, feePlainBps: 100, feeTaxedBps: 50, maxTaxBps: 1000, creatorFeePct: 50, mc0Sol: 20, mc1Sol: 60, supply: 1e9, decimals: 6 };
const conns = {}; const C = (rpc) => conns[rpc] || (conns[rpc] = new Connection(rpc, 'confirmed'));
const client = (rpc) => new DynamicBondingCurveClient(C(rpc), 'confirmed');
const pk = (x) => (x instanceof PublicKey ? x : new PublicKey(x));

export function curveFor({ taxBps = 0, trapBps = 5000, trapSecs = 30 }) {
  const trap = Math.min(9000, Math.max(RULES.minTrapBps, trapBps | 0)), secs = Math.max(RULES.minTrapSecs, trapSecs | 0), tax = Math.min(RULES.maxTaxBps, Math.max(0, taxBps | 0));
  return buildCurveWithMarketCap({
    token: { tokenType: TokenType.Token2022, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: TokenDecimal.NINE, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: RULES.supply, leftover: 0 },
    fee: { baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: trap, endingFeeBps: tax > 0 ? RULES.feeTaxedBps : RULES.feePlainBps, numberOfPeriod: RULES.trapSteps, totalDuration: secs } },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: RULES.creatorFeePct, poolCreationFee: 0, enableFirstSwapWithMinFee: true },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.Customizable, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.Compounding, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: 50, compoundingFeeBps: 0 } },
    liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 50, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp, initialMarketCap: RULES.mc0Sol, migrationMarketCap: RULES.mc1Sol,
  });
}
async function finish(rpc, txs, payer, keypairs) {
  const { blockhash, lastValidBlockHeight } = await C(rpc).getLatestBlockhash('confirmed');
  for (const tx of txs) {
    tx.feePayer = payer; tx.recentBlockhash = blockhash;
    const need = new Set(tx.compileMessage().accountKeys.slice(0, tx.compileMessage().header.numRequiredSignatures).map((k) => k.toBase58()));
    const signers = keypairs.filter((k) => need.has(k.publicKey.toBase58())); if (signers.length) tx.partialSign(...signers);
  }
  return { bytes: txs.map((t) => t.serialize({ requireAllSignatures: false, verifySignatures: false })), lastValidBlockHeight };
}
// create config + coin (+ optional dev first buy, never hit by the trap) — returns unsigned-by-wallet tx bytes
export async function buildCreate({ rpc, payer, partner, name, symbol, uri, taxBps = 0, trapBps = 5000, trapSecs = 30, devBuySol = 0 }) {
  payer = pk(payer); partner = pk(partner);
  const cl = client(rpc), cfg = Keypair.generate(), mint = Keypair.generate(), curve = curveFor({ taxBps, trapBps, trapSecs });
  const common = { payer, config: cfg.publicKey, feeClaimer: partner, leftoverReceiver: partner, quoteMint: NATIVE_MINT, ...curve,
    transferFeeParameters: taxBps > 0 ? { transferFeeBasisPoints: Math.min(RULES.maxTaxBps, taxBps), withheldAuthority: 0, migratedTransferFeeAuthorityOption: 0 } : null,
    preCreatePoolParam: { name: String(name).slice(0, 32), symbol: String(symbol).slice(0, 10), uri: String(uri).split('MINT'.repeat(11)).join(mint.publicKey.toBase58()).slice(0, 200), poolCreator: payer, baseMint: mint.publicKey } };
  let txs;
  if (devBuySol > 0) { const r = await cl.partner.createConfigAndPoolWithFirstBuy({ ...common, firstBuyParam: { buyer: payer, buyAmount: new BN(Math.round(devBuySol * 1e9)), minimumAmountOut: new BN(0), referralTokenAccount: null } }); txs = [r.createConfigTx, r.createPoolWithFirstBuyTx]; }
  else txs = [await cl.partner.createConfigAndPool(common)];
  const out = await finish(rpc, txs, payer, [cfg, mint]);
  return { ...out, uri: common.preCreatePoolParam.uri, mint: mint.publicKey.toBase58(), config: cfg.publicKey.toBase58(), pool: deriveDbcPoolAddress(NATIVE_MINT, mint.publicKey, cfg.publicKey).toBase58() };
}
async function poolCtx(rpc, pool) {
  const cl = client(rpc), vpw = await cl.state.getPool(pk(pool)); if (!vpw) throw new Error('Pool not found');
  const vp = vpw.poolState || vpw, cfg = await cl.state.getPoolConfig(vp.config), cp = await getCurrentPoint(C(rpc), cfg.activationType);
  return { cl, vpw: vpw.poolState ? vpw : { poolState: vp }, vp, cfg, cp };
}
// side 'buy': amount in SOL; side 'sell': amount in tokens
export async function quote({ rpc, pool, side, amount, slippageBps = 500 }) {
  const { cl, vpw, cfg, cp } = await poolCtx(rpc, pool), sell = side === 'sell';
  const amountIn = new BN(Math.floor(amount * (sell ? 10 ** RULES.decimals : 1e9)));
  const q = cl.pool.swapQuote2({ virtualPool: vpw, config: cfg, swapBaseForQuote: sell, amountIn, slippageBps, hasReferral: false, currentPoint: cp, swapMode: SwapMode.ExactIn });
  const outRaw = q.outputAmount || q.amountOut || new BN(0), minRaw = q.minimumAmountOut || new BN(0), fee = q.tradingFee || q.fee || new BN(0);
  const div = sell ? 1e9 : 10 ** RULES.decimals;
  return { out: Number(outRaw.toString()) / div, minOut: Number(minRaw.toString()) / div, feeSol: Number(fee.toString()) / 1e9, amountIn: amountIn.toString(), minRaw: minRaw.toString() };
}
export async function buildSwap({ rpc, owner, pool, side, amount, slippageBps = 500 }) {
  owner = pk(owner); const q = await quote({ rpc, pool, side, amount, slippageBps }), cl = client(rpc);
  const tx = await cl.pool.swap2({ owner, pool: pk(pool), swapBaseForQuote: side === 'sell', referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: new BN(q.amountIn), minimumAmountOut: new BN(q.minRaw) });
  const out = await finish(rpc, [tx], owner, []);
  return { ...out, quote: q };
}
export async function tokenBalance({ rpc, owner, mint }) {
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
