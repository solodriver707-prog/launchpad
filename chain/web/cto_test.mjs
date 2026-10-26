// local CTO test: holders B and C buy, B applies, C supports → takeover
import * as T from './src.mjs'; import { Keypair, Transaction, Connection, PublicKey } from '@solana/web3.js'; import { NATIVE_MINT } from '@solana/spl-token';
import { deriveDbcPoolAddress } from '@meteora-ag/dynamic-bonding-curve-sdk'; import { ed25519 } from '@noble/curves/ed25519'; import bs58 from 'bs58'; import fs from 'fs';
const rpc = 'http://127.0.0.1:8899', conn = new Connection(rpc, 'confirmed'), [cmd, mint, config] = process.argv.slice(2), API = 'http://localhost:8787', F = '/tmp/claude-0/-home-claude/6c43ef8f-b9bb-59b9-8928-0a21e972db9e/scratchpad/cto_keys.json';
const pool = () => deriveDbcPoolAddress(NATIVE_MINT, new PublicKey(mint), new PublicKey(config)).toBase58();
const sign = (kp, msg) => bs58.encode(ed25519.sign(new TextEncoder().encode(msg), kp.secretKey.slice(0, 32)));
const post = (path, body) => fetch(API + path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
if (cmd === 'buy') { const ks = [Keypair.generate(), Keypair.generate()]; fs.writeFileSync(F, JSON.stringify(ks.map((k) => [...k.secretKey])));
  for (const k of ks) { await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 5e9)); for (let i = 0; i < 3; i++) { const b = await T.buildSwap({ rpc, owner: k.publicKey.toBase58(), pool: pool(), side: 'buy', amount: 0.6 }); await T.sendAll({ rpc, signed: b.bytes.map((x) => { const t = Transaction.from(x); t.partialSign(k); return t.serialize(); }), lastValidBlockHeight: b.lastValidBlockHeight }); }
    console.log('holder', k.publicKey.toBase58(), (await T.tokenBalance({ rpc, owner: k.publicKey, mint })).toFixed(0)); } }
const [B, C] = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F)).map((s) => Keypair.fromSecretKey(Uint8Array.from(s))) : [];
if (cmd === 'apply') { const ts = Date.now(), plan = 'I will run socials daily and organise a weekly community call'; console.log('apply', await post('/api/cto/apply', { mint, wallet: B.publicKey.toBase58(), ts, sig: sign(B, `treid: lead takeover — ${mint} — ${ts}\n${plan}`), plan })); }
if (cmd === 'vote') { const ts = Date.now(), ap = B.publicKey.toBase58(); console.log('vote', await post('/api/cto/vote', { mint, applicant: ap, wallet: C.publicKey.toBase58(), ts, sig: sign(C, `treid: support takeover by ${ap} — ${mint} — ${ts}`) })); }
if (cmd === 'lead') console.log(B.publicKey.toBase58());
