import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction, PublicKey } from '@solana/web3.js';
import fs from 'fs';
export const RPC = process.env.RPC || 'https://api.devnet.solana.com';
export const conn = new Connection(RPC, 'confirmed');
export function key(name) {
  const p = new URL(`../keys/${name}.json`, import.meta.url);
  if (fs.existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p))));
  const k = Keypair.generate(); fs.writeFileSync(p, JSON.stringify(Array.from(k.secretKey))); return k;
}
export const sol = async (pk) => (await conn.getBalance(pk)) / LAMPORTS_PER_SOL;
export async function airdrop(pk, amt = 2) {
  try { const sig = await conn.requestAirdrop(pk, amt * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, 'confirmed'); return true; }
  catch (e) { console.log('airdrop failed:', e.message.slice(0, 160)); return false; }
}
export async function fund(from, to, amt) {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: Math.round(amt * LAMPORTS_PER_SOL) }));
  return sendAndConfirmTransaction(conn, tx, [from]);
}
export async function send(tx, signers) {
  tx.feePayer = tx.feePayer || signers[0].publicKey;
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  return sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed', skipPreflight: false });
}
export const ex = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`;
export const exa = (a) => `https://explorer.solana.com/address/${a}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`;
export const state = { load() { try { return JSON.parse(fs.readFileSync(new URL('../keys/state.json', import.meta.url))); } catch { return {}; } }, save(o) { fs.writeFileSync(new URL('../keys/state.json', import.meta.url), JSON.stringify(o, null, 2)); } };
