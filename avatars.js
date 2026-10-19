/* Original memecoin mascot generator — every logo is drawn here, no external images.
   spec = { kind, skin, bg, eyes, mouth, acc } */
(function () {
  'use strict';
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function f(c) { return Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt))); }
    return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
  }
  var KINDS = ['frog', 'cat', 'duck', 'bear', 'pug', 'goat', 'owl', 'shark', 'monkey'];
  var EYES = ['normal', 'shades', 'laser', 'sleepy', 'wink'];
  var MOUTHS = ['smile', 'grin', 'tongue', 'o'];
  var ACCS = ['none', 'crown', 'chain', 'cap', 'halo', 'party'];

  function eyesAt(kind) {
    if (kind === 'frog') return { y: 35, l: 33, r: 67, s: 1.05 };
    if (kind === 'owl') return { y: 50, l: 37, r: 63, s: 1.25 };
    if (kind === 'shark') return { y: 50, l: 37, r: 63, s: 0.9 };
    return { y: 52, l: 40, r: 60, s: 1 };
  }
  function drawEyes(sp, E) {
    var s = '', i, xs = [E.l, E.r];
    if (sp.eyes === 'shades') {
      s += '<path d="M' + (E.l - 11) + ' ' + (E.y - 6) + ' h' + (E.r - E.l + 22) + ' v4 h-2 q0 9 -9 9 h-2 q-8 0 -9 -8 h-' + (E.r - E.l - 16) + ' q-1 8 -9 8 h-2 q-9 0 -9 -9 h-2 z" fill="#0B0D12"/>';
      s += '<path d="M' + (E.l - 6) + ' ' + (E.y - 3) + ' l5 0 l-4 5 z" fill="#7DE3FF" opacity=".8"/>';
      s += '<path d="M' + (E.r - 3) + ' ' + (E.y - 3) + ' l5 0 l-4 5 z" fill="#7DE3FF" opacity=".8"/>';
      return s;
    }
    for (i = 0; i < 2; i++) {
      var x = xs[i], r = 6.5 * E.s;
      if (sp.eyes === 'sleepy' || (sp.eyes === 'wink' && i === 1)) {
        s += '<path d="M' + (x - r) + ' ' + E.y + ' q' + r + ' ' + (r * 0.9) + ' ' + (2 * r) + ' 0" fill="none" stroke="#0B0D12" stroke-width="2.6" stroke-linecap="round"/>';
        continue;
      }
      if (sp.eyes === 'laser') {
        s += '<line x1="' + x + '" y1="' + E.y + '" x2="' + (i ? 104 : -4) + '" y2="' + (E.y + 18) + '" stroke="#FF3D5A" stroke-width="5" stroke-linecap="round" opacity=".55"/>';
        s += '<line x1="' + x + '" y1="' + E.y + '" x2="' + (i ? 104 : -4) + '" y2="' + (E.y + 18) + '" stroke="#FFD0D8" stroke-width="1.6" stroke-linecap="round"/>';
        s += '<circle cx="' + x + '" cy="' + E.y + '" r="' + r + '" fill="#FF3D5A"/><circle cx="' + x + '" cy="' + E.y + '" r="' + (r * 0.45) + '" fill="#FFE3E8"/>';
        continue;
      }
      s += '<circle cx="' + x + '" cy="' + E.y + '" r="' + r + '" fill="#fff"/>';
      s += '<circle cx="' + (x + 1.2) + '" cy="' + (E.y + 0.8) + '" r="' + (r * 0.52) + '" fill="#0B0D12"/>';
      s += '<circle cx="' + (x + 2.6) + '" cy="' + (E.y - 1.4) + '" r="' + (r * 0.18) + '" fill="#fff"/>';
    }
    return s;
  }
  function drawMouth(sp, y, w) {
    w = w || 9;
    if (sp.mouth === 'o') return '<ellipse cx="50" cy="' + (y + 1) + '" rx="4" ry="5" fill="#3A1020"/>';
    if (sp.mouth === 'grin') return '<path d="M' + (50 - w) + ' ' + y + ' q' + w + ' ' + (w * 1.1) + ' ' + (2 * w) + ' 0 z" fill="#3A1020"/><path d="M' + (50 - w + 2) + ' ' + y + ' h' + (2 * w - 4) + ' v2.5 h-' + (2 * w - 4) + ' z" fill="#fff"/>';
    if (sp.mouth === 'tongue') return '<path d="M' + (50 - w) + ' ' + y + ' q' + w + ' ' + (w * 0.9) + ' ' + (2 * w) + ' 0" fill="none" stroke="#3A1020" stroke-width="2.6" stroke-linecap="round"/><path d="M' + (50 + 1) + ' ' + (y + 3) + ' q2 8 7 4 q1 -4 -2 -6 z" fill="#FF7A9A"/>';
    return '<path d="M' + (50 - w) + ' ' + y + ' q' + w + ' ' + (w * 0.9) + ' ' + (2 * w) + ' 0" fill="none" stroke="#3A1020" stroke-width="2.6" stroke-linecap="round"/>';
  }
  function drawAcc(sp, top) {
    var t = top;
    switch (sp.acc) {
      case 'crown': return '<path d="M34 ' + (t + 2) + ' l-2 -16 l9 8 l9 -12 l9 12 l9 -8 l-2 16 z" fill="#FFD15C" stroke="#B8860B" stroke-width="1.2" stroke-linejoin="round"/><circle cx="50" cy="' + (t - 6) + '" r="2.4" fill="#7DE3FF"/>';
      case 'cap': return '<path d="M28 ' + (t + 6) + ' q22 -22 44 0 z" fill="#9B8CFF"/><path d="M66 ' + (t + 4) + ' h18 q2 4 -3 5 h-15 z" fill="#7C6CE0"/>';
      case 'halo': return '<ellipse cx="50" cy="' + (t - 7) + '" rx="17" ry="4.5" fill="none" stroke="#FFE38A" stroke-width="3.2"/>';
      case 'party': return '<path d="M42 ' + (t + 4) + ' l8 -24 l8 24 z" fill="#FF6B8B"/><path d="M44.5 ' + (t - 3) + ' h11 M47 ' + (t - 11) + ' h6" stroke="#FFD15C" stroke-width="2.4"/><circle cx="50" cy="' + (t - 21) + '" r="3" fill="#7DE3FF"/>';
      case 'chain': return '<path d="M30 88 q20 12 40 0" fill="none" stroke="#FFD15C" stroke-width="3" stroke-dasharray="3 2"/><path d="M45 93 l5 -5 l5 5 l-5 7 z" fill="#7DE3FF" stroke="#E6FBFF" stroke-width=".8"/>';
    }
    return '';
  }

  function svg(sp) {
    var skin = sp.skin, dark = shade(skin, -0.28), light = shade(skin, 0.35);
    var k = sp.kind, o = '', top = 26, mouthY = 69, mouthW = 9;
    o += '<circle cx="50" cy="50" r="50" fill="' + sp.bg + '"/>';
    o += '<circle cx="50" cy="50" r="46" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/>';
    // body hint
    o += '<path d="M14 104 q36 -30 72 0 z" fill="' + dark + '"/>';
    if (k === 'cat') {
      o += '<path d="M23 44 L27 13 L46 30 Z M77 44 L73 13 L54 30 Z" fill="' + skin + '"/><path d="M28 34 L29.5 20 L39 29 Z M72 34 L70.5 20 L61 29 Z" fill="#FF9DB5"/>';
    } else if (k === 'bear') {
      o += '<circle cx="27" cy="31" r="11" fill="' + skin + '"/><circle cx="73" cy="31" r="11" fill="' + skin + '"/><circle cx="27" cy="31" r="5.5" fill="' + dark + '"/><circle cx="73" cy="31" r="5.5" fill="' + dark + '"/>';
    } else if (k === 'monkey') {
      o += '<circle cx="18" cy="55" r="11" fill="' + skin + '"/><circle cx="82" cy="55" r="11" fill="' + skin + '"/><circle cx="18" cy="55" r="6" fill="' + light + '"/><circle cx="82" cy="55" r="6" fill="' + light + '"/>';
    } else if (k === 'goat') {
      o += '<path d="M33 32 q-14 -10 -12 -26 q8 12 18 18 z M67 32 q14 -10 12 -26 q-8 12 -18 18 z" fill="#E9E1CF" stroke="#B9AE96" stroke-width="1.2"/>';
    } else if (k === 'owl') {
      o += '<path d="M24 36 L22 16 L40 28 Z M76 36 L78 16 L60 28 Z" fill="' + dark + '"/>';
    }
    // head
    if (k === 'frog') {
      o += '<circle cx="33" cy="36" r="13" fill="' + skin + '"/><circle cx="67" cy="36" r="13" fill="' + skin + '"/>';
      o += '<ellipse cx="50" cy="60" rx="35" ry="25" fill="' + skin + '"/><ellipse cx="50" cy="70" rx="24" ry="12" fill="' + light + '" opacity=".55"/>';
      top = 22; mouthY = 64; mouthW = 15;
    } else if (k === 'shark') {
      o += '<path d="M50 12 L38 38 L64 38 Z" fill="' + skin + '"/>';
      o += '<ellipse cx="50" cy="58" rx="33" ry="26" fill="' + skin + '"/><ellipse cx="50" cy="70" rx="22" ry="12" fill="#F2F7FF"/>';
      top = 30;
    } else {
      o += '<circle cx="50" cy="56" r="30" fill="' + skin + '"/>';
    }
    if (k === 'pug') {
      o += '<ellipse cx="25" cy="44" rx="8" ry="14" transform="rotate(25 25 44)" fill="' + dark + '"/><ellipse cx="75" cy="44" rx="8" ry="14" transform="rotate(-25 75 44)" fill="' + dark + '"/>';
      o += '<ellipse cx="50" cy="67" rx="16" ry="12" fill="' + dark + '"/><ellipse cx="50" cy="61" rx="5" ry="3.5" fill="#1A1014"/>';
      mouthY = 71; mouthW = 7;
    }
    if (k === 'monkey') { o += '<ellipse cx="50" cy="63" rx="21" ry="17" fill="' + light + '"/>'; mouthY = 70; }
    if (k === 'owl') { o += '<circle cx="37" cy="50" r="12" fill="' + light + '"/><circle cx="63" cy="50" r="12" fill="' + light + '"/>'; }
    if (k === 'cat') { o += '<ellipse cx="50" cy="62" rx="3.2" ry="2.4" fill="#FF7A9A"/><path d="M30 62 h-12 M30 66 l-11 3 M70 62 h12 M70 66 l11 3" stroke="#fff" stroke-opacity=".7" stroke-width="1.4"/>'; mouthY = 68; mouthW = 6; }
    if (k === 'bear') { o += '<ellipse cx="50" cy="66" rx="11" ry="8" fill="' + light + '"/><ellipse cx="50" cy="62" rx="4" ry="3" fill="#1A1014"/>'; mouthY = 69; mouthW = 5; }
    if (k === 'goat') { o += '<path d="M44 82 l6 14 l6 -14 z" fill="#E9E1CF"/>'; }
    o += drawEyes(sp, eyesAt(k));
    if (k === 'duck') {
      o += '<path d="M44 26 q4 -10 8 0 q3 -8 6 1" fill="none" stroke="' + skin + '" stroke-width="3" stroke-linecap="round"/>';
      o += '<ellipse cx="50" cy="67" rx="17" ry="8" fill="#FF9A3D"/><path d="M34 67 q16 6 32 0" fill="none" stroke="#D96F12" stroke-width="1.6"/>';
    } else if (k === 'owl') {
      o += '<path d="M45 62 l5 9 l5 -9 z" fill="#FFB347"/>';
    } else if (k === 'shark') {
      o += '<path d="M34 66 q16 12 32 0" fill="#3A1020"/><path d="M36 66.5 l3 4 l3 -3 l3 4 l3 -3.5 l3 4 l3 -3.5 l3 4 l3 -3.5 l3 3" fill="#fff"/>';
    } else {
      o += drawMouth(sp, mouthY, mouthW);
    }
    o += drawAcc(sp, top);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true"><g>' + o + '</g></svg>';
  }

  var cache = {};
  window.Avatars = {
    KINDS: KINDS, EYES: EYES, MOUTHS: MOUTHS, ACCS: ACCS,
    SKINS: ['#59D98E', '#FFB347', '#8B7CFF', '#F5F0E1', '#FF8FAB', '#7DD3FC', '#C8A27A', '#9CA3AF', '#FFD15C', '#6EE7B7'],
    BGS: ['#12304A', '#2A1840', '#3B2410', '#0E3B2E', '#3A1428', '#1B2440', '#33300E', '#10313A'],
    svg: function (sp) {
      var key = JSON.stringify(sp);
      if (!cache[key]) cache[key] = svg(sp);
      return cache[key];
    }
  };
})();
