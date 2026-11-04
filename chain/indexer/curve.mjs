// The exact curve the treid site creates (must match curveFor() in chain/web/src.mjs and chain/scripts/01_launch.mjs).
// curveOk(cfg, quoteDecimals) rebuilds that curve from the config's own start price and checks that every economic
// parameter matches — a config made by anyone else (odd threshold, fee schedule, migration settings) is not treid.
import { buildCurveWithMarketCap, buildCurve, getPriceFromSqrtPrice, TokenType, TokenDecimal, TokenAuthorityOption, BaseFeeMode, CollectFeeMode,
  MigrationOption, MigrationFeeOption, MigratedCollectFeeMode, DammV2DynamicFeeMode, ActivationType } from '@meteora-ag/dynamic-bonding-curve-sdk';
export const RULES = { minTrapBps: 5000, minTrapSecs: 30, trapSteps: 3, feePlainBps: 100, feeTaxedBps: 50, maxTaxBps: 1000, creatorFeePct: 50, supply: 1e9 };
// curve versions (must match chain/web/src.mjs CURVES): v1 20→60 SOL MC + 0.5% pool after graduation · v2 28→420 SOL MC + 1% pool
export const CURVES = [{ ratio: 3, gradFeeBps: 50 }, { ratio: 15, gradFeeBps: 100 }, { pct: 40, gradFeeBps: 100 }];   // v3 "Pro start": 40% of the supply sold on the curve for ~85 SOL (starts ~94 SOL MC, graduates ~213 SOL MC)
function curveBase({ taxBps = 0, trapBps = 5000, trapSecs = 30, quoteDecimals = 9, gradFeeBps = 100 }) {
  const trap = Math.min(9000, Math.max(RULES.minTrapBps, trapBps | 0)), secs = Math.max(RULES.minTrapSecs, trapSecs | 0), tax = Math.min(RULES.maxTaxBps, Math.max(0, taxBps | 0));
  return {
    token: { tokenType: TokenType.Token2022, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: quoteDecimals, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: RULES.supply, leftover: 0 },
    fee: { baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: trap, endingFeeBps: tax > 0 ? RULES.feeTaxedBps : RULES.feePlainBps, numberOfPeriod: RULES.trapSteps, totalDuration: secs } },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: RULES.creatorFeePct, poolCreationFee: 0, enableFirstSwapWithMinFee: true },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.Customizable, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.Compounding, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: gradFeeBps, compoundingFeeBps: 0 } },
    liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 50, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp };
}
export function curveFor(p) { return buildCurveWithMarketCap({ ...curveBase(p), initialMarketCap: p.mc0 ?? 28, migrationMarketCap: p.mc1 ?? 420 }); }
// v3 "Pro start": a fixed share of the supply is sold on the curve for a fixed amount of the pair token (thr, in whole tokens)
export function curveForPro(p) { return buildCurve({ ...curveBase(p), percentageSupplyOnMigration: p.pct || 40, migrationQuoteThreshold: p.thr }); }
const n = (x) => Number(x?.toString?.() ?? x);
const near = (a, b, tol = 2e-6) => { const x = BigInt(a.toString()), y = BigInt(b.toString()); if (x === y) return true; const d = x > y ? x - y : y - x, m = x > y ? x : y; return Number(d) / Number(m) <= tol; };
export function curveOk(cf, quoteDecimals) {
  try {
    const bf = cf.poolFees.baseFee, taxBps = n(cf.transferFeeFlag) ? n(cf.transferFeeBasisPoints) : 0, trapBps = Math.round(n(bf.cliffFeeNumerator) / 1e5), trapSecs = n(bf.firstFactor) * n(bf.secondFactor);
    if (n(bf.baseFeeMode) !== BaseFeeMode.FeeSchedulerLinear || n(bf.firstFactor) !== RULES.trapSteps || trapBps < RULES.minTrapBps || trapBps > 9000 || trapSecs < RULES.minTrapSecs || trapSecs > 86400 || taxBps > RULES.maxTaxBps) return false;
    const mc0 = Number(getPriceFromSqrtPrice(cf.sqrtStartPrice, 6, quoteDecimals)) * RULES.supply; if (!(mc0 > 0) || !isFinite(mc0)) return false;
    const vers = CURVES.filter((v) => v.gradFeeBps === n(cf.migratedPoolFeeBps)); if (!vers.length) return false;
    return vers.some((ver) => { try {   // every treid curve version is checked; the config must match one of them exactly
    const thr = Number(cf.migrationQuoteThreshold.toString()) / 10 ** quoteDecimals;
    const want = ver.pct ? curveForPro({ taxBps, trapBps, trapSecs, quoteDecimals, thr, pct: ver.pct, gradFeeBps: ver.gradFeeBps }) : curveFor({ taxBps, trapBps, trapSecs, quoteDecimals, mc0, mc1: mc0 * ver.ratio, gradFeeBps: ver.gradFeeBps }), wb = want.poolFees.baseFee;
    if (!near(want.sqrtStartPrice, cf.sqrtStartPrice) || !near(want.migrationQuoteThreshold, cf.migrationQuoteThreshold, 1e-4)) return false;
    if (n(wb.cliffFeeNumerator) !== n(bf.cliffFeeNumerator) || n(wb.firstFactor) !== n(bf.firstFactor) || n(wb.secondFactor) !== n(bf.secondFactor) || n(wb.thirdFactor) !== n(bf.thirdFactor)) return false;
    for (const k of ['migrationOption', 'migrationFeeOption', 'activationType', 'collectFeeMode', 'creatorTradingFeePercentage']) if (n(want[k]) !== n(cf[k])) return false;
    if (n(cf.migratedCollectFeeMode) !== MigratedCollectFeeMode.Compounding || n(cf.migratedDynamicFee) !== 0 || n(cf.migratedCompoundingFeeBps) !== 0 || n(cf.enableFirstSwapWithMinFee) !== 1
      || n(cf.poolCreationFee) !== 0 || n(cf.migrationFeePercentage) !== 0 || n(cf.creatorMigrationFeePercentage) !== 0) return false;
    const pts = (c) => (c || []).filter((p) => n(p.liquidity) !== 0 || p.liquidity.toString() !== '0');
    const a = pts(want.curve), b = pts(cf.curve); if (!b.length || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!near(a[i].sqrtPrice, b[i].sqrtPrice, 1e-4) || !near(a[i].liquidity, b[i].liquidity, 1e-4)) return false;
    return true;
    } catch { return false; } });
  } catch { return false; }
}
