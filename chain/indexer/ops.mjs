// treid ops wallet (hot): fee claimer + Token-2022 withheld authority of every new treid coin.
// Every cycle: claim trading fees, harvest the coin tax, split it (holders / burn / dev) and sweep spare SOL to the treasury.
import { Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, unpackAccount, getTransferFeeAmount, withdrawWithheldTokensFromAccounts, withdrawWithheldTokensFromMint, harvestWithheldTokensToMint,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, createBurnCheckedInstruction, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import { withLock } from './lock.mjs';

import { createHash } from 'node:crypto';
// OPS_SECRET can be a keypair (JSON array / base58) or any random string (e.g. Render's generateValue) → used as a seed
export function opsKeypair(secret) {
  if (!secret) return null; const s = secret.trim();
  if (s.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  try { const b = bs58.decode(s); if (b.length === 64) return Keypair.fromSecretKey(b); } catch {}
  return Keypair.fromSeed(createHash('sha256').update('treid-ops:' + s).digest());
}
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), memoIx = (t) => new TransactionInstruction({ keys: [], programId: MEMO, data: Buffer.from(t) });
const DEC = 6, SUPPLY = 1e9, MIN_HARVEST = 50_000 * 10 ** DEC;   // don't bother below 0.005% of supply
const parseSplit = (uri) => { try { const s = new URL(uri).searchParams.get('s'); if (s) { const p = s.split('.').map(Number); if (p.length === 3 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 100) && p[0] + p[1] + p[2] === 100) return { h: p[0], b: p[1], d: p[2] }; } } catch {} return { h: 70, b: 20, d: 10 }; };

