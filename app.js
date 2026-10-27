/* treid — no build step, no dependencies.
   Real: Solana wallet connection (Wallet Standard) + SOL balance & airdrop.
   Simulated: tokens, prices, trades, launches (clearly marked as beta/simulated in the footer). */
(function () {
  'use strict';
  var A = window.Avatars;

  if (window.top !== window.self) { try { window.top.location = window.location.href; } catch (e) {} document.documentElement.style.display = 'none'; return; }   // never run inside someone else's frame (clickjacking)
  // ================= CONFIG =================
  // ?rpc= / ?api= overrides are for local development only: localhost addresses, this tab only (a shared link can never repoint someone's site)
  function devHost(u) { try { var h = new URL(u).hostname; return h === 'localhost' || h === '127.0.0.1'; } catch (e) { return false; } }
  function devOverride(key, param) { try { localStorage.removeItem('dl.' + key); var q0 = new URLSearchParams(location.search); if (q0.has(param)) { var v0 = q0.get(param); if (v0 && devHost(v0)) sessionStorage.setItem('dl.' + key, v0); else sessionStorage.removeItem('dl.' + key); } var s0 = sessionStorage.getItem('dl.' + key); return s0 && devHost(s0) ? s0 : null; } catch (e) { return null; } }
  var RPC_DEV = devOverride('rpc', 'rpc'), RPC = RPC_DEV || window.TREID_RPC || 'https://api.devnet.solana.com';
  var TREASURY = window.TREID_TREASURY || 'BzCPzoJmoRKV8Ha7dHpyePikjSDL9a9Y3LNKJQdjeaNX';   // treid treasury (cold wallet)
  var PARTNER = window.TREID_PARTNER || TREASURY;   // fee claimer + reward escrow of new coins (the ops wallet) — pinned in index.html, never taken from the server
  var CHAIN_ID = (window.TREID_CLUSTER || (/mainnet/.test(RPC) ? 'mainnet' : 'devnet')) === 'mainnet' ? 'solana:mainnet' : 'solana:devnet';
  var GENESIS = { 'solana:mainnet': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', 'solana:devnet': 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' };
  var CLUSTER = CHAIN_ID === 'solana:mainnet' ? 'mainnet' : 'devnet', NET = CLUSTER === 'mainnet' ? '' : 'devnet ', NETP = CLUSTER === 'mainnet' ? '' : ' (devnet)';
  var LS = { wallet: 'dl.lastWallet', watch: 'dl.watch', created: 'dl.created' };
  var SOL_USD = 150; // simulation constant

  // ================= HELPERS =================
  function hash(s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647; return h; }
  function rng(seed) { var s = seed % 2147483647; if (s <= 0) s += 2147483646; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(n) { var s = ''; for (var i = 0; i < n; i++) s += B58[Math.floor(Math.random() * 58)]; return s; }
  function fakeCA(suf) { suf = suf || 'trd'; return b58(44 - suf.length) + suf; }
  function short(a) { return a ? a.slice(0, 4) + '…' + a.slice(/treid$/.test(a) ? -5 : -4) : ''; }
  function taxBg(t) { return t === 0 ? 'var(--up)' : t <= 3 ? 'var(--yellow)' : t <= 6 ? 'var(--orange)' : 'var(--pink)'; }
  function fmtK(k) { if (!isFinite(k)) k = 0; var sg = k < 0 ? '-' : '', a = Math.abs(k); if (a > 0 && a < 0.9995) { var d0 = a * 1000; return sg + '$' + (d0 < 100 ? d0.toFixed(2) : Math.round(d0)); } if (a >= 999.995) return sg + '$' + (a / 1000).toFixed(2) + 'M'; if (a >= 99.95) return sg + '$' + Math.round(a) + 'K'; return sg + '$' + a.toFixed(1) + 'K'; }
  var SUB = '₀₁₂₃₄₅₆₇₈₉';
  function fmtPrice(p) {
    if (!(p > 0)) return '$0';
    if (p >= 0.01) return '$' + p.toFixed(4);
    var s = p.toFixed(14).split('.')[1], z = 0;
    while (s[z] === '0') z++;
    var sig = s.slice(z, z + 4);
    if (z < 4) return '$0.' + s.slice(0, z) + sig;
    return '$0.0' + String(z).split('').map(function (d) { return SUB[+d]; }).join('') + sig;
  }
  function price(t) { return t.mcN * 1000 / 1e9; }
  function chg(t) { return (t.mcN / t.mc0 - 1) * 100; }
  function chgTxt(c) { if (!isFinite(c)) c = 0; if (Math.abs(c) < .05) c = 0; return (c >= 0 ? '+' : '') + c.toFixed(1) + '%'; }
  function ago(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + 's'; var m = Math.floor(s / 60); if (m < 60) return m + 'm';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h'; return Math.floor(h / 24) + 'd';
  }
  function fmtNum(n) { if (!isFinite(n)) n = 0; var sg = n < 0 ? '-' : '', a = Math.abs(n); return sg + (a >= 1e9 - 5e5 ? (a / 1e9).toFixed(2) + 'B' : a >= 999950 ? (a / 1e6).toFixed(2) + 'M' : a >= 999.5 ? (a / 1e3).toFixed(1) + 'K' : Math.round(a).toString()); }
  var BADIMG = {}; document.addEventListener('error', function (e) { var im = e.target; if (!im || im.tagName !== 'IMG' || !im.closest('.av')) return; var src = im.getAttribute('src'); if (BADIMG[src]) return; BADIMG[src] = 1; im.style.visibility = 'hidden'; }, true);   // a missing logo hides instead of showing a broken image
  function avatarHTML(t, size) {
    if (!t || (!t.img && !t.spec)) t = { img: t && t.img, spec: { kind: 'frog', skin: A.SKINS[0], bg: A.BGS[0], eyes: 'normal', mouth: 'smile', acc: 'none' } };
    var inner = t.img && !BADIMG[t.img] ? '<img src="' + esc(t.img) + '" alt="" decoding="async"' + (size < 120 ? ' loading="lazy"' : '') + '>' : A.svg(t.spec);
    return '<span class="av" style="width:' + size + 'px;height:' + size + 'px">' + inner + '</span>';
  }
  function copy(text, label) {
    try { navigator.clipboard.writeText(text).then(function () { toast(label || 'Copied'); }, function () { toast('Copy failed'); }); }
    catch (e) { toast('Copy failed'); }
  }
  var I = {
    copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    star: function (on) { return '<svg width="17" height="17" viewBox="0 0 24 24" fill="' + (on ? '#FFD15C' : 'none') + '" stroke="' + (on ? '#FFD15C' : 'currentColor') + '" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>'; },
    search: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zM16.7 19.2h1.7L7.4 4.7H5.6z"/></svg>',
    tg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.9 4.3 18.7 19.5c-.2 1-.9 1.3-1.8.8l-4.8-3.6-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 9-8.1c.4-.3-.1-.5-.6-.2L6.4 13.2l-4.8-1.5c-1-.3-1-1 .2-1.5L20.6 2.9c.9-.3 1.6.2 1.3 1.4z"/></svg>',
    web: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    gift: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/></svg>',
    flame: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2s5 4.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 1-3.5S9 11 11 11c0-4 1-9 1-9z"/></svg>',
    gem: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 3h12l4 6-10 12L2 9z"/></svg>',
    back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    dice: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>',
    up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>'
  };
  var LOGO = '<span class="logo" aria-hidden="true"><svg viewBox="0 0 40 40"><defs><linearGradient id="trG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBF3E2"/><stop offset=".55" stop-color="#D8C3A0"/><stop offset="1" stop-color="#A88D5F"/></linearGradient></defs><polygon class="tr-bar" points="5,13 34,4.5 34,13.5 5,22" fill="url(#trG)" stroke="url(#trG)" stroke-width="3" stroke-linejoin="round"/><polygon class="tr-stem" points="14.5,24.5 24,21.7 24,36 14.5,36" fill="#EDE9E1" stroke="#EDE9E1" stroke-width="3" stroke-linejoin="round"/></svg></span>';

  // ================= DATA =================
  function gradK() { return DEMO ? 69 : Math.round(60 * SOL_USD / 1000); }   // real curve graduates at ~60 SOL of market cap
  function curveMc(prog) { return 5 + Math.max(0, Math.min(100, prog)) / 100 * 64; }
  function mk(name, tick, kind, skinI, bgI, eyes, mouth, acc, buy, sell, pair, mcN, c24, prog, ageM, holders, soc, rewards, burn) {
    if (prog < 100) mcN = curveMc(prog) * (0.97 + (hash(tick) % 7) / 100);
    var t = {
      name: name, tick: tick, spec: { kind: kind, skin: A.SKINS[skinI], bg: A.BGS[bgI], eyes: eyes, mouth: mouth, acc: acc },
      buy: buy, sell: sell, pair: pair, mcN: mcN, mc0: mcN / (1 + c24 / 100), prog: prog, born: Date.now() - ageM * 60000,
      holders: holders, soc: soc, rewards: !!rewards, burn: !!burn, ca: fakeCA(), vol: mcN * rnd(0.08, 0.6)
    };
    seedHist(t);
    return t;
  }
  function seedHist(t) {
    var n = 120, h = [], v = t.mc0;
    var step = Math.pow(t.mcN / t.mc0, 1 / n);
    for (var i = 0; i < n; i++) { v = v * step * (1 + rnd(-0.035, 0.035)); h.push(v); }
    var fix = t.mcN / h[n - 1]; t.hist = h.map(function (x, i) { return x * Math.pow(fix, i / (n - 1)); });
    if (t.prog < 100) t.hist = t.hist.map(function (x) { return Math.min(x, 68.5); });
  }
  // DEMO mode = simulated coins/trades/callouts (no indexer, or ?demo=1). The real site shows only on-chain data.
  var DEMO = (function () { try { var qp = new URLSearchParams(location.search); if (qp.has('demo')) return qp.get('demo') !== '0'; } catch (e) {} return !window.TREID_API; })();
  if (DEMO) document.documentElement.classList.add('demo-mode'), document.body && document.body.classList.add('is-demo');
  document.addEventListener('DOMContentLoaded', function () { if (DEMO) document.body.classList.add('is-demo'); });
  var BASE = [
    mk('Neon Frog', 'NFROG', 'frog', 0, 3, 'normal', 'smile', 'crown', 0, 0, 'SOL', 1240, 34.2, 100, 4320, 4120, true, 1, 1),
    mk('Orbit Cat', 'ORBIT', 'cat', 1, 1, 'shades', 'smile', 'none', 1, 1, 'SPYx', 486, 12.8, 78, 540, 1930, true, 1, 0),
    mk('Chrome Duck', 'QUACK', 'duck', 8, 0, 'normal', 'smile', 'cap', 2, 3, 'TSLAx', 212, -6.4, 51, 180, 820, false, 0, 1),
    mk('Lava Bear', 'LAVA', 'bear', 6, 2, 'laser', 'grin', 'none', 0, 5, 'GOLD', 95, 58.1, 33, 42, 410, true, 1, 0),
    mk('Paper Pug', 'PUG', 'pug', 3, 5, 'normal', 'tongue', 'party', 3, 3, 'USDC', 640, 4.3, 89, 1440, 2610, true, 0, 1),
    mk('Velvet Goat', 'VGOAT', 'goat', 4, 4, 'sleepy', 'smile', 'halo', 5, 5, 'NVDAx', 330, -12.9, 64, 900, 1100, false, 1, 0),
    mk('Pixel Owl', 'HOOT', 'owl', 2, 7, 'normal', 'o', 'none', 0, 1, 'ETH', 58, 121.5, 18, 12, 150, false, 0, 0),
    mk('Tide Shark', 'FINS', 'shark', 5, 0, 'normal', 'grin', 'chain', 1, 2, 'EUR', 174, 9.7, 42, 300, 640, true, 1, 1),
    mk('Mango Monkey', 'MANGO', 'monkey', 1, 6, 'wink', 'grin', 'crown', 0, 0, 'OIL', 880, 22.0, 96, 2160, 3400, true, 1, 1),
    mk('Static Owl', 'STATIC', 'owl', 7, 1, 'laser', 'o', 'none', 4, 8, 'ONDO', 41, -31.2, 9, 25, 90, false, 0, 0),
    mk('Diamond Paws', 'PAWS', 'cat', 5, 7, 'normal', 'tongue', 'chain', 2, 2, 'NFROG', 520, 17.4, 81, 720, 2010, true, 1, 1),
    mk('Turbo Pug', 'TURBO', 'pug', 8, 3, 'shades', 'grin', 'cap', 0, 0, 'BTC', 260, 6.1, 57, 360, 1020, true, 1, 0),
    mk('Gigabear', 'GIGA', 'bear', 9, 4, 'shades', 'smile', 'chain', 1, 1, 'SOL', 1020, 45.3, 100, 2880, 3810, true, 1, 1),
    mk('Frost Shark', 'FROST', 'shark', 5, 7, 'shades', 'grin', 'none', 0, 2, 'ONDO', 133, -3.2, 38, 95, 520, false, 0, 0),
    mk('Banana Ape', 'NANA', 'monkey', 8, 2, 'normal', 'tongue', 'party', 2, 4, 'MANGO', 77, 66.7, 24, 30, 260, true, 0, 0),
    mk('Sir Hoots', 'SIR', 'owl', 6, 5, 'normal', 'smile', 'crown', 0, 1, 'AAPLx', 405, 8.8, 72, 1300, 1540, true, 1, 0),
    mk('Disco Cat', 'DISCO', 'cat', 4, 1, 'wink', 'grin', 'halo', 1, 3, 'GIGA', 19, 210.4, 6, 6, 64, false, 0, 0),
    mk('Chad Pug', 'CHAD', 'pug', 6, 6, 'shades', 'grin', 'crown', 0, 0, 'SOL', 91400, 18.2, 100, 30240, 48200, true, 1, 1),
    mk('Moon Ape', 'MAPE', 'monkey', 4, 0, 'shades', 'grin', 'chain', 1, 1, 'BTC', 38200, 9.4, 100, 20160, 26100, true, 1, 1),
    mk('Golden Goat', 'GOAT', 'goat', 8, 6, 'normal', 'smile', 'crown', 0, 1, 'GOLD', 12600, -4.1, 100, 14400, 15300, true, 1, 0),
    mk('Turbo Shark', 'TSHK', 'shark', 5, 5, 'laser', 'grin', 'chain', 1, 2, 'LINK', 4300, 27.5, 100, 8640, 7900, true, 0, 1),
    mk('Sir Quack', 'SIRQ', 'duck', 8, 4, 'normal', 'smile', 'halo', 0, 0, 'DOGE', 2100, 6.6, 100, 5760, 5100, true, 1, 0),
    mk('Laser Frog', 'ZAP', 'frog', 9, 0, 'laser', 'grin', 'none', 3, 6, 'SILVER', 156, -18.5, 44, 260, 590, false, 0, 1)
  ];  // opt-in preview: real Solana meme logos (logos from trustwallet/assets, MIT) on demo coins
  var REALM = [['BONK', 'Bonk', 'bonk'], ['WIF', 'dogwifhat', 'wif'], ['POPCAT', 'POPCAT', 'popcat'], ['MEW', 'cat in a dogs world', 'mew'], ['BOME', 'BOOK OF MEME', 'bome'], ['PNUT', 'Peanut the Squirrel', 'pnut'], ['GOAT', 'Goatseus Maximus', 'goat'], ['FART', 'Fartcoin', 'fartcoin'], ['MOODENG', 'Moo Deng', 'moodeng'], ['CHILL', 'Just a chill guy', 'chillguy'], ['SLERF', 'SLERF', 'slerf'], ['MYRO', 'Myro', 'myro'], ['PONKE', 'PONKE', 'ponke'], ['MICHI', 'michi', 'michi'], ['GIGA', 'GIGACHAD', 'giga'], ['RTRD', 'RETARDIO', 'retardio'], ['DOGE', 'Dogecoin', 'doge']];
  var REAL_ON = false; try { REAL_ON = localStorage.getItem('dl.realmemes') === '1'; } catch (e) {}
  if (REAL_ON) {
    var remap = {}, sorted = BASE.slice().sort(function (a, b) { return b.mcN - a.mcN; });
    REALM.forEach(function (r, k) { var t = sorted[k]; if (!t) return; remap[t.tick] = r[0]; t.tick = r[0]; t.name = r[1]; t.img = 'memes/' + r[2] + '.webp'; });
    BASE.forEach(function (t) { if (remap[t.pair]) t.pair = remap[t.pair]; });
  }

  var PAIR_INFO = {
    SOL: { img: 'icons/sol.svg', name: 'Solana', cat: 'crypto', g: '◎', c: '#A3B1C2' }, USDC: { img: 'icons/usdc.svg', name: 'USD Coin', cat: 'crypto', g: '$', c: '#5B9BFF' },
    ETH: { img: 'icons/eth.svg', name: 'Ether', cat: 'crypto', g: 'Ξ', c: '#A5B4FC' }, BTC: { img: 'icons/btc.svg', name: 'Bitcoin', cat: 'crypto', g: '₿', c: '#FFA94D' },
    SPYx: { name: 'S&P 500', cat: 'stocks', g: 'S&P', c: '#3DDC97' }, TSLAx: { name: 'Tesla', cat: 'stocks', g: 'T', c: '#FF7A93' },
    NVDAx: { name: 'Nvidia', cat: 'stocks', g: 'N', c: '#9BE15D' }, AAPLx: { name: 'Apple', cat: 'stocks', g: 'A', c: '#D7DEEA' },
    GOLD: { img: 'icons/gold.svg', name: 'Gold', cat: 'commod', g: 'Au', c: '#FFD15C' }, SILVER: { name: 'Silver', cat: 'commod', g: 'Ag', c: '#CBD5E1' }, OIL: { name: 'Crude oil', cat: 'commod', g: 'Oil', c: '#F59E6B' },
    EUR: { img: 'icons/eur.svg', name: 'Euro', cat: 'fx', g: '€', c: '#7DB8FF' }, JPY: { img: 'icons/jpy.svg', name: 'Yen', cat: 'fx', g: '¥', c: '#FF9AA8' }, GBP: { img: 'icons/gbp.svg', name: 'Pound', cat: 'fx', g: '£', c: '#C4B5FD' }
  };
  var CATS = [
    ['all', 'Everything', 'Pair with anything', '#E8E8EA'], ['memes', 'Memes', 'Meme paired with meme', '#FF6B8B'],
    ['crypto', 'Crypto', 'SOL · USDC · BTC · ETH', '#A3B1C2'], ['stocks', 'Stocks', 'Tokenized equities', '#3DDC97'],
    ['commod', 'Commodities', 'Gold · silver · oil', '#FFD15C'], ['fx', 'Currencies', 'EUR · JPY · GBP', '#7DB8FF']
  ];
  [['USDT', 'Tether', 'usdt'], ['BNB', 'BNB', 'bnb'], ['XRP', 'XRP', 'xrp'], ['DOGE', 'Dogecoin', 'doge'], ['LINK', 'Chainlink', 'link'], ['AVAX', 'Avalanche', 'avax'], ['AAVE', 'Aave', 'aave'], ['RAY', 'Meteora', 'ray']].forEach(function (x) { PAIR_INFO[x[0]] = { img: 'icons/' + x[2] + '.svg', name: x[1], cat: 'crypto', g: x[0][0], c: '#888' }; });
  PAIR_INFO.ONDO = { name: 'Ondo', cat: 'crypto', g: 'ON', c: '#C9D5FF' };
  var PAIRS = Object.keys(PAIR_INFO);
  function pairInfo(id) { if (PAIR_INFO[id]) return PAIR_INFO[id]; var t = find(id); return { name: t ? t.name : id, cat: 'memes', g: '', c: '#FF6B8B', meme: t }; }
  function pairLabel(id) { return PAIR_INFO[id] ? id : '$' + id; }
  function coinHTML(id, size) {
    var p = pairInfo(id);
    if (p.meme) return '<span class="coin meme" style="width:' + size + 'px;height:' + size + 'px">' + avatarHTML(p.meme, size) + '</span>';
    if (p.img) return '<span class="coin img" style="width:' + size + 'px;height:' + size + 'px"><img src="' + esc(p.img) + '" alt="' + esc(p.name) + '"></span>';
    var fs = Math.round(size * (p.g.length > 2 ? 0.3 : p.g.length > 1 ? 0.38 : 0.52));
    return '<span class="coin" style="width:' + size + 'px;height:' + size + 'px;background:' + p.c + ';font-size:' + fs + 'px">' + esc(p.g) + '</span>';
  }
  var SORTS = [['bump', 'Live'], ['newest', 'New'], ['trending', 'Trending'], ['grad', 'Near graduation'], ['graduated', 'Graduated'], ['mcap', 'Market cap'], ['lowtax', 'Lowest tax']];
  var TOGGLES = [['zeroOnly', '0% tax only'], ['gradOnly', 'Graduated only'], ['rewardsOnly', 'Holder rewards'], ['watchOnly', 'My watchlist']];
  var ADJ = ['Turbo', 'Baby', 'Sigma', 'Based', 'Cosmic', 'Glitch', 'Ice', 'Mega', 'Sleepy', 'Rich', 'Sir', 'Lucky', 'Hyper', 'Chill', 'Golden', 'Retro'];
  var NOUN = { frog: 'Frog', cat: 'Cat', duck: 'Duck', bear: 'Bear', pug: 'Pug', goat: 'Goat', owl: 'Owl', shark: 'Shark', monkey: 'Ape' };

  // ================= STATE =================
  var S = {
    screen: 'home', tick: null, side: 'buy', amount: '', tf: '1M', tpTab: 'trades',
    maxTax: 10, minProg: 0, minMc: 0, pair: 'All', cat: 'all', view: 'grid', deckIdx: 0, pctAmt: 0, sort: 'bump', zeroOnly: false, gradOnly: false, rewardsOnly: false, watchOnly: false,
    watch: [], created: [], launched: [], trades: [], tradeCount: 0, loading: true, newTick: null,
    palOpen: false, palQ: '', palIdx: 0,
    walletOpen: false, walletMenu: false, wallets: [], wallet: null, account: null, connecting: null, balance: null, airdropping: false,
    c: { name: '', tick: '', desc: '', x: '', tg: '', web: '', pair: 'SOL', buy: 0, sell: 0, img: null, spec: { kind: 'frog', skin: A.SKINS[0], bg: A.BGS[0], eyes: 'normal', mouth: 'smile', acc: 'crown' } }
  };
  try { S.watch = JSON.parse(localStorage.getItem(LS.watch) || '[]'); } catch (e) {}
  if (!DEMO) BASE.length = 0;
  if (DEMO) try {
    var saved = JSON.parse(localStorage.getItem(LS.created) || '[]');
    saved.forEach(function (t) { if (t && t.tick && t.spec) { t.hist = [t.mcN, t.mcN]; if (t.ca && /dmnd$/.test(t.ca)) t.ca = t.ca.slice(0, 39) + 'treid'; S.created.push(t); } });
  } catch (e) {}

  S.live = [];
  function all() { return DEMO ? S.live.concat(S.created, S.launched, BASE) : S.live; }
  S.archive = {};
  function find(tick) { var a = all(); for (var i = 0; i < a.length; i++) if (a[i].tick === tick) return a[i]; return S.archive[tick] || null; }
  function featured() { return (BASE.length ? BASE : all()).slice().sort(function (a, b) { return b.mcN - a.mcN; })[0]; }
  function saveCreated() { try { localStorage.setItem(LS.created, JSON.stringify(S.created.map(function (t) { var o = {}; for (var k in t) if (k !== 'hist') o[k] = t[k]; return o; }))); } catch (e) {} }

  // seed past trades
  (function seedTrades() {
    all().forEach(function (t) {
      for (var i = 0; i < 10; i++) {
        var side = Math.random() < 0.58 ? 'buy' : 'sell', sol = +(Math.pow(Math.random(), 2) * 4 + 0.05).toFixed(3);
        S.trades.push({ tick: t.tick, side: side, sol: sol, wallet: b58(44), t: Date.now() - rnd(20, 3600) * 1000, tax: sol * (side === 'buy' ? t.buy : t.sell) / 100, mine: false });
      }
    });
    S.trades.sort(function (a, b) { return b.t - a.t; });
  })(); S.seedN = S.trades.length;

  function set(p) { for (var k in p) S[k] = p[k]; render(); syncRoute(); }
  function setC(p) { for (var k in p) S.c[k] = p[k]; render(); }

  // ================= TOASTS + CONFETTI =================
  function toast(msg, tok) {
    var box = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = (tok ? avatarHTML(tok, 26) : '') + '<span>' + esc(msg) + '</span>';
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320); }, 3400);
  }
  function confetti() {
    var cols = ['#E8E8EA', '#A3B1C2', '#3DDC97', '#FFD15C', '#FF6B8B'];
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:70;overflow:hidden';
    for (var i = 0; i < 70; i++) {
      var p = document.createElement('i');
      var x = rnd(30, 70), dx = rnd(-45, 45), dur = rnd(1.4, 2.4);
      p.style.cssText = 'position:absolute;top:-12px;left:' + x + 'vw;width:' + rnd(6, 10) + 'px;height:' + rnd(10, 16) + 'px;border-radius:2px;background:' + pick(cols) + ';opacity:.95;';
      p.animate([{ transform: 'translate(0,0) rotate(0deg)' }, { transform: 'translate(' + dx + 'vw,' + rnd(80, 110) + 'vh) rotate(' + rnd(360, 900) + 'deg)', opacity: 0.2 }], { duration: dur * 1000, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 2600);
  }

  function confettiSmall() {
    var b = document.querySelector('.big-btn'); if (!b) return; var r = b.getBoundingClientRect();
    for (var i = 0; i < 18; i++) { var p = document.createElement('i'); p.style.cssText = 'position:fixed;z-index:70;pointer-events:none;width:7px;height:10px;border-radius:2px;left:' + (r.left + r.width / 2) + 'px;top:' + r.top + 'px;background:' + pick(['#E8E8EA', '#3DDC97', '#FFD15C', '#fff']);
      document.body.appendChild(p); p.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: 'translate(' + rnd(-160, 160) + 'px,' + rnd(-200, -60) + 'px) rotate(' + rnd(200, 700) + 'deg)', opacity: 0 }], { duration: rnd(700, 1100), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }); (function (el) { setTimeout(function () { el.remove(); }, 1200); })(p); }
  }
  // ================= WALLET (Wallet Standard) =================
  function isSol(w) { return w && w.features && w.features['standard:connect'] && Array.isArray(w.chains) && w.chains.some(function (c) { return String(c).indexOf('solana:') === 0; }); }
  function registerWallets() {
    Array.prototype.slice.call(arguments).forEach(function (w) {
      if (!isSol(w) || S.wallets.some(function (x) { return x.name === w.name; })) return;
      S.wallets.push(w);
    });
    if (S.walletOpen) render();
    tryAuto();
    return function () {};
  }
  var api = Object.freeze({ register: registerWallets });
  window.addEventListener('wallet-standard:register-wallet', function (e) { try { e.detail(api); } catch (err) {} });
  try { window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api })); } catch (e) {}
  var triedAuto = false;
  function tryAuto() {
    if (triedAuto || S.account) return;
    var last; try { last = localStorage.getItem(LS.wallet); } catch (e) {}
    var w = last && S.wallets.filter(function (x) { return x.name === last; })[0];
    if (!w) return; triedAuto = true; connect(w, true);
  }
  function connect(w, silent) {
    S.connecting = w.name; if (S.walletOpen) render();
    Promise.resolve(w.features['standard:connect'].connect(silent ? { silent: true } : undefined)).then(function (res) {
      var accs = (res && res.accounts) || w.accounts || [];
      var acc = accs.filter(function (a) { return (a.chains || []).some(function (c) { return String(c).indexOf('solana:') === 0; }); })[0] || accs[0];
      if (!acc) { set({ connecting: null }); if (!silent) toast('Wallet did not share an account'); return; }
      try { localStorage.setItem(LS.wallet, w.name); } catch (e) {}
      S.walletAcc = acc; set({ wallet: w, account: acc.address, connecting: null, walletOpen: false, balance: null });
      listen(w); refreshBalance();
      if (!silent) toast(w.name + ' connected · ' + short(acc.address));
    }).catch(function (err) {
      set({ connecting: null });
      if (!silent) toast('Connection cancelled' + (err && err.message ? ': ' + err.message : ''));
    });
  }
  var off = null;
  function listen(w) {
    if (off) { try { off(); } catch (e) {} off = null; }
    var ev = w.features['standard:events']; if (!ev) return;
    off = ev.on('change', function (p) {
      if (!p || !p.accounts) return;
      if (!p.accounts[0]) { set({ wallet: null, account: null, balance: null }); toast('Wallet disconnected'); return; }
      S.walletAcc = p.accounts[0]; set({ account: p.accounts[0].address, balance: null }); refreshBalance();
    });
  }
  function disconnect() {
    var w = S.wallet;
    try { localStorage.removeItem(LS.wallet); } catch (e) {} if (w && w.dl) dlPut(null);
    if (off) { try { off(); } catch (e) {} off = null; }
    set({ wallet: null, account: null, balance: null, walletMenu: false });
    if (w && w.features['standard:disconnect']) Promise.resolve(w.features['standard:disconnect'].disconnect()).catch(function () {});
    toast('Wallet disconnected');
  }
  function rpc(method, params) {
    return fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: method, params: params }) })
      .then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error.message || 'RPC error'); return j.result; });
  }
  function refreshBalance() {
    if (!S.account) return; var a = S.account;
    rpc('getBalance', [a, { commitment: 'confirmed' }]).then(function (r) { if (S.account === a) set({ balance: r.value / 1e9 }); })
      .catch(function () { if (S.account === a) set({ balance: 'err' }); });
  }
  function airdrop() {
    if (!S.account || S.airdropping) return;
    set({ airdropping: true });
    rpc('requestAirdrop', [S.account, 1e9]).then(function () {
      toast('1 ' + NET + 'SOL requested — arrives in a few seconds');
      setTimeout(refreshBalance, 4000); setTimeout(refreshBalance, 10000);
    }).catch(function () { toast('Devnet faucet is rate-limited — try faucet.solana.com'); })
      .then(function () { set({ airdropping: false }); });
  }
  setInterval(function () { if (S.account && document.visibilityState === 'visible') refreshBalance(); }, 30000);
  // holder rewards: every payout ops sends you, with its transaction — wallets like Phantom often hide transfers of new tokens, so we show them here
  S.rw = { acc: null, list: [], at: 0 };
  function rwTok(m) { var a = all(); for (var i = 0; i < a.length; i++) if (a[i].mint === m) return a[i]; return null; }
  function rwLoad() {
    if (DEMO || !API || !S.account) return; var acc = S.account;
    apiGet('/api/rewards/' + acc).then(function (list) { if (acc !== S.account || !Array.isArray(list)) return;
      var key = 'treid.rwSeen.' + acc, seen = 0; try { seen = +localStorage.getItem(key) || 0; } catch (e) {}
      var first = S.rw.acc !== acc, fresh = list.filter(function (r) { return r.ts > seen; });
      S.rw = { acc: acc, list: list, at: Date.now() };
      if (fresh.length && seen) fresh.slice(0, 3).forEach(function (r) { toast('🎁 You received ' + fmtNum(r.amount) + ' $' + r.tokenSymbol + ' holder rewards' + (r.symbol && r.symbol !== r.tokenSymbol ? ' from $' + r.symbol : ''), rwTok(r.mint)); });
      if (list.length) try { localStorage.setItem(key, String(list[0].ts)); } catch (e) {}
      if (S.walletMenu || first) render(); }).catch(function () {});
  }
  setInterval(function () { if (S.account && document.visibilityState === 'visible') rwLoad(); }, 60000);
  setTimeout(rwLoad, 4000);
  // ================= REAL CHAIN ACTIONS (create / buy / sell) =================
  var chainP = null;
  function chainLib() {
    if (window.TreidChain) return Promise.resolve(window.TreidChain);
    return chainP || (chainP = new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'chain.js?v=' + ((document.querySelector('script[src*="app.js"]') || {}).src || '').split('v=')[1]; sc.onload = function () { res(window.TreidChain); }; sc.onerror = function () { chainP = null; rej(new Error('Could not load chain module')); }; document.head.appendChild(sc); }));
  }
  function walletSign(list, b) {
    if (S.wallet && S.wallet.dl) return dlSignTx(list, b);
    var w = S.wallet, f = w && w.features && w.features['solana:signTransaction'];
    if (!f) return Promise.reject(new Error('This wallet can\'t sign transactions here — try Phantom, Solflare or Backpack'));
    return Promise.resolve(f.signTransaction.apply(f, list.map(function (b) { return { account: S.walletAcc, transaction: b, chain: CHAIN_ID }; }))).then(function (r) { return r.map(function (x) { return x.signedTransaction; }); });
  }
  // ===== phones: connect & sign through the Phantom / Solflare app, then come straight back to this browser tab =====
  var WICON = { phantom: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiB2aWV3Qm94PSIwIDAgMTA4IDEwOCIgZmlsbD0ibm9uZSI+CjxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiByeD0iMjYiIGZpbGw9IiNBQjlGRjIiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00Ni41MjY3IDY5LjkyMjlDNDIuMDA1NCA3Ni44NTA5IDM0LjQyOTIgODUuNjE4MiAyNC4zNDggODUuNjE4MkMxOS41ODI0IDg1LjYxODIgMTUgODMuNjU2MyAxNSA3NS4xMzQyQzE1IDUzLjQzMDUgNDQuNjMyNiAxOS44MzI3IDcyLjEyNjggMTkuODMyN0M4Ny43NjggMTkuODMyNyA5NCAzMC42ODQ2IDk0IDQzLjAwNzlDOTQgNTguODI1OCA4My43MzU1IDc2LjkxMjIgNzMuNTMyMSA3Ni45MTIyQzcwLjI5MzkgNzYuOTEyMiA2OC43MDUzIDc1LjEzNDIgNjguNzA1MyA3Mi4zMTRDNjguNzA1MyA3MS41NzgzIDY4LjgyNzUgNzAuNzgxMiA2OS4wNzE5IDY5LjkyMjlDNjUuNTg5MyA3NS44Njk5IDU4Ljg2ODUgODEuMzg3OCA1Mi41NzU0IDgxLjM4NzhDNDcuOTkzIDgxLjM4NzggNDUuNjcxMyA3OC41MDYzIDQ1LjY3MTMgNzQuNDU5OEM0NS42NzEzIDcyLjk4ODQgNDUuOTc2OCA3MS40NTU2IDQ2LjUyNjcgNjkuOTIyOVpNODMuNjc2MSA0Mi41Nzk0QzgzLjY3NjEgNDYuMTcwNCA4MS41NTc1IDQ3Ljk2NTggNzkuMTg3NSA0Ny45NjU4Qzc2Ljc4MTYgNDcuOTY1OCA3NC42OTg5IDQ2LjE3MDQgNzQuNjk4OSA0Mi41Nzk0Qzc0LjY5ODkgMzguOTg4NSA3Ni43ODE2IDM3LjE5MzEgNzkuMTg3NSAzNy4xOTMxQzgxLjU1NzUgMzcuMTkzMSA4My42NzYxIDM4Ljk4ODUgODMuNjc2MSA0Mi41Nzk0Wk03MC4yMTAzIDQyLjU3OTVDNzAuMjEwMyA0Ni4xNzA0IDY4LjA5MTYgNDcuOTY1OCA2NS43MjE2IDQ3Ljk2NThDNjMuMzE1NyA0Ny45NjU4IDYxLjIzMyA0Ni4xNzA0IDYxLjIzMyA0Mi41Nzk1QzYxLjIzMyAzOC45ODg1IDYzLjMxNTcgMzcuMTkzMSA2NS43MjE2IDM3LjE5MzFDNjguMDkxNiAzNy4xOTMxIDcwLjIxMDMgMzguOTg4NSA3MC4yMTAzIDQyLjU3OTVaIiBmaWxsPSIjRkZGREY4Ii8+Cjwvc3ZnPg==', solflare: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz48c3ZnIGlkPSJTIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MCA1MCI+PGRlZnM+PHN0eWxlPi5jbHMtMXtmaWxsOiMwMjA1MGE7c3Ryb2tlOiNmZmVmNDY7c3Ryb2tlLW1pdGVybGltaXQ6MTA7c3Ryb2tlLXdpZHRoOi41cHg7fS5jbHMtMntmaWxsOiNmZmVmNDY7fTwvc3R5bGU+PC9kZWZzPjxyZWN0IGNsYXNzPSJjbHMtMiIgeD0iMCIgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiByeD0iMTIiIHJ5PSIxMiIvPjxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTI0LjIzLDI2LjQybDIuNDYtMi4zOCw0LjU5LDEuNWMzLjAxLDEsNC41MSwyLjg0LDQuNTEsNS40MywwLDEuOTYtLjc1LDMuMjYtMi4yNSw0LjkzbC0uNDYuNS4xNy0xLjE3Yy42Ny00LjI2LS41OC02LjA5LTQuNzItNy40M2wtNC4zLTEuMzhoMFpNMTguMDUsMTEuODVsMTIuNTIsNC4xNy0yLjcxLDIuNTktNi41MS0yLjE3Yy0yLjI1LS43NS0zLjAxLTEuOTYtMy4zLTQuNTF2LS4wOGgwWk0xNy4zLDMzLjA2bDIuODQtMi43MSw1LjM0LDEuNzVjMi44LjkyLDMuNzYsMi4xMywzLjQ2LDUuMThsLTExLjY1LTQuMjJoMFpNMTMuNzEsMjAuOTVjMC0uNzkuNDItMS41NCwxLjEzLTIuMTcuNzUsMS4wOSwyLjA1LDIuMDUsNC4wOSwyLjcxbDQuNDIsMS40Ni0yLjQ2LDIuMzgtNC4zNC0xLjQyYy0yLS42Ny0yLjg0LTEuNjctMi44NC0yLjk2TTI2LjgyLDQyLjg3YzkuMTgtNi4wOSwxNC4xMS0xMC4yMywxNC4xMS0xNS4zMiwwLTMuMzgtMi01LjI2LTYuNDMtNi43MmwtMy4zNC0xLjEzLDkuMTQtOC43Ny0xLjg0LTEuOTYtMi43MSwyLjM4LTEyLjgxLTQuMjJjLTMuOTcsMS4yOS04Ljk3LDUuMDktOC45Nyw4Ljg5LDAsLjQyLjA0LjgzLjE3LDEuMjktMy4zLDEuODgtNC42MywzLjYzLTQuNjMsNS44LDAsMi4wNSwxLjA5LDQuMDksNC41NSw1LjIybDIuNzUuOTItOS41Miw5LjE0LDEuODQsMS45NiwyLjk2LTIuNzEsMTQuNzMsNS4yMmgwWiIvPjwvc3ZnPg==' };   // the wallets' own icons (from their official wallet-adapter packages)
  var DLP = { phantom: { base: 'https://phantom.app/ul/v1/', pk: 'phantom_encryption_public_key', name: 'Phantom', icon: WICON.phantom }, solflare: { base: 'https://solflare.com/ul/v1/', pk: 'solflare_encryption_public_key', name: 'Solflare', icon: WICON.solflare } };
  function dlGet() { try { return JSON.parse(localStorage.getItem('treid.dl') || 'null'); } catch (e) { return null; } }
  function dlPut(o) { try { if (o) localStorage.setItem('treid.dl', JSON.stringify(o)); else localStorage.removeItem('treid.dl'); } catch (e) {} }
  function dlBack(rid) { return location.origin + location.pathname + '?dlr=' + rid; }
  function dlRid() { return Math.random().toString(36).slice(2, 10); }
  function dlUrl(st, method, params) { return DLP[st.prov].base + method + '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&'); }
  function dlGo(st, method, params) { location.href = dlUrl(st, method, params); }
  // signing: the transaction is built first (async), and iOS won't open the app from a delayed redirect — so one tap on a real link opens the wallet
  function dlTap(st, method, params) { S.dlTap = { url: dlUrl(st, method, params), name: DLP[st.prov].name, prov: st.prov, label: method === 'signMessage' ? 'Sign in' : (S.busy || 'Approve transaction') }; render(); }
  function dlTapHTML() { var D = S.dlTap;
    return '<div class="overlay center"><div class="modal dl-tap" role="dialog" aria-modal="true"><img class="wl-ic" src="' + DLP[D.prov].icon + '" alt=""><b>' + esc(String(D.label).replace(/…$/, '')) + '</b><span class="muted">Ready — approve it in ' + esc(D.name) + ' and you come right back.</span>' +
      '<a class="wl-one dl-go" href="' + esc(D.url) + '" data-act="dlTapGo"><span class="wl-nm"><b>Open ' + esc(D.name) + '</b></span><span class="wl-go">Approve →</span></a><button class="link" data-act="dlTapX">Cancel</button></div></div>'; }
  // iOS opens the wallet app straight away only when a real link is tapped (no async work in between) — so the connect link is built before the tap
  S.dlPre = {};
  function dlPrep() {
    var T = window.TreidChain; if (!T) { if (!S._dlLoading) { S._dlLoading = true; chainLib().then(function () { S._dlLoading = false; if (S.walletOpen) render(); }).catch(function () { S._dlLoading = false; }); } return; }
    ['phantom', 'solflare'].forEach(function (prov) { if (S.dlPre[prov]) return; var kp = T.dl.keyPair(), rid = dlRid(), st = { prov: prov, sk: kp.sk, pk: kp.pk, pend: { rid: rid, kind: 'connect', ret: location.hash } };
      S.dlPre[prov] = { st: st, url: dlUrl(st, 'connect', { app_url: location.origin + location.pathname, dapp_encryption_public_key: kp.pk, redirect_link: dlBack(rid), cluster: CLUSTER === 'mainnet' ? 'mainnet-beta' : CLUSTER }) }; });
  }
  function dlWallet(st) { return { name: DLP[st.prov].name, icon: '', dl: true, features: { 'solana:signTransaction': { signTransaction: function () { return Promise.reject(new Error('use walletSign')); } }, 'solana:signMessage': { signMessage: function (o) { return dlSignMsg(o.message); } } } }; }
  function dlUse(st) { S.wallet = dlWallet(st); S.walletAcc = { address: st.account, chains: [CHAIN_ID] }; S.account = st.account; S.balance = null; refreshBalance(); }
  function dlConnect(prov) {
    var go = function (T) { var kp = T.dl.keyPair(), rid = dlRid(), st = { prov: prov, sk: kp.sk, pk: kp.pk, pend: { rid: rid, kind: 'connect', ret: location.hash } }; dlPut(st);
      dlGo(st, 'connect', { app_url: location.origin + location.pathname, dapp_encryption_public_key: kp.pk, redirect_link: dlBack(rid), cluster: CLUSTER === 'mainnet' ? 'mainnet-beta' : CLUSTER }); };
    if (window.TreidChain) go(window.TreidChain); else chainLib().then(go);
  }
  function dlSignTx(bytes, b) {
    var st = dlGet(), T = window.TreidChain; if (!st || !st.session || !T) return Promise.reject(new Error('Reconnect your wallet'));
    var rid = dlRid(), sealed = T.dl.seal({ transactions: bytes.map(function (x) { return T.dl.enc(x instanceof Uint8Array ? x : Uint8Array.from(x)); }), session: st.session }, st.wpk, st.sk);
    st.pend = { rid: rid, kind: 'tx', label: S.busy || 'Transaction', ret: location.hash, cos: (b && b.cosigners) || [], lvbh: b && b.lastValidBlockHeight, mint: (b && b.mint) || null, tick: S.tick, side: S.side }; dlPut(st);
    dlTap(st, 'signAllTransactions', { dapp_encryption_public_key: st.pk, nonce: sealed.nonce, redirect_link: dlBack(rid), payload: sealed.payload });
    return new Promise(function () {});   // the page continues when the wallet sends us back
  }
  function dlSignMsg(message) {
    var st = dlGet(), T = window.TreidChain, after = S._dlAfter; S._dlAfter = null;
    if (!after) return Promise.reject(new Error('On a phone this action needs the wallet’s own browser — open treid in the ' + (st ? DLP[st.prov].name : 'wallet') + ' app'));
    if (!st || !st.session || !T) return Promise.reject(new Error('Reconnect your wallet'));
    var rid = dlRid(), sealed = T.dl.seal({ message: T.dl.enc(message), session: st.session, display: 'utf8' }, st.wpk, st.sk);
    st.pend = { rid: rid, kind: 'msg', ret: location.hash, after: after }; dlPut(st);
    dlTap(st, 'signMessage', { dapp_encryption_public_key: st.pk, nonce: sealed.nonce, redirect_link: dlBack(rid), payload: sealed.payload });
    return new Promise(function () {});
  }
  // runs before the first route: read the wallet's reply from the URL, put the page back where it was
  var DLQ = (function () { var q; try { q = new URLSearchParams(location.search); } catch (e) { return null; } var rid = q.get('dlr'), st = dlGet();
    if (!rid) return st && st.account && st.session ? { restore: st } : null;
    var p = st && st.pend && st.pend.rid === rid ? st.pend : null; try { history.replaceState(null, '', location.pathname + ((p && p.ret) || '')); } catch (e) {}
    return { q: q, st: st, p: p }; })();
  function dlResume() {
    if (!DLQ) return; var R = DLQ; DLQ = null;
    if (R.restore) { dlUse(R.restore); return; }
    var st = R.st, p = R.p, q = R.q; if (!st || !p) return; st.pend = null; dlPut(st);
    if (q.get('errorCode')) { if (st.account) dlUse(st); toast(/reject|cancel|4001/i.test(q.get('errorMessage') + q.get('errorCode')) ? 'Cancelled in wallet' : 'Wallet: ' + (q.get('errorMessage') || 'error')); render(); return; }
    chainLib().then(function (T) {
      if (p.kind === 'connect') { var wpk = q.get(DLP[st.prov].pk), d = T.dl.open(q.get('data'), q.get('nonce'), wpk, st.sk); st.wpk = wpk; st.session = d.session; st.account = d.public_key; dlPut(st); dlUse(st); set({ walletOpen: false }); toast(DLP[st.prov].name + ' connected · ' + short(st.account)); return; }
      var r = T.dl.open(q.get('data'), q.get('nonce'), st.wpk, st.sk); dlUse(st);
      if (p.kind === 'tx') { S.busy = 'Confirming on-chain…'; render();
        return T.sendAll({ rpc: RPC, signed: T.cosign(r.transactions.map(T.dl.dec), p.cos || []), lastValidBlockHeight: p.lvbh }).then(function () { S.busy = null; toast('✓ ' + String(p.label).replace(/…$/, '') + ' — done'); render(); setTimeout(refreshBalance, 1500);
          [2500, 8000].forEach(function (ms) { setTimeout(function () { var tt = S.screen === 'token' && find(S.tick); if (tt && tt.live) livePos(tt); }, ms); }); })
          .catch(function (e) { S.busy = null; render(); toast(e && e.expired ? 'That took too long and the transaction expired — please try again' : chainErr(e)); }); }
      if (p.kind === 'msg' && p.after && p.after.type === 'session') { var a = p.after;
        return fetch(API + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: a.who, ts: a.ts, sig: r.signature }) }).then(function (x) { return x.json(); }).then(function (j) { if (!j || !j.token) throw new Error((j && j.error) || 'sign-in failed');
          S.sess = { w: a.who, token: j.token, exp: j.exp }; try { localStorage.setItem('treid.sess.' + a.who, JSON.stringify({ token: j.token, exp: j.exp })); } catch (e) {}
          if (a.draft) S.cmtDraft = a.draft; if (a.modal) S.coModal = a.modal; toast('Signed in for 24 h — tap Post'); render(); }); }
    }).catch(function (e) { S.busy = null; render(); toast('Couldn’t read the wallet reply: ' + ((e && e.message) || e)); });
  }
  function chainErr(e) {
    var m = String((e && e.message) || e || 'Unknown error');
    if (/reject|declin|cancel|denied/i.test(m)) return 'Cancelled in wallet';
    if (/insufficient|0x1\b|lamports/i.test(m)) return 'Not enough ' + NET + 'SOL';
    if (/slippage|0x1771|ExceededSlippage/i.test(m)) return 'Price moved too much — raise slippage';
    return m.length > 140 ? m.slice(0, 140) + '…' : m;
  }
  function chainRun(label, build, again) {
    if (S.netBad) { toast('Network check failed: the connection isn’t ' + CLUSTER + ' — transactions are blocked'); return Promise.reject(new Error('busy')); }
    if (S.busy) { toast('Finish the current transaction first'); return Promise.reject(new Error('busy')); }
    S.busy = label; render(); toast(label + ' — confirm in your wallet');
    return chainLib().then(function (T) {
      return build(T).then(function (b) { return walletSign(b.bytes, b).then(function (signed) { S.busy = 'Confirming on-chain…'; render(); return T.sendAll({ rpc: RPC, signed: T.cosign(signed, b.cosigners), lastValidBlockHeight: b.lastValidBlockHeight }); }).then(function (sigs) { b.sigs = sigs; return b; }); });
    }).then(function (b) { S.busy = null; render(); setTimeout(refreshBalance, 1500); [2500, 8000].forEach(function (ms) { setTimeout(function () { var tt = S.screen === 'token' && find(S.tick); if (tt && tt.live) livePos(tt); }, ms); }); return b; }, function (e) { S.busy = null; render();
      // the transaction expired before it was sent (a wallet window open for over ~60 s) and nothing went through: build a fresh one and ask once more
      if (e && e.expired && !e.sent && !again) { toast('That took a bit long and the transaction expired — please sign the fresh one'); return chainRun(label, build, true); }
      throw e; });
  }
  setInterval(function () { var tt = S.account && S.screen === 'token' && find(S.tick); if (tt && tt.live && !S.busy && !document.hidden) livePos(tt); }, 20000);   // your balance stays current on the coin page
  function livePos(t) {   // real token balance + cost basis from the user's on-chain trades
    if (!S.account || !t.live) return Promise.resolve(); var who = S.account;
    return chainLib().then(function (T) { return T.tokenBalance({ rpc: RPC, owner: who, mint: t.ca }); }).then(function (bal) {
      if (S.account !== who) return; var cost = 0; S.trades.forEach(function (x) { if (x.tick === t.tick && x.wallet === who) cost += x.side === 'buy' ? x.sol : -x.sol; });
      if (bal > 0) S.pos[t.tick] = { tok: bal, cost: Math.max(0, cost) }; else delete S.pos[t.tick];
      if (API) apiGet('/api/pos?mint=' + t.ca + '&wallet=' + who).then(function (p) { S.myPs = S.myPs || {}; S.myPs[t.ca] = psClean(p); if (S.screen === 'token' && S.tick === t.tick) render(); }).catch(function () {});
      if (S.screen === 'token' && S.tick === t.tick) render();
    }).catch(function () {});
  }
  // compact, permanent coin data inside the on-chain metadata URI (mascot, tax split, socials)
  function coinUri(mint, c, ipfsUri) {
    var A0 = A, ix = function (arr, v) { return Math.max(0, arr.indexOf(v)).toString(36); }, sp = c.spec || {};
    var q = 'c=' + ix(A0.KINDS, sp.kind) + ix(A0.SKINS, sp.skin) + ix(A0.BGS, sp.bg) + ix(A0.EYES, sp.eyes) + ix(A0.MOUTHS, sp.mouth) + ix(A0.ACCS, sp.acc);
    if (c.buy > 0 && c.split) q += '&s=' + c.split.h + '.' + c.split.b + '.' + c.split.d + (rwUri(c) && c.split.h > 0 ? '&r=' + rwUri(c) : '');
    var base = (ipfsUri ? ipfsUri : (API || 'https://treid.fun') + '/api/meta/' + mint) + '?' + q, add = function (k, v) { v = String(v || '').replace(/^https?:\/\//, '').replace(/^@/, '').trim(); if (v && (base + '&' + k + '=' + encodeURIComponent(v)).length <= 200) base += '&' + k + '=' + encodeURIComponent(v); };
    add('x', c.x); add('t', c.tg); add('w', c.web); return base;
  }
  // ===== HOLDER REWARDS: paid in the coin itself (recommended) or any verified token =====
  S.rwq = ''; S.rwBusy = null; S.rwErr = ''; S.rwTab = 'memes';
  var RW_TABS = [['memes', 'Memes'], ['crypto', 'Crypto'], ['stocks', 'Stocks'], ['fx', 'Stablecoins']];
  var RW_PRE = {   // [label, search symbol, logo]
    memes: [['BONK', 'BONK', 'memes/bonk.webp', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'], ['WIF', 'WIF', 'memes/wif.webp', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'], ['POPCAT', 'POPCAT', 'memes/popcat.webp', '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'], ['MEW', 'MEW', 'memes/mew.webp', 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5'], ['BOME', 'BOME', 'memes/bome.webp', 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82'], ['PNUT', 'Pnut', 'memes/pnut.webp', '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump'], ['GOAT', 'GOAT', 'memes/goat.webp', 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump'], ['FARTCOIN', 'Fartcoin', 'memes/fartcoin.webp', '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump'], ['MOODENG', 'MOODENG', 'memes/moodeng.webp', 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY'], ['CHILLGUY', 'CHILLGUY', 'memes/chillguy.webp', 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump'], ['GIGA', 'GIGA', 'memes/giga.webp', '63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9'], ['PONKE', 'PONKE', 'memes/ponke.webp', '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC'], ['MICHI', 'michi', 'memes/michi.webp', '5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp'], ['MYRO', 'MYRO', 'memes/myro.webp', 'HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4'], ['SLERF', 'SLERF', 'memes/slerf.webp', '7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3'], ['RETARDIO', 'RETARDIO', 'memes/retardio.webp', '6ogzHhzdrQr9Pgv6hZ2MNze7UrzBMAFyBBWUYp1Fhitx']],
    crypto: [['SOL', 'SOL', 'icons/sol.svg'], ['BTC', 'cbBTC', 'icons/btc.svg', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'], ['ETH', 'ETH', 'icons/eth.svg', '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'], ['JUP', 'JUP', 'icons/jup.webp', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'], ['RAY', 'RAY', 'icons/ray.svg', '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'], ['PYTH', 'PYTH', 'icons/pyth.webp', 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3'], ['JTO', 'JTO', 'icons/jto.webp', 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL'], ['LINK', 'LINK', 'icons/link.svg']],
    stocks: [['SPYx', 'SPYx', null], ['NVDAx', 'NVDAx', null], ['TSLAx', 'TSLAx', null], ['AAPLx', 'AAPLx', null], ['MSFTx', 'MSFTx', null], ['GOOGLx', 'GOOGLx', null], ['METAx', 'METAx', null], ['AMZNx', 'AMZNx', null]],
    fx: [['USDC', 'USDC', 'icons/usdc.svg'], ['USDT', 'USDT', 'icons/usdt.svg', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'], ['EURC', 'EURC', 'icons/eur.svg', 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr'], ['PYUSD', 'PYUSD', 'icons/pyusd.webp', '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo']] };
  function liveCat(t) { var L = pairLabel(t.pair); if (L === 'SOL') return 'crypto'; for (var k in RW_PRE) for (var i = 0; i < RW_PRE[k].length; i++) if (RW_PRE[k][i][0] === L || RW_PRE[k][i][1] === L) return k; return 'other'; }
  function preIcon(p, size) { if (!p[2] && API) p = [p[0], p[1], API + '/api/ticon?sym=' + encodeURIComponent(p[1])];   // the token's own logo (e.g. xStocks), served by the treid server
    return p[2] ? '<img class="coin rwp-ic" src="' + esc(p[2]) + '" alt="" data-ini="' + esc(p[0].slice(0, 2)) + '" style="width:' + size + 'px;height:' + size + 'px">' : '<span class="coin rwp-ic" style="width:' + size + 'px;height:' + size + 'px;background:#2E2E33;font-size:' + Math.round(size * .42) + 'px">' + esc(p[0].slice(0, 2)) + '</span>'; }
  function preOf(sym) { for (var t in RW_PRE) for (var i = 0; i < RW_PRE[t].length; i++) if (RW_PRE[t][i][1] === sym) return RW_PRE[t][i]; return null; }
  function tokImg(mint) { return API ? API + '/api/ticon?mint=' + mint : null; }   // logos come through the treid server (outside hosts are often slow or blocked)
  function rwPreset(sym) {   // a shortcut chip: its known address (verified + same symbol required), else find the verified token with exactly this symbol
    if (sym === 'SOL') return rwSelect(WSOL); if (sym === 'USDC') return rwSelect(USDC_MINT);
    var pp = preOf(sym); if (pp && pp[3]) return rwSelect(pp[3], { sym: pp[1], img: pp[2], retry: function () { rwPresetSearch(sym); } });
    rwPresetSearch(sym);
  }
  function rwPresetSearch(sym) {
    if (!API) { S.rwErr = 'Token search needs the treid server'; render(); return; }
    S.rwBusy = sym; S.rwErr = ''; render();
    apiGet('/api/tsearch?q=' + encodeURIComponent(sym)).then(function (list) { var t = (list || []).filter(function (x) { return String(x.symbol).toLowerCase() === sym.toLowerCase(); })[0];
      if (S.rwBusy !== sym) return; S.rwBusy = null; if (!t) { S.rwErr = 'Couldn’t find verified ' + sym + ' right now — try the search'; render(); return; } var pp = preOf(sym); rwSelect(t.mint, { sym: sym, img: pp && pp[2] }); })
      .catch(function () { S.rwBusy = null; S.rwErr = 'Token search is unavailable — try again'; render(); });
  }
  function rwOf(c) { return c && c.rw && c.rw.mint ? c.rw : null; }   // null = the coin itself
  function rwUri(c) { var r = rwOf(c); return r ? (r.mint === qOf(c).mint ? 'p' : r.mint) : ''; }
  function tokDrop(list, act, q) {
    return (list || []).map(function (t) { var k = qReg(t.symbol, t.mint, tokImg(t.mint) || t.icon, t.name); return '<button class="cpp-it" data-act="' + act + '" data-arg="' + esc(t.mint) + '">' + coinHTML(k, 26) + '<span><b>' + esc(t.symbol || k) + ' <em class="rwp-v">✓</em></b><small>' + esc(t.name || '') + ' · ' + esc(short(t.mint)) + '</small></span></button>'; }).join('') ||
      (isCA(q) ? '<button class="cpp-it ca" data-act="' + act + '" data-arg="' + esc(q) + '"><span class="coin" style="width:26px;height:26px;background:#3A3A3D;font-size:12px">?</span><span><b>Use this contract</b><small class="mono">' + esc(short(q)) + '</small></span></button>' : '<div class="muted cpp-none">No verified token found — try the ticker or paste the contract address.</div>');
  }
  function tokSearch(q, dropId, act) {   // name / ticker search through the server (verified tokens only), results drawn without re-rendering the page
    clearTimeout(S.tsT); var el = function () { return document.getElementById(dropId); };
    if (q.length < 2) { if (el()) el().style.display = 'none'; return; }
    S.tsT = setTimeout(function () { (API ? apiGet('/api/tsearch?q=' + encodeURIComponent(q)) : Promise.resolve([])).catch(function () { return []; }).then(function (list) { var d = el(); if (!d) return; d.innerHTML = tokDrop(list, act, q); d.style.display = 'flex'; }); }, 250);
  }
  function rwSelect(mint, pre) {
    if (mint === 'coin') { setC({ rw: 'coin' }); S.rwErr = ''; return; }
    if (mint === WSOL || mint === USDC_MINT) { var kk = mint === WSOL ? 'SOL' : 'USDC'; S.c.rw = { mint: mint, sym: kk, key: kk }; S.rwq = ''; S.rwErr = ''; render(); return; }
    if (mint === qOf(S.c).mint) { var q0 = qOf(S.c); S.c.rw = { mint: mint, sym: q0.sym, key: q0.key }; S.rwq = ''; S.rwErr = ''; render(); return; }
    S.rwBusy = mint; S.rwErr = ''; render();
    Promise.all([chainLib().then(function (T) { return T.quoteInfo({ rpc: RPC, mint: mint, reward: true }); }), API ? apiGet('/api/qprice?mint=' + mint).catch(function () { return {}; }) : Promise.resolve({})]).then(function (r) {
      var qi = r[0], pr = r[1] || {}; if (S.rwBusy !== mint) return; S.rwBusy = null;
      if (!qi.ok && CHAIN_ID === 'solana:devnet' && pr.verified && /No token found/.test(qi.reason || '')) qi = { ok: true, warn: 'Test network: holders get SOL here — ' + (pr.symbol || 'this token') + ' payouts start on mainnet' };
      if (!qi.ok) { S.rwErr = qi.reason || 'This token can’t be paid out'; render(); return; }
      if (pre && (!pr.verified || String(pr.symbol || '').toLowerCase() !== pre.sym.toLowerCase())) { if (pre.retry) return pre.retry(); S.rwErr = 'That shortcut didn’t check out — try the search'; render(); return; }
      if (!pr.verified) { S.rwErr = 'Only verified tokens can be holder rewards (so holders never get a fake).'; render(); return; }
      var k = qReg(pr.symbol, mint, tokImg(mint) || pr.icon, pr.name); if (pre && pre.img) PAIR_INFO[k].img = pre.img; S.c.rw = { mint: mint, sym: pr.symbol || k, key: k, warn: qi.warn || null }; S.rwq = ''; render();
    }).catch(function (e) { S.rwBusy = null; S.rwErr = 'Couldn’t check this token: ' + chainErr(e); render(); });
  }
  function rewardPick(c) {
    if (!(c.split && c.split.h > 0)) return '';
    var tk = '$' + (c.tick || 'TICKER'), r = rwOf(c), q = qOf(c), chips = [[WSOL, 'SOL'], [USDC_MINT, 'USDC']];
    if (q.mint !== WSOL && q.mint !== USDC_MINT) chips.push([q.mint, q.key]);
    if (r && !chips.some(function (x) { return x[0] === r.mint; })) chips.push([r.mint, r.key]);
    var me = { tick: c.tick || 'TICKER', name: c.name || 'Your token', spec: c.spec, img: c.img };
    var own = '<button class="cpp-q rwp-own' + (!r ? ' on' : '') + '" data-act="rwPick" data-arg="coin">' + avatarHTML(me, 20) + esc(tk) + '<em class="rwp-tag">★ Best for holders</em></button>';
    var sel = r ? coinHTML(r.key, 30) + '<span><b>' + esc(r.sym) + '</b><small>sold from the tax, then paid out</small></span>' : avatarHTML(me, 30) + '<span><b>' + esc(tk) + '</b><small>your own coin · nothing is sold</small></span>';
    var pre = RW_PRE[S.rwTab] || [], isOn = function (p) { return r && (String(r.sym).toLowerCase() === p[1].toLowerCase() || (p[0] === 'SOL' && r.mint === WSOL) || (p[0] === 'USDC' && r.mint === USDC_MINT)); };
    var tabs = '<div class="cpp-tabs">' + RW_TABS.map(function (x) { return '<button class="' + (S.rwTab === x[0] ? 'on' : '') + '" data-act="rwTab" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var preChips = pre.map(function (p) { return '<button class="cpp-q' + (isOn(p) ? ' on' : '') + '" data-act="rwPre" data-arg="' + esc(p[1]) + '">' + preIcon(p, 20) + '$' + esc(p[0]) + '</button>'; }).join('');
    return '<div class="field cpp rwp"><div class="spk-h"><b>Holders get paid in</b><span class="spk-lock">' + ICO.lock + 'Locked forever at launch</span></div>' +
      '<div class="cpp-row"><div class="cpp-sel' + (!r ? ' rwp-sel-own' : '') + '">' + sel + '</div>' +
      '<div class="cpp-s">' + I.search + '<input data-rwq value="' + esc(S.rwq) + '" placeholder="Search name, ticker or paste contract address" autocomplete="off" spellcheck="false"><div class="cpp-drop" id="rw-drop" style="display:none"></div></div></div>' +
      '<div class="cpp-quick drag-scroll rwp-first">' + own + (q.mint !== WSOL && q.mint !== USDC_MINT ? '<button class="cpp-q' + (r && r.mint === q.mint ? ' on' : '') + '" data-act="rwPick" data-arg="' + esc(q.mint) + '">' + coinHTML(q.key, 20) + esc(q.sym) + ' <small class="muted">pair</small></button>' : '') + '</div>' +
      tabs + '<div class="cpp-quick drag-scroll">' + preChips + '</div>' +
      (S.rwBusy ? '<small class="rpp-st">Checking token…</small>' : S.rwErr ? '<small class="rpp-st bad">' + esc(S.rwErr) + '</small>' : r && r.warn ? '<small class="rpp-st warn">⚠ ' + esc(r.warn) + '</small>' : '') +
      '<small class="spk-note">' + (!r ? 'Paying holders in <b>' + esc(tk) + '</b> is the strongest choice: their bags grow and nothing is ever sold, so payouts never push your price down.'
        : 'Each payout first sells the tax for ' + esc(r.sym) + ' — that sale shows on your chart. Coins that pay in their own token keep steadier charts; most strong communities choose ' + esc(tk) + '.') + '</small></div>';
  }
  function parseUri(uri) {
    var o = {}; try { var u = new URL(uri), g = function (k) { return u.searchParams.get(k); }, cc = g('c');
      if (cc && cc.length >= 6) { var d = cc.split('').map(function (ch) { return parseInt(ch, 36) || 0; }); o.spec = { kind: A.KINDS[d[0]] || A.KINDS[0], skin: A.SKINS[d[1]] || A.SKINS[0], bg: A.BGS[d[2]] || A.BGS[0], eyes: A.EYES[d[3]] || 'normal', mouth: A.MOUTHS[d[4]] || 'smile', acc: A.ACCS[d[5]] || 'none' }; }
      if (g('s')) { var p3 = g('s').split('.').map(Number); if (p3.length === 3 && p3[0] + p3[1] + p3[2] === 100) { o.split = { p: 'custom', h: p3[0], b: p3[1], d: p3[2] }; for (var pk0 in SPRE) if (SPRE[pk0][2] === p3[0] && SPRE[pk0][3] === p3[1] && SPRE[pk0][4] === p3[2]) o.split.p = pk0; } }
      if (g('r') === 'p') o.rw = 'pair'; else if (isCA(g('r') || '')) o.rw = { mint: g('r') };
      ['x', 't', 'w'].forEach(function (k) { if (g(k)) o[k] = g(k); });
    } catch (e) {} return o;
  }

  // ================= RENDER PIECES =================
  function balTxt() { return S.balance === null ? '…' : S.balance === 'err' ? '—' : S.balance.toFixed(3); }

  function tape() {
    var items = all().slice(0, 24).map(function (t) {
      var c = chg(t);
      return '<button class="tape-item" data-act="open" data-arg="' + esc(t.tick) + '">' + avatarHTML(t, 20) + '<b>$' + esc(t.tick) + '</b><span>' + fmtK(t.mcN) + '</span><span class="' + (c >= 0 ? 'up' : 'down') + '" data-tape="' + esc(t.tick) + '">' + chgTxt(c) + '</span></button>';
    }).join('');
    return '<div class="tape" aria-label="Live token ticker"><div class="tape-track">' + items + items + '</div></div>';
  }

  function header() {
    var right;
    if (S.account) {
      var icon = S.wallet && S.wallet.icon ? '<img src="' + esc(S.wallet.icon) + '" alt="">' : '<span class="dot"></span>';
      var WP = wprof(S.account), WS = wsum(WP), solB = typeof S.balance === 'number' ? S.balance : (WP.sol || 0), totU = solB * SOL_USD + WS.value;
      var wbOpen = WP.coins.filter(function (c) { return S.wbTab === 'closed' ? c.held <= 1 : c.held > 1; }).sort(function (a, z) { return S.wbTab === 'closed' ? z.profit - a.profit : z.value - a.value; });
      right = '<div class="wb-wrap"><button class="wpill wb-pill" data-act="walletMenu" aria-expanded="' + S.walletMenu + '"><span class="mono wb-tot">$' + money(totU) + '</span><span class="wb-car">' + (S.walletMenu ? '▴' : '▾') + '</span><span class="av" style="width:28px;height:28px">' + A.svg(walletSpec(S.account)) + '</span>' + (CLUSTER !== 'mainnet' ? '<span class="net">' + CLUSTER + '</span>' : '') + '</button>' +
        (S.walletMenu ? '<div class="wbal"><div class="wb-h"><b>Your balance</b><button class="wb-addr mono" data-act="copyAddr">' + esc(short(S.account)) + ' ' + I.copy + '</button></div>' +
          '<div class="wb-big mono">$' + money(totU) + '</div>' +
          '<div class="wb-sol">' + coinHTML('SOL', 26) + '<b>SOL</b><span class="mono">' + solB.toFixed(4) + ' SOL</span><small class="muted mono">$' + money(solB * SOL_USD) + '</small></div>' +
          '<div class="wb-acts"><button class="btn pri" data-act="wbDeposit">Deposit</button><button class="btn sec" data-act="wallet" data-arg="' + esc(S.account) + '">Profile</button>' + (CHAIN_ID !== 'solana:mainnet' ? '<button class="btn sec" data-act="airdrop"' + (S.airdropping ? ' disabled' : '') + '>' + (S.airdropping ? 'Requesting…' : 'Get 1 ' + NET + 'SOL') + '</button>' : '') + '</div>' +
          (S.wbDep ? '<div class="wb-dep">Send SOL to your wallet address from an exchange or another wallet:<button class="mono" data-act="copyAddr">' + esc(S.account) + ' ' + I.copy + '</button></div>' : '') +
          '<div class="wb-con">' + (S.wallet && S.wallet.icon ? '<img src="' + esc(S.wallet.icon) + '" alt="">' : '<span class="wb-wi">◎</span>') + '<span><small class="muted">Connected with</small><b>' + esc(S.wallet ? S.wallet.name : 'Wallet') + ' <span class="muted">· external wallet</span></b></span><button class="link wb-dc" data-act="disconnect">Disconnect</button></div>' +
          '<div class="wb-tabs"><div class="seg sm"><button class="' + (S.wbTab !== 'closed' ? 'on' : '') + '" data-act="wbTab" data-arg="open">Open</button><button class="' + (S.wbTab === 'closed' ? 'on' : '') + '" data-act="wbTab" data-arg="closed">Closed</button><button class="' + (S.wbTab === 'rewards' ? 'on' : '') + '" data-act="wbTab" data-arg="rewards">🎁 Rewards</button></div><button class="link" data-act="refresh">↻ Refresh</button></div>' +
          '<div class="wb-list">' + (S.wbTab === 'rewards' ? rwListHTML() : WP.loading ? '<div class="muted wb-empty"><span class="gr-sp"></span> Loading…</div>' : wbOpen.length ? wbOpen.map(function (c) { var up = c.profit >= 0, my = (S.comments[c.t.tick] || []).filter(function (x) { return x.w === S.account && x.reply == null && x.text; }).sort(function (a, z) { return z.t - a.t; })[0];
            return '<div class="wb-pos"><button class="wb-pt" data-act="open" data-arg="' + esc(c.t.tick) + '">' + avatarHTML(c.t, 42) + '<span class="wb-pn"><b>$' + esc(c.t.tick) + '</b><small class="muted">' + esc(c.t.name) + '</small></span><span class="wb-pv"><small>Position</small><b class="mono">$' + money(S.wbTab === 'closed' ? c.got : c.value) + '</b></span><span class="wb-pv"><small>Profit</small><b class="mono ' + (up ? 'up' : 'down') + '">' + (up ? '+' : '−') + '$' + money(c.profit) + '</b></span></button>' +
              '<div class="wb-pm"><span>Spent <b class="mono">$' + moneyS(c.spent) + '</b></span><span>Avg entry <b class="mono">' + (c.avgEntryMc ? fmtK(c.avgEntryMc / 1000) : '—') + '</b> → <b class="mono">' + fmtK(c.t.mcN) + ' MC</b></span></div>' + (my ? '<div class="wb-co">' + esc(my.text.length > 110 ? my.text.slice(0, 110) + '…' : my.text) + '</div>' : '') + '</div>'; }).join('') : '<div class="muted wb-empty">' + (S.wbTab === 'closed' ? 'No closed positions yet.' : 'No open positions on treid yet.') + '</div>') + '</div></div>' : '') + '</div>';
    } else {
      right = '<button class="btn sec" data-act="openWallet">Connect<span class="cw-w"> wallet</span></button>';
    }
    return '<header><div class="wrap hdr">' +
      '<button class="brand" data-act="home" aria-label="treid home"><span class="brand-name">treid</span></button>' +
      '<nav class="navlinks"><span class="nav-ind" id="nav-ind"></span><button class="' + (S.screen === 'home' ? 'on' : '') + '" data-act="home">Board</button><button class="' + (S.screen === 'create' ? 'on' : '') + '" data-act="create">Create</button><button class="' + (S.screen === 'leaders' ? 'on' : '') + '" data-act="leaders">Leaderboard</button><button class="' + (S.screen === 'burn' ? 'on' : '') + '" data-act="burnPage">🔥 Burnery</button><button class="' + (S.screen === 'trend' ? 'on' : '') + '" data-act="trendList">Trending</button><button data-act="how">How it works</button></nav>' +
      '<button class="searchbtn" data-act="palette">' + I.search + '<span>Search tokens or paste CA</span><span class="kbd">Ctrl K</span></button>' +
      '<div class="hdr-right">' + (DEMO || API ? '<button class="wl-btn co-btn' + (S.coOpen ? ' on' : '') + '" data-act="coToggle" title="Hot callouts">🔥<span>Callouts</span><b class="mono" id="co-new" style="display:none">0</b></button>' : '') + '<button class="wl-btn' + (S.screen === 'watch' ? ' on' : '') + '" data-act="watchPage" aria-label="Watchlist" data-tip="Your watchlist">' + I.star(S.watch.length > 0) + (S.watch.length ? '<b class="mono" id="wl-n">' + S.watch.length + '</b>' : '') + '</button><button class="btn pri" data-act="create">+ Launch token</button>' + right + '</div>' +
      '</div></header>' +
      '<nav class="mnav" aria-label="Main">' + [['home', 'Board', '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>', (!S.coOpen && S.screen === 'home')], ['trendList', 'Trending', '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>', (!S.coOpen && S.screen === 'trend')], ['leaders', 'Ranks', '<path d="M8 21V11M16 21V7M12 21V3M4 21h16"/>', (!S.coOpen && S.screen === 'leaders')], ['create', 'Launch', '<path d="M12 5v14M5 12h14"/>', (!S.coOpen && S.screen === 'create'), 'pri'], ['coToggle', 'Callouts', '<path d="M21 12a8 8 0 01-11.6 7.1L4 21l1.9-5.4A8 8 0 1121 12z"/>', S.coOpen], ['burnPage', 'Burnery', '<path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-9 0 4-4 6-4 12 0 5 3 8 7 8z"/>', (!S.coOpen && S.screen === 'burn')], ['watchPage', 'Watchlist', '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', (!S.coOpen && S.screen === 'watch')]].filter(function (x) { return true; }).map(function (x) { return '<button class="' + (x[3] ? 'on ' : '') + (x[4] || '') + '" data-act="' + x[0] + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">' + x[2] + '</svg><span>' + x[1] + '</span>' + (x[0] === 'coToggle' ? '<b class="mn-badge mono" id="mn-co"' + (S.mCo ? '' : ' style="display:none"') + '>' + (S.mCo || '') + '</b>' : '') + '</button>'; }).join('') + '</nav>';
  }

  function cardPts(t) {
    var h = t.hist.slice(-48), mx = Math.max.apply(null, h), mn = Math.min.apply(null, h), sp = (mx - mn) || 1;
    return h.map(function (v, i) { return [i * 300 / (h.length - 1), 6 + (1 - (v - mn) / sp) * 46]; });
  }
  function cardChart(t) {
    var pts = cardPts(t), line = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L'), last = pts[pts.length - 1];
    return '<svg viewBox="0 0 300 58" preserveAspectRatio="none" aria-hidden="true"><path class="cc-a" d="' + line + ' L300 58 L0 58 Z"/><path class="cc-l" d="' + line + '"/></svg>' +
      '<span class="cc-dot" style="top:' + (last[1] / 58 * 100).toFixed(1) + '%"></span>';
  }
  function spark(t) {
    var h = t.hist.slice(-36), mx = Math.max.apply(null, h), mn = Math.min.apply(null, h), sp = (mx - mn) || 1;
    return h.map(function (v, i) { return (i * 110 / (h.length - 1)).toFixed(1) + ',' + (36 - (v - mn) / sp * 32).toFixed(1); }).join(' ');
  }

  function xLink(v) { var l = linkOf(/[\/.]/.test(v) ? v : 'x.com/' + String(v).replace(/^@/, '')); return l && /^https:\/\/(www\.)?(x|twitter)\.com\//i.test(l) ? l : null; }
  function tgLink(v) { var l = linkOf(/[\/.]/.test(v) ? v : 't.me/' + String(v).replace(/^@/, '')); return l && /^https:\/\/(t|telegram)\.me\//i.test(l) ? l : null; }
  function linkOf(u) { if (!u) return null; u = String(u).trim(); if (!u) return null; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null; }
  function socialsOf(t) {
    if (t.links) return t.links;
    if (!t.soc) return { web: null, x: null, tg: null, demo: true };
    var h = hash(t.tick);
    return { web: h % 3 !== 0 ? '#' : null, x: '#', tg: (h >> 2) % 2 === 0 ? '#' : null, demo: true };
  }
  function socialsHTML(t, big) {
    var so = socialsOf(t), items = [['web', 'Website', I.web], ['x', 'X', I.x], ['tg', 'Telegram', I.tg]];
    return '<div class="soc' + (big ? ' big' : '') + '">' + items.map(function (it) {
      var has = !!so[it[0]];
      return has ? '<button class="sbtn2 on" data-act="soc" data-arg="' + esc(t.tick) + '|' + it[0] + '" aria-label="' + it[1] + '">' + it[2] + '<span>' + it[1] + '</span></button>' :
        '<span class="sbtn2 off" title="No ' + it[1] + '">' + it[2] + '<span>' + it[1] + '</span></span>';
    }).join('') + '</div>';
  }
  function freshness(t) {
    var m = (Date.now() - t.born) / 60000;
    if (m < 5) return { cls: 'f0', lab: 'JUST LAUNCHED' };
    if (m < 60) return { cls: 'f1', lab: 'NEW' };
    if (m < 1440) return { cls: 'f2', lab: 'TODAY' };
    return { cls: 'f3', lab: 'LIVE FOR' };
  }
  function liveBal(t) {
    var m = {}; S.trades.filter(function (x) { return x.tick === t.tick && x.tokens; }).sort(function (a, b) { return a.t - b.t; }).forEach(function (x) { m[x.wallet] = Math.max(0, (m[x.wallet] || 0) + (x.side === 'buy' ? x.tokens : -x.tokens)); });
    (S.myBurns || []).forEach(function (b) { if (b.tick === t.tick && m[b.who] != null) m[b.who] = Math.max(0, m[b.who] - b.tok); });
    return Object.keys(m).filter(function (a) { return m[a] > 0; }).map(function (a) { return { a: a, tok: m[a], pct: m[a] / 1e9 * 100 }; }).sort(function (a, b) { return b.tok - a.tok; });
  }
  function riskMetrics(t) {
    var h = hash(t.tick + 'r'), devSold = (h >> 4) % 7 === 0 && t.prog < 100;
    function lv(v, a, b) { return v < a ? 'g' : v < b ? 'y' : 'r'; }
    var dev = devSold ? 0 : ((h % 80) / 10), top = 16 + (h >> 2) % 52, sn = (h >> 5) % 19, bu = (h >> 8) % 16;
    if (t.creator && S.account && t.creator === S.account) { dev = 2.1; top = 22; sn = 0; bu = 0; devSold = false; }
    if (t.live) { var L = t.lstat || {}; dev = L.dev || 0; top = L.top >= 10 ? Math.round(L.top) : +(L.top || 0).toFixed(1); sn = +(L.sn || 0).toFixed(1); bu = +(L.bu || 0).toFixed(1); devSold = !!L.devSold; }
    else if (t.devPct != null) { var lb = liveBal(t), dv = lb.filter(function (x) { return x.a === t.creator; })[0]; var anyTr = S.trades.some(function (x) { return x.tick === t.tick && x.tokens; }); dev = lb.length || anyTr ? (dv ? dv.pct : 0) : t.devPct; top = lb.slice(0, 10).reduce(function (a, x) { return a + x.pct; }, 0); if (!lb.length) top = anyTr ? 0 : Math.max(t.devPct, 0); top = top >= 10 ? Math.round(top) : +top.toFixed(1); sn = 0; bu = 0; devSold = !!(t.devPct > 0 && anyTr && !dv); }
    return [
      { k: 'dev', lab: 'DEV', val: devSold ? 'SOLD' : dev.toFixed(1) + '%', lv: devSold ? 'r' : lv(dev, 3, 8), tip: devSold ? 'The creator already sold their tokens' : 'Share of supply the creator still holds' },
      { k: 'top', lab: 'TOP 10', val: top + '%', lv: lv(top, 30, 45), tip: 'Share of supply held by the 10 biggest wallets (excl. curve)' },
      { k: 'sn', lab: 'SNIPERS', val: sn + '%', lv: lv(sn, 5, 12), tip: 'Supply bought by bots in the first seconds after launch' },
      { k: 'bu', lab: 'BUNDLES', val: bu + '%', lv: lv(bu, 4, 9), tip: 'Supply bought by linked wallets in the same block' }
    ];
  }
  function riskTiles(t) {
    var r = riskMetrics(t);
    return '<div class="risk">' + r.map(function (m) {
      return '<span class="rk-t lv-' + m.lv + '" data-tip="' + esc(m.tip) + '"><span class="rk-l"><i></i>' + m.lab + '</span><b class="mono">' + m.val + '</b></span>';
    }).join('') + '</div>';
  }
  function redFlags(t) {
    if (t.live) { var lf = [], L = t.lstat || {}, tm = Math.max(t.buy, t.sell); if (tm >= 6) lf.push('High tax ' + tm + '%'); if (L.top > 48) lf.push('Top 10 hold ' + Math.round(L.top) + '%'); if (L.devSold) lf.push('Dev sold'); if (L.sn >= 12) lf.push('Snipers ' + L.sn.toFixed(0) + '%'); if (L.bu >= 9) lf.push('Bundles ' + L.bu.toFixed(0) + '%'); return lf; }
    var f = [], h = hash(t.tick), tmax = Math.max(t.buy, t.sell), top10 = 18 + (h % 50);
    if (tmax >= 6) f.push('High tax ' + tmax + '%');
    if (t.sell - t.buy >= 3) f.push('Sell tax ' + t.sell + '%');
    if (top10 > 48) f.push('Top 10 hold ' + top10 + '%');
    if ((h >> 4) % 6 === 0 && t.prog < 100) f.push('Dev sold');
    if (!t.soc && t.prog > 20) f.push('No socials');
    return f;
  }
  // phones: pump.fun-style coin rows — square logo, name + ticker + age, big market cap and a % pill, row tinted by direction
  function mrow(t) { var c = chg(t), up = c >= 0, tm = Math.max(t.buy, t.sell), id = esc(t.tick), hot = Math.abs(c) >= 25 || (t.vol > 50 && up), age = ago(t.born), vo = vampOf(t);
    return '<button class="mrow ' + (up ? 'up' : 'dn') + '" data-act="open" data-arg="' + id + '"><span class="mr-pic">' + avatarHTML(t, 60) + '<span class="mr-pair">' + coinHTML(t.pair, 18) + '</span></span>' +
      '<span class="mr-mid"><span class="mr-n"><b>' + esc(t.name) + '</b>' + (vo ? '<i class="mr-v">🧛</i>' : '') + (hot ? '<em class="mr-hot">HOT</em>' : '') + '</span>' +
      '<span class="mr-s"><span class="mono">' + id + '</span><span class="mr-age">🌱 ' + age + '</span>' + (tm > 0 ? '<span class="mr-tax" style="background:' + taxBg(tm) + '">' + tm + '%</span>' : '') + (t.prog >= 100 ? '<span class="mr-g">🎓</span>' : '') + '</span></span>' +
      '<span class="mr-r"><b class="mono" data-mc="' + id + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</b><span class="chgpill ' + (up ? 'up' : 'down') + '" data-chg="' + id + '">' + (up ? '↑ ' : '↓ ') + chgTxt(Math.abs(c)).replace('+', '') + '</span></span></button>'; }
  function card(t, opts) {
    opts = opts || {};
    var tmax = Math.max(t.buy, t.sell), on = S.watch.indexOf(t.tick) !== -1, c = chg(t), done = t.prog >= 100, fr = freshness(t), fl = redFlags(t);
    var flags = fl.length ? '<div class="tc-flags bad" data-tip="' + esc(fl.join(' · ')) + '"><span class="fl-ic">!</span><span>' + esc(fl.slice(0, 2).join(' · ')) + (fl.length > 2 ? ' +' + (fl.length - 2) : '') + '</span></div>' :
      '<div class="tc-flags ok"><span class="fl-ic">✓</span><span>No red flags</span></div>';
    return '<article class="tcard' + (S.newTick === t.tick ? ' is-new' : '') + (t.live ? ' is-live' : '') + ' ' + fr.cls + '" data-card="' + esc(t.tick) + '" data-act="open" data-arg="' + esc(t.tick) + '">' +
      '<div class="tc-hero' + (t.banner ? ' has-ban' : '') + '"><div class="tch-bg' + (t.banner ? ' ban' : '') + '" aria-hidden="true">' + (t.banner ? '<img src="' + esc(t.banner) + '" alt="">' : avatarHTML(t, 240)) + '</div>' +
        '<div class="tc-age tch-age ' + fr.cls + '"><span class="ag-dot"></span><span class="ag-lab">' + fr.lab + '</span><b class="mono" data-t="' + t.born + '">' + ago(t.born) + '</b>' + (done ? '<span class="ag-grad">GRADUATED</span>' : '') + '</div>' +
        '<div class="tch-av">' + avatarHTML(t, 150) + '</div>' + '' + (opts.preview ? '' : '<button class="tch-star' + (on ? ' on' : '') + '" data-act="star" data-arg="' + esc(t.tick) + '" aria-label="Add to watchlist" aria-pressed="' + on + '">' + I.star(on) + '</button>') +
        '<div class="tch-side">' + (trapLeft(t) > 0 ? trapBox(t, 'card') : '<div class="tax" style="background:' + taxBg(tmax) + '" data-tip="' + esc(splitTip(t)) + '"><small>TAX</small><b>' + tmax + '%</b>' + (splitOf(t) ? splitBar(splitOf(t), 'mini') : '') + '</div>') +
        (tmax > 0 || (t.live && t.qMint) ? '<div class="pairmini" data-tip="Paired with ' + esc(pairInfo(t.pair).name) + '">' + coinHTML(t.pair, 28) + '<small>PAIR</small><b>' + esc(pairLabel(t.pair)) + '</b></div>' : '<div class="pairmini plain" data-tip="0% tax — plain coin, no pair">' + coinHTML('SOL', 28) + '<small>PLAIN</small><b>SOL</b></div>') + '</div></div>' +
      '<div class="tc-name2"><b>' + esc(t.name) + crBadge(t) + '</b><span class="tc-tkr"><span class="mono">$' + esc(t.tick) + '</span>' + (opts.preview ? '' : '<button class="tc-ca mono" data-act="ca" data-arg="' + esc(t.tick) + '" data-tip="Copy contract address" aria-label="Copy contract address">' + esc(short(t.ca)) + I.copy + '</button>') + '</span></div>' +
      riskTiles(t) + socialsHTML(t) +
      '<div class="tc-mid"><div class="tc-mc"><div class="v"><span data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</span>' +
        '<span class="chgpill ' + (c >= 0 ? 'up' : 'down') + '" data-chg="' + esc(t.tick) + '">' + chgTxt(c) + '</span></div><div class="l">market cap · ' + fmtNum(t.holders) + ' holders · vol ' + fmtK(t.vol) + '</div></div></div>' +
      '<div class="tc-chart ' + (c >= 0 ? 'up' : 'down') + '" data-cchart="' + esc(t.tick) + '">' + cardChart(t) + '</div>' +
      '<div class="prog"><div class="l"><span>' + (done ? 'On Meteora' : 'Bonding curve') + '</span><span class="mono" data-prog="' + esc(t.tick) + '">' + Math.min(100, t.prog).toFixed(0) + '%</span></div>' +
        '<div class="bar"><i class="' + (done ? 'done' : '') + '" data-bar="' + esc(t.tick) + '" style="width:' + Math.max(1, Math.min(100, t.prog)) + '%"></i></div></div>' +

      '</article>';
  }

  function skeletonCard() {
    return '<div class="tcard"><div class="tc-top"><div class="sk" style="width:58px;height:58px;border-radius:99px"></div><div style="flex:1;display:flex;flex-direction:column;gap:8px"><div class="sk" style="height:14px;width:70%"></div><div class="sk" style="height:11px;width:40%"></div></div></div>' +
      '<div class="sk" style="height:26px;width:55%"></div><div class="sk" style="height:20px"></div><div class="sk" style="height:7px"></div><div class="sk" style="height:44px"></div></div>';
  }

  function filtered() {
    var list = all().filter(function (d) {
      var t = Math.max(d.buy, d.sell);
      if (S.sort === 'graduated' && d.prog < 100) return false;
      if (S.sort === 'grad' && d.prog >= 100) return false;
      if (t < rv('tax')[0] || t > rv('tax')[1]) return false;
      if (S.zeroOnly && t !== 0) return false;
      if (S.gradOnly && d.prog < 100) return false;
      if (S.rewardsOnly && !d.rewards) return false;
      if (S.watchOnly && S.watch.indexOf(d.tick) === -1) return false;
      if (S.cleanOnly && riskMetrics(d).some(function (m) { return m.lv === 'r'; })) return false;
      var mcr = rv('mc'), pr = rv('prog'), ag = rv('age'), am = (Date.now() - d.born) / 60000;
      if (d.prog < pr[0] || d.prog > pr[1] || d.mcN < mcr[0] || d.mcN > mcr[1] || am < ag[0] || am > ag[1]) return false;
      if (S.cat !== 'all' && (DEMO ? pairInfo(d.pair).cat : liveCat(d)) !== S.cat) return false;
      if (S.pair !== 'All' && d.pair !== S.pair && pairLabel(d.pair) !== S.pair) return false;
      return true;
    });
    var sorters = {
      bump: function (a, b) { return (b._lt || 0) - (a._lt || 0); },
      graduated: function (a, b) { return b.mcN - a.mcN; },
      trending: function (a, b) { return chg(b) - chg(a); },
      newest: function (a, b) { return b.born - a.born; },
      mcap: function (a, b) { return b.mcN - a.mcN; },
      lowtax: function (a, b) { return Math.max(a.buy, a.sell) - Math.max(b.buy, b.sell) || b.mcN - a.mcN; },
      grad: function (a, b) { return (b.prog >= 100 ? -1 : b.prog) - (a.prog >= 100 ? -1 : a.prog); }
    };
    return list.sort(sorters[S.sort]);
  }

  function heroChart(t, w, h, idp) {
    var d = t.hist, mx = Math.max.apply(null, d), mn = Math.min.apply(null, d), sp = (mx - mn) || 1;
    var pts = d.map(function (v, i) { return (i * w / (d.length - 1)).toFixed(1) + ' ' + (h - 8 - (v - mn) / sp * (h - 30)).toFixed(1); });
    var line = 'M' + pts.join(' L');
    return { line: line, area: line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z' };
  }

  S.feedF = 'all';
  function feedOk(tr) { if (S.feedF === 'whale') return tr.sol >= 2; if (S.feedF === 'follow') return S.trackWallets.indexOf(tr.wallet) !== -1 || S.watch.indexOf(tr.tick) !== -1 || tr.mine; return true; }
  function feedList() { var l = S.trades.filter(feedOk).slice(0, 6); return l.length ? l.map(function (t) { return feedRow(t); }).join('') : '<div class="muted" style="padding:16px 8px;font-size:13px;line-height:1.5">' + (S.feedF === 'follow' ? 'Nothing yet. Star coins or track wallets to follow them here.' : S.feedF === 'whale' ? 'No whale trades yet.' : 'No trades yet.') + '</div>'; }
  function feedRow(tr, enter) {
    var t = find(tr.tick); if (!t) return '';
    var w = Math.min(100, tr.sol / 5 * 100), buy = tr.side === 'buy', whale = tr.sol >= 3;
    return '<button class="feed-row' + (enter ? ' enter' : '') + (buy ? ' b' : ' s') + '" data-act="open" data-arg="' + esc(t.tick) + '" style="--w:' + w.toFixed(0) + '%">' + avatarHTML(t, 32) +
      '<span class="fr-main"><b>$' + esc(t.tick) + '</b>' + (whale ? '<span class="whale">WHALE</span>' : '') + '<span class="fr-sub">' + (tr.mine ? 'You' : esc(short(tr.wallet))) + ' · <span data-t="' + tr.t + '">' + ago(tr.t) + '</span></span></span>' +
      '<span class="fr-amt"><span class="' + (buy ? 'up' : 'down') + '">' + (buy ? 'BUY' : 'SELL') + '</span><b class="mono">' + tr.sol.toFixed(2) + ' SOL</b></span></button>';
  }

  // ---------- hero carousel + visual stats ----------
  var HERO = BASE.slice().sort(function (a, b) { return b.mcN - a.mcN; }).slice(0, 5).map(function (t) { return t.tick; });
  S.heroIdx = 0;
  var VB = [], TB = [];
  for (var vi = 0; vi < 16; vi++) { VB.push(rnd(8, 30)); TB.push(Math.round(rnd(2, 9))); }
  function pressure(tick) {
    var b = 0, sl = 0, n = 0;
    for (var i = 0; i < S.trades.length && n < 40; i++) { var x = S.trades[i]; if (x.tick !== tick) continue; n++; if (x.side === 'buy') b += x.sol; else sl += x.sol; }
    return (b + sl) ? b / (b + sl) * 100 : 50;
  }
  function heroSlide(t, rank) {
    var c = chg(t), tmax = Math.max(t.buy, t.sell), ch = heroChart(t, 1000, 220), pr = pressure(t.tick), id = esc(t.tick);
    return '<div class="hslide" data-hero="' + id + '">' +
      '<svg class="feat-chart" viewBox="0 0 1000 220" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="hg' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8E8EA" stop-opacity=".22"/><stop offset="1" stop-color="#E8E8EA" stop-opacity="0"/></linearGradient></defs>' +
        '<path data-ha="' + id + '" d="' + ch.area + '" fill="url(#hg' + id + ')"/><path data-hl="' + id + '" d="' + ch.line + '" fill="none" stroke="#E8E8EA" stroke-opacity=".3" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
        '<path data-hl="' + id + '" class="flow" d="' + ch.line + '" fill="none" stroke="#E8E8EA" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>' +
      '<div class="hs-left">' +
        '<span class="kicker"><span class="livedot"></span><span class="rank">#' + (rank + 1) + '</span> TOP MEME</span>' +
        '<div class="title-xl hs-title">' + esc(t.name) + ' <span class="tk">$' + id + '</span></div>' +
        '<div class="hs-pills"><span class="pill" style="padding-left:11px">' + fmtNum(t.holders) + ' holders</span>' +
          '<button class="pill copy2" data-act="ca" data-arg="' + id + '">' + esc(short(t.ca)) + ' ' + I.copy + '</button>' + (t.rewards ? '<span class="pill i">' + I.gift + ' Rewards</span>' : '') + (t.burn ? '<span class="pill i">' + I.flame + ' Burn</span>' : '') + '</div>' +
        '<div class="hs-stats"><div class="tax" style="background:' + taxBg(tmax) + ';padding:9px 14px"><small>TAX</small><b style="font-size:26px">' + tmax + '%</b></div>' +
          '<div class="pairbig" data-act="pairOpen" data-arg="' + esc(t.pair) + '">' + coinHTML(t.pair, 46) + '<div><small>PAIRED WITH</small><b>' + esc(pairLabel(t.pair)) + '</b><span>' + esc(pairInfo(t.pair).name) + '</span></div></div>' +
          '<div class="stat"><div class="l">Market cap</div><div class="v" data-mc="' + id + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</div></div>' +
          '<div class="stat"><div class="l">24h</div><div class="v ' + (c >= 0 ? 'up' : 'down') + '" data-chg2="' + id + '">' + chgTxt(c) + '</div></div>' +
          '</div>' +
        '<div class="press"><div class="press-l"><span class="up">Buys</span><span class="muted">Buy pressure · last 40 trades</span><span class="down">Sells</span></div>' +
          '<div class="press-bar"><i data-press="' + id + '" style="width:' + pr.toFixed(0) + '%"></i><span class="press-knob" data-pressk="' + id + '" style="left:' + pr.toFixed(0) + '%"></span></div>' +
          '<div class="press-l mono"><span class="up" data-presst="' + id + '">' + pr.toFixed(0) + '%</span><span class="down" data-pressts="' + id + '">' + (100 - pr).toFixed(0) + '%</span></div></div>' +
        '<div class="feat-actions"><button class="btn pri" data-act="open" data-arg="' + id + '">Trade $' + id + '</button><button class="btn sec" data-act="create">Launch your own</button></div>' +
      '</div>' +
      '<div class="hs-right"><div class="hs-mascot" data-parallax>' +
        '<span class="glow" style="background:' + t.spec.skin + '"></span>' +
        '<span class="orbit"><span class="orb">' + coinHTML(t.pair, 46) + '</span></span><span class="orbit o2"><span class="orb small">' + I.gem + '</span></span>' +
        '<span class="spark s1"></span><span class="spark s2"></span><span class="spark s3"></span>' +
        '<span class="hs-av">' + avatarHTML(t, 200) + '</span></div></div>' +
    '</div>';
  }
  // ================= RACE TO RAYDIUM (all coins climbing the hill) =================
  var RACE_OFF = {}, RPOS = {};
  var LG0 = Math.log10(5e5), LG1 = Math.log10(1e8), SPLIT = 0.56;
  function gameF(t) { return Math.max(0, Math.min(1, (Math.log10(t.mcN * 1000) - LG0) / (LG1 - LG0))); }
  function trackPt(u) { return { x: 5 + u * 89, y: 84 - Math.pow(u, 1.3) * 62 }; }
  function coinU(t) { return t.prog < 100 ? SPLIT * Math.max(0, Math.min(1, t.prog / 100)) : SPLIT + (1 - SPLIT) * gameF(t); }
  function mcU(usd) { return SPLIT + (1 - SPLIT) * Math.max(0, Math.min(1, (Math.log10(usd) - LG0) / (LG1 - LG0))); }
  function raceSize(t) { return t.prog >= 100 ? Math.max(32, Math.min(46, 28 + Math.sqrt(t.mcN) * 0.08)) : 32; }
  function trackPath(close) {
    var d = '', i; for (i = 0; i <= 80; i++) { var p = trackPt(i / 80); d += (i ? ' L' : 'M') + p.x.toFixed(2) + ',' + p.y.toFixed(2); }
    return close ? d + ' L94,100 L5,100 Z' : d;
  }
  // ----- race zoom / pan -----
  var RZ = { z: 1, x: 0, y: 0, preset: 'all' };
  var ZP = [['all', 'All', 0, 1, 0, 1], ['start', 'Fresh launches', 0, .22, .55, 1], ['p1', 'Bonding curve', 0, .6, .3, 1], ['near', 'Near graduation', .3, .62, .25, .85], ['p2', 'Open market', .5, 1, 0, .7]];
  function zoomStyle() { return 'transform:translate(' + RZ.x.toFixed(1) + 'px,' + RZ.y.toFixed(1) + 'px) scale(' + RZ.z.toFixed(3) + ');--z:' + RZ.z.toFixed(3); }
  function zoomBar() {
    return '<div class="zoombar"><button class="zb" data-act="rz" data-arg="out" aria-label="Zoom out">−</button><span class="zb-v mono" id="zb-v">' + Math.round(RZ.z * 100) + '%</span><button class="zb" data-act="rz" data-arg="in" aria-label="Zoom in">+</button>' +
      '<span class="zb-sep"></span>' + ZP.map(function (p) { return '<button class="zp' + (RZ.preset === p[0] ? ' on' : '') + '" data-act="rzp" data-arg="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>';
  }
  function stageWH() { var st = document.getElementById('race-stage'); return st ? { w: st.clientWidth, h: st.clientHeight, el: st } : null; }
  function zClamp() {
    var d = stageWH(); if (!d) return;
    RZ.z = Math.max(1, Math.min(8, RZ.z));
    RZ.x = Math.min(0, Math.max(d.w - d.w * RZ.z, RZ.x)); RZ.y = Math.min(0, Math.max(d.h - d.h * RZ.z, RZ.y));
  }
  function zApply(anim) {
    zClamp();
    var el = document.getElementById('race-zoom'); if (!el) return;
    el.style.transition = anim ? 'transform .45s cubic-bezier(.2,.8,.2,1)' : 'none';
    el.style.transform = 'translate(' + RZ.x + 'px,' + RZ.y + 'px) scale(' + RZ.z + ')'; el.style.setProperty('--z', RZ.z);
    var v = document.getElementById('zb-v'); if (v) v.textContent = Math.round(RZ.z * 100) + '%';
    document.querySelectorAll('.zp').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-arg') === RZ.preset); });
    var st = document.getElementById('race-stage'); if (st) st.classList.toggle('zoomed', RZ.z > 1.01);
    clearTimeout(zApply._t); zApply._t = setTimeout(raceLayout, 90);
  }
  function zoomAt(px, py, factor, anim) {
    var nz = Math.max(1, Math.min(8, RZ.z * factor));
    RZ.x = px - (px - RZ.x) * (nz / RZ.z); RZ.y = py - (py - RZ.y) * (nz / RZ.z); RZ.z = nz; RZ.preset = nz <= 1.01 ? 'all' : null; zApply(anim);
  }
  function zoomPreset(id) {
    var p = ZP.filter(function (x) { return x[0] === id; })[0], d = stageWH(); if (!p || !d) return;
    var z = Math.min(1 / (p[3] - p[2]), 1 / (p[5] - p[4]));
    RZ.z = z; RZ.x = d.w / 2 - (p[2] + p[3]) / 2 * d.w * z; RZ.y = d.h / 2 - (p[4] + p[5]) / 2 * d.h * z; RZ.preset = id; zApply(true);
  }
  document.addEventListener('wheel', function (e) {
    var st = e.target.closest && e.target.closest('#race-stage'); if (!st || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); var r = st.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.18 : 1 / 1.18, false);
  }, { passive: false });
  document.addEventListener('dblclick', function (e) {
    var st = e.target.closest && e.target.closest('#race-stage'); if (!st || e.target.closest('.zoombar')) return;
    var r = st.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 2, true);
  });
  var rp = null, pinch = null;
  document.addEventListener('pointerdown', function (e) {
    var st = e.target.closest && e.target.closest('#race-stage'); if (!st || e.target.closest('.zoombar') || RZ.z <= 1.01 || e.pointerType === 'touch') return;
    rp = { x: e.clientX, y: e.clientY, ox: RZ.x, oy: RZ.y, moved: false };
  });
  document.addEventListener('pointermove', function (e) {
    if (!rp) return; var dx = e.clientX - rp.x, dy = e.clientY - rp.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { rp.moved = true; var st = document.getElementById('race-stage'); if (st) st.classList.add('panning'); }
    if (rp.moved) { RZ.x = rp.ox + dx; RZ.y = rp.oy + dy; RZ.preset = null; zApply(false); }
  });
  document.addEventListener('pointerup', function () {
    if (!rp) return; if (rp.moved) { suppressClick = true; setTimeout(function () { suppressClick = false; }, 60); }
    rp = null; var st = document.getElementById('race-stage'); if (st) st.classList.remove('panning');
  });
  document.addEventListener('touchstart', function (e) {
    var st = e.target.closest && e.target.closest('#race-stage'); if (!st) return;
    var r = st.getBoundingClientRect();
    if (e.touches.length === 2) { var a = e.touches[0], b = e.touches[1]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx: (a.clientX + b.clientX) / 2 - r.left, cy: (a.clientY + b.clientY) / 2 - r.top, z: RZ.z, x: RZ.x, y: RZ.y }; }
    else if (e.touches.length === 1 && RZ.z > 1.01) { pinch = { pan: true, sx: e.touches[0].clientX, sy: e.touches[0].clientY, x: RZ.x, y: RZ.y }; }
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!pinch) return;
    if (pinch.pan && e.touches.length === 1) { RZ.x = pinch.x + e.touches[0].clientX - pinch.sx; RZ.y = pinch.y + e.touches[0].clientY - pinch.sy; RZ.preset = null; zApply(false); e.preventDefault(); return; }
    if (e.touches.length === 2 && !pinch.pan) {
      var a = e.touches[0], b = e.touches[1], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), nz = Math.max(1, Math.min(8, pinch.z * d / pinch.d));
      RZ.x = pinch.cx - (pinch.cx - pinch.x) * (nz / pinch.z); RZ.y = pinch.cy - (pinch.cy - pinch.y) * (nz / pinch.z); RZ.z = nz; RZ.preset = null; zApply(false); e.preventDefault();
    }
  }, { passive: false });
  document.addEventListener('touchend', function () { pinch = null; });
  window.addEventListener('resize', function () { zApply(false); });

  function raceLayout() {
    var st = document.getElementById('race-stage'), box = document.getElementById('race-b'), cbox = document.getElementById('race-c'); if (!st || !box) return;
    var W = st.clientWidth * RZ.z, H = st.clientHeight * RZ.z, list = all().map(function (t) { var u = coinU(t), p = trackPt(u); return { t: t, u: u, x: p.x, y: p.y, X: p.x * W / 100, sz: raceSize(t) }; }).sort(function (a, b) { return b.u - a.u; });
    var rows = [[], [], []], over = [];
    list.forEach(function (c) {
      var placed = false;
      for (var r = 0; r < 3 && !placed; r++) {
        var ok = rows[r].every(function (o) { return Math.abs(o.X - c.X) >= (o.sz + c.sz) / 2 + 4; });
        if (ok) { rows[r].push(c); c.row = r; placed = true; }
      }
      if (!placed) over.push(c);
    });
    list.forEach(function (c) {
      var el = box.querySelector('.rb[data-race="' + c.t.tick + '"]'); if (!el) return;
      if (c.row == null) { el.style.visibility = 'hidden'; return; }
      el.style.visibility = '';
      var dy = c.row * (c.sz + 18) / H * 100;
      RPOS[c.t.tick] = { x: c.x, y: c.y - dy };
      el.style.left = c.x.toFixed(2) + '%'; el.style.top = (c.y - dy - 1.2).toFixed(2) + '%';
      el.classList.toggle('stacked', c.row > 0);
    });
    // overflow chips: group by proximity
    var groups = [];
    over.sort(function (a, b) { return a.X - b.X; }).forEach(function (c) { var g = groups[groups.length - 1]; if (g && c.X - g.x1 < 60) { g.items.push(c); g.x1 = c.X; } else groups.push({ items: [c], x0: c.X, x1: c.X }); });
    if (cbox) cbox.innerHTML = groups.map(function (g) {
      var u = g.items.reduce(function (s2, c) { return s2 + c.u; }, 0) / g.items.length, p = trackPt(u), dy = 3 * 50 / H * 100;
      return '<button class="rchip" data-act="rzat" data-arg="' + p.x.toFixed(2) + '|' + p.y.toFixed(2) + '" style="left:' + p.x.toFixed(2) + '%;top:' + (p.y - dy - 1.2).toFixed(2) + '%" data-tip="' + esc(g.items.map(function (c) { return '$' + c.t.tick; }).join(', ')) + ' — click to zoom">' +
        g.items.slice(0, 2).map(function (c) { return avatarHTML(c.t, 22); }).join('') + '<b>+' + g.items.length + ' more</b></button>';
    }).join('');
  }
  // ===== WATCHLIST PAGE =====
  function watchPage() {
    var list = S.watch.map(find).filter(Boolean);
    var head = '<div class="wl-head"><button class="link" data-act="home">' + I.back + ' Board</button><h1 class="wl-h"><span class="wl-star">' + I.star(true) + '</span>Watchlist <span class="mono">' + list.length + '</span></h1>' +
      (list.length ? '<button class="btn sec wl-clear' + (S.wlConfirm ? ' sure' : '') + '" data-act="wlClear">' + (S.wlConfirm ? 'Tap again to clear all' : 'Clear all') + '</button>' : '') + '</div>';
    if (!list.length) {
      var sug = all().slice().sort(function (a, b) { return chg(b) - chg(a); }).slice(0, 4);
      return '<main class="wrap wl">' + head + '<div class="wl-empty"><div class="wl-big">' + I.star(false) + '</div><b>Nothing saved yet</b><span class="muted">Tap the ☆ on any coin and it lands here. Remove it anytime with one click.</span>' +
        '<div class="wl-sug">' + sug.map(function (t) { return '<div class="wl-sc">' + avatarHTML(t, 40) + '<span><b>' + esc(t.name) + '</b><small class="mono">$' + esc(t.tick) + ' · ' + fmtK(t.mcN) + '</small></span><button class="btn sec" data-act="star" data-arg="' + esc(t.tick) + '">☆ Add</button></div>'; }).join('') + '</div>' +
        '<button class="btn pri" data-act="home">Browse coins</button></div></main>';
    }
    return '<main class="wrap wl">' + head + '<div class="wl-list"><div class="wl-cols"><span>Coin</span><span>Paired with</span><span>Tax</span><span class="r">Market cap</span><span class="r">24h</span><span>Chart</span><span>Curve</span><span></span></div>' +
      list.map(function (t, i) { var c = chg(t), tm = Math.max(t.buy, t.sell), id = esc(t.tick), up = c >= 0;
        return '<div class="wl-row" data-wl="' + id + '" data-act="open" data-arg="' + id + '" style="--i:' + i + '">' +
          '<button class="wl-coin" data-act="open" data-arg="' + id + '">' + avatarHTML(t, 42) + '<span><b>' + esc(t.name) + '</b><small class="mono">$' + id + ' · <span data-t="' + t.born + '">' + ago(t.born) + '</span></small></span></button>' +
          '<span class="wl-pair">' + coinHTML(t.pair, 24) + '<b>' + esc(pairLabel(t.pair)) + '</b></span>' +
          '<span class="tax wl-tax" style="background:' + taxBg(tm) + '"><b>' + tm + '%</b></span>' +
          '<span class="r mono wl-mc" data-mc="' + id + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</span>' +
          '<span class="r mono ' + (up ? 'up' : 'down') + '" data-chg="' + id + '">' + chgTxt(c) + '</span>' +
          '<svg class="wl-spark" viewBox="0 0 110 40" preserveAspectRatio="none"><polyline points="' + spark(t) + '" fill="none" stroke="' + (up ? '#3DDC97' : '#F2708A') + '" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>' +
          '<span class="wl-prog">' + (t.prog >= 100 ? '<em>Graduated</em>' : '<i><u style="width:' + t.prog.toFixed(0) + '%"></u></i><small class="mono">' + t.prog.toFixed(0) + '%</small>') + '</span>' +
          '<span class="wl-act"><button class="btn sec" data-act="open" data-arg="' + id + '">Trade</button><button class="wl-x" data-act="unstar" data-arg="' + id + '" aria-label="Remove $' + id + ' from watchlist" data-tip="Remove">✕</button></span></div>';
      }).join('') + '</div></main>';
  }
  // ===== VERTICAL TOWER RACE: both races side by side, coins climb up, drag sideways for more =====
  S.raceTab = 'curve'; S.raceAll = true; S.raceSort = 'pos';
  function twF(t, kind) { return kind === 'curve' ? Math.max(0, Math.min(1, t.prog / 100)) : gameF(t); }
  function twVal(t, kind) { return kind === 'curve' ? Math.min(100, t.prog).toFixed(0) + '%' : fmtK(t.mcN); }
  function twList(kind) {
    var l = all().filter(function (t) { return kind === 'curve' ? t.prog < 100 : t.prog >= 100; });
    var srt = { pos: function (x, y) { return twF(y, kind) - twF(x, kind); }, mc: function (x, y) { return y.mcN - x.mcN; }, new: function (x, y) { return y.born - x.born; }, old: function (x, y) { return x.born - y.born; }, chg: function (x, y) { return chg(y) - chg(x); } }[S.raceSort];
    return l.sort(srt);
  }
  function raceList() { return twList(S.raceTab); }
  function twLead(kind) { var l = all().filter(function (t) { return kind === 'curve' ? t.prog < 100 : t.prog >= 100; }), b = null; l.forEach(function (t) { if (!b || twF(t, kind) > twF(b, kind)) b = t; }); return b; }
  function twColHTML(t, kind, lead) {
    var f = twF(t, kind) * 100, fresh = (Date.now() - t.born) < 300000, id = esc(t.tick), c = chg(t);
    var sz = Math.max(.78, Math.min(1.35, .7 + (Math.log10(Math.max(1, t.mcN)) - 1) * .2)), bob = (hash(t.tick) % 30) / 10;
    return '<div class="tw-col' + (lead ? ' lead' : '') + '" data-tw="' + id + '" style="--s:' + sz.toFixed(2) + ';--bob:-' + bob.toFixed(1) + 's">' +
      '<div class="tw-lane"><span class="tw-trail" style="height:' + f.toFixed(2) + '%"></span>' +
        '<button class="tw-run" data-act="open" data-arg="' + id + '" style="bottom:' + f.toFixed(2) + '%" data-tip="$' + id + ' · ' + fmtK(t.mcN) + ' · paired ' + esc(pairLabel(t.pair)) + ' · tax ' + Math.max(t.buy, t.sell) + '%">' +
          '<span class="tw-val mono">' + twVal(t, kind) + '</span>' + avatarHTML(t, 32) + (lead ? '<i class="tw-crown">♛</i>' : '') + '</button></div>' +
      '<button class="tw-lab" data-act="open" data-arg="' + id + '"><b>' + coinHTML(t.pair, 12) + '$' + id + '</b><em class="mono ' + (c >= 0 ? 'up' : 'down') + '">' + chgTxt(c) + '</em>' + (fresh ? '<i class="tw-new">NEW</i>' : '') + '</button></div>';
  }
  function twPanel(kind) {
    var isC = kind === 'curve', l = twList(kind), ld = twLead(kind);
    var ticks = isC ? [['25%', 25], ['50%', 50], ['75%', 75]] : [['$1M', 1e6], ['$10M', 1e7], ['$50M', 5e7]].map(function (m) { return [m[0], (mcU(m[1]) - SPLIT) / (1 - SPLIT) * 100]; });
    return '<div class="tw-panel ' + kind + '"><div class="tw-ph"><div><b>' + (isC ? 'Race to Meteora' : 'Race to the Moon') + '</b><span class="mono">' + l.length + '</span></div><small>' + (isC ? 'bonding curve %' : 'market cap') + '</small></div>' +
      '<div class="tw-stage"><div class="tw-grid">' + ticks.map(function (k) { return '<i style="bottom:' + k[1].toFixed(1) + '%"><u>' + k[0] + '</u></i>'; }).join('') +
        '<span class="tw-fin"><u>' + (isC ? 'Meteora' : 'The Moon · $100M') + '</u></span></div>' + (isC ? '' : '<span class="tw-moonorb"></span>') +
        '<div class="tw-scroll drag-scroll" id="tw-' + kind + '"><div class="tw-row">' + l.map(function (t) { return twColHTML(t, kind, ld && t.tick === ld.tick); }).join('') + '</div></div></div></div>';
  }
  // ===== THE MEME LAB: a bubbling flask (Cooking) piped into an open sky (Sent) =====
  function labR(t) { return Math.round(Math.max(17, Math.min(31, 13 + (Math.log10(Math.max(1, t.mcN)) - 1) * 5.2))); }
  function labBubble(t) {
    var r = labR(t), id = esc(t.tick), cook = t.prog < 100, c = chg(t);
    return '<button class="lb ' + (cook ? 'cook' : 'sent') + '" data-lb="' + id + '" data-act="open" data-arg="' + id + '" style="--r:' + r + 'px">' +
      avatarHTML(t, r * 2) + '<span class="lb-tag"><b>$' + id + '</b><em class="mono">' + (cook ? Math.min(99, Math.floor(t.prog)) + '%' : fmtK(t.mcN)) + '</em></span>' +
      '<span class="lb-card"><b>' + esc(t.name) + '</b><span>' + coinHTML(t.pair, 14) + esc(pairLabel(t.pair)) + ' · tax ' + Math.max(t.buy, t.sell) + '%</span><span class="mono">' + fmtK(t.mcN) + ' <i class="' + (c >= 0 ? 'up' : 'down') + '">' + chgTxt(c) + '</i></span></span></button>';
  }
  try { S.viz = localStorage.getItem('dl.viz') || 'orbit'; } catch (e) { S.viz = 'orbit'; }
  function ascentStage(a, cook, sent) {
    var alt = [['$1M', 1e6], ['$10M', 1e7], ['$50M', 5e7]].map(function (x) { return '<i data-f="' + ((mcU(x[1]) - SPLIT) / (1 - SPLIT)).toFixed(3) + '" data-z="s"><u>' + x[0] + '</u></i>'; }).join('') +
      [25, 50, 75].map(function (v) { return '<i data-f="' + (v / 100) + '" data-z="c"><u>' + v + '%</u></i>'; }).join('');
    return '<div class="lab-stage asc-stage" id="lab" data-mode="ascent"><canvas class="asc-cv" id="asc-cv"></canvas>' +
        '<div class="asc-zone z-sent"><span class="az-l">Sent <b class="mono" id="az-s">' + sent.length + '</b><small>graduated · market cap</small></span><span class="az-top mono">$100M</span></div>' +
        '<div class="asc-line"><span>graduation</span></div>' +
        '<div class="asc-zone z-cook"><span class="az-l">Cooking <b class="mono" id="az-c">' + cook.length + '</b><small>bonding curve</small></span></div>' +
        '<div class="asc-grid">' + alt + '</div>' +
        '<div class="lab-nodes" id="lab-nodes">' + a.map(labBubble).join('') + '</div><div class="asc-fx" id="asc-fx"></div></div>';
  }
  function orbitStage(a, cook, sent) {
    return '<div class="lab-stage orb-stage" id="lab" data-mode="orbit"><canvas class="asc-cv" id="asc-cv"></canvas>' +
      '<div class="orb-core pl" id="orb-core"><span class="oc-glow"></span><span class="pl-ring back"></span><span class="pl-body"><span class="pl-surf"></span><span class="pl-spots"></span><span class="pl-shade"></span></span><span class="pl-ring front"></span><span class="pl-moon"><i></i></span><div class="oc-idle"><b>treid</b><small class="mono"><span id="az-c">' + cook.length + '</span> cooking · <span id="az-s">' + sent.length + '</span> sent</small></div><div class="oc-live" id="oc-live"></div></div>' +
      '<div class="orb-banner" id="orb-banner"></div>' +
      '<div class="orb-labels" id="orb-labels"></div>' +
      '<div class="lab-nodes" id="lab-nodes">' + a.map(labBubble).join('') + '</div><div class="asc-fx" id="asc-fx"></div>' +
      '<div class="orb-hint mono">drag to spin · tap a coin to trade</div></div>';
  }
  function raceSection() {
    var a = all(), cook = a.filter(function (t) { return t.prog < 100; }), sent = a.filter(function (t) { return t.prog >= 100; }), orb = S.viz === 'orbit';
    return '<section class="race card-s lab asc' + (orb ? ' orbv' : '') + '" id="race"><div class="lab-head"><div><h2 class="title-xl lab-title">' + (orb ? 'The Orbit' : 'The Ascent') + '</h2>' +
      '<p class="muted lab-sub">' + (orb ? 'New coins circle the core while they cook — the further out, the closer to graduating. Cross the gold ring and they break out into the open market.' : 'Buys lift a coin, sells sink it. Fill the bonding curve to break through the line — then it\'s a race to $100M.') + '</p></div>' +
      '<div class="lab-right"><div class="seg sm viz-seg"><button class="' + (orb ? 'on' : '') + '" data-act="viz" data-arg="orbit">Orbit</button><button class="' + (!orb ? 'on' : '') + '" data-act="viz" data-arg="ascent">Ascent</button></div>' +
      '<div class="asc-key"><span><i class="k-up"></i>buy</span><span><i class="k-dn"></i>sell</span><span><i class="k-sz"></i>size = market cap</span></div></div></div>' +
      (orb ? orbitStage(a, cook, sent) : ascentStage(a, cook, sent)) + '</section>';
  }
  var LAB = { pos: {}, stage: null, raf: 0, hist: {} };
  var ASC_SPLIT = .52;
  function ascGeom(st) { var r = st.getBoundingClientRect(); return { w: r.width, h: r.height, top: 34, bot: r.height - 30, line: 34 + (r.height - 64) * (1 - ASC_SPLIT) }; }
  function ascY(G, t) {
    if (t.prog < 100) { var f = Math.max(0, Math.min(1, t.prog / 100)); return G.bot - f * (G.bot - G.line - 16); }
    var g = gameF(t); return G.line - 16 - g * (G.line - 16 - G.top);
  }
  function ascGridPos(st, G) {
    st.querySelectorAll('.asc-grid i').forEach(function (e) { var f = +e.getAttribute('data-f'), y = e.getAttribute('data-z') === 'c' ? G.bot - f * (G.bot - G.line - 16) : G.line - 16 - f * (G.line - 16 - G.top); e.style.top = y + 'px'; });
    var ln = st.querySelector('.asc-line'); if (ln) ln.style.top = G.line + 'px';
    var zs = st.querySelector('.z-sent'), zc = st.querySelector('.z-cook'); if (zs) zs.style.height = G.line + 'px'; if (zc) { zc.style.top = G.line + 'px'; zc.style.height = (G.h - G.line) + 'px'; }
    var cv = st.querySelector('#asc-cv'), dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = G.w * dpr; cv.height = G.h * dpr; cv.style.width = G.w + 'px'; cv.style.height = G.h + 'px'; LAB.ctx = cv.getContext('2d'); LAB.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // ---------- ORBIT ----------
  var ORB = { rot: 0, vrot: 0, slow: 1, slowT: 1, drag: null, flash: 0 };
  var OU0 = .17, OU1 = .62, OU2 = .96;
  function orbU(t) { return t.prog < 100 ? OU0 + Math.max(0, Math.min(1, t.prog / 100)) * (OU1 - OU0 - .02) : OU1 + .03 + gameF(t) * (OU2 - OU1 - .03); }
  function orbGeom(st) {
    var r = st.getBoundingClientRect(), w = r.width, h = r.height, ry = h * .5 - 26, rx = Math.min(w * .5 - 30, ry * 2.35);
    if (w < 760) { rx = w * .5 - 12; ry = Math.min(h * .5 - 28, rx * 1.1); }
    return { w: w, h: h, cx: w / 2, cy: h / 2 + 4, rx: rx, ry: ry, k: Math.max(.5, Math.min(1, w / 1250)) };
  }
  function orbRings() {
    var R = [[OU0 + .25 * (OU1 - OU0 - .02), '25%'], [OU0 + .5 * (OU1 - OU0 - .02), '50%'], [OU0 + .75 * (OU1 - OU0 - .02), '75%'], [OU1, 'GRADUATION', 'g']];
    [['$1M', 1e6], ['$10M', 1e7], ['$100M', 1e8]].forEach(function (m) { R.push([OU1 + .03 + ((mcU(m[1]) - SPLIT) / (1 - SPLIT)) * (OU2 - OU1 - .03), m[0], 's']); });
    return R;
  }
  function orbSetup(st, G) {
    var cv = st.querySelector('#asc-cv'), dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = G.w * dpr; cv.height = G.h * dpr; cv.style.width = G.w + 'px'; cv.style.height = G.h + 'px'; LAB.ctx = cv.getContext('2d'); LAB.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var lb = st.querySelector('#orb-labels'); if (lb) lb.innerHTML = orbRings().map(function (r) { return (r[2] === 'g' ? '<span class="ol g" style="left:' + G.cx + 'px;top:' + (G.cy - G.ry * r[0] - 1) + 'px">' + r[1] + '</span>' : '<span class="ol ' + (r[2] || '') + '" style="left:' + (G.cx + G.rx * r[0] * Math.cos(-.22)) + 'px;top:' + (G.cy + G.ry * r[0] * Math.sin(-.22) - 8) + 'px">' + r[1] + '</span>'); }).join('');
    var core = st.querySelector('#orb-core'); if (core) { var cw = G.rx * OU0 * 2 * .82, chh = G.ry * OU0 * 2 * .82; var pd = Math.min(cw * .78, chh * 1.55); core.style.width = pd + 'px'; core.style.height = pd + 'px'; core.style.left = (G.cx - pd / 2) + 'px'; core.style.top = (G.cy - pd / 2) + 'px'; }
  }
  function orbLoop(now, st) {
    if (st !== LAB.stage || LAB.dirty) { LAB.stage = st; LAB.G = orbGeom(st); orbSetup(st, LAB.G); LAB.dirty = false; LAB.last = now; }
    var G = LAB.G, ctx = LAB.ctx, dt = Math.min(50, now - (LAB.last || now)); LAB.last = now;
    ORB.slow += (ORB.slowT - ORB.slow) * .06;
    if (!ORB.drag) { ORB.rot += ORB.vrot; ORB.vrot *= .95; }
    ctx.clearRect(0, 0, G.w, G.h);
    // rings
    var fl = Math.max(0, 1 - (now - ORB.flash) / 1200);
    orbRings().forEach(function (r) {
      var g = r[2] === 'g';
      ctx.beginPath(); ctx.ellipse(G.cx, G.cy, G.rx * r[0], G.ry * r[0], 0, 0, 6.283);
      ctx.strokeStyle = g ? 'rgba(243,229,200,' + (.55 + fl * .45) + ')' : r[2] === 's' ? 'rgba(243,229,200,.10)' : 'rgba(255,255,255,.07)';
      ctx.lineWidth = g ? 1.6 + fl * 3 : 1; ctx.setLineDash(g || r[2] === 's' ? [] : [3, 6]); ctx.stroke();
      if (g) { ctx.strokeStyle = 'rgba(243,229,200,' + (.08 + fl * .25) + ')'; ctx.lineWidth = 10 + fl * 18; ctx.stroke(); }
    });
    ctx.setLineDash([]);
    // graduation ring travelling glint
    var ga = (now / 2600) % 6.283; ctx.beginPath(); ctx.ellipse(G.cx, G.cy, G.rx * OU1, G.ry * OU1, 0, ga, ga + .5); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2.5; ctx.stroke();
    var els = st.querySelectorAll('.lb'), NN = [];
    if (!ORB.hotT || now - ORB.hotT > 1000) { ORB.hotT = now; var hot = all().filter(function (t) { return t.prog < 100; }).sort(function (a, b) { return b.prog - a.prog; }).slice(0, 3).map(function (t) { return t.tick; });
      for (var hh = 0; hh < els.length; hh++) els[hh].classList.toggle('hot', hot.indexOf(els[hh].getAttribute('data-lb')) !== -1); }
    for (var a1 = 0; a1 < els.length; a1++) { var tk1 = els[a1].getAttribute('data-lb'), p1 = LAB.pos[tk1]; if (p1 && p1.a != null) NN.push({ p: p1, r: labR(find(tk1) || BASE[0]) }); }
    for (var a2 = 0; a2 < NN.length; a2++) for (var b2 = a2 + 1; b2 < NN.length; b2++) {
      var A = NN[a2], B = NN[b2], dx = B.p.x - A.p.x, dy = B.p.y - A.p.y, d = Math.sqrt(dx * dx + dy * dy), mn = (A.r + B.r) * G.k + 14;
      if (d < mn && Math.abs(A.p.u - B.p.u) < .09) { var df = Math.atan2(Math.sin(B.p.a - A.p.a), Math.cos(B.p.a - A.p.a)), k = .012 * (mn - d) / mn, sg = df >= 0 ? 1 : -1; A.p.a -= k * sg; B.p.a += k * sg; }
    }
    for (var i = 0; i < els.length; i++) {
      var el = els[i], tk = el.getAttribute('data-lb'), t = find(tk); if (!t) continue;
      var zone = t.prog < 100 ? 'c' : 's', tu = orbU(t), r0 = labR(t), p = LAB.pos[tk];
      if (!p || p.a == null) { var h = hash(tk); p = LAB.pos[tk] = { a: (h % 6283) / 1000, u: tu * .4, vu: 0, zone: zone, x: G.cx, y: G.cy }; }
      if (p.zone !== zone) { var was = p.zone; p.zone = zone; ORB.flash = now; ascBurst(p.x, p.y, '#F3E5C8', 36); if (was === 'c') orbBanner(t); }
      p.vu += (tu - p.u) * .03; p.vu *= .86; p.u += p.vu;
      var T = 16000 * Math.pow(Math.max(.15, p.u) / .3, 1.5); p.a += dt * 6.283 / T * ORB.slow;
      var ang = p.a + ORB.rot, depth = Math.sin(ang), sc = (.74 + .32 * (depth + 1) / 2) * G.k;
      p.x = G.cx + Math.cos(ang) * G.rx * p.u; p.y = G.cy + Math.sin(ang) * G.ry * p.u;
      el.style.transform = 'translate(' + (p.x - r0).toFixed(1) + 'px,' + (p.y - r0).toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
      el.style.zIndex = Math.round(200 + depth * 100); el.style.opacity = (.55 + .45 * (depth + 1) / 2).toFixed(2);
      var hs = LAB.hist[tk] || (LAB.hist[tk] = []); hs.push([p.x, p.y, p.vu]); if (hs.length > 34) hs.shift();
      if (hs.length > 2) {
        var kick = hs.reduce(function (m, q) { return Math.abs(q[2]) > Math.abs(m) ? q[2] : m; }, 0), col = kick > .004 ? '61,220,151' : kick < -.004 ? '242,112,138' : zone === 's' ? '243,229,200' : '237,233,225', base = (Math.abs(kick) > .004 ? .55 : .18) * (.6 + .4 * (depth + 1) / 2);
        for (var j = 1; j < hs.length; j++) { var al = (j / hs.length) * base; ctx.strokeStyle = 'rgba(' + col + ',' + al.toFixed(3) + ')'; ctx.lineWidth = (j / hs.length) * r0 * sc * .7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(hs[j - 1][0], hs[j - 1][1]); ctx.lineTo(hs[j][0], hs[j][1]); ctx.stroke(); }
      }
    }
    LAB.parts = (LAB.parts || []).filter(function (q) { q.life -= 1; return q.life > 0; });
    LAB.parts.forEach(function (q) { q.x += q.vx; q.y += q.vy; q.vy += .02; q.vx *= .97; ctx.fillStyle = q.c; ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.beginPath(); ctx.arc(q.x, q.y, q.s, 0, 6.283); ctx.fill(); });
    ctx.globalAlpha = 1;
  }
  document.addEventListener('pointerdown', function (e) {
    var st = e.target.closest && e.target.closest('.orb-stage'); if (!st || e.target.closest('.lb') || e.button > 0) return;
    ORB.drag = { x: e.clientX, last: e.clientX, t: performance.now() }; st.classList.add('spinning');
  });
  document.addEventListener('pointermove', function (e) { if (!ORB.drag) return; var dx = e.clientX - ORB.drag.last; ORB.drag.last = e.clientX; ORB.rot += dx * .006; ORB.vrot = dx * .006; });
  document.addEventListener('pointerup', function () { if (!ORB.drag) return; ORB.drag = null; var st = document.querySelector('.orb-stage'); if (st) st.classList.remove('spinning'); });
  document.addEventListener('mouseover', function (e) { ORB.slowT = e.target.closest && e.target.closest('.orb-stage .lb') ? .15 : e.target.closest && e.target.closest('.orb-stage') ? .55 : 1; });
  function labLoop(now) {
    var st = document.getElementById('lab'); if (!st) { LAB.raf = 0; LAB.stage = null; return; }
    if (st.getAttribute('data-mode') === 'orbit') { orbLoop(now, st); LAB.raf = requestAnimationFrame(labLoop); return; }
    if (st !== LAB.stage || LAB.dirty) { LAB.stage = st; LAB.G = ascGeom(st); ascGridPos(st, LAB.G); LAB.dirty = false; }
    var G = LAB.G, ctx = LAB.ctx, els = st.querySelectorAll('.lb'), nodes = [], slots = {};
    ['c', 's'].forEach(function (z) { var l = all().filter(function (t) { return (t.prog < 100) === (z === 'c'); }).sort(function (a, b) { return (hash(a.tick) % 997) - (hash(b.tick) % 997); }); l.forEach(function (t, i) { slots[t.tick] = (i + .5) / l.length; }); });
    for (var i = 0; i < els.length; i++) {
      var el = els[i], tk = el.getAttribute('data-lb'), t = find(tk); if (!t) continue;
      var r = labR(t), h = hash(tk), zone = t.prog < 100 ? 'c' : 's';
      var tx = 60 + (slots[tk] != null ? slots[tk] : .5) * (G.w - 120) + Math.sin(now / 2600 + h) * 10, ty = ascY(G, t);
      var p = LAB.pos[tk];
      if (!p || p.a != null) p = LAB.pos[tk] = { x: tx, y: G.bot + 40, vx: 0, vy: 0, zone: zone };
      if (p.zone !== zone) { p.zone = zone; ascBurst(p.x, p.y, '#F3E5C8', 26); }
      p.vx += (tx - p.x) * .008; p.vy += (ty - p.y) * .02; nodes.push({ el: el, p: p, r: r, t: t, tk: tk });
    }
    for (var a = 0; a < nodes.length; a++) for (var b = a + 1; b < nodes.length; b++) {
      var A = nodes[a], B = nodes[b], dx = B.p.x - A.p.x, dy = (B.p.y - A.p.y) / 1.5, d = Math.sqrt(dx * dx + dy * dy) || .01, min = A.r + B.r + 12;
      if (d < min) { var k = (min - d) / d * .05; A.p.vx -= dx * k; B.p.vx += dx * k; A.p.vy -= dy * k * .5; B.p.vy += dy * k * .5; }
    }
    ctx.clearRect(0, 0, G.w, G.h);
    nodes.forEach(function (n) {
      var p = n.p; p.vx *= .9; p.vy *= .88; p.x += p.vx; p.y += p.vy;
      p.x = Math.max(n.r + 6, Math.min(G.w - n.r - 6, p.x)); p.y = Math.max(G.top + n.r * .3, Math.min(G.bot + 6, p.y));
      n.el.style.transform = 'translate(' + (p.x - n.r).toFixed(1) + 'px,' + (p.y - n.r).toFixed(1) + 'px)';
      var hs = LAB.hist[n.tk] || (LAB.hist[n.tk] = []); hs.push([p.x, p.y]); if (hs.length > 46) hs.shift();
      if (hs.length > 3) {
        var mv = hs[hs.length - 1][1] - hs[0][1], col = mv < -3 ? '61,220,151' : mv > 3 ? '242,112,138' : '237,233,225', base = Math.min(1, Math.abs(mv) / 30) * .55 + .06;
        for (var j = 1; j < hs.length; j++) { var al = (j / hs.length) * base; ctx.strokeStyle = 'rgba(' + col + ',' + al.toFixed(3) + ')'; ctx.lineWidth = (j / hs.length) * n.r * .9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(hs[j - 1][0], hs[j - 1][1]); ctx.lineTo(hs[j][0], hs[j][1]); ctx.stroke(); }
      }
      var gl = ctx.createRadialGradient(p.x, p.y, n.r * .6, p.x, p.y, n.r * 2.4); gl.addColorStop(0, n.t.prog >= 100 ? 'rgba(243,229,200,.10)' : 'rgba(237,233,225,.05)'); gl.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p.x, p.y, n.r * 2.4, 0, 6.283); ctx.fill();
    });
    LAB.parts = (LAB.parts || []).filter(function (q) { q.life -= 1; return q.life > 0; });
    LAB.parts.forEach(function (q) { q.x += q.vx; q.y += q.vy; q.vy += .03; q.vx *= .97; ctx.fillStyle = q.c; ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.beginPath(); ctx.arc(q.x, q.y, q.s, 0, 6.283); ctx.fill(); });
    ctx.globalAlpha = 1;
    LAB.raf = requestAnimationFrame(labLoop);
  }
  function ascBurst(x, y, c, n) { LAB.parts = LAB.parts || []; for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, v = 1 + Math.random() * 3; LAB.parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, s: 1 + Math.random() * 2, c: c, life: 40 + Math.random() * 30, max: 70 }); } }
  function ascPop(t, side, sol) {
    var p = LAB.pos[t.tick], fx = document.getElementById('asc-fx'); if (!p || !fx) return;
    var up = side === 'buy', r = labR(t);
    ascBurst(p.x, p.y + (up ? r : -r), up ? '#3DDC97' : '#F2708A', 8);
    var e = document.createElement('span'); e.className = 'asc-num ' + (up ? 'up' : 'dn');
    e.textContent = (up ? '+' : '−') + (sol >= 10 ? sol.toFixed(0) : sol.toFixed(2)) + ' SOL'; e.style.left = p.x + 'px'; e.style.top = (p.y - r - 6) + 'px';
    if (sol >= 5) e.classList.add('big');
    fx.appendChild(e); setTimeout(function () { e.remove(); }, 1500);
    if (p.a != null) { if (sol >= 1.5 || Math.random() < .35) orbCore(t, up, sol); p.vu += (up ? 1 : -1) * Math.min(.05, .012 + sol * .004); ORB.coreHit = performance.now(); var core = document.getElementById('orb-core'); if (core) { core.classList.remove('hit', 'hitd'); void core.offsetWidth; core.classList.add(up ? 'hit' : 'hitd'); } }
    else p.vy += up ? -Math.min(14, 3 + sol) : Math.min(12, 2 + sol);
  }
  function orbBanner(t) {
    var b = document.getElementById('orb-banner'); if (!b) return;
    b.innerHTML = avatarHTML(t, 30) + '<span><b>$' + esc(t.tick) + '</b> just graduated</span><em class="mono">' + fmtK(t.mcN) + '</em>';
    b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
  }
  function orbCore(t, up, sol) {
    var c = document.getElementById('oc-live'), core = document.getElementById('orb-core'); if (!c || !core) return;
    c.innerHTML = avatarHTML(t, 34) + '<b class="mono ' + (up ? 'up' : 'down') + '">' + (up ? '+' : '−') + (sol >= 10 ? sol.toFixed(0) : sol.toFixed(2)) + '</b><small>$' + esc(t.tick) + '</small>';
    core.classList.add('showing'); clearTimeout(orbCore._t); orbCore._t = setTimeout(function () { core.classList.remove('showing'); }, 1600);
  }
  function labKick() { if (!LAB.raf && document.getElementById('lab')) LAB.raf = requestAnimationFrame(labLoop); }
  window.addEventListener('resize', function () { LAB.dirty = true; });
  var raceT2 = 0;
  function raceRefresh() {
    var box = document.getElementById('lab-nodes'); if (!box) return;
    var have = {}; box.querySelectorAll('.lb').forEach(function (el) { have[el.getAttribute('data-lb')] = el; });
    (box.closest('.orb-inline') ? filtered() : all()).forEach(function (t) {
      var el = have[t.tick], cook = t.prog < 100;
      if (!el) { box.insertAdjacentHTML('beforeend', labBubble(t)); el = box.lastElementChild; el.classList.add('pop'); }
      else if (el.classList.contains('cook') !== cook) { el.outerHTML = labBubble(t); el = box.querySelector('[data-lb="' + t.tick + '"]'); el.classList.add('pop', 'grad'); }
      else { var em = el.querySelector('.lb-tag em'); if (em) em.textContent = cook ? Math.min(99, Math.floor(t.prog)) + '%' : fmtK(t.mcN); }
      delete have[t.tick];
    });
    Object.keys(have).forEach(function (k) { have[k].remove(); });
    var c1 = document.getElementById('az-c'), c2 = document.getElementById('az-s'); if (c1) c1.textContent = all().filter(function (t) { return t.prog < 100; }).length; if (c2) c2.textContent = all().filter(function (t) { return t.prog >= 100; }).length;
  }
  function raceBubble(t) {
    var p = trackPt(coinU(t)), sz = raceSize(t), done = t.prog >= 100, lab = done ? fmtK(t.mcN) : Math.min(100, t.prog).toFixed(0) + '%';
    return '<button class="rb ' + (done ? 'done' : '') + '" data-race="' + esc(t.tick) + '" data-act="open" data-arg="' + esc(t.tick) + '" style="left:' + p.x.toFixed(2) + '%;top:' + p.y.toFixed(2) + '%;--sz:' + sz + 'px" data-tip="$' + esc(t.tick) + ' · ' + (done ? 'graduated · ' : Math.min(100, t.prog).toFixed(0) + '% of curve · ') + fmtK(t.mcN) + '">' +
      avatarHTML(t, Math.round(sz)) + '<span class="rb-pct mono">' + lab + '</span></button>';
  }
  function raceUpdate(t, side, sol) {
    var el = document.querySelector('.lb[data-lb="' + t.tick + '"]');
    if (el) { el.classList.remove('up-hit', 'down-hit'); void el.offsetWidth; el.classList.add(side === 'buy' ? 'up-hit' : 'down-hit'); }
    ascPop(t, side, sol || .5);
    if (Date.now() - raceT2 > 800) { raceT2 = Date.now(); raceRefresh(); } else { clearTimeout(raceUpdate._t); raceUpdate._t = setTimeout(function () { raceT2 = Date.now(); raceRefresh(); }, 820); }
  }


  function heroHTML() {
    var st = stats(), slides = HERO.map(function (tk, i) { return heroSlide(find(tk), i); }).join('');
    var avs = all().slice(0, 7).map(function (t, i) { return '<span style="--i:' + i + '">' + avatarHTML(t, 30) + '</span>'; }).join('');
    var gradPct = st.grad / st.tokens * 100, C = 2 * Math.PI * 26;
    return '<section class="hero">' +
      '<div class="card-s feat hero-car" id="hero-car">' +
        '<div class="hero-track" id="hero-track" style="transform:translateX(' + (-S.heroIdx * 100) + '%)">' + slides + '</div>' +
        '<div class="hero-nav"><button class="iconbtn" data-act="hero" data-arg="-1" aria-label="Previous">' + I.back + '</button>' +
          '<div class="dots">' + HERO.map(function (tk, i) { return '<button class="dotb' + (i === S.heroIdx ? ' on' : '') + '" data-act="heroGo" data-arg="' + i + '" aria-label="Show ' + esc(tk) + '"><i></i></button>'; }).join('') + '</div>' +
          '<button class="iconbtn" data-act="hero" data-arg="1" aria-label="Next" style="transform:scaleX(-1)">' + I.back + '</button></div>' +
      '</div>' +
      '<div class="side-stack"><div class="vstats" data-demo="1">' +
        '<div class="vtile"><div class="l">Tokens live</div><div class="v" data-count="' + st.tokens + '">' + st.tokens + '</div><div class="avstack">' + avs + '</div></div>' +
        '<div class="vtile"><div class="l">24h volume</div><div class="v" id="stat-vol">' + fmtK(st.vol) + '</div><div class="vbars" id="vbars">' + vbars() + '</div></div>' +
        '<div class="vtile"><div class="l"><span class="livedot"></span> Trades</div><div class="v" id="stat-trades">' + fmtNum(st.trades) + '</div><svg class="tline" viewBox="0 0 150 40" preserveAspectRatio="none" aria-hidden="true"><polyline id="tline" points="' + tline() + '" fill="none" stroke="#A3B1C2" stroke-width="2" stroke-linejoin="round"/></svg></div>' +
        '<div class="vtile ring-t"><div><div class="l">Graduated</div><div class="v" data-count="' + st.grad + '">' + st.grad + '</div><div class="muted" style="font-size:11.5px">to Meteora</div></div>' +
          '<svg class="ring2" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="#1E1E1F" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="url(#rg)" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (C * gradPct / 100).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 32 32)" class="ringarc"/><defs><linearGradient id="rg"><stop offset="0" stop-color="#E8E8EA"/><stop offset="1" stop-color="#A3B1C2"/></linearGradient></defs><g transform="translate(23 23) scale(.75)" fill="#E8E8EA"><path d="M6 3h12l4 6-10 12L2 9z"/></g></svg></div>' +
      '</div>' +
      '<div class="card-s feed"><div class="feed-h"><span class="livedot"></span>Live trades<div class="seg sm">' + [['all', 'All'], ['whale', 'Whales'], ['follow', 'Following']].map(function (f) { return '<button class="' + (S.feedF === f[0] ? 'on' : '') + '" data-act="feedf" data-arg="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="feed-list" id="feed">' + feedList() + '</div></div></div>' +
    '</section>';
  }
  function vbars() { var mx = Math.max.apply(null, VB); return VB.map(function (v, i) { return '<i style="height:' + Math.max(6, v / mx * 100).toFixed(0) + '%;--i:' + i + '"></i>'; }).join(''); }
  function tline() { var mx = Math.max.apply(null, TB) || 1; return TB.map(function (v, i) { return (i * 150 / (TB.length - 1)).toFixed(1) + ',' + (37 - v / mx * 32).toFixed(1); }).join(' '); }
  function updTiles() {
    var vb = document.getElementById('vbars'); if (vb) vb.innerHTML = vbars();
    var tl = document.getElementById('tline'); if (tl) tl.setAttribute('points', tline());
    var sv = document.getElementById('stat-vol'); if (sv) sv.textContent = fmtK(stats().vol);
  }
  if (DEMO) setInterval(function () { VB.shift(); VB.push(rnd(2, 6)); TB.shift(); TB.push(0); updTiles(); }, 4000);
  function heroGo(i) {
    S.heroIdx = (i + HERO.length) % HERO.length;
    var tr = document.getElementById('hero-track'); if (tr) { tr.style.transition = ''; tr.style.transform = 'translateX(' + (-S.heroIdx * 100) + '%)'; }
    document.querySelectorAll('.dotb').forEach(function (d, k) { d.classList.toggle('on', k === S.heroIdx); });
  }
  var heroHover = false;
  document.addEventListener('animationend', function (e) {
    if (e.animationName !== 'dotfill' || S.screen !== 'home' || hd) return;
    if (e.target.closest && e.target.closest('.dotb.on')) heroGo(S.heroIdx + 1);
  });
  // drag hero carousel
  var hd = null;
  document.addEventListener('pointerdown', function (e) {
    var car = e.target.closest && e.target.closest('#hero-track');
    if (!car || e.target.closest('button') || e.button !== 0) return;
    hd = { x: e.clientX, w: car.parentNode.clientWidth, dx: 0, tr: car };
    car.parentNode.classList.add('dragging');
    car.style.transition = 'none';
  });
  document.addEventListener('pointermove', function (e) {
    if (!hd) return;
    hd.dx = e.clientX - hd.x;
    hd.tr.style.transform = 'translateX(calc(' + (-S.heroIdx * 100) + '% + ' + hd.dx + 'px))';
  });
  document.addEventListener('pointerup', function () {
    if (!hd) return;
    var d = hd; hd = null; d.tr.style.transition = '';
    d.tr.parentNode.classList.remove('dragging');
    if (Math.abs(d.dx) > 6) { suppressClick = true; setTimeout(function () { suppressClick = false; }, 60); }
    if (d.dx < -60) heroGo(S.heroIdx + 1); else if (d.dx > 60) heroGo(S.heroIdx - 1); else heroGo(S.heroIdx);
  });
  document.addEventListener('mouseover', function (e) { heroHover = !!(e.target.closest && e.target.closest('#hero-car')); });
  // mascot parallax
  document.addEventListener('mousemove', function (e) {
    var car = e.target.closest && e.target.closest('#hero-car'); if (!car) return;
    var r = car.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    car.querySelectorAll('[data-parallax]').forEach(function (m) { m.style.transform = 'translate(' + (px * 26).toFixed(1) + 'px,' + (py * 20).toFixed(1) + 'px) rotate(' + (px * 6).toFixed(1) + 'deg)'; });
  });

  function stats() {
    var a = all(), vol = 0; a.forEach(function (t) { vol += t.vol; });
    return { tokens: a.length, vol: vol, trades: (S.seedN || 0) + S.tradeCount, grad: a.filter(function (t) { return t.prog >= 100; }).length };
  }

  var QUICK = [['all', 'All', null], ['SOL', 'SOL', 'SOL'], ['BTC', 'BTC', 'BTC'], ['memes', 'Memes', null], ['stocks', 'Stocks', null], ['GOLD', 'Gold', 'GOLD'], ['OIL', 'Oil', 'OIL'], ['crypto', 'Crypto', null], ['fx', 'Currencies', null]];
  function quickPairs() {
    return '<div class="qpairs drag-scroll"><span class="qp-l">PAIR WITH</span>' + QUICK.map(function (q) {
      var on = q[2] ? S.pair === q[2] : (S.cat === q[0] && S.pair === 'All');
      var ic = q[2] ? coinHTML(q[2], 22) : q[0] === 'memes' ? avatarHTML(BASE[0], 22) : q[0] === 'stocks' ? coinHTML('SPYx', 22) : q[0] === 'crypto' ? coinHTML('ETH', 22) : q[0] === 'fx' ? coinHTML('EUR', 22) : '<span class="qp-all">∞</span>';
      return '<button class="qp' + (on ? ' on' : '') + '" data-act="quick" data-arg="' + q[0] + '" aria-pressed="' + on + '">' + ic + '<span>' + q[1] + '</span></button>';
    }).join('') + '</div>';
  }
  function subPairs() {
    var a = all(), ids2 = [];
    a.forEach(function (t) { if (pairInfo(t.pair).cat === S.cat && ids2.indexOf(t.pair) === -1) ids2.push(t.pair); });
    return '<div class="chips drag-scroll" style="margin:-4px 0 14px">' + ['All'].concat(ids2).map(function (id) {
      var n = id === 'All' ? 0 : a.filter(function (t) { return t.pair === id; }).length;
      return '<button class="chip asset' + (S.pair === id ? ' on' : '') + '" data-act="pair" data-arg="' + esc(id) + '">' + (id === 'All' ? 'All' : coinHTML(id, 22) + '<span>' + esc(pairLabel(id)) + '</span><span class="cnt">' + n + '</span>') + '</button>';
    }).join('') + '</div>';
  }
  function pairSection() {
    var a = all();
    var tiles = CATS.map(function (c, ci) {
      var toks = a.filter(function (t) { return c[0] === 'all' || pairInfo(t.pair).cat === c[0]; });
      var ids = []; toks.forEach(function (t) { if (ids.indexOf(t.pair) === -1) ids.push(t.pair); });
      if (c[0] === 'all') ids = ['SOL', 'SPYx', 'GOLD', 'NFROG', 'EUR'].filter(function (x) { return x === 'NFROG' ? !!find(x) : true; });
      var avg = 0; toks.forEach(function (t) { avg += chg(t); }); avg = toks.length ? avg / toks.length : 0;
      var on = S.cat === c[0];
      return '<button class="cat' + (on ? ' on' : '') + '" style="--cc:' + c[3] + ';--d:' + (ci * 60) + 'ms" data-act="cat" data-arg="' + c[0] + '" aria-pressed="' + on + '">' +
        '<span class="cat-coins">' + ids.slice(0, 4).map(function (id, k) { return '<span class="cat-coin" style="--k:' + k + '">' + coinHTML(id, 38) + '</span>'; }).join('') + '</span>' +
        '<span class="cat-name">' + c[1] + '</span><span class="cat-sub">' + c[2] + '</span>' +
        '<span class="cat-foot"><span class="cat-avs">' + toks.slice(0, 4).map(function (t) { return avatarHTML(t, 22); }).join('') + '</span>' +
        '<span class="mono">' + toks.length + '</span><span class="mono ' + (avg >= 0 ? 'up' : 'down') + '">' + chgTxt(avg) + '</span></span></button>';
    }).join('');
    var sub = '';
    if (S.cat !== 'all') {
      var ids2 = [];
      a.forEach(function (t) { if (pairInfo(t.pair).cat === S.cat && ids2.indexOf(t.pair) === -1) ids2.push(t.pair); });
      sub = '<div class="chips drag-scroll" style="margin-top:12px">' + ['All'].concat(ids2).map(function (id) {
        var n = id === 'All' ? 0 : a.filter(function (t) { return t.pair === id; }).length;
        return '<button class="chip asset' + (S.pair === id ? ' on' : '') + '" aria-pressed="' + (S.pair === id) + '" data-act="pair" data-arg="' + esc(id) + '">' +
          (id === 'All' ? 'All ' + CATS.filter(function (c) { return c[0] === S.cat; })[0][1].toLowerCase() : coinHTML(id, 22) + '<span>' + esc(pairLabel(id)) + '</span><span class="cnt">' + n + '</span>') + '</button>';
      }).join('') + '</div>';
    }
    return '<div class="pair-head"><span class="kicker">PAIRED WITH</span><span class="muted" style="font-size:13px">Coins on treid trade against anything — drag to explore</span></div>' +
      '<div class="cats drag-scroll">' + tiles + '</div>' + sub + '<div style="height:18px"></div>';
  }

  function deckList() { return all().slice().sort(function (a, b) { return chg(b) - chg(a); }); }
  function deckCard(t, depth) {
    var c = chg(t), tmax = Math.max(t.buy, t.sell);
    return '<div class="swipe-card' + (depth === 0 ? ' top' : '') + '" data-swipe="' + esc(t.tick) + '" style="--depth:' + depth + '">' +
      '<span class="stamp like">WATCH</span><span class="stamp nope">SKIP</span><span class="stamp go">TRADE</span>' +
      '<div class="sc-av">' + avatarHTML(t, 112) + '</div>' +
      '<div class="sc-name">' + esc(t.name) + '</div><div class="mono muted" style="font-size:13px">$' + esc(t.tick) + ' · paired with ' + esc(pairLabel(t.pair)) + '</div>' +
      '<div class="sc-stats"><div><span class="muted">MC</span><b class="mono">' + fmtK(t.mcN) + '</b></div><div><span class="muted">24h</span><b class="mono ' + (c >= 0 ? 'up' : 'down') + '">' + chgTxt(c) + '</b></div>' +
      '<div class="tax" style="background:' + taxBg(tmax) + '"><small>TAX</small><b>' + tmax + '%</b></div></div>' +
      '<svg class="sc-spark" viewBox="0 0 110 40" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + spark(t) + '" fill="none" stroke="' + (c >= 0 ? '#3DDC97' : '#F2708A') + '" stroke-width="2.2" stroke-linejoin="round"/></svg></div>';
  }
  function deckHTML() {
    var l = deckList(), out = '';
    for (var d = 2; d >= 0; d--) { var t = l[(S.deckIdx + d) % l.length]; out += deckCard(t, d); }
    return out;
  }
  function swipeSection() {
    return '<section class="swipe-sec card-s">' +
      '<div class="swipe-copy"><span class="kicker">DIAMOND SWIPE</span><h2 class="title-xl" style="font-size:30px">Find your next gem.<br>Swipe it.</h2>' +
      '<p class="muted" style="line-height:1.6;max-width:380px">Drag a card <b style="color:var(--up)">right</b> to add it to your watchlist, <b style="color:var(--down)">left</b> to skip, or flick it <b style="color:var(--ice)">up</b> to trade. Works with mouse, touch or the buttons.</p>' +
      '<div class="swipe-btns"><button class="sbtn nope" data-act="swipe" data-arg="left" aria-label="Skip">✕</button><button class="sbtn go" data-act="swipe" data-arg="up" aria-label="Trade">↑</button><button class="sbtn like" data-act="swipe" data-arg="right" aria-label="Add to watchlist">' + I.star(false) + '</button></div>' +
      '<span class="mono muted" style="font-size:12px" id="swipe-count">' + S.watch.length + ' on your watchlist</span></div>' +
      '<div class="deck" id="deck">' + deckHTML() + '</div></section>';
  }

  var BUB = {};
  function bubR(t) { return Math.max(34, Math.min(104, 26 + Math.sqrt(t.mcN) * 2.3)); }
  // ===== DexScreener-style list =====
  S.lsort = 'rank'; S.ldir = -1;
  function liqK(t) { if (t.live && t.reserve != null) return t.reserve * qUsdT(t) / 1000; return t.prog >= 100 ? Math.max(85 * SOL_USD / 1000, t.mcN * .12) : t.prog / 100 * 85 * SOL_USD / 1000; }
  function chgOver(t, mins) { var tk = ensureTicks(t), at = Date.now() - mins * 60000; if (!tk.length || tk[0][0] >= at) { var ref0 = tk.length ? tk[0][1] : t.mcN; return ref0 ? (t.mcN / ref0 - 1) * 100 : 0; } var lo = 0, hi = tk.length - 1; while (lo < hi) { var md = (lo + hi + 1) >> 1; if (tk[md][0] <= at) lo = md; else hi = md - 1; } var ref = tk[lo][1]; return ref ? (t.mcN / ref - 1) * 100 : 0; }
  function lstats(t) { if (!t._ls || Date.now() - t._lsT > 4000) { var r = rng(hash(t.tick + 'ls')), v = t.vol * 1000; t._ls = { tx: Math.max(3, Math.round(v / (60 + r() * 140))), tr: 0 }; t._ls.tr = Math.max(1, Math.round(t._ls.tx * (.18 + r() * .25))); t._lsT = Date.now(); } return t._ls; }
  var LCOLS = [['rank', '#', ''], ['tok', 'Token', ''], ['tax', 'Tax', 'r'], ['mc', 'MCap', 'r'], ['price', 'Price', 'r'], ['age', 'Age', 'r'], ['tx', 'Txns', 'r hd1'], ['vol', 'Volume', 'r'], ['tr', 'Traders', 'r hd1'], ['c5', '5m', 'r hd2'], ['c1', '1h', 'r hd2'], ['c6', '6h', 'r hd1'], ['c24', '24h', 'r'], ['liq', 'Liquidity', 'r hd1'], ['curve', 'Curve', 'hd2']];
  function listHTML(list, keep) {
    var key = { rank: function (t) { return chgOver(t, 360) * Math.log10(t.vol * 1000 + 10); }, tax: function (t) { return Math.max(t.buy, t.sell); }, mc: function (t) { return t.mcN; }, price: function (t) { return t.mcN; }, age: function (t) { return t.born; }, near: function (t) { return t.prog < 100 ? t.prog : -1; }, tx: function (t) { return lstats(t).tx; }, vol: function (t) { return t.vol; }, tr: function (t) { return lstats(t).tr; }, c5: function (t) { return chgOver(t, 5); }, c1: function (t) { return chgOver(t, 60); }, c6: function (t) { return chgOver(t, 360); }, c24: function (t) { return chg(t); }, liq: function (t) { return t.prog; }, curve: function (t) { return t.prog; } };
    var k = key[S.lsort] || key.rank, rows = keep ? list.slice(0, 100) : list.slice().sort(function (a, b) { return (k(b) - k(a)) * (S.ldir === -1 ? 1 : -1); }).slice(0, 100);
    var pc = function (v) { return '<span class="' + (v >= 0 ? 'up' : 'down') + '">' + (Math.abs(v) >= 1000 ? (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en') + '%' : chgTxt(v)) + '</span>'; };
    var head = '<div class="lrow2 lhead">' + LCOLS.map(function (c) { return keep ? '<span class="' + c[2] + '">' + c[1] + '</span>' : '<button class="' + c[2] + (S.lsort === c[0] ? ' on' : '') + '" data-act="lsort" data-arg="' + c[0] + '">' + c[1] + (S.lsort === c[0] ? (S.ldir === -1 ? ' ↓' : ' ↑') : '') + '</button>'; }).join('') + '</div>';
    var body = rows.map(function (t, i) { var ls = lstats(t), tm = Math.max(t.buy, t.sell), rk = riskMetrics(t).some(function (m) { return m.lv === 'r'; }), liq = liqK(t);
      return '<div class="lrow2" data-act="open" data-arg="' + esc(t.tick) + '"><span class="lr-n mono">#' + (i + 1) + '</span>' +
        '<span class="lr-tok">' + avatarHTML(t, 28) + '<span class="lt-n"><b>' + esc(t.tick) + '</b><small>/ ' + esc(pairLabel(t.pair).replace('$', '')) + '</small><em>' + esc(t.name) + '</em>' + (rk ? '<i class="lt-flag" title="Risk flag">⚠</i>' : '') + (trapLeft(t) > 0 ? '<i class="lt-trap">🪤</i>' : '') + '</span></span>' +
        '<span class="r"><i class="lt-tax" style="background:' + taxBg(tm) + '">' + tm + '%</i></span>' +
        '<span class="r mono lt-mc" data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</span>' +
        '<span class="r mono">' + fmtPrice(price(t)) + '</span><span class="r mono" data-t="' + t.born + '">' + ago(t.born) + '</span>' +
        '<span class="r mono hd1">' + fmtNum(ls.tx) + '</span><span class="r mono">' + fmtK(t.vol) + '</span><span class="r mono hd1">' + fmtNum(ls.tr) + '</span>' +
        '<span class="r mono hd2">' + pc(chgOver(t, 5)) + '</span><span class="r mono hd2">' + pc(chgOver(t, 60)) + '</span><span class="r mono hd1">' + pc(chgOver(t, 360)) + '</span><span class="r mono">' + pc(chg(t)) + '</span>' +
        '<span class="r mono hd1">' + fmtK(liq) + '</span>' +
        '<span class="hd2 lt-cv">' + (t.prog >= 100 ? '<em>🎓 Meteora</em>' : '<i><u style="width:' + Math.min(100, t.prog).toFixed(0) + '%"></u></i><small class="mono">' + Math.min(100, t.prog).toFixed(0) + '%</small>') + '</span></div>'; }).join('');
    return '<section class="ltable"><div class="lt-scroll">' + head + body + '</div></section>';
  }
  // ===== THE BURNERY: leaderboard of coins that burned their own supply =====
  var BSRC = { dev: [DEMO ? 'Dev burn' : 'Dev & holder burns', '#F5B14C'], tax: [DEMO ? 'Tax buyback' : 'Tax burn', '#3DDC97'], frozen: [DEMO ? 'Frozen dev rewards' : 'Buyback & burn', '#B48CFF'] };
  function burnsLoad() { if (!API) return; apiGet('/api/treid').then(function (d) { S.treidFw = d && d.mint ? d : null; if (S.screen === 'burn') render(); }).catch(function () {}); apiGet('/api/burns').then(function (d) { S.burnData = d; S._burns = null; S._bnAgg = null; if (S.screen === 'burn') render(); }).catch(function () {}); }
  function burnLog() {
    if (S._burns && S._burnsN === all().length) return S._burns;
    var out = [];
    if (!DEMO) {   // real: events from on-chain receipts + verified user burns; per-coin totals from the mint supply
      var D = S.burnData || { coins: [], events: [] }, seen = {};
      D.events.forEach(function (e) { var t = S.live.filter(function (x) { return x.ca === e.mint; })[0]; if (!t) return; seen[e.mint] = seen[e.mint] || { tax: 0, frozen: 0, dev: 0 }; seen[e.mint][e.src] += e.tok;
        out.push({ t: t, tok: e.tok, pct: e.tok / 1e9 * 100, usd: e.tok * price(t), at: e.ts, src: e.src, who: e.wallet ? short(e.wallet) : 'auto', sig: e.sig, mine: !!(S.account && e.wallet === S.account) }); });
      D.coins.forEach(function (c) { var t = S.live.filter(function (x) { return x.ca === c.mint; })[0]; if (!t) return; var k = seen[c.mint] || { tax: 0, frozen: 0, dev: 0 }, rest = Math.max(0, c.burned - k.tax - k.frozen - k.dev);
        if (rest >= 1) out.push({ t: t, tok: rest, pct: rest / 1e9 * 100, usd: rest * price(t), at: 0, src: 'dev', who: 'auto', sig: null }); });   // burns we only see in the supply (older or made outside treid)
      out.sort(function (a, b) { return b.at - a.at; }); S._burns = out; S._burnsN = all().length; return out;
    }
    all().forEach(function (t) { var r = rng(hash(t.tick + 'burn2')); if (r() < .35) return; if (Date.now() - t.born < 3 * 36e5 && r() < .75) return;
      var heavy = r() < .25, n = 1 + Math.floor(r() * (heavy ? 7 : 3));
      for (var i = 0; i < n; i++) { var pct = +((heavy ? 1.2 : .08) + r() * r() * (heavy ? 9 : 2.4)).toFixed(3), tok = pct / 100 * 1e9, mc = t.mcN * (.35 + r() * .7), usd = tok * mc * 1000 / 1e9, at = Date.now() - 60000 - Math.min(Date.now() - t.born, 30 * 864e5) * r() * .98;
        var x = r(), src = (Math.max(t.buy, t.sell) > 0 && x < .55) ? 'tax' : 'dev';
        out.push({ t: t, tok: tok, pct: pct, usd: usd, at: at, src: src, who: src === 'tax' ? 'auto' : b58(4) + '…' + b58(4), sig: b58(64) }); } });
    all().forEach(function (t) { if (t.devPct != null) return; var d = devStatus(t); if (d.state !== 'out' && d.state !== 'cto' && d.state !== 'inactive') return; var r = rng(hash(t.tick + 'frz')), n = 1 + Math.floor(r() * 3), from = d.state === 'inactive' ? d.last + DR.inactive : d.outAt;
      for (var i = 0; i < n; i++) { var usd = Math.max(1, d.burned / n), mc = t.mcN, tok = usd / (mc * 1000 / 1e9), at = from + (Date.now() - from) * (.15 + r() * .8); if (at > Date.now() - 60000) continue; out.push({ t: t, tok: tok, pct: tok / 1e9 * 100, usd: usd, at: at, src: 'frozen', who: 'auto', sig: b58(64) }); } });
    (S.myBurns || []).forEach(function (b) { var t = find(b.tick); if (t) out.push({ t: t, tok: b.tok, pct: b.tok / 1e9 * 100, usd: b.usd, at: b.at, src: 'dev', who: b.who, sig: b.sig, mine: true }); });
    out.sort(function (a, b) { return b.at - a.at; }); S._burns = out; S._burnsN = all().length; return out;
  }
  S.bsort = 'pct';
  var BSI = { dev: '👤', tax: '🔄', frozen: '🧊' };
  function bhTubes(log) {
    var st = { dev: 0, tax: 0, frozen: 0 }, cn = { dev: {}, tax: {}, frozen: {} }, tot = 0; log.forEach(function (b) { st[b.src] += b.tok; cn[b.src][b.t.tick] = 1; tot += b.tok; }); BN.src = st;
    return '<div class="bh-side bh-src"><div class="bh-sh"><b>Who’s burning</b><small>share of all tokens burned</small></div><div class="bh-tubes">' + ['dev', 'tax', 'frozen'].map(function (k) { var sh = tot ? st[k] / tot * 100 : 0;
      return '<div class="bh-tube" data-tube="' + k + '" style="--c:' + BSRC[k][1] + '"><span class="bh-pct mono" data-tpct="' + k + '">' + sh.toFixed(0) + '%</span><div class="bh-glass"><div class="bh-liq" data-tliq="' + k + '" style="height:' + Math.max(8, sh).toFixed(1) + '%"><i class="bh-wv"></i><u></u><u></u><u></u></div><span class="bh-shine"></span></div><em>' + BSI[k] + '</em><b>' + (DEMO ? { dev: 'Devs', tax: 'Buybacks', frozen: 'Frozen' } : { dev: 'Devs & holders', tax: 'Tax burns', frozen: 'Buybacks' })[k] + '</b><small class="mono" data-ttok="' + k + '">' + fmtBig(st[k]) + '</small><small class="bh-cn">' + Object.keys(cn[k]).length + ' coins</small></div>'; }).join('') + '</div></div>';
  }
  function bhGauge(log, usd, ncoins) {
    var per = S.bhPer || '1h', W0 = { '1h': 36e5, '24h': 864e5, '7d': 6048e5, '30d': 2592e6 }[per], PL = { '1h': ['hour', '1h'], '24h': ['24 hours', '24h'], '7d': ['7 days', '7d'], '30d': ['30 days', '30d'] }[per];
    var now = Date.now(), hr = now - W0, h2 = now - 2 * W0, r1 = 0, u1 = 0, n1 = 0, c1 = {}, rp = 0;
    log.forEach(function (b) { if (b.at > h2 && b.at <= hr) rp += b.tok; if (b.at > hr) { r1 += b.tok; u1 += b.usd; n1++; c1[b.t.tick] = 1; } });
    var avg = Math.max(1, rp || r1); BN.h1 = { tok: r1, usd: u1, n: n1, coins: c1, avg: avg, rp: rp }; var rate = r1; BN.rate = rate; BN.lvl = Math.max(.08, Math.min(.95, .5 * rate / avg));
    var ticks = ''; for (var i = 0; i <= 10; i++) { var a = Math.PI * (1 - i / 10), x1 = 100 + Math.cos(a) * 66, y1 = 100 - Math.sin(a) * 66, x2 = 100 + Math.cos(a) * (i % 5 ? 72 : 76), y2 = 100 - Math.sin(a) * (i % 5 ? 72 : 76); ticks += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>'; }
    return '<div class="bh-side bh-gauge"><div class="bh-sh bh-shr"><div><b>Burn rate</b><small>tokens destroyed in the last ' + PL[0] + '</small></div><div class="bh-per">' + ['1h', '24h', '7d', '30d'].map(function (x) { return '<button class="' + (per === x ? 'on' : '') + '" data-act="bhPer" data-arg="' + x + '">' + x.toUpperCase() + '</button>'; }).join('') + '</div></div>' +
      '<div class="bh-dial"><svg viewBox="0 0 200 116"><defs><linearGradient id="bhg" x1="0" x2="1"><stop offset="0" stop-color="#3DDC97"/><stop offset=".5" stop-color="#FFD15C"/><stop offset="1" stop-color="#FF4D2E"/></linearGradient></defs><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="14" stroke-linecap="round"/><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="url(#bhg)" stroke-width="14" stroke-linecap="round" opacity=".9"/><g class="bh-ticks">' + ticks + '</g>' +
      '<g class="bh-needle" id="bh-needle" style="transform:rotate(' + (-90 + BN.lvl * 180) + 'deg)"><path d="M97 100 L100 28 L103 100Z" fill="#FFF1D6"/></g><circle cx="100" cy="100" r="8" fill="#1b130e" stroke="#FFD15C" stroke-width="2.5"/></svg>' +
      '<div class="bh-dv"><b class="mono"><span id="bh-rate">' + fmtBig(rate) + '</span><em>/ ' + PL[1] + '</em></b><span class="bh-hot" id="bh-hot">' + (BN.lvl > .8 ? '🔥 ON FIRE' : BN.lvl > .5 ? '🔥 HOT' : '♨ WARM') + '</span><small class="bh-avg">' + (!rp ? 'no earlier data to compare' : (rate >= avg ? '▲ +' : '▼ −') + Math.min(999, Math.abs(Math.round((rate / avg - 1) * 100))) + '% vs previous ' + PL[0]) + '</small></div></div>' +
      '<div class="bh-mini"><div><small>Value · ' + PL[1] + '</small><b class="mono" id="bh-u1">$' + fmtNum(Math.round(u1)) + '</b></div><div><small>Burns · ' + PL[1] + '</small><b class="mono" id="bh-n1">' + n1 + '</b></div><div><small>Coins · ' + PL[1] + '</small><b class="mono" id="bh-c1">' + Object.keys(c1).length + '</b></div></div></div>';
  }
  function bhKick(b, anim) {
    if (anim) { var tb0 = document.querySelector('[data-tube="' + b.src + '"]'); if (tb0) { tb0.classList.remove('kick'); void tb0.offsetWidth; tb0.classList.add('kick'); } var nd0 = document.getElementById('bh-needle'); if (nd0) { var cur = nd0.style.transform; nd0.style.transform = cur.replace(/rotate\(([-\d.]+)deg\)/, function (m0, d0) { return 'rotate(' + Math.min(90, +d0 + 12) + 'deg)'; }); setTimeout(function () { nd0.style.transform = cur; }, 380); } return; }
    var k = b.src, st = BN.src || {}; st[k] = (st[k] || 0) + b.tok; var tot = (st.dev || 0) + (st.tax || 0) + (st.frozen || 0);
    ['dev', 'tax', 'frozen'].forEach(function (q) { var sh = tot ? st[q] / tot * 100 : 0, l = document.querySelector('[data-tliq="' + q + '"]'), pc = document.querySelector('[data-tpct="' + q + '"]'); if (l) l.style.height = Math.max(8, sh).toFixed(1) + '%'; if (pc) pc.textContent = sh.toFixed(0) + '%'; });
    var tt = document.querySelector('[data-ttok="' + k + '"]'); if (tt) tt.textContent = fmtBig(st[k]);
    var tb = document.querySelector('[data-tube="' + k + '"]'); if (tb) { tb.classList.remove('kick'); void tb.offsetWidth; tb.classList.add('kick'); var pp = document.createElement('span'); pp.className = 'bh-tpop mono'; pp.textContent = '+' + fmtBig(b.tok); tb.appendChild(pp); setTimeout(function () { pp.remove(); }, 1400); }
    var H1 = BN.h1 || { tok: 0, usd: 0, n: 0, coins: {}, avg: 1 }; H1.tok += b.tok; H1.usd += b.usd; H1.n++; H1.coins[b.t.tick] = 1; BN.h1 = H1; BN.rate = H1.tok;
    var rt = document.getElementById('bh-rate'); if (rt) rt.textContent = fmtBig(H1.tok);
    var u1 = document.getElementById('bh-u1'), n1 = document.getElementById('bh-n1'), c1 = document.getElementById('bh-c1'); if (u1) u1.textContent = '$' + fmtNum(Math.round(H1.usd)); if (n1) n1.textContent = H1.n; if (c1) c1.textContent = Object.keys(H1.coins).length;
    var av = document.querySelector('.bh-avg'); if (av && H1.rp) av.textContent = (H1.tok >= H1.avg ? '▲ +' : '▼ −') + Math.min(999, Math.abs(Math.round((H1.tok / H1.avg - 1) * 100))) + '% vs previous ' + ({ '1h': 'hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days' })[S.bhPer || '1h'];
    var nd = document.getElementById('bh-needle'), lv = Math.max(.08, Math.min(.95, .5 * H1.tok / H1.avg)); if (nd) { nd.style.transform = 'rotate(' + (-90 + Math.min(.99, lv + .14) * 180) + 'deg)'; setTimeout(function () { nd.style.transform = 'rotate(' + (-90 + lv * 180) + 'deg)'; }, 380); }
    var hot = document.getElementById('bh-hot'); if (hot) { hot.textContent = lv > .8 ? '🔥 ON FIRE' : lv > .5 ? '🔥 HOT' : '♨ WARM'; hot.classList.remove('pulse'); void hot.offsetWidth; hot.classList.add('pulse'); }
  }
  function burnPage() {
    if (!DEMO && !S.burnData && !S._bl) { S._bl = 1; setTimeout(burnsLoad, 0); }
    var log = burnLog(), by = {}, totUsd = 0, totTok = 0;
    log.forEach(function (b) { totUsd += b.usd; totTok += b.tok; var e = by[b.t.tick] = by[b.t.tick] || { t: b.t, tok: 0, pct: 0, usd: 0, n: 0, last: 0, src: {} }; e.tok += b.tok; e.pct += b.pct; e.usd += b.usd; e.n++; e.last = Math.max(e.last, b.at); e.src[b.src] = (e.src[b.src] || 0) + b.pct; });
    var key = { pct: function (e) { return e.pct; }, usd: function (e) { return e.usd; }, n: function (e) { return e.n; }, last: function (e) { return e.last; } }[S.bsort] || function (e) { return e.pct; };
    var coins = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return key(b) - key(a); });
    var byPct = coins.slice().sort(function (a, b) { return b.pct - a.pct; });
    var mx = byPct.length ? byPct[0].pct : 1;
    var srcBar = function (e) { return ['dev', 'tax', 'frozen'].filter(function (k) { return e.src[k]; }).map(function (k) { return '<i style="width:' + (e.src[k] / mx * 100).toFixed(2) + '%;background:' + BSRC[k][1] + '"></i>'; }).join(''); };
    var podium = byPct.slice(0, 3), order = [1, 0, 2];
    var pod = '<div class="bn-pod">' + order.filter(function (i) { return podium[i]; }).map(function (i) { var e = podium[i]; return '<button class="bn-p bn-p' + (i + 1) + '" data-act="open" data-arg="' + esc(e.t.tick) + '"><span class="bn-pr">' + ['🥇', '🥈', '🥉'][i] + '</span>' + avatarHTML(e.t, i ? 48 : 62) + '<b>$' + esc(e.t.tick) + '</b><strong class="mono">' + e.pct.toFixed(2) + '%</strong><small>supply burned</small></button>'; }).join('') + '</div>';
    var stats = [['Supply destroyed', totTok >= 1e9 ? (totTok / 1e9).toFixed(2) + 'B' : fmtNum(Math.round(totTok)), 'tokens, all coins'], ['Value burned', '$' + fmtNum(Math.round(totUsd)), 'at time of burn'], ['Coins burning', coins.length, 'of ' + all().length + ' launched'], ['Last burn', log.length ? ago(log[0].at) + ' ago' : '—', log.length ? '$' + esc(log[0].t.tick) + ' · ' + BSRC[log[0].src][0] : '']];
    var sorts = [['pct', '% supply'], ['usd', 'Value'], ['n', 'Burns'], ['last', 'Recent']];
    S._bnAgg = by; BN.tot = totTok; S._bnRank = {}; byPct.forEach(function (e, i) { S._bnRank[e.t.tick] = i + 1; });
    var stat = function (x) { return '<div class="bh-st"><small>' + x[0] + '</small><b class="mono">' + x[1] + '</b><span>' + x[2] + '</span></div>'; };
    return '<main class="wrap burn"><section class="bh"><div class="bh-top"><span class="kicker">BURN LEADERBOARD</span><h1 class="bn-h">The Burnery</h1><button class="btn pri bh-cta" data-act="burnOpen">🔥 Burn your tokens</button><p>Every coin on treid can <b>burn its own supply</b> — the dev burns their bag, or the coin’s <b>tax buys back and burns</b> automatically. Gone forever. Less supply, higher rank.</p></div>' +
      '<div class="bh-stage">' + bhTubes(log) +
      '<div class="bn-fire" id="bn-fire"><canvas id="bn-cv"></canvas><div class="bn-pit"></div><div class="bh-count"><small>SUPPLY DESTROYED</small><b class="mono" id="bh-count">' + (totTok >= 1e9 ? (totTok / 1e9).toFixed(3) + 'B' : fmtNum(Math.round(totTok))) + '</b></div><div class="bn-fly" id="bn-fly"></div><div class="bn-now" id="bn-now"></div></div>' +
      bhGauge(log, totUsd, coins.length) + '</div></section>' + pod +
      (S.treidFw ? '<section class="card-s tfw"><div class="tfw-h"><span class="tfw-f">🔥</span><div><b>$TREID flywheel</b><small class="muted">' + Math.round(S.treidFw.pct * 100) + '% of treid’s fees buy back $TREID on the open market and burn it — automatically, on-chain</small></div></div><div class="tfw-g"><div><small>$TREID burned</small><b class="mono">' + fmtNum(S.treidFw.burned) + '</b></div><div><small>Of supply</small><b class="mono up">' + S.treidFw.burnedPct.toFixed(3) + '%</b></div><div><small>SOL spent</small><b class="mono">' + S.treidFw.solSpent.toFixed(3) + '</b></div><div><small>Buybacks</small><b class="mono">' + fmtNum(S.treidFw.buys) + '</b></div></div></section>' : '') +
      '<section class="bn-list card-s"><div class="bn-lh"><b>Burn leaderboard</b><div class="bn-leg">' + Object.keys(BSRC).map(function (k) { return '<span><i style="background:' + BSRC[k][1] + '"></i>' + BSRC[k][0] + '</span>'; }).join('') + '</div><div class="seg">' + sorts.map(function (x) { return '<button class="' + (S.bsort === x[0] ? 'on' : '') + '" data-act="bsort" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="bn-row bn-head"><span>#</span><span>Coin</span><span>Supply burned</span><span class="r">Tokens</span><span class="r">Value</span><span class="r">Burns</span><span class="r">Last</span></div>' +
      coins.map(function (e, i) { return '<div class="bn-row" data-act="open" data-arg="' + esc(e.t.tick) + '"><span class="mono bn-rk' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</span><span class="bn-c">' + avatarHTML(e.t, 30) + '<span><b>$' + esc(e.t.tick) + '</b><small>' + esc(e.t.name) + '</small></span></span><span class="bn-bar"><span class="bn-stk">' + srcBar(e) + '</span><b class="mono">' + e.pct.toFixed(2) + '%</b></span><span class="r mono">' + fmtNum(Math.round(e.tok)) + '</span><span class="r mono bn-usd">$' + fmtNum(Math.round(e.usd)) + '</span><span class="r mono">' + e.n + '</span><span class="r mono muted">' + ago(e.last) + '</span></div>'; }).join('') + '</section>' +
      '<section class="bn-feed card-s"><div class="bn-lh"><b>Live burns</b><span class="muted">every burn across treid, newest first</span></div><div id="bn-log">' + (log.filter(function (b) { return b.at > 0; }).slice(0, 30).map(burnLogRow).join('') || '<div class="muted" style="padding:14px">No burns yet.</div>') + '</div></section></main>';
  }
  function burnLogRow(b) { return '<div class="bn-lg">🔥<span class="bn-c">' + avatarHTML(b.t, 22) + '<b>$' + esc(b.t.tick) + '</b></span><span class="bn-src" style="--c:' + BSRC[b.src || 'dev'][1] + '">' + BSRC[b.src || 'dev'][0] + (b.who && b.who !== 'auto' ? ' <em class="mono">' + b.who + '</em>' : '') + '</span><span class="mono">' + fmtNum(Math.round(b.tok)) + ' tokens</span><span class="mono muted">' + b.pct.toFixed(3) + '% supply</span><span class="mono bn-usd">$' + fmtNum(Math.round(b.usd)) + '</span><span class="mono muted" data-t="' + b.at + '">' + ago(b.at) + '</span><button class="txb" data-act="tx" data-arg="' + esc(b.sig) + '" aria-label="View transaction">' + I.copy + '</button></div>'; }
  var BN = { raf: 0, el: null, parts: [], last: 0 };
  function bnLoop(now) {
    var box = document.getElementById('bn-fire'); if (!box) { BN.raf = 0; BN.el = null; return; }
    var cv = box.querySelector('#bn-cv');
    if (BN.el !== box) { BN.el = box; var r = box.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); cv.width = r.width * d; cv.height = r.height * d; BN.w = r.width; BN.h = r.height; BN.ctx = cv.getContext('2d'); BN.ctx.setTransform(d, 0, 0, d, 0, 0); BN.last = now; BN.next = now + 700; BN.side = 'r'; if (burnLog().length) bqInit(); }
    var c = BN.ctx, W = BN.w, H = BN.h, base = H * .78, boost = Math.max(0, 1 - (now - (BN.boost || 0)) / 900) + Math.max(0, 1 - (now - (BN.big || 0)) / 700) * .45; boost = Math.min(1.1, boost);
    for (var i = 0; i < 5 + boost * 14; i++) { var off = (Math.random() - .5) * 2, sp = Math.max(0, 1 - Math.abs(off)); BN.parts.push({ x: W / 2 + off * W * (.16 + boost * .08), y: base + Math.random() * 8, vx: -off * .25, vy: -(1.2 + sp * 2.6 + Math.random() * 1.2 + boost * 2.5), life: .55 + sp * .45, s: 12 + sp * 20 + Math.random() * 8 + boost * 10 }); }
    if (Math.random() < .5) BN.parts.push({ x: W / 2 + (Math.random() - .5) * W * .25, y: base - 20, vx: (Math.random() - .5) * .8, vy: -(2 + Math.random() * 2), life: 1, s: 1.6, spark: 1 });
    c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, W, H); c.globalCompositeOperation = 'lighter';
    BN.parts = BN.parts.filter(function (p) { p.life -= p.spark ? .008 : .014 + Math.random() * .008; p.x += p.vx + Math.sin(now / 180 + p.y / 25) * (p.spark ? .6 : .35); p.y += p.vy; if (!p.spark) p.vx += (W / 2 - p.x) * .0016; return p.life > 0; });
    BN.parts.forEach(function (p) { var l = p.life;
      if (p.spark) { c.fillStyle = 'rgba(255,200,120,' + l.toFixed(2) + ')'; c.beginPath(); c.arc(p.x, p.y, p.s, 0, 6.283); c.fill(); return; }
      var rr = p.s * (.25 + l * .9), g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr), col = l > .8 ? '255,214,150' : l > .55 ? '255,150,50' : l > .3 ? '232,72,40' : '110,30,30';
      g.addColorStop(0, 'rgba(' + col + ',' + (l * .22).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)'); c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, rr, 0, 6.283); c.fill(); });
    if (BN.parts.length > 900) BN.parts.splice(0, BN.parts.length - 900);
    if (now > BN.next) { BN.next = now + 2900; bnThrow(); }
    if (BN.big && now - BN.big < 120) for (var e2 = 0; e2 < 26; e2++) { var an2 = Math.random() * Math.PI; BN.parts.push({ x: W / 2, y: base - 10, vx: Math.cos(an2) * (2 + Math.random() * 4), vy: -Math.sin(an2) * (3 + Math.random() * 5), life: 1, s: 1.8, spark: 1 }); }
    BN.raf = requestAnimationFrame(bnLoop);
  }
  var BQPOS = ['act', 'w1', 'w2', 'w3'], BQSAY = ['bye bye supply 👋', 'deflation szn 📉', 'send it 🔥', 'burn baby burn', 'less supply = more pump', 'WAGMI 💎', 'diamond hands only', 'number go up 📈', 'into the fire 🫡', 'say goodbye, tokens'];
  function bqPick() { var log = burnLog(), on = {}; ['l', 'r'].forEach(function (sd) { (BN.q && BN.q[sd] || []).forEach(function (x) { on[x.b.t.tick] = 1; }); }); var pool = log.slice(0, 40).filter(function (x) { return !on[x.t.tick]; }); return pick(pool.length ? pool : log); }
  function bqMake(sd, b, pos) {
    var box = document.getElementById('bn-fire'); if (!box) return null;
    var agg = (S._bnAgg || {})[b.t.tick], left = Math.max(0, 100 - (agg ? agg.pct : b.pct)), before = Math.min(100, left + b.pct);
    var el = document.createElement('div'); el.className = 'bq ' + sd + ' ' + pos;
    el.innerHTML = '<span class="bq-say"></span><div class="bh-ring"><span class="bh-av">' + avatarHTML(b.t, 60) + '</span></div><b class="bh-tk">$' + esc(b.t.tick) + '</b><span class="bh-sup"><i style="width:' + before + '%"></i></span><small class="mono bh-left">' + before.toFixed(2) + '% supply</small>';
    box.appendChild(el); return { el: el, b: b, left: left, before: before };
  }
  function bqPos(sd) { BN.q[sd].forEach(function (x, i) { BQPOS.forEach(function (c) { x.el.classList.remove(c); }); x.el.classList.add(BQPOS[Math.min(i, 3)]); }); }
  function bqInit() { BN.q = { l: [], r: [] }; ['l', 'r'].forEach(function (sd) { for (var i = 0; i < 3; i++) { var x = bqMake(sd, bqPick(), BQPOS[i]); if (x) BN.q[sd].push(x); } }); }
  function bqAdvance(sd) {
    var q = BN.q[sd], out = q.shift(); if (out) { BQPOS.forEach(function (c) { out.el.classList.remove(c); }); out.el.classList.add('out'); var rk = document.createElement('span'); rk.className = 'bq-rocket'; rk.textContent = '🚀'; out.el.appendChild(rk); setTimeout(function () { out.el.remove(); }, 1100); }
    var nx = bqMake(sd, bqPick(), 'w3'); if (nx) q.push(nx);
    requestAnimationFrame(function () { requestAnimationFrame(function () { bqPos(sd); }); });
  }
  function fmtBig(v) { return v >= 1e9 ? (v / 1e9).toFixed(3) + 'B' : fmtNum(Math.round(v)); }
  function bnCount(add) {
    var el = document.getElementById('bh-count'); if (!el) return; var from = BN.tot || 0, to = from + add, t0 = performance.now(); BN.tot = to;
    (function step(n) { var k = Math.min(1, (n - t0) / 700), v = from + (to - from) * (1 - Math.pow(1 - k, 3)); el.textContent = fmtBig(v); if (k < 1) requestAnimationFrame(step); })(t0);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  function bnThrow() {
    var fly = document.getElementById('bn-fly'); if (!fly || !BN.q) return;
    BN.side = BN.side === 'l' ? 'r' : 'l'; var sd = BN.side, cur = BN.q[sd][0]; if (!cur) return; var f = cur.el, b = cur.b;
    var say = f.querySelector('.bq-say'); say.textContent = pick(BQSAY); f.classList.add('talk');
    setTimeout(function () {
      if (!f.isConnected) return; var fr = fly.getBoundingClientRect(), ar = f.querySelector('.bh-ring').getBoundingClientRect();
      var x0 = ar.left + ar.width / 2 - fr.left, y0 = ar.top + ar.height / 2 - fr.top, x1 = fr.width / 2, y1 = fr.height * .74;
      f.classList.remove('talk'); f.classList.add('grab');
      var n = Math.max(7, Math.min(16, Math.round(6 + b.pct * 3))), H = fr.height * (.36 + Math.random() * .1);
      setTimeout(function () {
        var bar = f.querySelector('.bh-sup i'); bar.style.transition = 'width 1.1s cubic-bezier(.3,0,.2,1)'; bar.style.width = cur.left + '%';
        var lf = f.querySelector('.bh-left'), t0 = performance.now(); (function st(nw) { var k = Math.min(1, (nw - t0) / 1100); lf.textContent = (cur.before - b.pct * k).toFixed(2) + '% supply'; if (k < 1) requestAnimationFrame(st); })(t0);
        for (var i = 0; i < n; i++) (function (i) {
          var c = document.createElement('span'); c.className = 'bh-chip'; c.innerHTML = avatarHTML(b.t, 22); fly.appendChild(c);
          var jx = (Math.random() - .5) * 40, jh = H * (.8 + Math.random() * .4), spin = (Math.random() < .5 ? -1 : 1) * (360 + Math.random() * 540), kf = [];
          for (var q = 0; q <= 14; q++) { var t = q / 14, x = x0 + (x1 + jx * t - x0) * t, y = y0 + (y1 - y0) * t - jh * 4 * t * (1 - t); kf.push({ transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + (spin * t).toFixed(0) + 'deg) scale(' + (t < .1 ? .4 + t * 6 : 1 - Math.max(0, t - .75) * 2).toFixed(2) + ')', opacity: t > .92 ? 0 : 1 }); }
          var an = c.animate(kf, { duration: 820 + Math.random() * 160, delay: i * 55, easing: 'cubic-bezier(.35,.1,.6,1)', fill: 'both' });
          an.onfinish = function () { c.remove(); BN.boost = performance.now() - (i === n - 1 ? 0 : 500); if (i === n - 1) { bnImpact(b, x1, y1); bqCheer(sd, cur); } };
        })(i);
      }, 260);
    }, 650);
  }
  function bqCheer(sd, cur) {
    var f = cur.el; if (!f.isConnected) return; f.classList.remove('grab'); f.classList.add('cheer');
    var rk = (S._bnRank || {})[cur.b.t.tick] || 9, up = 1 + Math.floor(Math.random() * 3), pop = document.createElement('span'); pop.className = 'bq-rank';
    pop.innerHTML = rk === 1 ? '🏆 <b>#1</b> burner' : '▲ <s>#' + (rk + up) + '</s> <b>#' + rk + '</b>'; f.appendChild(pop);
    setTimeout(function () { bqAdvance(sd); }, 1150);
  }
  function bnImpact(b, x, y) {
    var fly = document.getElementById('bn-fly'); if (!fly) return; BN.boost = performance.now(); BN.big = performance.now();
    var w = document.createElement('span'); w.className = 'bh-wave'; w.style.left = x + 'px'; w.style.top = y + 'px'; fly.appendChild(w); setTimeout(function () { w.remove(); }, 900);
    var p = document.createElement('span'); p.className = 'bh-pop'; p.style.left = x + 'px'; p.style.top = (y - 150) + 'px'; p.innerHTML = '🔥 −' + fmtNum(Math.round(b.tok)) + ' <em>$' + esc(b.t.tick) + '</em>'; fly.appendChild(p); setTimeout(function () { p.remove(); }, 1800);
    if (b.fresh) { bnCount(b.tok); bhKick(b); b.fresh = false; } else bhKick(b, true);
    var nw = document.getElementById('bn-now'); if (nw) { nw.innerHTML = '<b>$' + esc(b.t.tick) + '</b> burned ' + b.pct.toFixed(2) + '% supply · <span style="color:' + BSRC[b.src][1] + '">' + BSRC[b.src][0] + '</span> · <span class="bn-usd">$' + fmtNum(Math.round(b.usd)) + '</span>'; nw.classList.remove('go'); void nw.offsetWidth; nw.classList.add('go'); }
    var fire = document.getElementById('bn-fire'); if (fire) { fire.classList.remove('shake'); void fire.offsetWidth; fire.classList.add('shake'); }
  }
  function bnKick() { if (!BN.raf && document.getElementById('bn-fire')) BN.raf = requestAnimationFrame(bnLoop); }
  S.tcat = 'all';
  function trendPage() {
    var a = all().filter(function (t) { return (S.tcat === 'all' || pairInfo(t.pair).cat === S.tcat) && (S.lsort !== 'near' || t.prog < 100); });
    var pre = [['rank', '🔥 Trending'], ['vol', 'Top volume'], ['c1', '📈 Gainers 1h'], ['age', '✨ New'], ['near', '🎓 Near graduation'], ['mc', 'Market cap']];
    return '<main class="wrap trend"><div class="tr-head"><div><span class="kicker">TOP 100</span><h1 class="tr-h">Trending</h1></div><span class="muted mono">' + Math.min(100, a.length) + ' coins · updates live</span></div>' +
      '<div class="tr-bar"><div class="seg">' + pre.map(function (x) { return '<button class="' + (S.lsort === x[0] ? 'on' : '') + '" data-act="tpreset" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="seg tr-cats">' + [['all', 'All pairs']].concat(CATS.slice(1).map(function (c) { return [c[0], c[1]]; })).map(function (c) { return '<button class="' + (S.tcat === c[0] ? 'on' : '') + '" data-act="tcat" data-arg="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div></div>' +
      listHTML(a) + '</main>';
  }
  function bubblesHTML(list) {
    return '<section class="grid" style="display:block"><div class="bubbles" id="bubbles">' + list.slice(0, 40).map(function (t) {
      var r = bubR(t), c = chg(t), b = BUB[t.tick];
      var x = b ? b.x : rnd(r, 800), y = b ? b.y : rnd(r, 560);
      return '<button class="bubble ' + (c >= 0 ? 'pos' : 'neg') + '" data-bub="' + esc(t.tick) + '" style="width:' + (2 * r) + 'px;height:' + (2 * r) + 'px;transform:translate(' + (x - r) + 'px,' + (y - r) + 'px)" aria-label="' + esc(t.name) + '">' +
        avatarHTML(t, Math.round(r * (r > 50 ? 0.9 : 1.1))) + (r > 44 ? '<span class="bt">$' + esc(t.tick) + '</span>' : '') + '<span class="bc ' + (c >= 0 ? 'up' : 'down') + '" data-chg3="' + esc(t.tick) + '">' + chgTxt(c) + '</span><span class="bm' + (r > 44 ? '' : ' sm') + '"><b data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</b><i>·</i><span data-t="' + t.born + '">' + ago(t.born) + '</span></span></button>';
    }).join('') + '<span class="bub-hint">Drag and throw bubbles · size = market cap · colour = 24h change · click to open</span></div></section>';
  }

  S.fpop = null; S.cleanOnly = false;
  var RDEF = { mc: [0, 100], prog: [0, 100], tax: [0, 10], age: [0, 100] };
  S.r = JSON.parse(JSON.stringify(RDEF));
  var AGEL = Math.log10(43200);
  function mcK(s0) { return Math.pow(10, s0 / 20); }            // slider 0..100 -> $1K..$100M (in K)
  function ageM(s0) { return Math.pow(10, s0 / 100 * AGEL); }   // slider 0..100 -> 1 min..30 d
  function ageS(m) { return Math.log10(m) / AGEL * 100; }
  function rv(k) { var r = S.r[k];
    if (k === 'mc') return [r[0] <= 0 ? 0 : mcK(r[0]), r[1] >= 100 ? Infinity : mcK(r[1])];
    if (k === 'age') return [r[0] <= 0 ? 0 : ageM(r[0]), r[1] >= 100 ? Infinity : ageM(r[1])];
    return [r[0], r[1]]; }
  function ageTxt(m) { return m < 60 ? Math.round(m) + 'm' : m < 1440 ? (m / 60).toFixed(m < 600 ? 1 : 0).replace('.0', '') + 'h' : Math.round(m / 1440) + 'd'; }
  function rLabel(k) {
    if (typeof RS !== 'undefined' && RS[k]) return rsLabel(k);
    var r = S.r[k], d = RDEF[k], v = rv(k);
    if (r[0] === d[0] && r[1] === d[1]) return 'Any';
    function one(x, isMax) {
      if (k === 'mc') return x === Infinity ? '∞' : fmtK(x);
      if (k === 'age') return x === Infinity ? '∞' : ageTxt(Math.max(1, x));
      if (k === 'tax') return x + '%';
      return Math.round(x) + '%';
    }
    if (r[0] === d[0]) return (k === 'age' ? '< ' : '≤ ') + one(v[1], true);
    if (r[1] === d[1]) return (k === 'age' ? '> ' : '≥ ') + one(v[0]);
    return one(v[0]) + ' – ' + one(v[1], true);
  }
  var RCFG = {
    mc: { lab: 'MCap', title: 'Market cap', max: 100, step: 1, scale: ['$1K', '$10K', '$100K', '$1M', '$10M', '$100M+'],
      pre: [['Any', 0, 100], ['< $10K', 0, 20], ['$10K–$100K', 20, 40], ['$100K–$1M', 40, 60], ['$1M+', 60, 100]] },
    prog: { lab: 'Curve', title: 'Bonding curve', max: 100, step: 1, scale: ['0%', '25%', '50%', '75%', '100%'],
      pre: [['Any', 0, 100], ['Early 0–25%', 0, 25], ['Mid 25–75%', 25, 75], ['Near grad 75–99%', 75, 99], ['Graduated', 100, 100]] },
    tax: { lab: 'Tax', title: 'Max tax (buy or sell)', max: 10, step: 1, scale: ['0%', '2%', '4%', '6%', '8%', '10%'],
      pre: [['Any', 0, 10], ['0%', 0, 0], ['≤ 3%', 0, 3], ['≤ 6%', 0, 6], ['High 6%+', 6, 10]] },
    age: { lab: 'Age', title: 'Time since launch', max: 100, step: 1, scale: ['1m', '10m', '1h', '1d', '30d+'],
      pre: [['Any', 0, 100], ['< 5 min', 0, Math.round(ageS(5))], ['< 1 hour', 0, Math.round(ageS(60))], ['< 24 hours', 0, Math.round(ageS(1440))], ['Older 1d+', Math.round(ageS(1440)), 100]] }
  };
  function rFill(k) { var c = RCFG[k], r = S.r[k]; return 'left:' + (r[0] / c.max * 100) + '%;right:' + (100 - r[1] / c.max * 100) + '%'; }
  function rangePop(k) {
    var c = RCFG[k], r = S.r[k];
    return '<div class="fpop range"><div class="rp-h"><span>' + c.title + '</span><b class="mono" id="rpv-' + k + '">' + rLabel(k) + '</b></div>' +
      '<div class="dual' + (k === 'tax' ? ' taxg' : '') + '"><div class="dual-track"><i id="rpf-' + k + '" style="' + rFill(k) + '"></i></div>' +
        '<input type="range" min="0" max="' + c.max + '" step="' + c.step + '" value="' + r[0] + '" data-range="' + k + '|0" aria-label="' + c.title + ' minimum">' +
        '<input type="range" min="0" max="' + c.max + '" step="' + c.step + '" value="' + r[1] + '" data-range="' + k + '|1" aria-label="' + c.title + ' maximum"></div>' +
      '<div class="rp-scale mono">' + c.scale.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' +
      '<div class="rp-pre">' + c.pre.map(function (p) { var on = r[0] === p[1] && r[1] === p[2]; return '<button class="' + (on ? 'on' : '') + '" data-act="rpre" data-arg="' + k + '|' + p[1] + '|' + p[2] + '">' + p[0] + '</button>'; }).join('') + '</div>' +
      '<div class="rp-foot"><span class="mono muted" id="rpc-' + k + '">' + filtered().length + ' coins match</span><button class="link" style="min-height:0;font-size:12.5px" data-act="rpre" data-arg="' + k + '|' + RDEF[k][0] + '|' + RDEF[k][1] + '">Clear</button></div></div>';
  }
  S.pairQ = ''; S.pairTab = 'all';
  function pairCounts() { var m = {}; all().forEach(function (t) { m[t.pair] = (m[t.pair] || 0) + 1; }); return m; }
  function pairPop() {
    var cnt = pairCounts(), q = S.pairQ.trim().toLowerCase();
    var ids = Object.keys(PAIR_INFO).concat(BASE.filter(function (t) { return cnt[t.tick]; }).map(function (t) { return t.tick; }));
    var memes = BASE.slice().sort(function (a, b) { return b.mcN - a.mcN; }).slice(0, 8).map(function (t) { return t.tick; });
    memes.forEach(function (m) { if (ids.indexOf(m) === -1) ids.push(m); });
    var list = ids.filter(function (id) {
      var pi = pairInfo(id);
      if (S.pairTab !== 'all' && pi.cat !== S.pairTab) return false;
      if (q && id.toLowerCase().indexOf(q) === -1 && pi.name.toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return (cnt[b] || 0) - (cnt[a] || 0); });
    var tabs = [['all', 'All']].concat(CATS.slice(1).map(function (c) { return [c[0], c[1]]; }));
    return '<div class="fpop pairpop"><div class="pp-search">' + I.search + '<input id="pairq" data-bind="pairQ" value="' + esc(S.pairQ) + '" placeholder="Search Gold, ONDO, SOL, $PAWS…" autocomplete="off"></div>' +
      '<div class="pp-tabs">' + tabs.map(function (t) { var n = t[0] === 'all' ? all().length : all().filter(function (x) { return pairInfo(x.pair).cat === t[0]; }).length; return '<button class="' + (S.pairTab === t[0] ? 'on' : '') + '" data-act="ptab" data-arg="' + t[0] + '">' + t[1] + '<span>' + n + '</span></button>'; }).join('') + '</div>' +
      (S.pairTab !== 'all' ? '<button class="pp-all" data-act="pcat" data-arg="' + S.pairTab + '">Show all ' + tabs.filter(function (t) { return t[0] === S.pairTab; })[0][1].toLowerCase() + ' pairs →</button>' : '') +
      '<div class="pp-grid">' + (list.length ? list.map(function (id) {
        var n = cnt[id] || 0, on = S.pair === id;
        return '<button class="pp-item' + (on ? ' on' : '') + (n ? '' : ' empty') + '" data-act="ppick" data-arg="' + esc(id) + '">' + coinHTML(id, 30) + '<span class="pp-n"><b>' + esc(pairLabel(id)) + '</b><small>' + esc(pairInfo(id).name) + '</small></span><span class="pp-c mono">' + n + '</span></button>';
      }).join('') : '<div class="muted" style="padding:14px">No pair found</div>') + '</div>' +
      '<div class="rp-foot"><span class="mono muted">' + filtered().length + ' coins match</span><button class="link" style="min-height:0;font-size:12.5px" data-act="pclear">Clear</button></div></div>';
  }
  function pairIds(tab, q) {
    var cnt = pairCounts();
    var ids = Object.keys(PAIR_INFO).concat(BASE.filter(function (t) { return cnt[t.tick]; }).map(function (t) { return t.tick; }));
    BASE.slice().sort(function (a, b) { return b.mcN - a.mcN; }).slice(0, 8).forEach(function (t) { if (ids.indexOf(t.tick) === -1) ids.push(t.tick); });
    q = (q || '').trim().toLowerCase().replace(/^\$/, '');
    return ids.filter(function (id) { var pi = pairInfo(id);
      if (tab !== 'all' && pi.cat !== tab) return false;
      if (q && id.toLowerCase().indexOf(q) === -1 && pi.name.toLowerCase().indexOf(q) === -1) return false;
      return true; }).sort(function (a, b) { return (cnt[b] || 0) - (cnt[a] || 0); });
  }
  // visible "Paired with" row: category segments + coin rail + search
  function pairRow() {
    var cnt = pairCounts(), a = all();
    var cats = CATS.map(function (c) { var n = c[0] === 'all' ? a.length : a.filter(function (x) { return pairInfo(x.pair).cat === c[0]; }).length;
      var on = S.cat === c[0];
      return '<button class="prc' + (on ? ' on' : '') + '" style="--cc:' + c[3] + '" data-act="pcat" data-arg="' + c[0] + '"><span>' + (c[0] === 'all' ? 'All' : c[1]) + '</span><small>' + n + '</small></button>'; }).join('');
    var rail = pairIds(S.cat, '').filter(function (id) { return cnt[id]; }).map(function (id) {
      var on = S.pair === id;
      return '<button class="prp' + (on ? ' on' : '') + '" data-act="ppick" data-arg="' + esc(id) + '" title="' + esc(pairInfo(id).name) + '">' + coinHTML(id, 22) + '<b>' + esc(pairLabel(id)) + '</b><small>' + cnt[id] + '</small></button>'; }).join('');
    var q = S.pairQ.trim(), res = q ? pairIds('all', q).slice(0, 8) : [];
    var drop = q ? '<div class="pr-drop">' + (res.length ? res.map(function (id) { var n = cnt[id] || 0;
      return '<button class="pp-item' + (S.pair === id ? ' on' : '') + (n ? '' : ' empty') + '" data-act="ppick2" data-arg="' + esc(id) + '">' + coinHTML(id, 26) + '<span class="pp-n"><b>' + esc(pairLabel(id)) + '</b><small>' + esc(pairInfo(id).name) + ' · ' + (CATS.filter(function (c) { return c[0] === pairInfo(id).cat; })[0] || [0, ''])[1] + '</small></span><span class="pp-c mono">' + n + '</span></button>'; }).join('') : '<div class="muted" style="padding:12px 14px;font-size:13px">No pair called “' + esc(q) + '”</div>') + '</div>' : '';
    var sel = S.pair !== 'All' ? '<button class="pr-sel" data-act="ppick" data-arg="' + esc(S.pair) + '">' + coinHTML(S.pair, 18) + '<b>' + esc(pairLabel(S.pair)) + '</b><span>×</span></button>' : '';
    if (!DEMO) { var lc = {}; a.forEach(function (x) { var L = pairLabel(x.pair); lc[L] = (lc[L] || 0) + 1; });
      var ltabs = [['all', 'All', '#E8E8EA']].concat(RW_TABS.map(function (x) { return [x[0], x[1], { memes: '#FF6B8B', crypto: '#A3B1C2', stocks: '#3DDC97', fx: '#7DB8FF' }[x[0]]]; }));
      cats = ltabs.map(function (c) { var n = c[0] === 'all' ? a.length : a.filter(function (x) { return liveCat(x) === c[0]; }).length; return '<button class="prc' + (S.cat === c[0] ? ' on' : '') + '" style="--cc:' + c[2] + '" data-act="pcat" data-arg="' + c[0] + '"><span>' + c[1] + '</span><small>' + n + '</small></button>'; }).join('');
      var pres = (S.cat === 'all' ? ['crypto', 'fx', 'memes', 'stocks'] : [S.cat]).reduce(function (acc, k) { return acc.concat(RW_PRE[k] || []); }, []);
      var seen = {}; pres = pres.filter(function (p) { if (seen[p[0]]) return false; seen[p[0]] = 1; return true; }).sort(function (x, y) { return (lc[y[0]] || 0) - (lc[x[0]] || 0); });
      rail = pres.map(function (p) { var n = lc[p[0]] || 0, on = S.pair === p[0]; return '<button class="prp' + (on ? ' on' : '') + (n ? '' : ' zero') + '" data-act="ppickL" data-arg="' + esc(p[0]) + '" title="Coins paired with ' + esc(p[0]) + '">' + preIcon(p, 22) + '<b>' + esc(p[0]) + '</b><small>' + n + '</small></button>'; }).join('');
      sel = ''; }
    return '<div class="pairrow"><span class="pr-l">Paired<br>with</span><div class="pr-cats">' + cats + '</div>' +
      '<div class="pr-rail drag-scroll">' + rail + '</div>' + sel +
      '<div class="pr-search">' + I.search + '<input id="pairq" data-bind="pairQ" value="' + esc(S.pairQ) + '" placeholder="' + (DEMO ? 'Find pair: Gold, ONDO, $PAWS…' : 'Find pair: SOL, USDC…') + '" autocomplete="off">' + drop + '</div></div>';
  }
  // ---- tape-measure range filters ----
  var HB = 28;
  function sPos(k, d) {
    if (k === 'mc') return Math.max(0, Math.min(100, 20 * Math.log10(Math.max(1, d.mcN))));
    if (k === 'age') return Math.max(0, Math.min(100, ageS(Math.max(1, (Date.now() - d.born) / 60000))));
    if (k === 'tax') return Math.max(d.buy, d.sell);
    return d.prog;
  }
  function rTicks(k) {
    if (k === 'mc') return [[0, '1K'], [20, '10K'], [40, '100K'], [60, '1M'], [80, '10M'], [100, '100M']];
    if (k === 'age') return [[0, '1m'], [ageS(10), '10m'], [ageS(60), '1h'], [ageS(1440), '1d'], [100, '30d']];
    if (k === 'tax') return [[0, '0'], [2, '2'], [4, '4'], [6, '6'], [8, '8'], [10, '10%']];
    return [[0, '0'], [25, '25'], [50, '50'], [75, '75'], [100, '100%']];
  }
  function endTxt(k, i) {
    var v = rv(k)[i];
    if (k === 'mc') return v === Infinity ? '∞' : v === 0 ? '$0' : fmtK(v);
    if (k === 'age') return v === Infinity ? '∞' : v === 0 ? 'new' : ageTxt(Math.max(1, v));
    return Math.round(v) + '%';
  }
  function dotsHTML(k) {
    var c = RCFG[k], r = S.r[k];
    return all().map(function (d) { var v = sPos(k, d), on = v >= r[0] && v <= r[1];
      return '<i data-p="' + v.toFixed(2) + '" class="' + (on ? 'in' : '') + '" style="left:' + (v / c.max * 100).toFixed(2) + '%"></i>'; }).join('');
  }
  function irUpdate(k, idx) {
    var c = RCFG[k], r = S.r[k], box = document.querySelector('.ir-' + k); if (!box) return;
    var h = box.querySelectorAll('.ir-dots i');
    for (var j = 0; j < h.length; j++) { var pv = +h[j].getAttribute('data-p'); h[j].classList.toggle('in', pv >= r[0] && pv <= r[1]); }
    var lit = box.querySelector('.ir-rule.lit'); if (lit) lit.style.clipPath = 'inset(0 ' + (100 - r[1] / c.max * 100) + '% 0 ' + (r[0] / c.max * 100) + '%)';
    var tl = box.querySelectorAll('.ir-rule.lit em');
    rTicks(k).forEach(function (t, j) { var e = tl[j]; if (!e) return; var inr = t[0] >= r[0] && t[0] <= r[1]; e.classList.toggle('in', inr); });
    if (idx != null) {
      var f = box.querySelector('.ir-flag'), pos = r[idx] / c.max;
      f.textContent = endTxt(k, idx); f.style.left = 'calc(' + (pos * 100) + '% + ' + (7 - pos * 14) + 'px)';
      box.classList.add('drag'); clearTimeout(box._t); box._t = setTimeout(function () { box.classList.remove('drag'); }, 900);
      // click when passing a major tick
      var near = -1; rTicks(k).forEach(function (t, j) { if (Math.abs(t[0] - r[idx]) < c.max / 60) near = j; });
      if (near > -1 && box._near !== near) { var e = tl[near]; if (e) { e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop'); } }
      box._near = near;
    }
  }
  // ---- step filters: click a step, or drag across steps to pick a range ----
  var SB = {
    mc: [['<5K', 0, 20 * Math.log10(5)], ['5–10K', 20 * Math.log10(5), 20], ['10–30K', 20, 20 * Math.log10(30)], ['30–100K', 20 * Math.log10(30), 40], ['100K–1M', 40, 60], ['1M+', 60, 100]],
    age: [['<5m', 0, ageS(5)], ['5–30m', ageS(5), ageS(30)], ['30m–1h', ageS(30), ageS(60)], ['1–6h', ageS(60), ageS(360)], ['6–24h', ageS(360), ageS(1440)], ['1d+', ageS(1440), 100]],
    prog: [['0–25%', 0, 25], ['25–50%', 25, 50], ['50–75%', 50, 75], ['75–99%', 75, 99], ['Grad', 100, 100]],
    tax: [['0%', 0, 0], ['1–2%', 1, 2], ['3–4%', 3, 4], ['5–6%', 5, 6], ['7%+', 7, 10]]
  };
  var TAXC = ['#3DDC97', '#9BE36A', '#FFD15C', '#FF9A4D', '#F2708A'];
  function sfSel(k) {
    var r = S.r[k], d = RDEF[k]; if (r[0] === d[0] && r[1] === d[1]) return [-1, -1];
    var a = -1, b = -1; SB[k].forEach(function (x, i) { if (x[1] >= r[0] - 1e-6 && x[2] <= r[1] + 1e-6) { if (a < 0) a = i; b = i; } });
    return [a, b];
  }
  function sfApply(k, a, b) {
    if (a < 0) S.r[k] = RDEF[k].slice(); else { var B = SB[k]; S.r[k] = [B[Math.min(a, b)][1], B[Math.max(a, b)][2]]; }
    sfPaint(k); refreshGrid();
  }
  function sfWin(k) { var n = SB[k].length, sel = sfSel(k), a = sel[0] < 0 ? 0 : sel[0], b = sel[0] < 0 ? n - 1 : sel[1]; return { a: a, b: b, any: sel[0] < 0, style: 'left:calc(' + (a / n * 100) + '% + 2px);width:calc(' + ((b - a + 1) / n * 100) + '% - 4px)' }; }
  function sfPaint(k) {
    var box = document.querySelector('.ir-' + k); if (!box) return;
    var w = sfWin(k), bs = box.querySelectorAll('.sf-b'), win = box.querySelector('.sf-win');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('in', !w.any && i >= w.a && i <= w.b);
    if (win) { win.setAttribute('style', w.style); win.classList.toggle('any', w.any); }
  }
  // ---- snap range slider: single-value stops, two handles ----
  var mcS = function (k) { return 20 * Math.log10(k); };
  var RS = {
    mc: [[0, '0'], [mcS(5), '5K'], [mcS(10), '10K'], [mcS(20), '20K'], [mcS(30), '30K'], [mcS(50), '50K'], [40, '100K'], [mcS(250), '250K'], [60, '1M'], [100, '∞']],
    age: [[0, '0'], [ageS(5), '5m'], [ageS(15), '15m'], [ageS(30), '30m'], [ageS(60), '1h'], [ageS(360), '6h'], [ageS(1440), '1d'], [ageS(10080), '7d'], [100, '∞']],
    prog: [[0, '0'], [10, '10'], [25, '25'], [50, '50'], [75, '75'], [90, '90'], [100, '100']],
    tax: [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7'], [8, '8'], [9, '9'], [10, '10']]
  };
  var RSU = { mc: ['$', ''], age: ['', ''], prog: ['', '%'], tax: ['', '%'] };
  function rsIdx(k) { var st = RS[k], r = S.r[k], a = 0, b = st.length - 1, da = 1e9, db = 1e9;
    st.forEach(function (x, i) { var d0 = Math.abs(x[0] - r[0]), d1 = Math.abs(x[0] - r[1]); if (d0 < da) { da = d0; a = i; } if (d1 <= db) { db = d1; b = i; } });
    return [a, b]; }
  function rsTxt(k, i) { var l = RS[k][i][1], u = RSU[k]; return l === '∞' ? '∞' : u[0] + l + u[1]; }
  function rsLabel(k) { var ix = rsIdx(k), n = RS[k].length - 1;
    if (ix[0] === 0 && ix[1] === n) return 'Any';
    if (ix[0] === 0) return '≤ ' + rsTxt(k, ix[1]);
    if (ix[1] === n) return '≥ ' + rsTxt(k, ix[0]);
    if (ix[0] === ix[1]) return rsTxt(k, ix[0]);
    return rsTxt(k, ix[0]) + ' – ' + rsTxt(k, ix[1]); }
  function rsPct(k, i) { return i / (RS[k].length - 1) * 100; }
  function inlineRange(k) {
    var c = RCFG[k], ix = rsIdx(k), on = rLabel(k) !== 'Any', n = RS[k].length;
    var ic = { mc: '$', age: '◷', prog: '▲', tax: '%' }[k];
    var lab = RS[k].map(function (x, i) { return '<span class="rs-t' + (i >= ix[0] && i <= ix[1] && on ? ' in' : '') + '" style="left:' + rsPct(k, i) + '%' + (k === 'tax' ? ';--tc:' + taxBg(i) : '') + '">' + x[1] + '</span>'; }).join('');
    return '<div class="irange rsx ir-' + k + (on ? ' on' : '') + '"><div class="ir-h"><span><i>' + ic + '</i>' + c.lab + '</span><b id="fcl-' + k + '">' + rLabel(k) + '</b></div>' +
      '<div class="rs" data-rs="' + k + '" style="--a:' + rsPct(k, ix[0]) + '%;--b:' + rsPct(k, ix[1]) + '%"><div class="rs-rail"><div class="rs-track"><i class="rs-fill"></i>' +
      RS[k].map(function (x, i) { return '<b class="rs-dot" style="left:' + rsPct(k, i) + '%"></b>'; }).join('') + '</div>' +
      '<span class="rs-h h0" data-h="0"><em>' + rsTxt(k, ix[0]) + '</em></span><span class="rs-h h1" data-h="1"><em>' + rsTxt(k, ix[1]) + '</em></span></div>' +
      '<div class="rs-labs">' + lab + '</div></div></div>';
  }
  var rsD = null;
  function rsSet(el, k, a, b, live) {
    el.style.setProperty('--a', (typeof a === 'number' ? a : 0) + '%'); el.style.setProperty('--b', b + '%');
  }
  function rsCommit(k, ia, ib) {
    var st = RS[k]; S.r[k] = [st[ia][0], st[ib][0]];
    var box = document.querySelector('.ir-' + k); if (box) {
      box.querySelectorAll('.rs-t').forEach(function (e, i) { e.classList.toggle('in', i >= ia && i <= ib && !(ia === 0 && ib === st.length - 1)); });
      var h = box.querySelectorAll('.rs-h em'); h[0].textContent = rsTxt(k, ia); h[1].textContent = rsTxt(k, ib);
    }
    refreshGrid();
  }
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest && e.target.closest('[data-rs]'); if (!el || e.button > 0) return;
    e.preventDefault(); var k = el.getAttribute('data-rs'), rail = el.querySelector('.rs-rail').getBoundingClientRect(), n = RS[k].length - 1, ix = rsIdx(k);
    var f = Math.max(0, Math.min(1, (e.clientX - rail.left) / rail.width)), pa = ix[0] / n, pb = ix[1] / n;
    var h = e.target.closest('[data-h]'), which = h ? +h.getAttribute('data-h') : (Math.abs(f - pa) < Math.abs(f - pb) || (pa === pb && f < pa)) ? 0 : 1;
    rsD = { el: el, k: k, rail: rail, n: n, which: which, ia: ix[0], ib: ix[1] };
    el.classList.add('drag'); el.classList.toggle('w0', which === 0); el.classList.toggle('w1', which === 1);
    try { el.setPointerCapture(e.pointerId); } catch (er) {}
    rsMove(e.clientX);
  });
  function rsMove(x) {
    var d = rsD, f = Math.max(0, Math.min(1, (x - d.rail.left) / d.rail.width)), idx = Math.round(f * d.n);
    if (d.which === 0) { f = Math.min(f, d.ib / d.n); idx = Math.min(idx, d.ib); d.el.style.setProperty('--a', (f * 100) + '%'); if (idx !== d.ia) { d.ia = idx; rsCommit(d.k, d.ia, d.ib); } }
    else { f = Math.max(f, d.ia / d.n); idx = Math.max(idx, d.ia); d.el.style.setProperty('--b', (f * 100) + '%'); if (idx !== d.ib) { d.ib = idx; rsCommit(d.k, d.ia, d.ib); } }
  }
  document.addEventListener('pointermove', function (e) { if (rsD) rsMove(e.clientX); });
  document.addEventListener('pointerup', function () {
    if (!rsD) return; var d = rsD; rsD = null; d.el.classList.remove('drag');
    d.el.style.setProperty('--a', (d.ia / d.n * 100) + '%'); d.el.style.setProperty('--b', (d.ib / d.n * 100) + '%');
    var box = d.el.closest('.irange'); if (box) box.classList.toggle('on', rLabel(d.k) !== 'Any');
  });
  var sfD = null;
  function sfIdx(bar, k, x) { var r = bar.getBoundingClientRect(), n = SB[k].length; return Math.max(0, Math.min(n - 1, Math.floor((x - r.left) / r.width * n))); }
  document.addEventListener('pointerdown', function (e) {
    var bar = e.target.closest && e.target.closest('[data-sfbar]'); if (!bar || e.button > 0) return;
    e.preventDefault(); var k = bar.getAttribute('data-sfbar'), w = sfWin(k), idx = sfIdx(bar, k, e.clientX), h = e.target.closest('[data-sfh]');
    var mode = h ? 'h' + h.getAttribute('data-sfh') : (!w.any && idx >= w.a && idx <= w.b) ? 'move' : 'tap';
    sfD = { k: k, bar: bar, mode: mode, start: idx, a: w.a, b: w.b, any: w.any, moved: false };
    bar.classList.add('drag'); try { bar.setPointerCapture(e.pointerId); } catch (er) {}
    if (mode === 'tap') { sfApply(k, idx, idx); sfD.a = sfD.b = idx; sfD.mode = 'h1'; sfD.tap = true; }
  });
  document.addEventListener('pointermove', function (e) {
    if (!sfD) return; var k = sfD.k, n = SB[k].length, idx = sfIdx(sfD.bar, k, e.clientX), a = sfD.a, b = sfD.b;
    if (idx !== sfD.start) sfD.moved = true; if (!sfD.moved) return;
    if (sfD.mode === 'h0') a = Math.min(idx, sfD.b);
    else if (sfD.mode === 'h1') { if (sfD.tap) { a = Math.min(sfD.start, idx); b = Math.max(sfD.start, idx); } else b = Math.max(idx, sfD.a); }
    else { var d = idx - sfD.start; d = Math.max(-sfD.a, Math.min(n - 1 - sfD.b, d)); a = sfD.a + d; b = sfD.b + d; }
    var cw = sfWin(k); if (cw.a !== a || cw.b !== b) sfApply(k, a, b);
  });
  document.addEventListener('pointerup', function () {
    if (!sfD) return; var d = sfD; sfD = null; d.bar.classList.remove('drag');
    if (!d.moved && d.mode === 'move') { if (d.a === d.b) sfApply(d.k, 0, SB[d.k].length - 1); else sfApply(d.k, d.start, d.start); }
    var box = d.bar.closest('.irange'); if (box) { box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump'); }
  });
  function filterBar() {
    var active = 0;
    ['mc', 'age', 'prog', 'tax'].forEach(function (k) { if (rLabel(k) !== 'Any') active++; });
    var pairOn = S.pair !== 'All' || S.cat !== 'all'; if (pairOn) active++;
    var pl = S.pair !== 'All' ? coinHTML(S.pair, 20) + '<b>' + esc(pairLabel(S.pair)) + '</b>' : S.cat !== 'all' ? '<b>' + CATS.filter(function (c) { return c[0] === S.cat; })[0][1] + '</b>' : '<b>Any</b>';
    var pairChip = '<div class="fdrop"><button class="fchip pairchip big' + (pairOn ? ' on' : '') + (S.fpop === 'pair' ? ' open' : '') + '" data-act="fpop" data-arg="pair"><span class="fc-l">Paired with</span>' + pl + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg></button>' + (S.fpop === 'pair' ? pairPop() : '') + '</div>';
    var tg = [['zeroOnly', '0% tax', ''], ['gradOnly', 'Graduated', ''], ['rewardsOnly', 'Rewards', I.gift], ['watchOnly', 'Watchlist', I.star(false)], ['cleanOnly', 'No warnings', '<span class="fdot"></span>']].map(function (t) {
      var on = !!S[t[0]]; if (on) active++;
      return '<button class="ftog' + (on ? ' on' : '') + '" data-act="toggle" data-arg="' + t[0] + '" aria-pressed="' + on + '">' + t[2] + t[1] + '</button>';
    }).join('');
    return '<div class="fbar2' + (S.mFilt ? ' mopen' : '') + '"><button class="fb-mtog" data-act="mFilt">⚙ Filters' + (active ? ' <em>' + active + '</em>' : '') + '<span>' + (S.mFilt ? '▴' : '▾') + '</span></button>' + pairRow() + '<div class="fb2-row">' + ['mc', 'age', 'prog', 'tax'].map(inlineRange).join('') + '</div>' +
      '<div class="fb2-row sub">' + tg + '<span class="mono muted" style="margin-left:auto;font-size:12px" id="rpc-all">' + filtered().length + ' coins match</span>' + (active ? '<button class="freset" style="margin-left:10px" data-act="reset">Reset · ' + active + '</button>' : '') + '</div></div>';
  }
  function refreshGrid() {
    var list = filtered(), g = document.getElementById('grid'), cnt = document.getElementById('count');
    if (S.view === 'list' && S.screen === 'home') { var lt = document.querySelector('.ltable'); if (lt) lt.outerHTML = listHTML(list, true); }
    if (cnt) cnt.textContent = list.length + ' of ' + all().length + ' tokens';
    var ca = document.getElementById('rpc-all'); if (ca) ca.textContent = list.length + ' coins match';
    ['mc', 'age', 'prog', 'tax'].forEach(function (k) {
      var l = rLabel(k), e = document.getElementById('fcl-' + k); if (e) { e.textContent = l; }
      var v = document.getElementById('rpv-' + k); if (v) v.textContent = l;
      var f = document.getElementById('rpf-' + k); if (f) f.setAttribute('style', rFill(k));
      var c = document.getElementById('rpc-' + k); if (c) c.textContent = list.length + ' coins match';
      var ir = e && e.closest('.irange'); if (ir) ir.classList.toggle('on', l !== 'Any');
    });
    if (S.view === 'orbit') raceRefresh();
    if (g && S.view !== 'bubbles' && S.view !== 'list') g.innerHTML = list.length ? list.map(function (t) { return isMob() ? mrow(t) : card(t); }).join('') : '<div class="empty"><b style="font-size:19px">No coins in this range</b><span class="muted">Widen a slider or hit Reset.</span><button class="btn pri" data-act="reset">Reset filters</button></div>';
  }
  var SLOGANS = ['The market', 'is yours.'];
  var KIN = DEMO ? [['GOLD', 'gold'], ['$NFROG', 'frogs'], ['TSLAx', 'tesla'], ['SOL', 'solana'], ['$CHAD', 'chads'], ['EUR', 'euros'], ['BTC', 'bitcoin'], ['', 'anything.']] : [['SOL', 'solana'], ['USDC', 'dollars'], ['BTC', 'bitcoin'], ['', 'anything.']];
  var kinI = 0;
  setInterval(function () {
    var r = document.getElementById('kin-roll'); if (!r || document.hidden) return;
    kinI++; r.style.transition = 'transform .7s cubic-bezier(.7,-0.3,.25,1.3)'; r.style.transform = 'translateY(' + (-kinI * 100 / (KIN.length + 1)) + '%)';
    if (kinI === KIN.length) setTimeout(function () { r.style.transition = 'none'; kinI = 0; r.style.transform = 'translateY(0)'; }, 760);
  }, 2000);
  function tcHTML(t, k) {
    var c = chg(t), tm = Math.max(t.buy, t.sell), id = esc(t.tick);
    return '<div class="tc-in" role="button" tabindex="0" data-act="open" data-arg="' + id + '">' +
      '<span class="tc-av">' + avatarHTML(t, 84) + '<i class="tc-crown">♛</i></span>' +
      '<span class="tc-main"><span class="tc-k">TOP MEME <b>#' + (k + 1) + '</b></span><b class="tc-n">' + esc(t.name) + '</b><span class="tc-tk mono">$' + id + '</span>' +
        '<span class="tc-row"><span class="mono">' + fmtK(t.mcN) + '</span><span class="mono ' + (c >= 0 ? 'up' : 'down') + '">' + chgTxt(c) + '</span></span>' +
        '<span class="tc-bar"><i style="width:' + Math.min(100, t.prog) + '%"></i></span></span>' +
      '<span class="tc-side"><span class="tc-pair">' + coinHTML(t.pair, 26) + '<b>' + esc(pairLabel(t.pair)) + '</b></span><span class="tax" style="background:' + taxBg(tm) + '"><small>TAX</small><b>' + tm + '%</b></span></span></div>' + socialsHTML(t);
  }
  var tcI = 0;
  setInterval(function () {
    var el = document.getElementById('tc'); if (!el || document.hidden) return;
    if (!HERO.length) return; tcI = (tcI + 1) % HERO.length; var t = find(HERO[tcI]); if (!t) return;
    el.classList.add('out');
    setTimeout(function () { el.innerHTML = tcHTML(t, tcI) + '<span class="tc-timer"></span>'; el.classList.remove('out'); }, 260);
  }, 5000);
  function introHTML() {
    var st = stats(), fresh = all().slice().sort(function (a, b) { return b.born - a.born; }).slice(0, 3);
    var t0 = find(HERO[tcI]) || all()[0];
    return '<section class="intro3" id="intro"><div class="aurora"><span class="a1"></span><span class="a2"></span><span class="a3"></span></div>' +
      '<div class="i3-l">' +
        '<h1 class="kin"><span class="kin-a">pair with</span> <span class="kin-slot"><span class="kin-roll" id="kin-roll">' + KIN.concat([KIN[0]]).map(function (x) { return '<span class="kin-w">' + (x[0] ? (x[0].charAt(0) === '$' ? avatarHTML(find(x[0].slice(1)) || BASE[0], 64) : coinHTML(x[0], 64)) : '') + '<b>' + x[1] + '</b></span>'; }).join('') + '</span></span></h1>' +
        '<p class="i3-p"><b class="i3-slogan">Launch fair. Trade safer.</b> Pair your coin with anything — tax, dev bag and risks always on the label.</p>' +
        '<div class="i3-cta"><button class="btn pri" data-act="create">Launch a coin <span aria-hidden="true">→</span></button><button class="btn sec" data-act="board">Trade anything ↓</button></div></div>' +
      (t0 ? '<div class="tc" id="tc">' + tcHTML(t0, tcI) + '<span class="tc-timer"></span></div>' : '<div class="tc tc-empty"><b>No coins yet</b><small>Be the first — launch a coin in a minute.</small><button class="btn pri" data-act="create">Launch a coin →</button></div>') +
      '<div class="i2-live"><div class="i2-lh"><span class="livedot"></span>JUST LAUNCHED</div><div id="i2-fresh">' + fresh.map(i2Row).join('') + '</div></div>' +
    '</section>';
  }
  function i2Row(t) {
    return '<button class="i2-row" data-act="open" data-arg="' + esc(t.tick) + '">' + avatarHTML(t, 34) + '<span class="i2-n"><b>' + esc(t.name) + '</b><small>$' + esc(t.tick) + ' · ' + coinHTML(t.pair, 13) + esc(pairLabel(t.pair)) + '</small></span><span class="i2-age mono" data-t="' + t.born + '">' + ago(t.born) + '</span><span class="tax" style="background:' + taxBg(Math.max(t.buy, t.sell)) + ';min-width:38px;padding:3px 5px"><b style="font-size:12px">' + Math.max(t.buy, t.sell) + '%</b></span></button>';
  }
  document.addEventListener('mousemove', function (e) {
    var it = e.target.closest && e.target.closest('#intro'); if (!it) return;
    var r = it.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    var o = it.querySelector('.orbit3'); if (o) o.style.transform = 'rotateX(' + (62 - py * 10).toFixed(1) + 'deg) rotateZ(' + (px * 12).toFixed(1) + 'deg)';
    var a = it.querySelector('.aurora'); if (a) a.style.transform = 'translate(' + (px * -30).toFixed(1) + 'px,' + (py * -20).toFixed(1) + 'px)';
  });
  function home() {
    if (!DEMO && S.view === 'orbit') S.view = 'grid';

    var list = filtered(), PAGE = window.matchMedia && window.matchMedia('(max-width: 760px)').matches ? 8 : 12, fkey = [S.sort, S.view, S.pair, S.cat, S.maxTax, S.minProg, S.minMc, S.zeroOnly, S.gradOnly, S.rewardsOnly, S.watchOnly].join('|');
    if (S.shownKey !== fkey) { S.shownKey = fkey; S.shown = isMob() ? 25 : PAGE; }
    var shown = list.slice(0, S.shown || PAGE), more = list.length > shown.length ? '<div class="more-wrap"><button class="btn sec more-btn" data-act="showMore">Show more<span class="mono">' + shown.length + ' of ' + list.length + '</span></button>' + (list.length - shown.length > PAGE ? '<button class="link more-all" data-act="showAll">Show all</button>' : '') + '</div>' : '';
    var toolbar = '<div class="toolbar"><h2 class="h2">Tokens</h2>' + (DEMO ? '<span class="demo" data-tip="Market data is simulated until on-chain launch goes live.">DEMO DATA</span><button class="demo-img-btn" data-act="demoImgs">🖼 Try real images</button>' : '') + '<div class="seg">' + SORTS.map(function (s) {
      return '<button class="' + (S.sort === s[0] ? 'on' : '') + '" aria-pressed="' + (S.sort === s[0]) + '" data-act="sort" data-arg="' + s[0] + '">' + s[1] + '</button>';
    }).join('') + '</div><div class="seg" role="group" aria-label="View"><button class="' + (S.view === 'grid' ? 'on' : '') + '" data-act="view" data-arg="grid">Grid</button><button class="' + (S.view === 'bubbles' ? 'on' : '') + '" data-act="view" data-arg="bubbles">Bubbles</button>' + (DEMO ? '<button class="' + (S.view === 'orbit' ? 'on' : '') + '" data-act="view" data-arg="orbit">Orbit</button>' : '') + '<button class="' + (S.view === 'list' ? 'on' : '') + '" data-act="view" data-arg="list">List</button></div><span class="mono muted" style="margin-left:auto;font-size:12.5px" id="count">' + list.length + ' of ' + all().length + ' tokens</span></div>' +
      '';

    var filters = filterBar();

    var grid = (!S.loading && S.view === 'list') ? listHTML(shown, true) + more : (!S.loading && S.view === 'orbit') ? (function () { var a = list; return '<div class="orb-inline">' + orbitStage(a, a.filter(function (t) { return t.prog < 100; }), a.filter(function (t) { return t.prog >= 100; })) + '</div>'; })() : (!S.loading && S.view === 'bubbles') ? bubblesHTML(list) : '<section class="grid" id="grid">' + (S.loading ? [0, 1, 2, 3, 4, 5].map(skeletonCard).join('') : list.length ? shown.map(function (t) { return isMob() ? mrow(t) : card(t); }).join('') :
      (!DEMO && S.pair !== 'All' && !all().some(function (x) { return pairLabel(x.pair) === S.pair || x.pair === S.pair; }) ? '<div class="empty"><b style="font-size:19px">No coins paired with ' + esc(S.pair) + ' yet</b><span class="muted">Be the first — launch a coin that trades against ' + esc(S.pair) + '.</span><span style="display:flex;gap:8px;justify-content:center"><button class="btn pri" data-act="launchPair" data-arg="' + esc(S.pair) + '">Launch paired with ' + esc(S.pair) + '</button><button class="btn sec" data-act="pclear">Show all</button></span></div>' :
      '<div class="empty"><b style="font-size:19px">No tokens match these filters</b><span class="muted">Loosen the tax or market cap filters.</span><button class="btn pri" data-act="reset">Reset filters</button></div>')) + '</section>' + (S.loading ? '' : more);

    var how = '<section id="how" style="margin-top:56px"><h2 class="h2" style="margin-bottom:16px">How treid works</h2><div class="row">' +
      [['01', 'Pick a name & logo', 'Use the built-in mascot builder or upload your own image. Takes under a minute.'],
       ['02', 'Set your buy & sell tax', 'From 0% to 10%. The tax is shown on every card in colour, so traders always know the cost.'],
       ['03', 'Launch on a bonding curve', 'Price rises as people buy. When the curve fills, liquidity graduates to Meteora automatically.']].map(function (s) {
        return '<div class="card-s" style="flex:1 1 260px;padding:22px;display:flex;flex-direction:column;gap:8px"><span class="mono" style="color:var(--ice);font-size:13px">' + s[0] + '</span><b style="font-size:17px">' + s[1] + '</b><span class="muted" style="line-height:1.55">' + s[2] + '</span></div>';
      }).join('') + '</div></section>';

    var slogan = introHTML();
    return '<main class="wrap">' + slogan + trendStrip() + '<div id="board"></div>' + toolbar + filters + '<div class="layout full">' + grid + '</div>' + machineSection() + '</main>';
  }

  // ===== sliding "trending now" strip (persistent node, moved in on every render so the slide never jumps) =====
  var TS = { el: null, key: '', x: 0, last: 0, hover: false, at: 0 };
  function tsList() { return all().filter(function (t) { return !t.archived; }).sort(function (a, b) { return chgOver(b, 360) * Math.log10(b.vol * 1000 + 10) - chgOver(a, 360) * Math.log10(a.vol * 1000 + 10); }).slice(0, 14); }
  function tsCard(t, i) { var c = chgOver(t, 360), up = c >= 0;
    return '<button class="ts-card" data-act="open" data-arg="' + esc(t.tick) + '"><span class="ts-img">' + avatarHTML(t, 240) + '</span><span class="ts-rk mono">#' + (i + 1) + '</span>' + (vampOf(t) ? '<span class="ts-vamp" title="Possible copy">🧛</span>' : '') +
      '<span class="ts-bot"><b class="ts-n">' + esc(t.name) + '</b><span class="ts-r"><small class="mono">$' + esc(t.tick) + '</small><em class="mono ' + (up ? 'up' : 'down') + '">' + (up ? '▲ ' : '▼ ') + Math.abs(c).toFixed(1) + '%</em></span>' +
      '<span class="ts-r"><b class="mono ts-mc">' + fmtK(t.mcN) + '</b>' + lbSpark(t, 70, 22, 'ts' + i) + '</span><span class="ts-cv"><i style="width:' + Math.min(100, t.prog).toFixed(0) + '%"></i></span></span></button>'; }
  function tsMount() {
    var slot = document.getElementById('ts-slot'); if (!slot) return;
    if (!TS.el) { TS.el = document.createElement('div'); TS.el.className = 'ts-track'; TS.el.addEventListener('mouseenter', function () { TS.hover = true; }); TS.el.addEventListener('mouseleave', function () { TS.hover = false; }); requestAnimationFrame(tsTick); }
    var L = tsList(), key = L.map(function (t) { return t.tick; }).join(',');
    if (key !== TS.key || Date.now() - TS.at > 45e3) { var h = L.map(tsCard).join(''); TS.few = L.length < 6; TS.el.innerHTML = TS.few ? h : h + h; TS.key = key; TS.at = Date.now(); if (TS.few) { TS.x = 0; TS.el.style.transform = ''; } }
    var sec = slot.closest('.ts'); if (sec) sec.style.display = L.length ? '' : 'none'; var hint = sec && sec.querySelector('.ts-h .muted'); if (hint) hint.style.display = TS.few ? 'none' : '';
    if (TS.el.parentNode !== slot) slot.appendChild(TS.el);
  }
  function tsTick(now) { if (TS.el && TS.el.isConnected) { var dt = Math.min(64, now - (TS.last || now)); if (!TS.hover && !document.hidden && !TS.few) { TS.x -= dt * .045; var half = TS.el.scrollWidth / 2; if (half > 0 && -TS.x >= half) TS.x += half; TS.el.style.transform = 'translate3d(' + TS.x.toFixed(1) + 'px,0,0)'; } } TS.last = now; requestAnimationFrame(tsTick); }
  function trendStrip() { return '<section class="ts"><div class="ts-h"><b>🔥 trending now</b><span class="muted">point at it to stop it</span><button class="link" data-act="trendList">See all →</button></div><div class="ts-view" id="ts-slot"></div></section>'; }
  // ================= PRO TOKEN PAGE (pump.fun / dexscreener style) =================
  // ===== time-based chart engine (1m … 1d candles, zoom, pan, line/candles, MA, trade markers) =====
  var TFS = [['1M', '1m', 6e4], ['5M', '5m', 3e5], ['15M', '15m', 9e5], ['1H', '1h', 36e5], ['4H', '4h', 144e5], ['1D', '1d', 864e5]];
  function tfMs() { for (var i = 0; i < TFS.length; i++) if (TFS[i][0] === S.tf) return TFS[i][2]; return 6e4; }
  S.ctype = 'candle'; S.cma = true; S.cvol = true; S.cmarks = true; S.ccall = true; try { var cpf = JSON.parse(localStorage.getItem('dl.cmarks') || 'null'); if (cpf) { S.cmarks = cpf[0]; S.ccall = cpf[1]; S.cma = cpf[2] !== false; S.cvol = cpf[3] !== false; } } catch (e) {} S.czoom = 70; S.cpan = 0; S.cys = 1; S.cyo = 0; S.cfull = false;
  function ensureTicks(t) {
    if (t.tk) return t.tk;
    if (t.live) { var h0 = t.hist && t.hist.length ? t.hist : [t.mcN]; return [[t.born, h0[0], 0], [Date.now(), t.mcN, 0]]; }   // real coins: no made-up history; the real trades arrive when the coin is opened (liveLoad)
    var now = Date.now(), start = Math.max(t.born, now - 7 * 864e5), span = Math.max(60000, now - start), n = Math.min(2200, Math.max(30, Math.floor(span / 9000)));
    if (t.archived && t.span) { start = t.born; span = t.span; n = Math.min(1500, Math.max(60, Math.floor(span / 6000))); }
    var h = t.hist && t.hist.length ? t.hist : [t.mcN], r = rng(hash(t.tick + 'tk')), out = [];
    for (var i = 0; i < n - 1; i++) {
      var f = i / (n - 1), tf = t.archived ? f : 1 - Math.pow(1 - f, 2.2), idx = f * (h.length - 1), lo = Math.floor(idx), hi = Math.min(h.length - 1, lo + 1), base = h[lo] + (h[hi] - h[lo]) * (idx - lo);
      out.push([start + tf * span, Math.max(1, base * (1 + (r() - .5) * .035)), r() * r() * 2.4]);
    }
    out.push([now, t.mcN, .2]);
    t.tk = out; return out;
  }
  function candles(t) {
    var tk = ensureTicks(t), b = tfMs(), now = Date.now(), nowB = Math.floor(now / b), firstB = Math.floor(tk[0][0] / b), A = Math.max(1, nowB - firstB + 1), n = Math.max(6, Math.min(S.czoom, A + 1));
    S.cA = A; S.cEff = n; var endB = nowB - S.cpan, startB = endB - n + 1, pre = Math.max(0, firstB - startB), lo = 0, hi = tk.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (tk[m][0] < startB * b) lo = m + 1; else hi = m; }
    var k = lo, prevC = k > 0 ? tk[k - 1][1] : tk[0][1], out = [];
    var fut = Math.max(0, endB - Math.floor(now / b)); endB -= fut;
    for (var B = Math.max(startB, firstB); B <= endB; B++) {
      var o = prevC, h2 = o, l2 = o, c = o, v = 0, any = false, bt = B * b, be = bt + b;
      while (k < tk.length && tk[k][0] < be) { var x = tk[k]; if (x[0] >= bt) { any = true; h2 = Math.max(h2, x[1]); l2 = Math.min(l2, x[1]); c = x[1]; v += x[2]; } k++; }
      out.push({ o: o, h: h2, l: l2, c: c, v: v, t: bt, flat: !any }); prevC = c;
    }
    if (!out.length) { var c0 = tk[0][1]; out.push({ o: c0, h: c0, l: c0, c: c0, v: 0, t: endB * b, flat: true }); }
    // like a normal chart: minutes without trades get no candle — candles sit side by side (keep the live candle)
    var dense = out.filter(function (c, i) { return !c.flat || i === out.length - 1; }); if (dense.length < out.length) { var n2 = Math.min(n, Math.max(40, dense.length + fut + 2)); dense.fut = fut; dense.n = n2; dense.pre = Math.max(0, n2 - dense.length - fut); return dense; }   // few candles → wider candles, not slivers
    out.fut = fut; out.pre = Math.min(pre, n - out.length - fut); out.n = n; return out;
  }
  function yLabel(v, step) { if (S.chartMode === 'price') return fmtPrice(v * 1000 / 1e9); if (step != null && step < 0.1 && v < 1000) return '$' + Math.round(v * 1000).toLocaleString('en-US'); return fmtK(v); }
  function tLabel(ms) { var d = new Date(ms), p = function (x) { return (x < 10 ? '0' : '') + x; }; return tfMs() >= 864e5 ? (d.getMonth() + 1) + '/' + d.getDate() : p(d.getHours()) + ':' + p(d.getMinutes()); }
  // ===== TradingView Lightweight Charts engine (candles/line, volume, MA, trade + callout markers, avg entry/exit lines) =====
  S.cden = 'usd'; S.cscale = 0; try { var cpf2 = JSON.parse(localStorage.getItem('dl.cview') || 'null'); if (cpf2) { S.cden = cpf2[0] === 'sol' ? 'sol' : 'usd'; S.cscale = +cpf2[1] || 0; if (cpf2[2]) S.chartMode = cpf2[2] === 'price' ? 'price' : 'mc'; } } catch (e) {}
  function cviewSave() { try { localStorage.setItem('dl.cview', JSON.stringify([S.cden, S.cscale, S.chartMode])); } catch (e) {} }
  var LW = { chart: null, host: null, key: '', view: '', bars: [], marks: {}, lines: [] };
  var SUBD = '₀₁₂₃₄₅₆₇₈₉';
  function lwSmall(v) { if (!(v > 0)) return '0'; if (v >= 1) return v >= 1000 ? fmtNum(v) : v.toFixed(v < 10 ? 4 : 2); var s = v.toFixed(20).split('.')[1], z = s.match(/^0*/)[0].length, d = s.slice(z, z + 4).replace(/0+$/, '') || '0'; return z >= 4 ? '0.0' + String(z).split('').map(function (c) { return SUBD[+c]; }).join('') + d : '0.' + s.slice(0, z) + d; }
  function lwCompact(v) { var a = Math.abs(v), sg = v < 0 ? '-' : ''; if (a >= 1e9) return sg + (a / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return sg + (a / 1e6).toFixed(a < 1e7 ? 3 : 2) + 'M'; if (a >= 1e3) return sg + (a / 1e3).toFixed(a < 1e4 ? 3 : a < 1e5 ? 2 : 1) + 'K'; return sg + a.toFixed(a < 10 ? 3 : 2); }
  function lwFmt(v) { var usd = S.cden !== 'sol'; if (S.chartMode === 'price') return (usd ? '$' : '') + lwSmall(v); return (usd ? '$' : '') + lwCompact(v); }
  function lwConv(k) { var v = k * 1000; if (S.chartMode === 'price') v = v / 1e9; return S.cden === 'sol' ? v / SOL_USD : v; }   // tick value is market cap in $K
  function lwTime(ms) { return Math.floor(ms / 1000); }   // real UTC seconds; labels are formatted in local time below (shifting times breaks across DST)
  function lwP2(x) { return (x < 10 ? '0' : '') + x; }
  var LW_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function lwTimeFmt(ts) { var d = new Date(ts * 1000); return d.getDate() + ' ' + LW_MON[d.getMonth()] + ' ' + lwP2(d.getHours()) + ':' + lwP2(d.getMinutes()); }
  function lwTick(ts, type) { var d = new Date(ts * 1000); return type === 0 ? String(d.getFullYear()) : type === 1 ? LW_MON[d.getMonth()] : type === 2 ? String(d.getDate()) : lwP2(d.getHours()) + ':' + lwP2(d.getMinutes()); }
  function lwBars(t) {
    var tk = ensureTicks(t).slice().sort(function (a, z) { return a[0] - z[0]; }), b = tfMs(), out = [], cur = null, prevC = tk.length ? tk[0][1] : t.mcN;
    for (var i = 0; i < tk.length; i++) { var x = tk[i]; if (!(x[2] > 0) && i < tk.length - 1) { if (!cur && !out.length) prevC = x[1]; continue; }   // zero-volume ticks are price references, not trades
      var bt = Math.floor(x[0] / b) * b;
      if (!cur || cur.t !== bt) { if (cur) out.push(cur); cur = { t: bt, o: prevC, h: Math.max(prevC, x[1]), l: Math.min(prevC, x[1]), c: x[1], v: 0 }; }
      else { cur.h = Math.max(cur.h, x[1]); cur.l = Math.min(cur.l, x[1]); cur.c = x[1]; }
      cur.v += x[2] || 0; prevC = x[1]; }
    if (cur) out.push(cur);
    return out;
  }
  function lwEnsure() {
    if (LW.chart) return true; if (!window.LightweightCharts) return false;
    var C = window.LightweightCharts, host = document.createElement('div'); host.className = 'lwc-host';
    var ch = C.createChart(host, { autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8C8C93', fontSize: 11, fontFamily: "'JetBrains Mono', ui-monospace, monospace", attributionLogo: true },
      grid: { vertLines: { color: 'rgba(255,255,255,.035)' }, horzLines: { color: 'rgba(255,255,255,.035)' } },
      crosshair: { mode: C.CrosshairMode.Normal, vertLine: { color: 'rgba(255,255,255,.25)', labelBackgroundColor: '#2A2A2E' }, horzLine: { color: 'rgba(255,255,255,.25)', labelBackgroundColor: '#2A2A2E' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,.08)', scaleMargins: { top: .14, bottom: .24 } },
      timeScale: { borderColor: 'rgba(255,255,255,.08)', timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 9, minBarSpacing: 1.5 , tickMarkFormatter: lwTick },
      localization: { priceFormatter: lwFmt, timeFormatter: lwTimeFmt, locale: 'en-US' } });
    var pf = { type: 'custom', formatter: lwFmt, minMove: 1e-14 };
    LW.cs = ch.addCandlestickSeries({ upColor: '#3DDC97', downColor: '#F2708A', borderVisible: false, wickUpColor: '#3DDC97', wickDownColor: '#F2708A', priceFormat: pf });
    LW.ls = ch.addAreaSeries({ lineColor: '#3DDC97', topColor: 'rgba(61,220,151,.22)', bottomColor: 'rgba(61,220,151,0)', lineWidth: 2, priceFormat: pf, visible: false });
    LW.vs = ch.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    ch.priceScale('vol').applyOptions({ scaleMargins: { top: .8, bottom: 0 } });
    LW.ma = ch.addLineSeries({ color: 'rgba(216,195,160,.85)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: pf });
    ch.subscribeCrosshairMove(lwHover);
    ch.timeScale().subscribeVisibleLogicalRangeChange(function () { requestAnimationFrame(lwPlace); }); try { new ResizeObserver(function () { requestAnimationFrame(lwPlace); }).observe(host); } catch (e) {} setInterval(function () { if (LW.host && LW.host.isConnected && !document.hidden) lwPlace(); }, 400);
    ch.timeScale().subscribeVisibleLogicalRangeChange(function () { var b = document.getElementById('c-now'); if (b) b.style.display = ch.timeScale().scrollPosition() < -15 ? '' : 'none'; });
    LW.chart = ch; LW.host = host; return true;
  }
  function lwMain() { return S.ctype === 'line' ? LW.ls : LW.cs; }
  function lwAvg(t) {   // your average entry / exit market cap in USD (server stats first, then your own trades)
    if (!S.account) return null; var b = { u: 0, k: 0 }, s = { u: 0, k: 0 };
    S.trades.forEach(function (x) { if (x.tick !== t.tick || !(x.mine || x.wallet === S.account)) return; var px = x.price || price(t), usd = x.usd != null ? x.usd : x.sol * SOL_USD, tok = x.tokens || usd / px; var o = x.side === 'buy' ? b : s; o.u += usd; o.k += tok; });
    var ps = t.ca && S.myPs && S.myPs[t.ca], en = ps && ps.avgEntryMc > 0 ? ps.avgEntryMc : b.k > 0 ? b.u / b.k * 1e9 : 0, ex = ps && ps.avgExitMc > 0 ? ps.avgExitMc : s.k > 0 ? s.u / s.k * 1e9 : 0;   // exit at the market cap you sold at (not net of sell tax/fees)
    return en || ex ? { en: en, ex: ex } : null;
  }
  function lwMarks(t, bars) {
    var b = tfMs(), M = [], t0 = bars.length ? bars[0].t : 0, seen = {}; LW.marks = {};
    if (!bars.length) return M;
    if (S.cmarks) { seedDevTrades(t); var dev = devOf(t);
      S.trades.filter(function (x) { return x.tick === t.tick && x.t >= t0 && (x.mine || (S.account && x.wallet === S.account) || x.wallet === dev || x.sol >= 1); }).slice(0, 300).forEach(function (x) {
        var me = x.mine || (S.account && x.wallet === S.account), isDev = x.wallet === dev, buy = x.side === 'buy', bt = Math.floor(x.t / b) * b, cat = me ? 'Y' : isDev ? 'D' : 'W', key = bt + cat + (buy ? 'b' : 's');
        if (seen[key]) { LW.marks[seen[key]].n++; LW.marks[seen[key]].sol += x.sol; return; }
        var id = 'm' + M.length; seen[key] = id; LW.marks[id] = { k: 'tr', d: x, n: 1, sol: x.sol, cat: cat };
        M.push({ id: id, buy: buy, cat: cat, time: lwTime(bt), position: buy ? 'belowBar' : 'aboveBar', shape: 'circle', size: cat === 'W' ? .6 : 1, color: cat === 'Y' ? '#7FB6FF' : cat === 'D' ? (buy ? '#E8C26A' : '#FF9A5C') : (buy ? '#3DDC97' : '#F2708A'), text: (cat === 'Y' ? 'You ' : cat === 'D' ? 'Dev ' : '') + (buy ? 'B' : 'S') });
      }); }
    if (S.ccall) seedComments(t).filter(function (c) { return c.reply == null && c.t >= t0; }).slice(0, 40).forEach(function (c) {
      var bt = Math.floor(c.t / b) * b, key = bt + 'C'; if (seen[key]) return; var id = 'm' + M.length; seen[key] = id; LW.marks[id] = { k: 'co', d: c };
      M.push({ id: id, cat: 'C', time: lwTime(bt), position: 'aboveBar' });
    });
    var have = {}; bars.forEach(function (x) { have[lwTime(x.t)] = 1; });
    return M.filter(function (m) { return have[m.time]; }).sort(function (a, z) { return a.time - z.time; });
  }
  function lwUpdate(t) {
    if (!t || !LW.chart) return;
    var bars = lwBars(t), main = lwMain(), last = bars[bars.length - 1], av = lwAvg(t);
    var view = [t.tick, S.tf, S.chartMode, S.cden, S.ctype].join('|'), key = view + '|' + bars.length + '|' + (last ? last.c + ':' + last.v : '') + '|' + S.cma + S.cvol + S.cmarks + S.ccall + '|' + S.trades.length + '|' + (av ? av.en + ':' + av.ex : '') + '|' + S.cscale;
    if (key === LW.key) return; var fresh = view !== LW.view; LW.key = key; LW.view = view; LW.bars = bars;
    var up = last ? last.c >= (bars[0] || last).o : true, lc = up ? '#3DDC97' : '#F2708A';
    LW.cs.applyOptions({ visible: S.ctype !== 'line' }); LW.ls.applyOptions({ visible: S.ctype === 'line', lineColor: lc, topColor: up ? 'rgba(61,220,151,.22)' : 'rgba(242,112,138,.22)', bottomColor: 'rgba(0,0,0,0)' });
    var cd = bars.map(function (x) { return { time: lwTime(x.t), open: lwConv(x.o), high: lwConv(x.h), low: lwConv(x.l), close: lwConv(x.c) }; });
    LW.cs.setMarkers([]); LW.ls.setMarkers([]); LW.lines.forEach(function (l) { try { l.s.removePriceLine(l.l); } catch (e) {} }); LW.lines = [];
    LW.cs.setData(cd); LW.ls.setData(cd.map(function (x) { return { time: x.time, value: x.close }; }));
    var vm = S.cden === 'sol' ? 1 : SOL_USD;
    LW.vs.applyOptions({ visible: !!S.cvol }); LW.vs.setData(bars.map(function (x) { return { time: lwTime(x.t), value: x.v * vm, color: x.c >= x.o ? 'rgba(61,220,151,.35)' : 'rgba(242,112,138,.35)' }; }));
    var ma = []; if (cd.length > 5) { var per = Math.min(20, Math.max(3, Math.floor(cd.length / 2))), sum = 0; for (var i = 0; i < cd.length; i++) { sum += cd[i].close; if (i >= per) sum -= cd[i - per].close; if (i >= per - 1) ma.push({ time: cd[i].time, value: sum / per }); } }
    LW.ma.setData(ma); LW.ma.applyOptions({ visible: !!S.cma });
    LW.M = lwMarks(t, bars); LW.byT = {}; bars.forEach(function (x) { LW.byT[lwTime(x.t)] = x; }); requestAnimationFrame(lwPlace);
    if (av) { var mcv = function (u) { var v = S.chartMode === 'price' ? u / 1e9 : u; return S.cden === 'sol' ? v / SOL_USD : v; };
      if (av.en) LW.lines.push({ s: main, l: main.createPriceLine({ price: mcv(av.en), color: '#5AA8FF', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Avg entry ' + lwFmt(mcv(av.en)) }) });
      if (av.ex) LW.lines.push({ s: main, l: main.createPriceLine({ price: mcv(av.ex), color: '#FF9A3C', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Avg exit ' + lwFmt(mcv(av.ex)) }) }); }
    LW.chart.priceScale('right').applyOptions({ mode: S.cscale });
    if (fresh) { var tsc = LW.chart.timeScale(); tsc.applyOptions({ barSpacing: 9 }); tsc.scrollToRealTime(); requestAnimationFrame(function () { if (LW.chart) LW.chart.timeScale().scrollToRealTime(); }); LW.chart.priceScale('right').applyOptions({ autoScale: true }); }
    lwLegend(null);
  }
  function lwLegend(bar) {
    var el = document.getElementById('c-ohlc'); if (!el) return; var t = find(S.tick); if (!t) return;
    var b = bar || LW.bars[LW.bars.length - 1]; if (!b) { el.innerHTML = ''; return; }
    var ch = b.o ? (b.c - b.o) / b.o * 100 : 0, cl = ch >= 0 ? 'up' : 'down', f = function (k) { return lwFmt(lwConv(k)); };
    el.innerHTML = 'O <b class="' + cl + '">' + f(b.o) + '</b> H <b class="' + cl + '">' + f(b.h) + '</b> L <b class="' + cl + '">' + f(b.l) + '</b> C <b class="' + cl + '">' + f(b.c) + '</b> <b class="' + cl + '">' + (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%</b>' +
      (S.cvol ? ' <span class="c-vl">Vol <b>' + (S.cden === 'sol' ? b.v.toFixed(2) + ' SOL' : '$' + lwCompact(b.v * SOL_USD)) + '</b></span>' : '');
  }
  function lwBarAt(time) { for (var i = LW.bars.length - 1; i >= 0; i--) if (lwTime(LW.bars[i].t) === time) return LW.bars[i]; return null; }
  function lwHover(p) { lwLegend(p && p.time != null ? lwBarAt(p.time) : null); }
  function lwPlace() {   // our own markers: B / S coins in the candle's colour, anchored to the candle, stacked when several share one
    var box = document.getElementById('c-mk'); if (!box || !LW.chart || !LW.M) return; var main = lwMain(), ts = LW.chart.timeScale(), st = {}, h = '', W = box.clientWidth;
    LW.M.forEach(function (m) { var bar = LW.byT[m.time]; if (!bar) return; var x = ts.timeToCoordinate(m.time); if (x == null || x < -10 || x > W - 60) return;
      var below = m.position === 'belowBar', y = main.priceToCoordinate(lwConv(below ? bar.l : bar.h)); if (y == null) return; var k = m.time + (below ? 'b' : 'a'), n = st[k] = (st[k] || 0) + 1;
      y = below ? y + 13 + (n - 1) * 21 : y - 13 - (n - 1) * 21; var mk = LW.marks[m.id], big = mk && mk.sol >= 1;
      h += '<span class="lm ' + (m.cat === 'C' ? 'co' : m.buy ? 'b' : 's') + (m.cat === 'Y' ? ' me' : m.cat === 'D' ? ' dev' : '') + (big ? ' big' : '') + '" data-act="lwMk" data-arg="' + m.id + '" style="left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px">' + (m.cat === 'C' ? A.svg(walletSpec(mk.d.w)) : m.buy ? 'B' : 'S') + '</span>'; });
    if (box._h !== h) { box.innerHTML = h; box._h = h; }
  }
  function lwTip(id, el) {
    var tip = document.getElementById('cmtip'), t = find(S.tick), m = LW.marks[id]; if (!tip || !t || !m) return;
    var w = m.k === 'tr' ? m.d.wallet : m.d.w, me = S.account && w === S.account, h = '<div class="ct-h"><span class="av" style="width:30px;height:30px">' + A.svg(walletSpec(w)) + '</span><span class="ct-n"><b>' + esc(me ? 'You' : walletName(w)) + '</b><small class="mono">' + short(w) + '</small></span>' + (w === devOf(t) ? '<span class="bdg dev">DEV</span>' : '') + (me ? '<span class="bdg you">YOU</span>' : '') + '</div>';
    if (m.k === 'tr') { var x = m.d, buy = x.side === 'buy', usd = m.n > 1 ? m.sol * SOL_USD : (x.usd != null ? x.usd : x.sol * SOL_USD), tok = x.tokens || usd / (x.price || price(t));
      h += '<div class="ct-side ' + (buy ? 'b' : 's') + '">' + (me ? (buy ? 'You bought' : 'You sold') : (buy ? 'Bought' : 'Sold')) + ' <b class="mono">' + m.sol.toFixed(3) + ' SOL</b><span class="mono">≈ $' + money(usd) + '</span></div>' +
        (m.n > 1 ? '<div class="ct-f">' + m.n + ' trades in this candle</div>' : '<div class="ct-g"><span><small>Tokens</small><b class="mono">' + fmtNum(Math.round(tok)) + '</b></span><span><small>At MC</small><b class="mono">' + fmtK((x.price || price(t)) * 1e9 / 1000) + '</b></span><span><small>When</small><b class="mono">' + ago(x.t) + ' ago</b></span></div>'); }
    else h += '<div class="ct-co big">“' + esc(m.d.text.length > 140 ? m.d.text.slice(0, 140) + '…' : m.d.text) + '”</div><div class="ct-f">click to open the callout</div>';
    tip.innerHTML = h; tip.classList.add('on'); var bx = document.getElementById('chart').getBoundingClientRect(), r = el.getBoundingClientRect(), x0 = r.left - bx.left + r.width / 2;
    tip.style.left = Math.max(4, Math.min(bx.width - 254, x0 - 125)) + 'px'; tip.style.top = (r.bottom - bx.top + 160 > bx.height ? Math.max(4, r.top - bx.top - tip.offsetHeight - 8) : r.bottom - bx.top + 8) + 'px';
  }
  function lwMkClick(id) { var m = LW.marks[id], t = find(S.tick); if (!m || !t) return; if (m.k === 'tr') { S.hmap = null; set({ walletView: m.d.wallet }); } else if (m.d.real) set({ screen: 'callout', coView: { tick: t.tick, id: m.d.id } }); else set({ tpTab: 'thread' }); }
  function lwMount() {
    var box = document.getElementById('chart'), t = find(S.tick); if (!box || !t || !lwEnsure()) return;
    if (LW.host.parentNode !== box) { box.insertBefore(LW.host, box.firstChild); LW.key = ''; }
    lwUpdate(t);
  }
  function chartSVG(t) {   // overlays only — the chart itself is a persistent canvas moved in by lwMount()
    if (!window.LightweightCharts) return '<div class="route-wait"><b>Chart failed to load</b><small class="muted">refresh the page</small></div>';
    var full = S.chartMode === 'price' ? 'Price' : 'Market Cap';
    return '<div class="c-legend"><div class="c-lt"><b>$' + esc(t.tick) + '/' + esc(pairLabel(t.pair)) + '</b> <span class="muted">' + full + ' (' + (S.cden === 'sol' ? 'SOL' : 'USD') + ') · ' + esc((TFS.filter(function (x) { return x[0] === S.tf; })[0] || TFS[0])[1]) + ' · treid</span></div><div class="c-ohlc mono" id="c-ohlc"></div></div>' +
      '<div class="c-scale"><button class="' + (S.cscale === 2 ? 'on' : '') + '" data-act="cscale" data-arg="2" title="Percent scale">%</button><button class="' + (S.cscale === 1 ? 'on' : '') + '" data-act="cscale" data-arg="1" title="Log scale">log</button><button data-act="cauto" title="Auto-fit price scale">auto</button></div>' +
      '<div class="c-mk" id="c-mk"></div><button class="c-live" id="c-now" data-act="cnow" style="display:none">Back to now →</button><div class="cm-tip" id="cmtip"></div>';
  }
  function chartRedraw() { lwMount(); }
  function chartToolbar(t) {
    var seg = function (cur, items, actn) { return '<div class="seg">' + items.map(function (x) { return '<button class="' + (cur === x[0] ? 'on' : '') + '" data-act="' + actn + '" data-arg="' + x[0] + '"' + (x[2] ? ' title="' + x[2] + '"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>'; };
    return '<div class="chart-tb"><div class="seg tfseg">' + TFS.map(function (x) { return '<button class="' + (S.tf === x[0] ? 'on' : '') + '" data-act="tf" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      seg(S.ctype, [['candle', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3v4M7 17v4M17 5v3M17 16v3"/><rect x="4" y="7" width="6" height="10" rx="1"/><rect x="14" y="8" width="6" height="8" rx="1"/></svg>', 'Candles'], ['line', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/></svg>', 'Line']], 'ctype') +
      seg(S.chartMode, [['price', 'Price'], ['mc', 'MCap']], 'cmode') + seg(S.cden, [['usd', 'USD'], ['sol', 'SOL']], 'cden') +
      '<div class="ctog">' + [['cma', 'MA', S.cma], ['cvol', 'Vol', S.cvol], ['cmarks', 'Trades', S.cmarks], ['ccall', 'Callouts', S.ccall]].map(function (x) { return '<button class="' + (x[2] ? 'on' : '') + '" data-act="ctog" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<button class="iconbtn c-rs" data-act="czoom" data-arg="reset" title="Reset view">⟲</button>' +
      '<button class="iconbtn c-fs" data-act="cfull" aria-label="Fullscreen chart" title="Fullscreen">' + (S.cfull ? '✕' : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>') + '</button></div>';
  }
  // wallets pool so makers repeat (enables top traders / holders / maker filter)
  var HANDLES = ['degenfrog', 'solsurfer', 'paperhands', 'gemhunter', 'moonboi', 'bagholder', 'chartwizard', 'apeszn', 'diamondpaws', 'rugless', 'sniperjoe', 'whalewatch'];
  var WALLETS = []; for (var wi = 0; wi < 90; wi++) WALLETS.push({ a: b58(44), n: wi < HANDLES.length ? HANDLES[wi] : null, sp: { kind: pick(A.KINDS), skin: pick(A.SKINS), bg: pick(A.BGS), eyes: pick(A.EYES), mouth: pick(A.MOUTHS), acc: pick(A.ACCS) } });
  var WMAP = {}; WALLETS.forEach(function (w) { WMAP[w.a] = w; });
  function pickWallet() { return Math.random() < 0.88 ? WALLETS[Math.floor(Math.pow(Math.random(), 1.4) * WALLETS.length)].a : b58(44); }
  function devOf(t) { return t.creator || (t._dev = t._dev || WALLETS[hash(t.tick) % WALLETS.length].a); }
  function walletSpec(addr) { var w = WMAP[addr]; if (w) return w.sp; var h = hash(addr || 'x'); return { kind: A.KINDS[h % A.KINDS.length], skin: A.SKINS[(h >> 3) % A.SKINS.length], bg: A.BGS[(h >> 6) % A.BGS.length], eyes: A.EYES[(h >> 9) % A.EYES.length], mouth: A.MOUTHS[(h >> 12) % A.MOUTHS.length], acc: A.ACCS[(h >> 15) % A.ACCS.length] }; }
  function walletName(addr) { var w = WMAP[addr]; return S.account && addr === S.account ? 'You' : w && w.n ? '@' + w.n : short(addr); }
  // ---- trader hover card (DexScreener-style): bought / sold / PnL / unrealized for one wallet on this coin ----
  var TIERS = [[100, 'Shrimp', '#FF9A8B', 'under $100 bought or sold'], [1000, 'Fish', '#7FB6FF', '$100–$1k bought or sold'], [10000, 'Dolphin', '#5AC8E8', '$1k–$10k bought or sold'], [Infinity, 'Whale', '#B794FF', '$10k+ bought or sold']];
  function tierSVG(c, k) { var sc = [0.7, 0.85, 1, 1.15][k]; return '<svg viewBox="0 0 32 32" width="' + Math.round(26 * sc) + '" height="' + Math.round(26 * sc) + '"><path fill="' + c + '" d="M4 17c3-6 9-9 15-8 3 .5 5 2 7 4l3-3v12l-3-3c-2 2-4 3.5-7 4-6 1-12-2-15-6z"/><circle cx="21" cy="15" r="1.4" fill="#0b0b0d"/></svg>'; }
  function traderStats(t, addr) {
    var o = { bU: 0, bT: 0, bN: 0, sU: 0, sT: 0, sN: 0, first: 0 }, px = price(t);
    S.trades.forEach(function (x) { if (x.tick !== t.tick || x.wallet !== addr) return; var usd = x.usd != null ? +x.usd : x.sol * SOL_USD, tok = x.tokens || (usd / (x.price || px));
      if (x.side === 'buy') { o.bU += usd; o.bT += tok; o.bN++; if (!o.first || x.t < o.first) o.first = x.t; } else { o.sU += usd; o.sT += tok; o.sN++; } });
    var held = Math.max(0, o.bT - o.sT); if (t.live && t.lh) { var h = t.lh.filter(function (q) { return q.wallet === addr; })[0]; held = h ? h.pct / 100 * 1e9 : 0; } else if (S.account === addr && S.pos[t.tick]) held = S.pos[t.tick].tok;
    o.held = held; o.unreal = held * px; o.pnl = o.sU - o.bU; var vol = o.bU + o.sU; o.tier = 0; while (vol >= TIERS[o.tier][0]) o.tier++; return o;
  }
  function traderCard(t, addr) {
    var o = traderStats(t, addr), T = TIERS[o.tier], usd = function (v) { return '$' + (v >= 1000 ? fmtNum(Math.round(v)) : v.toFixed(v < 10 ? 2 : 0)); };
    var pct = o.bT > 0 ? Math.min(100, o.held / o.bT * 100) : 0, w = WMAP[addr], me = S.account && addr === S.account, dev = addr === devOf(t);
    var row = function (lab, val, cls, tok, tx) { return '<div class="trc-r"><span class="trc-l">' + lab + '</span><b class="trc-v mono ' + cls + '">' + val + '</b>' + (tok != null ? '<span class="trc-t mono">' + tok + '</span><span class="trc-n mono">' + tx + '</span>' : '') + '</div>'; };
    return '<div class="trc-rows">' +
      row('(−) Bought', usd(o.bU), 'down', fmtNum(o.bT), o.bN + ' txn' + (o.bN === 1 ? '' : 's')) +
      row('(+) Sold', usd(o.sU), 'up', fmtNum(o.sT), o.sN + ' txn' + (o.sN === 1 ? '' : 's')) +
      row('(=) PnL', usd(Math.abs(o.pnl)), o.pnl > 0 ? 'up' : o.pnl < 0 ? 'down' : '') +
      '<div class="trc-r"><span class="trc-l">Unrealized</span><b class="trc-v mono">' + usd(o.unreal) + '</b><span class="trc-u"><small class="mono">' + fmtNum(o.held) + ' <i>of</i> ' + fmtNum(o.bT) + '</small><span class="trc-bar"><i style="width:' + pct.toFixed(1) + '%"></i></span></span></div></div>' +
      '<div class="trc-who"><span class="trc-ic" style="--tc:' + T[2] + '">' + tierSVG(T[2], o.tier) + '</span><span class="trc-wi"><span class="trc-nm"><b class="mono">' + (me ? 'You' : w && w.n ? '@' + esc(w.n) : esc(addr.slice(0, 6) + '…' + addr.slice(-4))) + '</b>' + (dev ? '<span class="bdg dev">DEV</span>' : '') + (me && !dev ? '<span class="bdg you">YOU</span>' : '') + '</span><small><b style="color:' + T[2] + '">' + T[1] + '</b> · ' + T[3] + '</small><small>' + (o.first ? 'Holder since ' + ago(o.first) : 'No buys on this coin yet') + '</small></span></div>';
  }
  var tcEl = null, tcFor = null;
  document.addEventListener('mouseover', function (e) {
    var m = null;   // replaced by the wallet preview card (.wpv)
    if (!m) { if (tcEl && !(e.target.closest && e.target.closest('.trader-card'))) { tcEl.remove(); tcEl = null; tcFor = null; } return; }
    if (S.screen !== 'token' || window.matchMedia('(max-width: 760px)').matches) return;
    var addr = m.getAttribute('data-arg'), t = find(S.tick); if (!t || tcFor === m) return;
    if (tcEl) tcEl.remove(); tcFor = m; tcEl = document.createElement('div'); tcEl.className = 'trader-card'; tcEl.innerHTML = traderCard(t, addr); document.body.appendChild(tcEl);
    var r = m.getBoundingClientRect(), cw = tcEl.offsetWidth, ch = tcEl.offsetHeight, x = Math.min(window.innerWidth - cw - 12, r.right + 10), y = Math.max(8, Math.min(window.innerHeight - ch - 8, r.top - ch / 2 + r.height / 2));
    tcEl.style.left = x + 'px'; tcEl.style.top = y + 'px';
  });
  document.addEventListener('scroll', function () { if (tcEl) { tcEl.remove(); tcEl = null; tcFor = null; } }, true);
  function makerHTML(addr, t) {
    var w = WMAP[addr], me = S.account && addr === S.account, dev = addr === devOf(t);
    var av = '<span class="av" style="width:20px;height:20px">' + A.svg(walletSpec(addr)) + '</span>';
    return '<button class="maker" data-act="wallet" data-arg="' + esc(addr) + '" title="Open wallet">' + av + '<span>' + (me ? 'You' : w && w.n ? '@' + w.n : short(addr)) + '</span>' +
      (dev ? '<span class="bdg dev">DEV</span>' : '') + (me ? '<span class="bdg you">YOU</span>' : '') + '</button>';
  }
  S.pos = {}; S.tpFilter = 'all'; S.tpMaker = null; S.minSol = ''; S.absTime = false; S.chartMode = 'mc'; S.slip = 5; S.slipOpen = false; S.tpQueue = 0; S.comments = {};
  function tradeMatches(tr) {
    if (S.tpMaker && tr.wallet !== S.tpMaker) return false;
    if (S.tpFilter === 'buy' && tr.side !== 'buy') return false;
    if (S.tpFilter === 'sell' && tr.side !== 'sell') return false;
    if (S.tpFilter === 'whale' && tr.sol < 2) return false;
    if (S.tpFilter === 'mine' && !tr.mine) return false;
    var m = parseFloat(S.minSol); if (m > 0 && tr.sol < m) return false;
    return true;
  }
  function timeTxt(ts) { if (!S.absTime) return ago(ts); var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
  function tradeRow(tr, t, enter) {
    var buy = tr.side === 'buy', usd = tr.usd != null ? tr.usd : tr.sol * SOL_USD, w = Math.min(100, usd / (5 * SOL_USD) * 100), px = tr.price || price(t), tok = tr.tokens || usd / px;
    return '<div class="trow ' + (buy ? 'b' : 's') + (enter ? ' enter' : '') + (usd >= 2 * SOL_USD ? ' big' : '') + '" style="--w:' + w.toFixed(0) + '%" data-act="wallet" data-arg="' + esc(tr.wallet) + '" title="Open wallet">' +
      '<span class="muted" data-t="' + tr.t + '">' + timeTxt(tr.t) + '</span>' +
      '<span class="ty">' + (buy ? 'Buy' : 'Sell') + (usd >= 2 * SOL_USD ? ' <span class="bdg whale2" title="Whale">' + I.gem + '</span>' : '') + '</span>' +
      '<span class="r">$' + (usd >= 1000 ? (usd / 1000).toFixed(2) + 'K' : usd.toFixed(2)) + '</span>' +
      '<span class="r">' + (tr.sol >= 1000 ? fmtNum(tr.sol) : tr.sol.toFixed(3)) + '</span><span class="r">' + fmtNum(tok) + '</span><span class="r">' + fmtPrice(px) + '</span>' +
      '<span class="mk-cell">' + makerHTML(tr.wallet, t) + '<button class="mk-f' + (S.tpMaker === tr.wallet ? ' on' : '') + '" data-act="maker" data-arg="' + (S.tpMaker === tr.wallet ? '' : esc(tr.wallet)) + '" title="' + (S.tpMaker === tr.wallet ? 'Show all wallets' : 'Only this wallet\'s trades') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg></button></span>' +
      '<span class="r"><button class="txb" data-act="wallet" data-arg="' + esc(tr.wallet) + '" aria-label="Open wallet details"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button></span></div>';
  }
  function holdersOf(t) {
    if (t.live && !t.lh) return [{ a: 'curve', pct: 100, label: 'Loading holders…', kind: 'curve' }];   // real coins: never invented wallets
    if (t.live && t.lh) { var cv = t.lh.filter(function (x) { return x.curve; }).reduce(function (a, x) { return a + x.pct; }, 0), tagOf = {}; S.trades.forEach(function (x) { if (x.tick === t.tick && x.side === 'buy') { var g = tagOf[x.wallet] || (tagOf[x.wallet] = { first: x.t }); g.first = Math.min(g.first, x.t); if (x.sniper) g.sn = 1; if (x.bundle) g.bu = 1; } });
      return [{ a: 'curve', pct: cv || Math.max(0, 100 - t.lh.reduce(function (a, x) { return a + (x.curve ? 0 : x.pct); }, 0)), label: 'Bonding curve', kind: 'curve' }].concat(t.lh.filter(function (x) { return !x.curve; }).slice(0, 60).map(function (x) { var g = tagOf[x.wallet] || {}, tg = []; if (x.dev) tg.push('dev'); if (S.account && x.wallet === S.account) tg.push('you'); if (g.sn) tg.push('sniper'); if (g.bu) tg.push('bundle'); return { a: x.wallet, pct: x.pct, tags: tg, first: g.first || t.born, ps: psClean(x.ps) }; })); }
    var rm = riskMetrics(t), devP = rm[0].val === 'SOLD' ? 0 : parseFloat(rm[0].val), top = parseFloat(rm[1].val), sn = parseFloat(rm[2].val), bu = parseFloat(rm[3].val);
    if (t.devPct != null) { var lb2 = liveBal(t); if (lb2.length) { var held = lb2.reduce(function (a, x) { return a + x.pct; }, 0), o3 = [{ a: 'curve', pct: Math.max(0, 100 - held), label: 'Bonding curve', kind: 'curve' }];
      lb2.slice(0, 40).forEach(function (x) { var tg = []; if (x.a === t.creator) tg.push('dev'); if (S.account && x.a === S.account) tg.push('you'); o3.push({ a: x.a, pct: x.pct, tags: tg, first: (S.trades.filter(function (q) { return q.tick === t.tick && q.wallet === x.a; }).pop() || {}).t || t.born }); }); return o3; } }
    if (t.devPct != null && t.holders <= 3) { var o2 = [{ a: 'curve', pct: 100 - t.devPct, label: 'Bonding curve', kind: 'curve' }]; if (t.devPct > 0) o2.push({ a: t.creator || devOf(t), pct: t.devPct, tags: ['dev'].concat(S.account && t.creator === S.account ? ['you'] : []), first: t.born }); return o2; }
    var r = rng(hash(t.tick + 'hold')), dev = devOf(t), out = [], used = {}, B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    var fa = function () { var x = ''; for (var q = 0; q < 44; q++) x += B58[Math.floor(r() * 58)]; return x; };
    var poolP = t.prog < 100 ? Math.max(8, 100 - (10 + t.prog * .75)) : 20.6;
    out.push({ a: t.prog < 100 ? 'curve' : 'pool', pct: poolP, label: t.prog < 100 ? 'Bonding curve' : 'Meteora pool', kind: 'curve' });
    // top 10 wallets share `top` %, power-law split
    var w = [], sum = 0; for (var i = 0; i < 10; i++) { var x = Math.pow(.72, i) * (.8 + r() * .4); w.push(x); sum += x; }
    var top10 = [], snLeft = sn, buLeft = bu, buGroup = 0;
    for (var k = 0; k < 10; k++) {
      var pct = w[k] / sum * top, a = k === 0 && devP > 0 ? null : WALLETS[(hash(t.tick + k) >>> 0) % WALLETS.length].a;
      var h = { a: a, pct: pct, tags: [], first: Date.now() - (t.born ? (Date.now() - t.born) * (0.05 + r() * .9) : 3600e3) };
      if (!a || used[a]) h.a = fa();
      used[h.a] = 1; top10.push(h);
    }
    if (devP > 0) { top10.sort(function (a, b) { return b.pct - a.pct; }); var di = Math.min(9, Math.floor(r() * 6)); top10[di].a = dev; top10[di].pct = devP; top10[di].tags.push('dev'); }
    top10.forEach(function (h) { if (h.tags.length) return; if (snLeft > 1.2 && r() < .45) { h.tags.push('sniper'); snLeft -= h.pct; h.first = t.born + 2000 + r() * 4000; } else if (buLeft > 1.2 && r() < .35) { h.tags.push('bundle'); buLeft -= h.pct; h.first = t.born + 400; buGroup++; } });
    var minTop = Math.min.apply(null, top10.map(function (h) { return h.pct; })), rest = [];
    for (var m = 0; m < 10; m++) rest.push({ a: fa(), pct: minTop * Math.pow(.84, m + 1) * (.85 + r() * .1), tags: [], first: Date.now() - (Date.now() - t.born) * r() });
    var pos = position(t); if (pos && S.account) rest.unshift({ a: S.account, pct: Math.max(.01, pos.tok / 1e9 * 100), tags: ['you'], first: Date.now() - 60000 });
    return out.concat(top10.sort(function (a, b) { return b.pct - a.pct; }), rest.sort(function (a, b) { return b.pct - a.pct; }));
  }
  function holdersTab(t) {
    var hs = holdersOf(t), curve = hs[0], wallets = hs.slice(1), top10 = 0, devP = 0, snP = 0, buP = 0, mc = t.mcN * 1000;
    wallets.slice(0, 10).forEach(function (h) { top10 += h.pct; });
    wallets.forEach(function (h) { if (h.tags.indexOf('dev') > -1) devP += h.pct; if (h.tags.indexOf('sniper') > -1) snP += h.pct; if (h.tags.indexOf('bundle') > -1) buP += h.pct; });
    var shades = ['#EDE9E1', '#CFC9BE', '#B3ADA2', '#989388', '#7F7A71', '#69655D', '#57534D', '#48453F', '#3C3A35', '#33312D'];
    function colOf(h, i) { return h.kind === 'curve' ? 'curve' : h.tags.indexOf('dev') > -1 ? '#F2708A' : h.tags.indexOf('sniper') > -1 ? '#FF9A4D' : h.tags.indexOf('bundle') > -1 ? '#B794FF' : h.tags.indexOf('you') > -1 ? '#3DDC97' : shades[Math.min(9, i)]; }
    var shown = 0, segs = '<i class="hseg curve" style="flex:' + curve.pct.toFixed(2) + '" title="' + curve.label + ' ' + curve.pct.toFixed(1) + '%"><span>' + (t.prog < 100 ? 'CURVE' : 'POOL') + '</span></i>';
    wallets.slice(0, 10).forEach(function (h, i) { shown += h.pct; segs += '<i class="hseg" style="flex:' + h.pct.toFixed(2) + ';background:' + colOf(h, i) + '" title="' + esc(h.a === S.account ? 'You' : short(h.a)) + ' ' + h.pct.toFixed(2) + '%"></i>'; });
    segs += '<i class="hseg rest" style="flex:' + Math.max(0, 100 - curve.pct - shown).toFixed(2) + '" title="Everyone else"></i>';
    var lvc = function (v, a, b) { return v < a ? 'g' : v < b ? 'y' : 'r'; };
    var tiles = [['Holders', fmtNum(t.holders), ''], ['Top 10', top10.toFixed(1) + '%', lvc(top10, 30, 45)], ['Dev', devP ? devP.toFixed(1) + '%' : 'sold', devP ? lvc(devP, 3, 8) : 'r'], ['Snipers', snP.toFixed(1) + '%', lvc(snP, 5, 12)], ['Bundles', buP.toFixed(1) + '%', lvc(buP, 4, 9)], [t.prog < 100 ? 'Unsold in curve' : 'In pool', curve.pct.toFixed(1) + '%', 'c']];
    var legend = [['curve', t.prog < 100 ? 'Bonding curve' : 'Meteora pool'], ['#F2708A', 'Dev'], ['#FF9A4D', 'Sniper'], ['#B794FF', 'Bundle'], ['#3DDC97', 'You'], ['#CFC9BE', 'Holders'], ['rest', 'Everyone else']];
    var TAG = { dev: 'DEV', sniper: 'SNIPER', bundle: 'BUNDLE', you: 'YOU' };
    var rows = hs.map(function (h, i) {
      var c = colOf(h, i - 1), isC = h.kind === 'curve', val = mc * h.pct / 100;
      var who = isC ? '<span class="hw-ic curve"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="rgba(216,195,160,.2)" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="#D8C3A0" stroke-width="4" stroke-dasharray="' + (Math.min(100, t.prog) * .942).toFixed(1) + ' 94.2" transform="rotate(-90 18 18)" stroke-linecap="round"/></svg></span><span class="hw-n"><b>' + h.label + '</b><small>' + (t.prog < 100 ? 'unsold supply · ' + Math.min(100, t.prog).toFixed(0) + '% of curve filled' : 'liquidity locked in the pool') + '</small></span>'
        : '<span class="av" style="width:28px;height:28px">' + A.svg(walletSpec(h.a)) + '</span><span class="hw-n"><b class="mono">' + (h.a === S.account ? 'You' : WMAP[h.a] && WMAP[h.a].n ? '@' + WMAP[h.a].n : short(h.a)) + '</b><small>first buy ' + ago(h.first) + ' ago</small></span>' + h.tags.map(function (g) { return '<span class="htag ' + g + '">' + TAG[g] + '</span>'; }).join('');
      return '<div class="hrow2' + (isC ? ' is-curve' : '') + '"><span class="mono muted hr-n">' + (isC ? '—' : i) + '</span><span class="hw">' + who + '</span>' +
        '<span class="hbar2"><i style="width:' + Math.min(100, isC ? h.pct : h.pct / Math.max(1, wallets[0].pct) * 100).toFixed(1) + '%;' + (c === 'curve' ? '' : 'background:' + c) + '" class="' + (c === 'curve' ? 'curve' : '') + '"></i></span>' +
        '<span class="mono r hr-p">' + h.pct.toFixed(2) + '%</span><span class="mono r muted hr-v">$' + fmtNum(Math.round(val)) + '</span>' + (t.live ? '<span class="mono r hr-pf ' + (h.ps ? (h.ps.profit >= 0 ? 'up' : 'down') : '') + '">' + (h.ps && h.ps.trades ? (h.ps.profit >= 0 ? '+' : '−') + '$' + money(h.ps.profit) : '—') + '</span>' : '') + '</div>';
    }).join('');
    return '<div class="htiles">' + tiles.map(function (x) { return '<div class="htile ' + x[2] + '"><small>' + x[0] + '</small><b class="mono">' + x[1] + '</b></div>'; }).join('') + '</div>' +
      '<div class="hdist2">' + segs + '</div><div class="hlegend">' + legend.map(function (l) { return '<span><i class="' + (l[0] === 'curve' ? 'curve' : l[0] === 'rest' ? 'rest' : '') + '" style="' + (l[0][0] === '#' ? 'background:' + l[0] : '') + '"></i>' + l[1] + '</span>'; }).join('') + '</div>' +
      '<div class="hhead' + (t.live ? ' pf' : '') + '"><span>#</span><span>Holder</span><span>Share</span><span class="r">%</span><span class="r">Value</span>' + (t.live ? '<span class="r">Profit</span>' : '') + '</div><div class="' + (t.live ? 'hpf' : '') + '">' + rows + '</div>';
  }
  function topTraders(t) {
    var m = {}, px = price(t);
    S.trades.forEach(function (tr) { if (tr.tick !== t.tick) return; var e = m[tr.wallet] = m[tr.wallet] || { a: tr.wallet, b: 0, s: 0, tok: 0, n: 0 }; var tok = tr.tokens || tr.sol * SOL_USD / px; e.n++; if (tr.side === 'buy') { e.b += tr.sol; e.tok += tok; } else { e.s += tr.sol; e.tok -= tok; } });
    return Object.keys(m).map(function (k) { var e = m[k]; if (e.b === 0 && e.s > 0) { e.b = e.s * (0.55 + (hash(e.a) % 70) / 100); e.n++; } e.val = Math.max(0, e.tok) * px / SOL_USD; e.pnl = e.s + e.val - e.b; return e; }).sort(function (a, b) { return b.pnl - a.pnl; }).slice(0, 15);
  }
  var CMT = ['LFG', 'tax is fair, aping in', 'chart looks clean ngl', 'who is still holding?', '0% buy tax is the way', 'this mascot is elite', 'graduation soon?', 'dev is active in tg', 'bought the dip', 'diamond hands only', 'see you at Meteora', 'buy pressure is insane right now', 'just found this, looks fun', 'held since 5k mc', 'sell tax keeps the paper hands away', 'the pair choice is genius', 'curve almost full', 'lowkey the best meme on here'];
  function seedComments(t) {
    if (S.comments[t.tick]) return S.comments[t.tick];
    if (t.live) return (S.comments[t.tick] = []);   // real coins: no made-up chatter
    var r = rng(hash(t.tick + 'c')), out = [];
    for (var i = 0; i < 9; i++) { var w = WALLETS[Math.floor(r() * WALLETS.length)]; out.push({ id: i, w: w.a, text: CMT[Math.floor(r() * CMT.length)], t: Date.now() - (i * 7 + r() * 6) * 60000, likes: Math.floor(r() * 30), liked: false, reply: i > 2 && r() < 0.3 ? i - 1 - Math.floor(r() * 2) : null }); }
    S.comments[t.tick] = out; return out;
  }
  // ===== CALLOUTS (pump.fun-style, upgraded) =====
  S.follow = {}; S.muted = {}; S.coMenu = null; S.coExp = {}; S.coPaused = false; S.coF = 'all'; S.coOpen = false; S.coQueue = 0; S.ttab = 'coin'; try { S.ttab = localStorage.getItem('dl.ttab') || 'coin'; } catch (e) {}
  try { S.follow = JSON.parse(localStorage.getItem('dl.follow') || '{}'); } catch (e) {}
  var CO_LONG = ['Been watching this since launch — dev is active, chart keeps making higher lows and the tax is clearly shown. Holding a small bag and adding on dips, not financial advice.', 'Paired with gold is such a clean narrative. If this keeps holding the curve it is going to graduate today, then it is a different game on Meteora.', 'Not gonna lie I aped on the mascot alone. Then checked holders: no snipers, no bundles, dev under 3%. That is rare these days.'];
  function coMeta(c, t) { if (c.pos == null) { var r = rng(hash(t.tick + c.id + 'co')), me = S.account && c.w === S.account; c.pos = me ? Math.round((position(t) || { val: 0 }).val * SOL_USD) : Math.round(8 + r() * r() * 900); c.mc0 = t.mcN * (0.55 + r() * 0.8); c.views = Math.floor(20 + r() * 900); c.rt = Math.floor(r() * 6); if (r() < .18) c.text = CO_LONG[Math.floor(r() * CO_LONG.length)]; } }
  function coName(w) { var x = WMAP[w]; return S.account && w === S.account ? 'You' : x && x.n ? x.n : short(w); }
  function commentHTML(c, t, enter, opts) {
    opts = opts || {}; coMeta(c, t);
    var dev = c.w === devOf(t), pnl = c.pos * (t.mcN / c.mc0 - 1), up = pnl >= 0, key = t.tick + '|' + c.id, fol = !!S.follow[c.w], me = S.account && c.w === S.account, long = c.text.length > 120 && !S.coExp[key];
    var kids = opts.kids || [];
    return '<article class="co' + (enter ? ' enter' : '') + (opts.child ? ' child' : '') + '" data-co="' + esc(key) + '"><div class="co-h"><button class="co-u" data-act="walletAny" data-arg="' + esc(c.w) + '"><span class="av" style="width:30px;height:30px">' + A.svg(walletSpec(c.w)) + '</span><b>' + esc(coName(c.w)) + '</b></button>' + (dev ? '<span class="bdg dev">DEV</span>' : '') + (c.pos > 0 && !opts.child && pnl > c.pos * .5 ? '<span class="bdg win">🔥 +' + Math.round(pnl / c.pos * 100) + '%</span>' : '') + '<span class="muted mono co-time" data-t="' + c.t + '">' + ago(c.t) + '</span>' +
      (me ? '' : '<button class="co-ic co-fol' + (fol ? ' on' : '') + '" data-act="coFollow" data-arg="' + esc(c.w) + '" title="' + (fol ? 'Following' : 'Follow') + '">' + (fol ? '✓' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6"/></svg>') + '</button>') +
      '<span class="co-mw"><button class="co-ic" data-act="coMenu" data-arg="' + esc(key) + '" title="More">⋯</button>' + (S.coMenu === key ? '<span class="co-menu"><button data-act="coCopy" data-arg="' + esc(key) + '">Copy text</button><button data-act="coShare" data-arg="' + esc(key) + '">Copy link</button>' + (me ? '' : '<button data-act="coMute" data-arg="' + esc(c.w) + '">Mute ' + esc(coName(c.w)) + '</button><button data-act="coReport" data-arg="' + esc(key) + '">Report</button>') + '</span>' : '') + '</span></div>' +
      (opts.coinTag && !(c.pos > 0) ? '<button class="co-coin" data-act="open" data-arg="' + esc(t.tick) + '">' + avatarHTML(t, 18) + '<b>$' + esc(t.tick) + '</b><span class="mono">' + fmtK(t.mcN) + '</span></button>' : '') +
      (c.text ? '<div class="co-t' + (long ? ' clamp' : '') + (c.real && !opts.child ? ' co-link' : '') + '"' + (c.real && !opts.child ? ' data-act="coPage" data-arg="' + esc(key) + '"' : '') + '>' + esc(c.text) + '</div>' : '') + (c.img ? '<a class="co-img" href="' + esc(c.img) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(c.img) + '" loading="lazy" alt=""></a>' : '') + (long ? '<button class="co-more" data-act="coExpand" data-arg="' + esc(key) + '">Show more</button>' : '') +
      (c.real && c.ps && c.ps.trades > 0 && !opts.child ? (function () { var pu = c.ps.profit >= 0; return '<button class="co-pos" data-act="open" data-arg="' + esc(t.tick) + '" title="Open $' + esc(t.tick) + '">' + avatarHTML(t, 26) + '<span class="co-pn"><b>' + esc(t.tick) + '</b><small>' + esc(t.name) + '</small></span><span class="co-pv"><small>Position</small><b class="mono">$' + money(c.ps.value) + '</b></span><span class="co-pv"><small>Profit</small><b class="mono ' + (pu ? 'up' : 'down') + '">' + (pu ? '+' : '−') + '$' + money(c.ps.profit) + '</b></span><span class="co-go">›</span></button>'; })() : '') + (!c.real && c.pos > 0 && !opts.child ? '<button class="co-pos" data-act="open" data-arg="' + esc(t.tick) + '" title="Open $' + esc(t.tick) + '">' + avatarHTML(t, 26) + '<span class="co-pn"><b>' + esc(t.tick) + '</b><small>' + esc(t.name) + '</small></span><span class="co-pv"><small>Position</small><b class="mono">$' + fmtNum(c.pos) + '</b></span><span class="co-pv"><small>Profit</small><b class="mono ' + (up ? 'up' : 'down') + '">' + (up ? '+' : '−') + '$' + Math.abs(pnl).toFixed(2) + '</b></span><span class="co-go">›</span></button>' : '') +
      '<div class="co-a"><button data-act="coShare" data-arg="' + esc(key) + '" title="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8h16v-8M12 3v13M7 8l5-5 5 5"/></svg></button>' +
        '<button class="' + (c.rtd ? 'on rt' : '') + '" data-act="coRT" data-arg="' + esc(key) + '" title="Repost"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3"/></svg>' + (c.rt || '') + '</button>' +
        '<button class="' + (c.liked ? 'on lk' : '') + '" data-act="coLike" data-arg="' + esc(key) + '" title="Like"><svg viewBox="0 0 24 24" fill="' + (c.liked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z"/></svg>' + (c.likes || '') + '</button>' +
        '<button data-act="coReply" data-arg="' + esc(key) + '" title="Reply"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 01-11.6 7.1L4 21l1.9-5.4A8 8 0 1121 12z"/></svg>' + (kids.length || '') + '</button>' +
        (c.real ? '' : '<span class="co-v"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>' + (c.views || 0) + '</span>') +
        (opts.child ? '' : '<span class="co-mc mono">' + fmtK(c.mc0 || t.mcN) + ' MC</span>') + '</div>' +
      (opts.pre || '') + (kids.length ? '<div class="co-kids">' + kids.map(function (k) { return commentHTML(k, t, false, { child: true }); }).join('') + '</div>' : '') + '</article>';
  }
  function threadHTML(t, list) {
    var byId = {}; list.forEach(function (c) { byId[c.id] = c; });
    var tops = list.filter(function (c) { return (c.reply == null || !byId[c.reply]) && !S.muted[c.w]; }).sort(function (a, b) { return b.t - a.t; });
    return tops.map(function (c) { var kids = list.filter(function (k) { return k.reply === c.id && !S.muted[k.w]; }).sort(function (a, b) { return a.t - b.t; });
      var ups = kids.filter(function (k) { return k.w === c.w; }), rest = kids.filter(function (k) { return k.w !== c.w; }), k0 = t.tick + '|' + c.id, all = S.coUpAll && S.coUpAll[k0];
      var upHTML = ups.length ? '<div class="co-ups">' + (ups.length > 1 && !all ? '<button class="co-upmore" data-act="coUpMore" data-arg="' + esc(k0) + '">Show more updates (' + (ups.length - 1) + ')</button>' : '') + (all ? ups : ups.slice(-1)).map(function (u) { return '<div class="co-up"><small class="muted">Update · ' + ago(u.t) + ' ago</small>' + (u.text ? '<div class="co-t">' + esc(u.text) + '</div>' : '') + (u.img ? '<a class="co-img" href="' + esc(u.img) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(u.img) + '" loading="lazy" alt=""></a>' : '') + '</div>'; }).join('') + '</div>' : '';
      var mine = S.account && c.w === S.account && c.real ? '<button class="co-upd" data-act="coUpdate" data-arg="' + c.id + '">✎ Update callout</button>' : '';
      return commentHTML(c, t, false, { kids: rest, pre: upHTML + mine }); }).join('');
  }
  function coFind(key) { var p = key.split('|'), t = find(p[0]); if (!t) return null; var c = seedComments(t).filter(function (x) { return x.id === +p[1]; })[0]; return c ? { t: t, c: c } : null; }
  function globalCallouts() {
    var out = []; all().forEach(function (t) { seedComments(t).forEach(function (c) { coMeta(c, t); if (c.pos > 0 && !S.muted[c.w]) out.push({ c: c, t: t }); }); });
    if (S.coF === 'follow') out = out.filter(function (x) { return S.follow[x.c.w]; });
    if (S.coF === 'win') out = out.filter(function (x) { return x.c.pos * (x.t.mcN / x.c.mc0 - 1) > 0; });
    if (S.coF === 'hold') out = out.filter(function (x) { return position(x.t); });
    return out.sort(function (a, b) { return b.c.t - a.c.t; }).slice(0, 40);
  }
  function allLiveHTML() {
    var out = []; all().forEach(function (t) { seedComments(t).forEach(function (c) { if (c.reply == null && !S.muted[c.w]) out.push({ c: c, t: t }); }); });
    return out.sort(function (a, b) { return b.c.t - a.c.t; }).slice(0, 40).map(function (x) { return commentHTML(x.c, x.t, false, { coinTag: true }); }).join('');
  }
  S.railHidden = false; S.coPeekMute = false; try { S.railHidden = localStorage.getItem('dl.rail') === '0'; S.coPeekMute = localStorage.getItem('dl.copeek') === '0'; } catch (e) {}
  function railOn() { return S.screen === 'home' && !S.coOpen && window.innerWidth >= 1500; }
  function calloutRail() {
    if (S.screen !== 'home' || S.coOpen) return '';
    if (S.railHidden) return '<button class="co-rail-min" data-act="railShow" title="Show live callouts"><span class="tt-dot"></span><b class="mono" id="rail-n">' + (S.railNew || 0) + '</b><span>Callouts</span></button>';
    var list = globalCallouts().slice(0, 25);
    return '<aside class="co-rail" id="co-rail"><div class="cr-hd"><b>Live callouts</b><span class="tt-dot"></span><button class="iconbtn" data-act="railHide" aria-label="Collapse callouts" title="Collapse">⟩</button></div><div class="cr-list" id="rail-list">' + list.map(function (x) { return commentHTML(x.c, x.t, false, { coinTag: true }); }).join('') + '</div></aside>';
  }
  var isMob = function () { return window.matchMedia && window.matchMedia('(max-width: 760px)').matches; };
  function coPeek(c, t) {
    if (S.screen === 'site') return;
    if (isMob()) { if (S.coOpen) return; S.mCo = (S.mCo || 0) + 1; var mb = document.getElementById('mn-co'); if (mb) { mb.textContent = S.mCo > 99 ? '99+' : S.mCo; mb.style.display = ''; } return; }
    if (S.coPeekMute || S.coOpen || S.screen === 'token' || (railOn() && !S.railHidden) || document.hidden || document.querySelector('.hm-ov')) return; var now = Date.now(); if (now - (S.coPeekAt || 0) < 9000) return; S.coPeekAt = now;
    var box = document.getElementById('toasts'); if (!box) return; var el = document.createElement('button'); el.className = 'toast co-peek'; el.setAttribute('data-act', 'coToggle');
    el.innerHTML = '<span class="av" style="width:26px;height:26px">' + A.svg(walletSpec(c.w)) + '</span><span class="cp-t"><span class="cp-l"><b>' + esc(coName(c.w)) + '</b> on <b>$' + esc(t.tick) + '</b></span><small>' + esc(c.text.length > 54 ? c.text.slice(0, 52) + '…' : c.text) + '</small></span><i class="cp-x" data-act="coPeekMute" title="Mute callout pop-ups">✕</i>';
    box.appendChild(el); while (box.children.length > 4) box.removeChild(box.firstChild); setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 400); }, 4200);
  }
  function calloutDrawer() {
    if (!S.coOpen) return '';
    var list = globalCallouts();
    return '<aside class="co-drawer"><div class="cd-h"><b>🔥 Hot callouts</b><button class="cd-pause' + (S.coPaused ? ' on' : '') + '" data-act="coPause">' + (S.coPaused ? '▶ Resume' + (S.coQueue ? ' · ' + S.coQueue + ' new' : '') : '❚❚ Pause') + '</button><button class="iconbtn" data-act="coClose" aria-label="Close">✕</button></div>' +
      '<div class="cd-f">' + [['all', 'All'], ['follow', 'Following'], ['win', 'In profit'], ['hold', 'I hold']].map(function (f) { return '<button class="' + (S.coF === f[0] ? 'on' : '') + '" data-act="coFilter" data-arg="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
      '<div class="cd-list" id="cd-list">' + (list.length ? list.map(function (x) { return commentHTML(x.c, x.t); }).join('') : '<div class="muted" style="padding:30px 16px;text-align:center">' + (S.coF === 'follow' ? 'Follow people from their callouts and their posts show up here.' : 'Nothing here yet.') + '</div>') + '</div></aside>';
  }
  if (DEMO) setInterval(function () {
    if (document.hidden) return; var t = pick(all()); if (!t) return;
    var cm = seedComments(t), w = WALLETS[Math.floor(Math.random() * WALLETS.length)];
    var c = { id: cm.length, w: w.a, text: pick(CMT), t: Date.now(), likes: 0, liked: false, reply: Math.random() < 0.25 && cm.length ? cm[Math.floor(Math.random() * cm.length)].id : null };
    cm.push(c); coArrive(c, t);
  }, 3500);
  // ---- real callouts: wallet-signed, stored by the indexer ----
  function coClean(x) { return String(x || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 280); }   // must match indexer/callouts.mjs
  function coFromRow(r) { return { ps: psClean(r.ps), id: Number(r.id), w: String(r.wallet), text: String(r.text || ''), img: safeImg(r.img) && /^https:/.test(r.img) ? r.img : null, t: Number(r.ts) || 0, likes: 0, liked: false, reply: r.reply == null ? null : Number(r.reply), mc0: (Number(r.mc) || 0) / 1000 || null, pos: Math.round(Number(r.pos) || 0), real: true }; }
  function refreshCallouts() { var t = S.screen === 'token' && find(S.tick); if (!t || !t.live || !API) return; apiGet('/api/callouts?mint=' + t.ca).then(function (rows) { coMerge(rows || []); if (S.screen === 'token' && S.tick === t.tick) render(); }).catch(function () {}); }
  function coMerge(rows) { var ch = []; rows.forEach(function (r) { var t = S.live.filter(function (x) { return x.ca === r.mint; })[0]; if (!t) return; var list = S.comments[t.tick] || (S.comments[t.tick] = []); var old = list.filter(function (c) { return c.id === r.id; })[0]; if (old) { if (r.ps) old.ps = psClean(r.ps); return; } var c = coFromRow(r); if (!c.mc0) c.mc0 = t.mcN; list.push(c); ch.push({ c: c, t: t }); }); return ch; }
  function coArrive(c, t) {
    coMeta(c, t);
    var tb2 = document.getElementById('cmts'); if (tb2 && S.screen === 'token' && c.reply == null && (S.ttab === 'all' || S.tick === t.tick)) {
      var h0 = tb2.scrollHeight, away = tb2.scrollTop > 60; tb2.insertAdjacentHTML('afterbegin', commentHTML(c, t, !away, { coinTag: S.ttab === 'all' }));
      if (away) { tb2.scrollTop += tb2.scrollHeight - h0; var np = document.getElementById('tt-new'); if (np) { np._n = (np._n || 0) + 1; np.textContent = '↑ ' + np._n + ' new'; np.style.display = ''; } }
      while (tb2.children.length > 60) tb2.removeChild(tb2.lastChild); }
    var dl = document.getElementById('cd-list');
    if (dl && c.pos > 0 && c.reply == null && S.coF === 'all') { if (S.coPaused || dl.matches(':hover')) { S.coQueue++; var pb = document.querySelector('.cd-pause'); if (pb && S.coPaused) pb.textContent = '▶ Resume · ' + S.coQueue + ' new'; } else { dl.insertAdjacentHTML('afterbegin', commentHTML(c, t, true)); while (dl.children.length > 40) dl.removeChild(dl.lastChild); } }
    if (c.reply == null && c.pos > 0) { var rl = document.getElementById('rail-list'); if (rl && rl.offsetParent === null) rl = null; if (rl) { var away = rl.scrollTop > 40, h0 = rl.scrollHeight; rl.insertAdjacentHTML('afterbegin', commentHTML(c, t, !away, { coinTag: true })); if (away) rl.scrollTop += rl.scrollHeight - h0; while (rl.children.length > 30) rl.removeChild(rl.lastChild); } else { var rn = document.getElementById('rail-n'); S.railNew = (S.railNew || 0) + 1; if (rn) rn.textContent = S.railNew; coPeek(c, t); } }
    var nb = document.getElementById('co-new'); if (nb && !S.coOpen) { nb.textContent = (+nb.textContent || 0) + 1; nb.style.display = ''; }
  }
  if (DEMO) setInterval(function () { var ch = false; Object.keys(S.cto).forEach(function (k) { var c = S.cto[k]; if (c.approved || c.demo) return; c.support += .15 + Math.random() * .6; if (c.support >= DR.ctoNeed) { c.approved = true; c.at = Date.now(); toast('🎉 $' + k + ' takeover approved by holders'); } ch = true; }); if (ch) { drSave(); if (S.screen === 'token' && S.cto[S.tick] && !document.querySelector('.hm-ov')) { var c0 = S.cto[S.tick], cp = document.querySelector('.cr-panel'), t = find(S.tick); if (c0.approved) render(); else if (cp && t) cp.outerHTML = crPanel(t); } } }, 6000);
  function position(t) { var p = S.pos[t.tick]; if (!p || p.tok <= 0) return null; var val = p.tok * price(t) / qUsdT(t); return { tok: p.tok, cost: p.cost, val: val, pnl: val - p.cost, pct: p.cost ? (val / p.cost - 1) * 100 : 0 }; }
  // ---- Buy with SOL on pair coins: SOL → pair token via Jupiter, then the normal pool buy (mainnet only — Jupiter has no devnet) ----
  var JUP = 'https://lite-api.jup.ag/swap/v1';
  function jupOn(t) { return CHAIN_ID === 'solana:mainnet' && !!(t && t.live && t.qMint); }
  function paySol(t) { return jupOn(t) && S.side === 'buy' && !!S.paySol && !(S.wallet && S.wallet.dl); }
  function b64Bytes(x) { var b = atob(x), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function bytesB64(u) { var s0 = ''; for (var i = 0; i < u.length; i++) s0 += String.fromCharCode(u[i]); return btoa(s0); }
  // waits for a FINAL answer: confirmed, failed, or expired (blockhash past its last valid height — it can never land). Never "gave up while it could still land".
  function waitSig(sig, lvh) { var t0 = Date.now(); return new Promise(function (res, rej) { (function poll() { rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]).then(function (r) { var st = r && r.value && r.value[0]; if (st && st.err) return rej(new Error('Swap failed on-chain')); if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return res(sig);
    return (lvh ? rpc('getBlockHeight', [{ commitment: 'confirmed' }]) : Promise.resolve(null)).then(function (h) { if ((lvh && h > lvh + 5) || (!lvh && Date.now() - t0 > 90e3)) return rej(new Error('The swap expired without going through — nothing was spent')); if (Date.now() - t0 > 600e3) return rej(new Error('Network not responding — check your wallet before trying again')); setTimeout(poll, 1500); }); }).catch(function () { setTimeout(poll, 2000); }); })(); }); }
  function jupSolToPair(t, sol) {   // resolves with the pair-token amount that ACTUALLY arrived (balance before/after, on-chain decimals)
    var lam = Math.floor(sol * 1e9); if (lam <= 0) return Promise.reject(new Error('Enter an amount first'));
    var who = S.account, bal0 = null, qm = null;
    return chainLib().then(function (T) { return T.poolQuote({ rpc: RPC, pool: t.pool, expect: { mint: t.ca, partners: [PARTNER, TREASURY] } }).then(function (pq) { qm = pq.mint; if (qm !== t.qMint) throw new Error('Pair token mismatch — refusing'); return T.tokenBalance({ rpc: RPC, owner: who, mint: qm }); }); }).then(function (b) { bal0 = b; return jupSolToPair0(t, lam); })
      .then(function (sig) { if (S.account !== who) throw new Error('Wallet account changed — stopped'); return swapDelivered(sig, who, qm); })
      .then(function (got) { if (!(got > 0)) throw new Error('The swap didn’t deliver ' + qSymT(t) + ' — nothing was bought'); return got; });
  }
  function swapDelivered(sig, who, mint) {   // the owner's balance change in this mint, from the confirmed transaction's own meta
    var tries = 0; return (function get() { return rpc('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]).then(function (tx) {
      if (!tx || !tx.meta) { if (++tries > 8) throw new Error('Couldn’t read the swap result — check your wallet balance'); return new Promise(function (r) { setTimeout(r, 1500); }).then(get); }
      var sum = function (arr) { return (arr || []).filter(function (b) { return b.mint === mint && b.owner === who; }).reduce(function (a, b) { return a + Number(b.uiTokenAmount.amount) / Math.pow(10, b.uiTokenAmount.decimals); }, 0); };   // raw units (not the scaled UI amount)
      return sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances); }); })();
  }
  function jupSolToPair0(t, lam) {
    return fetch(JUP + '/quote?inputMint=' + WSOL + '&outputMint=' + t.qMint + '&amount=' + lam + '&slippageBps=' + Math.round(S.slip * 100)).then(function (r) { return r.json(); }).then(function (qr) {
      if (!qr || !qr.outAmount) throw new Error('No Jupiter route from SOL to ' + qSymT(t)); if (qr.inputMint !== WSOL || qr.outputMint !== t.qMint) throw new Error('Jupiter returned a different route — refusing');
      return fetch(JUP + '/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: qr, userPublicKey: S.account, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }) }).then(function (r) { return r.json(); }).then(function (sw) {
        if (!sw || !sw.swapTransaction) throw new Error('Jupiter couldn’t build the swap');
        var raw = b64Bytes(sw.swapTransaction); return chainLib().then(function (T) { return T.checkSwapTx(raw, S.account, RPC).then(function () { return walletSign([raw]); }); }).then(function (signed) { return rpc('sendTransaction', [bytesB64(signed[0]), { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 3 }]); }).then(function (sig) { return waitSig(sig, sw.lastValidBlockHeight); });
      }); });
  }
  function qSymT(t) { return t && t.live && t.qMint ? (t.qSym || t.pair) : 'SOL'; }
  function qUsdT(t) { return t && t.live && t.qMint && t.qUsd ? t.qUsd : SOL_USD; }
  function qBalT(t) { return t && t.live && t.qMint ? (typeof t.qBal === 'number' ? t.qBal : null) : (S.account && typeof S.balance === 'number' ? S.balance : null); }
  function quoteFor(t) {
    var isBuy = S.side === 'buy', amt = parseFloat(String(S.amount).replace(',', '.')) || 0, px = price(t);
    if (paySol(t)) amt = amt * SOL_USD / qUsdT(t) * 0.995;   // estimate after the Jupiter hop
    var QU = qUsdT(t), sol = isBuy ? amt : amt * px / QU, pct = effTax(t), tax = sol * pct / 100, fp = feeOf(t), fee = sol * fp / 100, net = sol - tax - fee;
    var impact = Math.min(25, net * 3 / Math.sqrt(Math.max(t.mcN, 4)));
    var outTok = isBuy ? net * QU / (px * (1 + impact / 200)) : 0, outSol = isBuy ? 0 : net * (1 - impact / 200);
    var res = { isBuy: isBuy, amt: amt, sol: sol, pct: pct, tax: tax, fp: fp, fee: fee, impact: impact, out: isBuy ? outTok : outSol, min: (isBuy ? outTok : outSol) * (1 - S.slip / 100) };
    if (t.live && t.pool && amt > 0) {   // real coins: exact on-chain quote (fetched in the background, panel re-renders when it lands)
      var key = t.tick + '|' + S.side + '|' + amt + '|' + S.slip, L = S.lq && S.lq.k === key ? S.lq.r : null;
      if (!L) { if (S.lqWant !== key) { S.lqWant = key; clearTimeout(S.lqT); S.lqT = setTimeout(function () { chainLib().then(function (T) { return T.quote({ rpc: RPC, expect: { mint: t.ca, partners: [PARTNER, TREASURY] }, pool: t.pool, side: isBuy ? 'buy' : 'sell', amount: amt, slippageBps: Math.round(S.slip * 100) }); }).then(function (r) { S.lq = { k: key, r: r }; if (S.lqWant === key && S.screen === 'token' && S.tick === t.tick) render(); }).catch(function () {}); }, 300); } res.pending = true; }
      else { var ct = Math.max(t.buy, t.sell) / 100; res.pct = ct * 100; res.fee = L.feeSol; res.fp = sol > 0 ? L.feeSol / sol * 100 : 0;
        if (isBuy) { res.out = L.out * (1 - ct); res.min = L.minOut; res.tax = sol * ct; }
        else { res.out = L.out; res.min = L.minOut; res.tax = L.out * ct / Math.max(1e-9, 1 - ct); res.sol = L.out + L.feeSol; }
        res.impact = 0; res.exact = true; }
    }
    return res;
  }

  // ================= WALLET PANEL (GMGN / Axiom style) =================
  S.walletView = null; S.trackWallets = [];
  try { S.trackWallets = JSON.parse(localStorage.getItem('gp.track') || '[]'); } catch (e) {}
  function seedDevTrades(t) {
    if (t._devSeeded || (S.account && t.creator === S.account)) return; t._devSeeded = true;
    var dev = devOf(t), r = rng(hash(t.tick + 'devtr')), rm = riskMetrics(t), sold = t.archived ? t.devSoldAfter != null : rm[0].val === 'SOLD', nowPct = sold ? 0 : t.archived ? 2 + r() * 3 : parseFloat(rm[0].val);
    var initPct = sold ? 1.5 + r() * 5 : nowPct * (1 + r() * .6) + .2, tok = initPct / 100 * 1e9, px0 = (t.hist && t.hist[0] ? Math.min(t.hist[0], 6) : 5) * 1000 / 1e9;
    S.trades.push({ tick: t.tick, side: 'buy', sol: +(tok * px0 / SOL_USD).toFixed(3), wallet: dev, t: t.born + 800, tax: 0, mine: false, price: px0, tokens: tok, sig: b58(64) });
    var sellTok = sold ? tok : tok - nowPct / 100 * 1e9;
    if (sellTok > tok * .02) { var h = t.hist || [t.mcN], k = t.archived && sold ? Math.min(h.length - 1, Math.floor((h.length - 1) * t.devSoldAfter * 60000 / t.span)) : Math.floor(h.length * (sold ? .15 + r() * .4 : .4 + r() * .5)), pxS = h[Math.min(h.length - 1, k)] * 1000 / 1e9, at = t.archived && sold ? t.born + t.devSoldAfter * 60000 : t.born + (Date.now() - t.born) * (k / h.length);
      S.trades.push({ tick: t.tick, side: 'sell', sol: +(sellTok * pxS / SOL_USD).toFixed(3), wallet: dev, t: at, tax: 0, mine: false, price: pxS, tokens: sellTok, sig: b58(64) }); }
    S.trades.sort(function (a, b) { return b.t - a.t; });
  }
  function walletStats(addr, t) {
    if (addr === devOf(t)) seedDevTrades(t);
    var px = price(t), tr = S.trades.filter(function (x) { return x.wallet === addr && x.tick === t.tick; }).sort(function (a, b) { return a.t - b.t; });
    var st = { trades: tr, nb: 0, ns: 0, b: 0, s: 0, tb: 0, ts: 0, first: tr.length ? tr[0].t : null, last: tr.length ? tr[tr.length - 1].t : null };
    tr.forEach(function (x) { var tok = x.tokens || x.sol * SOL_USD / (x.price || px); if (x.side === 'buy') { st.nb++; st.b += x.sol; st.tb += tok; } else { st.ns++; st.s += x.sol; st.ts += tok; } });
    if (st.tb === 0 && st.ts > 0) {
      st.tb = st.ts; st.b = st.s * (0.55 + (hash(addr) % 70) / 100); st.nb = 1;
      var fb = { side: 'buy', sol: st.b, price: st.b * SOL_USD / st.tb, t: (st.first || Date.now()) - (8 + hash(addr) % 30) * 60000, sig: b58(64), tokens: st.tb };
      st.trades = [fb].concat(st.trades); st.first = fb.t;
    }
    st.hold = Math.max(0, st.tb - st.ts); st.holdPct = st.hold / 1e9 * 100; st.val = st.hold * px / SOL_USD;
    st.avg = st.tb ? st.b * SOL_USD / st.tb : 0; st.avgMc = st.avg * 1e9 / 1000;
    st.realized = st.s - (st.tb ? st.b * (st.ts / st.tb) : 0); st.unreal = st.val - (st.tb ? st.b * (st.hold / st.tb) : 0); st.pnl = st.realized + st.unreal;
    st.roi = st.b ? st.pnl / st.b * 100 : 0;
    return st;
  }
  function walletOther(addr) {
    var m = {};
    S.trades.forEach(function (x) { if (x.wallet !== addr || x.tick === S.tick) return; var e = m[x.tick] = m[x.tick] || { tick: x.tick, b: 0, s: 0, n: 0 }; e.n++; if (x.side === 'buy') e.b += x.sol; else e.s += x.sol; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return (b.b + b.s) - (a.b + a.s); }).slice(0, 8);
  }
  function walletChart(addr, t, st) {
    var h = t.hist.slice(-120), W = 400, H = 130, mx = Math.max.apply(null, h), mn = Math.min.apply(null, h), sp = (mx - mn) || 1;
    var line = 'M' + h.map(function (v, i) { return (i * W / (h.length - 1)).toFixed(1) + ' ' + (8 + (1 - (v - mn) / sp) * (H - 16)).toFixed(1); }).join(' L');
    var t0 = Date.now() - 3600 * 1000, marks = st.trades.map(function (x) {
      var fx = Math.max(0.02, Math.min(0.98, (x.t - t0) / (3600 * 1000))), mcv = (x.price || price(t)) * 1e9 / 1000, fy = Math.max(0.06, Math.min(0.94, 1 - (mcv - mn) / sp));
      var buy = x.side === 'buy';
      return '<span class="wmk ' + (buy ? 'b' : 's') + '" style="left:' + (fx * 100).toFixed(1) + '%;top:' + (fy * 100).toFixed(1) + '%" title="' + (buy ? 'Bought ' : 'Sold ') + x.sol.toFixed(3) + ' SOL at ' + fmtK(mcv) + ' MC">' + (buy ? 'B' : 'S') + '</span>';
    }).join('');
    var avgLine = st.avgMc ? '<span class="wavg" style="top:' + (Math.max(0.04, Math.min(0.96, 1 - (st.avgMc - mn) / sp)) * 100).toFixed(1) + '%"><em>avg entry ' + fmtK(st.avgMc) + '</em></span>' : '';
    return '<div class="wchart"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><path d="' + line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="url(#ccUp)" opacity=".7"/><path d="' + line + '" fill="none" stroke="#9696A0" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>' + avgLine + marks + '</div>';
  }
  // ---- dev history: previous deploys and how they went ----
  var DADJ = ['Moon', 'Turbo', 'Based', 'Tiny', 'Giga', 'Lazy', 'Rich', 'Sad', 'Angry', 'Golden', 'Pixel', 'Space', 'Baby', 'Mega', 'Wet', 'Hyper'];
  var DNOUN = ['Frog', 'Cat', 'Pug', 'Duck', 'Ape', 'Owl', 'Shark', 'Goat', 'Bear', 'Doge', 'Hamster', 'Penguin', 'Otter', 'Crab'];
  function devHistory(addr) {
    var live = all().filter(function (t) { return devOf(t) === addr; }), r = rng(hash(addr + 'deploys')), isDev = live.length > 0;
    var n = isDev ? 2 + Math.floor(r() * 5) : (r() < .25 ? 1 + Math.floor(r() * 2) : 0), profile = r(), past = [];
    for (var i = 0; i < n; i++) {
      var adj = DADJ[Math.floor(r() * DADJ.length)], nn = DNOUN[Math.floor(r() * DNOUN.length)], roll = r(), out, ath, life;
      if (profile < .3) { out = roll < .65 ? 'rug' : roll < .9 ? 'dead' : 'grad'; } else if (profile < .7) { out = roll < .25 ? 'rug' : roll < .65 ? 'dead' : 'grad'; } else { out = roll < .08 ? 'rug' : roll < .45 ? 'dead' : 'grad'; }
      ath = out === 'grad' ? 69 + r() * r() * 4000 : out === 'rug' ? 6 + r() * 40 : 5 + r() * 25; life = out === 'rug' ? 2 + r() * 40 : out === 'dead' ? 30 + r() * 600 : 1440 + r() * 20000;
      var pts = [], v = 5, peakAt = .2 + r() * .5; for (var k = 0; k < 24; k++) { var f = k / 23; v = f < peakAt ? 5 + (ath - 5) * Math.pow(f / peakAt, 1.4) : out === 'rug' ? (f < peakAt + .06 ? ath * .2 : ath * .05) : out === 'dead' ? ath * Math.max(.15, 1 - (f - peakAt) * 1.6) : ath * (.55 + r() * .35); pts.push(v * (.94 + r() * .12)); }
      var pastO = { name: adj + ' ' + nn, tick: (adj.slice(0, 2) + nn.slice(0, 3)).toUpperCase(), spec: { kind: A.KINDS[Math.floor(r() * A.KINDS.length)], skin: A.SKINS[Math.floor(r() * A.SKINS.length)], bg: A.BGS[Math.floor(r() * A.BGS.length)], eyes: 'normal', mouth: pick(['smile', 'grin', 'o']), acc: 'none' }, out: out, ath: ath, now: pts[23], life: life, ago: (i + 1) * (2 + r() * 9) * 1440, pts: pts, devSoldAfter: out === 'rug' ? life : out === 'dead' ? life * (.2 + r() * .6) : (r() < .3 ? null : life * (.3 + r() * .7)) };
      var span0 = life * 60000 * 1.25; if (out === 'rug') { var pi = 0; pastO.pts.forEach(function (v, q) { if (v > pastO.pts[pi]) pi = q; }); pastO.devSoldAfter = (pi + 1.2) / 23 * span0 / 60000; } if (pastO.devSoldAfter != null) pastO.devSoldAfter = Math.min(pastO.devSoldAfter, span0 / 60000 * .98);
      var atk = pastO.tick; while (find(atk) && !(S.archive[atk] && S.archive[atk].creator === addr)) atk = atk.slice(0, 5) + 'XYZQW'[Math.floor(r() * 5)];
      pastO.tick = atk;
      if (!S.archive[atk]) { var bornA = Date.now() - pastO.ago * 60000; S.archive[atk] = { name: pastO.name, tick: atk, spec: pastO.spec, buy: Math.floor(r() * 4), sell: 0, pair: 'SOL', mcN: pastO.now, mc0: 5, prog: out === 'grad' ? 100 : Math.min(97, (Math.max.apply(null, pastO.pts) - 5) / 64 * 100), born: bornA, holders: Math.round(20 + pastO.ath * 3), soc: false, ca: fakeCA(), vol: pastO.ath * .4, hist: pastO.pts.slice(), creator: addr, ath: pastO.ath, archived: out, devPct: null, devSoldAfter: pastO.devSoldAfter, span: span0 }; S.archive[atk].sell = S.archive[atk].buy; }
      past.push(pastO);
    }
    past.sort(function (a, b) { return a.ago - b.ago; });
    var g = past.filter(function (x) { return x.out === 'grad'; }).length, rg = past.filter(function (x) { return x.out === 'rug'; }).length;
    var score = !past.length ? null : rg / past.length > .4 ? ['bad', 'Serial rugger'] : g / past.length >= .4 && rg <= 1 ? ['good', 'Trusted builder'] : ['mid', 'Mixed record'];
    return { live: live, past: past, grad: g, rugs: rg, score: score, best: past.reduce(function (m, x) { return Math.max(m, x.ath); }, 0) };
  }
  function durH(m) { if (m >= 59.5 && m < 60) m = 60; return m < 60 ? Math.max(1, Math.round(m)) + 'm' : m < 1440 ? (m / 60).toFixed(m < 600 ? 1 : 0).replace('.0', '') + 'h' : Math.round(m / 1440) + 'd'; }
  function devHistoryHTML(addr) {
    var h = devHistory(addr); if (!h.live.length && !h.past.length) return '';
    var sold = h.past.filter(function (x) { return x.devSoldAfter != null; }), avg = sold.length ? sold.reduce(function (a, x) { return a + x.devSoldAfter; }, 0) / sold.length : null, fast = sold.filter(function (x) { return x.devSoldAfter < 60; }).length;
    var holdCls = function (m) { return m == null ? 'g' : m < 60 ? 'r' : m < 1440 ? 'y' : 'g'; };
    var rows = h.live.map(function (t) { var dh = (Date.now() - t.born) / 60000, ds = riskMetrics(t)[0].val === 'SOLD';
        return '<button class="dh2-row" data-act="open" data-arg="' + esc(t.tick) + '">' + avatarHTML(t, 30) + '<span class="dh2-n"><b>' + esc(t.name) + '</b><small>$' + esc(t.tick) + ' · ' + ago(t.born) + ' ago · <i class="lv">live</i></small></span><span class="dh2-mc mono">' + fmtK(athOf(t)) + '</span><span class="dh2-s ' + (ds ? 'r' : 'g') + '">' + (ds ? 'sold' : 'holding') + '</span></button>'; }).join('') +
      h.past.map(function (x) { var c = holdCls(x.devSoldAfter);
        return '<button class="dh2-row" data-act="open" data-arg="' + esc(x.tick) + '"><span class="av" style="width:30px;height:30px">' + A.svg(x.spec) + '</span><span class="dh2-n"><b>' + esc(x.name) + '</b><small>$' + x.tick + ' · ' + ago(Date.now() - x.ago * 60000) + ' ago' + (x.out === 'grad' ? ' · 🎓' : '') + '</small></span><span class="dh2-mc mono">' + fmtK(x.ath) + '</span><span class="dh2-s ' + c + '">' + (x.devSoldAfter == null ? 'still holding' : durH(x.devSoldAfter)) + '</span></button>'; }).join('');
    return '<div class="dw-sec dh2"><div class="dw-title">Last deploys <span class="mono muted">' + (h.live.length + h.past.length) + '</span></div>' +
      (fast ? '<div class="dh2-alert">⚠ Sold within 1 hour on <b>' + fast + ' of ' + h.past.length + '</b> previous coins</div>' : '') +
      '<div class="dh2-head"><span>Coin</span><span class="r">ATH MC</span><span class="r">Dev sold after</span></div>' + rows +
      '<div class="dh2-foot"><span>Avg time until dev sold: <b class="mono">' + (avg != null ? durH(avg) : '—') + '</b></span><span>Best ATH <b class="mono">' + (h.best ? fmtK(h.best) : '—') + '</b></span></div></div>';
  }
  // ===== BURN TOOL: devs / projects burn their own supply =====
  function burnCoins() { return S.account ? all().filter(function (t) { return t.creator === S.account && position(t); }) : []; }
  function burnModal() {
    if (!S.burnOpen) return '';
    var head = '<div class="hm-h"><div><b>🔥 Burn tokens</b><small>Permanently destroy supply of a coin you launched · shows up in the Burnery</small></div><button class="iconbtn" data-act="burnClose" aria-label="Close">✕</button></div>';
    var wrap = function (inner) { return '<div class="hm-ov" data-act="burnClose"><div class="hm card-s bt" data-stop>' + head + inner + '</div></div>'; };
    if (!S.account) return wrap('<div class="bt-empty"><p>Connect the wallet that launched your coin to burn its tokens.</p><button class="btn pri" data-act="openWallet">Connect wallet</button></div>');
    var cs = burnCoins(); if (!cs.length) return wrap('<div class="bt-empty"><p>You don’t hold tokens of a coin you launched yet. Launch a coin (with an initial buy), then come back to burn part of your bag.</p><button class="btn pri" data-act="create">+ Launch a coin</button></div>');
    var t = find(S.burnTick) && cs.indexOf(find(S.burnTick)) >= 0 ? find(S.burnTick) : cs[0]; S.burnTick = t.tick;
    var pos = position(t), pct = S.burnPct || 25, tok = pos.tok * pct / 100, sup = tok / 1e9 * 100, usd = tok * price(t);
    return wrap('<div class="bt-coins">' + cs.map(function (c) { return '<button class="bt-c' + (c === t ? ' on' : '') + '" data-act="burnPick" data-arg="' + esc(c.tick) + '">' + avatarHTML(c, 28) + '<span><b>$' + esc(c.tick) + '</b><small class="mono">' + fmtNum(Math.round(position(c).tok)) + ' held</small></span></button>'; }).join('') + '</div>' +
      '<div class="bt-amt"><div class="bt-row"><small>Amount</small><b class="mono" id="bt-tok">' + fmtNum(Math.round(tok)) + ' $' + esc(t.tick) + '</b></div><input type="range" min="1" max="100" value="' + pct + '" data-burnpct><div class="bt-pre">' + [10, 25, 50, 100].map(function (v) { return '<button class="' + (pct === v ? 'on' : '') + '" data-act="burnPreset" data-arg="' + v + '">' + (v === 100 ? 'All' : v + '%') + '</button>'; }).join('') + '</div></div>' +
      '<div class="bt-sum"><div><small>Share of supply</small><b class="mono" id="bt-sup">' + sup.toFixed(3) + '%</b></div><div><small>Value</small><b class="mono" id="bt-usd">$' + fmtNum(Math.round(usd)) + '</b></div><div><small>Supply after</small><b class="mono" id="bt-after">' + fmtNum(Math.round(1e9 - tok - ((S._bnAgg || {})[t.tick] ? S._bnAgg[t.tick].tok : 0))) + '</b></div></div>' +
      '<div class="bt-warn">⚠ Burning is permanent. Tokens are destroyed on-chain and can never be recovered.</div><button class="btn pri bt-go" data-act="burnGo">🔥 Burn ' + pct + '% of my $' + esc(t.tick) + '</button>');
  }
  // ===== BUBBLE MAP: top holders, clustered by who funded them (server) + bundles; force layout, zoom & pan =====
  var BUB_COL = ['#3DDC97', '#7FB6FF', '#FFB15C', '#B794FF', '#FF6B8B', '#5AC8E8', '#E8C26A', '#9BE15D', '#F28DD0', '#6EE7D8'];
  S.bub = null; S.bubSel = null; S.bubList = true; S.bubLinks = true; S.bubV = { x: 0, y: 0, k: 1 };
  function bubDemo(t) {   // demo coins: derive clusters from the simulated bundle / sniper tags
    var hs = holdersOf(t).filter(function (h) { return h.kind !== 'curve'; }).slice(0, 100), r = rng(hash(t.tick + 'bub')), links = [], cl = {}, cid = 0;
    var bu = hs.filter(function (h) { return h.tags.indexOf('bundle') >= 0; }); if (bu.length > 1) { cid++; bu.forEach(function (h, i) { cl[h.a] = cid; if (i) links.push({ a: bu[0].a, b: h.a, k: 'bundle' }); }); }
    for (var g = 0; g < 3; g++) { var pick2 = hs.filter(function (h) { return !cl[h.a] && r() < .08; }).slice(0, 2 + Math.floor(r() * 3)); if (pick2.length > 1) { cid++; pick2.forEach(function (h, i) { cl[h.a] = cid; if (i) links.push({ a: pick2[0].a, b: h.a, k: i === 1 ? 'fund' : 'shared' }); }); } }
    var cls = []; for (var c = 1; c <= cid; c++) { var m = hs.filter(function (h) { return cl[h.a] === c; }); cls.push({ id: c, n: m.length, pct: m.reduce(function (a, h) { return a + h.pct; }, 0) }); }
    return { done: true, demo: true, holders: hs.map(function (h) { return { w: h.a, pct: h.pct, dev: h.tags.indexOf('dev') >= 0, sn: h.tags.indexOf('sniper') >= 0, c: cl[h.a] || 0, f: null }; }), links: links, clusters: cls.sort(function (a, z) { return z.pct - a.pct; }) };
  }
  function bubLoad(t) {
    if (!t.live || !API) { S.bub = { mint: t.tick, d: bubDemo(t) }; return; }
    if (!S.bub || S.bub.mint !== t.ca) S.bub = { mint: t.ca, d: null };
    apiGet('/api/bubbles/' + t.ca).then(function (d) { if (!S.hmap || !S.bub || S.bub.mint !== t.ca || !d || d.error) return; S.bub.d = d; render(); if (!d.done) setTimeout(function () { var t2 = find(S.hmap); if (t2 && t2.ca === t.ca) bubLoad(t2); }, 5000); }).catch(function () { if (S.bub && !S.bub.d) { S.bub.err = true; render(); } });
  }
  function bubLayout(d) {   // force-directed: repulsion + springs on links + gentle gravity, then collision cleanup
    var key = d.holders.map(function (h) { return h.w.slice(0, 4) + h.c; }).join('') + d.links.length; if (S.bubL && S.bubL.key === key) return S.bubL;
    var W = 1000, H = 720, nH = d.holders.length, RB = nH > 60 ? 7 : 9, RM = nH > 60 ? 48 : nH > 25 ? 58 : 66, mx = Math.max.apply(null, d.holders.map(function (h) { return h.pct; }).concat([0.0001])), N = d.holders.map(function (h, i) { var a = i * 2.39996, rr = 30 + 26 * Math.sqrt(i); return { h: h, x: W / 2 + Math.cos(a) * rr, y: H / 2 + Math.sin(a) * rr * .8, vx: 0, vy: 0, r: RB + Math.sqrt(h.pct / mx) * RM }; });
    var ix = {}; N.forEach(function (n, i) { ix[n.h.w] = i; }); var L = d.links.filter(function (l) { return ix[l.a] != null && ix[l.b] != null; });
    for (var it = 0; it < 320; it++) { var al = 1 - it / 320;
      for (var i = 0; i < N.length; i++) for (var j = i + 1; j < N.length; j++) { var a = N[i], b = N[j], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy + .01, dd = Math.sqrt(d2), f = 5200 / d2 * al, mn = a.r + b.r + 10;
        if (dd < mn) f += (mn - dd) * .18; var fx = dx / dd * f, fy = dy / dd * f; a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy; }
      L.forEach(function (l) { var a = N[ix[l.a]], b = N[ix[l.b]], dx = b.x - a.x, dy = b.y - a.y, dd = Math.sqrt(dx * dx + dy * dy) + .01, tg = a.r + b.r + 26, f = (dd - tg) * .08; a.vx += dx / dd * f; a.vy += dy / dd * f; b.vx -= dx / dd * f; b.vy -= dy / dd * f; });
      N.forEach(function (n) { n.vx += (W / 2 - n.x) * .0025; n.vy += (H / 2 - n.y) * .0035; n.x += n.vx *= .55; n.y += n.vy *= .55; }); }
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; N.forEach(function (n) { x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r); });   // fit everything into view
    var k = Math.min(1.6, (W - 80) / (x1 - x0), (H - 140) / (y1 - y0)); S.bubV = { k: k, x: W / 2 - (x0 + x1) / 2 * k, y: H / 2 + 10 - (y0 + y1) / 2 * k }; S.bubFitV = { k: S.bubV.k, x: S.bubV.x, y: S.bubV.y };
    S.bubL = { key: key, N: N, L: L, ix: ix, W: W, H: H, fresh: true }; return S.bubL;
  }
  function holderMap() {
    if (!S.hmap) return ''; var t = find(S.hmap); if (!t) return '';
    var B = S.bub, d = B && B.d, head = '<div class="bm-h"><div><b>Bubble map</b><small>$' + esc(t.tick) + ' · top holders · bubble size = share of supply</small></div><div class="bm-hb"><button class="iconbtn" data-act="bubFit" title="Reset view">⟲</button><button class="iconbtn" data-act="hmapClose" aria-label="Close">✕</button></div></div>';
    if (!d) return '<div class="hm-ov" data-act="hmapClose"><div class="bm card-s" data-stop>' + head + '<div class="bm-wait">' + (B && B.err ? 'Couldn\'t load the bubble map — try again in a moment.' : '<span class="gr-sp"></span>Loading holders…') + '</div></div></div>';
    if (!d.holders.length) return '<div class="hm-ov" data-act="hmapClose"><div class="bm card-s" data-stop>' + head + '<div class="bm-wait">No holders yet — everything is still on the bonding curve.</div></div></div>';
    var Lo = bubLayout(d), anim = Lo.fresh; Lo.fresh = false; var sel = S.bubSel, selC = sel && Lo.ix[sel] != null ? Lo.N[Lo.ix[sel]].h.c : 0, me = S.account;
    var col = function (c) { return c ? BUB_COL[(c - 1) % BUB_COL.length] : null; };
    var lines = S.bubLinks ? Lo.L.map(function (l) { var a = Lo.N[Lo.ix[l.a]], b = Lo.N[Lo.ix[l.b]], c = col(a.h.c) || '#888', dx = b.x - a.x, dy = b.y - a.y, dd = Math.hypot(dx, dy) || 1, x1 = a.x + dx / dd * a.r, y1 = a.y + dy / dd * a.r, x2 = b.x - dx / dd * (b.r + 3), y2 = b.y - dy / dd * (b.r + 3), dim = selC && a.h.c !== selC;
      return '<line class="bm-l k-' + l.k + (dim ? ' dim' : '') + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + c + '"' + (l.k === 'fund' ? ' marker-end="url(#bmArr)"' : '') + '/>'; }).join('') : '';
    var dots = Lo.N.map(function (n, i) { var h = n.h, c = col(h.c), isMe = me && h.w === me, dim = selC ? h.c !== selC : sel ? h.w !== sel : false;
      var tip = esc((h.dev ? 'Dev · ' : '') + (isMe ? 'You · ' : '') + '#' + (i + 1) + ' ' + short(h.w) + ' · ' + h.pct.toFixed(2) + '%' + (h.c ? ' · cluster ' + h.c : '') + (h.sn ? ' · sniper' : ''));
      return '<g class="bm-n' + (dim ? ' dim' : '') + (sel === h.w ? ' sel' : '') + '" data-act="bubSel" data-arg="' + esc(h.w) + '" data-tip="' + tip + '" style="--d:' + Math.min(900, i * 9) + 'ms"><circle cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="' + n.r.toFixed(1) + '" fill="' + (c ? c + '26' : '#232327') + '" stroke="' + (h.dev ? '#E8C26A' : isMe ? '#7FB6FF' : c || '#3A3A40') + '" stroke-width="' + (h.dev || isMe || sel === h.w ? 2.6 : c ? 1.8 : 1.2) + '"' + (h.sn && !c ? ' stroke-dasharray="4 3"' : '') + '/>' +
        (n.r > 18 ? '<text x="' + n.x.toFixed(1) + '" y="' + (n.y + 4).toFixed(1) + '">' + (h.dev ? 'DEV' : isMe ? 'YOU' : h.pct.toFixed(h.pct >= 10 ? 0 : 1) + '%') + '</text>' : '') + '</g>'; }).join('');
    var inCl = d.clusters.reduce(function (a, c) { return a + c.pct; }, 0), top10 = d.holders.slice(0, 10).reduce(function (a, h) { return a + h.pct; }, 0), devH = d.holders.filter(function (h) { return h.dev; })[0];
    var status = d.demo ? '<span class="bm-st ok">Demo data</span>' : d.done ? '<span class="bm-st ok">✓ Connections loaded</span>' : '<span class="bm-st"><span class="gr-sp"></span>Tracing funding · ' + (d.holders.length - d.missing) + '/' + d.holders.length + '</span>';
    var V = S.bubV, tr = 'translate(' + V.x.toFixed(1) + ' ' + V.y.toFixed(1) + ') scale(' + V.k.toFixed(3) + ')';
    var canvas = '<div class="bm-cv" id="bm-cv"><svg class="' + (anim ? 'anim' : '') + '" viewBox="0 0 ' + Lo.W + ' ' + Lo.H + '" preserveAspectRatio="xMidYMid meet"><defs><marker id="bmArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#cfcfd4"/></marker></defs><g id="bm-g" transform="' + tr + '">' + lines + dots + '</g></svg>' +
      '<div class="bm-tools"><button class="' + (S.bubList ? 'on' : '') + '" data-act="bubList">☰ Holders</button><button class="' + (S.bubLinks ? 'on' : '') + '" data-act="bubLinks">⤳ Links</button></div>' + status +
      '<div class="bm-tip" id="bm-tip"></div><div class="bm-leg"><span><i style="border-color:#E8C26A"></i>Dev</span><span><i style="border-color:#7FB6FF"></i>You</span><span><i class="dash"></i>Sniper</span><span><em class="a"></em>funded by</span><span><em></em>same funder / bundle</span></div></div>';
    var stat = function (k, v, lv) { return '<div class="bm-s lv-' + lv + '"><small>' + k + '</small><b class="mono">' + v + '</b></div>'; };
    var side = '<div class="bm-side' + (S.bubList ? '' : ' off') + '"><div class="bm-stats">' + stat('Top 10', top10.toFixed(1) + '%', top10 > 45 ? 'r' : top10 > 30 ? 'y' : 'g') + stat('In clusters', inCl.toFixed(1) + '%', inCl > 20 ? 'r' : inCl > 8 ? 'y' : 'g') + stat('Clusters', String(d.clusters.length), d.clusters.length ? 'y' : 'g') + stat('Dev holds', devH ? devH.pct.toFixed(2) + '%' : '0%', devH && devH.pct > 8 ? 'r' : 'g') + '</div>' +
      (d.clusters.length ? '<div class="bm-cls">' + d.clusters.slice(0, 8).map(function (c) { var w0 = d.holders.filter(function (h) { return h.c === c.id; })[0]; return '<button class="' + (selC === c.id ? 'on' : '') + '" data-act="bubSel" data-arg="' + esc(w0 ? w0.w : '') + '"><i style="background:' + col(c.id) + '"></i>Cluster ' + c.id + '<span class="mono">' + c.n + ' wallets · ' + c.pct.toFixed(2) + '%</span></button>'; }).join('') + '</div>' : '') +
      '<div class="bm-list">' + d.holders.map(function (h, i) { var c = col(h.c), f = h.f; return '<button class="bm-row' + (sel === h.w ? ' on' : '') + '" data-act="bubSel" data-arg="' + esc(h.w) + '"><span class="mono muted">' + (i + 1) + '</span><i style="background:' + (c || '#3A3A40') + '"></i><span class="mono bm-a">' + short(h.w) + (h.dev ? ' <em class="bdg dev">DEV</em>' : '') + (me && h.w === me ? ' <em class="bdg you">YOU</em>' : '') + '</span><span class="mono">' + h.pct.toFixed(2) + '%</span></button>' +
        (sel === h.w ? '<div class="bm-det">' + (f ? (f.k === 'ok' ? 'Funded by <b class="mono">' + short(f.by) + '</b>' + (f.hub ? ' <span class="muted">(exchange / busy wallet)</span>' : '') + (f.sol ? ' · ' + f.sol.toFixed(2) + ' SOL' : '') + (f.ts ? ' · ' + ago(f.ts) + ' ago' : '') : f.k === 'old' ? 'Old, active wallet — first funding too far back' : 'No SOL funding found') : d.demo ? 'Demo wallet' : 'Tracing…') + '<button class="link bm-ow" data-act="walletAny" data-arg="' + esc(h.w) + '">Open wallet →</button></div>' : ''); }).join('') + '</div>' +
      '<small class="muted bm-note">Wallets are linked when one funded another, both got their first SOL from the same wallet, or they bought in the same block at launch. Exchanges and busy wallets are ignored.</small></div>';
    return '<div class="hm-ov" data-act="hmapClose"><div class="bm card-s' + (S.bubList ? '' : ' nolist') + '" data-stop>' + head + '<div class="bm-body">' + canvas + side + '</div></div></div>';
  }
  // ===== WALLET PROFILE: hover preview on any wallet + full profile (positions, closed, created, this coin) =====
  S.wprof = {}; S.wTab = 'open';
  function rwCoinHTML(t, taxed) {   // total holder rewards this wallet got from this coin
    var L = (S.rw.acc === S.account ? S.rw.list : []).filter(function (r) { return r.mint === t.ca; });
    if (!L.length && !taxed) return '';
    var by = {}; L.forEach(function (r) { by[r.tokenSymbol] = (by[r.tokenSymbol] || 0) + r.amount; });
    var tot = Object.keys(by).map(function (k) { return '+' + fmtNum(by[k]) + ' $' + esc(k); }).join(' · ');
    return '<button class="pc-rw" data-act="rwOpen"><span class="pc-rw-i">🎁</span><span class="pc-rw-t"><small>Rewards received</small><b class="mono">' + (L.length ? tot : '—') + '</b></span><span class="pc-rw-m muted">' + (L.length ? L.length + ' payout' + (L.length > 1 ? 's' : '') + ' · last ' + ago(L[0].ts) + ' ›' : 'Paid to holders as tax builds up') + '</span></button>';
  }
  function rwListHTML() {
    var L = S.rw.acc === S.account ? S.rw.list : [], cl = CHAIN_ID === 'solana:devnet' ? '?cluster=devnet' : '';
    if (!L.length) return '<div class="muted wb-empty">No holder rewards yet. Hold taxed coins — every payout lands here with its transaction.</div>';
    return '<div class="rw-note muted">Some wallets hide transfers of new tokens. Each reward below links to its transaction on Solscan.</div>' + L.map(function (r) { var t = rwTok(r.mint);
      return '<a class="rw-row" target="_blank" rel="noopener" href="https://solscan.io/tx/' + esc(r.sig) + cl + '">' + (t ? avatarHTML(t, 34) : '<span class="rw-g">🎁</span>') + '<span class="rw-n"><b>+' + fmtNum(r.amount) + ' $' + esc(r.tokenSymbol) + '</b><small class="muted">' + (r.symbol ? 'Holder reward · $' + esc(r.symbol) : 'Holder reward') + ' · ' + ago(r.ts) + '</small></span><span class="rw-v">Solscan ↗</span></a>'; }).join('');
  }
  function wprof(addr) {
    if (!DEMO && API) { var e = S.wprof[addr]; if (!e || (Date.now() - e.at > 30e3 && !e.busy)) { e = S.wprof[addr] = e || { at: 0, d: null }; e.busy = true; apiGet('/api/wallet/' + addr).then(function (d) { e.d = d; e.at = Date.now(); e.busy = false; if (S.walletView === addr) render(); if (pvFor === addr) pvFill(); }).catch(function () { e.busy = false; e.at = Date.now(); }); }
      var d = e.d; if (!d) return { loading: true, coins: [], created: [] };
      return { sol: d.sol, first: d.first, coins: (d.coins || []).map(function (c) { var t = S.live.filter(function (x) { return x.ca === c.mint; })[0]; return t ? { t: t, held: +c.held || 0, value: +c.value || 0, spent: +c.spent || 0, got: +c.got || 0, profit: +c.profit || 0, profitPct: +c.profitPct || 0, avgEntryMc: +c.avgEntryMc || 0, trades: +c.trades || 0, last: +c.last || 0 } : null; }).filter(Boolean),
        created: (d.created || []).map(function (c) { return S.live.filter(function (x) { return x.ca === c.mint; })[0]; }).filter(Boolean) }; }
    var ticks = {}; S.trades.forEach(function (x) { if (x.wallet === addr) ticks[x.tick] = 1; }); all().forEach(function (t) { if (devOf(t) === addr) ticks[t.tick] = 1; });
    var coins = Object.keys(ticks).map(function (k) { var t = find(k); if (!t) return null; var st = walletStats(addr, t); if (!st.trades.length) return null; var spent = st.b * SOL_USD, got = st.s * SOL_USD, value = st.val * SOL_USD, pr = value + got - spent;
      return { t: t, held: st.hold, value: value, spent: spent, got: got, profit: pr, profitPct: spent ? pr / spent * 100 : 0, avgEntryMc: st.avgMc * 1000, trades: st.trades.length, last: st.last || 0 }; }).filter(Boolean).sort(function (a, z) { return z.last - a.last; });
    return { sol: 0.5 + (hash(addr) % 900) / 10, first: coins.reduce(function (m, c) { return Math.min(m, c.t.born); }, Date.now()), coins: coins, created: all().filter(function (t) { return devOf(t) === addr; }), demo: true };
  }
  function wsum(P) { var o = { value: 0, spent: 0, got: 0, profit: 0, unreal: 0, open: 0 }; P.coins.forEach(function (c) { o.value += c.value; o.spent += c.spent; o.got += c.got; o.profit += c.profit; if (c.held > 1) { o.open++; o.unreal += c.value - (c.spent - c.got > 0 ? Math.min(c.spent, c.spent - c.got) : 0); } }); o.realized = o.profit - o.unreal; o.port = o.value + (P.sol || 0) * SOL_USD; return o; }
  function usdP(v) { return (v >= 0 ? '+' : '−') + '$' + money(v); }
  // hover preview
  var pvEl = null, pvFor = null, pvT = null;
  function pvHTML(addr) {
    var P = wprof(addr), sm = wsum(P), t = find(S.tick), dev = t && devOf(t) === addr, me = S.account && addr === S.account, hp = 0;
    if (t) { var hh = holdersOf(t).filter(function (h) { return h.a === addr; })[0]; if (hh) hp = hh.pct; }
    var cur = t && P.coins.filter(function (c) { return c.t.tick === t.tick; })[0];
    var row = function (k, v, cl) { return '<div class="pv-r"><span>' + k + '</span><b class="mono ' + (cl || '') + '">' + v + '</b></div>'; };
    return '<div class="pv-h"><span class="av" style="width:40px;height:40px">' + A.svg(walletSpec(addr)) + '</span><span class="pv-n"><b>' + esc(me ? 'You' : walletName(addr)) + '</b><small class="mono">' + short(addr) + '</small></span>' + (dev ? '<span class="bdg dev">DEV</span>' : '') + '</div>' +
      (dev ? '<div class="pv-note">Creator of $' + esc(t.tick) + ' · holds ' + hp.toFixed(hp < 1 ? 2 : 1) + '% of supply</div>' : hp > 0 ? '<div class="pv-note">Holds ' + hp.toFixed(hp < 1 ? 2 : 1) + '% of $' + esc(t.tick) + '</div>' : '') +
      (P.loading ? '<div class="pv-load"><span class="gr-sp"></span>Loading wallet…</div>' :
        row('SOL balance', P.sol != null ? P.sol.toFixed(4) : '—') + row('Portfolio', '$' + money(sm.port)) + row('Holding', sm.open + (sm.open === 1 ? ' token' : ' tokens')) + row('PnL', usdP(sm.profit), sm.profit >= 0 ? 'up' : 'down') +
        (t ? (function () { var o = traderStats(t, addr); if (!o.bN && !o.sN) return ''; var u = function (v) { return '$' + money(v); }, pn = o.sU + o.unreal - o.bU, pct = o.bT > 0 ? Math.min(100, o.held / o.bT * 100) : 0;
          return '<div class="pv-tr"><div class="pv-th">On $' + esc(t.tick) + '</div>' +
            '<div class="pv-tl"><span>Bought</span><b class="mono down">' + u(o.bU) + '</b><em class="mono">' + fmtNum(o.bT) + '</em><i class="mono">' + o.bN + ' txn' + (o.bN === 1 ? '' : 's') + '</i></div>' +
            '<div class="pv-tl"><span>Sold</span><b class="mono up">' + u(o.sU) + '</b><em class="mono">' + fmtNum(o.sT) + '</em><i class="mono">' + o.sN + ' txn' + (o.sN === 1 ? '' : 's') + '</i></div>' +
            '<div class="pv-tl"><span>Unrealized</span><b class="mono">' + u(o.unreal) + '</b><em class="pv-ub"><u style="width:' + pct.toFixed(0) + '%"></u></em><i class="mono">' + fmtNum(o.held) + ' of ' + fmtNum(o.bT) + '</i></div>' +
            '<div class="pv-tl tot"><span>PnL</span><b class="mono ' + (pn >= 0 ? 'up' : 'down') + '">' + (pn >= 0 ? '+' : '−') + u(Math.abs(pn)) + '</b><em class="mono ' + (pn >= 0 ? 'up' : 'down') + '">' + (o.bU ? (pn >= 0 ? '+' : '') + (pn / o.bU * 100).toFixed(1) + '%' : '') + '</em><i></i></div></div>'; })() : '') +
        (cur && !(t && (traderStats(t, addr).bN || traderStats(t, addr).sN)) ? '<div class="pv-cur">' + avatarHTML(cur.t, 18) + '<span>On $' + esc(cur.t.tick) + '</span><b class="mono ' + (cur.profit >= 0 ? 'up' : 'down') + '">' + usdP(cur.profit) + ' <i>' + (cur.profitPct >= 0 ? '+' : '') + cur.profitPct.toFixed(1) + '%</i></b></div>' : '')) +
      '<div class="pv-f"><button class="btn sec" data-act="wallet" data-arg="' + esc(addr) + '">View profile</button><button class="iconbtn" data-act="copyW" data-arg="' + esc(addr) + '" title="Copy address">' + I.copy + '</button></div>';
  }
  function pvFill() { if (pvEl && pvFor) pvEl.innerHTML = pvHTML(pvFor); }
  function pvClose() { clearTimeout(pvT); if (pvEl) { pvEl.remove(); pvEl = null; pvFor = null; } }
  document.addEventListener('mouseover', function (e) {
    if (window.matchMedia('(max-width: 760px)').matches) return;
    var m = e.target.closest && e.target.closest('.maker'), inCard = e.target.closest && e.target.closest('.wpv');
    if (inCard) { clearTimeout(pvT); return; }
    if (!m) { if (pvEl) { clearTimeout(pvT); pvT = setTimeout(pvClose, 220); } return; }
    var addr = m.getAttribute('data-arg'); if (!addr || pvFor === addr) { clearTimeout(pvT); return; }
    clearTimeout(pvT); pvT = setTimeout(function () { pvClose(); pvFor = addr; pvEl = document.createElement('div'); pvEl.className = 'wpv'; pvEl.innerHTML = pvHTML(addr); document.body.appendChild(pvEl);
      var r = m.getBoundingClientRect(), cw = pvEl.offsetWidth, ch = pvEl.offsetHeight, x = Math.max(8, Math.min(window.innerWidth - cw - 8, r.left)), y = r.bottom + 8 + ch > window.innerHeight ? Math.max(8, r.top - ch - 8) : r.bottom + 8;
      pvEl.style.left = x + 'px'; pvEl.style.top = y + 'px'; }, 260);
  });
  document.addEventListener('scroll', function () { pvClose(); }, true);
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.wpv [data-act]')) setTimeout(pvClose, 0); }, true);
  function walletDrawer() {
    if (!S.walletView) return '';
    var addr = S.walletView, t = find(S.tick) || featured(), P = wprof(addr), sm = wsum(P), me = S.account && addr === S.account, tracked = S.trackWallets.indexOf(addr) !== -1, spec = walletSpec(addr);
    var tabs = [['open', 'Open', P.coins.filter(function (c) { return c.held > 1; }).length], ['closed', 'Closed', P.coins.filter(function (c) { return c.held <= 1; }).length], ['created', 'Created', P.created.length], ['coin', '$' + t.tick, null]];
    if (!tabs.some(function (x) { return x[0] === S.wTab; })) S.wTab = 'open';
    var head = '<div class="wp-ban" style="--wb:' + (spec.bg || '#1d3b2c') + '"><span class="wp-ban-av">' + A.svg(spec) + '</span></div><div class="wp-top"><span class="av wp-av" style="width:96px;height:96px">' + A.svg(spec) + '</span>' +
      '<div class="wp-id"><b>' + esc(me ? 'You' : walletName(addr)) + '</b>' + (P.created.length ? '<span class="bdg dev">DEV · ' + P.created.length + '</span>' : '') + '<button class="copy wp-addr mono" data-act="copyW" data-arg="' + esc(addr) + '">' + esc(addr.slice(0, 6) + '…' + addr.slice(-6)) + ' ' + I.copy + '</button>' +
        '<small class="muted">' + (P.first && P.coins.length ? 'First trade on treid ' + ago(P.first) + ' ago' : P.loading ? 'Loading…' : 'No trades on treid yet') + '</small></div>' +
      '<div class="wp-btns"><button class="btn ' + (tracked ? 'sec' : 'pri') + '" data-act="trackW" data-arg="' + esc(addr) + '">' + (tracked ? 'Tracking ✓' : 'Track') + '</button><button class="btn sec" data-act="maker" data-arg="' + esc(addr) + '">Its trades on $' + esc(t.tick) + '</button><a class="btn sec" href="https://solscan.io/account/' + esc(addr) + '" target="_blank" rel="noopener">Solscan ↗</a></div></div>';
    var stat = function (k, v, cl, sub) { return '<div class="wp-s"><small>' + k + '</small><b class="mono ' + (cl || '') + '">' + v + '</b>' + (sub ? '<span class="muted mono">' + sub + '</span>' : '') + '</div>'; };
    var stats = '<div class="wp-stats">' + stat('Portfolio value', '$' + money(sm.port), '', P.sol != null ? P.sol.toFixed(3) + ' SOL + tokens' : '') + stat('SOL balance', P.sol != null ? P.sol.toFixed(4) : '—', '', P.sol != null ? '≈ $' + money(P.sol * SOL_USD) : '') +
      stat('Total PnL', usdP(sm.profit), sm.profit >= 0 ? 'up' : 'down', sm.spent ? (sm.profit >= 0 ? '+' : '') + (sm.profit / sm.spent * 100).toFixed(1) + '%' : '') + stat('Realized', usdP(sm.realized), sm.realized >= 0 ? 'up' : 'down') + stat('Unrealized', usdP(sm.unreal), sm.unreal >= 0 ? 'up' : 'down') + stat('Buy volume', '$' + money(sm.spent), '', P.coins.length + ' coins') + '</div>';
    var tabH = '<div class="wp-tabs">' + tabs.map(function (x) { return '<button class="' + (S.wTab === x[0] ? 'on' : '') + '" data-act="wTab" data-arg="' + x[0] + '">' + esc(x[1]) + (x[2] != null ? ' <em>' + x[2] + '</em>' : '') + '</button>'; }).join('') + '</div>';
    var body = '';
    if (S.wTab === 'open' || S.wTab === 'closed') { var L = P.coins.filter(function (c) { return S.wTab === 'open' ? c.held > 1 : c.held <= 1; }).sort(function (a, z) { return S.wTab === 'open' ? z.value - a.value : z.profit - a.profit; });
      body = '<div class="wp-t"><div class="wp-tr wp-th"><span>Coin</span><span class="r">MCap</span><span class="r">' + (S.wTab === 'open' ? 'Value' : 'Got back') + '</span><span class="r">PnL</span></div>' + (L.length ? L.map(function (c) {
        return '<button class="wp-tr" data-act="open" data-arg="' + esc(c.t.tick) + '"><span class="wp-c">' + avatarHTML(c.t, 36) + '<span><b>' + esc(c.t.name) + '</b><small class="muted mono">' + (c.held > 1 ? fmtNum(c.held) + ' $' + esc(c.t.tick) : '$' + esc(c.t.tick)) + '</small></span></span>' +
          '<span class="r"><b class="mono">' + fmtK(c.t.mcN) + '</b><small class="muted">' + (c.avgEntryMc ? 'Avg entry ' + fmtK(c.avgEntryMc / 1000) : '') + '</small></span>' +
          '<span class="r"><b class="mono">$' + money(S.wTab === 'open' ? c.value : c.got) + '</b><small class="muted">Spent $' + money(c.spent) + '</small></span>' +
          '<span class="r"><b class="mono ' + (c.profit >= 0 ? 'up' : 'down') + '">' + usdP(c.profit) + '</b><small class="mono ' + (c.profit >= 0 ? 'up' : 'down') + '">' + (c.profitPct >= 0 ? '+' : '') + c.profitPct.toFixed(1) + '%</small></span></button>'; }).join('') : '<div class="muted wp-empty">' + (P.loading ? 'Loading…' : S.wTab === 'open' ? 'No open positions on treid.' : 'No closed positions yet.') + '</div>') + '</div>'; }
    else if (S.wTab === 'created') { body = devHistoryHTML(addr) + '<div class="wp-t">' + (P.created.length ? P.created.map(function (c) { return '<button class="wp-tr wp-cr" data-act="open" data-arg="' + esc(c.tick) + '"><span class="wp-c">' + avatarHTML(c, 36) + '<span><b>' + esc(c.name) + '</b><small class="muted mono">$' + esc(c.tick) + ' · ' + ago(c.born) + ' ago</small></span></span><span class="r"><b class="mono">' + fmtK(c.mcN) + '</b><small class="muted">' + (c.prog >= 100 ? '🎓 graduated' : c.prog.toFixed(0) + '% curve') + '</small></span><span class="r"><b class="mono">' + fmtK(athOf(c)) + '</b><small class="muted">ATH</small></span></button>'; }).join('') : '<div class="muted wp-empty">Hasn’t launched a coin on treid.</div>') + '</div>'; }
    else { var st = walletStats(addr, t), pc = st.pnl >= 0 ? 'up' : 'down', sg = function (v) { return (v >= 0 ? '+' : '') + v.toFixed(3); };
      body = '<div class="dw-pnl"><span class="muted">PnL on $' + esc(t.tick) + '</span><b class="mono ' + pc + '">' + sg(st.pnl) + ' SOL</b><span class="chgpill ' + pc + '">' + (st.roi >= 0 ? '+' : '') + st.roi.toFixed(1) + '%</span></div><div class="dw-grid">' +
        [['Bought', '<span class="up">' + st.b.toFixed(3) + ' SOL</span>', st.nb + ' buys'], ['Sold', '<span class="down">' + st.s.toFixed(3) + ' SOL</span>', st.ns + ' sells'], ['Holding', fmtNum(st.hold) + ' $' + esc(t.tick), st.holdPct.toFixed(3) + '% of supply'], ['Value now', st.val.toFixed(3) + ' SOL', '$' + (st.val * SOL_USD).toFixed(2)], ['Avg entry', st.avgMc ? fmtK(st.avgMc) + ' MC' : '—', ''], ['First / last trade', st.first ? ago(st.first) + ' / ' + ago(st.last) : '—', '']].map(function (r) { return '<div><span class="muted">' + r[0] + '</span><b class="mono">' + r[1] + '</b>' + (r[2] ? '<small class="muted mono">' + r[2] + '</small>' : '') + '</div>'; }).join('') + '</div>' +
        '<div class="dw-sub">Where it bought &amp; sold</div>' + walletChart(addr, t, st) + '<div class="dw-sub">Trades</div><div class="dw-trades">' + (st.trades.length ? st.trades.slice().reverse().map(function (x) { return '<div class="dwt ' + (x.side === 'buy' ? 'b' : 's') + '"><span class="ty">' + (x.side === 'buy' ? 'Buy' : 'Sell') + '</span><span class="mono">' + x.sol.toFixed(3) + ' SOL</span><span class="mono muted">@ ' + fmtK((x.price || price(t)) * 1e9 / 1000) + '</span><span class="mono muted">' + ago(x.t) + '</span><button class="txb" data-act="tx" data-arg="' + esc(x.sig || '') + '" aria-label="Copy transaction">' + I.copy + '</button></div>'; }).join('') : '<div class="muted" style="padding:10px 0">No trades on this coin yet.</div>') + '</div>'; }
    return '<div class="overlay wp-ov" data-act="bg"><div class="wp" role="dialog" aria-modal="true" aria-label="Wallet profile"><button class="iconbtn wp-x" data-act="closeW" aria-label="Close">✕</button>' + head + stats + tabH + '<div class="wp-body">' + body + '</div>' + (P.demo && DEMO ? '<span class="note">Simulated wallet data in this demo.</span>' : '') + '</div></div>';
  }

  S.lbTab = 'traders';
  // ---- ATH + milestone badges (ever reached) ----
  function athOf(t) {
    if (t.ath == null) { var hmax = Math.max.apply(null, t.hist.concat([t.mcN])); t.ath = t.devPct != null ? hmax : hmax * (1 + (hash(t.tick + 'ath') % 45) / 100); }
    if (t.prog < 100 && t.ath > 69) t.ath = Math.max(t.mcN, 69 * .98);
    if (t.mcN > t.ath) t.ath = t.mcN; return t.ath;
  }
  var MSB = [[1e5, '100K', '🔥', 'Hit $100K'], [1e6, '1M', '🚀', 'Hit $1M'], [1e7, '10M', '🌕', 'Hit $10M'], [1e8, '100M', '👑', 'Hit $100M']];
  function msBadges(t, cls) {
    var a = athOf(t) * 1000, out = '';
    if (t.prog >= 100) out += '<span class="msb grad" title="Graduated from the bonding curve">🎓<b>GRAD</b></span>';
    MSB.forEach(function (m) { if (t.prog >= 100 && a >= m[0]) out += '<span class="msb m' + m[1] + '" title="' + m[3] + ' (all-time high ' + fmtK(a / 1000) + ')">' + m[2] + '<b>' + m[1] + '</b></span>'; });
    return out ? '<span class="msbs ' + (cls || '') + '">' + out + '</span>' : '';
  }
  function mcJourney(t) {
    var M = [[5e3, '5K', '', 'start'], [69e3, 'GRAD', '🎓', 'grad'], [1e5, '100K', '🔥', 'm100K'], [1e6, '1M', '🚀', 'm1M'], [1e7, '10M', '🌕', 'm10M'], [1e8, '100M', '👑', 'm100M']];
    var f = function (usd) { usd = Math.max(5e3, Math.min(1e8, usd)); for (var k = 0; k < M.length - 1; k++) { if (usd <= M[k + 1][0]) { var a = Math.log10(M[k][0]), b = Math.log10(M[k + 1][0]); return (k + (Math.log10(usd) - a) / (b - a)) / (M.length - 1) * 100; } } return 100; };
    var mc = t.mcN * 1000, ath = athOf(t) * 1000, x = f(mc), ax = f(ath);
    return '<span class="jr jr2" title="' + fmtK(t.mcN) + ' now · ATH ' + fmtK(ath / 1000) + '"><span class="jr-track"><i class="jr-fill" style="width:' + x.toFixed(1) + '%"></i>' +
      (ax - x > 1.5 ? '<i class="jr-ath" style="left:' + x.toFixed(1) + '%;width:' + (ax - x).toFixed(1) + '%"></i>' : '') +
      M.map(function (m, k) { var p = k / (M.length - 1) * 100, hit = m[3] === 'start' ? false : m[3] === 'grad' ? t.prog >= 100 : t.prog >= 100 && ath >= m[0];
        return '<i class="jn ' + m[3] + (hit ? ' hit' : '') + '" style="left:' + p + '%" title="' + (m[3] === 'start' ? 'Launch' : m[3] === 'grad' ? (hit ? 'Graduated' : 'Not graduated yet') : (hit ? 'Reached ' : 'Not yet ') + '$' + m[1]) + '">' + (hit && m[2] ? '<span>' + m[2] + '</span>' : '') + '<u>' + m[1] + '</u></i>'; }).join('') +
      '<span class="jr-dot" style="left:' + x.toFixed(1) + '%"></span></span></span>';
  }
  function lbSpark(t, w, h, id) {
    var d = t.hist.slice(-40), mx = Math.max.apply(null, d), mn = Math.min.apply(null, d), sp = (mx - mn) || 1, up = d[d.length - 1] >= d[0];
    var line = 'M' + d.map(function (v, i) { return (i * w / (d.length - 1)).toFixed(1) + ' ' + (h - 3 - (v - mn) / sp * (h - 6)).toFixed(1); }).join(' L');
    return '<svg class="lb-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="url(#' + (up ? 'ccUp' : 'ccDn') + ')"/><path class="draw" d="' + line + '" fill="none" stroke="' + (up ? '#3DDC97' : '#F2708A') + '" stroke-width="2" vector-effect="non-scaling-stroke" pathLength="1"/></svg>';
  }
  S.lbPer = '7d';
  function lbYou(kind) { return S.account ? '<div class="lb2-you"><span class="lb2-rk mono">You</span>' + walletPill(S.account) + '<span class="muted">' + kind + '</span></div>' : '<div class="lb2-you off"><span class="muted">Connect a wallet to see your rank</span><button class="btn sec" data-act="openWallet">Connect</button></div>'; }
  function walletPill(a) { return '<span class="lb2-w"><span class="av" style="width:30px;height:30px">' + A.svg(walletSpec(a)) + '</span><b>' + esc(walletName(a)) + '</b></span>'; }
  function usdS(v) { var a = Math.abs(v); return (v >= 0 ? '+' : '−') + '$' + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(a < 10 ? 2 : 0)); }
  function lbLoad() { if (!API || S._lbBusy === S.lbPer) return; var per = S.lbPer; S._lbBusy = per; apiGet('/api/leaderboard?per=' + encodeURIComponent(per)).then(function (d) { S.lbReal = { per: per, d: d, at: Date.now() }; S._lbBusy = null; if (S.screen === 'leaders') render(); }).catch(function () { S._lbBusy = null; }); }
  function lbData(tab) {
    if (!DEMO) {   // real: computed by the indexer from on-chain trades
      var L = S.lbReal && S.lbReal.per === S.lbPer ? S.lbReal.d : null; if (!L || Date.now() - S.lbReal.at > 60e3) lbLoad(); if (!L) return [];
      var tk = function (m) { return S.live.filter(function (x) { return x.ca === m; })[0]; };
      if (tab === 'traders') return L.traders.map(function (e) { var bt = e.best && tk(e.best.mint), win = e.coins ? e.wins / e.coins * 100 : 0;
        e = { wallet: String(e.wallet), pnl: Number(e.pnl) || 0, n: Number(e.n) || 0, coins: Number(e.coins) || 0, wins: Number(e.wins) || 0, best: e.best ? { mint: String(e.best.mint), x: Number(e.best.x) || 0 } : null };
        return { a: e.wallet, v: e.pnl, cols: [{ v: usdS(e.pnl), c: e.pnl >= 0 ? 'up' : 'down', big: 1 }, { v: win.toFixed(0) + '%', c: win >= 55 ? 'up' : '' }, { v: fmtNum(e.n) }, { v: bt ? '<span class="lb2-coin">' + avatarHTML(bt, 18) + '$' + esc(bt.tick) + '</span> <b class="' + (e.best.x >= 1 ? 'up' : 'down') + '">' + e.best.x.toFixed(1) + 'x</b>' : '—', raw: 1 }], sub: e.n + ' trades · ' + win.toFixed(0) + '% win', main: usdS(e.pnl) }; });
      if (tab === 'devs') return L.devs.map(function (e) { e = { wallet: String(e.wallet), launches: Number(e.launches) || 0, grads: Number(e.grads) || 0, left: Number(e.left) || 0, best: Number(e.best) || 0 }; var rate = e.launches ? e.grads / e.launches * 100 : 0, tag = e.left / Math.max(1, e.launches) > .4 && e.launches > 1 ? ['bad', 'Often leaves'] : e.grads && !e.left ? ['good', 'Trusted builder'] : e.launches <= 1 ? ['mid', 'New dev'] : ['mid', 'Mixed record'];
        return { a: e.wallet, v: e.grads * 3 + Math.log10(e.best + 1) * 4 - e.left * 5, cols: [{ v: fmtNum(e.launches) }, { v: e.grads + ' <small class="muted">(' + rate.toFixed(0) + '%)</small>', c: rate >= 40 ? 'up' : '', raw: 1 }, { v: String(e.left), c: e.left ? 'down' : 'up' }, { v: fmtK(e.best / 1000), big: 1 }, { v: '<span class="lb2-tag ' + tag[0] + '">' + tag[1] + '</span>', raw: 1 }], sub: 'best ATH · ' + e.launches + ' launches · ' + e.grads + ' grad', main: fmtK(e.best / 1000) }; });
      if (tab === 'callers') { var m = {}; S.live.forEach(function (t) { (S.comments[t.tick] || []).forEach(function (c) { if (!c.real || c.reply != null || !c.mc0 || Date.now() - c.t > ({ '24h': 864e5, '7d': 6048e5 }[S.lbPer] || 1e13)) return; var g = (t.mcN / c.mc0 - 1) * 100, e = m[c.w] = m[c.w] || { a: c.w, n: 0, sum: 0, hit: 0, best: null }; e.n++; e.sum += g; if (g > 0) e.hit++; if (!e.best || g > e.best.g) e.best = { g: g, t: t }; }); });
        return Object.keys(m).map(function (k) { var e = m[k], avg = e.sum / e.n, hit = e.hit / e.n * 100;
          return { a: e.a, v: avg * Math.min(1, .45 + e.n * .18), cols: [{ v: (avg >= 0 ? '+' : '') + avg.toFixed(0) + '%', c: avg >= 0 ? 'up' : 'down', big: 1 }, { v: hit.toFixed(0) + '%', c: hit >= 55 ? 'up' : '' }, { v: String(e.n) }, { v: '<span class="lb2-coin">' + avatarHTML(e.best.t, 18) + '$' + esc(e.best.t.tick) + '</span> <b class="' + (e.best.g >= 0 ? 'up' : 'down') + '">' + (e.best.g >= 0 ? '+' : '') + e.best.g.toFixed(0) + '%</b>', raw: 1 }], sub: e.n + ' calls · ' + hit.toFixed(0) + '% hit', main: (avg >= 0 ? '+' : '') + avg.toFixed(0) + '%' }; }).sort(function (x, y) { return y.v - x.v; }); }
      if (tab === 'hall') return L.hall.map(function (h) { var t = tk(h.mint); if (!t) return null; var ath = h.ath / 1000, off = Math.max(0, (1 - t.mcN / ath) * 100);
        return { t: t, v: ath, cols: [{ v: fmtK(ath), big: 1 }, { v: msBadges(t) || '—', raw: 1 }, { v: fmtK(t.mcN) }, { v: off < 2 ? '<b class="up">at ATH</b>' : '−' + off.toFixed(0) + '%', c: off < 2 ? '' : 'down', raw: off < 2 }, { v: ago(t.born) }], sub: 'ATH ' + fmtK(ath), main: fmtK(ath) }; }).filter(Boolean);
      return [];
    }
    var per = S.lbPer, pm = { '24h': 864e5, '7d': 6048e5, all: 1e13 }[per], sc = { '24h': 1, '7d': 3.4, all: 11 }[per], a = all();
    if (tab === 'traders') {
      return WALLETS.map(function (w) { var r = rng(hash(w.a + 'lbt' + per)), pnl = (Math.pow(r(), 1.6) * 60 - 9) * sc * (.6 + r()), n = Math.round((8 + r() * 70) * sc), win = 32 + r() * 50, bt = a[Math.floor(r() * a.length)], bx = 1.6 + Math.pow(r(), 2) * 40;
        S.trades.forEach(function (x) { if (x.wallet === w.a && Date.now() - x.t < pm) { n++; pnl += (x.side === 'sell' ? 1 : -.2) * x.sol * .3; } });
        return { a: w.a, v: pnl, cols: [{ v: (pnl >= 0 ? '+' : '') + pnl.toFixed(1) + ' SOL', c: pnl >= 0 ? 'up' : 'down', big: 1 }, { v: win.toFixed(0) + '%', c: win >= 55 ? 'up' : '' }, { v: fmtNum(n) }, { v: '<span class="lb2-coin">' + avatarHTML(bt, 18) + '$' + esc(bt.tick) + '</span> <b class="up">' + bx.toFixed(1) + 'x</b>', raw: 1 }], sub: n + ' trades · ' + win.toFixed(0) + '% win', main: (pnl >= 0 ? '+' : '') + pnl.toFixed(1) + ' SOL' }; }).sort(function (x, y) { return y.v - x.v; });
    }
    if (tab === 'devs') {
      var devs = {}; a.forEach(function (t) { var d = devOf(t); if (d) devs[d] = 1; });
      return Object.keys(devs).map(function (d) { var h = devHistory(d), live = h.live, launches = h.past.length + live.length, grads = h.grad + live.filter(function (t) { return t.prog >= 100; }).length, best = Math.max(h.best, live.reduce(function (m, t) { return Math.max(m, athOf(t)); }, 0)), rate = launches ? grads / launches * 100 : 0;
        var sc2 = grads * 3 + Math.log10(best + 1) * 4 - h.rugs * 5, tag = h.rugs / Math.max(1, launches) > .4 ? ['bad', 'Serial rugger'] : rate >= 40 && h.rugs <= 1 ? ['good', 'Trusted builder'] : launches <= 1 ? ['mid', 'New dev'] : ['mid', 'Mixed record'];
        return { a: d, v: sc2, cols: [{ v: fmtNum(launches) }, { v: grads + ' <small class="muted">(' + rate.toFixed(0) + '%)</small>', c: rate >= 40 ? 'up' : '', raw: 1 }, { v: String(h.rugs), c: h.rugs ? 'down' : 'up' }, { v: fmtK(best), big: 1 }, { v: '<span class="lb2-tag ' + tag[0] + '">' + tag[1] + '</span>', raw: 1 }], sub: 'best ATH · ' + launches + ' launches · ' + grads + ' grad', main: fmtK(best) }; }).sort(function (x, y) { return y.v - x.v; });
    }
    if (tab === 'callers') {
      var m = {}; a.forEach(function (t) { seedComments(t).forEach(function (c) { coMeta(c, t); if (c.reply != null || !c.mc0 || Date.now() - c.t > pm) return; var g = (t.mcN / c.mc0 - 1) * 100, e = m[c.w] = m[c.w] || { a: c.w, n: 0, sum: 0, hit: 0, best: null };
        e.n++; e.sum += g; if (g > 0) e.hit++; if (!e.best || g > e.best.g) e.best = { g: g, t: t }; }); });
      return Object.keys(m).map(function (k) { var e = m[k], avg = e.sum / e.n, hit = e.hit / e.n * 100;
        return { a: e.a, v: avg * Math.min(1, .45 + e.n * .18), cols: [{ v: (avg >= 0 ? '+' : '') + avg.toFixed(0) + '%', c: avg >= 0 ? 'up' : 'down', big: 1 }, { v: hit.toFixed(0) + '%', c: hit >= 55 ? 'up' : '' }, { v: String(e.n) }, { v: '<span class="lb2-coin">' + avatarHTML(e.best.t, 18) + '$' + esc(e.best.t.tick) + '</span> <b class="' + (e.best.g >= 0 ? 'up' : 'down') + '">' + (e.best.g >= 0 ? '+' : '') + e.best.g.toFixed(0) + '%</b>', raw: 1 }], sub: e.n + ' calls · ' + hit.toFixed(0) + '% hit', main: (avg >= 0 ? '+' : '') + avg.toFixed(0) + '% avg' }; }).sort(function (x, y) { return y.v - x.v; });
    }
    var coins = a.concat(Object.keys(S.archive).map(function (k) { return S.archive[k]; }).filter(function (t) { return t.archived === 'grad'; }));
    return coins.filter(function (t) { return athOf(t) >= 100; }).sort(function (x, y) { return athOf(y) - athOf(x); }).map(function (t) { var ath = athOf(t), off = (1 - t.mcN / ath) * 100;
      return { t: t, v: ath, cols: [{ v: fmtK(ath), big: 1 }, { v: msBadges(t) || '—', raw: 1 }, { v: fmtK(t.mcN) }, { v: off < 2 ? '<b class="up">at ATH</b>' : '−' + off.toFixed(0) + '%', c: off < 2 ? '' : 'down', raw: off < 2 }, { v: ago(t.born) }], sub: 'ATH ' + fmtK(ath), main: fmtK(ath) }; });
  }
  function lbMovesKick() {
    if (!DEMO) return;   // no made-up rank changes on the real board
    clearInterval(lbMovesKick.t); lbMovesKick.t = setInterval(function () {
      var box = document.getElementById('lb2-moves'); if (!box) { clearInterval(lbMovesKick.t); return; }
      var tab = S.lbTab, full = lbData(tab), rows = full.slice(3, 40); if (!rows.length) return; var r = rows[Math.floor(Math.random() * rows.length)], i = full.indexOf(r), to = Math.max(1, i + 1 - (1 + Math.floor(Math.random() * 4)));
      var name = tab === 'hall' ? '$' + r.t.tick : walletName(r.a), why = { traders: 'after a ' + (2 + Math.random() * 30).toFixed(1) + 'x trade', devs: 'after a graduation 🎓', callers: 'call just hit +' + Math.round(20 + Math.random() * 300) + '%', hall: 'new milestone unlocked' }[tab];
      var el = document.createElement('div'); el.className = 'lb2-mv'; el.innerHTML = '<b class="up">▲ ' + (i + 1 - to) + '</b> <span>' + esc(name) + '</span> climbed to <b>#' + to + '</b> <small>' + why + '</small>';
      box.prepend(el); while (box.children.length > 3) box.removeChild(box.lastChild);
    }, 2600);
  }
  S.lbOpen = null; S.lbCoPer = '1d';
  function lbBestCallouts() {   // top callouts by the caller's profit on that coin
    var span = S.lbCoPer === '1w' ? 6048e5 : 864e5, out = [];
    (DEMO ? all() : S.live).forEach(function (t) { (DEMO ? seedComments(t) : S.comments[t.tick] || []).forEach(function (c) { if (c.reply != null || Date.now() - c.t > span) return; if (!DEMO && !c.real) return; coMeta(c, t);
      var ps = c.ps && c.ps.trades > 0 ? c.ps : null, pos = ps ? ps.value : c.pos || 0, pr = ps ? ps.profit : (c.pos || 0) * (t.mcN / (c.mc0 || t.mcN) - 1); out.push({ c: c, t: t, pos: pos, pr: pr }); }); });
    return out.sort(function (a, z) { return z.pr - a.pr; }).slice(0, 12);
  }
  function lbCoCard(x) {
    var c = x.c, t = x.t, up = x.pr >= 0, txt = c.text.length > 220 ? c.text.slice(0, 220) + '…' : c.text;
    var key = t.tick + '|' + c.id, kids = (DEMO ? seedComments(t) : S.comments[t.tick] || []).filter(function (k) { return k.reply === c.id; }).length, ic = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + d + '</svg>'; };
    var acts = '<div class="lb3-coa"><button data-act="coShare" data-arg="' + esc(key) + '" title="Share">' + ic('<path d="M4 12v8h16v-8M12 3v13M7 8l5-5 5 5"/>') + '</button>' +
      '<button class="' + (c.rtd ? 'on rt' : '') + '" data-act="coRT" data-arg="' + esc(key) + '" title="Repost">' + ic('<path d="M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3"/>') + (c.rt || '') + '</button>' +
      '<button class="' + (c.liked ? 'on lk' : '') + '" data-act="coLike" data-arg="' + esc(key) + '" title="Like"><svg viewBox="0 0 24 24" fill="' + (c.liked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z"/></svg>' + (c.likes || '') + '</button>' +
      '<button data-act="lbCo" data-arg="' + esc(key) + '" title="Comments">' + ic('<path d="M21 12a8 8 0 01-11.6 7.1L4 21l1.9-5.4A8 8 0 1121 12z"/>') + (kids || '') + '</button>' +
      (c.views ? '<span>' + ic('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>') + fmtNum(c.views) + '</span>' : '') +
      '<span class="mono lb3-mc">' + fmtK(t.mcN) + ' MC</span></div>';
    return '<div class="lb3-co"><div class="lb3-cok" data-act="lbCo" data-arg="' + esc(key) + '"><div class="lb3-coh"><span class="av" style="width:38px;height:38px">' + A.svg(walletSpec(c.w)) + '</span><b>' + esc(walletName(c.w)) + '</b><small class="muted">' + ago(c.t) + '</small></div>' +
      '<p>' + esc(txt) + '</p><div class="lb3-cob">' + avatarHTML(t, 34) + '<span class="lb3-cot"><b>$' + esc(t.tick) + '</b><small class="muted">' + esc(t.name) + '</small></span><span class="r"><small>Position</small><b class="mono">$' + money(x.pos) + '</b></span><span class="r"><small>Profit</small><b class="mono ' + (up ? 'up' : 'down') + '">' + (up ? '+' : '−') + '$' + money(x.pr) + '</b></span></div>' +
      (c.mc0 ? '<div class="lb3-cof muted">called at ' + fmtK(c.mc0) + ' MC</div>' : '') + '</div>' + acts + '</div>';
  }
  function leadersPage() {
    var tabs = [['traders', 'Traders', 'Profit from every buy and sell on treid — realised plus what you still hold.'], ['devs', 'Devs', 'Creators ranked by track record — graduations, best ATH, coins left behind.'], ['callers', 'Callers', 'Whose callouts actually pump — average gain since the call.'], ['hall', 'Hall of fame', 'Coins that hit the biggest milestones.']];
    if (!tabs.some(function (x) { return x[0] === S.lbTab; })) S.lbTab = 'traders';
    var cur = tabs.filter(function (x) { return x[0] === S.lbTab; })[0], tab = cur[0], full = lbData(tab), rows = full.slice(0, 50), hall = tab === 'hall', cut = isMob() && !S.lbAll && rows.length > 20;
    var heads = { traders: ['Profit', 'Win rate', 'Trades', 'Best trade'], devs: ['Launches', 'Graduated', 'Left', 'Best ATH', 'Record'], callers: ['Avg gain', 'Hit rate', 'Calls', 'Best call'], hall: ['ATH', 'Milestones', 'Now', 'From ATH', 'Age'] }[tab];
    var nm = function (r) { return hall ? '$' + r.t.tick : walletName(r.a); }, pic = function (r, sz) { return hall ? avatarHTML(r.t, sz) : '<span class="av" style="width:' + sz + 'px;height:' + sz + 'px">' + A.svg(walletSpec(r.a)) + '</span>'; };
    var key = function (r) { return hall ? r.t.tick : r.a; }, go = function (r) { return hall ? 'data-act="open" data-arg="' + esc(r.t.tick) + '"' : 'data-act="walletAny" data-arg="' + esc(r.a) + '"'; };
    var hero = rows[0] ? '<div class="lb3-hero"><div class="lb3-one"><span class="lb3-n1">1</span><b>' + esc(nm(rows[0])) + '</b><strong class="mono ' + (rows[0].cols[0].c || '') + '">' + rows[0].main + '</strong></div><div class="lb3-stage">' +
      '<i class="lb3-star s1">★</i><i class="lb3-star s2">★</i><i class="lb3-star s3">★</i><i class="lb3-star s4">★</i>' +
      [1, 2, 0, 3].filter(function (i) { return rows[i]; }).map(function (i) { var r = rows[i]; return '<button class="lb3-card c' + (i + 1) + '" ' + go(r) + ' title="' + esc(nm(r) + ' · ' + r.sub) + '">' + (i === 0 ? '<span class="lb3-crown">👑</span>' : '') + '<span class="lb3-num">' + (i + 1) + '</span><span class="lb3-pic">' + pic(r, i ? 120 : 190) + '</span><span class="lb3-cap"><b>' + esc(nm(r)) + '</b><em class="mono">' + r.main + '</em></span></button>'; }).join('') + '</div></div>' : '';
    var myI = S.account && !hall ? full.map(function (r) { return r.a; }).indexOf(S.account) : -1;
    var you = hall ? '' : S.account ? '<div class="lb3-you"><span class="lb3-yav">' + pic({ a: S.account }, 46) + '<em>YOU</em></span><span class="lb3-yn"><b>' + esc(short(S.account)) + '</b><small class="muted">' + (myI >= 0 ? 'Rank <b class="up">#' + (myI + 1) + '</b>' : tab === 'callers' ? 'Post a callout to get ranked' : 'Not ranked yet — trade to climb') + '</small></span><span class="lb3-yv r"><small>' + heads[0].toUpperCase() + '</small><b class="mono ' + (myI >= 0 ? full[myI].cols[0].c || '' : '') + '">' + (myI >= 0 ? full[myI].main : '—') + '</b></span></div>' : '<div class="lb3-you off"><span class="muted">Connect a wallet to see your rank</span><button class="btn sec" data-act="openWallet">Connect</button></div>';
    var list = rows.length ? rows.map(function (r, i) { var k = key(r), open = S.lbOpen === k;
      return '<div class="lb3-row' + (open ? ' open' : '') + '" style="--d:' + Math.min(i, 20) * 22 + 'ms"><button class="lb3-rm" data-act="lbOpen" data-arg="' + esc(k) + '"><span class="lb3-rk mono r' + Math.min(i + 1, 4) + '">' + (i + 1) + '</span>' + pic(r, 44) + '<span class="lb3-who"><b>' + esc(nm(r)) + (i === 0 ? ' <i class="lb3-cr">👑</i>' : '') + '</b><small class="mono muted">' + (hall ? esc(r.t.name) : short(r.a)) + '</small></span><strong class="mono ' + (r.cols[0].c || '') + '">' + r.main + '</strong><span class="lb3-chev">' + (open ? '▴' : '▾') + '</span></button>' +
        (open ? '<div class="lb3-det">' + heads.map(function (h, j) { var c = r.cols[j]; return c ? '<div><small>' + h + '</small><b class="mono ' + (c.c || '') + '">' + c.v + '</b></div>' : ''; }).join('') + '<button class="btn sec lb3-go" ' + go(r) + '>' + (hall ? 'Open coin' : 'Open wallet') + ' →</button></div>' : '') + '</div>'; }).join('') : '<div class="muted lb3-empty">Nothing here yet for this period.</div>';
    var co = lbBestCallouts();
    var right = '<aside class="lb3-side"><h2>Best callouts</h2><div class="seg lb3-cper">' + [['1d', '1D'], ['1w', '1W']].map(function (x) { return '<button class="' + (S.lbCoPer === x[0] ? 'on' : '') + '" data-act="lbCoPer" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="lb3-cos">' + (co.length ? co.map(lbCoCard).join('') : '<div class="muted lb3-empty">No callouts in this period yet. Hold a coin and post one.</div>') + '</div></aside>';
    return '<main class="wrap lb3"><div class="lb3-main"><h1 class="lb3-h">Leaderboard</h1><div class="lb3-tabs">' + tabs.map(function (x) { return '<button class="' + (tab === x[0] ? 'on' : '') + '" data-act="lbtab" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="lb3-info">ⓘ ' + cur[2] + '</div>' + hero +
      '<div class="lb3-bar">' + (hall ? '<span></span>' : '<div class="seg">' + [['24h', '1D'], ['7d', '1W'], ['all', 'All']].map(function (x) { return '<button class="' + (S.lbPer === x[0] ? 'on' : '') + '" data-act="lbper" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>') + '<span class="lb3-sort muted">↓ ' + heads[0] + '</span></div>' +
      '<div class="lb3-list' + (cut ? ' cut' : '') + '">' + you + list + '</div>' + (cut ? '<button class="btn sec lb3-all" data-act="lbAll">Show all 50</button>' : '') + '</div>' + right + '</main>';
  }


  function tokenPage() {
    var t = find(S.tick) || featured(), on = S.watch.indexOf(t.tick) !== -1, c = chg(t), id = esc(t.tick);
    var ath = athOf(t), athPct = t.mcN / ath * 100;
    var tt = S.trades.filter(function (x) { return x.tick === t.tick; }), nb = 0, ns = 0, vb = 0, vs = 0;
    tt.forEach(function (x) { if (x.side === 'buy') { nb++; vb += x.sol; } else { ns++; vs += x.sol; } });
    var q = quoteFor(t), pos = position(t), tmax = Math.max(t.buy, t.sell);
    var curveSol = t.live ? (liqK(t) * 1000 / qUsdT(t)).toFixed(2) : (t.prog / 100 * 85).toFixed(2);
    var head = '<section class="card-s tp-head2 tp-banner"><div class="tb-bg' + (t.banner ? ' ban' : '') + '" aria-hidden="true">' + (t.banner ? '<img src="' + esc(t.banner) + '" alt="">' : avatarHTML(t, 420)) + '</div><div class="tb-av">' + avatarHTML(t, 104) + '</div>' +
      '<div class="tp-id"><div class="title-xl" style="margin:0;font-size:30px">' + esc(t.name) + ' <span class="tk">$' + id + '</span>' + crBadge(t) + '</div>' + msBadges(t, 'lg') + (t.archived ? '<div class="arch-note ' + t.archived + '">' + (t.archived === 'rug' ? '⚠ Past coin · dev sold after ' + durH(t.devSoldAfter) : t.archived === 'dead' ? '💤 Past coin · inactive, faded on the curve' : '🎓 Past coin · graduated') + '</div>' : '') +
        '<div class="hs-pills" style="margin-top:8px"><button class="pill copy2" data-act="ca" data-arg="' + id + '">CA ' + esc(short(t.ca)) + ' ' + I.copy + '</button><span class="pill" style="padding-left:11px">created <span data-t="' + t.born + '">&nbsp;' + ago(t.born) + '</span>&nbsp;ago by&nbsp;' + makerHTML(devOf(t), t) + '</span>' +
        socialsHTML(t, true) +
        '<button class="pill cs-pill" data-act="siteShow" data-arg="' + id + '">🌐 Coin site</button><button class="iconbtn" data-act="star" data-arg="' + id + '" aria-label="Watchlist" aria-pressed="' + on + '">' + I.star(on) + '</button><button class="iconbtn" data-act="share" aria-label="Copy link"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8h16v-8M12 3v13M7 8l5-5 5 5"/></svg></button></div></div>' +
      '<div class="tp-key">' + (trapLeft(t) > 0 ? trapBox(t, 'head') : '') + '<div class="tax" style="background:' + taxBg(tmax) + ';padding:9px 14px"><small>TAX</small><b style="font-size:24px">' + tmax + '%</b><small style="letter-spacing:.04em;font-size:9px">BUY & SELL</small>' + (splitOf(t) ? splitBar(splitOf(t), 'mini') : '') + '</div>' +
        (tmax > 0 || (t.live && t.qMint) ? '<button class="pairbig" data-act="pairOpen" data-arg="' + esc(t.pair) + '">' + coinHTML(t.pair, 42) + '<div><small>PAIRED WITH</small><b>' + esc(pairLabel(t.pair)) + '</b><span>' + esc(pairInfo(t.pair).name) + '</span></div></button>' : '<div class="pairbig plain">' + coinHTML('SOL', 42) + '<div><small>NO PAIR</small><b>Plain coin</b><span>0% tax · trades in SOL</span></div></div>') + '</div></section>';
    var vo = vampOf(t), vampWarn = vo ? '<div class="vamp-warn">🧛 <span><b>Possible copy.</b> An older coin, <b>$' + esc(vo.tick) + '</b>' + (vo.name ? ' (' + esc(vo.name) + ')' : '') + ', uses the same ticker or name. Check the contract address before you buy.</span>' + (vo.tick && find(vo.tick) ? '<button class="btn sec" data-act="open" data-arg="' + esc(vo.tick) + '">Open original</button>' : '') + '</div>' : '';
    var kstats = '<section class="card-s kst">' + [['Market cap', '<span data-mc="' + id + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</span> <span class="chgpill ' + (c >= 0 ? 'up' : 'down') + '" data-chg="' + id + '">' + chgTxt(c) + '</span>', 'big'], ['24h vol', fmtK(t.vol)], ['Liquidity', fmtK(liqK(t))], ['Holders', fmtNum(t.holders)], ['ATH', fmtK(ath)]].map(function (r) { return '<div class="' + (r[2] || '') + '"><small>' + r[0] + '</small><b class="mono">' + r[1] + '</b></div>'; }).join('') + '</section>';
    var bp = nb + ns ? nb / (nb + ns) * 100 : 50, vp = vb + vs ? vb / (vb + vs) * 100 : 50, offAth = (1 - t.mcN / ath) * 100;
    var activity = '<section class="card-s panel actbox">' +
      (function () {
        var spanM = { '5m': 5, '1h': 60, '24h': 1440 }[S.stf || '24h'], since = Date.now() - spanM * 60000, list = tt.filter(function (x) { return x.t >= since; });
        var rb = 0, rs = 0, rbv = 0, rsv = 0; list.forEach(function (x) { if (x.side === 'buy') { rb++; rbv += x.sol; } else { rs++; rsv += x.sol; } });
        var tot = t.vol * 1000 * { '5m': .012, '1h': .09, '24h': 1 }[S.stf || '24h'], vr = rbv + rsv ? rbv / (rbv + rsv) : .55, cr = rb + rs ? rb / (rb + rs) : .55, n = Math.max(1, Math.round(tot / 180));
        var bv = tot * vr, sv = tot - bv, b = Math.round(n * cr), se = n - b, nbw = Math.round(b * .62), nsw = Math.round(se * .71);
        if (t.live) { var Uq = qUsdT(t), wb = {}, ws = {}; b = rb; se = rs; bv = 0; sv = 0; list.forEach(function (x) { var u = x.usd != null ? x.usd : x.sol * Uq; if (x.side === 'buy') { bv += u; wb[x.wallet] = 1; } else { sv += u; ws[x.wallet] = 1; } }); nbw = Object.keys(wb).length; nsw = Object.keys(ws).length; }
        var h = t.hist, ref = h[Math.max(0, h.length - 1 - Math.round(h.length * spanM / 1440))], pc = (t.mcN / ref - 1) * 100;
        var row = function (l, a, bb, fa, fb) { var tot = a + bb, w = tot ? a / tot * 100 : 50; return '<div class="st-row"><div class="st-v"><span class="up"><b class="mono">' + fa + '</b> ' + l[0] + '</span><span class="down"><b class="mono">' + fb + '</b> ' + l[1] + '</span></div><div class="bs-bar"><i style="width:' + w.toFixed(1) + '%"></i></div></div>'; };
        return '<div class="st-box"><div class="st-h"><b>Activity</b><span class="st-pc ' + (pc >= 0 ? 'up' : 'down') + '">' + (pc >= 0 ? '↑ +' : '↓ ') + pc.toFixed(1) + '%</span><span class="st-vol muted">Vol <b class="mono">' + fmtK((bv + sv) / 1000) + '</b></span><div class="seg sm st-tf">' + ['5m', '1h', '24h'].map(function (x) { return '<button class="' + ((S.stf || '24h') === x ? 'on' : '') + '" data-act="stf" data-arg="' + x + '">' + x + '</button>'; }).join('') + '</div></div>' +
          row(['buys', 'sells'], b, se, fmtNum(b), fmtNum(se)) + row(['bought', 'sold'], bv, sv, fmtK(bv / 1000), fmtK(sv / 1000)) + row(['buyers', 'sellers'], nbw, nsw, fmtNum(nbw), fmtNum(nsw)) + '</div>' +
          '<div class="st-foot"><div><small>Pool</small><b class="mono">' + fmtK(liqK(t)) + ' <em>(' + (liqK(t) * 1000 / qUsdT(t)).toFixed(2) + ' ' + esc(qSymT(t)) + ')</em></b><span class="muted">paired with ' + coinHTML(t.pair, 14) + ' ' + esc(pairLabel(t.pair)) + '</span></div>' +
          '<div><small>Creator</small><b>' + makerHTML(devOf(t), t) + '</b><span class="muted">earns ' + (+creatorCut(t).toFixed(3)) + '% of every trade' + (Math.max(t.buy, t.sell) > 0 ? '' : ' (creator rewards)') + '</span></div>' +
          '<button class="st-bub" data-act="hmap" data-arg="' + id + '">◎ Bubble map</button></div>' +
          '</section>';
      })();
    var chart = '<section class="card-s panel cpanel' + (S.cfull ? ' chart-fs' : '') + '">' + chartToolbar(t) +
      '<div class="chartbox" id="chart">' + chartSVG(t) + '</div><div class="c-help muted">scroll to zoom · drag to pan · drag the price axis to stretch · hover a marker for details</div></section>';
    // tabs
    if (S.tpTab === 'thread') S.tpTab = 'trades';
    var tabs = [['trades', 'Trades'], ['holders', 'Holders'], ['top', 'Top traders']];
    var cmAll = seedComments(t);
    var ttAll = S.ttab === 'all';
    var thread = '<aside class="tp-thread card-s"><div class="tt-h"><b>Callouts</b><div class="tt-tabs"><button class="' + (ttAll ? '' : 'on') + '" data-act="ttab" data-arg="coin">$' + id + ' <span class="mono">' + cmAll.length + '</span></button><button class="' + (ttAll ? 'on' : '') + '" data-act="ttab" data-arg="all"><i class="tt-dot"></i>All live</button></div>' + (coCanPost(t) && !coOpen() ? '<button class="co-newb" data-act="coNew" title="New callout">+</button>' : '') + '</div>' +
      coComposer(t, id, 'Call it: what\'s your take on $' + id + '?') +
      '<div class="tt-wrap"><button class="tt-new" id="tt-new" data-act="ttNew" style="display:none"></button><div id="cmts" class="tt-list' + (ttAll ? ' all' : '') + '">' + (ttAll ? allLiveHTML() : threadHTML(t, cmAll)) + '</div></div></aside>';
    var body = '';
    if (S.tpTab === 'trades') {
      var rows = tt.filter(tradeMatches).slice(0, 40);
      body = '<div class="tfilters"><div class="seg">' + [['all', 'All'], ['buy', 'Buys'], ['sell', 'Sells'], ['whale', 'Whales ≥2'], ['mine', 'Mine']].map(function (f) { return '<button class="' + (S.tpFilter === f[0] ? 'on' : '') + '" data-act="tpf" data-arg="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
        '<label class="minsol"><span class="muted">Min SOL</span><input id="minsol" class="inp" inputmode="decimal" data-bind="minSol" value="' + esc(S.minSol) + '" placeholder="0"></label>' +
        (S.tpMaker ? '<button class="chip on" data-act="maker" data-arg="">Wallet ' + esc(short(S.tpMaker)) + ' ✕</button>' : '') +
        '<span class="paused" id="tp-paused" style="display:none" data-act="resume">Paused · <b id="tp-qn">0</b> new trades — click to resume</span></div>' +
        '<div class="tbl" id="tp-tbl"><div class="trow h"><button class="link" data-act="abs" style="min-height:0;font-size:12px">' + (S.absTime ? 'Time ⇄' : 'Age ⇄') + '</button><span>Type</span><span class="r">USD</span><span class="r">' + esc(qSymT(t)) + '</span><span class="r">$' + id + '</span><span class="r">Price</span><span>Maker</span><span class="r">Txn</span></div>' +
        '<div id="tp-trades">' + (rows.length ? rows.map(function (x) { return tradeRow(x, t); }).join('') : '<div class="muted" style="padding:24px;text-align:center">No trades match these filters</div>') + '</div></div>';
    } else if (S.tpTab === 'thread') {
      var cm = seedComments(t);
      body = (coCanPost(t) && !coOpen() ? '<button class="btn sec co-newwide" data-act="coNew">+ New callout</button>' : '') + coComposer(t, id, 'Say something about $' + id + '…') +
        '<div id="cmts">' + cm.slice().sort(function (a, b) { return b.t - a.t; }).map(function (x) { return commentHTML(x, t); }).join('') + '</div>';
    } else if (S.tpTab === 'holders') {
      body = holdersTab(t);
    } else {
      var tl = topTraders(t), maxAbs = Math.max.apply(null, tl.map(function (e) { return Math.abs(e.pnl); }).concat([0.01])), maxB = Math.max.apply(null, tl.map(function (e) { return Math.max(e.b, e.s); }).concat([0.01]));
      var medal = ['#FFD15C', '#D7DEEA', '#E0A36B'], order = [1, 0, 2];
      var podium = '<div class="podium">' + order.filter(function (k) { return tl[k]; }).map(function (k) {
        var e = tl[k];
        return '<button class="pod p' + (k + 1) + '" data-act="wallet" data-arg="' + esc(e.a) + '" style="--md:' + medal[k] + '"><span class="pod-av"><span class="av" style="width:' + (k ? 56 : 72) + 'px;height:' + (k ? 56 : 72) + 'px">' + A.svg(walletSpec(e.a)) + '</span><span class="medal">' + (k + 1) + '</span></span>' +
          '<b class="pod-name">' + esc(walletName(e.a)) + '</b><span class="pod-pnl mono ' + (e.pnl >= 0 ? 'up' : 'down') + '">' + (e.pnl >= 0 ? '+' : '') + e.pnl.toFixed(2) + ' SOL</span>' +
          '<span class="pod-sub mono">' + e.n + ' trades · ' + (e.val > 0.001 ? 'still holding' : 'exited') + '</span><span class="pod-base">' + (k + 1) + '</span></button>';
      }).join('') + '</div>';
      body = podium + '<div class="tlist"><div class="tl h"><span>#</span><span>Trader</span><span>Bought / Sold</span><span>PnL</span><span class="r">Holding</span></div>' +
        tl.map(function (e, i) {
          var w = Math.abs(e.pnl) / maxAbs * 50;
          return '<div class="tl"><span class="mono muted">' + (i + 1) + '</span><span>' + makerHTML(e.a, t) + '</span>' +
            '<span class="bs-bars"><span class="bsb"><i class="b" style="width:' + (e.b / maxB * 100).toFixed(1) + '%"></i><em class="mono">' + e.b.toFixed(2) + '</em></span><span class="bsb"><i class="s" style="width:' + (e.s / maxB * 100).toFixed(1) + '%"></i><em class="mono">' + e.s.toFixed(2) + '</em></span></span>' +
            '<span class="pnlbar"><span class="mid"></span><i class="' + (e.pnl >= 0 ? 'p' : 'n') + '" style="width:' + w.toFixed(1) + '%"></i><em class="mono ' + (e.pnl >= 0 ? 'up' : 'down') + '">' + (e.pnl >= 0 ? '+' : '') + e.pnl.toFixed(2) + '</em></span>' +
            '<span class="r mono">' + (e.val > 0.001 ? e.val.toFixed(2) + ' SOL' : '<span class="muted">exited</span>') + '</span></div>';
        }).join('') + '</div>';
    }
    var tabsHTML = '<section class="card-s panel"><div class="tabs">' + tabs.map(function (x) { return '<button class="' + (S.tpTab === x[0] ? 'on' : '') + '" data-act="tpTab" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' + body + '</section>';
    // trade panel
    var PS = paySol(t), bal = PS ? (typeof S.balance === 'number' ? S.balance : null) : qBalT(t), QS = PS ? 'SOL' : qSymT(t), QK = PS ? 'SOL' : t.live && t.qMint ? t.pair : 'SOL', qP = PS || !(t.live && t.qMint) ? { sol: true } : { sol: false, usd: qUsdT(t) };
    var presets = q.isBuy ? ['reset'].concat(qPresets(qP, ['0.1', '0.5', '1', '5'])).map(function (p) { return '<button data-act="preset" data-arg="' + p + '">' + (p === 'reset' ? 'Reset' : p + ' ' + esc(QS)) + '</button>'; }).join('') :
      ['25', '50', '75', '100'].map(function (p) { return '<button data-act="sellpct" data-arg="' + p + '"' + (pos ? '' : ' disabled') + '>' + p + '%</button>'; }).join('');
    var U = PS ? SOL_USD : qUsdT(t), aN = parseFloat(String(S.amount).replace(',', '.')) || 0, pxU = price(t);
    var inUsd = q.isBuy ? aN * U : aN * pxU, outUsd = q.isBuy ? Math.max(0, aN - (q.tax || 0) - (q.fee || 0)) * U * (1 - Math.min(99, q.impact || 0) / 100) : (q.out || 0) * U;
    function usdS(v) { return v > 0 ? '≈ $' + (v < 0.01 ? '<0.01' : money(v)) : ''; }
    function f4(v) { return v > 0 && v < 0.0001 ? v.toPrecision(2) : v.toFixed(4); }
    var panel = '<section class="card-s panel tradebox">' +
      '<div class="bs"><button class="b' + (q.isBuy ? ' on' : '') + '" data-act="side" data-arg="buy">Buy</button><button class="s' + (!q.isBuy ? ' on' : '') + '" data-act="side" data-arg="sell">Sell</button></div>' +
      (jupOn(t) && q.isBuy ? '<div class="paywith"><span class="muted">Pay with</span><button class="' + (PS ? '' : 'on') + '" data-act="paySol" data-arg="0">' + coinHTML(t.pair, 16) + esc(qSymT(t)) + '</button><button class="' + (PS ? 'on' : '') + '" data-act="paySol" data-arg="1">' + coinHTML('SOL', 16) + 'SOL</button>' + (PS ? '<small class="muted">swapped to ' + esc(qSymT(t)) + ' via Jupiter first · 2 wallet approvals</small>' : '') + '</div>' : '') +
      '<div class="tb-top"><span class="muted" style="font-size:12.5px">' + (q.isBuy ? (bal != null ? 'Balance ' + (bal >= 1000 ? fmtNum(bal) : bal.toFixed(3)) + ' ' + esc(QS) : 'Amount in ' + esc(QS)) : (pos ? 'You hold ' + fmtNum(pos.tok) + ' $' + id : 'You hold 0 $' + id)) + '</span>' +
        '<button class="slipbtn" data-act="slip">Slippage ' + S.slip + '% ⚙</button></div>' +
      (S.slipOpen ? '<div class="slipbox"><span class="muted" style="font-size:12px">Max slippage</span><div class="presets">' + [1, 3, 5, 10, 20].map(function (v) { return '<button class="' + (S.slip === v ? 'on' : '') + '" data-act="setslip" data-arg="' + v + '">' + v + '%</button>'; }).join('') + '</div><span class="muted" style="font-size:11.5px">Priority fee: 0.0001 SOL · MEV protection on</span></div>' : '') +
      '<div class="amtwrap"><input id="amt" class="inp" inputmode="decimal" data-bind="amount" value="' + esc(S.amount) + '" placeholder="0.0"><span>' + (q.isBuy ? coinHTML(QK, 22) + esc(QS) : avatarHTML(t, 22) + '$' + id) + '</span></div>' +
      (inUsd > 0 ? '<div class="amt-usd mono">' + usdS(inUsd) + (q.isBuy && q.out > 0 ? ' · ≈ ' + fmtNum(q.out) + ' $' + id : '') + '</div>' : '') +
      '<div class="presets">' + presets + '</div>' +
      (PS ? '<div class="quote"><div><span class="muted">Route</span><span>SOL → ' + esc(qSymT(t)) + ' (Jupiter) → $' + id + '</span></div><div><span class="muted">Fees</span><span>coin tax ' + q.pct + '% + trading fee + Jupiter route</span></div><div style="padding-top:9px;border-top:1px solid var(--line)"><span class="muted">You receive ≈</span><span style="font-weight:800;font-size:15px">' + fmtNum(q.out) + ' $' + id + (outUsd > 0 ? ' <small class="q-usd">' + usdS(outUsd) + '</small>' : '') + '</span></div></div>' :
      '<div class="quote">' + (q.pct > 0 ? '<div><span class="muted">Coin ' + (q.isBuy ? 'buy' : 'sell') + ' tax (' + q.pct + '%)</span><span style="color:' + taxBg(q.pct) + '">' + f4(q.tax) + ' ' + esc(QS) + '</span></div>' : '') +
        '<div><span class="muted">Trading fee (' + (+q.fp.toFixed(2)) + '%)' + ' <em class="q-cr">' + (q.pct > 0 ? FEE.creatorTaxed : FEE.creatorPlain) + '% to creator</em></span><span>' + f4(q.fee) + ' ' + esc(QS) + '</span></div>' +
        '<div class="q-tot"><span class="muted">Total cost</span><span class="mono">' + (+(q.pct + q.fp).toFixed(2)) + '% · ' + f4((q.tax + q.fee)) + ' ' + esc(QS) + '</span></div>' +
        '<div><span class="muted">Price impact</span><span class="' + (q.impact > 5 ? 'down' : '') + '">' + q.impact.toFixed(2) + '%</span></div>' +
        '<div><span class="muted">Min received (' + S.slip + '% slip)</span><span>' + (q.isBuy ? fmtNum(q.min) + ' $' + id : q.min.toFixed(4) + ' ' + esc(QS)) + '</span></div>' +
        '<div style="padding-top:9px;border-top:1px solid var(--line)"><span class="muted">You receive ≈</span><span style="font-weight:800;font-size:15px">' + (q.isBuy ? fmtNum(q.out) + ' $' + id : q.out.toFixed(4) + ' ' + esc(QS)) + (outUsd > 0 ? ' <small class="q-usd">' + usdS(outUsd) + '</small>' : '') + '</span></div></div>') +
      (trapLeft(t) > 0 ? trapBox(t, 'buy') : '') +
      '<button class="big-btn btn ' + (!S.account ? 'pri' : q.isBuy ? 'up-b' : 'down-b') + '" data-act="trade" data-arg="' + id + '"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? esc(S.busy) + '…' : !S.account ? 'Connect wallet to trade' : (q.isBuy ? 'Buy $' : 'Sell $') + id) + '</button>' +
      '<span class="note">' + (t.live ? 'Real on-chain coin' + NETP + ' — every buy and sell is signed by your wallet.' : 'Wallet is real (devnet). Trades are simulated in this beta — nothing is sent on-chain.') + '</span></section>';
    var posCard = pos ? (function () {
      var ps = t.live && S.myPs && S.myPs[t.ca] && S.myPs[t.ca].trades > 0 ? S.myPs[t.ca] : null, U2 = qUsdT(t);
      var val = ps ? ps.value : pos.val * U2, pr = ps ? ps.profit : pos.pnl * U2, prp = ps ? ps.profitPct : pos.pct, up = pr >= 0;
      var spent = ps ? ps.spent : pos.cost * U2, avg = ps ? ps.avgEntryMc : 0, sup = ps ? ps.supplyPct : pos.tok / 1e7, sold = ps ? ps.soldPct : 0;
      var cell = function (k, v) { return '<div class="pc-c"><small>' + k + '</small><b class="mono">' + v + '</b></div>'; };
      return '<section class="card-s panel poscard pc2"><div class="pc-h"><b>Your position</b><span class="pc-hr">' + (sold > 0.5 ? '<span class="pc-sold">Sold ' + Math.round(sold) + '%</span>' : '') + '<button class="pc-share" data-act="shPos" data-arg="' + id + '" title="Share your PnL"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8h16v-8M12 3v13M7 8l5-5 5 5"/></svg></button></span></div>' +
        '<div class="pc-top"><div><small>Value</small><b class="mono pc-big">$' + money(val) + '</b><span class="mono muted">' + pos.val.toFixed(4) + ' ' + esc(QS) + '</span></div>' +
        '<div class="pc-pnl ' + (up ? 'up' : 'down') + '"><small>Profit</small><b class="mono">' + (up ? '+' : '−') + '$' + money(pr) + '</b><span class="mono">' + (up ? '+' : '') + prp.toFixed(1) + '%</span></div></div>' +
        '<div class="pc-grid">' + cell('Holding', fmtNum(pos.tok) + ' $' + id) + cell('Spent', '$' + moneyS(spent)) + cell('Avg entry', avg > 0 ? '$' + moneyS(avg) + ' MC' : '—') + cell('Supply held', sup.toFixed(2) + '%') + '</div>' + rwCoinHTML(t, q && q.pct > 0) +
        (t.live && coCanPost(t) ? '<button class="btn sec add-co" data-act="coNew">⊕ Add your callout</button>' : '') + '</section>';
    })() : '';
    var hsS = holdersOf(t), top10S = 0, devPct = 0, devA = devOf(t);
    hsS.slice(1, 11).forEach(function (h) { top10S += h.pct; }); hsS.forEach(function (h) { if (h.a === devA) devPct = h.pct; });
    if (!devPct) devPct = (hash(t.tick) % 40) / 10;
    function lvl(v, a, b) { return v < a ? ['ok', 'Low'] : v < b ? ['mid', 'Medium'] : ['bad', 'High']; }
    var l1 = lvl(top10S, 25, 45), l2 = lvl(devPct, 3, 8), l3 = lvl(Math.max(t.buy, t.sell), 4, 7);
    var rmS = riskMetrics(t), warnS = rmS.filter(function (m) { return m.lv === 'r'; }).length, cautS = rmS.filter(function (m) { return m.lv === 'y'; }).length;
    var lvTxt = { g: 'Looks normal', y: 'Watch', r: 'Warning' };
    var safety = '<section class="card-s panel safety"><div style="display:flex;justify-content:space-between;align-items:center"><b>What we can see</b><span class="sf-sum ' + (warnS ? 'r' : cautS ? 'y' : 'g') + '">' + (warnS ? warnS + ' warning' + (warnS > 1 ? 's' : '') : cautS ? cautS + ' to watch' : 'Nothing unusual seen') + '</span></div>' +
      rmS.map(function (m) {
        var w = m.val === 'SOLD' ? 100 : Math.min(100, parseFloat(m.val) * (m.k === 'top' ? 1.4 : m.k === 'dev' ? 9 : 6));
        return '<div class="sf-row" data-tip="' + esc(m.tip) + '"><div class="sf-top"><span class="rk-dot lv-' + m.lv + '"></span><span>' + m.lab.charAt(0) + m.lab.slice(1).toLowerCase() + '</span><b class="mono">' + m.val + '</b><span class="sf-tag ' + ({ g: 'ok', y: 'mid', r: 'bad' })[m.lv] + '">' + lvTxt[m.lv] + '</span></div><div class="sf-bar"><i class="' + ({ g: 'ok', y: 'mid', r: 'bad' })[m.lv] + '" style="width:' + w.toFixed(0) + '%"></i></div></div>';
      }).join('') +
      '<div class="sf-row sf-flags">' + (t.live && !t.auth ? '<span class="sf-mid">• Checking token authorities…</span>' : t.live ? '<span class="' + (t.auth.mint ? 'sf-ok">✓ Mint authority revoked' : 'sf-bad">! Mint authority active') + '</span><span class="' + (t.auth.freeze ? 'sf-ok">✓ Freeze authority revoked' : 'sf-bad">! Freeze authority active') + '</span>' : '<span class="sf-ok">✓ Mint authority revoked</span><span class="sf-ok">✓ Freeze authority revoked</span>') + '<span class="' + (t.prog >= 100 ? 'sf-ok">✓ LP locked forever' : 'sf-mid">• Liquidity held by bonding curve') + '</span><span class="' + (Math.max(t.buy, t.sell) >= 6 ? 'sf-bad">! High tax ' + Math.max(t.buy, t.sell) + '%' : 'sf-ok">✓ Tax ' + Math.max(t.buy, t.sell) + '% or less') + '</span></div>' +
      '<span class="note" style="text-align:left">These checks only show what is visible on-chain. They are not a guarantee — always do your own research.' + (DEMO ? ' Simulated in this beta.' : '') + '</span></section>';
    var curve = '<section class="card-s panel" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between"><b>' + (t.prog >= 100 ? 'Graduated to Meteora' : 'Bonding curve') + '</b><span class="mono" style="color:var(--ice)" data-prog="' + id + '">' + Math.min(100, t.prog).toFixed(0) + '%</span></div>' +
      '<div class="bar" style="height:12px"><i class="' + (t.prog >= 100 ? 'done' : '') + '" data-bar="' + id + '" style="width:' + Math.max(1, Math.min(100, t.prog)) + '%"></i></div>' +
      '<span class="muted" style="font-size:12.5px;line-height:1.55">' + (t.prog >= 100 ? 'Liquidity is live on Meteora.' : curveSol + ' ' + esc(qSymT(t)) + ' in the curve. Graduates to Meteora at 100%.') + '</span></section>';
    var mbuy = '<div class="m-bar"><button class="m-b" data-act="mSide" data-arg="buy">Buy</button><button class="m-s" data-act="mSide" data-arg="sell">Sell</button><span class="m-tx mono">' + (trapLeft(t) > 0 ? '🪤 ' + snipeNow(t) + '%' : 'tax ' + tmax + '%') + '</span></div>';
    return mbuy + '<main class="wrap tp-env" style="padding-top:14px;--coin:' + ((t.spec && t.spec.bg) || '#2A2418') + '"><div class="tp-glow" aria-hidden="true">' + avatarHTML(t, 300) + '</div><button class="link" data-act="home">' + I.back + 'Back to board</button>' + head +
      '<div class="tp-grid3">' + thread + '<div class="tp-main">' + vampWarn + kstats + chart + tabsHTML + '</div><aside class="tp-side">' + panel + posCard + activity + (t.desc ? '<section class="card-s panel about-b"><div class="ab-h">' + avatarHTML(t, 26) + '<b>About $' + id + '</b></div><p class="ab-t' + (t.desc.length > 220 && !S.descOpen ? ' clamp' : '') + '">' + esc(t.desc) + '</p>' + (t.desc.length > 220 ? '<button class="ab-more" data-act="descToggle">' + (S.descOpen ? 'Show less' : 'Show more') + '</button>' : '') + '</section>' : '') + taxSplitPanel(t) + crPanel(t) + safety + curve + '</aside></div></main>';
  }
  // give seeded trades real makers / prices
  S.trades.forEach(function (tr) { var t = find(tr.tick); tr.wallet = pickWallet(); tr.price = t ? price(t) * (1 + (Math.random() - 0.5) * 0.12) : 0; tr.tokens = tr.sol * SOL_USD / (tr.price || 1); tr.sig = b58(64); });
  function tpNewTrade(tr, t) {
    var tb = document.getElementById('tp-trades'); if (!tb || S.tpTab !== 'trades' || !tradeMatches(tr)) return;
    var tbl = document.getElementById('tp-tbl');
    if (tbl && tbl.matches(':hover')) { S.tpQueue++; var p = document.getElementById('tp-paused'); if (p) { p.style.display = ''; document.getElementById('tp-qn').textContent = S.tpQueue; } return; }
    tb.insertAdjacentHTML('afterbegin', tradeRow(tr, t, true)); while (tb.children.length > 40) tb.removeChild(tb.lastChild);
  }

  // ---- compact pair picker with search by name / ticker / contract address ----
  S.cpq = ''; S.cpTab = 'crypto';
  try { var CP = JSON.parse(localStorage.getItem('dl.cpairs') || '{}'); Object.keys(CP).forEach(function (k) { PAIR_INFO[k] = CP[k]; }); } catch (e) {}
  // ---- sign in once (24 h): the wallet signs one message, the server hands back a session token — no popup for every callout ----
  function psClean(p) { if (!p || typeof p !== 'object') return null; var o = {}; ['value', 'spent', 'got', 'profit', 'profitPct', 'avgEntryMc', 'soldPct', 'supplyPct', 'held', 'trades'].forEach(function (k) { o[k] = Number(p[k]) || 0; }); return o; }
  function money(v) { v = Math.abs(v); return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'K' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function moneyS(v) { v = Math.abs(v); return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e5 ? 0 : 2) + 'K' : v.toFixed(2); }
  function psStatus(ps) { return ps.held < 1 ? 'Sold all' : ps.soldPct >= 1 ? 'Sold ' + Math.round(ps.soldPct) + '%' : 'Holding'; }
  function psBlock(ps, key) {   // Position · Profit · Spent · Avg entry · Supply held · View trades
    if (!ps || !(ps.trades > 0)) return ''; var up = ps.profit >= 0, open = key && S.coTrOpen === key;
    return '<div class="ps"><div class="ps-r1"><span><small>Position</small><b class="mono">$' + money(ps.value) + '</b><em class="ps-st">' + psStatus(ps) + '</em></span><span class="ps-pr"><small>Profit</small><b class="mono ' + (up ? 'up' : 'down') + '">' + (up ? '+' : '−') + '$' + money(ps.profit) + ' <i>' + (up ? '+' : '') + ps.profitPct.toFixed(1) + '%</i></b></span></div>' +
      '<div class="ps-r2"><span>Spent <b class="mono">$' + moneyS(ps.spent) + '</b></span><span>Avg entry <b class="mono">$' + moneyS(ps.avgEntryMc) + ' MC</b></span><span>Supply held <b class="mono">' + ps.supplyPct.toFixed(2) + '%</b></span></div>' +
      (key ? '<button class="ps-tr" data-act="coTrades" data-arg="' + esc(key) + '">View trades ' + (open ? '▴' : '▾') + '</button>' + (open ? psTrades(key) : '') : '') + '</div>';
  }
  function psTrades(key) {
    var L = S.coTr && S.coTr[key]; if (!L) return '<div class="ps-tl muted">Loading trades…</div>'; if (!L.length) return '<div class="ps-tl muted">No trades found</div>';
    return '<div class="ps-tl">' + L.slice(0, 20).map(function (x) { var b = x.side === 'buy'; return '<div class="ps-t"><span class="' + (b ? 'up' : 'down') + '">' + (b ? 'Buy' : 'Sell') + '</span><span class="mono">$' + money(+x.usd || 0) + '</span><span class="mono muted">at $' + moneyS(+x.mcap_usd || 0) + ' MC</span><span class="muted">' + ago(+x.ts) + ' ago</span></div>'; }).join('') + '</div>';
  }
  function holdUsd(t) { var p = S.pos[t.tick]; return p && p.tok > 0 ? p.tok * price(t) : 0; }
  function coCanPost(t) { return !!S.account && (!t.live || holdUsd(t) >= 1); }   // like the server: you must hold ≥ $1 of the coin
  function coOpen() { return !!S.coCompose || S.replyTo != null; }
  // ===== CALLOUT PAGE: share card (PNG) · the callout + updates · the coin =====
  function calloutPage() {
    var v = S.coView || {}, t = find(v.tick); if (!t) return '<main class="wrap"><div class="route-wait"><b>Callout not found</b></div></main>';
    var list = seedComments(t), c = list.filter(function (x) { return x.id === v.id; })[0];
    if (!c) { if (t.live && !S.coViewTried) { S.coViewTried = 1; refreshCallouts(); } return '<main class="wrap"><div class="route-wait"><span class="gr-sp"></span><b>Loading callout…</b></div></main>'; }
    var mine = S.account && c.w === S.account, me = { tick: t.tick };
    var thread = threadHTML(t, list.filter(function (x) { return x.id === c.id || x.reply === c.id; }));
    var upd = mine ? '<div class="cp-upd"><textarea id="cmt-in" class="inp" data-bind="cmtDraft" maxlength="2000" placeholder="Add an update to your callout">' + (S.replyTo === c.id ? esc(S.cmtDraft || '') : '') + '</textarea>' + (S.coImg ? '<div class="co-prev"><img src="' + esc(S.coImg) + '" alt=""><button data-act="coImgDel">✕</button></div>' : '') +
      '<div class="co-bar"><label class="co-imgb" title="Add an image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-coimg hidden></label><span class="co-bar-r"><span class="muted mono" style="font-size:12px">' + (S.replyTo === c.id ? (S.cmtDraft || '').length : 0) + '/2000</span><button class="btn pri" data-act="cpPost" data-arg="' + c.id + '">' + (S.busy === 'Posting' ? 'Posting…' : 'Post') + '</button></span></div>' + (S.coErr ? '<small class="co-err">' + esc(S.coErr) + '</small>' : '') + '</div>' : '';
    var ps = c.ps, my = S.myPs && S.myPs[t.ca];
    return '<main class="wrap cp-wrap"><section class="cp-card"><canvas id="co-share" width="800" height="1200"></canvas><div class="cp-acts"><button class="btn sec" data-act="coShareLink">🔗 Copy link</button><button class="btn sec" data-act="coShareDl">⬇ Download</button></div></section>' +
      '<section class="cp-mid"><div class="cp-h"><button class="link" data-act="coBack">← </button><b>Callout</b><button class="link" data-act="coShare" data-arg="' + esc(t.tick + '|' + c.id) + '" title="Share">⇪</button></div>' + thread + upd + '</section>' +
      '<aside class="cp-side"><div class="card-s panel cp-coin">' + avatarHTML(t, 52) + '<span><b>' + esc(t.tick) + '</b><small>' + esc(t.name) + ' · ' + ago(t.born) + ' old</small></span><span class="cp-mc"><small>MC</small><b class="mono">' + fmtK(t.mcN) + '</b></span><button class="btn sec cp-view" data-act="open" data-arg="' + esc(t.tick) + '">View coin</button></div>' +
      (my ? '<div class="card-s panel"><b style="font-size:13px">Your position</b>' + psBlock(my, null) + '</div>' : '') +
      '<button class="btn pri cp-buy" data-act="open" data-arg="' + esc(t.tick) + '">Buy $' + esc(t.tick) + '</button></aside></main>';
  }
  function drawShareCard() {   // the shareable PnL card, drawn on a canvas so it downloads as a PNG
    var cv = document.getElementById('co-share'); if (!cv || !S.coView) return; var t = find(S.coView.tick); if (!t) return; var c = seedComments(t).filter(function (x) { return x.id === S.coView.id; })[0]; if (!c) return;
    var g = cv.getContext('2d'), W = cv.width, H = cv.height, ps = c.ps || { profit: 0, profitPct: 0, spent: 0, value: 0 }, up = ps.profit >= 0, col = up ? '#3DDC97' : '#F2708A';
    var bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, up ? '#06170f' : '#1a0a0e'); bg.addColorStop(1, '#0b0b0c'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.05)'; for (var x = 20; x < W; x += 40) for (var y = 20; y < H; y += 40) g.fillRect(x, y, 2, 2);
    g.textBaseline = 'top'; g.fillStyle = '#fff'; g.font = '800 40px Manrope, system-ui, sans-serif'; g.fillText('$' + t.tick, 56, 60);
    g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 22px "JetBrains Mono", monospace'; g.fillText(up ? 'PROFIT' : 'PNL', W - 56, 62);
    g.fillStyle = col; g.font = '800 92px Manrope, system-ui, sans-serif'; g.fillText((up ? '+$' : '−$') + moneyS(ps.profit), W - 56, 96);
    g.font = '700 30px "JetBrains Mono", monospace'; g.fillText((up ? '+' : '') + (ps.profitPct || 0).toFixed(1) + '%', W - 56, 200);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 20px "JetBrains Mono", monospace'; g.fillText('INVESTED', W - 56, 252); g.fillStyle = '#fff'; g.font = '800 30px "JetBrains Mono", monospace'; g.fillText('$' + moneyS(ps.spent), W - 56, 280);
    g.textAlign = 'left';
    var hs = (t.hist && t.hist.length > 1 ? t.hist : [t.mcN, t.mcN]).slice(-80), mn = Math.min.apply(null, hs), mx = Math.max.apply(null, hs), x0 = 56, x1 = W - 56, y0 = 420, y1 = 960, sx = function (i) { return x0 + (x1 - x0) * i / (hs.length - 1); }, sy = function (v) { return mx === mn ? (y0 + y1) / 2 : y1 - (y1 - y0) * (v - mn) / (mx - mn); };
    g.beginPath(); hs.forEach(function (v, i) { if (i) g.lineTo(sx(i), sy(v)); else g.moveTo(sx(i), sy(v)); }); g.strokeStyle = col; g.lineWidth = 6; g.shadowColor = col; g.shadowBlur = 24; g.stroke(); g.shadowBlur = 0;
    var fill = g.createLinearGradient(0, y0, 0, y1); fill.addColorStop(0, up ? 'rgba(61,220,151,.25)' : 'rgba(242,112,138,.22)'); fill.addColorStop(1, 'rgba(0,0,0,0)'); g.lineTo(sx(hs.length - 1), y1); g.lineTo(sx(0), y1); g.closePath(); g.fillStyle = fill; g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 20px "JetBrains Mono", monospace'; g.fillText('MARKET CAP NOW', 56, 1000); g.fillStyle = '#fff'; g.font = '800 34px "JetBrains Mono", monospace'; g.fillText(fmtK(t.mcN), 56, 1028);
    g.fillStyle = '#fff'; g.font = '800 30px Manrope, system-ui, sans-serif'; g.fillText(coName(c.w), 56, 1110); g.textAlign = 'right'; g.fillStyle = col; g.fillText('treid', W - 56, 1110); g.textAlign = 'left';
  }
  // ===== SHARE CARD (pump.fun-style): Callout / Profit, optional chart, background picker, Save PNG + Copy link =====
  var SH_BG = [['Mint', '#0b2a1d', '#06110c', '#3DDC97'], ['Night', '#141a33', '#08090f', '#7FB6FF'], ['Ember', '#331607', '#0e0805', '#FFB15C'], ['Grape', '#22113a', '#0b0710', '#B794FF'], ['Rose', '#3a0f1c', '#10070a', '#FF6B8B'], ['Ice', '#0d2b33', '#060f12', '#5AC8E8']];
  var SH_IMG = {};
  function shImg(src, cb) { if (!src) return cb(null); var c = SH_IMG[src]; if (c) return c.ok ? cb(c.im) : c.wait ? c.wait.push(cb) : cb(null);
    var im = new Image(); c = SH_IMG[src] = { im: im, wait: [cb] }; if (/^https?:/.test(src)) im.crossOrigin = 'anonymous';
    im.onload = function () { c.ok = true; var w = c.wait; c.wait = null; w.forEach(function (f) { f(im); }); }; im.onerror = function () { var w = c.wait; c.wait = null; w.forEach(function (f) { f(null); }); }; im.src = src; }
  function shAvatarSrc(spec) { var sv = A.svg(spec); if (!/xmlns=/.test(sv)) sv = sv.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'); sv = sv.replace(/width="100%"/, 'width="256"').replace(/height="100%"/, 'height="256"'); return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sv); }
  function shareOpen(tick, id, mode) { S.share = { tick: tick, id: id == null ? null : id, mode: mode || (id == null ? 'profit' : 'callout'), chart: true, bg: 0, custom: null, noImg: false }; render(); }
  function shareModal() {
    var sh = S.share; if (!sh) return ''; var t = find(sh.tick); if (!t) return '';
    var thumbs = SH_BG.map(function (b, i) { return '<button class="sh-th' + (sh.bg === i ? ' on' : '') + '" data-act="shBg" data-arg="' + i + '" title="' + b[0] + '" style="background:linear-gradient(150deg,' + b[1] + ',' + b[2] + ');--ac:' + b[3] + '"><i></i></button>'; }).join('') +
      '<button class="sh-th' + (sh.bg === 'coin' ? ' on' : '') + '" data-act="shBg" data-arg="coin" title="Coin art">' + avatarHTML(t, 40) + '</button>' +
      (sh.custom ? '<button class="sh-th' + (sh.bg === 'custom' ? ' on' : '') + '" data-act="shBg" data-arg="custom" title="Your image"><img src="' + esc(sh.custom) + '" alt=""></button>' : '') +
      '<label class="sh-th sh-add" title="Use your own image">+<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-shimg hidden></label>';
    return '<div class="modal-bg" data-act="shClose"></div><div class="sh-modal" role="dialog" aria-label="Share"><div class="sh-top"><div class="seg">' + (sh.id != null ? '<button class="' + (sh.mode === 'callout' ? 'on' : '') + '" data-act="shMode" data-arg="callout">Callout</button>' : '') + '<button class="' + (sh.mode === 'profit' ? 'on' : '') + '" data-act="shMode" data-arg="profit">Profit</button></div>' +
      '<button class="btn sec sh-ch" data-act="shChart">' + (sh.chart ? '◉ Hide chart' : '◎ Show chart') + '</button><button class="co-x" data-act="shClose" aria-label="Close">✕</button></div>' +
      '<canvas id="sh-cv" width="1000" height="640"></canvas><div class="sh-ths">' + thumbs + '</div>' +
      '<div class="sh-acts"><button class="btn sec" data-act="shSave">⬇ Save</button><button class="btn sec" data-act="shLink">🔗 Copy link</button></div></div>';
  }
  function shWrap(g, text, x, y, maxW, lh, maxLines) { var words = String(text).replace(/\s+/g, ' ').split(' '), line = '', n = 0;
    for (var i = 0; i < words.length; i++) { var test = line ? line + ' ' + words[i] : words[i]; if (g.measureText(test).width > maxW && line) { if (n === maxLines - 1) { while (g.measureText(line + '…').width > maxW && line) line = line.slice(0, -1); g.fillText(line + '…', x, y + n * lh); return n + 1; } g.fillText(line, x, y + n * lh); n++; line = words[i]; } else line = test; }
    if (line) { g.fillText(line, x, y + n * lh); n++; } return n; }
  function shRound(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function drawShare() {
    var sh = S.share, cv = document.getElementById('sh-cv'); if (!sh || !cv) return; var t = find(sh.tick); if (!t) return;
    var c = sh.id != null ? seedComments(t).filter(function (x) { return x.id === sh.id; })[0] : null, me = c ? c.w : S.account;
    var ps = c && c.ps && c.ps.trades > 0 ? c.ps : t.ca && S.myPs && S.myPs[t.ca] && (!c || c.w === S.account) ? S.myPs[t.ca] : null;
    if (!ps && c && c.mc0) { coMeta(c, t); var v1 = c.pos || 0, sp1 = v1 / Math.max(.01, t.mcN / c.mc0); ps = { value: v1, spent: sp1, profit: v1 - sp1, profitPct: sp1 ? (v1 / sp1 - 1) * 100 : 0, avgEntryMc: c.mc0 * 1000 }; }
    if (!ps && !c) { var p0 = position(t); if (p0) { var U3 = qUsdT(t); ps = { value: p0.val * U3, profit: p0.pnl * U3, profitPct: p0.pct, spent: p0.cost * U3, avgEntryMc: 0, supplyPct: p0.tok / 1e7 }; } }
    var B = typeof sh.bg === 'number' ? SH_BG[sh.bg] : SH_BG[0], artSrc = sh.noImg ? null : sh.bg === 'custom' ? sh.custom : sh.bg === 'coin' ? (t.img || shAvatarSrc(t.spec)) : null;
    var logoSrc = sh.noImg ? shAvatarSrc(t.spec) : (t.img || shAvatarSrc(t.spec));
    shImg(artSrc, function (art) { shImg(logoSrc, function (logo) { shImg(shAvatarSrc(walletSpec(me || 'x')), function (av) {
      if (!document.getElementById('sh-cv')) return; var g = cv.getContext('2d'), W = cv.width, H = cv.height, ac = B[3];
      g.clearRect(0, 0, W, H); g.save(); shRound(g, 0, 0, W, H, 34); g.clip();
      var bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, B[1]); bg.addColorStop(1, B[2]); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      var glow = g.createRadialGradient(W * .78, H * .4, 10, W * .78, H * .4, W * .6); glow.addColorStop(0, ac + '33'); glow.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = glow; g.fillRect(0, 0, W, H);
      if (art) { var s = Math.max(H * 1.05 / art.height, (W * .55) / art.width), aw = art.width * s, ah = art.height * s; g.globalAlpha = .9; g.drawImage(art, W - aw + 30, (H - ah) / 2 + 20, aw, ah); g.globalAlpha = 1;
        var fade = g.createLinearGradient(W * .35, 0, W * .75, 0); fade.addColorStop(0, B[2]); fade.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fade; g.fillRect(0, 0, W, H); }
      g.fillStyle = 'rgba(255,255,255,.035)'; for (var gx = 24; gx < W; gx += 36) for (var gy = 24; gy < H; gy += 36) g.fillRect(gx, gy, 2, 2);
      g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      if (logo) { g.save(); shRound(g, 44, 40, 84, 84, 20); g.clip(); g.drawImage(logo, 44, 40, 84, 84); g.restore(); g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2; shRound(g, 44, 40, 84, 84, 20); g.stroke(); }
      g.fillStyle = '#fff'; g.font = '800 44px Manrope, system-ui, sans-serif'; var nm = t.name.length > 18 ? t.name.slice(0, 18) + '…' : t.name; g.fillText(nm.toUpperCase(), 148, 84);
      g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '700 26px Manrope, system-ui, sans-serif'; g.fillText('$' + t.tick, 148, 118);
      g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = '800 48px Manrope, system-ui, sans-serif'; g.fillText(fmtK(t.mcN), W - 44, 92); g.textAlign = 'left';
      var top = 160, bot = sh.mode === 'callout' ? 360 : 330;
      if (sh.chart) { var hs = (t.hist && t.hist.length > 1 ? t.hist : [t.mcN, t.mcN]).slice(-90), mn = Math.min.apply(null, hs), mx = Math.max.apply(null, hs), x0 = 44, x1 = W - 44, sx = function (i) { return x0 + (x1 - x0) * i / (hs.length - 1); }, sy = function (v) { return mx === mn ? (top + bot) / 2 : bot - (bot - top) * (v - mn) / (mx - mn); };
        var gr = g.createLinearGradient(0, top, 0, bot + 40); gr.addColorStop(0, ac + '40'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.beginPath(); hs.forEach(function (v, i) { if (i) g.lineTo(sx(i), sy(v)); else g.moveTo(sx(i), sy(v)); }); g.lineTo(x1, bot + 40); g.lineTo(x0, bot + 40); g.closePath(); g.fillStyle = gr; g.fill();
        g.beginPath(); hs.forEach(function (v, i) { if (i) g.lineTo(sx(i), sy(v)); else g.moveTo(sx(i), sy(v)); }); g.strokeStyle = ac; g.lineWidth = 4; g.shadowColor = ac; g.shadowBlur = 16; g.stroke(); g.shadowBlur = 0;
        if (c && c.mc0) { var ci = Math.max(0, hs.length - 1 - Math.round(Math.min(hs.length - 1, (Date.now() - c.t) / Math.max(1, (Date.now() - t.born) / hs.length)))); g.beginPath(); g.arc(sx(ci), sy(hs[ci]), 9, 0, 6.3); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 4; g.strokeStyle = ac; g.stroke(); }
        g.beginPath(); g.arc(sx(hs.length - 1), sy(hs[hs.length - 1]), 7, 0, 6.3); g.fillStyle = ac; g.fill(); }
      var y = (sh.chart ? bot : top) + 50;
      if (av) { g.save(); g.beginPath(); g.arc(66, y - 10, 22, 0, 6.3); g.clip(); g.drawImage(av, 44, y - 32, 44, 44); g.restore(); }
      g.fillStyle = '#fff'; g.font = '800 28px Manrope, system-ui, sans-serif'; g.fillText(me ? (c ? coName(c.w) : walletName(me)) : 'treid trader', 100, y);
      if (c) { g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '600 22px Manrope, system-ui, sans-serif'; g.fillText(ago(c.t) + ' ago', W - 44, y); g.textAlign = 'left'; }
      if (sh.mode === 'callout' && c) { g.fillStyle = 'rgba(255,255,255,.92)'; g.font = '600 28px Manrope, system-ui, sans-serif'; var nl = shWrap(g, c.text || '', 44, y + 48, sh.chart ? W - 88 : W * .62, 38, sh.chart ? 2 : 5);
        g.fillStyle = ac; g.font = '800 22px Manrope, system-ui, sans-serif'; g.fillText((c.mc0 ? 'Called at ' + fmtK(c.mc0) + ' MC · ' : '') + 'View on treid', 44, y + 48 + nl * 38 + 6); }
      else { var up = ps ? ps.profit >= 0 : true, pc = up ? '#3DDC97' : '#F2708A';
        g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 20px "JetBrains Mono", monospace'; g.fillText('PROFIT', 44, y + 52);
        g.fillStyle = pc; g.font = '800 76px Manrope, system-ui, sans-serif'; g.fillText(ps ? (up ? '+$' : '−$') + moneyS(Math.abs(ps.profit)) : '—', 44, y + 128);
        var pw = g.measureText(ps ? (up ? '+$' : '−$') + moneyS(Math.abs(ps.profit)) : '—').width; g.font = '800 34px "JetBrains Mono", monospace'; g.fillText(ps ? (up ? '+' : '') + (ps.profitPct || 0).toFixed(1) + '%' : '', 64 + pw, y + 126);
        if (ps) { g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 18px "JetBrains Mono", monospace'; g.fillText('SPENT', 44, y + 176); g.fillText('POSITION', 230, y + 176); if (ps.avgEntryMc) g.fillText('AVG ENTRY', 440, y + 176);
          g.fillStyle = '#fff'; g.font = '800 26px "JetBrains Mono", monospace'; g.fillText('$' + moneyS(ps.spent), 44, y + 208); g.fillText('$' + moneyS(ps.value), 230, y + 208); if (ps.avgEntryMc) g.fillText('$' + moneyS(ps.avgEntryMc), 440, y + 208); } }
      g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = '800 40px Manrope, system-ui, sans-serif'; g.fillText('treid', W - 44 - g.measureText('.fun').width, H - 40); g.fillStyle = ac; g.fillText('.fun', W - 44, H - 40); g.textAlign = 'left';
      g.restore();
    }); }); });
  }
  // ===== COIN SITE: a free, shareable website for every coin (#/c/<CA or TICK>/<theme>) =====
  var SITE_TH = [['dark', 'Dark'], ['neon', 'Neon'], ['paper', 'Paper'], ['meme', 'Meme']];
  function siteUrl(t, th) { return location.href.split('#')[0] + '#/c/' + encodeURIComponent(t.live ? t.ca : t.tick) + (th && th !== 'dark' ? '/' + th : ''); }
  function sitePage() {
    var v = S.site || {}, t = find(v.tick); if (!t) return '<main class="wrap"><div class="route-wait"><span class="gr-sp"></span><b>Loading…</b></div></main>';
    var th = SITE_TH.some(function (x) { return x[0] === v.th; }) ? v.th : 'dark', id = esc(t.tick), c = chg(t), up = c >= 0, tm = Math.max(t.buy, t.sell), rm = riskMetrics(t), vo = vampOf(t), ds = devStatus(t), so = socialsOf(t);
    var ch = heroChart(t, 600, 160), col = (t.spec && t.spec.bg) || '#3DDC97'; (function () { var m = /^#?([0-9a-f]{6})$/i.exec(col); var n = m ? parseInt(m[1], 16) : 0, L = ((n >> 16) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114) / 255; if (!m || L < .5) col = '#3DDC97'; })();
    var soc = [['x', 'X', I.x], ['tg', 'Telegram', I.tg], ['web', 'Website', I.web]].filter(function (x) { return so[x[0]]; }).map(function (x) { return '<button class="cs-soc" data-act="soc" data-arg="' + id + '|' + x[0] + '">' + x[2] + '<span>' + x[1] + '</span></button>'; }).join('');
    var warn = (vo ? '<div class="cs-warn">🧛 Same name as an older coin, $' + esc(vo.tick) + ' — check the contract address before you buy.</div>' : '') + (ds.state === 'out' ? '<div class="cs-warn">The creator is no longer active on this coin.</div>' : '') + (rm.some(function (m) { return m.lv === 'r'; }) ? '<div class="cs-warn">⚠ Risk flags: ' + rm.filter(function (m) { return m.lv === 'r'; }).map(function (m) { return m.lab + ' ' + m.val; }).join(' · ') + '</div>' : '');
    return '<div class="cs cs-' + th + '" style="--cc:' + esc(col) + '">' +
      '<header class="cs-top"><span class="cs-brand">' + avatarHTML(t, 28) + '<b>$' + id + '</b></span><span class="cs-tr">' + soc + '<button class="cs-buy sm" data-act="open" data-arg="' + id + '">Buy $' + id + '</button></span></header>' +
      '<div class="cs-glow" aria-hidden="true">' + avatarHTML(t, 400) + '</div>' +
      '<section class="cs-hero">' + (t.banner ? '<div class="cs-ban"><img src="' + esc(t.banner) + '" alt=""></div>' : '') +
        '<div class="cs-id"><span class="cs-logo">' + avatarHTML(t, 150) + '</span><h1>' + esc(t.name) + '</h1><span class="cs-tk mono">$' + id + '</span>' +
        (t.desc ? '<p class="cs-desc">' + esc(t.desc) + '</p>' : '') +
        '<div class="cs-ctas"><button class="cs-buy" data-act="open" data-arg="' + id + '">Buy $' + id + ' on treid</button><button class="cs-ca mono" data-act="ca" data-arg="' + id + '"><small>CA</small> ' + esc(short(t.ca)) + ' ' + I.copy + '</button></div></div></section>' + warn +
      '<section class="cs-stats"><div><span class="cs-si">📈</span><small>Market cap</small><b class="mono">' + fmtK(t.mcN) + '</b><em class="' + (up ? 'up' : 'down') + '">' + chgTxt(c) + ' 24h</em></div><div><span class="cs-si">👥</span><small>Holders</small><b class="mono">' + fmtNum(t.holders) + '</b><em class="mut">vol ' + fmtK(t.vol) + '</em></div><div><span class="cs-si">🧾</span><small>Tax</small><b class="mono">' + tm + '%</b><em class="mut">' + (tm ? 'buy & sell' : 'no tax') + '</em></div><div><span class="cs-si">' + (t.prog >= 100 ? '🎓' : '⛰️') + '</span><small>' + (t.prog >= 100 ? 'Status' : 'Bonding curve') + '</small><b class="mono">' + (t.prog >= 100 ? 'Graduated' : t.prog.toFixed(0) + '%') + '</b><i class="cs-bar"><u style="width:' + Math.min(100, t.prog).toFixed(0) + '%"></u></i></div></section>' +
      '<section class="cs-chart"><svg viewBox="0 0 600 160" preserveAspectRatio="none"><defs><linearGradient id="csg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--cc)" stop-opacity=".35"/><stop offset="1" stop-color="var(--cc)" stop-opacity="0"/></linearGradient></defs><path d="' + ch.area + '" fill="url(#csg)"/><path d="' + ch.line + '" fill="none" stroke="var(--cc)" stroke-width="3" vector-effect="non-scaling-stroke"/></svg><button class="cs-chartbtn" data-act="open" data-arg="' + id + '">Open live chart →</button></section>' +
      (function () { var spl = splitOf(t), row = function (k, v) { return '<div><small>' + k + '</small><b>' + v + '</b></div>'; };
        return '<section class="cs-info"><h2>Token info</h2><div class="cs-ig">' + row('Contract', '<button class="cs-cab mono" data-act="ca" data-arg="' + id + '">' + esc(short(t.ca)) + ' ' + I.copy + '</button>') + row('Network', '◎ Solana') + row('Paired with', coinHTML(t.pair, 18) + ' ' + esc(pairLabel(t.pair))) + row('Total supply', '1,000,000,000') +
          row('Created', ago(t.born) + ' ago') + row('Creator', esc(short(devOf(t)))) + row('Launched on', 'treid · Meteora') + row('Tax split', spl ? '💎 ' + spl.h + '% · 🔥 ' + spl.b + '% · 👤 ' + spl.d + '%' : (tm ? 'set by the creator' : '—')) + '</div></section>'; })() +
      '<section class="cs-safe"><h2>On-chain, in the open</h2><div class="cs-rk">' + rm.map(function (m) { return '<div class="lv-' + m.lv + '"><small>' + m.lab + '</small><b class="mono">' + m.val + '</b></div>'; }).join('') + '</div><p>Live from the chain. Paired with ' + esc(pairLabel(t.pair)) + (tm ? ' · every trade pays a ' + tm + '% tax, split as the creator set it' : ' · no tax') + '.</p></section>' +
      '<section class="cs-how"><h2>How to buy $' + id + '</h2><ol><li><b>Get a wallet</b><span>Phantom, Solflare or Backpack.</span></li><li><b>Add some SOL</b><span>From an exchange or a card.</span></li><li><b>Open $' + id + ' on treid</b><span>Pick an amount and confirm in your wallet.</span></li></ol><button class="cs-buy" data-act="open" data-arg="' + id + '">Buy $' + id + '</button></section>' +
      '<footer class="cs-foot"><span>Launched on <b>treid</b> — launch fair, trade safer.</span><button class="cs-more" data-act="home">Explore more coins on treid →</button><small>Nothing here is financial advice. Memecoins are risky.</small></footer></div>';
  }
  function siteModal() {
    if (!S.siteShare) return ''; var t = find(S.siteShare); if (!t) return ''; var th = S.siteTh || 'dark';
    return '<div class="modal-bg" data-act="siteClose"></div><div class="sh-modal site-m" role="dialog" aria-label="Coin website"><div class="sh-top"><b style="font-size:17px">Your coin’s website</b><button class="co-x" data-act="siteClose" aria-label="Close">✕</button></div>' +
      '<p class="muted" style="margin:0;font-size:13.5px">Every coin on treid gets a free website. Pick a look and share the link on X and Telegram.</p>' +
      '<div class="site-ths">' + SITE_TH.map(function (x) { return '<button class="site-th st-' + x[0] + (th === x[0] ? ' on' : '') + '" data-act="siteTh" data-arg="' + x[0] + '"><i></i><span>' + x[1] + '</span></button>'; }).join('') + '</div>' +
      '<div class="site-link mono">' + esc(siteUrl(t, th)) + '</div><div class="sh-acts"><button class="btn sec" data-act="siteCopy">🔗 Copy link</button><button class="btn pri" data-act="siteOpen">Open site →</button></div></div>';
  }
  function coModal() {
    if (!S.coModal) return ''; var t = find(S.tick); if (!t) return ''; var upd = S.coModal.upd, n = (S.cmtDraft || '').length;
    return '<div class="modal-bg co-mbg" data-act="coCancel"></div><div class="co-modal" role="dialog" aria-label="New callout"><div class="co-mh"><b>' + (upd ? 'Update your callout' : 'New callout') + '</b><button class="co-x" data-act="coCancel" aria-label="Close">✕</button></div>' +
      '<div class="co-mcoin">' + avatarHTML(t, 44) + '<span><b>' + esc(t.name) + '</b><small>$' + esc(t.tick) + '</small></span><span class="co-mcall">Calling at MC <b>' + fmtK(t.mcN) + '</b></span></div>' +
      '<div class="co-mbody"><textarea id="cmt-in" class="inp" data-bind="cmtDraft" maxlength="2000" placeholder="' + (upd ? 'Add an update to your callout' : 'Create a callout and alert your followers') + '">' + esc(S.cmtDraft || '') + '</textarea><div class="co-cnt muted mono">' + n + ' / 2000</div>' +
      (S.coImg ? '<div class="co-prev"><img src="' + esc(S.coImg) + '" alt=""><button data-act="coImgDel" title="Remove image">✕</button></div>' : '') +
      (upd ? '' : '<p class="muted co-req">Posting a callout requires holding $1 of $' + esc(t.tick) + '.</p>') +
      (S.coErr ? '<small class="co-err">' + esc(S.coErr) + '</small>' : '') + '</div>' +
      (!upd && !S.coTipOff ? '<div class="co-tip"><div class="co-tiph"><b>Tip</b><button class="link" data-act="coTipOff">Dismiss</button></div><p>Make high-quality callouts: say why you\'re buying and link the sources that back it up.</p><div class="co-tipex"><small class="muted">Example</small><br>Buying because the dev locked their bag and the community is active on X (x.com/…). Locked supply, real team.</div></div>' : '') +
      '<div class="co-mf"><label class="co-imgb" title="Add an image or GIF"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-coimg hidden></label>' +
      '<button class="btn pri co-call" data-act="post"' + (S.busy === 'Posting' ? ' disabled' : '') + '>' + (S.busy === 'Posting' ? 'Posting…' : upd ? 'Post update' : 'Call $' + esc(t.tick)) + '</button></div></div>';
  }
  function coComposer(t, id, ph) {
    if (S.coModal) return '';
    if (!S.account) return '<div class="co-gate"><span class="muted">Connect a wallet to post a callout.</span><button class="btn sec" data-act="openWallet">Connect</button></div>';
    if (!coCanPost(t)) return '<div class="co-gate muted">Hold at least <b>$1</b> of $' + esc(id) + ' to post callouts.</div>';
    if (!coOpen()) return '';
    return '<div class="composer"><textarea id="cmt-in" class="inp" data-bind="cmtDraft" placeholder="' + (S.replyTo != null ? 'Replying to #' + (1000 + S.replyTo) + '…' : ph) + '" maxlength="280">' + esc(S.cmtDraft || '') + '</textarea>' + coImgBar() +
      (S.coErr ? '<small class="co-err">' + esc(S.coErr) + '</small>' : '') + '</div>';
  }
  function coImgBar() { return (S.coImg ? '<div class="co-prev"><img src="' + esc(S.coImg) + '" alt=""><button data-act="coImgDel" title="Remove image">✕</button></div>' : '') +
    '<div class="co-bar"><label class="co-imgb" title="Add an image or GIF"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-coimg hidden></label><span class="co-bar-r"><button class="btn sec" data-act="coCancel">Cancel</button><button class="btn pri" data-act="post"' + (S.busy === 'Posting' ? ' disabled' : '') + '>' + (S.busy === 'Posting' ? 'Posting…' : 'Post') + '</button></span></div>'; }
  function sessKey() { return 'treid.sess.' + S.account; }
  function dropSession() { try { localStorage.removeItem(sessKey()); } catch (e) {} S.sess = null; }
  function getSession() {
    var s = S.sess && S.sess.w === S.account ? S.sess : null; if (!s) { try { s = JSON.parse(localStorage.getItem(sessKey()) || 'null'); } catch (e) { s = null; } }
    if (s && s.token && s.exp > Date.now() + 60e3 && s.token.indexOf(S.account + '.') === 0) { S.sess = { w: S.account, token: s.token, exp: s.exp }; return Promise.resolve(s.token); }
    var f = S.wallet && S.wallet.features['solana:signMessage']; if (!f) return Promise.reject(new Error('This wallet can’t sign messages — try Phantom or Solflare'));
    var ts = Date.now(), who = S.account, m = 'treid: sign in \u2014 ' + who + ' \u2014 ' + ts;   // must match indexer sig.mjs signInMessage
    toast('Sign in once — no more wallet popups for the next 24 h');
    if (S.wallet && S.wallet.dl) S._dlAfter = { type: 'session', who: who, ts: ts, draft: S.cmtDraft || '', modal: S.coModal || null };
    return Promise.resolve(f.signMessage({ account: S.walletAcc, message: new TextEncoder().encode(siteMsg(m)) })).then(function (r) { var sg = (Array.isArray(r) ? r[0] : r).signature;
      return chainLib().then(function (T) { return fetch(API + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: who, ts: ts, sig: T.b58(sg) }) }).then(function (x) { return x.json(); }); }); })
      .then(function (j) { if (!j || !j.token) throw new Error((j && j.error) || 'sign-in failed'); S.sess = { w: who, token: j.token, exp: j.exp }; try { localStorage.setItem('treid.sess.' + who, JSON.stringify({ token: j.token, exp: j.exp })); } catch (e) {} return j.token; });
  }
  // callout images: shrunk in the browser (max 1280 px, WEBP), GIFs kept as they are if small enough
  function coPickImage(file) {
    if (!file) return; if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { toast('Images: PNG, JPG, GIF or WEBP'); return; }
    var rd = new FileReader(); rd.onload = function () { var url = String(rd.result);
      if (file.type === 'image/gif') { if (file.size > 1.5e6) { toast('GIF too big (1.5 MB max)'); return; } S.coImg = url; render(); return; }
      var im = new Image(); im.onload = function () { var k = Math.min(1, 1280 / Math.max(im.width, im.height)), cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); var out = cv.toDataURL('image/webp', 0.82); if (out.length > 2.1e6) out = cv.toDataURL('image/webp', 0.6);
        if (out.indexOf('data:image/webp') !== 0) out = cv.toDataURL('image/jpeg', 0.82); S.coImg = out; render(); }; im.src = url; };
    rd.readAsDataURL(file);
  }
  function siteMsg(m) { return location.host + ' wants you to sign:\n' + m; }   // wallets show this first line: a look-alike site can't reuse your signature here
  function isCA(q) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q); }
  function pairSearch(q) {
    q = q.trim(); var ql = q.toLowerCase().replace(/^\$/, ''), out = [];
    Object.keys(PAIR_INFO).forEach(function (id) { var pi = PAIR_INFO[id]; if (id.toLowerCase().indexOf(ql) > -1 || pi.name.toLowerCase().indexOf(ql) > -1 || (pi.ca && pi.ca === q)) out.push(id); });
    all().forEach(function (t) { if (out.indexOf(t.tick) > -1) return; if (t.tick.toLowerCase().indexOf(ql) > -1 || t.name.toLowerCase().indexOf(ql) > -1 || t.ca === q) out.push(t.tick); });
    return out.slice(0, 8);
  }
  // ---- one tax for buy & sell + optional anti-sniper trap ----
  // hybrid trap: 3 equal steps down (mirrors on-chain DBC linear fee scheduler, numberOfPeriod 3)
  var TRAP_STEPS = 3;
  function trapStepFee(start, base, i) { return Math.round(start - (start - base) * i / TRAP_STEPS); }
  function snipeNow(t, at) { var sn = t.snipe; if (!sn || !sn.on) return 0; var age = ((at || Date.now()) - t.born) / 1000; if (age >= sn.dur) return 0; return trapStepFee(sn.start, Math.max(t.buy, t.sell), Math.floor(age / (sn.dur / TRAP_STEPS))); }
  function trapLeft(t) { return t.snipe && t.snipe.on ? Math.max(0, t.snipe.dur - (Date.now() - t.born) / 1000) : 0; }
  function hgSVG(f) {
    f = Math.max(0, Math.min(1, f)); var yt = 19 - 14 * f, w = function (y) { return 1.2 + 8.3 * (19 - y) / 14; }, ph = 14 * (1 - f) + .01;
    return '<svg viewBox="0 0 24 40" class="hg-svg"><path d="M3 2h18M3 38h18" stroke="#EDE9E1" stroke-width="2" stroke-linecap="round"/><path d="M5 3 C5 12 11 15 11 20 C11 25 5 28 5 37 M19 3 C19 12 13 15 13 20 C13 25 19 28 19 37" fill="none" stroke="rgba(237,233,225,.55)" stroke-width="1.4"/>' +
      (f > 0 ? '<polygon points="' + (12 - w(yt)).toFixed(2) + ',' + yt.toFixed(2) + ' ' + (12 + w(yt)).toFixed(2) + ',' + yt.toFixed(2) + ' 12.8,19.6 11.2,19.6" fill="#F2708A"/><line x1="12" y1="20" x2="12" y2="36" stroke="#F2708A" stroke-width="1" stroke-dasharray="1.5 2" class="hg-fall"/>' : '') +
      '<polygon points="6,36.5 18,36.5 ' + (12 + Math.min(6, ph * .55)).toFixed(2) + ',' + (36.5 - ph * .6).toFixed(2) + ' 12,' + (36.5 - ph).toFixed(2) + ' ' + (12 - Math.min(6, ph * .55)).toFixed(2) + ',' + (36.5 - ph * .6).toFixed(2) + '" fill="#F2708A" opacity=".85"/></svg>';
  }
  function trapRing(t, sz) {
    var left = trapLeft(t), f = t.snipe ? left / t.snipe.dur : 0;
    return '<span class="tring hg" data-trapr="' + esc(t.tick) + '" style="height:' + sz + 'px" title="Sniper trap: extra tax until the timer runs out">' + hgSVG(f) + '<b class="mono">' + snipeNow(t) + '%</b></span>';
  }
  function liqContent(t, cls, rel) {
    var m = Math.max(t.buy, t.sell), id = esc(t.tick), left = trapFmt(trapLeft(t));
    if (rel) return cls === 'card' ? '<small>TAX</small><b>' + m + '%</b><em>released</em>' : cls === 'head' ? '<b>✓ Trap over</b><small>tax is now ' + m + '%</small>' : '<b>✓ Sniper trap is over</b><small>Normal ' + m + '% tax from now on.</small>';
    if (cls === 'card') return '<small>SNIPER TAX</small><b data-trapv="' + id + '">' + snipeNow(t) + '%</b><em class="mono" data-liqt>' + left + '</em>';
    if (cls === 'head') return '<span class="lq-big mono" data-trapv="' + id + '">' + snipeNow(t) + '%</span><span class="lq-tx"><b>🪤 Sniper tax</b><small>drops to <i>' + m + '%</i> in <i class="mono" data-liqt>' + left + '</i></small></span>';
    return '<span class="lq-big mono" data-trapv="' + id + '">' + snipeNow(t) + '%</span><span class="lq-tx"><b>Sniper tax is on</b><small>Buying now costs <i data-trapv="' + id + '">' + snipeNow(t) + '%</i> tax. It steps down every ' + Math.round(t.snipe.dur / TRAP_STEPS) + 's and reaches <i>' + m + '%</i> in <i class="mono" data-liqt>' + left + '</i>.</small></span>';
  }
  function trapBox(t, cls) {
    var f = t.snipe ? trapLeft(t) / t.snipe.dur : 0;
    return '<div class="liq liq-' + cls + '" data-liq="' + esc(t.tick) + '" data-liqc="' + cls + '" style="--f:' + f.toFixed(3) + '"><span class="liq-fill"><svg class="liq-w" viewBox="0 0 120 10" preserveAspectRatio="none"><path d="M0 5 Q7.5 0 15 5 T30 5 T45 5 T60 5 T75 5 T90 5 T105 5 T120 5 V10 H0Z"/></svg></span><span class="liq-c">' + liqContent(t, cls) + '</span></div>';
  }
  setInterval(function () {
    document.querySelectorAll('[data-liq]').forEach(function (e) { var t = find(e.getAttribute('data-liq')); if (!t || !t.snipe) return; var left = trapLeft(t);
      if (left <= 0) { if (e.classList.contains('rel')) return; e.classList.add('rel'); e.style.setProperty('--f', 0); e.querySelector('.liq-c').innerHTML = liqContent(t, e.getAttribute('data-liqc'), true); var tc = e.closest('.tcard'); if (tc) tc.classList.add('released'); return; }
      e.style.setProperty('--f', (left / t.snipe.dur).toFixed(3)); var tt = e.querySelectorAll('[data-liqt]'); for (var k = 0; k < tt.length; k++) tt[k].textContent = trapFmt(left); });
  }, 200);
  function trapRingOld(t, sz) {
    var left = trapLeft(t), f = t.snipe ? left / t.snipe.dur : 0, R = 15.5, C = 2 * Math.PI * R;
    return '<span class="tring" data-trapr="' + esc(t.tick) + '" style="width:' + sz + 'px;height:' + sz + 'px" title="Sniper trap: higher tax for early buyers"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="' + R + '" class="tr-bg"/><circle cx="18" cy="18" r="' + R + '" class="tr-fg" stroke-dasharray="' + (C * f).toFixed(2) + ' ' + C.toFixed(2) + '" transform="rotate(-90 18 18)"/></svg><b class="mono">' + snipeNow(t) + '%</b></span>';
  }
  function trapFmt(sec) { sec = Math.ceil(sec); return sec >= 60 ? Math.floor(sec / 60) + 'm ' + (sec % 60 < 10 ? '0' : '') + (sec % 60) + 's' : sec + 's'; }
  setInterval(function () {
    document.querySelectorAll('[data-trapr]').forEach(function (e) { var t = find(e.getAttribute('data-trapr')); if (!t) return; var left = trapLeft(t);
      if (left <= 0) { if (e.classList.contains('over')) return; var host = e.closest('[data-traphost]'); if (host) { host.classList.add('trap-released'); setTimeout(function () { host.classList.add('trap-over'); }, 1400); } e.classList.add('over'); e.querySelector('b').textContent = Math.max(t.buy, t.sell) + '%'; e.querySelector('svg').outerHTML = hgSVG(0); return; }
      e.querySelector('svg').outerHTML = hgSVG(left / t.snipe.dur); e.querySelector('b').textContent = snipeNow(t) + '%'; });
    document.querySelectorAll('[data-hgtax]').forEach(function (e) { var t = find(e.getAttribute('data-hgtax')); if (!t) return; var left = trapLeft(t);
      if (left <= 0) { if (e.classList.contains('rel')) return; var m = Math.max(t.buy, t.sell); e.classList.add('rel'); e.style.background = taxBg(m); e.innerHTML = '<small>TAX</small><b>' + m + '%</b><i class="rel-burst"></i>'; var tc = e.closest('.tcard'); if (tc) { var tr = tc.querySelector('.trap-c'); if (tr) tr.remove(); tc.classList.add('released'); } return; }
      var sv = e.querySelector('.hg-svg'); if (sv) sv.outerHTML = hgSVG(left / t.snipe.dur); var tt = e.querySelector('.hgt-t'); if (tt) tt.textContent = trapFmt(left); });
    document.querySelectorAll('[data-trapv]').forEach(function (e) { var t = find(e.getAttribute('data-trapv')); if (t && trapLeft(t) > 0) { var v = snipeNow(t) + '%'; if (e.textContent !== v) { e.textContent = v; e.classList.remove('stepdn'); void e.offsetWidth; e.classList.add('stepdn'); } } });
    document.querySelectorAll('[data-trapt]').forEach(function (e) { var t = find(e.getAttribute('data-trapt')); if (t) e.textContent = trapFmt(trapLeft(t)); });
  }, 250);
  // trading fee, % of each trade. On-chain split of every fee: creator 40% · treid 40% · Meteora (DEX protocol) 20%
  var FEE = { plain: 1, taxed: 0.5, creatorPlain: 0.4, treidPlain: 0.4, dexPlain: 0.2, creatorTaxed: 0.2, treidTaxed: 0.2, dexTaxed: 0.1 };
  function feeOf(t) { return Math.max(t.buy || 0, t.sell || 0) > 0 ? FEE.taxed : FEE.plain; }
  function creatorCut(t) { var sp = splitOf(t), m = Math.max(t.buy || 0, t.sell || 0); return m > 0 ? +((sp ? m * sp.d / 100 : 0) + FEE.creatorTaxed).toFixed(2) : FEE.creatorPlain; }
  // ===== CREATOR REWARDS: freeze rules + community takeover (CTO) =====
  var DR = { inactive: 48 * 36e5, out: 7 * 864e5, soldOut: 70, fundDays: 14, vestDays: 30, ctoNeed: 10, ctoHold: 1 };
  S.devSeen = {}; S.cto = {}; S.claimed = {}; S.myBurns = []; try { S.myBurns = JSON.parse(localStorage.getItem('dl.myburns') || '[]'); } catch (e) {}
  try { S.devSeen = JSON.parse(localStorage.getItem('dl.devseen') || '{}'); S.cto = JSON.parse(localStorage.getItem('dl.cto') || '{}'); S.claimed = JSON.parse(localStorage.getItem('dl.claimed') || '{}'); } catch (e) {}
  function drSave() { try { localStorage.setItem('dl.devseen', JSON.stringify(S.devSeen)); localStorage.setItem('dl.cto', JSON.stringify(S.cto)); localStorage.setItem('dl.claimed', JSON.stringify(S.claimed)); } catch (e) {} }
  function devPing(t) { if (t && S.account && t.creator === S.account) { S.devSeen[t.tick] = Date.now(); drSave(); } }
  function devStatus(t) {
    var now = Date.now(), age = Math.max(0, now - t.born), mine = !!(t.creator && t.creator === S.account), r = rng(hash(t.tick + 'dv')), last, sold = 0;
    if (t.creator && t.devPct != null) { // user-launched: real data
      last = Math.max(t.born, S.devSeen[t.tick] || 0, (S.trades.filter(function (x) { return x.tick === t.tick && x.wallet === t.creator; }).pop() || {}).t || 0);
      var peak = 0, bal = 0; S.trades.filter(function (x) { return x.tick === t.tick && x.wallet === t.creator && x.tokens; }).sort(function (a, b) { return a.t - b.t; }).forEach(function (x) { bal += x.side === 'buy' ? x.tokens : -x.tokens; peak = Math.max(peak, bal); });
            sold = peak > 0 ? Math.max(0, Math.min(100, (peak - Math.max(0, bal)) / peak * 100)) : 0;
    } else {
      var rm = riskMetrics(t); sold = rm[0].val === 'SOLD' ? 100 : Math.round(r() * r() * 82);
      var roll = r(), ago = roll < .7 ? r() * 40 * 36e5 : roll < .85 ? (50 + r() * 110) * 36e5 : (8 + r() * 14) * 864e5;
      last = Math.max(t.born, now - Math.min(age, ago));
    }
    var idle = now - last, why = null, state = 'active', outAt = null;
    if (sold >= DR.soldOut) { state = 'out'; why = 'sold'; outAt = last; }
    else if (idle >= DR.out) { state = 'out'; why = 'idle'; outAt = last + DR.out; }
    else if (idle >= DR.inactive) { state = 'inactive'; why = 'idle'; }
    var cto = S.cto[t.tick] || null;
    if (state === 'out' && !cto && !t.creator && r() < .55) { var w0 = WALLETS[Math.floor(r() * WALLETS.length)]; cto = { lead: w0.a, plan: 'New TG + daily spaces, rebuilding the meme', support: 10 + r() * 25, at: outAt + (1 + r() * 4) * 864e5, approved: true, demo: true }; if (cto.at > now) cto = null; }
    if (cto && cto.approved) state = 'cto';
    // money (USD)
    var cut = creatorCut(t), earned = t.vol * 1000 * cut / 100, span = Math.max(1, age);
    var frozenFrom = state === 'inactive' ? last + DR.inactive : outAt, fShare = frozenFrom ? Math.max(0, Math.min(1, (now - frozenFrom) / span)) : 0;
    var pot = earned * fShare, burned = 0, fund = 0, claimable = 0, fundEnds = outAt ? outAt + DR.fundDays * 864e5 : null;
    if (state === 'active') claimable = Math.max(0, earned * (mine ? 1 : .08 + r() * .1) - (S.claimed[t.tick] || 0));
    else if (state === 'inactive') burned = pot;
    else { burned = pot / 2; fund = pot / 2; if (state !== 'cto' && fundEnds && now > fundEnds) { burned += fund; fund = 0; } }
    var vest = state === 'cto' && cto ? Math.max(0, Math.min(1, (now - cto.at) / (DR.vestDays * 864e5))) : 0;
    return { state: state, why: why, sold: sold, last: last, idle: idle, outAt: outAt, cut: cut, earned: earned, claimable: claimable, burned: burned, fund: fund, fundEnds: fundEnds, cto: cto, vest: vest, mine: mine };
  }
  // copycat ("vamp") flag: same folded ticker / name as an OLDER coin — flagged with a 🧛 badge, never blocked
  var VLEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '$': 's', '@': 'a', '!': 'i' };
  function vfold(x) { return String(x || '').replace(/^\s*\$+/, '').trim().toLowerCase().replace(/\s+/g, ' '); }   // 1:1 only (case and spaces ignored)
  function vampMatch(tick, name, born, self) { var keys = [vfold(tick), vfold(name)].filter(function (k) { return k.length >= 2; }); if (!keys.length) return null; var best = null;
    all().concat(S.live || []).forEach(function (o) { if (o === self || o.archived || (born && o.born >= born)) return; var ok = [vfold(o.tick), vfold(o.name)]; if (keys.some(function (k) { return ok.indexOf(k) >= 0; }) && (!best || o.born < best.born)) best = o; }); return best; }
  function vampOf(t) { if (t.live) { if (!t.vamp || !t.vamp.mint) return null; var o = S.live.filter(function (x) { return x.ca === t.vamp.mint; })[0]; return o || { tick: String(t.vamp.symbol || '?'), name: String(t.vamp.name || ''), ca: t.vamp.mint }; } if (t._vamp === undefined) t._vamp = vampMatch(t.tick, t.name, t.born, t); return t._vamp; }
  function vampBadge(t) { var o = vampOf(t); return o ? '<span class="vampb" title="Same name as $' + esc(o.tick) + ', an older coin — check the contract address before buying">🧛</span>' : ''; }
  function vampNote(c) { var o = vampMatch(c.tick, c.name, 0, null); return o ? '🧛 <b>$' + esc(o.tick) + '</b> (' + esc(o.name) + ') already exists on treid. You can still launch, but your coin will show a <b>“Possible copy”</b> badge.' : ''; }
  function crBadge(t) { return crBadge0(t) + vampBadge(t); }
  function crBadge0(t) { var d = devStatus(t); return d.state === 'out' ? '<span class="crb out" title="Dev is out — open for community takeover">DEV OUT</span>' : d.state === 'cto' ? '<span class="crb cto" title="Community takeover">CTO</span>' : d.state === 'inactive' ? '<span class="crb idle" title="Dev inactive for 48h+ — rewards frozen">DEV AWAY</span>' : ''; }
  function crPanel(t) {
    if (t.live && t.esc && t.esc.escrow) { var E = t.esc, R0 = E.rules || {}, who = function (w) { return S.account && w === S.account ? 'You' : walletName ? walletName(w) : short(w); };
      var mineE = !!(S.account && E.creator && S.account === E.creator), solf = function (v) { return (v > 0 && v < 0.0001 ? '<0.0001' : (+v || 0).toFixed(4)) + ' ' + esc(E.quote || 'SOL'); }, durE = function (ms) { return durH(Math.max(1, ms / 60000)); };
      var isCto = E.era === 'cto', roleW = isCto ? 'lead' : 'creator', RoleW = isCto ? 'Lead' : 'Creator';
      var stE = E.era === 'out' ? ['r', 'Creator is out', E.why === 'sold' ? 'Creator sold their bag' : 'The creator left — holders can elect a new lead']
        : E.state === 'frozen' ? ['y', 'Paused', 'No ' + roleW + ' activity for ' + durE(E.idleMs) + ' — rewards now buy back & burn $' + esc(t.tick)]
        : isCto ? ['b', 'Community takeover', 'Led by ' + esc(who(E.creator)) + ' since ' + ago(E.cto.at) + ' ago · same rules apply'] : ['g', 'Active', 'Paid to the creator automatically, straight from the pool'];
      var tiles = E.era === 'out' ? [['Bought back & burned', solf(E.buybackSol)], ['To treid platform', solf(E.platformSol || 0)], ['Takeover', (E.apps || []).length ? (E.apps.length + ' applying') : 'open']]
        : isCto ? [['Paid to lead', solf(E.paidSol)], ['Waiting in pool', solf(E.pendingSol)], ['Bought back & burned', solf(E.buybackSol)]]
        : [['Paid to creator', solf(E.paidSol)], ['Waiting in pool', solf(E.pendingSol)], ['Bought back & burned', solf(E.buybackSol)]];
      var meterE = E.era !== 'out' ? '<div class="cr-meter"><div class="cr-ml"><small>Activity timer</small><small class="mono">' + (E.state === 'active' ? 'pauses in ' + durE(48 * 36e5 - E.idleMs) : roleW + ' out in ' + durE(7 * 864e5 - E.idleMs)) + '</small></div><span class="cr-bar"><i style="width:' + Math.min(100, E.idleMs / (7 * 864e5) * 100).toFixed(1) + '%"></i><em style="left:' + (48 / 168 * 100).toFixed(1) + '%" title="48h: paused"></em></span><div class="cr-ml"><small class="muted">last seen ' + ago(E.lastActive) + ' ago</small><small class="muted">48h pause · 7d out</small></div></div>' +
        '<div class="cr-meter"><div class="cr-ml"><small>' + RoleW + ' sold of peak bag</small><small class="mono ' + (E.soldPct >= 70 ? 'down' : E.soldPct >= 40 ? 'warn' : '') + '">' + Math.round(E.soldPct) + '%</small></div><span class="cr-bar sold"><i style="width:' + Math.min(100, E.soldPct) + '%"></i><em style="left:70%" title="70%: out"></em></span></div>' : '';
      // takeover voting (creator out)
      var ctoBox = '';
      if (E.era === 'out') { var apps = E.apps || [], myBal = S.account && t.lh ? ((t.lh.filter(function (h) { return h.wallet === S.account; })[0] || {}).pct || 0) : 0, canApply = S.account && S.account !== E.dev && myBal >= (R0.applyPct || 1) && !apps.some(function (a) { return a.wallet === S.account; });
        ctoBox = '<div class="cto-box"><div class="cto-h"><b>Community takeover</b><small class="muted">A holder with ' + (R0.applyPct || 1) + '%+ can apply to lead. When supporters hold ' + (R0.supportPct || 10) + '% of supply, the new lead takes over and earns the future rewards — under the same rules.</small></div>' +
          (apps.length ? apps.map(function (a) { var mine = S.account === a.wallet; return '<div class="cto-app"><div class="cto-ah"><span class="av" style="width:22px;height:22px">' + A.svg(walletSpec(a.wallet)) + '</span><b class="mono">' + esc(who(a.wallet)) + '</b><small class="muted">holds ' + a.ownPct.toFixed(2) + '% · ' + a.supporters + ' supporter' + (a.supporters === 1 ? '' : 's') + '</small></div><p>“' + esc(a.plan) + '”</p>' +
            '<div class="cr-ml"><small>Support</small><small class="mono">' + a.supportPct.toFixed(2) + '% / ' + (R0.supportPct || 10) + '%</small></div><span class="cr-bar sup"><i style="width:' + Math.min(100, a.supportPct / (R0.supportPct || 10) * 100).toFixed(1) + '%"></i></span>' +
            (S.account && !mine && S.account !== E.dev ? '<button class="btn sec cto-vote" data-act="ctoVote" data-arg="' + esc(t.tick) + '|' + esc(a.wallet) + '">Support this lead</button>' : '') + '</div>'; }).join('') : '<p class="muted cto-none">No applications yet.</p>') +
          (S.ctoForm === t.tick ? '<div class="cto-form"><textarea id="cto-plan" maxlength="240" placeholder="Your plan for $' + esc(t.tick) + ' — socials, marketing, community… (shown to holders)"></textarea><div class="cr-acts"><button class="btn sec" data-act="ctoFormX">Cancel</button><button class="btn pri" data-act="ctoApply" data-arg="' + esc(t.tick) + '">Sign & apply</button></div></div>'
            : canApply ? '<button class="btn pri cto-apply" data-act="ctoForm" data-arg="' + esc(t.tick) + '">Apply to lead $' + esc(t.tick) + '</button>' : S.account && S.account !== E.dev && !apps.some(function (a) { return a.wallet === S.account; }) ? '<small class="muted cto-need">Hold ' + (R0.applyPct || 1) + '% of supply to apply (you hold ' + myBal.toFixed(2) + '%).</small>' : '') + '</div>'; }
      var KN = { pay: 'Paid to creator', buyback: 'Buyback', burntok: 'Burned', fund: 'To takeover fund', grant: 'To treid platform', platform: 'To treid platform', ping: RoleW + ' checked in', out: 'Out', claim: 'Collected fees', cto: 'Takeover approved', ctopay: 'Fund → lead' };
      var logE = (E.log || []).filter(function (x) { return KN[x.kind] && x.kind !== 'claim'; }).slice(0, 5).map(function (x) { return '<a class="cr-log" target="_blank" rel="noopener" href="https://solscan.io/tx/' + esc(x.sig) + (CHAIN_ID === 'solana:devnet' ? '?cluster=devnet' : '') + '"><span>' + (x.kind === 'pay' && isCto && x.extra === E.creator ? 'Paid to lead' : KN[x.kind]) + '</span><b class="mono">' + (x.kind === 'burntok' ? fmtNum(x.lamports / 1e6) + ' $' + esc(t.tick) : x.lamports ? (x.lamports / Math.pow(10, t.qDec != null ? t.qDec : 9)).toFixed(4) + ' ' + esc(E.quote || 'SOL') : '') + '</b><small class="muted">' + ago(x.ts) + '</small></a>'; }).join('');
      return '<section class="card-s panel cr-panel s-' + stE[0] + '"><div class="cr-h"><b>Creator rewards</b><span class="cr-st ' + stE[0] + '"><i></i>' + stE[1] + '</span></div><small class="muted cr-sub">' + stE[2] + '</small>' +
        '<div class="cr-money">' + tiles.map(function (m) { return '<div><small>' + m[0] + '</small><b class="mono">' + m[1] + '</b></div>'; }).join('') + '</div>' + meterE +
        (mineE && E.era !== 'out' ? '<div class="cr-acts"><button class="btn sec" data-act="devHere" data-arg="' + esc(t.tick) + '">✋ I’m still here</button>' + (E.state === 'active' ? '<button class="btn pri" data-act="devClaimNow" data-arg="' + esc(t.tick) + '"' + (E.pendingSol < 0.0001 || S.busy ? ' disabled' : '') + '>Claim now · ' + solf(E.pendingSol) + '</button>' : '') + '</div>' : '') +
        ctoBox + (logE ? '<div class="cr-logs">' + logE + '</div>' : '') +
        '<details class="cr-rules"><summary>How the rules work</summary><ul><li>Rewards stay in the Meteora pool until they’re paid. treid’s automated wallet holds the pool’s creator role and pays them out under these rules — never anywhere else. An active creator is <b>paid straight from the pool</b> automatically once rewards reach $1, or any time with “Claim now” (from $1).</li><li><b>48h</b> with no creator activity → payouts pause; rewards meanwhile <b>buy back & burn</b> the coin. “I’m still here” (a free wallet signature) resumes payouts.</li><li><b>7 days</b> inactive, or the creator sells <b>or moves to another wallet 70%+</b> of their peak bag (selling and sending are added together; the rule covers the creator’s launch wallet) → creator is out: from then on <b>50%</b> of their rewards buys back & burns the coin and <b>50%</b> goes to the treid platform, until the community takes over.</li><li><b>Community takeover:</b> a holder with ' + (R0.applyPct || 1) + '%+ applies with a plan; holders support with a free signature. At ' + (R0.supportPct || 10) + '% of supply, held for 24 hours in a row, the new lead takes over and earns all future rewards — under the same rules.</li><li>Every step is an on-chain transaction — tap any line above to verify.</li></ul></details></section>';
    }
    if (t.live) {   // real coin: rewards are SOL sitting in the pool, the creator claims them straight to their wallet
      var f = t.crFees, mine = !!(S.account && f && S.account === f.creator), u = f ? f.unclaimed : null, uTxt = u == null ? '…' : (u < 0.0001 && u > 0 ? '<0.0001' : u.toFixed(4)) + ' ' + esc(qSymT(t));
      return '<section class="card-s panel cr-panel s-g"><div class="cr-h"><b>Creator rewards</b><span class="cr-st g"><i></i>On-chain</span></div><small class="muted cr-sub">' + creatorCut(t) + '% of every trade goes to the creator</small>' +
        '<div class="cr-money"><div><small>Unclaimed</small><b class="mono">' + uTxt + '</b></div><div><small>≈ USD</small><b class="mono">$' + (u ? (u * qUsdT(t)).toFixed(2) : '0') + '</b></div><div><small>Per trade</small><b class="mono">' + creatorCut(t) + '%</b></div></div>' +
        (mine ? '<div class="cr-acts"><button class="btn pri" style="flex:1" data-act="liveClaim" data-arg="' + esc(t.tick) + '"' + (!u || u < 0.000001 || S.busy ? ' disabled' : '') + '>' + (S.busy && /Claim/.test(S.busy) ? esc(S.busy) + '…' : 'Claim ' + uTxt) + '</button></div>' : '') +
        '<small class="muted" style="display:block;margin-top:10px;font-size:11.5px">' + (mine ? 'You’re the creator — claim any time, it goes straight to your wallet.' : 'Only the creator’s wallet can claim these.') + '</small></section>';
    }
    var d = devStatus(t), id = esc(t.tick), now = Date.now(), dur = function (ms) { return durH(Math.max(1, ms / 60000)); };
    var st = { active: ['g', 'Active', 'Creator is around and earning'], inactive: ['y', 'Inactive', 'No dev activity for ' + dur(d.idle) + ' — rewards frozen'], out: ['r', 'Dev is out', d.why === 'sold' ? 'Dev sold ' + Math.round(d.sold) + '% of their bag' : 'Inactive for ' + dur(d.idle)], cto: ['b', 'Community takeover', d.cto ? 'Run by the community for ' + dur(now - d.cto.at) : ''] }[d.state];
    var idleBar = d.state === 'active' || d.state === 'inactive' ? '<div class="cr-meter"><div class="cr-ml"><small>Activity timer</small><small class="mono">' + (d.state === 'active' ? 'freezes in ' + dur(DR.inactive - d.idle) : 'dev out in ' + dur(DR.out - d.idle)) + '</small></div><span class="cr-bar"><i style="width:' + Math.min(100, d.idle / DR.out * 100).toFixed(1) + '%"></i><em style="left:' + (DR.inactive / DR.out * 100).toFixed(1) + '%" title="48h: freeze"></em></span><div class="cr-ticks"><small style="left:0">last seen</small><small style="left:' + (DR.inactive / DR.out * 100).toFixed(1) + '%;transform:translateX(-50%)">48h freeze</small><small style="right:0">7d out</small></div></div>' : '';
    var soldBar = '<div class="cr-meter"><div class="cr-ml"><small>Dev sold of peak bag</small><small class="mono ' + (d.sold >= DR.soldOut ? 'down' : d.sold >= 40 ? 'warn' : '') + '">' + Math.round(d.sold) + '%</small></div><span class="cr-bar sold"><i style="width:' + Math.min(100, d.sold) + '%"></i><em style="left:' + DR.soldOut + '%" title="70%: dev out"></em></span></div>';
    var money = d.state === 'active' ? [['Earned', '$' + fmtNum(Math.round(d.earned))], ['Unclaimed', '$' + fmtNum(Math.round(d.claimable))], ['Per trade', d.cut.toFixed(2).replace(/\.?0+$/, '') + '%']]
      : d.state === 'inactive' ? [['Earned', '$' + fmtNum(Math.round(d.earned))], ['Burned (missed)', '$' + fmtNum(Math.round(d.burned))], ['Per trade', d.cut.toFixed(2).replace(/\.?0+$/, '') + '%']]
      : [['Burned', '$' + fmtNum(Math.round(d.burned))], ['Recovery fund', '$' + fmtNum(Math.round(d.fund))], [d.state === 'cto' ? 'Paid to CTO' : 'Fund window', d.state === 'cto' ? Math.round(d.vest * 100) + '%' : (d.fundEnds > now ? dur(d.fundEnds - now) + ' left' : 'closed')]];
    var acts = '';
    if (d.mine && (d.state === 'active' || d.state === 'inactive')) acts = '<div class="cr-acts"><button class="btn sec" data-act="devPing" data-arg="' + id + '">✋ I’m still here</button><button class="btn pri" data-act="devClaim" data-arg="' + id + '"' + (d.state !== 'active' || d.claimable < .01 ? ' disabled' : '') + '>Claim $' + fmtNum(Math.round(d.claimable)) + '</button></div>';
    else if (d.state === 'out') { var c = S.cto[t.tick]; acts = c ? '<div class="cr-cto"><div class="cr-ml"><small>Takeover by ' + esc(walletName(c.lead)) + '</small><small class="mono">' + c.support.toFixed(1) + '% / ' + DR.ctoNeed + '% support</small></div><span class="cr-bar sup"><i style="width:' + Math.min(100, c.support / DR.ctoNeed * 100) + '%"></i></span><p class="muted">“' + esc(c.plan) + '”</p><button class="btn pri" data-act="ctoBack" data-arg="' + id + '"' + (c.backed ? ' disabled' : '') + '>' + (c.backed ? '✓ You backed this' : 'Back this takeover') + '</button></div>' : '<div class="cr-acts"><button class="btn pri" data-act="ctoOpen" data-arg="' + id + '">Apply for community takeover</button></div>'; }
    else if (d.state === 'cto') acts = '<div class="cr-cto"><div class="cr-ml"><small>Lead: ' + esc(walletName(d.cto.lead)) + '</small><small class="mono">recovery fund paid ' + Math.round(d.vest * 100) + '% of ' + DR.vestDays + 'd</small></div><span class="cr-bar sup"><i style="width:' + (d.vest * 100).toFixed(1) + '%"></i></span><p class="muted">“' + esc(d.cto.plan) + '”</p></div>';
    return '<section class="card-s panel cr-panel s-' + st[0] + '"><div class="cr-h"><b>Creator rewards</b><span class="cr-st ' + st[0] + '"><i></i>' + st[1] + '</span></div><small class="muted cr-sub">' + st[2] + '</small>' +
      '<div class="cr-money">' + money.map(function (m) { return '<div><small>' + m[0] + '</small><b class="mono">' + m[1] + '</b></div>'; }).join('') + '</div>' + idleBar + soldBar + acts +
      '<details class="cr-rules"><summary>How the rules work</summary><ul><li><b>48h</b> with no dev activity → rewards freeze, missed rewards are burned. Dev can come back with “I’m still here”.</li><li><b>7 days</b> inactive, or dev sells <b>70%+</b> of their peak bag → dev is out for good.</li><li>When the dev is out: <b>50%</b> of frozen rewards is burned, <b>50%</b> becomes a recovery fund for ' + DR.fundDays + ' days.</li><li>A community takeover needs <b>' + DR.ctoNeed + '%</b> of supply backing it and a lead holding <b>' + DR.ctoHold + '%+</b>. Approved CTOs get future rewards and the fund over ' + DR.vestDays + ' days. No CTO in time → the fund is burned too.</li><li>Burning tokens never counts as selling.</li></ul></details></section>';
  }
  function ctoModal() {
    if (!S.ctoOpen) return ''; var t = find(S.ctoOpen); if (!t) return ''; var pos = position(t), hold = pos ? pos.tok / 1e9 * 100 : 0, exdev = S.account && t.creator === S.account, ok = hold >= DR.ctoHold && !exdev;
    var head = '<div class="hm-h"><div><b>Community takeover · $' + esc(t.tick) + '</b><small>Lead the coin after the dev left · get future creator rewards + the recovery fund</small></div><button class="iconbtn" data-act="ctoClose" aria-label="Close">✕</button></div>';
    var body = !S.account ? '<div class="bt-empty"><p>Connect a wallet to apply.</p><button class="btn pri" data-act="openWallet">Connect wallet</button></div>' :
      (exdev ? '<div class="cto-req no">✕ The original dev can’t lead a takeover of their own coin.</div>' : '<div class="cto-req ' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓' : '✕') + ' You hold <b class="mono">' + hold.toFixed(2) + '%</b> of supply · need ' + DR.ctoHold + '%+</div>') +
      '<label class="cto-f"><small>New X link</small><input class="inp" id="cto-x" placeholder="x.com/yourcoin"></label><label class="cto-f"><small>New Telegram</small><input class="inp" id="cto-tg" placeholder="t.me/yourcoin"></label><label class="cto-f"><small>Your plan (one line)</small><input class="inp" id="cto-plan" maxlength="90" placeholder="e.g. new art, daily spaces, buybacks"></label>' +
      '<small class="muted">Holders back your takeover with a free wallet signature. It’s approved once backers hold ' + DR.ctoNeed + '% of circulating supply. If you sell your bag, you’re out too.</small>' +
      '<button class="btn pri bt-go" data-act="ctoApply"' + (ok ? '' : ' disabled') + '>' + (ok ? 'Submit takeover' : exdev ? 'Not available to the original dev' : 'Buy at least ' + DR.ctoHold + '% to apply') + '</button>';
    return '<div class="hm-ov" data-act="ctoClose"><div class="hm card-s bt" data-stop>' + head + body + '</div></div>';
  }
  function effTax(t, at) { return Math.max(Math.max(t.buy, t.sell), snipeNow(t, at)); }
  function devQuote(amt) {   // amt is in the pair token (SOL, USDC, …)
    var q = qOf(S.c); amt = Math.max(0, +amt || 0); var usd = amt * qUsd(q), solEq = usd / SOL_USD, px0 = 5 * 1000 / 1e9, impact = Math.min(25, solEq * 3 / Math.sqrt(5));
    var tok = usd / (px0 * (1 + impact / 200)); tok = Math.min(tok, 8e8);
    return { sol: amt, tok: tok, pct: tok / 1e9 * 100, sym: q.sym, key: q.key, isSol: !!q.sol, mint: q.mint };
  }
  function niceQ(x) { if (!(x > 0)) return '0'; var p = Math.pow(10, Math.floor(Math.log10(x))); return String(+(Math.round(x / p) * p).toPrecision(2)); }
  function qPresets(q, list) { return q.sol ? list : list.map(function (v) { return v === '0' ? v : niceQ(+v * SOL_USD / q.usd); }); }
  // ===== CONTRACT ADDRESS ENDING: free ...treid or paid custom =====
  var B58C = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function vanFee(n) { return n <= 0 ? 0 : n <= 3 ? 0.1 : 0.25; }
  function vanEta(n) { return n <= 3 ? 'a few seconds' : '~1–3 min on this device'; }
  function vanPrev(c) { var v = c.van || {}, suf = v.mode === 'custom' && v.suf ? v.suf : 'trd', pre = (c.vanPre || (c.vanPre = b58(44))).slice(0, 44 - suf.length); return '<span class="mono">' + pre.slice(0, 6) + '<i>' + pre.slice(6, 14) + '…</i></span><b class="mono">' + esc(suf) + '</b>'; }
  function vanityPicker(c) {
    var v = c.van || (c.van = { mode: 'treid', suf: '' }), n = (v.suf || '').length, cus = v.mode === 'custom';
    return '<div class="van"><div class="van-h"><b>Contract address</b><small>how your coin’s address ends</small></div>' +
      '<div class="van-opts"><button class="van-o' + (cus ? '' : ' on') + '" data-act="vanMode" data-arg="treid"><span class="van-t">…<b>trd</b></span><span><b>trd ending</b><small>Instantly recognised as launched on treid</small></span><em class="van-free">FREE</em></button>' +
      '<button class="van-o' + (cus ? ' on' : '') + '" data-act="vanMode" data-arg="custom"><span class="van-t">…<b>' + (cus && v.suf ? esc(v.suf) : 'MOON') + '</b></span><span><b>Custom ending</b><small>Your own letters, 3–4 characters</small></span><em class="van-paid">from 0.1 SOL</em></button></div>' +
      (cus ? '<div class="van-cfg"><label class="van-in"><span>…</span><input id="van-suf" data-van maxlength="4" value="' + esc(v.suf || '') + '" placeholder="MOON" autocomplete="off" spellcheck="false"></label>' +
        '<div class="van-tiers">' + [[3, '3 chars', 0.1, 'seconds'], [4, '4 chars', 0.25, '~1–3 min']].map(function (x) { var on = n && n === x[0]; return '<span class="' + (on ? 'on' : '') + '"><b>' + x[1] + '</b><small class="mono">' + x[2] + ' SOL · ' + x[3] + '</small></span>'; }).join('') + '</div>' +
        '<small class="van-err" id="van-err"></small></div>' : '') +
      '<div class="van-prev"><small>Preview</small><div id="van-prev">' + vanPrev(c) + '</div>' + (cus && n >= 3 ? '<span class="van-fee mono" id="van-fee">+' + vanFee(n) + ' SOL · ' + vanEta(n) + '</span>' : cus ? '<span class="van-fee mono" id="van-fee">type at least 3 characters</span>' : '<span class="van-fee ok mono">free · instant</span>') + '</div></div>';
  }
  function devBuyPicker(c) {
    var q = devQuote(String(c.devBuy || '').replace(',', '.')), lv = q.pct === 0 ? 'z' : q.pct < 3 ? 'g' : q.pct < 8 ? 'y' : 'r';
    var note = { z: 'No initial buy — you start with 0%. Fair launch.', g: 'Looks fair to buyers.', y: 'Buyers will notice your holding.', r: 'Big dev bag — buyers will see this as a risk.' }[lv];
    return '<div class="field devb"><div class="lbl"><b>Your initial buy <span class="muted" style="font-weight:500;font-size:12px">· optional, no tax for the creator</span></b></div>' +
      '<div class="devb-row"><label class="devb-in" for="c-devbuy"><input id="c-devbuy" inputmode="decimal" data-bind="c.devBuy" value="' + esc(c.devBuy || '') + '" placeholder="0.0" autocomplete="off"><span class="devb-u">' + coinHTML(q.key || 'SOL', 20) + esc(q.sym) + '</span></label>' +
      '<div class="devb-q">' + qPresets(qOf(c), ['0', '0.1', '0.5', '1', '2', '5']).map(function (v) { return '<button class="' + (String(c.devBuy || '0') === v ? 'on' : '') + '" data-act="devbuy" data-arg="' + v + '">' + (v === '0' ? 'None' : v) + '</button>'; }).join('') + '</div></div>' +
      '<div class="devb-res ' + lv + '"><div class="devb-n"><span><small>You get</small><b class="mono">' + fmtNum(Math.round(q.tok)) + '</b><em>$' + esc(c.tick || 'TICKER') + '</em></span><span class="devb-p"><small>Share of supply</small><b class="mono">' + q.pct.toFixed(2) + '%</b></span></div>' +
      '<div class="devb-bar"><i style="width:' + Math.min(100, q.pct / 20 * 100).toFixed(2) + '%"></i><u style="left:15%"><em>3%</em></u><u style="left:40%"><em>8%</em></u><u style="left:100%"><em>20%+</em></u></div><div class="devb-note">' + note + '</div></div></div>';
  }
  // ---- preview demo coins with your own images (stored only in this browser) ----
  var DIMG = {}; try { DIMG = JSON.parse(localStorage.getItem('dl.demoimgs') || '{}'); } catch (e) {}
  BASE.forEach(function (t) { if (DIMG[t.tick]) t.img = DIMG[t.tick]; });
  // ===== TERMS & RISKS (plain-language draft — must be reviewed by a lawyer before mainnet) =====
  function termsModal() {
    if (!S.termsOpen) return '';
    var sec = function (h, b) { return '<section><h3>' + h + '</h3>' + b + '</section>'; };
    return '<div class="overlay" data-act="termsClose"><div class="terms card-s" data-stop><div class="terms-h"><b>Terms &amp; risks</b><button class="iconbtn" data-act="termsClose" aria-label="Close">✕</button></div>' +
      '<div class="terms-draft">Draft · last updated ' + new Date(1793030000000).toISOString().slice(0, 10) + ' · plain-language summary, not yet reviewed by a lawyer</div><div class="terms-b">' +
      sec('What treid is', '<p>treid is a website that helps you create and trade tokens on the Solana blockchain. Coins and trades run on Meteora’s public bonding-curve program. treid builds the transactions; <b>your wallet signs every one of them</b>. We never hold your wallet keys.</p>') +
      sec('The big risk', '<p>Memecoins are extremely risky. Prices can go to zero in minutes. Anyone can launch a coin, including people who intend to sell on buyers. <b>Only use money you can afford to lose completely.</b> Nothing on treid is investment, financial, legal or tax advice.</p>') +
      sec('What our checks can and can’t do', '<p>Risk labels (dev bag, top holders, snipers, bundles, tax, authorities) show what is visible on-chain at that moment. They can be wrong or incomplete and are not a guarantee. The creator-rewards rules (pause after 48h, out after 7 days or 70% sold/moved) cover the creator’s launch wallet only — a creator can hold or trade from other wallets.</p>') +
      sec('Fees', '<p>Every trade pays a trading fee (1%, or 0.5% on coins with a tax), split between the coin’s creator, treid and Meteora. Coins with a tax also charge that tax on transfers; how it is used (holders, burn, creator) is fixed at launch and shown on the coin. Network fees are paid to Solana. Fees are not refundable.</p>') +
      sec('Creator rewards and takeovers', '<p>Creator rewards stay in the Meteora pool until paid out. treid runs an automated wallet that pays them under the published rules, buys back &amp; burns, and runs community takeovers. Rules can change for new coins; existing coins keep the rules they launched with.</p>') +
      sec('Your responsibilities', '<p>You must be of legal age and allowed to use crypto services where you live. Don’t use treid for anything illegal, to manipulate markets, impersonate others, or launch coins that infringe someone’s rights. You are responsible for your own taxes. We may hide coins, callouts or content from the treid website that break these rules — we cannot change anything on the blockchain itself.</p>') +
      sec('No guarantees', '<p>treid is provided “as is”. Software, blockchains, wallets and third parties (Meteora, Jupiter, RPC providers, IPFS) can fail or be attacked. To the extent the law allows, treid is not liable for losses from trading, bugs, outages or third-party services.</p>') +
      sec('Callouts and content', '<p>Callouts are posted by users and signed by their wallets. They are opinions, not advice, and may be wrong or promotional. Coin names, images and descriptions are provided by creators.</p>') +
      '</div></div></div>';
  }
  function demoImgModal() {
    if (!S.demoImgOpen) return '';
    var n = Object.keys(DIMG).length;
    return '<div class="overlay" data-act="demoImgsClose"><div class="dimg card-s"><div class="dimg-h"><b>Preview with real images</b><button class="iconbtn" data-act="demoImgsClose">✕</button></div>' +
      '<p class="muted">Drop up to ' + BASE.length + ' images (memes, coin logos, anything). They replace the demo coin pictures <b>only in your browser</b> so you can see how real art looks on treid. Nothing is uploaded or shown to anyone else.</p>' +
      '<label class="drop dimg-drop" for="dimg-in" data-drop="demo"><span class="drop-ic">' + I.up + '</span><span class="drop-t">Drop images here or click to choose</span><small>Select many at once · PNG, JPG, GIF, WEBP</small></label><input id="dimg-in" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" class="sr">' +
      '<div class="dimg-real"><div><b>Popular Solana memes</b><small>BONK, WIF, POPCAT, MEW, PNUT, GOAT, Moo Deng, chill guy, GIGACHAD, DOGE + more — real logos on the demo coins (numbers stay fake).</small></div><button class="btn ' + (REAL_ON ? 'sec' : 'pri') + '" data-act="realMemes">' + (REAL_ON ? 'Turn off' : 'Use real meme logos') + '</button></div>' +
      '<div class="dimg-grid">' + BASE.map(function (t) { return '<span class="dimg-c' + (DIMG[t.tick] ? ' on' : '') + '" title="$' + esc(t.tick) + '">' + avatarHTML(t, 40) + '</span>'; }).join('') + '</div>' +
      '<div class="dimg-f"><span class="muted mono">' + n + ' / ' + BASE.length + ' replaced</span>' + (n ? '<button class="btn sec" data-act="demoImgsReset">Reset to originals</button>' : '') + '<button class="btn pri" data-act="demoImgsClose">Done</button></div></div></div>';
  }
  function demoImgsAdd(files) {
    files = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); }); if (!files.length) return;
    var free = BASE.filter(function (t) { return !DIMG[t.tick]; }).concat(BASE.filter(function (t) { return DIMG[t.tick]; })), done = 0;
    files.slice(0, BASE.length).forEach(function (f, k) {
      var r = new FileReader(); r.onload = function () { var im = new Image(); im.onload = function () {
        var cv = document.createElement('canvas'), x = cv.getContext('2d'), W = 256; cv.width = cv.height = W; var sc = Math.max(W / im.width, W / im.height), dw = im.width * sc, dh = im.height * sc; x.drawImage(im, (W - dw) / 2, (W - dh) / 2, dw, dh);
        var t = free[k]; DIMG[t.tick] = cv.toDataURL('image/webp', .85); t.img = DIMG[t.tick];
        if (++done === Math.min(files.length, BASE.length)) { try { localStorage.setItem('dl.demoimgs', JSON.stringify(DIMG)); } catch (er) { toast('Browser storage is full — some images won\'t be kept after reload'); } render(); toast(done + ' image' + (done > 1 ? 's' : '') + ' applied to demo coins'); }
      }; im.src = r.result; }; r.readAsDataURL(f);
    });
  }
  // ===== TAX SPLIT: holders / burn / dev, locked at launch =====
  var SVI = function (d) { return '<svg class="svi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  var ICO = {
    holders: SVI('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.8 14.6c2.4.2 4 1.6 4.6 4.4"/>'),
    burn: SVI('<path d="M12 3c.6 3.2 4.8 5 4.8 10a4.8 4.8 0 0 1-9.6 0c0-2.2 1-3.6 2.2-4.8.2 1.6.9 2.6 2 3 0-3 .2-5.6.6-8.2z"/>'),
    dev: SVI('<path d="M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4M13.5 5l-3 14"/>'),
    community: SVI('<circle cx="12" cy="7.5" r="2.6"/><circle cx="5.5" cy="10" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M7.5 19c.5-2.8 2.2-4.2 4.5-4.2s4 1.4 4.5 4.2M2.5 18c.3-1.8 1.3-2.8 3-3M21.5 18c-.3-1.8-1.3-2.8-3-3"/>'),
    deflation: SVI('<path d="M12 3c.6 3.2 4.8 5 4.8 10a4.8 4.8 0 0 1-9.6 0c0-2.2 1-3.6 2.2-4.8.2 1.6.9 2.6 2 3 0-3 .2-5.6.6-8.2z"/>'),
    balanced: SVI('<path d="M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/>'),
    custom: SVI('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
    lock: SVI('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')
  };
  var SPRE = { community: ['community', 'Community', 70, 20, 10], deflation: ['deflation', 'Deflation', 20, 70, 10], balanced: ['balanced', 'Balanced', 40, 30, 30] };
  var SPC = { h: ['#5CC8FF', 'holders', 'Holders', 'linear-gradient(90deg,#3B82F6,#5CC8FF)'], b: ['#FF8A4C', 'burn', 'Burn', 'linear-gradient(90deg,#FF4D2E,#FFB547)'], d: ['#E6CB95', 'dev', 'Dev', 'linear-gradient(90deg,#B08D57,#F1DDB0)'] };
  function splitOf(t) {
    if (!t || Math.max(t.buy || 0, t.sell || 0) <= 0) return null;
    if (t.split) return t.split;
    if (t.live) return null;   // real coin: split not published on-chain yet — don't invent one
    var r = rng(hash(t.tick + 'split')), k = t.burn && !t.rewards ? 'deflation' : t.rewards ? 'community' : ['community', 'deflation', 'balanced', 'community'][Math.floor(r() * 4)], p = SPRE[k];
    if (r() < .3) { var h = 20 + Math.round(r() * 12) * 5, d = Math.min(50, 5 + Math.round(r() * 5) * 5); if (h + d > 95) h = 95 - d; t.split = { p: 'custom', h: h, b: 100 - h - d, d: d }; }
    else t.split = { p: k, h: p[2], b: p[3], d: p[4] };
    return t.split;
  }
  function splitBar(sp, cls) { return '<span class="spbar ' + (cls || '') + '">' + ['h', 'b', 'd'].filter(function (k) { return sp[k] > 0; }).map(function (k) { return '<i style="flex:' + sp[k] + ';background:' + SPC[k][3] + '"></i>'; }).join('') + '</span>'; }
  function splitTip(t) { var sp = splitOf(t), m = Math.max(t.buy, t.sell); return sp ? 'Tax ' + m + '% → ' + sp.h + '% holders (paid in ' + rwSym(t) + ') · ' + sp.b + '% burn · ' + sp.d + '% dev (locked)' : 'No tax — plain coin'; }
  function rwSym(t) { if (t.rw === 'pair') return t.live ? qSymT(t) : (t.pair || 'SOL'); if (t.rw && t.rw.mint) { var m = t.rw.mint; if (m === WSOL) return 'SOL'; if (m === USDC_MINT) return 'USDC'; for (var k in PAIR_INFO) if (PAIR_INFO[k].ca === m) return k; return short(m); } return '$' + t.tick; }
  function splitPicker(c) {
    var base = c.buy; if (base <= 0) return '<div class="spk off fee0"><div class="spk-h"><b>Your creator rewards</b><span class="spk-lock">' + ICO.lock + 'automatic</span></div><div class="fee-big"><b class="mono">' + FEE.creatorPlain + '%</b><span>of every trade on your coin goes to you</span></div><small>Plain coins pay a ' + FEE.plain + '% trading fee per trade: ' + FEE.creatorPlain + '% to you, ' + FEE.treidPlain + '% to treid, ' + FEE.dexPlain + '% to Meteora (the on-chain DEX). Add a tax to also earn from your own tax split — the trading fee then drops to ' + FEE.taxed + '% (' + FEE.creatorTaxed + '% still yours).</small></div>';
    var sp = c.split || (c.split = { p: 'community', h: 70, b: 20, d: 10 });
    var chips = Object.keys(SPRE).map(function (k) { var p = SPRE[k]; return '<button class="spc' + (sp.p === k ? ' on' : '') + '" data-act="spPre" data-arg="' + k + '"><span class="spc-ic">' + ICO[p[0]] + '</span><b>' + p[1] + '</b><small class="mono">' + p[2] + ' / ' + p[3] + ' / ' + p[4] + '</small>' + splitBar({ h: p[2], b: p[3], d: p[4] }) + '</button>'; }).join('') +
      '<button class="spc' + (sp.p === 'custom' ? ' on' : '') + '" data-act="spPre" data-arg="custom"><span class="spc-ic">' + ICO.custom + '</span><b>Custom</b><small>set it yourself</small><span class="spbar"><i style="flex:1;background:repeating-linear-gradient(90deg,#3a3a40 0 4px,#26262a 4px 8px)"></i></span></button>';
    var ex = function (k) { return (base * sp[k] / 100).toFixed(2).replace(/\.?0+$/, '') + '%'; };
    var rows = ['h', 'b', 'd'].map(function (k) { var c0 = SPC[k]; return '<div class="spr" style="--c:' + c0[0] + '"><span class="spr-l"><span class="sp-ic">' + ICO[c0[1]] + '</span>' + c0[2] + '</span>' + (sp.p === 'custom' ? '<span class="spr-rg' + (k === 'd' ? ' cap' : '') + '"><input type="range" min="0" max="100" step="5" value="' + sp[k] + '" data-split="' + k + '">' + (k === 'd' ? '<em>cap 50%</em>' : '') + '</span>' : '<span class="spr-fill"><i style="width:' + sp[k] + '%;background:' + c0[3] + '"></i></span>') + '<b class="mono" data-spv="' + k + '">' + sp[k] + '%</b><small class="mono" data-spx="' + k + '">' + ex(k) + ' of each trade</small></div>'; }).join('');
    return '<div class="spk"><div class="spk-h"><b>Where the tax goes</b><span class="spk-lock">' + ICO.lock + 'Locked forever at launch</span></div><div class="spk-chips">' + chips + '</div>' +
      '<div class="spk-viz"><div class="spk-big" data-spbig>' + splitBar(sp, 'big') + '</div>' + rows + '</div>' + rewardPick(c) +
      '<small class="spk-note">Dev share is capped at 50%. Buyers also pay a ' + FEE.taxed + '% trading fee (total ' + (base + FEE.taxed) + '% per trade): ' + FEE.creatorTaxed + '% of it goes to you, ' + FEE.treidTaxed + '% to treid, ' + FEE.dexTaxed + '% to Meteora. It never comes out of this split.</small></div>';
  }
  function spUpdate() {
    var sp = S.c.split, base = S.c.buy; ['h', 'b', 'd'].forEach(function (k) { var v = document.querySelector('[data-spv="' + k + '"]'), x = document.querySelector('[data-spx="' + k + '"]'), r = document.querySelector('[data-split="' + k + '"]'); if (v) v.textContent = sp[k] + '%'; if (x) x.textContent = (base * sp[k] / 100).toFixed(2).replace(/\.?0+$/, '') + '% of each trade'; if (r && +r.value !== sp[k]) r.value = sp[k]; });
    var bg = document.querySelector('[data-spbig]'); if (bg) bg.innerHTML = splitBar(sp, 'big');
  }
  function taxSplitPanel(t) {
    var sp = splitOf(t), m = Math.max(t.buy, t.sell);
    if (!sp && t.live && m > 0) return '<section class="card-s panel tsp-panel"><div class="tsp-h"><b>Where the ' + m + '% tax goes</b><span class="tsp-p">' + ICO.lock + 'on-chain</span></div><small class="muted tsp-n">The ' + m + '% coin tax is held by the token itself (Token-2022) and collected by treid. The holders / burn / dev split for this coin isn\'t published yet — it will show here once the distributor is live. Plus a ' + FEE.taxed + '% trading fee per trade.</small></section>';
    if (!sp) return '<section class="card-s panel tsp-panel"><div class="tsp-h"><b>Fees on this coin</b><span class="tsp-p">plain coin · 0% tax</span></div><div class="tsp-rows" style="grid-template-columns:1fr 1fr 1fr"><div class="tsp-r" style="--c:#E6CB95"><em class="sp-ic">' + ICO.dev + '</em><span>Creator rewards</span><b class="mono">' + FEE.creatorPlain + '%</b><small class="mono">of every trade</small></div><div class="tsp-r" style="--c:#9a9aa2"><em class="sp-ic">' + ICO.lock + '</em><span>treid</span><b class="mono">' + FEE.treidPlain + '%</b><small class="mono">platform</small></div><div class="tsp-r" style="--c:#7FB6FF"><em class="sp-ic">' + ICO.lock + '</em><span>Meteora</span><b class="mono">' + FEE.dexPlain + '%</b><small class="mono">DEX protocol</small></div></div><small class="muted tsp-n">Buyers pay a ' + FEE.plain + '% trading fee per trade, split automatically on-chain.</small></section>';
    var pre = SPRE[sp.p], name = pre ? pre[1] : 'Custom';
    return '<section class="card-s panel tsp-panel"><div class="tsp-h"><b>Where the ' + m + '% tax goes</b><span class="tsp-p">' + ICO.lock + name + ' · locked</span></div>' + splitBar(sp, 'big') +
      (sp.h > 0 ? '<small class="muted tsp-n">Holders are paid in <b>' + esc(rwSym(t)) + '</b>' + (t.rw && t.rw !== 'coin' ? ' — the tax is sold for it before each payout.' : ' — nothing is sold.') + '</small>' : '') +
      '<div class="tsp-rows">' + ['h', 'b', 'd'].map(function (k) { var c0 = SPC[k]; return '<div class="tsp-r" style="--c:' + c0[0] + '"><em class="sp-ic">' + ICO[c0[1]] + '</em><span>' + c0[2] + '</span><b class="mono">' + sp[k] + '%</b><small class="mono">' + (m * sp[k] / 100).toFixed(2).replace(/\.?0+$/, '') + '% / trade</small></div>'; }).join('') + '</div>' +
      '<small class="muted tsp-n">Plus a ' + FEE.taxed + '% trading fee (' + FEE.creatorTaxed + '% creator · ' + FEE.treidTaxed + '% treid · ' + FEE.dexTaxed + '% Meteora), total ' + (m + FEE.taxed) + '% per trade. On a 1 SOL buy: ' + ['h', 'b', 'd'].map(function (k) { return (m / 100 * sp[k] / 100).toFixed(4).replace(/\.?0+$/, '') + ' SOL ' + SPC[k][2].toLowerCase(); }).join(' · ') + '</small>' + (t.live && t.taxPaid && t.taxPaid.n ? '<div class="tsp-paid"><b>Paid out on-chain</b><span class="mono"><em class="sp-ic">' + ICO[SPC.b[1]] + '</em>' + fmtNum(t.taxPaid.burned) + ' burned</span><span class="mono"><em class="sp-ic">' + ICO[SPC.h[1]] + '</em>' + (t.rw && t.rw !== 'coin' ? (+t.taxPaid.holders_q || 0).toFixed(4).replace(/\.?0+$/, '') + ' ' + esc(rwSym(t)) : fmtNum(t.taxPaid.holders)) + ' to holders</span><span class="mono"><em class="sp-ic">' + ICO[SPC.d[1]] + '</em>' + fmtNum(t.taxPaid.dev) + ' to dev</span></div>' : '') + '</section>';
  }
  function taxPicker(c) {
    var sn = c.snipe || (c.snipe = { on: true, start: 50, dur: 30 }); sn.on = true; if (sn.start < 50) sn.start = 50; if (sn.dur < 30) sn.dur = 30; var base = c.buy;
    var steps = []; for (var v = 0; v <= 10; v++) steps.push('<button class="txs' + (base === v ? ' on' : '') + '" style="--tc:' + taxBg(v) + '" data-act="ctax" data-arg="' + v + '">' + v + '%</button>');
    var W = 280, H = 80, x0 = 34, x1 = W - 10, y = function (v) { return 10 + (1 - v / 100) * (H - 30); }, pts = [];
    var stepLbl = ''; for (var k = 0; k < TRAP_STEPS; k++) { var fa = k / TRAP_STEPS, fb = (k + 1) / TRAP_STEPS, tv = trapStepFee(sn.start, base, k), xa = x0 + fa * (x1 - x0), xb = x0 + fb * (x1 - x0); pts.push(xa.toFixed(1) + ',' + y(tv).toFixed(1), xb.toFixed(1) + ',' + y(tv).toFixed(1)); if (k) stepLbl += '<text x="' + ((xa + xb) / 2).toFixed(1) + '" y="' + (y(tv) - 5).toFixed(1) + '" fill="#F2708A" font-size="9" text-anchor="middle" font-family="JetBrains Mono,monospace" opacity=".8">' + tv + '%</text>'; } pts.push(x1.toFixed(1) + ',' + y(base).toFixed(1));
    var graph = '<svg class="trap-g" viewBox="0 0 ' + W + ' ' + H + '"><defs><linearGradient id="trapf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2708A" stop-opacity=".35"/><stop offset="1" stop-color="#F2708A" stop-opacity="0"/></linearGradient></defs>' +
      '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + (H - 20) + '" y2="' + (H - 20) + '" stroke="#2A2A2E"/>' +
      '<polygon points="' + x0 + ',' + (H - 20) + ' ' + pts.join(' ') + ' ' + x1 + ',' + (H - 20) + '" fill="url(#trapf)"/><polyline points="' + pts.join(' ') + '" fill="none" stroke="#F2708A" stroke-width="2" stroke-linejoin="round"/>' +
      stepLbl + '<circle cx="' + x0 + '" cy="' + y(sn.start).toFixed(1) + '" r="3" fill="#F2708A"/><circle cx="' + x1 + '" cy="' + y(base).toFixed(1) + '" r="3" fill="#D6D1C9"/>' +
      '<text x="' + (x0 - 6) + '" y="' + (y(sn.start) + 3).toFixed(1) + '" fill="#F2708A" font-size="10" text-anchor="end" font-family="JetBrains Mono,monospace">' + sn.start + '%</text>' +
      '<text x="' + x1 + '" y="' + (y(base) - 7).toFixed(1) + '" fill="#D6D1C9" font-size="10" text-anchor="end" font-family="JetBrains Mono,monospace">' + base + '%</text>' +
      '<text x="' + x0 + '" y="' + (H - 6) + '" fill="#7A766F" font-size="9" font-family="JetBrains Mono,monospace">launch</text><text x="' + x1 + '" y="' + (H - 6) + '" fill="#7A766F" font-size="9" text-anchor="end" font-family="JetBrains Mono,monospace">+' + (sn.dur < 60 ? sn.dur + 's' : sn.dur / 60 + 'm') + '</text></svg>';
    return '<div class="field taxf"><div class="lbl"><b>Tax <span class="muted" style="font-weight:500;font-size:12px">· same for buys and sells</span></b><span class="mono" style="color:' + taxBg(base) + '">' + base + '%</span></div><div class="txrow">' + steps.join('') + '</div></div>' +
      '<div class="trap' + (sn.on ? ' on' : '') + '"><div class="trap-t"><span class="trap-ic">🪤</span><span><b>Sniper trap <em class="trap-on">always on</em></b><small>Every coin on treid starts with a sniper trap: buyers in the first seconds pay a high fee that steps down in 3 drops to normal as the timer runs out — no single moment for bots to wait for. Minimum 50% for 30 seconds — make it stronger or longer if you like. Your own initial buy is never affected.</small></span></div>' +
      (sn.on ? (function () {
        var durTxt = function (sec) { return sec < 60 ? sec + 's' : (sec % 60 ? Math.floor(sec / 60) + 'm ' + (sec % 60) + 's' : sec / 60 + 'm'); };
        var at = function (f) { return Math.round(sn.start - (sn.start - base) * f); };
        var ticks = '';
        return '<div class="trap-cfg2"><div class="tc-row"><span class="tc-l">Trap tax</span><div class="tc-seg">' + [50, 65, 80, 90].map(function (v) { return '<button class="' + (sn.start === v ? 'on' : '') + '" data-act="snipeStart" data-arg="' + v + '">' + v + '%</button>'; }).join('') + '</div></div>' +
          '<div class="tc-row"><span class="tc-l">Lasts for</span><div class="tc-seg g">' + [[30, '30s'], [40, '40s'], [45, '45s'], [50, '50s'], [60, '1 min']].map(function (d) { return '<button class="' + (sn.dur === d[0] ? 'on' : '') + '" data-act="snipeDur" data-arg="' + d[0] + '">' + d[1] + '</button>'; }).join('') + '</div></div>' +
          '<div class="tl3"><div class="liq liq-prev" style="--f:.62"><span class="liq-fill"><svg class="liq-w" viewBox="0 0 120 10" preserveAspectRatio="none"><path d="M0 5 Q7.5 0 15 5 T30 5 T45 5 T60 5 T75 5 T90 5 T105 5 T120 5 V10 H0Z"/></svg></span><span class="liq-c"><span class="lq-big mono">' + sn.start + '%</span><span class="lq-tx"><b>What buyers see</b><small>steps down every ' + durTxt(Math.round(sn.dur / TRAP_STEPS)) + ', then tax is <i>' + base + '%</i></small></span></span></div>' +
            '<div class="tstair">' + [0, 1, 2].map(function (i) { var w = sn.dur / TRAP_STEPS; return '<span style="--h:' + Math.max(.12, trapStepFee(sn.start, base, i) / 100).toFixed(2) + '"><b class="mono">' + trapStepFee(sn.start, base, i) + '%</b><small class="mono">' + Math.round(i * w) + '–' + Math.round((i + 1) * w) + 's</small></span>'; }).join('') + '<span class="done" style="--h:.12"><b class="mono">' + base + '%</b><small>after</small></span></div></div>' +
          '<div class="tc-ex">💡 A bot buying <b>1 SOL</b> at launch pays <b class="dn">' + (sn.start / 100).toFixed(2) + ' SOL</b> tax. Wait ' + durTxt(Math.round(sn.dur / TRAP_STEPS)) + ' → <b class="dn">' + (trapStepFee(sn.start, base, 1) / 100).toFixed(2) + ' SOL</b>, then <b class="dn">' + (trapStepFee(sn.start, base, 2) / 100).toFixed(2) + ' SOL</b>, and after ' + durTxt(sn.dur) + ' just <b>' + (base / 100).toFixed(2) + ' SOL</b>. No single second to camp — waiting costs price, rushing costs tax.</div></div>';
      })() : '') + '</div>';
  }
  setInterval(function () {
    document.querySelectorAll('[data-trap]').forEach(function (e) { var t = find(e.getAttribute('data-trap')); var v = t ? snipeNow(t) : 0; if (v > 0) e.textContent = '🪤 ' + v + '%'; else e.remove(); });
    document.querySelectorAll('[data-trapl]').forEach(function (e) { var t = find(e.getAttribute('data-trapl')); if (!t) return; var v = snipeNow(t), m = Math.max(t.buy, t.sell), sm = e.querySelector('small'); if (v > 0) { var left = Math.ceil(t.snipe.dur - (Date.now() - t.born) / 1000); sm.innerHTML = 'tax now <i>' + v + '%</i> → ' + m + '% · ' + (left >= 60 ? Math.floor(left / 60) + 'm ' : '') + (left % 60) + 's left'; } else { e.classList.add('done'); sm.textContent = 'ended — tax is ' + m + '%'; } });
  }, 1000);
  function socField(c, k, name, pre, ph) {
    var v = c[k] || '', ok = v.trim().length > 2;
    var ic = k === 'x' ? '<svg viewBox="0 0 24 24"><path fill="#fff" d="M17.75 3h3.07l-6.71 7.67L22 21h-6.18l-4.84-6.33L5.44 21H2.37l7.18-8.2L2 3h6.34l4.37 5.78L17.75 3zm-1.08 16.17h1.7L7.42 4.74H5.6l11.07 14.43z"/></svg>'
      : k === 'tg' ? '<svg viewBox="0 0 24 24"><path fill="#fff" d="M9.04 15.47l-.37 5.2c.53 0 .76-.23 1.04-.5l2.5-2.39 5.18 3.8c.95.52 1.62.25 1.88-.88l3.4-15.96c.31-1.41-.5-1.96-1.43-1.62L1.28 10.9c-1.37.53-1.35 1.3-.23 1.65l5.1 1.6L17.98 6.7c.56-.37 1.06-.17.64.2"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.6" ry="8.5"/><path d="M3.8 9h16.4M3.8 15h16.4"/></svg>';
    return '<label class="socf s-' + k + (ok ? ' ok' : '') + '" for="c-' + k + '"><span class="socf-ic">' + ic + '</span><span class="socf-in"><input id="c-' + k + '" data-bind="c.' + k + '" value="' + esc(v) + '" placeholder="' + ph + '" autocomplete="off" aria-label="' + name + ' link"></span><span class="socf-ck">✓</span></label>';
  }
  // ===== REAL PAIRS: what buyers pay with — SOL, USDC or any Solana token (validated on-chain) =====
  var USDC_MINT = CHAIN_ID === 'solana:devnet' ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', WSOL = 'So11111111111111111111111111111111111111112';
  S.qBusy = null; S.qErr = '';
  function qOf(c) { return (c && c.q) || { mint: WSOL, sym: 'SOL', dec: 9, usd: SOL_USD, sol: true, key: 'SOL' }; }
  function qUsd(q) { return q.sol ? SOL_USD : q.usd; }
  function usdTxt(v) { return v >= 1 ? v.toFixed(2) : v.toPrecision(3); }
  function qReg(sym, mint, icon, name) {
    if (mint === WSOL) return 'SOL'; if (mint === USDC_MINT) return 'USDC';   // only the real mints map to the known icons
    var k = String(sym || mint.slice(0, 4)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'TOKEN';
    if (PAIR_INFO[k] && PAIR_INFO[k].ca !== mint) k = k + '·' + mint.slice(0, 3);   // a token merely CALLED “USDC” never borrows the real one's name and icon
    if (!PAIR_INFO[k]) PAIR_INFO[k] = { name: (name || sym || 'Token') + ' · ' + mint.slice(0, 4) + '…' + mint.slice(-4), cat: 'crypto', g: k.slice(0, 2), c: '#4A4A4F', ca: mint, custom: true };
    if (safeImg(icon) && !PAIR_INFO[k].img) PAIR_INFO[k].img = safeImg(icon);
    return k;
  }
  function qSelect(mint, pre) {
    if (mint === WSOL) { S.c.q = null; S.c.pair = 'SOL'; S.qErr = ''; S.cpq = ''; render(); return; }
    S.qBusy = mint; S.qErr = ''; render();
    Promise.all([chainLib().then(function (T) { return T.quoteInfo({ rpc: RPC, mint: mint }); }), API ? apiGet('/api/qprice?mint=' + mint).catch(function () { return {}; }) : Promise.resolve({})]).then(function (r) {
      var qi = r[0], pr = r[1] || {}; if (S.qBusy !== mint) return; S.qBusy = null;
      if (!qi.ok) { S.qErr = CHAIN_ID === 'solana:devnet' && /No token found/.test(qi.reason || '') ? 'This pair opens on mainnet — on the test network only SOL and USDC exist' : (qi.reason || 'This token can’t be used as a pair'); render(); return; }
      if (pre && String(pr.symbol || '').toLowerCase() !== pre.sym.toLowerCase()) { if (pre.retry) return pre.retry(); S.qErr = 'That shortcut didn’t check out — try the search'; render(); return; }
      if (!(pr.usd > 0)) { S.qErr = 'No market price found for this token, so a fair starting price can’t be set. Pick a token that trades on Jupiter.'; render(); return; }
      var k = qReg(pr.symbol, mint, tokImg(mint) || pr.icon, pr.name); if (pre && pre.img) PAIR_INFO[k].img = pre.img;
      S.c.q = { mint: mint, sym: pr.symbol || k, dec: qi.decimals, usd: pr.usd, warn: qi.warn || null, key: k }; S.c.pair = k; S.cpq = ''; S.c.devBuy = ''; render();   // the holder-reward choice stays as picked
    }).catch(function (e) { S.qBusy = null; S.qErr = 'Couldn’t check this token: ' + chainErr(e); render(); });
  }
  function qPreset(sym) {   // shortcut chip → its known address (or the verified token with exactly this symbol) → the normal pair checks
    if (sym === 'SOL') return qSelect(WSOL); if (sym === 'USDC') return qSelect(USDC_MINT);
    var pp = preOf(sym); if (pp && pp[3]) return qSelect(pp[3], { sym: pp[1], img: pp[2], retry: function () { qPresetSearch(sym); } });
    qPresetSearch(sym);
  }
  function qPresetSearch(sym) {
    if (!API) { S.qErr = 'Token search needs the treid server'; render(); return; }
    S.qBusy = sym; S.qErr = ''; render();
    apiGet('/api/tsearch?q=' + encodeURIComponent(sym)).then(function (list) { var t = (list || []).filter(function (x) { return String(x.symbol).toLowerCase() === sym.toLowerCase(); })[0];
      if (S.qBusy !== sym) return; S.qBusy = null; if (!t) { S.qErr = 'Couldn’t find verified ' + sym + ' right now — try the search'; render(); return; } var pp = preOf(sym); qSelect(t.mint, { sym: sym, img: pp && pp[2] }); })
      .catch(function () { S.qBusy = null; S.qErr = 'Token search is unavailable — try again'; render(); });
  }
  function realPairPicker(c) {
    var q = qOf(c), cur = q.mint, custom = cur !== WSOL && cur !== USDC_MINT;
    return '<div class="field rpp"><div class="lbl"><b>Buyers pay with</b> <span class="muted" style="font-weight:500;font-size:12px">· the token your coin trades against</span></div>' +
      '<div class="rpp-opts">' + [[WSOL, 'SOL', 'Solana'], [USDC_MINT, 'USDC', 'USD Coin']].map(function (o) { return '<button class="rpp-o' + (cur === o[0] ? ' on' : '') + '" data-act="qpick" data-arg="' + o[0] + '">' + coinHTML(o[1], 26) + '<span><b>' + o[1] + '</b><small>' + o[2] + '</small></span></button>'; }).join('') +
        (custom ? '<button class="rpp-o on" data-act="qpick" data-arg="' + esc(cur) + '">' + coinHTML(q.key, 26) + '<span><b>' + esc(q.sym) + '</b><small class="mono">' + esc(short(cur)) + '</small></span></button>' : '') + '</div>' +
      '<div class="cpp-tabs">' + RW_TABS.map(function (x) { return '<button class="' + ((S.qTab || 'crypto') === x[0] ? 'on' : '') + '" data-act="qTab" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="cpp-quick drag-scroll">' + (RW_PRE[S.qTab || 'crypto'] || []).map(function (p) { var on = String(q.sym).toLowerCase() === p[1].toLowerCase() || (p[0] === 'SOL' && cur === WSOL) || (p[0] === 'USDC' && cur === USDC_MINT); return '<button class="cpp-q' + (on ? ' on' : '') + '" data-act="qPre" data-arg="' + esc(p[1]) + '">' + preIcon(p, 20) + '$' + esc(p[0]) + '</button>'; }).join('') + '</div>' +
      '<div class="rpp-s">' + I.search + '<input id="c-qmint" data-qmint value="' + esc(S.cpq) + '" placeholder="Search name, ticker or paste contract address" autocomplete="off" spellcheck="false"><div class="cpp-drop" id="q-drop" style="display:none"></div></div>' +
      (S.qBusy ? '<small class="rpp-st">Checking token…</small>' : S.qErr ? '<small class="rpp-st bad">' + esc(S.qErr) + '</small>' : q.warn ? '<small class="rpp-st warn">⚠ ' + esc(q.warn) + '</small>' : '') +
      '<small class="rpp-note">Buyers pay in <b>' + esc(q.sym) + '</b>. Price, trading fees and your creator rewards are all in ' + esc(q.sym) + (q.sol ? '' : ' · 1 ' + esc(q.sym) + ' ≈ $' + usdTxt(q.usd)) + '.</small></div>';
  }
  function pairPicker(c) {
    var pi = pairInfo(c.pair), q = S.cpq.trim(), res = q ? pairSearch(q) : [];
    var quick = S.cpTab === 'memes' ? all().slice().sort(function (a, b) { return b.mcN - a.mcN; }).slice(0, 12).map(function (t) { return t.tick; }) : Object.keys(PAIR_INFO).filter(function (id) { return PAIR_INFO[id].cat === S.cpTab; });
    var drop = q ? '<div class="cpp-drop">' + res.map(function (id) { var p2 = pairInfo(id), t = find(id); return '<button class="cpp-it' + (c.pair === id ? ' on' : '') + '" data-act="cpairPick" data-arg="' + esc(id) + '">' + coinHTML(id, 26) + '<span><b>' + esc(pairLabel(id)) + '</b><small>' + esc(p2.name) + (t ? ' · ' + short(t.ca) + ' · ' + fmtK(t.mcN) : p2.ca ? ' · ' + short(p2.ca) : '') + '</small></span></button>'; }).join('') +
      (isCA(q) && !res.length ? '<button class="cpp-it ca" data-act="cpairCA" data-arg="' + esc(q) + '"><span class="coin" style="width:26px;height:26px;background:#3A3A3D;font-size:12px">?</span><span><b>Use this contract</b><small class="mono">' + esc(short(q)) + ' · not listed on treid yet</small></span></button>' : '') +
      (!res.length && !isCA(q) ? '<div class="muted cpp-none">No match — paste a contract address to pair with any Solana token.</div>' : '') + '</div>' : '';
    return '<div class="field cpp"><b>Pair with</b><div class="cpp-row"><div class="cpp-sel">' + coinHTML(c.pair, 30) + '<span><b>' + esc(pairLabel(c.pair)) + '</b><small>' + esc(pi.name) + '</small></span></div>' +
      '<div class="cpp-s">' + I.search + '<input id="c-pq" data-bind="cpq" value="' + esc(S.cpq) + '" placeholder="Search name, ticker or paste contract address" autocomplete="off">' + drop + '</div></div>' +
      '<div class="cpp-tabs">' + CATS.slice(1).map(function (cg) { return '<button class="' + (S.cpTab === cg[0] ? 'on' : '') + '" data-act="cpTab" data-arg="' + cg[0] + '">' + cg[1] + '</button>'; }).join('') + '</div>' +
      '<div class="cpp-quick drag-scroll">' + quick.map(function (id) { return '<button class="cpp-q' + (c.pair === id ? ' on' : '') + '" data-act="cpair" data-arg="' + esc(id) + '">' + coinHTML(id, 20) + esc(pairLabel(id)) + '</button>'; }).join('') + '</div></div>';
  }
  function createPage() {
    var c = S.c, sp = c.spec, tmax = Math.max(c.buy, c.sell);
    var dq = devQuote(String(c.devBuy || '').replace(',', '.'));
    var preview = { devPct: +dq.pct.toFixed(2), name: c.name || 'Your token', tick: c.tick || 'TICKER', spec: sp, img: c.img, banner: c.banner, buy: c.buy, sell: c.sell, split: c.buy > 0 ? c.split : null, pair: c.pair, mcN: 5, mc0: 5, prog: 1, born: Date.now(), holders: 1, vol: 0, ca: 'preview', hist: [5, 5.1, 5, 5.2, 5.4], rewards: false, burn: false, rw: rwOf(c) ? (rwOf(c).mint === qOf(c).mint ? 'pair' : { mint: rwOf(c).mint }) : 'coin' };
    function opts(key, list) { return '<div class="optrow">' + list.map(function (v) { return '<button class="opt' + (sp[key] === v ? ' on' : '') + '" data-act="spec" data-k="' + key + '" data-arg="' + v + '">' + v + '</button>'; }).join('') + '</div>'; }
    function sws(key, list) { return '<div class="optrow">' + list.map(function (v) { return '<button class="sw' + (sp[key] === v ? ' on' : '') + '" style="background:' + v + '" data-act="spec" data-k="' + key + '" data-arg="' + v + '" aria-label="Colour ' + v + '"></button>'; }).join('') + '</div>'; }
    return '<main class="wrap" style="padding-top:22px;max-width:1240px">' +
      '<button class="link" data-act="home">' + I.back + 'Back to board</button>' +
      '<h1 class="title-xl" style="font-size:38px;margin:8px 0 22px">Launch a token</h1>' +
      '<div class="create-grid">' +
        '<section class="card-s panel" style="flex:999 1 520px;min-width:0;display:flex;flex-direction:column;gap:20px;padding:24px">' +
          '<div class="fsec"><i>1</i>Identity</div>' +
          '<div class="ident"><label class="ident-ban' + (c.banner ? ' has' : '') + '" for="c-banner" data-drop="banner">' + (c.banner ? '<img src="' + esc(c.banner) + '" alt="">' : '<span class="ib-ph">' + I.up + '<b>Add a banner</b><small>3:1 · e.g. 1500×500 · recommended</small></span>') + '</label>' +
            '<label class="ident-logo' + (c.img ? ' has' : '') + '" for="c-img" data-drop="img">' + (c.img ? '<img src="' + esc(c.img) + '" alt="">' : '<span class="il-ph">' + I.up + '<b>Logo</b></span>') + '</label>' +
            '<div class="ident-meta"><b>' + esc(c.name || 'Your coin') + '</b><span class="mono">$' + esc(c.tick || 'TICKER') + '</span></div>' +
            '<div class="ident-acts">' + (c.img ? '<button class="link" data-act="clearImg">Remove logo</button>' : '<span class="req">logo required</span>') + (c.banner ? '<button class="link" data-act="clearBanner">Remove banner</button>' : '') + '</div></div>' +
          '<input id="c-img" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="sr"><input id="c-banner" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="sr">' +
          '<div class="row"><div class="field" style="flex:2 1 220px"><label for="c-name" style="font-weight:700">Name</label><input id="c-name" class="inp" maxlength="32" data-bind="c.name" value="' + esc(c.name) + '" placeholder="e.g. Giga Pug"></div>' +
            '<div class="field" style="flex:1 1 140px"><label for="c-tick" style="font-weight:700">Ticker</label><span class="tick-in"><em>$</em><input id="c-tick" class="inp mono" data-bind="c.tick" value="' + esc(c.tick) + '" placeholder="DFROG"></span></div></div>' + 
          '<div class="field"><label for="c-desc" style="font-weight:700">Description</label><textarea id="c-desc" class="inp" data-bind="c.desc" placeholder="What is this token about?">' + esc(c.desc) + '</textarea></div>' +
          '<div class="fsec"><i>2</i>Market</div>' +
          realPairPicker(c) + taxPicker(c) + splitPicker(c) + devBuyPicker(c) + vanityPicker(c) +
          '<div class="fsec"><i>3</i>Community</div>' +
          '<div class="socrow"><span class="soc-l">Socials <small>optional · shown as buttons on your coin</small></span><div class="socgrid">' + socField(c, 'x', 'X', '', 'Paste X link') + socField(c, 'tg', 'Telegram', '', 'Paste Telegram link') + socField(c, 'web', 'Website', '', 'Paste website link') + '</div></div>' +
          '<button class="big-btn btn pri" data-act="launch"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? esc(S.busy) + '…' : S.account ? 'Launch on-chain' + NETP + '' : 'Connect wallet to launch') + '</button>' +
          (S.account && DEMO ? '<button class="demo-l" data-act="demoLaunch">No ' + NET + 'SOL? Try a demo launch instead</button>' : '') +
          '<span class="note">' + (CHAIN_ID === 'solana:devnet' ? 'Devnet beta: your coin is created on the Solana test network.' : 'Your coin is created on-chain on Meteora (Solana mainnet).') + ' Your wallet signs every step.</span>' +
        '</section>' +
        '<aside style="flex:1 1 320px;display:flex;flex-direction:column;gap:12px;position:sticky;top:90px"><span class="kicker">LIVE PREVIEW</span>' + card(preview, { preview: true }) +
          '<div class="card-s panel pv-sum"><div class="pv-row">' + avatarHTML(preview, 52) + '<div><b>At launch</b><small class="muted">what buyers will see</small></div></div>' +
            '<div class="pv-grid"><div><small>You hold</small><b class="mono" style="color:' + (dq.pct < 3 ? '#3DDC97' : dq.pct < 8 ? '#FFD15C' : '#F2708A') + '">' + dq.pct.toFixed(2) + '%</b></div><div><small>Snipers</small><b class="mono up">0%</b></div><div><small>Bundles</small><b class="mono up">0%</b></div><div><small>Tax</small><b class="mono">' + tmax + '%</b></div></div>' +
            (c.buy > 0 && c.split && c.split.h > 0 ? '<div class="pv-rw">' + (rwOf(c) ? coinHTML(rwOf(c).key, 18) : avatarHTML(preview, 18)) + '<span>Holders get <b>' + c.split.h + '%</b> of the tax, paid in <b>' + esc(rwOf(c) ? rwOf(c).sym : '$' + preview.tick) + '</b></span></div>' : '') +
            (c.snipe ? '<div class="pv-trap">🪤 Sniper trap: ' + [0, 1, 2].map(function (i) { return trapStepFee(c.snipe.start, tmax, i) + '%'; }).join(' → ') + ' → ' + tmax + '% over ' + (c.snipe.dur < 60 ? c.snipe.dur + 's' : c.snipe.dur / 60 + 'm') + '</div>' : '') + '</div></aside>' +
      '</div></main>';
  }

  function walletModal() {
    if (S.dlTap) return dlTapHTML();
    if (!S.walletOpen) return '';
    var opts = S.wallets.length ? S.wallets.map(function (w) {
      var busy = S.connecting === w.name;
      return '<button class="wopt" data-act="pickWallet" data-arg="' + esc(w.name) + '"' + (S.connecting ? ' disabled' : '') + '>' + (w.icon ? '<img src="' + esc(w.icon) + '" alt="">' : '') +
        '<span style="flex:1">' + esc(w.name) + '</span><span class="muted" style="font-size:12.5px;font-weight:600">' + (busy ? 'Approve in wallet…' : 'Detected') + '</span></button>';
    }).join('') : (isMob() || /iPhone|iPad|Android/i.test(navigator.userAgent) ? (function () { var here = encodeURIComponent(location.href), ref = encodeURIComponent(location.origin);   // phones: wallets have no browser extension — open this page inside the wallet app
      dlPrep(); var row = function (prov, sub) { var P = S.dlPre[prov], inner = '<img class="wl-ic" src="' + DLP[prov].icon + '" alt=""><span class="wl-nm"><b>' + DLP[prov].name + '</b><small>' + sub + '</small></span><span class="wl-go">Connect</span>';
        return P ? '<a class="wl-one" href="' + esc(P.url) + '" data-act="dlArm" data-arg="' + prov + '">' + inner + '</a>' : '<button class="wl-one" data-act="dlConnect" data-arg="' + prov + '">' + inner + '</button>'; };
      return '<div class="wl-mob">' + row('phantom', 'Opens the app · approve · back here') + row('solflare', 'Opens the app · approve · back here') +
        '<details class="wl-more"><summary>More options</summary><small class="muted wl-or">Open treid inside the wallet’s own browser:</small>' +
        '<a class="wl-deep" href="https://phantom.app/ul/browse/' + here + '?ref=' + ref + '"><img class="wl-ic sm" src="' + WICON.phantom + '" alt=""><b>Phantom browser</b><span>→</span></a>' +
        '<a class="wl-deep" href="https://solflare.com/ul/v1/browse/' + here + '?ref=' + ref + '"><img class="wl-ic sm" src="' + WICON.solflare + '" alt=""><b>Solflare browser</b><span>→</span></a>' +
        '<a class="wl-deep" href="https://backpack.app/ul/v1/browse/' + here + '?ref=' + ref + '"><span class="wl-di">🎒</span><b>Backpack browser</b><span>→</span></a></details>' +
        '<small class="muted">No wallet yet? <a href="https://phantom.com/download" target="_blank" rel="noopener">Get Phantom</a></small></div>'; })() :
      '<div class="card-s" style="padding:16px;display:flex;flex-direction:column;gap:10px"><b>No Solana wallet found</b><span class="muted" style="font-size:13.5px;line-height:1.55">Install Phantom, Solflare or Backpack and reload.</span><a href="https://phantom.com/download" target="_blank" rel="noopener">Get Phantom →</a></div>');
    return '<div class="overlay center" data-act="bg"><div class="modal" role="dialog" aria-modal="true" aria-label="Connect a wallet">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-family:var(--disp);font-size:18px">Connect wallet</b><button class="iconbtn" aria-label="Close" data-act="closeWallet">✕</button></div>' + opts +
      '<span class="note">Solana ' + CLUSTER + ' · Connecting only shares your public address.</span></div></div>';
  }

  function palResults() {
    var q = S.palQ.trim().toLowerCase();
    var list = all().filter(function (t) { return !q || t.name.toLowerCase().indexOf(q) !== -1 || t.tick.toLowerCase().indexOf(q) !== -1 || t.ca.toLowerCase() === q; });
    if (!q) list.sort(function (a, b) { return chg(b) - chg(a); });
    return list.slice(0, 8);
  }
  function palette() {
    if (!S.palOpen) return '';
    var res = palResults();
    return '<div class="overlay" data-act="bg"><div class="palette" role="dialog" aria-modal="true" aria-label="Search tokens">' +
      '<div class="palette-in">' + I.search + '<input id="pal" data-bind="palQ" value="' + esc(S.palQ) + '" placeholder="Search by name, ticker or contract address" autocomplete="off"><button class="kbd pal-x" data-act="palClose" aria-label="Close search">Esc</button></div>' +
      '<div class="palette-list">' + (S.palQ ? '' : '<div class="muted" style="font-size:12px;padding:6px 10px">Trending now</div>') +
      (res.length ? res.map(function (t, i) {
        var c = chg(t);
        return '<button class="pal-row' + (i === S.palIdx ? ' on' : '') + '" data-act="open" data-arg="' + esc(t.tick) + '">' + avatarHTML(t, 36) +
          '<span style="flex:1;min-width:0"><b>' + esc(t.name) + '</b> <span class="mono muted">$' + esc(t.tick) + '</span></span>' +
          '<span class="mono">' + fmtK(t.mcN) + '</span><span class="mono ' + (c >= 0 ? 'up' : 'down') + '" style="width:72px;text-align:right">' + chgTxt(c) + '</span>' +
          '<span class="tax" style="background:' + taxBg(Math.max(t.buy, t.sell)) + ';min-width:44px;padding:3px 6px"><b style="font-size:13px">' + Math.max(t.buy, t.sell) + '%</b></span></button>';
      }).join('') : '<div class="muted" style="padding:24px;text-align:center">No tokens found</div>') +
      '</div></div></div>';
  }

  function footer() {
    return '<footer><div class="wrap foot"><span style="display:flex;align-items:center;gap:8px"><span style="width:22px;height:22px;display:inline-block">' + LOGO + '</span><b style="color:var(--soft)">treid<span class="muted" style="font-weight:600">.fun</span></b></span>' +
      '<span>' + (DEMO ? 'Demo · market data on this page is simulated · wallet connects to Solana ' + CLUSTER : 'Beta on Solana ' + CLUSTER + ' · every coin and trade here is real and on-chain') + '</span>' +
      '<span style="margin-left:auto;display:flex;gap:16px"><a href="#machine" data-act="how">How it works</a><a href="#" data-act="social">X</a><a href="#" data-act="social">Telegram</a><a href="#" data-act="terms">Terms &amp; risks</a></span></div></footer>';
  }

  // ================= RENDER =================
  var firstCount = true;
  // ================= URL ROUTING (refresh / share / back button keep your place) =================
  var ROUTES = { create: 'create', burn: 'burnery', leaders: 'leaderboard', trend: 'trending', watch: 'watchlist' }, routeReady = false;
  function routeOf() { if (S.screen === 'pending') return location.hash || ''; if (S.screen === 'site' && S.site) { var tsv = find(S.site.tick); return '#/c/' + encodeURIComponent(tsv && tsv.live ? tsv.ca : S.site.tick) + (S.site.th && S.site.th !== 'dark' ? '/' + S.site.th : ''); } if (S.screen === 'callout' && S.coView) { var tv = find(S.coView.tick); return '#/callout/' + encodeURIComponent(tv && tv.live ? tv.ca : S.coView.tick) + '/' + S.coView.id; } if (S.screen === 'token' && S.tick) { var t0 = find(S.tick); return '#/coin/' + encodeURIComponent(t0 && t0.live ? t0.ca : S.tick); } return ROUTES[S.screen] ? '#/' + ROUTES[S.screen] : ''; }
  function syncRoute() { if (!routeReady) return; var r = routeOf(), cur = location.hash || ''; if (cur === r) return; try { history.pushState(null, '', r || (location.pathname + location.search)); } catch (e) {} }
  function applyRoute() {
    var h = ''; try { h = decodeURIComponent((location.hash || '').replace(/^#\/?/, '')); } catch (e) { h = ''; } var parts = h.split('/');
    if (parts[0] === 'coin' && parts[1]) { var id = parts[1], t1 = find(id) || S.live.filter(function (x) { return x.ca === id; })[0];
      if (t1) { if (S.screen !== 'token' || S.tick !== t1.tick) openToken(t1.tick); } else if (API) { S.pendingRoute = id; S.screen = 'pending'; setTimeout(function () { if (S.screen === 'pending') { S.pendingRoute = null; set({ screen: 'home' }); toast('Couldn\'t load that coin — the server may be waking up, try again'); } }, 45000); } else set({ screen: 'home' }); return; }
    if (parts[0] === 'c' && parts[1]) { var ts = find(parts[1]) || S.live.filter(function (x) { return x.ca === parts[1]; })[0];
      if (ts) { if (ts.live) liveLoad(ts); set({ screen: 'site', site: { tick: ts.tick, th: parts[2] || 'dark' } }); window.scrollTo(0, 0); } else if (API) { S.pendingRoute = parts[1]; S.pendingSite = parts[2] || 'dark'; S.screen = 'pending'; setTimeout(function () { if (S.screen === 'pending') { S.pendingRoute = null; S.pendingSite = null; set({ screen: 'home' }); toast('Couldn\'t load that coin — the server may be waking up, try again'); } }, 45000); } else set({ screen: 'home' }); return; }
    if (parts[0] === 'callout' && parts[1] && parts[2]) { var tc = find(parts[1]) || S.live.filter(function (x) { return x.ca === parts[1]; })[0];
      if (tc) { if (tc.live) liveLoad(tc); S.tick = tc.tick; set({ screen: 'callout', coView: { tick: tc.tick, id: +parts[2] } }); } else if (API) { S.pendingRoute = parts[1]; S.pendingCo = +parts[2]; S.screen = 'pending'; setTimeout(function () { if (S.screen === 'pending') { S.pendingRoute = null; S.pendingCo = null; set({ screen: 'home' }); } }, 45000); } else set({ screen: 'home' }); return; }
    for (var k in ROUTES) if (ROUTES[k] === parts[0]) { if (S.screen !== k) set({ screen: k, palOpen: false }); return; }
    if (S.screen !== 'home') set({ screen: 'home' });
  }
  window.addEventListener('popstate', function () { routeReady = false; applyRoute(); routeReady = true; });
  function render() {
    var ae = document.activeElement, fid = ae && ae.id, ss = null, se = null;
    try { if (fid && ae.selectionStart != null) { ss = ae.selectionStart; se = ae.selectionEnd; } } catch (e) {}
    var body = S.screen === 'pending' ? '<main class="wrap"><div class="route-wait"><span class="gr-sp"></span><b>Loading coin…</b><small class="muted">fetching live data from the chain</small></div></main>' : S.screen === 'token' ? tokenPage() : S.screen === 'create' ? createPage() : S.screen === 'leaders' ? leadersPage() : S.screen === 'watch' ? watchPage() : S.screen === 'burn' ? burnPage() : S.screen === 'trend' ? trendPage() : S.screen === 'callout' ? calloutPage() : S.screen === 'site' ? sitePage() : home();
    var detOpen = [].map.call(document.querySelectorAll('#app details'), function (d) { return d.open ? (d.className || 'd') : null; });
    if (S.screen === 'site') { document.getElementById('app').innerHTML = body + siteModal() + walletModal(); document.body.classList.add('on-site'); document.body.classList.remove('has-rail', 'has-rail-min'); return; } document.body.classList.remove('on-site');
    document.getElementById('app').innerHTML = (RPC_DEV || API_DEV ? '<div class="devbar">⚠ Developer mode — custom ' + [RPC_DEV ? 'RPC' : '', API_DEV ? 'server' : ''].filter(Boolean).join(' + ') + ' (this tab only)</div>' : '') + '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="ccUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3DDC97" stop-opacity=".28"/><stop offset="1" stop-color="#3DDC97" stop-opacity="0"/></linearGradient><linearGradient id="ccDn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2708A" stop-opacity=".26"/><stop offset="1" stop-color="#F2708A" stop-opacity="0"/></linearGradient></defs></svg>' + tape() + header() + body + footer() + walletModal() + demoImgModal() + termsModal() + calloutDrawer() + calloutRail() + palette() + walletDrawer() + holderMap() + burnModal() + ctoModal() + coModal() + shareModal() + siteModal();
    document.body.classList.toggle('has-rail', S.screen === 'home' && !S.coOpen && !S.railHidden); document.body.classList.toggle('has-rail-min', S.screen === 'home' && !S.coOpen && !!S.railHidden);
    if (fid) { var el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) {} } }
    if (S.palOpen && !fid) { var p = document.getElementById('pal'); if (p) p.focus(); }
    if (S.screen === 'home' && !S.loading && firstCount) { firstCount = false; countUp(); }
    if (typeof reveal === 'function') reveal();
    if (detOpen.some(Boolean)) { var dets = document.querySelectorAll('#app details'); detOpen.forEach(function (cl, i) { if (cl && dets[i] && (dets[i].className || 'd') === cl) dets[i].open = true; }); }   // keep opened sections open across live re-renders
    if (S.screen === 'callout') drawShareCard();
    if (S.share) drawShare();
    if (S.screen === 'token') lwMount();
    if (S.screen === 'home') tsMount();
    setTimeout(function () { navInd(); labKick(); fwKick(); mbuyWatch(); bnKick(); }, 0);
    mFit(); if (S.screen === 'home') mSetStep(M.step);
  }
  function countUp() {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var to = +el.getAttribute('data-count'), k = el.getAttribute('data-fmt') === 'k', t0 = performance.now();
      (function step(now) {
        var p = Math.min(1, (now - t0) / 1100), e = 1 - Math.pow(1 - p, 3), v = to * e;
        el.textContent = k ? fmtK(v) : Math.round(v).toString();
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    });
  }

  // ================= LIVE MARKET ENGINE =================
  function roll(el, txt, dir) {
    var old = el.getAttribute('data-v') || el.textContent;
    if (old === txt) return;
    var h = '';
    for (var i = 0; i < txt.length; i++) {
      var ch = txt[i], changed = ch !== old[i] && /\d/.test(ch);
      h += '<span' + (changed ? ' class="' + (dir > 0 ? 'u' : 'd') + '"' : '') + '>' + ch + '</span>';
    }
    el.innerHTML = '<span class="roll">' + h + '</span>';
    el.setAttribute('data-v', txt);
    el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
  }
  function q(sel) { return document.querySelectorAll(sel); }
  function attr(name, tick) { return '[' + name + '="' + (window.CSS && CSS.escape ? CSS.escape(tick) : tick) + '"]'; }

  function applyTrade(t, side, sol, wallet, mine, real) {
    var dir = side === 'buy' ? 1 : -1;
    var impact = Math.min(6, sol * 3 / Math.sqrt(Math.max(t.mcN, 4)));
    var wasGrad = t.prog >= 100;
    if (real) { t.mcN = real.mc; t.prog = real.prog; t.vol += (real.usd != null ? real.usd : sol * SOL_USD) / 1000; } else {
    t.mcN = Math.max(2, t.mcN * (1 + dir * impact / 100));
    t.vol += sol * SOL_USD / 1000; }
    if (!real && t.prog < 100) { t.prog = Math.max(0, Math.min(100, t.prog + dir * sol * 0.25)); t.mcN = Math.max(t.mcN * .985, Math.min(t.mcN * 1.015, curveMc(t.prog))); if (t.prog >= 100) t.mcN = Math.max(t.mcN, 69); }
    if (real) { if (real.holders != null) t.holders = real.holders; } else if (side === 'buy' && Math.random() < 0.4) t.holders += 1;
    t.hist.push(t.mcN); if (t.hist.length > 160) t.hist.shift(); athOf(t);
    if (t.tk) { t.tk.push([real ? real.ts : Date.now(), t.mcN, sol]); if (t.tk.length > 5000) t.tk.splice(0, 500); }
    var tr = { tick: t.tick, side: side, sol: sol, wallet: wallet || pickWallet(), t: Date.now(), tax: sol * effTax(t) / 100, mine: !!mine, price: price(t), sig: b58(64) }; tr.tokens = sol * SOL_USD / tr.price;
    if (real) { tr.t = real.ts; tr.tokens = real.tokens; tr.tax = real.fee; tr.sig = real.sig; tr.sniper = real.sniper; tr.bundle = real.bundle; tr.real = true; if (real.usd != null) tr.usd = real.usd; tr.mine = !!(S.account && wallet === S.account); }
    S.trades.unshift(tr); if (S.trades.length > 400) { for (var ti = S.trades.length - 1; ti >= 0 && S.trades.length > 400; ti--) { var ox = S.trades[ti], ot = find(ox.tick); if (ox.mine || (ot && ot.creator && ox.wallet === ot.creator) || (ot && ot.devPct != null)) continue; S.trades.splice(ti, 1); } if (S.trades.length > 900) S.trades.pop(); }
    S.tradeCount++;
    paint(t, dir, tr);
    t._lt = Date.now();
    var cardEl = document.querySelector('.tcard[data-card="' + t.tick + '"]');
    if (cardEl) { cardEl.classList.remove('shake', 'shake-s'); void cardEl.offsetWidth; cardEl.classList.add(side === 'buy' ? 'shake' : 'shake-s'); if (S.sort === 'bump' && S.screen === 'home' && !cardEl.matches(':hover')) { var gp = cardEl.parentNode; if (gp && gp.firstChild !== cardEl) gp.insertBefore(cardEl, gp.firstChild); } }
    machineTrade(t, tr);
    if (S.screen === 'home') raceUpdate(t, side, sol);
    if (!wasGrad && t.prog >= 100) { machineGrad(t); if (!isMob() || (S.screen === 'token' && S.tick === t.tick)) toast('$' + t.tick + ' graduated to Meteora', t); if (S.screen === 'token' && S.tick === t.tick) confetti(); }
    return tr;
  }

  function paint(t, dir, tr) {
    var c = chg(t), cls = c >= 0 ? 'up' : 'down';
    q(attr('data-mc', t.tick)).forEach(function (el) { roll(el, fmtK(t.mcN), dir); });
    q(attr('data-price', t.tick)).forEach(function (el) { roll(el, fmtPrice(price(t)), dir); });
    q(attr('data-chg', t.tick)).forEach(function (el) { el.textContent = el.closest('.mr-r') ? (c >= 0 ? '↑ ' : '↓ ') + chgTxt(Math.abs(c)).replace('+', '') : chgTxt(c); el.className = 'chgpill ' + cls; var row = el.closest('.mrow'); if (row) { row.classList.toggle('up', c >= 0); row.classList.toggle('dn', c < 0); } });
    q(attr('data-chg2', t.tick)).forEach(function (el) { el.textContent = chgTxt(c); el.classList.remove('up', 'down'); el.classList.add(cls); });
    q(attr('data-chg3', t.tick)).forEach(function (el) { el.textContent = chgTxt(c); el.className = 'bc ' + cls; var b = el.parentNode; if (b) { b.classList.toggle('pos', c >= 0); b.classList.toggle('neg', c < 0); b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); } });
    q(attr('data-tape', t.tick)).forEach(function (el) { el.textContent = chgTxt(c); el.className = cls; });
    q(attr('data-spark', t.tick)).forEach(function (el) { el.setAttribute('points', spark(t)); el.setAttribute('stroke', c >= 0 ? '#3DDC97' : '#F2708A'); });
    q(attr('data-cchart', t.tick)).forEach(function (el) { el.innerHTML = cardChart(t); el.classList.toggle('up', c >= 0); el.classList.toggle('down', c < 0); });
    q(attr('data-prog', t.tick)).forEach(function (el) { el.textContent = Math.min(100, t.prog).toFixed(0) + '%'; });
    q(attr('data-bar', t.tick)).forEach(function (el) { el.style.width = Math.max(1, Math.min(100, t.prog)) + '%'; if (t.prog >= 100) el.classList.add('done'); });
    var st = document.getElementById('stat-trades'); if (st) st.textContent = fmtNum((S.seedN || 0) + S.tradeCount);
    var i2t = document.getElementById('i2-tr'); if (i2t) { i2t.textContent = fmtNum((S.seedN || 0) + S.tradeCount); i2t.classList.remove('tick'); void i2t.offsetWidth; i2t.classList.add('tick'); }
    var feed = document.getElementById('feed');
    if (feed) {
      if (feedOk(tr)) { var em = feed.querySelector('.muted'); if (em) em.remove(); feed.insertAdjacentHTML('afterbegin', feedRow(tr, true)); }
      while (feed.children.length > 6) feed.removeChild(feed.lastChild);
    }
    if (S.screen === 'home' && HERO.indexOf(t.tick) !== -1) {
      var ch = heroChart(t, 1000, 220), pr = pressure(t.tick);
      q(attr('data-hl', t.tick)).forEach(function (e) { e.setAttribute('d', ch.line); });
      q(attr('data-ha', t.tick)).forEach(function (e) { e.setAttribute('d', ch.area); });
      q(attr('data-press', t.tick)).forEach(function (e) { e.style.width = pr.toFixed(0) + '%'; });
      q(attr('data-pressk', t.tick)).forEach(function (e) { e.style.left = pr.toFixed(0) + '%'; });
      q(attr('data-presst', t.tick)).forEach(function (e) { e.textContent = pr.toFixed(0) + '%'; });
      q(attr('data-pressts', t.tick)).forEach(function (e) { e.textContent = (100 - pr).toFixed(0) + '%'; });
    }
    VB[VB.length - 1] += tr.sol; TB[TB.length - 1] += 1; updTiles();
    if (S.screen === 'token' && S.tick === t.tick) {
      var box = document.getElementById('chart');
      if (box) lwUpdate(t);
      tpNewTrade(tr, t);
      var ab = document.querySelector('[data-athbar="' + t.tick + '"]'); if (ab) { var athv = athOf(t); ab.style.width = (t.mcN / athv * 100).toFixed(1) + '%'; }
    }
  }

  function tickMarket() {
    if (S.loading || document.visibilityState !== 'visible') return;
    var a = all().filter(function (x) { return !x.live; }), t = a[Math.floor(Math.pow(Math.random(), 1.6) * a.length)];
    var momentum = chg(t) > 0 ? 0.56 : 0.5;
    var side = Math.random() < momentum ? 'buy' : 'sell';
    var sol = +(Math.pow(Math.random(), 2.2) * 5 + 0.03).toFixed(3);
    applyTrade(t, side, sol);
  }
  if (DEMO) setInterval(tickMarket, 1100);

  function newLaunch() {
    if (S.loading || document.visibilityState !== 'visible') return;
    var kind = pick(A.KINDS), name = pick(ADJ) + ' ' + NOUN[kind];
    var tick = (name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) + NOUN[kind].toUpperCase().slice(0, 2)).slice(0, 6);
    while (find(tick)) tick = tick.slice(0, 4) + B58[Math.floor(Math.random() * 24) + 9].toUpperCase();
    var mc = rnd(5, 12);
    var t = { name: name, tick: tick, spec: { kind: kind, skin: pick(A.SKINS), bg: pick(A.BGS), eyes: pick(A.EYES), mouth: pick(A.MOUTHS), acc: pick(A.ACCS) },
      buy: Math.floor(rnd(0, 4)), sell: Math.floor(rnd(0, 6)), pair: Math.random() < 0.25 ? pick(BASE).tick : pick(PAIRS), mcN: mc, mc0: mc, prog: rnd(1, 4), born: Date.now(), holders: 1 + Math.floor(rnd(0, 6)),
      soc: false, rewards: Math.random() < 0.3, burn: false, ca: fakeCA(), vol: rnd(0.5, 2), hist: [mc * 0.98, mc] };
    if (Math.random() < 0.5 || !S.trapSeen) { t.snipe = { on: true, start: pick([50, 80, 90]), dur: pick([20, 30, 45, 60]) }; S.trapSeen = true; }
    S.launched.unshift(t); if (S.launched.length > 20) S.launched.pop();
    var hl = document.getElementById('hlive-n'); if (hl) { hl.textContent = all().length; hl.classList.remove('tick'); void hl.offsetWidth; hl.classList.add('tick'); }
    if (!isMob()) toast('New launch: ' + name + ' $' + tick, t);
    machineLaunch(t);
    raceRefresh();
    var i2 = document.getElementById('i2-fresh'); if (i2) { i2.insertAdjacentHTML('afterbegin', i2Row(t)); i2.firstElementChild.classList.add('enter'); while (i2.children.length > 3) i2.removeChild(i2.lastChild); }
    if (S.screen === 'home' && S.sort === 'newest') {
      S.newTick = tick;
      var grid = document.getElementById('grid'), ok = filtered().indexOf(t) !== -1;
      if (grid && ok) grid.insertAdjacentHTML('afterbegin', card(t));
      var cnt = document.getElementById('count'); if (cnt) cnt.textContent = filtered().length + ' of ' + all().length + ' tokens';
      setTimeout(function () { if (S.newTick === tick) S.newTick = null; }, 2500);
    }
  }
  if (DEMO) (function loop() { setTimeout(function () { newLaunch(); loop(); }, rnd(14000, 24000)); })();

  setInterval(function () { q('[data-t]').forEach(function (el) { el.textContent = ago(+el.getAttribute('data-t')); }); }, 5000);

  // ================= EVENTS =================
  function openToken(tick) { var lt0 = find(tick); if (lt0 && lt0.live) liveLoad(lt0); S.cpan = 0; S.cys = 1; S.cyo = 0; var tA = S.archive[tick] && !all().some(function (x) { return x.tick === tick; }) ? S.archive[tick] : null, tfA = null;
    if (tA && tA.span) { var best = TFS[0]; TFS.forEach(function (x) { if (tA.span / x[2] >= 40) best = x; }); tfA = best[0]; var bA = best[2]; S.czoom = Math.max(20, Math.min(120, Math.ceil(tA.span / bA) + 6)); S.cpan = Math.max(0, Math.floor(Date.now() / bA) - Math.floor((tA.born + tA.span) / bA) - 3); }
    set({ walletView: null, screen: 'token', tick: tick, side: 'buy', amount: '', tf: tfA || S.tf || '1M', tpTab: 'trades', palOpen: false, walletMenu: false }); window.scrollTo(0, 0); }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (S.fpop && !e.target.closest('.fdrop')) { S.fpop = null; if (!el) { render(); return; } }
    if (S.walletMenu && !e.target.closest('.wpill') && !e.target.closest('.wbal') && !(el && /airdrop|refresh|copyAddr|disconnect/.test(el.getAttribute('data-act')))) { S.walletMenu = false; if (!el) { render(); return; } }
    if (S.coMenu && !e.target.closest('.co-mw')) { S.coMenu = null; if (!el) { render(); return; } }
    if (!el) return;
    var act = el.getAttribute('data-act'), arg = el.getAttribute('data-arg');
    if (/^(home|create|leaders|trendList|burnPage|watchPage|open|coPage|lbCo)$/.test(act) || (el.closest('.mnav') && act !== 'coToggle')) { S.coOpen = false; S.walletView = null; S.hmap = null; S.share = null; S.walletMenu = false; S.palOpen = false; S.coModal = null; S.burnOpen = false; S.mFilt = false; pvClose && pvClose(); }   // going somewhere closes every panel and sheet
    if (el.tagName === 'A' && act !== 'how' && act !== 'dlArm' && act !== 'dlTapGo') e.preventDefault();
    switch (act) {
      case 'bg': if (e.target === el) set({ walletOpen: false, palOpen: false, walletView: null }); break;
      case 'railHide': S.railHidden = true; S.railNew = 0; try { localStorage.setItem('dl.rail', '0'); } catch (er) {} render(); break;
      case 'railShow': S.railHidden = false; S.railNew = 0; try { localStorage.setItem('dl.rail', '1'); } catch (er) {} render(); break;
      case 'coPeekMute': e.stopPropagation(); S.coPeekMute = true; try { localStorage.setItem('dl.copeek', '0'); } catch (er) {} var pk = el.closest('.co-peek'); if (pk) pk.remove(); toast('Callout pop-ups muted — open 🔥 Callouts anytime'); return;
      case 'palClose': set({ palOpen: false }); break;
      case 'home': set({ screen: 'home', palOpen: false }); window.scrollTo(0, 0); break;
      case 'create': set({ screen: 'create', palOpen: false }); window.scrollTo(0, 0); break;
      case 'how':
        e.preventDefault();
        if (S.screen !== 'home') set({ screen: 'home' });
        setTimeout(function () { var h = document.getElementById('machine'); if (h) h.scrollIntoView({ behavior: 'smooth' }); }, 30); break;
      case 'open': openToken(arg); break;
      case 'palette': set({ palOpen: true, palQ: '', palIdx: 0 }); break;
      case 'star':
        var on = S.watch.indexOf(arg) !== -1;
        S.watch = on ? S.watch.filter(function (x) { return x !== arg; }) : S.watch.concat([arg]);
        try { localStorage.setItem(LS.watch, JSON.stringify(S.watch)); } catch (er) {}
        render(); toast(on ? 'Removed $' + arg + ' from watchlist' : 'Added $' + arg + ' to watchlist', find(arg)); break;
      case 'ca': var tk = find(arg); if (tk) copy(tk.ca, 'Contract address copied'); break;
      case 'copyAddr': copy(S.account, 'Address copied'); break;
      case 'social': toast('Links are added by the creator at launch'); break;
      case 'sort': set({ sort: arg }); break;
      case 'pair': set({ pair: arg }); break;
      case 'toggle': var o = {}; o[arg] = !S[arg]; set(o); break;
      case 'reset': S.r = JSON.parse(JSON.stringify(RDEF)); S.pairQ = ''; S.pairTab = 'all'; set({ fpop: null, cleanOnly: false, maxTax: 10, minProg: 0, minMc: 0, pair: 'All', cat: 'all', zeroOnly: false, gradOnly: false, rewardsOnly: false, watchOnly: false }); break;
      case 'tf': S.cpan = 0; S.cys = 1; S.cyo = 0; var tA2 = find(S.tick); if (tA2 && tA2.archived && tA2.span) { var bA2 = TFS.filter(function (x) { return x[0] === arg; })[0][2]; S.cpan = Math.max(0, Math.floor(Date.now() / bA2) - Math.floor((tA2.born + tA2.span) / bA2) - 3); } set({ tf: arg }); break;
      case 'ctype': set({ ctype: arg }); break;
      case 'ctog': S[arg] = !S[arg]; try { localStorage.setItem('dl.cmarks', JSON.stringify([S.cmarks, S.ccall, S.cma, S.cvol])); } catch (er) {} render(); break;
      case 'cclean': var allOff = !S.cmarks && !S.ccall; if (allOff) { S.cmarks = S._cm0 != null ? S._cm0 : true; S.ccall = S._cc0 != null ? S._cc0 : true; } else { S._cm0 = S.cmarks; S._cc0 = S.ccall; S.cmarks = false; S.ccall = false; } try { localStorage.setItem('dl.cmarks', JSON.stringify([S.cmarks, S.ccall, S.cma, S.cvol])); } catch (er) {} render(); break;
      case 'cfull': set({ cfull: !S.cfull }); break;
      case 'ttab': S.ttab = arg; try { localStorage.setItem('dl.ttab', arg); } catch (e) {} render(); break;
      case 'ttNew': var tl = document.getElementById('cmts'); if (tl) tl.scrollTo({ top: 0, behavior: 'smooth' }); var npb = document.getElementById('tt-new'); if (npb) { npb._n = 0; npb.style.display = 'none'; } break;
      case 'bhPer': S.bhPer = arg; render(); break;
      case 'cauto': if (LW.chart) LW.chart.priceScale('right').applyOptions({ autoScale: true }); break;
      case 'lwMk': lwMkClick(arg); break;
      case 'cnow': if (LW.chart) LW.chart.timeScale().scrollToRealTime(); break;
      case 'czoom': if (LW.chart) { LW.chart.timeScale().applyOptions({ barSpacing: 9 }); LW.chart.timeScale().scrollToRealTime(); LW.chart.priceScale('right').applyOptions({ autoScale: true }); } break;
      case 'cden': S.cden = arg === 'sol' ? 'sol' : 'usd'; cviewSave(); render(); break;
      case 'cscale': S.cscale = S.cscale === +arg ? 0 : +arg; cviewSave(); render(); break;
      case 'tpTab': set({ tpTab: arg }); break;
      case 'descToggle': S.descOpen = !S.descOpen; render(); break;
      case 'hmap': S.bubSel = null; S.bubV = { x: 0, y: 0, k: 1 }; S.bubL = null; var tH = find(arg); S.hmap = arg; if (tH) bubLoad(tH); render(); break;
      case 'bubSel': S.bubSel = S.bubSel === arg ? null : arg; render(); break;
      case 'bubList': S.bubList = !S.bubList; render(); break;
      case 'bubLinks': S.bubLinks = !S.bubLinks; render(); break;
      case 'bubFit': S.bubV = S.bubFitV ? { k: S.bubFitV.k, x: S.bubFitV.x, y: S.bubFitV.y } : { x: 0, y: 0, k: 1 }; S.bubSel = null; render(); break;
      case 'devPing': devPing(find(arg)); toast('✋ Check-in signed — activity timer reset'); render(); break;
      case 'devClaim': (function () { var t = find(arg), d = t && devStatus(t); if (!d || d.state !== 'active' || d.claimable < .01) return; S.claimed[t.tick] = (S.claimed[t.tick] || 0) + d.claimable; devPing(t); drSave(); toast('Claimed $' + fmtNum(Math.round(d.claimable)) + ' creator rewards'); render(); })(); break;
      case 'ctoOpen': set({ ctoOpen: arg }); break;
      case 'ctoClose': if (el.classList.contains('hm-ov') && e.target.closest('[data-stop]')) break; set({ ctoOpen: null }); break;
      case 'ctoApply': (function () { var t = find(S.ctoOpen); if (!t || !S.account) return; var g = function (i) { var x = document.getElementById(i); return x ? x.value.trim() : ''; };
        S.cto[t.tick] = { lead: S.account, x: g('cto-x'), tg: g('cto-tg'), plan: g('cto-plan') || 'Rebuilding the community', support: (position(t) ? position(t).tok / 1e9 * 100 : 0), at: Date.now(), approved: false, backed: true }; var cc = S.cto[t.tick]; if (cc.support >= DR.ctoNeed) cc.approved = true; drSave(); S.ctoOpen = null; toast(cc.approved ? '🎉 Takeover approved — your bag alone covers ' + DR.ctoNeed + '% support' : 'Takeover submitted — holders can now back it'); render(); })(); break;
      case 'ctoBack': (function () { var t = find(arg), c = S.cto[arg]; if (!c) return; if (!S.account) { set({ walletOpen: true }); return; } var add = position(t) ? position(t).tok / 1e9 * 100 : 0; if (!add) { toast('Hold some $' + arg + ' to back a takeover'); return; } c.support += add; c.backed = true; if (c.support >= DR.ctoNeed) { c.approved = true; c.at = Date.now(); toast('🎉 Takeover approved — $' + arg + ' is now community-run'); } else toast('Backed with ' + add.toFixed(2) + '% of supply'); drSave(); render(); })(); break;
      case 'burnOpen': set({ burnOpen: true, burnTick: arg || S.burnTick, burnPct: S.burnPct || 25 }); break;
      case 'burnClose': if (el.classList.contains('hm-ov') && e.target.closest('[data-stop]')) break; set({ burnOpen: false }); break;
      case 'burnPick': set({ burnTick: arg }); break;
      case 'burnPreset': set({ burnPct: +arg }); break;
      case 'burnGo': (function () { var t = find(S.burnTick), pos = t && position(t); if (!pos) return; var tok = pos.tok * (S.burnPct || 25) / 100;
        if (t.live) { S.burnOpen = false; render();
          chainRun('Burning $' + t.tick, function (T) { return T.buildBurn({ rpc: RPC, owner: S.account, mint: t.ca, amount: tok }); }).then(function (b) {
            toast('🔥 Burned ' + fmtNum(Math.round(b.tokens)) + ' $' + t.tick + ' — gone forever', t); livePos(t);
            return fetch(API + '/api/burned', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sig: b.sigs[b.sigs.length - 1] }) }).then(function () { burnsLoad(); });
          }).catch(function (e) { if (e && e.message !== 'busy') toast('Burn failed: ' + chainErr(e)); });
          return; } S.pos[t.tick].tok -= tok; if (S.pos[t.tick].tok < 1) delete S.pos[t.tick];
        var b = { t: t, tok: tok, pct: tok / 1e9 * 100, usd: tok * price(t), at: Date.now(), src: 'dev', who: S.account, sig: b58(64), mine: true, fresh: true }; S.myBurns = S.myBurns || []; S.myBurns.push({ tick: t.tick, tok: tok, usd: b.usd, at: b.at, who: S.account, sig: b.sig }); try { localStorage.setItem('dl.myburns', JSON.stringify(S.myBurns)); } catch (er) {} S._burns = null; S._bnAgg = null;
        S.burnOpen = false; S._bnAgg = null; toast('🔥 Burned ' + fmtNum(Math.round(tok)) + ' $' + t.tick + ' — gone forever'); if (S.screen === 'burn') { render(); setTimeout(function () { var fl = document.getElementById('bn-fly'); if (fl) { var r = fl.getBoundingClientRect(); bnImpact(b, r.width / 2, r.height * .74); } }, 400); } else render(); })(); break;
      case 'hmapClose': if (el.classList.contains('hm-ov') && e.target.closest('[data-stop]')) break; set({ hmap: null }); break;
      case 'side': set({ side: arg }); break;
      case 'terms': e.preventDefault && e.preventDefault(); set({ termsOpen: true }); break;
      case 'termsClose': if (e.target.closest('[data-stop]') && !e.target.closest('.iconbtn')) break; set({ termsOpen: false }); break;
      case 'paySol': S.amount = ''; set({ paySol: arg === '1' }); break;
      case 'preset': if (arg === 'reset') { set({ amount: '' }); break; } set({ pctAmt: 0, amount: arg === 'max' ? Math.max(0, S.balance - 0.01).toFixed(3) : arg }); break;
      case 'dlConnect': dlConnect(arg); break;
      case 'dlTapGo': setTimeout(function () { S.dlTap = null; render(); }, 600); break;
      case 'dlTapX': { var stx = dlGet(); if (stx) { stx.pend = null; dlPut(stx); } S.dlTap = null; S.busy = null; render(); break; }
      case 'dlArm': if (S.dlPre[arg]) dlPut(S.dlPre[arg].st); S.dlPre = {}; break;   // the link itself opens the wallet
      case 'openWallet': set({ walletOpen: true }); break;
      case 'closeWallet': set({ walletOpen: false }); break;
      case 'walletMenu': set({ walletMenu: !S.walletMenu }); break;
      case 'pickWallet': var w = S.wallets.filter(function (x) { return x.name === arg; })[0]; if (w) connect(w, false); break;
      case 'disconnect': disconnect(); break;
      case 'airdrop': airdrop(); break;
      case 'refresh': refreshBalance(); if (S.account && S.wprof[S.account]) S.wprof[S.account].at = 0; toast('Balance refreshed'); break;
      case 'spec': var k = el.getAttribute('data-k'), spc = {}; for (var x in S.c.spec) spc[x] = S.c.spec[x]; spc[k] = arg; setC({ spec: spc }); break;
      case 'randomLogo': setC({ img: null, spec: { kind: pick(A.KINDS), skin: pick(A.SKINS), bg: pick(A.BGS), eyes: pick(A.EYES), mouth: pick(A.MOUTHS), acc: pick(A.ACCS) } }); break;
      case 'clearImg': setC({ img: null }); break;
      case 'clearBanner': setC({ banner: null }); break;
      case 'cpair': setC({ pair: arg }); break;
      case 'burnPage': burnsLoad(); set({ screen: 'burn', palOpen: false, coOpen: false }); window.scrollTo(0, 0); break;
      case 'lsort': if (S.lsort === arg) S.ldir = -S.ldir; else { S.lsort = arg; S.ldir = -1; } render(); break;
      case 'trendList': S.lsort = 'rank'; S.ldir = -1; set({ screen: 'trend', palOpen: false, coOpen: false }); window.scrollTo(0, 0); break;
      case 'bsort': S.bsort = arg; render(); break;
      case 'tcat': S.tcat = arg; render(); break;
      case 'tpreset': S.lsort = arg; S.ldir = -1; render(); break;
      case 'fxpGo': FXP.hold = Date.now() + 9000; fxpShow(+arg); break;
      case 'siteShow': S.siteShare = arg; S.siteTh = 'dark'; render(); break;
      case 'siteClose': S.siteShare = null; render(); break;
      case 'siteTh': S.siteTh = arg; render(); break;
      case 'siteCopy': var tsc = find(S.siteShare); if (tsc) copy(siteUrl(tsc, S.siteTh), 'Website link copied'); break;
      case 'siteOpen': var tso = find(S.siteShare); S.siteShare = null; if (tso) set({ screen: 'site', site: { tick: tso.tick, th: S.siteTh || 'dark' } }); window.scrollTo(0, 0); break;
      case 'mFilt': S.mFilt = !S.mFilt; render(); break;
      case 'mSide': S.side = arg; render(); setTimeout(function () { var tb = document.querySelector('.tradebox'); if (tb) tb.scrollIntoView({ behavior: 'smooth', block: 'start' }); var inp = document.getElementById('amt'); if (inp) setTimeout(function () { inp.focus({ preventScroll: true }); }, 450); }, 30); break;
      case 'mBuy': var tbx = document.querySelector('.tradebox'); if (tbx) tbx.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
      case 'stf': S.stf = arg; render(); break;
      case 'fwGo': fwCenter(FW.hi === +arg ? -1 : +arg); break;
      case 'demoImgs': set({ demoImgOpen: true }); break;
      case 'realMemes': try { localStorage.setItem('dl.realmemes', REAL_ON ? '0' : '1'); } catch (er) {} location.reload(); break;
      case 'demoImgsClose': if (e.target === el || el.tagName === 'BUTTON') set({ demoImgOpen: false }); break;
      case 'demoImgsReset': BASE.forEach(function (t) { if (DIMG[t.tick]) delete t.img; }); DIMG = {}; try { localStorage.removeItem('dl.demoimgs'); } catch (er) {} render(); break;
      case 'devbuy': setC({ devBuy: arg === '0' ? '' : arg }); break;
      case 'ctax': setC(+arg > 0 ? { buy: +arg, sell: +arg } : { buy: 0, sell: 0 }); break;
      case 'qpick': qSelect(arg); break;
      case 'qTab': S.qTab = arg; render(); break;
      case 'qPre': qPreset(arg); break;
      case 'vanMode': S.c.van = S.c.van || { mode: 'treid', suf: '' }; S.c.van.mode = arg; render(); setTimeout(function () { var vi = document.getElementById('van-suf'); if (vi) vi.focus(); }, 30); break;
      case 'rwPick': S.rwq = ''; rwSelect(arg); break;
      case 'rwPre': S.rwq = ''; rwPreset(arg); break;
      case 'rwTab': S.rwTab = arg; render(); break;
      case 'spPre': var sp1 = S.c.split || {}; if (arg === 'custom') setC({ split: { p: 'custom', h: sp1.h || 70, b: sp1.b || 20, d: sp1.d || 10 } }); else { var pp = SPRE[arg]; setC({ split: { p: arg, h: pp[2], b: pp[3], d: pp[4] } }); } break;
      case 'snipeStart': var sn1 = S.c.snipe; sn1.start = +arg; setC({ snipe: sn1 }); break;
      case 'snipeDur': var sn2 = S.c.snipe; sn2.dur = +arg; setC({ snipe: sn2 }); break;
      case 'cpairPick': S.cpq = ''; setC({ pair: arg }); break;
      case 'cpTab': S.cpTab = arg; render(); break;
      case 'cpairCA': var cid = arg.slice(0, 4) + '…' + arg.slice(-4); PAIR_INFO[cid] = { name: 'Custom token', cat: 'crypto', g: '?', c: '#4A4A4F', ca: arg };
        try { var cpS = JSON.parse(localStorage.getItem('dl.cpairs') || '{}'); cpS[cid] = PAIR_INFO[cid]; localStorage.setItem('dl.cpairs', JSON.stringify(cpS)); } catch (er) {}
        S.cpq = ''; setC({ pair: cid }); toast('Paired with contract ' + cid); break;
      case 'cat': set({ cat: arg, pair: 'All' }); break;
      case 'fpop': set({ fpop: S.fpop === arg ? null : arg }); break;
      case 'ptab': S.pairTab = arg; render(); break;
      case 'ppick': set({ pair: S.pair === arg ? 'All' : arg, cat: S.pair === arg ? 'all' : pairInfo(arg).cat, fpop: null }); break;
      case 'pcat': set({ cat: arg, pair: 'All', fpop: null }); break;
      case 'ppickL': set({ pair: S.pair === arg ? 'All' : arg, fpop: null }); break;
      case 'launchPair': set({ screen: 'create', palOpen: false }); window.scrollTo(0, 0); setTimeout(function () { if (arg === 'SOL') return; try { qPreset(arg); } catch (er) {} }, 50); break;
      case 'ppick2': S.pairQ = ''; set({ pair: arg, cat: pairInfo(arg).cat, fpop: null }); break;
      case 'pclear': set({ cat: 'all', pair: 'All', fpop: null, pairTab: 'all', pairQ: '' }); break;
      case 'rpre': var rq = arg.split('|'); S.r[rq[0]] = [+rq[1], +rq[2]]; render(); break;
      case 'rz': var dd = stageWH(); if (dd) zoomAt(dd.w / 2, dd.h / 2, arg === 'in' ? 1.6 : 1 / 1.6, true); break;
      case 'rzp': zoomPreset(arg); break;
      case 'rtab': S.raceTab = arg; S.raceAll = false; var rs = document.getElementById('race'); if (rs) rs.outerHTML = raceSection(); break;
      case 'viz': S.viz = arg; try { localStorage.setItem('dl.viz', arg); } catch (er) {} LAB.hist = {}; LAB.stage = null; render(); break;
      case 'rsort': S.raceSort = arg; document.querySelectorAll('[data-act=rsort]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-arg') === arg); }); raceRefresh(); break;
      case 'rall': S.raceAll = !S.raceAll; var rs2 = document.getElementById('race'); if (rs2) rs2.outerHTML = raceSection(); break;
      case 'rzat': var za = arg.split('|'), dz = stageWH(); if (dz) { var px0 = +za[0] / 100 * dz.w * RZ.z + RZ.x, py0 = +za[1] / 100 * dz.h * RZ.z + RZ.y; zoomAt(px0, py0, 2.6, true); } break;
      case 'soc': var sp0 = arg.split('|'), st0 = find(sp0[0]), so0 = st0 && socialsOf(st0), u0 = so0 && so0[sp0[1]];
        if (so0 && !so0.demo && u0) window.open(u0, '_blank', 'noopener'); else toast('Demo coin — its ' + ({ web: 'website', x: 'X account', tg: 'Telegram' })[sp0[1]] + ' opens here once real coins go live', st0); break;
      case 'quick': var qq0 = QUICK.filter(function (x) { return x[0] === arg; })[0]; if (qq0 && qq0[2]) set({ cat: pairInfo(qq0[2]).cat, pair: qq0[2], view: 'grid' }); else set({ cat: arg, pair: 'All', view: 'grid' }); setTimeout(function () { var bd = document.getElementById('board'); if (bd) bd.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); break;
      case 'board': var bd0 = document.getElementById('board'); if (bd0) bd0.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'feedf': S.feedF = arg; render(); break;
      case 'leaders': lbLoad(); set({ screen: 'leaders', palOpen: false }); window.scrollTo(0, 0); break;
      case 'watchPage': set({ screen: 'watch', palOpen: false }); window.scrollTo(0, 0); break;
      case 'unstar':
        var row = document.querySelector('.wl-row[data-wl="' + arg + '"]');
        var doUn = function () { S.watch = S.watch.filter(function (x) { return x !== arg; }); try { localStorage.setItem(LS.watch, JSON.stringify(S.watch)); } catch (er) {} render(); };
        if (row) { row.classList.add('bye'); setTimeout(doUn, 320); } else doUn();
        toast('Removed $' + arg + ' from watchlist', find(arg)); break;
      case 'wlClear': if (!S.wlConfirm) { set({ wlConfirm: true }); setTimeout(function () { if (S.wlConfirm) set({ wlConfirm: false }); }, 3000); break; }
        S.watch = []; S.wlConfirm = false; try { localStorage.setItem(LS.watch, '[]'); } catch (er) {} render(); toast('Watchlist cleared'); break;
      case 'lbtab': set({ lbTab: arg }); break;
      case 'lbAll': S.lbAll = true; render(); break;
      case 'lbOpen': S.lbOpen = S.lbOpen === arg ? null : arg; render(); break;
      case 'lbCoPer': set({ lbCoPer: arg }); break;
      case 'lbCo': var lp = String(arg).split('|'), lt = find(lp[0]), lc = lt && (S.comments[lt.tick] || []).filter(function (c) { return String(c.id) === lp[1]; })[0]; if (lt && lc && lc.real) set({ screen: 'callout', coView: { tick: lt.tick, id: lc.id } }); else if (lt) { openToken(lt.tick); set({ tpTab: 'thread' }); } break;
      case 'lbper': set({ lbPer: arg }); break;
      case 'walletAny': S.hmap = null;
      case 'walletAnyX': S.tick = (S.trades.filter(function (x) { return x.wallet === arg; })[0] || {}).tick || S.tick; set({ walletView: arg }); break;
      case 'wallet': set({ walletView: arg, walletMenu: false }); break;
      case 'closeW': set({ walletView: null }); break;
      case 'wTab': set({ wTab: arg }); break;
      case 'rwOpen': rwLoad(); set({ walletMenu: true, wbTab: 'rewards' }); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'wbTab': if (arg === 'rewards') rwLoad(); set({ wbTab: arg }); break;
      case 'wbDeposit': S.wbDep = !S.wbDep; render(); break;
      case 'copyW': copy(arg, 'Wallet address copied'); break;
      case 'trackW': var ti = S.trackWallets.indexOf(arg); if (ti === -1) S.trackWallets.push(arg); else S.trackWallets.splice(ti, 1); try { localStorage.setItem('gp.track', JSON.stringify(S.trackWallets)); } catch (er) {} render(); toast(ti === -1 ? 'Tracking ' + walletName(arg) : 'Stopped tracking'); break;
      case 'tpf': set({ tpFilter: arg, tpQueue: 0 }); break;
      case 'maker': set({ tpMaker: arg || null, tpTab: 'trades', tpQueue: 0, walletView: null }); break;
      case 'abs': set({ absTime: !S.absTime }); break;
      case 'resume': set({ tpQueue: 0 }); break;
      case 'tx': copy(arg, DEMO ? 'Transaction id copied (simulated)' : 'Transaction id copied'); break;
      case 'cmode': S.chartMode = arg === 'price' ? 'price' : 'mc'; cviewSave(); render(); break;
      case 'slip': set({ slipOpen: !S.slipOpen }); break;
      case 'setslip': set({ slip: +arg, slipOpen: false }); break;
      case 'share': copy(location.href.split('#')[0] + '#' + (S.tick || ''), 'Link copied'); break;
      case 'sellpct': var tp0 = find(S.tick), ps0 = tp0 && S.pos[tp0.tick]; if (ps0) set({ side: 'sell', amount: (ps0.tok * (+arg) / 100).toFixed(0) }); break;
      case 'sellall': var tp1 = find(S.tick), ps1 = tp1 && S.pos[tp1.tick]; if (ps1) set({ side: 'sell', amount: String(Math.floor(ps1.tok)), sellAll: true }); break;
      case 'coImgDel': S.coImg = null; render(); break;
      case 'coNew': S.coModal = { upd: false }; S.replyTo = null; S.coErr = ''; S.tick = S.tick || arg; render(); setTimeout(function () { var x = document.getElementById('cmt-in'); if (x) x.focus(); }, 30); break;
      case 'coUpdate': S.coModal = { upd: true }; S.replyTo = +arg; S.coErr = ''; render(); setTimeout(function () { var x = document.getElementById('cmt-in'); if (x) x.focus(); }, 30); break;
      case 'coCancel': S.coModal = null; S.coCompose = false; S.replyTo = null; S.coErr = ''; S.coImg = null; render(); break;
      case 'coPage': var cp = arg.split('|'); S.coModal = null; S.tick = cp[0]; set({ screen: 'callout', coView: { tick: cp[0], id: +cp[1] } }); window.scrollTo(0, 0); break;
      case 'coShareDl': var cvs = document.getElementById('co-share'); if (cvs) { var a = document.createElement('a'); a.href = cvs.toDataURL('image/png'); a.download = 'treid-callout-' + (S.coView ? S.coView.tick + '-' + S.coView.id : 'card') + '.png'; document.body.appendChild(a); a.click(); a.remove(); } break;
      case 'coShareLink': copy(location.href, 'Link copied'); break;
      case 'coBack': set({ screen: 'token' }); break;
      case 'coTipOff': S.coTipOff = true; try { localStorage.setItem('dl.coTipOff', '1'); } catch (er) {} render(); break;
      case 'coUpMore': S.coUpAll = S.coUpAll || {}; S.coUpAll[arg] = 1; render(); break;
      case 'coTrades': if (S.coTrOpen === arg) { S.coTrOpen = null; render(); break; } S.coTrOpen = arg; S.coTr = S.coTr || {}; render();
        (function (k) { var f = coFind(k); if (!f || !API) return; apiGet('/api/mytrades?mint=' + f.t.ca + '&wallet=' + f.c.w).then(function (L) { S.coTr[k] = Array.isArray(L) ? L : []; render(); }).catch(function () { S.coTr[k] = []; render(); }); })(arg); break;
      case 'coToggle': S.mCo = 0; set({ coOpen: !S.coOpen, coQueue: 0 }); break;
      case 'coClose': set({ coOpen: false }); break;
      case 'coPause': S.coPaused = !S.coPaused; if (!S.coPaused) S.coQueue = 0; render(); break;
      case 'coFilter': S.coF = arg; render(); break;
      case 'coFollow': if (S.follow[arg]) delete S.follow[arg]; else S.follow[arg] = 1; try { localStorage.setItem('dl.follow', JSON.stringify(S.follow)); } catch (er) {} toast(S.follow[arg] ? 'Following ' + coName(arg) : 'Unfollowed ' + coName(arg)); render(); break;
      case 'coMenu': S.coMenu = S.coMenu === arg ? null : arg; render(); break;
      case 'coExpand': S.coExp[arg] = 1; render(); break;
      case 'coLike': var cx = coFind(arg); if (cx) { cx.c.liked = !cx.c.liked; cx.c.likes = (cx.c.likes || 0) + (cx.c.liked ? 1 : -1); render(); } break;
      case 'coRT': var cr = coFind(arg); if (cr) { cr.c.rtd = !cr.c.rtd; cr.c.rt = (cr.c.rt || 0) + (cr.c.rtd ? 1 : -1); toast(cr.c.rtd ? 'Reposted' : 'Repost removed'); render(); } break;
      case 'coShare': S.coMenu = null; var shp = arg.split('|'); shareOpen(shp[0], +shp[1], 'callout'); break;
      case 'shPos': shareOpen(arg, null, 'profit'); break;
      case 'shClose': S.share = null; render(); break;
      case 'shMode': S.share.mode = arg; render(); break;
      case 'shChart': S.share.chart = !S.share.chart; render(); break;
      case 'shBg': S.share.bg = arg === 'coin' || arg === 'custom' ? arg : +arg; render(); break;
      case 'shSave': var shc = document.getElementById('sh-cv'); if (shc) { try { var sha = document.createElement('a'); sha.href = shc.toDataURL('image/png'); sha.download = 'treid-' + S.share.tick + '-' + S.share.mode + '.png'; sha.click(); } catch (er) { S.share.noImg = true; render(); setTimeout(function () { toast('Coin art can\'t be exported from this image host — saved without it. Press Save again.'); }, 50); } } break;
      case 'shLink': var sht = find(S.share.tick); copy(location.href.split('#')[0] + (S.share.id != null && sht ? '#/callout/' + encodeURIComponent(sht.live ? sht.ca : sht.tick) + '/' + S.share.id : sht ? '#/coin/' + encodeURIComponent(sht.live ? sht.ca : sht.tick) : ''), 'Link copied'); break;
      case 'coCopy': var cc = coFind(arg); S.coMenu = null; if (cc) copy(cc.c.text, 'Text copied'); render(); break;
      case 'coMute': S.muted[arg] = 1; S.coMenu = null; toast('Muted ' + coName(arg)); render(); break;
      case 'coReport': S.coMenu = null; toast('Thanks — reported for review'); render(); break;
      case 'coReply': var cp = arg.split('|'); if (S.screen !== 'token' || S.tick !== cp[0]) openToken(cp[0]); S.coOpen = false; set({ replyTo: +cp[1] }); setTimeout(function () { var ci = document.getElementById('cmt-in'); if (ci) ci.focus(); else toast('Connect a wallet to reply'); }, 60); break;
      case 'like': var cl = (S.comments[S.tick] || [])[+arg]; if (cl) { cl.liked = !cl.liked; cl.likes += cl.liked ? 1 : -1; render(); } break;
      case 'replyTo': set({ replyTo: +arg }); setTimeout(function () { var ci = document.getElementById('cmt-in'); if (ci) ci.focus(); }, 20); break;
      case 'cpPost': S.replyTo = +arg;   // update from the callout page → same posting path
      // falls through
      case 'post':
        var txt = (S.cmtDraft || '').trim(); if (!txt && !S.coImg) { toast('Write something first'); break; }
        var tp0 = find(S.tick); if (tp0 && tp0.live) {
          if (!S.account || !S.wallet) { set({ walletOpen: true }); break; }
          var txC = coClean(txt), rpC = S.replyTo != null ? S.replyTo : null, imgC = S.coImg || null;
          if (S.busy) break; S.busy = 'Posting'; render();
          var sendCo = function (tok) { return fetch(API + '/api/callout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: tp0.ca, session: tok, reply: rpC, text: txC, image: imgC }) }).then(function (x) { return x.json(); }); };
          getSession().then(sendCo).then(function (j) { if (j && !j.ok && /sign in again/.test(j.error || '')) { dropSession(); return getSession().then(sendCo); } return j; })   // signed in once per day — no wallet popup per callout
            .then(function (j) { S.busy = null; if (!j || !j.ok) throw new Error((j && j.error) || 'posting failed'); coMerge([j.callout]); devPing(tp0); S.coImg = null; S.coCompose = false; S.coModal = null; S.coErr = ''; set({ cmtDraft: '', replyTo: null }); toast('Callout posted ✓'); setTimeout(refreshCallouts, 1500); })
            .catch(function (e) { S.busy = null; S.coErr = chainErr(e); render(); toast(S.coErr); });   // the error stays visible under the composer
          break; }
        var cms = seedComments(find(S.tick)); cms.push({ id: cms.length, w: S.account, text: txt, t: Date.now(), likes: 0, liked: false, reply: S.replyTo != null ? S.replyTo : null });
        devPing(find(S.tick)); set({ cmtDraft: '', replyTo: null }); toast('Callout posted'); break;
      case 'pairOpen': set({ cat: pairInfo(arg).cat, pair: arg }); setTimeout(function () { var g = document.getElementById('grid') || document.getElementById('bubbles'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); break;
      case 'hero': heroGo(S.heroIdx + (+arg)); break;
      case 'heroGo': heroGo(+arg); break;
      case 'view': set({ view: arg }); break;
      case 'swipe': flyOut(arg); break;
      case 'mstep': for (var mi = 0; mi < MSTEPS.length; mi++) { if (MSTEPS[mi][0] === arg) { M.paused = 5000; mSetStep(mi); break; } } break;
      case 'devHere': var th = find(arg); if (!th || !S.wallet) break; var fsm = S.wallet.features['solana:signMessage'];
        if (!fsm) { toast('This wallet can’t sign messages — try Phantom or Solflare'); break; }
        var tsH = Date.now(), msgH = 'treid: I\'m still here \u2014 ' + th.ca + ' \u2014 ' + tsH;   // must match indexer/rewards.mjs pingMessage
        Promise.resolve(fsm.signMessage({ account: S.walletAcc, message: new TextEncoder().encode(siteMsg(msgH)) })).then(function (r) { var sg = (Array.isArray(r) ? r[0] : r).signature; return chainLib().then(function (T) { return fetch(API + '/api/ping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: th.ca, wallet: S.account, ts: tsH, sig: T.b58(sg) }) }).then(function (x) { return x.json(); }); }); })
          .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || 'check-in failed'); toast('Checked in ✓ — your activity timer is reset', th); setTimeout(function () { liveLoad(th); }, 2500); })
          .catch(function (e) { toast(chainErr(e)); });
        break;
      case 'ctoForm': S.ctoForm = arg; render(); setTimeout(function () { var ta = document.getElementById('cto-plan'); if (ta) ta.focus(); }, 30); break;
      case 'ctoFormX': S.ctoForm = null; render(); break;
      case 'ctoApply': case 'ctoVote': (function (act) {
        var parts = String(arg).split('|'), tk = find(parts[0]); if (!tk || !S.wallet) return; var fsg = S.wallet.features['solana:signMessage'];
        if (!fsg) { toast('This wallet can’t sign messages — try Phantom or Solflare'); return; }
        var ts0 = Date.now(), plan = act === 'ctoApply' ? ((document.getElementById('cto-plan') || {}).value || '').replace(/["\\\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240) : '';
        if (act === 'ctoApply' && plan.length < 10) { toast('Write a short plan (10+ characters)'); return; }
        var msg = act === 'ctoApply' ? 'treid: lead takeover — ' + tk.ca + ' — ' + ts0 + '\n' + plan : 'treid: support takeover by ' + parts[1] + ' — ' + tk.ca + ' — ' + ts0;   // must match indexer/rewards.mjs
        Promise.resolve(fsg.signMessage({ account: S.walletAcc, message: new TextEncoder().encode(siteMsg(msg)) })).then(function (r) { var sg = (Array.isArray(r) ? r[0] : r).signature; return chainLib().then(function (T) {
          var body = act === 'ctoApply' ? { mint: tk.ca, wallet: S.account, ts: ts0, sig: T.b58(sg), plan: plan } : { mint: tk.ca, applicant: parts[1], wallet: S.account, ts: ts0, sig: T.b58(sg) };
          return fetch(API + '/api/cto/' + (act === 'ctoApply' ? 'apply' : 'vote'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (x) { return x.json(); }); }); })
          .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || 'failed'); S.ctoForm = null; toast(act === 'ctoApply' ? 'Application sent ✓ — holders can now support you' : j.approved ? 'Takeover approved! 🎉' : 'Support counted ✓', tk); if (j.approved) confetti(); setTimeout(function () { liveLoad(tk); }, 2000); })
          .catch(function (e) { toast(chainErr(e)); });
      })(act); break;
      case 'devClaimNow': var tq = find(arg); if (!tq || !S.wallet) break; var fsq = S.wallet.features['solana:signMessage'];
        if (!fsq) { toast('This wallet can’t sign messages — try Phantom or Solflare'); break; }
        var tsQ = Date.now(), msgQ = 'treid: claim — ' + tq.ca + ' — ' + tsQ;   // must match indexer/rewards.mjs claimMessage
        S.busy = 'Claiming'; render();
        Promise.resolve(fsq.signMessage({ account: S.walletAcc, message: new TextEncoder().encode(siteMsg(msgQ)) })).then(function (r) { var sg = (Array.isArray(r) ? r[0] : r).signature; return chainLib().then(function (T) { return fetch(API + '/api/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: tq.ca, wallet: S.account, ts: tsQ, sig: T.b58(sg) }) }).then(function (x) { return x.json(); }); }); })
          .then(function (j) { S.busy = null; if (!j || !j.ok) throw new Error((j && j.error) || 'claim failed'); confettiSmall(); toast('Paid ' + j.sol.toFixed(4) + ' ' + qSymT(tq) + ' to your wallet ✓', tq); setTimeout(function () { liveLoad(tq); refreshBalance(); }, 2000); render(); })
          .catch(function (e) { S.busy = null; render(); toast(chainErr(e)); });
        break;
      case 'liveClaim': var tc = find(arg); if (!tc || !tc.live) break;
        chainRun('Claiming rewards', function (T) { return T.buildClaimCreator({ rpc: RPC, creator: S.account, pool: tc.pool }); })
          .then(function (b) { confettiSmall(); toast('Claimed ' + b.amount.toFixed(4) + ' ' + qSymT(tc) + ' to your wallet ✓', tc); tc.crFees && (tc.crFees.unclaimed = 0); render(); setTimeout(function () { liveLoad(tc); }, 1500); })
          .catch(function (e) { if (e && e.message !== 'busy') toast('Claim failed: ' + chainErr(e)); });
        break;
      case 'showMore': S.shown = (S.shown || 12) + (window.matchMedia('(max-width: 760px)').matches ? 25 : 12); render(); break;
      case 'showAll': S.shown = 9999; render(); break;
      case 'mlaunch': newLaunch(); break;
      case 'trade':
        if (!S.account) { set({ walletOpen: true }); break; }
        var t = find(arg), amt = parseFloat(String(S.amount).replace(',', '.')) || 0;
        if (!t) break;
        if (amt <= 0) { toast('Enter an amount first'); break; }
        if (t.live) {
          var side0 = S.side, ps0 = S.pos[t.tick] || { tok: 0 };
          var qb0 = qBalT(t); if (!paySol(t) && side0 === 'buy' && qb0 != null && amt > qb0 - (t.qMint ? 0 : 0.003)) { toast('Not enough ' + qSymT(t) + ' — balance ' + (qb0 >= 1000 ? fmtNum(qb0) : qb0.toFixed(3))); break; }
          if (t.qMint && typeof S.balance === 'number' && S.balance < 0.003) { toast('You need a little SOL for network fees'); break; }
          if (side0 === 'sell') { if (amt > ps0.tok) amt = ps0.tok; if (amt <= 0) { toast('You don\'t hold any $' + t.tick + ' yet — buy first'); break; } }
          if (paySol(t)) { if (typeof S.balance === 'number' && amt > S.balance - 0.01) { toast('Not enough SOL — balance ' + S.balance.toFixed(3)); break; } if (S.busy) break; S.busy = 'Swapping SOL → ' + qSymT(t); render(); toast('Step 1 of 2: swap SOL → ' + qSymT(t) + ' — confirm in your wallet');
            jupSolToPair(t, amt).catch(function (e) { throw /fetch/i.test(String(e && e.message)) ? new Error('Couldn’t reach Jupiter — try again in a moment') : e; }).then(function (got) { S.busy = null; render(); return chainRun('Step 2 of 2: buying $' + t.tick, function (T) { return T.buildSwap({ rpc: RPC, expect: { mint: t.ca, partners: [PARTNER, TREASURY] }, owner: S.account, pool: t.pool, side: 'buy', amount: got, slippageBps: Math.round(S.slip * 100) }); }); })
              .then(function (b) { S.amount = ''; confettiSmall(); toast('Bought ~' + fmtNum(b.quote.out * (1 - Math.max(t.buy, t.sell) / 100)) + ' $' + t.tick + ' with SOL · on-chain ✓', t); setTimeout(function () { liveLoad(t); refreshBalance(); }, 1200); })
              .catch(function (e) { S.busy = null; render(); if (e && e.message !== 'busy') toast(chainErr(e)); });
            break; }
          chainRun(side0 === 'buy' ? 'Buying $' + t.tick : 'Selling $' + t.tick, function (T) { return T.buildSwap({ rpc: RPC, expect: { mint: t.ca, partners: [PARTNER, TREASURY] }, owner: S.account, pool: t.pool, side: side0, amount: amt, slippageBps: Math.round(S.slip * 100) }); })
            .then(function (b) { S.amount = ''; S.sellAll = false; if (side0 === 'buy') confettiSmall(); toast((side0 === 'buy' ? 'Bought ~' + fmtNum(b.quote.out * (1 - Math.max(t.buy, t.sell) / 100)) + ' $' + t.tick : 'Sold ' + fmtNum(amt) + ' $' + t.tick + ' for ~' + b.quote.out.toFixed(4) + ' ' + qSymT(t)) + ' · on-chain ✓', t); setTimeout(function () { liveLoad(t); }, 1200); })
            .catch(function (e) { if (e && e.message !== 'busy') toast(chainErr(e)); });
          break;
        }
        if (typeof S.balance === 'number' && S.side === 'buy' && amt > S.balance) { toast('Not enough ' + NET + 'SOL — balance ' + S.balance.toFixed(3)); break; }
        var qq = quoteFor(t), ps = S.pos[t.tick] = S.pos[t.tick] || { tok: 0, cost: 0 };
        if (S.side === 'sell' && amt > ps.tok && amt - ps.tok < 1) amt = ps.tok;
        if (S.side === 'sell' && S.sellAll && Math.abs(amt - Math.floor(ps.tok)) < 1) amt = ps.tok;
        if (S.side === 'sell' && amt > ps.tok + 1e-6) { toast(ps.tok > 0 ? 'You only hold ' + fmtNum(ps.tok) + ' $' + t.tick : 'You don\'t hold any $' + t.tick + ' yet — buy first'); break; }
        var solAmt = S.side === 'buy' ? amt : qq.sol;
        var trd = applyTrade(t, S.side, +solAmt.toFixed(4), S.account, true); devPing(t);
        if (S.side === 'buy') { ps.tok += qq.out; ps.cost += amt; trd.tokens = qq.out; }
        else { var frac = Math.min(1, amt / ps.tok); ps.cost -= ps.cost * frac; ps.tok -= amt; trd.tokens = amt; if (ps.tok < 1) delete S.pos[t.tick]; }
        S.amount = ''; S.sellAll = false; render();
        if (S.side === 'buy') confettiSmall();
        toast((S.side === 'buy' ? 'Bought ' + fmtNum(qq.out) + ' $' + t.tick + ' for ' + amt + ' SOL' : 'Sold ' + fmtNum(amt) + ' $' + t.tick + ' for ' + qq.out.toFixed(4) + ' SOL') + ' · tax ' + trd.tax.toFixed(4) + ' (simulated)', t); break;
      case 'demoLaunch': S.demoLaunch = true; document.querySelector('[data-act=launch]') && document.querySelector('[data-act=launch]').click(); S.demoLaunch = false; break;
      case 'launch':
        if (!S.account) { set({ walletOpen: true }); toast('Connect a wallet to launch'); break; }
        if (S.opsMismatch) { toast('Launching is paused: server configuration check failed. Please try again later.'); break; }
        var c = S.c;
        if (!c.name.trim() || c.tick.length < 2) { toast('Add a name and a ticker (2+ characters)'); break; }
        if (!c.img) { toast('Upload a logo image for your coin'); break; }
        var dq2 = devQuote(String(c.devBuy || '').replace(',', '.'));
        if (dq2.isSol && dq2.sol > 0 && typeof S.balance === 'number' && dq2.sol > S.balance) { toast('Not enough ' + NET + 'SOL for a ' + dq2.sol + ' SOL buy — balance ' + S.balance.toFixed(3)); break; }
        if (find(c.tick)) { toast('$' + c.tick + ' is already taken'); break; }
        if (!S.demoLaunch) {
          var tax0 = Math.max(c.buy, c.sell), sn0 = c.snipe || {}, cc0 = JSON.parse(JSON.stringify({ name: c.name.trim(), tick: c.tick, spec: c.spec, split: c.split, rw: rwOf(c) ? { mint: rwOf(c).mint } : 'coin', buy: c.buy, sell: c.sell, x: c.x, tg: c.tg, web: c.web, desc: c.desc, img: c.img, banner: c.banner, snipe: sn0, pair: c.pair, q: c.q || null }));
          var solB = dq2.isSol ? dq2.sol : 0, qq1 = qOf(c);
          if (typeof S.balance === 'number' && S.balance < solB + 0.03) { toast('You need about ' + (solB + 0.03).toFixed(2) + ' ' + NET + 'SOL (coin creation ≈ 0.03 SOL' + (solB ? ' + your ' + solB + ' SOL buy' : '') + ')'); break; }
          var vc1 = c.van && c.van.mode === 'custom' && (c.van.suf || '').length >= 3, suf1 = vc1 ? c.van.suf : 'trd', vf1 = vc1 ? vanFee(suf1.length) : 0, grindT = null;
          if (typeof S.balance === 'number' && S.balance < solB + 0.03 + vf1) { toast('You need about ' + (solB + 0.03 + vf1).toFixed(2) + ' ' + NET + 'SOL incl. the ' + vf1 + ' SOL address fee'); break; }
          S.busy = 'Finding address …' + suf1; render();
          var gBox = document.getElementById('toasts'), gEl = document.createElement('div'); gEl.className = 'toast grind-t'; gEl.innerHTML = '<span class="gr-sp"></span><span>Finding your address <b class="mono">…' + esc(suf1) + '</b> <small class="mono" id="gr-n"></small></span>'; if (gBox) gBox.appendChild(gEl);
          var gStart = Date.now();
          chainLib().then(function (T) { return dq2.isSol || !dq2.sol ? T : T.tokenBalance({ rpc: RPC, owner: S.account, mint: qq1.mint }).then(function (hb) { if (hb < dq2.sol) throw new Error('You have ' + fmtNum(hb) + ' ' + qq1.sym + ' — not enough for a ' + dq2.sol + ' ' + qq1.sym + ' buy'); return T; }); })
          .then(function (T) { return T.grind(suf1, { onProgress: function (n, exp) { var el = document.getElementById('gr-n'); if (!el) return; var rate = n / Math.max(0.2, (Date.now() - gStart) / 1000), left = Math.max(0, (exp - n) / rate); el.textContent = fmtNum(n) + ' tried · ' + (n >= exp ? 'any moment now — it\'s luck' : left < 5 ? 'almost there' : '~' + (left < 90 ? Math.ceil(left) + 's' : Math.ceil(left / 60) + ' min') + ' left'); } }); })
          .then(function (g) { gEl.remove(); grindT = g; S.busy = 'Saving logo…'; render();
            var fsU = S.wallet && S.wallet.features['solana:signMessage'], tsU = Date.now(), whoU = S.account;   // the upload is signed by your wallet (protects the IPFS account from spam)
            var up = API ? (fsU ? Promise.resolve(fsU.signMessage({ account: S.walletAcc, message: new TextEncoder().encode(siteMsg('treid: upload \u2014 ' + whoU + ' \u2014 ' + tsU)) })) : Promise.reject(new Error('This wallet can’t sign messages — try Phantom or Solflare'))).then(function (r) { var sg = (Array.isArray(r) ? r[0] : r).signature; return chainLib().then(function (T) { return T.b58(sg); }); }).then(function (sigU) { return Promise.race([fetch(API + '/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: whoU, ts: tsU, sig: sigU, name: cc0.name, symbol: cc0.tick, description: (cc0.desc || '').trim(), image: cc0.img || null, banner: cc0.banner || null, x: cc0.x, tg: cc0.tg, web: cc0.web }) }).then(function (r) { return r.json(); }), new Promise(function (r) { setTimeout(function () { r({}); }, 25000); })]); }).catch(function (e) { return { error: e && e.message }; }) : Promise.resolve({});
            return up; }).then(function (up) { S.busy = null; if (API && !API_DEV && !(up && up.uri)) throw new Error((up && up.error) || 'Couldn’t save your logo to IPFS — please try again'); var g = grindT; return chainRun('Launching $' + c.tick, function (T) {
            return T.buildCreate({ rpc: RPC, payer: S.account, partner: PARTNER, treasury: TREASURY, mintSecret: g.secret, extraFeeSol: vf1, escrow: S.escrowWallet || null, name: cc0.name, symbol: cc0.tick, uri: coinUri('MINT'.repeat(11), cc0, up && up.uri), taxBps: tax0 * 100, trapBps: Math.max(50, sn0.start || 50) * 100, trapSecs: Math.max(30, sn0.dur || 30), devBuySol: dq2.sol, quoteMint: qq1.sol ? null : qq1.mint, mc0: qq1.sol ? null : 20 * SOL_USD / qq1.usd, mc1: qq1.sol ? null : 60 * SOL_USD / qq1.usd });
          }); }).then(function (b) {
            var coin = { mint: b.mint, pool: b.pool, config: b.config, creator: S.account, name: cc0.name, symbol: cc0.tick, uri: b.uri, tax_bps: tax0 * 100, trap_bps: Math.max(50, sn0.start || 50) * 100, trap_secs: Math.max(30, sn0.dur || 30), created_at: Date.now(), mcap_usd: 20 * SOL_USD, curve_pct: 0, holders: dq2.sol > 0 ? 1 : 0, quote_mint: qq1.mint, quote_symbol: qq1.sym, quote_usd: qUsd(qq1), quote_dec: qq1.dec };
            var nt2 = liveTok(coin); nt2.tick = cc0.tick; nt2.spec = cc0.spec; nt2.img = cc0.img; nt2.banner = cc0.banner || null; nt2.desc = (cc0.desc || '').trim(); nt2.split = tax0 > 0 && cc0.split ? { p: cc0.split.p, h: cc0.split.h, b: cc0.split.b, d: cc0.split.d } : null;
            if (cc0.x || cc0.tg || cc0.web) { nt2.soc = true; nt2.links = { demo: false, web: linkOf(cc0.web), x: cc0.x ? linkOf(/[\/.]/.test(cc0.x) ? cc0.x : 'x.com/' + cc0.x.replace(/^@/, '')) : null, tg: cc0.tg ? linkOf(/[\/.]/.test(cc0.tg) ? cc0.tg : 't.me/' + cc0.tg.replace(/^@/, '')) : null }; }
            S.c = { name: '', tick: '', desc: '', x: '', tg: '', web: '', pair: 'SOL', q: null, buy: 0, sell: 0, img: null, banner: null, devBuy: '', spec: { kind: pick(A.KINDS), skin: pick(A.SKINS), bg: pick(A.BGS), eyes: 'normal', mouth: 'smile', acc: 'none' } };
            openToken(nt2.tick); confetti(); toast('$' + nt2.tick + ' is live on-chain' + NETP + ' ✓', nt2);
          }).catch(function (e) { gEl.remove(); if (S.busy && /^Finding/.test(S.busy)) { S.busy = null; render(); } if (e && e.message !== 'busy') toast('Launch failed: ' + chainErr(e)); });
          break;
        }
        var vc = c.van && c.van.mode === 'custom', vs = vc ? (c.van.suf || '') : 'trd', vf = vc ? vanFee(vs.length) : 0;
        if (vc && vs.length < 3) { toast('Custom address ending needs at least 3 characters'); break; }
        if (vf && typeof S.balance === 'number' && dq2.sol + vf > S.balance) { toast('Not enough ' + NET + 'SOL — need ' + (dq2.sol + vf).toFixed(2) + ' SOL incl. ' + vf + ' SOL address fee'); break; }
        var nt = { name: c.name.trim(), tick: c.tick, spec: c.spec, img: c.img, banner: c.banner || null, snipe: { on: true, start: Math.max(50, (c.snipe && c.snipe.start) || 50), dur: Math.max(30, (c.snipe && c.snipe.dur) || 30) }, buy: c.buy, sell: c.sell, split: c.buy > 0 && c.split ? { p: c.split.p, h: c.split.h, b: c.split.b, d: c.split.d } : null, rw: rwOf(c) ? (rwOf(c).mint === qOf(c).mint ? 'pair' : { mint: rwOf(c).mint }) : 'coin', pair: c.pair, mcN: 5, mc0: 5, prog: 1, born: Date.now(), holders: 1,
          soc: !!(c.x || c.tg || c.web), links: { web: linkOf(c.web), x: c.x ? linkOf(/[\/.]/.test(c.x) ? c.x : 'x.com/' + c.x.replace(/^@/, '')) : null, tg: c.tg ? linkOf(/[\/.]/.test(c.tg) ? c.tg : 't.me/' + c.tg.replace(/^@/, '')) : null, demo: false }, rewards: false, burn: false, ca: fakeCA(vs), vanity: vc ? vs : null, vol: 0, hist: [5, 5], desc: c.desc.trim(), creator: S.account };
        if (vf && typeof S.balance === 'number') S.balance = Math.max(0, S.balance - vf);
        nt.devPct = +dq2.pct.toFixed(2);
        S.created.unshift(nt);
        if (dq2.sol > 0) { var dtr = applyTrade(nt, 'buy', dq2.sol, S.account, true); dtr.tokens = dq2.tok; dtr.tax = 0; S.pos[nt.tick] = { tok: dq2.tok, cost: dq2.sol }; }
        saveCreated();
        S.c = { name: '', tick: '', desc: '', x: '', tg: '', web: '', pair: 'SOL', q: null, buy: 0, sell: 0, img: null, banner: null, devBuy: '', spec: { kind: pick(A.KINDS), skin: pick(A.SKINS), bg: pick(A.BGS), eyes: 'normal', mouth: 'smile', acc: 'none' } };
        openToken(nt.tick); confetti(); toast('$' + nt.tick + ' is live on treid', nt); break;
    }
  });

  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.tc-ca'); if (!b) return; b.classList.add('ok'); var h = b.innerHTML; b.innerHTML = 'Copied ✓'; setTimeout(function () { if (b.isConnected) { b.innerHTML = h; b.classList.remove('ok'); } }, 1200); }, true);
  document.addEventListener('scroll', function (e) { if (e.target && e.target.id === 'cmts' && e.target.scrollTop < 20) { var np = document.getElementById('tt-new'); if (np && np._n) { np._n = 0; np.style.display = 'none'; } } }, true);
  document.addEventListener('error', function (e) {   // a logo that can't load turns into initials
    var im = e.target; if (!im || im.tagName !== 'IMG') return;
    if (im.parentNode && im.parentNode.classList && im.parentNode.classList.contains('img') && im.parentNode.classList.contains('coin')) { var w = im.parentNode; w.classList.remove('img'); w.style.background = '#3A3A40'; w.style.fontSize = Math.round(parseInt(w.style.width, 10) * .38) + 'px'; w.textContent = String(im.alt || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'; return; }
    if (!im.classList.contains('rwp-ic')) return; var sp = document.createElement('span'); sp.className = 'coin rwp-ic'; sp.textContent = im.getAttribute('data-ini') || '?';
    sp.style.cssText = 'width:' + im.style.width + ';height:' + im.style.height + ';background:#2E2E33;font-size:9px'; im.replaceWith(sp); }, true);
  document.addEventListener('change', function (e) { if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-shimg')) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f || !/^image\//.test(f.type) || f.size > 8e6 || !S.share) return; var fr = new FileReader(); fr.onload = function () { if (S.share) { S.share.custom = String(fr.result); S.share.bg = 'custom'; render(); } }; fr.readAsDataURL(f); } });
  document.addEventListener('change', function (e) { if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-coimg')) { coPickImage(e.target.files && e.target.files[0]); e.target.value = ''; } });
  document.addEventListener('input', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-burnpct')) { S.burnPct = +e.target.value; var t = find(S.burnTick), pos = t && position(t); if (!pos) return; var tok = pos.tok * S.burnPct / 100;
      var q = function (id, v) { var x = document.getElementById(id); if (x) x.textContent = v; }; q('bt-tok', fmtNum(Math.round(tok)) + ' $' + t.tick); q('bt-sup', (tok / 1e9 * 100).toFixed(3) + '%'); q('bt-usd', '$' + fmtNum(Math.round(tok * price(t))));
      var g = document.querySelector('.bt-go'); if (g) g.textContent = '🔥 Burn ' + S.burnPct + '% of my $' + t.tick; document.querySelectorAll('.bt-pre button').forEach(function (bb) { bb.classList.toggle('on', +bb.getAttribute('data-arg') === S.burnPct); }); return; }
    if (e.target.hasAttribute && e.target.hasAttribute('data-qmint')) { S.cpq = e.target.value.trim(); if (isCA(S.cpq) && S.qBusy !== S.cpq && qOf(S.c).mint !== S.cpq) qSelect(S.cpq); else if (!isCA(S.cpq)) tokSearch(S.cpq, 'q-drop', 'qpick'); return; }
    if (e.target.hasAttribute && e.target.hasAttribute('data-rwq')) { S.rwq = e.target.value.trim(); tokSearch(S.rwq, 'rw-drop', 'rwPick'); return; }
    if (e.target.hasAttribute && e.target.hasAttribute('data-van')) {
      var raw = e.target.value, clean = raw.split('').filter(function (ch) { return B58C.indexOf(ch) >= 0; }).join('').slice(0, 4), bad = raw.replace(/./g, function (ch) { return B58C.indexOf(ch) >= 0 ? '' : ch; });
      if (clean !== raw) e.target.value = clean; S.c.van.suf = clean; var n = clean.length;
      var er = document.getElementById('van-err'); if (er) er.textContent = bad ? 'Addresses can’t use 0, O, I, l or symbols' : '';
      var pv = document.getElementById('van-prev'); if (pv) pv.innerHTML = vanPrev(S.c);
      var fe = document.getElementById('van-fee'); if (fe) fe.textContent = n >= 3 ? '+' + vanFee(n) + ' SOL · ' + vanEta(n) : 'type at least 3 characters';
      document.querySelectorAll('.van-tiers span').forEach(function (sp, i) { sp.classList.toggle('on', n === 3 + i); });
      var vt = document.querySelector('.van-o.on .van-t b'); if (vt) vt.textContent = clean || 'MOON';
      return;
    }
    var spk = e.target.getAttribute && e.target.getAttribute('data-split');
    if (spk && S.c.split) { var sp = S.c.split, v = Math.min(spk === 'd' ? 50 : 100, +e.target.value); if (+e.target.value !== v) e.target.value = v; var others = ['h', 'b', 'd'].filter(function (k) { return k !== spk; }), rest = 100 - v;
      var a = others[0], b2 = others[1], sumO = sp[a] + sp[b2];
      var na = sumO ? Math.round(rest * sp[a] / sumO / 5) * 5 : Math.round(rest / 10) * 5, nb = rest - na;
      if (b2 === 'd' && nb > 50) { nb = 50; na = rest - 50; } if (a === 'd' && na > 50) { na = 50; nb = rest - 50; }
      sp[spk] = v; sp[a] = na; sp[b2] = nb; spUpdate(); return; }
    var rg = e.target.getAttribute && e.target.getAttribute('data-range');
    if (rg) {
      var pk = rg.split('|'), k = pk[0], idx = +pk[1], val = +e.target.value, r = S.r[k];
      if (idx === 0) r[0] = Math.min(val, r[1]); else r[1] = Math.max(val, r[0]);
      if (+e.target.value !== r[idx]) e.target.value = r[idx];
      refreshGrid(); irUpdate(k, idx); return;
    }
    var el = e.target, key = el.getAttribute && el.getAttribute('data-bind');
    if (!key) return;
    var v = el.value;
    if (el.getAttribute('data-num')) v = Number(v);
    if (key === 'c.tick') v = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (key === 'c.devBuy') v = v.replace(/[^0-9.,]/g, '').slice(0, 8);
    if (key === 'amount') { v = v.replace(/[^0-9.,]/g, ''); S.pctAmt = 0; }
    if (key === 'pctAmt') { var base = (S.account && typeof S.balance === 'number') ? Math.max(0, S.balance - 0.01) : 10; el.style.setProperty('--p', v + '%'); set({ pctAmt: v, amount: v ? (base * v / 100).toFixed(3) : '' }); return; }
    if (key.indexOf('c.') === 0) { var p = {}; p[key.slice(2)] = v; setC(p); return; }
    var o = {}; o[key] = v; if (key === 'palQ') o.palIdx = 0; set(o);
  });

  function loadMedia(f, kind) {
    if (!f) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { toast('Use PNG, JPG, GIF or WEBP'); return; }
    if (f.size > 4 * 1024 * 1024) { toast('Image is over 4 MB'); return; }
    var r = new FileReader();
    r.onload = function () {
      var im = new Image();
      im.onload = function () {
        var W = kind === 'img' ? 400 : 1500, H = kind === 'img' ? 400 : 500, cv = document.createElement('canvas'), x = cv.getContext('2d');
        cv.width = W; cv.height = H;
        var sc = Math.max(W / im.width, H / im.height), dw = im.width * sc, dh = im.height * sc;
        x.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
        var o = {}; o[kind] = cv.toDataURL('image/webp', .85); setC(o);
      };
      im.src = r.result;
    };
    r.readAsDataURL(f);
  }
  document.addEventListener('change', function (e) {
    if (e.target.id === 'c-img') loadMedia(e.target.files && e.target.files[0], 'img');
    if (e.target.id === 'c-banner') loadMedia(e.target.files && e.target.files[0], 'banner');
    if (e.target.id === 'dimg-in') demoImgsAdd(e.target.files);
  });
  document.addEventListener('dragover', function (e) { var d = e.target.closest && e.target.closest('[data-drop]'); if (!d) return; e.preventDefault(); d.classList.add('over'); });
  document.addEventListener('dragleave', function (e) { var d = e.target.closest && e.target.closest('[data-drop]'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', function (e) { var d = e.target.closest && e.target.closest('[data-drop]'); if (!d) return; e.preventDefault(); d.classList.remove('over'); if (d.getAttribute('data-drop') === 'demo') demoImgsAdd(e.dataTransfer.files); else loadMedia(e.dataTransfer.files && e.dataTransfer.files[0], d.getAttribute('data-drop')); });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); set({ palOpen: !S.palOpen, palQ: '', palIdx: 0 }); return; }
    if (e.target && e.target.id === 'pairq') { if (e.key === 'Enter') { var pr0 = pairIds('all', S.pairQ)[0]; if (pr0) { S.pairQ = ''; set({ pair: pr0, cat: pairInfo(pr0).cat }); } return; } if (e.key === 'Escape') { set({ pairQ: '' }); return; } }
    if (e.key === 'Escape') { if (S.palOpen || S.walletOpen || S.walletMenu || S.walletView) set({ palOpen: false, walletOpen: false, walletMenu: false, walletView: null }); return; }
    if (S.palOpen) {
      var res = palResults();
      if (e.key === 'ArrowDown') { e.preventDefault(); set({ palIdx: Math.min(res.length - 1, S.palIdx + 1) }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); set({ palIdx: Math.max(0, S.palIdx - 1) }); }
      else if (e.key === 'Enter' && res[S.palIdx]) { e.preventDefault(); openToken(res[S.palIdx].tick); }
    }
  });

  // header nav sliding indicator
  function navInd(btn) { var ind = document.getElementById('nav-ind'), nav = ind && ind.parentNode; if (!ind) return; btn = btn || nav.querySelector('button.on'); if (!btn) { ind.style.opacity = 0; return; } var r = btn.getBoundingClientRect(), n = nav.getBoundingClientRect(); ind.style.opacity = 1; ind.style.width = r.width + 'px'; ind.style.transform = 'translateX(' + (r.left - n.left) + 'px)'; }
  document.addEventListener('mouseover', function (e) { var b = e.target.closest && e.target.closest('.navlinks button'); if (b) navInd(b); else if (e.target.closest && !e.target.closest('.navlinks')) navInd(); });
  window.addEventListener('resize', function () { navInd(); });
  // card spotlight follows the mouse
  document.addEventListener('mousemove', function (e) {
    var c = e.target.closest && e.target.closest('.tcard');
    if (c) { var r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); }
    var box = e.target.closest && e.target.closest('#chart');
    if (box && e.target.closest('.cmark')) { var xt = document.getElementById('xht'); if (xt) xt.style.display = 'none'; return; }
    if (box && S.chartPts && !CDRAG) {
      var rb = box.getBoundingClientRect(), fx = (e.clientX - rb.left) / rb.width * S.chartW;
      var i = Math.max(0, Math.min(S.chartPts.length - 1, Math.round((fx - S.chartOff - S.chartCw / 2) / S.chartCw))), p = S.chartPts[i];
      var xh = document.getElementById('xh'), yh = document.getElementById('yh'), d = document.getElementById('xhd'), tip = document.getElementById('xht');
      if (!xh || !p) return;
      var px = p.x / S.chartW * rb.width, py = p.y / S.chartH * rb.height;
      xh.style.display = d.style.display = tip.style.display = yh.style.display = 'block';
      xh.style.left = px + 'px'; d.style.left = px + 'px'; d.style.top = py + 'px'; yh.style.top = (e.clientY - rb.top) + 'px';
      var ch = (p.v - p.o) / p.o * 100;
      tip.innerHTML = '<span class="muted">' + tLabel(p.t) + '</span> O <b>' + yLabel(p.o, S.cStep) + '</b> H <b class="up">' + yLabel(p.h, S.cStep) + '</b> L <b class="down">' + yLabel(p.l, S.cStep) + '</b> C <b>' + yLabel(p.v, S.cStep) + '</b> <b class="' + (ch >= 0 ? 'up' : 'down') + '">' + (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%</b> <span class="muted">Vol</span> <b>' + p.vol.toFixed(2) + ' SOL</b>';
      tip.style.left = Math.min(rb.width - tip.offsetWidth - 4, Math.max(4, px + 12)) + 'px';
    }
  });
  document.addEventListener('mouseover', function (e) { var m = e.target.closest && e.target.closest('.lm'); if (m) lwTip(m.getAttribute('data-arg'), m); else if (e.target.closest && e.target.closest('#chart')) { var tp = document.getElementById('cmtip'); if (tp) tp.classList.remove('on'); } });
  // bubble map: wheel zoom at the cursor, drag to pan, hover tooltip
  var BMD = null;
  function bmUnit(cv) { var r = cv.getBoundingClientRect(), s = Math.max(1000 / r.width, 720 / r.height); return { r: r, s: s, ox: (r.width * s - 1000) / 2, oy: (r.height * s - 720) / 2 }; }
  function bmApply() { var g = document.getElementById('bm-g'), V = S.bubV; if (g) g.setAttribute('transform', 'translate(' + V.x.toFixed(1) + ' ' + V.y.toFixed(1) + ') scale(' + V.k.toFixed(3) + ')'); }
  document.addEventListener('wheel', function (e) { var cv = e.target.closest && e.target.closest('#bm-cv'); if (!cv) return; e.preventDefault();
    var u = bmUnit(cv), px = (e.clientX - u.r.left) * u.s - u.ox, py = (e.clientY - u.r.top) * u.s - u.oy, V = S.bubV, k1 = Math.max(.4, Math.min(6, V.k * (e.deltaY > 0 ? .88 : 1.14)));
    V.x = px - (px - V.x) * k1 / V.k; V.y = py - (py - V.y) * k1 / V.k; V.k = k1; bmApply(); }, { passive: false });
  document.addEventListener('pointerdown', function (e) { var cv = e.target.closest && e.target.closest('#bm-cv'); if (!cv || e.button > 0 || e.target.closest('button')) return; BMD = { x: e.clientX, y: e.clientY, vx: S.bubV.x, vy: S.bubV.y, s: bmUnit(cv).s, moved: false }; });
  document.addEventListener('pointermove', function (e) { if (BMD) { var dx = e.clientX - BMD.x, dy = e.clientY - BMD.y; if (Math.abs(dx) + Math.abs(dy) > 4) BMD.moved = true; if (BMD.moved) { S.bubV.x = BMD.vx + dx * BMD.s; S.bubV.y = BMD.vy + dy * BMD.s; bmApply(); } }
    var tip = document.getElementById('bm-tip'); if (!tip) return; var n = e.target.closest && e.target.closest('#bm-cv [data-tip]'); if (!n || (BMD && BMD.moved)) { tip.classList.remove('on'); return; }
    var r = document.getElementById('bm-cv').getBoundingClientRect(); tip.textContent = n.getAttribute('data-tip'); tip.classList.add('on'); tip.style.left = Math.min(r.width - tip.offsetWidth - 6, e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top + 14) + 'px'; });
  document.addEventListener('pointerup', function () { if (BMD && BMD.moved) { var stop = function (ev) { ev.stopPropagation(); ev.preventDefault(); }; document.addEventListener('click', stop, { capture: true, once: true }); setTimeout(function () { document.removeEventListener('click', stop, { capture: true }); }, 50); } BMD = null; });
  // chart: wheel zoom + drag pan + Esc to leave fullscreen + candle rollover
  var CDRAG = null, PINCH = null;
  document.addEventListener('mouseover', function (e) {
    var m = e.target.closest && e.target.closest('.cmark'), tip = document.getElementById('cmtip'); if (!tip) return;
    if (!m) { tip.classList.remove('on'); return; }
    var it = S.cmarkData && S.cmarkData[+m.getAttribute('data-cmi')], t = find(S.tick); if (!it || !t) return;
    var w = it.k === 'tr' ? it.d.wallet : it.d.w, dev = w === devOf(t), me = S.account && w === S.account, h = '';
    var head = '<div class="ct-h"><span class="av" style="width:30px;height:30px">' + A.svg(walletSpec(w)) + '</span><span class="ct-n"><b>' + esc(walletName(w)) + '</b><small class="mono">' + short(w) + '</small></span>' + (dev ? '<span class="bdg dev">DEV</span>' : '') + (me ? '<span class="bdg win">YOU</span>' : '') + '</div>';
    if (it.k === 'tr') { var x = it.d, buy = x.side === 'buy', tok = x.tokens || x.sol * SOL_USD / (x.price || price(t)), mc = (x.price || price(t)) * 1e9 / 1000;
      h = head + '<div class="ct-side ' + (buy ? 'b' : 's') + '">' + (buy ? 'Bought' : 'Sold') + ' <b class="mono">' + x.sol.toFixed(3) + ' SOL</b><span class="mono">≈ $' + fmtNum(Math.round(x.sol * SOL_USD)) + '</span></div>' +
        '<div class="ct-g"><span><small>Tokens</small><b class="mono">' + fmtNum(Math.round(tok)) + '</b></span><span><small>At MC</small><b class="mono">' + fmtK(mc) + '</b></span><span><small>When</small><b class="mono">' + ago(x.t) + ' ago</b></span><span><small>Tax paid</small><b class="mono">' + (x.tax || 0).toFixed(3) + '</b></span></div>';
      var co = seedComments(t).filter(function (c) { return c.w === w; })[0]; if (co) h += '<div class="ct-co">💬 “' + esc(co.text.length > 90 ? co.text.slice(0, 90) + '…' : co.text) + '”</div>';
    } else { var c = it.d; coMeta(c, t); var pnl = c.pos * (t.mcN / c.mc0 - 1);
      h = head + '<div class="ct-co big">“' + esc(c.text.length > 140 ? c.text.slice(0, 140) + '…' : c.text) + '”</div><div class="ct-g"><span><small>Called at</small><b class="mono">' + fmtK(c.mc0) + '</b></span><span><small>Position</small><b class="mono">$' + fmtNum(c.pos) + '</b></span><span><small>PnL</small><b class="mono ' + (pnl >= 0 ? 'up' : 'down') + '">' + (pnl >= 0 ? '+' : '−') + '$' + Math.abs(pnl).toFixed(0) + '</b></span><span><small>When</small><b class="mono">' + ago(c.t) + ' ago</b></span></div>'; }
    h += '<div class="ct-f">click to open wallet</div>';
    tip.innerHTML = h; tip.classList.add('on');
    var box = document.getElementById('chart').getBoundingClientRect(), mr = m.getBoundingClientRect(), tw = 250, x0 = mr.left - box.left + mr.width / 2 - tw / 2, y0 = mr.bottom - box.top + 8;
    tip.style.left = Math.max(4, Math.min(box.width - tw - 4, x0)) + 'px'; tip.style.top = (y0 + 170 > box.height ? Math.max(4, mr.top - box.top - tip.offsetHeight - 8) : y0) + 'px';
  });
  document.addEventListener('touchstart', function (e) { var box = e.target.closest && e.target.closest('#chart'); if (LW.chart || !box || e.touches.length !== 2) return; PINCH = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: S.czoom }; }, { passive: true });
  document.addEventListener('touchmove', function (e) { if (!PINCH || e.touches.length !== 2) return; e.preventDefault(); var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); S.czoom = Math.max(12, Math.min(240, Math.round(PINCH.z * PINCH.d / Math.max(20, d)))); chartRedraw(); }, { passive: false });
  document.addEventListener('touchend', function () { PINCH = null; });
  document.addEventListener('keydown', function (e) { if (LW.chart || S.screen !== 'token' || /INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return; if (e.key === '+' || e.key === '=') { S.czoom = Math.max(12, Math.round(S.czoom * .8)); chartRedraw(); } else if (e.key === '-') { S.czoom = Math.min(240, Math.round(S.czoom * 1.25)); chartRedraw(); } });
  document.addEventListener('wheel', function (e) {
    var box = e.target.closest && e.target.closest('#chart'); if (!box || LW.chart) return;
    e.preventDefault();
    var sv = box.querySelector('svg'), rr = (sv || box).getBoundingClientRect(), vb = sv && sv.viewBox.baseVal, W0 = vb && vb.width ? vb.width : rr.width;
    var f = Math.max(0, Math.min(1, (e.clientX - rr.left) / rr.width * W0 / Math.max(1, W0 - 70)));
    var n0 = Math.min(S.czoom, S.cEff || S.czoom), n1 = Math.max(12, Math.min(240, Math.round(n0 * (e.deltaY > 0 ? 1.12 : .89)))); if (n1 === n0) n1 = Math.max(12, Math.min(240, n0 + (e.deltaY > 0 ? 1 : -1)));
    var anchor = S.cpan + (n0 - 1) - f * n0; // buckets back from now under the cursor
    S.czoom = n1; S.cpan = Math.max(-Math.floor(n1 * .8), Math.min((S.cA || 1e6) - 2, Math.round(anchor - (n1 - 1) + f * n1))); chartRedraw(); var zl = document.querySelector('.czoom .mono'); if (zl) zl.textContent = S.cEff || S.czoom;
  }, { passive: false });
  document.addEventListener('pointerdown', function (e) {
    var box = e.target.closest && e.target.closest('#chart'); if (LW.chart || !box || e.button > 0 || e.target.closest('button')) return;
    var br = box.getBoundingClientRect(); CDRAG = { x: e.clientX, y: e.clientY, pan: S.cpan, w: br.width, h: br.height, ys: S.cys, yo: S.cyo, axis: !!e.target.closest('.yhit') }; box.classList.add(CDRAG.axis ? 'yscaling' : 'panning');
  });
  document.addEventListener('pointermove', function (e) {
    if (!CDRAG) return; var dx = e.clientX - CDRAG.x, dy = e.clientY - CDRAG.y;
    if (CDRAG.axis) { S.cys = Math.max(.08, Math.min(40, CDRAG.ys * Math.exp(dy / 160))); if (!CDRAG.raf) CDRAG.raf = requestAnimationFrame(function () { if (CDRAG) CDRAG.raf = 0; chartRedraw(); }); return; }
    var np = Math.max(-Math.floor((S.cEff || S.czoom) * .8), Math.min((S.cA || 1e6) - 2, Math.round(CDRAG.pan + dx / CDRAG.w * (S.cEff || S.czoom)))), ny = (S.cys !== 1 || CDRAG.yo) ? CDRAG.yo + dy / (CDRAG.h * .78) * S.cys : 0;
    if (np !== S.cpan || ny !== S.cyo) { S.cpan = np; S.cyo = ny; if (!CDRAG.raf) CDRAG.raf = requestAnimationFrame(function () { if (CDRAG) CDRAG.raf = 0; chartRedraw(); }); }
  });
  document.addEventListener('pointerup', function () { if (!CDRAG) return; CDRAG = null; var b = document.getElementById('chart'); if (b) b.classList.remove('panning', 'yscaling'); });
  document.addEventListener('dblclick', function (e) { if (e.target.closest && e.target.closest('#chart .yhit')) { S.cys = 1; S.cyo = 0; chartRedraw(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.cfull) set({ cfull: false }); });
  setInterval(function () { if (S.screen !== 'token' || document.hidden || CDRAG) return; var b = document.getElementById('chart'); if (b && !b.matches(':hover')) chartRedraw(); }, 3000);
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest && e.target.closest('#chart') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#chart'))) {
      ['xh', 'xhd', 'xht'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
    }
  });

  // ================= THE DIAMOND FACTORY (fun how-it-works) =================
  var M = { launched: all().length, tax: 0, creators: 0, holders: 0, vault: 0, grad: BASE.filter(function (t) { return t.prog >= 100; }).length, step: 0, pos: 0, rider: null, paused: 0 };
  var MSTEPS = [['make'], ['climb'], ['blast']];
  setInterval(function () { if (S.screen === 'home' && document.getElementById('machine') && !(M.paused > 0)) mSetStep(M.step + 1); }, 2600);
  function hotToken() { var l = all().filter(function (t) { return t.prog < 100; }).sort(function (a, b) { return b.prog - a.prog; }); return l[0] || BASE[0]; }
  function hillPos(p) { var k = p / 100; return { x: 8 + k * 78, y: 12 + Math.pow(k, 1.6) * 62 }; }
  function jarH(v) { return Math.min(92, 8 + Math.sqrt(v) * 38); }
  var RUGS = 0, CLEAN = 0;
  var POS = { press: 18, tax: 34, scan: 46, pick: 55, bin: 64, pump: 78, launch: 92 };
  // ===== HOW IT WORKS: "A coin's life" — cinematic story, 6 scenes =====
  var STS = [
    ['Launch', 'Logo, banner, any pair, one tax. Live in seconds.'],
    ['Sniper trap', 'Bots that rush in at launch pay a huge tax. It steps down in 3 drops, then everyone pays the normal tax.'],
    ['Trade the curve', 'Every buy pushes the price up the bonding curve. Every trade pays the tax shown on the coin.'],
    ['Risk flags', 'We never hide or delete coins. We show dev, top 10, snipers and bundles — you decide.'],
    ['Graduate', 'At ~$' + gradK() + 'K the curve fills, liquidity moves to Meteora and milestone badges start.'],
    ['Tax flywheel', 'Every trade’s tax splits three ways: creator, holders and burn. More trading, more rewards.']
  ];
  var FW = { raf: 0, el: null, coins: [], last: 0, lt: 0, paused: false, hi: -1, jars: [0, 0, 0], spawn: 0, cnt: [1240, 386, 0, [52, 171], 214, 0] };
  var FST = [['Launch', 'Make a coin, pick a tax', '#F5D9A8'], ['Sniper trap', 'Early bots pay huge tax', '#FF5E6C'], ['Bonding curve', 'Every buy lifts the price', '#3DDC97'], ['Risk scan', 'We flag risks, never hide', '#FFB15C'], ['Graduate', 'At ~$' + gradK() + 'K it moves to Meteora', '#F5D9A8'], ['Tax split', 'Creator picks the split, locked', '#7FB6FF']];
  function fxMini(k) {
    var t = all()[3] || all()[0];
    if (k === 0) return '<div class="fm fm0"><span class="fm-blank">?</span><span class="fm-arr">→</span><span class="fm-coin">' + avatarHTML(t, 26) + '<i class="mono">2%</i></span></div>';
    if (k === 1) return '<div class="fm fm1"><b class="mono" data-snv>80%</b><span class="fm-bar"><i data-snb></i></span><small data-snl>bots pay</small></div>';
    if (k === 2) return '<div class="fm fm2"><svg viewBox="0 0 120 34"><path class="fm-ln" d="M2 32 C40 30 60 24 80 14 S110 3 118 2" fill="none" stroke="#3DDC97" stroke-width="2.5" stroke-linecap="round"/></svg><span class="fm-up mono">▲ price</span></div>';
    if (k === 3) return '<div class="fm fm3"><span class="g">Dev ✓</span><span class="r">Top10 ⚠</span><span class="g">Bundle ✓</span></div>';
    if (k === 4) return '<div class="fm fm4"><span class="fm-bar"><i></i></span><span class="fm-cap">🎓</span><small class="mono">$' + gradK() + 'K</small></div>';
    return '<div class="fm fm5"><span class="fm-split"><i style="flex:5;background:#7FB6FF"></i><i style="flex:3;background:#FF8A5B"></i><i style="flex:2;background:#F5D9A8"></i></span><span class="fm-lab"><em>💎 holders</em><em>🔥 burn</em><em>👤 dev</em></span></div>';
  }
  function fxRead(k) {
    var c = FW.cnt, v = k === 0 ? '<b>' + fmtNum(c[0]) + '</b> coins minted' : k === 1 ? '<b>' + fmtNum(c[1]) + '</b> bots taxed' : k === 2 ? '<b>+' + c[2].toFixed(1) + ' SOL</b> bought' : k === 3 ? '<b class="r">⚠ ' + c[3][0] + '</b> · <b class="g">✓ ' + c[3][1] + '</b>' : k === 4 ? '<b>🎓 ' + c[4] + '</b> graduated' : '<b>$' + fmtNum(Math.round(c[5])) + '</b> paid out';
    var e = document.querySelector('[data-fread="' + k + '"]'); if (e) e.innerHTML = v; return v;
  }
  var FSX = [8.3, 25, 41.7, 58.3, 75, 91.7]; // station centres, % of belt
  var FICO = [
    '<svg viewBox="0 0 24 24"><path d="M12 3v10M7 8l5 5 5-5M4 21h16"/></svg>',
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M3 20c6 0 9-4 11-9s4-7 7-7"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M3 12h18M6 6l12 12M18 6L6 18" opacity=".0"/><path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M4 12h16"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M21 3l-9 9M15 3h6v6"/></svg>'
  ];
  // iOS: a tap on the fixed bottom nav sometimes never becomes a click (hover emulation / toolbar resizing) — fire it ourselves on touchend
  (function () { var t0 = null; document.addEventListener('touchstart', function (e) { var b = e.target.closest && e.target.closest('.mnav button, .m-bar button'); t0 = b ? { b: b, x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    document.addEventListener('touchend', function (e) { if (!t0) return; var b = e.target.closest && e.target.closest('.mnav button, .m-bar button'), c = e.changedTouches[0]; if (b && b === t0.b && Math.abs(c.clientX - t0.x) < 12 && Math.abs(c.clientY - t0.y) < 12) { e.preventDefault(); b.click(); } t0 = null; }, { passive: false }); })();
  // phones: the factory plays by itself — the belt slides station to station while the screen stays put; swipe to jump
  var FXP = { k: 0, hold: 0, coins: [], last: 0, spawn: 0, hits: 0, raf: 0 }, FXB = ['minted ✓', '🤖 −80% · you −2%', '▲ price up', 'scanned', '🎓 → Meteora', '💎 🔥 👤'];
  function fxPlayer() {
    return '<div class="fxp" id="fxp"><div class="fxp-view"><div class="fxp-stage" id="fxp-stage" style="--sc:' + FST[FXP.k][2] + '"><div class="fxp-st" id="fxp-st">' + fxpStation(FXP.k) + '</div><span class="fxp-piston" id="fxp-piston"><i></i></span><div class="fxp-coins" id="fxp-coins"></div><span class="fxp-belt"></span></div>' +
      '<div class="fxp-txt" id="fxp-txt">' + fxpTxt(FXP.k) + '</div></div>' +
      '<div class="fxp-dots">' + STS.map(function (x, k) { return '<button class="' + (k === FXP.k ? 'on' : '') + '" data-act="fxpGo" data-arg="' + k + '" aria-label="Step ' + (k + 1) + '"><i></i></button>'; }).join('') + '</div></div>'; }
  function fxpStation(k) { return '<span class="fxp-ic">' + FICO[k] + '</span><b class="fxp-sn">' + FST[k][0] + '</b>' + fxMini(k); }
  function fxpTxt(k) { return '<span class="mono">0' + (k + 1) + ' / 06</span><b>' + STS[k][0] + '</b><small>' + STS[k][1] + '</small>'; }
  function fxpShow(k) { FXP.k = (k + 6) % 6; FXP.hits = 0; if (FXP.k !== 0) document.querySelectorAll('.fxp-c.blank').forEach(function (e) { e.classList.remove('blank'); }); var st = document.getElementById('fxp-st'), sg = document.getElementById('fxp-stage'), tx = document.getElementById('fxp-txt'); if (!st) return;
    sg.style.setProperty('--sc', FST[FXP.k][2]); st.classList.add('swap'); setTimeout(function () { st.innerHTML = fxpStation(FXP.k); tx.innerHTML = fxpTxt(FXP.k); st.classList.remove('swap'); }, 220);
    document.querySelectorAll('.fxp-dots button').forEach(function (b, i) { b.classList.toggle('on', i === FXP.k); }); }
  function fxpSpawn(box) { var t = pick(all()) || BASE[0], blank = FXP.k === 0, el = document.createElement('span'); el.className = 'fxp-c' + (blank ? ' blank' : '');
    el.innerHTML = '<span class="fxp-cf">' + avatarHTML(t, 44) + '</span><span class="fxp-cq">?</span><span class="fxp-tag"></span>'; box.appendChild(el); FXP.coins.push({ el: el, x: -30, hit: false, k: FXP.k }); }
  function fxpHit(c, W) { var k = FXP.k, el = c.el, pi = document.getElementById('fxp-piston'), tag = el.querySelector('.fxp-tag');
    if (pi) { pi.classList.remove('down'); void pi.offsetWidth; pi.classList.add('down'); } el.classList.remove('squash'); void el.offsetWidth; el.classList.add('squash');
    var st = document.getElementById('fxp-st'); if (st) { st.classList.remove('hit'); void st.offsetWidth; st.classList.add('hit'); }
    setTimeout(function () { if (!el.isConnected) return; el.classList.add('fx' + k); el.classList.remove('blank');
      var txt = k === 0 ? 'minted' : k === 1 ? (Math.random() < .5 ? '🤖 −80%' : '🙂 −2%') : k === 2 ? '▲' : k === 3 ? (Math.random() < .3 ? '⚠' : '✓') : k === 4 ? '🎓' : '💎🔥👤';
      tag.textContent = txt; tag.className = 'fxp-tag on' + (k === 1 && txt.indexOf('80') > 0 ? ' r' : k === 3 && txt === '⚠' ? ' y' : ''); }, 230);
    FXP.hits++; if (FXP.hits >= 3 && Date.now() > FXP.hold) setTimeout(function () { fxpShow(FXP.k + 1); }, 900); }
  function fxpTick(now) { FXP.raf = requestAnimationFrame(fxpTick); var box = document.getElementById('fxp-coins'); if (!box || document.hidden || !box.offsetParent) { FXP.last = now; return; }
    var W = box.clientWidth, dt = Math.min(60, now - (FXP.last || now)); FXP.last = now; if (now < (FXP.stop || 0)) { FXP.spawn += dt; return; }   // the belt halts while the press comes down, so it lands dead centre
    // a re-render swaps in a fresh #fxp-coins box: drop coins left behind in the old one, or they keep riding invisibly and fire the press with no coin under it
    FXP.coins = FXP.coins.filter(function (c) { if (c.el.parentNode === box) return true; c.el.remove(); return false; });
    var lastC = FXP.coins[FXP.coins.length - 1];   // never drop a new coin on top of one still near the start (e.g. after scrolling back) — that made back-to-back double presses
    if (!FXP.coins.length || (now - FXP.spawn > 1500 && lastC.x > 90)) { FXP.spawn = now; fxpSpawn(box); }
    FXP.coins = FXP.coins.filter(function (c) { c.x += dt * .085; if (!c.hit && c.x >= W / 2 && now >= (FXP.stop || 0)) { var over = c.x - W / 2; FXP.coins.forEach(function (o) { o.x -= over; o.el.style.transform = 'translateX(' + (o.x - 23).toFixed(1) + 'px)'; }); c.hit = true; FXP.stop = now + 560; fxpHit(c, W); } c.el.style.transform = 'translateX(' + (c.x - 23).toFixed(1) + 'px)'; if (c.x > W + 40) { c.el.remove(); return false; } return true; }); }
  requestAnimationFrame(fxpTick);
  (function () { var sx = null; document.addEventListener('touchstart', function (e) { if (e.target.closest && e.target.closest('#fxp')) { sx = e.touches[0].clientX; } }, { passive: true });
    document.addEventListener('touchend', function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 40) { FXP.hold = Date.now() + 9000; fxpShow(FXP.k + (dx < 0 ? 1 : -1)); } }, { passive: true }); })();
  function machineSection() {
    FW.cnt[2] = FW.cnt[2] || 1840.5; FW.cnt[5] = FW.cnt[5] || 58210;
    var st = FST.map(function (x, k) { return '<div class="fx-st fx-s' + k + '" data-fst="' + k + '" style="--sc:' + x[2] + ';left:calc(2% + ' + (FSX[k] * .96).toFixed(2) + '%)"><div class="fx-house"><div class="fx-hd"><span class="fx-ico">' + FICO[k] + '</span><span class="fx-n mono">0' + (k + 1) + '</span></div><b class="fx-t">' + x[0] + '</b><small class="fx-sub">' + x[1] + '</small>' +
      fxMini(k) +
      (k === 0 ? '<span class="fx-press"></span>' : k === 3 ? '<span class="fx-laser"></span>' : k === 4 ? '<span class="fx-portal"></span>' : '') + '</div><span class="fx-leg"></span></div>'; }).join('');
    var cap = STS.map(function (x, k) { return '<button class="fx-cap" data-act="fwGo" data-arg="' + k + '" data-fcap="' + k + '"><span class="mono">0' + (k + 1) + '</span><b>' + x[0] + '</b><small>' + x[1] + '</small>' +
      (k === 5 ? '<span class="fx-jars">' + [['Creator', '#F5D9A8'], ['Holders', '#7FB6FF'], ['Burn', '#FF8A5B']].map(function (j, q) { return '<span class="fx-jar" style="--c:' + j[1] + '"><i data-jar="' + q + '"></i><em>' + j[0] + '</em></span>'; }).join('') + '</span>' : '') + '</button>'; }).join('');
    return '<section class="story card-s fx" id="machine"><div class="st2-head"><div><span class="kicker">HOW IT WORKS</span><h2 class="title-xl lab-title">The treid factory</h2></div><span class="muted st2-hint">watch a coin go from launch to tax payouts</span></div>' +
      fxPlayer() +
      '<div class="fx-scroll"><div class="fx-floor" id="fw-wheel"><div class="fx-belt"><span class="fx-tread"></span><span class="fx-roll l"></span><span class="fx-roll r"></span></div><div class="fx-coins" id="fx-coins"></div>' + st + '</div>' +
      '</div></section>';
  }
  function fxSpawn() {
    var box = document.getElementById('fx-coins'); if (!box) return;
    var t = pick(all()) || { buy: 2, sell: 2 }, r = Math.random(), tm = Math.max(t.buy, t.sell) || 2, el = document.createElement('div');
    el.className = 'fxc'; el.innerHTML = '<span class="fxc-ring"></span><span class="fxc-blank">?</span><span class="fxc-face">' + avatarHTML(t, 44) + '</span><span class="fxc-tax mono" style="background:' + taxBg(tm) + '">' + tm + '%</span><span class="fxc-cap">🎓</span><span class="fxc-flag"></span><span class="fxc-mc mono"></span>';
    box.appendChild(el); FW.coins.push({ el: el, x: -4, t: t, risky: r < .33, st: -1, mc: 5 });
  }
  function fxPop(c, txt, cls) { var box = document.getElementById('fx-coins'); if (!box) return; var e = document.createElement('span'); e.className = 'fxp ' + (cls || ''); e.textContent = txt; e.style.left = c.x + '%'; box.appendChild(e); setTimeout(function () { e.remove(); }, 1300); }
  function fxPressAt(c) { var st = document.querySelector('[data-fst="0"] .fx-house'); if (!st || !c.el) return; var sr = st.getBoundingClientRect(), cr = c.el.getBoundingClientRect(); var d = Math.max(10, cr.top - (sr.bottom + 10) + 12); st.style.setProperty('--pd', d.toFixed(0) + 'px'); var box = document.getElementById('fx-coins'), dx = (cr.left + cr.width / 2) - (sr.left + sr.width / 2); if (box && box.clientWidth) { var pc = dx / box.clientWidth * 100; FW.coins.forEach(function (o) { o.x -= pc; o.el.style.left = o.x + '%'; }); } c.el.classList.remove('squash'); void c.el.offsetWidth; c.el.classList.add('squash'); }
  function fxHit(k) { var e = document.querySelector('[data-fst="' + k + '"]'); if (!e) return; e.classList.remove('hit'); void e.offsetWidth; e.classList.add('hit'); var cp = document.querySelector('[data-fcap="' + k + '"]'); if (cp) { cp.classList.remove('hit'); void cp.offsetWidth; cp.classList.add('hit'); } }
  function fxStage(c, k) {
    c.st = k; var el = c.el; el.classList.add('s' + k); fxHit(k);
    var C = FW.cnt; if (k === 0) C[0]++; if (k === 1) C[1] += 1 + Math.floor(Math.random() * 3); if (k === 2) C[2] += 2 + Math.random() * 9; if (k === 3) C[3][c.risky ? 0 : 1]++; if (k === 4) C[4]++; if (k === 5) C[5] += 40 + Math.random() * 400; if (k !== 1) fxRead(k);
    if (k === 0) fxPop(c, 'minted', 'g');
    if (k === 1) { fxPop(c, '🤖 sniper −80%', 'r'); setTimeout(function () { if (el.isConnected) fxPop(c, '🙂 you −' + (Math.max(c.t.buy, c.t.sell) || 2) + '%', 'g'); }, 380); }
    if (k === 3) { var f = el.querySelector('.fxc-flag'); f.textContent = c.risky ? '⚠' : '✓'; f.className = 'fxc-flag ' + (c.risky ? 'r' : 'g'); fxPop(c, c.risky ? 'flagged · still tradable' : 'clean', c.risky ? 'r' : 'g'); }
    if (k === 4) fxPop(c, '→ Meteora', 'y');
    if (k === 5) { [0, 1, 2].forEach(function (q) { setTimeout(function () { FW.jars[q] = Math.min(100, FW.jars[q] + [5, 3.4, 2.4][q]); var j = document.querySelector('[data-jar="' + q + '"]'); if (j) j.style.height = (12 + FW.jars[q] * .88) + '%'; }, q * 160); }); fxPop(c, 'tax → creator · holders · burn', 'y'); if (FW.jars[0] >= 100) FW.jars = [20, 14, 10]; }
  }
  function fwCenter(k) { FW.hi = k; document.querySelectorAll('[data-fcap]').forEach(function (e) { e.classList.toggle('on', +e.getAttribute('data-fcap') === k); }); document.querySelectorAll('[data-fst]').forEach(function (e) { e.classList.toggle('on', +e.getAttribute('data-fst') === k); }); }
  function fwLoop(now) {
    var w = document.getElementById('fw-wheel'); if (!w) { FW.raf = 0; FW.el = null; FW.coins = []; return; }
    if (FW.el !== w) { FW.el = w; FW.coins = []; FW.lt = now; FW.spawn = 0; 
      for (var i = 0; i < 5; i++) { fxSpawn(); var c0 = FW.coins[FW.coins.length - 1]; c0.x = 88 - i * 21; for (var k = 0; k < 6; k++) if (c0.x > FSX[k]) { c0.st = k; c0.el.classList.add('s' + k); if (k === 3) { var f0 = c0.el.querySelector('.fxc-flag'); f0.textContent = c0.risky ? '⚠' : '✓'; f0.className = 'fxc-flag ' + (c0.risky ? 'r' : 'g'); } } } }
    var dt = Math.min(64, now - FW.lt); FW.lt = now;
    var cyc = (now % 4600) / 4600, sv = document.querySelector('[data-snv]');
    if (sv) { var k2 = Math.min(1, cyc / .7), tx = Math.round(80 - 78 * (1 - Math.pow(1 - k2, 2))), done = k2 >= 1; sv.textContent = tx + '%'; sv.style.color = done ? '#5BE6A8' : 'hsl(' + (355 + (1 - tx / 80) * 0) + ',90%,' + (62 + (1 - tx / 80) * 10) + '%)'; var sb = document.querySelector('[data-snb]'); sb.style.width = (tx / 80 * 100) + '%'; sb.style.background = done ? '#3DDC97' : ''; document.querySelector('[data-snl]').textContent = done ? 'normal tax ✓' : 'bots pay'; }
    if (!FW.paused && now >= (FW.halt || 0)) {
      FW.spawn -= dt; if (FW.spawn <= 0) { fxSpawn(); FW.spawn = 2900 + Math.random() * 900; }
      FW.coins.forEach(function (c) {
        c.x += dt * 0.0072;
        if (c.st < 0 && c.x >= FSX[0]) { var ov = c.x - FSX[0]; FW.coins.forEach(function (o) { o.x -= ov; }); fxPressAt(c); FW.halt = now + 560; }   // the belt stops while the press comes down: dead centre on the coin
        while (c.st < 5 && c.x >= FSX[c.st + 1]) fxStage(c, c.st + 1);
        var mcEl = c.el.querySelector('.fxc-mc');
        if (c.st >= 2) { var p = c.st >= 4 ? 1 : Math.min(1, (c.x - FSX[2]) / (FSX[4] - FSX[2])); var mc = c.st >= 4 ? gradK() + (c.x - FSX[4]) * 9 : 5 + p * (gradK() - 5); mcEl.textContent = '$' + mc.toFixed(0) + 'K'; c.el.style.setProperty('--p', (p * 100).toFixed(0)); }
        var lift = c.st >= 2 && c.st < 4 ? Math.sin(Math.min(1, (c.x - FSX[2]) / (FSX[4] - FSX[2])) * Math.PI) * 14 : 0;
        c.el.style.left = c.x + '%'; c.el.style.transform = 'translate(-50%,' + (-lift).toFixed(1) + 'px)';
        if (c.x > 103) { c.el.remove(); c.gone = true; }
      });
      FW.coins = FW.coins.filter(function (c) { return !c.gone; });
    }
    FW.raf = requestAnimationFrame(fwLoop);
  }
  function mbuyWatch() { var tb = document.querySelector('.tradebox'), mb = document.querySelector('.m-bar'); if (!tb || !mb || !window.IntersectionObserver) return; if (mbuyWatch.o) mbuyWatch.o.disconnect(); mbuyWatch.o = new IntersectionObserver(function (en) { mb.classList.toggle('hide', en[0].isIntersecting); }, { threshold: .15 }); mbuyWatch.o.observe(tb); }
  function fwKick() { if (!FW.raf && document.getElementById('fw-wheel')) FW.raf = requestAnimationFrame(fwLoop); }
  // ---------- conveyor + crane engine ----------
  var LC = [], lastSpawn = 0, LT = performance.now(), ARM = { busy: false };
  function spawnCoin(tok, forceRug) {
    var box = document.getElementById('coins'); if (!box) return;
    var src = tok || pick(all()), el = document.createElement('div'), rug = forceRug != null ? forceRug : (!tok && Math.random() < 0.3);
    var tx = rug ? 6 + Math.floor(Math.random() * 4) : Math.max(src.buy, src.sell);
    el.className = 'lcoin s0';
    el.innerHTML = '<span class="lc-raw">?</span><span class="lc-face">' + avatarHTML(src, 46) + '</span><span class="lc-tax" style="background:' + taxBg(tx) + '">' + tx + '%</span><span class="lc-mc mono">$5K</span><span class="lc-rug">RUG</span><span class="lc-ok">✓</span>';
    box.appendChild(el);
    var whale = !rug && Math.random() < 0.18; if (whale) el.classList.add('whale');
    LC.push({ el: el, x: 2, st: 0, mc: 5, tok: src, rug: rug, whale: whale, scanned: false, held: false, gone: false, nt: 0 });
  }
  function lineFx(kind, c, txt) {
    var line = document.getElementById('line'); if (!line || !c.el.isConnected) return;
    var lr = line.getBoundingClientRect(), er = c.el.getBoundingClientRect(), x = er.left + er.width / 2 - lr.left, y = er.top + er.height / 2 - lr.top;
    var e = document.createElement('span'); e.className = 'lfx ' + kind; e.style.left = x + 'px'; e.style.top = y + 'px';
    if (txt) e.textContent = txt;
    if (kind === 'spark' || kind === 'burst') { var n = kind === 'burst' ? 14 : 8, R = kind === 'burst' ? 70 : 34; for (var i = 0; i < n; i++) { var q = document.createElement('i'), a = i / n * 6.283; q.style.setProperty('--dx', (Math.cos(a) * R).toFixed(0) + 'px'); q.style.setProperty('--dy', (Math.sin(a) * R).toFixed(0) + 'px'); e.appendChild(q); } }
    line.appendChild(e); setTimeout(function () { e.remove(); }, kind === 'alarm' ? 1400 : 1200);
  }
  function stampMachine(id) { var m = document.getElementById('mach-' + id); if (!m) return; m.classList.remove('hit'); void m.offsetWidth; m.classList.add('hit'); }
  function setCount(id, v) { var e = document.getElementById(id); if (e) { e.textContent = v; e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); } }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function catchRug(c) {
    ARM.busy = true;
    var tro = document.getElementById('trolley'), cab = document.getElementById('cable'), claw = document.getElementById('claw'), hold = document.getElementById('claw-hold'), bin = document.getElementById('rugbin'), slot = document.getElementById('bin-slot');
    if (!tro || !cab || !claw || !hold || !bin || !slot) { ARM.busy = false; c.el.remove(); c.gone = true; return; }
    claw.classList.add('open');
    cab.style.height = '118px';
    wait(620).then(function () {
      claw.classList.remove('open'); claw.classList.add('grip');
      return wait(240);
    }).then(function () {
      c.el.classList.add('grabbed'); c.el.style.left = ''; hold.appendChild(c.el);
      cab.style.height = '26px';
      return wait(560);
    }).then(function () {
      tro.style.left = POS.bin + '%';
      setTimeout(function () { bin.classList.add('open'); }, 380);
      return wait(780);
    }).then(function () {
      cab.style.height = '36px';
      return wait(420);
    }).then(function () {
      claw.classList.remove('grip'); claw.classList.add('open');
      c.el.classList.remove('grabbed'); c.el.classList.add('inbin');
      c.el.style.left = '0'; c.el.style.top = '-54px';
      slot.appendChild(c.el);
      return wait(460);
    }).then(function () {
      c.el.remove(); c.gone = true; RUGS++;
      bin.classList.remove('open', 'thud'); void bin.offsetWidth; bin.classList.add('thud');
      setCount('rug-n', RUGS); setCount('ls-rug', RUGS);
      var pl = document.getElementById('bin-plus'); if (pl) { pl.classList.remove('go'); void pl.offsetWidth; pl.classList.add('go'); }
      cab.style.height = '26px';
      return wait(420);
    }).then(function () {
      claw.classList.remove('open');
      tro.style.left = POS.pick + '%';
      return wait(760);
    }).then(function () { ARM.busy = false; });
  }
  (function lineLoop(now) {
    var dt = Math.min(50, now - LT); LT = now;
    var box = document.getElementById('coins');
    if (box && S.screen === 'home') {
      if (now - lastSpawn > 1700) { lastSpawn = now; spawnCoin(); }
      LC = LC.filter(function (c) { return !c.gone && (c.el.isConnected || c.held); });
      var belt = LC.filter(function (c) { return !c.held || !c.el.classList.contains('grabbed'); }).sort(function (a, b) { return b.x - a.x; });
      for (var i = 0; i < belt.length; i++) {
        var c = belt[i]; if (c.st >= 4) continue;
        var ahead = i > 0 ? belt[i - 1] : null, blocked = ahead && ahead.st < 4 && ahead.x - c.x < 5.2;
        if (c.held) {
          if (!ARM.busy && !c.el.classList.contains('grabbed')) catchRug(c);
          continue;
        }
        if (!blocked) {
          var slow = 0; [POS.press, POS.tax, POS.scan, POS.pump].forEach(function (mx) { if (Math.abs(c.x - mx) < 1.6) slow = 1; });
          c.x += dt * (slow ? 0.0026 : 0.0082);
        }
        if (!c.scanned && c.x >= POS.scan) {
          c.scanned = true; stampMachine('scan');
          c.el.classList.add(c.rug ? 'rug' : 'clean'); lineFx(c.rug ? 'alarm' : 'ok', c);
          if (!c.rug) { CLEAN++; setCount('ls-ok', CLEAN); }
        }
        if (c.rug && c.scanned && c.x >= POS.pick) { c.x = POS.pick; c.held = true; }
        var st = c.x < POS.press ? 0 : c.x < POS.tax ? 1 : c.x < POS.pump ? 2 : c.x < POS.launch ? 3 : 4;
        if (st !== c.st) {
          c.st = st; c.el.classList.remove('s0', 's1', 's2', 's3', 's4'); c.el.classList.add('s' + st);
          stampMachine(['', 'press', 'tax', 'pump', 'launch'][st]);
          if (st === 1) lineFx('spark', c);
          if (st === 2) lineFx('stamp', c, 'TAX ' + c.el.querySelector('.lc-tax').textContent);
          if (st === 4) { lineFx('burst', c); c.el.classList.add('blast'); }
          if (st === 4) { (function (cc) { setTimeout(function () { cc.el.remove(); cc.gone = true; }, 1300); })(c); }
        }
        if (st === 3 && (c.nt -= dt) <= 0) { c.nt = 260 + Math.random() * 260; var gain = (c.whale ? 4 : 1) * (0.4 + Math.random() * 2.2); lineFx('num', c, '+' + gain.toFixed(1) + ' SOL'); c.el.classList.remove('hop'); void c.el.offsetWidth; c.el.classList.add('hop'); }
        if (st === 3) { c.mc += dt * 0.09 * (c.whale ? 2.2 : 1) * (1 + c.mc / 60); var mcEl = c.el.querySelector('.lc-mc'); if (mcEl) mcEl.textContent = fmtK(c.mc); c.el.style.setProperty('--grow', Math.min(1.35, 1 + (c.x - POS.pump) / 50)); }
        if (st < 4) c.el.style.left = c.x + '%';
      }
    } else if (!box && LC.length) { LC = []; ARM.busy = false; }
    requestAnimationFrame(lineLoop);
  })(LT);

  function mSetStep(i) {
    M.step = (i + MSTEPS.length) % MSTEPS.length;
    document.querySelectorAll('.fpanel').forEach(function (p, k) { p.classList.toggle('here', k === M.step); });
  }
  function mFit() {}
  setInterval(function () { if (M.paused > 0) M.paused -= 500; }, 500);
  // rider loop: travels the belt, lighting each station as it passes
  var riderT = performance.now();
  (function ride(now) {
    var dt = Math.min(64, now - riderT); riderT = now;
    var r = document.getElementById('f-rider');
    if (r && S.screen === 'home') {
      if (M.paused > 0) M.paused -= dt; else M.pos += dt / 140;
      if (M.pos >= 100) {
        M.pos = 0; var pool = all(); r.innerHTML = avatarHTML(pool[Math.floor(Math.random() * pool.length)], 40);
        var rk = document.getElementById('f-rocket'); if (rk) { rk.classList.remove('launch'); void rk.offsetWidth; rk.classList.add('launch'); }
      }
      r.style.left = M.pos + '%';
      var st = Math.min(4, Math.floor(M.pos / 20));
      if (st !== M.step) { mSetStep(st); r.classList.remove('hop'); void r.offsetWidth; r.classList.add('hop'); }
    }
    requestAnimationFrame(ride);
  })(riderT);
  function onHome() { return S.screen === 'home' && document.getElementById('machine'); }
  function setTxt(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  function machineTrade(t, tr) {
    if (!onHome()) return;
    var rain = document.getElementById('f-rain');
    if (rain) {
      var c = document.createElement('span');
      c.className = 'fcoin ' + (tr.side === 'buy' ? 'b' : 's');
      c.style.left = (15 + Math.random() * 70) + '%';
      c.style.setProperty('--sz', Math.max(14, Math.min(30, 12 + tr.sol * 5)) + 'px');
      c.textContent = tr.side === 'buy' ? '+' : '−';
      rain.appendChild(c); setTimeout(function () { c.remove(); }, 1300);
    }
    var ht = hotToken(), hp = hillPos(ht.prog), cl = document.getElementById('f-climb');
    if (cl) { if (cl.getAttribute('data-tk') !== ht.tick) { cl.innerHTML = avatarHTML(ht, 38); cl.setAttribute('data-tk', ht.tick); } cl.style.left = hp.x + '%'; cl.style.bottom = hp.y + '%'; }
    setTxt('fs-climb', '$' + ht.tick + ' is ' + ht.prog.toFixed(0) + '% up');
    if (tr.tax > 0) {
      M.tax += tr.tax; M.creators += tr.tax * 0.5; M.holders += tr.tax * 0.3; M.vault += tr.tax * 0.2;
      var pg = document.getElementById('pump-g'); if (pg) pg.style.height = (30 + Math.random() * 70) + '%';
      ['creators', 'holders', 'vault'].forEach(function (k) { var e = document.getElementById('fj-' + k); if (e) { e.style.height = jarH(M[k]) + '%'; e.parentNode.classList.remove('drip'); void e.offsetWidth; e.parentNode.classList.add('drip'); } });
      setTxt('fs-jar', M.tax.toFixed(2) + ' SOL shared');
    }
  }
  function machineLaunch(t) {
    M.launched++;
    if (!onHome()) return;
    spawnCoin(t);
    setTxt('fs-make', fmtNum(M.launched) + ' coins made');
  }
  function machineGrad(t) {
    M.grad++;
    if (!onHome()) return;
    var rk = document.getElementById('f-rocket');
    if (rk) { var w = rk.querySelector('.rk-win'); if (w) w.innerHTML = avatarHTML(t, 26); rk.classList.remove('launch'); void rk.offsetWidth; rk.classList.add('launch'); }
    setTxt('fs-blast', M.grad + ' coins graduated');
  }

  // ================= MOTION & DRAG ENGINE =================
  var suppressClick = false;
  window.addEventListener('click', function (e) { if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); } }, true);

  // --- drag-to-scroll rows with momentum ---
  var ds = null;
  document.addEventListener('pointerdown', function (e) {
    var row = e.target.closest && e.target.closest('.drag-scroll');
    if (!row || e.pointerType === 'touch' || e.button !== 0) return;
    ds = { row: row, x: e.clientX, left: row.scrollLeft, v: 0, lx: e.clientX, lt: performance.now(), moved: false };
  });
  document.addEventListener('pointermove', function (e) {
    if (!ds) return;
    var dx = e.clientX - ds.x;
    if (Math.abs(dx) > 5) { ds.moved = true; ds.row.classList.add('dragging'); }
    if (!ds.moved) return;
    ds.row.scrollLeft = ds.left - dx;
    var now = performance.now(); ds.v = (e.clientX - ds.lx) / Math.max(1, now - ds.lt); ds.lx = e.clientX; ds.lt = now;
  });
  document.addEventListener('pointerup', function () {
    if (!ds) return;
    var d = ds; ds = null; d.row.classList.remove('dragging');
    if (d.moved) {
      suppressClick = true; setTimeout(function () { suppressClick = false; }, 60);
      var v = d.v * 16;
      (function glide() { if (Math.abs(v) < 0.4) return; d.row.scrollLeft -= v; v *= 0.93; requestAnimationFrame(glide); })();
    }
  });

  // --- vertical drag-scroll for race lanes ---
  var vs = null;
  document.addEventListener('pointerdown', function (e) {
    var box = e.target.closest && e.target.closest('#lanes-scroll'); if (!box || e.pointerType === 'touch' || e.button !== 0) return;
    vs = { box: box, y: e.clientY, top: box.scrollTop, v: 0, ly: e.clientY, lt: performance.now(), moved: false };
  });
  document.addEventListener('pointermove', function (e) {
    if (!vs) return; var dy = e.clientY - vs.y;
    if (Math.abs(dy) > 5) { vs.moved = true; vs.box.classList.add('dragging'); }
    if (!vs.moved) return;
    vs.box.scrollTop = vs.top - dy; var now = performance.now(); vs.v = (e.clientY - vs.ly) / Math.max(1, now - vs.lt); vs.ly = e.clientY; vs.lt = now;
  });
  document.addEventListener('pointerup', function () {
    if (!vs) return; var d = vs; vs = null; d.box.classList.remove('dragging');
    if (d.moved) { suppressClick = true; setTimeout(function () { suppressClick = false; }, 60); var v = d.v * 16; (function glide() { if (Math.abs(v) < 0.4) return; d.box.scrollTop -= v; v *= 0.94; requestAnimationFrame(glide); })(); }
  });
  // --- swipe deck ---
  var sw = null;
  function topCard() { return document.querySelector('.swipe-card.top'); }
  function flyOut(dir) {
    var c = topCard(); if (!c || c.classList.contains('gone')) return;
    var tick = c.getAttribute('data-swipe'), t = find(tick);
    c.classList.add('gone');
    c.style.transition = 'transform .38s cubic-bezier(.3,.7,.3,1), opacity .38s';
    c.style.transform = dir === 'right' ? 'translate(140%, -6%) rotate(24deg)' : dir === 'left' ? 'translate(-140%, -6%) rotate(-24deg)' : 'translate(0, -130%) rotate(-4deg)';
    c.style.opacity = '0';
    var st = c.querySelector(dir === 'right' ? '.stamp.like' : dir === 'left' ? '.stamp.nope' : '.stamp.go'); if (st) st.style.opacity = 1;
    setTimeout(function () {
      if (dir === 'right' && t) {
        if (S.watch.indexOf(tick) === -1) { S.watch = S.watch.concat([tick]); try { localStorage.setItem(LS.watch, JSON.stringify(S.watch)); } catch (er) {} }
        toast('Added $' + tick + ' to your watchlist', t);
      }
      S.deckIdx = (S.deckIdx + 1) % deckList().length;
      if (dir === 'up' && t) { openToken(tick); return; }
      var deck = document.getElementById('deck'); if (deck) deck.innerHTML = deckHTML();
      var sc = document.getElementById('swipe-count'); if (sc) sc.textContent = S.watch.length + ' on your watchlist';
    }, 340);
  }
  document.addEventListener('pointerdown', function (e) {
    var c = e.target.closest && e.target.closest('.swipe-card.top');
    if (!c || c.classList.contains('gone')) return;
    sw = { c: c, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    c.style.transition = 'none'; c.setPointerCapture && c.setPointerCapture(e.pointerId);
    c.classList.add('grab');
  });
  document.addEventListener('pointermove', function (e) {
    if (!sw) return;
    sw.dx = e.clientX - sw.x; sw.dy = e.clientY - sw.y;
    sw.c.style.transform = 'translate(' + sw.dx + 'px,' + sw.dy + 'px) rotate(' + (sw.dx * 0.07) + 'deg)';
    var like = sw.c.querySelector('.stamp.like'), nope = sw.c.querySelector('.stamp.nope'), go = sw.c.querySelector('.stamp.go');
    like.style.opacity = Math.max(0, Math.min(1, sw.dx / 110));
    nope.style.opacity = Math.max(0, Math.min(1, -sw.dx / 110));
    go.style.opacity = Math.max(0, Math.min(1, (-sw.dy - Math.abs(sw.dx)) / 110));
  });
  document.addEventListener('pointerup', function () {
    if (!sw) return;
    var s2 = sw; sw = null; s2.c.classList.remove('grab');
    var moved = Math.abs(s2.dx) + Math.abs(s2.dy) > 8;
    if (moved) { suppressClick = true; setTimeout(function () { suppressClick = false; }, 60); }
    if (s2.dx > 110) return flyOut('right');
    if (s2.dx < -110) return flyOut('left');
    if (s2.dy < -110) return flyOut('up');
    s2.c.style.transition = 'transform .5s cubic-bezier(.2,1.6,.4,1)';
    s2.c.style.transform = '';
    s2.c.querySelectorAll('.stamp').forEach(function (x) { x.style.opacity = 0; });
    if (!moved) openToken(s2.c.getAttribute('data-swipe'));
  });

  // --- bubbles physics ---
  var bd = null;
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest && e.target.closest('.bubble');
    if (!el) return;
    var tick = el.getAttribute('data-bub'), b = BUB[tick]; if (!b) return;
    var box = document.getElementById('bubbles').getBoundingClientRect();
    bd = { tick: tick, b: b, ox: e.clientX - box.left - b.x, oy: e.clientY - box.top - b.y, sx: e.clientX, sy: e.clientY, moved: false, lx: e.clientX, ly: e.clientY, lt: performance.now() };
    b.drag = true; el.classList.add('grab');
    e.preventDefault();
  });
  document.addEventListener('pointermove', function (e) {
    if (!bd) return;
    var box = document.getElementById('bubbles'); if (!box) { bd = null; return; }
    var r = box.getBoundingClientRect(), b = bd.b;
    if (Math.abs(e.clientX - bd.sx) + Math.abs(e.clientY - bd.sy) > 6) bd.moved = true;
    var now = performance.now(), dt = Math.max(1, now - bd.lt);
    b.vx = (e.clientX - bd.lx) / dt * 16; b.vy = (e.clientY - bd.ly) / dt * 16;
    bd.lx = e.clientX; bd.ly = e.clientY; bd.lt = now;
    b.x = e.clientX - r.left - bd.ox; b.y = e.clientY - r.top - bd.oy;
  });
  document.addEventListener('pointerup', function () {
    if (!bd) return;
    var d = bd; bd = null; d.b.drag = false;
    var el = document.querySelector('.bubble[data-bub="' + d.tick + '"]'); if (el) el.classList.remove('grab');
    if (d.moved) { suppressClick = true; setTimeout(function () { suppressClick = false; }, 60); }
    else openToken(d.tick);
  });
  (function physics() {
    var box = document.getElementById('bubbles');
    if (box) {
      var W = box.clientWidth, H = box.clientHeight, els = box.querySelectorAll('.bubble'), arr = [];
      els.forEach(function (el) {
        var tick = el.getAttribute('data-bub'), t = find(tick); if (!t) return;
        var r = bubR(t), b = BUB[tick];
        if (!b) { b = BUB[tick] = { x: rnd(r, W - r), y: rnd(r, H - r), vx: rnd(-1, 1), vy: rnd(-1, 1) }; }
        b.r = r; b.el = el; arr.push(b);
      });
      for (var i = 0; i < arr.length; i++) {
        var a = arr[i];
        if (!a.drag) {
          a.vx += (W / 2 - a.x) * 0.00035; a.vy += (H / 2 - a.y) * 0.00035;
          a.vx += Math.sin(performance.now() / 1400 + i) * 0.012;
          a.vx *= 0.985; a.vy *= 0.985;
        }
        for (var j = i + 1; j < arr.length; j++) {
          var o = arr[j], dx = o.x - a.x, dy = o.y - a.y, dist = Math.sqrt(dx * dx + dy * dy) || 1, min = a.r + o.r + 4;
          if (dist < min) {
            var push = (min - dist) / 2, nx = dx / dist, ny = dy / dist;
            if (!a.drag) { a.x -= nx * push; a.y -= ny * push; a.vx -= nx * push * 0.08; a.vy -= ny * push * 0.08; }
            if (!o.drag) { o.x += nx * push; o.y += ny * push; o.vx += nx * push * 0.08; o.vy += ny * push * 0.08; }
          }
        }
      }
      arr.forEach(function (b) {
        if (!b.drag) { b.x += b.vx; b.y += b.vy; }
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.7; } if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.7; }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.7; } if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.7; }
        b.el.style.transform = 'translate(' + (b.x - b.r).toFixed(1) + 'px,' + (b.y - b.r).toFixed(1) + 'px)';
      });
    }
    requestAnimationFrame(physics);
  })();

  // --- 3D tilt cards + magnetic buttons ---
  document.addEventListener('mousemove', function (e) {
    var card = e.target.closest && e.target.closest('.tcard, .cat, .swipe-sec .sbtn');
    if (card && card.classList.contains('tcard')) {
      var r = card.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = 'perspective(900px) rotateX(' + (-py * 7).toFixed(2) + 'deg) rotateY(' + (px * 9).toFixed(2) + 'deg) translateY(-4px)';
    } else if (card && card.classList.contains('cat')) {
      var r2 = card.getBoundingClientRect(), qx = (e.clientX - r2.left) / r2.width - 0.5, qy = (e.clientY - r2.top) / r2.height - 0.5;
      card.style.transform = 'perspective(700px) rotateX(' + (-qy * 10).toFixed(2) + 'deg) rotateY(' + (qx * 12).toFixed(2) + 'deg) translateY(-4px)';
    }
    var m = e.target.closest && e.target.closest('.btn.pri, .sbtn');
    if (m) { var r3 = m.getBoundingClientRect(); m.style.transform = 'translate(' + ((e.clientX - r3.left - r3.width / 2) * 0.18).toFixed(1) + 'px,' + ((e.clientY - r3.top - r3.height / 2) * 0.25).toFixed(1) + 'px)'; }
  });
  document.addEventListener('mouseout', function (e) {
    var el = e.target.closest && e.target.closest('.tcard, .cat, .btn.pri, .sbtn');
    if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) el.style.transform = '';
  });

  // --- reveal on scroll ---
  var seen = {};
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (ents) {
    ents.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target; io.unobserve(el);
      var k = el.getAttribute('data-card'); if (k) seen[S.screen + k] = 1;
      setTimeout(function () { el.classList.add('in'); }, (+el.getAttribute('data-i') || 0) * 45);
    });
  }, { rootMargin: '0px 0px -40px 0px' }) : null;
  function reveal() {
    var n = 0;
    document.querySelectorAll('.tcard[data-card], .reveal-me').forEach(function (el) {
      var k = el.getAttribute('data-card');
      if (!io || (k && seen[S.screen + k])) { el.classList.add('in', 'instant'); return; }
      el.classList.add('rv'); el.setAttribute('data-i', (n++) % 8); io.observe(el);
    });
  }

  render();
  // ================= LIVE CHAIN DATA (treid indexer) =================
  // Real coins launched on treid come from the indexer API. Without an API the site runs as a pure demo.
  // Set it with ?api=https://your-indexer (remembered), or window.TREID_API in index.html. ?api= (empty) clears it.
  var API_DEV = devOverride('api', 'api'), API = (API_DEV || window.TREID_API || '').replace(/\/+$/, '');
  if (window.TREID_PARTNER) S.escrowWallet = window.TREID_PARTNER;
  S.api = API; S.apiOk = false;
  function apiGet(path) { return fetch(API + path, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function liveStat(t, c) { if (c.tax_paid) t.taxPaid = c.tax_paid; t.lstat = { dev: c.dev_pct || 0, top: c.top10_pct || 0, sn: c.snipers_pct || 0, bu: c.bundles_pct || 0, devSold: !!c.dev_sold }; }
  function safeImg(u) { return typeof u === 'string' && (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(u) || /^https:\/\/[^\s"'<>\\]+$/.test(u)) ? u : null; }
  function trustedMeta(u) { try { var h = new URL(u).hostname; return /\/ipfs\//.test(u) && (h === 'gateway.pinata.cloud' || /\.mypinata\.cloud$/.test(h) || h === 'ipfs.io'); } catch (e) { return false; } }
  function liveTok(c) {
    if (c.sol_usd) SOL_USD = c.sol_usd;
    var t = S.live.filter(function (x) { return x.ca === c.mint; })[0];
    if (!t) {
      var tick = (c.symbol || 'COIN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'COIN', base = tick, n = 2;
      while (find(tick)) tick = base + n++;
      var r = rng(hash(c.mint)), pk = function (a) { return a[Math.floor(r() * a.length)]; }, tax = Math.round((c.tax_bps || 0) / 100), mc = (c.mcap_usd || 0) / 1000 || 3;
      t = { live: true, name: c.name || tick, tick: tick, spec: { kind: pk(A.KINDS), skin: pk(A.SKINS), bg: pk(A.BGS), eyes: pk(A.EYES), mouth: pk(A.MOUTHS), acc: pk(A.ACCS) },
        buy: tax, sell: tax, split: null, pair: 'SOL', mcN: mc, mc0: mc, prog: c.curve_pct || 0, born: c.created_at || Date.now(), holders: c.holders || 0, soc: false, links: { demo: false }, rewards: false, burn: false,
        ca: c.mint, creator: c.creator, vol: (c.vol_sol || 0) * SOL_USD / 1000, hist: [mc, mc], desc: '', pool: c.pool };
      if (c.quote_mint && c.quote_mint !== WSOL) { t.qMint = c.quote_mint; t.qDec = c.quote_dec; t.pair = qReg(c.quote_symbol, c.quote_mint); t.qSym = c.quote_symbol || t.pair; }
      if (c.reserve != null) t.reserve = c.reserve;
      if (c.trap_bps) t.snipe = { on: true, start: Math.round(c.trap_bps / 100), dur: c.trap_secs || 30 };
      S.live.push(t); S.live.sort(function (a, b) { return b.born - a.born; });
      if (!DEMO) { HERO.length = 0; S.live.slice().sort(function (a, b) { return b.mcN - a.mcN; }).slice(0, 5).forEach(function (x) { HERO.push(x.tick); }); }
    } else { t.mcN = (c.mcap_usd || 0) / 1000 || t.mcN; t.prog = c.curve_pct || t.prog; t.holders = c.holders != null ? c.holders : t.holders; t.vol = (c.vol_sol || 0) * SOL_USD / 1000; }
    if (c.reserve != null) t.reserve = c.reserve;
    if (t.qMint) { if (c.quote_usd) t.qUsd = c.quote_usd; if (c.vol_usd != null) t.vol = c.vol_usd / 1000; }
    liveStat(t, c);
    if ('vamp' in c) t.vamp = c.vamp && typeof c.vamp.mint === 'string' ? { mint: c.vamp.mint, symbol: String(c.vamp.symbol || ''), name: String(c.vamp.name || '') } : null;
    if (c.uri && !t._uri) { t._uri = 1; var pu = parseUri(c.uri); if (pu.spec) t.spec = pu.spec; if (pu.split) t.split = pu.split; if (pu.rw) t.rw = pu.rw;
      if (pu.x || pu.t || pu.w) { t.soc = true; t.links = { demo: false, x: pu.x ? xLink(pu.x) : null, tg: pu.t ? tgLink(pu.t) : null, web: pu.w ? linkOf(pu.w) : null }; }
      if (!t.img && API) t.img = API + '/api/img/' + c.mint;   // served + cached by our server (IPFS gateways are slow)
      if (!t.img) { try { var cimg = safeImg(localStorage.getItem('dl.img.' + c.mint)); if (cimg) t.img = cimg; } catch (e) {} }
      var viaApi = function () { return API ? apiGet('/api/meta/' + c.mint) : Promise.reject(); };
      (trustedMeta(c.uri) ? fetch(c.uri.split('?')[0]).then(function (r) { if (!r.ok) throw new Error('meta ' + r.status); return r.json(); }).catch(viaApi) : viaApi()).then(function (m) { var ch = false; if (m && safeImg(m.image)) { try { localStorage.setItem('dl.img.' + c.mint, safeImg(m.image)); } catch (e) {} } if (m && safeImg(m.image) && !t.img) { t.img = safeImg(m.image); ch = true; } if (m && m.description && !t.desc) { t.desc = m.description; ch = true; } if (m && safeImg(m.banner) && !t.banner) { t.banner = API ? API + '/api/img/' + c.mint + '?b=1' : safeImg(m.banner); ch = true; } if (ch) render(); }).catch(function () { setTimeout(function () { t._uri = 0; }, 15000); }); }
    return t;
  }
  function liveLoad(t) {
    Promise.all([apiGet('/api/trades/' + t.ca), apiGet('/api/holders/' + t.ca).catch(function () { return null; }), apiGet('/api/coin/' + t.ca)]).then(function (res) {
      var rows = res[0].slice().reverse(); liveTok(res[2]);
      S.trades = S.trades.filter(function (x) { return x.tick !== t.tick; });
      rows.forEach(function (x) { S.trades.push({ tick: t.tick, usd: Number(x.usd) || 0, side: x.side === 'sell' ? 'sell' : 'buy', sol: Number(x.sol) || 0, wallet: String(x.wallet), t: Number(x.ts) || 0, tax: x.fee_sol, mine: !!(S.account && x.wallet === S.account), price: x.price_usd, sig: x.sig, tokens: x.tokens, sniper: x.sniper, bundle: x.bundle, real: true }); });
      S.trades.sort(function (a, b) { return b.t - a.t; });
      t.tk = rows.length ? [[t.born, rows[0].mcap_usd / 1000, 0]].concat(rows.map(function (x) { return [x.ts, x.mcap_usd / 1000, x.sol]; })) : [[t.born, t.mcN, 0], [Date.now(), t.mcN, 0]];
      t.tk.push([Date.now(), t.mcN, 0]); t.hist = t.tk.slice(-160).map(function (x) { return x[1]; });
      if (res[1]) t.lh = res[1];
      if (!t.auth) rpc('getAccountInfo', [t.ca, { encoding: 'jsonParsed', commitment: 'confirmed' }]).then(function (r) { var inf = r && r.value && r.value.data && r.value.data.parsed && r.value.data.parsed.info; if (inf) { var tfx = (inf.extensions || []).filter(function (x) { return x.extension === 'transferFeeConfig'; })[0], bps = tfx ? Number((tfx.state.newerTransferFee || {}).transferFeeBasisPoints || 0) : 0; t.auth = { mint: !inf.mintAuthority, freeze: !inf.freezeAuthority, taxBps: bps }; t.buy = t.sell = bps / 100; if (S.screen === 'token' && S.tick === t.tick) render(); } }).catch(function () {});
      livePos(t); if (t.qMint && S.account) chainLib().then(function (T) { return T.tokenBalance({ rpc: RPC, owner: S.account, mint: t.qMint }); }).then(function (b) { t.qBal = b; if (S.screen === 'token' && S.tick === t.tick) render(); }).catch(function () {});
      chainLib().then(function (T) { return T.creatorFees({ rpc: RPC, pool: t.pool }); }).then(function (f) { t.crFees = f; if (S.screen === 'token' && S.tick === t.tick) render(); }).catch(function () {});
      apiGet('/api/callouts?mint=' + t.ca).then(function (rows) { if (coMerge(rows).length && S.screen === 'token' && S.tick === t.tick) render(); }).catch(function () {});
      apiGet('/api/creator/' + t.ca).then(function (e) { t.esc = e; if (S.screen === 'token' && S.tick === t.tick) render(); }).catch(function () {});
      if (S.screen === 'token' && S.tick === t.tick) render();
    }).catch(function (e) { console.warn('[treid] live load failed', e); });
  }
  function liveTrade(x) {
    var t = S.live.filter(function (y) { return y.ca === x.mint; })[0];
    if (!t) { apiGet('/api/coin/' + x.mint).then(function (c) { if (c) { liveTok(c); render(); } }).catch(function () {}); return; }
    if (S.trades.some(function (y) { return y.sig === x.sig; })) return;
    applyTrade(t, x.side, x.sol, x.wallet, false, { mc: x.mcap_usd / 1000, prog: x.progress || t.prog, ts: x.ts, tokens: x.tokens, fee: x.fee_sol, sig: x.sig, sniper: x.sniper, bundle: x.bundle, usd: x.usd });
    if (S.screen === 'token' && S.tick === t.tick) { clearTimeout(t._lr); t._lr = setTimeout(function () { liveLoad(t); }, 1500); }   // refresh holders/risk after the dust settles
    else { clearTimeout(t._ls); t._ls = setTimeout(function () { apiGet('/api/coin/' + t.ca).then(function (c) { liveTok(c); var el = document.querySelector('.tcard[data-card="' + t.tick + '"]'); if (el && !el.matches(':hover')) el.outerHTML = card(t); }).catch(function () {}); }, 1500); }
  }
  function liveStart() {
    if (!API) return;
    apiGet('/api/health').then(function (h) { if (!h || !h.ops) return; if (!window.TREID_PARTNER || API_DEV) { PARTNER = h.ops; S.escrowWallet = h.ops; } else if (h.ops !== window.TREID_PARTNER) { S.opsMismatch = true; console.warn('[treid] server ops wallet does not match the pinned one — launching disabled'); render(); } }).catch(function () {});
    apiGet('/api/coins').then(function (cs) {
      S.apiOk = true; cs.filter(Boolean).forEach(liveTok); render();
      var coAll = function (n) { apiGet('/api/callouts').then(function (rows) { if (coMerge(rows || []).length) render(); }).catch(function () { if (n < 6) setTimeout(function () { coAll(n + 1); }, 5000 * (n + 1)); }); }; coAll(0); setInterval(function () { if (!document.hidden) coAll(6); }, 60e3);   // retried: a server restart must not leave the callouts empty
      if (S.pendingRoute) { var pr = S.pendingRoute, tp = S.live.filter(function (x) { return x.ca === pr || x.tick.toUpperCase() === String(pr).toUpperCase(); })[0]; S.pendingRoute = null; var rr = routeReady; routeReady = false; var psite = S.pendingSite, pco = S.pendingCo; S.pendingSite = null; S.pendingCo = null; if (tp && pco != null) { liveLoad(tp); S.tick = tp.tick; set({ screen: 'callout', coView: { tick: tp.tick, id: pco } }); } else if (tp && psite) { liveLoad(tp); set({ screen: 'site', site: { tick: tp.tick, th: psite } }); } else if (tp) openToken(tp.tick); else { set({ screen: 'home' }); toast('That coin wasn\'t found'); } routeReady = rr; }
      var es = new EventSource(API + '/api/stream');
      es.onmessage = function (m) { var ev; try { ev = JSON.parse(m.data); } catch (e) { return; } if (ev.type === 'callout') { coMerge([ev]).forEach(function (x) { coArrive(x.c, x.t); if (!(S.account && x.c.w === S.account)) coPeek(x.c, x.t); }); } else if (ev.type === 'burn') burnsLoad(); else if (ev.type === 'trade') liveTrade(ev); else if (ev.type === 'coin') apiGet('/api/coin/' + ev.mint).then(function (c) { if (c) { var known = S.live.some(function (x) { return x.ca === c.mint; }), t = liveTok(c); if (!known && !isMob()) toast('New on treid: ' + t.name + ' $' + t.tick, t); render(); } }).catch(function () {}); };
      es.onerror = function () { S.apiOk = es.readyState === 1; };
      es.onopen = function () { S.apiOk = true; apiGet('/api/coins').then(function (cs2) { cs2.filter(Boolean).forEach(liveTok); }).catch(function () {}); };
    }).catch(function (e) { console.warn('[treid] indexer not reachable at', API, e); });
  }
  liveStart();
  if (!RPC_DEV) rpc('getGenesisHash', []).then(function (g) { if (g !== GENESIS[CHAIN_ID]) { S.netBad = true; render(); console.warn('[treid] RPC network mismatch'); } }).catch(function () {});
  setInterval(function () { if (S.screen === 'burn' && !document.hidden) burnsLoad(); }, 30000);
  dlResume(); if (isMob() && !window.TreidChain) setTimeout(function () { chainLib().catch(function () {}); }, 1500);   // phones: preload so the wallet hand-off starts instantly
  applyRoute(); render();   // same tick as the first paint → no flash of the board on refresh

  setTimeout(function () { S.loading = false; render(); routeReady = true; syncRoute(); }, 850);
})();
