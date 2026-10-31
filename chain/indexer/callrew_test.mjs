// unit test for callout rewards (no network): attribution rules, ledger, payout batching + idempotency
import { DatabaseSync } from 'node:sqlite';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { startCalloutRewards, coMemoOf, CO_SHARE } from './callrew.mjs';
const db = new DatabaseSync(':memory:'), run = (s, ...a) => db.prepare(s).run(...a), q = (s, ...a) => db.prepare(s).all(...a), q1 = (s, ...a) => db.prepare(s).get(...a);
run('CREATE TABLE callouts(id INTEGER PRIMARY KEY, mint TEXT, wallet TEXT, ts INT, reply INT)'); run('CREATE TABLE rlog(sig TEXT, i INT, mint TEXT, kind TEXT, lamports INT, ts INT, extra TEXT, PRIMARY KEY(sig,i))'); run('CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT)');
const W = () => Keypair.generate().publicKey.toBase58(), caller = W(), buyer = W(), dev = W(), MINT = W(), OTHER = W();
const coin = { mint: MINT, creator: dev, quote_mint: null }, now = Date.now() - 2 * 864e5;
run('INSERT INTO callouts VALUES(1,?,?,?,NULL)', MINT, caller, now); run('INSERT INTO callouts VALUES(2,?,?,?,NULL)', OTHER, caller, now);
let sent = []; const ops = Keypair.generate();
const conn = { getBalance: async () => 10e9, getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1e9 }),
  sendRawTransaction: async (raw) => { sent.push(raw); return 'x'; }, getSignatureStatus: async () => ({ value: { confirmationStatus: 'confirmed' } }), simulateTransaction: async () => ({ value: {} }), getBlockHeight: async () => 1 };
const CR = startCalloutRewards({ conn, ops, q, q1, run, solUsd: () => 150, mainnet: true, ready: () => true, log: () => {} });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const fee = 4e6;   // treid's part: 0.004 SOL on a 1 SOL buy
ok(CR.attr({ sig: 's1', id: 1, trader: buyer, coin, treidFeeLam: fee, usd: 150, ts: now + 3600e3 })?.lam === Math.floor(fee * CO_SHARE), 'credits the caller ' + CO_SHARE * 100 + '% of treid fee');
ok(!CR.attr({ sig: 's1', id: 1, trader: buyer, coin, treidFeeLam: fee, usd: 150, ts: now + 3600e3 }), 'same trade never counted twice');
ok(!CR.attr({ sig: 's2', id: 1, trader: caller, coin, treidFeeLam: fee, usd: 150, ts: now + 3600e3 }), 'caller buying from own callout: nothing');
ok(!CR.attr({ sig: 's3', id: 1, trader: dev, coin, treidFeeLam: fee, usd: 150, ts: now + 3600e3 }), 'dev buying: nothing');
ok(!CR.attr({ sig: 's4', id: 2, trader: buyer, coin, treidFeeLam: fee, usd: 150, ts: now + 3600e3 }), 'callout about another coin: nothing');
ok(!CR.attr({ sig: 's5', id: 1, trader: buyer, coin, treidFeeLam: fee, usd: 150, ts: now + 73 * 3600e3 }), 'after 72h: nothing');
ok(!CR.attr({ sig: 's6', id: 1, trader: buyer, coin, treidFeeLam: fee, usd: 150, ts: now - 1000 }), 'buy before the callout existed: nothing');
ok(!CR.attr({ sig: 's7', id: 1, trader: buyer, coin: { ...coin, quote_mint: OTHER }, treidFeeLam: fee, usd: 150, ts: now + 3600e3 }), 'non-SOL pair: nothing');
ok(!CR.attr({ sig: 's8', id: 99, trader: buyer, coin, treidFeeLam: fee, usd: 150, ts: now + 3600e3 }), 'unknown callout: nothing');
for (let i = 0; i < 9; i++) CR.attr({ sig: 'b' + i, id: 1, trader: W(), coin, treidFeeLam: fee, usd: 150, ts: now + 7200e3 });   // 10 buys total → 0.01 SOL = $1.50
ok(Math.abs(CR.stats(caller).earned_sol - 0.01) < 1e-9, 'earned 0.01 SOL from 10 buys');
await CR.payout(); ok(sent.length === 1, 'paid in one transaction');
ok(CR.owedOf(caller) === 0 && CR.stats(caller).paid_sol === 0.01, 'ledger: paid, nothing owed');
{ const { Transaction } = await import('@solana/web3.js'); const t = Transaction.from(sent[0]); const tr = t.instructions.find((i) => i.programId.equals(new PublicKey('11111111111111111111111111111111'))), mm = t.instructions.find((i) => i.programId.toBase58().startsWith('Memo'));
  ok(t.feePayer.equals(ops.publicKey) && tr.keys[1].pubkey.toBase58() === caller && Number(tr.data.readBigUInt64LE(4)) === 1e7, 'tx: ops pays 0.01 SOL to the caller');
  ok(mm && mm.data.toString() === 'treid:copay:' + caller + ':10000000:' + new Date().toISOString().slice(0, 10), 'tx: receipt memo for the ledger rebuild'); }
await CR.payout(); ok(sent.length === 1, 'same day: never pays again');
run("DELETE FROM kv WHERE k='copay_day'"); await CR.payout(); ok(sent.length === 1, 'new day, nothing owed: nothing sent');
// small earner below $1 waits
const small = W(); run('INSERT INTO callouts VALUES(3,?,?,?,NULL)', MINT, small, now); CR.attr({ sig: 'c1', id: 3, trader: buyer, coin, treidFeeLam: fee, usd: 150, ts: now + 3600e3 }); run("DELETE FROM kv WHERE k='copay_day'"); await CR.payout();
ok(sent.length === 1 && CR.owedOf(small) === 1e6, 'under $1: carried to a later day');
// memo parsing
const keys = { get: (i) => [new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), new PublicKey(buyer)][i] };
ok(coMemoOf({ transaction: { message: { compiledInstructions: [{ programIdIndex: 0, data: Buffer.from('treid:co:42') }] } } }, keys) === 42, 'reads treid:co memo');
ok(coMemoOf({ transaction: { message: { compiledInstructions: [{ programIdIndex: 0, data: Buffer.from('treid:co:42x') }] } } }, keys) === null, 'ignores malformed memo');
ok(coMemoOf({ transaction: { message: { compiledInstructions: [{ programIdIndex: 1, data: Buffer.from('treid:co:42') }] } } }, keys) === null, 'only the memo program');
process.exit();
