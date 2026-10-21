// launch a coin and simulate: 2 sniper bots in the first slot, then humans buying/selling
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import { DynamicBondingCurveClient, deriveDbcPoolAddress, SwapMode } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { conn, key, airdrop, sol, state } from './common.mjs';
import { execSync } from 'child_process';
const W = ['bot1', 'bot2', 'alice', 'bob', 'carol', 'dave'].map(n => [n, key(n)]);
for (const [, k] of W) if (await sol(k.publicKey) < 2) await airdrop(k.publicKey, 20);
execSync('node scripts/01_launch.mjs', { stdio: 'inherit', env: { ...process.env } });
const st = state.load(), client = new DynamicBondingCurveClient(conn, 'confirmed');
const mint = new PublicKey(st.mint), pool = deriveDbcPoolAddress(NATIVE_MINT, mint, new PublicKey(st.config));
async function buy(k, amt) { const tx = await client.pool.swap2({ owner: k.publicKey, pool, swapBaseForQuote: false, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: new BN(amt * LAMPORTS_PER_SOL), minimumAmountOut: new BN(0) }); tx.feePayer = k.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.sign(k); return conn.sendRawTransaction(tx.serialize()); }
async function sell(k, frac) { const a = await getAccount(conn, getAssociatedTokenAddressSync(mint, k.publicKey, false, TOKEN_2022_PROGRAM_ID), 'confirmed', TOKEN_2022_PROGRAM_ID); const amt = new BN((a.amount * BigInt(Math.round(frac * 100)) / 100n).toString()); const tx = await client.pool.swap2({ owner: k.publicKey, pool, swapBaseForQuote: true, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: amt, minimumAmountOut: new BN(0) }); tx.feePayer = k.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.sign(k); return conn.sendRawTransaction(tx.serialize()); }
const wait = (ms) => new Promise(r => setTimeout(r, ms)), get = (n) => W.find(w => w[0] === n)[1];
await Promise.all([buy(get('bot1'), 0.8), buy(get('bot2'), 0.8)]); console.log('snipers fired');
await wait(9000); await buy(get('alice'), 0.5); await wait(1500); await buy(get('bob'), 0.3); await wait(1500); await buy(get('carol'), 1.0);
await wait(25000); await buy(get('dave'), 0.6); await wait(1500); await sell(get('bot1'), 1); await wait(1500); await sell(get('alice'), .4); await wait(1500); await buy(get('bob'), 0.4);
await wait(3000); console.log('simulation done');
