// treid indexer: listens to Meteora DBC, stores treid coins + trades in SQLite, serves a JSON API + live stream
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getTokenMetadata, unpackAccount, getTransferFeeConfig, getMint } from '@solana/spl-token';
import { DynamicBondingCurveClient, DYNAMIC_BONDING_CURVE_PROGRAM_ID, deriveDbcPoolAuthority, DynamicBondingCurveIdl, getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
const coder = new anchor.BorshEventCoder(DynamicBondingCurveIdl);
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { opsKeypair, startOps } from './ops.mjs';
import { startRewards } from './rewards.mjs';
import { startCallouts } from './callouts.mjs';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const WS = process.env.WS || RPC.replace('http', 'ws').replace(':8899', ':8900');
const PARTNER = process.env.PARTNER;               // treid treasury / legacy fee-claimer wallet
const OPS = opsKeypair(process.env.OPS_SECRET);   // optional hot ops wallet: fee claimer + tax authority of new coins
const PARTNERS = [...new Set([PARTNER, OPS?.publicKey.toBase58()].filter(Boolean))];   // coins from configs of any of these are indexed
const PORT = +(process.env.PORT || 8787);
let SOL_USD = +(process.env.SOL_USD || 150);
// permanent coin images + metadata on IPFS via Pinata (set PINATA_JWT); without it metadata lives in this server's memory only
const PINATA_JWT = process.env.PINATA_JWT || '', PINATA_GW = (process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud').replace(/\/+$/, '');
async function pinFile(dataUrl, name) {
  const [h, b64] = dataUrl.split(','), type = h.slice(5, h.indexOf(';')), fd = new FormData();
  fd.append('file', new Blob([Buffer.from(b64, 'base64')], { type }), name + '.' + (type.split('/')[1] || 'png').replace('svg+xml', 'svg'));
  fd.append('pinataMetadata', JSON.stringify({ name: 'treid-' + name }));
  const r = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { authorization: 'Bearer ' + PINATA_JWT }, body: fd });
  const j = await r.json(); if (!j.IpfsHash) throw new Error('pinata file: ' + JSON.stringify(j).slice(0, 120)); return PINATA_GW + '/ipfs/' + j.IpfsHash;
}
async function pinJSON(obj, name) {
  const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', { method: 'POST', headers: { authorization: 'Bearer ' + PINATA_JWT, 'content-type': 'application/json' }, body: JSON.stringify({ pinataContent: obj, pinataMetadata: { name: 'treid-' + name + '.json' } }) });
  const j = await r.json(); if (!j.IpfsHash) throw new Error('pinata json: ' + JSON.stringify(j).slice(0, 120)); return PINATA_GW + '/ipfs/' + j.IpfsHash;
}
async function solPrice() { try { const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'); const j = await r.json(); if (j?.solana?.usd) SOL_USD = j.solana.usd; } catch {} }
const SUPPLY = 1e9, WSOL = 'So11111111111111111111111111111111111111112';
const QUOTE_OVERRIDE = (() => { try { return JSON.parse(process.env.QUOTE_USD || '{}'); } catch { return {}; } })();   // {"<mint>": 1} for devnet test tokens
const qPrice = new Map();
function quoteUsd(mint, symbol) { if (!mint || mint === WSOL) return SOL_USD; if (QUOTE_OVERRIDE[mint] != null) return +QUOTE_OVERRIDE[mint]; const p = qPrice.get(mint); if (p) return p; return /usd/i.test(symbol || '') ? 1 : 0; }
async function quotePrices() {
  const ms = q('SELECT DISTINCT quote_mint m FROM coins WHERE quote_mint IS NOT NULL AND quote_mint != ?', WSOL).map((r) => r.m).filter((m) => QUOTE_OVERRIDE[m] == null); if (!ms.length) return;
  try { const r = await fetch('https://lite-api.jup.ag/price/v3?ids=' + ms.join(',')); const j = await r.json(); for (const m of ms) if (j?.[m]?.usdPrice) qPrice.set(m, +j[m].usdPrice); } catch {}
}
const KNOWN_Q = { [WSOL]: 'SOL', EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC', Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC' };
const conn = new Connection(RPC, { commitment: 'confirmed', wsEndpoint: WS });
const dbc = new DynamicBondingCurveClient(conn, 'confirmed');
const db = new DatabaseSync(process.env.DB || 'treid.db');
db.exec(`CREATE TABLE IF NOT EXISTS coins(mint TEXT PRIMARY KEY, pool TEXT, config TEXT, creator TEXT, name TEXT, symbol TEXT, uri TEXT, tax_bps INT, created_slot INT, created_at INT);
CREATE TABLE IF NOT EXISTS trades(sig TEXT PRIMARY KEY, mint TEXT, wallet TEXT, side TEXT, sol REAL, tokens REAL, price_usd REAL, mcap_usd REAL, slot INT, ts INT, sniper INT DEFAULT 0, bundle INT DEFAULT 0, fee_sol REAL DEFAULT 0, progress REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS t_mint ON trades(mint, ts);
CREATE TABLE IF NOT EXISTS seen(sig TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS payouts(id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, ts INT, harvested REAL, burned REAL, dev REAL, holders REAL, n_holders INT, fees_sol REAL);
CREATE TABLE IF NOT EXISTS meta(mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, description TEXT, image TEXT, banner TEXT, at INT);`);
for (const col of ['trap_bps INT DEFAULT 0', 'trap_secs INT DEFAULT 0', 'trap_steps INT DEFAULT 0', "quote_mint TEXT DEFAULT 'So11111111111111111111111111111111111111112'", 'quote_dec INT DEFAULT 9', "quote_symbol TEXT DEFAULT 'SOL'"]) { try { db.exec('ALTER TABLE coins ADD COLUMN ' + col); } catch {} }
try { db.exec('ALTER TABLE trades ADD COLUMN usd REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE trades ADD COLUMN reserve REAL DEFAULT 0'); } catch {}
const gradTarget = new Map();
db.exec('CREATE TABLE IF NOT EXISTS uburn(sig TEXT PRIMARY KEY, mint TEXT, wallet TEXT, tok REAL, ts INT)');
// ---- burns: total burned is authoritative from the mint supply; events come from the ops receipts + reported user burns ----
const supplyC = new Map();
async function burnedOf(mint) { const h = supplyC.get(mint); if (h && Date.now() - h.ts < 60e3) return h.v; try { const s = await conn.getTokenSupply(new PublicKey(mint)); const v = Math.max(0, SUPPLY - Number(s.value.amount) / 1e6); supplyC.set(mint, { ts: Date.now(), v }); return v; } catch { return h?.v || 0; } }
async function verifyBurn(sig) {   // a user's burn of a treid coin, checked on-chain (never trusted from the request)
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig)) throw new Error('bad signature'); if (q1('SELECT 1 FROM uburn WHERE sig=?', sig)) return { ok: true, dup: true };
  let tx = null; for (let i = 0; i < 6 && !tx; i++) { tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null); if (!tx) await new Promise((r) => setTimeout(r, 1500)); }
  if (!tx || tx.meta.err) throw new Error('transaction not found');
  const keys = tx.transaction.message.getAccountKeys ? tx.transaction.message.getAccountKeys().staticAccountKeys : tx.transaction.message.accountKeys, signer = keys[0].toBase58();
  // decode the Token-2022 Burn (8) / BurnChecked (15) instructions themselves: accounts [token account, mint, authority], amount = u64 LE
  const msg = tx.transaction.message, mk = msg.getAccountKeys ? msg.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }) : null, key = (i) => (mk ? mk.get(i) : msg.accountKeys[i]).toBase58(), T22 = TOKEN_2022_PROGRAM_ID.toBase58(), by = new Map();
  for (const ix of msg.compiledInstructions || []) { if (key(ix.programIdIndex) !== T22) continue; const d = Buffer.from(ix.data); if (!(d[0] === 8 || d[0] === 15) || d.length < 9) continue;
    const mint = key(ix.accountKeyIndexes[1]), auth = key(ix.accountKeyIndexes[2]); if (auth !== signer || !q1('SELECT 1 FROM coins WHERE mint=?', mint)) continue; by.set(mint, (by.get(mint) || 0) + Number(d.readBigUInt64LE(1)) / 1e6); }
  for (const [mint, tok] of by) { if (tok <= 0) continue; run('INSERT OR IGNORE INTO uburn VALUES(?,?,?,?,?)', sig, mint, signer, tok, (tx.blockTime || Date.now() / 1000) * 1000); supplyC.delete(mint); push({ type: 'burn', mint, tok, wallet: signer, sig }); return { ok: true, tok }; }
  throw new Error('no treid tokens burned in this transaction');
}   // curve migration threshold per coin (pair-token units)
const q = (sql, ...a) => db.prepare(sql).all(...a), q1 = (sql, ...a) => db.prepare(sql).get(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
let configs = new Set(); const watched = new Map(); const escCache = new Map(); let REW = null;
// treid configs = DBC configs whose fee claimer is the treid wallet. Each one is watched by address,
// so we only ever fetch transactions that touch treid coins (never the whole DBC firehose).
async function loadConfigs() {
  if (!PARTNERS.length) return; const cs = (await Promise.all(PARTNERS.map((w) => dbc.state.getPoolConfigsByOwner(new PublicKey(w))))).flat();
  for (const c of cs) { const k = c.publicKey.toBase58(); if (!configs.has(k)) { configs.add(k); watchConfig(k); } }
}
function watchConfig(k) {
  if (watched.has(k)) return;
  watched.set(k, conn.onLogs(new PublicKey(k), (l) => { if (!l.err) handle(l.signature).catch(e => console.log('err', e.message)); }, 'confirmed'));
}
async function syncAddress(addr, limit = 1000) {   // fetch history (oldest first), skipping what we've already processed
  let before, all = [];
  while (true) { const page = await conn.getSignaturesForAddress(new PublicKey(addr), { limit: Math.min(limit, 1000), before }, 'confirmed'); if (!page.length) break;
    const fresh = page.filter(x => !x.err && !q1('SELECT 1 FROM seen WHERE sig=?', x.signature)); all.push(...fresh);
    if (fresh.length < page.length || page.length < Math.min(limit, 1000) || all.length >= limit) break; before = page[page.length - 1].signature; }
  for (const x of all.reverse()) await handle(x.signature).catch(e => console.log('err', e.message));
}
const clients = new Set(); const push = (ev) => { const s = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) c.write(s); };
let CO = null;   // callouts (started below, once the helpers exist)

