// one ops-wallet action at a time (tax cycle and rewards cycle share the same token accounts)
let chain = Promise.resolve();
export function withLock(fn) { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; }
export const lockIdle = () => chain;   // resolves when the money action running now (if any) has finished
// if the money ledger can't be written (disk full, db error) the ops wallet must stop: amounts still owed are computed from it,
// so a lost row would be paid again on the next cycle. Halted until a restart (after the disk is fixed).
export const HALT = { on: false, why: '' };
export function halt(why) { if (!HALT.on) console.error('!! OPS HALTED — ledger write failed:', why); HALT.on = true; HALT.why = String(why).slice(0, 200); }
// a write test before any money moves
// (a tiny row can still fit on a nearly full disk, so the free space where the database lives is checked as well)
import fs from 'node:fs';
import path from 'node:path';
const MIN_FREE = 20e6;
function freeBytes() { try { const st = fs.statfsSync(path.dirname(path.resolve(process.env.DB || 'treid.db'))); return Number(st.bavail) * Number(st.bsize); } catch { return Infinity; } }   // unknown → don't block on it
export function canWrite(run) { try { const f = freeBytes(); if (f < MIN_FREE) throw new Error('disk almost full (' + Math.round(f / 1e6) + ' MB free)'); run("CREATE TABLE IF NOT EXISTS hb(k TEXT PRIMARY KEY, v INT)"); run("INSERT OR REPLACE INTO hb(k,v) VALUES('w',?)", Date.now()); return true; } catch (e) { halt(e.message); return false; } }
