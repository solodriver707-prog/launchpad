// Callouts: wallet-signed comments on coins. Stored in the DB and backed up to IPFS (Pinata) so restarts don't lose them.
import { PublicKey } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

import { verifySig, checkSession, hmac, sealMatches } from './sig.mjs';
export const calloutMessage = (mint, ts, reply, text) => `treid: callout — ${mint} — ${ts}${reply != null ? ' — reply ' + reply : ''}\n${text}`;
const clean = (t) => String(t || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);

export function startCallouts({ q, q1, run, push, rate, coinStats, pinJSON, pinFile, pinataJwt, gateway, log = console.log }) {
  run(`CREATE TABLE IF NOT EXISTS callouts(id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, wallet TEXT, text TEXT, ts INT, sig TEXT UNIQUE, reply INT, mc REAL, pos REAL)`);
  try { run('ALTER TABLE callouts ADD COLUMN img TEXT'); } catch {}
  // a callout is proven either by its own wallet signature, or (signed-in session) by the server's seal over all its fields
  const seal = (c) => 'h:' + hmac([c.mint, c.wallet, c.ts, c.reply ?? '', c.text, c.img || ''].join('|'));
  const sealData = (c) => [c.mint, c.wallet, c.ts, c.reply ?? '', c.text, c.img || ''].join('|');
  const verify = (c) => (String(c.sig || '').startsWith('h:') ? sealMatches(c.sig, sealData(c)) : verifySig(calloutMessage(c.mint, c.ts, c.reply, c.text), c.sig, c.wallet, c.ts));
  const row = (r) => ({ id: r.id, mint: r.mint, wallet: r.wallet, text: r.text, ts: r.ts, reply: r.reply, mc: r.mc, pos: r.pos, img: r.img || null });
  const IMG_MAX = 1.6e6, MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46], webp: [0x52, 0x49, 0x46, 0x46] };
  function imageOf(dataUrl) {   // a real raster image (checked by its bytes, not its label), ≤ 1.6 MB
    const m = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '')); if (!m) throw new Error('images: PNG, JPG, GIF or WEBP only');
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > IMG_MAX) throw new Error('image too big (1.6 MB max)');
    if (!MAGIC[m[1]].every((b, i) => buf[i] === b)) throw new Error('that file isn’t a real image'); return dataUrl;
  }

  async function post(body, ipAddr) {
    const session = body.session ? checkSession(body.session) : null; if (body.session && !session) throw new Error('please sign in again');
    const mint = String(body.mint || ''), wallet = session || String(body.wallet || ''), ts = session ? Date.now() : +body.ts, reply = body.reply == null || body.reply === '' ? null : +body.reply, text = String(body.text || '');
    const image = body.image ? imageOf(body.image) : null; if (image && !pinataJwt) throw new Error('image uploads are off right now');
    if (!clean(text) && !image) throw new Error('write something first');
    if (text && text !== clean(text)) throw new Error('unsupported characters or too long (2000 max)');
    if (!(Math.abs(Date.now() - ts) <= 2 * 60e3)) throw new Error('signature expired — try again');
    if (!q1('SELECT 1 FROM coins WHERE mint=?', mint)) throw new Error('unknown coin');
    if (reply != null && !q1('SELECT 1 FROM callouts WHERE id=? AND mint=?', reply, mint)) throw new Error('reply target not found');
    if (!session) { const c0 = { mint, wallet, ts, sig: String(body.sig || ''), reply, text }; if (!verify(c0)) throw new Error('bad signature'); if (q1('SELECT 1 FROM callouts WHERE sig=?', c0.sig)) throw new Error('already posted'); }
    if (!rate('co|' + wallet, 1, 15e3) || !rate('coh|' + wallet, 40, 36e5) || !rate('coip|' + ipAddr, 120, 36e5)) throw new Error('slow down — too many callouts');
    const root = reply != null ? q1('SELECT wallet, reply FROM callouts WHERE id=?', reply) : null, isUpdate = !!root && root.wallet === wallet && root.reply == null;   // an update to your own callout
    const s = await coinStats(mint, wallet);
    if (!s.allowed && !isUpdate) throw new Error('only holders of at least $1 of this coin can post callouts');   // market cap now + the poster's bag value (shown as "holding $X" and used for the callers board)
    let img = null; if (image) { if (!rate('coimg|' + wallet, 10, 36e5)) throw new Error('too many images — try again later'); img = await pinFile(image, 'callout-' + mint.slice(0, 6) + '-' + ts); }   // pinned only after the holder check
    const sig = session ? seal({ mint, wallet, ts, reply, text, img }) : String(body.sig || '');
    const r = run('INSERT INTO callouts(mint,wallet,text,ts,sig,reply,mc,pos,img) VALUES(?,?,?,?,?,?,?,?,?)', mint, wallet, text, ts, sig, reply, s.mc, s.pos, img);   // ts = the signed time, so a restored copy still verifies
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
        n += run('INSERT OR IGNORE INTO callouts(id,mint,wallet,text,ts,sig,reply,mc,pos,img) VALUES(?,?,?,?,?,?,?,?,?,?)', c.id, c.mint, c.wallet, c.text, c.ts, c.sig, c.reply, c.mc, c.pos, c.img || null).changes; }
      log('callouts restored from IPFS:', n); for (const x of rows.slice(1)) fetch('https://api.pinata.cloud/pinning/unpin/' + x.ipfs_pin_hash, { method: 'DELETE', headers: { authorization: 'Bearer ' + pinataJwt } }).catch(() => {});
    } catch (e) { log('callouts restore err', e.message.slice(0, 100)); }
  }
  return { post, list, restore };
}
