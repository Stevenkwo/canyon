/* Whale One · Live Daily Target Book (mobile & desktop)
   1. Renders immediately from #wb-seed; re-fetches ../live/whale_book.json on open/focus and every 5 min
      (updated hourly by canyon_whale_book.py via run_risk_panel.sh).
   2. Fetches live US quotes from public feed (qt.gtimg.cn) every 60s to refresh Holding prices,
      live Mag7 + LLY TTM P/E ratios, live QQQ vs 200-day average, and FTNT -2% pre-market check. */
(function () {
  var card = document.getElementById('wb-card');
  if (!card) return;

  var seedEl = document.getElementById('wb-seed');
  var state = null;
  try { state = seedEl ? JSON.parse(seedEl.textContent) : null; } catch (e) {}

  var STORAGE_KEY = 'canyon_whale_mode';
  var curMode = 'dual_55_45';
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved === 'dual_55_45' || saved === 'dual_40_60' || saved === 'r1_live')) curMode = saved;
  } catch (e) {}

  var quotes = {};
  var TENCENT_MAP = {
    GOOGL: 'usGOOGL', NVDA: 'usNVDA', AAPL: 'usAAPL', MSFT: 'usMSFT',
    AMZN: 'usAMZN', META: 'usMETA', TSLA: 'usTSLA', LLY: 'usLLY',
    QQQ: 'usQQQ', FTNT: 'usFTNT', XOM: 'usXOM', USO: 'usUSO', TSM: 'usTSM'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function closePx(sym) {
    if (!state) return null;
    var ps = state.pe_scanner || [];
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].sym === sym) return ps[i].close;
    }
    var g = state.gates || {};
    if (sym === 'XOM') return g.xom_close;
    if (sym === 'QQQ') return g.qqq_close;
    if (sym === 'FTNT') return g.ftnt_prior_close;
    return null;
  }

  function fmtQuoteCell(sym) {
    if (sym === 'CASH / T-BILLS') return '—';
    var q = quotes[sym];
    if (q && q.price > 0) {
      var cls = q.pct > 0 ? 'up' : (q.pct < 0 ? 'dn' : '');
      var chg = typeof q.pct === 'number' ? ' <span class="' + cls + '">' + (q.pct > 0 ? '+' : '') + q.pct.toFixed(2) + '%</span>' : '';
      return '$' + q.price.toFixed(2) + chg;
    }
    var cp = closePx(sym);
    return cp ? '$' + Number(cp).toFixed(2) : '—';
  }

  function render() {
    if (!state || !state.modes) return;
    var m = state.modes[curMode] || state.modes.dual_55_45;
    var g = state.gates || {};

    // Tabs
    var btns = card.querySelectorAll('#wb-tabs button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.className = b.getAttribute('data-mode') === curMode ? 'on' : '';
    }

    // Gates
    var qLive = quotes.QQQ && quotes.QQQ.price > 0 ? quotes.QQQ.price : g.qqq_close;
    var qDiff = g.qqq_ma200 > 0 ? ((qLive / g.qqq_ma200 - 1) * 100) : g.qqq_pct_vs_ma200;
    var ftLive = quotes.FTNT && quotes.FTNT.price > 0 ? quotes.FTNT.price : null;
    var ftHit = ftLive && g.ftnt_armed && ftLive <= g.ftnt_trigger_px;
    var ftLine = ftLive
      ? ('FTNT now <b>$' + ftLive.toFixed(2) + '</b> vs ≤ $' + Number(g.ftnt_trigger_px).toFixed(2) + (ftHit ? ' <b>(IN ZONE)</b>' : ''))
      : ('FTNT ≤ <b>$' + Number(g.ftnt_trigger_px).toFixed(2) + '</b> at 09:28 ET (VIX ' + Number(g.vix_close).toFixed(2) + ')');

    var gatesEl = document.getElementById('wb-gates');
    if (gatesEl) {
      var mList = (state.monsters_active && state.monsters_active.length) ? state.monsters_active.join(', ') : 'None (T-bills)';
      gatesEl.innerHTML =
        '<div class="wb-g">Night gate (QQQ 200d): <b>' + (g.night_gate_on ? 'ON · Cash overnight' : 'OFF · Hold ' + esc(m.night_sym)) + '</b><br>QQQ <b>$' + Number(qLive).toFixed(2) + '</b> vs ' + Number(g.qqq_ma200).toFixed(2) + ' (' + (qDiff >= 0 ? '+' : '') + qDiff.toFixed(1) + '%)</div>' +
        '<div class="wb-g">Day gate (F-3 252d AAPL): <b>' + (g.f3_day_gate_on ? 'OPEN' : 'CLOSED') + '</b> (' + (g.f3_252d_pct >= 0 ? '+' : '') + Number(g.f3_252d_pct).toFixed(1) + '%)<br>' + ftLine + '</div>' +
        '<div class="wb-g">Left Slot 2 (PE &lt; 20 monster): <b>' + esc(mList) + '</b><br>Left Slot 1 anchor: <b>' + (m.left_pct > 0 ? 'GOOGL (' + (m.left_pct / 2).toFixed(1) + '%)' : 'None (100% auction)') + '</div>' +
        '<div class="wb-g">Energy sleeves: XOM <b>' + (g.xom_gate_on ? 'ON' : 'OFF') + '</b> · USO <b>' + (g.uso_gate_on ? 'ON (' + g.uso_session + '/21)' : 'OFF') + '</b><br>OVX close ' + Number(g.ovx_close).toFixed(2) + '</div>';
    }

    // Holdings rows
    var tb = document.getElementById('wb-tbody');
    if (tb) {
      var html = '';
      for (var rIdx = 0; rIdx < m.rows.length; rIdx++) {
        var r = m.rows[rIdx];
        html += '<tr>' +
          '<td><b>' + esc(r.sym) + '</b><div class="wb-role">' + esc(r.role) + '</div></td>' +
          '<td class="num wb-px">' + fmtQuoteCell(r.sym) + '</td>' +
          '<td class="num"><b>' + Number(r.day_pct).toFixed(1) + '%</b></td>' +
          '<td class="num"><b>' + Number(r.night_pct).toFixed(1) + '%</b></td>' +
          '</tr>';
      }
      tb.innerHTML = html;
    }

    // Actions
    var actEl = document.getElementById('wb-actions');
    if (actEl && m.actions) {
      var ah = '';
      for (var aIdx = 0; aIdx < m.actions.length; aIdx++) {
        ah += '<li>' + esc(m.actions[aIdx]) + '</li>';
      }
      actEl.innerHTML = ah;
    }

    // Mag7 + LLY live PE scanner
    var peEl = document.getElementById('wb-pes');
    if (peEl && state.pe_scanner) {
      var items = state.pe_scanner.map(function (p) {
        var px = (quotes[p.sym] && quotes[p.sym].price > 0) ? quotes[p.sym].price : p.close;
        var pe = (p.eps_ttm && p.eps_ttm > 0) ? (px / p.eps_ttm) : p.pe_ttm;
        return { sym: p.sym, pe: pe, hit: pe > 0 && pe < 20.0 };
      }).sort(function (a, b) { return (a.pe || 9999) - (b.pe || 9999); });

      peEl.innerHTML = items.map(function (it) {
        return '<span class="wb-pe' + (it.hit ? ' hit' : '') + '"><b>' + esc(it.sym) + '</b> ' + Number(it.pe).toFixed(1) + '</span>';
      }).join('');
    }
  }

  function setStatus(txt, liveOn) {
    var st = document.getElementById('wb-status');
    if (!st) return;
    st.className = 'wb-live' + (liveOn ? ' on' : '');
    st.innerHTML = '<span class="dot"></span>' + esc(txt);
  }

  function loadBookJson() {
    if (document.hidden) return;
    var src = card.getAttribute('data-src') || '../live/whale_book.json';
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

  var tabsWrap = document.getElementById('wb-tabs');
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
