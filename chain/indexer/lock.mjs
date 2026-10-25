// one ops-wallet action at a time (tax cycle and rewards cycle share the same token accounts)
let chain = Promise.resolve();
export function withLock(fn) { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; }
