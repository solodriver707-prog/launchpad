// local test: launch a SOL coin with treid's config (escrow = ops) and buy it all the way up the curve (graduation threshold)
import * as T from './src.mjs'; import { Keypair, Transaction, Connection } from '@solana/web3.js'; import fs from 'fs';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
const rpc = 'http://127.0.0.1:8899', conn = new Connection(rpc, 'confirmed'), OPS = 'BUCDaQveAzYbhd2c5ZzFgrXcn3nWiPhGRNe8QpT64p4j', dbc = new DynamicBondingCurveClient(conn, 'confirmed');
const F = './grad.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = Keypair.generate(), buyers = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
for (const k of [dev, ...buyers]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 12e9));
const sign = (kp, b) => T.cosign(b.bytes.map((x) => { const t = Transaction.from(x); t.partialSign(kp); return t.serialize({ requireAllSignatures: false }); }), b.cosigners);
const c = await T.buildCreate({ rpc, payer: dev.publicKey.toBase58(), partner: OPS, treasury: 'BzCPzoJmoRKV8Ha7dHpyePikjSDL9a9Y3LNKJQdjeaNX', name: 'Grad Two', symbol: 'GRD2', uri: 'https://x.y/z?c=000000&s=70.20.10', taxBps: 200, devBuySol: 0.5, escrow: OPS });
await T.sendAll({ rpc, signed: sign(dev, c), lastValidBlockHeight: c.lastValidBlockHeight }); console.log('coin', c.mint, 'pool', c.pool);
fs.writeFileSync(F, JSON.stringify({ mint: c.mint, config: c.config, pool: c.pool, dev: [...dev.secretKey], buyers: buyers.map((b) => [...b.secretKey]) }));
await sleep(32000);   // let the sniper trap run out
for (let i = 0; i < 12; i++) {
  const vp = (await dbc.state.getPool(c.pool)).poolState, cfg = await dbc.state.getPoolConfig(vp.config), q = Number(vp.quoteReserve.toString()), thr = Number(cfg.migrationQuoteThreshold.toString());
  console.log('curve', (q / thr * 100).toFixed(1) + '%', (q / 1e9).toFixed(2), '/', (thr / 1e9).toFixed(2), 'SOL'); if (q >= thr) break;
  const k = buyers[i % 3], amt = 10;
  try { const b = await T.buildSwap({ rpc, owner: k.publicKey.toBase58(), pool: c.pool, side: 'buy', amount: amt, slippageBps: 2000 }); await T.sendAll({ rpc, signed: sign(k, b), lastValidBlockHeight: b.lastValidBlockHeight }); }
  catch (e) { console.log('buy err', e.message.slice(0, 120)); }
}
const vp = (await dbc.state.getPool(c.pool)).poolState; console.log('complete?', vp.isMigrated, 'quote', Number(vp.quoteReserve.toString()) / 1e9);
