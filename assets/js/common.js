// assets/js/common.js
// Utilitarios compartilhados por todas as paginas do painel (charts, tabela filtravel,
// navegacao/menu, botao "Atualizar" e helpers de URL para conectar graficos entre paineis).
(function () {
  "use strict";

  var COLORS = {
    valeGreen: "#007E7A",
    valeBlue: "#3CB5E5",
    darkGreen: "#034944",
    darkBlue: "#2626D1",
    mediumGray: "#BCBEC0",
    lightGray: "#E6E7E8",
    valeGray: "#747678"
  };

  var FAROL_COLORS = {
    "No prazo": "#3CB5E5",
    "Atenção": "#F2A900",
    "Atrasado": "#D93025",
    "Concluído": "#2E9E4B",
    "In hold": "#9AA0A6"
  };

  var DATA_SCRIPT_PATHS = {
    mas: "assets/js/data/mas.data.js",
    cronograma: "assets/js/data/cronograma.data.js",
    escopo: "assets/js/data/escopo.data.js",
    escopoArvore: "assets/js/data/escopoArvore.data.js",
    engenharia: "assets/js/data/engenharia.data.js",
    curvaSFisica: "assets/js/data/curvaSFisica.data.js",
    curvaEco: "assets/js/data/curvaEco.data.js",
    pgu: "assets/js/data/pgu.data.js"
  };

  // ---------------------------------------------------------------- helpers

  function $(id) { return document.getElementById(id); }

  function esc(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var p = String(iso).split("-");
    if (p.length !== 3) return iso;
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  function fmtMonthLabel(ym) {
    var meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    var p = ym.split("-");
    var idx = parseInt(p[1], 10) - 1;
    return meses[idx] + "/" + p[0].slice(2);
  }

  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return Number(n).toLocaleString("pt-BR");
  }

  function daysBetween(a, b) {
    if (!a || !b) return null;
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function farolBadgeClass(farol) {
    switch (farol) {
      case "Atrasado": return "farol-atrasado";
      case "Atenção": return "farol-atencao";
      case "Concluído": return "farol-concluido";
      case "No prazo": return "farol-noprazo";
      case "In hold": return "farol-inhold";
      default: return "farol-outro";
    }
  }

  function badge(text, cls) {
    return '<span class="badge ' + cls + '">' + esc(text) + "</span>";
  }

  function countBy(rows, key) {
    var map = {};
    (rows || []).forEach(function (r) {
      var k = r[key];
      if (k === null || k === undefined || k === "") return;
      map[k] = (map[k] || 0) + 1;
    });
    return Object.keys(map).map(function (k) {
      return { label: k, value: map[k] };
    }).sort(function (a, b) { return b.value - a.value; });
  }

  // ---------------------------------------------------------------- nav badges, alert band, tabs

  function setNavBadge(navKey, text, cls) {
    var el = document.querySelector('.nav-item[data-nav="' + navKey + '"]');
    if (!el) return;
    var badgeEl = el.querySelector(".nav-item__count");
    if (!badgeEl) {
      badgeEl = document.createElement("span");
      el.appendChild(badgeEl);
    }
    badgeEl.className = "nav-item__count" + (cls ? " " + cls : "");
    badgeEl.textContent = text;
  }

  // items: [{count, label, hint, href, tone: 'bad'|'warn'|'info'}]
  function alertBand(items) {
    items = (items || []).filter(function (it) { return it && it.count; });
    if (!items.length) return "";
    var pills = items.map(function (it) {
      var cls = "alert-pill" + (it.tone ? " alert-pill--" + it.tone : "");
      var body = '<span class="alert-pill__count">' + esc(it.count) + "</span>" +
        '<span class="alert-pill__text"><span class="alert-pill__label">' + esc(it.label) + '</span><span class="alert-pill__hint">' + esc(it.hint || "") + "</span></span>";
      return it.href ? '<a class="' + cls + '" href="' + it.href + '">' + body + "</a>" : '<div class="' + cls + '">' + body + "</div>";
    }).join("");
    return '<div class="alert-band"><div class="alert-band__intro"><span class="alert-band__icon">🔔</span><div>' +
      '<div class="alert-band__title">Ações necessárias</div><div class="alert-band__subtitle">Clique para abrir a lista já filtrada</div></div></div>' +
      '<div class="alert-band__pills">' + pills + "</div></div>";
  }

  function sectionLabel(text) {
    return '<div class="section-label">' + esc(text) + "</div>";
  }

  function distinctValues(rows, key) {
    var seen = {};
    var out = [];
    (rows || []).forEach(function (r) {
      var v = r[key];
      if (v === null || v === undefined || v === "" || seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    out.sort();
    return out.map(function (v) { return { value: v, label: v }; });
  }

  // fields: [{key, label, value (selected), options: [{value,label}]}]
  function filterToolbar(fields) {
    var fieldsHtml = fields.map(function (f) {
      var opts = '<option value="">Todos</option>' + f.options.map(function (o) {
        var isSel = f.value !== undefined && f.value !== null && String(f.value) === String(o.value);
        return '<option value="' + esc(o.value) + '"' + (isSel ? " selected" : "") + '>' + esc(o.label) + "</option>";
      }).join("");
      return '<div class="filter-toolbar__field"><label class="filter-toolbar__label">' + esc(f.label) + '</label>' +
        '<select class="filter-toolbar__select" data-filter-key="' + esc(f.key) + '">' + opts + "</select></div>";
    }).join("");
    return '<div class="filter-toolbar">' + fieldsHtml +
      '<button type="button" class="filter-toolbar__clear" data-clear-filters>✕ Limpar filtros</button></div>';
  }

  function wireFilterToolbar(containerId, table, onChange) {
    var container = $(containerId);
    if (!container) return;
    container.querySelectorAll("select[data-filter-key]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        table.setExactValue(sel.getAttribute("data-filter-key"), sel.value || null);
        if (onChange) onChange(sel.getAttribute("data-filter-key"), sel.value || null);
      });
    });
    var clearBtn = container.querySelector("[data-clear-filters]");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () { table.clearAll(); });
    }
  }

  function syncFilterToolbar(containerId, state) {
    var container = $(containerId);
    if (!container) return;
    container.querySelectorAll("select[data-filter-key]").forEach(function (sel) {
      var key = sel.getAttribute("data-filter-key");
      var v = state.exact[key];
      sel.value = v ? v : "";
    });
  }

  function wireTabs(containerId, onChange) {
    var container = $(containerId);
    if (!container) return;
    var tabs = container.querySelectorAll(".tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var key = tab.getAttribute("data-tab");
        tabs.forEach(function (t) { t.classList.toggle("active", t === tab); });
        container.querySelectorAll(".tab-panel").forEach(function (p) {
          p.classList.toggle("active", p.getAttribute("data-tab-panel") === key);
        });
        if (onChange) onChange(key);
      });
    });
  }

  // ---------------------------------------------------------------- URL / query helpers

  function qs(name) {
    var params = new URLSearchParams(window.location.search);
    var v = params.get(name);
    return v === null ? null : v;
  }

  function setQuery(paramsObj) {
    var params = new URLSearchParams(window.location.search);
    Object.keys(paramsObj).forEach(function (k) {
      var v = paramsObj[k];
      if (v === null || v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    });
    var newUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
    window.history.replaceState(null, "", newUrl);
  }

  // ------------------------------------------------------------ event delegation

  function onDelegated(container, selector, handler) {
    if (!container) return;
    container.addEventListener("click", function (e) {
      var el = e.target.closest(selector);
      if (el && container.contains(el)) handler(el, e);
    });
  }

  // ------------------------------------------------------------ mini charts

  function donutChart(items, size, opts) {
    opts = opts || {};
    size = size || 170;
    var total = items.reduce(function (s, it) { return s + it.value; }, 0) || 1;
    var r = size / 2;
    var stroke = size * 0.26;
    var radius = r - stroke / 2;
    var circumference = 2 * Math.PI * radius;
    var offset = 0;
    var circles = "";

    items.forEach(function (it) {
      var frac = it.value / total;
      var len = frac * circumference;
      var key = opts.getKey ? opts.getKey(it) : it.label;
      var isActive = opts.activeKey !== undefined && opts.activeKey !== null && String(opts.activeKey) === String(key);
      var dimmed = opts.activeKey !== undefined && opts.activeKey !== null && !isActive;
      var cls = "donut-arc" + (opts.clickable ? " donut-arc--clickable" : "") +
        (dimmed ? " donut-arc--dimmed" : "") + (isActive ? " donut-arc--active" : "");
      circles += '<circle class="' + cls + '" data-key="' + esc(key) + '" cx="' + r + '" cy="' + r + '" r="' + radius +
        '" fill="none" stroke="' + it.color + '" stroke-width="' + stroke +
        '" stroke-dasharray="' + len + " " + (circumference - len) +
        '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 ' + r + " " + r + ')">' +
        "<title>" + esc(it.label) + ": " + fmtNum(it.value) + "</title></circle>";
      offset += len;
    });

    return '<svg class="donut-chart" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '">' +
      circles +
      '<text x="' + r + '" y="' + (r - 4) + '" text-anchor="middle" font-size="22" font-weight="700" fill="#555555">' + total + "</text>" +
      '<text x="' + r + '" y="' + (r + 16) + '" text-anchor="middle" font-size="11" fill="#747678">' + esc(opts.centerLabel || "itens") + "</text>" +
      "</svg>";
  }

  function lineChart(values, labels, opts) {
    opts = opts || {};
    var w = opts.width || 640, h = opts.height || 180, pad = 28;
    var max = Math.max.apply(null, values.concat([1]));
    var stepX = (w - pad * 2) / Math.max(values.length - 1, 1);
    var pts = values.map(function (v, i) {
      var x = pad + i * stepX;
      var y = h - pad - (v / max) * (h - pad * 2);
      return { x: x, y: y, label: labels[i], value: v };
    });

    var pathPts = pts.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); });
    var area = "M" + pad + "," + (h - pad) + " L" + pathPts.join(" L") + " L" + (pad + (values.length - 1) * stepX) + "," + (h - pad) + " Z";
    var line = "M" + pathPts.join(" L");

    var labelEvery = Math.ceil(values.length / 12);
    var labelsSvg = "";
    var dotsSvg = "";
    labels.forEach(function (lb, i) {
      var p = pts[i];
      dotsSvg += '<circle class="line-chart__dot" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.2" fill="' + (opts.stroke || COLORS.valeGreen) + '">' +
        "<title>" + esc(lb) + ": " + fmtNum(p.value) + "</title></circle>";
      if (i % labelEvery !== 0 && i !== labels.length - 1) return;
      labelsSvg += '<text x="' + p.x + '" y="' + (h - 6) + '" font-size="9" text-anchor="middle" fill="#747678">' + esc(lb) + "</text>";
    });

    return '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" style="overflow:visible">' +
      '<path d="' + area + '" fill="' + (opts.fill || "rgba(0,126,122,0.12)") + '" stroke="none"></path>' +
      '<path d="' + line + '" fill="none" stroke="' + (opts.stroke || COLORS.valeGreen) + '" stroke-width="2"></path>' +
      dotsSvg +
      labelsSvg +
      "</svg>";
  }

  // series: [{ name, values, color, dashed }]. Todas as series compartilham o mesmo eixo X (labels).
  function multiLineChart(series, labels, opts) {
    opts = opts || {};
    var w = opts.width || 640, h = opts.height || 220, pad = 30;
    var allValues = [];
    series.forEach(function (s) { allValues = allValues.concat(s.values); });
    var max = Math.max.apply(null, allValues.concat([1]));
    var n = labels.length;
    var stepX = (w - pad * 2) / Math.max(n - 1, 1);

    function toPoints(values) {
      return values.map(function (v, i) {
        var x = pad + i * stepX;
        var y = h - pad - (v / max) * (h - pad * 2);
        return x.toFixed(1) + "," + y.toFixed(1);
      });
    }

    var paths = series.map(function (s) {
      var pts = toPoints(s.values);
      var dash = s.dashed ? ' stroke-dasharray="6 4"' : "";
      return '<path d="M' + pts.join(" L") + '" fill="none" stroke="' + s.color + '" stroke-width="2.2"' + dash + "></path>";
    }).join("");

    var labelEvery = Math.ceil(n / 10) || 1;
    var labelsSvg = "";
    labels.forEach(function (lb, i) {
      if (i % labelEvery !== 0 && i !== n - 1) return;
      var x = pad + i * stepX;
      labelsSvg += '<text x="' + x + '" y="' + (h - 6) + '" font-size="9" text-anchor="middle" fill="#747678">' + esc(lb) + "</text>";
    });

    var gridSvg = "";
    for (var gy = 0; gy <= 4; gy++) {
      var y = pad + (gy / 4) * (h - pad * 2 - 14);
      gridSvg += '<line x1="' + pad + '" y1="' + y + '" x2="' + (w - pad) + '" y2="' + y + '" stroke="#E6E7E8" stroke-width="1"></line>';
    }

    var legend = series.map(function (s) {
      return '<div class="chart-legend__item"><span class="chart-legend__swatch" style="background:' + s.color + '"></span>' + esc(s.name) + "</div>";
    }).join("");

    return '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" style="overflow:visible">' +
      gridSvg + paths + labelsSvg + "</svg>" +
      '<div class="chart-legend">' + legend + "</div>";
  }

  function barRows(items, opts) {
    opts = opts || {};
    var max = Math.max.apply(null, items.map(function (it) { return it.value; }).concat([1]));
    return items.map(function (it) {
      var pct = Math.max(2, Math.round((it.value / max) * 100));
      var key = opts.getKey ? opts.getKey(it) : it.label;
      var isActive = opts.activeKey !== undefined && opts.activeKey !== null && String(opts.activeKey) === String(key);
      var dimmed = opts.activeKey !== undefined && opts.activeKey !== null && !isActive;
      var cls = "bar-row" + (opts.clickable ? " bar-row--clickable" : "") +
        (dimmed ? " bar-row--dimmed" : "") + (isActive ? " bar-row--active" : "");
      return '<div class="' + cls + '" data-key="' + esc(key) + '"' + (opts.clickable ? ' role="button" tabindex="0"' : "") + ">" +
        '<div class="bar-row__label" title="' + esc(it.label) + '">' + esc(it.label) + "</div>" +
        '<div class="bar-row__track"><div class="bar-row__fill" style="width:' + pct + '%; background:' + (it.color || COLORS.valeGreen) + ';"></div></div>' +
        '<div class="bar-row__value">' + fmtNum(it.value) + "</div>" +
        "</div>";
    }).join("");
  }

  // items: [{ label, total, segments: [{label, value, color}] }]
  function stackedBarRows(items, opts) {
    opts = opts || {};
    var max = Math.max.apply(null, items.map(function (it) { return it.total; }).concat([1]));
    return items.map(function (it) {
      var pct = Math.max(2, Math.round((it.total / max) * 100));
      var key = opts.getKey ? opts.getKey(it) : it.label;
      var isActive = opts.activeKey !== undefined && opts.activeKey !== null && String(opts.activeKey) === String(key);
      var dimmed = opts.activeKey !== undefined && opts.activeKey !== null && !isActive;
      var cls = "bar-row" + (opts.clickable ? " bar-row--clickable" : "") +
        (dimmed ? " bar-row--dimmed" : "") + (isActive ? " bar-row--active" : "");
      var segsHtml = (it.segments || []).map(function (seg) {
        if (!seg.value) return "";
        var segPct = it.total ? (seg.value / it.total) * 100 : 0;
        return '<div style="width:' + segPct + '%; background:' + seg.color + ';" title="' + esc(seg.label) + ": " + fmtNum(seg.value) + '"></div>';
      }).join("");
      return '<div class="' + cls + '" data-key="' + esc(key) + '"' + (opts.clickable ? ' role="button" tabindex="0"' : "") + ">" +
        '<div class="bar-row__label" title="' + esc(it.label) + '">' + esc(it.label) + "</div>" +
        '<div class="bar-row__track"><div style="display:flex;height:100%;width:' + pct + '%;">' + segsHtml + "</div></div>" +
        '<div class="bar-row__value">' + fmtNum(it.total) + "</div>" +
        "</div>";
    }).join("");
  }

  // Grafico de curva S: series [{name, values, color, dashed}] sobre o mesmo eixo X (labels),
  // com eixo Y em % (0-100), marcador de "hoje" e legenda com o valor mais recente.
  function sCurveChart(series, labels, opts) {
    opts = opts || {};
    var w = opts.width || 720, h = opts.height || 300;
    var padL = 42, padR = 18, padT = 18, padB = 34;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;
    var maxY = opts.maxY || 100;
    var n = labels.length;
    var stepX = n > 1 ? plotW / (n - 1) : 0;
    var yUnit = opts.yUnit || "%";

    function xAt(i) { return padL + i * stepX; }
    function yAt(v) { return padT + plotH - (Math.max(0, Math.min(v, maxY)) / maxY) * plotH; }

    var gridSteps = opts.gridSteps || 4;
    var gridSvg = "", yLabelsSvg = "";
    for (var g = 0; g <= gridSteps; g++) {
      var val = (maxY / gridSteps) * g;
      var y = yAt(val);
      gridSvg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) + '" stroke="#E6E7E8" stroke-width="1"></line>';
      yLabelsSvg += '<text x="' + (padL - 8) + '" y="' + (y + 3).toFixed(1) + '" font-size="10" text-anchor="end" fill="#9AA0A6">' + Math.round(val) + yUnit + "</text>";
    }

    var todaySvg = "";
    if (opts.todayIndex !== undefined && opts.todayIndex !== null && opts.todayIndex >= 0 && opts.todayIndex < n) {
      var tx = xAt(opts.todayIndex);
      todaySvg = '<line x1="' + tx.toFixed(1) + '" y1="' + padT + '" x2="' + tx.toFixed(1) + '" y2="' + (h - padB) + '" stroke="#9AA0A6" stroke-width="1" stroke-dasharray="3 3"></line>' +
        '<text x="' + tx.toFixed(1) + '" y="' + (padT - 5) + '" font-size="9" text-anchor="middle" fill="#9AA0A6">hoje</text>';
    }

    var pathsSvg = "";
    series.forEach(function (s) {
      var pts = s.values.map(function (v, i) { return xAt(i).toFixed(1) + "," + yAt(v).toFixed(1); });
      var dash = s.dashed ? ' stroke-dasharray="7 4"' : "";
      pathsSvg += '<path d="M' + pts.join(" L") + '" fill="none" stroke="' + s.color + '" stroke-width="2.5"' + dash + "></path>";
      var dotEvery = Math.max(1, Math.ceil(n / 26));
      s.values.forEach(function (v, i) {
        if (i % dotEvery !== 0 && i !== n - 1) return;
        var x = xAt(i), y = yAt(v);
        pathsSvg += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="' + s.color + '"><title>' +
          esc(s.name) + " — " + esc(labels[i]) + ": " + v.toFixed(1) + yUnit + "</title></circle>";
      });
    });

    var xLabelsSvg = "";
    var labelEvery = Math.max(1, Math.ceil(n / (opts.maxXLabels || 9)));
    labels.forEach(function (lb, i) {
      if (i % labelEvery !== 0 && i !== n - 1) return;
      var x = xAt(i);
      xLabelsSvg += '<text x="' + x.toFixed(1) + '" y="' + (h - padB + 16) + '" font-size="10" text-anchor="middle" fill="#747678">' + esc(lb) + "</text>";
    });

    var legendSvg = series.map(function (s) {
      var lastVal = (opts.todayIndex !== undefined && opts.todayIndex !== null && s.values[opts.todayIndex] !== undefined)
        ? s.values[opts.todayIndex] : s.values[s.values.length - 1];
      return '<div class="chart-legend__item"><span class="chart-legend__swatch" style="background:' + s.color + '"></span>' +
        '<strong style="color:#555555;">' + esc(s.name) + "</strong>&nbsp;" + (lastVal !== undefined ? Math.round(lastVal) + yUnit : "") + "</div>";
    }).join("");

    return '<div class="chart-legend" style="margin-top:0;margin-bottom:10px;">' + legendSvg + "</div>" +
      '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" style="overflow:visible">' +
      gridSvg + yLabelsSvg + todaySvg + pathsSvg + xLabelsSvg +
      "</svg>";
  }

  // Grafico combinado estilo "Curva S" classico: barras mensais (eixo esquerdo, valor
  // incremental) + linhas acumuladas (eixo direito, 0-100%), com faixas de ano no rodape.
  // bars: [{ value, color, label }] -- um por ponto do eixo X.
  // lines: [{ name, values, color, dashedFromIndex }] -- acumulado 0-100%, pode virar
  //   tracejado a partir de um indice (ex.: a partir de "hoje", indicando previsao).
  // labels: rotulos curtos do eixo X (ex.: inicial do mes). opts.yearBands: [{ label, start, end }].
  function comboSCurveChart(bars, lines, labels, opts) {
    opts = opts || {};
    var n = labels.length;
    var minPxPerPoint = opts.minPxPerPoint || 20;
    var w = Math.max(opts.width || 720, n * minPxPerPoint);
    var h = opts.height || 340;
    var padL = 56, padR = 56, padT = 26, padB = opts.yearBands ? 50 : 32;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;
    var stepX = n > 1 ? plotW / (n - 1) : 0;
    var lineMax = opts.maxY || 100;
    var yUnit = opts.yUnit || "%";
    var barMax = Math.max.apply(null, bars.map(function (b) { return b.value; }).concat([1])) * 1.15;

    function xAt(i) { return padL + i * stepX; }
    function yBar(v) { return padT + plotH - (Math.max(0, v) / barMax) * plotH; }
    function yLine(v) { return padT + plotH - (Math.max(0, Math.min(v, lineMax)) / lineMax) * plotH; }

    // grade + labels dos dois eixos
    var steps = 4;
    var gridSvg = "", leftLabelsSvg = "", rightLabelsSvg = "";
    for (var g = 0; g <= steps; g++) {
      var rightVal = (lineMax / steps) * g;
      var y = yLine(rightVal);
      gridSvg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) + '" stroke="#E6E7E8" stroke-width="1"></line>';
      rightLabelsSvg += '<text x="' + (w - padR + 8) + '" y="' + (y + 3).toFixed(1) + '" font-size="10" text-anchor="start" fill="#9AA0A6">' + Math.round(rightVal) + yUnit + "</text>";
      var leftVal = (barMax / steps) * g;
      leftLabelsSvg += '<text x="' + (padL - 8) + '" y="' + (y + 3).toFixed(1) + '" font-size="10" text-anchor="end" fill="#9AA0A6">' + fmtNum(Math.round(leftVal)) + "</text>";
    }

    var barW = Math.max(2, stepX * 0.62);
    var barsSvg = bars.map(function (b, i) {
      var x = xAt(i) - barW / 2;
      var y = yBar(b.value);
      var barH = (padT + plotH) - y;
      if (barH <= 0) return "";
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) + '" fill="' + b.color + '"><title>' +
        esc(b.label || labels[i]) + ": " + fmtNum(Math.round(b.value)) + "</title></rect>";
    }).join("");

    var todaySvg = "";
    if (opts.todayIndex !== undefined && opts.todayIndex !== null && opts.todayIndex >= 0 && opts.todayIndex < n) {
      var tx = xAt(opts.todayIndex);
      todaySvg = '<line x1="' + tx.toFixed(1) + '" y1="' + padT + '" x2="' + tx.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#9AA0A6" stroke-width="1" stroke-dasharray="3 3"></line>' +
        '<text x="' + tx.toFixed(1) + '" y="' + (padT - 8) + '" font-size="9" text-anchor="middle" fill="#9AA0A6">hoje</text>';
    }

    var linesSvg = lines.map(function (s) {
      var cut = (s.dashedFromIndex !== undefined && s.dashedFromIndex !== null) ? s.dashedFromIndex : n;
      var solidPts = [], dashedPts = [];
      s.values.forEach(function (v, i) {
        var pt = xAt(i).toFixed(1) + "," + yLine(v).toFixed(1);
        if (i <= cut) solidPts.push(pt);
        if (i >= cut) dashedPts.push(pt);
      });
      var out = "";
      if (solidPts.length > 1) out += '<path d="M' + solidPts.join(" L") + '" fill="none" stroke="' + s.color + '" stroke-width="2.5"></path>';
      if (dashedPts.length > 1) out += '<path d="M' + dashedPts.join(" L") + '" fill="none" stroke="' + s.color + '" stroke-width="2.5" stroke-dasharray="7 4"></path>';
      var dotEvery = Math.max(1, Math.ceil(n / 40));
      s.values.forEach(function (v, i) {
        if (i % dotEvery !== 0 && i !== n - 1) return;
        out += '<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yLine(v).toFixed(1) + '" r="2.6" fill="' + s.color + '"><title>' +
          esc(s.name) + " — " + esc(labels[i]) + ": " + v.toFixed(1) + yUnit + "</title></circle>";
      });
      return out;
    }).join("");

    var xLabelsSvg = labels.map(function (lb, i) {
      return '<text x="' + xAt(i).toFixed(1) + '" y="' + (padT + plotH + 14) + '" font-size="9.5" text-anchor="middle" fill="#747678">' + esc(lb) + "</text>";
    }).join("");

    var yearBandSvg = "";
    if (opts.yearBands && opts.yearBands.length) {
      var bandY = padT + plotH + 24;
      opts.yearBands.forEach(function (yb, i) {
        var x1 = xAt(yb.start) - stepX / 2;
        var x2 = xAt(yb.end) + stepX / 2;
        if (i > 0) yearBandSvg += '<line x1="' + x1.toFixed(1) + '" y1="' + (padT + plotH) + '" x2="' + x1.toFixed(1) + '" y2="' + (bandY + 6) + '" stroke="#D6D8DA" stroke-width="1"></line>';
        yearBandSvg += '<text x="' + ((x1 + x2) / 2).toFixed(1) + '" y="' + (bandY + 4) + '" font-size="10.5" font-weight="700" text-anchor="middle" fill="#555555">' + esc(yb.label) + "</text>";
      });
    }

    var legendSvg = lines.map(function (s) {
      return '<div class="chart-legend__item"><span class="chart-legend__swatch" style="background:' + s.color + '"></span><strong style="color:#555555;">' + esc(s.name) + "</strong></div>";
    }).concat(Object.keys(opts.barLegend || {}).map(function (k) {
      return '<div class="chart-legend__item"><span class="chart-legend__swatch" style="background:' + opts.barLegend[k] + '"></span>' + esc(k) + "</div>";
    })).join("");

    return '<div class="chart-legend" style="margin-top:0;margin-bottom:10px;">' + legendSvg + "</div>" +
      '<div style="overflow-x:auto;">' +
      '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" style="display:block;">' +
      gridSvg + leftLabelsSvg + rightLabelsSvg + barsSvg + todaySvg + linesSvg + xLabelsSvg + yearBandSvg +
      "</svg></div>";
  }

  function ganttRows(items, projStart, projEnd, opts) {
    opts = opts || {};
    var t0 = new Date(projStart).getTime();
    var t1 = new Date(projEnd).getTime();
    var span = Math.max(t1 - t0, 1);
    return items.map(function (it) {
      var key = opts.getKey ? opts.getKey(it) : it.nome;
      var isActive = opts.activeKey !== undefined && opts.activeKey !== null && String(opts.activeKey) === String(key);
      var cls = "bar-row" + (opts.clickable ? " bar-row--clickable" : "") + (isActive ? " bar-row--active" : "");
      if (!it.inicio || !it.termino) {
        return '<div class="' + cls + '" data-key="' + esc(key) + '"><div class="bar-row__label" title="' + esc(it.nome) + '">' + esc(it.nome) +
          '</div><div class="bar-row__track"></div><div class="bar-row__value">—</div></div>';
      }
      var s = new Date(it.inicio).getTime();
      var e = new Date(it.termino).getTime();
      var left = Math.max(0, ((s - t0) / span) * 100);
      var width = Math.max(1, ((e - s) / span) * 100);
      return '<div class="' + cls + '" data-key="' + esc(key) + '"' + (opts.clickable ? ' role="button" tabindex="0"' : "") + ">" +
        '<div class="bar-row__label" title="' + esc(it.nome) + '">' + esc(it.nome) + "</div>" +
        '<div class="bar-row__track"><div class="bar-row__fill" style="margin-left:' + left.toFixed(1) + "%; width:" + width.toFixed(1) + '%; background:' + COLORS.valeBlue + ';"></div></div>' +
        '<div class="bar-row__value">' + fmtNum(it.totalAtividades) + "</div>" +
        "</div>";
    }).join("");
  }

  // ------------------------------------------------------------- filterable table

  // rows: array of objects. columns: [{key, label, render(row)}].
  // opts: { limit, searchPlaceholder, searchKeys (defaults to all column keys),
  //         initialText, initialExact: {field:value}, filterLabels: {field:'Rotulo'},
  //         onFilterChange(state), emptyLabel }
  function makeFilterableTable(containerId, rows, columns, opts) {
    opts = opts || {};
    var container = $(containerId);
    if (!container) return null;

    var searchKeys = opts.searchKeys || columns.map(function (c) { return c.key; });
    var state = { text: opts.initialText || "", exact: {} };
    Object.keys(opts.initialExact || {}).forEach(function (k) {
      if (opts.initialExact[k] !== null && opts.initialExact[k] !== undefined && opts.initialExact[k] !== "") {
        state.exact[k] = opts.initialExact[k];
      }
    });

    function applyFilters() {
      var f = (state.text || "").toLowerCase();
      return rows.filter(function (r) {
        for (var k in state.exact) {
          if (state.exact[k] !== null && state.exact[k] !== undefined && String(r[k]) !== String(state.exact[k])) return false;
        }
        if (!f) return true;
        return searchKeys.some(function (k) {
          var v = r[k];
          return v !== null && v !== undefined && String(v).toLowerCase().indexOf(f) !== -1;
        });
      });
    }

    function chipLabel(key) {
      return (opts.filterLabels && opts.filterLabels[key]) || key;
    }

    function renderChips() {
      var keys = Object.keys(state.exact).filter(function (k) { return state.exact[k] !== null && state.exact[k] !== undefined && state.exact[k] !== ""; });
      if (!keys.length) return "";
      var chips = keys.map(function (k) {
        return '<span class="filter-chip">' + esc(chipLabel(k)) + ": " + esc(state.exact[k]) +
          '<button type="button" class="filter-chip__x" data-chip-clear="' + esc(k) + '" aria-label="Remover filtro">&times;</button></span>';
      }).join("");
      return '<div class="filter-chips">' + chips + '<button type="button" class="filter-chip__clear-all" id="ftClearAll">Limpar filtros</button></div>';
    }

    function renderAll() {
      var filtered = applyFilters();
      var limited = opts.limit ? filtered.slice(0, opts.limit) : filtered;

      var thead = "<tr>" + columns.map(function (c) { return "<th>" + esc(c.label) + "</th>"; }).join("") + "</tr>";
      var tbody = limited.map(function (r) {
        return "<tr>" + columns.map(function (c) {
          var val = c.render ? c.render(r) : esc(r[c.key]);
          return "<td>" + val + "</td>";
        }).join("") + "</tr>";
      }).join("");

      var caption = filtered.length > limited.length
        ? "Mostrando " + limited.length + " de " + filtered.length + " registros. Refine a busca para ver outros."
        : filtered.length + " registro(s).";

      var searchHtml = opts.searchPlaceholder === false ? "" :
        '<div class="search-box"><span>🔎</span><input type="text" class="ft-search" placeholder="' +
        esc(opts.searchPlaceholder || "Buscar...") + '" value="' + esc(state.text) + '"></div>';

      container.innerHTML =
        searchHtml +
        renderChips() +
        '<div class="table-wrap"><table class="data-table"><thead>' + thead + "</thead><tbody>" +
        (tbody || '<tr><td colspan="' + columns.length + '" style="text-align:center;color:#747678;">' + esc(opts.emptyLabel || "Nenhum registro encontrado.") + "</td></tr>") +
        "</tbody></table></div>" +
        '<div class="table-caption">' + caption + "</div>";

      var input = container.querySelector(".ft-search");
      if (input) {
        input.addEventListener("input", function (e) {
          state.text = e.target.value;
          renderAll();
        });
      }
      container.querySelectorAll("[data-chip-clear]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.exact[btn.getAttribute("data-chip-clear")] = null;
          renderAll();
          if (opts.onFilterChange) opts.onFilterChange(state);
        });
      });
      var clearAll = container.querySelector("#ftClearAll");
      if (clearAll) {
        clearAll.addEventListener("click", function () {
          state.exact = {};
          renderAll();
          if (opts.onFilterChange) opts.onFilterChange(state);
        });
      }
    }

    renderAll();
    if (opts.onFilterChange) opts.onFilterChange(state);

    return {
      setExact: function (key, value) {
        state.exact[key] = (state.exact[key] !== undefined && state.exact[key] !== null && String(state.exact[key]) === String(value)) ? null : value;
        renderAll();
        if (opts.onFilterChange) opts.onFilterChange(state);
      },
      setExactValue: function (key, value) {
        state.exact[key] = value || null;
        renderAll();
        if (opts.onFilterChange) opts.onFilterChange(state);
      },
      setText: function (v) { state.text = v; renderAll(); },
      clearAll: function () { state.exact = {}; state.text = ""; renderAll(); if (opts.onFilterChange) opts.onFilterChange(state); },
      getState: function () { return state; }
    };
  }

  // ---------------------------------------------------------------- multiselect (caixas de seleção)

  // options: array de strings. selected: array de strings marcadas. Uso: A.multiSelect(id, options,
  // selected, label) pra montar o HTML, depois A.wireMultiSelect(id, function(values){...}) depois
  // que o HTML já estiver no DOM (o innerHTML precisa ter sido atribuído antes de chamar).
  function multiSelect(id, options, selected, label) {
    var selSet = {};
    (selected || []).forEach(function (v) { selSet[v] = true; });
    var resumo = !selected || !selected.length ? (label || "Todos")
      : (selected.length === 1 ? selected[0] : selected.length + " selecionados");
    var optsHtml = (options || []).map(function (o) {
      return '<label class="ms-opt"><input type="checkbox" value="' + esc(o) + '"' + (selSet[o] ? " checked" : "") + ">" + esc(o) + "</label>";
    }).join("");
    return '<div class="ms-wrap" id="' + id + '">' +
      '<div class="ms-input" data-ms-toggle><span class="ms-label">' + esc(resumo) + '</span><span class="ms-arrow">▾</span></div>' +
      '<div class="ms-drop" id="' + id + '-drop">' +
        '<div class="ms-search"><input type="text" placeholder="Buscar…"></div>' +
        '<div class="ms-list">' + (optsHtml || '<div class="ms-empty">Nenhuma opção.</div>') + "</div>" +
        '<div class="ms-footer"><button type="button" class="ms-btn-all" data-ms-all>Todos</button><button type="button" class="ms-btn-all" data-ms-clear>Limpar</button></div>' +
      "</div></div>";
  }

  // Liga os eventos de um multiSelect já renderizado no DOM. onChange(values) roda toda vez que a
  // seleção muda, recebendo o array atualizado de valores marcados.
  function wireMultiSelect(id, onChange) {
    var wrap = $(id);
    if (!wrap) return;
    var drop = $(id + "-drop");
    var input = wrap.querySelector("[data-ms-toggle]");
    input.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = drop.classList.contains("ms-drop--open");
      document.querySelectorAll(".ms-drop--open").forEach(function (d) { d.classList.remove("ms-drop--open"); });
      if (!open) drop.classList.add("ms-drop--open");
    });
    function currentValues() {
      return Array.prototype.slice.call(drop.querySelectorAll("input[type=checkbox]:checked")).map(function (c) { return c.value; });
    }
    drop.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
      cb.addEventListener("change", function () { onChange(currentValues()); });
    });
    var searchInput = drop.querySelector(".ms-search input");
    if (searchInput) {
      searchInput.addEventListener("click", function (e) { e.stopPropagation(); });
      searchInput.addEventListener("input", function () {
        var q = searchInput.value.toLowerCase();
        drop.querySelectorAll(".ms-opt").forEach(function (opt) {
          opt.style.display = opt.textContent.toLowerCase().indexOf(q) >= 0 ? "" : "none";
        });
      });
    }
    var allBtn = drop.querySelector("[data-ms-all]");
    if (allBtn) allBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var boxes = drop.querySelectorAll("input[type=checkbox]");
      boxes.forEach(function (c) { c.checked = true; });
      onChange(currentValues());
    });
    var clearBtn = drop.querySelector("[data-ms-clear]");
    if (clearBtn) clearBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      drop.querySelectorAll("input[type=checkbox]").forEach(function (c) { c.checked = false; });
      onChange([]);
    });
  }
  document.addEventListener("click", function () {
    document.querySelectorAll(".ms-drop--open").forEach(function (d) { d.classList.remove("ms-drop--open"); });
  });

  // ---------------------------------------------------------------- shell (menu, pills, atualizar)

  function initMenuToggle() {
    var btn = $("menuToggle"), sidebar = $("sidebar");
    if (btn && sidebar) {
      btn.addEventListener("click", function () { sidebar.classList.toggle("open"); });
    }
  }

  function setStatusPills(pills) {
    var wrap = $("statusPills");
    if (!wrap) return;
    wrap.innerHTML = pills.map(function (p) {
      return '<div class="topbar__pill">' + esc(p) + "</div>";
    }).join("");
  }

  function toast(msg, kind) {
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " toast--" + kind : "");
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("toast--visible"); });
    setTimeout(function () { el.classList.remove("toast--visible"); }, 2400);
    setTimeout(function () { el.parentNode && el.parentNode.removeChild(el); }, 2900);
  }

  function reloadPanelData(keys, onDone) {
    var remaining = keys.length;
    if (!remaining) { onDone(); return; }
    var failed = false;
    keys.forEach(function (key) {
      var path = DATA_SCRIPT_PATHS[key];
      if (!path) { remaining--; if (remaining <= 0) onDone(failed); return; }
      var old = $("data-script-" + key);
      if (old) old.parentNode.removeChild(old);
      var s = document.createElement("script");
      s.id = "data-script-" + key;
      s.src = path + "?t=" + Date.now();
      s.onload = function () { remaining--; if (remaining <= 0) onDone(failed); };
      s.onerror = function () { failed = true; remaining--; if (remaining <= 0) onDone(failed); };
      document.head.appendChild(s);
    });
  }

  function wireAtualizarButton(keys, renderFn) {
    var btn = $("btnAtualizar");
    if (!btn) return;
    btn.addEventListener("click", function () {
      btn.disabled = true;
      var original = btn.textContent;
      btn.textContent = "⏳ Atualizando...";
      reloadPanelData(keys, function (failed) {
        btn.disabled = false;
        btn.textContent = original;
        if (failed) {
          toast("Não foi possível atualizar os dados.", "error");
          return;
        }
        try {
          renderFn();
          toast("Dados atualizados com sucesso.");
        } catch (err) {
          toast("Dados recarregados, mas houve um erro ao exibi-los.", "error");
        }
      });
    });
  }

  function disableAtualizarButton(hint) {
    var btn = $("btnAtualizar");
    if (!btn) return;
    btn.disabled = true;
    btn.title = hint || "Nenhuma planilha de origem encontrada ainda.";
  }

  // ---------------------------------------------------------------- splash "Projeto CPF"
  // Roda uma vez por aba/sessão (sessionStorage), na primeira página que a pessoa abrir --
  // não repete a cada troca de aba dentro do painel.
  function showSplashOnce() {
    try { if (sessionStorage.getItem("cpfSplashShown")) return; } catch (e) {}
    var overlay = document.createElement("div");
    overlay.id = "cpfSplash";
    overlay.innerHTML =
      '<div class="cpf-splash-ring cpf-splash-ring--1"></div>' +
      '<div class="cpf-splash-ring cpf-splash-ring--2"></div>' +
      '<div class="cpf-splash-logo-wrap">' +
        '<div class="cpf-splash-logo-glow"></div>' +
        '<img class="cpf-splash-logo" src="assets/images/squad-cpf-logo.png" alt="Squad CPF">' +
      "</div>" +
      '<div class="cpf-splash-name" id="cpfSplashName"></div>' +
      '<div class="cpf-splash-tagline">Coarse Particle Flotation</div>' +
      '<div class="cpf-splash-bar-track"><div class="cpf-splash-bar-fill"></div></div>';
    document.body.appendChild(overlay);

    var text = "PROJETO CPF";
    var nameEl = document.getElementById("cpfSplashName");
    text.split("").forEach(function (ch, i) {
      var s = document.createElement("span");
      s.textContent = ch === " " ? " " : ch;
      s.style.animationDelay = (0.45 + i * 0.045) + "s";
      nameEl.appendChild(s);
    });

    var prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    setTimeout(function () {
      overlay.classList.add("cpf-splash--leaving");
      document.documentElement.style.overflow = prevOverflow;
      setTimeout(function () { overlay.parentNode && overlay.parentNode.removeChild(overlay); }, 750);
    }, 1650);

    try { sessionStorage.setItem("cpfSplashShown", "1"); } catch (e) {}
  }

  window.App = {
    COLORS: COLORS,
    FAROL_COLORS: FAROL_COLORS,
    $: $,
    esc: esc,
    fmtDate: fmtDate,
    fmtMonthLabel: fmtMonthLabel,
    fmtNum: fmtNum,
    daysBetween: daysBetween,
    farolBadgeClass: farolBadgeClass,
    badge: badge,
    countBy: countBy,
    setNavBadge: setNavBadge,
    alertBand: alertBand,
    sectionLabel: sectionLabel,
    wireTabs: wireTabs,
    distinctValues: distinctValues,
    filterToolbar: filterToolbar,
    wireFilterToolbar: wireFilterToolbar,
    syncFilterToolbar: syncFilterToolbar,
    multiSelect: multiSelect,
    wireMultiSelect: wireMultiSelect,
    qs: qs,
    setQuery: setQuery,
    onDelegated: onDelegated,
    donutChart: donutChart,
    lineChart: lineChart,
    multiLineChart: multiLineChart,
    sCurveChart: sCurveChart,
    comboSCurveChart: comboSCurveChart,
    barRows: barRows,
    stackedBarRows: stackedBarRows,
    ganttRows: ganttRows,
    makeFilterableTable: makeFilterableTable,
    initMenuToggle: initMenuToggle,
    setStatusPills: setStatusPills,
    toast: toast,
    reloadPanelData: reloadPanelData,
    wireAtualizarButton: wireAtualizarButton,
    disableAtualizarButton: disableAtualizarButton
  };

  initMenuToggle();
  showSplashOnce();
})();
