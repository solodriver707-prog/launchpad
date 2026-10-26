// treid ops wallet (hot): fee claimer + Token-2022 withheld-tax authority of every treid coin.
// It only works on coins where something happened (trades since the last look), so cost and RPC use follow real activity:
//   · partner fees → claimed straight to the treasury once they're worth ≥ $1
//   · coin tax → harvested once it's worth ≥ $5 (at most hourly per coin), split holders / burn / dev, receipts on-chain
//   · spare SOL → swept to the treasury (never what's owed to creators mid-payout)
import { Keypair, PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, unpackAccount, getTransferFeeAmount, getMint, getTransferFeeConfig, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, createBurnCheckedInstruction, createCloseAccountInstruction, createWithdrawWithheldTokensFromAccountsInstruction, createWithdrawWithheldTokensFromMintInstruction, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import BN from 'bn.js';
import { createHash } from 'node:crypto';
import { withLock } from './lock.mjs';
import { sendTx } from './txutil.mjs';

// OPS_SECRET: a real keypair (JSON array or base58). A plain string is accepted ONLY off mainnet (seeded key, for dev/test).
export function opsKeypair(secret, { mainnet = false } = {}) {
  if (!secret) return null; const s = secret.trim();
  if (s.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  try { const b = bs58.decode(s); if (b.length === 64) return Keypair.fromSecretKey(b); } catch {}
  if (mainnet) throw new Error('OPS_SECRET must be a full 64-byte keypair on mainnet (generated offline and backed up)');
  return Keypair.fromSeed(createHash('sha256').update('treid-ops:' + s).digest());
}
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), memoIx = (t) => new TransactionInstruction({ keys: [], programId: MEMO, data: Buffer.from(t) });
const WSOL = 'So11111111111111111111111111111111111111112', START = Date.now() - 7 * 864e5;   // after a restart: re-check fees of coins traded in the last week
const DEC = 6, HARVEST_USD = 5, SHARE_USD = 0.05, FEE_USD = 1, MAX_ACCTS = 200;
const parseSplit = (uri) => { try { const s = new URL(uri).searchParams.get('s'); if (s) { const p = s.split('.').map(Number); if (p.length === 3 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 100) && p[0] + p[1] + p[2] === 100) return { h: p[0], b: p[1], d: p[2] }; } } catch {} return { h: 70, b: 20, d: 10 }; };

