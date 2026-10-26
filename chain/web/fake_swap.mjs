// attack test: memo containing "Instruction: Swap" + a self token transfer, touching the ops wallet — must NOT be recorded as a trade
import { Keypair, Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
const conn = new Connection('http://127.0.0.1:8899', 'confirmed'), [ops] = process.argv.slice(2), atk = Keypair.generate();
await conn.confirmTransaction(await conn.requestAirdrop(atk.publicKey, 1e9));
const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: atk.publicKey, toPubkey: new PublicKey(ops), lamports: 1000 }), new TransactionInstruction({ keys: [], programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Buffer.from('Program log: Instruction: Swap') }));
console.log('fake swap sent', (await sendAndConfirmTransaction(conn, tx, [atk])).slice(0, 10), atk.publicKey.toBase58());
