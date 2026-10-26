import * as T from './src.mjs'; import { Keypair, Transaction, Connection } from '@solana/web3.js'; import fs from 'fs';
const rpc = 'http://127.0.0.1:8899', conn = new Connection(rpc, 'confirmed'), G = JSON.parse(fs.readFileSync('./grad.json'));
const expect = { mint: G.mint, partners: ['BUCDaQveAzYbhd2c5ZzFgrXcn3nWiPhGRNe8QpT64p4j'] }, dev = Keypair.fromSecretKey(Uint8Array.from(G.dev)), k = Keypair.generate();
await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 12e9));
const go = async (kp, side, amount) => { const b = await T.buildSwap({ rpc, owner: kp.publicKey.toBase58(), pool: G.pool, side, amount, expect }); await T.sendAll({ rpc, signed: b.bytes.map((x) => { const t = Transaction.from(x); t.partialSign(kp); return t.serialize({ requireAllSignatures: false }); }), lastValidBlockHeight: b.lastValidBlockHeight }); };
for (let i = 0; i < 3; i++) await go(k, 'buy', 3);
const bal = await T.tokenBalance({ rpc, owner: dev.publicKey.toBase58(), mint: G.mint }); console.log('dev bal', bal);
if (process.argv[2] === 'dump') { await go(dev, 'sell', bal * 0.8); console.log('dev sold 80%'); }
