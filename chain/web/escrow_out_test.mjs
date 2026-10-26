// launch an escrow coin (dev buy), dev sells everything → creator out
import * as T from './src.mjs'; import { Keypair, Transaction, Connection } from '@solana/web3.js';
const rpc = 'http://127.0.0.1:8899', conn = new Connection(rpc, 'confirmed'), OPS = 'BUCDaQveAzYbhd2c5ZzFgrXcn3nWiPhGRNe8QpT64p4j';
const dev = Keypair.generate(); await conn.confirmTransaction(await conn.requestAirdrop(dev.publicKey, 5e9));
const sign = (b) => T.cosign(b.bytes.map((x) => { const t = Transaction.from(x); t.partialSign(dev); return t.serialize({ requireAllSignatures: false }); }), b.cosigners);
const c = await T.buildCreate({ rpc, payer: dev.publicKey.toBase58(), partner: OPS, treasury: 'BzCPzoJmoRKV8Ha7dHpyePikjSDL9a9Y3LNKJQdjeaNX', name: 'Out Test', symbol: 'OUTT', uri: 'https://x.y/z?c=000000', taxBps: 300, devBuySol: 0.5, escrow: OPS });
await T.sendAll({ rpc, signed: sign(c), lastValidBlockHeight: c.lastValidBlockHeight }); await new Promise((r) => setTimeout(r, 4000));
const bal = await T.tokenBalance({ rpc, owner: dev.publicKey, mint: c.mint }); const s = await T.buildSwap({ rpc, owner: dev.publicKey.toBase58(), pool: c.pool, side: 'sell', amount: bal });
await T.sendAll({ rpc, signed: sign(s), lastValidBlockHeight: s.lastValidBlockHeight }); console.log(c.mint, c.config);
