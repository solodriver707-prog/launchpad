// node test of the browser module against a local validator, wallet = keypair
import * as T from './src.mjs';
import { Keypair, Transaction, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import fs from 'fs';
const rpc = process.env.RPC || 'http://127.0.0.1:8899', conn = new Connection(rpc, 'confirmed');
const dev = Keypair.generate(), PARTNER = 'BzCPzoJmoRKV8Ha7dHpyePikjSDL9a9Y3LNKJQdjeaNX';
await conn.confirmTransaction(await conn.requestAirdrop(dev.publicKey, 10 * LAMPORTS_PER_SOL));
const signW = (bytes) => bytes.map((b) => { const t = Transaction.from(b); t.partialSign(dev); return t.serialize({ requireAllSignatures: false }); });
const c = await T.buildCreate({ rpc, payer: dev.publicKey.toBase58(), partner: PARTNER, name: 'Web Test', symbol: 'WEBT', uri: 'https://treid.fun/m/x', taxBps: 300, trapBps: 5000, trapSecs: 30, devBuySol: 0.5 });
console.log('create txs', c.bytes.length, 'mint', c.mint);
console.log('sigs', await T.sendAll({ rpc, signed: T.cosign(signW(c.bytes), c.cosigners), lastValidBlockHeight: c.lastValidBlockHeight }));
console.log('dev tokens after first buy', await T.tokenBalance({ rpc, owner: dev.publicKey, mint: c.mint }));
const q = await T.quote({ rpc, pool: c.pool, side: 'buy', amount: 0.1 }); console.log('quote buy 0.1 SOL (in trap)', q);
const b = await T.buildSwap({ rpc, owner: dev.publicKey.toBase58(), pool: c.pool, side: 'buy', amount: 0.1 });
await T.sendAll({ rpc, signed: T.cosign(signW(b.bytes), b.cosigners), lastValidBlockHeight: b.lastValidBlockHeight });
const bal = await T.tokenBalance({ rpc, owner: dev.publicKey, mint: c.mint }); console.log('tokens', bal);
const s = await T.buildSwap({ rpc, owner: dev.publicKey.toBase58(), pool: c.pool, side: 'sell', amount: bal / 4 });
await T.sendAll({ rpc, signed: T.cosign(signW(s.bytes), s.cosigners), lastValidBlockHeight: s.lastValidBlockHeight });
console.log('after sell', await T.tokenBalance({ rpc, owner: dev.publicKey, mint: c.mint }), 'SOL', await conn.getBalance(dev.publicKey) / 1e9);
// 0% tax coin, no dev buy (single tx)
const c2 = await T.buildCreate({ rpc, payer: dev.publicKey.toBase58(), partner: PARTNER, name: 'Plain', symbol: 'PLN', uri: 'https://treid.fun/m/y', taxBps: 0, devBuySol: 0 });
console.log('plain create txs', c2.bytes.length, await T.sendAll({ rpc, signed: T.cosign(signW(c2.bytes), c2.cosigners), lastValidBlockHeight: c2.lastValidBlockHeight }));
