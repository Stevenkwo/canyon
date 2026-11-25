/* GLA · Daily Position Reminder & Live Target Book (homepage bottom & strategy page)
   1. Renders immediately from #gla-seed; re-fetches data-src (live/gla_book.json or ../live/gla_book.json)
      on open/focus and every 5 minutes (updated hourly by canyon_gla.py via run_risk_panel.sh).
   2. Polls live US quotes from qt.gtimg.cn every 60s to refresh stock prices, live QQQ vs 200-day line,
      and live FTNT <= -2% pre-market trigger status. */
(function () {
  var card = document.getElementById('gla-card');
  if (!card) return;

  var seedEl = document.getElementById('gla-seed');
  var state = null;
  try { state = seedEl ? JSON.parse(seedEl.textContent) : null; } catch (e) {}

  var STORAGE_KEY = 'canyon_gla_mode';
  var curMode = 'b3_ftnt';
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved === 'b3_ftnt' || saved === 'a5_ftnt' || saved === 'a6_ftnt')) curMode = saved;
  } catch (e) {}

  var quotes = {};
  var TENCENT_MAP = {
    LLY: 'usLLY', GOOGL: 'usGOOGL', AAPL: 'usAAPL',
    SGOV: 'usSGOV', FTNT: 'usFTNT', QQQ: 'usQQQ'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function closePx(sym) {
    if (!state || !state.quotes_close) return null;
    return state.quotes_close[sym] != null ? state.quotes_close[sym] : null;
  }

  function fmtQuoteCell(sym) {
    var q = quotes[sym];
    if (q && q.price > 0) {
      var cls = q.pct > 0 ? 'up' : (q.pct < 0 ? 'dn' : '');
      var chg = typeof q.pct === 'number' ? ' <span class="' + cls + '">' + (q.pct > 0 ? '+' : '') + q.pct.toFixed(2) + '%</span>' : '';
      return '$' + q.price.toFixed(2) + chg;
    }
    var cp = closePx(sym);
    return cp != null ? '$' + Number(cp).toFixed(2) : '—';
  }

  function render() {
    if (!state || !state.modes) return;
    var m = state.modes[curMode] || state.modes.b3_ftnt;
    var g = state.gates || {};

    var btns = card.querySelectorAll('#gla-tabs button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.className = b.getAttribute('data-mode') === curMode ? 'on' : '';
    }

    var qLive = (quotes.QQQ && quotes.QQQ.price > 0) ? quotes.QQQ.price : g.qqq_close;
    var qDiff = g.qqq_ma200 > 0 ? ((qLive / g.qqq_ma200 - 1) * 100) : g.qqq_pct_vs_ma200;
    var lLive = (quotes.LLY && quotes.LLY.price > 0) ? quotes.LLY.price : g.lly_close;
    var lDiff = g.lly_ma200 > 0 ? ((lLive / g.lly_ma200 - 1) * 100) : g.lly_pct_vs_ma200;
    var ftLive = (quotes.FTNT && quotes.FTNT.price > 0) ? quotes.FTNT.price : null;
    var ftHit = ftLive && g.ftnt_armed && ftLive <= g.ftnt_trigger_px;
    var ftSub = ftLive
      ? ('FTNT now <b>$' + ftLive.toFixed(2) + '</b> vs &lt;= $' + Number(g.ftnt_trigger_px).toFixed(2) + (ftHit ? ' <b>(IN ZONE)</b>' : '') + ' · VIX ' + Number(g.vix_close).toFixed(2))
      : ('Prior close $' + Number(g.ftnt_prior_close).toFixed(2) + ' · VIX ' + Number(g.vix_close).toFixed(2));

    var llyActiveInMode = (curMode === 'a5_ftnt') ? true : Boolean(g.lly_monthly_on);
    var llyTitle = (curMode === 'a5_ftnt')
      ? 'ON · Held across regimes (A5)'
      : (g.lly_monthly_on ? 'ON · Hold LLY' : 'OFF · Park in SGOV');

    var gatesEl = document.getElementById('gla-gates');
    if (gatesEl) {
      gatesEl.innerHTML =
        '<div class="gla-g">Tech gate (QQQ 200d): <b>' + (g.tech_gate_on ? 'ON · Hold tech legs' : 'OFF · Park in SGOV') + '</b><br>QQQ <b>$' + Number(qLive).toFixed(2) + '</b> vs ' + Number(g.qqq_ma200).toFixed(2) + ' (' + (qDiff >= 0 ? '+' : '') + qDiff.toFixed(1) + '%)</div>' +
        '<div class="gla-g">Pharma anchor (LLY): <b>' + llyTitle + '</b><br>LLY <b>$' + Number(lLive).toFixed(2) + '</b> vs ' + Number(g.lly_ma200).toFixed(2) + ' (' + (lDiff >= 0 ? '+' : '') + lDiff.toFixed(1) + '%)</div>' +
        '<div class="gla-g">Daytime AAPL (F-3 252d): <b>' + (curMode === 'b3_ftnt' ? (g.f3_day_open ? 'OPEN · MOO → MOC' : 'PAUSED') : 'Spot sleeve (see QQQ 200d)') + '</b> (' + (g.f3_252d_pct >= 0 ? '+' : '') + Number(g.f3_252d_pct).toFixed(1) + '%)<br>SGOV 0–3M T-bill yield ~<b>' + Number(g.irx_yield_pct).toFixed(2) + '%</b> (no TLT)</div>' +
        '<div class="gla-g">FTNT 09:28 ET check: <b>' + (g.ftnt_armed ? 'ARMED · &lt;= $' + Number(g.ftnt_trigger_px).toFixed(2) : 'DISARMED') + '</b><br>' + ftSub + '</div>';
    }

    var tb = document.getElementById('gla-tbody');
    if (tb && m.rows) {
      var html = '';
      for (var rIdx = 0; rIdx < m.rows.length; rIdx++) {
        var r = m.rows[rIdx];
        var dayCell = r.cond_day
          ? ('<span style="color:var(--ink-2)">0.0%</span> <span style="font-size:11px;color:var(--fw)">(' + esc(r.cond_day) + ')</span>')
          : ('<b>' + Number(r.day_pct).toFixed(1) + '%</b>');
        html += '<tr>' +
          '<td><b>' + esc(r.sym) + '</b><div class="gla-role">' + esc(r.role) + '</div></td>' +
          '<td class="num gla-px">' + fmtQuoteCell(r.sym) + '</td>' +
          '<td class="num">' + dayCell + '</td>' +
          '<td class="num"><b>' + Number(r.night_pct).toFixed(1) + '%</b></td>' +
          '</tr>';
      }
      tb.innerHTML = html;
    }

    var actEl = document.getElementById('gla-actions');
    if (actEl && m.actions) {
      actEl.innerHTML = m.actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
    }
  }

  function setStatus(txt, liveOn) {
    var st = document.getElementById('gla-status');
    if (!st) return;
    st.className = 'gla-live' + (liveOn ? ' on' : '');
    st.innerHTML = '<span class="dot"></span>' + esc(txt);
  }

  function loadBookJson() {
    if (document.hidden) return;
    var src = card.getAttribute('data-src') || 'live/gla_book.json';
    fetch(src + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.modes) {
          state = j;
          render();
        }
      })
      .catch(function () {});
  }

  function loadQuotes() {
    if (document.hidden) return;
    var syms = Object.keys(TENCENT_MAP);
    var qstr = syms.map(function (k) { return TENCENT_MAP[k]; }).join(',');
    fetch('https://qt.gtimg.cn/q=' + qstr + '&r=' + Math.random(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) {
        var got = false;
        txt.split(';').forEach(function (line) {
          var m = line.match(/v_([A-Za-z0-9.]+)="([^"]*)"/);
          if (!m) return;
          var f = m[2].split('~');
          if (f.length < 33 || !f[3]) return;
          var code = m[1];
          for (var i = 0; i < syms.length; i++) {
            if (TENCENT_MAP[syms[i]] === code && +f[3] > 0) {
              quotes[syms[i]] = { price: +f[3], pct: +f[32] };
              got = true;
            }
          }
        });
        if (got) {
          render();
          var hm = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
          setStatus('Rules: ' + (state ? state.asof : '') + ' close · Quotes ' + hm + ' CST', true);
        }
      })
      .catch(function () {});
  }

  var tabsWrap = document.getElementById('gla-tabs');
  if (tabsWrap) {
    tabsWrap.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-mode]');
      if (!btn) return;
      curMode = btn.getAttribute('data-mode');
      try { localStorage.setItem(STORAGE_KEY, curMode); } catch (e) {}
      render();
    });
  }

  render();
  loadBookJson();
  loadQuotes();
  setInterval(loadBookJson, 300000);
  setInterval(loadQuotes, 60000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { loadBookJson(); loadQuotes(); }
  });
})();
