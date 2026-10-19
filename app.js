/* CHADPAD — no build step, no dependencies.
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
  function fakeCA() { return b58(40) + 'dmnd'; }
  function short(a) { return a ? a.slice(0, 4) + '…' + a.slice(-4) : ''; }
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
  var LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lgS" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".5" stop-color="#D3D5DA"/><stop offset="1" stop-color="#9A9DA4"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="17" fill="url(#lgS)"/><path d="M46 21.5 A16 16 0 1 0 46 42.5" fill="none" stroke="#0A0A0B" stroke-width="9.5" stroke-linecap="round"/><path d="M40 13 L52 13 L52 25 Z" fill="#0A0A0B"/><circle cx="32" cy="32" r="3.6" fill="#0A0A0B"/></svg>';

  // ================= DATA =================
  function mk(name, tick, kind, skinI, bgI, eyes, mouth, acc, buy, sell, pair, mcN, c24, prog, ageM, holders, soc, rewards, burn) {
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
  ];
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
    if (p.meme) return avatarHTML(p.meme, size);
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
    screen: 'home', tick: null, side: 'buy', amount: '', tf: '1H', tpTab: 'trades',
    maxTax: 10, minProg: 0, minMc: 0, pair: 'All', cat: 'all', view: 'grid', deckIdx: 0, pctAmt: 0, sort: 'bump', zeroOnly: false, gradOnly: false, rewardsOnly: false, watchOnly: false,
    watch: [], created: [], launched: [], trades: [], tradeCount: 0, loading: true, newTick: null,
    palOpen: false, palQ: '', palIdx: 0,
    walletOpen: false, walletMenu: false, wallets: [], wallet: null, account: null, connecting: null, balance: null, airdropping: false,
    c: { name: '', tick: '', desc: '', x: '', tg: '', web: '', pair: 'SOL', buy: 0, sell: 0, img: null, spec: { kind: 'frog', skin: A.SKINS[0], bg: A.BGS[0], eyes: 'normal', mouth: 'smile', acc: 'crown' } }
  };
  try { S.watch = JSON.parse(localStorage.getItem(LS.watch) || '[]'); } catch (e) {}
  try {
    var saved = JSON.parse(localStorage.getItem(LS.created) || '[]');
    saved.forEach(function (t) { if (t && t.tick && t.spec) { t.hist = [t.mcN, t.mcN]; S.created.push(t); } });
  } catch (e) {}

  function all() { return S.created.concat(S.launched, BASE); }
  function find(tick) { var a = all(); for (var i = 0; i < a.length; i++) if (a[i].tick === tick) return a[i]; return null; }
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
      '<button class="brand" data-act="home" aria-label="CHADPAD home">' + LOGO + '<span class="brand-name">CHAD<span>PAD</span></span><span class="beta">BETA</span></button>' +
      '<nav class="navlinks"><button class="' + (S.screen === 'home' ? 'on' : '') + '" data-act="home">Board</button><button class="' + (S.screen === 'create' ? 'on' : '') + '" data-act="create">Create</button><button class="' + (S.screen === 'leaders' ? 'on' : '') + '" data-act="leaders">Leaderboard</button><button data-act="how">How it works</button></nav>' +
      '<button class="searchbtn" data-act="palette">' + I.search + '<span>Search tokens or paste CA</span><span class="kbd">Ctrl K</span></button>' +
      '<div class="hdr-right"><button class="btn pri" data-act="create">+ Launch token</button>' + right + '</div>' +
      '</div></header>';
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
  function riskMetrics(t) {
    var h = hash(t.tick + 'r'), devSold = (h >> 4) % 7 === 0 && t.prog < 100;
    function lv(v, a, b) { return v < a ? 'g' : v < b ? 'y' : 'r'; }
    var dev = devSold ? 0 : ((h % 80) / 10), top = 16 + (h >> 2) % 52, sn = (h >> 5) % 19, bu = (h >> 8) % 16;
    if (t.creator && S.account && t.creator === S.account) { dev = 2.1; top = 22; sn = 0; bu = 0; devSold = false; }
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
    return '<article class="tcard' + (S.newTick === t.tick ? ' is-new' : '') + ' ' + fr.cls + '" data-card="' + esc(t.tick) + '">' +
      '<div class="tc-age ' + fr.cls + '"><span class="ag-dot"></span><span class="ag-lab">' + fr.lab + '</span><b class="mono" data-t="' + t.born + '">' + ago(t.born) + '</b>' + (done ? '<span class="ag-grad">GRADUATED</span>' : '') + '</div>' +
      '<div class="tc-top"><button class="tc-id" data-act="open" data-arg="' + esc(t.tick) + '">' + avatarHTML(t, 52) +
        '<span class="tc-name"><b>' + esc(t.name) + '</b><span>$' + esc(t.tick) + '</span></span></button>' +
        '<div class="pairmini" data-tip="Paired with ' + esc(pairInfo(t.pair).name) + '">' + coinHTML(t.pair, 26) + '<small>PAIR</small><b>' + esc(pairLabel(t.pair)) + '</b></div>' +
        '<div class="tax" style="background:' + taxBg(tmax) + '" data-tip="Buy ' + t.buy + '% · Sell ' + t.sell + '%"><small>TAX</small><b>' + tmax + '%</b></div></div>' +
      riskTiles(t) + socialsHTML(t) +
      '<div class="tc-mid"><div class="tc-mc"><div class="v"><span data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</span>' +
        '<span class="chgpill ' + (c >= 0 ? 'up' : 'down') + '" data-chg="' + esc(t.tick) + '">' + chgTxt(c) + '</span></div><div class="l">market cap · ' + fmtNum(t.holders) + ' holders · vol ' + fmtK(t.vol) + '</div></div></div>' +
      '<div class="tc-chart ' + (c >= 0 ? 'up' : 'down') + '" data-cchart="' + esc(t.tick) + '">' + cardChart(t) + '</div>' +
      '<div class="prog"><div class="l"><span>' + (done ? 'On Raydium' : 'Bonding curve') + '</span><span class="mono" data-prog="' + esc(t.tick) + '">' + Math.min(100, t.prog).toFixed(0) + '%</span></div>' +
        '<div class="bar"><i class="' + (done ? 'done' : '') + '" data-bar="' + esc(t.tick) + '" style="width:' + Math.max(1, Math.min(100, t.prog)) + '%"></i></div></div>' +
      (opts.preview ? '' : '<div class="tc-act"><button class="btn pri" data-act="open" data-arg="' + esc(t.tick) + '">Trade</button>' +
        '<button class="iconbtn" data-act="star" data-arg="' + esc(t.tick) + '" aria-label="Add to watchlist" aria-pressed="' + on + '">' + I.star(on) + '</button></div>') +
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
        '<span class="kicker"><span class="livedot"></span><span class="rank">#' + (rank + 1) + '</span> TOP CHAD</span>' +
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
  S.raceTab = 'curve'; S.raceAll = false;
  function raceList() {
    var a = all();
    if (S.raceTab === 'curve') return a.filter(function (t) { return t.prog < 100; }).sort(function (x, y) { return y.prog - x.prog; });
    return a.filter(function (t) { return t.prog >= 100; }).sort(function (x, y) { return y.mcN - x.mcN; });
  }
  function laneF(t) { return S.raceTab === 'curve' ? Math.max(0, Math.min(1, t.prog / 100)) : gameF(t); }
  function laneVal(t) { return S.raceTab === 'curve' ? Math.min(100, t.prog).toFixed(0) + '%' : fmtK(t.mcN); }
  function laneHTML(t, i) {
    var f = laneF(t), fresh = (Date.now() - t.born) < 300000, lead = i === 0;
    return '<div class="lane' + (lead ? ' lead' : '') + '" data-lane="' + esc(t.tick) + '">' +
      '<span class="ln-rank mono">' + (i + 1) + '</span>' +
      '<button class="ln-id" data-act="open" data-arg="' + esc(t.tick) + '"><b>$' + esc(t.tick) + '</b>' + (fresh ? '<span class="ln-new">NEW</span>' : '') + '<small>' + coinHTML(t.pair, 14) + esc(pairLabel(t.pair)) + '</small></button>' +
      '<div class="ln-track"><span class="ln-trail" style="width:' + (f * 100).toFixed(2) + '%"></span>' +
        '<button class="ln-runner" data-act="open" data-arg="' + esc(t.tick) + '" style="left:' + (f * 100).toFixed(2) + '%">' + avatarHTML(t, 34) + (lead ? '<span class="ln-crown">♛</span>' : '') + '</button>' +
        '<span class="ln-val mono" style="left:' + (f * 100).toFixed(2) + '%">' + laneVal(t) + '</span></div>' +
      '<span class="ln-chg mono ' + (chg(t) >= 0 ? 'up' : 'down') + '">' + chgTxt(chg(t)) + '</span></div>';
  }
  function raceRowsHTML() {
    var l = raceList(), show = S.raceAll ? l : l.slice(0, 10);
    return show.map(laneHTML).join('');
  }
  function raceSection() {
    var a = all(), cur = a.filter(function (t) { return t.prog < 100; }), grad = a.filter(function (t) { return t.prog >= 100; }), list = raceList();
    var isC = S.raceTab === 'curve';
    var ticks = isC ? [['25%', 25], ['50%', 50], ['75%', 75]] : [['$1M', mcU(1e6)], ['$10M', mcU(1e7)], ['$50M', mcU(5e7)]].map(function (m) { return [m[0], (m[1] - SPLIT) / (1 - SPLIT) * 100]; });
    return '<section class="race card-s" id="race"><div class="m-head"><div><span class="kicker"><span class="livedot"></span>LIVE RACE</span><h2 class="title-xl" style="font-size:30px;margin:8px 0 4px">' + (isC ? 'Race to Raydium' : 'Race to the Moon') + '</h2>' +
      '<p class="muted" style="margin:0;max-width:600px">' + (isC ? 'Every coin on the bonding curve gets a lane. Buys push it forward, sells pull it back. First to the finish line graduates to Raydium.' : 'Graduated coins race on market cap. Next stops: $1M, $10M, $50M — the finish line is the moon at $100M.') + '</p></div>' +
      '<div class="race-tabs"><button class="' + (isC ? 'on' : '') + '" data-act="rtab" data-arg="curve"><span>Race to Raydium</span><b class="mono">' + cur.length + '</b></button><button class="' + (!isC ? 'on' : '') + '" data-act="rtab" data-arg="moon"><span>Race to the Moon</span><b class="mono">' + grad.length + '</b></button></div></div>' +
      '<div class="lanes-wrap"><div class="lanes-head"><span></span><span>COIN</span><div class="lh-track">' + '<span class="lh-tick" style="left:0">' + (isC ? 'START' : '$500K') + '</span>' + ticks.map(function (k) { return '<span class="lh-tick" style="left:' + k[1].toFixed(1) + '%">' + k[0] + '</span>'; }).join('') + '<span class="lh-tick fin" style="left:100%">' + (isC ? 'RAYDIUM' : 'MOON $100M') + '</span></div><span class="r">24H</span></div>' +
        '<div class="lanes" id="lanes" style="--ticks:' + ticks.map(function (k) { return k[1].toFixed(1); }).join(',') + '">' +
          '<div class="lane-grid">' + ticks.map(function (k) { return '<i style="left:' + k[1].toFixed(1) + '%"></i>'; }).join('') + '<span class="finish"></span></div>' + raceRowsHTML() + '</div>' +
        (list.length > 10 ? '<button class="lanes-more" data-act="rall">' + (S.raceAll ? 'Show top 10' : 'Show all ' + list.length + ' coins') + '</button>' : '') + '</div></section>';
  }
  var raceT2 = 0;
  function raceRefresh() {
    var box = document.getElementById('lanes'); if (!box) return;
    var l = raceList(), show = S.raceAll ? l : l.slice(0, 10), first = {};
    box.querySelectorAll('.lane').forEach(function (el) { first[el.getAttribute('data-lane')] = el.getBoundingClientRect().top; });
    var keep = {};
    show.forEach(function (t, i) {
      var el = box.querySelector('.lane[data-lane="' + t.tick + '"]'), f = laneF(t);
      if (!el) { box.insertAdjacentHTML('beforeend', laneHTML(t, i)); el = box.lastElementChild; el.classList.add('enter'); }
      el.classList.toggle('lead', i === 0);
      el.querySelector('.ln-rank').textContent = i + 1;
      el.querySelector('.ln-trail').style.width = (f * 100).toFixed(2) + '%';
      el.querySelector('.ln-runner').style.left = (f * 100).toFixed(2) + '%';
      var v = el.querySelector('.ln-val'); v.style.left = (f * 100).toFixed(2) + '%'; v.textContent = laneVal(t);
      var c = el.querySelector('.ln-chg'); c.textContent = chgTxt(chg(t)); c.className = 'ln-chg mono ' + (chg(t) >= 0 ? 'up' : 'down');
      var cr = el.querySelector('.ln-crown'); if (i === 0 && !cr) el.querySelector('.ln-runner').insertAdjacentHTML('beforeend', '<span class="ln-crown">♛</span>'); if (i !== 0 && cr) cr.remove();
      box.appendChild(el); keep[t.tick] = 1;
    });
    box.querySelectorAll('.lane').forEach(function (el) { if (!keep[el.getAttribute('data-lane')]) el.remove(); });
    box.querySelectorAll('.lane').forEach(function (el) {
      var k = el.getAttribute('data-lane'); if (first[k] == null) return;
      var dy = first[k] - el.getBoundingClientRect().top; if (!dy) return;
      el.style.transition = 'none'; el.style.transform = 'translateY(' + dy + 'px)';
      requestAnimationFrame(function () { el.style.transition = 'transform .6s cubic-bezier(.2,.8,.2,1)'; el.style.transform = ''; });
    });
  }
  function raceBubble(t) {
    var p = trackPt(coinU(t)), sz = raceSize(t), done = t.prog >= 100, lab = done ? fmtK(t.mcN) : Math.min(100, t.prog).toFixed(0) + '%';
    return '<button class="rb ' + (done ? 'done' : '') + '" data-race="' + esc(t.tick) + '" data-act="open" data-arg="' + esc(t.tick) + '" style="left:' + p.x.toFixed(2) + '%;top:' + p.y.toFixed(2) + '%;--sz:' + sz + 'px" data-tip="$' + esc(t.tick) + ' · ' + (done ? 'graduated · ' : Math.min(100, t.prog).toFixed(0) + '% of curve · ') + fmtK(t.mcN) + '">' +
      avatarHTML(t, Math.round(sz)) + '<span class="rb-pct mono">' + lab + '</span></button>';
  }
  function raceUpdate(t, side) {
    var el = document.querySelector('.lane[data-lane="' + t.tick + '"] .ln-runner');
    if (el) { el.classList.remove('up-hit', 'down-hit'); void el.offsetWidth; el.classList.add(side === 'buy' ? 'up-hit' : 'down-hit'); }
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
          '<svg class="ring2" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="#1F1F23" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="url(#rg)" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (C * gradPct / 100).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 32 32)" class="ringarc"/><defs><linearGradient id="rg"><stop offset="0" stop-color="#E8E8EA"/><stop offset="1" stop-color="#A3B1C2"/></linearGradient></defs><g transform="translate(23 23) scale(.75)" fill="#E8E8EA"><path d="M6 3h12l4 6-10 12L2 9z"/></g></svg></div>' +
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
    return '<div class="pair-head"><span class="kicker">PAIRED WITH</span><span class="muted" style="font-size:13px">Coins on CHADPAD trade against anything — drag to explore</span></div>' +
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
  function bubblesHTML(list) {
    return '<section class="grid" style="display:block"><div class="bubbles" id="bubbles">' + list.slice(0, 40).map(function (t) {
      var r = bubR(t), c = chg(t), b = BUB[t.tick];
      var x = b ? b.x : rnd(r, 800), y = b ? b.y : rnd(r, 560);
      return '<button class="bubble ' + (c >= 0 ? 'pos' : 'neg') + '" data-bub="' + esc(t.tick) + '" style="width:' + (2 * r) + 'px;height:' + (2 * r) + 'px;transform:translate(' + (x - r) + 'px,' + (y - r) + 'px)" aria-label="' + esc(t.name) + '">' +
        avatarHTML(t, Math.round(r * (r > 50 ? 0.9 : 1.1))) + (r > 44 ? '<span class="bt">$' + esc(t.tick) + '</span>' : '') + '<span class="bc ' + (c >= 0 ? 'up' : 'down') + '" data-chg3="' + esc(t.tick) + '">' + chgTxt(c) + '</span></button>';
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
  function inlineRange(k) {
    var c = RCFG[k], r = S.r[k], on = rLabel(k) !== 'Any';
    var ic = { mc: '$', age: '◷', prog: '▲', tax: '%' }[k];
    return '<div class="irange ir-' + k + (on ? ' on' : '') + '"><div class="ir-h"><span><i>' + ic + '</i>' + c.lab + '</span><b id="fcl-' + k + '">' + rLabel(k) + '</b></div>' +
      '<div class="dual sm' + (k === 'tax' ? ' taxg' : '') + '"><div class="dual-track"><i id="rpf-' + k + '" style="' + rFill(k) + '"></i></div>' +
      '<input type="range" min="0" max="' + c.max + '" step="' + c.step + '" value="' + r[0] + '" data-range="' + k + '|0" aria-label="' + c.title + ' minimum">' +
      '<input type="range" min="0" max="' + c.max + '" step="' + c.step + '" value="' + r[1] + '" data-range="' + k + '|1" aria-label="' + c.title + ' maximum"></div>' +
'</div>';
  }
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
    return '<div class="fbar2"><div class="fb2-row">' + pairChip + ['mc', 'age', 'prog', 'tax'].map(inlineRange).join('') + '</div>' +
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
    if (g && S.view !== 'bubbles') g.innerHTML = list.length ? list.map(function (t) { return card(t); }).join('') : '<div class="empty"><b style="font-size:19px">No coins in this range</b><span class="muted">Widen a slider or hit Reset.</span><button class="btn pri" data-act="reset">Reset filters</button></div>';
  }
  var SLOGANS = ['Launch it.', 'Pair it.', 'Send it.'];
  function introHTML() {
    var st = stats(), fresh = all().slice().sort(function (a, b) { return b.born - a.born; }).slice(0, 4);
    var floaters = ['SOL', 'BTC', 'GOLD', 'ETH', 'ONDO', 'EUR', BASE[0].tick, BASE[8].tick].map(function (id, k) {
      return '<span class="fl" style="--x:' + (52 + (k * 6.1) % 46) + '%;--y:' + (12 + (k * 37) % 70) + '%;--d:' + (5 + k % 4) + 's;--dl:-' + k + 's">' + coinHTML(id, 26 + (k % 3) * 8) + '</span>';
    }).join('');
    return '<section class="intro2" id="intro">' +
      '<div class="aurora"><span class="a1"></span><span class="a2"></span><span class="a3"></span></div><div class="floaters">' + floaters + '</div>' +
      '<div class="i2-l">' +
        '<h1 class="i2-h">' + SLOGANS.map(function (w, k) { return '<span style="--k:' + k + '">' + w + '</span>'; }).join(' ') + '</h1>' +
        '<p class="i2-p">The launchpad where any coin can pair with <b>anything</b> — SOL, gold, stocks, even another meme.</p>' +
        '<div class="intro-cta"><button class="btn pri big" data-act="create">Launch a token <span aria-hidden="true">→</span></button><button class="btn sec big" data-act="palette">' + I.search + 'Find a coin</button></div>' +
      '</div>' +
      '<div class="i2-r"><div class="i2-live"><div class="i2-lh"><span class="livedot"></span>JUST LAUNCHED<span class="muted mono" id="i2-cnt">' + st.tokens + ' live</span></div><div id="i2-fresh">' +
        fresh.map(i2Row).join('') + '</div>' +
        '<div class="i2-stats"><div><b data-count="' + Math.round(st.vol) + '" data-fmt="k">' + fmtK(st.vol) + '</b><span>24h volume</span></div><div><b id="i2-tr">' + fmtNum(st.trades) + '</b><span>trades</span></div><div><b data-count="' + st.grad + '">' + st.grad + '</b><span>graduated</span></div></div></div></div>' +
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
    var hero = heroHTML();

    var list = filtered();
    var toolbar = '<div class="toolbar"><h2 class="h2">Tokens</h2><span class="demo" data-tip="Market data is simulated until on-chain launch goes live. Wallet + SOL balance are real (devnet).">DEMO DATA</span><div class="seg">' + SORTS.map(function (s) {
      return '<button class="' + (S.sort === s[0] ? 'on' : '') + '" aria-pressed="' + (S.sort === s[0]) + '" data-act="sort" data-arg="' + s[0] + '">' + s[1] + '</button>';
    }).join('') + '</div><div class="seg" role="group" aria-label="View"><button class="' + (S.view === 'grid' ? 'on' : '') + '" data-act="view" data-arg="grid">Grid</button><button class="' + (S.view === 'bubbles' ? 'on' : '') + '" data-act="view" data-arg="bubbles">Bubbles</button></div><span class="mono muted" style="margin-left:auto;font-size:12.5px" id="count">' + list.length + ' of ' + all().length + ' tokens</span></div>' +
      '';

    var filters = filterBar();

    var grid = (!S.loading && S.view === 'bubbles') ? bubblesHTML(list) : '<section class="grid" id="grid">' + (S.loading ? [0, 1, 2, 3, 4, 5].map(skeletonCard).join('') : list.length ? list.map(function (t) { return card(t); }).join('') :
      '<div class="empty"><b style="font-size:19px">No tokens match these filters</b><span class="muted">Loosen the tax or market cap filters.</span><button class="btn pri" data-act="reset">Reset filters</button></div>') + '</section>';

    var how = '<section id="how" style="margin-top:56px"><h2 class="h2" style="margin-bottom:16px">How CHADPAD works</h2><div class="row">' +
      [['01', 'Pick a name & logo', 'Use the built-in mascot builder or upload your own image. Takes under a minute.'],
       ['02', 'Set your buy & sell tax', 'From 0% to 10%. The tax is shown on every card in colour, so traders always know the cost.'],
       ['03', 'Launch on a bonding curve', 'Price rises as people buy. When the curve fills, liquidity graduates to Raydium automatically.']].map(function (s) {
        return '<div class="card-s" style="flex:1 1 260px;padding:22px;display:flex;flex-direction:column;gap:8px"><span class="mono" style="color:var(--ice);font-size:13px">' + s[0] + '</span><b style="font-size:17px">' + s[1] + '</b><span class="muted" style="line-height:1.55">' + s[2] + '</span></div>';
      }).join('') + '</div></section>';

    var slogan = introHTML() + quickPairs();
    return '<main class="wrap">' + slogan + hero + '<div id="board"></div>' + toolbar + filters + '<div class="layout full">' + grid + '</div>' + raceSection() + machineSection() + '</main>';
  }

  // ================= PRO TOKEN PAGE (pump.fun / dexscreener style) =================
  function tfPoints(t) { var n = { '5M': 40, '1H': 80, '6H': 120, '24H': 160 }[S.tf]; return t.hist.slice(-n); }
  function candles(t) {
    var d = tfPoints(t), per = Math.max(1, Math.round(d.length / 40)), out = [], r = rng(hash(t.tick + S.tf + d.length));
    for (var i = 0; i < d.length; i += per) {
      var seg = d.slice(i, i + per), o = i ? d[i - 1] : seg[0] * (1 + (r() - 0.5) * 0.02), c = seg[seg.length - 1];
      var hi = Math.max.apply(null, seg.concat([o])), lo = Math.min.apply(null, seg.concat([o]));
      hi *= 1 + r() * 0.012; lo *= 1 - r() * 0.012;
      out.push({ o: o, h: hi, l: lo, c: c, v: 0.3 + r() * (Math.abs(c - o) / o * 60 + 0.6) });
    }
    return out;
  }
  function yLabel(v) { return S.chartMode === 'price' ? fmtPrice(v * 1000 / 1e9) : fmtK(v); }
  function chartSVG(t) {
    var cs = candles(t), W = 1000, H = 380, top = 16, vh = 70, ph = H - vh - top - 10;
    var mx = Math.max.apply(null, cs.map(function (c) { return c.h; })), mn = Math.min.apply(null, cs.map(function (c) { return c.l; }));
    var minSp = mx * 0.08; if (mx - mn < minSp) { var mid = (mx + mn) / 2; mx = mid + minSp / 2; mn = mid - minSp / 2; } var sp = mx - mn;
    var vmx = Math.max.apply(null, cs.map(function (c) { return c.v; }));
    var slots = Math.max(cs.length, 44), off0 = (slots - cs.length) * (W / slots), Y = function (v) { return top + (mx - v) / sp * ph; }, cw = W / slots, bw = Math.max(3, cw * 0.62);
    var g = '', pts = [];
    for (var k = 1; k < 5; k++) g += '<line x1="0" x2="' + W + '" y1="' + (top + k * ph / 5) + '" y2="' + (top + k * ph / 5) + '" stroke="#18181B" vector-effect="non-scaling-stroke"/>';
    var bars = cs.map(function (c, i) {
      var x = off0 + i * cw + cw / 2, up = c.c >= c.o, col = up ? '#3DDC97' : '#F2708A', y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
      pts.push({ x: x, y: Y(c.c), v: c.c, o: c.o, h: c.h, l: c.l });
      return '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + Y(c.h).toFixed(1) + '" y2="' + Y(c.l).toFixed(1) + '" stroke="' + col + '" stroke-width="1.4" vector-effect="non-scaling-stroke"/>' +
        '<rect x="' + (x - bw / 2).toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1.5, y2 - y1).toFixed(1) + '" rx="1" fill="' + col + '"' + (i === cs.length - 1 ? ' class="lastc"' : '') + '/>' +
        '<rect x="' + (x - bw / 2).toFixed(1) + '" y="' + (H - c.v / vmx * vh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (c.v / vmx * vh).toFixed(1) + '" fill="' + col + '" opacity=".28"/>';
    }).join('');
    S.chartPts = pts; S.chartW = W; S.chartH = H;
    var last = cs[cs.length - 1], ly = Y(last.c), lcol = last.c >= last.o ? '#3DDC97' : '#F2708A';
    var labels = ''; for (var j = 0; j <= 4; j++) { var v = mx - j * sp / 4; labels += '<span class="ylab" style="top:' + ((top + j * ph / 4) / H * 100).toFixed(2) + '%">' + yLabel(v) + '</span>'; }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Candlestick chart">' + g + bars +
      '<line x1="0" x2="' + W + '" y1="' + ly.toFixed(1) + '" y2="' + ly.toFixed(1) + '" stroke="' + lcol + '" stroke-opacity=".6" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/></svg>' + labels +
      '<span class="lastlab" style="top:' + (ly / H * 100).toFixed(2) + '%;background:' + lcol + '">' + yLabel(last.c) + '</span>' +
      '<div class="xh" id="xh"></div><div class="xh-dot" id="xhd" style="background:#fff"></div><div class="xh-tip" id="xht"></div>' +
      '<span class="wm">' + LOGO + 'chadpad</span>';
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
    var m = {}, tot = 1e9, px = price(t);
    S.trades.forEach(function (tr) { if (tr.tick !== t.tick) return; var tok = tr.tokens || tr.sol * SOL_USD / px; m[tr.wallet] = (m[tr.wallet] || 0) + (tr.side === 'buy' ? tok : -tok * 0.6); });
    var list = Object.keys(m).filter(function (k) { return m[k] > 0; }).map(function (k) { return { a: k, tok: m[k] }; }).sort(function (a, b) { return b.tok - a.tok; });
    var held = 0; list.forEach(function (h) { held += h.tok; });
    var circ = tot * Math.min(0.85, 0.1 + t.prog / 100 * 0.75), scale = held ? circ / held : 0;
    list.forEach(function (h) { h.pct = h.tok * scale / tot * 100; });
    var out = [];
    if (t.prog < 100) out.push({ a: 'curve', pct: 100 - circ / tot * 100, label: 'Bonding curve' }); else out.push({ a: 'pool', pct: 20.6, label: 'Raydium pool' });
    return out.concat(list.slice(0, 18));
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
  function commentHTML(c, t, enter) {
    var w = WMAP[c.w], me = S.account && c.w === S.account, dev = c.w === devOf(t);
    return '<div class="cmt' + (enter ? ' enter' : '') + '"><span class="av" style="width:34px;height:34px">' + A.svg(walletSpec(c.w)) + '</span><div class="cmt-b">' +
      '<div class="cmt-h"><b>' + (me ? 'You' : w && w.n ? '@' + w.n : short(c.w)) + '</b>' + (dev ? '<span class="bdg dev">DEV</span>' : '') + '<span class="muted mono" data-t="' + c.t + '">' + ago(c.t) + '</span><span class="muted mono">#' + (1000 + c.id) + '</span></div>' +
      (c.reply != null ? '<div class="cmt-r">replying to #' + (1000 + c.reply) + '</div>' : '') +
      '<div class="cmt-t">' + esc(c.text) + '</div>' +
      '<div class="cmt-a"><button class="' + (c.liked ? 'on' : '') + '" data-act="like" data-arg="' + c.id + '">♥ ' + c.likes + '</button><button data-act="replyTo" data-arg="' + c.id + '">reply</button></div></div></div>';
  }
  function position(t) { var p = S.pos[t.tick]; if (!p || p.tok <= 0) return null; var val = p.tok * price(t) / SOL_USD; return { tok: p.tok, cost: p.cost, val: val, pnl: val - p.cost, pct: p.cost ? (val / p.cost - 1) * 100 : 0 }; }
  function quoteFor(t) {
    var isBuy = S.side === 'buy', amt = parseFloat(String(S.amount).replace(',', '.')) || 0, px = price(t);
    var sol = isBuy ? amt : amt * px / SOL_USD, pct = isBuy ? t.buy : t.sell, tax = sol * pct / 100, net = sol - tax;
    var impact = Math.min(25, net * 3 / Math.sqrt(Math.max(t.mcN, 4)));
    var outTok = isBuy ? net * SOL_USD / (px * (1 + impact / 200)) : 0, outSol = isBuy ? 0 : net * (1 - impact / 200);
    return { isBuy: isBuy, amt: amt, sol: sol, pct: pct, tax: tax, impact: impact, out: isBuy ? outTok : outSol, min: (isBuy ? outTok : outSol) * (1 - S.slip / 100) };
  }

  // ================= WALLET PANEL (GMGN / Axiom style) =================
  S.walletView = null; S.trackWallets = [];
  try { S.trackWallets = JSON.parse(localStorage.getItem('gp.track') || '[]'); } catch (e) {}
  function walletStats(addr, t) {
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
  function walletDrawer() {
    if (!S.walletView) return '';
    var addr = S.walletView, t = find(S.tick) || featured(), st = walletStats(addr, t), other = walletOther(addr), dev = addr === devOf(t), tracked = S.trackWallets.indexOf(addr) !== -1;
    var pnlCls = st.pnl >= 0 ? 'up' : 'down', sign = function (v) { return (v >= 0 ? '+' : '') + v.toFixed(3); };
    return '<div class="overlay drawer-ov" data-act="bg"><aside class="drawer" role="dialog" aria-modal="true" aria-label="Wallet details">' +
      '<div class="dw-head"><span class="av" style="width:56px;height:56px">' + A.svg(walletSpec(addr)) + '</span><div style="flex:1;min-width:0"><b style="font-size:18px">' + esc(walletName(addr)) + '</b>' + (dev ? ' <span class="bdg dev">DEV</span>' : '') +
        '<button class="copy" style="display:flex;margin-top:4px" data-act="copyW" data-arg="' + esc(addr) + '">' + esc(addr.slice(0, 6) + '…' + addr.slice(-6)) + ' ' + I.copy + '</button></div><button class="iconbtn" data-act="closeW" aria-label="Close">✕</button></div>' +
      '<div class="dw-actions"><button class="btn ' + (tracked ? 'sec' : 'pri') + '" data-act="trackW" data-arg="' + esc(addr) + '">' + (tracked ? 'Tracking ✓' : 'Track wallet') + '</button><button class="btn sec" data-act="maker" data-arg="' + esc(addr) + '">Show its trades</button></div>' +
      '<div class="dw-sec"><div class="dw-title">' + avatarHTML(t, 22) + 'on $' + esc(t.tick) + '</div>' +
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
          '<span class="lr-bar"><i style="--w:' + v.toFixed(1) + '%"></i>' + lbSpark(t, 160, 28) + '</span><span class="lr-chg mono ' + (c >= 0 ? 'up' : 'down') + '" data-chg2="' + esc(t.tick) + '">' + chgTxt(c) + '</span>' +
          '<span class="lr-big mono"' + (S.lbTab === 'mcap' ? ' data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '"' : '') + '>' + fmt(t) + '</span></button>';
      }).join('');
    }
    return '<main class="wrap lbpage" style="padding-top:22px"><section class="lb-hero"><div class="lb-glow"></div><div class="lb-head"><div><span class="kicker"><span class="livedot"></span>LIVE RANKINGS</span><h1>Hall of Chads</h1></div>' + tabBar + '</div>' +
      '<div class="lb-stage" key="' + S.lbTab + '">' + champ + '<div class="podcs">' + side + '</div></div></section>' +
      '<section class="lb-list card-s">' + rows + '</section><p class="note" style="margin-top:12px">Rankings use simulated market data in this beta.</p></main>';
  }


  function tokenPage() {
    var t = find(S.tick) || featured(), on = S.watch.indexOf(t.tick) !== -1, c = chg(t), id = esc(t.tick);
    var ath = Math.max.apply(null, t.hist.concat([t.mcN])), athPct = t.mcN / ath * 100;
    var tt = S.trades.filter(function (x) { return x.tick === t.tick; }), nb = 0, ns = 0, vb = 0, vs = 0;
    tt.forEach(function (x) { if (x.side === 'buy') { nb++; vb += x.sol; } else { ns++; vs += x.sol; } });
    var q = quoteFor(t), pos = position(t), tmax = Math.max(t.buy, t.sell);
    var curveSol = (t.prog / 100 * 85).toFixed(2);
    var head = '<section class="card-s tp-head2">' + avatarHTML(t, 84) +
      '<div class="tp-id"><div class="title-xl" style="margin:0;font-size:30px">' + esc(t.name) + ' <span class="tk">$' + id + '</span></div>' +
        '<div class="hs-pills" style="margin-top:8px"><button class="pill copy2" data-act="ca" data-arg="' + id + '">CA ' + esc(short(t.ca)) + ' ' + I.copy + '</button><span class="pill" style="padding-left:11px">created <span data-t="' + t.born + '">&nbsp;' + ago(t.born) + '</span>&nbsp;ago by&nbsp;' + makerHTML(devOf(t), t) + '</span>' +
        socialsHTML(t, true) +
        '<button class="iconbtn" data-act="star" data-arg="' + id + '" aria-label="Watchlist" aria-pressed="' + on + '">' + I.star(on) + '</button><button class="iconbtn" data-act="share" aria-label="Copy link"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8h16v-8M12 3v13M7 8l5-5 5 5"/></svg></button></div></div>' +
      '<div class="tp-key"><div class="tax" style="background:' + taxBg(tmax) + ';padding:9px 14px"><small>TAX</small><b style="font-size:24px">' + t.buy + '/' + t.sell + '</b><small style="letter-spacing:.04em;font-size:9px">BUY/SELL %</small></div>' +
        '<button class="pairbig" data-act="pairOpen" data-arg="' + esc(t.pair) + '">' + coinHTML(t.pair, 42) + '<div><small>PAIRED WITH</small><b>' + esc(pairLabel(t.pair)) + '</b><span>' + esc(pairInfo(t.pair).name) + '</span></div></button></div></section>';
    var mcrow = '<section class="card-s mcrow"><div class="mc-main"><div class="l muted">Market cap</div><div class="mc-big"><span data-mc="' + id + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</span><span class="chgpill ' + (c >= 0 ? 'up' : 'down') + '" data-chg="' + id + '">' + chgTxt(c) + '</span></div>' +
        '<div class="ath"><div class="ath-l"><span class="muted">ATH</span><span class="mono">' + fmtK(ath) + '</span></div><div class="ath-bar"><i data-athbar="' + id + '" style="width:' + athPct.toFixed(1) + '%"></i></div></div></div>' +
      '<div class="mstats">' + [['Price', '<span data-price="' + id + '" data-v="' + fmtPrice(price(t)) + '">' + fmtPrice(price(t)) + '</span>'], ['24h vol', fmtK(t.vol)], ['Liquidity', curveSol + ' SOL'], ['Holders', fmtNum(t.holders)],
        ['Txns', '<span class="up">' + nb + '</span> / <span class="down">' + ns + '</span>'], ['Buy vol', '<span class="up">' + vb.toFixed(1) + '</span> / <span class="down">' + vs.toFixed(1) + '</span> SOL']].map(function (r) { return '<div><span class="muted">' + r[0] + '</span><b class="mono">' + r[1] + '</b></div>'; }).join('') + '</div></section>';
    var chart = '<section class="card-s panel"><div class="chart-tb"><div class="seg">' + ['5M', '1H', '6H', '24H'].map(function (x) { return '<button class="' + (S.tf === x ? 'on' : '') + '" data-act="tf" data-arg="' + x + '">' + x + '</button>'; }).join('') + '</div>' +
      '<div class="seg"><button class="' + (S.chartMode === 'mc' ? 'on' : '') + '" data-act="cmode" data-arg="mc">MCap</button><button class="' + (S.chartMode === 'price' ? 'on' : '') + '" data-act="cmode" data-arg="price">Price</button></div>' +
      '<span class="muted mono" style="margin-left:auto;font-size:11.5px;display:flex;align-items:center;gap:6px"><span class="livedot"></span>$' + id + '/' + esc(pairLabel(t.pair)) + ' · live</span></div>' +
      '<div class="chartbox" id="chart">' + chartSVG(t) + '</div></section>';
    // tabs
    var tabs = [['trades', 'Trades'], ['thread', 'Thread (' + seedComments(t).length + ')'], ['holders', 'Holders'], ['top', 'Top traders']];
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
      var hs = holdersOf(t), cols = ['#E8E8EA', '#A3B1C2', '#3DDC97', '#FFD15C', '#FF9A4D', '#FF6B8B', '#5CE1E6', '#C4B5FD'];
      var top10 = 0; hs.slice(1, 11).forEach(function (h) { top10 += h.pct; });
      body = '<div class="hdist">' + hs.slice(0, 9).map(function (h, i) { return '<i style="flex:' + h.pct.toFixed(2) + ';background:' + (i ? cols[(i - 1) % cols.length] : '#3A3A42') + '" title="' + (h.label || short(h.a)) + ' ' + h.pct.toFixed(2) + '%"></i>'; }).join('') + '<i style="flex:12;background:#1F1F23"></i></div>' +
        '<div class="muted" style="font-size:12.5px;margin:6px 0 12px">Top 10 holders own <b style="color:' + (top10 > 40 ? 'var(--down)' : 'var(--up)') + '">' + top10.toFixed(1) + '%</b> · ' + fmtNum(t.holders) + ' holders</div>' +
        hs.map(function (h, i) { return '<div class="hrow"><span class="mono muted">' + (i + 1) + '</span>' + (h.label ? '<span class="maker"><span class="av" style="width:20px;height:20px;background:#3A3A42"></span><span>' + h.label + '</span><span class="bdg pool">' + (h.a === 'curve' ? 'CURVE' : 'POOL') + '</span></span>' : makerHTML(h.a, t)) +
          '<span class="hbar"><i style="width:' + Math.min(100, h.pct * 2).toFixed(1) + '%;background:' + (i ? cols[(i - 1) % cols.length] : '#3A3A42') + '"></i></span><span class="mono r">' + h.pct.toFixed(2) + '%</span></div>'; }).join('');
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
    return '<main class="wrap" style="padding-top:18px"><button class="link" data-act="home">' + I.back + 'Back to board</button>' + head +
      '<div class="tp-grid"><div class="tp-main">' + mcrow + chart + tabsHTML + '</div><aside class="tp-side">' + panel + posCard + safety + curve + '</aside></div></main>';
  }
  // give seeded trades real makers / prices
  S.trades.forEach(function (tr) { var t = find(tr.tick); tr.wallet = pickWallet(); tr.price = t ? price(t) * (1 + (Math.random() - 0.5) * 0.12) : 0; tr.tokens = tr.sol * SOL_USD / (tr.price || 1); tr.sig = b58(64); });
  function tpNewTrade(tr, t) {
    var tb = document.getElementById('tp-trades'); if (!tb || S.tpTab !== 'trades' || !tradeMatches(tr)) return;
    var tbl = document.getElementById('tp-tbl');
    if (tbl && tbl.matches(':hover')) { S.tpQueue++; var p = document.getElementById('tp-paused'); if (p) { p.style.display = ''; document.getElementById('tp-qn').textContent = S.tpQueue; } return; }
    tb.insertAdjacentHTML('afterbegin', tradeRow(tr, t, true)); while (tb.children.length > 40) tb.removeChild(tb.lastChild);
  }
  setInterval(function () {
    if (S.screen !== 'token') return; var t = find(S.tick); if (!t || Math.random() > 0.35) return;
    var cm = seedComments(t), w = WALLETS[Math.floor(Math.random() * WALLETS.length)];
    var c = { id: cm.length, w: w.a, text: pick(CMT), t: Date.now(), likes: 0, liked: false, reply: Math.random() < 0.3 && cm.length ? Math.floor(Math.random() * cm.length) : null };
    cm.push(c); var box = document.getElementById('cmts'); if (box && S.tpTab === 'thread') box.insertAdjacentHTML('afterbegin', commentHTML(c, t, true));
  }, 6000);

  function createPage() {
    var c = S.c, sp = c.spec, tmax = Math.max(c.buy, c.sell);
    var preview = { name: c.name || 'Your token', tick: c.tick || 'TICKER', spec: sp, img: c.img, buy: c.buy, sell: c.sell, pair: c.pair, mcN: 5, mc0: 5, prog: 1, born: Date.now(), holders: 1, ca: 'preview', hist: [5, 5.1, 5, 5.2, 5.4], rewards: false, burn: false };
    function opts(key, list) { return '<div class="optrow">' + list.map(function (v) { return '<button class="opt' + (sp[key] === v ? ' on' : '') + '" data-act="spec" data-k="' + key + '" data-arg="' + v + '">' + v + '</button>'; }).join('') + '</div>'; }
    function sws(key, list) { return '<div class="optrow">' + list.map(function (v) { return '<button class="sw' + (sp[key] === v ? ' on' : '') + '" style="background:' + v + '" data-act="spec" data-k="' + key + '" data-arg="' + v + '" aria-label="Colour ' + v + '"></button>'; }).join('') + '</div>'; }
    return '<main class="wrap" style="padding-top:22px;max-width:1240px">' +
      '<button class="link" data-act="home">' + I.back + 'Back to board</button>' +
      '<h1 class="title-xl" style="font-size:38px;margin:8px 0 22px">Launch a token</h1>' +
      '<div class="create-grid">' +
        '<section class="card-s panel" style="flex:999 1 520px;min-width:0;display:flex;flex-direction:column;gap:20px;padding:24px">' +
          '<div class="row"><div class="field" style="flex:2 1 220px"><label for="c-name" style="font-weight:700">Name</label><input id="c-name" class="inp" maxlength="32" data-bind="c.name" value="' + esc(c.name) + '" placeholder="e.g. Giga Pug"></div>' +
            '<div class="field" style="flex:1 1 140px"><label for="c-tick" style="font-weight:700">Ticker</label><input id="c-tick" class="inp mono" data-bind="c.tick" value="' + esc(c.tick) + '" placeholder="DFROG"></div></div>' +
          '<div class="field"><label for="c-desc" style="font-weight:700">Description</label><textarea id="c-desc" class="inp" data-bind="c.desc" placeholder="What is this token about?">' + esc(c.desc) + '</textarea></div>' +
          '<div class="field"><div style="display:flex;justify-content:space-between;align-items:center"><b>Logo</b><button class="link" style="font-size:13.5px" data-act="randomLogo">' + I.dice + ' Randomise</button></div>' +
            '<label class="upload" for="c-img">' + I.up + '<span>' + (c.img ? 'Custom image uploaded — <u>change</u>' : 'Upload your own image (PNG, JPG, GIF — max 2 MB) or build a mascot below') + '</span></label><input id="c-img" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="sr">' +
            (c.img ? '<button class="link" style="font-size:13px" data-act="clearImg">Remove image, use mascot</button>' : '') +
            '<div class="builder"' + (c.img ? ' style="opacity:.45"' : '') + '><span class="muted" style="font-size:12.5px">Character</span>' + opts('kind', A.KINDS) +
              '<span class="muted" style="font-size:12.5px">Colour</span>' + sws('skin', A.SKINS) + '<span class="muted" style="font-size:12.5px">Background</span>' + sws('bg', A.BGS) +
              '<span class="muted" style="font-size:12.5px">Eyes</span>' + opts('eyes', A.EYES) + '<span class="muted" style="font-size:12.5px">Mouth</span>' + opts('mouth', A.MOUTHS) +
              '<span class="muted" style="font-size:12.5px">Accessory</span>' + opts('acc', A.ACCS) + '</div></div>' +
          '<div class="field"><b>Pair with — anything</b>' + CATS.slice(1).map(function (cg) { var ids = cg[0] === 'memes' ? BASE.slice().sort(function (a, b) { return b.mcN - a.mcN; }).slice(0, 6).map(function (t) { return t.tick; }) : PAIRS.filter(function (id) { return PAIR_INFO[id].cat === cg[0]; }); return '<div class="pairgroup"><span class="muted" style="font-size:12px">' + cg[1] + '</span><div class="optrow">' + ids.map(function (id) { return '<button class="opt popt' + (c.pair === id ? ' on' : '') + '" data-act="cpair" data-arg="' + esc(id) + '">' + coinHTML(id, 22) + esc(pairLabel(id)) + '</button>'; }).join('') + '</div></div>'; }).join('') + '</div>' +
          '<div class="row" style="gap:20px"><div class="field" style="flex:1 1 200px"><div class="lbl"><label for="c-buy">Buy tax</label><span>' + c.buy + '%</span></div><input id="c-buy" type="range" min="0" max="10" step="1" value="' + c.buy + '" data-bind="c.buy" data-num="1"></div>' +
            '<div class="field" style="flex:1 1 200px"><div class="lbl"><label for="c-sell">Sell tax</label><span>' + c.sell + '%</span></div><input id="c-sell" type="range" min="0" max="10" step="1" value="' + c.sell + '" data-bind="c.sell" data-num="1"></div></div>' +
          '<div class="row"><div class="field" style="flex:1 1 180px"><label for="c-x" style="font-weight:700">X (optional)</label><input id="c-x" class="inp" data-bind="c.x" value="' + esc(c.x) + '" placeholder="x.com/…"></div>' +
            '<div class="field" style="flex:1 1 180px"><label for="c-tg" style="font-weight:700">Telegram (optional)</label><input id="c-tg" class="inp" data-bind="c.tg" value="' + esc(c.tg) + '" placeholder="t.me/…"></div>' +
            '<div class="field" style="flex:1 1 180px"><label for="c-web" style="font-weight:700">Website (optional)</label><input id="c-web" class="inp" data-bind="c.web" value="' + esc(c.web) + '" placeholder="https://"></div></div>' +
          '<button class="big-btn btn pri" data-act="launch">' + (S.account ? 'Launch token' : 'Connect wallet to launch') + '</button>' +
          '<span class="note">Beta: launching adds your token to this board (saved in your browser). On-chain launch via Raydium LaunchLab is coming next.</span>' +
        '</section>' +
        '<aside style="flex:1 1 320px;display:flex;flex-direction:column;gap:12px;position:sticky;top:90px"><span class="kicker">LIVE PREVIEW</span>' + card(preview, { preview: true }) +
          '<div class="card-s panel" style="display:flex;align-items:center;gap:16px">' + avatarHTML(preview, 72) + '<div><b>Your logo</b><div class="muted" style="font-size:13px;margin-top:4px;line-height:1.5">' + (tmax > 6 ? 'High tax shows in pink — buyers will notice.' : tmax > 0 ? 'Moderate tax, clearly shown to buyers.' : '0% tax — a strong selling point.') + '</div></div></div></aside>' +
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
    return '<footer><div class="wrap foot"><span style="display:flex;align-items:center;gap:8px"><span style="width:22px;height:22px;display:inline-block">' + LOGO + '</span><b style="color:var(--soft)">CHADPAD</b></span>' +
      '<span>Beta · market data on this page is simulated · wallet connects to Solana ' + CLUSTER + '</span>' +
      '<span style="margin-left:auto;display:flex;gap:16px"><a href="#machine" data-act="how">How it works</a><a href="#" data-act="social">X</a><a href="#" data-act="social">Telegram</a><a href="#" data-act="social">Terms</a></span></div></footer>';
  }

  // ================= RENDER =================
  var firstCount = true;
  function render() {
    var ae = document.activeElement, fid = ae && ae.id, ss = null, se = null;
    try { if (fid && ae.selectionStart != null) { ss = ae.selectionStart; se = ae.selectionEnd; } } catch (e) {}
    var body = S.screen === 'token' ? tokenPage() : S.screen === 'create' ? createPage() : S.screen === 'leaders' ? leadersPage() : home();
    document.getElementById('app').innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="ccUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3DDC97" stop-opacity=".28"/><stop offset="1" stop-color="#3DDC97" stop-opacity="0"/></linearGradient><linearGradient id="ccDn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2708A" stop-opacity=".26"/><stop offset="1" stop-color="#F2708A" stop-opacity="0"/></linearGradient></defs></svg>' + tape() + header() + body + footer() + walletModal() + palette() + walletDrawer();
    if (fid) { var el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) {} } }
    if (S.palOpen && !fid) { var p = document.getElementById('pal'); if (p) p.focus(); }
    if (S.screen === 'home' && !S.loading && firstCount) { firstCount = false; countUp(); }
    if (typeof reveal === 'function') reveal();
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
    if (t.prog < 100) t.prog = Math.max(0, Math.min(100, t.prog + dir * sol * 0.25));
    if (side === 'buy' && Math.random() < 0.4) t.holders += 1;
    t.hist.push(t.mcN); if (t.hist.length > 160) t.hist.shift();
    var tr = { tick: t.tick, side: side, sol: sol, wallet: wallet || pickWallet(), t: Date.now(), tax: sol * (side === 'buy' ? t.buy : t.sell) / 100, mine: !!mine, price: price(t), sig: b58(64) }; tr.tokens = sol * SOL_USD / tr.price;
    S.trades.unshift(tr); if (S.trades.length > 400) S.trades.pop();
    S.tradeCount++;
    paint(t, dir, tr);
    t._lt = Date.now();
    var cardEl = document.querySelector('.tcard[data-card="' + t.tick + '"]');
    if (cardEl) { cardEl.classList.remove('shake', 'shake-s'); void cardEl.offsetWidth; cardEl.classList.add(side === 'buy' ? 'shake' : 'shake-s'); if (S.sort === 'bump' && S.screen === 'home' && !cardEl.matches(':hover')) { var gp = cardEl.parentNode; if (gp && gp.firstChild !== cardEl) gp.insertBefore(cardEl, gp.firstChild); } }
    machineTrade(t, tr);
    if (S.screen === 'home') raceUpdate(t, side);
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
      var ab = document.querySelector('[data-athbar="' + t.tick + '"]'); if (ab) { var athv = Math.max.apply(null, t.hist); ab.style.width = (t.mcN / athv * 100).toFixed(1) + '%'; }
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
    S.launched.unshift(t); if (S.launched.length > 20) S.launched.pop();
    toast('New launch: ' + name + ' $' + tick, t);
    machineLaunch(t);
    raceRefresh();
    var i2 = document.getElementById('i2-fresh'); if (i2) { i2.insertAdjacentHTML('afterbegin', i2Row(t)); i2.firstElementChild.classList.add('enter'); while (i2.children.length > 4) i2.removeChild(i2.lastChild); }
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
  function openToken(tick) { set({ walletView: null, screen: 'token', tick: tick, side: 'buy', amount: '', tf: '1H', tpTab: 'trades', palOpen: false, walletMenu: false }); window.scrollTo(0, 0); }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (S.fpop && !e.target.closest('.fdrop')) { S.fpop = null; if (!el) { render(); return; } }
    if (S.walletMenu && !e.target.closest('.wpill') && !(el && /airdrop|refresh|copyAddr|disconnect/.test(el.getAttribute('data-act')))) { S.walletMenu = false; if (!el) { render(); return; } }
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
      case 'tf': set({ tf: arg }); break;
      case 'tpTab': set({ tpTab: arg }); break;
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
      case 'cpair': setC({ pair: arg }); break;
      case 'cat': set({ cat: arg, pair: 'All' }); break;
      case 'fpop': set({ fpop: S.fpop === arg ? null : arg }); break;
      case 'ptab': S.pairTab = arg; render(); break;
      case 'ppick': set({ pair: S.pair === arg ? 'All' : arg, cat: S.pair === arg ? 'all' : pairInfo(arg).cat, fpop: null }); break;
      case 'pcat': set({ cat: arg, pair: 'All', fpop: null }); break;
      case 'pclear': set({ cat: 'all', pair: 'All', fpop: null, pairTab: 'all', pairQ: '' }); break;
      case 'rpre': var rq = arg.split('|'); S.r[rq[0]] = [+rq[1], +rq[2]]; render(); break;
      case 'rz': var dd = stageWH(); if (dd) zoomAt(dd.w / 2, dd.h / 2, arg === 'in' ? 1.6 : 1 / 1.6, true); break;
      case 'rzp': zoomPreset(arg); break;
      case 'rtab': S.raceTab = arg; S.raceAll = false; var rs = document.getElementById('race'); if (rs) rs.outerHTML = raceSection(); break;
      case 'rall': S.raceAll = !S.raceAll; var rs2 = document.getElementById('race'); if (rs2) rs2.outerHTML = raceSection(); break;
      case 'rzat': var za = arg.split('|'), dz = stageWH(); if (dz) { var px0 = +za[0] / 100 * dz.w * RZ.z + RZ.x, py0 = +za[1] / 100 * dz.h * RZ.z + RZ.y; zoomAt(px0, py0, 2.6, true); } break;
      case 'soc': var sp0 = arg.split('|'), st0 = find(sp0[0]), so0 = st0 && socialsOf(st0), u0 = so0 && so0[sp0[1]];
        if (so0 && !so0.demo && u0) window.open(u0, '_blank', 'noopener'); else toast('Demo coin — its ' + ({ web: 'website', x: 'X account', tg: 'Telegram' })[sp0[1]] + ' opens here once real coins go live', st0); break;
      case 'quick': var qq0 = QUICK.filter(function (x) { return x[0] === arg; })[0]; if (qq0 && qq0[2]) set({ cat: pairInfo(qq0[2]).cat, pair: qq0[2], view: 'grid' }); else set({ cat: arg, pair: 'All', view: 'grid' }); setTimeout(function () { var bd = document.getElementById('board'); if (bd) bd.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); break;
      case 'feedf': S.feedF = arg; render(); break;
      case 'leaders': set({ screen: 'leaders', palOpen: false }); window.scrollTo(0, 0); break;
      case 'lbtab': set({ lbTab: arg }); break;
      case 'walletAny': S.tick = (S.trades.filter(function (x) { return x.wallet === arg; })[0] || {}).tick || S.tick; set({ walletView: arg }); break;
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
      case 'like': var cl = (S.comments[S.tick] || [])[+arg]; if (cl) { cl.liked = !cl.liked; cl.likes += cl.liked ? 1 : -1; render(); } break;
      case 'replyTo': set({ replyTo: +arg }); setTimeout(function () { var ci = document.getElementById('cmt-in'); if (ci) ci.focus(); }, 20); break;
      case 'post':
        var txt = (S.cmtDraft || '').trim(); if (!txt) { toast('Write something first'); break; }
        var cms = seedComments(find(S.tick)); cms.push({ id: cms.length, w: S.account, text: txt, t: Date.now(), likes: 0, liked: false, reply: S.replyTo != null ? S.replyTo : null });
        set({ cmtDraft: '', replyTo: null }); toast('Posted to the thread'); break;
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
        if (find(c.tick)) { toast('$' + c.tick + ' is already taken'); break; }
        var nt = { name: c.name.trim(), tick: c.tick, spec: c.spec, img: c.img, buy: c.buy, sell: c.sell, pair: c.pair, mcN: 5, mc0: 5, prog: 1, born: Date.now(), holders: 1,
          soc: !!(c.x || c.tg || c.web), links: { web: linkOf(c.web), x: linkOf(c.x), tg: linkOf(c.tg), demo: false }, rewards: false, burn: false, ca: fakeCA(), vol: 0, hist: [5, 5], desc: c.desc.trim(), creator: S.account };
        S.created.unshift(nt); saveCreated();
        S.c = { name: '', tick: '', desc: '', x: '', tg: '', web: '', pair: 'SOL', buy: 0, sell: 0, img: null, spec: { kind: pick(A.KINDS), skin: pick(A.SKINS), bg: pick(A.BGS), eyes: 'normal', mouth: 'smile', acc: 'none' } };
        openToken(nt.tick); confetti(); toast('$' + nt.tick + ' is live on CHADPAD', nt); break;
    }
  });

  document.addEventListener('input', function (e) {
    var rg = e.target.getAttribute && e.target.getAttribute('data-range');
    if (rg) {
      var pk = rg.split('|'), k = pk[0], idx = +pk[1], val = +e.target.value, r = S.r[k];
      if (idx === 0) r[0] = Math.min(val, r[1]); else r[1] = Math.max(val, r[0]);
      if (+e.target.value !== r[idx]) e.target.value = r[idx];
      refreshGrid(); return;
    }
    var el = e.target, key = el.getAttribute && el.getAttribute('data-bind');
    if (!key) return;
    var v = el.value;
    if (el.getAttribute('data-num')) v = Number(v);
    if (key === 'c.tick') v = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (key === 'amount') { v = v.replace(/[^0-9.,]/g, ''); S.pctAmt = 0; }
    if (key === 'pctAmt') { var base = (S.account && typeof S.balance === 'number') ? Math.max(0, S.balance - 0.01) : 10; el.style.setProperty('--p', v + '%'); set({ pctAmt: v, amount: v ? (base * v / 100).toFixed(3) : '' }); return; }
    if (key.indexOf('c.') === 0) { var p = {}; p[key.slice(2)] = v; setC(p); return; }
    var o = {}; o[key] = v; if (key === 'palQ') o.palIdx = 0; set(o);
  });

  document.addEventListener('change', function (e) {
    if (e.target.id !== 'c-img') return;
    var f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('Image is over 2 MB'); return; }
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { toast('Use PNG, JPG, GIF or WEBP'); return; }
    var r = new FileReader(); r.onload = function () { setC({ img: r.result }); }; r.readAsDataURL(f);
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); set({ palOpen: !S.palOpen, palQ: '', palIdx: 0 }); return; }
    if (e.key === 'Escape') { if (S.palOpen || S.walletOpen || S.walletMenu || S.walletView) set({ palOpen: false, walletOpen: false, walletMenu: false, walletView: null }); return; }
    if (S.palOpen) {
      var res = palResults();
      if (e.key === 'ArrowDown') { e.preventDefault(); set({ palIdx: Math.min(res.length - 1, S.palIdx + 1) }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); set({ palIdx: Math.max(0, S.palIdx - 1) }); }
      else if (e.key === 'Enter' && res[S.palIdx]) { e.preventDefault(); openToken(res[S.palIdx].tick); }
    }
  });

  // card spotlight follows the mouse
  document.addEventListener('mousemove', function (e) {
    var c = e.target.closest && e.target.closest('.tcard');
    if (c) { var r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); }
    var box = e.target.closest && e.target.closest('#chart');
    if (box && S.chartPts) {
      var rb = box.getBoundingClientRect(), fx = (e.clientX - rb.left) / rb.width;
      var i = Math.max(0, Math.min(S.chartPts.length - 1, Math.round(fx * (S.chartPts.length - 1)))), p = S.chartPts[i];
      var xh = document.getElementById('xh'), d = document.getElementById('xhd'), tip = document.getElementById('xht');
      if (!xh) return;
      var px = p.x / S.chartW * rb.width, py = p.y / S.chartH * rb.height;
      xh.style.display = d.style.display = tip.style.display = 'block';
      xh.style.left = px + 'px'; d.style.left = px + 'px'; d.style.top = py + 'px';
      var steps = S.chartPts.length - 1 - i, mins = { '5M': 10 / 60, '1H': 1, '6H': 6, '24H': 12 }[S.tf] * steps;
      tip.innerHTML = 'O <b>' + yLabel(p.o) + '</b> H <b class="up">' + yLabel(p.h) + '</b> L <b class="down">' + yLabel(p.l) + '</b> C <b>' + yLabel(p.v) + '</b> · ' + (mins < 1 ? Math.round(mins * 60) + 's' : mins < 60 ? Math.round(mins) + 'm' : (mins / 60).toFixed(1) + 'h') + ' ago';
      tip.style.left = Math.min(rb.width - tip.offsetWidth - 4, Math.max(4, px + 12)) + 'px';
    }
  });
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
  function machineSection() {
    var mach = [
      ['press', POS.press, 'MASCOT PRESS', '#A3B1C2', '1', 'Give it a face', 'Name, ticker &amp; mascot'],
      ['tax', POS.tax, 'TAX STAMP', '#FFD15C', '2', 'Set the tax', '0–10%, shown to everyone'],
      ['scan', POS.scan, 'RUG SCANNER', '#F2708A', '3', 'Rug check', 'Bad coins get thrown out'],
      ['pump', POS.pump, 'PUMP', '#3DDC97', '4', 'Traders pump it', 'Every buy pushes the price up'],
      ['launch', POS.launch, 'LAUNCHER', '#ECECEE', '5', 'Graduate', 'Hits 100% → Raydium']
    ];
    var html = mach.map(function (m) {
      return '<div class="mach m-' + m[0] + '" id="mach-' + m[0] + '" style="left:' + m[1] + '%;--mc:' + m[3] + '">' +
        '<div class="mach-body"><span class="mach-name">' + m[2] + '</span><span class="mach-lights"><i></i><i></i><i></i></span>' +
        (m[0] === 'pump' ? '<span class="gauge"><i id="pump-g"></i></span>' : '') + (m[0] === 'launch' ? '<span class="ramp"></span>' : '') + '</div>' +
        '<div class="piston"><i></i></div>' + (m[0] === 'scan' ? '<span class="beam"></span>' : '') + '</div>' +
        '<div class="mlab" style="left:' + m[1] + '%"><span class="mstepn">' + m[4] + '</span><b>' + m[5] + '</b><span>' + m[6] + '</span></div>';
    }).join('');
    var crane = '<div class="crane"><span class="rail" style="left:' + (POS.pick - 3) + '%;width:' + (POS.bin - POS.pick + 6) + '%"></span>' +
      '<div class="trolley" id="trolley" style="left:' + POS.pick + '%"><span class="tr-body"></span><span class="cable" id="cable"></span>' +
      '<span class="claw" id="claw"><span class="claw-hub"></span><span class="finger l"></span><span class="finger r"></span><span class="claw-hold" id="claw-hold"></span></span></div>' +
      '<span class="crane-tag" style="left:' + ((POS.pick + POS.bin) / 2) + '%">RUG CATCHER</span></div>';
    var bin = '<div class="rugbin" id="rugbin" style="left:' + POS.bin + '%"><span class="bin-pole"></span><span class="bin-back"></span><span class="bin-slot" id="bin-slot"></span>' +
      '<span class="bin-front"><b id="rug-n">' + RUGS + '</b><small>RUGS</small></span><span class="bin-lid"><i></i></span><span class="bin-plus" id="bin-plus">+1</span></div>';
    var split = '<div class="split"><div class="split-h"><b>Where does the tax go?</b><span class="muted">Every trade pays the tax shown on the coin. It gets shared like this:</span><span class="mono split-tot" id="fs-jar">' + M.tax.toFixed(2) + ' SOL shared so far</span></div>' +
      '<div class="split-bar"><span class="sp c" style="flex:50"><b>50%</b> Creator</span><span class="sp h" style="flex:30"><b>30%</b> Holders</span><span class="sp v" style="flex:20"><b>20%</b> Burn</span></div></div>';
    return '<section class="factory card-s" id="machine">' +
      '<div class="m-head"><div><span class="kicker"><span class="livedot"></span>HOW IT WORKS</span><h2 class="title-xl" style="font-size:32px;margin:8px 0 4px">From raw coin to legend</h2>' +
        '<p class="muted" style="margin:0">Every coin rides the same line. Rugs get caught and binned. Only the strong reach Raydium.</p></div>' +
        '<div class="line-stats"><div><span class="muted">Rugs binned</span><b class="mono down" id="ls-rug">' + RUGS + '</b></div><div><span class="muted">Passed</span><b class="mono up" id="ls-ok">' + CLEAN + '</b></div><button class="btn pri" data-act="mlaunch">Drop a coin in</button></div></div>' +
      '<div class="line-wrap drag-scroll"><div class="line" id="line">' +
        '<div class="hopper"><span>RAW<br>COINS</span></div>' + html + crane +
        '<div class="belt2"><span class="belt2-track"></span><span class="roller r1"></span><span class="roller r2"></span><span class="roller r3"></span><span class="roller r4"></span><span class="roller r5"></span></div>' +
        bin + '<div id="coins"></div><div class="exit"><span>RAYDIUM</span></div></div></div>' + split + '</section>';
  }
  // ---------- conveyor + crane engine ----------
  var LC = [], lastSpawn = 0, LT = performance.now(), ARM = { busy: false };
  function spawnCoin(tok, forceRug) {
    var box = document.getElementById('coins'); if (!box) return;
    var src = tok || pick(all()), el = document.createElement('div'), rug = forceRug != null ? forceRug : (!tok && Math.random() < 0.3);
    var tx = rug ? 6 + Math.floor(Math.random() * 4) : Math.max(src.buy, src.sell);
    el.className = 'lcoin s0';
    el.innerHTML = '<span class="lc-raw">?</span><span class="lc-face">' + avatarHTML(src, 46) + '</span><span class="lc-tax" style="background:' + taxBg(tx) + '">' + tx + '%</span><span class="lc-mc mono">$5K</span><span class="lc-rug">RUG</span><span class="lc-ok">✓</span>';
    box.appendChild(el);
    LC.push({ el: el, x: 2, st: 0, mc: 5, tok: src, rug: rug, scanned: false, held: false, gone: false });
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
          c.el.classList.add(c.rug ? 'rug' : 'clean');
          if (!c.rug) { CLEAN++; setCount('ls-ok', CLEAN); }
        }
        if (c.rug && c.scanned && c.x >= POS.pick) { c.x = POS.pick; c.held = true; }
        var st = c.x < POS.press ? 0 : c.x < POS.tax ? 1 : c.x < POS.pump ? 2 : c.x < POS.launch ? 3 : 4;
        if (st !== c.st) {
          c.st = st; c.el.classList.remove('s0', 's1', 's2', 's3', 's4'); c.el.classList.add('s' + st);
          stampMachine(['', 'press', 'tax', 'pump', 'launch'][st]);
          if (st === 4) { (function (cc) { setTimeout(function () { cc.el.remove(); cc.gone = true; }, 1300); })(c); }
        }
        if (st === 3) { c.mc += dt * 0.09 * (1 + c.mc / 60); var mcEl = c.el.querySelector('.lc-mc'); if (mcEl) mcEl.textContent = fmtK(c.mc); c.el.style.setProperty('--grow', Math.min(1.35, 1 + (c.x - POS.pump) / 50)); }
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
