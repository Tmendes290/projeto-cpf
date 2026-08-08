// assets/js/pages/pgu-report.js — report "só pra gente aqui" (gerência de projetos): Curva S
// automática do andamento da PGU + lista de atividades concluídas. Só leitura (nunca grava nada
// no Supabase) e vive numa página própria (report.html) que NÃO é linkada em nenhum menu/botão
// do pgu.html que os encarregados usam -- só acessa quem tiver o link direto.
(function () {
  "use strict";
  var A = window.App;
  var SUPA_URL = "https://ehbiyqqpzqrluvuqrljp.supabase.co";
  var SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoYml5cXFwenFybHV2dXFybGpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMjM3MTcsImV4cCI6MjA5NDg5OTcxN30.lW_Jdc7SC7FKh9OJPBCYdfN-QMXFTYGjterU3eWOFTc";
  var supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);

  // ------------------------------------------------------------ carga de dados (Supabase)

  // Tabelas grandes cortam em 1000 linhas sem paginação (já vimos isso morder no dashboard
  // principal) -- pgu_overrides tem 1 linha por atividade já tocada, então pode passar de 1000
  // numa PGU grande. Pagina sempre, mesmo que hoje ainda não precise.
  async function fetchAllRows(table, cols) {
    var all = [], from = 0, pageSize = 1000;
    while (true) {
      var res = await supa.from(table).select(cols).range(from, from + pageSize - 1);
      if (res.error) throw res.error;
      var rows = res.data || [];
      all = all.concat(rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  async function loadOverrides() {
    try {
      var rows = await fetchAllRows("pgu_overrides", "uid,dados");
      var map = {};
      rows.forEach(function (r) { map[r.uid] = r.dados; });
      return map;
    } catch (e) {
      console.warn("[PGU report] erro ao carregar overrides:", e);
      A.toast("Não consegui carregar as atualizações compartilhadas.", "error");
      return {};
    }
  }

  async function loadBaselineAtividades() {
    try {
      var res = await supa.from("pgu_baseline").select("dados").eq("chave", "main").maybeSingle();
      if (res.error) throw res.error;
      if (res.data && res.data.dados) return res.data.dados.atividades || [];
    } catch (e) {
      console.warn("[PGU report] erro ao carregar baseline importada (usando a estática):", e);
    }
    var estatico = (window.PANEL_DATA && window.PANEL_DATA.pgu) || {};
    return estatico.atividades || [];
  }

  // ------------------------------------------------------------ datas

  function parseISO(s) {
    if (!s) return null;
    var p = String(s).split(" ");
    var d = p[0].split("-");
    if (d.length < 3) return null;
    var hm = (p[1] || "00:00").split(":");
    var dt = new Date(+d[0], +d[1] - 1, +d[2], +(hm[0] || 0), +(hm[1] || 0));
    return isNaN(dt.getTime()) ? null : dt;
  }
  // "atualizadoEm" é gravado com toLocaleString("pt-BR") -> "dd/MM/yyyy, HH:mm:ss".
  function parsePtBR(s) {
    if (!s) return null;
    var m = /(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})/.exec(String(s));
    if (!m) return null;
    var dt = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // ------------------------------------------------------------ merge baseline + overrides
  // (versão enxuta do effective() de pgu.js -- só os campos que essa página usa, sem cascata de
  // reprogramação: a tendência (terminoTendenciaAuto) já vem calculada e salva pelo pgu.js todo
  // fim de render de quem estiver em campo, então aqui é só ler o que já está no Supabase.)

  function effectiveLite(a, ov) {
    ov = ov || {};
    var percent = (ov.percent !== undefined && ov.percent !== null) ? ov.percent : a.percentComplete;
    return {
      uid: a.uid, nome: a.nome, area: a.area || "Sem classificação", componente: a.componente || "",
      encarregado: ov.encarregado || a.encarregado || "",
      status: ov.status || a.status, percent: percent || 0,
      duracaoHoras: a.duracaoHoras || 0,
      inicioBaseline: parseISO(a.inicioBaselineDataHora || a.inicioDataHora),
      terminoBaseline: parseISO(a.terminoBaselineDataHora || a.terminoDataHora),
      inicioReal: parseISO(a.inicioReal), terminoReal: parseISO(a.terminoReal),
      terminoTendencia: parseISO(ov.terminoTendencia || ov.terminoTendenciaAuto) || parseISO(a.terminoBaselineDataHora || a.terminoDataHora),
      atualizadoEm: parsePtBR(ov.atualizadoEm)
    };
  }

  // ------------------------------------------------------------ curva S (fração 0–1 por atividade)

  function peso(e) { return e.duracaoHoras || 1; }
  function pesoTotal(effs) { return effs.reduce(function (s, e) { return s + peso(e); }, 0) || 1; }

  // Quanto do prazo planejado (linha de base) já devia ter passado em T -- rampa linear entre
  // início e término da baseline da própria atividade.
  function fracBaseline(e, T) {
    if (!e.inicioBaseline || !e.terminoBaseline) return 0;
    if (T <= e.inicioBaseline) return 0;
    if (T >= e.terminoBaseline) return 1;
    return (T - e.inicioBaseline) / (e.terminoBaseline - e.inicioBaseline);
  }

  // Progresso REAL em T (só faz sentido pra T <= agora): concluída = degrau na data real de
  // término (ActualFinish do MS Project, ou a última atualização feita no site, ou -- na falta
  // dos dois -- a própria data da linha de base); em andamento = rampa entre o início real e
  // agora, até o % preenchido hoje (nunca inventa progresso além do que foi de fato registrado).
  function fracReal(e, T, agora) {
    if (e.status === "Concluída") {
      var quando = e.terminoReal || e.atualizadoEm || e.terminoBaseline;
      if (!quando) return e.percent >= 100 ? 1 : 0;
      return T >= quando ? 1 : 0;
    }
    var pct = (e.percent || 0) / 100;
    if (pct <= 0) return 0;
    if (T >= agora) return pct;
    var inicio = e.inicioReal || e.inicioBaseline;
    if (!inicio || T <= inicio) return 0;
    var span = agora - inicio;
    if (span <= 0) return pct;
    return pct * ((T - inicio) / span);
  }

  // Projeção pra frente de agora: mesma rampa da linha de base, mas mirando o término de
  // tendência (reprogramação automática por atraso de predecessora, já calculada pelo pgu.js) em
  // vez do término original -- nunca cai abaixo do que já foi realmente concluído.
  function fracTendencia(e, T) {
    var piso = (e.percent || 0) / 100;
    if (!e.inicioBaseline || !e.terminoTendencia) return piso;
    if (T <= e.inicioBaseline) return piso;
    if (T >= e.terminoTendencia) return 1;
    return Math.max(piso, (T - e.inicioBaseline) / (e.terminoTendencia - e.inicioBaseline));
  }

  function sumFrac(effs, T, fracFn) {
    return effs.reduce(function (s, e) { return s + peso(e) * fracFn(e, T); }, 0);
  }
  function pctAt(effs, T, fracFn, total) {
    return Math.round((sumFrac(effs, T, fracFn) / total) * 1000) / 10;
  }

  // Pontos da curva a cada troca de turno (07h/17h) cobrindo do início ao fim da baseline (e da
  // tendência, se ela empurrar o término pra depois da baseline).
  function buildPontos(effs) {
    var starts = [], ends = [];
    effs.forEach(function (e) {
      if (e.inicioBaseline) starts.push(e.inicioBaseline);
      if (e.terminoBaseline) ends.push(e.terminoBaseline);
      if (e.terminoTendencia) ends.push(e.terminoTendencia);
    });
    if (!starts.length || !ends.length) return [];
    var rangeStart = new Date(Math.min.apply(null, starts));
    var rangeEnd = new Date(Math.max.apply(null, ends));

    var cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate(), rangeStart.getHours() < 17 ? 7 : 17, 0, 0, 0);
    while (cur > rangeStart) cur = new Date(cur.getTime() - (cur.getHours() === 7 ? 14 : 10) * 3600000);
    var pts = [];
    while (cur <= rangeEnd) {
      pts.push(new Date(cur));
      cur = new Date(cur.getTime() + (cur.getHours() === 7 ? 10 : 14) * 3600000);
    }
    if (!pts.length || pts[pts.length - 1] < rangeEnd) pts.push(new Date(rangeEnd));
    return pts;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function buildCurva(effs) {
    var pts = buildPontos(effs);
    if (!pts.length) return null;
    var total = pesoTotal(effs);
    var agora = new Date();
    var todayIdx = 0;
    pts.forEach(function (p, i) { if (p <= agora) todayIdx = i; });

    var labels = pts.map(function (p) { return p.getHours() === 7 ? (pad2(p.getDate()) + "/" + pad2(p.getMonth() + 1)) : ""; });
    var linhaBase = pts.map(function (T) { return pctAt(effs, T, fracBaseline, total); });
    var real = pts.map(function (T) { return pctAt(effs, T, function (e, t) { return fracReal(e, t, agora); }, total); });
    var tendencia = pts.map(function (T) { return pctAt(effs, T, fracTendencia, total); });
    var combinado = pts.map(function (v, i) { return i <= todayIdx ? real[i] : tendencia[i]; });

    return A.comboSCurveChart([], [
      { name: "% Linha de Base", values: linhaBase, color: A.COLORS.valeGreen },
      { name: "% Real / Tendência", values: combinado, color: A.COLORS.darkBlue, dashedFromIndex: todayIdx }
    ], labels, { height: 340, todayIndex: todayIdx, maxY: 110 });
  }

  // ------------------------------------------------------------ report por área (TR/ativo)

  function groupStats(effs, agora) {
    var groups = {}, order = [];
    effs.forEach(function (e) {
      if (!groups[e.area]) { groups[e.area] = []; order.push(e.area); }
      groups[e.area].push(e);
    });
    return order.map(function (k) {
      var itens = groups[k];
      var total = pesoTotal(itens);
      var prev = pctAt(itens, agora, fracBaseline, total);
      var real = pctAt(itens, agora, function (e, t) { return fracReal(e, t, agora); }, total);
      var ad = prev > 0 ? Math.round((real / prev) * 1000) / 10 : (real > 0 ? 100 : 0);
      var termino = itens.reduce(function (m, e) { return (e.terminoBaseline && (!m || e.terminoBaseline > m)) ? e.terminoBaseline : m; }, null);
      var tendTermino = itens.reduce(function (m, e) { return (e.terminoTendencia && (!m || e.terminoTendencia > m)) ? e.terminoTendencia : m; }, null);
      return {
        label: k, total: itens.length, concluidas: itens.filter(function (e) { return e.status === "Concluída"; }).length,
        prev: prev, real: real, ad: ad, termino: termino, tendTermino: tendTermino
      };
    });
  }

  function fmtDataHora(d) {
    if (!d) return "—";
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + " " + pad2(d.getHours()) + "h";
  }

  function adColor(ad) { return ad >= 100 ? "farol-concluido" : (ad >= 90 ? "dim" : "farol-atrasado"); }

  function reportTableHtml(rows, totalRow) {
    function tr(r, destaque) {
      return "<tr" + (destaque ? ' style="font-weight:800;background:var(--light-gray);"' : "") + ">" +
        "<td>" + A.esc(r.label) + "</td>" +
        "<td>" + r.total + "</td>" +
        "<td>" + r.concluidas + "</td>" +
        "<td>" + r.prev + "%</td>" +
        "<td>" + r.real + "%</td>" +
        '<td><span class="badge ' + adColor(r.ad) + '">' + r.ad + "%</span></td>" +
        "<td>" + fmtDataHora(r.termino) + "</td>" +
        "<td>" + fmtDataHora(r.tendTermino) + "</td>" +
        "</tr>";
    }
    return '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      "<th>TR / Ativo</th><th>Ativ.</th><th>Concl.</th><th>% Prev.</th><th>% Real</th><th>% Adiant.</th><th>Término (linha de base)</th><th>Tend. término</th>" +
      "</tr></thead><tbody>" + tr(totalRow, true) + rows.map(function (r) { return tr(r, false); }).join("") + "</tbody></table></div>";
  }

  // ------------------------------------------------------------ atividades concluídas

  function concluidasTableHtml(effs) {
    var concluidas = effs.filter(function (e) { return e.status === "Concluída"; })
      .map(function (e) { return { e: e, quando: e.terminoReal || e.atualizadoEm || e.terminoBaseline }; })
      .sort(function (a, b) { return (b.quando || 0) - (a.quando || 0); });
    if (!concluidas.length) return '<div class="table-caption">Nenhuma atividade concluída ainda.</div>';
    return '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      "<th>Concluída em</th><th>Atividade</th><th>TR / Ativo</th><th>Componente</th><th>Encarregado</th>" +
      "</tr></thead><tbody>" +
      concluidas.map(function (c) {
        return "<tr><td>" + fmtDataHora(c.quando) + "</td><td>" + A.esc(c.e.nome) + "</td><td>" + A.esc(c.e.area) + "</td><td>" + A.esc(c.e.componente || "—") + "</td><td>" + A.esc(c.e.encarregado || "—") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  // ------------------------------------------------------------ shell

  function kpiCard(icon, label, value, cls, hint) {
    return '<div class="kpi-card ' + (cls || "") + '"><div class="kpi-card__icon">' + icon + "</div>" +
      '<div class="kpi-card__label">' + A.esc(label) + '</div><div class="kpi-card__value">' + value + "</div>" +
      (hint ? '<div class="kpi-card__hint">' + A.esc(hint) + "</div>" : "") + "</div>";
  }

  async function render() {
    var content = A.$("content");
    content.innerHTML = '<div class="table-caption">Carregando…</div>';

    var atividadesRaw = await loadBaselineAtividades();
    var overrides = await loadOverrides();
    if (!atividadesRaw.length) {
      content.innerHTML = '<div class="panel"><div class="table-caption">Nenhum cronograma importado ainda.</div></div>';
      return;
    }
    var effs = atividadesRaw
      .filter(function (a) { return !a.resumo; })
      .map(function (a) { return effectiveLite(a, overrides[a.uid]); });

    var agora = new Date();
    var curva = buildCurva(effs);
    var total = pesoTotal(effs);
    var prevHoje = pctAt(effs, agora, fracBaseline, total);
    var realHoje = pctAt(effs, agora, function (e, t) { return fracReal(e, t, agora); }, total);
    var adHoje = prevHoje > 0 ? Math.round((realHoje / prevHoje) * 1000) / 10 : (realHoje > 0 ? 100 : 0);
    var concluidas = effs.filter(function (e) { return e.status === "Concluída"; }).length;

    var totalRow = {
      label: "PGU (total)", total: effs.length, concluidas: concluidas,
      prev: prevHoje, real: realHoje, ad: adHoje,
      termino: effs.reduce(function (m, e) { return (e.terminoBaseline && (!m || e.terminoBaseline > m)) ? e.terminoBaseline : m; }, null),
      tendTermino: effs.reduce(function (m, e) { return (e.terminoTendencia && (!m || e.terminoTendencia > m)) ? e.terminoTendencia : m; }, null)
    };
    var linhas = groupStats(effs, agora);

    content.innerHTML =
      '<div class="pgu-turno-header" style="background:linear-gradient(135deg, var(--vale-blue), #1f6fa0);">' +
        '<div><div class="pgu-turno-header__title">📈 Curva S — Report Gerência</div>' +
        '<div class="pgu-turno-header__sub">Uso interno — não compartilhar este link com encarregados. Atualizado ' + fmtDataHora(agora) + "</div></div>" +
        '<div class="pgu-turno-header__actions">' +
          '<button type="button" class="pgu-btn-ghost" id="pguPdfBtn">📄 PDF</button>' +
        "</div>" +
      "</div>" +
      '<div class="kpi-grid">' +
        kpiCard("🏁", "Atividades", A.fmtNum(effs.length)) +
        kpiCard("✅", "Concluídas", A.fmtNum(concluidas)) +
        kpiCard("📗", "% Previsto (hoje)", prevHoje + "%") +
        kpiCard("📘", "% Real (hoje)", realHoje + "%", "blue") +
        kpiCard("⚖️", "% Adiantamento", adHoje + "%", adHoje >= 100 ? "" : (adHoje >= 90 ? "" : "bad")) +
      "</div>" +
      '<div class="panel"><h3 class="panel__title">Curva S física</h3>' +
        '<p class="panel__subtitle">Linha sólida = realizado até agora · linha pontilhada = tendência (reprogramação automática por atraso de predecessora)</p>' +
        (curva || '<div class="table-caption">Sem datas de linha de base suficientes pra montar a curva.</div>') +
      "</div>" +
      '<div class="panel"><h3 class="panel__title">Avanço por TR / ativo</h3>' +
        reportTableHtml(linhas, totalRow) +
      "</div>" +
      '<div class="panel"><h3 class="panel__title">Atividades concluídas</h3>' +
        concluidasTableHtml(effs) +
      "</div>";
  }

  render();
  A.wireAtualizarButton(["pgu"], render);
  setInterval(function () { render(); }, 60000);

  // Delegado no .main (fixo, sobrevive ao content.innerHTML ser trocado a cada render/refresh) --
  // abre a caixa de impressão do navegador pra "Salvar como PDF" e divulgar o report (mesma ideia
  // do botão PDF do pgu.js, ver regras @media print no CSS).
  A.onDelegated(document.querySelector(".main"), "#pguPdfBtn", function () { window.print(); });
})();
