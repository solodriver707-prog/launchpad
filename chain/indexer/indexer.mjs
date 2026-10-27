// treid indexer: listens to Meteora DBC, stores treid coins + trades in SQLite, serves a JSON API + live stream
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getTokenMetadata, unpackAccount, getTransferFeeConfig, getMint, getExtensionTypes, ExtensionType, getScaledUiAmountConfig } from '@solana/spl-token';
import { DynamicBondingCurveClient, DYNAMIC_BONDING_CURVE_PROGRAM_ID, deriveDbcPoolAuthority, DynamicBondingCurveIdl, getPriceFromSqrtPrice, deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm, CpAmmIdl, getPriceFromSqrtPrice as ammPrice } from '@meteora-ag/cp-amm-sdk';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
const coder = new anchor.BorshEventCoder(DynamicBondingCurveIdl), ammCoder = new anchor.BorshEventCoder(CpAmmIdl);
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { opsKeypair, startOps } from './ops.mjs';
import { startRewards } from './rewards.mjs';
import { startCallouts } from './callouts.mjs';
import { fetchT, JUP } from './txutil.mjs';
import { verifySig, SITES, issueSession } from './sig.mjs';
import { ed25519 } from '@noble/curves/ed25519';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const WS = process.env.WS || RPC.replace('http', 'ws').replace(':8899', ':8900');
const PARTNER = process.env.PARTNER;               // treid treasury / legacy fee-claimer wallet
const MAINNET = process.env.CLUSTER === 'mainnet' || /mainnet/.test(RPC);
const OPS = opsKeypair(process.env.OPS_SECRET, { mainnet: MAINNET });   // optional hot ops wallet: fee claimer + tax authority of new coins
const PARTNERS = [...new Set([PARTNER, OPS?.publicKey.toBase58()].filter(Boolean))];   // coins from configs of any of these are indexed
const PORT = +(process.env.PORT || 8787), PUBLIC_URL = (process.env.PUBLIC_URL || 'https://treid-indexer.onrender.com').replace(/\/+$/, '');
let SOL_USD = +(process.env.SOL_USD || 150);
// permanent coin images + metadata on IPFS via Pinata (set PINATA_JWT); without it metadata lives in this server's memory only
const PINATA_JWT = process.env.PINATA_JWT || '', PINATA_GW = (process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud').replace(/\/+$/, '');
async function pinFile(dataUrl, name) {
  const [h, b64] = dataUrl.split(','), type = h.slice(5, h.indexOf(';')), fd = new FormData();
  fd.append('file', new Blob([Buffer.from(b64, 'base64')], { type }), name + '.' + (type.split('/')[1] || 'png').replace('svg+xml', 'svg'));
  fd.append('pinataMetadata', JSON.stringify({ name: 'treid-' + name }));
  const r = await fetchT('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { authorization: 'Bearer ' + PINATA_JWT }, body: fd });
  const j = await r.json(); if (!j.IpfsHash) throw new Error('pinata file: ' + JSON.stringify(j).slice(0, 120)); return PINATA_GW + '/ipfs/' + j.IpfsHash;
}
async function pinJSON(obj, name) {
  const r = await fetchT('https://api.pinata.cloud/pinning/pinJSONToIPFS', { method: 'POST', headers: { authorization: 'Bearer ' + PINATA_JWT, 'content-type': 'application/json' }, body: JSON.stringify({ pinataContent: obj, pinataMetadata: { name: 'treid-' + name + '.json' } }) });
  const j = await r.json(); if (!j.IpfsHash) throw new Error('pinata json: ' + JSON.stringify(j).slice(0, 120)); return PINATA_GW + '/ipfs/' + j.IpfsHash;
}
async function solPrice() { try { const r = await fetchT('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'); const j = await r.json(); if (j?.solana?.usd) SOL_USD = j.solana.usd; } catch {} }
const HIDDEN = new Set(String(process.env.HIDDEN_MINTS || '').split(',').map((s) => s.trim()).filter(Boolean));   // our own test coins: kept on-chain (and paid out fairly), just not listed on the site
const SUPPLY = 1e9, WSOL = 'So11111111111111111111111111111111111111112';
const QUOTE_OVERRIDE = (() => { try { return JSON.parse(process.env.QUOTE_USD || '{}'); } catch { return {}; } })();   // {"<mint>": 1} for devnet test tokens
const qPrice = new Map();
const STABLE = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU']);   // USDC, USDT, devnet USDC — never guessed from a name
function quoteUsd(mint, symbol) { if (!mint || mint === WSOL) return SOL_USD; if (QUOTE_OVERRIDE[mint] != null) return +QUOTE_OVERRIDE[mint]; const p = qPrice.get(mint); if (p) return p; return STABLE.has(mint) ? 1 : 0; }
async function quotePrices() {
  const ms = q('SELECT DISTINCT quote_mint m FROM coins WHERE quote_mint IS NOT NULL AND quote_mint != ?', WSOL).map((r) => r.m).filter((m) => QUOTE_OVERRIDE[m] == null); if (!ms.length) return;
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
const dbc = new DynamicBondingCurveClient(conn, 'confirmed'), amm = new CpAmm(conn);
let DB_PATH = process.env.DB || 'treid.db', db;
try { db = new DatabaseSync(DB_PATH); db.exec('CREATE TABLE IF NOT EXISTS _w(x INT); DROP TABLE _w;'); }   // the persistent disk must be writable
catch (e) { console.error('!! DATABASE NOT WRITABLE at', DB_PATH, '-', e.message, '— falling back to /tmp (data is rebuilt from chain on every restart)'); DB_PATH = '/tmp/treid.db'; db = new DatabaseSync(DB_PATH); }
db.exec(`CREATE TABLE IF NOT EXISTS coins(mint TEXT PRIMARY KEY, pool TEXT, config TEXT, creator TEXT, name TEXT, symbol TEXT, uri TEXT, tax_bps INT, created_slot INT, created_at INT);
CREATE TABLE IF NOT EXISTS trades(sig TEXT PRIMARY KEY, mint TEXT, wallet TEXT, side TEXT, sol REAL, tokens REAL, price_usd REAL, mcap_usd REAL, slot INT, ts INT, sniper INT DEFAULT 0, bundle INT DEFAULT 0, fee_sol REAL DEFAULT 0, progress REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS t_mint ON trades(mint, ts);
CREATE TABLE IF NOT EXISTS seen(sig TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS payouts(id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, ts INT, harvested REAL, burned REAL, dev REAL, holders REAL, n_holders INT, fees_sol REAL);
CREATE TABLE IF NOT EXISTS meta(mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, description TEXT, image TEXT, banner TEXT, at INT);`);
for (const col of ['trap_bps INT DEFAULT 0', 'trap_secs INT DEFAULT 0', 'trap_steps INT DEFAULT 0', "quote_mint TEXT DEFAULT 'So11111111111111111111111111111111111111112'", 'quote_dec INT DEFAULT 9', "quote_symbol TEXT DEFAULT 'SOL'"]) { try { db.exec('ALTER TABLE coins ADD COLUMN ' + col); } catch {} }
try { db.exec('ALTER TABLE trades ADD COLUMN usd REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE trades ADD COLUMN reserve REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE coins ADD COLUMN damm TEXT'); } catch {}   // the coin's DAMM v2 pool once it graduated
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
async function loadConfigs() {
  if (!PARTNERS.length) return; const cs = (await Promise.all(PARTNERS.map((w) => dbc.state.getPoolConfigsByOwner(new PublicKey(w))))).flat();
  for (const c of cs) { const k = c.publicKey.toBase58(); if (!configs.has(k) && treidConfig(c.account) && configs.size < 1e6) configs.add(k); }   // which ones get a live stream is decided by retier()
}
const cfgFound = new Map();   // configs seen being created (their coin may not be indexed yet) → counted as active
async function addConfig(k) {   // one new config, read on its own (never a rescan of every config)
  if (configs.has(k)) return true; if (configs.size >= 1e6) return false;
  const cf = await dbc.state.getPoolConfig(new PublicKey(k)).catch(() => null); if (!cf || !treidConfig(cf)) return false;
  configs.add(k); cfgFound.set(k, Date.now()); watch(k); for (const ms of [6e3, 25e3]) setTimeout(() => syncAddress(k, 100).catch(() => {}), ms); return true;   // its pool may be created before the stream is up
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
const clients = new Set(); const push = (ev) => { const s = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) { if (c.writableLength > 256e3) { clients.delete(c); try { c.destroy(); } catch {} continue; } c.write(s); } };   // slow readers are dropped, never buffered forever
let CO = null, coinsSnap = null, burnsSnap = null; const opsSolC = { v: null };   // callouts (started below, once the helpers exist)

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
    if (!qs) { const qmd = qprog ? await getTokenMetadata(conn, new PublicKey(qm), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(softErr) : null; qs = qmd?.symbol || qm.slice(0, 4); } }
  const m = await getMint(conn, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(softErr); const tf = m && getTransferFeeConfig(m);
  // the coin itself: 6 decimals, nobody can mint or freeze, and only the extensions treid uses (no hooks, delegates or other surprises)
  const OKX = new Set([ExtensionType.TransferFeeConfig, ExtensionType.MetadataPointer, ExtensionType.TokenMetadata]);
  if (!m || m.decimals !== 6 || m.mintAuthority || m.freezeAuthority || getExtensionTypes(m.tlvData).some((e) => !OKX.has(e))) { console.log('skip  non-standard coin', mint); return false; }
  const tfa = tf?.transferFeeConfigAuthority; if (tfa && !tfa.equals(PublicKey.default) && tfa.toBase58() !== deriveDbcPoolAuthority().toBase58()) { console.log('skip  tax can be changed by someone', mint); return false; }   // nobody but the program may ever change the tax
  if (qm !== WSOL) { const qa = await conn.getAccountInfo(new PublicKey(qm)).catch(softErr); if (qa?.owner?.equals(TOKEN_2022_PROGRAM_ID)) { const qmi = await getMint(conn, new PublicKey(qm), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(softErr); const QOK = new Set([ExtensionType.MetadataPointer, ExtensionType.TokenMetadata, ExtensionType.ImmutableOwner]); const tfq = qmi && getTransferFeeConfig(qmi), taxed = tfq && (tfq.newerTransferFee.transferFeeBasisPoints > 0 || tfq.olderTransferFee.transferFeeBasisPoints > 0);
    if (!qmi || taxed || getExtensionTypes(qmi.tlvData).includes(ExtensionType.TransferHook) || (getExtensionTypes(qmi.tlvData).some((e) => !QOK.has(e)) && !(await hasBadge(qm)))) { console.log('skip  pair token not allowed', mint); return false; } } }   // extra features only with Meteora's badge; never taxed or hooked
  const ins = run('INSERT OR IGNORE INTO coins(mint,pool,config,creator,name,symbol,uri,tax_bps,created_slot,created_at,trap_bps,trap_secs,trap_steps,quote_mint,quote_dec,quote_symbol) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', mint, ps.publicKey.toBase58(), cfg, creator || pst.creator.toBase58(), md?.name || '', md?.symbol || '', md?.uri || '', tf ? tf.newerTransferFee.transferFeeBasisPoints : 0, creator ? slot : 0, creator || !cf || Number(cf.activationType) !== 1 ? ts : Number(pst.activationPoint) * 1000, trap.bps, trap.secs, trap.steps, qm, qd, qs || 'SOL');
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
    const QD = 10 ** (coin.quote_dec ?? 9), QU = quoteUsd(coin.quote_mint || WSOL, coin.quote_symbol), tax = (coin.tax_bps || 0) / 1e4, buy = Number(ev.data.trade_direction) === 1;
    if (!gradTarget.has(coin.mint) && coin.config) { const cf = await dbc.state.getPoolConfig(new PublicKey(coin.config)).catch(() => null); if (cf) gradTarget.set(coin.mint, Number(cf.migrationQuoteThreshold.toString()) / QD); }   // newer swap events don't carry the threshold
    let inAmt, outAmt, fee, sq, reserveRaw, targetRaw;
    if (ev.name === 'EvtSwap2') { const r = ev.data.swap_result; inAmt = Number(r.included_fee_input_amount); outAmt = Number(r.output_amount); fee = Number(r.trading_fee); sq = r.next_sqrt_price; reserveRaw = Number(ev.data.quote_reserve_amount); targetRaw = Number(ev.data.migration_threshold); }
    else { inAmt = Number(ev.data.included_transfer_fee_amount_in); outAmt = Number(ev.data.excluded_transfer_fee_amount_out); fee = Number(ev.data.trading_fee); sq = ev.data.next_sqrt_price; reserveRaw = Number(ev.data.quote_reserve); targetRaw = gradTarget.get(coin.mint) * QD || 0; }
    const side = buy ? 'buy' : 'sell', sol = (buy ? inAmt : outAmt) / QD, tokens = buy ? outAmt / 1e6 * (ev.name === 'EvtSwap2' ? 1 - tax : 1) : inAmt / 1e6;   // tokens the trader actually got / gave
    const price = sq ? Number(getPriceFromSqrtPrice(sq, 6, coin.quote_dec ?? 9)) * QU : (tokens ? sol * QU / tokens : 0);
    const prog = targetRaw ? reserveRaw / targetRaw * 100 : (q1('SELECT progress p FROM trades WHERE mint=? ORDER BY ts DESC LIMIT 1', coin.mint)?.p || 0), reserve = reserveRaw / QD;
    if (targetRaw && !gradTarget.has(coin.mint)) gradTarget.set(coin.mint, targetRaw / QD);
    const sniper = buy && trader !== coin.creator && (coin.created_slot > 0 ? tx.slot - coin.created_slot <= 4 : ts - coin.created_at <= 2000) ? 1 : 0;   // ~1.5s after launch: faster than a human
    const rowSig = n++ ? sig + '#' + coin.mint.slice(0, 6) : sig;
    run('INSERT OR IGNORE INTO trades(sig,mint,wallet,side,sol,tokens,price_usd,mcap_usd,slot,ts,sniper,bundle,fee_sol,progress,usd,reserve) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)', rowSig, coin.mint, trader, side, sol, tokens, price, price * SUPPLY, tx.slot, ts, sniper, fee / QD, Math.min(100, prog), sol * QU, reserve);
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
    const QD = 10 ** (coin.quote_dec ?? 9), QU = quoteUsd(coin.quote_mint || WSOL, coin.quote_symbol), d = ev.data, r = d.swap_result, buy = Number(d.trade_direction) === 1;   // tokenA = coin, tokenB = pair: B→A is a buy
    const sol = Number(buy ? d.included_transfer_fee_amount_in : d.excluded_transfer_fee_amount_out) / QD, tokens = Number(buy ? d.excluded_transfer_fee_amount_out : d.included_transfer_fee_amount_in) / 1e6;
    const fee = ['claiming_fee', 'protocol_fee', 'compounding_fee', 'referral_fee'].reduce((a, k) => a + Number(r[k] || 0), 0), price = Number(ammPrice(r.next_sqrt_price, 6, coin.quote_dec ?? 9)) * QU, side = buy ? 'buy' : 'sell';
    const rowSig = n++ ? sig + '#' + coin.mint.slice(0, 6) : sig;
    run('INSERT OR IGNORE INTO trades(sig,mint,wallet,side,sol,tokens,price_usd,mcap_usd,slot,ts,sniper,bundle,fee_sol,progress,usd,reserve) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,100,?,?)', rowSig, coin.mint, trader, side, sol, tokens, price, price * SUPPLY, tx.slot, ts, fee / QD, sol * QU, Number(d.reserve_b_amount) / QD);
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
const hCache = new Map(), inflight = new Map(), lbCache = new Map(), iconC = new Map();
function holdersCached(mint) { const h = hCache.get(mint); if (h?.list && Date.now() - h.ts < 30e3) return Promise.resolve(h.list); if (!inflight.has(mint)) inflight.set(mint, holders(mint).then((l) => { hCache.set(mint, { ts: Date.now(), list: l }); return l; }).finally(() => inflight.delete(mint))); return inflight.get(mint); }
// simple in-memory rate limiter (per key, n hits per window)
const hits = new Map(); function rate(k, n, ms) { const now = Date.now(), a = (hits.get(k) || []).filter((t) => now - t < ms); if (a.length >= n) { hits.set(k, a); return false; } a.push(now); hits.set(k, a);
  if (hits.size > 50000) for (const [key, v] of hits) if (now - v[v.length - 1] > 36e5) hits.delete(key);   // evict by age, never wipe all limits
  return true; }
const ip = (req) => { const x = String(req.headers['x-forwarded-for'] || '').split(',').map((v) => v.trim()).filter(Boolean); return x.length ? x[x.length - 1] : String(req.socket.remoteAddress || ''); };   // rightmost = added by Render's proxy; the left ones are client-controlled
function liveHolders(mint, refresh = true) { const h = hCache.get(mint); if (refresh && (!h || Date.now() - h.ts > 120e3) && holderSlots()) { if (!h?.busy) { const e = h || { ts: 0, list: null }; e.busy = true; hCache.set(mint, e); hRun++; holders(mint).then((l) => { hCache.set(mint, { ts: Date.now(), list: l }); }).catch(() => { e.busy = false; e.ts = Date.now() - 60e3; }).finally(() => { hRun--; }); } } return h?.list || null; }
let hRun = 0; const holderSlots = () => hRun < 3;   // at most 3 holder scans at a time (each is a getProgramAccounts)
function stats(mint, list = false) {
  const c = q1('SELECT * FROM coins WHERE mint=?', mint); if (!c) return null;
  const last = q1('SELECT mcap_usd, progress, reserve FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 1', mint);
  const agg = q1(`SELECT COUNT(*) n, SUM(sol) vol, SUM(usd) volusd, SUM(side='buy') buys, SUM(side='sell') sells, COUNT(DISTINCT wallet) traders, SUM(CASE WHEN sniper=1 THEN tokens ELSE 0 END) snipeTok, SUM(CASE WHEN bundle=1 AND side='buy' THEN tokens ELSE 0 END) bundleTok FROM trades WHERE mint=?`, mint);
  const bal = q(`SELECT wallet, SUM(CASE WHEN side='buy' THEN tokens ELSE -tokens END) n FROM trades WHERE mint=? GROUP BY wallet HAVING n > 0.5 ORDER BY n DESC`, mint);
  const devBuy = q1(`SELECT 1 x FROM trades WHERE mint=? AND wallet=? AND side='buy' LIMIT 1`, mint, c.creator);
  const recent = (q1('SELECT MAX(ts) t FROM trades WHERE mint=?', mint)?.t || 0) > Date.now() - 36e5, lh = liveHolders(mint, !list || recent), real = lh ? lh.filter((h) => !h.curve) : null;
  const devN = real ? (real.find((h) => h.wallet === c.creator)?.pct || 0) / 100 * SUPPLY : bal.find(b => b.wallet === c.creator)?.n || 0;
  const top10 = Math.min(SUPPLY, real ? real.slice(0, 10).reduce((s, h) => s + h.pct / 100 * SUPPLY, 0) : bal.slice(0, 10).reduce((s, b) => s + b.n, 0));
  const po = OPS && REW ? q1(`SELECT COALESCE(SUM(CASE WHEN kind='taxburn' THEN lamports END),0)/1e6 burned, COALESCE(SUM(CASE WHEN kind='taxhold' THEN lamports END),0)/1e6 holders, COALESCE(SUM(CASE WHEN kind='taxdev' THEN lamports END),0)/1e6 dev, COUNT(CASE WHEN kind='taxhold' THEN 1 END) n, COALESCE(SUM(CASE WHEN kind='taxholdq' THEN lamports END),0) * 1.0 / ${10 ** (c.quote_dec ?? 9)} holders_q FROM rlog WHERE mint=? AND kind IN ('taxburn','taxdev','taxhold','taxholdq')`, mint) : null;   // from on-chain receipts → survives restarts
  return { ...c, tax_paid: po, reserve: last?.reserve || 0, grad_target: gradTarget.get(mint) || 0, quote_usd: quoteUsd(c.quote_mint, c.quote_symbol), vol_usd: agg.volusd || 0, holders: real ? real.length : bal.length, dev_pct: devN / SUPPLY * 100, dev_sold: !!devBuy && devN < 1, top10_pct: top10 / SUPPLY * 100, sol_usd: SOL_USD, mcap_usd: last?.mcap_usd || 0, curve_pct: last?.progress || 0, trades: agg.n, vol_sol: agg.vol || 0, buys: agg.buys || 0, sells: agg.sells || 0, traders: agg.traders, snipers_pct: (agg.snipeTok || 0) / SUPPLY * 100, bundles_pct: (agg.bundleTok || 0) / SUPPLY * 100 };
}
process.on('unhandledRejection', (e) => console.log('unhandled', String(e?.message || e).slice(0, 200)));   // one bad request or RPC hiccup must never kill the server
process.on('uncaughtException', (e) => console.log('uncaught', String(e?.message || e).slice(0, 200)));
const sseByIp = new Map();
http.createServer((req, res) => { handleReq(req, res).catch((e) => { console.log('req err', String(e?.message || e).slice(0, 160)); try { if (!res.headersSent) res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end('{"ok":false}'); } catch {} }); }).listen(PORT, () => console.log('API on :' + PORT));
async function handleReq(req, res) {
  const u = new URL(req.url, 'http://x'), p = u.pathname.split('/').filter(Boolean), J = (o) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }
  // coin metadata (image / description) posted by the site at launch — first write wins. TODO mainnet: pin to IPFS instead.
  if (p[1] === 'upload' && req.method === 'POST') {   // before launch: pin image(s) + metadata JSON to IPFS, return the permanent URI
    if (!rate('up|' + ip(req), 6, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end(JSON.stringify({ uri: null, error: 'too many uploads — try again later' })); }
    let body = ''; req.on('data', (d) => { body += d; if (body.length > 3e6) req.destroy(); });
    req.on('end', async () => { try { if (!PINATA_JWT) return J({ uri: null });
      const m = JSON.parse(body), wl = String(m.wallet || ''), wts = +m.ts;   // only a real wallet with SOL can pin (protects the IPFS account)
      if (!(Math.abs(Date.now() - wts) <= 5 * 60e3) || !verifySig(`treid: upload — ${wl} — ${wts}`, m.sig, wl, wts)) throw new Error('sign the upload with your wallet');
      if (!rate('upw|' + wl, 10, 864e5)) throw new Error('upload limit reached for today'); if ((await conn.getBalance(new PublicKey(wl))) < 0.02e9) throw new Error('your wallet needs a little SOL to launch');
      const ok = (v) => typeof v === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(v) && v.length < 1.5e6, tag = String(m.symbol || 'coin').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) + '-' + Date.now().toString(36);
      const image = ok(m.image) ? await pinFile(m.image, tag) : null, banner = ok(m.banner) ? await pinFile(m.banner, tag + '-banner') : null;
      const meta = { name: String(m.name || '').slice(0, 32), symbol: String(m.symbol || '').slice(0, 10), description: String(m.description || '').slice(0, 600), image, banner, external_url: 'https://treid.fun', properties: { files: image ? [{ uri: image, type: 'image' }] : [] } };
      if (m.x) meta.twitter = String(m.x).slice(0, 100); if (m.tg) meta.telegram = String(m.tg).slice(0, 100); if (m.web) meta.website = String(m.web).slice(0, 100);
      J({ uri: await pinJSON(meta, tag), image, banner }); } catch (e) { console.log('upload err', e.message); res.writeHead(502, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ uri: null, error: e.message })); } });
    return;
  }
  if (p[1] === 'meta' && req.method === 'POST') { res.writeHead(410, { 'access-control-allow-origin': '*' }); return res.end('{"ok":false,"error":"metadata lives on IPFS now"}'); }
  if (p[1] === 'meta' && p[2]) { const m = q1('SELECT * FROM meta WHERE mint=?', p[2]), c = q1('SELECT name, symbol FROM coins WHERE mint=?', p[2]); if (!m && !c) { res.writeHead(404, { 'access-control-allow-origin': '*' }); return res.end('{}'); }
    const base = PUBLIC_URL;
    return J({ name: m?.name || c?.name, symbol: m?.symbol || c?.symbol, description: m?.description || '', image: m?.image ? base + '/api/img/' + p[2] : null, banner: m?.banner ? base + '/api/img/' + p[2] + '?b=1' : null }); }
  if (p[1] === 'img' && p[2]) { const m = q1('SELECT image, banner FROM meta WHERE mint=?', p[2]), d = u.searchParams.get('b') ? m?.banner : m?.image; if (!d) { res.writeHead(404); return res.end(); }
    const [h, b64] = d.split(','), ct = h.slice(5, h.indexOf(';')); if (!/^image\/(png|jpe?g|gif|webp)$/.test(ct)) { res.writeHead(404); return res.end(); }   // never serve svg (script)
    res.writeHead(200, { 'content-type': ct, 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' }); return res.end(Buffer.from(b64, 'base64')); }
  if (!p.length || p[1] === 'health') return J({ ok: true, coins: q1('SELECT COUNT(*) n FROM coins').n, trades: q1('SELECT COUNT(*) n FROM trades').n, configs: configs.size, partner: PARTNER || null, ops: OPS?.publicKey.toBase58() || null, ipfs: !!PINATA_JWT, sol_usd: SOL_USD, ready, cluster: MAINNET ? 'mainnet' : 'devnet', db_persistent: DB_PATH.startsWith('/data/'), ops_sol: opsSolC.v, sites: SITES });
  try {
    if (p[1] === 'stream') { const ipx = ip(req), nIp = sseByIp.get(ipx) || 0; if (clients.size >= 3000 || nIp >= 6) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end(); }
      sseByIp.set(ipx, nIp + 1); req.on('close', () => { const v = (sseByIp.get(ipx) || 1) - 1; if (v > 0) sseByIp.set(ipx, v); else sseByIp.delete(ipx); });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' }); res.write(': hi\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
    if (p[1] === 'qprice' && !rate('qp|' + ip(req), 30, 6e4)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('{}'); }
    if (p[1] === 'ticon') {   // logo of a verified token by exact symbol (e.g. tokenized stocks), fetched once and served from here — raster images only
      const sym = String(u.searchParams.get('sym') || ''), mintQ = String(u.searchParams.get('mint') || '');
      if (!/^[A-Za-z0-9]{2,12}$/.test(sym) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintQ)) { res.writeHead(404); return res.end(); }
      const ik = mintQ || sym.toLowerCase(); let h = iconC.get(ik);
      if (!h || Date.now() - h.at > 864e5) { if (!rate('ti|' + ip(req), 60, 6e4)) { res.writeHead(429); return res.end(); } h = { at: Date.now(), buf: null, ct: null };
        try { const j = await (await fetchT(JUP + '/tokens/v2/search?query=' + encodeURIComponent(mintQ || sym))).json(), t = (Array.isArray(j) ? j : []).find((x) => x && (mintQ ? x.id === mintQ : (x.isVerified || (x.tags || []).includes('verified')) && String(x.symbol).toLowerCase() === sym.toLowerCase()));
          const url = t && typeof t.icon === 'string' ? new URL(t.icon) : null;
          if (url && url.protocol === 'https:' && !/^(\d+\.){3}\d+$|^\[|localhost|\.internal$|\.local$/i.test(url.hostname)) { const r = await fetchT(url.href), ct = String(r.headers.get('content-type') || '').split(';')[0];
            if (r.ok && /^image\/(png|jpeg|webp|gif)$/.test(ct)) { const buf = Buffer.from(await r.arrayBuffer()); if (buf.length <= 400e3) { h.buf = buf; h.ct = ct; } } } } catch {}
        iconC.set(ik, h); if (iconC.size > 500) iconC.delete(iconC.keys().next().value); }
      if (!h.buf) { res.writeHead(404, { 'access-control-allow-origin': '*' }); return res.end(); }
      res.writeHead(200, { 'content-type': h.ct, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" }); return res.end(h.buf); }
    if (p[1] === 'tsearch') {   // token search by name / ticker / address — verified Jupiter tokens only, for the pair & holder-reward pickers
      if (!rate('ts|' + ip(req), 40, 6e4)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('[]'); }
      const qs = String(u.searchParams.get('q') || '').trim().slice(0, 50); if (qs.length < 2) return J([]);
      const k = 'ts|' + qs.toLowerCase(), h = lbCache.get(k); if (h && Date.now() - h.at < 3e5) return J(h.v);
      let out = [], okRes = false; try { const j = await (await fetchT(JUP + '/tokens/v2/search?query=' + encodeURIComponent(qs))).json(); okRes = Array.isArray(j);
        out = (Array.isArray(j) ? j : []).filter((t) => t && t.id && (t.isVerified || (t.tags || []).includes('verified'))).slice(0, 8)
          .map((t) => ({ mint: String(t.id), symbol: String(t.symbol || '').slice(0, 12), name: String(t.name || '').slice(0, 40), icon: typeof t.icon === 'string' ? t.icon : null, usd: +t.usdPrice || 0, liq: +t.liquidity || 0, verified: true })); } catch {}
      if (okRes) lbCache.set(k, { at: Date.now(), v: out }); return J(out); }
    if (p[1] === 'qprice') { const m = String(u.searchParams.get('mint') || ''); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) return J({ usd: 0 });   // pair-token price for the Create page
      let usd = quoteUsd(m, KNOWN_Q[m]), symbol = KNOWN_Q[m] || null, name = null, icon = null, verified = m === WSOL || STABLE.has(m);
      try { const r = await fetchT(JUP + '/tokens/v2/search?query=' + m); const j = await r.json(); const t = Array.isArray(j) ? j.find((x) => x.id === m) : null; if (t) { symbol = symbol || t.symbol; name = t.name; icon = t.icon || null; verified = verified || !!(t.isVerified || (t.tags || []).includes('verified')); if (!QUOTE_OVERRIDE[m] && t.usdPrice) { usd = +t.usdPrice * (await qMult(m)); qPrice.set(m, usd); } } } catch {}   // per on-chain unit (scaled-UI tokens: × multiplier)
      return J({ mint: m, usd, symbol, name, icon, verified }); }
    if (p[1] === 'coins') { if (!coinsSnap || Date.now() - coinsSnap.at > 10e3) coinsSnap = { at: Date.now(), v: q('SELECT mint FROM coins ORDER BY created_slot DESC LIMIT 2000').filter((r) => !HIDDEN.has(r.mint)).map((r) => stats(r.mint, true)) }; return J(coinsSnap.v); }
    if (p[1] === 'coin') return J(HIDDEN.has(p[2]) ? null : stats(p[2]));
    if (p[1] === 'trades') return J(q('SELECT * FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 200', p[2]));
    if (p[1] === 'creator' && p[2]) {   // creator rewards escrow status for a coin
      const c = q1('SELECT * FROM coins WHERE mint=?', p[2]); if (!c) return J(null);
      const k = 'esc:' + c.mint; let esc = escCache.get(k);
      if (!esc || Date.now() - esc.at > 60e3) { const vp = (await dbc.state.getPool(new PublicKey(c.pool)).catch(() => null))?.poolState; esc = { at: Date.now(), on: !!(OPS && vp && vp.creator.toBase58() === OPS.publicKey.toBase58()), pending: vp ? Number(vp.creatorQuoteFee.toString()) / 10 ** (c.quote_dec ?? 9) : 0 }; escCache.set(k, esc); }
      if (!esc.on || !REW) return J({ escrow: false, dev: c.creator });
      const st = REW.state(c), L = (x) => x / 10 ** (c.quote_dec ?? 9), apps = st.era === 'out' ? await REW.applications(c).catch(() => []) : [];
      return J({ escrow: true, dev: c.creator, era: st.era, creator: st.creator, cto: st.cto ? { lead: st.cto.lead, at: st.cto.at, fundSol: L(st.cto.fund), paidSol: L(st.cto.paid), vestedSol: L(st.cto.vested) } : null, apps, state: st.state, why: st.why, idleMs: st.idle, lastActive: st.last, soldPct: st.sold, quote: c.quote_symbol || 'SOL', quoteUsd: quoteUsd(c.quote_mint, c.quote_symbol), pendingSol: Math.max(0, esc.pending - L(st.fund)), paidSol: L(st.paid), buybackSol: L(st.buyback), burnedTokens: st.burnedTokens / 1e6, fundSol: L(st.fund), grantedSol: L(st.granted), platformSol: L(st.granted), fundEndsAt: st.fundEndsAt, rules: { freezeH: 48, outD: 7, soldOut: 70, applyPct: 1, supportPct: 10 }, log: REW.logFor(c.mint) });
    }
    if (['cto', 'claim', 'ping'].includes(p[1]) && req.method === 'POST' && !rate('act|' + ip(req), 30, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('{"ok":false,"error":"too many requests — try again later"}'); }
    if (p[1] === 'cto' && (p[2] === 'apply' || p[2] === 'vote') && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 6000) req.destroy(); });
      req.on('end', async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); const b = JSON.parse(body); J(p[2] === 'apply' ? await REW.ctoApply(b) : await REW.ctoVote(b)); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'session' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 2000) req.destroy(); });   // sign in once (24 h)
      req.on('end', () => { try { if (!rate('ss|' + ip(req), 20, 36e5)) throw new Error('too many sign-ins'); J(issueSession(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'callout' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 2.3e6) req.destroy(); });   // text + optional image
      req.on('end', async () => { try { J(await CO.post(JSON.parse(body), ip(req))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'callouts') return J(CO.list(u.searchParams.get('mint') || null));
    if (p[1] === 'burned' && req.method === 'POST' && !rate('burn|' + ip(req), 30, 36e5)) { res.writeHead(429, { 'access-control-allow-origin': '*' }); return res.end('{"ok":false,"error":"too many requests"}'); }
    if (p[1] === 'burned' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 1000) req.destroy(); });
      req.on('end', async () => { try { J(await verifyBurn(String(JSON.parse(body).sig || ''))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
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
    if (p[1] === 'claim' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 4000) req.destroy(); });
      req.on('end', async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); J(await REW.claimNow(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'ping' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 4000) req.destroy(); });
      req.on('end', async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); J(await REW.ping(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'payouts') return J(OPS && REW ? q(`SELECT sig, MAX(ts) ts, SUM(lamports)/1e6 harvested, SUM(CASE WHEN kind='taxburn' THEN lamports ELSE 0 END)/1e6 burned, SUM(CASE WHEN kind='taxdev' THEN lamports ELSE 0 END)/1e6 dev, SUM(CASE WHEN kind='taxhold' THEN lamports ELSE 0 END)/1e6 holders, MAX(CASE WHEN kind='taxhold' THEN CAST(extra AS INT) END) n_holders FROM rlog WHERE mint=? AND kind IN ('taxburn','taxdev','taxhold') GROUP BY sig ORDER BY ts DESC LIMIT 50`, p[2]) : []);
    if (p[1] === 'candles') return J(candles(p[2], u.searchParams.get('tf') || '1m'));
    if (p[1] === 'holders') { const h = hCache.get(p[2]); if (h?.list && Date.now() - h.ts < 15e3) return J(h.list.slice(0, 300)); if (!q1('SELECT 1 FROM coins WHERE mint=?', p[2])) return J([]); if (!inflight.has(p[2])) inflight.set(p[2], holders(p[2]).finally(() => inflight.delete(p[2]))); const l = await inflight.get(p[2]); hCache.set(p[2], { ts: Date.now(), list: l }); return J(l.slice(0, 300)); }
    res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end('{}');
  } catch (e) { res.writeHead(500, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ error: e.message })); }
}
let ready = false;
if (!PARTNER) { console.error('Set PARTNER=<treid fee-claimer wallet>'); process.exit(1); }
if (MAINNET && !(+process.env.OPS_PRIORITY_MICROLAMPORTS > 0)) console.error('!! OPS_PRIORITY_MICROLAMPORTS is 0 on mainnet — ops transactions may not land');
if (MAINNET && OPS && PARTNER === OPS.publicKey.toBase58()) { console.error('On mainnet the treasury (PARTNER) must be a separate cold wallet, not the hot ops wallet'); process.exit(1); }
CO = startCallouts({ q, q1, run, push, rate, pinJSON, pinFile, pinataJwt: PINATA_JWT, gateway: PINATA_GW,
  coinStats: async (mint, wallet) => { const last = q1('SELECT mcap_usd, price_usd FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 1', mint) || {}; let pos = 0;
    let held = false; try { const hs = await holdersCached(mint); const h = hs.find((x) => x.wallet === wallet && !x.curve); if (h) { held = true; pos = h.pct / 100 * SUPPLY * (last.price_usd || 0); } } catch {}
    return { mc: last.mcap_usd || 0, pos, allowed: held && pos >= 1 }; } });   // you must actually hold ≥ $1 of the coin right now (a dust buy doesn't buy a voice)
CO.restore();
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
  // full history first (retrying until it works) — nothing that depends on history starts before this succeeds
  for (let i = 1; ; i++) { try { await solPrice(); await quotePrices().catch(() => {}); await backfill(); break; } catch (e) { console.log('startup retry', i, String(e?.message || e).slice(0, 120)); await sleep(Math.min(60e3, 5e3 * i)); } }
  ready = true; setInterval(solPrice, 60e3); setInterval(() => quotePrices().catch(() => {}), 60e3);
  for (const w of PARTNERS) conn.onLogs(new PublicKey(w), (l) => { if (!l.err) enqueue(l.signature); }, 'confirmed');
  setInterval(() => syncAll().catch(() => {}), 5 * 60e3);
  setInterval(() => { for (const w of PARTNERS) syncAddress(w, 50).catch(() => {}); }, 60e3);   // a new coin shows up within a minute even if its stream message was missed
  retier(); setInterval(() => loadConfigs().catch(() => {}), 24 * 36e5);   // full config rescan only daily (new configs are picked up from their own create tx)
  console.log('watching', configs.size, 'treid configs (partners', PARTNERS.join(', '), ')');
  if (!OPS) return;
  REW = startRewards({ conn, dbc, ops: OPS, treasury: PARTNER, q, q1, run, mainnet: MAINNET, quoteUsd: (c) => quoteUsd(c.quote_mint, c.quote_symbol), balances: async (mint) => new Map((await holders(mint)).filter((h) => !h.curve).map((h) => [h.wallet, h.pct / 100 * SUPPLY])) });
  for (let i = 1; ; i++) { try { await REW.rebuild(); break; } catch (e) { console.log('rewards rebuild retry', i, String(e?.message || e).slice(0, 120)); await sleep(Math.min(60e3, 5e3 * i)); } }   // a hole in the ledger could pay the wrong person
  setTimeout(() => REW.cycle(), 30e3); setInterval(() => REW.cycle(), +(process.env.OPS_EVERY_MIN || 10) * 60e3);
  startOps({ conn, dbc, ops: OPS, treasury: PARTNER, q, q1, run, mainnet: MAINNET, rewardOk: (m) => quoteAllowed(m), quoteUsd: (c) => quoteUsd(c.quote_mint, c.quote_symbol), devState: (c) => REW.state(c), liabilities: () => REW.liabilities(), ready: () => REW.ready(), poolAuthority: deriveDbcPoolAuthority().toBase58(), everyMs: +(process.env.OPS_EVERY_MIN || 10) * 60e3 });
  const opsBal = () => conn.getBalance(OPS.publicKey).then((b) => { opsSolC.v = b / 1e9; if (MAINNET && b < 0.05e9) console.error('!! ops wallet low on SOL:', b / 1e9); }).catch(() => {}); opsBal(); setInterval(opsBal, 10 * 60e3);
  console.log('ops wallet', OPS.publicKey.toBase58(), '→ treasury', PARTNER);
}
start();
