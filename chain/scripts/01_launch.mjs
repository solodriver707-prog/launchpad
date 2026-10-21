// treid devnet proof: config (treid partner) + Token-2022 tax coin + sniper fee schedule
import { Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT as WSOL } from '@solana/spl-token';
import BN from 'bn.js';
import { DynamicBondingCurveClient, buildCurveWithMarketCap, TokenType, TokenDecimal, TokenAuthorityOption, BaseFeeMode, CollectFeeMode,
  MigrationOption, MigrationFeeOption, MigratedCollectFeeMode, DammV2DynamicFeeMode, ActivationType } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { conn, key, send, ex, exa, sol, fund, state } from './common.mjs';

const TAX_BPS = +(process.env.TAX_BPS || 300);       // coin tax (Token-2022 transfer fee), 3%
const SNIPE_START_BPS = Math.max(5000, +(process.env.SNIPE || 5000)); // sniper trap starting fee 50%
const PLATFORM_BPS = 100;                             // treid fee 1% after the trap
const TRAP_SECONDS = Math.max(30, +(process.env.TRAP || 30)); // mandatory minimum 30s
const TRAP_STEPS = 3; // hybrid: 3 equal steps down (e.g. 50% → 34% → 17%), then normal fee

const treid = key('treid'), dev = key('dev'), buyer = key('buyer');
const client = new DynamicBondingCurveClient(conn, 'confirmed');
console.log('treid', treid.publicKey.toBase58(), await sol(treid.publicKey), 'SOL');
for (const k of [dev, buyer]) if (await sol(k.publicKey) < 0.25) await fund(treid, k.publicKey, 0.35);

const curve = buildCurveWithMarketCap({
  token: { tokenType: TokenType.Token2022, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: TokenDecimal.NINE, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: 1_000_000_000, leftover: 0 },
  fee: { baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: SNIPE_START_BPS, endingFeeBps: PLATFORM_BPS, numberOfPeriod: TRAP_STEPS, totalDuration: TRAP_SECONDS } },
    dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 50, poolCreationFee: 0, enableFirstSwapWithMinFee: true },
  migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.Customizable, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.Compounding, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: 50, compoundingFeeBps: 0 } },
  liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 50, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0 },
  lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
  activationType: ActivationType.Timestamp,
  initialMarketCap: +(process.env.MC0 || 20), migrationMarketCap: +(process.env.MC1 || 60), // in SOL (devnet-sized)
});

const cfg = Keypair.generate();
const tx1 = await client.partner.createConfig2({ payer: treid.publicKey, config: cfg.publicKey, feeClaimer: treid.publicKey, leftoverReceiver: treid.publicKey, quoteMint: WSOL, ...curve,
  transferFeeParameters: { transferFeeBasisPoints: TAX_BPS, withheldAuthority: 0, migratedTransferFeeAuthorityOption: 0 } });
const s1 = await send(tx1, [treid, cfg]);
console.log('config', cfg.publicKey.toBase58(), ex(s1));

const mint = Keypair.generate();
const tx2 = await client.creator.createPool({ baseMint: mint.publicKey, config: cfg.publicKey, name: process.env.NAME || 'treid test', symbol: process.env.SYMBOL || 'TTEST', uri: 'https://solodriver707-prog.github.io/launchpad/', payer: dev.publicKey, poolCreator: dev.publicKey });
const s2 = await send(tx2, [dev, mint]);
console.log('coin ', mint.publicKey.toBase58(), ex(s2));
const st = state.load(); st.config = cfg.publicKey.toBase58(); st.mint = mint.publicKey.toBase58(); st.created = Date.now(); state.save(st);
console.log('explorer', exa(mint.publicKey.toBase58()));