export function startOps({ conn, dbc, ops, treasury, q, q1, run, quoteUsd = () => 150, poolAuthority, log = console.log, everyMs = 10 * 60e3, liabilities = () => 0, devState = (c) => ({ state: 'active', creator: c.creator }), ready = () => true }) {
  const send = (ixs) => sendTx(conn, ixs, [ops]);
  const lastTradeTs = (mint) => q1('SELECT MAX(ts) t FROM trades WHERE mint=?', mint)?.t || 0;
  const lastPx = (mint) => q1('SELECT price_usd FROM trades WHERE mint=? ORDER BY ts DESC LIMIT 1', mint)?.price_usd || 0;
  const seenFee = new Map(), seenTax = new Map();   // when each coin was last looked at

  async function claimFees() {
    for (const c of q('SELECT * FROM coins')) {
      const lt = lastTradeTs(c.mint), ls = seenFee.get(c.mint) || START; if (lt <= ls) continue;   // fees only grow with trades: nothing traded since the last look → nothing to claim
      try { const vpw = await dbc.state.getPool(new PublicKey(c.pool)), vp = vpw?.poolState || vpw; if (!vp) continue;
        if (c.config) { const cfg = await dbc.state.getPoolConfig(vp.config); if (cfg.feeClaimer.toBase58() !== ops.publicKey.toBase58()) { seenFee.set(c.mint, Date.now()); continue; } }
        const fee = Number(vp.partnerQuoteFee.toString()) / 10 ** (c.quote_dec ?? 9); if (fee * (quoteUsd(c) || 0) < FEE_USD) { seenFee.set(c.mint, Date.now()); continue; }
        // claimed INTO ops (a claim "to the treasury" would open a coin account for the treasury and pay its rent, for every coin), then:
        // SOL → the sweep forwards it; other pair tokens → passed on to the treasury in the same transaction, exact amount
        const amt = BigInt(vp.partnerQuoteFee.toString()), mint = new PublicKey(c.mint), tx = await dbc.partner.claimPartnerTradingFeeToReceiver({ pool: new PublicKey(c.pool), feeClaimer: ops.publicKey, payer: ops.publicKey, maxBaseAmount: new BN(0), maxQuoteAmount: new BN(amt.toString()), receiver: ops.publicKey });
        const qm = new PublicKey(c.quote_mint || WSOL); if (!qm.equals(new PublicKey(WSOL))) { const qprog = (await conn.getAccountInfo(qm)).owner, dst = getAssociatedTokenAddressSync(qm, new PublicKey(treasury), true, qprog);
          tx.add(createAssociatedTokenAccountIdempotentInstruction(ops.publicKey, dst, new PublicKey(treasury), qm, qprog), createTransferCheckedInstruction(getAssociatedTokenAddressSync(qm, ops.publicKey, false, qprog), qm, dst, ops.publicKey, amt, c.quote_dec ?? 6, [], qprog)); }
        const ata = getAssociatedTokenAddressSync(mint, ops.publicKey, false, TOKEN_2022_PROGRAM_ID), ai = await conn.getAccountInfo(ata); let closeOk = !ai;
        if (ai) { try { const a = unpackAccount(ata, ai, TOKEN_2022_PROGRAM_ID); closeOk = a.amount === 0n && !(getTransferFeeAmount(a)?.withheldAmount > 0n); } catch {} }
        if (closeOk) tx.add(createCloseAccountInstruction(ata, ops.publicKey, ops.publicKey, [], TOKEN_2022_PROGRAM_ID));   // the claim opens ops' coin account; close it again, rent back
        tx.add(memoIx(`treid:pfee:${c.mint}:${amt}`));
        await send(tx); seenFee.set(c.mint, Date.now()); log('ops   claimed', fee.toFixed(4), c.quote_symbol || 'SOL', 'from', c.symbol, '→ treasury');
      } catch (e) { log('ops   claim err', c.symbol, e.message.slice(0, 120)); }
    }
  }
  async function taxCycle(c) {
    const mint = new PublicKey(c.mint), opsAta = getAssociatedTokenAddressSync(mint, ops.publicKey, false, TOKEN_2022_PROGRAM_ID), px = lastPx(c.mint);
    if (!(px > 0)) return null;
    const accs = (await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: c.mint } }] })).map((a) => { try { return unpackAccount(a.pubkey, a.account, TOKEN_2022_PROGRAM_ID); } catch { return null; } }).filter(Boolean);
    const wa = (a) => getTransferFeeAmount(a)?.withheldAmount || 0n, withheld = accs.filter((a) => wa(a) > 0n).sort((x, y) => (wa(y) > wa(x) ? 1 : -1)).slice(0, MAX_ACCTS);
    const mintInfo = await getMint(conn, mint, 'confirmed', TOKEN_2022_PROGRAM_ID), inMint = getTransferFeeConfig(mintInfo)?.withheldAmount || 0n;   // tax anyone "harvested to the mint" is collected too
    const opsAcc = accs.find((a) => a.address.equals(opsAta)), stranded = opsAcc ? opsAcc.amount : 0n;   // tokens left in ops from an interrupted cycle are distributed now
    const total = withheld.reduce((s, a) => s + wa(a), 0n) + inMint + stranded;
    if (Number(total) / 10 ** DEC * px < HARVEST_USD) return null;   // not worth the transactions yet
    if (!opsAcc) await send([createAssociatedTokenAccountIdempotentInstruction(ops.publicKey, opsAta, ops.publicKey, mint, TOKEN_2022_PROGRAM_ID)]);
    for (let i = 0; i < withheld.length; i += 24) await send([createWithdrawWithheldTokensFromAccountsInstruction(mint, opsAta, ops.publicKey, [], withheld.slice(i, i + 24).map((a) => a.address), TOKEN_2022_PROGRAM_ID)]);   // 24 accounts per tx (size limit)
    if (inMint > 0n) await send([createWithdrawWithheldTokensFromMintInstruction(mint, opsAta, ops.publicKey, [], TOKEN_2022_PROGRAM_ID)]);
    const got = (await getAccount(conn, opsAta, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount; if (got <= 0n) return null;   // the WHOLE balance: harvest + anything stranded earlier
    const sp = parseSplit(c.uri), burnAmt = got * BigInt(sp.b) / 100n, devAmt = got * BigInt(sp.d) / 100n, holdAmt = got - burnAmt - devAmt;
    let devBurn = false, devTo = c.creator; try { const ds = devState(c); devBurn = ds.era === 'out' || ds.state !== 'active'; devTo = ds.creator || c.creator; } catch {}
    if (devAmt > 0n && !devBurn) { const devAta = getAssociatedTokenAddressSync(mint, new PublicKey(devTo), false, TOKEN_2022_PROGRAM_ID); if (!(await conn.getAccountInfo(devAta))) devBurn = true;   // ops never opens accounts for others
      else await send([createTransferCheckedInstruction(opsAta, mint, devAta, ops.publicKey, devAmt, DEC, [], TOKEN_2022_PROGRAM_ID)]); }
    // holders: the biggest 200 real wallets (never the curve, pools/PDAs, ops or the dev), shares worth ≥ $0.05
    const skip = new Set([poolAuthority, ops.publicKey.toBase58(), c.creator, devTo]), byOwner = new Map();
    for (const a of accs) { const o = a.owner.toBase58(); if (a.amount <= 0n || skip.has(o) || !PublicKey.isOnCurve(a.owner.toBytes())) continue; const e = byOwner.get(o) || { to: a.address, big: 0n, total: 0n }; e.total += a.amount; if (a.amount > e.big) { e.big = a.amount; e.to = a.address; } byOwner.set(o, e); }   // one share per wallet, paid into its biggest account
    const hs = [...byOwner.values()].sort((x, y) => (y.total > x.total ? 1 : -1)).slice(0, MAX_ACCTS), held = hs.reduce((s, a) => s + a.total, 0n), minAmt = BigInt(Math.ceil(SHARE_USD / px * 10 ** DEC));
    let paid = 0n, n = 0, aborted = false;
    if (holdAmt > 0n && held > 0n) {
      const shares = hs.map((a) => ({ to: a.to, amt: holdAmt * a.total / held })).filter((x) => x.amt >= minAmt), ix = (x) => createTransferCheckedInstruction(opsAta, mint, x.to, ops.publicKey, x.amt, DEC, [], TOKEN_2022_PROGRAM_ID);
      for (let i = 0; i < shares.length; i += 16) { const batch = shares.slice(i, i + 16);   // 16 transfers per tx (fits the size limit with the compute budget)
        try { await send(batch.map(ix)); paid += batch.reduce((s, x) => s + x.amt, 0n); n += batch.length; }
        catch (e) { if (e.unconfirmed) { aborted = true; log('ops   batch unconfirmed — stopping, next cycle redistributes what is left', c.symbol); break; }   // never resend a batch that may have landed
          for (const x of batch) { try { await send([ix(x)]); paid += x.amt; n++; } catch (e2) { if (e2.unconfirmed) { aborted = true; break; } log('ops   skip holder', x.to.toBase58().slice(0, 6), e2.message.slice(0, 60)); } } } }
    }
    const now = (await getAccount(conn, opsAta, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, toBurn = aborted ? (burnAmt + (devBurn ? devAmt : 0n) < now ? burnAmt + (devBurn ? devAmt : 0n) : now) : now;   // normally everything still here (burn share + unpaid dust + inactive creator's share); after an unsure batch, only the burn part — holders get the rest next cycle
    const devPaid = devBurn ? 0n : devAmt, ixs = [];
    if (toBurn > 0n) ixs.push(createBurnCheckedInstruction(opsAta, mint, ops.publicKey, toBurn, DEC, [], TOKEN_2022_PROGRAM_ID));
    ixs.push(...[['taxburn', toBurn, null], ['taxdev', devPaid, devBurn ? null : devTo], ['taxhold', paid, String(n)]].map(([k, a, x]) => memoIx(`treid:${k}:${c.mint}:${a}` + (x ? ':' + x : ''))));
    const sg = await send(ixs);
    [['taxburn', toBurn, null], ['taxdev', devPaid, devBurn ? null : devTo], ['taxhold', paid, String(n)]].forEach(([k, a, x], i) => { try { run('INSERT OR IGNORE INTO rlog(sig,i,mint,kind,lamports,ts,extra) VALUES(?,?,?,?,?,?,?)', sg, i, c.mint, k, Number(a), Date.now(), x); } catch {} });
    try { const a = await getAccount(conn, opsAta, 'confirmed', TOKEN_2022_PROGRAM_ID); if (a.amount === 0n && !(getTransferFeeAmount(a)?.withheldAmount > 0n)) await send([createCloseAccountInstruction(opsAta, ops.publicKey, ops.publicKey, [], TOKEN_2022_PROGRAM_ID)]); } catch {}   // rent back to ops
    const f = (x) => (Number(x) / 10 ** DEC).toFixed(0);
    log('ops   tax', c.symbol, 'harvested', f(got), 'burn', f(toBurn), 'dev', devBurn ? 'burned' : f(devAmt), 'holders', f(paid), 'to', n);
    return { got };
  }
  async function sweep() {
    const bal = await conn.getBalance(ops.publicKey), keep = 0.2e9 + liabilities();   // never sweep SOL that is mid-payout to a creator
    if (treasury && bal > keep + 0.1e9) { const amt = bal - keep; await send([SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: new PublicKey(treasury), lamports: amt })]); log('ops   swept', (amt / 1e9).toFixed(4), 'SOL to treasury'); }
  }
  let busy = false;
  async function cycle() {
    if (busy || !ready()) return; busy = true;
    try { await claimFees();
      for (const c of q('SELECT * FROM coins WHERE tax_bps > 0')) {
        const lt = lastTradeTs(c.mint), ls = seenTax.get(c.mint) || 0; if (!(lt > ls && Date.now() - ls > 36e5) && Date.now() - ls < 7 * 864e5) continue;   // hourly at most, only after new trades (weekly fallback: plain wallet-to-wallet transfers pay tax too)
        try { const cfg = await dbc.state.getPoolConfig(new PublicKey(c.config)); if (cfg.feeClaimer.toBase58() === ops.publicKey.toBase58()) await taxCycle(c); seenTax.set(c.mint, Date.now()); } catch (e) { log('ops   tax err', c.symbol, e.message.slice(0, 140)); } }
      await sweep();
    } catch (e) { log('ops   cycle err', e.message); } finally { busy = false; }
  }
  let queued = false; const locked = () => { if (queued) return; queued = true; withLock(cycle).finally(() => { queued = false; }); }; setTimeout(locked, 30e3); setInterval(locked, everyMs);
  return { cycle };
}
