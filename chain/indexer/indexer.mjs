// treid indexer: listens to Meteora DBC, stores treid coins + trades in SQLite, serves a JSON API + live stream
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getTokenMetadata, unpackAccount, getTransferFeeConfig, getMint } from '@solana/spl-token';
import { DynamicBondingCurveClient, DYNAMIC_BONDING_CURVE_PROGRAM_ID, deriveDbcPoolAuthority, DynamicBondingCurveIdl, getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
const coder = new anchor.BorshEventCoder(DynamicBondingCurveIdl);
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const WS = process.env.WS || RPC.replace('http', 'ws').replace(':8899', ':8900');
const PARTNER = process.env.PARTNER;               // treid fee-claimer wallet: only coins from its configs are indexed
const PORT = +(process.env.PORT || 8787);
const SOL_USD = +(process.env.SOL_USD || 150);
const SUPPLY = 1e9, WSOL = 'So11111111111111111111111111111111111111112';
const conn = new Connection(RPC, { commitment: 'confirmed', wsEndpoint: WS });
const dbc = new DynamicBondingCurveClient(conn, 'confirmed');
const db = new DatabaseSync(process.env.DB || 'treid.db');
db.exec(`CREATE TABLE IF NOT EXISTS coins(mint TEXT PRIMARY KEY, pool TEXT, config TEXT, creator TEXT, name TEXT, symbol TEXT, uri TEXT, tax_bps INT, created_slot INT, created_at INT);
CREATE TABLE IF NOT EXISTS trades(sig TEXT PRIMARY KEY, mint TEXT, wallet TEXT, side TEXT, sol REAL, tokens REAL, price_usd REAL, mcap_usd REAL, slot INT, ts INT, sniper INT DEFAULT 0, bundle INT DEFAULT 0, fee_sol REAL DEFAULT 0, progress REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS t_mint ON trades(mint, ts);`);
const q = (sql, ...a) => db.prepare(sql).all(...a), q1 = (sql, ...a) => db.prepare(sql).get(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
let configs = new Set();
async function loadConfigs() { if (!PARTNER) return; const cs = await dbc.state.getPoolConfigsByOwner(new PublicKey(PARTNER)); configs = new Set(cs.map(c => c.publicKey.toBase58())); }
const clients = new Set(); const push = (ev) => { const s = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) c.write(s); };

async function addCoin(mint, slot, ts, creator) {
  if (q1('SELECT 1 FROM coins WHERE mint=?', mint)) return true;
  const ps = await dbc.state.getPoolByBaseMint(new PublicKey(mint)).catch(() => null); if (!ps) return false;
  const pst = ps.account.poolState || ps.account; const cfg = pst.config.toBase58(); if (PARTNER && !configs.has(cfg)) { await loadConfigs(); if (!configs.has(cfg)) return false; }
  const md = await getTokenMetadata(conn, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(() => null);
  const m = await getMint(conn, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(() => null); const tf = m && getTransferFeeConfig(m);
  run('INSERT OR IGNORE INTO coins VALUES(?,?,?,?,?,?,?,?,?,?)', mint, ps.publicKey.toBase58(), cfg, creator || pst.creator.toBase58(), md?.name || '', md?.symbol || '', md?.uri || '', tf ? tf.newerTransferFee.transferFeeBasisPoints : 0, slot, ts);
  push({ type: 'coin', mint, name: md?.name, symbol: md?.symbol }); console.log('coin  ', md?.symbol, mint); return true;
}
async function handle(sig) {
  if (q1('SELECT 1 FROM trades WHERE sig=?', sig)) return;
  const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
  if (!tx || tx.meta?.err) return;
  const logs = (tx.meta.logMessages || []).join('\n'), keys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
  const signer = keys[0].toBase58(), ts = (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000;
  const pre = tx.meta.preTokenBalances || [], post = tx.meta.postTokenBalances || [];
  const mints = [...new Set(post.map(b => b.mint).filter(x => x !== WSOL))];
  if (/Instruction: InitializeVirtualPoolWithToken2022|Instruction: InitializeVirtualPool/.test(logs)) { for (const mt of mints) await addCoin(mt, tx.slot, ts, signer); return; }
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
    const sniper = side === 'buy' && tx.slot - coin.created_slot <= 4 ? 1 : 0; // ~1.5s after launch: faster than a human can click
    run('INSERT OR IGNORE INTO trades VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?)', sig, mint, signer, side, sol, tokens, price, price * SUPPLY, tx.slot, ts, sniper, fee, Math.min(100, prog));
    const same = q('SELECT DISTINCT wallet FROM trades WHERE mint=? AND slot=? AND side=\'buy\'', mint, tx.slot);
    if (same.length >= 2) run('UPDATE trades SET bundle=1 WHERE mint=? AND slot=? AND side=\'buy\'', mint, tx.slot);
    const t = q1('SELECT * FROM trades WHERE sig=?', sig); push({ type: 'trade', ...t, symbol: coin.symbol });
    console.log('trade ', coin.symbol, side.padEnd(4), sol.toFixed(3), 'SOL', tokens.toFixed(0), sniper ? 'SNIPER' : '', t.bundle ? 'BUNDLE' : '');
  }
}
async function backfill() {
  const sigs = await conn.getSignaturesForAddress(DYNAMIC_BONDING_CURVE_PROGRAM_ID, { limit: 1000 }, 'confirmed');
  for (const s of sigs.reverse()) await handle(s.signature).catch(e => console.log('err', e.message));
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
  return { ...c, mcap_usd: last?.mcap_usd || 0, curve_pct: last?.progress || 0, trades: agg.n, vol_sol: agg.vol || 0, buys: agg.buys || 0, sells: agg.sells || 0, traders: agg.traders, snipers_pct: (agg.snipeTok || 0) / SUPPLY * 100, bundles_pct: (agg.bundleTok || 0) / SUPPLY * 100 };
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname.split('/').filter(Boolean), J = (o) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  try {
    if (p[1] === 'stream') { res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' }); res.write(': hi\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
    if (p[1] === 'coins') return J(q('SELECT mint FROM coins ORDER BY created_slot DESC').map(r => stats(r.mint)));
    if (p[1] === 'coin') return J(stats(p[2]));
    if (p[1] === 'trades') return J(q('SELECT * FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 200', p[2]));
    if (p[1] === 'candles') return J(candles(p[2], u.searchParams.get('tf') || '1m'));
    if (p[1] === 'holders') return J(await holders(p[2]));
    res.writeHead(404); res.end('{}');
  } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
}).listen(PORT, () => console.log('API on http://127.0.0.1:' + PORT));
await loadConfigs(); await backfill();
conn.onLogs(DYNAMIC_BONDING_CURVE_PROGRAM_ID, (l) => { if (!l.err) handle(l.signature).catch(e => console.log('err', e.message)); }, 'confirmed');
console.log('listening to DBC… (partner', PARTNER || 'any', ')');
