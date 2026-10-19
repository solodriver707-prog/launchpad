/* Diamond Launchpad — no build step, no dependencies.
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
  var LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 24 22 10h20l10 14-20 30z" fill="#7DE3FF"/><path d="M12 24h40L32 54z" fill="#9B8CFF"/><path d="M22 10l4 14h12l4-14M12 24l20 30 20-30" fill="none" stroke="#060A12" stroke-width="1.8" stroke-linejoin="round"/><path d="M26 24l6 30 6-30" fill="none" stroke="#060A12" stroke-width="1.4" opacity=".6"/></svg>';

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
    mk('Static Owl', 'STATIC', 'owl', 7, 1, 'laser', 'o', 'none', 4, 8, 'GBP', 41, -31.2, 9, 25, 90, false, 0, 0),
    mk('Diamond Paws', 'PAWS', 'cat', 5, 7, 'normal', 'tongue', 'chain', 2, 2, 'NFROG', 520, 17.4, 81, 720, 2010, true, 1, 1),
    mk('Turbo Pug', 'TURBO', 'pug', 8, 3, 'shades', 'grin', 'cap', 0, 0, 'BTC', 260, 6.1, 57, 360, 1020, true, 1, 0),
    mk('Gigabear', 'GIGA', 'bear', 9, 4, 'shades', 'smile', 'chain', 1, 1, 'SOL', 1020, 45.3, 100, 2880, 3810, true, 1, 1),
    mk('Frost Shark', 'FROST', 'shark', 5, 7, 'shades', 'grin', 'none', 0, 2, 'JPY', 133, -3.2, 38, 95, 520, false, 0, 0),
    mk('Banana Ape', 'NANA', 'monkey', 8, 2, 'normal', 'tongue', 'party', 2, 4, 'MANGO', 77, 66.7, 24, 30, 260, true, 0, 0),
    mk('Sir Hoots', 'SIR', 'owl', 6, 5, 'normal', 'smile', 'crown', 0, 1, 'AAPLx', 405, 8.8, 72, 1300, 1540, true, 1, 0),
    mk('Disco Cat', 'DISCO', 'cat', 4, 1, 'wink', 'grin', 'halo', 1, 3, 'GIGA', 19, 210.4, 6, 6, 64, false, 0, 0),
    mk('Laser Frog', 'ZAP', 'frog', 9, 0, 'laser', 'grin', 'none', 3, 6, 'SILVER', 156, -18.5, 44, 260, 590, false, 0, 1)
  ];
  var PAIR_INFO = {
    SOL: { name: 'Solana', cat: 'crypto', g: '◎', c: '#9B8CFF' }, USDC: { name: 'USD Coin', cat: 'crypto', g: '$', c: '#5B9BFF' },
    ETH: { name: 'Ether', cat: 'crypto', g: 'Ξ', c: '#A5B4FC' }, BTC: { name: 'Bitcoin', cat: 'crypto', g: '₿', c: '#FFA94D' },
    SPYx: { name: 'S&P 500', cat: 'stocks', g: 'S&P', c: '#34E39A' }, TSLAx: { name: 'Tesla', cat: 'stocks', g: 'T', c: '#FF7A93' },
    NVDAx: { name: 'Nvidia', cat: 'stocks', g: 'N', c: '#9BE15D' }, AAPLx: { name: 'Apple', cat: 'stocks', g: 'A', c: '#D7DEEA' },
    GOLD: { name: 'Gold', cat: 'commod', g: 'Au', c: '#FFD15C' }, SILVER: { name: 'Silver', cat: 'commod', g: 'Ag', c: '#CBD5E1' }, OIL: { name: 'Crude oil', cat: 'commod', g: 'Oil', c: '#F59E6B' },
    EUR: { name: 'Euro', cat: 'fx', g: '€', c: '#7DB8FF' }, JPY: { name: 'Yen', cat: 'fx', g: '¥', c: '#FF9AA8' }, GBP: { name: 'Pound', cat: 'fx', g: '£', c: '#C4B5FD' }
  };
  var CATS = [
    ['all', 'Everything', 'Pair with anything', '#7DE3FF'], ['memes', 'Memes', 'Meme paired with meme', '#FF6B8B'],
    ['crypto', 'Crypto', 'SOL · USDC · BTC · ETH', '#9B8CFF'], ['stocks', 'Stocks', 'Tokenized equities', '#34E39A'],
    ['commod', 'Commodities', 'Gold · silver · oil', '#FFD15C'], ['fx', 'Currencies', 'EUR · JPY · GBP', '#7DB8FF']
  ];
  var PAIRS = Object.keys(PAIR_INFO);
  function pairInfo(id) { if (PAIR_INFO[id]) return PAIR_INFO[id]; var t = find(id); return { name: t ? t.name : id, cat: 'memes', g: '', c: '#FF6B8B', meme: t }; }
  function pairLabel(id) { return PAIR_INFO[id] ? id : '$' + id; }
  function coinHTML(id, size) {
    var p = pairInfo(id);
    if (p.meme) return avatarHTML(p.meme, size);
    var fs = Math.round(size * (p.g.length > 2 ? 0.3 : p.g.length > 1 ? 0.38 : 0.52));
    return '<span class="coin" style="width:' + size + 'px;height:' + size + 'px;background:' + p.c + ';font-size:' + fs + 'px">' + esc(p.g) + '</span>';
  }
  var SORTS = [['trending', 'Trending'], ['newest', 'Newest'], ['mcap', 'Market cap'], ['lowtax', 'Lowest tax'], ['grad', 'Near graduation']];
  var TOGGLES = [['zeroOnly', '0% tax only'], ['gradOnly', 'Graduated only'], ['rewardsOnly', 'Holder rewards'], ['watchOnly', 'My watchlist']];
  var ADJ = ['Turbo', 'Baby', 'Sigma', 'Based', 'Cosmic', 'Glitch', 'Ice', 'Mega', 'Sleepy', 'Rich', 'Sir', 'Lucky', 'Hyper', 'Chill', 'Golden', 'Retro'];
  var NOUN = { frog: 'Frog', cat: 'Cat', duck: 'Duck', bear: 'Bear', pug: 'Pug', goat: 'Goat', owl: 'Owl', shark: 'Shark', monkey: 'Ape' };

  // ================= STATE =================
  var S = {
    screen: 'home', tick: null, side: 'buy', amount: '', tf: '1H', tpTab: 'trades',
    maxTax: 10, minProg: 0, minMc: 0, pair: 'All', cat: 'all', view: 'grid', deckIdx: 0, pctAmt: 0, sort: 'trending', zeroOnly: false, gradOnly: false, rewardsOnly: false, watchOnly: false,
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
    var cols = ['#7DE3FF', '#9B8CFF', '#34E39A', '#FFD15C', '#FF6B8B'];
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
      '<button class="brand" data-act="home" aria-label="Diamond Launchpad home">' + LOGO + '<span class="brand-name">Diamond<span> Launchpad</span></span><span class="beta">BETA</span></button>' +
      '<nav class="navlinks"><button class="' + (S.screen === 'home' ? 'on' : '') + '" data-act="home">Board</button><button class="' + (S.screen === 'create' ? 'on' : '') + '" data-act="create">Create</button><button data-act="how">How it works</button></nav>' +
      '<button class="searchbtn" data-act="palette">' + I.search + '<span>Search tokens or paste CA</span><span class="kbd">Ctrl K</span></button>' +
      '<div class="hdr-right"><button class="btn pri" data-act="create">+ Launch token</button>' + right + '</div>' +
      '</div></header>';
  }

  function spark(t) {
    var h = t.hist.slice(-36), mx = Math.max.apply(null, h), mn = Math.min.apply(null, h), sp = (mx - mn) || 1;
    return h.map(function (v, i) { return (i * 110 / (h.length - 1)).toFixed(1) + ',' + (36 - (v - mn) / sp * 32).toFixed(1); }).join(' ');
  }

  function card(t, opts) {
    opts = opts || {};
    var tmax = Math.max(t.buy, t.sell), on = S.watch.indexOf(t.tick) !== -1, c = chg(t), done = t.prog >= 100;
    var badges = (t.rewards ? '<span class="tag i" data-tip="Holders earn a share of trading fees">' + I.gift + ' Rewards</span>' : '') +
      (t.burn ? '<span class="tag i" data-tip="Platform revenue buys back & burns">' + I.flame + ' Burn</span>' : '');
    return '<article class="tcard' + (S.newTick === t.tick ? ' is-new' : '') + '" data-card="' + esc(t.tick) + '">' +
      '<div class="tc-top"><button class="tc-id" data-act="open" data-arg="' + esc(t.tick) + '">' + avatarHTML(t, 58) +
        '<span class="tc-name"><b>' + esc(t.name) + '</b><span>$' + esc(t.tick) + ' · <span data-t="' + t.born + '">' + ago(t.born) + '</span></span></span></button>' +
        '<div class="tax" style="background:' + taxBg(tmax) + '" data-tip="Buy ' + t.buy + '% · Sell ' + t.sell + '%"><small>TAX</small><b>' + tmax + '%</b></div></div>' +
      '<div class="tc-mid"><div class="tc-mc"><div class="l">Market cap</div><div class="v"><span data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</span>' +
        '<span class="chgpill ' + (c >= 0 ? 'up' : 'down') + '" data-chg="' + esc(t.tick) + '">' + chgTxt(c) + '</span></div></div>' +
        '<svg class="spark" viewBox="0 0 110 40" preserveAspectRatio="none" aria-hidden="true"><polyline data-spark="' + esc(t.tick) + '" points="' + spark(t) + '" fill="none" stroke="' + (c >= 0 ? '#34E39A' : '#FF5C7C') + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg></div>' +
      '<div class="tags"><span class="tag">Buy ' + t.buy + '%</span><span class="tag">Sell ' + t.sell + '%</span><span class="tag v pairtag">' + coinHTML(t.pair, 16) + esc(pairLabel(t.pair)) + '</span>' + badges + '</div>' +
      '<div class="prog"><div class="l"><span>' + (done ? 'Graduated to Raydium' : 'Bonding curve') + '</span><span class="mono" data-prog="' + esc(t.tick) + '">' + Math.min(100, t.prog).toFixed(0) + '%</span></div>' +
        '<div class="bar"><i class="' + (done ? 'done' : '') + '" data-bar="' + esc(t.tick) + '" style="width:' + Math.max(1, Math.min(100, t.prog)) + '%"></i></div></div>' +
      (opts.preview ? '' : '<div class="tc-act"><button class="btn pri" data-act="open" data-arg="' + esc(t.tick) + '">Trade</button>' +
        '<button class="iconbtn" data-act="ca" data-arg="' + esc(t.tick) + '" aria-label="Copy contract address" data-tip="Copy CA">' + I.copy + '</button>' +
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
      if (t > S.maxTax) return false;
      if (S.zeroOnly && t !== 0) return false;
      if (S.gradOnly && d.prog < 100) return false;
      if (S.rewardsOnly && !d.rewards) return false;
      if (S.watchOnly && S.watch.indexOf(d.tick) === -1) return false;
      if (d.prog < S.minProg || d.mcN < S.minMc) return false;
      if (S.cat !== 'all' && pairInfo(d.pair).cat !== S.cat) return false;
      if (S.pair !== 'All' && d.pair !== S.pair) return false;
      return true;
    });
    var sorters = {
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
      '<svg class="feat-chart" viewBox="0 0 1000 220" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="hg' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7DE3FF" stop-opacity=".22"/><stop offset="1" stop-color="#7DE3FF" stop-opacity="0"/></linearGradient></defs>' +
        '<path data-ha="' + id + '" d="' + ch.area + '" fill="url(#hg' + id + ')"/><path data-hl="' + id + '" d="' + ch.line + '" fill="none" stroke="#7DE3FF" stroke-opacity=".3" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
        '<path data-hl="' + id + '" class="flow" d="' + ch.line + '" fill="none" stroke="#7DE3FF" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>' +
      '<div class="hs-left">' +
        '<span class="kicker"><span class="livedot"></span><span class="rank">#' + (rank + 1) + '</span> DIAMOND OF THE HOUR</span>' +
        '<div class="title-xl hs-title">' + esc(t.name) + ' <span class="tk">$' + id + '</span></div>' +
        '<div class="hs-pills"><span class="pill">' + coinHTML(t.pair, 20) + 'paired with ' + esc(pairLabel(t.pair)) + '</span><span class="pill">' + fmtNum(t.holders) + ' holders</span>' +
          '<button class="pill copy2" data-act="ca" data-arg="' + id + '">' + esc(short(t.ca)) + ' ' + I.copy + '</button>' + (t.rewards ? '<span class="pill i">' + I.gift + ' Rewards</span>' : '') + (t.burn ? '<span class="pill i">' + I.flame + ' Burn</span>' : '') + '</div>' +
        '<div class="hs-stats"><div class="stat"><div class="l">Market cap</div><div class="v" data-mc="' + id + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</div></div>' +
          '<div class="stat"><div class="l">24h</div><div class="v ' + (c >= 0 ? 'up' : 'down') + '" data-chg2="' + id + '">' + chgTxt(c) + '</div></div>' +
          '<div class="tax" style="background:' + taxBg(tmax) + ';padding:9px 14px"><small>TAX</small><b style="font-size:24px">' + tmax + '%</b></div></div>' +
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
      '<div class="side-stack"><div class="vstats">' +
        '<div class="vtile"><div class="l">Tokens live</div><div class="v" data-count="' + st.tokens + '">' + st.tokens + '</div><div class="avstack">' + avs + '</div></div>' +
        '<div class="vtile"><div class="l">24h volume</div><div class="v" id="stat-vol">' + fmtK(st.vol) + '</div><div class="vbars" id="vbars">' + vbars() + '</div></div>' +
        '<div class="vtile"><div class="l"><span class="livedot"></span> Trades</div><div class="v" id="stat-trades">' + fmtNum(st.trades) + '</div><svg class="tline" viewBox="0 0 150 40" preserveAspectRatio="none" aria-hidden="true"><polyline id="tline" points="' + tline() + '" fill="none" stroke="#9B8CFF" stroke-width="2" stroke-linejoin="round"/></svg></div>' +
        '<div class="vtile ring-t"><div><div class="l">Graduated</div><div class="v" data-count="' + st.grad + '">' + st.grad + '</div><div class="muted" style="font-size:11.5px">to Raydium</div></div>' +
          '<svg class="ring2" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="#1A2540" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="url(#rg)" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (C * gradPct / 100).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 32 32)" class="ringarc"/><defs><linearGradient id="rg"><stop offset="0" stop-color="#7DE3FF"/><stop offset="1" stop-color="#9B8CFF"/></linearGradient></defs><g transform="translate(23 23) scale(.75)" fill="#7DE3FF"><path d="M6 3h12l4 6-10 12L2 9z"/></g></svg></div>' +
      '</div>' +
      '<div class="card-s feed"><div class="feed-h"><span class="livedot"></span>Live trades<span class="muted mono" style="margin-left:auto;font-size:11.5px;font-weight:500">simulated</span></div>' +
        '<div class="feed-list" id="feed">' + S.trades.slice(0, 6).map(function (t) { return feedRow(t); }).join('') + '</div></div></div>' +
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
  setInterval(function () { if (S.screen === 'home' && !heroHover && !hd && document.visibilityState === 'visible') heroGo(S.heroIdx + 1); }, 7000);
  // drag hero carousel
  var hd = null;
  document.addEventListener('pointerdown', function (e) {
    var car = e.target.closest && e.target.closest('#hero-track');
    if (!car || e.target.closest('button') || e.button !== 0) return;
    hd = { x: e.clientX, w: car.parentNode.clientWidth, dx: 0, tr: car };
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
    return '<div class="pair-head"><span class="kicker">PAIRED WITH</span><span class="muted" style="font-size:13px">Coins on Diamond can trade against anything — drag to explore</span></div>' +
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
      '<svg class="sc-spark" viewBox="0 0 110 40" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + spark(t) + '" fill="none" stroke="' + (c >= 0 ? '#34E39A' : '#FF5C7C') + '" stroke-width="2.2" stroke-linejoin="round"/></svg></div>';
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

  function home() {
    var hero = heroHTML();

    var list = filtered();
    var toolbar = '<div class="toolbar"><h2 class="h2">Tokens</h2><div class="seg">' + SORTS.map(function (s) {
      return '<button class="' + (S.sort === s[0] ? 'on' : '') + '" aria-pressed="' + (S.sort === s[0]) + '" data-act="sort" data-arg="' + s[0] + '">' + s[1] + '</button>';
    }).join('') + '</div><div class="seg" role="group" aria-label="View"><button class="' + (S.view === 'grid' ? 'on' : '') + '" data-act="view" data-arg="grid">Grid</button><button class="' + (S.view === 'bubbles' ? 'on' : '') + '" data-act="view" data-arg="bubbles">Bubbles</button></div><span class="mono muted" style="margin-left:auto;font-size:12.5px" id="count">' + list.length + ' of ' + all().length + ' tokens</span></div>' +
      pairSection();

    var filters = '<aside class="card-s filters">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">Filters</b><button class="link" style="color:var(--ice);font-weight:700;font-size:13.5px" data-act="reset">Reset</button></div>' +
      '<div class="field"><div class="lbl"><label for="f-tax">Max tax</label><span>' + S.maxTax + '%</span></div><input id="f-tax" type="range" min="0" max="10" step="1" value="' + S.maxTax + '" data-bind="maxTax" data-num="1"></div>' +
      '<div class="field"><div class="lbl"><label for="f-prog">Bonding curve ≥</label><span>' + S.minProg + '%</span></div><input id="f-prog" type="range" min="0" max="100" step="5" value="' + S.minProg + '" data-bind="minProg" data-num="1"></div>' +
      '<div class="field"><div class="lbl"><label for="f-mc">Market cap ≥</label><span>' + (S.minMc ? fmtK(S.minMc) : 'Any') + '</span></div><input id="f-mc" type="range" min="0" max="1000" step="25" value="' + S.minMc + '" data-bind="minMc" data-num="1"></div>' +
      '<div>' + TOGGLES.map(function (t) {
        var on = !!S[t[0]];
        return '<button class="switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" data-act="toggle" data-arg="' + t[0] + '"><span>' + t[1] + '</span><span class="track"><i></i></span></button>';
      }).join('') + '</div>' +
      '<div class="tags" style="gap:8px"><span class="tag" style="background:var(--up);color:#04140C">0%</span><span class="tag" style="background:var(--yellow);color:#1A1200">≤3%</span><span class="tag" style="background:var(--orange);color:#1A0B00">≤6%</span><span class="tag" style="background:var(--pink);color:#1A0409">6%+</span></div>' +
      '<span class="muted" style="font-size:12.5px;line-height:1.5;margin-top:-12px">Tax colours: buyers see the exit cost before they click.</span></aside>';

    var grid = (!S.loading && S.view === 'bubbles') ? bubblesHTML(list) : '<section class="grid" id="grid">' + (S.loading ? [0, 1, 2, 3, 4, 5].map(skeletonCard).join('') : list.length ? list.map(function (t) { return card(t); }).join('') :
      '<div class="empty"><b style="font-size:19px">No tokens match these filters</b><span class="muted">Loosen the tax or market cap filters.</span><button class="btn pri" data-act="reset">Reset filters</button></div>') + '</section>';

    var how = '<section id="how" style="margin-top:56px"><h2 class="h2" style="margin-bottom:16px">How Diamond works</h2><div class="row">' +
      [['01', 'Pick a name & logo', 'Use the built-in mascot builder or upload your own image. Takes under a minute.'],
       ['02', 'Set your buy & sell tax', 'From 0% to 10%. The tax is shown on every card in colour, so traders always know the cost.'],
       ['03', 'Launch on a bonding curve', 'Price rises as people buy. When the curve fills, liquidity graduates to Raydium automatically.']].map(function (s) {
        return '<div class="card-s" style="flex:1 1 260px;padding:22px;display:flex;flex-direction:column;gap:8px"><span class="mono" style="color:var(--ice);font-size:13px">' + s[0] + '</span><b style="font-size:17px">' + s[1] + '</b><span class="muted" style="line-height:1.55">' + s[2] + '</span></div>';
      }).join('') + '</div></section>';

    return '<main class="wrap">' + hero + swipeSection() + toolbar + '<div class="layout">' + filters + grid + '</div>' + how + '</main>';
  }

  function tfPoints(t) { var n = { '5M': 30, '1H': 60, '6H': 90, '24H': 120 }[S.tf]; return t.hist.slice(-n); }
  function chartSVG(t) {
    var d = tfPoints(t), W = 1000, H = 340, mx = Math.max.apply(null, d), mn = Math.min.apply(null, d), sp = (mx - mn) || 1;
    var pad = 24, pts = d.map(function (v, i) { return { x: i * W / (d.length - 1), y: H - pad - (v - mn) / sp * (H - pad * 2.4), v: v }; });
    S.chartPts = pts; S.chartW = W; S.chartH = H;
    var line = 'M' + pts.map(function (p) { return p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' L');
    var up = d[d.length - 1] >= d[0], col = up ? '#34E39A' : '#FF5C7C', last = pts[pts.length - 1];
    var grid = ''; for (var g = 1; g < 5; g++) grid += '<line x1="0" x2="' + W + '" y1="' + (g * H / 5) + '" y2="' + (g * H / 5) + '" stroke="#16213A" vector-effect="non-scaling-stroke"/>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Price chart"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + col + '" stop-opacity=".25"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>' + grid +
      '<line x1="0" x2="' + W + '" y1="' + last.y.toFixed(1) + '" y2="' + last.y.toFixed(1) + '" stroke="' + col + '" stroke-opacity=".5" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="url(#cg)"/><path d="' + line + '" fill="none" stroke="' + col + '" stroke-width="2.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>' +
      '<div class="xh" id="xh"></div><div class="xh-dot" id="xhd" style="background:' + col + '"></div><div class="xh-tip" id="xht"></div>' +
      '<div style="position:absolute;right:0;top:' + (last.y / H * 100).toFixed(2) + '%;transform:translateY(-50%);background:' + col + ';color:#05080F;font-family:var(--mono);font-size:11.5px;font-weight:700;padding:3px 7px;border-radius:6px">' + fmtPrice(price(t)) + '</div>' +
      '<span style="position:absolute;left:' + (last.x / W * 100) + '%;top:' + (last.y / H * 100).toFixed(2) + '%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:99px;background:' + col + ';box-shadow:0 0 0 6px ' + col + '33"></span>';
  }

  function tradeRow(tr, t, enter) {
    return '<div class="tr' + (enter ? ' enter' : '') + '"><span style="font-weight:700" class="' + (tr.side === 'buy' ? 'up' : 'down') + '">' + tr.side.toUpperCase() + '</span>' +
      '<span style="color:var(--soft)">' + (tr.mine ? '<b style="color:var(--ice)">You</b>' : esc(short(tr.wallet))) + '</span><span>' + tr.sol.toFixed(3) + '</span>' +
      '<span style="color:var(--soft)">' + fmtNum(tr.sol * SOL_USD / price(t)) + '</span><span style="color:var(--soft)">' + tr.tax.toFixed(4) + '</span><span class="muted" data-t="' + tr.t + '">' + ago(tr.t) + '</span></div>';
  }

  function tokenPage() {
    var t = find(S.tick) || featured(), on = S.watch.indexOf(t.tick) !== -1, c = chg(t);
    var isBuy = S.side === 'buy', amt = parseFloat(String(S.amount).replace(',', '.')) || 0;
    var pct = isBuy ? t.buy : t.sell, tax = amt * pct / 100, net = amt - tax, out = net * SOL_USD / price(t);
    var trades = S.trades.filter(function (x) { return x.tick === t.tick; }).slice(0, 14);
    var hr = (function () { var r = [], left = 100, seed = t.tick.length; if (t.prog < 100) { var bc = 100 - t.prog * 0.7; r.push(['Bonding curve', bc]); left -= bc; }
      for (var i = 0; i < 9; i++) { var p = left * (0.18 - i * 0.012); r.push([short(t.ca.slice(i * 3) + b58(4)), p]); left -= p; } return r; })();
    var btnLabel = !S.account ? 'Connect wallet to trade' : (isBuy ? 'Buy $' : 'Sell $') + esc(t.tick);
    var socials = '<div class="socials"><button class="iconbtn" data-act="social" aria-label="X / Twitter">' + I.x + '</button><button class="iconbtn" data-act="social" aria-label="Telegram">' + I.tg + '</button><button class="iconbtn" data-act="social" aria-label="Website">' + I.web + '</button></div>';

    return '<main class="wrap" style="padding-top:22px">' +
      '<button class="link" data-act="home">' + I.back + 'Back to board</button>' +
      '<section class="card-s tp-head" style="margin-top:8px">' + avatarHTML(t, 92) +
        '<div style="flex:1 1 260px;min-width:0"><div class="title-xl" style="margin-top:0">' + esc(t.name) + ' <span class="tk">$' + esc(t.tick) + '</span></div>' +
          '<div class="muted" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><span>↔ ' + esc(t.pair) + '</span><span>·</span><span>created <span data-t="' + t.born + '">' + ago(t.born) + '</span> ago</span><span>·</span>' +
          '<button class="copy" data-act="ca" data-arg="' + esc(t.tick) + '">CA ' + esc(short(t.ca)) + ' ' + I.copy + '</button></div>' +
          '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' + socials +
            (t.rewards ? '<span class="tag i" data-tip="Holders earn a share of trading fees">' + I.gift + ' Rewards</span>' : '') + (t.burn ? '<span class="tag i" data-tip="Revenue buys back & burns">' + I.flame + ' Burn</span>' : '') + '</div></div>' +
        '<div class="feat-stats" style="gap:28px">' +
          '<div class="stat"><div class="l">Price</div><div class="v" data-price="' + esc(t.tick) + '" data-v="' + fmtPrice(price(t)) + '">' + fmtPrice(price(t)) + '</div></div>' +
          '<div class="stat"><div class="l">Market cap</div><div class="v" data-mc="' + esc(t.tick) + '" data-v="' + fmtK(t.mcN) + '">' + fmtK(t.mcN) + '</div></div>' +
          '<div class="stat"><div class="l">24h</div><div class="v ' + (c >= 0 ? 'up' : 'down') + '" data-chg2="' + esc(t.tick) + '">' + chgTxt(c) + '</div></div>' +
          '<div style="display:flex;gap:8px"><div class="tax" style="background:' + taxBg(t.buy) + ';padding:8px 12px"><small>BUY TAX</small><b style="font-size:22px">' + t.buy + '%</b></div>' +
          '<div class="tax" style="background:' + taxBg(t.sell) + ';padding:8px 12px"><small>SELL TAX</small><b style="font-size:22px">' + t.sell + '%</b></div></div>' +
          '<button class="iconbtn" style="width:48px;height:48px" data-act="star" data-arg="' + esc(t.tick) + '" aria-label="Add to watchlist" aria-pressed="' + on + '">' + I.star(on) + '</button></div></section>' +
      '<div class="tp-grid"><div class="tp-main">' +
        '<section class="card-s panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px"><b style="font-size:16px;display:flex;align-items:center;gap:8px"><span class="livedot"></span>$' + esc(t.tick) + ' / ' + esc(t.pair) + '</b>' +
          '<div class="seg">' + ['5M', '1H', '6H', '24H'].map(function (x) { return '<button class="' + (S.tf === x ? 'on' : '') + '" data-act="tf" data-arg="' + x + '">' + x + '</button>'; }).join('') + '</div></div>' +
          '<div class="chartbox" id="chart">' + chartSVG(t) + '</div></section>' +
        '<section class="card-s panel"><div class="tabs"><button class="' + (S.tpTab === 'trades' ? 'on' : '') + '" data-act="tpTab" data-arg="trades">Trades</button><button class="' + (S.tpTab === 'holders' ? 'on' : '') + '" data-act="tpTab" data-arg="holders">Top holders</button><button class="' + (S.tpTab === 'about' ? 'on' : '') + '" data-act="tpTab" data-arg="about">About</button></div>' +
          (S.tpTab === 'trades' ? '<div class="tbl"><div class="tr h"><span>Type</span><span>Wallet</span><span>SOL</span><span>$' + esc(t.tick) + '</span><span>Tax (SOL)</span><span>Age</span></div><div id="tp-trades">' + trades.map(function (x) { return tradeRow(x, t); }).join('') + '</div></div>' :
           S.tpTab === 'holders' ? '<div>' + hr.map(function (h, i) { return '<div class="holder"><span class="mono muted">' + (i + 1) + '</span><div><span class="mono" style="font-size:13px">' + esc(h[0]) + '</span><div class="hb"><i style="width:' + Math.min(100, h[1] * 1.4) + '%"></i></div></div><span class="mono" style="text-align:right">' + h[1].toFixed(2) + '%</span></div>'; }).join('') + '<div class="muted" style="font-size:12.5px;margin-top:8px">' + fmtNum(t.holders) + ' holders in total</div></div>' :
           '<p style="color:var(--soft);line-height:1.65;margin:8px 0 0">' + esc(t.desc || ('$' + t.tick + ' is a community memecoin paired with ' + t.pair + '. Buy tax ' + t.buy + '%, sell tax ' + t.sell + '%. Launched on Diamond.')) + '</p>') +
        '</section></div>' +
        '<aside class="tp-side"><section class="card-s panel tradebox">' +
          '<div class="bs"><button class="b' + (isBuy ? ' on' : '') + '" data-act="side" data-arg="buy">Buy</button><button class="s' + (!isBuy ? ' on' : '') + '" data-act="side" data-arg="sell">Sell</button></div>' +
          '<div class="field"><label for="amt" style="font-weight:700;font-size:14px;display:flex;justify-content:space-between">Amount<span class="mono muted" style="font-weight:500">' + (S.account && typeof S.balance === 'number' ? 'Bal ' + S.balance.toFixed(3) + ' SOL' : '') + '</span></label>' +
            '<div class="amtwrap"><input id="amt" class="inp" inputmode="decimal" data-bind="amount" value="' + esc(S.amount) + '" placeholder="0.00"><span>SOL</span></div>' +
            '<div class="presets">' + ['0.1', '0.5', '1', '5'].map(function (p) { return '<button data-act="preset" data-arg="' + p + '">' + p + '</button>'; }).join('') + (S.account && typeof S.balance === 'number' ? '<button data-act="preset" data-arg="max">MAX</button>' : '') + '</div>' + '<div class="pct"><input id="pct" type="range" min="0" max="100" step="1" value="' + S.pctAmt + '" data-bind="pctAmt" data-num="1" aria-label="Percent of balance" style="--p:' + S.pctAmt + '%"><div class="pct-l mono"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div></div></div>' +
          '<div class="quote"><div><span class="muted">' + (isBuy ? 'Buy' : 'Sell') + ' tax (' + pct + '%)</span><span style="color:' + taxBg(pct) + '">' + tax.toFixed(4) + ' SOL</span></div>' +
            '<div><span class="muted">After tax</span><span>' + net.toFixed(4) + ' SOL</span></div>' +
            '<div style="padding-top:9px;border-top:1px solid var(--line)"><span class="muted">' + (isBuy ? 'You receive ≈' : 'You receive') + '</span><span style="font-weight:700">' + (isBuy ? fmtNum(out) + ' $' + esc(t.tick) : net.toFixed(4) + ' SOL') + '</span></div></div>' +
          '<button class="big-btn ' + (!S.account ? 'btn pri' : isBuy ? 'up-b btn' : 'down-b btn') + '" data-act="trade" data-arg="' + esc(t.tick) + '">' + btnLabel + '</button>' +
          '<span class="note">Wallet connection is real (Solana devnet). Trades are simulated in this beta — nothing is sent on-chain.</span></section>' +
          '<section class="card-s panel" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between"><b>' + (t.prog >= 100 ? 'Graduated to Raydium' : 'Bonding curve progress') + '</b><span class="mono" style="color:var(--ice)" data-prog="' + esc(t.tick) + '">' + Math.min(100, t.prog).toFixed(0) + '%</span></div>' +
            '<div class="bar" style="height:10px"><i class="' + (t.prog >= 100 ? 'done' : '') + '" data-bar="' + esc(t.tick) + '" style="width:' + Math.max(1, Math.min(100, t.prog)) + '%"></i></div>' +
            '<span class="muted" style="font-size:12.5px;line-height:1.55">When the curve fills, liquidity migrates to Raydium and the token trades on the open market.</span></section>' +
          '<section class="card-s panel" style="display:flex;flex-direction:column;gap:10px"><b>Token info</b>' +
            [['Holders', fmtNum(t.holders)], ['24h volume', fmtK(t.vol)], ['Supply', '1,000,000,000'], ['Creator', short(t.creator || t.ca.slice(5))]].map(function (r) { return '<div style="display:flex;justify-content:space-between;font-size:13.5px"><span class="muted">' + r[0] + '</span><span class="mono">' + esc(r[1]) + '</span></div>'; }).join('') +
          '</section></aside></div></main>';
  }

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
          '<div class="row"><div class="field" style="flex:2 1 220px"><label for="c-name" style="font-weight:700">Name</label><input id="c-name" class="inp" maxlength="32" data-bind="c.name" value="' + esc(c.name) + '" placeholder="e.g. Diamond Frog"></div>' +
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
    return '<footer><div class="wrap foot"><span style="display:flex;align-items:center;gap:8px"><span style="width:22px;height:22px;display:inline-block">' + LOGO + '</span><b style="color:var(--soft)">Diamond Launchpad</b></span>' +
      '<span>Beta · market data on this page is simulated · wallet connects to Solana ' + CLUSTER + '</span>' +
      '<span style="margin-left:auto;display:flex;gap:16px"><a href="#how" data-act="how">How it works</a><a href="#" data-act="social">X</a><a href="#" data-act="social">Telegram</a><a href="#" data-act="social">Terms</a></span></div></footer>';
  }

  // ================= RENDER =================
  var firstCount = true;
  function render() {
    var ae = document.activeElement, fid = ae && ae.id, ss = null, se = null;
    try { if (fid && ae.selectionStart != null) { ss = ae.selectionStart; se = ae.selectionEnd; } } catch (e) {}
    var body = S.screen === 'token' ? tokenPage() : S.screen === 'create' ? createPage() : home();
    document.getElementById('app').innerHTML = tape() + header() + body + footer() + walletModal() + palette();
    if (fid) { var el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) {} } }
    if (S.palOpen && !fid) { var p = document.getElementById('pal'); if (p) p.focus(); }
    if (S.screen === 'home' && !S.loading && firstCount) { firstCount = false; countUp(); }
    if (typeof reveal === 'function') reveal();
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
    var tr = { tick: t.tick, side: side, sol: sol, wallet: wallet || b58(44), t: Date.now(), tax: sol * (side === 'buy' ? t.buy : t.sell) / 100, mine: !!mine };
    S.trades.unshift(tr); if (S.trades.length > 400) S.trades.pop();
    S.tradeCount++;
    paint(t, dir, tr);
    if (!wasGrad && t.prog >= 100) { toast('$' + t.tick + ' graduated to Raydium', t); if (S.screen === 'token' && S.tick === t.tick) confetti(); }
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
    q(attr('data-spark', t.tick)).forEach(function (el) { el.setAttribute('points', spark(t)); el.setAttribute('stroke', c >= 0 ? '#34E39A' : '#FF5C7C'); });
    q(attr('data-prog', t.tick)).forEach(function (el) { el.textContent = Math.min(100, t.prog).toFixed(0) + '%'; });
    q(attr('data-bar', t.tick)).forEach(function (el) { el.style.width = Math.max(1, Math.min(100, t.prog)) + '%'; if (t.prog >= 100) el.classList.add('done'); });
    var st = document.getElementById('stat-trades'); if (st) st.textContent = fmtNum(S.trades.length + S.tradeCount);
    var feed = document.getElementById('feed');
    if (feed) {
      feed.insertAdjacentHTML('afterbegin', feedRow(tr, true));
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
      var tb = document.getElementById('tp-trades');
      if (tb) { tb.insertAdjacentHTML('afterbegin', tradeRow(tr, t, true)); while (tb.children.length > 14) tb.removeChild(tb.lastChild); }
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
  function openToken(tick) { set({ screen: 'token', tick: tick, side: 'buy', amount: '', tf: '1H', tpTab: 'trades', palOpen: false, walletMenu: false }); window.scrollTo(0, 0); }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (S.walletMenu && !e.target.closest('.wpill') && !(el && /airdrop|refresh|copyAddr|disconnect/.test(el.getAttribute('data-act')))) { S.walletMenu = false; if (!el) { render(); return; } }
    if (!el) return;
    var act = el.getAttribute('data-act'), arg = el.getAttribute('data-arg');
    if (el.tagName === 'A' && act !== 'how') e.preventDefault();
    switch (act) {
      case 'bg': if (e.target === el) set({ walletOpen: false, palOpen: false }); break;
      case 'home': set({ screen: 'home', palOpen: false }); window.scrollTo(0, 0); break;
      case 'create': set({ screen: 'create', palOpen: false }); window.scrollTo(0, 0); break;
      case 'how':
        e.preventDefault();
        if (S.screen !== 'home') set({ screen: 'home' });
        setTimeout(function () { var h = document.getElementById('how'); if (h) h.scrollIntoView({ behavior: 'smooth' }); }, 30); break;
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
      case 'reset': set({ maxTax: 10, minProg: 0, minMc: 0, pair: 'All', cat: 'all', zeroOnly: false, gradOnly: false, rewardsOnly: false, watchOnly: false }); break;
      case 'tf': set({ tf: arg }); break;
      case 'tpTab': set({ tpTab: arg }); break;
      case 'side': set({ side: arg }); break;
      case 'preset': set({ pctAmt: 0, amount: arg === 'max' ? Math.max(0, S.balance - 0.01).toFixed(3) : arg }); break;
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
      case 'hero': heroGo(S.heroIdx + (+arg)); break;
      case 'heroGo': heroGo(+arg); break;
      case 'view': set({ view: arg }); break;
      case 'swipe': flyOut(arg); break;
      case 'trade':
        if (!S.account) { set({ walletOpen: true }); break; }
        var t = find(arg), amt = parseFloat(String(S.amount).replace(',', '.')) || 0;
        if (!t) break;
        if (amt <= 0) { toast('Enter an amount first'); break; }
        if (typeof S.balance === 'number' && S.side === 'buy' && amt > S.balance) { toast('Not enough devnet SOL — balance ' + S.balance.toFixed(3)); break; }
        var trd = applyTrade(t, S.side, amt, S.account, true);
        S.amount = ''; render();
        toast((S.side === 'buy' ? 'Bought' : 'Sold') + ' ' + amt + ' SOL of $' + t.tick + ' · tax ' + trd.tax.toFixed(4) + ' SOL (simulated)', t); break;
      case 'launch':
        if (!S.account) { set({ walletOpen: true }); toast('Connect a wallet to launch'); break; }
        var c = S.c;
        if (!c.name.trim() || c.tick.length < 2) { toast('Add a name and a ticker (2+ characters)'); break; }
        if (find(c.tick)) { toast('$' + c.tick + ' is already taken'); break; }
        var nt = { name: c.name.trim(), tick: c.tick, spec: c.spec, img: c.img, buy: c.buy, sell: c.sell, pair: c.pair, mcN: 5, mc0: 5, prog: 1, born: Date.now(), holders: 1,
          soc: !!(c.x || c.tg || c.web), rewards: false, burn: false, ca: fakeCA(), vol: 0, hist: [5, 5], desc: c.desc.trim(), creator: S.account };
        S.created.unshift(nt); saveCreated();
        S.c = { name: '', tick: '', desc: '', x: '', tg: '', web: '', pair: 'SOL', buy: 0, sell: 0, img: null, spec: { kind: pick(A.KINDS), skin: pick(A.SKINS), bg: pick(A.BGS), eyes: 'normal', mouth: 'smile', acc: 'none' } };
        openToken(nt.tick); confetti(); toast('$' + nt.tick + ' is live on Diamond', nt); break;
    }
  });

  document.addEventListener('input', function (e) {
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
    if (e.key === 'Escape') { if (S.palOpen || S.walletOpen || S.walletMenu) set({ palOpen: false, walletOpen: false, walletMenu: false }); return; }
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
      tip.textContent = fmtPrice(p.v * 1000 / 1e9) + ' · MC ' + fmtK(p.v) + ' · ' + (mins < 1 ? Math.round(mins * 60) + 's' : mins < 60 ? Math.round(mins) + 'm' : (mins / 60).toFixed(1) + 'h') + ' ago';
      tip.style.left = Math.min(rb.width - tip.offsetWidth - 4, Math.max(4, px + 12)) + 'px';
    }
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest && e.target.closest('#chart') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#chart'))) {
      ['xh', 'xhd', 'xht'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
    }
  });

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
