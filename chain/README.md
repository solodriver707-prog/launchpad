# treid chain — proof of concept (Meteora DBC + Token-2022 tax)

Tested on a local Solana validator cloned from devnet (Meteora DBC, DAMM v2, Metaplex, Locker programs).

- `00_wallets.mjs` – creates treid / dev / buyer test wallets (keys/ is git-ignored) and airdrops SOL
- `01_launch.mjs` – creates the treid partner config (Token-2022 coin tax up to 10%, withheld by treid, locked after graduation; sniper-trap fee schedule 50% → 1% over 60s; 50% of trading fee to creator) and launches a test coin
- `02_trade.mjs` – sniper buy, normal buy, sell, then harvests the withheld coin tax and burns a share; prints unclaimed treid/creator fees
- `check_curve.mjs` – validates config offline

Run locally:
```
solana-test-validator --reset --url https://api.devnet.solana.com \
  --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone-upgradeable-program LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn
npm install
RPC=http://127.0.0.1:8899 node scripts/00_wallets.mjs
RPC=http://127.0.0.1:8899 node scripts/01_launch.mjs
RPC=http://127.0.0.1:8899 node scripts/02_trade.mjs all
```
Use `RPC=https://api.devnet.solana.com` for public devnet (needs devnet SOL in the treid wallet).

## Indexer (`indexer/indexer.mjs`)
Listens to the Meteora DBC program, keeps only coins launched from treid's configs (`PARTNER` = treid fee-claimer wallet), decodes the program's swap events for exact price / fee / curve progress, stores everything in SQLite (built into Node 22) and serves:

| Endpoint | What |
|---|---|
| `GET /api/coins` | all treid coins with market cap, curve %, volume, traders, sniper % |
| `GET /api/coin/:mint` | one coin |
| `GET /api/trades/:mint` | last 200 trades (side, SOL, tokens, mcap, fee, sniper/bundle flags) |
| `GET /api/candles/:mint?tf=1m` | candles 1m/5m/15m/1h/4h/1d |
| `GET /api/holders/:mint` | holders with %, curve and dev marked |
| `GET /api/stream` | live server-sent events for new coins and trades |

Flags: **sniper** = bought within ~4 slots (~1.5 s) of launch; **bundle** = 2+ wallets buying in the same slot.

```
RPC=http://127.0.0.1:8899 PARTNER=<treid wallet> node indexer/indexer.mjs
RPC=http://127.0.0.1:8899 NAME="Ice Cat" SYMBOL=ICE node scripts/03_simulate.mjs   # launch + 2 snipers + humans
```
