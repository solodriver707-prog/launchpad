import * as T from './src.mjs';
import { Keypair, Transaction, Connection, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { deriveDbcPoolAddress } from '@meteora-ag/dynamic-bonding-curve-sdk';
const rpc = 'http://127.0.0.1:8899', conn = new Connection(rpc, 'confirmed'), [mint, config] = process.argv.slice(2);
const pool = deriveDbcPoolAddress(NATIVE_MINT, new PublicKey(mint), new PublicKey(config)).toBase58();
for (const n of [1, 2]) { const k = Keypair.generate(); await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 5e9));
  for (let i = 0; i < 3; i++) { const b = await T.buildSwap({ rpc, owner: k.publicKey.toBase58(), pool, side: 'buy', amount: 0.5 }); const signed = b.bytes.map((x) => { const t = Transaction.from(x); t.partialSign(k); return t.serialize(); }); await T.sendAll({ rpc, signed, lastValidBlockHeight: b.lastValidBlockHeight }); }
  console.log('holder', n, k.publicKey.toBase58(), (await T.tokenBalance({ rpc, owner: k.publicKey, mint })).toFixed(0)); }
