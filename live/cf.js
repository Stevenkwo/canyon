/* cf.js — canyon home · Off-peak rank live card.
   Reads live/cf.json (context exported after each close by cf_live_context.py) plus public quotes
   (Tencent qt.gtimg.cn; Eastmoney push2 as fallback) and recomputes the last row(s) exactly as the
   engines do — official = trs_qdespread.series(), research = cf_now.research(). Node-testable:
   module.exports = {compute, official, research, parseTencent}. Only a close counts for the rules. */
(function (root) {
  'use strict';
  var CFL = {};

  // ---------- numerics (mirror numpy) ----------
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function mean(a) { return sum(a) / a.length; }
  function betaOfficial(bc, bq) {            // np.cov(bc,bq)[0,1] (ddof=1) / bq.var() (ddof=0)
    var n = bq.length, mq = mean(bq), mc = mean(bc), sxy = 0, sxx = 0;
    for (var i = 0; i < n; i++) { sxy += (bc[i] - mc) * (bq[i] - mq); sxx += (bq[i] - mq) * (bq[i] - mq); }
    var v = sxx / n;
    return v > 1e-12 ? (sxy / (n - 1)) / v : 0;
  }
  function slope(x, y) {                     // np.polyfit(x, y, 1)[0]
    var n = x.length, mx = mean(x), my = mean(y), sxy = 0, sxx = 0;
    for (var i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); }
    return sxx > 0 ? sxy / sxx : 0;
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  // ---------- official: trs_qdespread.series() on the tail ----------
  // coalRows [{d,hfq}] asc · qqqBars [{d,c}] asc · recompute rows with date >= from (ctx last row + appended)
  CFL.official = function (O, coalRows, qqqBars, from) {
    var W_RET = O.W_RET, W_BETA = O.W_BETA, W_PCT = O.W_PCT, paired = [], j = -1, k, m;
    for (k = 0; k < coalRows.length; k++) {
      var r = coalRows[k];
      while (j + 1 < qqqBars.length && qqqBars[j + 1].d <= r.d) j++;
      if (j < 0) continue;
      paired.push({ d: r.d, cp: r.hfq, qp: qqqBars[j].c, qd: qqqBars[j].d });
    }
    var rc = [], rq = [];
    for (k = 1; k < paired.length; k++) { rc.push(Math.log(paired[k].cp / paired[k - 1].cp)); rq.push(Math.log(paired[k].qp / paired[k - 1].qp)); }
    var dvD = O.dv.dates.slice(), dvV = O.dv.v.slice(), out = [];
    for (k = 1; k < paired.length; k++) {
      if (paired[k].d < from) continue;
      var i = k - 1;
      if (i < W_BETA || i < W_RET) continue;
      var b = betaOfficial(rc.slice(i - W_BETA, i), rq.slice(i - W_BETA, i));
      var dv = sum(rc.slice(i - W_RET + 1, i + 1)) - b * sum(rq.slice(i - W_RET + 1, i + 1));
      var pos = dvD.indexOf(paired[k].d);
      if (pos >= 0) dvV[pos] = dv; else { dvD.push(paired[k].d); dvV.push(dv); pos = dvD.length - 1; }
      var lo = Math.max(0, pos - W_PCT + 1), cnt = 0, len = 0;
      for (m = lo; m <= pos; m++) { if (dvV[m] == null || isNaN(dvV[m])) continue; len++; if (dvV[m] <= dv) cnt++; }
      out.push({ d: paired[k].d, pct: round1(100 * cnt / len), d42: dv * 100, qd: paired[k].qd, beta: b, window: len });
    }
    return out;
  };

  // ---------- research: cf_now.research() on the tail ----------
  CFL.research = function (R, newRows, qqqBars) {
    var L = R.L, B = R.B, W = R.W, D = R.rows.dates.slice(), C = R.rows.c.slice(), Q = R.rows.q.slice(), k, m;
    for (k = 0; k < newRows.length; k++) {
      var q = null;
      for (m = qqqBars.length - 1; m >= 0; m--) if (qqqBars[m].d < newRows[k].d) { q = qqqBars[m].c; break; }
      if (q == null) return [];
      D.push(newRows[k].d); C.push(newRows[k].c); Q.push(q);
    }
    var n = D.length, rc = [null], rq = [null];
    for (k = 1; k < n; k++) { rc.push(C[k] / C[k - 1] - 1); rq.push(Q[k] / Q[k - 1] - 1); }
    var spD = R.spread.dates.slice(), spV = R.spread.v.slice(), out = [];
    for (k = n - 1 - newRows.length; k < n; k++) {
      if (k - B + 1 < 1 || k - L < 0) continue;
      var b = slope(rq.slice(k - B + 1, k + 1), rc.slice(k - B + 1, k + 1));
      var rcL = C[k] / C[k - L] - 1, rqL = Q[k] / Q[k - L] - 1, sp = rcL - b * rqL;
      var pos = spD.indexOf(D[k]);
      if (pos >= 0) spV[pos] = sp; else { spD.push(D[k]); spV.push(sp); pos = spD.length - 1; }
      if (pos - W + 1 < 0) continue;
      var cnt = 0;
      for (m = pos - W + 1; m < pos; m++) if (spV[m] < sp) cnt++;
      out.push({ d: D[k], pct: round1(100 * cnt / W), coal42: rcL * 100, qqq42: rqL * 100, beta: b });
    }
    return out;
  };

  // ---------- quotes ----------
  CFL.parseTencent = function (txt) {
    var out = {}, re = /v_(\w+)="([^"]*)"/g, m;
    while ((m = re.exec(txt))) {
      var f = m[2].split('~');
      if (f.length < 33) continue;
      var code = m[1], us = code.indexOf('us') === 0, t = f[30] || '', date, time;
      if (us) { date = t.slice(0, 10); time = t.slice(11, 19); }
      else { date = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8); time = t.slice(8, 10) + ':' + t.slice(10, 12) + ':' + t.slice(12, 14); }
      out[code] = { price: +f[3], prev: +f[4], chg: +f[31], pct: +f[32], date: date, time: time, src: 'Tencent' };
    }
    return out;
  };
  function partsIn(tz, date) {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    var p = {}; f.formatToParts(date || new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, time: (p.hour === '24' ? '00' : p.hour) + ':' + p.minute + ':' + p.second, wd: p.weekday };
  }
  CFL.partsIn = partsIn;
  function emQuote(secid, tz) {
    var url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + secid + '&fields=f43,f59,f60,f86,f170&_=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var d = j.data, s = Math.pow(10, d.f59 == null ? 2 : d.f59), p = partsIn(tz, new Date(d.f86 * 1000));
      return { price: d.f43 / s, prev: d.f60 / s, pct: d.f170 / 100, chg: (d.f43 - d.f60) / s, date: p.date, time: p.time, src: 'Eastmoney' };
    });
  }
  function fetchQuotes(ctx) {
    var sy = ctx.symbols;
    return fetch('https://qt.gtimg.cn/q=' + sy.coal.tencent + ',' + sy.qqq.tencent + '&r=' + Math.random(), { cache: 'no-store' })
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) {
        var txt; try { txt = new TextDecoder('gbk').decode(buf); } catch (e) { txt = new TextDecoder().decode(buf); }
        var q = CFL.parseTencent(txt), c = q[sy.coal.tencent], u = q[sy.qqq.tencent];
        if (!c || !u || !(c.price > 0) || !(u.price > 0)) throw new Error('tencent');
        return { coal: c, qqq: u };
      })
      .catch(function () {
        return Promise.all([emQuote(sy.coal.em, 'Asia/Shanghai'), emQuote(sy.qqq.em, 'America/New_York')]).then(function (a) { return { coal: a[0], qqq: a[1] }; });
      });
  }

  // ---------- regimes ----------
  CFL.compute = function (ctx, coalQ, qqqQ, now) {
    now = now || { cn: partsIn('Asia/Shanghai'), et: partsIn('America/New_York') };
    var O = ctx.official, R = ctx.research;
    var ctxCoalLast = O.coal.dates[O.coal.dates.length - 1], ctxQqqLast = O.qqq.dates[O.qqq.dates.length - 1];
    var qqqBars = O.qqq.dates.map(function (d, i) { return { d: d, c: O.qqq.close[i] }; });
    var usLive = false, qqqNote = null;
    if (qqqQ && qqqQ.date && qqqQ.price > 0) {
      var weekday = now.et.wd !== 'Sat' && now.et.wd !== 'Sun';
      usLive = weekday && qqqQ.date === now.et.date && now.et.time >= '09:30:00' && now.et.time < '16:00:00';
      var lastB = qqqBars[qqqBars.length - 1];
      if (qqqQ.date > ctxQqqLast) { qqqBars.push({ d: qqqQ.date, c: qqqQ.price, live: usLive }); qqqNote = usLive ? 'live' : 'close added'; }
      else if (qqqQ.date === ctxQqqLast && !usLive && Math.abs(qqqQ.price / lastB.c - 1) > 5e-4) { lastB.c = qqqQ.price; qqqNote = 'close fixed'; }
    }
    var coalRows = O.coal.dates.map(function (d, i) { return { d: d, hfq: O.coal.hfq[i] }; });
    var newCoal = null, intraday = false;
    if (coalQ && coalQ.date && coalQ.date > ctxCoalLast && coalQ.price > 0) {
      intraday = coalQ.time < '15:00:00';
      var ref = coalQ.prev > 0 ? coalQ.prev : O.coal.unadj_last;      // ex-dividend day: reference price = prior close − dividend
      coalRows.push({ d: coalQ.date, hfq: coalQ.price + O.coal.hfq_last - ref });   // moomoo HFQ = unadjusted + cumulative cash dividends (additive; checked 2026-11-02)
      newCoal = { d: coalQ.date, c: R.rows.c[R.rows.c.length - 1] * coalQ.price / R.unadj_last, intraday: intraday };
    }
    var offRows = CFL.official(O, coalRows, qqqBars, ctxCoalLast), resRows = CFL.research(R, newCoal ? [newCoal] : [], qqqBars);
    var offBy = {}, resBy = {};
    offRows.forEach(function (x) { offBy[x.d] = x; }); resRows.forEach(function (x) { resBy[x.d] = x; });
    var closeOff = offBy[ctxCoalLast] || { d: ctxCoalLast, pct: O.close.pct, qd: O.close.qqq_date, d42: O.close.d42 };
    var closeRes = resBy[ctxCoalLast] || { d: ctxCoalLast, pct: R.close.pct };
    var lastBar = qqqBars[qqqBars.length - 1];
    var usDone = now.et.date > ctxCoalLast || (now.et.date === ctxCoalLast && now.et.time >= '16:00:00');
    var pending = (lastBar.live && closeOff.qd === lastBar.d) || (closeOff.qd < ctxCoalLast && !usDone);
    var regime = newCoal ? (intraday ? 'intraday' : 'closed-new') : (usLive ? 'us-live' : 'closed');
    return {
      regime: regime, usLive: usLive, qqqNote: qqqNote, coalQ: coalQ, qqqQ: qqqQ, now: now,
      close: { date: ctxCoalLast, official: closeOff, research: closeRes, officialPending: pending },
      live: newCoal ? { date: newCoal.d, official: offBy[newCoal.d], research: resBy[newCoal.d], intraday: intraday } : null
    };
  };

  // ---------- rendering ----------
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fd(s) { return s ? MON[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)) : ''; }
  function f1(x) { return x == null || isNaN(x) ? '—' : x.toFixed(1); }
  function f2(x) { return x == null || isNaN(x) ? '—' : x.toFixed(2); }
  function sg(x) { return x == null || isNaN(x) ? '' : (x > 0 ? '+' : (x < 0 ? '−' : '')) + Math.abs(x).toFixed(2) + '%'; }
  function hm(t) { return (t || '').slice(0, 5); }
  function $(el, id) { return el.querySelector('#' + id); }
  function txt(el, id, s) { var n = $(el, id); if (n) n.textContent = s; }
  function zoneText(p, rules) {
    if (p >= rules.band_hi) return 'Band rule: coal target 90% of anchor';
    if (p <= rules.band_lo) return 'Band rule: coal target 110% of anchor';
    return 'Neutral band: nothing fires';
  }
  function spark(svg, ledger, livePt) {
    var W = 640, H = 64, pad = 6, n = ledger.length + (livePt ? 1 : 0), x = function (i) { return pad + (W - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1)); };
    var y = function (p) { return H - 4 - (H - 10) * (p / 100); };
    var s = '';
    [[90, 0.35], [85, 0.8], [50, 0.5], [10, 0.35]].forEach(function (g) { s += '<line x1="0" x2="' + W + '" y1="' + y(g[0]).toFixed(1) + '" y2="' + y(g[0]).toFixed(1) + '" style="stroke:var(--rule);stroke-width:1' + (g[0] === 85 ? ';stroke-dasharray:4 3;stroke:var(--ink-2);opacity:' + g[1] : ';opacity:' + g[1]) + '"/>'; });
    var pts = ledger.map(function (r, i) { return x(i).toFixed(1) + ',' + y(r[1]).toFixed(1); });
    s += '<polyline points="' + pts.join(' ') + '" style="fill:none;stroke:var(--ink);stroke-width:1.6;stroke-linejoin:round"/>';
    var li = ledger.length - 1;
    s += '<circle cx="' + x(li).toFixed(1) + '" cy="' + y(ledger[li][1]).toFixed(1) + '" r="3" style="fill:var(--ink)"/>';
    if (livePt) {
      s += '<line x1="' + x(li).toFixed(1) + '" y1="' + y(ledger[li][1]).toFixed(1) + '" x2="' + x(li + 1).toFixed(1) + '" y2="' + y(livePt).toFixed(1) + '" style="stroke:var(--accent);stroke-width:1.4;stroke-dasharray:3 3"/>';
      s += '<circle cx="' + x(li + 1).toFixed(1) + '" cy="' + y(livePt).toFixed(1) + '" r="3.6" style="fill:var(--surface);stroke:var(--accent);stroke-width:1.8"/>';
    }
    svg.innerHTML = s;
  }
  function nextSession(now) {               // what moves the reading next, in Beijing time
    var off = ((+now.cn.time.slice(0, 2) - +now.et.time.slice(0, 2)) + 24) % 24;      // CST ahead of ET: 13 in winter, 12 in summer
    var h = ('0' + ((9 + off) % 24)).slice(-2), usOpenT = h + ':30:00', t = now.cn.time, wd = now.cn.wd, wk = wd !== 'Sat' && wd !== 'Sun';
    if (wk && t < '09:30:00') return 'A-share session 09:30 CST';
    if (wk && t >= '15:00:00' && t < usOpenT) return 'US session ' + h + ':30 CST (QQQ reprices the official close)';
    if (wd === 'Fri' || !wk) return 'Monday 09:30 CST';
    return 'A-share session 09:30 CST';
  }
  CFL.render = function (el, ctx, res, err) {
    var O = ctx.official, R = ctx.research, rules = ctx.rules, c = res.close, L = res.live;
    txt(el, 'cf-close-date', 'Close · ' + fd(c.date));
    txt(el, 'cf-close-off', f1(c.official.pct));
    var cs = $(el, 'cf-close-sub'); if (cs) cs.innerHTML = 'official' + (c.officialPending ? ', pending the US close' : '') + ' · research <b id="cf-close-res">' + f1(c.research.pct) + '</b>';
    txt(el, 'cf-zone', zoneText(c.official.pct, rules));
    var status = $(el, 'cf-status'), dot = status ? status.querySelector('.dot') : null, label = '';
    var big = $(el, 'cf-now-off');
    if (L) {
      txt(el, 'cf-now-lab', L.intraday ? 'Now · intraday · ' + fd(L.date) : 'Now · ' + fd(L.date) + ' close' + (res.regime === 'closed-new' && res.usLive ? ' · QQQ live' : ''));
      txt(el, 'cf-now-off', L.official ? f1(L.official.pct) : '—');
      txt(el, 'cf-now-sub', 'official · research ' + (L.research ? f1(L.research.pct) : '—') + (L.intraday ? ' · not a close' : (c.officialPending ? '' : ' · official pending the US close')));
      label = L.intraday ? 'Live · intraday' : (res.usLive ? 'Live · US session' : 'After the close');
    } else if (res.regime === 'us-live') {
      txt(el, 'cf-now-lab', 'Now · US session live · ' + fd(c.date) + ' official repriced');
      txt(el, 'cf-now-off', f1(c.official.pct));
      txt(el, 'cf-now-sub', 'official with QQQ live · research ' + f1(c.research.pct) + ' final');
      label = 'Live · US session';
    } else {
      txt(el, 'cf-now-lab', 'Now · no session open');
      txt(el, 'cf-now-off', f1(c.official.pct));
      txt(el, 'cf-now-sub', 'same as the close · next: ' + nextSession(res.now));
      label = 'Closed';
    }
    if (big) big.className = 'big' + ((L && L.intraday) || res.regime === 'us-live' ? ' pending' : '');
    if (status) { status.innerHTML = '<span class="dot' + (label.indexOf('Live') === 0 ? ' live' : '') + '"></span>' + label; }
    var q = res.coalQ, u = res.qqqQ, qs = [];
    if (q) qs.push('Shaanxi Coal ' + f2(q.price) + ' ' + sg(q.pct) + ' · ' + hm(q.time) + ' CST');
    if (u) qs.push('QQQ ' + f2(u.price) + ' ' + sg(u.pct) + ' · ' + (res.usLive ? hm(u.time) + ' ET live' : fd(u.date) + ' close'));
    txt(el, 'cf-quotes', err ? 'Live quotes unavailable right now' : qs.join('  ·  ') + (q && q.src ? '  ·  ' + q.src : ''));
    txt(el, 'cf-updated', 'checked ' + hm(res.now.cn.time) + ' CST · context ' + (ctx.generated || '').slice(5, 16));
    var sv = $(el, 'cf-spark'); if (sv) spark(sv, O.ledger, L && L.official ? L.official.pct : null);
  };

  CFL.boot = function (el) {
    var src = el.getAttribute('data-src') || 'live/cf.json', ctx = null, timer = null;
    function tick() {
      fetchQuotes(ctx).then(function (q) { CFL.render(el, ctx, CFL.compute(ctx, q.coal, q.qqq)); schedule(30000); })
        .catch(function (e) { CFL.render(el, ctx, CFL.compute(ctx, null, null), e); schedule(120000); });
    }
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(function () { if (document.visibilityState === 'visible') tick(); else schedule(30000); }, ms); }
    fetch(src + '?v=' + Math.floor(Date.now() / 600000), { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('cf.json ' + r.status); return r.json(); })
      .then(function (j) { ctx = j; tick(); })
      .catch(function () { var s = $(el, 'cf-status'); if (s) s.innerHTML = '<span class="dot"></span>Live data unavailable'; });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && ctx) tick(); });
  };

  if (typeof document !== 'undefined') {
    var go = function () { var el = document.getElementById('cf-card'); if (el) CFL.boot(el); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = CFL;
  root.CFL = CFL;
})(typeof window !== 'undefined' ? window : globalThis);
