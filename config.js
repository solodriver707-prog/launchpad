// treid site config — the ops wallet must match the server (/api/health "ops"); launching is blocked if it doesn't
// MAINNET (live). Devnet test values, to switch back: API https://treid-indexer.onrender.com · PARTNER 93E4kPbzRQArUKKV7f7urQdgBSQC7uFehKXVKv5kihAa · TREASURY BzCPzoJmoRKV8Ha7dHpyePikjSDL9a9Y3LNKJQdjeaNX · CLUSTER devnet · no TREID_RPC
window.TREID_API = "https://treid-indexer-mainnet.onrender.com";
window.TREID_PARTNER = "4owmiPxaN9HzQeoFVJeDZvDEStpKrieNt8ynwWNKsQn6";    // hot ops wallet: fee claimer + reward escrow of new coins
window.TREID_TREASURY = "7kcjobw864LLGcuqGa8QBSpqCctkepLBZTotdosRvQd5";   // cold treasury
window.TREID_CLUSTER = "mainnet";   // the site double-checks it against the RPC's genesis hash
window.TREID_RPC = "https://mainnet.helius-rpc.com/?api-key=a672ea9f-30a3-48c2-891e-ef2c65f19f07";   // browser key, restricted to the site's domain in Helius
