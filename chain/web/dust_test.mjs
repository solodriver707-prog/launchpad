// attack test: give the creator a SECOND Token-2022 account holding 1 raw unit — must NOT make the creator look like they sold everything
import { Keypair, Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAccountLenForMint, getMint, createInitializeAccount3Instruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, ExtensionType, getAccountLen } from '@solana/spl-token';
const conn = new Connection('http://127.0.0.1:8899', 'confirmed'), [mintS, creatorS, buyerSecret] = process.argv.slice(2), mint = new PublicKey(mintS), creator = new PublicKey(creatorS);
const atk = Keypair.generate(); await conn.confirmTransaction(await conn.requestAirdrop(atk.publicKey, 1e9));
const mi = await getMint(conn, mint, 'confirmed', TOKEN_2022_PROGRAM_ID), len = getAccountLenForMint(mi), acct = Keypair.generate();
const tx = new Transaction().add(SystemProgram.createAccount({ fromPubkey: atk.publicKey, newAccountPubkey: acct.publicKey, space: len, lamports: await conn.getMinimumBalanceForRentExemption(len), programId: TOKEN_2022_PROGRAM_ID }), createInitializeAccount3Instruction(acct.publicKey, mint, creator, TOKEN_2022_PROGRAM_ID));
await sendAndConfirmTransaction(conn, tx, [atk, acct]); console.log('dust account for creator created', acct.publicKey.toBase58().slice(0, 8));
// attacker buys a little, then sends 1 raw unit into the creator's second account
import * as T from './src.mjs';
const pool = (await (await import('@meteora-ag/dynamic-bonding-curve-sdk')).DynamicBondingCurveClient.prototype.constructor && null);
const b = await T.buildSwap({ rpc: 'http://127.0.0.1:8899', owner: atk.publicKey.toBase58(), pool: process.argv[5], side: 'buy', amount: 0.05 });
await T.sendAll({ rpc: 'http://127.0.0.1:8899', signed: b.bytes.map((x) => { const t = Transaction.from(x); t.partialSign(atk); return t.serialize(); }), lastValidBlockHeight: b.lastValidBlockHeight });
const src = getAssociatedTokenAddressSync(mint, atk.publicKey, false, TOKEN_2022_PROGRAM_ID);
await sendAndConfirmTransaction(conn, new Transaction().add(createTransferCheckedInstruction(src, mint, acct.publicKey, atk.publicKey, 1n, 6, [], TOKEN_2022_PROGRAM_ID)), [atk]); console.log('sent 1 raw unit into it');
