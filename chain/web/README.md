# Browser chain module

`src.mjs` → bundled to `/chain.js` (global `TreidChain`), loaded lazily by the site on first launch / trade.

Build (from a folder with the chain deps + esbuild installed):

    esbuild chain/web/src.mjs --bundle --format=iife --global-name=TreidChain --platform=browser --minify --target=es2020 --define:global=globalThis --outfile=chain.js

- `buildCreate` — config + coin (+ optional dev first buy at min fee) in 1–2 txs; fee claimer = treid wallet
- `buildSwap` / `quote` — real buy / sell on the bonding curve
- `sendAll` — sends wallet-signed txs in order
The wallet only signs (`solana:signTransaction`). Rules mirror `chain/scripts/01_launch.mjs`.
