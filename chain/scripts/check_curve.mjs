import { buildCurveWithMarketCap, validateConfigParameters, validateTransferFeeParameters, TokenType, TokenDecimal, TokenAuthorityOption, BaseFeeMode, CollectFeeMode, MigrationOption, MigrationFeeOption, MigratedCollectFeeMode, DammV2DynamicFeeMode, ActivationType } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { Keypair } from '@solana/web3.js';
const curve = buildCurveWithMarketCap({
  token: { tokenType: TokenType.Token2022, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: TokenDecimal.NINE, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: 1_000_000_000, leftover: 0 },
  fee: { baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerExponential, feeSchedulerParam: { startingFeeBps: 5000, endingFeeBps: 100, numberOfPeriod: 10, totalDuration: 60 } }, dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 50, poolCreationFee: 0, enableFirstSwapWithMinFee: true },
  migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.Customizable, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 }, migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.Compounding, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: 50, compoundingFeeBps: 0 } },
  liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 50, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0 },
  lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
  activationType: ActivationType.Timestamp, initialMarketCap: 20, migrationMarketCap: 60 });
console.log('threshold SOL', curve.migrationQuoteThreshold.toString() / 1e9, 'supply', JSON.stringify(curve.tokenSupply), 'baseFee', JSON.stringify(curve.poolFees.baseFee));
try { validateConfigParameters({ ...curve, leftoverReceiver: Keypair.generate().publicKey }); console.log('config valid'); } catch (e) { console.log('INVALID:', e.message); }
try { validateTransferFeeParameters({ transferFeeBasisPoints: 300, withheldAuthority: 0, migratedTransferFeeAuthorityOption: 0 }, curve.tokenType, Keypair.generate().publicKey); console.log('transfer fee valid'); } catch (e) { console.log('TF INVALID:', e.message); }
