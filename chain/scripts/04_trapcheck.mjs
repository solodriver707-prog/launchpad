// buy a tiny amount every few seconds through the trap and print the fee actually charged
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import BN from 'bn.js'; import { NATIVE_MINT } from '@solana/spl-token';
import { DynamicBondingCurveClient, deriveDbcPoolAddress, SwapMode, getCurrentPoint } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { conn, key, airdrop, sol, state } from './common.mjs'; import { execSync } from 'child_process';
const k = key('alice'); if (await sol(k.publicKey) < 2) await airdrop(k.publicKey, 20);
execSync('node scripts/01_launch.mjs', { stdio: 'ignore', env: { ...process.env } });
const st = state.load(), client = new DynamicBondingCurveClient(conn, 'confirmed'), pool = deriveDbcPoolAddress(NATIVE_MINT, new PublicKey(st.mint), new PublicKey(st.config));
const t0 = Date.now();
for (let i = 0; i < 9; i++) {
  const vpw = await client.state.getPool(pool), vp = vpw.poolState, cfg = await client.state.getPoolConfig(vp.config), cp = await getCurrentPoint(conn, cfg.activationType);
  const amountIn = new BN(0.05 * LAMPORTS_PER_SOL);
  const qt = client.pool.swapQuote2({ virtualPool: vpw, config: cfg, swapBaseForQuote: false, amountIn, slippageBps: 100, hasReferral: false, currentPoint: cp, swapMode: SwapMode.ExactIn });
  const before = vp.partnerQuoteFee.add(vp.creatorQuoteFee).add(vp.protocolQuoteFee); const tx = await client.pool.swap2({ owner: k.publicKey, pool, swapBaseForQuote: false, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn, minimumAmountOut: new BN(0) }); tx.feePayer = k.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.sign(k); await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), 'confirmed'); const vp2 = (await client.state.getPool(pool)).poolState; const fee = vp2.partnerQuoteFee.add(vp2.creatorQuoteFee).add(vp2.protocolQuoteFee).sub(before).toNumber() / 1e9;
  console.log(`chain clock +${(cp.toNumber() - vp.activationPoint.toNumber())}s  (wall +${((Date.now() - t0) / 1000).toFixed(0)}s)  actual fee on a 0.05 SOL buy: ${(fee / 0.05 * 100).toFixed(1)}%`);
  await new Promise(r => setTimeout(r, 4000));
}
