// shared transaction helper for the ops wallet: optional priority fee, and "did it land?" checks on timeouts
import { Transaction, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

export const PRIO = Math.max(0, +(process.env.OPS_PRIORITY_MICROLAMPORTS || 0));   // e.g. 20000 on mainnet (~0.000004 SOL per tx at 200k CU)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fetchT = (url, opts = {}, ms = 8000) => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });   // every outbound call has a timeout

// send + confirm; if confirmation times out, look the signature up before reporting failure (a "failed" send that actually
// landed must never be retried blindly — that's how double payments happen)
export async function sendTx(conn, txOrIxs, signers) {
  const tx = Array.isArray(txOrIxs) ? new Transaction().add(...txOrIxs) : txOrIxs;
  if (PRIO > 0 && !tx.instructions.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId))) tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIO }));
  try { return await sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed', maxRetries: 3 }); }
  catch (e) {
    const sig = e.signature || (tx.signature ? bs58.encode(tx.signature) : null); if (!sig) throw e;
    for (let i = 0; i < 4; i++) { await sleep(2500); const st = (await conn.getSignatureStatus(sig, { searchTransactionHistory: true }).catch(() => null))?.value;
      if (st?.err) throw e; if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig; }
    const err = new Error('unconfirmed: ' + e.message); err.signature = sig; err.unconfirmed = true; throw err;   // caller tracks it as pending
  }
}
// read a confirmed tx, retrying while the RPC catches up
export async function getTxRetry(conn, sig, tries = 6) {
  for (let i = 0; i < tries; i++) { const t = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null); if (t) return t; await sleep(1500 * (i + 1)); }
  return null;
}
