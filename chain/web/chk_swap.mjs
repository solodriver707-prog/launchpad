import { checkSwapTx } from './src.mjs'; import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram, PublicKey, TransactionInstruction } from '@solana/web3.js';
const u = Keypair.generate(), mk = (payer, ixs) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message()).serialize();
const { getAssociatedTokenAddressSync, NATIVE_MINT } = await import('@solana/spl-token'); const ok = mk(u.publicKey, [SystemProgram.transfer({ fromPubkey: u.publicKey, toPubkey: getAssociatedTokenAddressSync(NATIVE_MINT, u.publicKey, true), lamports: 1 })]);
const thief = mk(u.publicKey, [SystemProgram.transfer({ fromPubkey: u.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })]);
const evil = mk(u.publicKey, [new TransactionInstruction({ keys: [], programId: Keypair.generate().publicKey, data: Buffer.from([1]) })]);
const other = mk(Keypair.generate().publicKey, []);
for (const [n, b] of [["wrap own SOL", ok], ["send SOL to stranger", thief], ["unknown program", evil], ["other payer", other]]) { try { await checkSwapTx(b, u.publicKey.toBase58(), "http://127.0.0.1:8899"); console.log(n, '→ allowed'); } catch (e) { console.log(n, '→ blocked:', e.message.slice(0, 50)); } }
