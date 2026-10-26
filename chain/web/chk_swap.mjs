import { checkSwapTx } from './src.mjs'; import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram, PublicKey, TransactionInstruction } from '@solana/web3.js';
const u = Keypair.generate(), mk = (payer, ixs) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message()).serialize();
const ok = mk(u.publicKey, [SystemProgram.transfer({ fromPubkey: u.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })]);
const evil = mk(u.publicKey, [new TransactionInstruction({ keys: [], programId: Keypair.generate().publicKey, data: Buffer.from([1]) })]);
const other = mk(Keypair.generate().publicKey, []);
for (const [n, b] of [['ok', ok], ['unknown program', evil], ['other payer', other]]) { try { checkSwapTx(b, u.publicKey.toBase58()); console.log(n, '→ allowed'); } catch (e) { console.log(n, '→ blocked:', e.message.slice(0, 50)); } }