async function addCoin(mint, slot, ts, creator) {
  if (q1('SELECT 1 FROM coins WHERE mint=?', mint)) return true;
  const ps = await dbc.state.getPoolByBaseMint(new PublicKey(mint)).catch(() => null); if (!ps) return false;
  const pst = ps.account.poolState || ps.account; const cfg = pst.config.toBase58(); if (PARTNER && !configs.has(cfg)) { await loadConfigs(); if (!configs.has(cfg)) return false; }
  const cf = await dbc.state.getPoolConfig(pst.config).catch(() => null), bf = cf?.poolFees?.baseFee;
  const trap = bf && Number(bf.baseFeeMode) <= 1 ? { bps: Math.round(Number(bf.cliffFeeNumerator) / 1e5), secs: Number(bf.firstFactor) * Number(bf.secondFactor), steps: Number(bf.firstFactor) } : { bps: 0, secs: 0, steps: 0 };
  if (!creator) {   // seen first via a trade: find the pool's creation tx and read the creator from its DBC instruction
    try { let before, oldest = null; for (let i = 0; i < 20; i++) { const pg = await conn.getSignaturesForAddress(ps.publicKey, { before, limit: 1000 }, 'confirmed'); if (!pg.length) break; oldest = pg[pg.length - 1]; if (pg.length < 1000) break; before = oldest.signature; }
      if (oldest) { const t0 = await conn.getTransaction(oldest.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); const it = t0 && poolInits(t0).find((x) => x.mint === mint); if (it) { creator = it.creator; slot = t0.slot; ts = (t0.blockTime || 0) * 1000 || ts; } } } catch {}
    if (!creator) return false;   // never guess a creator
  }
  const md = await getTokenMetadata(conn, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(() => null);
  const qm = cf ? cf.quoteMint.toBase58() : WSOL; let qd = 9, qs = KNOWN_Q[qm] || null;
  if (qm !== WSOL) { const qa = await conn.getAccountInfo(new PublicKey(qm)).catch(() => null); const qprog = qa?.owner?.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined; const qmi = await getMint(conn, new PublicKey(qm), 'confirmed', qprog).catch(() => null); if (qmi) qd = qmi.decimals;
    if (!qs) { const qmd = qprog ? await getTokenMetadata(conn, new PublicKey(qm), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(() => null) : null; qs = qmd?.symbol || qm.slice(0, 4); } }
  const m = await getMint(conn, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(() => null); const tf = m && getTransferFeeConfig(m);
  const ins = run('INSERT OR IGNORE INTO coins(mint,pool,config,creator,name,symbol,uri,tax_bps,created_slot,created_at,trap_bps,trap_secs,trap_steps,quote_mint,quote_dec,quote_symbol) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', mint, ps.publicKey.toBase58(), cfg, creator || pst.creator.toBase58(), md?.name || '', md?.symbol || '', md?.uri || '', tf ? tf.newerTransferFee.transferFeeBasisPoints : 0, creator ? slot : 0, creator || !cf || Number(cf.activationType) !== 1 ? ts : Number(pst.activationPoint) * 1000, trap.bps, trap.secs, trap.steps, qm, qd, qs || 'SOL');
  if (ins.changes) { push({ type: 'coin', mint, name: md?.name, symbol: md?.symbol }); console.log('coin  ', md?.symbol, mint); } return true;
}
// pool creations, read from the DBC instruction itself (accounts: 2 = creator, 3 = base_mint) — never from fee payer / logs / balances
const INIT_DISC = DynamicBondingCurveIdl.instructions.filter((i) => /^initialize_virtual_pool/.test(i.name)).map((i) => Buffer.from(i.discriminator).toString('hex'));
function poolInits(tx) {
  const msg = tx.transaction.message, keys = msg.getAccountKeys ? msg.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }) : null, key = (i) => (keys ? keys.get(i) : msg.accountKeys[i]).toBase58(), DBC = DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(), out = [];
  const check = (pid, accts, data) => { if (key(pid) !== DBC || !data || data.length < 8) return; if (!INIT_DISC.includes(Buffer.from(data.subarray(0, 8)).toString('hex'))) return; out.push({ creator: key(accts[2]), mint: key(accts[3]) }); };
  for (const ix of msg.compiledInstructions || []) check(ix.programIdIndex, ix.accountKeyIndexes, Buffer.from(ix.data));
  for (const g of tx.meta.innerInstructions || []) for (const ix of g.instructions) { try { check(ix.programIdIndex, ix.accounts, Buffer.from(bs58.decode(ix.data))); } catch {} }
  return out;
}
async function handle(sig) {
  if (q1('SELECT 1 FROM seen WHERE sig=?', sig)) return;
  const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
  if (!tx) return; run('INSERT OR IGNORE INTO seen VALUES(?)', sig); if (tx.meta?.err) return;
  const logs = (tx.meta.logMessages || []).join('\n'), keys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
  const signer = keys[0].toBase58(), ts = (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000;
  const pre = tx.meta.preTokenBalances || [], post = tx.meta.postTokenBalances || [];
  const quoteSet = new Set(q('SELECT DISTINCT quote_mint m FROM coins').map((r) => r.m)); quoteSet.add(WSOL);
  const mints = [...new Set(post.map(b => b.mint).filter(x => !quoteSet.has(x) || q1('SELECT 1 FROM coins WHERE mint=?', x)))];
  if (/Instruction: CreateConfig/.test(logs)) { await loadConfigs(); return; }
  const inits = poolInits(tx); if (inits.length) { for (const it of inits) await addCoin(it.mint, tx.slot, ts, it.creator); if (!/Instruction: Swap/.test(logs)) return; }   // pool + dev first buy can share one tx
  if (!/Instruction: Swap/.test(logs)) return;
  const evs = []; for (const g of tx.meta.innerInstructions || []) for (const ix of g.instructions) { if (keys[ix.programIdIndex].toBase58() !== DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58()) continue; try { const e = coder.decode(Buffer.from(bs58.decode(ix.data)).subarray(8).toString('base64')); if (e) evs.push(e); } catch {} }
  const swapEv = (pool) => evs.find((e) => (e.name === 'EvtSwap2' || e.name === 'EvtSwap3') && e.data.pool?.toBase58() === pool);   // real swaps only: the DBC program's own event for THIS pool (log text can be faked by a memo)
  for (const mint of mints) {
    const coin = q1('SELECT * FROM coins WHERE mint=?', mint) || (await addCoin(mint, tx.slot, ts) && q1('SELECT * FROM coins WHERE mint=?', mint)); if (!coin) continue;
    const evp = swapEv(coin.pool); if (!evp) continue; const ev2 = evp.name === 'EvtSwap2' ? evp : null, ev3 = evp.name === 'EvtSwap3' ? evp : null;
    const amt = (arr, owner, mt) => arr.filter(b => b.owner === owner && b.mint === mt).reduce((s, b) => s + Number(b.uiTokenAmount.amount), 0);
    const tokDelta = (amt(post, signer, mint) - amt(pre, signer, mint)) / 1e6;
    const auth = deriveDbcPoolAuthority().toBase58();
    const QM = coin.quote_mint || WSOL, QD = 10 ** (coin.quote_dec ?? 9), QU = quoteUsd(QM, coin.quote_symbol);
    const vaultDelta = (amt(post, auth, QM) - amt(pre, auth, QM)) / QD;   // pair token into (+) / out of (−) the curve
    if (!tokDelta) continue;
    const side = tokDelta > 0 ? 'buy' : 'sell', sol = Math.abs(vaultDelta), tokens = Math.abs(tokDelta);
    const sq = ev2?.data.swap_result.next_sqrt_price || ev3?.data.next_sqrt_price;
    const price = sq ? Number(getPriceFromSqrtPrice(sq, 6, coin.quote_dec ?? 9)) * QU : (tokens ? sol * QU / tokens : 0);
    const fee = ev2 ? Number(ev2.data.swap_result.trading_fee) / QD : 0, prog = ev2 ? Number(ev2.data.quote_reserve_amount) / Number(ev2.data.migration_threshold) * 100 : 0, reserve = ev2 ? Number(ev2.data.quote_reserve_amount) / QD : 0, target = ev2 ? Number(ev2.data.migration_threshold) / QD : 0;
    const sniper = side === 'buy' && signer !== coin.creator && (coin.created_slot > 0 ? tx.slot - coin.created_slot <= 4 : ts - coin.created_at <= 2000) ? 1 : 0; // ~1.5s after launch: faster than a human can click
    run('INSERT OR IGNORE INTO trades(sig,mint,wallet,side,sol,tokens,price_usd,mcap_usd,slot,ts,sniper,bundle,fee_sol,progress,usd,reserve) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)', sig, mint, signer, side, sol, tokens, price, price * SUPPLY, tx.slot, ts, sniper, fee, Math.min(100, prog), sol * QU, reserve);
    if (target && !gradTarget.has(mint)) gradTarget.set(mint, target);
    const same = q('SELECT DISTINCT wallet FROM trades WHERE mint=? AND slot=? AND side=\'buy\'', mint, tx.slot);
    if (same.length >= 2) run('UPDATE trades SET bundle=1 WHERE mint=? AND slot=? AND side=\'buy\'', mint, tx.slot);
    const t = q1('SELECT * FROM trades WHERE sig=?', sig); push({ type: 'trade', ...t, symbol: coin.symbol });
    console.log('trade ', coin.symbol, side.padEnd(4), sol.toFixed(3), coin.quote_symbol || 'SOL', tokens.toFixed(0), sniper ? 'SNIPER' : '', t.bundle ? 'BUNDLE' : '');
  }
}
async function backfill() {   // rebuilds everything from chain, so the server can run without a persistent disk
  await loadConfigs();
  for (const k of configs) await syncAddress(k);
}
// ---- API ----
const TF = { '1m': 60e3, '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
function candles(mint, tf) {
  const b = TF[tf] || 60e3, rows = q('SELECT ts, mcap_usd m, sol FROM trades WHERE mint=? ORDER BY ts, slot', mint), out = [];
  for (const r of rows) { const k = Math.floor(r.ts / b) * b, c = out[out.length - 1]; if (c && c.t === k) { c.h = Math.max(c.h, r.m); c.l = Math.min(c.l, r.m); c.c = r.m; c.v += r.sol; } else { const o = c ? c.c : r.m; out.push({ t: k, o, h: Math.max(o, r.m), l: Math.min(o, r.m), c: r.m, v: r.sol }); } }
  return out;
}
async function holders(mint) {
  const coin = q1('SELECT * FROM coins WHERE mint=?', mint); if (!coin) return [];
  const accs = await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: mint } }] });
  const auth = deriveDbcPoolAuthority().toBase58();
  return accs.map(a => unpackAccount(a.pubkey, a.account, TOKEN_2022_PROGRAM_ID)).filter(a => a.amount > 0n)
    .map(a => ({ wallet: a.owner.toBase58(), pct: Number(a.amount) / 1e6 / SUPPLY * 100, curve: a.owner.toBase58() === auth, dev: a.owner.toBase58() === coin.creator }))
    .sort((x, y) => y.pct - x.pct);
}
// real on-chain balances (transfers, tax payouts and burns included) — cached, refreshed in the background
const hCache = new Map(), inflight = new Map(), lbCache = new Map();
function holdersCached(mint) { const h = hCache.get(mint); if (h?.list && Date.now() - h.ts < 30e3) return Promise.resolve(h.list); if (!inflight.has(mint)) inflight.set(mint, holders(mint).then((l) => { hCache.set(mint, { ts: Date.now(), list: l }); return l; }).finally(() => inflight.delete(mint))); return inflight.get(mint); }
// simple in-memory rate limiter (per key, n hits per window)
const hits = new Map(); function rate(k, n, ms) { const now = Date.now(), a = (hits.get(k) || []).filter((t) => now - t < ms); if (a.length >= n) { hits.set(k, a); return false; } a.push(now); hits.set(k, a);
  if (hits.size > 50000) for (const [key, v] of hits) if (now - v[v.length - 1] > 36e5) hits.delete(key);   // evict by age, never wipe all limits
  return true; }
