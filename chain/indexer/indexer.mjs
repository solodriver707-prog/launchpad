// treid indexer: listens to Meteora DBC, stores treid coins + trades in SQLite, serves a JSON API + live stream
import { ALERTS } from './alerts.mjs';   // first: catches the "!!" lines other modules log while loading
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getTokenMetadata, unpackAccount, getTransferFeeConfig, getMint, getExtensionTypes, ExtensionType, getScaledUiAmountConfig, getTransferHook } from '@solana/spl-token';
import { DynamicBondingCurveClient, DYNAMIC_BONDING_CURVE_PROGRAM_ID, deriveDbcPoolAuthority, DynamicBondingCurveIdl, getPriceFromSqrtPrice, deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm, CpAmmIdl, getPriceFromSqrtPrice as ammPrice } from '@meteora-ag/cp-amm-sdk';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
const coder = new anchor.BorshEventCoder(DynamicBondingCurveIdl), ammCoder = new anchor.BorshEventCoder(CpAmmIdl);
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import zlib from 'node:zlib';
import net from 'node:net';
import dns from 'node:dns/promises';
import dnsCb from 'node:dns';
import https from 'node:https';
import { Readable } from 'node:stream';
import { timingSafeEqual, createHash } from 'node:crypto';
import { opsKeypair, startOps, treidCfg, parseSplit } from './ops.mjs';
import { startRewards, RULES as REW_RULES } from './rewards.mjs';
import { startCallouts } from './callouts.mjs';
import { startCalloutRewards, coMemoOf, CO_SHARE } from './callrew.mjs';
import { startBubbles } from './bubbles.mjs';
import { startPush } from './push.mjs';
import { curveOk } from './curve.mjs';
import { lockCache } from './devlock.mjs';
import { fetchT, JUP } from './txutil.mjs';
import { HALT, lockIdle } from './lock.mjs';
let OPS_ST = null;
import { verifySig, SITES, issueSession } from './sig.mjs';
import { ed25519 } from '@noble/curves/ed25519';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const WS = process.env.WS || RPC.replace('http', 'ws').replace(':8899', ':8900');
const PARTNER = process.env.PARTNER;               // treid treasury / legacy fee-claimer wallet
const MAINNET = process.env.CLUSTER === 'mainnet' || /mainnet/.test(RPC);
const OPS = opsKeypair(process.env.OPS_SECRET, { mainnet: MAINNET });   // optional hot ops wallet: fee claimer + tax authority of new coins
const PARTNERS = [...new Set([PARTNER, OPS?.publicKey.toBase58()].filter(Boolean))];
const SYSW = new Set(PARTNERS);   // treid wallets: their trades are bookkeeping, not market activity   // coins from configs of any of these are indexed
const PORT = +(process.env.PORT || 8787), PUBLIC_URL = (process.env.PUBLIC_URL || 'https://treid-indexer.onrender.com').replace(/\/+$/, '');
let SOL_USD = +(process.env.SOL_USD || 150);
// permanent coin images + metadata on IPFS via Pinata (set PINATA_JWT); without it metadata lives in this server's memory only
const PINATA_JWT = process.env.PINATA_JWT || '', PINATA_GW = (process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud').replace(/\/+$/, '');
// content-addressed dedupe: the same bytes (an image) or the same metadata JSON are pinned once and the earlier URL is reused
// (launch retries don't pile up duplicate pins). Table pinc is created with the other tables below.
const pinBusy = new Map();
async function pinOnce(hash, fn) { const row = q1('SELECT url FROM pinc WHERE h=?', hash); if (row?.url) return row.url; if (pinBusy.has(hash)) return pinBusy.get(hash);
  const pr = fn().then((url) => { try { run('INSERT OR REPLACE INTO pinc(h, url, at) VALUES(?,?,?)', hash, url, Date.now()); } catch {} return url; }).finally(() => pinBusy.delete(hash));
  pinBusy.set(hash, pr); return pr; }
async function pinFile(dataUrl, name) {
  const [h, b64] = dataUrl.split(','), type = h.slice(5, h.indexOf(';')), bytes = Buffer.from(b64, 'base64');
  return pinOnce('f:' + createHash('sha256').update(type + '\0').update(bytes).digest('hex'), async () => { const fd = new FormData();
    fd.append('file', new Blob([bytes], { type }), name + '.' + (type.split('/')[1] || 'png').replace('svg+xml', 'svg'));
    fd.append('pinataMetadata', JSON.stringify({ name: 'treid-' + name }));
    const r = await fetchT('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { authorization: 'Bearer ' + PINATA_JWT }, body: fd });
    const j = await r.json(); if (!j.IpfsHash) throw new Error('pinata file: ' + JSON.stringify(j).slice(0, 120)); return PINATA_GW + '/ipfs/' + j.IpfsHash; });
}
async function pinJSON0(obj, name) {
  const r = await fetchT('https://api.pinata.cloud/pinning/pinJSONToIPFS', { method: 'POST', headers: { authorization: 'Bearer ' + PINATA_JWT, 'content-type': 'application/json' }, body: JSON.stringify({ pinataContent: obj, pinataMetadata: { name: 'treid-' + name + '.json' } }) });
  const j = await r.json(); if (!j.IpfsHash) throw new Error('pinata json: ' + JSON.stringify(j).slice(0, 120)); return PINATA_GW + '/ipfs/' + j.IpfsHash;
}
// dedupe only for launch metadata; the callouts backup (unpins its previous snapshot) always pins fresh
async function pinJSON(obj, name, { dedupe = false } = {}) { return dedupe ? pinOnce('j:' + createHash('sha256').update(JSON.stringify(obj)).digest('hex'), () => pinJSON0(obj, name)) : pinJSON0(obj, name); }
async function solPrice() { try { const r = await fetchT('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'); const j = await r.json(); if (j?.solana?.usd) SOL_USD = j.solana.usd; } catch {} }
const HIDDEN = new Set(String(process.env.HIDDEN_MINTS || '').split(',').map((s) => s.trim()).filter(Boolean));   // our own test coins: kept on-chain (and paid out fairly), just not listed on the site
const SUPPLY = 1e9, WSOL = 'So11111111111111111111111111111111111111112';
const QUOTE_OVERRIDE = (() => { try { return JSON.parse(process.env.QUOTE_USD || '{}'); } catch { return {}; } })();   // {"<mint>": 1} for devnet test tokens
const qPrice = new Map();
// a trade's USD value uses the pair-token price AT THAT TIME: live trades → the current price; history (backfill) → SOL's daily price
// from CoinGecko (cached in the db), stablecoins → 1. Other pair tokens have no history source → current price (best we have).
const dayPx = new Map(); let dayPxBusy = 0;
async function solUsdOn(ts) {
  const d = new Date(ts), key = `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
  if (dayPx.has(key)) return dayPx.get(key); const row = q1('SELECT usd FROM spx WHERE day=?', key); if (row) { dayPx.set(key, row.usd); return row.usd; }
  if (dayPxBusy > 2) return SOL_USD; dayPxBusy++;
  try { const j = await (await fetchT('https://api.coingecko.com/api/v3/coins/solana/history?date=' + key + '&localization=false', {}, 10e3)).json(), v = +j?.market_data?.current_price?.usd;
    if (v > 0) { run('INSERT OR REPLACE INTO spx(day,usd) VALUES(?,?)', key, v); dayPx.set(key, v); return v; } } catch {} finally { dayPxBusy--; }
  return SOL_USD; }   // unknown → today's price, not cached (tried again next time)
async function quoteUsdAt(mint, symbol, ts) { if (Date.now() - ts < 20 * 60e3) return quoteUsd(mint, symbol); if (!mint || mint === WSOL) return solUsdOn(ts); return quoteUsd(mint, symbol); }
const STABLE = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU']);   // USDC, USDT, devnet USDC — never guessed from a name
function quoteUsd(mint, symbol) { if (!mint || mint === WSOL) return SOL_USD; if (QUOTE_OVERRIDE[mint] != null) return +QUOTE_OVERRIDE[mint]; const p = qPrice.get(mint); if (p) return p; return STABLE.has(mint) ? 1 : 0; }
async function quotePrices() {
  let rwm = []; try { rwm = q('SELECT DISTINCT token m FROM hpay WHERE token != mint AND token != ?', WSOL).map((r) => r.m); } catch {}   // third-token holder rewards need a price too
  const ms = [...new Set([...q('SELECT DISTINCT quote_mint m FROM coins WHERE quote_mint IS NOT NULL AND quote_mint != ?', WSOL).map((r) => r.m), ...rwm])].filter((m) => QUOTE_OVERRIDE[m] == null); if (!ms.length) return;
  for (let i = 0; i < ms.length; i += 50) { const part = ms.slice(i, i + 50);   // every pair token, 50 per request
    try { const r = await fetchT(JUP + '/price/v3?ids=' + part.join(',')); const j = await r.json(); for (const m of part) if (j?.[m]?.usdPrice) qPrice.set(m, +j[m].usdPrice * (await qMult(m))); } catch {} }
}
const multC = new Map();
async function qMult(m) {   // current UI multiplier of a scaled-UI-amount token (1 for everything else)
  const h = multC.get(m); if (h && Date.now() - h.at < 6e5) return h.v; let v = 1;
  try { const ai = await conn.getAccountInfo(new PublicKey(m)); if (ai?.owner.equals(TOKEN_2022_PROGRAM_ID)) { const sc = getScaledUiAmountConfig(await getMint(conn, new PublicKey(m), 'confirmed', TOKEN_2022_PROGRAM_ID));
    if (sc) v = Date.now() / 1000 >= Number(sc.newMultiplierEffectiveTimestamp) ? Number(sc.newMultiplier) : Number(sc.multiplier); } } catch {}
  if (!(v > 0)) v = 1; multC.set(m, { v, at: Date.now() }); return v; }
const KNOWN_Q = { [WSOL]: 'SOL', EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC', Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC' };
const conn = new Connection(RPC, { commitment: 'confirmed', wsEndpoint: WS, fetch: (u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(30e3) }) });   // a stalled RPC call can never freeze the ops loops
const LOCKS = lockCache(conn);   // "Locked launch": the creator's launch buy in a Jupiter Lock escrow (verified on-chain, cached)
const dbc = new DynamicBondingCurveClient(conn, 'confirmed'), amm = new CpAmm(conn);
let DB_PATH = process.env.DB || 'treid.db', db;
try { db = new DatabaseSync(DB_PATH); db.exec('CREATE TABLE IF NOT EXISTS _w(x INT); DROP TABLE _w;'); }   // the persistent disk must be writable
catch (e) { console.error('!! DATABASE NOT WRITABLE at', DB_PATH, '-', e.message, '— falling back to /tmp (data is rebuilt from chain on every restart)'); DB_PATH = '/tmp/treid.db'; db = new DatabaseSync(DB_PATH); }
db.exec(`CREATE TABLE IF NOT EXISTS coins(mint TEXT PRIMARY KEY, pool TEXT, config TEXT, creator TEXT, name TEXT, symbol TEXT, uri TEXT, tax_bps INT, created_slot INT, created_at INT);
CREATE TABLE IF NOT EXISTS trades(sig TEXT PRIMARY KEY, mint TEXT, wallet TEXT, side TEXT, sol REAL, tokens REAL, price_usd REAL, mcap_usd REAL, slot INT, ts INT, sniper INT DEFAULT 0, bundle INT DEFAULT 0, fee_sol REAL DEFAULT 0, progress REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS t_mint ON trades(mint, ts);
CREATE INDEX IF NOT EXISTS t_wallet ON trades(wallet, mint);
CREATE INDEX IF NOT EXISTS c_creator ON coins(creator);
CREATE TABLE IF NOT EXISTS seen(sig TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS payouts(id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, ts INT, harvested REAL, burned REAL, dev REAL, holders REAL, n_holders INT, fees_sol REAL);
CREATE TABLE IF NOT EXISTS meta(mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, description TEXT, image TEXT, banner TEXT, at INT);`);
for (const col of ['trap_bps INT DEFAULT 0', 'trap_secs INT DEFAULT 0', 'trap_steps INT DEFAULT 0', "quote_mint TEXT DEFAULT 'So11111111111111111111111111111111111111112'", 'quote_dec INT DEFAULT 9', "quote_symbol TEXT DEFAULT 'SOL'"]) { try { db.exec('ALTER TABLE coins ADD COLUMN ' + col); } catch {} }
try { db.exec('ALTER TABLE trades ADD COLUMN usd REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE trades ADD COLUMN reserve REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE coins ADD COLUMN damm TEXT'); } catch {}
try { db.exec('ALTER TABLE trades ADD COLUMN sys INT DEFAULT 0'); } catch {}   // the coin's DAMM v2 pool once it graduated
const gradTarget = new Map();
db.exec('CREATE TABLE IF NOT EXISTS spx(day TEXT PRIMARY KEY, usd REAL)');
db.exec('CREATE TABLE IF NOT EXISTS uburn(sig TEXT PRIMARY KEY, mint TEXT, wallet TEXT, tok REAL, ts INT)');
// ---- burns: total burned is authoritative from the mint supply; events come from the ops receipts + reported user burns ----
const supplyC = new Map();
// the mint supply barely changes: cached 1 h per coin (6 h for coins with no trade in 3 days), busted when the server sees a burn
// (verified user burns, and any ops/rewards ledger row whose kind is a burn — see runLedger below)
const supplyBusy = new Map();
const supplyTtl = (mint) => { const lt = q1('SELECT MAX(ts) t FROM trades WHERE mint=?', mint)?.t || 0; return Date.now() - lt > 3 * 864e5 ? 6 * 36e5 : 36e5; };
const supplyStale = (mint) => { const h = supplyC.get(mint); return !h || Date.now() - h.ts > (h.ttl || 36e5); };
export function bustSupply(mint) { if (mint) { supplyC.delete(mint); burnsSnap = null; } }
async function burnedOf(mint) { const h = supplyC.get(mint); if (h && !supplyStale(mint)) return h.v; if (supplyBusy.has(mint)) return supplyBusy.get(mint);
  const pr = (async () => { try { const s = await conn.getTokenSupply(new PublicKey(mint)); const v = Math.max(0, SUPPLY - Number(s.value.amount) / 1e6); supplyC.set(mint, { ts: Date.now(), v, ttl: supplyTtl(mint) }); return v; } catch { return h?.v || 0; } })().finally(() => supplyBusy.delete(mint));
  supplyBusy.set(mint, pr); return pr; }
// ops / rewards modules get this instead of `run`: a ledger row recording a burn busts that coin's cached supply (ops.mjs untouched)
const runLedger = (sql, ...a) => { const r = run(sql, ...a); try { if (/INTO\s+rlog/i.test(sql) && /burn/.test(String(a[3] || ''))) bustSupply(String(a[2] || '')); } catch {} return r; };
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
let configs = new Set(), lastCfgScan = 0; const watched = new Map(); const escCache = new Map(); let REW = null;
// treid configs = DBC configs whose fee claimer is the treid wallet. Each one is watched by address,
// so we only ever fetch transactions that touch treid coins (never the whole DBC firehose).
// a config only counts as treid if it matches what the treid site creates: fixed 1e9 supply, 6 decimals, Token-2022, no vesting,
// all LP permanently locked, immutable token, normal fee scheduler, tax ≤10% with the withheld tax under partner control
function treidConfig(cf) {
  try { const n = (x) => Number(x?.toString?.() ?? x), bf = cf.poolFees.baseFee, lv = cf.lockedVestingConfig;
    return PARTNERS.includes(cf.feeClaimer.toBase58()) && cf.leftoverReceiver.toBase58() === PARTNER && n(cf.tokenType) === 1 && n(cf.tokenDecimal) === 6
      && cf.preMigrationTokenSupply.toString() === '1000000000000000' && cf.postMigrationTokenSupply.toString() === '1000000000000000' && n(cf.fixedTokenSupplyFlag) === 1
      && n(cf.tokenUpdateAuthority) === 1 && ['amountPerPeriod', 'cliffUnlockAmount', 'numberOfPeriod'].every((k) => n(lv[k]) === 0)
      && n(cf.creatorLiquidityPercentage) === 0 && n(cf.partnerLiquidityPercentage) === 0 && n(cf.creatorPermanentLockedLiquidityPercentage) + n(cf.partnerPermanentLockedLiquidityPercentage) === 100
      && !n(cf.creatorLiquidityVestingInfo?.isInitialized) && !n(cf.partnerLiquidityVestingInfo?.isInitialized) && n(bf.baseFeeMode) <= 1 && !n(cf.poolFees.dynamicFee?.initialized)
      && n(cf.transferFeeBasisPoints) <= 1000 && (!n(cf.transferFeeFlag) || (n(cf.transferFeeWithheldAuthority) === 0 && n(cf.migratedTransferFeeAuthorityOption) === 0)) && n(cf.creatorTradingFeePercentage) === 50 && n(cf.collectFeeMode) === 0;
  } catch { return false; } }
// …and (mainnet) its curve is exactly the one the site builds: start price, migration threshold, fee schedule and migration settings
const qDecC = new Map([[WSOL, 9]]);
async function quoteDec(qm) { if (qDecC.has(qm)) return qDecC.get(qm); const ai = await conn.getAccountInfo(new PublicKey(qm)); if (!ai) throw new Error('quote mint not found');
  const mi = await getMint(conn, new PublicKey(qm), 'confirmed', ai.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined); qDecC.set(qm, mi.decimals); return mi.decimals; }
const curveRej = new Set();
async function treidCurve(k, cf) { if (!MAINNET) return true; const ok = curveOk(cf, await quoteDec(cf.quoteMint.toBase58())); if (!ok && !curveRej.has(k)) { curveRej.add(k); console.log('skip  config with a non-treid curve', k); } return ok; }
async function loadConfigs() {
  if (!PARTNERS.length) return; const cs = (await Promise.all(PARTNERS.map((w) => dbc.state.getPoolConfigsByOwner(new PublicKey(w))))).flat();
  for (const c of cs) { const k = c.publicKey.toBase58(); cfgFee.set(k, Number(c.account.migratedPoolFeeBps?.toString?.() ?? 50)); if (!configs.has(k) && treidConfig(c.account) && configs.size < 1e6 && await treidCurve(k, c.account)) configs.add(k); }   // an RPC error throws → the caller retries (never "not treid")   // which ones get a live stream is decided by retier()
}
const cfgFound = new Map(), cfgFee = new Map();   // config → pool fee after graduation (bps): 50 for v1 coins, 100 for v2   // configs seen being created (their coin may not be indexed yet) → counted as active
async function addConfig(k) {   // one new config, read on its own (never a rescan of every config)
  if (configs.has(k)) return true; if (configs.size >= 1e6) return false;
  const cf = await dbc.state.getPoolConfig(new PublicKey(k)).catch(() => null); if (!cf || !treidConfig(cf) || !(await treidCurve(k, cf))) return false;
  cfgFee.set(k, Number(cf.migratedPoolFeeBps?.toString?.() ?? 50)); configs.add(k); cfgFound.set(k, Date.now()); watch(k); for (const ms of [6e3, 25e3]) setTimeout(() => syncAddress(k, 100).catch(() => {}), ms); return true;   // its pool may be created before the stream is up
}
function watch(k) { if (watched.has(k)) return; watched.set(k, conn.onLogs(new PublicKey(k), (l) => { if (!l.err) enqueue(l.signature); }, 'confirmed')); }
function unwatch(k) { const id = watched.get(k); if (id == null) return; watched.delete(k); conn.removeOnLogsListener(id).catch(() => {}); }
// live streams only for addresses with recent activity (an RPC allows a limited number of subscriptions); quiet ones are polled less often
const LIVE_MS = 48 * 36e5, MAX_LIVE = +(process.env.MAX_LIVE || 1500);
function activity() {
  const last = new Map(), bump = (a, t) => { if (a) last.set(a, Math.max(last.get(a) || 0, t || 0)); };
  for (const r of q('SELECT c.config a, c.damm d, c.created_at cr, (SELECT MAX(ts) FROM trades t WHERE t.mint=c.mint) lt FROM coins c')) { const t = Math.max(r.cr || 0, r.lt || 0); if (r.d) bump(r.d, t); else bump(r.a, t); }   // graduated: only its DAMM pool still trades
  for (const k of configs) if (!last.has(k) && !q1('SELECT 1 FROM coins WHERE config=? AND damm IS NOT NULL', k)) last.set(k, cfgFound.get(k) || 0);
  return last;
}
function retier() {
  const now = Date.now(), act = activity(), live = new Set([...act].filter(([, t]) => now - t < LIVE_MS).sort((x, y) => y[1] - x[1]).slice(0, MAX_LIVE).map((x) => x[0]));
  const n0 = watched.size; for (const k of live) watch(k); for (const k of [...watched.keys()]) if (!live.has(k)) unwatch(k);
  if (watched.size !== n0) console.log('live  ', watched.size, 'streams of', act.size, 'addresses'); return act;
}
async function syncAddress(addr, limit = 1000) {   // fetch history (oldest first), skipping what we've already processed
  let before, all = [];
  while (true) { const page = await conn.getSignaturesForAddress(new PublicKey(addr), { limit: Math.min(limit, 1000), before }, 'confirmed'); if (!page.length) break;
    const ok = page.filter((x) => !x.err), fresh = ok.filter((x) => !q1('SELECT 1 FROM seen WHERE sig=?', x.signature)); all.push(...fresh);
    if (fresh.length < ok.length || page.length < Math.min(limit, 1000) || all.length >= limit) break; before = page[page.length - 1].signature; }   // stop at the first ALREADY-SEEN tx (failed ones on a page don't count)
  for (const x of all.reverse()) await handle(x.signature).catch(e => console.log('err', e.message));
}
let PUSH = null; const clients = new Set(); const push = (ev) => { if (PUSH) PUSH.onEvent(ev); const s = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) { if (c.writableLength > 256e3) { clients.delete(c); try { c.destroy(); } catch {} continue; } c.write(s); } };   // slow readers are dropped, never buffered forever
function buildCoinsSnap() { if (coinsSnap && coinsSnap.busy) return; if (coinsSnap) coinsSnap.busy = true;
  try { const v = q('SELECT mint FROM coins ORDER BY created_slot DESC LIMIT 2000').filter((r) => !HIDDEN.has(r.mint)).map((r) => stats(r.mint, true)), raw = JSON.stringify(v); coinsSnap = { at: Date.now(), v, out: { raw, __gz: zlib.gzipSync(raw, { level: 6 }) } }; }
  catch (e) { if (coinsSnap) coinsSnap.busy = false; throw e; } }
let CO = null, CR = null, BUB = null, bubC = new Map(), walC = new Map(), coinsSnap = null, burnsSnap = null; const opsSolC = { v: null };   // callouts (started below, once the helpers exist)

// pair tokens: SOL, USDC, USDT always; anything else only if Jupiter lists it as verified with real liquidity (no self-priced fakes)
const qOk = new Map(), badgeC = new Map();
// Meteora's own approval for a Token-2022 pair token with extra features (e.g. tokenized stocks): a "token badge" PDA of the DBC program
async function hasBadge(qm) { const h = badgeC.get(qm); if (h && Date.now() - h.at < 864e5) return h.ok;
  const [b] = PublicKey.findProgramAddressSync([Buffer.from('token_badge'), new PublicKey(qm).toBuffer()], DYNAMIC_BONDING_CURVE_PROGRAM_ID), ai = await conn.getAccountInfo(b).catch(() => null);
  const ok = !!ai && ai.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID); badgeC.set(qm, { ok, at: Date.now() }); return ok; }
async function quoteAllowed(qm) {
  if (qm === WSOL || STABLE.has(qm) || QUOTE_OVERRIDE[qm] != null) return true; if (await hasBadge(qm)) return true; if (!MAINNET) return false; const h = qOk.get(qm); if (h && Date.now() - h.at < 864e5) return h.ok;
  let ok = false, got = false; try { const j = await (await fetchT(JUP + '/tokens/v2/search?query=' + qm)).json(), t = Array.isArray(j) ? j.find((x) => x.id === qm) : null; got = Array.isArray(j); ok = !!(t && (t.isVerified || (t.tags || []).includes('verified')) && (t.liquidity || 0) >= 1e5); } catch {}
  if (got) qOk.set(qm, { ok, at: Date.now() }); else if (!ok) throw new Error('pair check unavailable');   // a failed lookup is retried, never cached as "not allowed"
  return ok;
}
// an uploaded image must really be a PNG / JPEG / GIF / WEBP (checked by its bytes, not its label) and not too big
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46], webp: [0x52, 0x49, 0x46, 0x46] };
function realImage(v, maxBytes) { const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof v === 'string' ? v : ''); if (!m) return false; const b = Buffer.from(m[2], 'base64');
  return b.length > 12 && b.length <= maxBytes && MAGIC[m[1]].every((x, i) => b[i] === x) && (m[1] !== 'webp' || b.subarray(8, 12).toString() === 'WEBP'); }
// coin images: fetched once from IPFS (slow public gateways) and served from here with a long browser cache
run('CREATE TABLE IF NOT EXISTS pinc(h TEXT PRIMARY KEY, url TEXT, at INT)');   // pin dedupe: sha256 of content → IPFS URL
run('CREATE TABLE IF NOT EXISTS cimg(mint TEXT, b INT, ct TEXT, data BLOB, at INT, PRIMARY KEY(mint, b))');
const imgBusy = new Map();
function ipfsUrls(u) { const m = String(u || '').match(/\/ipfs\/([A-Za-z0-9]+)(\/[^?#]*)?/) || String(u || '').match(/^ipfs:\/\/([A-Za-z0-9]+)(\/[^?#]*)?/); if (!m) return /^https:\/\//.test(u) ? [u] : []; const path = m[1] + (m[2] || ''); return [PINATA_GW + '/ipfs/' + path, 'https://ipfs.io/ipfs/' + path, 'https://gateway.pinata.cloud/ipfs/' + path].filter((x, i, a) => a.indexOf(x) === i); }
const badHost = (h) => /^(\d+\.){3}\d+$|^\[|localhost|\.internal$|\.local$|^metadata\./i.test(h) || !h.includes('.');
// any address that isn't plain public unicast is refused (private, loopback, link-local, CGNAT, benchmark 198.18/15, documentation,
// multicast/reserved, NAT64 64:ff9b::/96 + 64:ff9b:1::/48, 6to4, IPv4-mapped/-compatible IPv6 → checked as the embedded IPv4)
const PRIV4 = new net.BlockList(), PRIV6 = new net.BlockList();
for (const c of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/3']) { const [a, b] = c.split('/'); PRIV4.addSubnet(a, +b, 'ipv4'); }
for (const c of ['::/96', '::ffff:0:0/96', '64:ff9b::/96', '64:ff9b:1::/48', '100::/64', '2001::/23', '2001:db8::/32', '2002::/16', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8']) { const [a, b] = c.split('/'); PRIV6.addSubnet(a, +b, 'ipv6'); }
const privIp = (a0) => { const a = String(a0 || '').trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (net.isIPv4(a)) return PRIV4.check(a, 'ipv4'); if (!net.isIPv6(a)) return true;
  let l; try { l = new URL('http://[' + a + ']').hostname.slice(1, -1).toLowerCase(); } catch { return true; }   // canonical form
  const m = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(l) || /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(l);   // embedded IPv4
  if (m) { const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16); if (PRIV4.check([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'), 'ipv4')) return true; }
  return PRIV6.check(l, 'ipv6'); };
async function hostOk(h) { if (badHost(h)) return false; try { const as = await dns.lookup(h, { all: true }); return as.length > 0 && !as.some((a) => privIp(a.address)); } catch { return false; } }   // a public name pointing at an internal address is refused too
// the connection itself uses this lookup: the address that is checked IS the address connected to (no DNS-rebinding window between check and fetch)
function safeLookup(host, opts, cb) { if (typeof opts === 'function') { cb = opts; opts = {}; }
  dnsCb.lookup(host, { all: true }, (err, as) => { if (err) return cb(err); const ok = (as || []).filter((a) => !privIp(a.address));
    if (!ok.length || ok.length !== as.length) return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
    const fam = opts.family === 4 || opts.family === 6 ? ok.filter((a) => a.family === opts.family) : ok; if (!fam.length) return cb(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }));
    if (opts.all) cb(null, fam); else cb(null, fam[0].address, fam[0].family); }); }
function pinnedGet(href, ms) { return new Promise((ok, no) => {
  const req = https.request(new URL(href), { method: 'GET', lookup: safeLookup, signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'treid-indexer', accept: '*/*', 'accept-encoding': 'identity' } }, (res) => {
    const h = new Headers(); for (const [k, v] of Object.entries(res.headers)) if (v != null) { try { h.set(k, Array.isArray(v) ? v.join(', ') : String(v)); } catch {} }
    const st = res.statusCode || 502, noBody = st < 200 || st === 204 || st === 304 || st >= 300 && st < 400; if (noBody) res.resume();
    try { ok(new Response(noBody ? null : Readable.toWeb(res), { status: st < 200 || st > 599 ? 502 : st, headers: h })); } catch (e) { res.destroy(); no(e); } });
  req.on('error', no); req.end(); }); }
async function fetchSafe(x, ms) { let u = x; for (let hop = 0; hop < 4; hop++) { const url = new URL(u); if (url.protocol !== 'https:' || !(await hostOk(url.hostname))) return null;   // every redirect hop is checked again
    const r = await pinnedGet(u, ms); if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u).href; continue; } return r; } return null; }
async function fetchAny(urls, ms = 12e3) { for (const x of urls) { try { const r = await fetchSafe(x, ms); if (r && r.ok) return r; } catch {} } return null; }
// what an image really is, from its first bytes (many hosts send logos as octet-stream / text/plain); SVG is served only as an image with a strict CSP
function imgType(buf, hdr) { const h = buf.subarray(0, 16), a = (i) => h[i];
  if (a(0) === 0x89 && a(1) === 0x50 && a(2) === 0x4e && a(3) === 0x47) return 'image/png'; if (a(0) === 0xff && a(1) === 0xd8) return 'image/jpeg';
  if (a(0) === 0x47 && a(1) === 0x49 && a(2) === 0x46) return 'image/gif'; if (h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  const head = buf.subarray(0, 600).toString('utf8').trimStart().toLowerCase(); if ((hdr === 'image/svg+xml' || /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(head)) && head.includes('<svg')) return 'image/svg+xml';
  return null; }
async function readCapped(r, max) { const len = +(r.headers.get('content-length') || 0); if (len > max) { try { r.body?.cancel(); } catch {} return null; }   // never hold more than `max` bytes of someone's file in memory
  const rd = r.body.getReader(), parts = []; let n = 0; for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > max) { try { rd.cancel(); } catch {} return null; } parts.push(value); } return Buffer.concat(parts); }
const IMG_MAX = 6e6, IMG_QUOTA = 400e6, memImg = new Map(); let memImgB = 0; let imgTot = { v: 0, at: 0 };
const imgTotal = () => { if (Date.now() - imgTot.at > 10 * 60e3) { imgTot = { v: q1('SELECT COALESCE(SUM(LENGTH(data)),0) s FROM cimg').s, at: Date.now() }; } return imgTot.v; };
const imgMiss = (mint, ban) => { try { run('INSERT OR REPLACE INTO cimg(mint,b,ct,data,at) VALUES(?,?,?,?,?)', mint, ban, null, null, Date.now()); } catch {} return null; };
function coinImage(mint, ban) {
  const row = q1('SELECT ct, data, at FROM cimg WHERE mint=? AND b=?', mint, ban); if (row && row.data) return Promise.resolve({ ct: row.ct, data: Buffer.from(row.data) });
  const mm = memImg.get(mint + '|' + ban); if (mm) { memImg.delete(mint + '|' + ban); memImg.set(mint + '|' + ban, mm); return Promise.resolve(mm); }   // over the disk quota: recently used images live in memory (LRU, 80 MB)
  if (row && Date.now() - row.at < 10 * 60e3) return Promise.resolve(null);   // remembered miss: retry in 10 min
  const k = mint + '|' + ban; if (imgBusy.has(k)) return imgBusy.get(k);
  const pr = (async () => { const c = q1('SELECT uri FROM coins WHERE mint=?', mint); if (!c?.uri) return null;
    const mr = await fetchAny(ipfsUrls(c.uri)); let meta = null; try { const mb = mr && await readCapped(mr, 64e3); meta = mb && JSON.parse(mb.toString('utf8')); } catch {} const src = meta && (ban ? meta.banner : meta.image); if (typeof src !== 'string') return imgMiss(mint, ban);
    const r = await fetchAny(ipfsUrls(src), 20e3); const ct = r && String(r.headers.get('content-type') || '').split(';')[0];
    if (!r || !/^image\/(png|jpe?g|gif|webp)$/.test(ct)) return imgMiss(mint, ban);
    const buf = await readCapped(r, IMG_MAX); if (!buf) return imgMiss(mint, ban);
    if (imgTotal() + buf.length < IMG_QUOTA) { run('INSERT OR REPLACE INTO cimg(mint,b,ct,data,at) VALUES(?,?,?,?,?)', mint, ban, ct, buf, Date.now()); imgTot.v += buf.length; }
    else { memImg.set(mint + '|' + ban, { ct, data: buf }); memImgB += buf.length; for (const [k2, v2] of memImg) { if (memImgB <= 80e6) break; memImg.delete(k2); memImgB -= v2.data.length; } }   // the disk also holds the money ledger: images never fill it
    return { ct, data: buf }; })().catch(() => imgMiss(mint, ban)).finally(() => imgBusy.delete(k));
  imgBusy.set(k, pr); return pr;
}
// copycat ("vamp") detection: a coin whose ticker or name folds to the same thing as an OLDER treid coin gets flagged, never blocked
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '$': 's', '@': 'a', '!': 'i' };
function fold(x) { return String(x || '').replace(/^\s*\$+/, '').trim().toLowerCase().replace(/\s+/g, ' '); }   // 1:1 only (case and spaces ignored)
const tickOf = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);   // the ticker the site shows ("PEPE." and "PEPE" are the same $PEPE)
let vampMap = null, vampAt = 0;
function vampOf(mint) {
  if (!vampMap || Date.now() - vampAt > 60e3) { vampMap = new Map(); vampAt = Date.now(); const first = new Map();
    for (const c of q('SELECT mint, symbol, name, created_at FROM coins ORDER BY created_at ASC')) { if (HIDDEN.has(c.mint)) continue;
      const keys = [...new Set([fold(c.symbol), fold(c.name), tickOf(c.symbol).length >= 2 ? 't:' + tickOf(c.symbol) : ''].filter((k) => k.length >= 2))]; let hit = null;
      for (const k of keys) { const o = first.get(k); if (o && o.mint !== c.mint) { hit = o; break; } }
      if (hit) vampMap.set(c.mint, { mint: hit.mint, symbol: hit.symbol, name: hit.name });
      for (const k of keys) if (!first.has(k)) first.set(k, c); } }
  return vampMap.get(mint) || null;
}
async function addCoin(mint, slot, ts, creator, poolAddr = null) {   // returns true (indexed), false (not a treid coin) or 'retry' (an RPC error — try again later, never "not ours")
  let transient = false; const softErr = () => { transient = true; return null; };
  let r; try { r = await addCoin0(mint, slot, ts, creator, poolAddr, softErr); } catch (e) { console.log('addCoin retry later', mint.slice(0, 6), String(e?.message || e).slice(0, 80)); return 'retry'; }
  return r ? r : transient ? 'retry' : false;
}
async function addCoin0(mint, slot, ts, creator, poolAddr, softErr) {
  if (q1('SELECT 1 FROM coins WHERE mint=?', mint)) return true;
  let ps = null;
  if (poolAddr) { const a = await dbc.state.getPool(new PublicKey(poolAddr)).catch(softErr); if (a && (a.poolState || a).baseMint?.toBase58() === mint) ps = { publicKey: new PublicKey(poolAddr), account: a }; }   // one cheap account read
  else ps = await dbc.state.getPoolByBaseMint(new PublicKey(mint)).catch(softErr);
  if (!ps) return false;
  const pst = ps.account.poolState || ps.account; const cfg = pst.config.toBase58(); if (PARTNER && !configs.has(cfg) && !(await addConfig(cfg))) return false;
  const cf = await dbc.state.getPoolConfig(pst.config).catch(softErr), bf = cf?.poolFees?.baseFee;
  const trap = bf && Number(bf.baseFeeMode) <= 1 ? { bps: Math.round(Number(bf.cliffFeeNumerator) / 1e5), secs: Number(bf.firstFactor) * Number(bf.secondFactor), steps: Number(bf.firstFactor) } : { bps: 0, secs: 0, steps: 0 };
  if (!creator) {   // seen first via a trade: find the pool's creation tx and read the creator from its DBC instruction
    try { let before, oldest = null; for (let i = 0; i < 20; i++) { const pg = await conn.getSignaturesForAddress(ps.publicKey, { before, limit: 1000 }, 'confirmed'); if (!pg.length) break; oldest = pg[pg.length - 1]; if (pg.length < 1000) break; before = oldest.signature; }
      if (oldest) { const t0 = await conn.getTransaction(oldest.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); const it = t0 && poolInits(t0).find((x) => x.mint === mint); if (it) { creator = it.creator; slot = t0.slot; ts = (t0.blockTime || 0) * 1000 || ts; } } } catch {}
    if (!creator) return false;   // never guess a creator
  }
  const md = await getTokenMetadata(conn, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(softErr);
  const qm = cf ? cf.quoteMint.toBase58() : WSOL; let qd = 9, qs = KNOWN_Q[qm] || null; if (!cf || !(await quoteAllowed(qm))) { console.log('skip  pair token not allowed', mint); return false; }
  if (qm !== WSOL) { const qa = await conn.getAccountInfo(new PublicKey(qm)).catch(softErr); const qprog = qa?.owner?.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined; const qmi = await getMint(conn, new PublicKey(qm), 'confirmed', qprog).catch(softErr); if (!qmi) return false; qd = qmi.decimals;   // never guess decimals
    if (!qs) { const qmd = qprog ? await getTokenMetadata(conn, new PublicKey(qm), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(() => null) : null; qs = qmd?.symbol || null;
      if (!qs) { try { const j = await (await fetchT(JUP + '/tokens/v2/search?query=' + qm)).json(), t0 = Array.isArray(j) ? j.find((x) => x.id === qm) : null; if (t0 && typeof t0.symbol === 'string') qs = t0.symbol.slice(0, 16); } catch {} }   // plain SPL pair tokens (ZEC…) keep their name in Metaplex: Jupiter's list has it
      if (!qs) qs = qm.slice(0, 4); } }
  const m = await getMint(conn, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(softErr); const tf = m && getTransferFeeConfig(m);
  // the coin itself: 6 decimals, nobody can mint or freeze, and only the extensions treid uses (no hooks, delegates or other surprises)
  const OKX = new Set([ExtensionType.TransferFeeConfig, ExtensionType.MetadataPointer, ExtensionType.TokenMetadata]);
  if (!m || m.decimals !== 6 || m.mintAuthority || m.freezeAuthority || getExtensionTypes(m.tlvData).some((e) => !OKX.has(e))) { console.log('skip  non-standard coin', mint); return false; }
  const tfa = tf?.transferFeeConfigAuthority; if (tfa && !tfa.equals(PublicKey.default) && tfa.toBase58() !== deriveDbcPoolAuthority().toBase58()) { console.log('skip  tax can be changed by someone', mint); return false; }   // nobody but the program may ever change the tax
  if (qm !== WSOL) { const qa = await conn.getAccountInfo(new PublicKey(qm)).catch(softErr); if (qa?.owner?.equals(TOKEN_2022_PROGRAM_ID)) { const qmi = await getMint(conn, new PublicKey(qm), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(softErr); const QOK = new Set([ExtensionType.MetadataPointer, ExtensionType.TokenMetadata, ExtensionType.ImmutableOwner]); const tfq = qmi && getTransferFeeConfig(qmi), taxed = tfq && (tfq.newerTransferFee.transferFeeBasisPoints > 0 || tfq.olderTransferFee.transferFeeBasisPoints > 0);
    const qx = qmi ? getExtensionTypes(qmi.tlvData) : [], hk = qx.includes(ExtensionType.TransferHook) ? getTransferHook(qmi) : null, hookLive = !!hk && !hk.programId.equals(PublicKey.default) && !hk.programId.equals(SystemProgram.programId);   // an empty hook (xStocks…) runs nothing
    if (!qmi || hookLive || ((taxed || qx.some((e) => !QOK.has(e))) && !(await hasBadge(qm)))) { console.log('skip  pair token not allowed', mint); return false; } } }   // extra features or its own transfer fee only with Meteora's badge; never a live hook   // extra features only with Meteora's badge; never taxed or hooked
  const ins = run('INSERT OR IGNORE INTO coins(mint,pool,config,creator,name,symbol,uri,tax_bps,created_slot,created_at,trap_bps,trap_secs,trap_steps,quote_mint,quote_dec,quote_symbol) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', mint, ps.publicKey.toBase58(), cfg, creator || pst.creator.toBase58(), md?.name || '', md?.symbol || '', md?.uri || '', tf ? tf.newerTransferFee.transferFeeBasisPoints : 0, creator ? slot : 0, creator || !cf || Number(cf.activationType) !== 1 ? ts : Number(pst.activationPoint) * 1000, trap.bps, trap.secs, trap.steps, qm, qd, qs || 'SOL');
  if (ins.changes) setTimeout(() => { coinImage(mint, 0); coinImage(mint, 1); }, 4000);   // warm the image cache so the first visitor doesn't wait on IPFS
  if (ins.changes) { push({ type: 'coin', mint, name: md?.name, symbol: md?.symbol }); console.log('coin  ', md?.symbol, mint); } return true;
}
// pool creations, read from the DBC instruction itself (accounts: 2 = creator, 3 = base_mint) — never from fee payer / logs / balances
const INIT_DISC = DynamicBondingCurveIdl.instructions.filter((i) => /^initialize_virtual_pool/.test(i.name) && !/transfer_hook/.test(i.name)).map((i) => Buffer.from(i.discriminator).toString('hex'));
function poolInits(tx) {
  const msg = tx.transaction.message, keys = msg.getAccountKeys ? msg.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }) : null, key = (i) => (keys ? keys.get(i) : msg.accountKeys[i]).toBase58(), DBC = DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(), out = [];
  const check = (pid, accts, data) => { if (key(pid) !== DBC || !data || data.length < 8) return; if (!INIT_DISC.includes(Buffer.from(data.subarray(0, 8)).toString('hex'))) return; out.push({ creator: key(accts[2]), mint: key(accts[3]), pool: key(accts[5]), config: key(accts[0]) }); };
  for (const ix of msg.compiledInstructions || []) check(ix.programIdIndex, ix.accountKeyIndexes, Buffer.from(ix.data));
  for (const g of tx.meta.innerInstructions || []) for (const ix of g.instructions) { try { check(ix.programIdIndex, ix.accounts, Buffer.from(bs58.decode(ix.data))); } catch {} }
  return out;
}
// ---- transaction processing: everything is read from decoded Meteora instructions/events, never from log text ----
const DBC_ID = DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(), discOf = (n) => Buffer.from(DynamicBondingCurveIdl.instructions.find((i) => i.name === n).discriminator).toString('hex');
const SWAP_DISC = new Set(['swap', 'swap2'].map(discOf)), CFG_DISCS = new Set(['create_config', 'create_config2'].map(discOf));
const badPool = new Map();   // pools we looked up and rejected (not treid) — never looked up again for a day
const AMM_ID = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG', AMM_SWAP = new Set(CpAmmIdl.instructions.filter((i) => i.name === 'swap' || i.name === 'swap2').map((i) => Buffer.from(i.discriminator).toString('hex')));
const MIG_DISC = new Set(DynamicBondingCurveIdl.instructions.filter((i) => /^migrat/.test(i.name)).map((i) => Buffer.from(i.discriminator).toString('hex')));
const DAMM_CFG = DAMM_V2_MIGRATION_FEE_ADDRESS[6];
// graduation: the curve migrated into its DAMM v2 pool → remember the pool, watch it, index its trades like curve trades
async function checkGrad(c) {
  const known = q1('SELECT damm FROM coins WHERE mint=?', c.mint)?.damm; if (known) return known; const a = await dbc.state.getPool(new PublicKey(c.pool)).catch(() => null), vp = a && (a.poolState || a); if (!vp || !(Number(vp.isMigrated?.toString?.() ?? vp.isMigrated) > 0)) return null;
  const pool = deriveDammV2PoolAddress(DAMM_CFG, new PublicKey(c.mint), new PublicKey(c.quote_mint || WSOL)), ps = await amm.fetchPoolState(pool).catch(() => null);
  if (!ps || ps.tokenAMint.toBase58() !== c.mint || ps.tokenBMint.toBase58() !== (c.quote_mint || WSOL)) return null;
  const k = pool.toBase58(); if (q1('SELECT damm FROM coins WHERE mint=?', c.mint)?.damm) return k; run('UPDATE coins SET damm=? WHERE mint=?', k, c.mint); unwatch(c.config); watch(k); push({ type: 'grad', mint: c.mint, damm: k }); console.log('grad  ', c.symbol, '→ DAMM v2', k);
  setTimeout(() => syncAddress(k, 1e9).catch(() => {}), 1000); return k;
}
function dbcIxs(tx, keys, pid0 = DBC_ID) {   // every instruction of one program in the tx (top-level and inner), with resolved account addresses
  const out = [], key = (i) => keys.get(i)?.toBase58(), add = (pid, accts, data) => { if (key(pid) !== pid0 || !data || data.length < 8) return; out.push({ disc: Buffer.from(data.subarray(0, 8)).toString('hex'), accts: accts.map(key), data }); };
  for (const ix of tx.transaction.message.compiledInstructions || []) add(ix.programIdIndex, ix.accountKeyIndexes, Buffer.from(ix.data));
  for (const g of tx.meta.innerInstructions || []) for (const ix of g.instructions) { try { add(ix.programIdIndex, ix.accounts, Buffer.from(bs58.decode(ix.data))); } catch {} }
  return out;
}
const retryN = new Map();
async function handle(sig) {
  if (q1('SELECT 1 FROM seen WHERE sig=?', sig)) return;
  const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
  if (!tx) { const n = (retryN.get(sig) || 0) + 1; if (n <= 6) { retryN.set(sig, n); setTimeout(() => enqueue(sig), 2000 * n); } else retryN.delete(sig); return; }   // the RPC can lag the websocket by a few seconds: look again
  retryN.delete(sig);
  if (tx.meta?.err) { run('INSERT OR IGNORE INTO seen VALUES(?)', sig); return; }
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }), ts = (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000, ixs = dbcIxs(tx, keys);
  for (const x of ixs) if (CFG_DISCS.has(x.disc) && x.accts[0]) await addConfig(x.accts[0]);   // a new treid config: account 0 of create_config
  const coId = coMemoOf(tx, keys);   // bought from a callout on treid? (memo inside the buyer's own transaction)
  let again = false; const inits = poolInits(tx); for (const it of inits) if ((await addCoin(it.mint, tx.slot, ts, it.creator, it.pool)) === 'retry') again = true;
  for (const x of ixs) if (MIG_DISC.has(x.disc)) for (const a of x.accts) { const c = a && q1('SELECT * FROM coins WHERE pool=?', a); if (c && !c.damm) setTimeout(() => checkGrad(c).catch(() => {}), 1500); }
  // swap events emitted by the DBC program itself (CPI through its event authority — can't be faked); the LAST one per pool wins
  const evs = []; for (const g of tx.meta.innerInstructions || []) for (const ix of g.instructions) { if (keys.get(ix.programIdIndex)?.toBase58() !== DBC_ID) continue; try { const e = coder.decode(Buffer.from(bs58.decode(ix.data)).subarray(8).toString('base64')); if (e && (e.name === 'EvtSwap2' || e.name === 'EvtSwap3')) evs.push(e); } catch {} }
  const byPool = new Map(); for (const e of evs) byPool.set(e.data.pool.toBase58(), e);
  let n = 0;
  for (const [pool, ev] of byPool) {
    let coin = q1('SELECT * FROM coins WHERE pool=?', pool);
    if (!coin) { if (Date.now() - (badPool.get(pool) || 0) < 864e5) continue;   // unknown pool: one cheap account read, then remember the answer
      const ps = await dbc.state.getPool(new PublicKey(pool)).catch(() => null), bm = ps && (ps.poolState || ps).baseMint?.toBase58();
      const ac = bm ? await addCoin(bm, tx.slot, ts, null, pool) : (ps === null ? 'retry' : false); if (ac === 'retry') { again = true; continue; }
      if (!ac) { badPool.set(pool, Date.now()); if (badPool.size > 100000) badPool.clear(); continue; } coin = q1('SELECT * FROM coins WHERE pool=?', pool); if (!coin) continue; }
    const sw = ixs.filter((x) => SWAP_DISC.has(x.disc) && x.accts[2] === pool).pop(), trader = sw?.accts[9]; if (!trader) continue;   // the swap's own payer account = the trader
    const QD = 10 ** (coin.quote_dec ?? 9), QU = await quoteUsdAt(coin.quote_mint || WSOL, coin.quote_symbol, ts), tax = (coin.tax_bps || 0) / 1e4, buy = Number(ev.data.trade_direction) === 1, circ = SUPPLY - await burnedOf(coin.mint);
    if (!gradTarget.has(coin.mint) && coin.config) { const cf = await dbc.state.getPoolConfig(new PublicKey(coin.config)).catch(() => null); if (cf) gradTarget.set(coin.mint, Number(cf.migrationQuoteThreshold.toString()) / QD); }   // newer swap events don't carry the threshold
    let inAmt, outAmt, fee, sq, reserveRaw, targetRaw;
    if (ev.name === 'EvtSwap2') { const r = ev.data.swap_result; inAmt = Number(r.included_fee_input_amount); outAmt = Number(r.output_amount); fee = Number(r.trading_fee); sq = r.next_sqrt_price; reserveRaw = Number(ev.data.quote_reserve_amount); targetRaw = Number(ev.data.migration_threshold); }
    else { inAmt = Number(ev.data.included_transfer_fee_amount_in); outAmt = Number(ev.data.excluded_transfer_fee_amount_out); fee = Number(ev.data.trading_fee); sq = ev.data.next_sqrt_price; reserveRaw = Number(ev.data.quote_reserve); targetRaw = gradTarget.get(coin.mint) * QD || 0; }
    const side = buy ? 'buy' : 'sell', sol = (buy ? inAmt : outAmt) / QD, tokens = buy ? outAmt / 1e6 * (ev.name === 'EvtSwap2' ? 1 - tax : 1) : inAmt / 1e6;   // tokens the trader actually got / gave
    const price = sq ? Number(getPriceFromSqrtPrice(sq, 6, coin.quote_dec ?? 9)) * QU : (tokens ? sol * QU / tokens : 0);
    const prog = targetRaw ? reserveRaw / targetRaw * 100 : (q1('SELECT progress p FROM trades WHERE mint=? ORDER BY ts DESC LIMIT 1', coin.mint)?.p || 0), reserve = reserveRaw / QD;
    if (targetRaw && !gradTarget.has(coin.mint)) gradTarget.set(coin.mint, targetRaw / QD);
    const trapEnd = coin.trap_secs > 0 ? coin.created_at + coin.trap_secs * 1000 : 0;   // bots that wait out the sniper trap land in the very first second after it ends (a person clicking + approving in a wallet takes several seconds) — they count as snipers too
    const sniper = buy && trader !== coin.creator && ((coin.created_slot > 0 ? tx.slot - coin.created_slot <= 4 : ts - coin.created_at <= 2000) || (trapEnd && ts >= trapEnd && ts - trapEnd <= 1000)) ? 1 : 0;   // ~1.5s after launch: faster than a human
    const rowSig = n++ ? sig + '#' + coin.mint.slice(0, 6) : sig;
    run('INSERT OR IGNORE INTO trades(sig,mint,wallet,side,sol,tokens,price_usd,mcap_usd,slot,ts,sniper,bundle,fee_sol,progress,usd,reserve) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)', rowSig, coin.mint, trader, side, sol, tokens, price, price * circ, tx.slot, ts, sniper, fee / QD, Math.min(100, prog), sol * QU, reserve);
    if (SYSW.has(trader)) run('UPDATE trades SET sys=1 WHERE sig=?', rowSig);   // treid's own wallets (tax sales, buybacks) never count as market activity
    if (coId && buy && CR) CR.attr({ sig: rowSig, id: coId, trader, coin, ts, usd: sol * QU, sys: SYSW.has(trader), treidFeeLam: Math.min(fee * 0.5, inAmt * (tax > 0 ? 0.002 : 0.004)) });   // treid's half of the trading fee (Meteora's cut is separate), never more than the normal rate (sniper-trap fees don't count)
    // bundle = several different wallets buying in the same slot right after launch (where coordinated buys matter)
    if (buy && coin.created_slot > 0 && tx.slot - coin.created_slot <= 20) { const same = q("SELECT DISTINCT wallet FROM trades WHERE mint=? AND slot=? AND side='buy' AND wallet!=?", coin.mint, tx.slot, coin.creator); if (same.length >= 3) run("UPDATE trades SET bundle=1 WHERE mint=? AND slot=? AND side='buy' AND wallet!=?", coin.mint, tx.slot, coin.creator); }
    const t = q1('SELECT * FROM trades WHERE sig=?', rowSig); if (t) push({ type: 'trade', ...t, symbol: coin.symbol });
    console.log('trade ', coin.symbol, side.padEnd(4), sol.toFixed(3), coin.quote_symbol || 'SOL', tokens.toFixed(0), sniper ? 'SNIPER' : '', t?.bundle ? 'BUNDLE' : '');
  }
  // graduated coins: swap events from the DAMM v2 program, only for pools we recorded at graduation (never discovered from a trade)
  const aixs = dbcIxs(tx, keys, AMM_ID), aev = new Map();
  if (aixs.length) for (const g of tx.meta.innerInstructions || []) for (const ix of g.instructions) { if (keys.get(ix.programIdIndex)?.toBase58() !== AMM_ID) continue; try { const e = ammCoder.decode(Buffer.from(bs58.decode(ix.data)).subarray(8).toString('base64')); if (e?.name === 'EvtSwap2') aev.set(e.data.pool.toBase58(), e); } catch {} }
  for (const [pool, ev] of aev) {
    const coin = q1('SELECT * FROM coins WHERE damm=?', pool); if (!coin) continue;
    const trader = aixs.filter((x) => AMM_SWAP.has(x.disc) && x.accts[1] === pool).pop()?.accts[8]; if (!trader) continue;   // the swap's payer
    const QD = 10 ** (coin.quote_dec ?? 9), QU = await quoteUsdAt(coin.quote_mint || WSOL, coin.quote_symbol, ts), d = ev.data, r = d.swap_result, buy = Number(d.trade_direction) === 1, circ = SUPPLY - await burnedOf(coin.mint);   // tokenA = coin, tokenB = pair: B→A is a buy
    const sol = Number(buy ? d.included_transfer_fee_amount_in : d.excluded_transfer_fee_amount_out) / QD, tokens = Number(buy ? d.excluded_transfer_fee_amount_out : d.included_transfer_fee_amount_in) / 1e6;
    const fee = ['claiming_fee', 'protocol_fee', 'compounding_fee', 'referral_fee'].reduce((a, k) => a + Number(r[k] || 0), 0), price = Number(ammPrice(r.next_sqrt_price, 6, coin.quote_dec ?? 9)) * QU, side = buy ? 'buy' : 'sell';
    const rowSig = n++ ? sig + '#' + coin.mint.slice(0, 6) : sig;
    run('INSERT OR IGNORE INTO trades(sig,mint,wallet,side,sol,tokens,price_usd,mcap_usd,slot,ts,sniper,bundle,fee_sol,progress,usd,reserve) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,100,?,?)', rowSig, coin.mint, trader, side, sol, tokens, price, price * circ, tx.slot, ts, fee / QD, sol * QU, Number(d.reserve_b_amount) / QD);
    if (SYSW.has(trader)) run('UPDATE trades SET sys=1 WHERE sig=?', rowSig);
    if (coId && buy && CR) CR.attr({ sig: rowSig, id: coId, trader, coin, ts, usd: sol * QU, sys: SYSW.has(trader), treidFeeLam: Math.min(fee * 0.4, sol * QD * (cfgFee.get(coin.config) || 50) / 1e4 * 0.4) });   // treid's LP half of the pool fee after Meteora's 20%
    const t = q1('SELECT * FROM trades WHERE sig=?', rowSig); if (t) push({ type: 'trade', ...t, symbol: coin.symbol });
    console.log('trade ', coin.symbol, side.padEnd(4), sol.toFixed(3), coin.quote_symbol || 'SOL', tokens.toFixed(0), '(DAMM)');
  }
  if (again) { const n = (retryN.get(sig) || 0) + 1; if (n <= 6) { retryN.set(sig, n); setTimeout(() => enqueue(sig), 5000 * n); } return; }   // RPC hiccup: look again, don't mark seen
  run('INSERT OR IGNORE INTO seen VALUES(?)', sig);   // only after it was fully processed
}
// bounded concurrency for websocket-triggered work (a flood of notifications can't fan out into unlimited RPC calls)
const queue = []; let active = 0; const MAXQ = 5000;
function enqueue(sig) { if (queue.length >= MAXQ) return; queue.push(sig); pump(); }
function pump() { while (active < 4 && queue.length) { const s = queue.shift(); active++; handle(s).catch((e) => console.log('err', String(e?.message || e).slice(0, 120))).finally(() => { active--; pump(); }); } }
async function backfill() {   // rebuilds everything from chain, so the server can run without a persistent disk
  if (SYSW.size) run(`UPDATE trades SET sys=1 WHERE sys=0 AND wallet IN (${[...SYSW].map(() => '?').join(',')})`, ...SYSW);
  await loadConfigs();
  for (const w of PARTNERS) await syncAddress(w, 2000).catch(() => {});   // configs created recently (also found by the scan above)
  for (const k of configs) await syncAddress(k, 1e9);   // FULL history (paged); with a persistent disk only the new part is fetched
  for (const c of q(`SELECT c.* FROM coins c WHERE c.damm IS NOT NULL OR (SELECT progress FROM trades t WHERE t.mint=c.mint ORDER BY ts DESC, slot DESC LIMIT 1) >= 99`)) { const k = c.damm || await checkGrad(c).catch(() => null); if (k) await syncAddress(k, 1e9); }   // graduated coins' DAMM trades
  // user burns made through treid carry a "treid:burn" memo: find them in each coin's history so the 70% rule never mistakes a burn for a sale
  run('CREATE TABLE IF NOT EXISTS bscan(mint TEXT PRIMARY KEY, until TEXT)');   // how far each coin's history was already scanned for burn memos
  for (const c of q('SELECT mint FROM coins')) { let before; const until = q1('SELECT until FROM bscan WHERE mint=?', c.mint)?.until || undefined; let newest = null;
    for (let i = 0; i < 10; i++) { const pg = await conn.getSignaturesForAddress(new PublicKey(c.mint), { limit: 1000, before, until }, 'confirmed').catch(() => []); if (!pg.length) break; if (!newest) newest = pg[0].signature;
    for (const x of pg) if (!x.err && /treid:burn:/.test(x.memo || '') && !q1('SELECT 1 FROM uburn WHERE sig=?', x.signature)) await verifyBurn(x.signature).catch(() => {});
    if (pg.length < 1000) break; before = pg[pg.length - 1].signature; }
    if (newest) run('INSERT OR REPLACE INTO bscan VALUES(?,?)', c.mint, newest); }
}
// ---- API ----
const TF = { '1m': 60e3, '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
function candles(mint, tf) {
  const b = TF[tf] || 60e3, rows = q('SELECT ts, mcap_usd m, sol FROM (SELECT ts, slot, mcap_usd, sol FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 20000) ORDER BY ts, slot', mint), out = [];
  for (const r of rows) { const k = Math.floor(r.ts / b) * b, c = out[out.length - 1]; if (c && c.t === k) { c.h = Math.max(c.h, r.m); c.l = Math.min(c.l, r.m); c.c = r.m; c.v += r.sol; } else { const o = c ? c.c : r.m; out.push({ t: k, o, h: Math.max(o, r.m), l: Math.min(o, r.m), c: r.m, v: r.sol }); } }
  return out;
}
// a wallet's position in a coin, like pump.fun shows it: value now, spent, received, avg entry market cap, % of its buys sold, supply held, profit
function posStats(mint, wallet, held = null) {
  const r = q1(`SELECT COALESCE(SUM(CASE WHEN side='buy' THEN usd END),0) spent, COALESCE(SUM(CASE WHEN side='sell' THEN usd END),0) got, COALESCE(SUM(CASE WHEN side='buy' THEN tokens END),0) bought,
    COALESCE(SUM(CASE WHEN side='sell' THEN tokens END),0) sold, COALESCE(SUM(CASE WHEN side='buy' THEN tokens*mcap_usd END),0) wmc, COALESCE(SUM(CASE WHEN side='sell' THEN tokens*mcap_usd END),0) smc,
    COALESCE(SUM(CASE WHEN side='buy' AND usd>0 AND sol>0 THEN tokens*mcap_usd*sol/usd END),0) wmq, COALESCE(SUM(CASE WHEN side='buy' AND usd>0 AND sol>0 THEN tokens END),0) bq,
    COALESCE(SUM(CASE WHEN side='sell' AND usd>0 AND sol>0 THEN tokens*mcap_usd*sol/usd END),0) smq, COALESCE(SUM(CASE WHEN side='sell' AND usd>0 AND sol>0 THEN tokens END),0) sq, COUNT(*) n FROM trades WHERE mint=? AND wallet=?`, mint, wallet);
  const px = q1('SELECT price_usd p FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 1', mint)?.p || 0;
  if (held == null) { const lh = hCache.get(mint)?.list; const h = lh && lh.find((x) => x.wallet === wallet); held = h ? h.pct / 100 * SUPPLY : Math.max(0, r.bought - r.sold); }
  const cRow = q1('SELECT tax_bps, quote_mint, quote_symbol, quote_dec FROM coins WHERE mint=?', mint) || {}, sellTax = (cRow.tax_bps || 0) / 1e4;
  let rewardsUsd = 0; try { for (const h of q('SELECT token, SUM(amt) a, MAX(dec) d FROM hpay WHERE mint=? AND wallet=? AND token != ? GROUP BY token', mint, wallet, mint)) rewardsUsd += h.a / 10 ** (h.d ?? 9) * (h.token === cRow.quote_mint ? quoteUsd(cRow.quote_mint, cRow.quote_symbol) : quoteUsd(h.token)); } catch {}   // paid in SOL / the pair / another token
  const value = held * px * (1 - sellTax), profit = value + r.got + rewardsUsd - r.spent;   // value = what selling now would bring (after the coin's tax)
  return { value, spent: r.spent, got: r.got, rewardsUsd, profit, profitPct: r.spent > 0 ? profit / r.spent * 100 : 0, avgEntryMc: r.bought > 0 ? r.wmc / r.bought : 0,   /* token-weighted, like the exit */ avgExitMc: r.sold > 0 ? r.smc / r.sold : 0, avgEntryMcQ: r.bq > 0 ? r.wmq / r.bq : 0, avgExitMcQ: r.sq > 0 ? r.smq / r.sq : 0,   /* the same in the pair token (SOL), for charts drawn at today's SOL price */
    soldPct: r.bought > 0 ? Math.min(100, r.sold / r.bought * 100) : 0, supplyPct: held / SUPPLY * 100, held, trades: r.n };
}
async function holders(mint) {   // one row per OWNER (all their token accounts added up) — a dust account can't fake someone's balance
  const coin = q1('SELECT * FROM coins WHERE mint=?', mint); if (!coin) return [];
  const accs = await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: mint } }] });
  const auth = deriveDbcPoolAuthority().toBase58(), opsK = OPS?.publicKey.toBase58(), by = new Map();
  for (const a of accs) { let u; try { u = unpackAccount(a.pubkey, a.account, TOKEN_2022_PROGRAM_ID); } catch { continue; } if (u.amount <= 0n) continue; const o = u.owner.toBase58(); by.set(o, (by.get(o) || 0n) + u.amount); }
  return [...by].map(([o, amt]) => { const curve = o === auth, pda = !curve && !PublicKey.isOnCurve(new PublicKey(o).toBytes());
      return { wallet: o, pct: Number(amt) / 1e6 / SUPPLY * 100, curve: curve || pda, pool: pda, ops: o === opsK, dev: o === coin.creator }; })   // PDAs (curve, migrated pool vaults) are never "holders"
    .filter((h) => !h.ops).sort((x, y) => y.pct - x.pct);
}
// real on-chain balances (transfers, tax payouts and burns included) — cached, refreshed in the background
const hCache = new Map(), inflight = new Map(), lbCache = new Map(), iconC = new Map(); let iconB = 0;
// ONE holder cache per mint for everything (/api/holders, coin stats, callouts, bubbles, rewards balances): a list is fresh for 90 s,
// and concurrent askers share the one scan in flight
const HOLD_TTL = 90e3, hFresh = (h) => !!(h?.list && Date.now() - h.ts < HOLD_TTL);
function scanHolders(mint) { if (inflight.has(mint)) return inflight.get(mint); hRun++;
  const pr = holders(mint).then((l) => { hCache.set(mint, { ts: Date.now(), list: l }); return l; }, (e) => { const h = hCache.get(mint) || { ts: 0, list: null }; h.failAt = Date.now(); hCache.set(mint, h); throw e; })
    .finally(() => { hRun--; inflight.delete(mint); });
  inflight.set(mint, pr); return pr; }
function holdersCached(mint) { const h = hCache.get(mint); return hFresh(h) ? Promise.resolve(h.list) : scanHolders(mint); }
// simple in-memory rate limiter (per key, n hits per window)
// short response cache for the heavier read endpoints (a burst of visitors costs one computation, not hundreds of queries each)
const rcache = new Map(); function cached(key, ms, fn) { const h = rcache.get(key); if (h && Date.now() - h.at < ms) return h.v; const v = fn(); rcache.set(key, { at: Date.now(), v }); if (rcache.size > 3000) { const now = Date.now(); for (const [k2, x] of rcache) if (now - x.at > 6e4) rcache.delete(k2); if (rcache.size > 3000) rcache.clear(); } return v; }
// per-key sliding windows; the map is an LRU (a touched key moves to the end) capped at HITS_MAX keys, oldest evicted first — O(1) per call
const hits = new Map(), HITS_MAX = 50000;
function rate(k, n, ms) { const now = Date.now(); let a = hits.get(k); if (a) { hits.delete(k); let i = 0; while (i < a.length && now - a[i] >= ms) i++; if (i) a = a.slice(i); } else a = [];
  if (a.length >= n) { hits.set(k, a); return false; } a.push(now); hits.set(k, a);
  while (hits.size > HITS_MAX) hits.delete(hits.keys().next().value);
  return true; }
// ---- client IP ----
// Production path: browser → Cloudflare → Render → this server. Render appends the address that connected to it as the LAST
// X-Forwarded-For entry; when that is a Cloudflare edge, Cloudflare's own CF-Connecting-IP is the real client.
// The *.onrender.com origin is also reachable directly (no Cloudflare): then the last XFF entry IS the client and anything
// before it was written by the client (never trusted).
// ORIGIN_SECRET (recommended): a long random string. In Cloudflare → Rules → Transform Rules → "Modify Request Header",
// add a rule for the API hostname that SETS header `x-origin-secret: <ORIGIN_SECRET>`. Requests without it (i.e. that
// bypassed Cloudflare) are refused, except /api/health for Render's health check. Without ORIGIN_SECRET, "came via Cloudflare"
// is decided by the last XFF hop being inside Cloudflare's published ranges (https://www.cloudflare.com/ips/).
const ORIGIN_SECRET = process.env.ORIGIN_SECRET || '';
if (ORIGIN_SECRET && ORIGIN_SECRET.length < 24) console.error('!! ORIGIN_SECRET is shorter than 24 characters — use a long random value');
const CF_NETS = new net.BlockList();
for (const c of ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22']) { const [a, b] = c.split('/'); CF_NETS.addSubnet(a, +b, 'ipv4'); }
for (const c of ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']) { const [a, b] = c.split('/'); CF_NETS.addSubnet(a, +b, 'ipv6'); }
const normIp = (a) => { a = String(a || '').trim(); if (a.toLowerCase().startsWith('::ffff:') && net.isIPv4(a.slice(7))) a = a.slice(7); return net.isIP(a) ? a : ''; };
const inCf = (a) => { a = normIp(a); return !!a && CF_NETS.check(a, net.isIPv4(a) ? 'ipv4' : 'ipv6'); };
function originOk(req) { if (!ORIGIN_SECRET) return true; const g = Buffer.from(String(req.headers['x-origin-secret'] || '')), w = Buffer.from(ORIGIN_SECRET); return g.length === w.length && timingSafeEqual(g, w); }
const xffOf = (req) => String(req.headers['x-forwarded-for'] || '').split(',').map((v) => v.trim()).filter(Boolean).slice(-2);   // never more than the last two hops
function viaCf(req) { if (ORIGIN_SECRET) return originOk(req); const x = xffOf(req); return inCf(x.length ? x[x.length - 1] : req.socket.remoteAddress); }
const ip = (req) => { if (req._ip) return req._ip; const x = xffOf(req), cf = viaCf(req);
  let v = cf ? normIp(req.headers['cf-connecting-ip']) || normIp(x.length >= 2 ? x[0] : '') : '';   // via Cloudflare: its header, else the hop Cloudflare added
  if (!v) v = normIp(x.length ? x[x.length - 1] : '') || normIp(req.socket.remoteAddress) || 'unknown';   // direct: the address that connected to Render
  return (req._ip = v); };
function liveHolders(mint, refresh = true) { const h = hCache.get(mint); if (refresh && !hFresh(h) && !inflight.has(mint) && holderSlots() && !(h?.failAt && Date.now() - h.failAt < 30e3)) scanHolders(mint).catch(() => {}); return h?.list || null; }   // background refresh; never waits
let hRun = 0; const holderSlots = () => hRun < 3;   // at most 3 holder scans at a time (each is a getProgramAccounts)
// a creator's track record, from the indexed trades of each coin they launched (never guessed):
//  · grad  = reached Meteora · rug = creator sold ≥70% of the most they ever held (or the rewards rules put them out for selling)
//  · dead  = no trades for 3 days, not graduated · live = everything else. soldAfterMin = minutes from launch until the creator's bag fell below 30% of its peak.
function devRecord(w) {
  const coins = q('SELECT * FROM coins WHERE creator=? ORDER BY created_at DESC LIMIT 100', w).filter((c) => !HIDDEN.has(c.mint));
  const list = coins.map((c) => {
    const ag = q1('SELECT MAX(mcap_usd) ath, MAX(progress) prog, MAX(ts) lt FROM trades WHERE mint=? AND sys=0', c.mint) || {}, now = q1('SELECT mcap_usd m FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 1', c.mint)?.m || 0;
    let bag = 0, peak = 0, soldAt = null;
    for (const t of q("SELECT side, tokens, ts FROM trades WHERE mint=? AND wallet=? ORDER BY ts, slot", c.mint, w)) { bag = Math.max(0, bag + (t.side === 'buy' ? t.tokens : -t.tokens)); if (bag > peak) { peak = bag; soldAt = null; } else if (peak > 0 && bag < peak * 0.3 && soldAt == null) soldAt = t.ts; }
    let outSold = false; try { const st = REW && REW.state(c); outSold = !!(st && st.era === 'out' && st.why === 'sold'); } catch {}
    const grad = !!c.damm || (ag.prog || 0) >= 100, rug = !grad && (outSold || (peak > 0 && bag <= peak * 0.3)), dead = !grad && !rug && Date.now() - (ag.lt || c.created_at || 0) > 3 * 864e5;
    return { mint: c.mint, symbol: c.symbol, name: c.name, created: c.created_at, ath: ag.ath || 0, mc: now, status: grad ? 'grad' : rug ? 'rug' : dead ? 'dead' : 'live', devBuy: peak > 0, soldAfterMin: soldAt ? Math.max(0, (soldAt - (c.created_at || soldAt)) / 60000) : null };
  });
  const n = list.length, grads = list.filter((x) => x.status === 'grad').length, rugs = list.filter((x) => x.status === 'rug').length, fast = list.filter((x) => x.soldAfterMin != null && x.soldAfterMin < 60).length;
  const tag = !n ? null : n >= 2 && rugs / n > 0.4 ? 'bad' : n >= 2 && grads / n >= 0.4 && rugs <= 1 ? 'good' : n <= 1 ? 'new' : 'mixed';
  return { wallet: w, launches: n, grads, rugs, fast, best: list.reduce((m, x) => Math.max(m, x.ath), 0), tag, coins: list };
}
// ---- X confirmation: the X account in the coin's links posted the coin's contract address ----
db.exec('CREATE TABLE IF NOT EXISTS xconf(mint TEXT PRIMARY KEY, handle TEXT, url TEXT, at INT)');
function xHandleOf(c) { try { let v = String(new URL(c.uri).searchParams.get('x') || '').trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^@/, '');
  const m = /^(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:$|[/?#])/i.exec(v); if (m) v = m[1]; if (!/^[A-Za-z0-9_]{1,15}$/.test(v) || /^(i|home|search|intent|share)$/i.test(v)) return null; return v; } catch { return null; } }
try { db.exec('ALTER TABLE xconf ADD COLUMN post_id TEXT'); } catch {} try { db.exec('ALTER TABLE xconf ADD COLUMN chk INT'); } catch {}
const xPostId = (url) => /(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d{5,25})(?:$|[/?#])/.exec(String(url || ''))?.[1] || null;
const snowflakeMs = (id) => { try { return Number((BigInt(id) >> 22n) + 1288834974657n); } catch { return 0; } };
// → true / false when X gave a definite answer (false also when the post is deleted); throws when X couldn't be read (unknown)
// a match = posted by the coin's X account, AFTER the coin was created, and its text has the contract address AND the word "treid"
async function xPostCheck(handle, id, mint, createdAt) {
  const H = handle.toLowerCase(), textOk = (t) => String(t || '').includes(mint) && /treid/i.test(String(t || ''));
  if (!(snowflakeMs(id) > (+createdAt || 0))) return false;   // a post older than the coin can't be about it
  let gone = false;
  try { const tok = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ''), r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${tok}`, { signal: AbortSignal.timeout(10e3) });
    if (r.ok) { const j = await r.json(), who = String(j?.user?.screen_name || '').toLowerCase(); if (who) return who === H && String(j?.id_str || id) === id && textOk(j?.text); } else if (r.status === 404) gone = true; } catch {}
  const r2 = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent('https://twitter.com/i/status/' + id)}`, { signal: AbortSignal.timeout(10e3) });
  if (r2.status === 404 || (gone && r2.status === 403)) return false;
  if (!r2.ok) throw new Error('could not read that post — is it public? try again in a minute');
  const j2 = await r2.json(); return String(j2.author_url || '').split('/').pop().toLowerCase() === H && textOk(j2.html);
}
// confirmed posts are re-checked once a day: deleted, edited away or the coin's X link changed → the ✓ is dropped
async function xRecheck() { for (const r of q('SELECT * FROM xconf WHERE chk IS NULL OR chk < ? ORDER BY chk LIMIT 40', Date.now() - 864e5)) {
  const c = q1('SELECT * FROM coins WHERE mint=?', r.mint), h = c && xHandleOf(c), id = r.post_id || xPostId(r.url);
  let ok; try { ok = !!(c && h && id && h.toLowerCase() === r.handle) && await xPostCheck(h, id, c.mint, c.created_at); } catch { continue; }   // X unreadable: try again next round
  if (ok) run('UPDATE xconf SET chk=?, post_id=? WHERE mint=?', Date.now(), id, r.mint); else { run('DELETE FROM xconf WHERE mint=?', r.mint); coinsSnap = null; console.log('x confirm dropped', r.mint.slice(0, 6), '@' + r.handle); }
  await new Promise((ok2) => setTimeout(ok2, 3e3)); } }
setTimeout(() => { xRecheck().catch(() => {}); setInterval(() => xRecheck().catch(() => {}), 36e5); }, 5 * 60e3);
function stats(mint, list = false, scanOk = true) {
  const c = q1('SELECT * FROM coins WHERE mint=?', mint); if (!c) return null;
  const last = q1('SELECT mcap_usd, progress, reserve FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 1', mint);
  const agg = q1(`SELECT COUNT(*) n, SUM(sol) vol, SUM(usd) volusd, SUM(side='buy') buys, SUM(side='sell') sells, COUNT(DISTINCT wallet) traders, SUM(CASE WHEN sniper=1 THEN tokens ELSE 0 END) snipeTok, SUM(CASE WHEN bundle=1 AND side='buy' THEN tokens ELSE 0 END) bundleTok FROM trades WHERE mint=? AND sys=0`, mint);
  const bal = q(`SELECT wallet, SUM(CASE WHEN side='buy' THEN tokens ELSE -tokens END) n FROM trades WHERE mint=? GROUP BY wallet HAVING n > 0.5 ORDER BY n DESC`, mint);
  const devBuy = q1(`SELECT 1 x FROM trades WHERE mint=? AND wallet=? AND side='buy' LIMIT 1`, mint, c.creator);
  const recent = (q1('SELECT MAX(ts) t FROM trades WHERE mint=?', mint)?.t || 0) > Date.now() - 36e5, lh = liveHolders(mint, scanOk && (!list || recent)), real = lh ? lh.filter((h) => !h.curve) : null;
  const lk = LOCKS.get(c, recent);   // verified lock escrow (null when none / not launched as a locked launch)
  const devN = (real ? (real.find((h) => h.wallet === c.creator)?.pct || 0) / 100 * SUPPLY + (lk?.inside || 0) : bal.find(b => b.wallet === c.creator)?.n || 0);   // trades never saw the move into the lock → the trade count already includes it
  const top10 = Math.min(SUPPLY, real ? real.slice(0, 10).reduce((s, h) => s + h.pct / 100 * SUPPLY, 0) : bal.slice(0, 10).reduce((s, b) => s + b.n, 0));
  const po = OPS && REW ? q1(`SELECT COALESCE(SUM(CASE WHEN kind='taxburn' THEN lamports END),0)/1e6 burned, COALESCE(SUM(CASE WHEN kind='taxhold' THEN lamports END),0)/1e6 holders, COALESCE(SUM(CASE WHEN kind='taxdev' THEN lamports END),0)/1e6 dev, COUNT(CASE WHEN kind='taxhold' THEN 1 END) n, COALESCE(SUM(CASE WHEN kind='taxholdq' THEN lamports END),0) * 1.0 / ${10 ** (c.quote_dec ?? 9)} holders_q FROM rlog WHERE mint=? AND kind IN ('taxburn','taxdev','taxhold','taxholdq')`, mint) : null;   // from on-chain receipts → survives restarts
  const burned = supplyC.get(mint)?.v || 0; if (supplyStale(mint) && (supplyC.has(mint) || supplyBusy.size < 8)) burnedOf(mint).catch(() => {});   // refreshed in the background
  const sp = c.tax_bps > 0 ? parseSplit(c.uri) : null;   // the split ops ACTUALLY applies (an invalid or missing one falls back to 70/20/10; dev share capped at 50% unless the coin launched with dc=1)
  let rwst = null; try { const r = q1('SELECT COUNT(DISTINCT wallet) w, COUNT(DISTINCT sig) n, MAX(ts) last FROM hpay WHERE mint=? AND wallet != ?', mint, c.creator); if (r && r.w) rwst = { wallets: r.w, payouts: r.n, last: r.last }; } catch {}   // holders paid (receipts), dev share excluded
  const ref24 = q1('SELECT mcap_usd m FROM trades WHERE mint=? AND ts<=? AND sys=0 ORDER BY ts DESC LIMIT 1', mint, Date.now() - 864e5) || q1('SELECT mcap_usd m FROM trades WHERE mint=? ORDER BY ts ASC LIMIT 1', mint);   // market cap 24h ago (or at launch) → a real "24h change"
  let banV = 0; try { banV = q1("SELECT at FROM meta WHERE mint=? AND banner LIKE 'data:%'", mint)?.at || 0; } catch {}   // a banner the creator changed later (cache-busting version)
  return { ...c, banner_v: banV, grad_fee_bps: cfgFee.get(c.config) || 50, mcap_24h: ref24?.m || null, rewards_stats: rwst, supply: SUPPLY - burned, burned, split_applied: sp ? { h: sp.h, b: sp.b, d: sp.d, pair: !!sp.pair, rw: sp.rw || null } : null, vamp: vampOf(mint), tax_paid: po, reserve: last?.reserve || 0, grad_target: gradTarget.get(mint) || 0, quote_usd: quoteUsd(c.quote_mint, c.quote_symbol), vol_usd: agg.volusd || 0, holders: real ? real.length : bal.length, dev_pct: devN / SUPPLY * 100, lock_intent: LOCKS.wants(c), x_ok: (() => { try { const r = q1('SELECT handle FROM xconf WHERE mint=?', mint); return r && xHandleOf(c)?.toLowerCase() === r.handle ? xHandleOf(c) : null; } catch { return null; } })(), dev_lock: lk ? { total_pct: lk.total / SUPPLY * 100, inside_pct: lk.inside / SUPPLY * 100, locked_pct: lk.locked / SUPPLY * 100, start: lk.start, unlock_start: lk.unlockStart, unlock_end: lk.unlockEnd, days: lk.days, escrows: lk.escrows } : null, dev_sold: !!devBuy && devN < 1, top10_pct: top10 / SUPPLY * 100, sol_usd: SOL_USD, mcap_usd: last?.mcap_usd || 0, curve_pct: last?.progress || 0, trades: agg.n, vol_sol: agg.vol || 0, buys: agg.buys || 0, sells: agg.sells || 0, traders: agg.traders, snipers_pct: (agg.snipeTok || 0) / SUPPLY * 100, bundles_pct: (agg.bundleTok || 0) / SUPPLY * 100 };
}
// errors our own code throws on purpose are meant for the user; anything else (library, RPC, database, parser) gets a generic text
const pubErr = (e) => { const m = String(e?.message || ''); if (e && e.constructor === Error && !e.code && m && m.length < 200 && !/sqlite|database|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|timed? ?out|abort|socket|JSON|Unexpected token|failed to get|getaddrinfo|status code|Cannot read|is not a function|undefined|\bat \S+:\d+/i.test(m)) return m; console.log('err (hidden)', m.slice(0, 160)); return 'something went wrong — try again'; };
// ---- request bodies: size known before reading (Content-Length), read into a Buffer with a hard per-route cap, and a global
// in-flight byte budget so many parallel large POSTs can't exhaust memory. Rate limits run BEFORE this is called.
const BODY_CAP = +(process.env.BODY_CAP_MB || 64) * 1e6; let bodyBytes = 0;
const bodyErr = (msg, status) => Object.assign(new Error(msg), { status });
function readBody(req, res, max) { return new Promise((ok, no) => {
  const cl = req.headers['content-length'], len = cl == null ? null : Number(cl);
  const refuse = (e) => { try { res.setHeader('connection', 'close'); } catch {} no(e); };   // the rest of the body is never read
  if (len != null && !(Number.isInteger(len) && len >= 0)) return refuse(bodyErr('bad request', 400));
  if (len != null && len > max) return refuse(bodyErr('request too big', 413));
  const reserve = len ?? max; if (bodyBytes + reserve > BODY_CAP) return refuse(bodyErr('server busy — try again in a moment', 503));
  bodyBytes += reserve; const parts = []; let n = 0, done = false;
  const fin = (e, v) => { if (done) return; done = true; bodyBytes -= reserve; if (e) no(e); else ok(v); };
  req.on('data', (d) => { if (done) return; n += d.length; if (n > (len ?? max)) { fin(bodyErr('request too big', 413)); req.destroy(); return; } parts.push(d); });
  req.on('end', () => fin(null, Buffer.concat(parts, n))); req.on('error', () => fin(bodyErr('aborted', 400))); req.on('close', () => fin(bodyErr('aborted', 400)));
}); }
function bodyFail(res, e) { if (res.headersSent || res.destroyed) return; res.writeHead(e?.status || 400, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, uri: null, error: e?.status ? e.message : 'bad request' })); }
const withBody = (fn) => fn();   // runs a handler whose body was already read (keeps the old handler shape)
// deploys / restarts: Render sends SIGTERM first. Stop starting new money transactions, let the one in flight finish (its receipt
// is recorded), tell live viewers to reconnect, then exit — so a restart never cuts a payout in half.
let stopping = false;
async function shutdown(sig) {
  if (stopping) return; stopping = true; console.log('shutdown', sig, '— finishing what is in flight');
  if (!HALT.on) { HALT.on = true; HALT.why = 'restarting'; }   // every send checks this: nothing new leaves the ops wallet
  const coFlush = Promise.resolve().then(() => CO?.flush && CO.flush()).catch(() => {});   // last callouts snapshot to IPFS (backups are debounced to 30 min), in parallel
  await Promise.race([Promise.all([lockIdle(), coFlush]), new Promise((r) => setTimeout(r, 25e3))]);
  for (const c of clients) { try { c.write('retry: 3000\nevent: bye\ndata: {}\n\n'); c.end(); } catch {} }
  try { server.close(); } catch {} try { db.close(); } catch {}
  console.log('shutdown done'); process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.log('unhandled', String(e?.message || e).slice(0, 200)));   // one bad request or RPC hiccup must never kill the server
process.on('uncaughtException', (e) => console.log('uncaught', String(e?.message || e).slice(0, 200)));
const sseByIp = new Map();
// X (Twitter) post previews for callouts: fetched once from X's public embed endpoint, cached, and served as plain data (the site draws its own card)
run('CREATE TABLE IF NOT EXISTS xposts(id TEXT PRIMARY KEY, j TEXT, at INT)');
const xBusy = new Map();
async function xPost(id) {
  const c = q1('SELECT j, at FROM xposts WHERE id=?', id); if (c && (c.j !== 'null' ? Date.now() - c.at < 864e5 : Date.now() - c.at < 6e5)) return JSON.parse(c.j);
  if (xBusy.has(id)) return xBusy.get(id);
  const pr = (async () => {
    let out = null;
    try {
      const tok = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
      const r = await fetch('https://cdn.syndication.twimg.com/tweet-result?id=' + id + '&lang=en&token=' + tok, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      if (r.ok) { const d = await r.json(); const pick = (x) => x && x.user ? { id: x.id_str, name: x.user.name, handle: x.user.screen_name, avatar: x.user.profile_image_url_https, verified: !!(x.user.is_blue_verified || x.user.verified),
          text: String(x.text || '').replace(/\s*https:\/\/t\.co\/\w+\s*$/, '').slice(0, 1200), img: (x.mediaDetails || [])[0]?.media_url_https || (x.photos || [])[0]?.url || x.video?.poster || null, ts: x.created_at ? Date.parse(x.created_at) : 0 } : null;
        out = pick(d); if (out && d.quoted_tweet) out.quote = pick(d.quoted_tweet); }
    } catch {}
    run('INSERT OR REPLACE INTO xposts(id,j,at) VALUES(?,?,?)', id, JSON.stringify(out), Date.now()); xBusy.delete(id); return out;
  })();
  xBusy.set(id, pr); return pr;
}
// Jupiter Trigger V2 proxy: the browser can't hold the API key. Only the order endpoints, the user's own Jupiter JWT passed through.
const JT_ROUTES = [['POST', /^auth\/(challenge|verify|refresh)$/], ['GET', /^vault(\/register)?$/], ['POST', /^deposit\/craft$/], ['POST', /^orders\/price$/], ['POST', /^orders\/price\/(cancel|confirm-cancel)\/[A-Za-z0-9_-]{1,80}$/], ['GET', /^orders\/history$/]];
async function jtProxy(req, res, u, p) {
  const out = (code, o) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }
  const path = p.slice(2).join('/'); if (!JT_ROUTES.some(([m, re]) => m === req.method && re.test(path))) return out(404, { error: 'not found' });
  if (!process.env.JUP_API_KEY) return out(503, { error: 'limit orders are not enabled on this server (JUP_API_KEY missing)' });
  if (!rate('jt|' + ip(req), 400, 36e5)) return out(429, { error: 'too many requests — try again later' });
  let body = null; if (req.method === 'POST') { try { body = await readBody(req, res, 3e5); } catch (e) { return out(e.status || 400, { error: e.message }); } }
  const auth = String(req.headers.authorization || ''), qs = path === 'orders/history' ? '?' + new URLSearchParams([...u.searchParams].filter(([k]) => ['state', 'mint', 'limit', 'offset', 'sort', 'dir'].includes(k))).toString() : '';
  try { const r = await fetchT('https://api.jup.ag/trigger/v2/' + path + qs, { method: req.method, body: body || undefined, headers: { 'content-type': 'application/json', ...(/^Bearer [A-Za-z0-9._~+\/=-]{10,4000}$/.test(auth) ? { authorization: auth } : {}) } }, 20e3);
    const txt = await r.text(); res.writeHead(r.status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(txt.slice(0, 2e6)); }
  catch (e) { out(502, { error: 'Jupiter not reachable — try again' }); }
}
const server = http.createServer((req, res) => { handleReq(req, res).catch((e) => { console.log('req err', String(e?.message || e).slice(0, 160)); try { if (!res.headersSent) res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end('{"ok":false}'); } catch {} }); }).listen(PORT, () => console.log('API on :' + PORT));
async function handleReq(req, res) {
  const u = new URL(req.url, 'http://x'), p = u.pathname.split('/').filter(Boolean), J = (o, st = 200) => { const body = typeof o === 'object' && o && o.__gz ? null : JSON.stringify(o), gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));   // big answers go out gzipped (the coin list shrinks ~8x)
    if (o && o.__gz) { res.writeHead(st, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store', ...(gz ? { 'content-encoding': 'gzip', vary: 'Accept-Encoding' } : {}) }); return res.end(gz ? o.__gz : o.raw); }
    if (gz && body.length > 4096) { res.writeHead(st, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-encoding': 'gzip', vary: 'Accept-Encoding' }); return res.end(zlib.gzipSync(body, { level: 6 })); }
    res.writeHead(st, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(body); };
  if (!originOk(req) && !(!p.length || p[1] === 'health')) { res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"use the public API address"}'); }   // bypassed Cloudflare (ORIGIN_SECRET set)
  if (req.method === 'POST' && !rate('post|' + ip(req), 1500, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*', connection: 'close' }); return res.end('{"ok":false,"error":"too many requests — try again later"}'); }   // before any body is read
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, *', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }
  // coin metadata (image / description) posted by the site at launch — first write wins. TODO mainnet: pin to IPFS instead.
  if (p[1] === 'upload' && req.method === 'POST') {   // before launch: pin image(s) + metadata JSON to IPFS, return the permanent URI
    if (!rate('up|' + ip(req), 6, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end(JSON.stringify({ uri: null, error: 'too many uploads — try again later' })); }
    let body; try { body = await readBody(req, res, 3e6); } catch (e) { return bodyFail(res, e); }
    withBody(async () => { try { if (!PINATA_JWT) return J({ uri: null });
      const m = JSON.parse(body), wl = String(m.wallet || ''), wts = +m.ts;   // only a real wallet with SOL can pin (protects the IPFS account)
      if (!(Math.abs(Date.now() - wts) <= 5 * 60e3) || !verifySig(`treid: upload — ${wl} — ${wts}`, m.sig, wl, wts)) throw new Error('sign the upload with your wallet');
      if (!rate('upw|' + wl, 10, 864e5)) throw new Error('upload limit reached for today'); if ((await conn.getBalance(new PublicKey(wl))) < 0.02e9) throw new Error('your wallet needs a little SOL to launch');
      const ok = (v) => realImage(v, 1.1e6), tag = String(m.symbol || 'coin').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) + '-' + Date.now().toString(36);
      const image = ok(m.image) ? await pinFile(m.image, tag) : null, banner = ok(m.banner) ? await pinFile(m.banner, tag + '-banner') : null;
      const meta = { name: String(m.name || '').slice(0, 32), symbol: String(m.symbol || '').slice(0, 10), description: String(m.description || '').slice(0, 600), image, banner, external_url: 'https://treid.fun', properties: { files: image ? [{ uri: image, type: 'image' }] : [] } };
      if (m.x) meta.twitter = String(m.x).slice(0, 100); if (m.tg) meta.telegram = String(m.tg).slice(0, 100); if (m.web) meta.website = String(m.web).slice(0, 100);
      J({ uri: await pinJSON(meta, tag, { dedupe: true }), image, banner }); } catch (e) { console.log('upload err', e.message); res.writeHead(502, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ uri: null, error: pubErr(e) })); } });
    return;
  }
  if (p[1] === 'meta' && req.method === 'POST') { res.writeHead(410, { 'access-control-allow-origin': '*' }); return res.end('{"ok":false,"error":"metadata lives on IPFS now"}'); }
  if (p[1] === 'meta' && p[2]) { const m = q1('SELECT * FROM meta WHERE mint=?', p[2]), c = q1('SELECT name, symbol FROM coins WHERE mint=?', p[2]); if (!m && !c) { res.writeHead(404, { 'access-control-allow-origin': '*' }); return res.end('{}'); }
    const base = PUBLIC_URL;
    return J({ name: m?.name || c?.name, symbol: m?.symbol || c?.symbol, description: m?.description || '', image: m?.image ? base + '/api/img/' + p[2] : null, banner: m?.banner ? base + '/api/img/' + p[2] + '?b=1' : null }); }
  if (p[1] === 'coimg' && p[2]) {   // callout pictures through our server (public IPFS gateways are often slow or blocked) — only pictures that are in a callout
    const cid = String(p[2]); if (!/^[A-Za-z0-9]{40,70}$/.test(cid)) { res.writeHead(404); return res.end(); }
    let row = null; try { row = q1('SELECT ct, data FROM cimg WHERE mint=? AND b=0', 'co:' + cid); } catch {}
    let im = row && row.data ? { ct: row.ct, data: Buffer.from(row.data) } : null;
    if (!im) { if (!q1("SELECT 1 FROM callouts WHERE img LIKE ? LIMIT 1", '%/ipfs/' + cid + '%')) { res.writeHead(404, { 'access-control-allow-origin': '*' }); return res.end(); }
      const r = await fetchAny(ipfsUrls('ipfs://' + cid), 20e3), ct = r && String(r.headers.get('content-type') || '').split(';')[0]; const buf = r && /^image\/(png|jpe?g|gif|webp)$/.test(ct) ? await readCapped(r, IMG_MAX) : null;
      if (!buf) { res.writeHead(404, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' }); return res.end(); }
      im = { ct, data: buf }; try { if (imgTotal() + buf.length < IMG_QUOTA) { run('INSERT OR REPLACE INTO cimg(mint,b,ct,data,at) VALUES(?,?,?,?,?)', 'co:' + cid, 0, ct, buf, Date.now()); imgTot.v += buf.length; } } catch {} }
    res.writeHead(200, { 'content-type': im.ct, 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=604800, immutable' }); return res.end(im.data); }
  if (p[1] === 'img' && p[2]) { const ban = u.searchParams.get('b') ? 1 : 0, m = q1('SELECT image, banner FROM meta WHERE mint=?', p[2]), d = ban ? m?.banner : m?.image;
    if (!d || !String(d).startsWith('data:')) { const im = await coinImage(p[2], ban); if (!im) { res.writeHead(404, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' }); return res.end(); }
      res.writeHead(200, { 'content-type': im.ct, 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=604800, immutable' }); return res.end(im.data); }
    const [h, b64] = d.split(','), ct = h.slice(5, h.indexOf(';')); if (!/^image\/(png|jpe?g|gif|webp)$/.test(ct)) { res.writeHead(404); return res.end(); }   // never serve svg (script)
    res.writeHead(200, { 'content-type': ct, 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' }); return res.end(Buffer.from(b64, 'base64')); }
  // public health: no ops balance / halt reason / subscriber counts (there is no admin-token mechanism; those live in the logs + Telegram alerts)
  if (!p.length || p[1] === 'health') return J({ ok: true, ready, coins: q1('SELECT COUNT(*) n FROM coins').n, trades: q1('SELECT COUNT(*) n FROM trades').n, partner: PARTNER || null, ops: OPS?.publicKey.toBase58() || null, sol_usd: SOL_USD });
  try {
    if (p[1] === 'stream') { const ipx = ip(req), nIp = sseByIp.get(ipx) || 0; if (clients.size >= 3000 || nIp >= 6) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end(); }
      sseByIp.set(ipx, nIp + 1); req.on('close', () => { const v = (sseByIp.get(ipx) || 1) - 1; if (v > 0) sseByIp.set(ipx, v); else sseByIp.delete(ipx); });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' }); res.write(': hi\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
    if (p[1] === 'push' && p[2] === 'key') return J({ key: PUSH?.publicKey || null });   // web push: the server's VAPID public key (null = off)
    if (p[1] === 'push' && ['alert', 'alerts', 'alertdel'].includes(p[2]) && req.method === 'POST') { if (!rate('pal|' + ip(req), 120, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end(JSON.stringify({ ok: false, error: 'too many requests — try again later' })); } let body; try { body = await readBody(req, res, 4000); } catch (e) { return bodyFail(res, e); }
      withBody(() => { try { const b = JSON.parse(body); J(p[2] === 'alert' ? PUSH.alertAdd(b) : p[2] === 'alerts' ? PUSH.alertList(b) : PUSH.alertDel(b)); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'jt') return jtProxy(req, res, u, p);   // Jupiter Trigger V2 (limit / TP / SL orders), with the server's API key
    if (p[1] === 'push' && (p[2] === 'sub' || p[2] === 'unsub') && req.method === 'POST') { if (!rate('push|' + ip(req), 30, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end(JSON.stringify({ ok: false, error: 'too many requests — try again later' })); } let body; try { body = await readBody(req, res, 40000); } catch (e) { return bodyFail(res, e); }
      withBody(() => { try { const b = JSON.parse(body); J(p[2] === 'sub' ? PUSH.save(b, ip(req)) : PUSH.drop(b.endpoint)); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'qprice' && !rate('qp|' + ip(req), 30, 6e4)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('{}'); }
    if (p[1] === 'ticon') {   // logo of a verified token by exact symbol (e.g. tokenized stocks), fetched once and served from here — raster images only
      const sym = String(u.searchParams.get('sym') || ''), mintQ = String(u.searchParams.get('mint') || '');
      if (!/^[A-Za-z0-9]{2,12}$/.test(sym) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintQ)) { res.writeHead(404); return res.end(); }
      const ik = mintQ || sym.toLowerCase(); let h = iconC.get(ik);
      if (!h || Date.now() - h.at > (h.buf ? 864e5 : 10 * 60e3)) { if (!rate('ti|' + ip(req), 60, 6e4)) { res.writeHead(429); return res.end(); } h = { at: Date.now(), buf: null, ct: null };
        try { const j = await (await fetchT(JUP + '/tokens/v2/search?query=' + encodeURIComponent(mintQ || sym))).json(), t = (Array.isArray(j) ? j : []).find((x) => x && (mintQ ? x.id === mintQ : (x.isVerified || (x.tags || []).includes('verified')) && String(x.symbol).toLowerCase() === sym.toLowerCase()));
          const url = t && typeof t.icon === 'string' ? new URL(t.icon) : null;
          if (url && url.protocol === 'https:') { const r = await fetchAny(ipfsUrls(url.href), 8000);   // IPFS logos through our own gateway first; every redirect hop re-checked (no SSRF)
            const buf = r ? await readCapped(r, 1.5e6) : null, ct = buf ? imgType(buf, String(r.headers.get('content-type') || '').split(';')[0]) : null;   // never read more than 1.5 MB
            if (buf && ct && /^image\/(png|jpeg|gif|webp)$/.test(ct)) { h.buf = buf; h.ct = ct; } } } catch {}   // raster only: never SVG (script-capable) from here
        iconC.set(ik, h); iconB += h.buf ? h.buf.length : 0; while (iconC.size > 300 || iconB > 25e6) { const [k0, v0] = iconC.entries().next().value; iconC.delete(k0); iconB -= v0.buf ? v0.buf.length : 0; } }   // bounded memory (count + bytes)
      if (!h.buf) { res.writeHead(404, { 'access-control-allow-origin': '*' }); return res.end(); }
      res.writeHead(200, { 'content-type': h.ct, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" }); return res.end(h.buf); }
    if (p[1] === 'tsearch') {   // token search by name / ticker / address — verified Jupiter tokens only, for the pair & holder-reward pickers
      if (!rate('ts|' + ip(req), 40, 6e4)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('[]'); }
      const qs = String(u.searchParams.get('q') || '').trim().slice(0, 50); if (qs.length < 2) return J([]);
      if (lbCache.size > 400) for (const key of [...lbCache.keys()]) if (key.startsWith('ts|')) lbCache.delete(key);   // searches never grow the cache without bound
      const k = 'ts|' + qs.toLowerCase(), h = lbCache.get(k); if (h && Date.now() - h.at < 3e5) return J(h.v);
      let out = [], okRes = false; try { const j = await (await fetchT(JUP + '/tokens/v2/search?query=' + encodeURIComponent(qs))).json(); okRes = Array.isArray(j);
        out = (Array.isArray(j) ? j : []).filter((t) => t && t.id && (t.isVerified || (t.tags || []).includes('verified'))).slice(0, 8)
          .map((t) => ({ mint: String(t.id), symbol: String(t.symbol || '').slice(0, 12), name: String(t.name || '').slice(0, 40), icon: typeof t.icon === 'string' ? t.icon : null, usd: +t.usdPrice || 0, liq: +t.liquidity || 0, verified: true })); } catch {}
      if (okRes) lbCache.set(k, { at: Date.now(), v: out }); return J(out); }
    if (p[1] === 'qprice') { const m = String(u.searchParams.get('mint') || ''); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) return J({ usd: 0 });   // pair-token price for the Create page
      let usd = quoteUsd(m, KNOWN_Q[m]), symbol = KNOWN_Q[m] || null, name = null, icon = null, verified = m === WSOL || STABLE.has(m);
      try { const r = await fetchT(JUP + '/tokens/v2/search?query=' + m); const j = await r.json(); const t = Array.isArray(j) ? j.find((x) => x.id === m) : null; if (t) { symbol = symbol || t.symbol; name = t.name; icon = t.icon || null; verified = verified || !!(t.isVerified || (t.tags || []).includes('verified')); if (!QUOTE_OVERRIDE[m] && t.usdPrice) { usd = +t.usdPrice * (await qMult(m)); qPrice.set(m, usd); } } } catch {}   // per on-chain unit (scaled-UI tokens: × multiplier)
      return J({ mint: m, usd, symbol, name, icon, verified }); }
    if (p[1] === 'coins') { if (!coinsSnap) buildCoinsSnap(); else if (Date.now() - coinsSnap.at > 10e3) setImmediate(buildCoinsSnap); return J(coinsSnap.out); }   // stale-while-refresh: nobody waits for the rebuild
    if (p[1] === 'recent') return J(q('SELECT mint, wallet, side, usd, ts, sig FROM trades WHERE usd >= 5 ORDER BY ts DESC, slot DESC LIMIT 40').filter((r) => !HIDDEN.has(r.mint) && (!OPS || r.wallet !== OPS.publicKey.toBase58())).slice(0, 24));   // home page: the latest real trades across treid (no dust)
    if (p[1] === 'coin') { const m = String(p[2] || ''); if (HIDDEN.has(m) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) return J(null); return J(cached('coin|' + m, 5e3, () => stats(m, false, rate('hscan|' + ip(req), 30, 60e3)))); }   // many visitors of one coin share one computation per 5 s   // a burst of different coins from one visitor can't fan out into holder scans
    if (p[1] === 'trades') return J(q('SELECT * FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 200', p[2]));
    if (p[1] === 'creator' && p[2]) {   // creator rewards escrow status for a coin
      const c = q1('SELECT * FROM coins WHERE mint=?', p[2]); if (!c) return J(null);
      const k = 'esc:' + c.mint; let esc = escCache.get(k);
      if (!esc || Date.now() - esc.at > 60e3) { const vp = (await dbc.state.getPool(new PublicKey(c.pool)).catch(() => null))?.poolState; esc = { at: Date.now(), on: !!(OPS && vp && vp.creator.toBase58() === OPS.publicKey.toBase58()), pending: vp ? Number(vp.creatorQuoteFee.toString()) / 10 ** (c.quote_dec ?? 9) : 0 }; escCache.set(k, esc); }
      if (!esc.on || !REW) return J({ escrow: false, dev: c.creator });
      const st = REW.state(c), L = (x) => x / 10 ** (c.quote_dec ?? 9), apps = st.era === 'out' ? await REW.applications(c).catch(() => []) : [];
      return J({ escrow: true, dev: c.creator, era: st.era, creator: st.creator, to: st.to || null, claimBy: st.claimBy || null, cto: st.cto ? { lead: st.cto.lead, at: st.cto.at, fundSol: L(st.cto.fund), paidSol: L(st.cto.paid), vestedSol: L(st.cto.vested) } : null, apps, state: st.state, why: st.why, idleMs: st.idle, lastActive: st.last, soldPct: st.sold, quote: c.quote_symbol || 'SOL', quoteUsd: quoteUsd(c.quote_mint, c.quote_symbol), pendingSol: Math.max(0, esc.pending - L(st.fund)), paidSol: L(st.paid), buybackSol: L(st.buyback), burnedTokens: st.burnedTokens / 1e6, fundSol: L(st.fund), grantedSol: L(st.granted), platformSol: L(st.granted), fundEndsAt: st.fundEndsAt, rules: { freezeH: REW_RULES.idleFreezeMs / 36e5, outD: REW_RULES.idleOutMs / 864e5, soldOut: 70, applyPct: 1, supportPct: 10 }, log: REW.logFor(c.mint) });
    }
    if (['cto', 'claim', 'ping', 'hlink'].includes(p[1]) && req.method === 'POST' && !rate('act|' + ip(req), 30, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('{"ok":false,"error":"too many requests — try again later"}'); }
    if (p[1] === 'xconfirm' && req.method === 'POST') {   // the coin's own X account posted its contract address → "✓ X @handle" (a public post is the proof; no wallet needed)
      if (!rate('xc|' + ip(req), 12, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('{"ok":false,"error":"too many tries — try again later"}'); }
      let body; try { body = await readBody(req, res, 2000); } catch (e) { return bodyFail(res, e); }
      withBody(async () => { try { const b = JSON.parse(body), c = q1('SELECT * FROM coins WHERE mint=?', String(b.mint || '')); if (!c) throw new Error('unknown coin');
          const h = xHandleOf(c); if (!h) throw new Error('this coin has no X account in its links');
          const id = xPostId(b.url); if (!id) throw new Error('paste the link to the post (x.com/…/status/…)');
          const ok = await xPostCheck(h, id, c.mint, c.created_at); if (!ok) throw new Error(`that post must be from @${h}, made after the coin launched, and contain both the contract address and the word "treid"`);
          run('INSERT OR REPLACE INTO xconf(mint, handle, url, at, post_id, chk) VALUES(?,?,?,?,?,?)', c.mint, h.toLowerCase(), String(b.url).slice(0, 200), Date.now(), id, Date.now()); coinsSnap = null; J({ ok: true, handle: h });
        } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'banner' && req.method === 'POST') {   // the creator replaces the coin's banner later (signed by the creator wallet; served instead of the one from launch)
      if (!rate('ban|' + ip(req), 10, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('{"ok":false,"error":"too many changes — try again later"}'); }
      let body; try { body = await readBody(req, res, 1_200_000); } catch (e) { return bodyFail(res, e); }
      withBody(() => { try { const b = JSON.parse(body), c = q1('SELECT * FROM coins WHERE mint=?', String(b.mint || '')); if (!c) throw new Error('unknown coin');
          const ts = +b.ts; if (!(Math.abs(Date.now() - ts) <= 2 * 60e3)) throw new Error('signature expired — try again');
          if (b.wallet !== c.creator) throw new Error('only the creator can change the banner');
          if (!verifySig(`treid: set banner — ${c.mint} — ${ts}`, b.sig, b.wallet, ts)) throw new Error('bad signature');
          const img = String(b.image || ''); if (!/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 1_100_000) throw new Error('use a PNG, JPG or WEBP banner under 800 KB');
          run('INSERT INTO meta(mint, name, symbol, banner, at) VALUES(?,?,?,?,?) ON CONFLICT(mint) DO UPDATE SET banner=excluded.banner, at=excluded.at', c.mint, c.name, c.symbol, img, Date.now());
          coinsSnap = null; J({ ok: true, v: Date.now() }); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'hlink' && req.method === 'POST') { let body; try { body = await readBody(req, res, 4000); } catch (e) { return bodyFail(res, e); }   // an X / GitHub account claims the fees sent to it
      withBody(async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); J(await REW.link(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'cto' && (p[2] === 'apply' || p[2] === 'vote') && req.method === 'POST') { let body; try { body = await readBody(req, res, 6000); } catch (e) { return bodyFail(res, e); }
      withBody(async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); const b = JSON.parse(body); J(p[2] === 'apply' ? await REW.ctoApply(b) : await REW.ctoVote(b)); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'session' && req.method === 'POST') { if (!rate('ss|' + ip(req), 20, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end(JSON.stringify({ ok: false, error: 'too many sign-ins' })); } let body; try { body = await readBody(req, res, 2000); } catch (e) { return bodyFail(res, e); }   // sign in once (24 h)
      withBody(() => { try { J(issueSession(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'callout' && req.method === 'POST') { if (!rate('copre|' + ip(req), 300, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end(JSON.stringify({ ok: false, error: 'slow down — too many callouts' })); } let body; try { body = await readBody(req, res, 2.3e6); } catch (e) { return bodyFail(res, e); }   // text + optional image
      withBody(async () => { try { J(await CO.post(JSON.parse(body), ip(req))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'coreact' && req.method === 'POST') { if (!rate('crpre|' + ip(req), 600, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end(JSON.stringify({ ok: false, error: 'slow down' })); } let body; try { body = await readBody(req, res, 3000); } catch (e) { return bodyFail(res, e); }
      withBody(() => { try { J(CO.react(JSON.parse(body), ip(req))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (['callouts', 'coearn', 'dev', 'pos', 'mytrades', 'vampcheck', 'rewards'].includes(p[1]) && req.method === 'GET' && !rate('rd|' + ip(req), 240, 6e4)) { res.writeHead(429, { 'access-control-allow-origin': '*', 'content-type': 'application/json', 'retry-after': '30' }); return res.end('{"error":"too many requests"}'); }   // reads computed per wallet / coin: a flood of random keys can't pin the CPU
    if (p[1] === 'callouts') { const cm = u.searchParams.get('mint') || null, me0 = String(u.searchParams.get('me') || ''), me = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(me0) ? me0 : null; return J(cached('co|' + (cm || '') + '|' + (me || ''), 5e3, () => { const memo = new Map(); const L = CO.list(cm, me), ern = CR ? CR.byCallout(L.map((c) => c.id)) : {}; return L.map((c) => { const k = c.mint + '|' + c.wallet; if (!memo.has(k)) memo.set(k, posStats(c.mint, c.wallet)); return { ...c, ps: memo.get(k), earn: ern[c.id] || null }; }); })); }   // every callout carries its author's live position
    if (p[1] === 'coearn') { if (!CR) return J(null); if (p[2]) { const w = String(p[2]); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) return J(null); return J(cached('cre|' + w, 15e3, () => CR.stats(w))); } return J(cached('cretop', 60e3, () => ({ share: CO_SHARE, top: CR.top(30) }))); }   // callout rewards: one caller's earnings, or the 30-day top callers
    if (p[1] === 'dev' && p[2]) { const w = String(p[2]); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) return J(null); return J(cached('dev|' + w, 30e3, () => devRecord(w))); }   // creator reputation: every coin this wallet launched on treid
    if (p[1] === 'wallet' && p[2]) { const w = String(p[2]); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) return J(null); const c0 = walC.get(w); if (c0 && Date.now() - c0.ts < 30e3) return J(c0.v); if (!rate('wal|' + ip(req), 40, 60e3)) return J(c0 ? c0.v : null);
      let sol = null; try { sol = (await conn.getBalance(new PublicKey(w))) / 1e9; } catch {}
      const rows = q('SELECT mint, COUNT(*) n, MIN(ts) f, MAX(ts) l, SUM(CASE WHEN side=\'buy\' THEN usd ELSE 0 END) bu FROM trades WHERE wallet=? GROUP BY mint ORDER BY l DESC LIMIT 60', w).filter((r) => !HIDDEN.has(r.mint));
      const coins = rows.map((r) => { const c = q1('SELECT symbol, name FROM coins WHERE mint=?', r.mint) || {}; const ps = posStats(r.mint, w); return { mint: r.mint, symbol: c.symbol || '', name: c.name || '', first: r.f, last: r.l, ...ps }; });
      const created = q('SELECT mint, symbol, name, created_at FROM coins WHERE creator=? ORDER BY created_at DESC LIMIT 50', w).filter((r) => !HIDDEN.has(r.mint));
      const v = { wallet: w, sol, first: rows.length ? Math.min(...rows.map((r) => r.f)) : null, coins, created }; walC.set(w, { ts: Date.now(), v }); if (walC.size > 3000) walC.delete(walC.keys().next().value); return J(v); }
    if (p[1] === 'vampcheck') { const sym = fold(u.searchParams.get('symbol')), nm = fold(u.searchParams.get('name')); const hits = q('SELECT mint, symbol, name, created_at FROM coins ORDER BY created_at ASC LIMIT 20000').filter((c) => !HIDDEN.has(c.mint) && ((sym.length >= 2 && (fold(c.symbol) === sym || fold(c.name) === sym || (tickOf(sym).length >= 2 && tickOf(c.symbol) === tickOf(sym)))) || (nm.length >= 2 && (fold(c.name) === nm || fold(c.symbol) === nm)))).slice(0, 3); return J({ hits }); }
    if (p[1] === 'xpost' && /^\d{5,25}$/.test(p[2] || '')) { if (!q1('SELECT 1 FROM xposts WHERE id=?', p[2]) && !rate('xp|' + ip(req), 30, 60e3)) { res.writeHead(429, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('null'); } return J(await xPost(p[2])); }
    if (p[1] === 'rewards' && p[2]) { const w = String(p[2]); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) return J([]); let rows = []; try { rows = q('SELECT sig, mint, token, amt, dec, ts FROM hpay WHERE wallet=? ORDER BY ts DESC LIMIT 100', w); } catch {}
      return J(rows.filter((r) => !HIDDEN.has(r.mint) || true).map((r) => { const c = q1('SELECT symbol FROM coins WHERE mint=?', r.mint) || {}, tk = r.token === r.mint ? c.symbol : (r.token === WSOL ? 'SOL' : (q1('SELECT symbol FROM coins WHERE mint=?', r.token) || {}).symbol || null);
        return { sig: r.sig, mint: r.mint, symbol: c.symbol || '', token: r.token, tokenSymbol: tk || r.token.slice(0, 4), amount: r.amt / 10 ** (r.dec ?? 6), ts: r.ts }; })); }
    if (p[1] === 'treid') { const m = treidCfg.mint; if (!m) return J({ mint: null, pct: treidCfg.pct });
      const sT = (k) => q1('SELECT COALESCE(SUM(lamports),0) s, COUNT(*) n FROM rlog WHERE mint=? AND kind=?', m, k), b = sT('tbuy'), burned = sT('tburn').s + sT('tburnr').s;
      const recent = q("SELECT sig, kind, lamports, ts FROM rlog WHERE mint=? AND kind IN ('tbuy','tburn','tburnr') ORDER BY ts DESC LIMIT 20", m);
      return J({ mint: m, pct: treidCfg.pct, solSpent: b.s / 1e9, buys: b.n, burned: burned / 1e6, burnedPct: burned / 1e6 / SUPPLY * 100, recent }); }
    if (p[1] === 'pos') { const m = String(u.searchParams.get('mint') || ''), w = String(u.searchParams.get('wallet') || ''); if (!q1('SELECT 1 FROM coins WHERE mint=?', m) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) return J(null); return J(posStats(m, w)); }
    if (p[1] === 'mytrades') { const m = String(u.searchParams.get('mint') || ''), w = String(u.searchParams.get('wallet') || ''); return J(q('SELECT sig, side, sol, tokens, usd, mcap_usd, ts FROM trades WHERE mint=? AND wallet=? ORDER BY ts DESC LIMIT 100', m, w)); }
    if (p[1] === 'burned' && req.method === 'POST' && !rate('burn|' + ip(req), 30, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('{"ok":false,"error":"too many requests"}'); }
    if (p[1] === 'burned' && req.method === 'POST') { let body; try { body = await readBody(req, res, 1000); } catch (e) { return bodyFail(res, e); }
      withBody(async () => { try { J(await verifyBurn(String(JSON.parse(body).sig || ''))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'leaderboard' && !['24h', '7d', 'all'].includes(u.searchParams.get('per') || 'all')) return J({ traders: [], devs: [], hall: [] });
    if (p[1] === 'leaderboard' && lbCache.has(u.searchParams.get('per') || 'all') && Date.now() - lbCache.get(u.searchParams.get('per') || 'all').ts < 60e3) return J(lbCache.get(u.searchParams.get('per') || 'all').v);
    if (p[1] === 'leaderboard') { const pm = { '24h': 864e5, '7d': 6048e5 }[u.searchParams.get('per')] || 1e13, since = Date.now() - pm;
      const px = new Map(q('SELECT t.mint, t.price_usd p FROM trades t JOIN (SELECT mint, MAX(ts) m FROM trades GROUP BY mint) l ON l.mint=t.mint AND l.m=t.ts').map((r) => [r.mint, r.p]));
      const skip = new Set([OPS?.publicKey.toBase58(), PARTNER].filter(Boolean)), W = new Map();
      for (const r of q(`SELECT wallet, mint, SUM(CASE WHEN side='buy' THEN usd ELSE 0 END) b, SUM(CASE WHEN side='sell' THEN usd ELSE 0 END) s, SUM(CASE WHEN side='buy' THEN tokens ELSE -tokens END) net, COUNT(*) n FROM trades WHERE ts>=? GROUP BY wallet, mint`, since)) { if (HIDDEN.has(r.mint)) continue;
        if (skip.has(r.wallet)) continue; const val = r.s + Math.max(0, r.net) * (px.get(r.mint) || 0), pnl = val - r.b, e = W.get(r.wallet) || { wallet: r.wallet, pnl: 0, n: 0, coins: 0, wins: 0, best: null };
        e.pnl += pnl; e.n += r.n; e.coins++; if (pnl > 0) e.wins++; if (!e.best || pnl > e.best.pnl) e.best = { mint: r.mint, pnl, x: r.b > 0 ? val / r.b : 0 }; W.set(r.wallet, e); }
      const traders = [...W.values()].sort((a, b) => b.pnl - a.pnl).slice(0, 100);
      const D = new Map(), coinsAll = q('SELECT * FROM coins');
      for (const c of coinsAll) { const st = q1('SELECT MAX(mcap_usd) ath, MAX(progress) prog FROM trades WHERE mint=?', c.mint), e = D.get(c.creator) || { wallet: c.creator, launches: 0, grads: 0, left: 0, best: 0, bestMint: null };
        e.launches++; if ((st.prog || 0) >= 100) e.grads++; if ((st.ath || 0) > e.best) { e.best = st.ath || 0; e.bestMint = c.mint; } try { if (REW && REW.state(c).era === 'out') e.left++; } catch {} D.set(c.creator, e); }
      const devs = [...D.values()].sort((a, b) => (b.grads * 3 + Math.log10(b.best + 1) * 4 - b.left * 5) - (a.grads * 3 + Math.log10(a.best + 1) * 4 - a.left * 5)).slice(0, 100);
      const hall = coinsAll.map((c) => ({ mint: c.mint, ath: q1('SELECT MAX(mcap_usd) a FROM trades WHERE mint=?', c.mint).a || 0 })).filter((x) => x.ath > 0).sort((a, b) => b.ath - a.ath).slice(0, 50);
      const lv = { traders, devs, hall }; lbCache.set(u.searchParams.get('per') || 'all', { ts: Date.now(), v: lv }); return J(lv); }
    if (p[1] === 'burns' && burnsSnap && Date.now() - burnsSnap.at < 30e3) return J(burnsSnap.v);
    if (p[1] === 'burns') { const burnt = new Set([...q('SELECT DISTINCT mint FROM uburn').map((r) => r.mint), ...(OPS && REW ? q(`SELECT DISTINCT mint FROM rlog WHERE kind IN ('taxburn','burntok')`).map((r) => r.mint) : [])]);
      const coins = q('SELECT mint, creator FROM coins').filter((r) => !HIDDEN.has(r.mint) && burnt.has(r.mint)), out = [];
      for (const c of coins) { const burned = await burnedOf(c.mint); if (burned < 1) continue;
        const r = REW ? q1(`SELECT COALESCE(SUM(CASE WHEN kind='taxburn' THEN lamports END),0)/1e6 tax, COALESCE(SUM(CASE WHEN kind='burntok' THEN lamports END),0)/1e6 bb FROM rlog WHERE mint=?`, c.mint) : { tax: 0, bb: 0 };
        out.push({ mint: c.mint, burned, tax: r.tax, buyback: r.bb, other: Math.max(0, burned - r.tax - r.bb) }); }
      const ev = (REW ? q(`SELECT mint, CASE kind WHEN 'taxburn' THEN 'tax' ELSE 'frozen' END src, lamports/1e6 tok, ts, sig, NULL wallet FROM rlog WHERE kind IN ('taxburn','burntok') AND lamports > 0`) : []).concat(q(`SELECT mint, 'dev' src, tok, ts, sig, wallet FROM uburn`)).sort((a, b) => b.ts - a.ts).slice(0, 200);
      burnsSnap = { at: Date.now(), v: { coins: out, events: ev } }; return J(burnsSnap.v); }
    if (p[1] === 'claim' && req.method === 'POST') { let body; try { body = await readBody(req, res, 4000); } catch (e) { return bodyFail(res, e); }
      withBody(async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); J(await REW.claimNow(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'ping' && req.method === 'POST') { let body; try { body = await readBody(req, res, 4000); } catch (e) { return bodyFail(res, e); }
      withBody(async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); J(await REW.ping(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: pubErr(e) })); } }); return; }
    if (p[1] === 'payouts') return J(OPS && REW ? q(`SELECT sig, MAX(ts) ts, SUM(lamports)/1e6 harvested, SUM(CASE WHEN kind='taxburn' THEN lamports ELSE 0 END)/1e6 burned, SUM(CASE WHEN kind='taxdev' THEN lamports ELSE 0 END)/1e6 dev, SUM(CASE WHEN kind='taxhold' THEN lamports ELSE 0 END)/1e6 holders, MAX(CASE WHEN kind='taxhold' THEN CAST(extra AS INT) END) n_holders FROM rlog WHERE mint=? AND kind IN ('taxburn','taxdev','taxhold') GROUP BY sig ORDER BY ts DESC LIMIT 50`, p[2]) : []);
    if (p[1] === 'candles') { const tf = u.searchParams.get('tf') || '1m'; return J(cached('cd|' + p[2] + '|' + tf, 5e3, () => candles(p[2], tf))); }
    if (p[1] === 'bubbles' && p[2]) { if (!rate('bub|' + ip(req), 30, 60e3)) return J({ error: 'slow down' }, 429); const k = 'bub|' + p[2], c0 = bubC.get(k); if (c0 && Date.now() - c0.ts < (c0.v?.done ? 60e3 : 6e3)) return J(c0.v);
      try { const v = await BUB.map(p[2]); if (!v) return J({ error: 'unknown coin' }, 404); bubC.set(k, { ts: Date.now(), v }); if (bubC.size > 500) bubC.delete(bubC.keys().next().value); return J(v); } catch (e) { return J({ error: 'bubble map unavailable' }, 503); } }
    if (p[1] === 'holders') { const withPs = (l) => l.slice(0, 300).map((x) => (x.curve || x.pool ? x : { ...x, ps: posStats(p[2], x.wallet, x.pct / 100 * SUPPLY) }));   // position value, spent and profit per holder
      const h = hCache.get(p[2]); if (hFresh(h)) return J(cached('hp|' + p[2] + '|' + h.ts, HOLD_TTL, () => withPs(h.list))); if (!q1('SELECT 1 FROM coins WHERE mint=?', p[2])) return J([]);
      if (!inflight.has(p[2]) && (!holderSlots() || (h?.failAt && Date.now() - h.failAt < 30e3) || !rate('hscan|' + ip(req), 20, 60e3))) return J(h?.list ? withPs(h.list) : []);   // a fresh scan is a getProgramAccounts: at most 3 at a time and 20/min per visitor (else the last list)
      const l = await scanHolders(p[2]); return J(cached('hp|' + p[2] + '|' + hCache.get(p[2]).ts, HOLD_TTL, () => withPs(l))); }
    res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end('{}');
  } catch (e) { res.writeHead(500, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ error: pubErr(e) })); }
}
let ready = false;
if (!PARTNER) { console.error('Set PARTNER=<treid fee-claimer wallet>'); process.exit(1); }
if (MAINNET && !(+process.env.OPS_PRIORITY_MICROLAMPORTS > 0)) console.error('!! OPS_PRIORITY_MICROLAMPORTS is 0 on mainnet — ops transactions may not land');
if (MAINNET && OPS && PARTNER === OPS.publicKey.toBase58()) { console.error('On mainnet the treasury (PARTNER) must be a separate cold wallet, not the hot ops wallet'); process.exit(1); }
setTimeout(async () => { for (const c of q('SELECT mint FROM coins ORDER BY created_at DESC LIMIT 300')) { if (!q1('SELECT 1 FROM cimg WHERE mint=? AND b=0', c.mint)) await coinImage(c.mint, 0); } }, 20e3);   // warm missing images after a restart
BUB = startBubbles({ conn, q, q1, run, holdersCached });
PUSH = startPush({ q, q1, run, rate, pub: process.env.VAPID_PUBLIC, priv: process.env.VAPID_PRIVATE, subject: process.env.VAPID_SUBJECT });
CO = startCallouts({ q, q1, run, push, rate, pinJSON, pinFile, pinataJwt: PINATA_JWT, gateway: PINATA_GW,
  coinStats: async (mint, wallet) => { const last = q1('SELECT mcap_usd, price_usd FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 1', mint) || {}; let pos = 0;
    let held = false; try { const hs = await holdersCached(mint); const h = hs.find((x) => x.wallet === wallet && !x.curve); if (h) { held = true; pos = h.pct / 100 * SUPPLY * (last.price_usd || 0); } } catch {}
    return { mc: last.mcap_usd || 0, pos, allowed: held && pos >= 1 }; } });   // you must actually hold ≥ $1 of the coin right now (a dust buy doesn't buy a voice)
run(`CREATE TABLE IF NOT EXISTS rlog(sig TEXT, i INT, mint TEXT, kind TEXT, lamports INT, ts INT, PRIMARY KEY(sig, i))`); try { run('ALTER TABLE rlog ADD COLUMN extra TEXT'); } catch {} run('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)');
CR = startCalloutRewards({ conn, ops: OPS, q, q1, run, mainnet: MAINNET, solUsd: () => SOL_USD, ready: () => !!REW && REW.ready(), otherLiab: () => (REW ? REW.liabilities() : 0) + (OPS_ST && OPS_ST.pending ? OPS_ST.pending() : 0) });   // callers earn a share of treid's fee on the buys their callouts bring
const sleep0 = (ms) => new Promise((r) => setTimeout(r, ms));
const coRestored = Promise.race([Promise.resolve().then(() => CO.restore()).catch((e) => console.log('callout restore err', String(e?.message || e).slice(0, 100))), sleep0(60e3)]);   // callouts must be back BEFORE old trades are replayed, or their callers' earnings are never credited
setInterval(() => push({ type: 'ping', t: Date.now() }), 25e3);               // keeps proxies from closing the stream
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let syncing = false; const lastSync = new Map();
async function syncAll() {   // safety net for missed websocket messages: every config, 3 at a time, never overlapping runs
  if (syncing) return; syncing = true;
  try { for (const w of PARTNERS) await syncAddress(w, 100).catch(() => {});   // new configs/coins mention the treid wallets
    const act = retier(), now = Date.now();   // live (48h): every 5 min · quiet (30d): every 30 min · dead: every 6h
    const list = [...act].filter(([k, t]) => { const age = now - t, every = age < LIVE_MS ? 5 * 60e3 : age < 30 * 864e5 ? 30 * 60e3 : 6 * 36e5; return now - (lastSync.get(k) || 0) >= every; }).map((x) => x[0]);
    for (let i = 0; i < list.length; i += 3) await Promise.all(list.slice(i, i + 3).map((k) => syncAddress(k, 200).then(() => lastSync.set(k, now)).catch(() => {})));
    for (const c of q(`SELECT c.* FROM coins c WHERE c.damm IS NULL AND (SELECT progress FROM trades t WHERE t.mint=c.mint ORDER BY ts DESC, slot DESC LIMIT 1) >= 99`)) await checkGrad(c).catch(() => {});   // a migration we missed
  } finally { syncing = false; }
}
async function start() {
  await coRestored;
  // full history first (retrying until it works) — nothing that depends on history starts before this succeeds
  for (let i = 1; ; i++) { try { await solPrice(); await quotePrices().catch(() => {}); await backfill(); break; } catch (e) { console.log('startup retry', i, String(e?.message || e).slice(0, 120)); await sleep(Math.min(60e3, 5e3 * i)); } }
  ready = true; setInterval(solPrice, 60e3); setInterval(() => quotePrices().catch(() => {}), 60e3);
  for (const w of PARTNERS) conn.onLogs(new PublicKey(w), (l) => { if (!l.err) enqueue(l.signature); }, 'confirmed');
  setInterval(() => syncAll().catch(() => {}), 5 * 60e3);
  setInterval(() => { for (const w of PARTNERS) syncAddress(w, 50).catch(() => {}); }, 60e3);   // a new coin shows up within a minute even if its stream message was missed
  // orphan pools: a pool on a treid config whose coin isn't indexed (e.g. skipped by an older rule) — add it and replay its history once
  const fixQs = async () => { for (const c of q('SELECT DISTINCT quote_mint m, quote_symbol s FROM coins WHERE quote_mint IS NOT NULL AND quote_mint != ?', WSOL)) { if (!c.s || c.s !== c.m.slice(0, 4)) continue;
    try { const j = await (await fetchT(JUP + '/tokens/v2/search?query=' + c.m)).json(), t0 = Array.isArray(j) ? j.find((x) => x.id === c.m) : null; if (t0 && typeof t0.symbol === 'string') run('UPDATE coins SET quote_symbol=? WHERE quote_mint=?', t0.symbol.slice(0, 16), c.m); } catch {} } };
  setTimeout(() => fixQs().catch(() => {}), 30e3);
  const orphans = async () => { for (const k of [...configs]) { let ps = []; try { ps = await dbc.state.getPoolsByConfig(k); } catch { continue; }
    for (const p of ps) { const st = p.account?.poolState || p.account, mint = st?.baseMint?.toBase58?.(); if (!mint || q1('SELECT 1 FROM coins WHERE mint=?', mint)) continue;
      const r = await addCoin(mint, 0, 0, null, p.publicKey.toBase58()).catch(() => 'retry'); if (r !== true) continue; console.log('orphan pool indexed', mint); await quotePrices().catch(() => {});   // its pair price first, so the replayed trades get USD values
      let before; for (let i = 0; i < 10; i++) { const pg = await conn.getSignaturesForAddress(p.publicKey, { before, limit: 1000 }, 'confirmed').catch(() => []); if (!pg.length) break;
        for (const x of pg) if (!x.err) { run('DELETE FROM seen WHERE sig=?', x.signature); enqueue(x.signature); } if (pg.length < 1000) break; before = pg[pg.length - 1].signature; } } } };
  // trades recorded while their pair token had no USD price yet: replay them once the price is known (chart, volume, market cap)
  const repriced = async () => { for (const c of q('SELECT mint, pool, quote_mint FROM coins WHERE quote_mint IS NOT NULL AND quote_mint != ?', WSOL)) { if (!(quoteUsd(c.quote_mint) > 0)) continue;
    const bad = q('SELECT sig FROM trades WHERE mint=? AND (usd IS NULL OR usd=0) AND sol>0', c.mint); if (!bad.length) continue;
    const txs = [...new Set(bad.map((b) => b.sig.split('#')[0]))]; for (const b of bad) run('DELETE FROM trades WHERE sig=?', b.sig); for (const t of txs) { run('DELETE FROM seen WHERE sig=?', t); enqueue(t); }   /* row keys can carry '#…' for a 2nd event in one tx */ console.log('repricing', bad.length, 'trades of', c.mint.slice(0, 6)); } };
  setTimeout(() => quotePrices().then(repriced).catch(() => {}), 60e3); setInterval(() => repriced().catch(() => {}), 30 * 60e3);
  setTimeout(() => orphans().catch((e) => console.log('orphan scan err', String(e?.message || e).slice(0, 80))), 20e3); setInterval(() => orphans().catch(() => {}), 6 * 36e5);
  retier(); setInterval(() => loadConfigs().catch(() => {}), 24 * 36e5);   // full config rescan only daily (new configs are picked up from their own create tx)
  console.log('watching', configs.size, 'treid configs (partners', PARTNERS.join(', '), ')');
  if (!OPS) return;
  REW = startRewards({ conn, dbc, ops: OPS, treasury: PARTNER, q, q1, run: runLedger, mainnet: MAINNET, quoteUsd: (c) => quoteUsd(c.quote_mint, c.quote_symbol), lockedOf: async (c) => (await LOCKS.fresh(c))?.inside || 0, balances: async (mint) => new Map((await holdersCached(mint)).filter((h) => !h.curve).map((h) => [h.wallet, h.pct / 100 * SUPPLY])) });
  for (let i = 1; ; i++) { try { await REW.rebuild(); break; } catch (e) { console.log('rewards rebuild retry', i, String(e?.message || e).slice(0, 120)); await sleep(Math.min(60e3, 5e3 * i)); } }   // a hole in the ledger could pay the wrong person
  setTimeout(() => REW.cycle(), 30e3); setInterval(() => REW.cycle(), +(process.env.OPS_EVERY_MIN || 10) * 60e3);
  // creator reminders (push to the creator's own devices): 24 h and 6 h before their coin's fees pause for inactivity — once per quiet spell
  setInterval(() => { if (!PUSH || !PUSH.toWallet) return; try { for (const c of q('SELECT * FROM coins')) { if (HIDDEN.has(c.mint)) continue; let st; try { st = REW.state(c); } catch { continue; }
    if (st && st.creator && (st.era === 'out' || st.state === 'out' || st.state === 'frozen')) {   // tell the creator once when their fees pause / when they're out
      const out = st.era === 'out' || st.state === 'out', k2 = (out ? 'notify:out:' : 'notify:paused:') + c.mint + ':' + st.creator + (out ? '' : ':' + st.last);
      if (!q1('SELECT 1 FROM kv WHERE k=?', k2)) { run('INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)', k2, String(Date.now()));
        PUSH.toWallet(st.creator, out ? { title: '🔴 $' + c.symbol + ': you are out as creator', body: (st.why === 'sold' ? 'You sold 70%+ of your bag and hold under 0.5% of supply' : 'No activity for 7 days') + ' — your creator fees now buy back & burn the coin.', path: '#/coin/' + c.mint, tag: 'out-' + c.mint }
          : { title: '⏸ $' + c.symbol + ': your creator fees are paused', body: 'No activity for 72h — fees now buy back & burn. Tap “Resume my fees” to start earning again.', path: '#/coin/' + c.mint, tag: 'remind-' + c.mint }); }
      continue; }
    if (!st || st.state !== 'active' || !st.creator || !(st.idle > 0)) continue; const left = 72 * 3600e3 - st.idle, stage = left <= 6 * 3600e3 ? 6 : left <= 24 * 3600e3 ? 24 : 0; if (!stage || left <= 0) continue;
    const k = 'remind:' + c.mint + ':' + st.creator + ':' + stage + ':' + st.last; if (q1('SELECT 1 FROM kv WHERE k=?', k)) continue; run('INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)', k, String(Date.now()));
    PUSH.toWallet(st.creator, { title: '⏳ $' + c.symbol + ': your fees pause in ' + Math.max(1, Math.round(left / 36e5)) + 'h', body: 'Tap “I’m still here” (or post an update) to keep earning from your coin.', path: '#/coin/' + c.mint, tag: 'remind-' + c.mint }); } } catch (e) { console.log('remind err', String(e?.message || e).slice(0, 80)); } }, 5 * 60e3);
  OPS_ST = startOps({ conn, dbc, ops: OPS, treasury: PARTNER, q, q1, run: runLedger, mainnet: MAINNET, rewardOk: (m) => quoteAllowed(m), quoteUsd: (c) => quoteUsd(c.quote_mint, c.quote_symbol), devState: (c) => REW.state(c), liabilities: () => REW.liabilities(), reserved: () => CR.owed(), callerCost: (since) => CR.earnedSince(since), ready: () => REW.ready(), poolAuthority: deriveDbcPoolAuthority().toBase58(), everyMs: +(process.env.OPS_EVERY_MIN || 10) * 60e3 });
  const opsBal = () => conn.getBalance(OPS.publicKey).then((b) => { opsSolC.v = b / 1e9; if (MAINNET && b < 0.05e9) console.error('!! ops wallet low on SOL:', b / 1e9); }).catch(() => {}); opsBal(); setInterval(opsBal, 10 * 60e3);
  console.log('ops wallet', OPS.publicKey.toBase58(), '→ treasury', PARTNER);
}
start();
