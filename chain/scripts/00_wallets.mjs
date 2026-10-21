import { key, sol, airdrop } from './common.mjs';
const treid = key('treid'), dev = key('dev'), buyer = key('buyer');
for (const [n, k] of [['treid', treid], ['dev', dev], ['buyer', buyer]]) {
  let b = await sol(k.publicKey);
  if (b < 1) { await airdrop(k.publicKey, 50); b = await sol(k.publicKey); }
  console.log(n.padEnd(6), k.publicKey.toBase58(), b, 'SOL');
}
