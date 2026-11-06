/* 首页「Indicators」块：页面里是构建时的预渲染；打开页面、回到页面和每 10 分钟各重拉一次 live/indicators.html 换掉
   （canyon_indicators.py 每小时整点导出并只推这个文件）。拉不到就保留现在的。
   实时层（1106）：每分钟从基站（Mac mini，canyon_live_server.py）拉 /live/quotes.json，换掉行情条和 VIX / OVX / 10Y 的大数；
   页面是 http 时先试同源，再试 Tailscale 上的 mini；页面是 https（GitHub）时试 Tailscale 的 HTTPS 入口；都不通就退回腾讯直连只换行情条。 */
(function () {
  var el = document.getElementById('ind'); if (!el) return;
  var MINI_HTTP = ['http://100.90.24.94:8964', 'http://mac-mini.tailde71ab.ts.net:8964'], MINI_HTTPS = 'https://mac-mini.tailde71ab.ts.net:8443';
  var cands = location.protocol === 'http:' ? [location.origin].concat(MINI_HTTP) : [MINI_HTTPS];
  var good = null, TENCENT = { NDX: 'usNDX', QQQ: 'usQQQ', NVDA: 'usNVDA', COAL: 'sh601225' };

  function load() {
    if (document.hidden) return;
    fetch('live/indicators.html?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (t) {
        if (!t) return;
        var w = document.createElement('div'); w.innerHTML = t.trim();
        var n = w.firstElementChild;
        if (n && n.id === 'ind') { el.replaceWith(n); el = n; live(); }
      })
      .catch(function () {});
  }
  function fetchT(url, ms) {
    var c = ('AbortController' in window) ? new AbortController() : null, t = c && setTimeout(function () { c.abort(); }, ms);
    return fetch(url, { cache: 'no-store', signal: c && c.signal }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r; });
  }
  function fmt(v, dec) { return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
  function setTk(key, q) {
    var tk = el.querySelector('.tape [data-sym="' + key + '"]'); if (!tk || !(q.price > 0)) return;
    var dec = +tk.getAttribute('data-dec') || 2, px = tk.querySelector('.px'), ch = tk.querySelector('.ch');
    px.textContent = fmt(q.price, dec);
    if (typeof q.pct === 'number') { ch.textContent = (q.pct > 0 ? '+' : '') + q.pct.toFixed(2) + '%'; ch.className = 'ch' + (q.pct > 0 ? ' up' : q.pct < 0 ? ' dn' : ''); }
    tk.title = (q.src || '') + ' ' + (q.time || '');
    var big = el.querySelector('[data-live="' + key + '"]');
    if (big) { var u = big.querySelector('.unit'); big.textContent = fmt(q.price, key === 'US10Y' ? 2 : 2); if (u) big.appendChild(u); }
  }
  function stamp(txt, ok) {
    var s = el.querySelector('[data-livest]'); if (s) { s.textContent = ' · ' + txt; s.className = 'livest' + (ok ? ' on' : ''); }
    var d = el.querySelector('.tape .ldot'), l = el.querySelector('.tape .lt'); if (d) d.className = 'ldot' + (ok ? ' on' : ''); if (l) l.textContent = ok ? 'live' : 'closes';
  }
  function apply(j) {
    var q = j.quotes || {}; Object.keys(q).forEach(function (k) { setTk(k, q[k]); });
    var t = (j.asof || '').slice(11, 16); stamp('quotes ' + t + ' CST from the base station, 15-min delay', true);
  }
  function tencentFallback() {
    var keys = Object.keys(TENCENT);
    return fetchT('https://qt.gtimg.cn/q=' + keys.map(function (k) { return TENCENT[k]; }).join(',') + '&r=' + Math.random(), 5000)
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var any = false;
        txt.split(';').forEach(function (line) {
          var m = line.match(/v_([A-Za-z0-9.]+)="([^"]*)"/); if (!m) return;
          var f = m[2].split('~'); if (f.length < 33 || !f[3]) return;
          var key = keys.filter(function (k) { return TENCENT[k] === m[1]; })[0]; if (!key) return;
          setTk(key, { price: +f[3], pct: +f[32], src: 'tencent', time: f[30] }); any = true;
        });
        stamp(any ? 'quotes direct, base station unreachable' : 'closes', any);
      }).catch(function () { stamp('closes', false); });
  }
  function live() {
    if (document.hidden) return;
    var list = good ? [good] : cands.slice(), i = 0;
    (function next() {
      if (i >= list.length) { good = null; return tencentFallback(); }
      var base = list[i++];
      fetchT(base + '/live/quotes.json?t=' + Date.now(), 4000).then(function (r) { return r.json(); })
        .then(function (j) { good = base; apply(j); })
        .catch(function () { if (good === base) good = null; next(); });
    })();
  }
  load(); live();
  setInterval(load, 600000); setInterval(live, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { load(); live(); } });
})();
