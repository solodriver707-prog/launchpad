# treid — handoff notes (for the next working session)

Live site: https://solodriver707-prog.github.io/launchpad/ (GitHub Pages, branch `main`)
Mainnet indexer: https://treid-indexer-mainnet.onrender.com (Render, Docker, `chain/indexer`, blueprint `render.yaml`)

## Layout
- `app.js`, `styles.css`, `index.html` — the whole site (vanilla JS, renders HTML strings; always use `esc()`)
- `chain.js` — bundled from `chain/web/src.mjs`:
  `npx esbuild web/src.mjs --bundle --format=iife --global-name=TreidChain --minify --platform=browser --alias:util=./web/shim-util.mjs --banner:js="var process=globalThis.process||{env:{},browser:true,version:''};" --outfile=chain.js`
  (run from a folder that has the npm deps: @meteora-ag/*, @solana/*, tweetnacl, buffer, bn.js, bs58)
- `chain/indexer/` — server: `indexer.mjs` (API + indexing), `ops.mjs` (ops hot wallet: tax harvest/burn/holder payouts, fee claims, $TREID buyback), `rewards.mjs` (creator rewards + ledger rebuild from on-chain memos), `callouts.mjs`, `sig.mjs`, `bubbles.mjs`, `lock.mjs` (withLock + HALT), `txutil.mjs`
- Bump the cache-busting version before each site commit (`?v=` in index.html).

## Rules that must not break
- Never commit keys. OPS_SECRET / PINATA_JWT / RPC key live only in Render env.
- Money ledger (`rlog`) is the source of truth for what ops owes; if it can't be written, ops halts (`HALT`), nothing is sent.
- Unknown tx outcome → `unknown()` halts and exits; Render restarts; startup `rebuild()` reconciles from `treid:*` memos.
- Ops never opens token accounts for other people.
- Dev share of tax capped at 50%. Vamp coins only get a 🧛 flag, never blocked.
- Mobile is the main market: test every change at 390×844.

## State (end of Oct 2026)
- Tax test on TTEST worked 70/20/10. Holder rewards history: `/api/rewards/<wallet>`, wallet panel 🎁 tab, coin page "Rewards received".
- Overnight audit fixes are committed (security, economics, mobile). Not yet seen on mainnet with real payouts — watch the next tax round in Render logs.
- Pending env: `HIDDEN_MINTS` (hide TTEST after testing), `TREID_MINT` (when $TREID exists), optional `SESSION_SECRET`.

## Done 29 Oct 2026 (needs deploy + env)
- **Trenches** (`#/trenches`, `trenchPage()` in app.js): New (<50% curve) / Graduating (50–99%) / Graduated, live via the existing stream; phones = swipeable tabs (mobile nav: Trending → Trenches, Trending linked from the page).
- **Web push** (`chain/indexer/push.mjs`, `sw.js`, `manifest.webmanifest`, `icons/app-*.png`): no npm dependency (RFC 8291/8292 with node:crypto, cross-checked against web-push/http_ece). Watchlist ±25% moves (`PUSH_MOVE_PCT`) + graduation, holder rewards (polls `hpay`, money code untouched), callouts from followed wallets. Bell in header / wallet menu / watchlist page.
  Env (Render): `VAPID_PUBLIC`, `VAPID_PRIVATE` (`npx web-push generate-vapid-keys`), `VAPID_SUBJECT`. Without them push is simply off. iPhone: site must be added to the Home Screen (iOS 16.4+).
- **TP/SL** (coin page → "TP / SL" tab): Jupiter Trigger **V2** docs say Token-2022 mints with transfer-fee/hook are rejected unless whitelisted → only 0%-tax coins get ⚡ Auto-sell (vault deposit, OCO or single, min $10, via `/api/jt/*` proxy that adds `JUP_API_KEY`). Every Jupiter-built tx is simulated first and refused if it takes more of your tokens/SOL than chosen. Taxed coins (and anyone who prefers) get 🔔 Alert me: one-shot push at TP/SL market cap (`/api/push/alert*`, table `pushalert`).
  NOT yet tested on mainnet: first try a $10+ order on a 0%-tax coin; if Jupiter's challenge/deposit shapes differ from the docs, adjust `jtToken`/`jtPlace`. Ask Jupiter to whitelist treid coins to enable Auto-sell for taxed ones.

## Next up
- Mainnet test of TP/SL Auto-sell; Jupiter whitelist request for transfer-fee coins.

## Earlier plan (agreed)
1. **Limit orders (TP/SL)** via Jupiter Trigger API — first verify it accepts our Token-2022 transfer-fee coins (try TTEST); UI like pump.fun (Take profit / Stop loss, % or MC, sell amount slider, manage orders).
2. **"Trenches" view** — three columns New / Graduating (near bonding-curve end) / Graduated, live via `/api/stream`; on phones as swipeable tabs.
3. **Push notifications** — Web Push (service worker + VAPID keys in Render env): watchlist coin moves, your holder rewards, callouts from people you follow. iPhone needs the site added to the Home Screen for web push.

Other ideas: ops low-balance Telegram alert, own domain treid.fun (Phantom trust), likes/reposts server-side, card on-ramp Deposit, creator reputation, rewards-paid stats per coin.

---

# Addendum (29 Oct 2026) — everything from the main build session that is not in the code yet

## Decisions already taken (keep them)
- Brand **treid**, slogan "Launch fair. Trade safer." Mobile is the main market. Benchmark: never worse than stonk.fun.
- Vamp/copycat coins: 🧛 icon only, exact 1:1 name/ticker match (case/space-insensitive), never blocked, no warning at Create (we want more launches).
- Holder tax rewards: creator picks coin itself (default, encouraged) or the pair token; split presets + custom, locked at launch; dev share ≤ 50%.
- Creator rule: sells + moves away ≥70% of the bag → "out" (not paused); their dev share is burned.
- $TREID platform coin: 60% buyback & burn / 40% treasury; nothing paid to holders. Dormant until `TREID_MINT` is set. Coins paired with $TREID burn their platform fee share directly.
- Tax round interval changed 1h → 10 min ("change only the time"). **Revert to 1h if ops costs rise** (`OPS_EVERY_MIN`, and the 6e5 check in `ops.mjs` cycle).
- Orbit section removed; Trending kept in nav (now Trenches in mobile nav, Trending linked from it).
- Use the word "pair" (not "trade bitcoin") in the pair UI.
- Coin header banner layout was restored at the user's request ("old better"): CA label, TAX + PAIRED blocks; stats strip without Price.
- Rewards UI: laconic, no gift box on the coin page — paid token icon + amount + $ value + payout count.
- Callouts: under "Your position" show your own callout with "Update callout" (pump.fun style). X post links in callouts become preview cards; big view on hover (desktop).
- First tax distribution (TTEST, 70/20/10) happened before per-holder receipts existed → it is not in `hpay`/Rewards history; that's accepted.

## Unfinished items from the overnight audit (not fixed yet)
### Security — DONE 29 Oct 2026 (commits e53de06, + client-IP fix)
- Curve pinned: `chain/indexer/curve.mjs` `curveOk()` (mainnet) rebuilds the site curve from the config's sqrtStartPrice (mc1 = 3×mc0) and compares curve points, threshold, fee schedule, migration settings; site `treidCfgOk` now = server rules + `curveOk` (`strictCurve` on mainnet). TTEST passes; tampered configs fail. RPC errors → retry, never "not treid".
- Ops Jupiter swaps ($TREID buyback, reward-token convert): simulation must show ops' output account receiving ≥ `otherAmountThreshold`. Site SOL→pair swap: `swapGuard()` simulates, user's output ATA must rise ≥ minimum (tested on a real Jupiter route).
- `SESSION_SECRET` (≥32 chars) expected in env (loud log + derived fallback otherwise); old callout seals still verify (`sealMatches`); constant-time compares.
- Upload checks real image bytes (`realImage`); 400/500 bodies use `pubErr()` (own messages only); outbound fetch: dotless names refused, DNS answers in private ranges refused (`hostOk`).
- Client IP: Render is behind Cloudflare → `ip()` = second-to-last X-Forwarded-For (was the shared Cloudflare edge = everyone shared one limit bucket). `/api/whoami` shows it.
- `/api/coin` holder-scan budget per IP; claim settle back-off after 5 failures (every 6 h + `!!` log, never marked paid); `canWrite` also halts below 20 MB free disk; images up to 6 MB + 80 MB memory LRU over the disk quota.
- Still on you: Helius browser key — keep separate from the server key and set a rate limit in Helius.

### Economics — DONE 29 Oct 2026 (except where noted)
- Ops/treasury trades flagged `sys=1` and excluded from coin stats (volume, buys/sells, traders).
- Market cap = price × circulating supply (`SUPPLY − burned`); `/api/coin` returns `supply`, `burned`; site `price(t)` and TP/SL use `t.supply`.
- Trade USD for history uses SOL's daily price from CoinGecko (table `spx`); live trades use the current price. Non-SOL pairs without a history source still use the current price.
- `posStats`: value after the coin's sell tax; `rewardsUsd` (holder rewards in SOL / pair / third token) counted in profit.
- Per-holder receipts (`hpay`) rebuilt from ops' own transactions (coin TransferChecked + memo'd pair/SOL payouts) — one-time pass `kv.hpay_v1`; the first TTEST payout now shows in Rewards history.
- `/api/coin` returns `split_applied` (what ops really applies, dev ≤ 50%); site shows it. Third reward token priced (site via `/api/qprice`, server via Jupiter).
- SOL holder shares below rent-exempt to empty wallets wait for a later round (no failing batch). UI notes that sub-$0.05 shares are burned.
- NOT done (dormant / decision): $TREID flywheel fixes (`treid_since` per mint, buyback cap, post-graduation LP fees) — do before setting `TREID_MINT`; creator side-wallet reward farming — open question; ops-paid migrations not reimbursed; Jito/private sends for ops sales.
### Mobile — DONE 29 Oct 2026
- Even TAX/PAIRED cards (coin header), card badges and top-meme side same size, compact chart legend + `% log auto` in the toolbar on phones, create tax chips 6-col grid, trap durations one row, collapsed board filters hide pair rows, bento coin site without holes, opaque header ≤1100px, footer taps, `$0`, plurals, podium loss colour, QUIET burn gauge, own-wallet profile text, `?demo=1` without live server.
### Ops alerts — DONE
- `alerts.mjs`: every `!!` server log line → Telegram (env `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; optional; 1×/h per message). `/api/health` shows `alerts`.
- Verified in production: X post preview cards work (`/api/xpost/<id>`).

## Older pending items (offered, not confirmed/done)
- Holders-only page; ops low-balance **Telegram alert** (now only `ops_low` in /api/health).
- pump.fun app ideas: mobile Deposit button, "New callouts" bar, profile Deposit/Receive.
- Likes/reposts stored server-side (now browser-only).
- Own domain **treid.fun** + Phantom dApp review (removes wallet warnings, improves deeplinks).
- `HIDDEN_MINTS` = TTEST mint after testing; `TREID_MINT` when $TREID exists.
- **Phantom/Solflare deeplink on a real iPhone not tested yet.** Connect link is prebuilt so one tap opens the app; signing uses a tap sheet. If Safari still lands on phantom.com's "open in app" page, switch to the `phantom://v1/...` scheme (iOS asks "Open in Phantom?" once).
- X post cards use `cdn.syndication.twimg.com/tweet-result` server-side — never verified from production; check one real callout with an x.com/…/status/… link.
- Phantom hides incoming unverified-token transfers in History (spam filter) — we can't change that; holders see rewards in the site (🎁 tab, coin page) with Solscan links, or Phantom's hidden/spam section.

## Ideas / recommendations not started
- Creator fee split across several wallets (pump.fun: up to 10) + coin ownership transfer.
- Card on-ramp / Deposit (MoonPay-style) on phones.
- Creator reputation: past launches + "rug" mark on the dev profile (fits "Trade safer").
- Livestream/video per coin (later; expensive/risky).
- "Rewards paid" stats + holder rewards map per coin.
- Zero-downtime deploys on Render (server restart after each deploy briefly breaks the site; the site now retries).
- Deploy in quiet hours until then.

## Open questions
- Does Jupiter whitelist our Token-2022 transfer-fee coins for Trigger orders? (needed for Auto-sell on taxed coins)
- Exact creator fee share after graduation (DAMM v2 `poolFeeBps: 50`)?
- Do we act on creator side-wallet reward farming?
- Is the 10-min tax interval affordable at real volume? (watch ops SOL in /api/health)
