// one ops-wallet action at a time (tax cycle and rewards cycle share the same token accounts)
let chain = Promise.resolve();
export function withLock(fn) { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; }
// if the money ledger can't be written (disk full, db error) the ops wallet must stop: amounts still owed are computed from it,
// so a lost row would be paid again on the next cycle. Halted until a restart (after the disk is fixed).
export const HALT = { on: false, why: '' };
export function halt(why) { if (!HALT.on) console.error('!! OPS HALTED — ledger write failed:', why); HALT.on = true; HALT.why = String(why).slice(0, 200); }
// a write test before any money moves
export function canWrite(run) { try { run("CREATE TABLE IF NOT EXISTS hb(k TEXT PRIMARY KEY, v INT)"); run("INSERT OR REPLACE INTO hb(k,v) VALUES('w',?)", Date.now()); return true; } catch (e) { halt(e.message); return false; } }