export function startOps({ conn, dbc, ops, treasury, q, q1, run, quoteUsd = () => 150, poolAuthority, log = console.log, everyMs = 10 * 60e3, liabilities = () => 0, devState = (c) => ({ state: 'active', creator: c.creator }) }) {
  run(`CREATE TABLE IF NOT EXISTS payouts(id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, ts INT, harvested REAL, burned REAL, dev REAL, holders REAL, n_holders INT, fees_sol REAL)`);
  const send = (ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [ops], { commitment: 'confirmed' });
  let busy = false;
  async function claimFees() {
    let total = 0;
    for (const c of q('SELECT * FROM coins')) {
      try { const vp = (await dbc.state.getPool(new PublicKey(c.pool)))?.poolState; if (!vp) continue;
        const cfg = await dbc.state.getPoolConfig(vp.config); if (cfg.feeClaimer.toBase58() !== ops.publicKey.toBase58()) continue;
        const fee = Number(vp.partnerQuoteFee.toString()) / 10 ** (c.quote_dec ?? 9); if (fee * (quoteUsd(c) || 0) < 0.5) continue;   // claim from $0.50
        const tx = await dbc.partner.claimPartnerTradingFeeToReceiver({ pool: new PublicKey(c.pool), feeClaimer: ops.publicKey, payer: ops.publicKey, maxBaseAmount: new BN(0), maxQuoteAmount: new BN(vp.partnerQuoteFee.toString()), receiver: new PublicKey(treasury) });   // straight to the treasury, any pair token
        await sendAndConfirmTransaction(conn, tx, [ops], { commitment: 'confirmed' }); total += fee; log('ops   claimed', fee.toFixed(4), c.quote_symbol || 'SOL', 'from', c.symbol, '→ treasury');
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
    let devBurn = false, devTo = c.creator; try { const ds = devState(c); devBurn = ds.era === 'out' || ds.state !== 'active'; devTo = ds.creator || c.creator; } catch {}   // CTO lead gets the tax share while in charge
    if (devAmt > 0n && devBurn) await send([createBurnCheckedInstruction(opsAta, mint, ops.publicKey, devAmt, DEC, [], TOKEN_2022_PROGRAM_ID)]);   // creator paused / out → their tax share is burned
    if (devAmt > 0n && !devBurn) { const devAta = getAssociatedTokenAddressSync(mint, new PublicKey(devTo), false, TOKEN_2022_PROGRAM_ID);
      await send([createAssociatedTokenAccountIdempotentInstruction(ops.publicKey, devAta, new PublicKey(devTo), mint, TOKEN_2022_PROGRAM_ID), createTransferCheckedInstruction(opsAta, mint, devAta, ops.publicKey, devAmt, DEC, [], TOKEN_2022_PROGRAM_ID)]); }
    // holders: pro-rata to every real holder (not the curve vault, not ops, not the dev who already got the dev share)
    const skip = new Set([poolAuthority, ops.publicKey.toBase58(), c.creator, devTo]);
    const hs = accs.filter((a) => a.amount > 0n && !skip.has(a.owner.toBase58()) && PublicKey.isOnCurve(a.owner.toBytes())), held = hs.reduce((s, a) => s + a.amount, 0n);   // PDAs (pool vaults after migration, programs) are not holders
    let paid = 0n, n = 0;
    if (holdAmt > 0n && held > 0n) {
      const shares = hs.map((a) => ({ to: a.address, amt: holdAmt * a.amount / held })).filter((x) => x.amt >= 1000n);   // skip dust
      const ix = (x) => createTransferCheckedInstruction(opsAta, mint, x.to, ops.publicKey, x.amt, DEC, [], TOKEN_2022_PROGRAM_ID);
      for (let i = 0; i < shares.length; i += 8) { const batch = shares.slice(i, i + 8);
        try { await send(batch.map(ix)); paid += batch.reduce((s, x) => s + x.amt, 0n); n += batch.length; }
        catch { for (const x of batch) { try { await send([ix(x)]); paid += x.amt; n++; } catch (e) { log('ops   skip holder', x.to.toBase58().slice(0, 6), e.message.slice(0, 60)); } } } }   // one bad account never blocks the rest
    }
    const left = holdAmt - paid; if (left > 0n) await send([createBurnCheckedInstruction(opsAta, mint, ops.publicKey, left, DEC, [], TOKEN_2022_PROGRAM_ID)]);   // nobody to pay → burn it
    const f = (x) => Number(x) / 10 ** DEC, burnTot = burnAmt + left + (devBurn ? devAmt : 0n), devPaid = devBurn ? 0n : devAmt;
    // permanent on-chain receipt of this cycle → the payout history survives any server restart (rebuilt from the ops wallet's memos)
    const items = [['taxburn', burnTot, null], ['taxdev', devPaid, devBurn ? null : devTo], ['taxhold', paid, String(n)]];
    try { const sg = await send(items.map(([k, a, x]) => memoIx(`treid:${k}:${c.mint}:${a}` + (x ? ':' + x : ''))));
      items.forEach(([k, a, x], i) => { try { run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', sg, i, c.mint, k, Number(a), Date.now(), x); } catch {} }); } catch (e) { log('ops   receipt err', e.message.slice(0, 100)); }
    run('INSERT INTO payouts(mint,ts,harvested,burned,dev,holders,n_holders,fees_sol) VALUES(?,?,?,?,?,?,?,0)', c.mint, Date.now(), f(got), f(burnAmt + left + (devBurn ? devAmt : 0n)), f(devBurn ? 0n : devAmt), f(paid), n);
    log('ops   tax', c.symbol, 'harvested', f(got).toFixed(0), 'burn', f(burnAmt + left + (devBurn ? devAmt : 0n)).toFixed(0), 'dev', (devBurn ? 'burned (creator not active)' : f(devAmt).toFixed(0)), 'holders', f(paid).toFixed(0), 'to', n);
    return { got: f(got) };
  }
  async function sweep() {
    const bal = await conn.getBalance(ops.publicKey), keep = 0.2e9 + liabilities();   // never sweep takeover funds held for communities
    if (treasury && bal > keep + 0.1e9) { const amt = bal - keep; await send([SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: new PublicKey(treasury), lamports: amt })]); log('ops   swept', (amt / 1e9).toFixed(4), 'SOL to treasury'); }
  }
  async function cycle() {
    if (busy) return; busy = true;
    try { await claimFees();
      for (const c of q('SELECT * FROM coins WHERE tax_bps > 0')) { try { const cfg = await dbc.state.getPoolConfig(new PublicKey(c.config)); if (cfg.feeClaimer.toBase58() === ops.publicKey.toBase58()) await taxCycle(c); } catch (e) { log('ops   tax err', c.symbol, e.message.slice(0, 140)); } }
      await sweep();
    } catch (e) { log('ops   cycle err', e.message); } finally { busy = false; }
  }
  const locked = () => withLock(cycle); setTimeout(locked, 30e3); setInterval(locked, everyMs);
  return { cycle };
}
