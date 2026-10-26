// Callouts: wallet-signed comments on coins. Stored in the DB and backed up to IPFS (Pinata) so restarts don't lose them.
import { PublicKey } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

export const calloutMessage = (mint, ts, reply, text) => `treid: callout — ${mint} — ${ts}${reply != null ? ' — reply ' + reply : ''}\n${text}`;
const clean = (t) => String(t || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 280);

export function startCallouts({ q, q1, run, push, rate, coinStats, pinJSON, pinataJwt, gateway, log = console.log }) {
  run(`CREATE TABLE IF NOT EXISTS callouts(id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, wallet TEXT, text TEXT, ts INT, sig TEXT UNIQUE, reply INT, mc REAL, pos REAL)`);
  const verify = (c) => { try { return ed25519.verify(bs58.decode(c.sig), new TextEncoder().encode(calloutMessage(c.mint, c.ts, c.reply, c.text)), new PublicKey(c.wallet).toBytes()); } catch { return false; } };
  const row = (r) => ({ id: r.id, mint: r.mint, wallet: r.wallet, text: r.text, ts: r.ts, reply: r.reply, mc: r.mc, pos: r.pos });

  async function post(body, ipAddr) {
    const mint = String(body.mint || ''), wallet = String(body.wallet || ''), ts = +body.ts, sig = String(body.sig || ''), reply = body.reply == null || body.reply === '' ? null : +body.reply, text = String(body.text || '');
    if (!clean(text)) throw new Error('write something first');
    if (text !== clean(text)) throw new Error('unsupported characters or too long (280 max)');
    if (!(Math.abs(Date.now() - ts) <= 2 * 60e3)) throw new Error('signature expired — try again');
    if (!q1('SELECT 1 FROM coins WHERE mint=?', mint)) throw new Error('unknown coin');
    if (reply != null && !q1('SELECT 1 FROM callouts WHERE id=? AND mint=?', reply, mint)) throw new Error('reply target not found');
    const c = { mint, wallet, ts, sig, reply, text }; if (!verify(c)) throw new Error('bad signature');
    if (q1('SELECT 1 FROM callouts WHERE sig=?', sig)) throw new Error('already posted');
    if (!rate('co|' + wallet, 1, 15e3) || !rate('coh|' + wallet, 40, 36e5) || !rate('coip|' + ipAddr, 120, 36e5)) throw new Error('slow down — too many callouts');
    const s = await coinStats(mint, wallet);   // market cap now + the poster's bag value (shown as "holding $X" and used for the callers board)
    const r = run('INSERT INTO callouts(mint,wallet,text,ts,sig,reply,mc,pos) VALUES(?,?,?,?,?,?,?,?)', mint, wallet, text, ts, sig, reply, s.mc, s.pos);   // ts = the signed time, so a restored copy still verifies
    const out = row(q1('SELECT * FROM callouts WHERE id=?', r.lastInsertRowid)); push({ type: 'callout', ...out }); backupSoon(); return { ok: true, callout: out };
  }
  const list = (mint) => (mint ? q('SELECT * FROM callouts WHERE mint=? ORDER BY id DESC LIMIT 300', mint) : q('SELECT * FROM callouts ORDER BY id DESC LIMIT 150')).map(row);

  // ---- IPFS backup: one JSON snapshot, the previous one is unpinned ----
  let timer = null, lastCid = null;
  function backupSoon() { if (!pinataJwt || timer) return; timer = setTimeout(async () => { timer = null; try {
    const all = q('SELECT * FROM callouts ORDER BY id DESC LIMIT 20000'), url = await pinJSON({ v: 1, at: Date.now(), callouts: all.map((r) => ({ ...row(r), sig: r.sig })) }, 'callouts');
    const cid = url.split('/ipfs/')[1]; if (lastCid && lastCid !== cid) fetch('https://api.pinata.cloud/pinning/unpin/' + lastCid, { method: 'DELETE', headers: { authorization: 'Bearer ' + pinataJwt } }).catch(() => {}); lastCid = cid;
  } catch (e) { log('callouts backup err', e.message.slice(0, 100)); } }, 20e3); }
  async function restore() {
    if (!pinataJwt) return; try {
      const r = await fetch('https://api.pinata.cloud/data/pinList?status=pinned&metadata[name]=treid-callouts.json&pageLimit=20', { headers: { authorization: 'Bearer ' + pinataJwt } }), j = await r.json();
      const rows = (j.rows || []).sort((a, b) => new Date(b.date_pinned) - new Date(a.date_pinned)); if (!rows.length) return; lastCid = rows[0].ipfs_pin_hash;
      const snap = await (await fetch(gateway + '/ipfs/' + lastCid)).json(); let n = 0;
      for (const c of (snap.callouts || []).sort((a, b) => a.id - b.id)) { if (!verify(c)) continue;   // every restored callout is re-checked against its wallet signature
        n += run('INSERT OR IGNORE INTO callouts(id,mint,wallet,text,ts,sig,reply,mc,pos) VALUES(?,?,?,?,?,?,?,?,?)', c.id, c.mint, c.wallet, c.text, c.ts, c.sig, c.reply, c.mc, c.pos).changes; }
      log('callouts restored from IPFS:', n); for (const x of rows.slice(1)) fetch('https://api.pinata.cloud/pinning/unpin/' + x.ipfs_pin_hash, { method: 'DELETE', headers: { authorization: 'Bearer ' + pinataJwt } }).catch(() => {});
    } catch (e) { log('callouts restore err', e.message.slice(0, 100)); }
  }
  return { post, list, restore };
}