const ip = (req) => { const x = String(req.headers['x-forwarded-for'] || '').split(',').map((v) => v.trim()).filter(Boolean); return x.length ? x[x.length - 1] : String(req.socket.remoteAddress || ''); };   // rightmost = added by Render's proxy; the left ones are client-controlled
function liveHolders(mint) { const h = hCache.get(mint); if (!h || Date.now() - h.ts > 120e3) { if (!h?.busy) { const e = h || { ts: 0, list: null }; e.busy = true; hCache.set(mint, e); holders(mint).then((l) => { hCache.set(mint, { ts: Date.now(), list: l }); }).catch(() => { e.busy = false; }); } } return h?.list || null; }
function stats(mint) {
  const c = q1('SELECT * FROM coins WHERE mint=?', mint); if (!c) return null;
  const last = q1('SELECT mcap_usd, progress, reserve FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 1', mint);
  const agg = q1(`SELECT COUNT(*) n, SUM(sol) vol, SUM(usd) volusd, SUM(side='buy') buys, SUM(side='sell') sells, COUNT(DISTINCT wallet) traders, SUM(CASE WHEN sniper=1 THEN tokens ELSE 0 END) snipeTok, SUM(CASE WHEN bundle=1 AND side='buy' THEN tokens ELSE 0 END) bundleTok FROM trades WHERE mint=?`, mint);
  const bal = q(`SELECT wallet, SUM(CASE WHEN side='buy' THEN tokens ELSE -tokens END) n FROM trades WHERE mint=? GROUP BY wallet HAVING n > 0.5 ORDER BY n DESC`, mint);
  const devBuy = q1(`SELECT 1 x FROM trades WHERE mint=? AND wallet=? AND side='buy' LIMIT 1`, mint, c.creator);
  const lh = liveHolders(mint), real = lh ? lh.filter((h) => !h.curve) : null;
  const devN = real ? (real.find((h) => h.wallet === c.creator)?.pct || 0) / 100 * SUPPLY : bal.find(b => b.wallet === c.creator)?.n || 0;
  const top10 = Math.min(SUPPLY, real ? real.slice(0, 10).reduce((s, h) => s + h.pct / 100 * SUPPLY, 0) : bal.slice(0, 10).reduce((s, b) => s + b.n, 0));
  const po = OPS && REW ? q1(`SELECT COALESCE(SUM(CASE WHEN kind='taxburn' THEN lamports END),0)/1e6 burned, COALESCE(SUM(CASE WHEN kind='taxhold' THEN lamports END),0)/1e6 holders, COALESCE(SUM(CASE WHEN kind='taxdev' THEN lamports END),0)/1e6 dev, COUNT(CASE WHEN kind='taxhold' THEN 1 END) n FROM rlog WHERE mint=? AND kind IN ('taxburn','taxdev','taxhold')`, mint) : null;   // from on-chain receipts → survives restarts
  return { ...c, tax_paid: po, reserve: last?.reserve || 0, grad_target: gradTarget.get(mint) || 0, quote_usd: quoteUsd(c.quote_mint, c.quote_symbol), vol_usd: agg.volusd || 0, holders: real ? real.length : bal.length, dev_pct: devN / SUPPLY * 100, dev_sold: !!devBuy && devN < 1, top10_pct: top10 / SUPPLY * 100, sol_usd: SOL_USD, mcap_usd: last?.mcap_usd || 0, curve_pct: last?.progress || 0, trades: agg.n, vol_sol: agg.vol || 0, buys: agg.buys || 0, sells: agg.sells || 0, traders: agg.traders, snipers_pct: (agg.snipeTok || 0) / SUPPLY * 100, bundles_pct: (agg.bundleTok || 0) / SUPPLY * 100 };
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname.split('/').filter(Boolean), J = (o) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }
  // coin metadata (image / description) posted by the site at launch — first write wins. TODO mainnet: pin to IPFS instead.
  if (p[1] === 'upload' && req.method === 'POST') {   // before launch: pin image(s) + metadata JSON to IPFS, return the permanent URI
    if (!rate('up|' + ip(req), 6, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end(JSON.stringify({ uri: null, error: 'too many uploads — try again later' })); }
    let body = ''; req.on('data', (d) => { body += d; if (body.length > 3e6) req.destroy(); });
    req.on('end', async () => { try { if (!PINATA_JWT) return J({ uri: null });
      const m = JSON.parse(body), ok = (v) => typeof v === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(v) && v.length < 1.5e6, tag = String(m.symbol || 'coin').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) + '-' + Date.now().toString(36);
      const image = ok(m.image) ? await pinFile(m.image, tag) : null, banner = ok(m.banner) ? await pinFile(m.banner, tag + '-banner') : null;
      const meta = { name: String(m.name || '').slice(0, 32), symbol: String(m.symbol || '').slice(0, 10), description: String(m.description || '').slice(0, 600), image, banner, external_url: 'https://treid.fun', properties: { files: image ? [{ uri: image, type: 'image' }] : [] } };
      if (m.x) meta.twitter = String(m.x).slice(0, 100); if (m.tg) meta.telegram = String(m.tg).slice(0, 100); if (m.web) meta.website = String(m.web).slice(0, 100);
      J({ uri: await pinJSON(meta, tag), image, banner }); } catch (e) { console.log('upload err', e.message); res.writeHead(502, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ uri: null, error: e.message })); } });
    return;
  }
  if (p[1] === 'meta' && req.method === 'POST') { res.writeHead(410, { 'access-control-allow-origin': '*' }); return res.end('{"ok":false,"error":"metadata lives on IPFS now"}'); }
  if (false) {
    let body = ''; req.on('data', (d) => { body += d; if (body.length > 2.5e6) req.destroy(); });
    req.on('end', () => { try { const m = JSON.parse(body); new PublicKey(m.mint); const img = (v) => (typeof v === 'string' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(v) && v.length < 1.2e6 ? v : null);
      run('INSERT OR IGNORE INTO meta VALUES(?,?,?,?,?,?,?)', m.mint, String(m.name || '').slice(0, 32), String(m.symbol || '').slice(0, 10), String(m.description || '').slice(0, 600), img(m.image), img(m.banner), Date.now()); J({ ok: true }); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end('{"ok":false}'); } });
    return;
  }
  if (p[1] === 'meta' && p[2]) { const m = q1('SELECT * FROM meta WHERE mint=?', p[2]), c = q1('SELECT name, symbol FROM coins WHERE mint=?', p[2]); if (!m && !c) { res.writeHead(404, { 'access-control-allow-origin': '*' }); return res.end('{}'); }
    const base = (req.headers['x-forwarded-proto'] || 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host);
    return J({ name: m?.name || c?.name, symbol: m?.symbol || c?.symbol, description: m?.description || '', image: m?.image ? base + '/api/img/' + p[2] : null, banner: m?.banner ? base + '/api/img/' + p[2] + '?b=1' : null }); }
  if (p[1] === 'img' && p[2]) { const m = q1('SELECT image, banner FROM meta WHERE mint=?', p[2]), d = u.searchParams.get('b') ? m?.banner : m?.image; if (!d) { res.writeHead(404); return res.end(); }
    const [h, b64] = d.split(','); res.writeHead(200, { 'content-type': h.slice(5, h.indexOf(';')), 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' }); return res.end(Buffer.from(b64, 'base64')); }
  if (!p.length || p[1] === 'health') return J({ ok: true, coins: q1('SELECT COUNT(*) n FROM coins').n, trades: q1('SELECT COUNT(*) n FROM trades').n, configs: configs.size, partner: PARTNER || null, ops: OPS?.publicKey.toBase58() || null, ipfs: !!PINATA_JWT, sol_usd: SOL_USD, ready });
  try {
    if (p[1] === 'stream') { res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' }); res.write(': hi\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
    if (p[1] === 'qprice') { const m = String(u.searchParams.get('mint') || ''); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) return J({ usd: 0 });   // pair-token price for the Create page
      let usd = quoteUsd(m, KNOWN_Q[m]), symbol = KNOWN_Q[m] || null, name = null, icon = null;
      try { const r = await fetch('https://lite-api.jup.ag/tokens/v2/search?query=' + m); const j = await r.json(); const t = Array.isArray(j) ? j.find((x) => x.id === m) : null; if (t) { symbol = symbol || t.symbol; name = t.name; icon = t.icon || null; if (!QUOTE_OVERRIDE[m] && t.usdPrice) { usd = +t.usdPrice; qPrice.set(m, usd); } } } catch {}
      return J({ mint: m, usd, symbol, name, icon }); }
    if (p[1] === 'coins') return J(q('SELECT mint FROM coins ORDER BY created_slot DESC').map(r => stats(r.mint)));
    if (p[1] === 'coin') return J(stats(p[2]));
    if (p[1] === 'trades') return J(q('SELECT * FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 200', p[2]));
    if (p[1] === 'creator' && p[2]) {   // creator rewards escrow status for a coin
      const c = q1('SELECT * FROM coins WHERE mint=?', p[2]); if (!c) return J(null);
      const k = 'esc:' + c.mint; let esc = escCache.get(k);
      if (!esc || Date.now() - esc.at > 60e3) { const vp = (await dbc.state.getPool(new PublicKey(c.pool)).catch(() => null))?.poolState; esc = { at: Date.now(), on: !!(OPS && vp && vp.creator.toBase58() === OPS.publicKey.toBase58()), pending: vp ? Number(vp.creatorQuoteFee.toString()) / 10 ** (c.quote_dec ?? 9) : 0 }; escCache.set(k, esc); }
      if (!esc.on || !REW) return J({ escrow: false, dev: c.creator });
      const st = REW.state(c), L = (x) => x / 10 ** (c.quote_dec ?? 9), apps = st.era === 'out' ? await REW.applications(c).catch(() => []) : [];
      return J({ escrow: true, dev: c.creator, era: st.era, creator: st.creator, cto: st.cto ? { lead: st.cto.lead, at: st.cto.at, fundSol: L(st.cto.fund), paidSol: L(st.cto.paid), vestedSol: L(st.cto.vested) } : null, apps, state: st.state, why: st.why, idleMs: st.idle, lastActive: st.last, soldPct: st.sold, quote: c.quote_symbol || 'SOL', quoteUsd: quoteUsd(c.quote_mint, c.quote_symbol), pendingSol: Math.max(0, esc.pending - L(st.fund)), paidSol: L(st.paid), buybackSol: L(st.buyback), burnedTokens: st.burnedTokens / 1e6, fundSol: L(st.fund), grantedSol: L(st.granted), platformSol: L(st.granted), fundEndsAt: st.fundEndsAt, rules: { freezeH: 48, outD: 7, soldOut: 70, applyPct: 1, supportPct: 10 }, log: REW.logFor(c.mint) });
    }
    if (p[1] === 'cto' && (p[2] === 'apply' || p[2] === 'vote') && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 6000) req.destroy(); });
      req.on('end', async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); const b = JSON.parse(body); J(p[2] === 'apply' ? await REW.ctoApply(b) : await REW.ctoVote(b)); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'callout' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 3000) req.destroy(); });
      req.on('end', async () => { try { J(await CO.post(JSON.parse(body), ip(req))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'callouts') return J(CO.list(u.searchParams.get('mint') || null));
    if (p[1] === 'burned' && req.method === 'POST' && !rate('burn|' + ip(req), 30, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('{"ok":false,"error":"too many requests"}'); }
    if (p[1] === 'burned' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 1000) req.destroy(); });
      req.on('end', async () => { try { J(await verifyBurn(String(JSON.parse(body).sig || ''))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'leaderboard' && lbCache.has(u.searchParams.get('per') || 'all') && Date.now() - lbCache.get(u.searchParams.get('per') || 'all').ts < 60e3) return J(lbCache.get(u.searchParams.get('per') || 'all').v);
    if (p[1] === 'leaderboard') { const pm = { '24h': 864e5, '7d': 6048e5 }[u.searchParams.get('per')] || 1e13, since = Date.now() - pm;
      const px = new Map(q('SELECT t.mint, t.price_usd p FROM trades t JOIN (SELECT mint, MAX(ts) m FROM trades GROUP BY mint) l ON l.mint=t.mint AND l.m=t.ts').map((r) => [r.mint, r.p]));
      const skip = new Set([OPS?.publicKey.toBase58(), PARTNER].filter(Boolean)), W = new Map();
      for (const r of q(`SELECT wallet, mint, SUM(CASE WHEN side='buy' THEN usd ELSE 0 END) b, SUM(CASE WHEN side='sell' THEN usd ELSE 0 END) s, SUM(CASE WHEN side='buy' THEN tokens ELSE -tokens END) net, COUNT(*) n FROM trades WHERE ts>=? GROUP BY wallet, mint`, since)) {
        if (skip.has(r.wallet)) continue; const val = r.s + Math.max(0, r.net) * (px.get(r.mint) || 0), pnl = val - r.b, e = W.get(r.wallet) || { wallet: r.wallet, pnl: 0, n: 0, coins: 0, wins: 0, best: null };
        e.pnl += pnl; e.n += r.n; e.coins++; if (pnl > 0) e.wins++; if (!e.best || pnl > e.best.pnl) e.best = { mint: r.mint, pnl, x: r.b > 0 ? val / r.b : 0 }; W.set(r.wallet, e); }
      const traders = [...W.values()].sort((a, b) => b.pnl - a.pnl).slice(0, 100);
      const D = new Map(), coinsAll = q('SELECT * FROM coins');
      for (const c of coinsAll) { const st = q1('SELECT MAX(mcap_usd) ath, MAX(progress) prog FROM trades WHERE mint=?', c.mint), e = D.get(c.creator) || { wallet: c.creator, launches: 0, grads: 0, left: 0, best: 0, bestMint: null };
        e.launches++; if ((st.prog || 0) >= 100) e.grads++; if ((st.ath || 0) > e.best) { e.best = st.ath || 0; e.bestMint = c.mint; } try { if (REW && REW.state(c).era === 'out') e.left++; } catch {} D.set(c.creator, e); }
      const devs = [...D.values()].sort((a, b) => (b.grads * 3 + Math.log10(b.best + 1) * 4 - b.left * 5) - (a.grads * 3 + Math.log10(a.best + 1) * 4 - a.left * 5)).slice(0, 100);
      const hall = coinsAll.map((c) => ({ mint: c.mint, ath: q1('SELECT MAX(mcap_usd) a FROM trades WHERE mint=?', c.mint).a || 0 })).filter((x) => x.ath > 0).sort((a, b) => b.ath - a.ath).slice(0, 50);
      const lv = { traders, devs, hall }; lbCache.set(u.searchParams.get('per') || 'all', { ts: Date.now(), v: lv }); return J(lv); }
    if (p[1] === 'burns') { const coins = q('SELECT mint, creator FROM coins'), out = [];
      for (const c of coins) { const burned = await burnedOf(c.mint); if (burned < 1) continue;
        const r = REW ? q1(`SELECT COALESCE(SUM(CASE WHEN kind='taxburn' THEN lamports END),0)/1e6 tax, COALESCE(SUM(CASE WHEN kind='burntok' THEN lamports END),0)/1e6 bb FROM rlog WHERE mint=?`, c.mint) : { tax: 0, bb: 0 };
        out.push({ mint: c.mint, burned, tax: r.tax, buyback: r.bb, other: Math.max(0, burned - r.tax - r.bb) }); }
      const ev = (REW ? q(`SELECT mint, CASE kind WHEN 'taxburn' THEN 'tax' ELSE 'frozen' END src, lamports/1e6 tok, ts, sig, NULL wallet FROM rlog WHERE kind IN ('taxburn','burntok') AND lamports > 0`) : []).concat(q(`SELECT mint, 'dev' src, tok, ts, sig, wallet FROM uburn`)).sort((a, b) => b.ts - a.ts).slice(0, 200);
      return J({ coins: out, events: ev }); }
    if (p[1] === 'claim' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 4000) req.destroy(); });
      req.on('end', async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); J(await REW.claimNow(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'ping' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 4000) req.destroy(); });
      req.on('end', async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); J(await REW.ping(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'payouts') return J(OPS && REW ? q(`SELECT sig, MAX(ts) ts, SUM(lamports)/1e6 harvested, SUM(CASE WHEN kind='taxburn' THEN lamports ELSE 0 END)/1e6 burned, SUM(CASE WHEN kind='taxdev' THEN lamports ELSE 0 END)/1e6 dev, SUM(CASE WHEN kind='taxhold' THEN lamports ELSE 0 END)/1e6 holders, MAX(CASE WHEN kind='taxhold' THEN CAST(extra AS INT) END) n_holders FROM rlog WHERE mint=? AND kind IN ('taxburn','taxdev','taxhold') GROUP BY sig ORDER BY ts DESC LIMIT 50`, p[2]) : []);
    if (p[1] === 'candles') return J(candles(p[2], u.searchParams.get('tf') || '1m'));
    if (p[1] === 'holders') { const h = hCache.get(p[2]); if (h?.list && Date.now() - h.ts < 15e3) return J(h.list); if (!q1('SELECT 1 FROM coins WHERE mint=?', p[2])) return J([]); if (!inflight.has(p[2])) inflight.set(p[2], holders(p[2]).finally(() => inflight.delete(p[2]))); const l = await inflight.get(p[2]); hCache.set(p[2], { ts: Date.now(), list: l }); return J(l); }
    res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end('{}');
  } catch (e) { res.writeHead(500, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ error: e.message })); }
}).listen(PORT, () => console.log('API on :' + PORT));
let ready = false;
if (!PARTNER) { console.error('Set PARTNER=<treid fee-claimer wallet>'); process.exit(1); }
CO = startCallouts({ q, q1, run, push, rate, pinJSON, pinataJwt: PINATA_JWT, gateway: PINATA_GW,
  coinStats: async (mint, wallet) => { const last = q1('SELECT mcap_usd, price_usd FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 1', mint) || {}; let pos = 0;
    let held = false; try { const hs = await holdersCached(mint); const h = hs.find((x) => x.wallet === wallet && !x.curve); if (h) { held = true; pos = h.pct / 100 * SUPPLY * (last.price_usd || 0); } } catch {}
    const traded = !!q1('SELECT 1 FROM trades WHERE mint=? AND wallet=? LIMIT 1', mint, wallet); return { mc: last.mcap_usd || 0, pos, allowed: held || traded }; } });
