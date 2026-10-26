// local test: coin paired with a mock USDC (SPL, 6 decimals)
import * as T from './src.mjs'; import { Keypair, Transaction, Connection } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token'; import fs from 'fs';
const rpc = 'http://127.0.0.1:8899', conn = new Connection(rpc, 'confirmed'), OPS = 'BUCDaQveAzYbhd2c5ZzFgrXcn3nWiPhGRNe8QpT64p4j';
const F = '/tmp/claude-0/-home-claude/6c43ef8f-b9bb-59b9-8928-0a21e972db9e/scratchpad/pair.json';
const dev = Keypair.generate(), buyer = Keypair.generate(); for (const k of [dev, buyer]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 5e9));
const usdc = await createMint(conn, dev, dev.publicKey, null, 6); for (const k of [dev, buyer]) { const a = await getOrCreateAssociatedTokenAccount(conn, dev, usdc, k.publicKey); await mintTo(conn, dev, usdc, a.address, dev, 100000e6); }
console.log('mock USDC', usdc.toBase58(), await T.quoteInfo({ rpc, mint: usdc.toBase58() }));
const sign = (kp, b) => T.cosign(b.bytes.map((x) => { const t = Transaction.from(x); t.partialSign(kp); return t.serialize({ requireAllSignatures: false }); }), b.cosigners);
const c = await T.buildCreate({ rpc, payer: dev.publicKey.toBase58(), partner: OPS, treasury: 'BzCPzoJmoRKV8Ha7dHpyePikjSDL9a9Y3LNKJQdjeaNX', name: 'Usd Pair', symbol: 'USDP', uri: 'https://x.y/z?c=000000', taxBps: 300, devBuySol: 50, escrow: OPS, quoteMint: usdc.toBase58(), mc0: 3000, mc1: 9000 });
await T.sendAll({ rpc, signed: sign(dev, c), lastValidBlockHeight: c.lastValidBlockHeight }); console.log('coin', c.mint, 'dev tokens', (await T.tokenBalance({ rpc, owner: dev.publicKey, mint: c.mint })).toFixed(0));
const q = await T.quote({ rpc, pool: c.pool, side: 'buy', amount: 100 }); console.log('quote 100 USDC →', q.out.toFixed(0), 'fee', q.feeSol, 'USDC');
const b = await T.buildSwap({ rpc, owner: buyer.publicKey.toBase58(), pool: c.pool, side: 'buy', amount: 100 }); await T.sendAll({ rpc, signed: sign(buyer, b), lastValidBlockHeight: b.lastValidBlockHeight });
const bal = await T.tokenBalance({ rpc, owner: buyer.publicKey, mint: c.mint }); console.log('buyer tokens', bal.toFixed(0), 'USDC left', await T.tokenBalance({ rpc, owner: buyer.publicKey, mint: usdc.toBase58() }));
const s = await T.buildSwap({ rpc, owner: buyer.publicKey.toBase58(), pool: c.pool, side: 'sell', amount: bal / 2 }); await T.sendAll({ rpc, signed: sign(buyer, s), lastValidBlockHeight: s.lastValidBlockHeight });
console.log('after sell USDC', await T.tokenBalance({ rpc, owner: buyer.publicKey, mint: usdc.toBase58() }), 'creator fees', await T.creatorFees({ rpc, pool: c.pool }));
fs.writeFileSync(F, JSON.stringify({ usdc: usdc.toBase58(), mint: c.mint, config: c.config, pool: c.pool, dev: [...dev.secretKey], buyer: [...buyer.secretKey] }));
