(function () {
  var V = []; document.addEventListener('securitypolicyviolation', function (e) { V.push(e.violatedDirective + ' ' + String(e.blockedURI).slice(0, 60) + ' ' + String(e.sourceFile || '').slice(0, 50)); });
  var o = document.getElementById('o'), log = function (m) { o.textContent += '\n' + new Date().toISOString().slice(11, 19) + ' ' + m; },
    rep = function (k, m) { try { fetch('https://treid-indexer-mainnet.onrender.com/api/clog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ w: 'TEST-' + k + '-' + location.pathname.replace(/\W/g, ''), e: m + ' | CSP: ' + (V.join(' ; ') || 'none'), e0: 'ptest', host: location.host }) }); } catch (e) {} };
  o.textContent = 'phantom provider: ' + !!(window.phantom && window.phantom.solana);
  document.getElementById('a').onclick = function () { var p = window.phantom && window.phantom.solana; if (!p) return log('no provider');
    log('connect…'); var t = Date.now(); p.connect().then(function (r) { var m = 'OK ' + String(r.publicKey).slice(0, 6) + ' in ' + (Date.now() - t) + 'ms'; log(m); rep('prov', m); }, function (e) { var m = 'ERR ' + (e && e.code) + ' ' + (e && e.message) + ' in ' + (Date.now() - t) + 'ms'; log(m); rep('prov', m); }); };
  var W = []; window.addEventListener('wallet-standard:register-wallet', function (ev) { try { ev.detail({ register: function (w) { W.push(w); } }); } catch (e) {} });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: function (w) { W.push(w); } } }));
  document.getElementById('b').onclick = function () { var w = W.filter(function (x) { return /phantom/i.test(x.name); })[0]; if (!w) return log('no standard wallet (' + W.map(function (x) { return x.name; }).join(',') + ')');
    log('std connect…'); var t = Date.now(); w.features['standard:connect'].connect().then(function (r) { var m = 'OK ' + ((r.accounts || [])[0] || {}).address + ' in ' + (Date.now() - t) + 'ms'; log(m); rep('std', m); }, function (e) { var m = 'ERR ' + (e && e.code) + ' ' + (e && e.message) + ' in ' + (Date.now() - t) + 'ms'; log(m); rep('std', m); }); };
})();
