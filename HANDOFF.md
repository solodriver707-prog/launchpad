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

## Next up (agreed)
1. **Limit orders (TP/SL)** via Jupiter Trigger API — first verify it accepts our Token-2022 transfer-fee coins (try TTEST); UI like pump.fun (Take profit / Stop loss, % or MC, sell amount slider, manage orders).
2. **"Trenches" view** — three columns New / Graduating (near bonding-curve end) / Graduated, live via `/api/stream`; on phones as swipeable tabs.
3. **Push notifications** — Web Push (service worker + VAPID keys in Render env): watchlist coin moves, your holder rewards, callouts from people you follow. iPhone needs the site added to the Home Screen for web push.

Other ideas: ops low-balance Telegram alert, own domain treid.fun (Phantom trust), likes/reposts server-side, card on-ramp Deposit, creator reputation, rewards-paid stats per coin.
