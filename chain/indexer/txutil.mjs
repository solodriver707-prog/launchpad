// shared transaction helper for the ops wallet: optional priority fee, and "did it land?" checks on timeouts
import { Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import bs58 from 'bs58';

export const PRIO = Math.max(0, +(process.env.OPS_PRIORITY_MICROLAMPORTS || 0));   // e.g. 20000 on mainnet (~0.000004 SOL per tx at 200k CU)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Jupiter: api.jup.ag with a (free) key when JUP_API_KEY is set; the older lite-api host otherwise (being retired)
export const JUP = process.env.JUP_API_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag';
export const fetchT = (url, opts = {}, ms = 8000) => { const h = { ...(opts.headers || {}) }; if (process.env.JUP_API_KEY && String(url).startsWith('https://api.jup.ag')) h['x-api-key'] = process.env.JUP_API_KEY;
  return fetch(url, { ...opts, headers: h, signal: AbortSignal.timeout(ms) }); };   // every outbound call has a timeout

// send + confirm; if confirmation times out, look the signature up before reporting failure (a "failed" send that actually
// landed must never be retried blindly — that's how double payments happen)
export async function sendTx(conn, txOrIxs, signers) {
  const tx = Array.isArray(txOrIxs) ? new Transaction().add(...txOrIxs) : txOrIxs;
  if (PRIO > 0 && !tx.instructions.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId))) {
    // the priority fee is charged on the compute LIMIT, and the default limit is 200k CU per instruction (up to 1.4M):
    // measure what the tx really uses and ask for just that (+15%), so a 40k-CU transfer never pays for 1.4M
    let limit = 1_400_000;
    try { tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: limit })); const sim = await conn.simulateTransaction(tx, signers);
      if (!sim.value.err && sim.value.unitsConsumed) limit = Math.min(1_400_000, Math.ceil(sim.value.unitsConsumed * 1.15) + 2000); tx.instructions.shift(); }
    catch { if (tx.instructions[0]?.programId.equals(ComputeBudgetProgram.programId)) tx.instructions.shift(); }
    tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: limit }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIO }));
    try { tx.feePayer = tx.feePayer || signers[0].publicKey; if (!tx.recentBlockhash) tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      if (tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length > 1232) tx.instructions.splice(0, 2); } catch { tx.instructions.splice(0, 2); }   // a tx already at the size limit goes without a priority fee
    tx.signatures = []; }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash; tx.feePayer = tx.feePayer || signers[0].publicKey; tx.signatures = []; tx.sign(...signers);
  return landOrExpire(conn, tx.serialize(), bs58.encode(tx.signature), lastValidBlockHeight);
}
// send a signed transaction and keep re-broadcasting it until it is CONFIRMED, or until its blockhash has expired (then it can never land).
// Only then is the answer final — a send that "failed" but could still land is never reported as failed (that's how double payments happen).
// If the RPC can't be reached at all, the result stays unknown → err.unconfirmed (the caller keeps it as pending).
export async function landOrExpire(conn, raw, sig, lastValidBlockHeight) {
  const send = () => conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => null);
  let first; try { await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }); } catch (e) {
    const m = String(e?.message || e); if (/simulation failed|custom program error|insufficient|InstructionError/i.test(m) && !/blockhash not found/i.test(m)) throw e;   // preflight says it would fail: nothing was sent
    first = e; }
  let reachable = false;
  for (let i = 0; i < 120; i++) {
    const st = (await conn.getSignatureStatus(sig, { searchTransactionHistory: true }).catch(() => null))?.value; if (st !== undefined) reachable = true;
    if (st?.err) { const e = new Error('transaction failed: ' + JSON.stringify(st.err)); e.signature = sig; throw e; }
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    const h = await conn.getBlockHeight('confirmed').catch(() => null);
    if (h != null && h > lastValidBlockHeight + 5) {   // expired: one last look (it may have landed in the final blocks)
      const st2 = (await conn.getSignatureStatus(sig, { searchTransactionHistory: true }).catch(() => null))?.value;
      if (st2 && !st2.err && st2.confirmationStatus) return sig;
      const e = new Error('expired: ' + (first ? String(first.message || first).slice(0, 120) : 'not confirmed in time')); e.signature = sig; e.expired = true; throw e; }
    if (i % 2 === 1) send(); await sleep(2000);
  }
  const err = new Error('unconfirmed: RPC unreachable'); err.signature = sig; err.unconfirmed = true; err.reachable = reachable; throw err;
}
// read a confirmed tx, retrying while the RPC catches up
export async function getTxRetry(conn, sig, tries = 6) {
  for (let i = 0; i < tries; i++) { const t = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null); if (t) return t; await sleep(1500 * (i + 1)); }
  return null;
}
