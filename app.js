/* treid — no build step, no dependencies.
   Real: Solana wallet connection (Wallet Standard) + devnet SOL balance & airdrop.
   Simulated: tokens, prices, trades, launches (clearly marked as beta/simulated in the footer). */
(function () {
  'use strict';
  var A = window.Avatars;

  // ================= CONFIG =================
  var RPC = 'https://api.devnet.solana.com';
  var CLUSTER = 'devnet';
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
  function fakeCA(suf) { suf = suf || 'treid'; return b58(44 - suf.length) + suf; }
  function short(a) { return a ? a.slice(0, 4) + '…' + a.slice(/treid$/.test(a) ? -5 : -4) : ''; }
  function taxBg(t) { return t === 0 ? 'var(--up)' : t <= 3 ? 'var(--yellow)' : t <= 6 ? 'var(--orange)' : 'var(--pink)'; }
  function fmtK(k) { return k >= 1000 ? '$' + (k / 1000).toFixed(2) + 'M' : k >= 100 ? '$' + k.toFixed(0) + 'K' : '$' + k.toFixed(1) + 'K'; }
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
  function chgTxt(c) { return (c >= 0 ? '+' : '') + c.toFixed(1) + '%'; }
  function ago(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + 's'; var m = Math.floor(s / 60); if (m < 60) return m + 'm';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h'; return Math.floor(h / 24) + 'd';
  }
  function fmtNum(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n).toString(); }
  function avatarHTML(t, size) {
    var inner = t.img ? '<img src="' + esc(t.img) + '" alt="">' : A.svg(t.spec);
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
  [['USDT', 'Tether', 'usdt'], ['BNB', 'BNB', 'bnb'], ['XRP', 'XRP', 'xrp'], ['DOGE', 'Dogecoin', 'doge'], ['LINK', 'Chainlink', 'link'], ['AVAX', 'Avalanche', 'avax'], ['AAVE', 'Aave', 'aave'], ['RAY', 'Raydium', 'ray']].forEach(function (x) { PAIR_INFO[x[0]] = { img: 'icons/' + x[2] + '.svg', name: x[1], cat: 'crypto', g: x[0][0], c: '#888' }; });
  PAIR_INFO.ONDO = { name: 'Ondo', cat: 'crypto', g: 'ON', c: '#C9D5FF' };
  var PAIRS = Object.keys(PAIR_INFO);
  function pairInfo(id) { if (PAIR_INFO[id]) return PAIR_INFO[id]; var t = find(id); return { name: t ? t.name : id, cat: 'memes', g: '', c: '#FF6B8B', meme: t }; }
  function pairLabel(id) { return PAIR_INFO[id] ? id : '$' + id; }
  function coinHTML(id, size) {
    var p = pairInfo(id);
    if (p.meme) return '<span class="coin meme" style="width:' + size + 'px;height:' + size + 'px">' + avatarHTML(p.meme, size) + '</span>';
    if (p.img) return '<span class="coin img" style="width:' + size + 'px;height:' + size + 'px"><img src="' + p.img + '" alt="' + esc(p.name) + '"></span>';
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
  try {
    var saved = JSON.parse(localStorage.getItem(LS.created) || '[]');
    saved.forEach(function (t) { if (t && t.tick && t.spec) { t.hist = [t.mcN, t.mcN]; if (t.ca && /dmnd$/.test(t.ca)) t.ca = t.ca.slice(0, 39) + 'treid'; S.created.push(t); } });
  } catch (e) {}

  function all() { return S.created.concat(S.launched, BASE); }
  S.archive = {};
  function find(tick) { var a = all(); for (var i = 0; i < a.length; i++) if (a[i].tick === tick) return a[i]; return S.archive[tick] || null; }
  function featured() { return BASE.slice().sort(function (a, b) { return b.mcN - a.mcN; })[0]; }
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
  })();

  function set(p) { for (var k in p) S[k] = p[k]; render(); }
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
      set({ wallet: w, account: acc.address, connecting: null, walletOpen: false, balance: null });
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
      set({ account: p.accounts[0].address, balance: null }); refreshBalance();
    });
  }
  function disconnect() {
    var w = S.wallet;
    try { localStorage.removeItem(LS.wallet); } catch (e) {}
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
      toast('1 devnet SOL requested — arrives in a few seconds');
      setTimeout(refreshBalance, 4000); setTimeout(refreshBalance, 10000);
    }).catch(function () { toast('Devnet faucet is rate-limited — try faucet.solana.com'); })
      .then(function () { set({ airdropping: false }); });
  }
  setInterval(function () { if (S.account && document.visibilityState === 'visible') refreshBalance(); }, 30000);

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
      right = '<div style="position:relative"><button class="wpill" data-act="walletMenu" aria-expanded="' + S.walletMenu + '">' + icon +
        '<span class="mono" style="font-size:13px">' + esc(short(S.account)) + '</span>' +
        '<span class="mono" style="font-size:13px;color:var(--ice)">' + balTxt() + ' SOL</span><span class="net">' + CLUSTER + '</span></button>' +
        (S.walletMenu ? '<div class="card-s" style="position:absolute;right:0;top:calc(100% + 8px);width:280px;padding:14px;display:flex;flex-direction:column;gap:8px;z-index:30;animation:pop .15s ease-out">' +
          '<div class="muted" style="font-size:12px">Connected with ' + esc(S.wallet ? S.wallet.name : '') + '</div>' +
          '<button class="btn sec" data-act="copyAddr" style="justify-content:space-between"><span class="mono">' + esc(short(S.account)) + '</span>' + I.copy + '</button>' +
          '<button class="btn sec" data-act="airdrop"' + (S.airdropping ? ' disabled' : '') + '>' + (S.airdropping ? 'Requesting…' : 'Get 1 devnet SOL') + '</button>' +
          '<button class="btn sec" data-act="refresh">Refresh balance</button>' +
          '<button class="btn sec" data-act="disconnect" style="color:var(--down)">Disconnect</button></div>' : '') + '</div>';
    } else {
      right = '<button class="btn sec" data-act="openWallet">Connect wallet</button>';
    }
    return '<header><div class="wrap hdr">' +
      '<button class="brand" data-act="home" aria-label="treid home"><span class="brand-name">treid</span></button>' +
      '<nav class="navlinks"><span class="nav-ind" id="nav-ind"></span><button class="' + (S.screen === 'home' ? 'on' : '') + '" data-act="home">Board</button><button class="' + (S.screen === 'create' ? 'on' : '') + '" data-act="create">Create</button><button class="' + (S.screen === 'leaders' ? 'on' : '') + '" data-act="leaders">Leaderboard</button><button class="' + (S.screen === 'burn' ? 'on' : '') + '" data-act="burnPage">🔥 Burnery</button><button class="' + (S.screen === 'trend' ? 'on' : '') + '" data-act="trendList">Trending</button><button data-act="how">How it works</button></nav>' +
      '<button class="searchbtn" data-act="palette">' + I.search + '<span>Search tokens or paste CA</span><span class="kbd">Ctrl K</span></button>' +
      '<div class="hdr-right"><button class="wl-btn co-btn' + (S.coOpen ? ' on' : '') + '" data-act="coToggle" title="Hot callouts">🔥<span>Callouts</span><b class="mono" id="co-new" style="display:none">0</b></button><button class="wl-btn' + (S.screen === 'watch' ? ' on' : '') + '" data-act="watchPage" aria-label="Watchlist" data-tip="Your watchlist">' + I.star(S.watch.length > 0) + (S.watch.length ? '<b class="mono" id="wl-n">' + S.watch.length + '</b>' : '') + '</button><button class="btn pri" data-act="create">+ Launch token</button>' + right + '</div>' +
      '</div></header>' +
      '<nav class="mnav" aria-label="Main">' + [['home', 'Board', '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>', S.screen === 'home'], ['trendList', 'Trending', '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>', S.screen === 'trend'], ['leaders', 'Ranks', '<path d="M8 21V11M16 21V7M12 21V3M4 21h16"/>', S.screen === 'leaders'], ['create', 'Launch', '<path d="M12 5v14M5 12h14"/>', S.screen === 'create', 'pri'], ['coToggle', 'Callouts', '<path d="M21 12a8 8 0 01-11.6 7.1L4 21l1.9-5.4A8 8 0 1121 12z"/>', S.coOpen], ['burnPage', 'Burnery', '<path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-9 0 4-4 6-4 12 0 5 3 8 7 8z"/>', S.screen === 'burn'], ['watchPage', 'Watchlist', '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', S.screen === 'watch']].map(function (x) { return '<button class="' + (x[3] ? 'on ' : '') + (x[4] || '') + '" data-act="' + x[0] + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">' + x[2] + '</svg><span>' + x[1] + '</span></button>'; }).join('') + '</nav>';
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
    var m = {}; S.trades.forEach(function (x) { if (x.tick !== t.tick || !x.tokens) return; m[x.wallet] = Math.max(0, (m[x.wallet] || 0) + (x.side === 'buy' ? x.tokens : -x.tokens)); });
    return Object.keys(m).filter(function (a) { return m[a] > 0; }).map(function (a) { return { a: a, tok: m[a], pct: m[a] / 1e9 * 100 }; }).sort(function (a, b) { return b.tok - a.tok; });
  }
  function riskMetrics(t) {
    var h = hash(t.tick + 'r'), devSold = (h >> 4) % 7 === 0 && t.prog < 100;
    function lv(v, a, b) { return v < a ? 'g' : v < b ? 'y' : 'r'; }
    var dev = devSold ? 0 : ((h % 80) / 10), top = 16 + (h >> 2) % 52, sn = (h >> 5) % 19, bu = (h >> 8) % 16;
    if (t.creator && S.account && t.creator === S.account) { dev = 2.1; top = 22; sn = 0; bu = 0; devSold = false; }
    if (t.devPct != null) { var lb = liveBal(t), dv = lb.filter(function (x) { return x.a === t.creator; })[0]; dev = lb.length ? (dv ? dv.pct : 0) : t.devPct; top = lb.slice(0, 10).reduce(function (a, x) { return a + x.pct; }, 0); if (!lb.length) top = Math.max(t.devPct, 0); top = top >= 10 ? Math.round(top) : +top.toFixed(1); sn = 0; bu = 0; devSold = !!(t.devPct > 0 && lb.length && !dv); }
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
    var f = [], h = hash(t.tick), tmax = Math.max(t.buy, t.sell), top10 = 18 + (h % 50);
    if (tmax >= 6) f.push('High tax ' + tmax + '%');
    if (t.sell - t.buy >= 3) f.push('Sell tax ' + t.sell + '%');
    if (top10 > 48) f.push('Top 10 hold ' + top10 + '%');
    if ((h >> 4) % 6 === 0 && t.prog < 100) f.push('Dev sold');
    if (!t.soc && t.prog > 20) f.push('No socials');
    return f;
  }
  function card(t, opts) {
    opts = opts || {};
    var tmax = Math.max(t.buy, t.sell), on = S.watch.indexOf(t.tick) !== -1, c = chg(t), done = t.prog >= 100, fr = freshness(t), fl = redFlags(t);
    var flags = fl.length ? '<div class="tc-flags bad" data-tip="' + esc(fl.join(' · ')) + '"><span class="fl-ic">!</span><span>' + esc(fl.slice(0, 2).join(' · ')) + (fl.length > 2 ? ' +' + (fl.length - 2) : '') + '</span></div>' :
      '<div class="tc-flags ok"><span class="fl-ic">✓</span><span>No red flags</span></div>';
    return '<article class="tcard' + (S.newTick === t.tick ? ' is-new' : '') + ' ' + fr.cls + '" data-card="' + esc(t.tick) + '" data-act="open" data-arg="' + esc(t.tick) + '">' +
      '<div class="tc-hero' + (t.banner ? ' has-ban' : '') + '"><div class="tch-bg' + (t.banner ? ' ban' : '') + '" aria-hidden="true">' + (t.banner ? '<img src="' + t.banner + '" alt="">' : avatarHTML(t, 240)) + '</div>' +
        '<div class="tc-age tch-age ' + fr.cls + '"><span class="ag-dot"></span><span class="ag-lab">' + fr.lab + '</span><b class="mono" data-t="' + t.born + '">' + ago(t.born) + '</b>' + (done ? '<span class="ag-grad">GRADUATED</span>' : '') + '</div>' +
        '<div class="tch-av">' + avatarHTML(t, 150) + '</div>' + '' + (opts.preview ? '' : '<button class="tch-star' + (on ? ' on' : '') + '" data-act="star" data-arg="' + esc(t.tick) + '" aria-label="Add to watchlist" aria-pressed="' + on + '">' + I.star(on) + '</button>') +
        '<div class="tch-side">' + (trapLeft(t) > 0 ? trapBox(t, 'card') : '<div class="tax" style="background:' + taxBg(tmax) + '" data-tip="' + esc(splitTip(t)) + '"><small>TAX</small><b>' + tmax + '%</b>' + (splitOf(t) ? splitBar(splitOf(t), 'mini') : '') + '</div>') +
        '<div class="pairmini" data-tip="Paired with ' + esc(pairInfo(t.pair).name) + '">' + coinHTML(t.pair, 28) + '<small>PAIR</small><b>' + esc(pairLabel(t.pair)) + '</b></div></div></div>' +
      '<div class="tc-name2"><b>' + esc(t.name) + '</b><span class="tc-tkr"><span class="mono">$' + esc(t.tick) + '</span>' + (opts.preview ? '' : '<button class="tc-ca mono" data-act="ca" data-arg="' + esc(t.tick) + '" data-tip="Copy contract address" aria-label="Copy contract address">' + esc(short(t.ca)) + I.copy + '</button>') + '</span></div>' +
      riskTiles(t) + socialsHTML(t) +
      '<div class="tc-mid"><div class="tc-mc"><div class="v"><span data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</span>' +
        '<span class="chgpill ' + (c >= 0 ? 'up' : 'down') + '" data-chg="' + esc(t.tick) + '">' + chgTxt(c) + '</span></div><div class="l">market cap · ' + fmtNum(t.holders) + ' holders · vol ' + fmtK(t.vol) + '</div></div></div>' +
      '<div class="tc-chart ' + (c >= 0 ? 'up' : 'down') + '" data-cchart="' + esc(t.tick) + '">' + cardChart(t) + '</div>' +
      '<div class="prog"><div class="l"><span>' + (done ? 'On Raydium' : 'Bonding curve') + '</span><span class="mono" data-prog="' + esc(t.tick) + '">' + Math.min(100, t.prog).toFixed(0) + '%</span></div>' +
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
      if (S.cat !== 'all' && pairInfo(d.pair).cat !== S.cat) return false;
      if (S.pair !== 'All' && d.pair !== S.pair) return false;
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
  function feedList() { var l = S.trades.filter(feedOk).slice(0, 6); return l.length ? l.map(function (t) { return feedRow(t); }).join('') : '<div class="muted" style="padding:16px 8px;font-size:13px;line-height:1.5">' + (S.feedF === 'follow' ? 'Nothing yet. Star coins or track wallets to follow them here.' : 'No whale trades yet.') + '</div>'; }
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
    return '<div class="tw-panel ' + kind + '"><div class="tw-ph"><div><b>' + (isC ? 'Race to Raydium' : 'Race to the Moon') + '</b><span class="mono">' + l.length + '</span></div><small>' + (isC ? 'bonding curve %' : 'market cap') + '</small></div>' +
      '<div class="tw-stage"><div class="tw-grid">' + ticks.map(function (k) { return '<i style="bottom:' + k[1].toFixed(1) + '%"><u>' + k[0] + '</u></i>'; }).join('') +
        '<span class="tw-fin"><u>' + (isC ? 'Raydium' : 'The Moon · $100M') + '</u></span></div>' + (isC ? '' : '<span class="tw-moonorb"></span>') +
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
        '<div class="vtile ring-t"><div><div class="l">Graduated</div><div class="v" data-count="' + st.grad + '">' + st.grad + '</div><div class="muted" style="font-size:11.5px">to Raydium</div></div>' +
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
  setInterval(function () { VB.shift(); VB.push(rnd(2, 6)); TB.shift(); TB.push(0); updTiles(); }, 4000);
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
    return { tokens: a.length, vol: vol, trades: S.trades.length + S.tradeCount, grad: a.filter(function (t) { return t.prog >= 100; }).length };
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
  function chgOver(t, mins) { var h = t.hist, n = h.length; var life = Math.max(1, (Date.now() - t.born) / 60000), span = Math.min(life, 1440); var k = Math.max(1, Math.round(n * Math.min(1, mins / span))); var ref = h[Math.max(0, n - 1 - k)]; return (t.mcN / ref - 1) * 100; }
  function lstats(t) { if (!t._ls || Date.now() - t._lsT > 4000) { var r = rng(hash(t.tick + 'ls')), v = t.vol * 1000; t._ls = { tx: Math.max(3, Math.round(v / (60 + r() * 140))), tr: 0 }; t._ls.tr = Math.max(1, Math.round(t._ls.tx * (.18 + r() * .25))); t._lsT = Date.now(); } return t._ls; }
  var LCOLS = [['rank', '#', ''], ['tok', 'Token', ''], ['tax', 'Tax', 'r'], ['mc', 'MCap', 'r'], ['price', 'Price', 'r'], ['age', 'Age', 'r'], ['tx', 'Txns', 'r hd1'], ['vol', 'Volume', 'r'], ['tr', 'Traders', 'r hd1'], ['c5', '5m', 'r hd2'], ['c1', '1h', 'r hd2'], ['c6', '6h', 'r hd1'], ['c24', '24h', 'r'], ['liq', 'Liquidity', 'r hd1'], ['curve', 'Curve', 'hd2']];
  function listHTML(list) {
    var key = { rank: function (t) { return chgOver(t, 360) * Math.log10(t.vol * 1000 + 10); }, tax: function (t) { return Math.max(t.buy, t.sell); }, mc: function (t) { return t.mcN; }, price: function (t) { return t.mcN; }, age: function (t) { return -t.born; }, tx: function (t) { return lstats(t).tx; }, vol: function (t) { return t.vol; }, tr: function (t) { return lstats(t).tr; }, c5: function (t) { return chgOver(t, 5); }, c1: function (t) { return chgOver(t, 60); }, c6: function (t) { return chgOver(t, 360); }, c24: function (t) { return chg(t); }, liq: function (t) { return t.prog; }, curve: function (t) { return t.prog; } };
    var k = key[S.lsort] || key.rank, rows = list.slice().sort(function (a, b) { return (k(b) - k(a)) * (S.ldir === -1 ? 1 : -1); }).slice(0, 100);
    var pc = function (v) { return '<span class="' + (v >= 0 ? 'up' : 'down') + '">' + (Math.abs(v) >= 1000 ? (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en') + '%' : chgTxt(v)) + '</span>'; };
    var head = '<div class="lrow2 lhead">' + LCOLS.map(function (c) { return '<button class="' + c[2] + (S.lsort === c[0] ? ' on' : '') + '" data-act="lsort" data-arg="' + c[0] + '">' + c[1] + (S.lsort === c[0] ? (S.ldir === -1 ? ' ↓' : ' ↑') : '') + '</button>'; }).join('') + '</div>';
    var body = rows.map(function (t, i) { var ls = lstats(t), tm = Math.max(t.buy, t.sell), rk = riskMetrics(t).some(function (m) { return m.lv === 'r'; }), liq = (t.prog / 100 * 85 * SOL_USD / 1000);
      return '<div class="lrow2" data-act="open" data-arg="' + esc(t.tick) + '"><span class="lr-n mono">#' + (i + 1) + '</span>' +
        '<span class="lr-tok">' + avatarHTML(t, 28) + '<span class="lt-n"><b>' + esc(t.tick) + '</b><small>/ ' + esc(pairLabel(t.pair).replace('$', '')) + '</small><em>' + esc(t.name) + '</em>' + (rk ? '<i class="lt-flag" title="Risk flag">⚠</i>' : '') + (trapLeft(t) > 0 ? '<i class="lt-trap">🪤</i>' : '') + '</span></span>' +
        '<span class="r"><i class="lt-tax" style="background:' + taxBg(tm) + '">' + tm + '%</i></span>' +
        '<span class="r mono lt-mc" data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</span>' +
        '<span class="r mono">' + fmtPrice(price(t)) + '</span><span class="r mono" data-t="' + t.born + '">' + ago(t.born) + '</span>' +
        '<span class="r mono hd1">' + fmtNum(ls.tx) + '</span><span class="r mono">' + fmtK(t.vol) + '</span><span class="r mono hd1">' + fmtNum(ls.tr) + '</span>' +
        '<span class="r mono hd2">' + pc(chgOver(t, 5)) + '</span><span class="r mono hd2">' + pc(chgOver(t, 60)) + '</span><span class="r mono hd1">' + pc(chgOver(t, 360)) + '</span><span class="r mono">' + pc(chg(t)) + '</span>' +
        '<span class="r mono hd1">' + (t.prog >= 100 ? '$' + fmtK(liq * 4).replace('$', '') : fmtK(liq)) + '</span>' +
        '<span class="hd2 lt-cv">' + (t.prog >= 100 ? '<em>🎓 Raydium</em>' : '<i><u style="width:' + Math.min(100, t.prog).toFixed(0) + '%"></u></i><small class="mono">' + Math.min(100, t.prog).toFixed(0) + '%</small>') + '</span></div>'; }).join('');
    return '<section class="ltable"><div class="lt-scroll">' + head + body + '</div></section>';
  }
  // ===== THE BURNERY: leaderboard of coins that burned their own supply =====
  var BSRC = { dev: ['Dev burn', '#F5B14C'], holder: ['Holder burn', '#FF7A59'], tax: ['Tax buyback', '#3DDC97'] };
  function burnLog() {
    if (S._burns && S._burnsN === all().length) return S._burns;
    var out = [];
    all().forEach(function (t) { var r = rng(hash(t.tick + 'burn2')); if (r() < .35) return; if (Date.now() - t.born < 3 * 36e5 && r() < .75) return;
      var heavy = r() < .25, n = 1 + Math.floor(r() * (heavy ? 7 : 3));
      for (var i = 0; i < n; i++) { var pct = +((heavy ? 1.2 : .08) + r() * r() * (heavy ? 9 : 2.4)).toFixed(3), tok = pct / 100 * 1e9, mc = t.mcN * (.35 + r() * .7), usd = tok * mc * 1000 / 1e9, at = Date.now() - 60000 - Math.min(Date.now() - t.born, 36 * 36e5) * r() * .98;
        var x = r(), src = (Math.max(t.buy, t.sell) > 0 && x < .4) ? 'tax' : x < .72 ? 'dev' : 'holder';
        out.push({ t: t, tok: tok, pct: pct, usd: usd, at: at, src: src, who: src === 'tax' ? 'auto' : b58(4) + '…' + b58(4), sig: b58(64) }); } });
    out.sort(function (a, b) { return b.at - a.at; }); S._burns = out; S._burnsN = all().length; return out;
  }
  S.bsort = 'pct';
  var BSI = { dev: '👤', holder: '💎', tax: '🔄' };
  function bhTubes(log) {
    var st = { dev: 0, holder: 0, tax: 0 }, cn = { dev: {}, holder: {}, tax: {} }, tot = 0; log.forEach(function (b) { st[b.src] += b.tok; cn[b.src][b.t.tick] = 1; tot += b.tok; }); BN.src = st;
    return '<div class="bh-side bh-src"><div class="bh-sh"><b>Who’s burning</b><small>share of all tokens burned</small></div><div class="bh-tubes">' + ['dev', 'holder', 'tax'].map(function (k) { var sh = tot ? st[k] / tot * 100 : 0;
      return '<div class="bh-tube" data-tube="' + k + '" style="--c:' + BSRC[k][1] + '"><span class="bh-pct mono" data-tpct="' + k + '">' + sh.toFixed(0) + '%</span><div class="bh-glass"><div class="bh-liq" data-tliq="' + k + '" style="height:' + Math.max(8, sh).toFixed(1) + '%"><i class="bh-wv"></i><u></u><u></u><u></u></div><span class="bh-shine"></span></div><em>' + BSI[k] + '</em><b>' + BSRC[k][0].replace(' burn', 's').replace('Tax buyback', 'Buybacks') + '</b><small class="mono" data-ttok="' + k + '">' + fmtBig(st[k]) + '</small><small class="bh-cn">' + Object.keys(cn[k]).length + ' coins</small></div>'; }).join('') + '</div></div>';
  }
  function bhGauge(log, usd, ncoins) {
    var now = Date.now(), day = now - 864e5, hr = now - 36e5, r24 = 0, r1 = 0, u1 = 0, n1 = 0, c1 = {};
    var h2 = now - 72e5, rp = 0; log.forEach(function (b) { if (b.at > day) r24 += b.tok; if (b.at > h2 && b.at <= hr) rp += b.tok; if (b.at > hr) { r1 += b.tok; u1 += b.usd; n1++; c1[b.t.tick] = 1; } });
    var avg = Math.max(1, rp || r24 / 24); BN.h1 = { tok: r1, usd: u1, n: n1, coins: c1, avg: avg }; var rate = r1; BN.rate = rate; BN.lvl = Math.max(.08, Math.min(.95, .5 * rate / avg));
    var ticks = ''; for (var i = 0; i <= 10; i++) { var a = Math.PI * (1 - i / 10), x1 = 100 + Math.cos(a) * 66, y1 = 100 - Math.sin(a) * 66, x2 = 100 + Math.cos(a) * (i % 5 ? 72 : 76), y2 = 100 - Math.sin(a) * (i % 5 ? 72 : 76); ticks += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>'; }
    return '<div class="bh-side bh-gauge"><div class="bh-sh"><b>Burn rate</b><small>tokens destroyed in the last hour</small></div>' +
      '<div class="bh-dial"><svg viewBox="0 0 200 116"><defs><linearGradient id="bhg" x1="0" x2="1"><stop offset="0" stop-color="#3DDC97"/><stop offset=".5" stop-color="#FFD15C"/><stop offset="1" stop-color="#FF4D2E"/></linearGradient></defs><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="14" stroke-linecap="round"/><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="url(#bhg)" stroke-width="14" stroke-linecap="round" opacity=".9"/><g class="bh-ticks">' + ticks + '</g>' +
      '<g class="bh-needle" id="bh-needle" style="transform:rotate(' + (-90 + BN.lvl * 180) + 'deg)"><path d="M97 100 L100 28 L103 100Z" fill="#FFF1D6"/></g><circle cx="100" cy="100" r="8" fill="#1b130e" stroke="#FFD15C" stroke-width="2.5"/></svg>' +
      '<div class="bh-dv"><b class="mono"><span id="bh-rate">' + fmtBig(rate) + '</span><em>/ hr</em></b><span class="bh-hot" id="bh-hot">' + (BN.lvl > .8 ? '🔥 ON FIRE' : BN.lvl > .5 ? '🔥 HOT' : '♨ WARM') + '</span><small class="bh-avg">' + (rate >= avg ? '▲ +' : '▼ −') + Math.abs(Math.round((rate / avg - 1) * 100)) + '% vs previous hour</small></div></div>' +
      '<div class="bh-mini"><div><small>Value · 1h</small><b class="mono" id="bh-u1">$' + fmtNum(Math.round(u1)) + '</b></div><div><small>Burns · 1h</small><b class="mono" id="bh-n1">' + n1 + '</b></div><div><small>Coins · 1h</small><b class="mono" id="bh-c1">' + Object.keys(c1).length + '</b></div></div></div>';
  }
  function bhKick(b) {
    var k = b.src, st = BN.src || {}; st[k] = (st[k] || 0) + b.tok; var tot = (st.dev || 0) + (st.holder || 0) + (st.tax || 0);
    ['dev', 'holder', 'tax'].forEach(function (q) { var sh = tot ? st[q] / tot * 100 : 0, l = document.querySelector('[data-tliq="' + q + '"]'), pc = document.querySelector('[data-tpct="' + q + '"]'); if (l) l.style.height = Math.max(8, sh).toFixed(1) + '%'; if (pc) pc.textContent = sh.toFixed(0) + '%'; });
    var tt = document.querySelector('[data-ttok="' + k + '"]'); if (tt) tt.textContent = fmtBig(st[k]);
    var tb = document.querySelector('[data-tube="' + k + '"]'); if (tb) { tb.classList.remove('kick'); void tb.offsetWidth; tb.classList.add('kick'); var pp = document.createElement('span'); pp.className = 'bh-tpop mono'; pp.textContent = '+' + fmtBig(b.tok); tb.appendChild(pp); setTimeout(function () { pp.remove(); }, 1400); }
    var H1 = BN.h1 || { tok: 0, usd: 0, n: 0, coins: {}, avg: 1 }; H1.tok += b.tok; H1.usd += b.usd; H1.n++; H1.coins[b.t.tick] = 1; BN.h1 = H1; BN.rate = H1.tok;
    var rt = document.getElementById('bh-rate'); if (rt) rt.textContent = fmtBig(H1.tok);
    var u1 = document.getElementById('bh-u1'), n1 = document.getElementById('bh-n1'), c1 = document.getElementById('bh-c1'); if (u1) u1.textContent = '$' + fmtNum(Math.round(H1.usd)); if (n1) n1.textContent = H1.n; if (c1) c1.textContent = Object.keys(H1.coins).length;
    var av = document.querySelector('.bh-avg'); if (av) av.textContent = (H1.tok >= H1.avg ? '▲ +' : '▼ −') + Math.abs(Math.round((H1.tok / H1.avg - 1) * 100)) + '% vs previous hour';
    var nd = document.getElementById('bh-needle'), lv = Math.max(.08, Math.min(.95, .5 * H1.tok / H1.avg)); if (nd) { nd.style.transform = 'rotate(' + (-90 + Math.min(.99, lv + .14) * 180) + 'deg)'; setTimeout(function () { nd.style.transform = 'rotate(' + (-90 + lv * 180) + 'deg)'; }, 380); }
    var hot = document.getElementById('bh-hot'); if (hot) { hot.textContent = lv > .8 ? '🔥 ON FIRE' : lv > .5 ? '🔥 HOT' : '♨ WARM'; hot.classList.remove('pulse'); void hot.offsetWidth; hot.classList.add('pulse'); }
  }
  function burnPage() {
    var log = burnLog(), by = {}, totUsd = 0, totTok = 0;
    log.forEach(function (b) { totUsd += b.usd; totTok += b.tok; var e = by[b.t.tick] = by[b.t.tick] || { t: b.t, tok: 0, pct: 0, usd: 0, n: 0, last: 0, src: {} }; e.tok += b.tok; e.pct += b.pct; e.usd += b.usd; e.n++; e.last = Math.max(e.last, b.at); e.src[b.src] = (e.src[b.src] || 0) + b.pct; });
    var key = { pct: function (e) { return e.pct; }, usd: function (e) { return e.usd; }, n: function (e) { return e.n; }, last: function (e) { return e.last; } }[S.bsort] || function (e) { return e.pct; };
    var coins = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return key(b) - key(a); });
    var byPct = coins.slice().sort(function (a, b) { return b.pct - a.pct; });
    var mx = byPct.length ? byPct[0].pct : 1;
    var srcBar = function (e) { return ['dev', 'holder', 'tax'].filter(function (k) { return e.src[k]; }).map(function (k) { return '<i style="width:' + (e.src[k] / mx * 100).toFixed(2) + '%;background:' + BSRC[k][1] + '"></i>'; }).join(''); };
    var podium = byPct.slice(0, 3), order = [1, 0, 2];
    var pod = '<div class="bn-pod">' + order.filter(function (i) { return podium[i]; }).map(function (i) { var e = podium[i]; return '<button class="bn-p bn-p' + (i + 1) + '" data-act="open" data-arg="' + esc(e.t.tick) + '"><span class="bn-pr">' + ['🥇', '🥈', '🥉'][i] + '</span>' + avatarHTML(e.t, i ? 48 : 62) + '<b>$' + esc(e.t.tick) + '</b><strong class="mono">' + e.pct.toFixed(2) + '%</strong><small>supply burned</small></button>'; }).join('') + '</div>';
    var stats = [['Supply destroyed', totTok >= 1e9 ? (totTok / 1e9).toFixed(2) + 'B' : fmtNum(Math.round(totTok)), 'tokens, all coins'], ['Value burned', '$' + fmtNum(Math.round(totUsd)), 'at time of burn'], ['Coins burning', coins.length, 'of ' + all().length + ' launched'], ['Last burn', log.length ? ago(log[0].at) + ' ago' : '—', log.length ? '$' + esc(log[0].t.tick) + ' · ' + BSRC[log[0].src][0] : '']];
    var sorts = [['pct', '% supply'], ['usd', 'Value'], ['n', 'Burns'], ['last', 'Recent']];
    S._bnAgg = by; BN.tot = totTok; S._bnRank = {}; byPct.forEach(function (e, i) { S._bnRank[e.t.tick] = i + 1; });
    var stat = function (x) { return '<div class="bh-st"><small>' + x[0] + '</small><b class="mono">' + x[1] + '</b><span>' + x[2] + '</span></div>'; };
    return '<main class="wrap burn"><section class="bh"><div class="bh-top"><span class="kicker">BURN LEADERBOARD</span><h1 class="bn-h">The Burnery</h1><p>Every coin on treid can <b>burn its own supply</b> — dev, holders or automatic <b>tax buyback</b>. Gone forever. Less supply, higher rank.</p></div>' +
      '<div class="bh-stage">' + bhTubes(log) +
      '<div class="bn-fire" id="bn-fire"><canvas id="bn-cv"></canvas><div class="bn-pit"></div><div class="bh-count"><small>SUPPLY DESTROYED</small><b class="mono" id="bh-count">' + (totTok >= 1e9 ? (totTok / 1e9).toFixed(3) + 'B' : fmtNum(Math.round(totTok))) + '</b></div><div class="bn-fly" id="bn-fly"></div><div class="bn-now" id="bn-now"></div></div>' +
      bhGauge(log, totUsd, coins.length) + '</div></section>' + pod +
      '<section class="bn-list card-s"><div class="bn-lh"><b>Burn leaderboard</b><div class="bn-leg">' + Object.keys(BSRC).map(function (k) { return '<span><i style="background:' + BSRC[k][1] + '"></i>' + BSRC[k][0] + '</span>'; }).join('') + '</div><div class="seg">' + sorts.map(function (x) { return '<button class="' + (S.bsort === x[0] ? 'on' : '') + '" data-act="bsort" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="bn-row bn-head"><span>#</span><span>Coin</span><span>Supply burned</span><span class="r">Tokens</span><span class="r">Value</span><span class="r">Burns</span><span class="r">Last</span></div>' +
      coins.map(function (e, i) { return '<div class="bn-row" data-act="open" data-arg="' + esc(e.t.tick) + '"><span class="mono bn-rk' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</span><span class="bn-c">' + avatarHTML(e.t, 30) + '<span><b>$' + esc(e.t.tick) + '</b><small>' + esc(e.t.name) + '</small></span></span><span class="bn-bar"><span class="bn-stk">' + srcBar(e) + '</span><b class="mono">' + e.pct.toFixed(2) + '%</b></span><span class="r mono">' + fmtNum(Math.round(e.tok)) + '</span><span class="r mono bn-usd">$' + fmtNum(Math.round(e.usd)) + '</span><span class="r mono">' + e.n + '</span><span class="r mono muted">' + ago(e.last) + '</span></div>'; }).join('') + '</section>' +
      '<section class="bn-feed card-s"><div class="bn-lh"><b>Live burns</b><span class="muted">every burn across treid, newest first</span></div><div id="bn-log">' + log.slice(0, 30).map(burnLogRow).join('') + '</div></section></main>';
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
    bnCount(b.tok); bhKick(b);
    var nw = document.getElementById('bn-now'); if (nw) { nw.innerHTML = '<b>$' + esc(b.t.tick) + '</b> burned ' + b.pct.toFixed(2) + '% supply · <span style="color:' + BSRC[b.src][1] + '">' + BSRC[b.src][0] + '</span> · <span class="bn-usd">$' + fmtNum(Math.round(b.usd)) + '</span>'; nw.classList.remove('go'); void nw.offsetWidth; nw.classList.add('go'); }
    var fire = document.getElementById('bn-fire'); if (fire) { fire.classList.remove('shake'); void fire.offsetWidth; fire.classList.add('shake'); }
  }
  function bnKick() { if (!BN.raf && document.getElementById('bn-fire')) BN.raf = requestAnimationFrame(bnLoop); }
  S.tcat = 'all';
  function trendPage() {
    var a = all().filter(function (t) { return S.tcat === 'all' || pairInfo(t.pair).cat === S.tcat; });
    var pre = [['rank', '🔥 Trending'], ['vol', 'Top volume'], ['c1', '📈 Gainers 1h'], ['age', '✨ New'], ['curve', '🎓 Near graduation'], ['mc', 'Market cap']];
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
    return '<div class="pairrow"><span class="pr-l">Paired<br>with</span><div class="pr-cats">' + cats + '</div>' +
      '<div class="pr-rail drag-scroll">' + rail + '</div>' + sel +
      '<div class="pr-search">' + I.search + '<input id="pairq" data-bind="pairQ" value="' + esc(S.pairQ) + '" placeholder="Find pair: Gold, ONDO, $PAWS…" autocomplete="off">' + drop + '</div></div>';
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
    return '<div class="fbar2">' + pairRow() + '<div class="fb2-row">' + ['mc', 'age', 'prog', 'tax'].map(inlineRange).join('') + '</div>' +
      '<div class="fb2-row sub">' + tg + '<span class="mono muted" style="margin-left:auto;font-size:12px" id="rpc-all">' + filtered().length + ' coins match</span>' + (active ? '<button class="freset" style="margin-left:10px" data-act="reset">Reset · ' + active + '</button>' : '') + '</div></div>';
  }
  function refreshGrid() {
    var list = filtered(), g = document.getElementById('grid'), cnt = document.getElementById('count');
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
    if (g && S.view !== 'bubbles') g.innerHTML = list.length ? list.map(function (t) { return card(t); }).join('') : '<div class="empty"><b style="font-size:19px">No coins in this range</b><span class="muted">Widen a slider or hit Reset.</span><button class="btn pri" data-act="reset">Reset filters</button></div>';
  }
  var SLOGANS = ['The market', 'is yours.'];
  var KIN = [['GOLD', 'gold'], ['$NFROG', 'frogs'], ['TSLAx', 'tesla'], ['SOL', 'solana'], ['$CHAD', 'chads'], ['EUR', 'euros'], ['BTC', 'bitcoin'], ['', 'anything.']];
  var kinI = 0;
  setInterval(function () {
    var r = document.getElementById('kin-roll'); if (!r || document.hidden) return;
    kinI++; r.style.transition = 'transform .7s cubic-bezier(.7,-0.3,.25,1.3)'; r.style.transform = 'translateY(' + (-kinI * 100 / (KIN.length + 1)) + '%)';
    if (kinI === KIN.length) setTimeout(function () { r.style.transition = 'none'; kinI = 0; r.style.transform = 'translateY(0)'; }, 760);
  }, 2000);
  function tcHTML(t, k) {
    var c = chg(t), tm = Math.max(t.buy, t.sell), id = esc(t.tick);
    return '<div class="tc-in" role="button" tabindex="0" data-act="open" data-arg="' + id + '">' +
      '<span class="tc-av">' + avatarHTML(t, 58) + '<i class="tc-crown">♛</i></span>' +
      '<span class="tc-main"><span class="tc-k">TOP MEME <b>#' + (k + 1) + '</b></span><b class="tc-n">' + esc(t.name) + '</b>' +
        '<span class="tc-row"><span class="mono">' + fmtK(t.mcN) + '</span><span class="mono ' + (c >= 0 ? 'up' : 'down') + '">' + chgTxt(c) + '</span></span>' +
        '<span class="tc-bar"><i style="width:' + Math.min(100, t.prog) + '%"></i></span></span>' +
      '<span class="tc-side"><span class="tc-pair">' + coinHTML(t.pair, 26) + '<b>' + esc(pairLabel(t.pair)) + '</b></span><span class="tax" style="background:' + taxBg(tm) + '"><small>TAX</small><b>' + tm + '%</b></span></span></div>' + socialsHTML(t);
  }
  var tcI = 0;
  setInterval(function () {
    var el = document.getElementById('tc'); if (!el || document.hidden) return;
    tcI = (tcI + 1) % HERO.length; var t = find(HERO[tcI]); if (!t) return;
    el.classList.add('out');
    setTimeout(function () { el.innerHTML = tcHTML(t, tcI) + '<span class="tc-timer"></span>'; el.classList.remove('out'); }, 260);
  }, 5000);
  function introHTML() {
    var st = stats(), fresh = all().slice().sort(function (a, b) { return b.born - a.born; }).slice(0, 3);
    var t0 = find(HERO[tcI]) || all()[0];
    return '<section class="intro3" id="intro"><div class="aurora"><span class="a1"></span><span class="a2"></span><span class="a3"></span></div>' +
      '<div class="i3-l">' +
        '<h1 class="kin"><span class="kin-a">trade</span> <span class="kin-slot"><span class="kin-roll" id="kin-roll">' + KIN.concat([KIN[0]]).map(function (x) { return '<span class="kin-w">' + (x[0] ? (x[0].charAt(0) === '$' ? avatarHTML(find(x[0].slice(1)) || BASE[0], 64) : coinHTML(x[0], 64)) : '') + '<b>' + x[1] + '</b></span>'; }).join('') + '</span></span></h1>' +
        '<p class="i3-p">Launch a coin. Pair it with anything. Tax is always on the label.</p>' +
        '<div class="i3-cta"><button class="btn pri" data-act="create">Launch a coin <span aria-hidden="true">→</span></button><button class="btn sec" data-act="board">Trade anything ↓</button></div></div>' +
      '<div class="tc" id="tc">' + tcHTML(t0, tcI) + '<span class="tc-timer"></span></div>' +
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

    var list = filtered();
    var toolbar = '<div class="toolbar"><h2 class="h2">Tokens</h2><span class="demo" data-tip="Market data is simulated until on-chain launch goes live.">DEMO DATA</span><button class="demo-img-btn" data-act="demoImgs">🖼 Try real images</button><div class="seg">' + SORTS.map(function (s) {
      return '<button class="' + (S.sort === s[0] ? 'on' : '') + '" aria-pressed="' + (S.sort === s[0]) + '" data-act="sort" data-arg="' + s[0] + '">' + s[1] + '</button>';
    }).join('') + '</div><div class="seg" role="group" aria-label="View"><button class="' + (S.view === 'grid' ? 'on' : '') + '" data-act="view" data-arg="grid">Grid</button><button class="' + (S.view === 'bubbles' ? 'on' : '') + '" data-act="view" data-arg="bubbles">Bubbles</button><button class="' + (S.view === 'orbit' ? 'on' : '') + '" data-act="view" data-arg="orbit">Orbit</button></div><span class="mono muted" style="margin-left:auto;font-size:12.5px" id="count">' + list.length + ' of ' + all().length + ' tokens</span></div>' +
      '';

    var filters = filterBar();

    if (S.view === 'list') S.view = 'grid';
    var grid = (!S.loading && S.view === 'orbit') ? (function () { var a = list; return '<div class="orb-inline">' + orbitStage(a, a.filter(function (t) { return t.prog < 100; }), a.filter(function (t) { return t.prog >= 100; })) + '</div>'; })() : (!S.loading && S.view === 'bubbles') ? bubblesHTML(list) : '<section class="grid" id="grid">' + (S.loading ? [0, 1, 2, 3, 4, 5].map(skeletonCard).join('') : list.length ? list.map(function (t) { return card(t); }).join('') :
      '<div class="empty"><b style="font-size:19px">No tokens match these filters</b><span class="muted">Loosen the tax or market cap filters.</span><button class="btn pri" data-act="reset">Reset filters</button></div>') + '</section>';

    var how = '<section id="how" style="margin-top:56px"><h2 class="h2" style="margin-bottom:16px">How treid works</h2><div class="row">' +
      [['01', 'Pick a name & logo', 'Use the built-in mascot builder or upload your own image. Takes under a minute.'],
       ['02', 'Set your buy & sell tax', 'From 0% to 10%. The tax is shown on every card in colour, so traders always know the cost.'],
       ['03', 'Launch on a bonding curve', 'Price rises as people buy. When the curve fills, liquidity graduates to Raydium automatically.']].map(function (s) {
        return '<div class="card-s" style="flex:1 1 260px;padding:22px;display:flex;flex-direction:column;gap:8px"><span class="mono" style="color:var(--ice);font-size:13px">' + s[0] + '</span><b style="font-size:17px">' + s[1] + '</b><span class="muted" style="line-height:1.55">' + s[2] + '</span></div>';
      }).join('') + '</div></section>';

    var slogan = introHTML();
    return '<main class="wrap">' + slogan + '<div id="board"></div>' + toolbar + filters + '<div class="layout full">' + grid + '</div>' + (S.view === 'orbit' ? '' : raceSection()) + machineSection() + '</main>';
  }

  // ================= PRO TOKEN PAGE (pump.fun / dexscreener style) =================
  // ===== time-based chart engine (1m … 1d candles, zoom, pan, line/candles, MA, trade markers) =====
  var TFS = [['1M', '1m', 6e4], ['5M', '5m', 3e5], ['15M', '15m', 9e5], ['1H', '1h', 36e5], ['4H', '4h', 144e5], ['1D', '1d', 864e5]];
  function tfMs() { for (var i = 0; i < TFS.length; i++) if (TFS[i][0] === S.tf) return TFS[i][2]; return 6e4; }
  S.ctype = 'candle'; S.cma = true; S.cvol = true; S.cmarks = true; S.czoom = 70; S.cpan = 0; S.cys = 1; S.cyo = 0; S.cfull = false;
  function ensureTicks(t) {
    if (t.tk) return t.tk;
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
    var tk = ensureTicks(t), b = tfMs(), now = Date.now(), endB = Math.floor(now / b) - S.cpan, n = S.czoom, startB = endB - n + 1;
    var firstB = Math.floor(tk[0][0] / b), lo = 0, hi = tk.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (tk[m][0] < startB * b) lo = m + 1; else hi = m; }
    var k = lo, prevC = k > 0 ? tk[k - 1][1] : tk[0][1], out = [];
    var fut = Math.max(0, endB - Math.floor(now / b)); endB -= fut;
    for (var B = Math.max(startB, firstB); B <= endB; B++) {
      var o = prevC, h2 = o, l2 = o, c = o, v = 0, any = false, bt = B * b, be = bt + b;
      while (k < tk.length && tk[k][0] < be) { var x = tk[k]; if (x[0] >= bt) { any = true; h2 = Math.max(h2, x[1]); l2 = Math.min(l2, x[1]); c = x[1]; v += x[2]; } k++; }
      out.push({ o: o, h: h2, l: l2, c: c, v: v, t: bt, flat: !any }); prevC = c;
    }
    if (!out.length) out.push({ o: t.mcN, h: t.mcN, l: t.mcN, c: t.mcN, v: 0, t: endB * b });
    out.fut = fut; return out;
  }
  function yLabel(v) { return S.chartMode === 'price' ? fmtPrice(v * 1000 / 1e9) : fmtK(v); }
  function tLabel(ms) { var d = new Date(ms), p = function (x) { return (x < 10 ? '0' : '') + x; }; return tfMs() >= 864e5 ? (d.getMonth() + 1) + '/' + d.getDate() : p(d.getHours()) + ':' + p(d.getMinutes()); }
  function chartSVG(t) {
    var cs = candles(t), W = 1000, H = 400, top = 16, vh = S.cvol ? 64 : 0, bot = 22, ph = H - vh - top - bot - 8, yfree = S.cys !== 1 || !!S.cyo;
    if (yfree) { top = 4; ph = H - bot - top - 2; }
    var mx = Math.max.apply(null, cs.map(function (c) { return c.h; })), mn = Math.min.apply(null, cs.map(function (c) { return c.l; }));
    var minSp = mx * 0.06; if (mx - mn < minSp) { var mid = (mx + mn) / 2; mx = mid + minSp / 2; mn = mid - minSp / 2; } var pad = (mx - mn) * .06; mx += pad; mn -= pad; var sp = mx - mn;
    if (S.cys !== 1 || S.cyo) { var md0 = (mx + mn) / 2 + S.cyo * sp, h0 = sp / 2 * S.cys; mx = md0 + h0; mn = md0 - h0; sp = mx - mn; }
    var vmx = Math.max(.0001, Math.max.apply(null, cs.map(function (c) { return c.v; })));
    var fut = cs.fut || 0, slots = Math.max(cs.length + fut, S.czoom), cw = (W - 70) / slots, off0 = (slots - cs.length - fut) * cw, Y = function (v) { return top + (mx - v) / sp * ph; }, bw = Math.max(1.5, cw * 0.64);
    var g = '', pts = [], xl = '';
    for (var k = 1; k < 5; k++) g += '<line x1="0" x2="' + W + '" y1="' + (top + k * ph / 5) + '" y2="' + (top + k * ph / 5) + '" stroke="#18181A" vector-effect="non-scaling-stroke"/>';
    var every = Math.max(1, Math.round(slots / 7));
    var body = '', vol = '', line = '', area = '';
    cs.forEach(function (c, i) {
      var x = off0 + i * cw + cw / 2, up = c.c >= c.o, col = c.flat ? '#3A3A3D' : up ? '#3DDC97' : '#F2708A', y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
      pts.push({ x: x, y: Y(c.c), v: c.c, o: c.o, h: c.h, l: c.l, vol: c.v, t: c.t });
      if (S.ctype === 'candle') body += '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + Y(c.h).toFixed(1) + '" y2="' + Y(c.l).toFixed(1) + '" stroke="' + col + '" stroke-width="1.2" vector-effect="non-scaling-stroke"/>' +
        '<rect x="' + (x - bw / 2).toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1.2, y2 - y1).toFixed(1) + '" rx="1" fill="' + col + '"' + (i === cs.length - 1 && S.cpan <= 0 ? ' class="lastc"' : '') + '/>';
      line += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + Y(c.c).toFixed(1);
      if (S.cvol && c.v > 0) vol += '<rect x="' + (x - bw / 2).toFixed(1) + '" y="' + (H - bot - c.v / vmx * vh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (c.v / vmx * vh).toFixed(1) + '" fill="' + (up ? '#3DDC97' : '#F2708A') + '" opacity=".3"/>';
      if ((slots - cs.length + i) % every === 0) xl += '<span class="xlab" style="left:' + (x / W * 100).toFixed(2) + '%">' + tLabel(c.t) + '</span>';
    });
    if (S.ctype === 'line') { var x0 = off0 + cw / 2, x1 = off0 + (cs.length - 1) * cw + cw / 2, upAll = cs[cs.length - 1].c >= cs[0].o, lc = upAll ? '#3DDC97' : '#F2708A';
      area = '<defs><linearGradient id="cfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + lc + '" stop-opacity=".25"/><stop offset="1" stop-color="' + lc + '" stop-opacity="0"/></linearGradient></defs><path d="' + line + 'L' + x1.toFixed(1) + ' ' + (top + ph) + 'L' + x0.toFixed(1) + ' ' + (top + ph) + 'Z" fill="url(#cfill)"/>';
      body = '<path d="' + line + '" fill="none" stroke="' + lc + '" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>'; }
    var ma = '';
    if (S.cma && cs.length > 5) { var per = Math.min(20, Math.floor(cs.length / 2)), d = ''; for (var m = per - 1; m < cs.length; m++) { var sum = 0; for (var q2 = m - per + 1; q2 <= m; q2++) sum += cs[q2].c; d += (m === per - 1 ? 'M' : 'L') + (off0 + m * cw + cw / 2).toFixed(1) + ' ' + Y(sum / per).toFixed(1); }
      ma = '<path d="' + d + '" fill="none" stroke="#D8C3A0" stroke-width="1.4" stroke-opacity=".85" vector-effect="non-scaling-stroke"/>'; }
    var marks = '';
    if (S.cmarks) { var b = tfMs(), t0 = cs[0].t, tEnd = cs[cs.length - 1].t + b;
      seedDevTrades(t); var stack = {}; S.cmarkData = [];
      var place = function (ts, side) { var idx = Math.floor((ts - t0) / b), c = cs[idx]; if (!c) return null; var n = stack[idx] = (stack[idx] || 0) + 1; if (n > 6) return null; var yy = Y(c.h) - 16 - (n - 1) * 22; if (yy < 40) yy = Y(c.l) + 16 + (n - 1) * 22; return { x: off0 + idx * cw + cw / 2, y: yy }; };
      S.trades.filter(function (tr) { return tr.tick === t.tick && (tr.mine || tr.sol >= 1 || tr.wallet === devOf(t)) && tr.t >= t0 && tr.t < tEnd; }).slice(0, 70).forEach(function (tr) {
        var p0 = place(tr.t); if (!p0) return; var buy = tr.side === 'buy', k = S.cmarkData.push({ k: 'tr', d: tr }) - 1, dev = tr.wallet === devOf(t);
        if (p0.y < top - 6 || p0.y > top + ph + 6) return;
        marks += '<span class="cmark ' + (buy ? 'b' : 's') + (tr.mine ? ' me' : '') + (dev ? ' dev' : '') + '" data-cmi="' + k + '" data-act="walletAny" data-arg="' + esc(tr.wallet) + '" style="left:' + (p0.x / W * 100).toFixed(2) + '%;top:' + (Math.max(2, p0.y) / H * 100).toFixed(2) + '%">' + A.svg(walletSpec(tr.wallet)) + (dev ? '<i class="cm-d">' + (buy ? 'DEV B' : 'DEV S') + '</i>' : '') + '</span>';
      });
      seedComments(t).filter(function (c) { return c.t >= t0 && c.t < tEnd && c.reply == null; }).slice(0, 12).forEach(function (c) {
        var p0 = place(c.t); if (!p0) return; var k = S.cmarkData.push({ k: 'co', d: c }) - 1;
        if (p0.y < top - 6 || p0.y > top + ph + 6) return;
        marks += '<span class="cmark cmco' + (c.w === devOf(t) ? ' dev' : '') + '" data-cmi="' + k + '" data-act="walletAny" data-arg="' + esc(c.w) + '" style="left:' + (p0.x / W * 100).toFixed(2) + '%;top:' + (Math.max(2, p0.y) / H * 100).toFixed(2) + '%">' + A.svg(walletSpec(c.w)) + '<i class="cm-c">💬</i></span>';
      }); }
    S.chartPts = pts; S.chartW = W; S.chartH = H; S.chartOff = off0; S.chartCw = cw;
    var last = cs[cs.length - 1], ly = Math.max(2, Math.min(H - bot - 2, Y(last.c))), lcol = last.c >= last.o ? '#3DDC97' : '#F2708A';
    if (fut) { var bms = tfMs(), lastT = cs[cs.length - 1].t; for (var fi = 1; fi <= fut; fi++) { var ii = cs.length - 1 + fi; if ((slots - cs.length + ii) % every === 0) { var fx = off0 + ii * cw + cw / 2; if (fx < W - 70) xl += '<span class="xlab fut" style="left:' + (fx / W * 100).toFixed(2) + '%">' + tLabel(lastT + fi * bms) + '</span>'; } } }
    var labels = '', NL = yfree ? 7 : 4; for (var j = 0; j <= NL; j++) { var v = mx - j * sp / NL; if (v < 0 && !yfree) continue; labels += '<span class="ylab" style="top:' + ((top + j * ph / NL) / H * 100).toFixed(2) + '%">' + yLabel(v) + '</span>'; }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Price chart"><defs><clipPath id="pclip"><rect x="0" y="0" width="' + W + '" height="' + (yfree ? H - bot : top + ph + 4) + '"/></clipPath></defs>' + g + vol + '<g clip-path="url(#pclip)">' + area + body + ma + '</g>' +
      '<line x1="0" x2="' + W + '" y1="' + ly.toFixed(1) + '" y2="' + ly.toFixed(1) + '" stroke="' + lcol + '" stroke-opacity=".55" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/></svg>' + labels + xl + marks +
      (S.cpan > 0 ? '' : '<span class="lastlab" style="top:' + (ly / H * 100).toFixed(2) + '%;background:' + lcol + '">' + yLabel(last.c) + '</span>') +
      (S.cpan > 0 ? '<button class="c-live" data-act="cnow">Back to now →</button>' : '') +
      '<div class="yhit" title="Drag to scale · double-click to auto-fit"></div><button class="c-auto' + (yfree ? '' : ' on') + '" data-act="cauto" title="Auto-fit price scale">A</button>' +
      '<div class="cm-tip" id="cmtip"></div><div class="xh" id="xh"></div><div class="yh" id="yh"></div><div class="xh-dot" id="xhd" style="background:#fff"></div><div class="xh-tip" id="xht"></div>' +
      '<span class="wm">treid.fun</span>';
  }
  function chartRedraw() { var t = find(S.tick), box = document.getElementById('chart'); if (t && box) box.innerHTML = chartSVG(t); }
  function chartToolbar(t) {
    var id = esc(t.tick);
    return '<div class="chart-tb"><div class="seg tfseg">' + TFS.map(function (x) { return '<button class="' + (S.tf === x[0] ? 'on' : '') + '" data-act="tf" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="seg"><button class="' + (S.ctype === 'candle' ? 'on' : '') + '" data-act="ctype" data-arg="candle" title="Candles"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3v4M7 17v4M17 5v3M17 16v3"/><rect x="4" y="7" width="6" height="10" rx="1"/><rect x="14" y="8" width="6" height="8" rx="1"/></svg></button><button class="' + (S.ctype === 'line' ? 'on' : '') + '" data-act="ctype" data-arg="line" title="Line"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/></svg></button></div>' +
      '<div class="seg"><button class="' + (S.chartMode === 'mc' ? 'on' : '') + '" data-act="cmode" data-arg="mc">MCap</button><button class="' + (S.chartMode === 'price' ? 'on' : '') + '" data-act="cmode" data-arg="price">Price</button></div>' +
      '<div class="ctog">' + [['cma', 'MA', S.cma], ['cvol', 'Vol', S.cvol], ['cmarks', 'Trades', S.cmarks]].map(function (x) { return '<button class="' + (x[2] ? 'on' : '') + '" data-act="ctog" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="czoom"><button data-act="czoom" data-arg="out" title="Zoom out">−</button><span class="mono">' + S.czoom + '</span><button data-act="czoom" data-arg="in" title="Zoom in">+</button><button data-act="czoom" data-arg="reset" title="Reset view">⟲</button></div>' +
      '<span class="muted mono c-pair">$' + id + '/' + esc(pairLabel(t.pair)) + '</span>' +
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
    var buy = tr.side === 'buy', usd = tr.sol * SOL_USD, w = Math.min(100, tr.sol / 5 * 100), px = tr.price || price(t), tok = tr.tokens || usd / px;
    return '<div class="trow ' + (buy ? 'b' : 's') + (enter ? ' enter' : '') + (tr.sol >= 2 ? ' big' : '') + '" style="--w:' + w.toFixed(0) + '%" data-act="wallet" data-arg="' + esc(tr.wallet) + '" title="Open wallet">' +
      '<span class="muted" data-t="' + tr.t + '">' + timeTxt(tr.t) + '</span>' +
      '<span class="ty">' + (buy ? 'Buy' : 'Sell') + (tr.sol >= 2 ? ' <span class="bdg whale2" title="Whale">' + I.gem + '</span>' : '') + '</span>' +
      '<span class="r">$' + (usd >= 1000 ? (usd / 1000).toFixed(2) + 'K' : usd.toFixed(2)) + '</span>' +
      '<span class="r">' + tr.sol.toFixed(3) + '</span><span class="r">' + fmtNum(tok) + '</span><span class="r">' + fmtPrice(px) + '</span>' +
      '<span>' + makerHTML(tr.wallet, t) + '</span>' +
      '<span class="r"><button class="txb" data-act="wallet" data-arg="' + esc(tr.wallet) + '" aria-label="Open wallet details"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button></span></div>';
  }
  function holdersOf(t) {
    var rm = riskMetrics(t), devP = rm[0].val === 'SOLD' ? 0 : parseFloat(rm[0].val), top = parseFloat(rm[1].val), sn = parseFloat(rm[2].val), bu = parseFloat(rm[3].val);
    if (t.devPct != null) { var lb2 = liveBal(t); if (lb2.length) { var held = lb2.reduce(function (a, x) { return a + x.pct; }, 0), o3 = [{ a: 'curve', pct: Math.max(0, 100 - held), label: 'Bonding curve', kind: 'curve' }];
      lb2.slice(0, 40).forEach(function (x) { var tg = []; if (x.a === t.creator) tg.push('dev'); if (S.account && x.a === S.account) tg.push('you'); o3.push({ a: x.a, pct: x.pct, tags: tg, first: (S.trades.filter(function (q) { return q.tick === t.tick && q.wallet === x.a; }).pop() || {}).t || t.born }); }); return o3; } }
    if (t.devPct != null && t.holders <= 3) { var o2 = [{ a: 'curve', pct: 100 - t.devPct, label: 'Bonding curve', kind: 'curve' }]; if (t.devPct > 0) o2.push({ a: t.creator || devOf(t), pct: t.devPct, tags: ['dev'].concat(S.account && t.creator === S.account ? ['you'] : []), first: t.born }); return o2; }
    var r = rng(hash(t.tick + 'hold')), dev = devOf(t), out = [], used = {}, B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    var fa = function () { var x = ''; for (var q = 0; q < 44; q++) x += B58[Math.floor(r() * 58)]; return x; };
    var poolP = t.prog < 100 ? Math.max(8, 100 - (10 + t.prog * .75)) : 20.6;
    out.push({ a: t.prog < 100 ? 'curve' : 'pool', pct: poolP, label: t.prog < 100 ? 'Bonding curve' : 'Raydium pool', kind: 'curve' });
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
    var legend = [['curve', t.prog < 100 ? 'Bonding curve' : 'Raydium pool'], ['#F2708A', 'Dev'], ['#FF9A4D', 'Sniper'], ['#B794FF', 'Bundle'], ['#3DDC97', 'You'], ['#CFC9BE', 'Holders'], ['rest', 'Everyone else']];
    var TAG = { dev: 'DEV', sniper: 'SNIPER', bundle: 'BUNDLE', you: 'YOU' };
    var rows = hs.map(function (h, i) {
      var c = colOf(h, i - 1), isC = h.kind === 'curve', val = mc * h.pct / 100;
      var who = isC ? '<span class="hw-ic curve"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="rgba(216,195,160,.2)" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="#D8C3A0" stroke-width="4" stroke-dasharray="' + (Math.min(100, t.prog) * .942).toFixed(1) + ' 94.2" transform="rotate(-90 18 18)" stroke-linecap="round"/></svg></span><span class="hw-n"><b>' + h.label + '</b><small>' + (t.prog < 100 ? 'unsold supply · ' + Math.min(100, t.prog).toFixed(0) + '% of curve filled' : 'liquidity locked in the pool') + '</small></span>'
        : '<span class="av" style="width:28px;height:28px">' + A.svg(walletSpec(h.a)) + '</span><span class="hw-n"><b class="mono">' + (h.a === S.account ? 'You' : WMAP[h.a] && WMAP[h.a].n ? '@' + WMAP[h.a].n : short(h.a)) + '</b><small>first buy ' + ago(h.first) + ' ago</small></span>' + h.tags.map(function (g) { return '<span class="htag ' + g + '">' + TAG[g] + '</span>'; }).join('');
      return '<div class="hrow2' + (isC ? ' is-curve' : '') + '"><span class="mono muted hr-n">' + (isC ? '—' : i) + '</span><span class="hw">' + who + '</span>' +
        '<span class="hbar2"><i style="width:' + Math.min(100, isC ? h.pct : h.pct / Math.max(1, wallets[0].pct) * 100).toFixed(1) + '%;' + (c === 'curve' ? '' : 'background:' + c) + '" class="' + (c === 'curve' ? 'curve' : '') + '"></i></span>' +
        '<span class="mono r hr-p">' + h.pct.toFixed(2) + '%</span><span class="mono r muted hr-v">$' + fmtNum(Math.round(val)) + '</span></div>';
    }).join('');
    return '<div class="htiles">' + tiles.map(function (x) { return '<div class="htile ' + x[2] + '"><small>' + x[0] + '</small><b class="mono">' + x[1] + '</b></div>'; }).join('') + '</div>' +
      '<div class="hdist2">' + segs + '</div><div class="hlegend">' + legend.map(function (l) { return '<span><i class="' + (l[0] === 'curve' ? 'curve' : l[0] === 'rest' ? 'rest' : '') + '" style="' + (l[0][0] === '#' ? 'background:' + l[0] : '') + '"></i>' + l[1] + '</span>'; }).join('') + '</div>' +
      '<div class="hhead"><span>#</span><span>Holder</span><span>Share</span><span class="r">%</span><span class="r">Value</span></div>' + rows;
  }
  function topTraders(t) {
    var m = {}, px = price(t);
    S.trades.forEach(function (tr) { if (tr.tick !== t.tick) return; var e = m[tr.wallet] = m[tr.wallet] || { a: tr.wallet, b: 0, s: 0, tok: 0, n: 0 }; var tok = tr.tokens || tr.sol * SOL_USD / px; e.n++; if (tr.side === 'buy') { e.b += tr.sol; e.tok += tok; } else { e.s += tr.sol; e.tok -= tok; } });
    return Object.keys(m).map(function (k) { var e = m[k]; if (e.b === 0 && e.s > 0) { e.b = e.s * (0.55 + (hash(e.a) % 70) / 100); e.n++; } e.val = Math.max(0, e.tok) * px / SOL_USD; e.pnl = e.s + e.val - e.b; return e; }).sort(function (a, b) { return b.pnl - a.pnl; }).slice(0, 15);
  }
  var CMT = ['LFG', 'tax is fair, aping in', 'chart looks clean ngl', 'who is still holding?', '0% buy tax is the way', 'this mascot is elite', 'graduation soon?', 'dev is active in tg', 'bought the dip', 'diamond hands only', 'see you at Raydium', 'buy pressure is insane right now', 'just found this, looks fun', 'held since 5k mc', 'sell tax keeps the paper hands away', 'the pair choice is genius', 'curve almost full', 'lowkey the best meme on here'];
  function seedComments(t) {
    if (S.comments[t.tick]) return S.comments[t.tick];
    var r = rng(hash(t.tick + 'c')), out = [];
    for (var i = 0; i < 9; i++) { var w = WALLETS[Math.floor(r() * WALLETS.length)]; out.push({ id: i, w: w.a, text: CMT[Math.floor(r() * CMT.length)], t: Date.now() - (i * 7 + r() * 6) * 60000, likes: Math.floor(r() * 30), liked: false, reply: i > 2 && r() < 0.3 ? i - 1 - Math.floor(r() * 2) : null }); }
    S.comments[t.tick] = out; return out;
  }
  // ===== CALLOUTS (pump.fun-style, upgraded) =====
  S.follow = {}; S.muted = {}; S.coMenu = null; S.coExp = {}; S.coPaused = false; S.coF = 'all'; S.coOpen = false; S.coQueue = 0; S.ttab = 'coin'; try { S.ttab = localStorage.getItem('dl.ttab') || 'coin'; } catch (e) {}
  try { S.follow = JSON.parse(localStorage.getItem('dl.follow') || '{}'); } catch (e) {}
  var CO_LONG = ['Been watching this since launch — dev is active, chart keeps making higher lows and the tax is clearly shown. Holding a small bag and adding on dips, not financial advice.', 'Paired with gold is such a clean narrative. If this keeps holding the curve it is going to graduate today, then it is a different game on Raydium.', 'Not gonna lie I aped on the mascot alone. Then checked holders: no snipers, no bundles, dev under 3%. That is rare these days.'];
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
      '<div class="co-t' + (long ? ' clamp' : '') + '">' + esc(c.text) + '</div>' + (long ? '<button class="co-more" data-act="coExpand" data-arg="' + esc(key) + '">Show more</button>' : '') +
      (c.pos > 0 && !opts.child ? '<button class="co-pos" data-act="open" data-arg="' + esc(t.tick) + '" title="Open $' + esc(t.tick) + '">' + avatarHTML(t, 26) + '<span class="co-pn"><b>' + esc(t.tick) + '</b><small>' + esc(t.name) + '</small></span><span class="co-pv"><small>Position</small><b class="mono">$' + fmtNum(c.pos) + '</b></span><span class="co-pv"><small>PnL</small><b class="mono ' + (up ? 'up' : 'down') + '">' + (up ? '+' : '−') + '$' + Math.abs(pnl).toFixed(2) + '</b></span><span class="co-go">›</span></button>' : '') +
      '<div class="co-a"><button data-act="coShare" data-arg="' + esc(key) + '" title="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8h16v-8M12 3v13M7 8l5-5 5 5"/></svg></button>' +
        '<button class="' + (c.rtd ? 'on rt' : '') + '" data-act="coRT" data-arg="' + esc(key) + '" title="Repost"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3"/></svg>' + (c.rt || '') + '</button>' +
        '<button class="' + (c.liked ? 'on lk' : '') + '" data-act="coLike" data-arg="' + esc(key) + '" title="Like"><svg viewBox="0 0 24 24" fill="' + (c.liked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z"/></svg>' + (c.likes || '') + '</button>' +
        '<button data-act="coReply" data-arg="' + esc(key) + '" title="Reply"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 01-11.6 7.1L4 21l1.9-5.4A8 8 0 1121 12z"/></svg>' + (kids.length || '') + '</button>' +
        '<span class="co-v"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>' + (c.views || 0) + '</span>' +
        (opts.child ? '' : '<span class="co-mc mono">' + fmtK(c.mc0 || t.mcN) + ' MC</span>') + '</div>' +
      (kids.length ? '<div class="co-kids">' + kids.map(function (k) { return commentHTML(k, t, false, { child: true }); }).join('') + '</div>' : '') + '</article>';
  }
  function threadHTML(t, list) {
    var byId = {}; list.forEach(function (c) { byId[c.id] = c; });
    var tops = list.filter(function (c) { return (c.reply == null || !byId[c.reply]) && !S.muted[c.w]; }).sort(function (a, b) { return b.t - a.t; });
    return tops.map(function (c) { var kids = list.filter(function (k) { return k.reply === c.id && !S.muted[k.w]; }).sort(function (a, b) { return a.t - b.t; }); return commentHTML(c, t, false, { kids: kids }); }).join('');
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
  function calloutDrawer() {
    if (!S.coOpen) return '';
    var list = globalCallouts();
    return '<aside class="co-drawer"><div class="cd-h"><b>🔥 Hot callouts</b><button class="cd-pause' + (S.coPaused ? ' on' : '') + '" data-act="coPause">' + (S.coPaused ? '▶ Resume' + (S.coQueue ? ' · ' + S.coQueue + ' new' : '') : '❚❚ Pause') + '</button><button class="iconbtn" data-act="coClose" aria-label="Close">✕</button></div>' +
      '<div class="cd-f">' + [['all', 'All'], ['follow', 'Following'], ['win', 'In profit'], ['hold', 'I hold']].map(function (f) { return '<button class="' + (S.coF === f[0] ? 'on' : '') + '" data-act="coFilter" data-arg="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
      '<div class="cd-list" id="cd-list">' + (list.length ? list.map(function (x) { return commentHTML(x.c, x.t); }).join('') : '<div class="muted" style="padding:30px 16px;text-align:center">' + (S.coF === 'follow' ? 'Follow people from their callouts and their posts show up here.' : 'Nothing here yet.') + '</div>') + '</div></aside>';
  }
  setInterval(function () {
    if (document.hidden) return; var t = pick(all()); if (!t) return;
    var cm = seedComments(t), w = WALLETS[Math.floor(Math.random() * WALLETS.length)];
    var c = { id: cm.length, w: w.a, text: pick(CMT), t: Date.now(), likes: 0, liked: false, reply: Math.random() < 0.25 && cm.length ? cm[Math.floor(Math.random() * cm.length)].id : null };
    cm.push(c); coMeta(c, t);
    var tb2 = document.getElementById('cmts'); if (tb2 && S.screen === 'token' && c.reply == null && (S.ttab === 'all' || S.tick === t.tick)) {
      var h0 = tb2.scrollHeight, away = tb2.scrollTop > 60; tb2.insertAdjacentHTML('afterbegin', commentHTML(c, t, !away, { coinTag: S.ttab === 'all' }));
      if (away) { tb2.scrollTop += tb2.scrollHeight - h0; var np = document.getElementById('tt-new'); if (np) { np._n = (np._n || 0) + 1; np.textContent = '↑ ' + np._n + ' new'; np.style.display = ''; } }
      while (tb2.children.length > 60) tb2.removeChild(tb2.lastChild); }
    var dl = document.getElementById('cd-list');
    if (dl && c.pos > 0 && c.reply == null && S.coF === 'all') { if (S.coPaused || dl.matches(':hover')) { S.coQueue++; var pb = document.querySelector('.cd-pause'); if (pb && S.coPaused) pb.textContent = '▶ Resume · ' + S.coQueue + ' new'; } else { dl.insertAdjacentHTML('afterbegin', commentHTML(c, t, true)); while (dl.children.length > 40) dl.removeChild(dl.lastChild); } }
    var nb = document.getElementById('co-new'); if (nb && !S.coOpen) { nb.textContent = (+nb.textContent || 0) + 1; nb.style.display = ''; }
  }, 3500);
  function position(t) { var p = S.pos[t.tick]; if (!p || p.tok <= 0) return null; var val = p.tok * price(t) / SOL_USD; return { tok: p.tok, cost: p.cost, val: val, pnl: val - p.cost, pct: p.cost ? (val / p.cost - 1) * 100 : 0 }; }
  function quoteFor(t) {
    var isBuy = S.side === 'buy', amt = parseFloat(String(S.amount).replace(',', '.')) || 0, px = price(t);
    var sol = isBuy ? amt : amt * px / SOL_USD, pct = effTax(t), tax = sol * pct / 100, net = sol - tax;
    var impact = Math.min(25, net * 3 / Math.sqrt(Math.max(t.mcN, 4)));
    var outTok = isBuy ? net * SOL_USD / (px * (1 + impact / 200)) : 0, outSol = isBuy ? 0 : net * (1 - impact / 200);
    return { isBuy: isBuy, amt: amt, sol: sol, pct: pct, tax: tax, impact: impact, out: isBuy ? outTok : outSol, min: (isBuy ? outTok : outSol) * (1 - S.slip / 100) };
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
  function durH(m) { return m < 60 ? Math.max(1, Math.round(m)) + 'm' : m < 1440 ? (m / 60).toFixed(m < 600 ? 1 : 0).replace('.0', '') + 'h' : Math.round(m / 1440) + 'd'; }
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
  // ===== HOLDER MAP: bubble map of top wallets =====
  function holderMap() {
    if (!S.hmap) return ''; var t = find(S.hmap); if (!t) return '';
    var hs = holdersOf(t).filter(function (h) { return h.kind !== 'curve'; }).slice(0, 32), W = 760, H = 480;
    if (!hs.length) return '<div class="hm-ov" data-act="hmapClose"><div class="hm card-s" data-stop><div class="hm-h"><b>Holder map · $' + esc(t.tick) + '</b><button class="iconbtn" data-act="hmapClose">✕</button></div><div class="muted" style="padding:60px;text-align:center">No holders yet — everything is still on the bonding curve.</div></div></div>';
    var mxp = hs[0].pct, R = function (p) { return Math.max(12, Math.sqrt(p / mxp) * 112); };
    var tag = function (h) { return h.tags.indexOf('dev') >= 0 ? 'dev' : h.tags.indexOf('you') >= 0 ? 'you' : h.tags.indexOf('sniper') >= 0 ? 'sn' : h.tags.indexOf('bundle') >= 0 ? 'bu' : 'w'; };
    // bundles first so they sit together, then the rest by size
    var order = hs.filter(function (h) { return tag(h) === 'bu'; }).concat(hs.filter(function (h) { return tag(h) !== 'bu'; }));
    var placed = [], r0 = rng(hash(t.tick + 'hm'));
    order.forEach(function (h, i) {
      var r = R(h.pct), best = null;
      if (!placed.length) best = { x: W / 2, y: H / 2 };
      var anchor = tag(h) === 'bu' && placed.length && tag(placed[placed.length - 1].h) === 'bu' ? placed[placed.length - 1] : { x: W / 2, y: H / 2 };
      for (var d = 0; !best && d < 900; d += 3) { for (var a = 0; a < 24; a++) { var ang = a / 24 * 6.283 + r0() * .3, x = anchor.x + Math.cos(ang) * d * 1.25, y = anchor.y + Math.sin(ang) * d * .8;
        if (x - r < 6 || x + r > W - 6 || y - r < 6 || y + r > H - 6) continue;
        if (placed.every(function (q) { return Math.hypot(q.x - x, q.y - y) > q.r + r + 4; })) { best = { x: x, y: y }; break; } } }
      if (best) placed.push({ x: best.x, y: best.y, r: r, h: h, k: tag(h) });
    });
    var bu = placed.filter(function (q) { return q.k === 'bu'; }), links = '';
    for (var i = 1; i < bu.length; i++) links += '<line x1="' + bu[i - 1].x.toFixed(1) + '" y1="' + bu[i - 1].y.toFixed(1) + '" x2="' + bu[i].x.toFixed(1) + '" y2="' + bu[i].y.toFixed(1) + '"/>';
    var sn = placed.filter(function (q) { return q.k === 'sn'; }); for (var j = 1; j < sn.length; j++) links += '<line class="sn" x1="' + sn[j - 1].x.toFixed(1) + '" y1="' + sn[j - 1].y.toFixed(1) + '" x2="' + sn[j].x.toFixed(1) + '" y2="' + sn[j].y.toFixed(1) + '"/>';
    var lab = { dev: 'Dev', you: 'You', sn: 'Sniper', bu: 'Bundle', w: 'Wallet' };
    var bubbles = placed.map(function (q, i) { return '<g class="hm-b k-' + q.k + '" style="--d:' + (i * 35) + 'ms" data-act="walletAny" data-arg="' + esc(q.h.a) + '" data-tip="' + esc(lab[q.k] + ' · ' + short(q.h.a) + ' · ' + q.h.pct.toFixed(2) + '%') + '"><title>' + esc(lab[q.k] + ' · ' + short(q.h.a) + ' · ' + q.h.pct.toFixed(2) + '% of supply') + '</title><circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + q.r.toFixed(1) + '"/>' + (q.r > 20 ? '<text x="' + q.x.toFixed(1) + '" y="' + (q.y + 4).toFixed(1) + '">' + q.h.pct.toFixed(q.h.pct >= 10 ? 0 : 1) + '%</text>' : '') + '</g>'; }).join('');
    var sum = function (k) { return placed.filter(function (q) { return q.k === k; }).reduce(function (a, q) { return a + q.h.pct; }, 0); };
    var top10 = hs.slice(0, 10).reduce(function (a, h) { return a + h.pct; }, 0);
    var stats = [['Top 10', top10.toFixed(1) + '%', top10 > 45 ? 'r' : top10 > 30 ? 'y' : 'g'], ['Connected (bundle)', bu.length ? bu.length + (bu.length > 1 ? ' wallets · ' : ' wallet · ') + sum('bu').toFixed(1) + '%' : 'none', bu.length ? (sum('bu') > 9 ? 'r' : 'y') : 'g'], ['Snipers', sn.length ? sn.length + (sn.length > 1 ? ' wallets · ' : ' wallet · ') + sum('sn').toFixed(1) + '%' : 'none', sn.length ? (sum('sn') > 12 ? 'r' : 'y') : 'g'], ['Dev', sum('dev') ? sum('dev').toFixed(1) + '%' : 'holds 0%', sum('dev') > 8 ? 'r' : 'g']];
    return '<div class="hm-ov" data-act="hmapClose"><div class="hm card-s" data-stop><div class="hm-h"><div><b>Bubble map</b><small>$' + esc(t.tick) + ' · top ' + placed.length + ' wallets · bubble size = share of supply · bonding curve hidden</small></div><button class="iconbtn" data-act="hmapClose" aria-label="Close">✕</button></div>' +
      '<div class="hm-body"><svg class="hm-svg" viewBox="0 0 ' + W + ' ' + H + '"><g class="hm-links">' + links + '</g>' + bubbles + '</svg>' +
      '<div class="hm-side">' + stats.map(function (x) { return '<div class="hm-st lv-' + x[2] + '"><small>' + x[0] + '</small><b class="mono">' + x[1] + '</b></div>'; }).join('') +
      '<div class="hm-leg">' + [['dev', 'Dev'], ['sn', 'Sniper'], ['bu', 'Bundle'], ['you', 'You'], ['w', 'Other wallet']].map(function (x) { return '<span><i class="k-' + x[0] + '"></i>' + x[1] + '</span>'; }).join('') + '<span><em></em>linked wallets</span></div>' +
      '<small class="muted hm-n">Click a bubble to see that wallet. Linked lines show wallets that bought together in the same block.</small></div></div></div></div>';
  }
  function walletDrawer() {
    if (!S.walletView) return '';
    var addr = S.walletView, t = find(S.tick) || featured(), st = walletStats(addr, t), other = walletOther(addr), dev = addr === devOf(t), tracked = S.trackWallets.indexOf(addr) !== -1;
    var pnlCls = st.pnl >= 0 ? 'up' : 'down', sign = function (v) { return (v >= 0 ? '+' : '') + v.toFixed(3); };
    return '<div class="overlay drawer-ov" data-act="bg"><aside class="drawer" role="dialog" aria-modal="true" aria-label="Wallet details">' +
      '<div class="dw-head"><span class="av" style="width:56px;height:56px">' + A.svg(walletSpec(addr)) + '</span><div style="flex:1;min-width:0"><b style="font-size:18px">' + esc(walletName(addr)) + '</b>' + (dev ? ' <span class="bdg dev">DEV</span>' : '') +
        '<button class="copy" style="display:flex;margin-top:4px" data-act="copyW" data-arg="' + esc(addr) + '">' + esc(addr.slice(0, 6) + '…' + addr.slice(-6)) + ' ' + I.copy + '</button></div><button class="iconbtn" data-act="closeW" aria-label="Close">✕</button></div>' +
      '<div class="dw-actions"><button class="btn ' + (tracked ? 'sec' : 'pri') + '" data-act="trackW" data-arg="' + esc(addr) + '">' + (tracked ? 'Tracking ✓' : 'Track wallet') + '</button><button class="btn sec" data-act="maker" data-arg="' + esc(addr) + '">Show its trades</button></div>' +
      devHistoryHTML(addr) + '<div class="dw-sec"><div class="dw-title">' + avatarHTML(t, 22) + 'on $' + esc(t.tick) + '</div>' +
        '<div class="dw-pnl"><span class="muted">Total PnL</span><b class="mono ' + pnlCls + '">' + sign(st.pnl) + ' SOL</b><span class="chgpill ' + pnlCls + '">' + (st.roi >= 0 ? '+' : '') + st.roi.toFixed(1) + '%</span></div>' +
        '<div class="dw-grid">' +
          [['Bought', '<span class="up">' + st.b.toFixed(3) + ' SOL</span>', st.nb + ' buys'], ['Sold', '<span class="down">' + st.s.toFixed(3) + ' SOL</span>', st.ns + ' sells'],
           ['Holding', fmtNum(st.hold) + ' $' + esc(t.tick), st.holdPct.toFixed(3) + '% of supply'], ['Value now', st.val.toFixed(3) + ' SOL', '$' + (st.val * SOL_USD).toFixed(2)],
           ['Avg entry', st.avgMc ? fmtK(st.avgMc) + ' MC' : '—', st.avg ? fmtPrice(st.avg) : ''], ['Realized / unreal.', '<span class="' + (st.realized >= 0 ? 'up' : 'down') + '">' + sign(st.realized) + '</span> / <span class="' + (st.unreal >= 0 ? 'up' : 'down') + '">' + sign(st.unreal) + '</span>', 'SOL'],
           ['First trade', st.first ? ago(st.first) + ' ago' : '—', ''], ['Last trade', st.last ? ago(st.last) + ' ago' : '—', '']].map(function (r) { return '<div><span class="muted">' + r[0] + '</span><b class="mono">' + r[1] + '</b>' + (r[2] ? '<small class="muted mono">' + r[2] + '</small>' : '') + '</div>'; }).join('') + '</div>' +
        '<div class="dw-sub">Where it bought &amp; sold</div>' + walletChart(addr, t, st) +
        '<div class="dw-sub">Its trades on $' + esc(t.tick) + '</div><div class="dw-trades">' + (st.trades.length ? st.trades.slice().reverse().map(function (x) {
          return '<div class="dwt ' + (x.side === 'buy' ? 'b' : 's') + '"><span class="ty">' + (x.side === 'buy' ? 'Buy' : 'Sell') + '</span><span class="mono">' + x.sol.toFixed(3) + ' SOL</span><span class="mono muted">@ ' + fmtK((x.price || price(t)) * 1e9 / 1000) + '</span><span class="mono muted">' + ago(x.t) + '</span><button class="txb" data-act="tx" data-arg="' + esc(x.sig || '') + '" aria-label="Copy transaction">' + I.copy + '</button></div>';
        }).join('') : '<div class="muted" style="padding:10px 0">No trades on this coin yet.</div>') + '</div></div>' +
      '<div class="dw-sec"><div class="dw-title">Other coins it trades</div>' + (other.length ? other.map(function (o) {
          var tk = find(o.tick); if (!tk) return ''; var net = o.s - o.b;
          return '<button class="dwo" data-act="open" data-arg="' + esc(o.tick) + '">' + avatarHTML(tk, 28) + '<span style="flex:1;text-align:left"><b>$' + esc(o.tick) + '</b><small class="muted mono" style="display:block">' + o.n + ' trades · ' + (o.b + o.s).toFixed(2) + ' SOL volume</small></span><span class="mono ' + (net >= 0 ? 'up' : 'down') + '">' + (net >= 0 ? '+' : '') + net.toFixed(2) + '</span></button>';
        }).join('') : '<div class="muted">Nothing else yet.</div>') + '</div>' +
      '<span class="note">Simulated wallet data in this beta.</span></aside></div>';
  }

  S.lbTab = 'mcap';
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
  function leadersPage() {
    var a = all(), tabs = [['mcap', 'Biggest', 'Market cap'], ['gain', 'Top gainers', '24h change'], ['vol', 'Most volume', '24h volume'], ['holders', 'Most holders', 'Holders'], ['traders', 'Top traders', 'Profit']];
    var cur = tabs.filter(function (x) { return x[0] === S.lbTab; })[0], ti = tabs.indexOf(cur);
    var tabBar = '<div class="lb-tabs" style="--i:' + ti + ';--n:' + tabs.length + '"><span class="lb-ind"></span>' + tabs.map(function (x) { return '<button class="' + (S.lbTab === x[0] ? 'on' : '') + '" data-act="lbtab" data-arg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var rows, champ, side = '';
    if (S.lbTab === 'traders') {
      var m = {};
      S.trades.forEach(function (x) { var e2 = m[x.wallet] = m[x.wallet] || { a: x.wallet, b: 0, s: 0, n: 0, coins: {} }; e2.n++; e2.coins[x.tick] = 1; if (x.side === 'buy') e2.b += x.sol; else e2.s += x.sol; });
      var list = Object.keys(m).map(function (k2) { var e2 = m[k2]; e2.pnl = e2.s - e2.b * 0.82 + (hash(k2) % 50) / 100; e2.nc = Object.keys(e2.coins).length; return e2; }).sort(function (x, y) { return y.pnl - x.pnl; }).slice(0, 20);
      var mxp = Math.max.apply(null, list.map(function (e2) { return Math.abs(e2.pnl); }).concat([.01]));
      var w0 = list[0];
      champ = '<div class="champ"><div class="rays"></div><div class="champ-av"><span class="av" style="width:150px;height:150px">' + A.svg(walletSpec(w0.a)) + '</span><span class="crown">♛</span></div>' +
        '<div class="champ-info"><span class="kicker">#1 TRADER</span><h2>' + esc(walletName(w0.a)) + '</h2><div class="champ-v mono up">+' + w0.pnl.toFixed(2) + ' SOL</div><div class="champ-sub">' + w0.n + ' trades · ' + w0.nc + ' coins · ' + (w0.b + w0.s).toFixed(1) + ' SOL volume</div>' +
        '<button class="btn pri" data-act="walletAny" data-arg="' + esc(w0.a) + '">View wallet</button></div></div>';
      side = [1, 2].map(function (k2) { var e2 = list[k2]; if (!e2) return ''; return '<button class="podc p' + (k2 + 1) + '" data-act="walletAny" data-arg="' + esc(e2.a) + '"><span class="podc-r">' + (k2 + 1) + '</span><span class="av" style="width:64px;height:64px">' + A.svg(walletSpec(e2.a)) + '</span><b>' + esc(walletName(e2.a)) + '</b><span class="mono up">+' + e2.pnl.toFixed(2) + ' SOL</span><small>' + e2.n + ' trades</small></button>'; }).join('');
      rows = list.slice(3).map(function (e2, i) {
        var mv = ((hash(e2.a) % 7) - 3);
        return '<button class="lrow" style="--d:' + (i * 45) + 'ms" data-act="walletAny" data-arg="' + esc(e2.a) + '"><span class="lr-rank">' + (i + 4) + '</span><span class="lr-mv ' + (mv > 0 ? 'up' : mv < 0 ? 'down' : '') + '">' + (mv > 0 ? '▲' + mv : mv < 0 ? '▼' + (-mv) : '–') + '</span><span class="av" style="width:42px;height:42px">' + A.svg(walletSpec(e2.a)) + '</span>' +
          '<span class="lr-name"><b>' + esc(walletName(e2.a)) + '</b><small class="mono">' + e2.n + ' trades · ' + e2.nc + ' coins</small></span><span class="lr-bar"><i style="--w:' + (Math.abs(e2.pnl) / mxp * 100).toFixed(1) + '%" class="' + (e2.pnl >= 0 ? '' : 'neg') + '"></i></span>' +
          '<span class="lr-chg mono"></span><span class="lr-big mono ' + (e2.pnl >= 0 ? 'up' : 'down') + '">' + (e2.pnl >= 0 ? '+' : '') + e2.pnl.toFixed(2) + ' SOL</span></button>';
      }).join('');
    } else {
      var key = { mcap: function (t) { return t.mcN; }, gain: function (t) { return chg(t); }, vol: function (t) { return t.vol; }, holders: function (t) { return t.holders; } }[S.lbTab];
      var fmt = { mcap: function (t) { return fmtK(t.mcN); }, gain: function (t) { return chgTxt(chg(t)); }, vol: function (t) { return fmtK(t.vol); }, holders: function (t) { return fmtNum(t.holders); } }[S.lbTab];
      var l2 = a.slice().sort(function (x, y) { return key(y) - key(x); }).slice(0, 20), mx = Math.abs(key(l2[0])) || 1, c0 = l2[0], cc = chg(c0);
      var live = S.lbTab === 'mcap' ? ' data-mc="' + esc(c0.tick) + '" data-v="' + fmtK(c0.mcN) + '"' : '';
      champ = '<div class="champ"><div class="rays"></div><div class="champ-av">' + avatarHTML(c0, 150) + '<span class="crown">♛</span></div>' +
        '<div class="champ-info"><span class="kicker">#1 · ' + cur[2].toUpperCase() + '</span><h2>' + esc(c0.name) + ' <span>$' + esc(c0.tick) + '</span></h2><div class="champ-v mono"' + live + '>' + fmt(c0) + '</div>' +
        '<div class="champ-sub"><span class="chgpill ' + (cc >= 0 ? 'up' : 'down') + '">' + chgTxt(cc) + '</span>' + coinHTML(c0.pair, 16) + ' paired with ' + esc(pairLabel(c0.pair)) + ' · ' + fmtNum(c0.holders) + ' holders</div>' +
        '<div class="champ-chart">' + lbSpark(c0, 400, 90) + '</div><button class="btn pri" data-act="open" data-arg="' + esc(c0.tick) + '">Trade $' + esc(c0.tick) + '</button></div></div>';
      side = [1, 2].map(function (k2) { var t = l2[k2]; if (!t) return ''; var c2 = chg(t); return '<button class="podc p' + (k2 + 1) + '" data-act="open" data-arg="' + esc(t.tick) + '"><span class="podc-r">' + (k2 + 1) + '</span>' + avatarHTML(t, 64) + '<b>$' + esc(t.tick) + '</b><span class="mono"' + (S.lbTab === 'mcap' ? ' data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '"' : '') + '>' + fmt(t) + '</span><small class="' + (c2 >= 0 ? 'up' : 'down') + '">' + chgTxt(c2) + '</small>' + lbSpark(t, 200, 40) + '</button>'; }).join('');
      rows = l2.slice(3).map(function (t, i) {
        var v = Math.max(2, Math.abs(key(t)) / mx * 100), c = chg(t), mv = ((hash(t.tick + S.lbTab) % 7) - 3);
        return '<button class="lrow" style="--d:' + (i * 45) + 'ms" data-act="open" data-arg="' + esc(t.tick) + '"><span class="lr-rank">' + (i + 4) + '</span><span class="lr-mv ' + (mv > 0 ? 'up' : mv < 0 ? 'down' : '') + '">' + (mv > 0 ? '▲' + mv : mv < 0 ? '▼' + (-mv) : '–') + '</span>' + avatarHTML(t, 42) +
          '<span class="lr-name"><b>' + esc(t.name) + '</b><small class="mono">$' + esc(t.tick) + ' · ' + coinHTML(t.pair, 13) + ' ' + esc(pairLabel(t.pair)) + '</small></span>' +
          mcJourney(t) + '<span class="lr-ath"><small>ATH</small><b class="mono">' + fmtK(athOf(t)) + '</b><em class="mono ' + (t.mcN >= athOf(t) * .98 ? 'up' : 'down') + '">' + (t.mcN >= athOf(t) * .98 ? 'at ATH' : '−' + ((1 - t.mcN / athOf(t)) * 100).toFixed(0) + '%') + '</em></span><span class="lr-chg mono ' + (c >= 0 ? 'up' : 'down') + '" data-chg2="' + esc(t.tick) + '">' + chgTxt(c) + '</span>' +
          '<span class="lr-big mono"' + (S.lbTab === 'mcap' ? ' data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '"' : '') + '>' + fmt(t) + '</span></button>';
      }).join('');
    }
    return '<main class="wrap lbpage" style="padding-top:22px"><section class="lb-hero"><div class="lb-glow"></div><div class="lb-head"><div><span class="kicker">RANKINGS</span><h1>Hall of Memes</h1></div>' + tabBar + '</div>' +
      '<div class="lb-stage" key="' + S.lbTab + '">' + champ + '<div class="podcs">' + side + '</div></div></section>' +
      '<section class="lb-list card-s">' + rows + '</section><p class="note" style="margin-top:12px">Rankings use simulated market data in this beta.</p></main>';
  }


  function tokenPage() {
    var t = find(S.tick) || featured(), on = S.watch.indexOf(t.tick) !== -1, c = chg(t), id = esc(t.tick);
    var ath = athOf(t), athPct = t.mcN / ath * 100;
    var tt = S.trades.filter(function (x) { return x.tick === t.tick; }), nb = 0, ns = 0, vb = 0, vs = 0;
    tt.forEach(function (x) { if (x.side === 'buy') { nb++; vb += x.sol; } else { ns++; vs += x.sol; } });
    var q = quoteFor(t), pos = position(t), tmax = Math.max(t.buy, t.sell);
    var curveSol = (t.prog / 100 * 85).toFixed(2);
    var head = '<section class="card-s tp-head2 tp-banner"><div class="tb-bg' + (t.banner ? ' ban' : '') + '" aria-hidden="true">' + (t.banner ? '<img src="' + t.banner + '" alt="">' : avatarHTML(t, 420)) + '</div><div class="tb-av">' + avatarHTML(t, 104) + '</div>' +
      '<div class="tp-id"><div class="title-xl" style="margin:0;font-size:30px">' + esc(t.name) + ' <span class="tk">$' + id + '</span></div>' + msBadges(t, 'lg') + (t.archived ? '<div class="arch-note ' + t.archived + '">' + (t.archived === 'rug' ? '⚠ Past coin · dev sold after ' + durH(t.devSoldAfter) : t.archived === 'dead' ? '💤 Past coin · inactive, faded on the curve' : '🎓 Past coin · graduated') + '</div>' : '') +
        '<div class="hs-pills" style="margin-top:8px"><button class="pill copy2" data-act="ca" data-arg="' + id + '">CA ' + esc(short(t.ca)) + ' ' + I.copy + '</button><span class="pill" style="padding-left:11px">created <span data-t="' + t.born + '">&nbsp;' + ago(t.born) + '</span>&nbsp;ago by&nbsp;' + makerHTML(devOf(t), t) + '</span>' +
        socialsHTML(t, true) +
        '<button class="iconbtn" data-act="star" data-arg="' + id + '" aria-label="Watchlist" aria-pressed="' + on + '">' + I.star(on) + '</button><button class="iconbtn" data-act="share" aria-label="Copy link"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8h16v-8M12 3v13M7 8l5-5 5 5"/></svg></button></div></div>' +
      '<div class="tp-key">' + (trapLeft(t) > 0 ? trapBox(t, 'head') : '') + '<div class="tax" style="background:' + taxBg(tmax) + ';padding:9px 14px"><small>TAX</small><b style="font-size:24px">' + tmax + '%</b><small style="letter-spacing:.04em;font-size:9px">BUY & SELL</small>' + (splitOf(t) ? splitBar(splitOf(t), 'mini') : '') + '</div>' +
        '<button class="pairbig" data-act="pairOpen" data-arg="' + esc(t.pair) + '">' + coinHTML(t.pair, 42) + '<div><small>PAIRED WITH</small><b>' + esc(pairLabel(t.pair)) + '</b><span>' + esc(pairInfo(t.pair).name) + '</span></div></button></div></section>';
    var bp = nb + ns ? nb / (nb + ns) * 100 : 50, vp = vb + vs ? vb / (vb + vs) * 100 : 50, offAth = (1 - t.mcN / ath) * 100;
    var mcrow = '<section class="card-s mcrow2"><div class="mc2-top"><div class="mc2-main"><small>Market cap</small><div class="mc2-v"><span data-mc="' + id + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</span><span class="chgpill ' + (c >= 0 ? 'up' : 'down') + '" data-chg="' + id + '">' + chgTxt(c) + '</span></div>' +
        '<div class="mc2-ath"><span>ATH <b class="mono">' + fmtK(ath) + '</b></span><span class="' + (offAth < 2 ? 'up' : 'down') + '">' + (offAth < 2 ? 'at all-time high' : '−' + offAth.toFixed(0) + '% from ATH') + '</span></div></div>' +
        '<div class="mc2-j">' + mcJourney(t) + '</div></div>' +
      '<div class="mc2-tiles">' + [['Price', '<span data-price="' + id + '" data-v="' + fmtPrice(price(t)) + '">' + fmtPrice(price(t)) + '</span>'], ['24h volume', fmtK(t.vol)], ['Liquidity', fmtK(curveSol * SOL_USD / 1000)], ['Holders', fmtNum(t.holders)]].map(function (r) { return '<div><small>' + r[0] + '</small><b class="mono">' + r[1] + '</b></div>'; }).join('') + '</div>' +
      (function () {
        var spanM = { '5m': 5, '1h': 60, '24h': 1440 }[S.stf || '24h'], since = Date.now() - spanM * 60000, list = tt.filter(function (x) { return x.t >= since; });
        var rb = 0, rs = 0, rbv = 0, rsv = 0; list.forEach(function (x) { if (x.side === 'buy') { rb++; rbv += x.sol; } else { rs++; rsv += x.sol; } });
        var tot = t.vol * 1000 * { '5m': .012, '1h': .09, '24h': 1 }[S.stf || '24h'], vr = rbv + rsv ? rbv / (rbv + rsv) : .55, cr = rb + rs ? rb / (rb + rs) : .55, n = Math.max(1, Math.round(tot / 180));
        var bv = tot * vr, sv = tot - bv, b = Math.round(n * cr), se = n - b, nbw = Math.round(b * .62), nsw = Math.round(se * .71);
        var h = t.hist, ref = h[Math.max(0, h.length - 1 - Math.round(h.length * spanM / 1440))], pc = (t.mcN / ref - 1) * 100;
        var row = function (l, a, bb, fa, fb) { var tot = a + bb, w = tot ? a / tot * 100 : 50; return '<div class="st-row"><div class="st-v"><span class="up"><b class="mono">' + fa + '</b> ' + l[0] + '</span><span class="down"><b class="mono">' + fb + '</b> ' + l[1] + '</span></div><div class="bs-bar"><i style="width:' + w.toFixed(1) + '%"></i></div></div>'; };
        return '<div class="st-box"><div class="st-h"><b>Activity</b><span class="st-pc ' + (pc >= 0 ? 'up' : 'down') + '">' + (pc >= 0 ? '↑ +' : '↓ ') + pc.toFixed(1) + '%</span><span class="st-vol muted">Vol <b class="mono">' + fmtK((bv + sv) / 1000) + '</b></span><div class="seg sm st-tf">' + ['5m', '1h', '24h'].map(function (x) { return '<button class="' + ((S.stf || '24h') === x ? 'on' : '') + '" data-act="stf" data-arg="' + x + '">' + x + '</button>'; }).join('') + '</div></div>' +
          row(['buys', 'sells'], b, se, fmtNum(b), fmtNum(se)) + row(['bought', 'sold'], bv, sv, fmtK(bv / 1000), fmtK(sv / 1000)) + row(['buyers', 'sellers'], nbw, nsw, fmtNum(nbw), fmtNum(nsw)) + '</div>' +
          '<div class="st-foot"><div><small>Pool</small><b class="mono">' + fmtK(curveSol * SOL_USD / 1000) + ' <em>(' + curveSol + ' SOL)</em></b><span class="muted">paired with ' + coinHTML(t.pair, 14) + ' ' + esc(pairLabel(t.pair)) + '</span></div>' +
          '<div><small>Creator</small><b>' + makerHTML(devOf(t), t) + '</b><span class="muted">' + (splitOf(t) ? 'earns ' + splitOf(t).d + '% of tax' : 'no tax on this coin') + '</span></div>' +
          '<button class="st-bub" data-act="hmap" data-arg="' + id + '">◎ Bubble map</button></div>' +
          (t.desc ? '<div class="st-desc"><small>About</small><p>' + esc(t.desc) + '</p></div>' : '') + '</section>';
      })();
    var chart = '<section class="card-s panel cpanel' + (S.cfull ? ' chart-fs' : '') + '">' + chartToolbar(t) +
      '<div class="chartbox" id="chart">' + chartSVG(t) + '</div><div class="c-help muted">scroll to zoom where you point · pinch · drag to pan · + / − keys</div></section>';
    // tabs
    if (S.tpTab === 'thread') S.tpTab = 'trades';
    var tabs = [['trades', 'Trades'], ['holders', 'Holders'], ['top', 'Top traders']];
    var cmAll = seedComments(t);
    var ttAll = S.ttab === 'all';
    var thread = '<aside class="tp-thread card-s"><div class="tt-h"><b>Callouts</b><div class="tt-tabs"><button class="' + (ttAll ? '' : 'on') + '" data-act="ttab" data-arg="coin">$' + id + ' <span class="mono">' + cmAll.length + '</span></button><button class="' + (ttAll ? 'on' : '') + '" data-act="ttab" data-arg="all"><i class="tt-dot"></i>All live</button></div></div>' +
      '<div class="composer">' + (S.account ? '<textarea id="cmt-in" class="inp" data-bind="cmtDraft" placeholder="' + (S.replyTo != null ? 'Replying to #' + (1000 + S.replyTo) + '…' : 'Call it: what\'s your take on $' + id + '?') + '" maxlength="280">' + esc(S.cmtDraft || '') + '</textarea><button class="btn pri" data-act="post">Post</button>' :
        '<span class="muted">Connect a wallet to post a callout.</span><button class="btn sec" data-act="openWallet">Connect</button>') + '</div>' +
      '<div class="tt-wrap"><button class="tt-new" id="tt-new" data-act="ttNew" style="display:none"></button><div id="cmts" class="tt-list' + (ttAll ? ' all' : '') + '">' + (ttAll ? allLiveHTML() : threadHTML(t, cmAll)) + '</div></div></aside>';
    var body = '';
    if (S.tpTab === 'trades') {
      var rows = tt.filter(tradeMatches).slice(0, 40);
      body = '<div class="tfilters"><div class="seg">' + [['all', 'All'], ['buy', 'Buys'], ['sell', 'Sells'], ['whale', 'Whales ≥2'], ['mine', 'Mine']].map(function (f) { return '<button class="' + (S.tpFilter === f[0] ? 'on' : '') + '" data-act="tpf" data-arg="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
        '<label class="minsol"><span class="muted">Min SOL</span><input id="minsol" class="inp" inputmode="decimal" data-bind="minSol" value="' + esc(S.minSol) + '" placeholder="0"></label>' +
        (S.tpMaker ? '<button class="chip on" data-act="maker" data-arg="">Wallet ' + esc(short(S.tpMaker)) + ' ✕</button>' : '') +
        '<span class="paused" id="tp-paused" style="display:none" data-act="resume">Paused · <b id="tp-qn">0</b> new trades — click to resume</span></div>' +
        '<div class="tbl" id="tp-tbl"><div class="trow h"><button class="link" data-act="abs" style="min-height:0;font-size:12px">' + (S.absTime ? 'Time ⇄' : 'Age ⇄') + '</button><span>Type</span><span class="r">USD</span><span class="r">SOL</span><span class="r">$' + id + '</span><span class="r">Price</span><span>Maker</span><span class="r">Txn</span></div>' +
        '<div id="tp-trades">' + (rows.length ? rows.map(function (x) { return tradeRow(x, t); }).join('') : '<div class="muted" style="padding:24px;text-align:center">No trades match these filters</div>') + '</div></div>';
    } else if (S.tpTab === 'thread') {
      var cm = seedComments(t);
      body = '<div class="composer">' + (S.account ? '<textarea id="cmt-in" class="inp" data-bind="cmtDraft" placeholder="' + (S.replyTo != null ? 'Replying to #' + (1000 + S.replyTo) + '…' : 'Say something about $' + id + '…') + '" maxlength="280">' + esc(S.cmtDraft || '') + '</textarea><button class="btn pri" data-act="post">Post</button>' :
        '<span class="muted">Connect a wallet to join the thread.</span><button class="btn sec" data-act="openWallet">Connect wallet</button>') + '</div>' +
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
    var bal = S.account && typeof S.balance === 'number' ? S.balance : null;
    var presets = q.isBuy ? ['reset', '0.1', '0.5', '1', '5'].map(function (p) { return '<button data-act="preset" data-arg="' + p + '">' + (p === 'reset' ? 'Reset' : p + ' SOL') + '</button>'; }).join('') :
      ['25', '50', '75', '100'].map(function (p) { return '<button data-act="sellpct" data-arg="' + p + '"' + (pos ? '' : ' disabled') + '>' + p + '%</button>'; }).join('');
    var panel = '<section class="card-s panel tradebox">' +
      '<div class="bs"><button class="b' + (q.isBuy ? ' on' : '') + '" data-act="side" data-arg="buy">Buy</button><button class="s' + (!q.isBuy ? ' on' : '') + '" data-act="side" data-arg="sell">Sell</button></div>' +
      '<div class="tb-top"><span class="muted" style="font-size:12.5px">' + (q.isBuy ? (bal != null ? 'Balance ' + bal.toFixed(3) + ' SOL' : 'Amount in SOL') : (pos ? 'You hold ' + fmtNum(pos.tok) + ' $' + id : 'You hold 0 $' + id)) + '</span>' +
        '<button class="slipbtn" data-act="slip">Slippage ' + S.slip + '% ⚙</button></div>' +
      (S.slipOpen ? '<div class="slipbox"><span class="muted" style="font-size:12px">Max slippage</span><div class="presets">' + [1, 3, 5, 10, 20].map(function (v) { return '<button class="' + (S.slip === v ? 'on' : '') + '" data-act="setslip" data-arg="' + v + '">' + v + '%</button>'; }).join('') + '</div><span class="muted" style="font-size:11.5px">Priority fee: 0.0001 SOL · MEV protection on</span></div>' : '') +
      '<div class="amtwrap"><input id="amt" class="inp" inputmode="decimal" data-bind="amount" value="' + esc(S.amount) + '" placeholder="0.0"><span>' + (q.isBuy ? coinHTML('SOL', 22) + 'SOL' : avatarHTML(t, 22) + '$' + id) + '</span></div>' +
      '<div class="presets">' + presets + '</div>' +
      '<div class="quote"><div><span class="muted">' + (q.isBuy ? 'Buy' : 'Sell') + ' tax (' + q.pct + '%)</span><span style="color:' + taxBg(q.pct) + '">' + q.tax.toFixed(4) + ' SOL</span></div>' +
        '<div><span class="muted">Price impact</span><span class="' + (q.impact > 5 ? 'down' : '') + '">' + q.impact.toFixed(2) + '%</span></div>' +
        '<div><span class="muted">Min received (' + S.slip + '% slip)</span><span>' + (q.isBuy ? fmtNum(q.min) + ' $' + id : q.min.toFixed(4) + ' SOL') + '</span></div>' +
        '<div style="padding-top:9px;border-top:1px solid var(--line)"><span class="muted">You receive ≈</span><span style="font-weight:800;font-size:15px">' + (q.isBuy ? fmtNum(q.out) + ' $' + id : q.out.toFixed(4) + ' SOL') + '</span></div></div>' +
      (trapLeft(t) > 0 ? trapBox(t, 'buy') : '') +
      '<button class="big-btn btn ' + (!S.account ? 'pri' : q.isBuy ? 'up-b' : 'down-b') + '" data-act="trade" data-arg="' + id + '">' + (!S.account ? 'Connect wallet to trade' : (q.isBuy ? 'Buy $' : 'Sell $') + id) + '</button>' +
      '<span class="note">Wallet is real (devnet). Trades are simulated in this beta — nothing is sent on-chain.</span></section>';
    var posCard = pos ? '<section class="card-s panel poscard"><div style="display:flex;justify-content:space-between;align-items:center"><b>Your position</b><button class="link" style="min-height:0;font-size:12.5px;color:var(--down)" data-act="sellall">Sell all</button></div>' +
      '<div class="pos-v"><span class="mono" style="font-size:22px;font-weight:700">' + pos.val.toFixed(4) + ' SOL</span><span class="chgpill ' + (pos.pnl >= 0 ? 'up' : 'down') + '">' + (pos.pnl >= 0 ? '+' : '') + pos.pct.toFixed(1) + '%</span></div>' +
      '<div class="muted mono" style="font-size:12px">' + fmtNum(pos.tok) + ' $' + id + ' · cost ' + pos.cost.toFixed(4) + ' SOL · PnL <span class="' + (pos.pnl >= 0 ? 'up' : 'down') + '">' + (pos.pnl >= 0 ? '+' : '') + pos.pnl.toFixed(4) + '</span></div></section>' : '';
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
      '<div class="sf-row sf-flags"><span class="sf-ok">✓ Mint authority revoked</span><span class="sf-ok">✓ Freeze authority revoked</span><span class="' + (t.prog >= 100 ? 'sf-ok">✓ LP burned' : 'sf-mid">• Liquidity held by bonding curve') + '</span><span class="' + (Math.max(t.buy, t.sell) >= 6 ? 'sf-bad">! High tax ' + Math.max(t.buy, t.sell) + '%' : 'sf-ok">✓ Tax ' + Math.max(t.buy, t.sell) + '% or less') + '</span></div>' +
      '<span class="note" style="text-align:left">These checks only show what is visible on-chain. They are not a guarantee — always do your own research. Simulated in this beta.</span></section>';
    var curve = '<section class="card-s panel" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between"><b>' + (t.prog >= 100 ? 'Graduated to Raydium' : 'Bonding curve') + '</b><span class="mono" style="color:var(--ice)" data-prog="' + id + '">' + Math.min(100, t.prog).toFixed(0) + '%</span></div>' +
      '<div class="bar" style="height:12px"><i class="' + (t.prog >= 100 ? 'done' : '') + '" data-bar="' + id + '" style="width:' + Math.max(1, Math.min(100, t.prog)) + '%"></i></div>' +
      '<span class="muted" style="font-size:12.5px;line-height:1.55">' + (t.prog >= 100 ? 'Liquidity is live on Raydium.' : curveSol + ' SOL in the curve. Graduates to Raydium at 100%.') + '</span></section>';
    var mbuy = '<button class="m-buy" data-act="mBuy">Buy / Sell $' + id + (trapLeft(t) > 0 ? ' · 🪤 ' + snipeNow(t) + '%' : ' · tax ' + tmax + '%') + '</button>';
    return mbuy + '<main class="wrap tp-env" style="padding-top:14px;--coin:' + ((t.spec && t.spec.bg) || '#2A2418') + '"><div class="tp-glow" aria-hidden="true">' + avatarHTML(t, 300) + '</div><button class="link" data-act="home">' + I.back + 'Back to board</button>' + head +
      '<div class="tp-grid3">' + thread + '<div class="tp-main">' + mcrow + chart + tabsHTML + '</div><aside class="tp-side">' + panel + posCard + taxSplitPanel(t) + safety + curve + '</aside></div></main>';
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
  function isCA(q) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q); }
  function pairSearch(q) {
    q = q.trim(); var ql = q.toLowerCase().replace(/^\$/, ''), out = [];
    Object.keys(PAIR_INFO).forEach(function (id) { var pi = PAIR_INFO[id]; if (id.toLowerCase().indexOf(ql) > -1 || pi.name.toLowerCase().indexOf(ql) > -1 || (pi.ca && pi.ca === q)) out.push(id); });
    all().forEach(function (t) { if (out.indexOf(t.tick) > -1) return; if (t.tick.toLowerCase().indexOf(ql) > -1 || t.name.toLowerCase().indexOf(ql) > -1 || t.ca === q) out.push(t.tick); });
    return out.slice(0, 8);
  }
  // ---- one tax for buy & sell + optional anti-sniper trap ----
  function snipeNow(t, at) { var sn = t.snipe; if (!sn || !sn.on) return 0; var age = ((at || Date.now()) - t.born) / 1000; if (age >= sn.dur) return 0; return sn.start; }
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
    if (cls === 'card') return '<small>SNIPER TAX</small><b>' + t.snipe.start + '%</b><em class="mono" data-liqt>' + left + '</em>';
    if (cls === 'head') return '<span class="lq-big mono">' + t.snipe.start + '%</span><span class="lq-tx"><b>🪤 Sniper tax</b><small>drops to <i>' + m + '%</i> in <i class="mono" data-liqt>' + left + '</i></small></span>';
    return '<span class="lq-big mono">' + t.snipe.start + '%</span><span class="lq-tx"><b>Sniper tax is on</b><small>Buying now costs <i>' + t.snipe.start + '%</i> tax. When it drains (<i class="mono" data-liqt>' + left + '</i>) it drops instantly to <i>' + m + '%</i>.</small></span>';
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
    document.querySelectorAll('[data-trapt]').forEach(function (e) { var t = find(e.getAttribute('data-trapt')); if (t) e.textContent = trapFmt(trapLeft(t)); });
  }, 250);
  function effTax(t, at) { return Math.max(Math.max(t.buy, t.sell), snipeNow(t, at)); }
  function devQuote(sol) {
    sol = Math.max(0, +sol || 0); var px0 = 5 * 1000 / 1e9, impact = Math.min(25, sol * 3 / Math.sqrt(5));
    var tok = sol * SOL_USD / (px0 * (1 + impact / 200)); tok = Math.min(tok, 8e8);
    return { sol: sol, tok: tok, pct: tok / 1e9 * 100 };
  }
  // ===== CONTRACT ADDRESS ENDING: free ...treid or paid custom =====
  var B58C = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function vanFee(n) { return n <= 0 ? 0 : n <= 4 ? 0.1 : n === 5 ? 0.5 : 2; }
  function vanEta(n) { return n <= 4 ? 'instant' : n === 5 ? '~10 sec' : '~5 min · queued'; }
  function vanPrev(c) { var v = c.van || {}, suf = v.mode === 'custom' && v.suf ? v.suf : 'treid', pre = (c.vanPre || (c.vanPre = b58(44))).slice(0, 44 - suf.length); return '<span class="mono">' + pre.slice(0, 6) + '<i>' + pre.slice(6, 14) + '…</i></span><b class="mono">' + esc(suf) + '</b>'; }
  function vanityPicker(c) {
    return '<div class="van fixed"><div class="van-h"><b>Contract address</b><small>every coin launched here ends in treid</small></div>' +
      '<div class="van-prev"><small>Your address</small><div id="van-prev">' + vanPrev({ vanPre: c.vanPre || (c.vanPre = b58(44)) }) + '</div><span class="van-fee ok mono">free · instant</span></div></div>';
  }
  function devBuyPicker(c) {
    var q = devQuote(String(c.devBuy || '').replace(',', '.')), lv = q.pct === 0 ? 'z' : q.pct < 3 ? 'g' : q.pct < 8 ? 'y' : 'r';
    var note = { z: 'No initial buy — you start with 0%. Fair launch.', g: 'Looks fair to buyers.', y: 'Buyers will notice your holding.', r: 'Big dev bag — buyers will see this as a risk.' }[lv];
    return '<div class="field devb"><div class="lbl"><b>Your initial buy <span class="muted" style="font-weight:500;font-size:12px">· optional, no tax for the creator</span></b></div>' +
      '<div class="devb-row"><label class="devb-in" for="c-devbuy"><input id="c-devbuy" inputmode="decimal" data-bind="c.devBuy" value="' + esc(c.devBuy || '') + '" placeholder="0.0" autocomplete="off"><span class="devb-u">' + coinHTML('SOL', 20) + 'SOL</span></label>' +
      '<div class="devb-q">' + ['0', '0.1', '0.5', '1', '2', '5'].map(function (v) { return '<button class="' + (String(c.devBuy || '0') === v ? 'on' : '') + '" data-act="devbuy" data-arg="' + v + '">' + (v === '0' ? 'None' : v) + '</button>'; }).join('') + '</div></div>' +
      '<div class="devb-res ' + lv + '"><div class="devb-n"><span><small>You get</small><b class="mono">' + fmtNum(Math.round(q.tok)) + '</b><em>$' + esc(c.tick || 'TICKER') + '</em></span><span class="devb-p"><small>Share of supply</small><b class="mono">' + q.pct.toFixed(2) + '%</b></span></div>' +
      '<div class="devb-bar"><i style="width:' + Math.min(100, q.pct / 20 * 100).toFixed(2) + '%"></i><u style="left:15%"><em>3%</em></u><u style="left:40%"><em>8%</em></u><u style="left:100%"><em>20%+</em></u></div><div class="devb-note">' + note + '</div></div></div>';
  }
  // ---- preview demo coins with your own images (stored only in this browser) ----
  var DIMG = {}; try { DIMG = JSON.parse(localStorage.getItem('dl.demoimgs') || '{}'); } catch (e) {}
  BASE.forEach(function (t) { if (DIMG[t.tick]) t.img = DIMG[t.tick]; });
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
    var r = rng(hash(t.tick + 'split')), k = t.burn && !t.rewards ? 'deflation' : t.rewards ? 'community' : ['community', 'deflation', 'balanced', 'community'][Math.floor(r() * 4)], p = SPRE[k];
    if (r() < .3) { var h = 20 + Math.round(r() * 12) * 5, d = Math.min(50, 5 + Math.round(r() * 5) * 5); if (h + d > 95) h = 95 - d; t.split = { p: 'custom', h: h, b: 100 - h - d, d: d }; }
    else t.split = { p: k, h: p[2], b: p[3], d: p[4] };
    return t.split;
  }
  function splitBar(sp, cls) { return '<span class="spbar ' + (cls || '') + '">' + ['h', 'b', 'd'].filter(function (k) { return sp[k] > 0; }).map(function (k) { return '<i style="flex:' + sp[k] + ';background:' + SPC[k][3] + '"></i>'; }).join('') + '</span>'; }
  function splitTip(t) { var sp = splitOf(t), m = Math.max(t.buy, t.sell); return sp ? 'Tax ' + m + '% → ' + sp.h + '% holders · ' + sp.b + '% burn · ' + sp.d + '% dev (locked)' : 'No tax — plain coin'; }
  function splitPicker(c) {
    var base = c.buy; if (base <= 0) return '<div class="spk off"><b>Where the tax goes</b><small>0% tax — nothing to split. Your coin trades as a plain token.</small></div>';
    var sp = c.split || (c.split = { p: 'community', h: 70, b: 20, d: 10 });
    var chips = Object.keys(SPRE).map(function (k) { var p = SPRE[k]; return '<button class="spc' + (sp.p === k ? ' on' : '') + '" data-act="spPre" data-arg="' + k + '"><span class="spc-ic">' + ICO[p[0]] + '</span><b>' + p[1] + '</b><small class="mono">' + p[2] + ' / ' + p[3] + ' / ' + p[4] + '</small>' + splitBar({ h: p[2], b: p[3], d: p[4] }) + '</button>'; }).join('') +
      '<button class="spc' + (sp.p === 'custom' ? ' on' : '') + '" data-act="spPre" data-arg="custom"><span class="spc-ic">' + ICO.custom + '</span><b>Custom</b><small>set it yourself</small><span class="spbar"><i style="flex:1;background:repeating-linear-gradient(90deg,#3a3a40 0 4px,#26262a 4px 8px)"></i></span></button>';
    var ex = function (k) { return (base * sp[k] / 100).toFixed(2).replace(/\.?0+$/, '') + '%'; };
    var rows = ['h', 'b', 'd'].map(function (k) { var c0 = SPC[k]; return '<div class="spr" style="--c:' + c0[0] + '"><span class="spr-l"><span class="sp-ic">' + ICO[c0[1]] + '</span>' + c0[2] + '</span>' + (sp.p === 'custom' ? '<span class="spr-rg' + (k === 'd' ? ' cap' : '') + '"><input type="range" min="0" max="100" step="5" value="' + sp[k] + '" data-split="' + k + '">' + (k === 'd' ? '<em>cap 50%</em>' : '') + '</span>' : '<span class="spr-fill"><i style="width:' + sp[k] + '%;background:' + c0[3] + '"></i></span>') + '<b class="mono" data-spv="' + k + '">' + sp[k] + '%</b><small class="mono" data-spx="' + k + '">' + ex(k) + ' of each trade</small></div>'; }).join('');
    return '<div class="spk"><div class="spk-h"><b>Where the tax goes</b><span class="spk-lock">' + ICO.lock + 'Locked forever at launch</span></div><div class="spk-chips">' + chips + '</div>' +
      '<div class="spk-viz"><div class="spk-big" data-spbig>' + splitBar(sp, 'big') + '</div>' + rows + '</div>' +
      '<small class="spk-note">Dev share is capped at 50%. The treid platform fee is separate and never comes out of this split.</small></div>';
  }
  function spUpdate() {
    var sp = S.c.split, base = S.c.buy; ['h', 'b', 'd'].forEach(function (k) { var v = document.querySelector('[data-spv="' + k + '"]'), x = document.querySelector('[data-spx="' + k + '"]'), r = document.querySelector('[data-split="' + k + '"]'); if (v) v.textContent = sp[k] + '%'; if (x) x.textContent = (base * sp[k] / 100).toFixed(2).replace(/\.?0+$/, '') + '% of each trade'; if (r && +r.value !== sp[k]) r.value = sp[k]; });
    var bg = document.querySelector('[data-spbig]'); if (bg) bg.innerHTML = splitBar(sp, 'big');
  }
  function taxSplitPanel(t) {
    var sp = splitOf(t), m = Math.max(t.buy, t.sell); if (!sp) return '<section class="card-s panel tsp-panel"><b>Where the tax goes</b><small class="muted">0% tax — plain coin, nothing is split.</small></section>';
    var pre = SPRE[sp.p], name = pre ? pre[1] : 'Custom';
    return '<section class="card-s panel tsp-panel"><div class="tsp-h"><b>Where the ' + m + '% tax goes</b><span class="tsp-p">' + ICO.lock + name + ' · locked</span></div>' + splitBar(sp, 'big') +
      '<div class="tsp-rows">' + ['h', 'b', 'd'].map(function (k) { var c0 = SPC[k]; return '<div class="tsp-r" style="--c:' + c0[0] + '"><em class="sp-ic">' + ICO[c0[1]] + '</em><span>' + c0[2] + '</span><b class="mono">' + sp[k] + '%</b><small class="mono">' + (m * sp[k] / 100).toFixed(2).replace(/\.?0+$/, '') + '% / trade</small></div>'; }).join('') + '</div>' +
      '<small class="muted tsp-n">On a 1 SOL buy: ' + ['h', 'b', 'd'].map(function (k) { return (m / 100 * sp[k] / 100).toFixed(4).replace(/0+$/, '') + ' SOL ' + SPC[k][2].toLowerCase(); }).join(' · ') + '</small></section>';
  }
  function taxPicker(c) {
    var sn = c.snipe || { on: false, start: 80, dur: 60 }, base = c.buy;
    var steps = []; for (var v = 0; v <= 10; v++) steps.push('<button class="txs' + (base === v ? ' on' : '') + '" style="--tc:' + taxBg(v) + '" data-act="ctax" data-arg="' + v + '">' + v + '%</button>');
    var W = 280, H = 80, x0 = 34, x1 = W - 10, y = function (v) { return 10 + (1 - v / 100) * (H - 30); }, pts = [];
    for (var k = 0; k <= 30; k++) { var f = k / 30, tx = sn.start - (sn.start - base) * f; pts.push((x0 + f * (x1 - x0)).toFixed(1) + ',' + y(tx).toFixed(1)); }
    var graph = '<svg class="trap-g" viewBox="0 0 ' + W + ' ' + H + '"><defs><linearGradient id="trapf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2708A" stop-opacity=".35"/><stop offset="1" stop-color="#F2708A" stop-opacity="0"/></linearGradient></defs>' +
      '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + (H - 20) + '" y2="' + (H - 20) + '" stroke="#2A2A2E"/>' +
      '<polygon points="' + x0 + ',' + (H - 20) + ' ' + pts.join(' ') + ' ' + x1 + ',' + (H - 20) + '" fill="url(#trapf)"/><polyline points="' + pts.join(' ') + '" fill="none" stroke="#F2708A" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="' + x0 + '" cy="' + y(sn.start).toFixed(1) + '" r="3" fill="#F2708A"/><circle cx="' + x1 + '" cy="' + y(base).toFixed(1) + '" r="3" fill="#D6D1C9"/>' +
      '<text x="' + (x0 - 6) + '" y="' + (y(sn.start) + 3).toFixed(1) + '" fill="#F2708A" font-size="10" text-anchor="end" font-family="JetBrains Mono,monospace">' + sn.start + '%</text>' +
      '<text x="' + x1 + '" y="' + (y(base) - 7).toFixed(1) + '" fill="#D6D1C9" font-size="10" text-anchor="end" font-family="JetBrains Mono,monospace">' + base + '%</text>' +
      '<text x="' + x0 + '" y="' + (H - 6) + '" fill="#7A766F" font-size="9" font-family="JetBrains Mono,monospace">launch</text><text x="' + x1 + '" y="' + (H - 6) + '" fill="#7A766F" font-size="9" text-anchor="end" font-family="JetBrains Mono,monospace">+' + (sn.dur < 60 ? sn.dur + 's' : sn.dur / 60 + 'm') + '</text></svg>';
    return '<div class="field taxf"><div class="lbl"><b>Tax <span class="muted" style="font-weight:500;font-size:12px">· same for buys and sells</span></b><span class="mono" style="color:' + taxBg(base) + '">' + base + '%</span></div><div class="txrow">' + steps.join('') + '</div></div>' +
      '<div class="trap' + (sn.on ? ' on' : '') + '"><button class="trap-t" data-act="snipeToggle"><span class="trap-ic">🪤</span><span><b>Sniper trap</b><small>Early buyers pay a much higher tax until the timer runs out — then it drops instantly to your normal ' + base + '%.</small></span><i class="sw2"><i></i></i></button>' +
      (sn.on ? (function () {
        var durTxt = function (sec) { return sec < 60 ? sec + 's' : (sec % 60 ? Math.floor(sec / 60) + 'm ' + (sec % 60) + 's' : sec / 60 + 'm'); };
        var at = function (f) { return Math.round(sn.start - (sn.start - base) * f); };
        var ticks = '';
        return '<div class="trap-cfg2"><div class="tc-row"><span class="tc-l">Trap tax</span><div class="tc-seg">' + [25, 50, 80, 90].map(function (v) { return '<button class="' + (sn.start === v ? 'on' : '') + '" data-act="snipeStart" data-arg="' + v + '">' + v + '%</button>'; }).join('') + '</div></div>' +
          '<div class="tc-row"><span class="tc-l">Lasts for</span><div class="tc-seg g">' + [[5, '5s'], [10, '10s'], [15, '15s'], [20, '20s'], [30, '30s'], [45, '45s'], [60, '1 min']].map(function (d) { return '<button class="' + (sn.dur === d[0] ? 'on' : '') + '" data-act="snipeDur" data-arg="' + d[0] + '">' + d[1] + '</button>'; }).join('') + '</div></div>' +
          '<div class="tl3"><div class="liq liq-prev" style="--f:.62"><span class="liq-fill"><svg class="liq-w" viewBox="0 0 120 10" preserveAspectRatio="none"><path d="M0 5 Q7.5 0 15 5 T30 5 T45 5 T60 5 T75 5 T90 5 T105 5 T120 5 V10 H0Z"/></svg></span><span class="liq-c"><span class="lq-big mono">' + sn.start + '%</span><span class="lq-tx"><b>What buyers see</b><small>drains over ' + durTxt(sn.dur) + ', then tax drops to <i>' + base + '%</i></small></span></span></div></div>' +
          '<div class="tc-ex">💡 A bot buying <b>1 SOL</b> in the first ' + durTxt(sn.dur) + ' pays <b class="dn">' + (sn.start / 100).toFixed(2) + ' SOL</b> tax. One second after the sand runs out, the same buy pays just <b>' + (base / 100).toFixed(2) + ' SOL</b>.</div></div>';
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
      : '<svg viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/></svg>';
    return '<label class="socf s-' + k + (ok ? ' ok' : '') + '" for="c-' + k + '"><span class="socf-ic">' + ic + '</span><span class="socf-in"><input id="c-' + k + '" data-bind="c.' + k + '" value="' + esc(v) + '" placeholder="' + ph + '" autocomplete="off" aria-label="' + name + ' link"></span><span class="socf-ck">✓</span></label>';
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
    var preview = { devPct: +dq.pct.toFixed(2), name: c.name || 'Your token', tick: c.tick || 'TICKER', spec: sp, img: c.img, banner: c.banner, buy: c.buy, sell: c.sell, split: c.buy > 0 ? c.split : null, pair: c.pair, mcN: 5, mc0: 5, prog: 1, born: Date.now(), holders: 1, vol: 0, ca: 'preview', hist: [5, 5.1, 5, 5.2, 5.4], rewards: false, burn: false };
    function opts(key, list) { return '<div class="optrow">' + list.map(function (v) { return '<button class="opt' + (sp[key] === v ? ' on' : '') + '" data-act="spec" data-k="' + key + '" data-arg="' + v + '">' + v + '</button>'; }).join('') + '</div>'; }
    function sws(key, list) { return '<div class="optrow">' + list.map(function (v) { return '<button class="sw' + (sp[key] === v ? ' on' : '') + '" style="background:' + v + '" data-act="spec" data-k="' + key + '" data-arg="' + v + '" aria-label="Colour ' + v + '"></button>'; }).join('') + '</div>'; }
    return '<main class="wrap" style="padding-top:22px;max-width:1240px">' +
      '<button class="link" data-act="home">' + I.back + 'Back to board</button>' +
      '<h1 class="title-xl" style="font-size:38px;margin:8px 0 22px">Launch a token</h1>' +
      '<div class="create-grid">' +
        '<section class="card-s panel" style="flex:999 1 520px;min-width:0;display:flex;flex-direction:column;gap:20px;padding:24px">' +
          '<div class="fsec"><i>1</i>Identity</div>' +
          '<div class="ident"><label class="ident-ban' + (c.banner ? ' has' : '') + '" for="c-banner" data-drop="banner">' + (c.banner ? '<img src="' + c.banner + '" alt="">' : '<span class="ib-ph">' + I.up + '<b>Add a banner</b><small>3:1 · e.g. 1500×500 · recommended</small></span>') + '</label>' +
            '<label class="ident-logo' + (c.img ? ' has' : '') + '" for="c-img" data-drop="img">' + (c.img ? '<img src="' + c.img + '" alt="">' : '<span class="il-ph">' + I.up + '<b>Logo</b></span>') + '</label>' +
            '<div class="ident-meta"><b>' + esc(c.name || 'Your coin') + '</b><span class="mono">$' + esc(c.tick || 'TICKER') + '</span></div>' +
            '<div class="ident-acts">' + (c.img ? '<button class="link" data-act="clearImg">Remove logo</button>' : '<span class="req">logo required</span>') + (c.banner ? '<button class="link" data-act="clearBanner">Remove banner</button>' : '') + '</div></div>' +
          '<input id="c-img" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="sr"><input id="c-banner" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="sr">' +
          '<div class="row"><div class="field" style="flex:2 1 220px"><label for="c-name" style="font-weight:700">Name</label><input id="c-name" class="inp" maxlength="32" data-bind="c.name" value="' + esc(c.name) + '" placeholder="e.g. Giga Pug"></div>' +
            '<div class="field" style="flex:1 1 140px"><label for="c-tick" style="font-weight:700">Ticker</label><span class="tick-in"><em>$</em><input id="c-tick" class="inp mono" data-bind="c.tick" value="' + esc(c.tick) + '" placeholder="DFROG"></span></div></div>' +
          '<div class="field"><label for="c-desc" style="font-weight:700">Description</label><textarea id="c-desc" class="inp" data-bind="c.desc" placeholder="What is this token about?">' + esc(c.desc) + '</textarea></div>' +
          '<div class="fsec"><i>2</i>Market</div>' +
          pairPicker(c) +
          taxPicker(c) + splitPicker(c) + devBuyPicker(c) + vanityPicker(c) +
          '<div class="fsec"><i>3</i>Community</div>' +
          '<div class="socrow"><span class="soc-l">Socials <small>optional · shown as buttons on your coin</small></span><div class="socgrid">' + socField(c, 'x', 'X', '', 'Paste X link') + socField(c, 'tg', 'Telegram', '', 'Paste Telegram link') + socField(c, 'web', 'Website', '', 'Paste website link') + '</div></div>' +
          '<button class="big-btn btn pri" data-act="launch">' + (S.account ? 'Launch token' : 'Connect wallet to launch') + '</button>' +
          '<span class="note">Beta: launching adds your token to this board (saved in your browser). On-chain launch via Raydium LaunchLab is coming next.</span>' +
        '</section>' +
        '<aside style="flex:1 1 320px;display:flex;flex-direction:column;gap:12px;position:sticky;top:90px"><span class="kicker">LIVE PREVIEW</span>' + card(preview, { preview: true }) +
          '<div class="card-s panel pv-sum"><div class="pv-row">' + avatarHTML(preview, 52) + '<div><b>At launch</b><small class="muted">what buyers will see</small></div></div>' +
            '<div class="pv-grid"><div><small>You hold</small><b class="mono" style="color:' + (dq.pct < 3 ? '#3DDC97' : dq.pct < 8 ? '#FFD15C' : '#F2708A') + '">' + dq.pct.toFixed(2) + '%</b></div><div><small>Snipers</small><b class="mono up">0%</b></div><div><small>Bundles</small><b class="mono up">0%</b></div><div><small>Tax</small><b class="mono">' + tmax + '%</b></div></div>' +
            (c.snipe && c.snipe.on ? '<div class="pv-trap">🪤 Sniper trap: ' + c.snipe.start + '% → ' + tmax + '% over ' + (c.snipe.dur < 60 ? c.snipe.dur + 's' : c.snipe.dur / 60 + 'm') + '</div>' : '') + '</div></aside>' +
      '</div></main>';
  }

  function walletModal() {
    if (!S.walletOpen) return '';
    var opts = S.wallets.length ? S.wallets.map(function (w) {
      var busy = S.connecting === w.name;
      return '<button class="wopt" data-act="pickWallet" data-arg="' + esc(w.name) + '"' + (S.connecting ? ' disabled' : '') + '>' + (w.icon ? '<img src="' + esc(w.icon) + '" alt="">' : '') +
        '<span style="flex:1">' + esc(w.name) + '</span><span class="muted" style="font-size:12.5px;font-weight:600">' + (busy ? 'Approve in wallet…' : 'Detected') + '</span></button>';
    }).join('') : '<div class="card-s" style="padding:16px;display:flex;flex-direction:column;gap:10px"><b>No Solana wallet found</b><span class="muted" style="font-size:13.5px;line-height:1.55">Install Phantom, Solflare or Backpack and reload. On mobile, open this site in your wallet app’s browser.</span><a href="https://phantom.com/download" target="_blank" rel="noopener">Get Phantom →</a></div>';
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
      '<div class="palette-in">' + I.search + '<input id="pal" data-bind="palQ" value="' + esc(S.palQ) + '" placeholder="Search by name, ticker or contract address" autocomplete="off"><span class="kbd">Esc</span></div>' +
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
      '<span>Beta · market data on this page is simulated · wallet connects to Solana ' + CLUSTER + '</span>' +
      '<span style="margin-left:auto;display:flex;gap:16px"><a href="#machine" data-act="how">How it works</a><a href="#" data-act="social">X</a><a href="#" data-act="social">Telegram</a><a href="#" data-act="social">Terms</a></span></div></footer>';
  }

  // ================= RENDER =================
  var firstCount = true;
  function render() {
    var ae = document.activeElement, fid = ae && ae.id, ss = null, se = null;
    try { if (fid && ae.selectionStart != null) { ss = ae.selectionStart; se = ae.selectionEnd; } } catch (e) {}
    var body = S.screen === 'token' ? tokenPage() : S.screen === 'create' ? createPage() : S.screen === 'leaders' ? leadersPage() : S.screen === 'watch' ? watchPage() : S.screen === 'burn' ? burnPage() : S.screen === 'trend' ? trendPage() : home();
    document.getElementById('app').innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="ccUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3DDC97" stop-opacity=".28"/><stop offset="1" stop-color="#3DDC97" stop-opacity="0"/></linearGradient><linearGradient id="ccDn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2708A" stop-opacity=".26"/><stop offset="1" stop-color="#F2708A" stop-opacity="0"/></linearGradient></defs></svg>' + tape() + header() + body + footer() + walletModal() + demoImgModal() + calloutDrawer() + palette() + walletDrawer() + holderMap();
    if (fid) { var el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) {} } }
    if (S.palOpen && !fid) { var p = document.getElementById('pal'); if (p) p.focus(); }
    if (S.screen === 'home' && !S.loading && firstCount) { firstCount = false; countUp(); }
    if (typeof reveal === 'function') reveal();
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

  function applyTrade(t, side, sol, wallet, mine) {
    var dir = side === 'buy' ? 1 : -1;
    var impact = Math.min(6, sol * 3 / Math.sqrt(Math.max(t.mcN, 4)));
    t.mcN = Math.max(2, t.mcN * (1 + dir * impact / 100));
    t.vol += sol * SOL_USD / 1000;
    var wasGrad = t.prog >= 100;
    if (t.prog < 100) { t.prog = Math.max(0, Math.min(100, t.prog + dir * sol * 0.25)); t.mcN = Math.max(t.mcN * .985, Math.min(t.mcN * 1.015, curveMc(t.prog))); if (t.prog >= 100) t.mcN = Math.max(t.mcN, 69); }
    if (side === 'buy' && Math.random() < 0.4) t.holders += 1;
    t.hist.push(t.mcN); if (t.hist.length > 160) t.hist.shift(); athOf(t);
    if (t.tk) { t.tk.push([Date.now(), t.mcN, sol]); if (t.tk.length > 5000) t.tk.splice(0, 500); }
    var tr = { tick: t.tick, side: side, sol: sol, wallet: wallet || pickWallet(), t: Date.now(), tax: sol * effTax(t) / 100, mine: !!mine, price: price(t), sig: b58(64) }; tr.tokens = sol * SOL_USD / tr.price;
    S.trades.unshift(tr); if (S.trades.length > 400) S.trades.pop();
    S.tradeCount++;
    paint(t, dir, tr);
    t._lt = Date.now();
    var cardEl = document.querySelector('.tcard[data-card="' + t.tick + '"]');
    if (cardEl) { cardEl.classList.remove('shake', 'shake-s'); void cardEl.offsetWidth; cardEl.classList.add(side === 'buy' ? 'shake' : 'shake-s'); if (S.sort === 'bump' && S.screen === 'home' && !cardEl.matches(':hover')) { var gp = cardEl.parentNode; if (gp && gp.firstChild !== cardEl) gp.insertBefore(cardEl, gp.firstChild); } }
    machineTrade(t, tr);
    if (S.screen === 'home') raceUpdate(t, side, sol);
    if (!wasGrad && t.prog >= 100) { machineGrad(t); toast('$' + t.tick + ' graduated to Raydium', t); if (S.screen === 'token' && S.tick === t.tick) confetti(); }
    return tr;
  }

  function paint(t, dir, tr) {
    var c = chg(t), cls = c >= 0 ? 'up' : 'down';
    q(attr('data-mc', t.tick)).forEach(function (el) { roll(el, fmtK(t.mcN), dir); });
    q(attr('data-price', t.tick)).forEach(function (el) { roll(el, fmtPrice(price(t)), dir); });
    q(attr('data-chg', t.tick)).forEach(function (el) { el.textContent = chgTxt(c); el.className = 'chgpill ' + cls; });
    q(attr('data-chg2', t.tick)).forEach(function (el) { el.textContent = chgTxt(c); el.classList.remove('up', 'down'); el.classList.add(cls); });
    q(attr('data-chg3', t.tick)).forEach(function (el) { el.textContent = chgTxt(c); el.className = 'bc ' + cls; var b = el.parentNode; if (b) { b.classList.toggle('pos', c >= 0); b.classList.toggle('neg', c < 0); b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); } });
    q(attr('data-tape', t.tick)).forEach(function (el) { el.textContent = chgTxt(c); el.className = cls; });
    q(attr('data-spark', t.tick)).forEach(function (el) { el.setAttribute('points', spark(t)); el.setAttribute('stroke', c >= 0 ? '#3DDC97' : '#F2708A'); });
    q(attr('data-cchart', t.tick)).forEach(function (el) { el.innerHTML = cardChart(t); el.classList.toggle('up', c >= 0); el.classList.toggle('down', c < 0); });
    q(attr('data-prog', t.tick)).forEach(function (el) { el.textContent = Math.min(100, t.prog).toFixed(0) + '%'; });
    q(attr('data-bar', t.tick)).forEach(function (el) { el.style.width = Math.max(1, Math.min(100, t.prog)) + '%'; if (t.prog >= 100) el.classList.add('done'); });
    var st = document.getElementById('stat-trades'); if (st) st.textContent = fmtNum(S.trades.length + S.tradeCount);
    var i2t = document.getElementById('i2-tr'); if (i2t) { i2t.textContent = fmtNum(S.trades.length + S.tradeCount); i2t.classList.remove('tick'); void i2t.offsetWidth; i2t.classList.add('tick'); }
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
      if (box && !box.matches(':hover')) { box.innerHTML = chartSVG(t); }
      tpNewTrade(tr, t);
      var ab = document.querySelector('[data-athbar="' + t.tick + '"]'); if (ab) { var athv = athOf(t); ab.style.width = (t.mcN / athv * 100).toFixed(1) + '%'; }
    }
  }

  function tickMarket() {
    if (S.loading || document.visibilityState !== 'visible') return;
    var a = all(), t = a[Math.floor(Math.pow(Math.random(), 1.6) * a.length)];
    var momentum = chg(t) > 0 ? 0.56 : 0.5;
    var side = Math.random() < momentum ? 'buy' : 'sell';
    var sol = +(Math.pow(Math.random(), 2.2) * 5 + 0.03).toFixed(3);
    applyTrade(t, side, sol);
  }
  setInterval(tickMarket, 1100);

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
    toast('New launch: ' + name + ' $' + tick, t);
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
  (function loop() { setTimeout(function () { newLaunch(); loop(); }, rnd(14000, 24000)); })();

  setInterval(function () { q('[data-t]').forEach(function (el) { el.textContent = ago(+el.getAttribute('data-t')); }); }, 5000);

  // ================= EVENTS =================
  function openToken(tick) { S.cpan = 0; S.cys = 1; S.cyo = 0; var tA = S.archive[tick] && !all().some(function (x) { return x.tick === tick; }) ? S.archive[tick] : null, tfA = null;
    if (tA && tA.span) { var best = TFS[0]; TFS.forEach(function (x) { if (tA.span / x[2] >= 40) best = x; }); tfA = best[0]; var bA = best[2]; S.czoom = Math.max(20, Math.min(120, Math.ceil(tA.span / bA) + 6)); S.cpan = Math.max(0, Math.floor(Date.now() / bA) - Math.floor((tA.born + tA.span) / bA) - 3); }
    set({ walletView: null, screen: 'token', tick: tick, side: 'buy', amount: '', tf: tfA || S.tf || '1M', tpTab: 'trades', palOpen: false, walletMenu: false }); window.scrollTo(0, 0); }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (S.fpop && !e.target.closest('.fdrop')) { S.fpop = null; if (!el) { render(); return; } }
    if (S.walletMenu && !e.target.closest('.wpill') && !(el && /airdrop|refresh|copyAddr|disconnect/.test(el.getAttribute('data-act')))) { S.walletMenu = false; if (!el) { render(); return; } }
    if (S.coMenu && !e.target.closest('.co-mw')) { S.coMenu = null; if (!el) { render(); return; } }
    if (!el) return;
    var act = el.getAttribute('data-act'), arg = el.getAttribute('data-arg');
    if (el.tagName === 'A' && act !== 'how') e.preventDefault();
    switch (act) {
      case 'bg': if (e.target === el) set({ walletOpen: false, palOpen: false, walletView: null }); break;
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
      case 'ctog': S[arg] = !S[arg]; render(); break;
      case 'cfull': set({ cfull: !S.cfull }); break;
      case 'ttab': S.ttab = arg; try { localStorage.setItem('dl.ttab', arg); } catch (e) {} render(); break;
      case 'ttNew': var tl = document.getElementById('cmts'); if (tl) tl.scrollTo({ top: 0, behavior: 'smooth' }); var npb = document.getElementById('tt-new'); if (npb) { npb._n = 0; npb.style.display = 'none'; } break;
      case 'cauto': S.cys = 1; S.cyo = 0; chartRedraw(); break;
      case 'cnow': S.cpan = 0; S.cys = 1; S.cyo = 0; chartRedraw(); break;
      case 'czoom': S.czoom = arg === 'reset' ? 70 : Math.max(12, Math.min(240, Math.round(S.czoom * (arg === 'in' ? .7 : 1.4)))); if (arg === 'reset') { S.cpan = 0; S.cys = 1; S.cyo = 0; } chartRedraw(); var zl = document.querySelector('.czoom .mono'); if (zl) zl.textContent = S.czoom; break;
      case 'tpTab': set({ tpTab: arg }); break;
      case 'hmap': set({ hmap: arg }); break;
      case 'hmapClose': if (el.classList.contains('hm-ov') && e.target.closest('[data-stop]')) break; set({ hmap: null }); break;
      case 'side': set({ side: arg }); break;
      case 'preset': if (arg === 'reset') { set({ amount: '' }); break; } set({ pctAmt: 0, amount: arg === 'max' ? Math.max(0, S.balance - 0.01).toFixed(3) : arg }); break;
      case 'openWallet': set({ walletOpen: true }); break;
      case 'closeWallet': set({ walletOpen: false }); break;
      case 'walletMenu': set({ walletMenu: !S.walletMenu }); break;
      case 'pickWallet': var w = S.wallets.filter(function (x) { return x.name === arg; })[0]; if (w) connect(w, false); break;
      case 'disconnect': disconnect(); break;
      case 'airdrop': airdrop(); break;
      case 'refresh': refreshBalance(); toast('Balance refreshed'); break;
      case 'spec': var k = el.getAttribute('data-k'), spc = {}; for (var x in S.c.spec) spc[x] = S.c.spec[x]; spc[k] = arg; setC({ spec: spc }); break;
      case 'randomLogo': setC({ img: null, spec: { kind: pick(A.KINDS), skin: pick(A.SKINS), bg: pick(A.BGS), eyes: pick(A.EYES), mouth: pick(A.MOUTHS), acc: pick(A.ACCS) } }); break;
      case 'clearImg': setC({ img: null }); break;
      case 'clearBanner': setC({ banner: null }); break;
      case 'cpair': setC({ pair: arg }); break;
      case 'burnPage': set({ screen: 'burn', palOpen: false, coOpen: false }); window.scrollTo(0, 0); break;
      case 'lsort': if (S.lsort === arg) S.ldir = -S.ldir; else { S.lsort = arg; S.ldir = -1; } render(); break;
      case 'trendList': S.lsort = 'rank'; S.ldir = -1; set({ screen: 'trend', palOpen: false, coOpen: false }); window.scrollTo(0, 0); break;
      case 'bsort': S.bsort = arg; render(); break;
      case 'tcat': S.tcat = arg; render(); break;
      case 'tpreset': S.lsort = arg; S.ldir = -1; render(); break;
      case 'mBuy': var tbx = document.querySelector('.tradebox'); if (tbx) tbx.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
      case 'stf': S.stf = arg; render(); break;
      case 'fwGo': fwCenter(FW.hi === +arg ? -1 : +arg); break;
      case 'demoImgs': set({ demoImgOpen: true }); break;
      case 'realMemes': try { localStorage.setItem('dl.realmemes', REAL_ON ? '0' : '1'); } catch (er) {} location.reload(); break;
      case 'demoImgsClose': if (e.target === el || el.tagName === 'BUTTON') set({ demoImgOpen: false }); break;
      case 'demoImgsReset': BASE.forEach(function (t) { if (DIMG[t.tick]) delete t.img; }); DIMG = {}; try { localStorage.removeItem('dl.demoimgs'); } catch (er) {} render(); break;
      case 'devbuy': setC({ devBuy: arg === '0' ? '' : arg }); break;
      case 'ctax': setC({ buy: +arg, sell: +arg }); break;
      case 'vanMode': S.c.van = S.c.van || { mode: 'treid', suf: '' }; S.c.van.mode = arg; render(); setTimeout(function () { var vi = document.getElementById('van-suf'); if (vi) vi.focus(); }, 30); break;
      case 'spPre': var sp1 = S.c.split || {}; if (arg === 'custom') setC({ split: { p: 'custom', h: sp1.h || 70, b: sp1.b || 20, d: sp1.d || 10 } }); else { var pp = SPRE[arg]; setC({ split: { p: arg, h: pp[2], b: pp[3], d: pp[4] } }); } break;
      case 'snipeToggle': var sn0 = S.c.snipe || { on: false, start: 80, dur: 60 }; sn0.on = !sn0.on; setC({ snipe: sn0 }); break;
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
      case 'leaders': set({ screen: 'leaders', palOpen: false }); window.scrollTo(0, 0); break;
      case 'watchPage': set({ screen: 'watch', palOpen: false }); window.scrollTo(0, 0); break;
      case 'unstar':
        var row = document.querySelector('.wl-row[data-wl="' + arg + '"]');
        var doUn = function () { S.watch = S.watch.filter(function (x) { return x !== arg; }); try { localStorage.setItem(LS.watch, JSON.stringify(S.watch)); } catch (er) {} render(); };
        if (row) { row.classList.add('bye'); setTimeout(doUn, 320); } else doUn();
        toast('Removed $' + arg + ' from watchlist', find(arg)); break;
      case 'wlClear': if (!S.wlConfirm) { set({ wlConfirm: true }); setTimeout(function () { if (S.wlConfirm) set({ wlConfirm: false }); }, 3000); break; }
        S.watch = []; S.wlConfirm = false; try { localStorage.setItem(LS.watch, '[]'); } catch (er) {} render(); toast('Watchlist cleared'); break;
      case 'lbtab': set({ lbTab: arg }); break;
      case 'walletAny': S.hmap = null;
      case 'walletAnyX': S.tick = (S.trades.filter(function (x) { return x.wallet === arg; })[0] || {}).tick || S.tick; set({ walletView: arg }); break;
      case 'wallet': set({ walletView: arg }); break;
      case 'closeW': set({ walletView: null }); break;
      case 'copyW': copy(arg, 'Wallet address copied'); break;
      case 'trackW': var ti = S.trackWallets.indexOf(arg); if (ti === -1) S.trackWallets.push(arg); else S.trackWallets.splice(ti, 1); try { localStorage.setItem('gp.track', JSON.stringify(S.trackWallets)); } catch (er) {} render(); toast(ti === -1 ? 'Tracking ' + walletName(arg) : 'Stopped tracking'); break;
      case 'tpf': set({ tpFilter: arg, tpQueue: 0 }); break;
      case 'maker': set({ tpMaker: arg || null, tpTab: 'trades', tpQueue: 0, walletView: null }); break;
      case 'abs': set({ absTime: !S.absTime }); break;
      case 'resume': set({ tpQueue: 0 }); break;
      case 'tx': copy(arg, 'Transaction id copied (simulated)'); break;
      case 'cmode': set({ chartMode: arg }); break;
      case 'slip': set({ slipOpen: !S.slipOpen }); break;
      case 'setslip': set({ slip: +arg, slipOpen: false }); break;
      case 'share': copy(location.href.split('#')[0] + '#' + (S.tick || ''), 'Link copied'); break;
      case 'sellpct': var tp0 = find(S.tick), ps0 = tp0 && S.pos[tp0.tick]; if (ps0) set({ side: 'sell', amount: (ps0.tok * (+arg) / 100).toFixed(0) }); break;
      case 'sellall': var tp1 = find(S.tick), ps1 = tp1 && S.pos[tp1.tick]; if (ps1) set({ side: 'sell', amount: ps1.tok.toFixed(0) }); break;
      case 'coToggle': set({ coOpen: !S.coOpen, coQueue: 0 }); break;
      case 'coClose': set({ coOpen: false }); break;
      case 'coPause': S.coPaused = !S.coPaused; if (!S.coPaused) S.coQueue = 0; render(); break;
      case 'coFilter': S.coF = arg; render(); break;
      case 'coFollow': if (S.follow[arg]) delete S.follow[arg]; else S.follow[arg] = 1; try { localStorage.setItem('dl.follow', JSON.stringify(S.follow)); } catch (er) {} toast(S.follow[arg] ? 'Following ' + coName(arg) : 'Unfollowed ' + coName(arg)); render(); break;
      case 'coMenu': S.coMenu = S.coMenu === arg ? null : arg; render(); break;
      case 'coExpand': S.coExp[arg] = 1; render(); break;
      case 'coLike': var cx = coFind(arg); if (cx) { cx.c.liked = !cx.c.liked; cx.c.likes = (cx.c.likes || 0) + (cx.c.liked ? 1 : -1); render(); } break;
      case 'coRT': var cr = coFind(arg); if (cr) { cr.c.rtd = !cr.c.rtd; cr.c.rt = (cr.c.rt || 0) + (cr.c.rtd ? 1 : -1); toast(cr.c.rtd ? 'Reposted' : 'Repost removed'); render(); } break;
      case 'coShare': S.coMenu = null; copy(location.href.split('#')[0] + '#' + arg.split('|')[0], 'Link copied'); render(); break;
      case 'coCopy': var cc = coFind(arg); S.coMenu = null; if (cc) copy(cc.c.text, 'Text copied'); render(); break;
      case 'coMute': S.muted[arg] = 1; S.coMenu = null; toast('Muted ' + coName(arg)); render(); break;
      case 'coReport': S.coMenu = null; toast('Thanks — reported for review'); render(); break;
      case 'coReply': var cp = arg.split('|'); if (S.screen !== 'token' || S.tick !== cp[0]) openToken(cp[0]); S.coOpen = false; set({ replyTo: +cp[1] }); setTimeout(function () { var ci = document.getElementById('cmt-in'); if (ci) ci.focus(); else toast('Connect a wallet to reply'); }, 60); break;
      case 'like': var cl = (S.comments[S.tick] || [])[+arg]; if (cl) { cl.liked = !cl.liked; cl.likes += cl.liked ? 1 : -1; render(); } break;
      case 'replyTo': set({ replyTo: +arg }); setTimeout(function () { var ci = document.getElementById('cmt-in'); if (ci) ci.focus(); }, 20); break;
      case 'post':
        var txt = (S.cmtDraft || '').trim(); if (!txt) { toast('Write something first'); break; }
        var cms = seedComments(find(S.tick)); cms.push({ id: cms.length, w: S.account, text: txt, t: Date.now(), likes: 0, liked: false, reply: S.replyTo != null ? S.replyTo : null });
        set({ cmtDraft: '', replyTo: null }); toast('Callout posted'); break;
      case 'pairOpen': set({ cat: pairInfo(arg).cat, pair: arg }); setTimeout(function () { var g = document.getElementById('grid') || document.getElementById('bubbles'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); break;
      case 'hero': heroGo(S.heroIdx + (+arg)); break;
      case 'heroGo': heroGo(+arg); break;
      case 'view': set({ view: arg }); break;
      case 'swipe': flyOut(arg); break;
      case 'mstep': for (var mi = 0; mi < MSTEPS.length; mi++) { if (MSTEPS[mi][0] === arg) { M.paused = 5000; mSetStep(mi); break; } } break;
      case 'mlaunch': newLaunch(); break;
      case 'trade':
        if (!S.account) { set({ walletOpen: true }); break; }
        var t = find(arg), amt = parseFloat(String(S.amount).replace(',', '.')) || 0;
        if (!t) break;
        if (amt <= 0) { toast('Enter an amount first'); break; }
        if (typeof S.balance === 'number' && S.side === 'buy' && amt > S.balance) { toast('Not enough devnet SOL — balance ' + S.balance.toFixed(3)); break; }
        var qq = quoteFor(t), ps = S.pos[t.tick] = S.pos[t.tick] || { tok: 0, cost: 0 };
        if (S.side === 'sell' && amt > ps.tok + 1e-6) { toast(ps.tok > 0 ? 'You only hold ' + fmtNum(ps.tok) + ' $' + t.tick : 'You don\'t hold any $' + t.tick + ' yet — buy first'); break; }
        var solAmt = S.side === 'buy' ? amt : qq.sol;
        var trd = applyTrade(t, S.side, +solAmt.toFixed(4), S.account, true);
        if (S.side === 'buy') { ps.tok += qq.out; ps.cost += amt; trd.tokens = qq.out; }
        else { var frac = Math.min(1, amt / ps.tok); ps.cost -= ps.cost * frac; ps.tok -= amt; trd.tokens = amt; }
        S.amount = ''; render();
        if (S.side === 'buy') confettiSmall();
        toast((S.side === 'buy' ? 'Bought ' + fmtNum(qq.out) + ' $' + t.tick + ' for ' + amt + ' SOL' : 'Sold ' + fmtNum(amt) + ' $' + t.tick + ' for ' + qq.out.toFixed(4) + ' SOL') + ' · tax ' + trd.tax.toFixed(4) + ' (simulated)', t); break;
      case 'launch':
        if (!S.account) { set({ walletOpen: true }); toast('Connect a wallet to launch'); break; }
        var c = S.c;
        if (!c.name.trim() || c.tick.length < 2) { toast('Add a name and a ticker (2+ characters)'); break; }
        if (!c.img) { toast('Upload a logo image for your coin'); break; }
        var dq2 = devQuote(String(c.devBuy || '').replace(',', '.'));
        if (dq2.sol > 0 && typeof S.balance === 'number' && dq2.sol > S.balance) { toast('Not enough devnet SOL for a ' + dq2.sol + ' SOL buy — balance ' + S.balance.toFixed(3)); break; }
        if (find(c.tick)) { toast('$' + c.tick + ' is already taken'); break; }
        var vc = false, vs = 'treid', vf = 0;
        if (vf && typeof S.balance === 'number' && dq2.sol + vf > S.balance) { toast('Not enough devnet SOL — need ' + (dq2.sol + vf).toFixed(2) + ' SOL incl. ' + vf + ' SOL address fee'); break; }
        var nt = { name: c.name.trim(), tick: c.tick, spec: c.spec, img: c.img, banner: c.banner || null, snipe: c.snipe && c.snipe.on ? { on: true, start: c.snipe.start, dur: c.snipe.dur } : null, buy: c.buy, sell: c.sell, split: c.buy > 0 && c.split ? { p: c.split.p, h: c.split.h, b: c.split.b, d: c.split.d } : null, pair: c.pair, mcN: 5, mc0: 5, prog: 1, born: Date.now(), holders: 1,
          soc: !!(c.x || c.tg || c.web), links: { web: linkOf(c.web), x: c.x ? linkOf(/[\/.]/.test(c.x) ? c.x : 'x.com/' + c.x.replace(/^@/, '')) : null, tg: c.tg ? linkOf(/[\/.]/.test(c.tg) ? c.tg : 't.me/' + c.tg.replace(/^@/, '')) : null, demo: false }, rewards: false, burn: false, ca: fakeCA(vs), vanity: vc ? vs : null, vol: 0, hist: [5, 5], desc: c.desc.trim(), creator: S.account };
        if (vf && typeof S.balance === 'number') S.balance = Math.max(0, S.balance - vf);
        nt.devPct = +dq2.pct.toFixed(2);
        S.created.unshift(nt);
        if (dq2.sol > 0) { var dtr = applyTrade(nt, 'buy', dq2.sol, S.account, true); dtr.tokens = dq2.tok; dtr.tax = 0; S.pos[nt.tick] = { tok: dq2.tok, cost: dq2.sol }; }
        saveCreated();
        S.c = { name: '', tick: '', desc: '', x: '', tg: '', web: '', pair: 'SOL', buy: 0, sell: 0, img: null, banner: null, devBuy: '', spec: { kind: pick(A.KINDS), skin: pick(A.SKINS), bg: pick(A.BGS), eyes: 'normal', mouth: 'smile', acc: 'none' } };
        openToken(nt.tick); confetti(); toast('$' + nt.tick + ' is live on treid', nt); break;
    }
  });

  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.tc-ca'); if (!b) return; b.classList.add('ok'); var h = b.innerHTML; b.innerHTML = 'Copied ✓'; setTimeout(function () { if (b.isConnected) { b.innerHTML = h; b.classList.remove('ok'); } }, 1200); }, true);
  document.addEventListener('scroll', function (e) { if (e.target && e.target.id === 'cmts' && e.target.scrollTop < 20) { var np = document.getElementById('tt-new'); if (np && np._n) { np._n = 0; np.style.display = 'none'; } } }, true);
  document.addEventListener('input', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-van')) {
      var raw = e.target.value, clean = raw.split('').filter(function (ch) { return B58C.indexOf(ch) >= 0; }).join('').slice(0, 6), bad = raw.replace(/./g, function (ch) { return B58C.indexOf(ch) >= 0 ? '' : ch; });
      if (clean !== raw) e.target.value = clean; S.c.van.suf = clean; var n = clean.length;
      var er = document.getElementById('van-err'); if (er) er.textContent = bad ? 'Addresses can’t use 0, O, I, l or symbols' : '';
      var pv = document.getElementById('van-prev'); if (pv) pv.innerHTML = vanPrev(S.c);
      var fe = document.getElementById('van-fee'); if (fe) fe.textContent = n >= 3 ? '+' + vanFee(n) + ' SOL · ' + vanEta(n) : 'type at least 3 characters';
      document.querySelectorAll('.van-tiers span').forEach(function (sp, i) { sp.classList.toggle('on', !!n && (i === 0 ? n >= 3 && n <= 4 : i === 1 ? n === 5 : n === 6)); });
      var vt = document.querySelector('.van-o.on .van-t b'); if (vt) vt.textContent = clean || 'GOAT';
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
      tip.innerHTML = '<span class="muted">' + tLabel(p.t) + '</span> O <b>' + yLabel(p.o) + '</b> H <b class="up">' + yLabel(p.h) + '</b> L <b class="down">' + yLabel(p.l) + '</b> C <b>' + yLabel(p.v) + '</b> <b class="' + (ch >= 0 ? 'up' : 'down') + '">' + (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%</b> <span class="muted">Vol</span> <b>' + p.vol.toFixed(2) + ' SOL</b>';
      tip.style.left = Math.min(rb.width - tip.offsetWidth - 4, Math.max(4, px + 12)) + 'px';
    }
  });
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
  document.addEventListener('touchstart', function (e) { var box = e.target.closest && e.target.closest('#chart'); if (!box || e.touches.length !== 2) return; PINCH = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: S.czoom }; }, { passive: true });
  document.addEventListener('touchmove', function (e) { if (!PINCH || e.touches.length !== 2) return; e.preventDefault(); var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); S.czoom = Math.max(12, Math.min(240, Math.round(PINCH.z * PINCH.d / Math.max(20, d)))); chartRedraw(); }, { passive: false });
  document.addEventListener('touchend', function () { PINCH = null; });
  document.addEventListener('keydown', function (e) { if (S.screen !== 'token' || /INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return; if (e.key === '+' || e.key === '=') { S.czoom = Math.max(12, Math.round(S.czoom * .8)); chartRedraw(); } else if (e.key === '-') { S.czoom = Math.min(240, Math.round(S.czoom * 1.25)); chartRedraw(); } });
  document.addEventListener('wheel', function (e) {
    var box = e.target.closest && e.target.closest('#chart'); if (!box) return;
    e.preventDefault();
    var sv = box.querySelector('svg'), rr = (sv || box).getBoundingClientRect(), vb = sv && sv.viewBox.baseVal, W0 = vb && vb.width ? vb.width : rr.width;
    var f = Math.max(0, Math.min(1, (e.clientX - rr.left) / rr.width * W0 / Math.max(1, W0 - 70)));
    var n0 = S.czoom, n1 = Math.max(12, Math.min(240, Math.round(n0 * (e.deltaY > 0 ? 1.12 : .89)))); if (n1 === n0) n1 = Math.max(12, Math.min(240, n0 + (e.deltaY > 0 ? 1 : -1)));
    var anchor = S.cpan + (n0 - 1) - f * n0; // buckets back from now under the cursor
    S.czoom = n1; S.cpan = Math.max(-Math.floor(n1 * .8), Math.round(anchor - (n1 - 1) + f * n1)); chartRedraw(); var zl = document.querySelector('.czoom .mono'); if (zl) zl.textContent = S.czoom;
  }, { passive: false });
  document.addEventListener('pointerdown', function (e) {
    var box = e.target.closest && e.target.closest('#chart'); if (!box || e.button > 0 || e.target.closest('button')) return;
    var br = box.getBoundingClientRect(); CDRAG = { x: e.clientX, y: e.clientY, pan: S.cpan, w: br.width, h: br.height, ys: S.cys, yo: S.cyo, axis: !!e.target.closest('.yhit') }; box.classList.add(CDRAG.axis ? 'yscaling' : 'panning');
  });
  document.addEventListener('pointermove', function (e) {
    if (!CDRAG) return; var dx = e.clientX - CDRAG.x, dy = e.clientY - CDRAG.y;
    if (CDRAG.axis) { S.cys = Math.max(.08, Math.min(40, CDRAG.ys * Math.exp(dy / 160))); if (!CDRAG.raf) CDRAG.raf = requestAnimationFrame(function () { if (CDRAG) CDRAG.raf = 0; chartRedraw(); }); return; }
    var np = Math.max(-Math.floor(S.czoom * .8), Math.round(CDRAG.pan + dx / CDRAG.w * S.czoom)), ny = (S.cys !== 1 || CDRAG.yo) ? CDRAG.yo + dy / (CDRAG.h * .78) * S.cys : 0;
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
    ['Sniper trap', 'Bots that rush in at launch pay a huge tax. When it drains, everyone pays the normal tax.'],
    ['Trade the curve', 'Every buy pushes the price up the bonding curve. Every trade pays the tax shown on the coin.'],
    ['Risk flags', 'We never hide or delete coins. We show dev, top 10, snipers and bundles — you decide.'],
    ['Graduate', 'At ~$69K the curve fills, liquidity moves to Raydium and milestone badges start.'],
    ['Tax flywheel', 'Every trade’s tax splits three ways: creator, holders and burn. More trading, more rewards.']
  ];
  var FW = { raf: 0, el: null, coins: [], last: 0, lt: 0, paused: false, hi: -1, jars: [0, 0, 0], spawn: 0, cnt: [1240, 386, 0, [52, 171], 214, 0] };
  var FST = [['Launch', 'Make a coin, pick a tax', '#F5D9A8'], ['Sniper trap', 'Early bots pay huge tax', '#FF5E6C'], ['Bonding curve', 'Every buy lifts the price', '#3DDC97'], ['Risk scan', 'We flag risks, never hide', '#FFB15C'], ['Graduate', 'At $69K it moves to Raydium', '#F5D9A8'], ['Tax split', 'Creator picks the split, locked', '#7FB6FF']];
  function fxMini(k) {
    var t = all()[3] || all()[0];
    if (k === 0) return '<div class="fm fm0"><span class="fm-blank">?</span><span class="fm-arr">→</span><span class="fm-coin">' + avatarHTML(t, 26) + '<i class="mono">2%</i></span></div>';
    if (k === 1) return '<div class="fm fm1"><b class="mono" data-snv>80%</b><span class="fm-bar"><i data-snb></i></span><small data-snl>bots pay</small></div>';
    if (k === 2) return '<div class="fm fm2"><svg viewBox="0 0 120 34"><path class="fm-ln" d="M2 32 C40 30 60 24 80 14 S110 3 118 2" fill="none" stroke="#3DDC97" stroke-width="2.5" stroke-linecap="round"/></svg><span class="fm-up mono">▲ price</span></div>';
    if (k === 3) return '<div class="fm fm3"><span class="g">Dev ✓</span><span class="r">Top10 ⚠</span><span class="g">Bundle ✓</span></div>';
    if (k === 4) return '<div class="fm fm4"><span class="fm-bar"><i></i></span><span class="fm-cap">🎓</span><small class="mono">$69K</small></div>';
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
  function machineSection() {
    FW.cnt[2] = FW.cnt[2] || 1840.5; FW.cnt[5] = FW.cnt[5] || 58210;
    var st = FST.map(function (x, k) { return '<div class="fx-st fx-s' + k + '" data-fst="' + k + '" style="--sc:' + x[2] + ';left:calc(2% + ' + (FSX[k] * .96).toFixed(2) + '%)"><div class="fx-house"><div class="fx-hd"><span class="fx-ico">' + FICO[k] + '</span><span class="fx-n mono">0' + (k + 1) + '</span></div><b class="fx-t">' + x[0] + '</b><small class="fx-sub">' + x[1] + '</small>' +
      fxMini(k) +
      (k === 0 ? '<span class="fx-press"></span>' : k === 3 ? '<span class="fx-laser"></span>' : k === 4 ? '<span class="fx-portal"></span>' : '') + '</div><span class="fx-leg"></span></div>'; }).join('');
    var cap = STS.map(function (x, k) { return '<button class="fx-cap" data-act="fwGo" data-arg="' + k + '" data-fcap="' + k + '"><span class="mono">0' + (k + 1) + '</span><b>' + x[0] + '</b><small>' + x[1] + '</small>' +
      (k === 5 ? '<span class="fx-jars">' + [['Creator', '#F5D9A8'], ['Holders', '#7FB6FF'], ['Burn', '#FF8A5B']].map(function (j, q) { return '<span class="fx-jar" style="--c:' + j[1] + '"><i data-jar="' + q + '"></i><em>' + j[0] + '</em></span>'; }).join('') + '</span>' : '') + '</button>'; }).join('');
    return '<section class="story card-s fx" id="machine"><div class="st2-head"><div><span class="kicker">HOW IT WORKS</span><h2 class="title-xl lab-title">The treid factory</h2></div><span class="muted st2-hint">watch a coin go from launch to tax payouts</span></div>' +
      '<div class="fx-scroll"><div class="fx-floor" id="fw-wheel"><div class="fx-belt"><span class="fx-tread"></span><span class="fx-roll l"></span><span class="fx-roll r"></span></div><div class="fx-coins" id="fx-coins"></div>' + st + '</div>' +
      '</div></section>';
  }
  function fxSpawn() {
    var box = document.getElementById('fx-coins'); if (!box) return;
    var t = pick(all()), r = Math.random(), tm = Math.max(t.buy, t.sell) || 2, el = document.createElement('div');
    el.className = 'fxc'; el.innerHTML = '<span class="fxc-ring"></span><span class="fxc-blank">?</span><span class="fxc-face">' + avatarHTML(t, 44) + '</span><span class="fxc-tax mono" style="background:' + taxBg(tm) + '">' + tm + '%</span><span class="fxc-cap">🎓</span><span class="fxc-flag"></span><span class="fxc-mc mono"></span>';
    box.appendChild(el); FW.coins.push({ el: el, x: -4, t: t, risky: r < .33, st: -1, mc: 5 });
  }
  function fxPop(c, txt, cls) { var box = document.getElementById('fx-coins'); if (!box) return; var e = document.createElement('span'); e.className = 'fxp ' + (cls || ''); e.textContent = txt; e.style.left = c.x + '%'; box.appendChild(e); setTimeout(function () { e.remove(); }, 1300); }
  function fxHit(k) { var e = document.querySelector('[data-fst="' + k + '"]'); if (!e) return; e.classList.remove('hit'); void e.offsetWidth; e.classList.add('hit'); var cp = document.querySelector('[data-fcap="' + k + '"]'); if (cp) { cp.classList.remove('hit'); void cp.offsetWidth; cp.classList.add('hit'); } }
  function fxStage(c, k) {
    c.st = k; var el = c.el; el.classList.add('s' + k); fxHit(k);
    var C = FW.cnt; if (k === 0) C[0]++; if (k === 1) C[1] += 1 + Math.floor(Math.random() * 3); if (k === 2) C[2] += 2 + Math.random() * 9; if (k === 3) C[3][c.risky ? 0 : 1]++; if (k === 4) C[4]++; if (k === 5) C[5] += 40 + Math.random() * 400; if (k !== 1) fxRead(k);
    if (k === 0) fxPop(c, 'minted', 'g');
    if (k === 1) { fxPop(c, '🤖 sniper −80%', 'r'); setTimeout(function () { if (el.isConnected) fxPop(c, '🙂 you −' + (Math.max(c.t.buy, c.t.sell) || 2) + '%', 'g'); }, 380); }
    if (k === 3) { var f = el.querySelector('.fxc-flag'); f.textContent = c.risky ? '⚠' : '✓'; f.className = 'fxc-flag ' + (c.risky ? 'r' : 'g'); fxPop(c, c.risky ? 'flagged · still tradable' : 'clean', c.risky ? 'r' : 'g'); }
    if (k === 4) fxPop(c, '→ Raydium', 'y');
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
    if (!FW.paused) {
      FW.spawn -= dt; if (FW.spawn <= 0) { fxSpawn(); FW.spawn = 2900 + Math.random() * 900; }
      FW.coins.forEach(function (c) {
        c.x += dt * 0.0072;
        while (c.st < 5 && c.x >= FSX[c.st + 1]) fxStage(c, c.st + 1);
        var mcEl = c.el.querySelector('.fxc-mc');
        if (c.st >= 2) { var p = c.st >= 4 ? 1 : Math.min(1, (c.x - FSX[2]) / (FSX[4] - FSX[2])); var mc = c.st >= 4 ? 69 + (c.x - FSX[4]) * 9 : 5 + p * 64; mcEl.textContent = '$' + mc.toFixed(0) + 'K'; c.el.style.setProperty('--p', (p * 100).toFixed(0)); }
        var lift = c.st >= 2 && c.st < 4 ? Math.sin(Math.min(1, (c.x - FSX[2]) / (FSX[4] - FSX[2])) * Math.PI) * 14 : 0;
        c.el.style.left = c.x + '%'; c.el.style.transform = 'translate(-50%,' + (-lift).toFixed(1) + 'px)';
        if (c.x > 103) { c.el.remove(); c.gone = true; }
      });
      FW.coins = FW.coins.filter(function (c) { return !c.gone; });
    }
    FW.raf = requestAnimationFrame(fwLoop);
  }
  function mbuyWatch() { var tb = document.querySelector('.tradebox'), mb = document.querySelector('.m-buy'); if (!tb || !mb || !window.IntersectionObserver) return; if (mbuyWatch.o) mbuyWatch.o.disconnect(); mbuyWatch.o = new IntersectionObserver(function (en) { mb.classList.toggle('hide', en[0].isIntersecting); }, { threshold: .15 }); mbuyWatch.o.observe(tb); }
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
  setTimeout(function () { S.loading = false; render(); }, 850);
})();
