/* 首页「Indicators」块：页面里是构建时的预渲染；打开页面、回到页面和每 10 分钟各重拉一次 live/indicators.html 换掉
   （canyon_indicators.py 每小时整点导出并只推这个文件）。拉不到就保留现在的。 */
(function () {
  var el = document.getElementById('ind'); if (!el) return;
  function load() {
    if (document.hidden) return;
    fetch('live/indicators.html?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (t) {
        if (!t) return;
        var w = document.createElement('div'); w.innerHTML = t.trim();
        var n = w.firstElementChild;
        if (n && n.id === 'ind') { el.replaceWith(n); el = n; }
      })
      .catch(function () {});
  }
  load();
  setInterval(load, 600000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
})();
