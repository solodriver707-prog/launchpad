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
const conn = new Connection(RPC, { commitment: 'confirmed', wsEndpoint: WS });
const dbc = new DynamicBondingCurveClient(conn, 'confirmed');
const db = new DatabaseSync(process.env.DB || 'treid.db');
db.exec(`CREATE TABLE IF NOT EXISTS coins(mint TEXT PRIMARY KEY, pool TEXT, config TEXT, creator TEXT, name TEXT, symbol TEXT, uri TEXT, tax_bps INT, created_slot INT, created_at INT);
CREATE TABLE IF NOT EXISTS trades(sig TEXT PRIMARY KEY, mint TEXT, wallet TEXT, side TEXT, sol REAL, tokens REAL, price_usd REAL, mcap_usd REAL, slot INT, ts INT, sniper INT DEFAULT 0, bundle INT DEFAULT 0, fee_sol REAL DEFAULT 0, progress REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS t_mint ON trades(mint, ts);
CREATE TABLE IF NOT EXISTS seen(sig TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS payouts(id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, ts INT, harvested REAL, burned REAL, dev REAL, holders REAL, n_holders INT, fees_sol REAL);
CREATE TABLE IF NOT EXISTS meta(mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, description TEXT, image TEXT, banner TEXT, at INT);`);
for (const col of ['trap_bps INT DEFAULT 0', 'trap_secs INT DEFAULT 0', 'trap_steps INT DEFAULT 0']) { try { db.exec('ALTER TABLE coins ADD COLUMN ' + col); } catch {} }
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

