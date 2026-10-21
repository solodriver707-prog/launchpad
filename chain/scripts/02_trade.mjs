// buy during sniper trap, buy after, sell; then show withheld coin tax, harvest + burn it, claim treid fee
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount, getTransferFeeAmount, unpackAccount, withdrawWithheldTokensFromAccounts, harvestWithheldTokensToMint, withdrawWithheldTokensFromMint, createAssociatedTokenAccountIdempotent, burnChecked, getMint, getTransferFeeConfig } from '@solana/spl-token';
import BN from 'bn.js';
import { DynamicBondingCurveClient, deriveDbcPoolAddress, getCurrentPoint, SwapMode } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { conn, key, send, ex, state } from './common.mjs';
const st = state.load(), treid = key('treid'), dev = key('dev'), buyer = key('buyer');
const client = new DynamicBondingCurveClient(conn, 'confirmed');
const mint = new PublicKey(st.mint), config = new PublicKey(st.config);
const pool = deriveDbcPoolAddress(NATIVE_MINT, mint, config);
const bal = async (owner) => { try { const a = await getAccount(conn, getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID), 'confirmed', TOKEN_2022_PROGRAM_ID); return Number(a.amount) / 1e6; } catch { return 0; } };
async function swap(who, buy, amount, label) {
  const vp = (await client.state.getPool(pool)).poolState, cfg = await client.state.getPoolConfig(vp.config);
  const currentPoint = await getCurrentPoint(conn, cfg.activationType);
  const amountIn = new BN(buy ? Math.round(amount * LAMPORTS_PER_SOL) : Math.round(amount * 1e6));
  const before = await bal(who.publicKey);
  const tx = await client.pool.swap2({ owner: who.publicKey, pool, swapBaseForQuote: !buy, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn, minimumAmountOut: new BN(0) });
  const sig = await send(tx, [who]); const after = await bal(who.publicKey);
  const secs = ((Date.now() - st.created) / 1000).toFixed(0);
  console.log(`${label.padEnd(26)} t+${secs}s  ${buy ? 'paid ' + amount + ' SOL → got ' + (after - before).toFixed(0) + ' TTEST' : 'sold ' + amount + ' TTEST'}  ${ex(sig)}`);
  return after - before;
}
const step = process.argv[2] || 'all';
if (step === 'snipe' || step === 'all') await swap(buyer, true, 0.2, 'Sniper buy (trap on)');
if (step === 'all') { const wait = Math.max(0, st.created + 75000 - Date.now()); console.log('waiting', (wait / 1000).toFixed(0), 's for trap to end…'); await new Promise(r => setTimeout(r, wait)); }
if (step === 'normal' || step === 'all') await swap(dev, true, 0.2, 'Normal buy (trap over)');
if (step === 'sell' || step === 'all') { const b = await bal(buyer.publicKey); await swap(buyer, false, Math.floor(b / 2), 'Sell half'); }
if (step === 'tax' || step === 'all') {
  const accs = await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }] });
  let withheld = 0n, list = [];
  for (const a of accs) { const acc = unpackAccount(a.pubkey, a.account, TOKEN_2022_PROGRAM_ID); const tf = getTransferFeeAmount(acc); if (tf && tf.withheldAmount > 0n) { withheld += tf.withheldAmount; list.push(a.pubkey); } }
  const m = await getMint(conn, mint, 'confirmed', TOKEN_2022_PROGRAM_ID); const tfc = getTransferFeeConfig(m);
  console.log('coin tax rate', tfc.newerTransferFee.transferFeeBasisPoints / 100 + '%', '· withdraw authority', tfc.withdrawWithheldAuthority.toBase58() === treid.publicKey.toBase58() ? 'treid ✓' : tfc.withdrawWithheldAuthority.toBase58());
  console.log('tax withheld in', list.length, 'accounts:', Number(withheld) / 1e6, 'TTEST');
  if (list.length) {
    const dest = await createAssociatedTokenAccountIdempotent(conn, treid, mint, treid.publicKey, {}, TOKEN_2022_PROGRAM_ID);
    const s = await withdrawWithheldTokensFromAccounts(conn, treid, mint, dest, treid, [], list, {}, TOKEN_2022_PROGRAM_ID);
    const got = await bal(treid.publicKey); console.log('harvested to treid:', got, 'TTEST', ex(s));
    const burnAmt = BigInt(Math.floor(got * 1e6 * 0.2)); // e.g. 20% burn share
    const b = await burnChecked(conn, treid, dest, mint, treid, burnAmt, 6, [], {}, TOKEN_2022_PROGRAM_ID);
    console.log('burned (20% share):', Number(burnAmt) / 1e6, 'TTEST', ex(b));
  }
}
if (step === 'fees' || step === 'all') {
  const vp = (await client.state.getPool(pool)).poolState;
  console.log('treid fee unclaimed (SOL):', vp.partnerQuoteFee.toString() / 1e9, '· creator fee unclaimed (SOL):', vp.creatorQuoteFee.toString() / 1e9);
}
