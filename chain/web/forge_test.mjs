// attack test: a stranger sends a forged treid:cto memo to the ops wallet — must be ignored on rebuild
import { Keypair, Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
const conn = new Connection('http://127.0.0.1:8899', 'confirmed'), [ops, mint] = process.argv.slice(2), atk = Keypair.generate();
await conn.confirmTransaction(await conn.requestAirdrop(atk.publicKey, 1e9));
const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: atk.publicKey, toPubkey: new PublicKey(ops), lamports: 1000 }), new TransactionInstruction({ keys: [], programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Buffer.from(`treid:cto:${mint}:0:${atk.publicKey.toBase58()}`) }));
console.log('forged memo sent', await sendAndConfirmTransaction(conn, tx, [atk]), 'attacker', atk.publicKey.toBase58());