async function addCoin(mint, slot, ts, creator) {
  if (q1('SELECT 1 FROM coins WHERE mint=?', mint)) return true;
  const ps = await dbc.state.getPoolByBaseMint(new PublicKey(mint)).catch(() => null); if (!ps) return false;
  const pst = ps.account.poolState || ps.account; const cfg = pst.config.toBase58(); if (PARTNER && !configs.has(cfg)) { await loadConfigs(); if (!configs.has(cfg)) return false; }
  const cf = await dbc.state.getPoolConfig(pst.config).catch(() => null), bf = cf?.poolFees?.baseFee;
  const trap = bf && Number(bf.baseFeeMode) <= 1 ? { bps: Math.round(Number(bf.cliffFeeNumerator) / 1e5), secs: Number(bf.firstFactor) * Number(bf.secondFactor), steps: Number(bf.firstFactor) } : { bps: 0, secs: 0, steps: 0 };
  const md = await getTokenMetadata(conn, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(() => null);
  const m = await getMint(conn, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(() => null); const tf = m && getTransferFeeConfig(m);
  const ins = run('INSERT OR IGNORE INTO coins(mint,pool,config,creator,name,symbol,uri,tax_bps,created_slot,created_at,trap_bps,trap_secs,trap_steps) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', mint, ps.publicKey.toBase58(), cfg, creator || pst.creator.toBase58(), md?.name || '', md?.symbol || '', md?.uri || '', tf ? tf.newerTransferFee.transferFeeBasisPoints : 0, creator ? slot : 0, creator || !cf || Number(cf.activationType) !== 1 ? ts : Number(pst.activationPoint) * 1000, trap.bps, trap.secs, trap.steps);
  if (ins.changes) { push({ type: 'coin', mint, name: md?.name, symbol: md?.symbol }); console.log('coin  ', md?.symbol, mint); } return true;
}
async function handle(sig) {
  if (q1('SELECT 1 FROM seen WHERE sig=?', sig)) return;
  const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
  if (!tx) return; run('INSERT OR IGNORE INTO seen VALUES(?)', sig); if (tx.meta?.err) return;
  const logs = (tx.meta.logMessages || []).join('\n'), keys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
  const signer = keys[0].toBase58(), ts = (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000;
  const pre = tx.meta.preTokenBalances || [], post = tx.meta.postTokenBalances || [];
  const mints = [...new Set(post.map(b => b.mint).filter(x => x !== WSOL))];
  if (/Instruction: CreateConfig/.test(logs)) { await loadConfigs(); return; }
  if (/Instruction: InitializeVirtualPoolWithToken2022|Instruction: InitializeVirtualPool/.test(logs)) { for (const mt of mints) await addCoin(mt, tx.slot, ts, signer); if (!/Instruction: Swap/.test(logs)) return; }   // pool + dev first buy can share one tx
  if (!/Instruction: Swap/.test(logs)) return;
  const evs = []; for (const g of tx.meta.innerInstructions || []) for (const ix of g.instructions) { if (keys[ix.programIdIndex].toBase58() !== DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58()) continue; try { const e = coder.decode(Buffer.from(bs58.decode(ix.data)).subarray(8).toString('base64')); if (e) evs.push(e); } catch {} }
  const ev2 = evs.find(e => e.name === 'EvtSwap2'), ev3 = evs.find(e => e.name === 'EvtSwap3');
  for (const mint of mints) {
    const coin = q1('SELECT * FROM coins WHERE mint=?', mint) || (await addCoin(mint, tx.slot, ts) && q1('SELECT * FROM coins WHERE mint=?', mint)); if (!coin) continue;
    const amt = (arr, owner, mt) => arr.filter(b => b.owner === owner && b.mint === mt).reduce((s, b) => s + Number(b.uiTokenAmount.amount), 0);
    const tokDelta = (amt(post, signer, mint) - amt(pre, signer, mint)) / 1e6;
    const auth = deriveDbcPoolAuthority().toBase58();
    const vaultDelta = (amt(post, auth, WSOL) - amt(pre, auth, WSOL)) / 1e9;   // SOL into (+) / out of (−) the curve
    if (!tokDelta) continue;
    const side = tokDelta > 0 ? 'buy' : 'sell', sol = Math.abs(vaultDelta), tokens = Math.abs(tokDelta);
    const sq = ev2?.data.swap_result.next_sqrt_price || ev3?.data.next_sqrt_price;
    const price = sq ? Number(getPriceFromSqrtPrice(sq, 6, 9)) * SOL_USD : (tokens ? sol * SOL_USD / tokens : 0);
    const fee = ev2 ? Number(ev2.data.swap_result.trading_fee) / 1e9 : 0, prog = ev2 ? Number(ev2.data.quote_reserve_amount) / Number(ev2.data.migration_threshold) * 100 : 0;
    const sniper = side === 'buy' && signer !== coin.creator && (coin.created_slot > 0 ? tx.slot - coin.created_slot <= 4 : ts - coin.created_at <= 2000) ? 1 : 0; // ~1.5s after launch: faster than a human can click
    run('INSERT OR IGNORE INTO trades VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?)', sig, mint, signer, side, sol, tokens, price, price * SUPPLY, tx.slot, ts, sniper, fee, Math.min(100, prog));
    const same = q('SELECT DISTINCT wallet FROM trades WHERE mint=? AND slot=? AND side=\'buy\'', mint, tx.slot);
    if (same.length >= 2) run('UPDATE trades SET bundle=1 WHERE mint=? AND slot=? AND side=\'buy\'', mint, tx.slot);
    const t = q1('SELECT * FROM trades WHERE sig=?', sig); push({ type: 'trade', ...t, symbol: coin.symbol });
    console.log('trade ', coin.symbol, side.padEnd(4), sol.toFixed(3), 'SOL', tokens.toFixed(0), sniper ? 'SNIPER' : '', t.bundle ? 'BUNDLE' : '');
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
function stats(mint) {
  const c = q1('SELECT * FROM coins WHERE mint=?', mint); if (!c) return null;
  const last = q1('SELECT mcap_usd, progress FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 1', mint);
  const agg = q1(`SELECT COUNT(*) n, SUM(sol) vol, SUM(side='buy') buys, SUM(side='sell') sells, COUNT(DISTINCT wallet) traders, SUM(CASE WHEN sniper=1 THEN tokens ELSE 0 END) snipeTok, SUM(CASE WHEN bundle=1 AND side='buy' THEN tokens ELSE 0 END) bundleTok FROM trades WHERE mint=?`, mint);
  const bal = q(`SELECT wallet, SUM(CASE WHEN side='buy' THEN tokens ELSE -tokens END) n FROM trades WHERE mint=? GROUP BY wallet HAVING n > 0.5 ORDER BY n DESC`, mint);
  const devBuy = q1(`SELECT 1 x FROM trades WHERE mint=? AND wallet=? AND side='buy' LIMIT 1`, mint, c.creator);
  const devN = bal.find(b => b.wallet === c.creator)?.n || 0, top10 = bal.slice(0, 10).reduce((s, b) => s + b.n, 0);
  const po = OPS ? q1('SELECT COALESCE(SUM(burned),0) burned, COALESCE(SUM(holders),0) holders, COALESCE(SUM(dev),0) dev, COUNT(*) n FROM payouts WHERE mint=?', mint) : null;
  return { ...c, tax_paid: po, holders: bal.length, dev_pct: devN / SUPPLY * 100, dev_sold: !!devBuy && devN < 1, top10_pct: top10 / SUPPLY * 100, sol_usd: SOL_USD, mcap_usd: last?.mcap_usd || 0, curve_pct: last?.progress || 0, trades: agg.n, vol_sol: agg.vol || 0, buys: agg.buys || 0, sells: agg.sells || 0, traders: agg.traders, snipers_pct: (agg.snipeTok || 0) / SUPPLY * 100, bundles_pct: (agg.bundleTok || 0) / SUPPLY * 100 };
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname.split('/').filter(Boolean), J = (o) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }
  // coin metadata (image / description) posted by the site at launch — first write wins. TODO mainnet: pin to IPFS instead.
  if (p[1] === 'upload' && req.method === 'POST') {   // before launch: pin image(s) + metadata JSON to IPFS, return the permanent URI
    let body = ''; req.on('data', (d) => { body += d; if (body.length > 3e6) req.destroy(); });
    req.on('end', async () => { try { if (!PINATA_JWT) return J({ uri: null });
      const m = JSON.parse(body), ok = (v) => typeof v === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(v) && v.length < 1.5e6, tag = String(m.symbol || 'coin').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) + '-' + Date.now().toString(36);
      const image = ok(m.image) ? await pinFile(m.image, tag) : null, banner = ok(m.banner) ? await pinFile(m.banner, tag + '-banner') : null;
      const meta = { name: String(m.name || '').slice(0, 32), symbol: String(m.symbol || '').slice(0, 10), description: String(m.description || '').slice(0, 600), image, banner, external_url: 'https://treid.fun', properties: { files: image ? [{ uri: image, type: 'image' }] : [] } };
      if (m.x) meta.twitter = String(m.x).slice(0, 100); if (m.tg) meta.telegram = String(m.tg).slice(0, 100); if (m.web) meta.website = String(m.web).slice(0, 100);
      J({ uri: await pinJSON(meta, tag), image, banner }); } catch (e) { console.log('upload err', e.message); res.writeHead(502, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ uri: null, error: e.message })); } });
    return;
  }
  if (p[1] === 'meta' && req.method === 'POST') {
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
    if (p[1] === 'coins') return J(q('SELECT mint FROM coins ORDER BY created_slot DESC').map(r => stats(r.mint)));
    if (p[1] === 'coin') return J(stats(p[2]));
    if (p[1] === 'trades') return J(q('SELECT * FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 200', p[2]));
    if (p[1] === 'creator' && p[2]) {   // creator rewards escrow status for a coin
      const c = q1('SELECT * FROM coins WHERE mint=?', p[2]); if (!c) return J(null);
      const k = 'esc:' + c.mint; let esc = escCache.get(k);
      if (!esc || Date.now() - esc.at > 60e3) { const vp = (await dbc.state.getPool(new PublicKey(c.pool)).catch(() => null))?.poolState; esc = { at: Date.now(), on: !!(OPS && vp && vp.creator.toBase58() === OPS.publicKey.toBase58()), pending: vp ? Number(vp.creatorQuoteFee.toString()) / 1e9 : 0 }; escCache.set(k, esc); }
      if (!esc.on || !REW) return J({ escrow: false, dev: c.creator });
      const st = REW.state(c), L = (x) => x / 1e9;
      return J({ escrow: true, dev: c.creator, state: st.state, why: st.why, idleMs: st.idle, lastActive: st.last, soldPct: st.sold, pendingSol: Math.max(0, esc.pending - L(st.fund)), paidSol: L(st.paid), buybackSol: L(st.buyback), burnedTokens: st.burnedTokens / 1e6, fundSol: L(st.fund), grantedSol: L(st.granted), fundEndsAt: st.fundEndsAt, rules: { freezeH: 48, outD: 7, soldOut: 70, fundD: 14 }, log: REW.logFor(c.mint) });
    }
    if (p[1] === 'claim' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 4000) req.destroy(); });
      req.on('end', async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); J(await REW.claimNow(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'ping' && req.method === 'POST') { let body = ''; req.on('data', (d) => { body += d; if (body.length > 4000) req.destroy(); });
      req.on('end', async () => { try { if (!REW) throw new Error('rewards escrow not enabled'); J(await REW.ping(JSON.parse(body))); } catch (e) { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: false, error: e.message })); } }); return; }
    if (p[1] === 'payouts') return J(OPS ? q('SELECT * FROM payouts WHERE mint=? ORDER BY ts DESC LIMIT 50', p[2]) : []);
    if (p[1] === 'candles') return J(candles(p[2], u.searchParams.get('tf') || '1m'));
    if (p[1] === 'holders') return J(await holders(p[2]));
    res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end('{}');
  } catch (e) { res.writeHead(500, { 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ error: e.message })); }
}).listen(PORT, () => console.log('API on :' + PORT));
let ready = false;
if (!PARTNER) { console.error('Set PARTNER=<treid fee-claimer wallet>'); process.exit(1); }
await solPrice(); setInterval(solPrice, 60e3);
setInterval(() => push({ type: 'ping', t: Date.now() }), 25e3);               // keeps proxies from closing the stream
await backfill(); ready = true;
for (const w of PARTNERS) conn.onLogs(new PublicKey(w), (l) => { if (!l.err) handle(l.signature).catch(e => console.log('err', e.message)); }, 'confirmed'); // new treid configs
setInterval(() => { for (const k of configs) syncAddress(k, 100).catch(() => {}); }, 60e3);   // safety net if a websocket message is missed (cheap: 1 call per config)
setInterval(() => loadConfigs().catch(() => {}), 15 * 60e3);                                  // full config rescan (getProgramAccounts is credit-heavy) — new configs are caught live via the PARTNER subscription
console.log('watching', configs.size, 'treid configs (partners', PARTNERS.join(', '), ')');
if (OPS) { REW = startRewards({ conn, dbc, ops: OPS, treasury: PARTNER, q, q1, run }); REW.rebuild().catch((e) => console.log('rewards rebuild err', e.message)).then(() => { setTimeout(() => REW.cycle(), 45e3); setInterval(() => REW.cycle(), +(process.env.OPS_EVERY_MIN || 10) * 60e3); });
  startOps({ conn, dbc, ops: OPS, treasury: PARTNER, q, q1, run, devState: (c) => REW.state(c).state, liabilities: () => 0,   /* takeover funds stay inside the pools now */ poolAuthority: deriveDbcPoolAuthority().toBase58(), everyMs: +(process.env.OPS_EVERY_MIN || 10) * 60e3 }); console.log('ops wallet', OPS.publicKey.toBase58(), '→ treasury', PARTNER); }
