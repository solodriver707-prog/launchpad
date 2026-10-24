// treid ops wallet (hot): fee claimer + Token-2022 withheld authority of every new treid coin.
// Every cycle: claim trading fees, harvest the coin tax, split it (holders / burn / dev) and sweep spare SOL to the treasury.
import { Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, unpackAccount, getTransferFeeAmount, withdrawWithheldTokensFromAccounts, withdrawWithheldTokensFromMint, harvestWithheldTokensToMint,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, createBurnCheckedInstruction, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';

import { createHash } from 'node:crypto';
// OPS_SECRET can be a keypair (JSON array / base58) or any random string (e.g. Render's generateValue) → used as a seed
export function opsKeypair(secret) {
  if (!secret) return null; const s = secret.trim();
  if (s.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  try { const b = bs58.decode(s); if (b.length === 64) return Keypair.fromSecretKey(b); } catch {}
  return Keypair.fromSeed(createHash('sha256').update('treid-ops:' + s).digest());
}
const DEC = 6, SUPPLY = 1e9, MIN_HARVEST = 50_000 * 10 ** DEC;   // don't bother below 0.005% of supply
const parseSplit = (uri) => { try { const s = new URL(uri).searchParams.get('s'); if (s) { const p = s.split('.').map(Number); if (p.length === 3 && p[0] + p[1] + p[2] === 100) return { h: p[0], b: p[1], d: p[2] }; } } catch {} return { h: 70, b: 20, d: 10 }; };

export function startOps({ conn, dbc, ops, treasury, q, q1, run, poolAuthority, log = console.log, everyMs = 10 * 60e3 }) {
  run(`CREATE TABLE IF NOT EXISTS payouts(id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, ts INT, harvested REAL, burned REAL, dev REAL, holders REAL, n_holders INT, fees_sol REAL)`);
  const send = (ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [ops], { commitment: 'confirmed' });
  let busy = false;
  async function claimFees() {
    let total = 0;
    for (const c of q('SELECT * FROM coins')) {
      try { const vp = (await dbc.state.getPool(new PublicKey(c.pool)))?.poolState; if (!vp) continue;
        const cfg = await dbc.state.getPoolConfig(vp.config); if (cfg.feeClaimer.toBase58() !== ops.publicKey.toBase58()) continue;
        const fee = Number(vp.partnerQuoteFee.toString()) / 1e9; if (fee < 0.005) continue;
        const tx = await dbc.partner.claimPartnerTradingFee({ pool: new PublicKey(c.pool), feeClaimer: ops.publicKey, payer: ops.publicKey, maxBaseAmount: new BN(0), maxQuoteAmount: new BN(vp.partnerQuoteFee.toString()) });
        await sendAndConfirmTransaction(conn, tx, [ops], { commitment: 'confirmed' }); total += fee; log('ops   claimed', fee.toFixed(4), 'SOL from', c.symbol);
      } catch (e) { log('ops   claim err', c.symbol, e.message.slice(0, 120)); }
    }
    return total;
  }
  async function taxCycle(c) {
    const mint = new PublicKey(c.mint), opsAta = getAssociatedTokenAddressSync(mint, ops.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const accs = (await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: c.mint } }] })).map((a) => unpackAccount(a.pubkey, a.account, TOKEN_2022_PROGRAM_ID));
    const withheld = accs.filter((a) => (getTransferFeeAmount(a)?.withheldAmount || 0n) > 0n), totalW = withheld.reduce((s, a) => s + getTransferFeeAmount(a).withheldAmount, 0n);
    if (totalW < BigInt(MIN_HARVEST)) return null;
    await send([createAssociatedTokenAccountIdempotentInstruction(ops.publicKey, opsAta, ops.publicKey, mint, TOKEN_2022_PROGRAM_ID)]);
    const before = (await getAccount(conn, opsAta, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount;
    for (let i = 0; i < withheld.length; i += 20) await withdrawWithheldTokensFromAccounts(conn, ops, mint, opsAta, ops, [], withheld.slice(i, i + 20).map((a) => a.address), { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
    const got = (await getAccount(conn, opsAta, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount - before; if (got <= 0n) return null;
    const sp = parseSplit(c.uri), burnAmt = got * BigInt(sp.b) / 100n, devAmt = got * BigInt(sp.d) / 100n, holdAmt = got - burnAmt - devAmt;
    if (burnAmt > 0n) await send([createBurnCheckedInstruction(opsAta, mint, ops.publicKey, burnAmt, DEC, [], TOKEN_2022_PROGRAM_ID)]);
    if (devAmt > 0n) { const devAta = getAssociatedTokenAddressSync(mint, new PublicKey(c.creator), false, TOKEN_2022_PROGRAM_ID);
      await send([createAssociatedTokenAccountIdempotentInstruction(ops.publicKey, devAta, new PublicKey(c.creator), mint, TOKEN_2022_PROGRAM_ID), createTransferCheckedInstruction(opsAta, mint, devAta, ops.publicKey, devAmt, DEC, [], TOKEN_2022_PROGRAM_ID)]); }
    // holders: pro-rata to every real holder (not the curve vault, not ops, not the dev who already got the dev share)
    const skip = new Set([poolAuthority, ops.publicKey.toBase58(), c.creator]);
    const hs = accs.filter((a) => a.amount > 0n && !skip.has(a.owner.toBase58())), held = hs.reduce((s, a) => s + a.amount, 0n);
    let paid = 0n, n = 0;
    if (holdAmt > 0n && held > 0n) {
      const shares = hs.map((a) => ({ to: a.address, amt: holdAmt * a.amount / held })).filter((x) => x.amt >= 1000n);   // skip dust
      for (let i = 0; i < shares.length; i += 8) { const batch = shares.slice(i, i + 8);
        await send(batch.map((x) => createTransferCheckedInstruction(opsAta, mint, x.to, ops.publicKey, x.amt, DEC, [], TOKEN_2022_PROGRAM_ID))); paid += batch.reduce((s, x) => s + x.amt, 0n); n += batch.length; }
    }
    const left = holdAmt - paid; if (left > 0n) await send([createBurnCheckedInstruction(opsAta, mint, ops.publicKey, left, DEC, [], TOKEN_2022_PROGRAM_ID)]);   // nobody to pay → burn it
    const f = (x) => Number(x) / 10 ** DEC;
    run('INSERT INTO payouts(mint,ts,harvested,burned,dev,holders,n_holders,fees_sol) VALUES(?,?,?,?,?,?,?,0)', c.mint, Date.now(), f(got), f(burnAmt + left), f(devAmt), f(paid), n);
    log('ops   tax', c.symbol, 'harvested', f(got).toFixed(0), 'burn', f(burnAmt + left).toFixed(0), 'dev', f(devAmt).toFixed(0), 'holders', f(paid).toFixed(0), 'to', n);
    return { got: f(got) };
  }
  async function sweep() {
    const bal = await conn.getBalance(ops.publicKey), keep = 0.2e9;
    if (treasury && bal > keep + 0.1e9) { const amt = bal - keep; await send([SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: new PublicKey(treasury), lamports: amt })]); log('ops   swept', (amt / 1e9).toFixed(4), 'SOL to treasury'); }
  }
  async function cycle() {
    if (busy) return; busy = true;
    try { await claimFees();
      for (const c of q('SELECT * FROM coins WHERE tax_bps > 0')) { try { const cfg = await dbc.state.getPoolConfig(new PublicKey(c.config)); if (cfg.feeClaimer.toBase58() === ops.publicKey.toBase58()) await taxCycle(c); } catch (e) { log('ops   tax err', c.symbol, e.message.slice(0, 140)); } }
      await sweep();
    } catch (e) { log('ops   cycle err', e.message); } finally { busy = false; }
  }
  setTimeout(cycle, 30e3); setInterval(cycle, everyMs);
  return { cycle };
}