CO.restore();
await solPrice(); setInterval(solPrice, 60e3); setInterval(() => quotePrices().catch(() => {}), 60e3);
setInterval(() => push({ type: 'ping', t: Date.now() }), 25e3);               // keeps proxies from closing the stream
await backfill(); ready = true;
for (const w of PARTNERS) conn.onLogs(new PublicKey(w), (l) => { if (!l.err) handle(l.signature).catch(e => console.log('err', e.message)); }, 'confirmed'); // new treid configs
setInterval(() => { for (const k of configs) syncAddress(k, 100).catch(() => {}); }, 60e3);   // safety net if a websocket message is missed (cheap: 1 call per config)
setInterval(() => loadConfigs().catch(() => {}), 15 * 60e3);                                  // full config rescan (getProgramAccounts is credit-heavy) — new configs are caught live via the PARTNER subscription
console.log('watching', configs.size, 'treid configs (partners', PARTNERS.join(', '), ')');
if (OPS) { REW = startRewards({ conn, dbc, ops: OPS, treasury: PARTNER, q, q1, run, quoteUsd: (c) => quoteUsd(c.quote_mint, c.quote_symbol), balances: async (mint) => new Map((await holders(mint)).filter((h) => !h.curve).map((h) => [h.wallet, h.pct / 100 * SUPPLY])) }); REW.rebuild().catch((e) => console.log('rewards rebuild err', e.message)).then(() => { setTimeout(() => REW.cycle(), 45e3); setInterval(() => REW.cycle(), +(process.env.OPS_EVERY_MIN || 10) * 60e3); });
  startOps({ conn, dbc, ops: OPS, treasury: PARTNER, q, q1, run, quoteUsd: (c) => quoteUsd(c.quote_mint, c.quote_symbol), devState: (c) => REW.state(c), liabilities: () => 0,   /* takeover funds stay inside the pools now */ poolAuthority: deriveDbcPoolAuthority().toBase58(), everyMs: +(process.env.OPS_EVERY_MIN || 10) * 60e3 }); console.log('ops wallet', OPS.publicKey.toBase58(), '→ treasury', PARTNER); }
