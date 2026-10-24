// local test signer: holds a funded keypair, signs txs posted by the fake browser wallet
import http from 'node:http'; import { Keypair, Transaction, Connection } from '@solana/web3.js'; import fs from 'fs';
const conn = new Connection('http://127.0.0.1:8899', 'confirmed'), kp = Keypair.generate();
await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 20e9));
fs.writeFileSync(process.argv[2] || 'signer.addr', kp.publicKey.toBase58());
http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
  res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', '*'); if (req.method === 'OPTIONS') return res.end();
  try { const list = JSON.parse(b).map(x => { const t = Transaction.from(Buffer.from(x, 'base64')); t.partialSign(kp); return t.serialize({ requireAllSignatures: false }).toString('base64'); }); res.end(JSON.stringify(list)); } catch (e) { res.statusCode = 500; res.end(e.message); } }); }).listen(8790, () => console.log('signer', kp.publicKey.toBase58()));
