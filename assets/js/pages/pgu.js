// assets/js/pages/pgu.js — pagina PGU (Parada Geral de Usina): dashboard, timeline e
// atualizacao rapida de campo. As atualizacoes (status/%, observacoes, encarregado, turno,
// impedimentos) ficam salvas no Supabase (tabelas pgu_overrides/pgu_historico), entao
// sincronizam entre qualquer pessoa/dispositivo (recarrega quando a pessoa aperta 🔄).
(function () {
  "use strict";
  var A = window.App;
  var SUPA_URL = "https://ehbiyqqpzqrluvuqrljp.supabase.co";
  var SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoYml5cXFwenFybHV2dXFybGpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMjM3MTcsImV4cCI6MjA5NDg5OTcxN30.lW_Jdc7SC7FKh9OJPBCYdfN-QMXFTYGjterU3eWOFTc";
  var supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  var mainTable;
  var activitiesByUid = {};
  var allAtividades = [];
  var OVERRIDES_CACHE = null; // uid -> objeto de override; populado do Supabase no boot

  // ------------------------------------------------------------ storage (Supabase, compartilhado)

  // loadOverrides() continua sincrona de proposito: todo o resto do arquivo (effective(),
  // recomputeCascade(), os render*()) ja foi escrito assumindo leitura instantanea (era
  // localStorage). Em vez de reescrever essa logica toda pra async, mantemos a LEITURA sobre um
  // cache em memoria (populado uma vez no boot e recarregado periodicamente) e so a GRAVACAO --
  // que nao precisa travar a tela -- vira uma chamada assincrona pro Supabase em segundo plano.
  function loadOverrides() {
    return OVERRIDES_CACHE || {};
  }
  function saveOverrides(obj) {
    var changedUids = Object.keys(obj).filter(function (uid) {
      var prev = OVERRIDES_CACHE ? OVERRIDES_CACHE[uid] : undefined;
      return JSON.stringify(prev) !== JSON.stringify(obj[uid]);
    });
    OVERRIDES_CACHE = obj;
    if (!changedUids.length) return;
    var rows = changedUids.map(function (uid) { return { uid: uid, dados: obj[uid] }; });
    supa.from("pgu_overrides").upsert(rows, { onConflict: "uid" }).then(function (res) {
      if (res.error) {
        console.warn("[PGU] erro ao salvar overrides:", res.error);
        A.toast("Erro ao sincronizar (ficou só neste navegador por enquanto): " + res.error.message, "error");
      }
    });
  }
  async function loadOverridesFromSupabase() {
    try {
      var res = await supa.from("pgu_overrides").select("uid,dados");
      if (res.error) throw res.error;
      var map = {};
      (res.data || []).forEach(function (r) { map[r.uid] = r.dados; });
      OVERRIDES_CACHE = map;
    } catch (e) {
      console.warn("[PGU] erro ao carregar overrides:", e);
      OVERRIDES_CACHE = OVERRIDES_CACHE || {};
      A.toast("Não consegui carregar as atualizações compartilhadas.", "error");
    }
  }
  function pushHistory(entry) {
    supa.from("pgu_historico").insert({ uid: entry.uid, dados: entry }).then(function (res) {
      if (res.error) console.warn("[PGU] erro ao gravar histórico:", res.error);
    });
  }

  // ------------------------------------------------------------ baseline importada (cronograma XML)

  // Carrega a baseline importada por alguém pelo site (se existir) e substitui window.PANEL_DATA.pgu
  // por ela -- se ninguém nunca importou nada ainda, mantém o que já veio do pgu.data.js estático.
  async function loadBaselineFromSupabase() {
    try {
      var res = await supa.from("pgu_baseline").select("dados").eq("chave", "main").maybeSingle();
      if (res.error) throw res.error;
      if (res.data && res.data.dados) {
        window.PANEL_DATA = window.PANEL_DATA || {};
        window.PANEL_DATA.pgu = res.data.dados;
      }
    } catch (e) {
      console.warn("[PGU] erro ao carregar baseline importada (usando a estática):", e);
    }
  }
  async function salvarBaselineImportada(dados) {
    var res = await supa.from("pgu_baseline").upsert(
      { chave: "main", dados: dados, atualizado_em: new Date().toISOString() },
      { onConflict: "chave" }
    );
    if (res.error) throw res.error;
  }

  // Porta pra JS (DOMParser, no navegador) a mesma lógica do scripts/parse-pgu.ps1: lê o XML nativo
  // do MS Project e devolve {geradoEm, projeto, totalAtividades, atividades}, no mesmo formato que
  // window.PANEL_DATA.pgu já tem hoje. Ver o .ps1 pros comentários completos de cada regra.
  function pIso8601Duration(s) {
    if (!s) return 0;
    var m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s);
    if (!m) return 0;
    var h = m[1] ? parseFloat(m[1]) : 0, mi = m[2] ? parseFloat(m[2]) : 0, se = m[3] ? parseFloat(m[3]) : 0;
    return Math.round((h + mi / 60 + se / 3600) * 10) / 10;
  }
  function pDateStr(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : (d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
  }
  function pDateHoraStr(v) {
    if (!v) return null;
    var d = new Date(v), ds = pDateStr(v);
    return ds ? (ds + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")) : null;
  }
  function pTurnoDaHora(v) {
    if (!v) return null;
    var d = new Date(v);
    if (isNaN(d.getTime())) return null;
    var h = d.getHours();
    if (h >= 7 && h < 17) return "07h–17h";
    if (h >= 17) return "17h–00h";
    return "00h–07h";
  }
  function pTxt(el, tag) { var n = el.getElementsByTagName(tag)[0]; return n ? n.textContent : ""; }

  function parsePguXml(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("XML inválido ou corrompido.");

    var extAttrsWrap = doc.getElementsByTagName("ExtendedAttributes")[0];
    var fieldIdByAlias = {};
    if (extAttrsWrap) {
      Array.prototype.slice.call(extAttrsWrap.getElementsByTagName("ExtendedAttribute")).forEach(function (d) {
        var alias = pTxt(d, "Alias"), fid = pTxt(d, "FieldID");
        if (alias) fieldIdByAlias[alias] = fid;
      });
    }
    var executanteFieldId = fieldIdByAlias["Executante"];
    var encarregadoFieldId = fieldIdByAlias["Encarregado"];
    var fiscalObraFieldId = fieldIdByAlias["Fiscal Obra"];
    var fiscalSegurancaFieldId = fieldIdByAlias["Fiscal Segurança"];

    function campoCustomizado(taskEl, fieldId) {
      if (!fieldId) return null;
      var attrs = taskEl.getElementsByTagName("ExtendedAttribute");
      for (var i = 0; i < attrs.length; i++) {
        if (pTxt(attrs[i], "FieldID") === fieldId) {
          var v = pTxt(attrs[i], "Value").trim();
          return v || null;
        }
      }
      return null;
    }

    var tasksEl = doc.getElementsByTagName("Tasks")[0];
    if (!tasksEl) throw new Error("Não encontrei a seção <Tasks> no arquivo — é mesmo um export do MS Project?");
    var taskEls = Array.prototype.slice.call(tasksEl.getElementsByTagName("Task"));

    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var tasksByUid = {}, orderedUids = [];

    taskEls.forEach(function (t) {
      var uid = pTxt(t, "UID");
      orderedUids.push(uid);
      var nivel = parseInt(pTxt(t, "OutlineLevel"), 10) || 0;
      var nome = pTxt(t, "Name").trim();
      var milestone = pTxt(t, "Milestone") === "1";
      var resumo = pTxt(t, "Summary") === "1";
      var critico = pTxt(t, "Critical") === "1";
      var pctComplete = parseFloat(pTxt(t, "PercentComplete")) || 0;
      var pctFisicoRaw = pTxt(t, "PhysicalPercentComplete");
      var pctFisico = pctFisicoRaw ? parseFloat(pctFisicoRaw) : pctComplete;
      var startRaw = pTxt(t, "Start"), finishRaw = pTxt(t, "Finish");
      var inicio = pDateStr(startRaw), termino = pDateStr(finishRaw);
      var inicioReal = pDateStr(pTxt(t, "ActualStart")), terminoReal = pDateStr(pTxt(t, "ActualFinish"));
      var inicioDataHora = pDateHoraStr(startRaw), terminoDataHora = pDateHoraStr(finishRaw);
      var turno = pTurnoDaHora(startRaw);
      var duracaoHoras = pIso8601Duration(pTxt(t, "Duration"));

      var inicioBaseline = null, terminoBaseline = null, inicioBaselineDataHora = null, terminoBaselineDataHora = null;
      var baselines = t.getElementsByTagName("Baseline");
      for (var bi = 0; bi < baselines.length; bi++) {
        if (pTxt(baselines[bi], "Number") === "0") {
          var bStart = pTxt(baselines[bi], "Start"), bFinish = pTxt(baselines[bi], "Finish");
          inicioBaseline = pDateStr(bStart); terminoBaseline = pDateStr(bFinish);
          inicioBaselineDataHora = pDateHoraStr(bStart); terminoBaselineDataHora = pDateHoraStr(bFinish);
          break;
        }
      }

      var executante = executanteFieldId ? campoCustomizado(t, executanteFieldId) : null;
      var encarregado = campoCustomizado(t, encarregadoFieldId);
      var fiscalObra = campoCustomizado(t, fiscalObraFieldId);
      var fiscalSeguranca = campoCustomizado(t, fiscalSegurancaFieldId);

      var predecessores = [];
      Array.prototype.slice.call(t.getElementsByTagName("PredecessorLink")).forEach(function (p) {
        var lagRaw = pTxt(p, "LinkLag");
        predecessores.push({ uid: pTxt(p, "PredecessorUID"), tipo: parseInt(pTxt(p, "Type"), 10) || 0, lagMin: lagRaw ? Math.round(parseFloat(lagRaw) / 10) : 0 });
      });

      var status = "Não iniciada", atrasoDias = 0;
      if (milestone) {
        status = pctComplete >= 100 ? "Concluída" : (termino && new Date(termino) < hoje ? "Atrasada" : "Não iniciada");
      } else if (pctComplete >= 100) {
        status = "Concluída";
      } else if (pctComplete > 0 || inicioReal) {
        status = "Em andamento";
        if (termino && new Date(termino) < hoje) { status = "Atrasada"; atrasoDias = Math.round((hoje - new Date(termino)) / 86400000); }
      } else if (inicio && new Date(inicio) < hoje) {
        status = "Atrasada"; atrasoDias = Math.round((hoje - new Date(inicio)) / 86400000);
      }

      tasksByUid[uid] = {
        uid: uid, nome: nome, nivel: nivel, milestone: milestone, resumo: resumo, critico: critico,
        inicio: inicio, termino: termino, inicioDataHora: inicioDataHora, terminoDataHora: terminoDataHora,
        turno: turno, inicioReal: inicioReal, terminoReal: terminoReal,
        inicioBaseline: inicioBaseline, terminoBaseline: terminoBaseline,
        inicioBaselineDataHora: inicioBaselineDataHora, terminoBaselineDataHora: terminoBaselineDataHora,
        duracaoHoras: duracaoHoras, percentComplete: pctComplete, percentFisico: pctFisico,
        executante: executante, encarregado: encarregado, fiscalObra: fiscalObra, fiscalSeguranca: fiscalSeguranca,
        predecessores: predecessores, status: status, atrasoDias: atrasoDias, filhos: []
      };
    });

    var root = null, stack = [];
    orderedUids.forEach(function (uid) {
      var node = tasksByUid[uid];
      var nivel1idx = node.nivel + 1;
      if (nivel1idx === 1) { root = node; stack = [node]; return; }
      while (stack.length >= nivel1idx) stack.pop();
      var parent = stack[stack.length - 1];
      if (parent) parent.filhos.push(node);
      stack.push(node);
    });
    var arvore = root ? root.filhos : [];

    var DISCIPLINAS_CONHECIDAS = ["MECÂNICA", "ELÉTRICA", "CIVIL"];
    function classificar(node, areaAtual, componenteAtual, disciplinaAtual) {
      var area = node.nivel === 3 ? node.nome : areaAtual;
      var componente = node.nivel === 4 ? node.nome : componenteAtual;
      var disciplina = (node.nivel === 5 && DISCIPLINAS_CONHECIDAS.indexOf((node.nome || "").toUpperCase()) >= 0) ? node.nome : disciplinaAtual;
      node.area = area; node.componente = componente; node.disciplina = disciplina;
      node.filhos.forEach(function (f) { classificar(f, area, componente, disciplina); });
    }
    arvore.forEach(function (n) { classificar(n, null, null, null); });

    var atividades = Object.keys(tasksByUid).map(function (k) { return tasksByUid[k]; })
      .filter(function (a) { return !a.resumo && a.nivel >= 3; })
      .sort(function (a, b) { return parseInt(a.uid, 10) - parseInt(b.uid, 10); });
    atividades.forEach(function (a) { delete a.filhos; });

    if (!atividades.length) throw new Error("Nenhuma atividade executável encontrada no arquivo.");

    var projectEl = doc.getElementsByTagName("Project")[0];
    var projeto = {
      nome: projectEl ? pTxt(projectEl, "Title") : "",
      inicio: pDateStr(projectEl ? pTxt(projectEl, "StartDate") : null),
      termino: pDateStr(projectEl ? pTxt(projectEl, "FinishDate") : null),
      statusData: pDateStr(projectEl ? pTxt(projectEl, "StatusDate") : null)
    };

    return { geradoEm: new Date().toLocaleString("pt-BR"), projeto: projeto, totalAtividades: atividades.length, atividades: atividades };
  }

  function toISODate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // Mescla a tarefa do MS Project com a atualizacao local (se houver) do encarregado.
  function effective(a, ov) {
    ov = ov || {};
    return {
      uid: a.uid, nome: a.nome, area: a.area, executante: ov.executante || a.executante,
      // area = TR/ativo (ex.: TCLD 0101SA-01); componente = sistema/parte do TR (ex.: ACIONAMENTO
      // M1); disciplina = Mecânica/Elétrica/Civil -- os 3 vem do nivel do cronograma (WBS).
      componente: a.componente || "", disciplina: a.disciplina || "",
      inicio: a.inicio, termino: a.termino, inicioBaseline: a.inicioBaseline, terminoBaseline: a.terminoBaseline,
      inicioDataHora: a.inicioDataHora, terminoDataHora: a.terminoDataHora,
      milestone: a.milestone, critico: a.critico,
      status: ov.status || a.status,
      percent: (ov.percent !== undefined && ov.percent !== null) ? ov.percent : a.percentComplete,
      observacoes: ov.observacoes || "",
      justificativa: ov.justificativa || "",
      tendencia: ov.tendencia || "",
      // Datas de tendencia: previsao de quando a atividade realmente vai comecar/terminar
      // (diferente do inicio/termino previsto pelo cronograma). Prioridade: 1) o que o
      // encarregado preencheu na mao, 2) reprogramacao automatica calculada a partir do atraso
      // das predecessoras (ver recomputeCascade), 3) enquanto nada foi preenchido, mostra a
      // propria linha de base (nunca fica em branco) -- so passa a valer pra cascata depois que
      // alguem efetivamente preenche/confirma a data.
      inicioTendencia: ov.inicioTendencia || ov.inicioTendenciaAuto || a.inicioBaselineDataHora || "",
      terminoTendencia: ov.terminoTendencia || ov.terminoTendenciaAuto || a.terminoBaselineDataHora || "",
      isTendenciaAuto: !ov.inicioTendencia && !!ov.inicioTendenciaAuto,
      isTendenciaBaseline: !ov.inicioTendencia && !ov.inicioTendenciaAuto && !!a.inicioBaselineDataHora,
      impedimento: ov.impedimento || "",
      // Encarregado, fiscal de obra e fiscal de seguranca agora vem do cronograma (planilha
      // revisao 3); o encarregado responsavel pode corrigir na atualizacao rapida se precisar.
      encarregado: ov.encarregado || a.encarregado || "",
      fiscalObra: ov.fiscalObra || a.fiscalObra || "",
      fiscalSeguranca: ov.fiscalSeguranca || a.fiscalSeguranca || "",
      // Turno vem do cronograma (hora de inicio da tarefa); o encarregado pode sobrescrever na atualizacao.
      // Tambem e reescrito quando o turno anterior fecha sem essa atividade terminar (ver "Encerrar turno").
      turno: ov.turno || a.turno || "",
      // Setado pelo botao "Encerrar turno" quando a atividade nao termina dentro do turno dela (e
      // nao era esperado que ultrapassasse) -- guarda de qual turno ela veio, pra mostrar o selo
      // "Herdada de X" pra quem recebe o turno seguinte.
      herancaDeTurno: ov.herancaDeTurno || null,
      atualizadoEm: ov.atualizadoEm || null
    };
  }

  // Deriva o status automaticamente a partir do % de avanco: 0% = nao iniciada, 100% = concluida,
  // qualquer coisa no meio = em andamento. "Atrasada" continua so podendo ser escolhida na mao.
  function statusFromPercent(pct) {
    var p = Number(pct);
    if (p >= 100) return "Concluída";
    if (p <= 0) return "Não iniciada";
    return "Em andamento";
  }

  // Salva um unico campo de override (usado pelos inputs de data inline nas colunas da tabela).
  function saveOverrideField(uid, field, value) {
    var overrides = loadOverrides();
    var anterior = overrides[uid] || {};
    var novo = {};
    for (var k in anterior) { novo[k] = anterior[k]; }
    novo[field] = value;
    if (field === "percent") { novo.status = statusFromPercent(value); }
    novo.atualizadoEm = new Date().toLocaleString("pt-BR");
    overrides[uid] = novo;
    saveOverrides(overrides);
    var atividade = activitiesByUid[uid];
    pushHistory({
      uid: uid, nome: atividade ? atividade.nome : uid, quando: novo.atualizadoEm,
      campo: field, valorAntigo: anterior[field] || "", valorNovo: value || ""
    });
    recomputeCascade();
  }

  // Igual a saveOverrideField, mas grava varios campos de uma vez soh (uma escrita no Supabase em
  // vez de uma por campo) -- usado pelas acoes rapidas (Problema) e pelo "Encerrar turno".
  function saveOverrideFields(uid, fields) {
    var overrides = loadOverrides();
    var anterior = overrides[uid] || {};
    var novo = {};
    for (var k in anterior) { novo[k] = anterior[k]; }
    for (var f in fields) { novo[f] = fields[f]; }
    if (fields.percent !== undefined && fields.status === undefined) { novo.status = statusFromPercent(fields.percent); }
    novo.atualizadoEm = new Date().toLocaleString("pt-BR");
    overrides[uid] = novo;
    saveOverrides(overrides);
    var atividade = activitiesByUid[uid];
    pushHistory({
      uid: uid, nome: atividade ? atividade.nome : uid, quando: novo.atualizadoEm,
      campo: Object.keys(fields).join(","), valorNovo: JSON.stringify(fields)
    });
    recomputeCascade();
  }

  function toDatetimeLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") +
      "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function parseDataHora(str) {
    if (!str) return null;
    var d = new Date(String(str).replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }

  // Reprogramacao em cascata: quando uma atividade fica com tendencia de termino depois do que
  // estava previsto, empurra o inicio das atividades sucessoras (ligacao Termino-Inicio) que
  // ainda nao tem tendencia PROPRIA (manual) preenchida -- e assim por diante, propagando o
  // atraso adiante na cadeia de dependencias do cronograma. So avanca prazos (nunca antecipa) e
  // nunca sobrescreve uma data que o proprio encarregado da atividade sucessora ja digitou.
  // Roda depois de qualquer atualizacao salva (status/%/tendencia) porque qualquer uma delas
  // pode ter mudado o termino efetivo de uma atividade que e predecessora de outras.
  function recomputeCascade() {
    if (!allAtividades.length) return;
    var byUid = {};
    allAtividades.forEach(function (a) { byUid[a.uid] = a; });
    var overrides = loadOverrides();

    // Limpa os valores "auto" anteriores antes de recalcular -- assim, se a causa do atraso for
    // corrigida (ou removida), a reprogramacao em cascata tambem desfaz o que nao se aplica mais.
    allAtividades.forEach(function (a) {
      var ov = overrides[a.uid];
      if (ov && (ov.inicioTendenciaAuto || ov.terminoTendenciaAuto)) {
        var limpo = {};
        for (var k in ov) { if (k !== "inicioTendenciaAuto" && k !== "terminoTendenciaAuto") limpo[k] = ov[k]; }
        overrides[a.uid] = limpo;
      }
    });

    function efetivoTermino(uid) {
      var ov = overrides[uid] || {};
      var d = parseDataHora(ov.terminoTendencia) || parseDataHora(ov.terminoTendenciaAuto);
      if (d) return d;
      var a = byUid[uid];
      return a ? parseDataHora(a.terminoDataHora) : null;
    }

    var mudou = true, passo = 0;
    while (mudou && passo < 15) {
      mudou = false; passo++;
      allAtividades.forEach(function (a) {
        var ov = overrides[a.uid] || {};
        if (ov.inicioTendencia) return; // encarregado ja definiu a propria tendencia -- respeita
        var inicioPlan = parseDataHora(a.inicioDataHora);
        var terminoPlan = parseDataHora(a.terminoDataHora);
        if (!inicioPlan || !terminoPlan) return;
        var duracaoMs = terminoPlan.getTime() - inicioPlan.getTime();

        var maiorFimPred = null;
        (a.predecessores || []).forEach(function (p) {
          if (p.tipo !== 1) return; // so considera ligacoes Termino-Inicio
          var fim = efetivoTermino(p.uid);
          if (!fim) return;
          var comLag = new Date(fim.getTime() + (p.lagMin || 0) * 60000);
          if (!maiorFimPred || comLag > maiorFimPred) maiorFimPred = comLag;
        });
        if (!maiorFimPred || maiorFimPred <= inicioPlan) return;

        var novoInicioStr = toDatetimeLocal(maiorFimPred);
        if (ov.inicioTendenciaAuto === novoInicioStr) return;

        var atualizado = {};
        for (var k in ov) { atualizado[k] = ov[k]; }
        atualizado.inicioTendenciaAuto = novoInicioStr;
        atualizado.terminoTendenciaAuto = toDatetimeLocal(new Date(maiorFimPred.getTime() + duracaoMs));
        overrides[a.uid] = atualizado;
        mudou = true;
      });
    }
    saveOverrides(overrides);
  }

  function statusBadgeClass(status) {
    if (status === "Concluída") return "farol-concluido";
    if (status === "Atrasada") return "farol-atrasado";
    if (status === "Em andamento") return "farol-noprazo";
    return "dim";
  }

  function fmtDataHora(dh) {
    if (!dh) return "—";
    var p = String(dh).replace("T", " ").split(" ");
    var d = p[0].split("-");
    return d[2] + "/" + d[1] + (p[1] ? " " + p[1] : "");
  }

  function farolDe(eff) {
    if (eff.status === "Concluída") return "verde";
    if (eff.status === "Atrasada") return "vermelho";
    if (eff.tendencia === "Atrasada" || eff.tendencia === "Risco de atraso") return "amarelo";
    if (eff.status === "Em andamento") return "verde";
    if (eff.status === "Não iniciada" && eff.inicio) {
      var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      var dias = Math.round((new Date(eff.inicio) - hoje) / 86400000);
      if (dias <= 2) return "amarelo";
    }
    return "verde";
  }
  function farolEmoji(f) { return f === "vermelho" ? "🔴" : f === "amarelo" ? "🟡" : "🟢"; }

  function kpiCard(icon, label, value, cls, hint) {
    return '<div class="kpi-card ' + (cls || "") + '"><div class="kpi-card__icon">' + icon + "</div>" +
      '<div class="kpi-card__label">' + A.esc(label) + '</div><div class="kpi-card__value">' + value + "</div>" +
      (hint ? '<div class="kpi-card__hint">' + A.esc(hint) + "</div>" : "") +
      '<div class="kpi-card__bar"></div></div>';
  }

  function miniProgress(pct) {
    pct = pct || 0;
    return '<div style="display:flex;align-items:center;gap:6px;min-width:110px;">' +
      '<div class="bar-row__track" style="height:8px;flex:1;"><div class="bar-row__fill" style="width:' + pct + '%;"></div></div>' +
      '<span style="font-size:11px;color:var(--vale-gray);width:32px;text-align:right;">' + Math.round(pct) + "%</span></div>";
  }

  function buildFarolStack(effs, keyFn) {
    var groups = {};
    effs.forEach(function (e) {
      var k = keyFn(e) || "—";
      if (!groups[k]) groups[k] = { verde: 0, amarelo: 0, vermelho: 0, total: 0 };
      groups[k][farolDe(e)]++;
      groups[k].total++;
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      return {
        label: k, total: g.total,
        segments: [
          { label: "Atrasado", value: g.vermelho, color: "#D93025" },
          { label: "Em risco", value: g.amarelo, color: "#F2A900" },
          { label: "No prazo / concluído", value: g.verde, color: "#2E9E4B" }
        ]
      };
    }).sort(function (a, b) { return b.total - a.total; });
  }

  // ------------------------------------------------------------ drawer (atualizacao rapida)

  var STATUS_OPTIONS = ["Não iniciada", "Em andamento", "Concluída", "Atrasada"];
  var PERCENT_OPTIONS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  var TENDENCIA_OPTIONS = ["Conclui hoje", "Conclui amanhã", "Mais dois dias", "Atrasada", "Risco de atraso"];
  var IMPEDIMENTO_OPTIONS = ["Material", "Equipamento", "Equipe", "Clima", "Segurança", "Outro"];
  var TURNO_OPTIONS = ["07h–17h", "17h–00h", "00h–07h"];

  function closeDrawer() {
    var el = A.$("pguDrawerOverlay");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function chipsHtml(containerId, dataAttr, options, current, extraCls) {
    return '<div class="chip-grid" id="' + containerId + '">' + options.map(function (opt) {
      return '<button type="button" class="chip-option' + (extraCls || "") + (current === opt ? " active" : "") +
        '" ' + dataAttr + '="' + A.esc(opt) + '">' + A.esc(opt) + (dataAttr === "data-percent" ? "%" : "") + "</button>";
    }).join("") + "</div>";
  }

  function wireChips(containerId, dataAttr, state, stateKey, isNumber) {
    A.$(containerId).querySelectorAll(".chip-option").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var val = btn.getAttribute(dataAttr);
        var already = btn.classList.contains("active");
        A.$(containerId).querySelectorAll(".chip-option").forEach(function (b) { b.classList.remove("active"); });
        if (!already) {
          btn.classList.add("active");
          state[stateKey] = isNumber ? parseInt(val, 10) : val;
        } else {
          state[stateKey] = isNumber ? null : "";
        }
      });
    });
  }

  function openDrawer(activity, onSaved) {
    closeDrawer();
    var overrides = loadOverrides();
    var ov = overrides[activity.uid] || {};
    var eff = effective(activity, ov);

    var overlay = document.createElement("div");
    overlay.className = "drawer-overlay";
    overlay.id = "pguDrawerOverlay";
    overlay.innerHTML =
      '<div class="drawer">' +
        '<div class="drawer__header"><div><div class="drawer__title">' + A.esc(activity.nome) + "</div>" +
          '<div class="drawer__meta">' + A.esc(activity.area || "—") + (activity.executante ? " · " + A.esc(activity.executante) : "") +
          (activity.termino ? " · prazo " + A.fmtDate(activity.termino) : "") + "</div>" +
          (eff.fiscalObra || eff.fiscalSeguranca ? '<div class="drawer__meta">' +
            (eff.fiscalObra ? "👷 Fiscal de campo: " + A.esc(eff.fiscalObra) : "") +
            (eff.fiscalObra && eff.fiscalSeguranca ? " · " : "") +
            (eff.fiscalSeguranca ? "🦺 Fiscal de segurança: " + A.esc(eff.fiscalSeguranca) : "") +
            "</div>" : "") +
          "</div>" +
          '<button type="button" class="drawer__close" id="pguDrawerClose">✕</button></div>' +

        '<div class="drawer__field"><label class="drawer__label">Status</label>' + chipsHtml("pguStatusChips", "data-status", STATUS_OPTIONS, eff.status) + "</div>" +
        '<div class="drawer__field"><label class="drawer__label">Percentual de avanço</label>' + chipsHtml("pguPercentChips", "data-percent", PERCENT_OPTIONS, eff.percent, " percent-chip") + "</div>" +
        '<div class="drawer__field"><label class="drawer__label">Tendência de conclusão</label>' + chipsHtml("pguTendenciaChips", "data-tendencia", TENDENCIA_OPTIONS, eff.tendencia) + "</div>" +
        '<div class="drawer__field"><label class="drawer__label">Início tendência (previsão real)</label><input type="datetime-local" id="pguInicioTendencia" value="' +
          A.esc(ov.inicioTendencia || (eff.isTendenciaAuto ? "" : eff.inicioTendencia)) + '"></div>' +
        '<div class="drawer__field"><label class="drawer__label">Término tendência (previsão real)</label><input type="datetime-local" id="pguTerminoTendencia" value="' +
          A.esc(ov.terminoTendencia || (eff.isTendenciaAuto ? "" : eff.terminoTendencia)) + '"></div>' +
        (eff.isTendenciaBaseline ? '<div class="drawer__updated" style="text-align:left;background:var(--light-gray);border-radius:6px;padding:8px 10px;margin-top:-8px;">📐 Ainda igual à linha de base. Muda pra "tendência" de verdade quando você salvar (mesmo sem editar a data).</div>' : "") +
        (eff.isTendenciaAuto ? '<div class="drawer__updated" style="text-align:left;background:rgba(60,181,229,0.1);border-radius:6px;padding:8px 10px;margin-top:-8px;">🔄 Reprogramado automaticamente (atraso em predecessora): ' +
          A.esc(fmtDataHora(eff.inicioTendencia)) + " → " + A.esc(fmtDataHora(eff.terminoTendencia)) + ". Preencha acima pra confirmar ou ajustar.</div>" : "") +
        '<div class="drawer__field"><label class="drawer__label">Justificativa (se houver desvio)</label><textarea id="pguJustificativa" placeholder="Explique o motivo se a atividade estiver atrasada/adiantada em relação ao previsto...">' + A.esc(eff.justificativa) + "</textarea></div>" +
        '<div class="drawer__field"><label class="drawer__label">Impedimento (se houver)</label>' + chipsHtml("pguImpedimentoChips", "data-impedimento", IMPEDIMENTO_OPTIONS, eff.impedimento, " impediment") + "</div>" +
        '<div class="drawer__field"><label class="drawer__label">Turno</label>' + chipsHtml("pguTurnoChips", "data-turno", TURNO_OPTIONS, eff.turno) + "</div>" +
        '<div class="drawer__field"><label class="drawer__label">Encarregado</label><input type="text" id="pguEncarregado" value="' + A.esc(eff.encarregado) + '" placeholder="Nome do encarregado"></div>' +
        '<div class="drawer__field"><label class="drawer__label">Observações</label><textarea id="pguObservacoes" placeholder="Observações de campo...">' + A.esc(eff.observacoes) + "</textarea></div>" +
        '<button type="button" class="drawer__save" id="pguDrawerSave">💾 Salvar atualização</button>' +
        (eff.atualizadoEm ? '<div class="drawer__updated">Última atualização: ' + A.esc(eff.atualizadoEm) + "</div>" : "") +
        '<div class="drawer__updated">Ao salvar, fica visível pra todo mundo em campo (sincroniza sozinho).</div>' +
      "</div>";
    document.body.appendChild(overlay);

    var state = { status: eff.status, percent: eff.percent, tendencia: eff.tendencia, impedimento: eff.impedimento, turno: eff.turno };
    wireChips("pguStatusChips", "data-status", state, "status", false);
    wireChips("pguPercentChips", "data-percent", state, "percent", true);
    wireChips("pguTendenciaChips", "data-tendencia", state, "tendencia", false);
    wireChips("pguImpedimentoChips", "data-impedimento", state, "impedimento", false);
    wireChips("pguTurnoChips", "data-turno", state, "turno", false);

    // Ao mudar o % de avanco, atualiza o status junto (0% = nao iniciada, 100% = concluida, meio = em
    // andamento) -- roda depois do wireChips acima, entao o state.percent ja esta atualizado aqui.
    A.$("pguPercentChips").querySelectorAll(".chip-option").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (state.percent === null || state.percent === undefined) return;
        var novoStatus = statusFromPercent(state.percent);
        state.status = novoStatus;
        A.$("pguStatusChips").querySelectorAll(".chip-option").forEach(function (b) {
          b.classList.toggle("active", b.getAttribute("data-status") === novoStatus);
        });
      });
    });

    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeDrawer(); });
    A.$("pguDrawerClose").addEventListener("click", closeDrawer);

    A.$("pguDrawerSave").addEventListener("click", function () {
      var novo = {
        status: state.status || activity.status,
        percent: (state.percent !== null && state.percent !== undefined) ? state.percent : eff.percent,
        tendencia: state.tendencia || "",
        inicioTendencia: A.$("pguInicioTendencia").value || "",
        terminoTendencia: A.$("pguTerminoTendencia").value || "",
        impedimento: state.impedimento || "",
        encarregado: A.$("pguEncarregado").value.trim(),
        turno: state.turno || "",
        observacoes: A.$("pguObservacoes").value.trim(),
        justificativa: A.$("pguJustificativa").value.trim(),
        atualizadoEm: new Date().toLocaleString("pt-BR")
      };
      var overridesNow = loadOverrides();
      var anterior = overridesNow[activity.uid] || {};
      overridesNow[activity.uid] = novo;
      saveOverrides(overridesNow);
      pushHistory({
        uid: activity.uid, nome: activity.nome, quando: novo.atualizadoEm,
        statusAntigo: anterior.status || activity.status, statusNovo: novo.status,
        percentAntigo: (anterior.percent !== undefined && anterior.percent !== null) ? anterior.percent : activity.percentComplete,
        percentNovo: novo.percent
      });
      recomputeCascade();
      closeDrawer();
      A.toast("Atividade atualizada.");
      if (onSaved) onSaved();
    });
  }

  // ------------------------------------------------------------ Tab: Hoje

  var hojeSelectedDate = null; // yyyy-MM-dd escolhido na linha do tempo da PGU (persiste entre re-renders)
  var pguModo = "encarregado"; // "encarregado" | "gestao" -- persiste entre re-renders
  var meuTurno = null; // turno escolhido no Modo Encarregado (07h–17h / 17h–00h / 00h–07h)
  var lastEffs = [];
  // "fiscalObra|disciplina" -> turno predominante desse fiscal NAQUELA disciplina (maioria das
  // atividades dele ali), recalculado a cada renderAll(). Separado por disciplina porque um mesmo
  // fiscal pode atender mais de uma disciplina em turnos diferentes -- calcular só por fiscal
  // misturaria isso e geraria falso positivo. Usado só pra sinalizar quando uma atividade tem
  // turno (calculado pela hora) diferente do habitual do fiscal nessa disciplina.
  var FISCAL_TURNO_PREDOMINANTE = {};
  function fiscalDisciplinaKey(fiscal, disciplina) { return fiscal + "|" + (disciplina || ""); }
  function computeFiscalTurnoPredominante(effs) {
    var tally = {};
    effs.forEach(function (e) {
      if (!e.fiscalObra || !e.turno) return;
      var k = fiscalDisciplinaKey(e.fiscalObra, e.disciplina);
      if (!tally[k]) tally[k] = {};
      tally[k][e.turno] = (tally[k][e.turno] || 0) + 1;
    });
    var result = {};
    Object.keys(tally).forEach(function (k) {
      var counts = tally[k], best = null, bestCount = 0, total = 0;
      Object.keys(counts).forEach(function (turno) {
        total += counts[turno];
        if (counts[turno] > bestCount) { bestCount = counts[turno]; best = turno; }
      });
      // só marca "turno habitual" com uma amostra minima, senão uma combinação com 1 atividade
      // sempre "bate" trivialmente com ela mesma e o aviso perde o sentido.
      if (total >= 3 && best) result[k] = best;
    });
    return result;
  }
  function turnoHabitualDe(e) {
    return FISCAL_TURNO_PREDOMINANTE[fiscalDisciplinaKey(e.fiscalObra, e.disciplina)];
  }
  function turnoDivergente(e) {
    var esperado = turnoHabitualDe(e);
    return !!(esperado && e.turno && e.turno !== esperado);
  }
  // Quais grupos (TR/componente/disciplina) estao abertos na arvore -- guardado por chave estavel
  // pra sobreviver a um re-render (ex.: quando o encarregado preenche o avanco de uma atividade),
  // em vez de recolher tudo de volta toda vez que a tela atualiza.
  var groupOpenState = {};
  // Cada filtro agora é uma lista (caixa de seleção com checkbox) em vez de um valor único.
  var hojeFilters = { turno: [], executante: [], encarregado: [], fiscalObra: [], fiscalSeguranca: [] };

  function applyHojeFilters(effs) {
    return effs.filter(function (e) {
      if (hojeFilters.turno.length && hojeFilters.turno.indexOf(e.turno) < 0) return false;
      if (hojeFilters.executante.length && hojeFilters.executante.indexOf(e.executante) < 0) return false;
      if (hojeFilters.encarregado.length && hojeFilters.encarregado.indexOf(e.encarregado) < 0) return false;
      if (hojeFilters.fiscalObra.length && hojeFilters.fiscalObra.indexOf(e.fiscalObra) < 0) return false;
      if (hojeFilters.fiscalSeguranca.length && hojeFilters.fiscalSeguranca.indexOf(e.fiscalSeguranca) < 0) return false;
      return true;
    });
  }

  // ---------------------------------------------------------- card de atividade (Modo Encarregado
  // e Modo Gestão) -- substitui a antiga linha de tabela (activity-row). Clicar no corpo do card
  // abre o painel completo (observações, impedimento, tendência etc.); a barra de avanço e os
  // botões de ação rápida ficam por cima disso e nunca deixam o clique "vazar" pro abrir-painel.
  var ICON_POR_DISCIPLINA = { "MECÂNICA": ["🔧", "mec"], "ELÉTRICA": ["⚡", "ele"], "CIVIL": ["🏗️", "civ"] };
  function iconeDisciplina(disc) { return ICON_POR_DISCIPLINA[disc] || ["⚙️", "civ"]; }

  // "yyyy-MM-dd HH:mm" -> só "HH:mm" (o dia já está implícito em qual turno/dia está sendo visto).
  function horaSo(dh) {
    if (!dh) return null;
    var p = String(dh).split(" ");
    return p[1] || null;
  }

  function activityCardHtml(e, showEncarregado) {
    var farol = farolDe(e);
    var ic = iconeDisciplina(e.disciplina);
    // Quando a atividade é o próprio "TR/ativo" (sem componente por baixo, ex.: marcos soltos
    // fora de qualquer TR), area === nome e o card ficava com o mesmo texto duas vezes -- só
    // mostra a área se ela disser algo além do título.
    var mesmoNomeDaArea = (e.area || "").trim().toUpperCase() === (e.nome || "").trim().toUpperCase();
    var partesBreadcrumb = [];
    if (e.area && !mesmoNomeDaArea) partesBreadcrumb.push(A.esc(e.area));
    if (e.componente) partesBreadcrumb.push(A.esc(e.componente));
    if (showEncarregado && e.encarregado) partesBreadcrumb.push(A.esc(e.encarregado));
    var breadcrumb = partesBreadcrumb.join(" · ");

    var hi = horaSo(e.inicioDataHora), ht = horaSo(e.terminoDataHora);
    var horarioHtml = (hi && ht) ? '<div class="pgu-card__horario"><span>🕐 Previsto ' + hi + '–' + ht + "</span></div>" : "";

    var turnoAvisoHtml = turnoDivergente(e)
      ? ' <span class="badge farol-atrasado" title="Turno diferente do habitual do fiscal ' + A.esc(e.fiscalObra) + ' em ' + A.esc(e.disciplina || "—") + ' (normalmente ' + A.esc(turnoHabitualDe(e)) + ')">⚠ atípico</span>'
      : "";

    var obsHtml = e.observacoes ? '<div class="pgu-card__obs">💬 <span><strong>Motivo:</strong> ' + A.esc(e.observacoes) + "</span></div>" : "";

    var pct = Math.round(e.percent || 0);
    var acoesHtml = e.status !== "Concluída"
      ? '<div class="pgu-card__actions">' +
          '<button type="button" class="pgu-act--done" data-pgu-act="done" data-uid="' + A.esc(e.uid) + '">✅ Concluir</button>' +
          '<button type="button" data-pgu-act="andamento" data-uid="' + A.esc(e.uid) + '">🔧 Em andamento</button>' +
          '<button type="button" class="pgu-act--prob" data-pgu-act="problema" data-uid="' + A.esc(e.uid) + '">⚠️ Problema</button>' +
        "</div>"
      : "";

    return '<div class="pgu-card pgu-card--' + farol + '">' +
      '<div class="pgu-card__stripe"></div>' +
      '<div style="flex:1;">' +
        '<div class="pgu-card__body pgu-open" data-uid="' + A.esc(e.uid) + '">' +
          '<div class="pgu-card__top">' +
            '<div class="pgu-card__icon pgu-card__icon--' + ic[1] + '">' + ic[0] + "</div>" +
            '<div class="pgu-card__info">' +
              '<div class="pgu-card__nome">' + A.esc(e.nome) + "</div>" +
              (breadcrumb ? '<div class="pgu-card__breadcrumb">' + breadcrumb + "</div>" : "") +
              '<div class="pgu-card__badges">' +
                '<span class="badge ' + statusBadgeClass(e.status) + '">' + A.esc(e.status) + "</span>" +
                (e.turno ? '<span class="badge dim">🕐 ' + A.esc(e.turno) + "</span>" : "") +
                turnoAvisoHtml +
                (e.herancaDeTurno ? '<span class="badge" style="background:#7B61FF;" title="Não foi concluída no turno ' + A.esc(e.herancaDeTurno) + ' e foi passada pra cá">↪ Herdada de ' + A.esc(e.herancaDeTurno) + "</span>" : "") +
              "</div>" +
              horarioHtml +
              '<div class="pgu-card__pct-wrap">' +
                '<div class="pgu-card__pct-track" data-pct-track="' + A.esc(e.uid) + '">' +
                  '<div class="pgu-card__pct-track-bg"></div>' +
                  '<div class="pgu-card__pct-fill" style="width:' + pct + '%;"></div>' +
                  '<div class="pgu-card__pct-thumb" style="left:' + pct + '%;"></div>' +
                "</div>" +
                '<div class="pgu-card__pct-num" data-pct-num="' + A.esc(e.uid) + '">' + pct + "%</div>" +
              "</div>" +
              obsHtml +
            "</div>" +
          "</div>" +
        "</div>" +
        acoesHtml +
      "</div>" +
    "</div>";
  }

  var TODA_PGU = "ALL";

  function pguDayChipsHtml(pguInicio, pguFim, hojeStr, selecionado) {
    if (!pguInicio || !pguFim) return "";
    var chips = '<button type="button" class="chip-option' + (selecionado === TODA_PGU ? " active" : "") + '" data-dia="' + TODA_PGU + '">📅 Toda a PGU</button>';
    var cur = new Date(pguInicio + "T00:00:00");
    var end = new Date(pguFim + "T00:00:00");
    while (cur <= end) {
      var d = toISODate(cur);
      var isHoje = d === hojeStr;
      var isSel = d === selecionado;
      chips += '<button type="button" class="chip-option' + (isSel ? " active" : "") + '" data-dia="' + d + '" style="position:relative;">' +
        d.slice(8, 10) + "/" + d.slice(5, 7) + (isHoje ? '<span style="position:absolute;top:-6px;right:-4px;font-size:9px;">📍</span>' : "") +
        "</button>";
      cur.setDate(cur.getDate() + 1);
    }
    return '<div class="chip-grid">' + chips + "</div>";
  }

  var SEM_CLASSIFICACAO = "Sem classificação";

  function groupBy(effs, keyFn) {
    var groups = {}, order = [];
    effs.forEach(function (e) {
      var k = keyFn(e) || SEM_CLASSIFICACAO;
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(e);
    });
    return order.map(function (k) { return { label: k, itens: groups[k] }; });
  }

  // Cor de destaque por disciplina -- pra bater o olho rapido de que tipo de servico e (e "Limpeza"
  // pras atividades que nao caem em nenhuma pasta de disciplina do cronograma).
  function disciplinaColor(nome) {
    var n = (nome || "").toUpperCase();
    if (n.indexOf("MEC") === 0) return "#3CB5E5";
    if (n.indexOf("EL") === 0) return "#F2A900";
    if (n.indexOf("CIV") === 0) return "#7B61FF";
    if (n.indexOf("LIMP") === 0) return "#2E9E4B";
    return "#747678";
  }

  // Marcos soltos (fora de qualquer TR) viram seu próprio grupo de "TR/ativo" com o mesmo nome da
  // única atividade dentro dele -- mostrar o cabeçalho da pasta E o card, os dois com o mesmo
  // texto, é redundante. Nesses casos, pula o cabeçalho e mostra só o card direto.
  function grupoRedundante(grupo) {
    return grupo.itens.length === 1 && (grupo.itens[0].nome || "").trim().toUpperCase() === (grupo.label || "").trim().toUpperCase();
  }

  // Agrupa as atividades por TR/ativo -> Componente -> Disciplina (o mesmo WBS do cronograma da
  // PGU) em vez de lista lisa. Cada nivel tem um estilo bem diferente (cartao / faixa azul /
  // pilula colorida) pra ficar facil de distinguir onde voce esta na hierarquia.
  // Se o grupo nao tiver classificacao, nao mostra a pilula/faixa "Sem classificação" -- so joga a
  // atividade direto na lista, sem cabecalho nem details (nada pra abrir/fechar ali).
  function groupedActivityListHtml(effs) {
    if (!effs.length) return '<div class="table-caption">Nenhuma atividade encontrada com os filtros atuais.</div>';
    var porTR = groupBy(effs, function (e) { return e.area; });
    var html = porTR.map(function (trGroup) {
      var porComp = groupBy(trGroup.itens, function (e) { return e.componente; });
      var compHtml = porComp.map(function (compGroup) {
        var porDisc = groupBy(compGroup.itens, function (e) { return e.disciplina; });
        var discHtml = porDisc.map(function (discGroup) {
          var body = '<div class="pgu-group__body">' + discGroup.itens.map(function (e) { return activityCardHtml(e, true); }).join("") + "</div>";
          if (discGroup.label === SEM_CLASSIFICACAO) return body;
          var key = "disc:" + trGroup.label + "|" + compGroup.label + "|" + discGroup.label;
          return '<details class="pgu-group-disciplina" data-gkey="' + A.esc(key) + '"' + (groupOpenState[key] ? " open" : "") + '><summary style="background:' + disciplinaColor(discGroup.label) + ';">' +
            A.esc(discGroup.label) +
            '<span class="pgu-group__count">' + discGroup.itens.length + "</span>" +
            "</summary>" + body + "</details>";
        }).join("");
        if (compGroup.label === SEM_CLASSIFICACAO) return '<div class="pgu-group__body">' + discHtml + "</div>";
        var keyC = "comp:" + trGroup.label + "|" + compGroup.label;
        return '<details class="pgu-group-componente" data-gkey="' + A.esc(keyC) + '"' + (groupOpenState[keyC] ? " open" : "") + '><summary>' +
          "⚙️ " + A.esc(compGroup.label) +
          '<span class="pgu-group__count">' + compGroup.itens.length + "</span>" +
          "</summary>" +
          '<div class="pgu-group__body">' + discHtml + "</div>" +
          "</details>";
      }).join("");
      if (trGroup.label === SEM_CLASSIFICACAO || grupoRedundante(trGroup)) return '<div class="pgu-group__body">' + compHtml + "</div>";
      var keyT = "tr:" + trGroup.label;
      return '<details class="pgu-group-tr" data-gkey="' + A.esc(keyT) + '"' + (groupOpenState[keyT] ? " open" : "") + '><summary>' +
        "🛠️ " + A.esc(trGroup.label) +
        '<span class="pgu-group__count">' + trGroup.itens.length + " atividades</span>" +
        "</summary>" +
        '<div class="pgu-group__body">' + compHtml + "</div>" +
        "</details>";
    }).join("");
    return '<div id="pguGroupedTree">' + html + "</div>";
  }

  // Agrupamento de 2 níveis (TR/ativo -> Componente, nível 4 do cronograma: ACIONAMENTO, CHUTE,
  // COMISSIONAMENTO etc.) usado no Modo Encarregado -- mais simples que a árvore de 3 níveis do
  // Modo Gestão (sem a disciplina), mas ainda separa por equipamento/sistema dentro do TR.
  function groupedByTrOnlyHtml(effs, showEncarregado) {
    if (!effs.length) return '<div class="table-caption">Nenhuma atividade encontrada.</div>';
    var porTR = groupBy(effs, function (e) { return e.area; });
    // Ordena os GRUPOS pelo nome do TR (TCLD 0101SA-01, -02, -03...) -- sem isso, o grupo que
    // aparecia primeiro era o que por acaso tivesse a atividade mais cedo naquele turno/dia (ex.:
    // TR-04 antes do TR-01), o que não bate com a ordem do cronograma. As atividades DENTRO de
    // cada grupo continuam na ordem cronológica (já vêm ordenadas de quem chamou essa função).
    porTR.sort(function (a, b) { return a.label < b.label ? -1 : (a.label > b.label ? 1 : 0); });
    var html = porTR.map(function (trGroup) {
      var porComp = groupBy(trGroup.itens, function (e) { return e.componente; });
      var compHtml = porComp.map(function (compGroup) {
        var body = '<div class="pgu-group__body">' + compGroup.itens.map(function (e) { return activityCardHtml(e, !!showEncarregado); }).join("") + "</div>";
        if (compGroup.label === SEM_CLASSIFICACAO) return body;
        var keyC = "comp-enc:" + trGroup.label + "|" + compGroup.label;
        return '<details class="pgu-group-componente" data-gkey="' + A.esc(keyC) + '"' + (groupOpenState[keyC] ? " open" : "") + '><summary>' +
          "⚙️ " + A.esc(compGroup.label) +
          '<span class="pgu-group__count">' + compGroup.itens.length + " atividade" + (compGroup.itens.length === 1 ? "" : "s") + "</span>" +
          "</summary>" + body + "</details>";
      }).join("");
      if (trGroup.label === SEM_CLASSIFICACAO || grupoRedundante(trGroup)) return '<div class="pgu-group__body">' + compHtml + "</div>";
      var key = "tr-enc:" + trGroup.label;
      return '<details class="pgu-group-tr" data-gkey="' + A.esc(key) + '"' + (groupOpenState[key] ? " open" : "") + '><summary>' +
        "🛠️ " + A.esc(trGroup.label) +
        '<span class="pgu-group__count">' + trGroup.itens.length + " atividade" + (trGroup.itens.length === 1 ? "" : "s") + "</span>" +
        "</summary>" +
        '<div class="pgu-group__body">' + compHtml + "</div>" +
        "</details>";
    }).join("");
    return '<div id="pguGroupedTree">' + html + "</div>";
  }

  // ---------------------------------------------------------- Modo Encarregado / Modo Gestão

  function modeSwitchHtml() {
    return '<div class="pgu-modeswitch">' +
      '<button type="button" class="' + (pguModo === "encarregado" ? "active" : "") + '" data-pgu-modo="encarregado">👷 Modo Encarregado</button>' +
      '<button type="button" class="' + (pguModo === "gestao" ? "active" : "") + '" data-pgu-modo="gestao">🖥️ Modo Gestão</button>' +
    "</div>";
  }

  // Detecta o turno pela hora do aparelho (mesma regra do cronograma: 07h-17h / 17h-00h / 00h-07h)
  // -- so pra JA SUGERIR o turno certo na tela de escolha; o encarregado sempre confirma antes.
  function turnoAtualPorHora() {
    var h = new Date().getHours();
    if (h >= 7 && h < 17) return "07h–17h";
    if (h >= 17) return "17h–00h";
    return "00h–07h";
  }

  function nextTurno(t) {
    var i = TURNO_OPTIONS.indexOf(t);
    return TURNO_OPTIONS[(i + 1) % TURNO_OPTIONS.length];
  }

  // Fronteira (hora decimal, base 0-24) de cada turno -- "17h–00h" termina em 24 (meia-noite).
  var TURNO_FIM_HORA = { "07h–17h": 17, "17h–00h": 24, "00h–07h": 7 };

  // true = a atividade JA ESTAVA programada pra ultrapassar o turno dela (tarefa comprida, normal,
  // não é atraso de ninguém). false = deveria ter terminado dentro do turno -- se não terminou,
  // isso sim é atraso de verdade (ver "Encerrar turno").
  function programadaParaUltrapassarTurno(e) {
    if (!e.turno || !e.inicioDataHora || !e.terminoDataHora) return false;
    var ini = parseDataHora(e.inicioDataHora), fim = parseDataHora(e.terminoDataHora);
    if (!ini || !fim) return false;
    var horaLimite = TURNO_FIM_HORA[e.turno];
    if (horaLimite === undefined) return false;
    var fimDoTurno = new Date(ini);
    if (horaLimite === 24) { fimDoTurno.setDate(fimDoTurno.getDate() + 1); fimDoTurno.setHours(0, 0, 0, 0); }
    else { fimDoTurno.setHours(horaLimite, 0, 0, 0); }
    return fim > fimDoTurno;
  }

  // Se a atividade tem uma predecessora (ligação Término-Início) que também não foi concluída, o
  // motivo dela não ter terminado já está explicado por isso -- evita perguntar de novo no
  // "Encerrar turno". Recebe a atividade CRUA (com .predecessores), não o effective().
  function predecessoraPendente(a) {
    if (!a || !a.predecessores || !a.predecessores.length) return null;
    var overrides = loadOverrides();
    for (var i = 0; i < a.predecessores.length; i++) {
      var p = a.predecessores[i];
      if (p.tipo !== 1) continue;
      var predAtividade = activitiesByUid[p.uid];
      if (!predAtividade) continue;
      var predEff = effective(predAtividade, overrides[p.uid]);
      if (predEff.status !== "Concluída") return predEff;
    }
    return null;
  }

  function turnoPickerHtml() {
    var sugerido = turnoAtualPorHora();
    return '<div class="pgu-turno-picker">' +
      "<h1>🕐 Qual o seu turno?</h1>" +
      "<p>A gente já sugere o turno pela hora do seu aparelho — confirme ou troque se não bater.</p>" +
      '<div class="pgu-turnos">' +
      TURNO_OPTIONS.map(function (t) {
        var isSugerido = t === sugerido;
        return '<button type="button" class="pgu-turno-btn' + (isSugerido ? " pgu-turno-btn--sugerido" : "") + '" data-pick-turno="' + A.esc(t) + '">' +
          "<div>" + A.esc(t) + "</div>" +
          (isSugerido ? '<div class="pgu-turno-btn__tag">🕐 agora</div>' : "") +
          "</button>";
      }).join("") +
      "</div>" +
    "</div>";
  }

  // Faixa com a linha do tempo da PGU (existente) + a "corrida" (avanço real de HOJE x meta
  // esperada pra hoje). A corrida não muda ao clicar em outro dia -- o site não guarda um
  // histórico diário de %, então mostrar isso pra dias passados seria inventar dado. Os chips de
  // dia continuam controlando só qual dia a lista de atividades abaixo mostra (como já era).
  function raceBannerHtml(effsAll, pguInicio, pguFim, hojeStr, diaSelecionado) {
    var diasParaInicio = pguInicio ? Math.round((new Date(pguInicio) - new Date(hojeStr)) / 86400000) : null;
    var diasParaFim = pguFim ? Math.round((new Date(pguFim) - new Date(hojeStr)) / 86400000) : null;
    var vendoHojeReal = diaSelecionado === hojeStr;

    var bannerTexto, bannerValor;
    if (diasParaInicio !== null && diasParaInicio > 0) {
      bannerTexto = "A PGU começa em"; bannerValor = diasParaInicio + " dia" + (diasParaInicio === 1 ? "" : "s");
    } else if (diasParaFim !== null && diasParaFim >= 0) {
      bannerTexto = "Faltam pra terminar a PGU"; bannerValor = diasParaFim + " dia" + (diasParaFim === 1 ? "" : "s");
    } else {
      bannerTexto = "PGU"; bannerValor = pguFim ? "Concluída em " + A.fmtDate(pguFim) : "Sem datas";
    }

    var faroisCount = { verde: 0, amarelo: 0, vermelho: 0 };
    effsAll.forEach(function (e) { faroisCount[farolDe(e)]++; });
    var faroGeral = faroisCount.vermelho > 0 ? "vermelho" : (faroisCount.amarelo > 0 ? "amarelo" : "verde");

    // A corrida só faz sentido depois que a PGU comecou (antes disso e sempre 0% x 0%).
    var mostrarCorrida = pguInicio && pguFim && hojeStr >= pguInicio;
    var corridaHtml = "";
    if (mostrarCorrida) {
      var pctGeral = effsAll.length ? Math.round(effsAll.reduce(function (s, e) { return s + (e.percent || 0); }, 0) / effsAll.length) : 0;
      var totalDias = Math.round((new Date(pguFim) - new Date(pguInicio)) / 86400000) || 1;
      var diasDecorridos = Math.max(0, Math.round((new Date(hojeStr) - new Date(pguInicio)) / 86400000));
      var metaPct = Math.max(0, Math.min(100, Math.round((diasDecorridos / totalDias) * 100)));
      var adiantado = pctGeral >= metaPct;
      corridaHtml = '<div class="pgu-race" style="flex:1 1 260px;">' +
        '<div class="pgu-race__track">' +
          '<div class="pgu-race__track-bg"></div>' +
          '<div class="pgu-race__fill" style="width:' + pctGeral + '%;"></div>' +
          '<div class="pgu-race__meta" style="left:' + metaPct + '%;"><span class="pgu-race__meta-label">meta hoje</span></div>' +
          '<div class="pgu-race__runner" style="left:' + pctGeral + '%;">👷</div>' +
          '<div class="pgu-race__flag">🏁</div>' +
        "</div>" +
        '<div class="pgu-race__caption">' + (adiantado ? "🟢 Adiantado" : "🟠 Atrás") + ' do previsto pra hoje (' + pctGeral + '% feito · meta ' + metaPct + '%)</div>' +
      "</div>";
    }

    return '<div class="countdown-banner">' +
      '<div><div class="countdown-banner__title">' + A.esc(bannerTexto) + '</div><div class="countdown-banner__value">' + A.esc(bannerValor) + "</div></div>" +
      corridaHtml +
      '<div class="countdown-banner__timeline" title="Linha do tempo da PGU — 📍 = hoje">' + pguDayChipsHtml(pguInicio, pguFim, hojeStr, diaSelecionado) + "</div>" +
      (vendoHojeReal ? "" : '<button type="button" class="countdown-banner__voltar" id="pguVoltarHoje">↩ Hoje (' + A.fmtDate(hojeStr) + ")</button>") +
      '<div style="font-size:38px;" title="Farol geral da PGU">' + farolEmoji(faroGeral) + "</div>" +
    "</div>";
  }

  // Grupo de botoes (igual a linha do tempo) para um filtro de valor unico, com um botao "Todos"
  // pra limpar. options: array de strings.
  function chipFilterHtml(dataAttr, options, current, allLabel) {
    var html = '<button type="button" class="chip-option' + (!current ? " active" : "") + '" ' + dataAttr + '="">' + (allLabel || "Todos") + "</button>";
    html += options.map(function (opt) {
      return '<button type="button" class="chip-option' + (current === opt ? " active" : "") + '" ' + dataAttr + '="' + A.esc(opt) + '">' + A.esc(opt) + "</button>";
    }).join("");
    return '<div class="chip-grid">' + html + "</div>";
  }

  // Chips "📅 Toda a PGU" + um por dia, e "🕐 Todos os turnos" + um por turno -- filtros do Modo
  // Gestão, independentes do dia escolhido no banner de cima (que só vale pro Modo Encarregado).
  var pguGestaoDia = null;
  var pguGestaoTurno = null;

  function gestaoDiaChipsHtml(pguInicio, pguFim, hojeStr) {
    if (!pguGestaoDia) pguGestaoDia = TODA_PGU;
    var chips = '<button type="button" class="pgu-gestao-chip' + (pguGestaoDia === TODA_PGU ? " pgu-gestao-chip--sel" : "") + '" data-pick-dia-gestao="' + TODA_PGU + '">📅 Toda a PGU</button>';
    if (pguInicio && pguFim) {
      var cur = new Date(pguInicio + "T00:00:00");
      var end = new Date(pguFim + "T00:00:00");
      while (cur <= end) {
        var d = toISODate(cur);
        var isHoje = d === hojeStr;
        var isSel = d === pguGestaoDia;
        chips += '<button type="button" class="pgu-gestao-chip' + (isHoje ? " pgu-gestao-chip--hoje" : "") + (isSel ? " pgu-gestao-chip--sel" : "") + '" data-pick-dia-gestao="' + d + '">' +
          d.slice(8, 10) + "/" + d.slice(5, 7) + (isHoje ? '<span class="pgu-gestao-chip__pin">📍</span>' : "") +
        "</button>";
        cur.setDate(cur.getDate() + 1);
      }
    }
    return '<div class="pgu-gestao-daybar">' + chips + "</div>";
  }

  function gestaoTurnoChipsHtml() {
    if (!pguGestaoTurno) pguGestaoTurno = TODA_PGU;
    var chips = '<button type="button" class="pgu-gestao-chip' + (pguGestaoTurno === TODA_PGU ? " pgu-gestao-chip--sel" : "") + '" data-pick-turno-gestao="' + TODA_PGU + '">🕐 Todos os turnos</button>';
    chips += TURNO_OPTIONS.map(function (t) {
      var isSel = t === pguGestaoTurno;
      return '<button type="button" class="pgu-gestao-chip' + (isSel ? " pgu-gestao-chip--sel" : "") + '" data-pick-turno-gestao="' + A.esc(t) + '">' + A.esc(t) + "</button>";
    }).join("");
    return '<div class="pgu-gestao-daybar">' + chips + "</div>";
  }

  // Corpo do Modo Gestão: painel geral (dia + turno em chips) e as atividades agrupadas só por
  // TR/ativo em cards -- igual ao Modo Encarregado, só que sem travar num turno só.
  function renderModoGestaoBody(effsAll, hojeStr, pguInicio, pguFim) {
    if (!pguGestaoDia) pguGestaoDia = TODA_PGU;
    if (!pguGestaoTurno) pguGestaoTurno = TODA_PGU;

    var filtradas = effsAll.filter(function (e) {
      var passaDia = pguGestaoDia === TODA_PGU || (e.inicio && e.termino && e.inicio <= pguGestaoDia && e.termino >= pguGestaoDia);
      var passaTurno = pguGestaoTurno === TODA_PGU || e.turno === pguGestaoTurno;
      return passaDia && passaTurno;
    });
    var diaFmt = pguGestaoDia === TODA_PGU ? "todos os dias" : (pguGestaoDia.slice(8, 10) + "/" + pguGestaoDia.slice(5, 7));
    var turnoFmt = pguGestaoTurno === TODA_PGU ? "todos os turnos" : "turno " + pguGestaoTurno;

    return '<div class="pgu-turno-header" style="background:linear-gradient(135deg, var(--vale-blue), #1f6fa0);">' +
        '<div><div class="pgu-turno-header__title">🖥️ Visão geral — Modo Gestão</div>' +
        '<div class="pgu-turno-header__sub">Vendo ' + A.esc(diaFmt) + ' · ' + A.esc(turnoFmt) + ' · ' + A.fmtNum(filtradas.length) + ' de ' + A.fmtNum(effsAll.length) + ' atividades</div></div>' +
        '<div class="pgu-turno-header__actions">' +
          '<a class="pgu-btn-ghost" href="report.html" target="_blank" rel="noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;">📈 Report</a>' +
          '<button type="button" class="pgu-btn-ghost" id="pguPdfBtn">📄 PDF</button>' +
        "</div>" +
      "</div>" +
      gestaoDiaChipsHtml(pguInicio, pguFim, hojeStr) +
      gestaoTurnoChipsHtml() +
      (filtradas.length ? groupedByTrOnlyHtml(filtradas, true) :
        '<div class="panel"><div class="table-caption">Nenhuma atividade com esses filtros.</div></div>');
  }

  // Corpo do Modo Encarregado: card por atividade do turno escolhido, agrupado só por TR/ativo.
  function renderModoEncarregadoBody(effsAll, diaStr, hojeStr) {
    var tAtual = meuTurno;
    var vendoTodaPgu = diaStr === TODA_PGU;
    var doDia = vendoTodaPgu ? effsAll : effsAll.filter(function (e) { return e.inicio && e.termino && e.inicio <= diaStr && e.termino >= diaStr; });
    var doTurno = doDia.filter(function (e) { return e.turno === tAtual; })
      .sort(function (a, b) {
        var da = a.inicioDataHora || "", db = b.inicioDataHora || "";
        return da < db ? -1 : (da > db ? 1 : 0);
      });

    var pendentes = doTurno.filter(function (e) { return e.status !== "Concluída"; });
    var herdadas = doTurno.filter(function (e) { return e.herancaDeTurno; });
    var atrasadas = doTurno.filter(function (e) { return e.status === "Atrasada"; }).length;
    var pctMedio = doTurno.length ? Math.round(doTurno.reduce(function (s, e) { return s + (e.percent || 0); }, 0) / doTurno.length) : 0;
    var tituloDia = vendoTodaPgu ? "todos os dias" : (diaStr === hojeStr ? "hoje" : A.fmtDate(diaStr));
    // Encerra o turno do dia que está sendo visualizado nos chips (não precisa bater com a data
    // real do relógio) -- só não faz sentido em "Toda a PGU", onde não há um turno único pra fechar.
    var podeEncerrar = pendentes.length > 0 && diaStr !== TODA_PGU;

    return '<div class="pgu-turno-header">' +
        '<div><div class="pgu-turno-header__title">🕐 Turno ' + A.esc(tAtual) + '</div>' +
        '<div class="pgu-turno-header__sub">Vendo ' + A.esc(tituloDia) + ' · atividades programadas pra esse turno</div></div>' +
        '<div class="pgu-turno-header__actions">' +
          '<button type="button" class="pgu-btn-ghost" id="pguPdfBtn">📄 PDF</button>' +
          (podeEncerrar ? '<button type="button" class="pgu-btn-ghost pgu-btn-ghost--danger" id="pguEncerrarTurno">🔒 Encerrar turno</button>' : "") +
          '<button type="button" class="pgu-btn-ghost" id="pguTrocarTurno">Trocar turno</button>' +
        "</div>" +
      "</div>" +
      '<div class="kpi-grid">' +
        kpiCard("📋", "Atividades no turno", A.fmtNum(doTurno.length)) +
        kpiCard("⏱️", "Atrasadas", A.fmtNum(atrasadas), atrasadas ? "bad" : "") +
        kpiCard("📊", "Avanço médio", pctMedio + "%", "blue") +
      "</div>" +
      (herdadas.length ? '<div class="pgu-inherit-note">ℹ️ ' + herdadas.length + ' atividade(s) chegaram de um turno anterior sem terem sido concluídas lá (marcadas com ↪ abaixo).</div>' : "") +
      '<div class="panel">' +
        (doTurno.length ? groupedByTrOnlyHtml(doTurno) : '<div class="table-caption">Nenhuma atividade programada pra este turno. 🎉</div>') +
      "</div>";
  }

  function renderHoje(effsAll) {
    lastEffs = effsAll;
    var container = A.$("pguHojeContent");
    var hojeReal = new Date(); hojeReal.setHours(0, 0, 0, 0);
    var hojeStr = toISODate(hojeReal);

    // Datas/contagem regressiva sempre baseadas no conjunto completo (o cronograma da PGU nao muda com o filtro)
    var datas = [];
    effsAll.forEach(function (e) { if (e.inicio) datas.push(e.inicio); if (e.termino) datas.push(e.termino); });
    var pguInicio = datas.length ? datas.reduce(function (a, b) { return a < b ? a : b; }) : null;
    var pguFim = datas.length ? datas.reduce(function (a, b) { return a > b ? a : b; }) : null;

    if (!hojeSelectedDate) {
      hojeSelectedDate = (pguInicio && hojeStr < pguInicio) ? pguInicio : ((pguFim && hojeStr > pguFim) ? pguFim : hojeStr);
    }
    var diaStr = hojeSelectedDate;

    var bodyHtml;
    if (pguModo === "gestao") {
      bodyHtml = renderModoGestaoBody(effsAll, hojeStr, pguInicio, pguFim);
    } else if (!meuTurno) {
      bodyHtml = turnoPickerHtml();
    } else {
      bodyHtml = renderModoEncarregadoBody(effsAll, diaStr, hojeStr);
    }

    // A faixa "A PGU começa em"/corrida só aparece no Modo Encarregado -- no Modo Gestão os
    // próprios chips de dia/turno (dentro do corpo) já cobrem a navegação por data.
    var bannerHtml = pguModo === "gestao" ? "" : raceBannerHtml(effsAll, pguInicio, pguFim, hojeStr, diaStr);
    container.innerHTML = modeSwitchHtml() + bannerHtml + bodyHtml;

    // Guarda o estado aberto/fechado de cada grupo pra sobreviver ao proximo re-render (ver groupOpenState).
    container.querySelectorAll("details[data-gkey]").forEach(function (d) {
      d.addEventListener("toggle", function () { groupOpenState[d.getAttribute("data-gkey")] = d.open; });
    });
  }

  // Ligado uma unica vez (em renderShell) sobre o container fixo da aba "Hoje" -- usa delegacao
  // de evento para nao acumular listeners a cada re-render (renderAll roda toda vez que o
  // encarregado salva uma atualizacao).
  function wireHojeTab() {
    var container = A.$("pguHojeContent");
    // Abre o painel completo -- ignora clique que veio de dentro da barra de avanço (ela tem o
    // próprio gesto de arrastar, ver mais abaixo) pra não abrir o painel sem querer no meio do drag.
    A.onDelegated(container, ".pgu-open", function (el, e) {
      if (e.target.closest(".pgu-card__pct-track")) return;
      var a = activitiesByUid[el.getAttribute("data-uid")];
      if (a) openDrawer(a, renderAll);
    });
    A.onDelegated(container, "[data-dia]", function (el) {
      hojeSelectedDate = el.getAttribute("data-dia");
      renderHoje(lastEffs);
    });
    A.onDelegated(container, "#pguVoltarHoje", function () {
      hojeSelectedDate = toISODate(new Date());
      renderHoje(lastEffs);
    });
    A.onDelegated(container, "#pguGroupExpandAll", function () {
      container.querySelectorAll("#pguGroupedTree details").forEach(function (d) {
        d.open = true;
        var k = d.getAttribute("data-gkey"); if (k) groupOpenState[k] = true;
      });
    });
    A.onDelegated(container, "#pguGroupCollapseAll", function () {
      container.querySelectorAll("#pguGroupedTree details").forEach(function (d) {
        d.open = false;
        var k = d.getAttribute("data-gkey"); if (k) groupOpenState[k] = false;
      });
    });

    // ---- Modo Encarregado / Modo Gestão + escolha de turno ----
    A.onDelegated(container, "[data-pgu-modo]", function (el) {
      pguModo = el.getAttribute("data-pgu-modo");
      renderHoje(lastEffs);
    });
    A.onDelegated(container, "[data-pick-turno]", function (el) {
      meuTurno = el.getAttribute("data-pick-turno");
      renderHoje(lastEffs);
    });
    A.onDelegated(container, "#pguTrocarTurno", function () {
      meuTurno = null;
      renderHoje(lastEffs);
    });
    A.onDelegated(container, "[data-pick-dia-gestao]", function (el) {
      pguGestaoDia = el.getAttribute("data-pick-dia-gestao");
      renderHoje(lastEffs);
    });
    A.onDelegated(container, "[data-pick-turno-gestao]", function (el) {
      pguGestaoTurno = el.getAttribute("data-pick-turno-gestao");
      renderHoje(lastEffs);
    });

    // ---- Ações rápidas do card (Concluir / Em andamento / Problema) ----
    A.onDelegated(container, "[data-pgu-act]", function (el, e) {
      e.stopPropagation();
      var uid = el.getAttribute("data-uid");
      var act = el.getAttribute("data-pgu-act");
      var atividade = activitiesByUid[uid];
      if (act === "done") {
        saveOverrideField(uid, "percent", 100);
        A.toast("Atividade concluída.");
      } else if (act === "andamento") {
        saveOverrideField(uid, "status", "Em andamento");
        A.toast("Marcada como em andamento.");
      } else if (act === "problema") {
        var atual = loadOverrides()[uid] || {};
        var motivo = prompt('Motivo de "' + (atividade ? atividade.nome : "") + '" não estar em dia (fica registrado na atividade):', atual.observacoes || "");
        if (motivo === null) return;
        if (!motivo.trim()) { A.toast("Precisa descrever o motivo pra marcar como problema.", "error"); return; }
        saveOverrideFields(uid, { status: "Atrasada", observacoes: motivo.trim() });
        A.toast("Problema registrado.");
      }
      renderAll();
    });

    // ---- Encerrar turno: separa quem já era pra ultrapassar (segue pro próximo turno de boa) de
    // quem devia terminar e não terminou (vira "herdada", com motivo obrigatório). ----
    A.onDelegated(container, "#pguEncerrarTurno", function () {
      var tAtual = meuTurno;
      // Fecha o turno do dia que está sendo visualizado nos chips (hojeSelectedDate), não
      // necessariamente o dia real do relógio -- ver [[podeEncerrar]] em renderModoEncarregadoBody.
      var diaAlvo = hojeSelectedDate || toISODate(new Date());
      var doTurnoHoje = lastEffs.filter(function (e) {
        return e.turno === tAtual && e.inicio && e.termino && e.inicio <= diaAlvo && e.termino >= diaAlvo;
      });
      var pendentes = doTurnoHoje.filter(function (e) { return e.status !== "Concluída"; });
      if (!pendentes.length) { A.toast("Tudo concluído nesse turno. 🎉"); return; }

      var estouro = pendentes.filter(programadaParaUltrapassarTurno);
      var atraso = pendentes.filter(function (e) { return !programadaParaUltrapassarTurno(e); });

      var msg = "Encerrar o turno " + tAtual + "?\n";
      if (estouro.length) msg += "• " + estouro.length + " atividade(s) já programada(s) pra continuar no próximo turno (normal, sem motivo).\n";
      if (atraso.length) msg += "• " + atraso.length + " atividade(s) deveriam ter terminado neste turno e vão precisar de motivo.";
      if (!confirm(msg)) return;

      estouro.forEach(function (e) { saveOverrideField(e.uid, "turno", nextTurno(tAtual)); });

      atraso.forEach(function (e) {
        var pred = predecessoraPendente(activitiesByUid[e.uid]);
        var motivo;
        if (pred) {
          motivo = 'Aguardando "' + pred.nome + '" (predecessora também não concluída neste turno).';
        } else {
          motivo = "";
          while (!motivo.trim()) {
            motivo = prompt('Motivo de "' + e.nome + '" não ter sido concluída no turno ' + tAtual + ':', e.observacoes || "") || "";
            if (motivo === "") { if (!confirm("O motivo é obrigatório. Tentar de novo?")) return; }
          }
        }
        saveOverrideFields(e.uid, { status: "Atrasada", observacoes: motivo.trim(), herancaDeTurno: tAtual, turno: nextTurno(tAtual) });
      });

      A.toast("Turno encerrado.");
      renderAll();
    });

    // ---- PDF: abre a caixa de impressão do navegador (a pessoa escolhe "Salvar como PDF") sobre
    // uma versão enxuta da MESMA lista que está na tela (ver regras @media print no CSS) --
    // funciona offline, sem depender de biblioteca externa. Como impressão só mostra o que já está
    // aberto no DOM, força toda pasta/TR/componente a abrir antes de chamar print(). ----
    A.onDelegated(container, "#pguPdfBtn", function () {
      container.querySelectorAll("details[data-gkey]").forEach(function (d) { d.open = true; });
      window.print();
    });

    // ---- Barra de avanço arrastável (pula de 10 em 10) ----
    var draggingTrack = null;
    function pctFromEvent(e, track) {
      var rect = track.getBoundingClientRect();
      var raw = ((e.clientX - rect.left) / rect.width) * 100;
      return Math.max(0, Math.min(100, Math.round(raw / 10) * 10));
    }
    function paintTrack(track, pct) {
      var fill = track.querySelector(".pgu-card__pct-fill");
      var thumb = track.querySelector(".pgu-card__pct-thumb");
      if (fill) fill.style.width = pct + "%";
      if (thumb) thumb.style.left = pct + "%";
      var num = container.querySelector('[data-pct-num="' + track.getAttribute("data-pct-track") + '"]');
      if (num) num.textContent = pct + "%";
    }
    container.addEventListener("pointerdown", function (e) {
      var track = e.target.closest(".pgu-card__pct-track");
      if (!track || !container.contains(track)) return;
      track.setPointerCapture(e.pointerId);
      track.classList.add("pgu-dragging");
      draggingTrack = track;
      var pct = pctFromEvent(e, track);
      track._dragPct = pct;
      paintTrack(track, pct);
    });
    container.addEventListener("pointermove", function (e) {
      if (!draggingTrack) return;
      var pct = pctFromEvent(e, draggingTrack);
      draggingTrack._dragPct = pct;
      paintTrack(draggingTrack, pct);
    });
    function finishDrag() {
      if (!draggingTrack) return;
      draggingTrack.classList.remove("pgu-dragging");
      var uid = draggingTrack.getAttribute("data-pct-track");
      var pct = draggingTrack._dragPct;
      draggingTrack = null;
      if (pct !== undefined) {
        saveOverrideField(uid, "percent", pct);
        A.toast("Avanço atualizado.");
        renderAll();
      }
    }
    container.addEventListener("pointerup", finishDrag);
    container.addEventListener("pointercancel", finishDrag);
  }

  // ------------------------------------------------------------ Tab: Dashboard

  function renderDashboard(effs) {
    var container = A.$("pguDashContent");
    var total = effs.length;
    var concluidas = effs.filter(function (e) { return e.status === "Concluída"; }).length;
    var andamento = effs.filter(function (e) { return e.status === "Em andamento"; }).length;
    var naoIniciadas = effs.filter(function (e) { return e.status === "Não iniciada"; }).length;
    var atrasadas = effs.filter(function (e) { return e.status === "Atrasada"; }).length;
    var pctGeral = total ? Math.round(effs.reduce(function (s, e) { return s + (e.percent || 0); }, 0) / total) : 0;

    var statusItems = [
      { label: "Concluída", value: concluidas, color: A.COLORS.valeGreen },
      { label: "Em andamento", value: andamento, color: A.COLORS.valeBlue },
      { label: "Não iniciada", value: naoIniciadas, color: A.COLORS.mediumGray },
      { label: "Atrasada", value: atrasadas, color: "#D93025" }
    ].filter(function (i) { return i.value > 0; });

    var farolArea = buildFarolStack(effs, function (e) { return e.area; });
    var farolExecutante = buildFarolStack(effs, function (e) { return e.executante; });
    var farolDisciplina = buildFarolStack(effs, function (e) { return e.disciplina; });
    var farolComponente = buildFarolStack(effs, function (e) { return e.componente; });

    var datas = [];
    effs.forEach(function (e) {
      if (e.terminoBaseline) datas.push(e.terminoBaseline);
      if (e.termino) datas.push(e.termino);
    });
    var minD = datas.length ? datas.reduce(function (a, b) { return a < b ? a : b; }) : null;
    var maxD = datas.length ? datas.reduce(function (a, b) { return a > b ? a : b; }) : null;
    var dias = [];
    if (minD && maxD) {
      var cur = new Date(minD + "T00:00:00");
      var end = new Date(maxD + "T00:00:00");
      while (cur <= end) { dias.push(toISODate(cur)); cur.setDate(cur.getDate() + 1); }
    }
    var baselineSerie = dias.map(function (d) {
      var n = effs.filter(function (e) { return e.terminoBaseline && e.terminoBaseline <= d; }).length;
      return total ? (n / total) * 100 : 0;
    });
    var previstoSerie = dias.map(function (d) {
      var n = effs.filter(function (e) { return e.termino && e.termino <= d; }).length;
      return total ? (n / total) * 100 : 0;
    });
    var hojeStr = toISODate(new Date());
    var todayIdx = null;
    dias.forEach(function (d, i) { if (d <= hojeStr) todayIdx = i; });
    var turnoAtipico = effs.filter(turnoDivergente).length;

    container.innerHTML =
      '<div class="kpi-grid">' +
        kpiCard("🏁", "Total de atividades", A.fmtNum(total)) +
        kpiCard("✅", "Concluídas", A.fmtNum(concluidas)) +
        kpiCard("🔄", "Em andamento", A.fmtNum(andamento), "blue") +
        kpiCard("⏱️", "Atrasadas", A.fmtNum(atrasadas), atrasadas ? "bad" : "") +
        kpiCard("⬜", "Não iniciadas", A.fmtNum(naoIniciadas)) +
        kpiCard("📊", "% geral da PGU", pctGeral + "%", "blue") +
        kpiCard("⚠️", "Turno atípico p/ fiscal", A.fmtNum(turnoAtipico), turnoAtipico ? "warn" : "", "Turno da tarefa diferente do habitual do fiscal responsável") +
      "</div>" +
      '<div class="grid-2">' +
        '<div class="panel"><h3 class="panel__title">Status das atividades</h3><div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">' +
          (statusItems.length ? A.donutChart(statusItems, 160, { centerLabel: "atividades" }) : "") +
          '<div class="chart-legend" style="flex-direction:column;">' + statusItems.map(function (it) {
            return '<div class="chart-legend__item"><span class="chart-legend__swatch" style="background:' + it.color + '"></span>' + A.esc(it.label) + " (" + it.value + ")</div>";
          }).join("") + "</div></div></div>" +
        '<div class="panel"><h3 class="panel__title">Curva planejada — % concluído acumulado por dia</h3>' +
          '<p class="panel__subtitle">Linha de base x previsto atual (o % realizado de hoje está no card acima)</p>' +
          (dias.length ? A.sCurveChart([
            { name: "Linha de base", values: baselineSerie, color: A.COLORS.valeGray, dashed: true },
            { name: "Previsto atual", values: previstoSerie, color: A.COLORS.valeGreen }
          ], dias.map(function (d) { return d.slice(8, 10) + "/" + d.slice(5, 7); }), { height: 260, todayIndex: todayIdx, maxXLabels: Math.min(dias.length, 10) }) : '<p class="table-caption">Sem datas suficientes.</p>') +
        "</div>" +
      "</div>" +
      '<div class="panel"><h3 class="panel__title">Farol por área (TR / ativo)</h3><p class="panel__subtitle">🔴 atrasado · 🟡 em risco · 🟢 no prazo / concluído</p>' + A.stackedBarRows(farolArea, {}) + "</div>" +
      '<div class="panel"><h3 class="panel__title">Farol por disciplina</h3>' + A.stackedBarRows(farolDisciplina, {}) + "</div>" +
      '<div class="panel"><h3 class="panel__title">Farol por componente/sistema</h3>' + A.stackedBarRows(farolComponente, {}) + "</div>" +
      '<div class="panel"><h3 class="panel__title">Farol por executante</h3>' + A.stackedBarRows(farolExecutante, {}) + "</div>";
  }

  // ------------------------------------------------------------ Tab: Atividades

  var lastAtvFilterState = null;

  function renderAtividades(effs) {
    var container = A.$("pguAtividadesContent");
    var areaOptions = A.distinctValues(effs, "area");
    var componenteOptions = A.distinctValues(effs, "componente");
    var disciplinaOptions = A.distinctValues(effs, "disciplina");
    var execOptions = A.distinctValues(effs, "executante");
    var statusOptions = A.distinctValues(effs, "status");
    var turnoOptions = TURNO_OPTIONS.map(function (t) { return { value: t, label: t }; });
    var encarregadoOptions = A.distinctValues(effs.filter(function (e) { return e.encarregado; }), "encarregado");
    var fiscalObraOptions = A.distinctValues(effs.filter(function (e) { return e.fiscalObra; }), "fiscalObra");
    var fiscalSegurancaOptions = A.distinctValues(effs.filter(function (e) { return e.fiscalSeguranca; }), "fiscalSeguranca");

    var toolbarHtml = A.filterToolbar([
      { key: "encarregado", label: "Encarregado", value: null, options: encarregadoOptions },
      { key: "fiscalObra", label: "Fiscal de Campo", value: null, options: fiscalObraOptions },
      { key: "fiscalSeguranca", label: "Fiscal de Segurança", value: null, options: fiscalSegurancaOptions },
      { key: "area", label: "TR / Área", value: null, options: areaOptions },
      { key: "componente", label: "Componente", value: null, options: componenteOptions },
      { key: "disciplina", label: "Disciplina", value: null, options: disciplinaOptions },
      { key: "executante", label: "Executante", value: null, options: execOptions },
      { key: "status", label: "Status", value: null, options: statusOptions },
      { key: "turno", label: "Turno (informado em campo)", value: null, options: turnoOptions }
    ]);

    container.innerHTML =
      '<div id="pguAtvToolbar">' + toolbarHtml + "</div>" +
      '<div class="panel"><h3 class="panel__title">Atividades da PGU</h3><p class="panel__subtitle">Clique no nome da atividade para abrir a atualização rápida</p><div id="pguAtvTable"></div></div>';

    mainTable = A.makeFilterableTable("pguAtvTable", effs, [
      { key: "nome", label: "Atividade", render: function (r) { return '<a href="javascript:void(0)" class="pgu-open" data-uid="' + A.esc(r.uid) + '" style="color:var(--dark-green);font-weight:600;text-decoration:none;">' + A.esc(r.nome) + "</a>"; } },
      { key: "encarregado", label: "Encarregado", render: function (r) { return r.encarregado ? A.esc(r.encarregado) : "—"; } },
      { key: "fiscalObra", label: "Fiscal de Campo", render: function (r) { return r.fiscalObra ? A.esc(r.fiscalObra) : "—"; } },
      { key: "fiscalSeguranca", label: "Fiscal de Segurança", render: function (r) { return r.fiscalSeguranca ? A.esc(r.fiscalSeguranca) : "—"; } },
      { key: "area", label: "TR / Área" },
      { key: "componente", label: "Componente", render: function (r) { return r.componente ? A.esc(r.componente) : "—"; } },
      { key: "disciplina", label: "Disciplina", render: function (r) { return r.disciplina ? A.esc(r.disciplina) : "—"; } },
      { key: "executante", label: "Executante" },
      { key: "status", label: "Status", render: function (r) { return farolEmoji(farolDe(r)) + " " + A.esc(r.status); } },
      { key: "percent", label: "% Avanço", render: function (r) { return miniProgress(r.percent); } },
      { key: "inicio", label: "Início previsto", render: function (r) { return fmtDataHora(r.inicioDataHora); } },
      { key: "termino", label: "Término previsto", render: function (r) { return fmtDataHora(r.terminoDataHora); } },
      { key: "inicioTendencia", label: "Início tendência", render: function (r) {
          var cls = (r.isTendenciaAuto || r.isTendenciaBaseline) ? " pgu-tend-input--auto" : "";
          var ttl = r.isTendenciaAuto ? "Reprogramado automaticamente por atraso em predecessora" : (r.isTendenciaBaseline ? "Ainda igual à linha de base" : "");
          return '<input type="datetime-local" class="pgu-tend-input' + cls + '" data-uid="' + A.esc(r.uid) + '" data-field="inicioTendencia" value="' + A.esc(r.inicioTendencia) + '"' + (ttl ? ' title="' + ttl + '"' : "") + '>';
        } },
      { key: "terminoTendencia", label: "Término tendência", render: function (r) {
          var cls = (r.isTendenciaAuto || r.isTendenciaBaseline) ? " pgu-tend-input--auto" : "";
          var ttl = r.isTendenciaAuto ? "Reprogramado automaticamente por atraso em predecessora" : (r.isTendenciaBaseline ? "Ainda igual à linha de base" : "");
          return '<input type="datetime-local" class="pgu-tend-input' + cls + '" data-uid="' + A.esc(r.uid) + '" data-field="terminoTendencia" value="' + A.esc(r.terminoTendencia) + '"' + (ttl ? ' title="' + ttl + '"' : "") + '>';
        } },
      { key: "turno", label: "Turno", render: function (r) {
          if (!r.turno) return "—";
          return A.esc(r.turno) + (turnoDivergente(r) ? ' <span class="badge farol-atrasado" title="Diferente do turno habitual do fiscal ' + A.esc(r.fiscalObra) + ' em ' + A.esc(r.disciplina || "—") + '">⚠</span>' : "");
        } }
    ], {
      limit: 300,
      searchPlaceholder: "Buscar atividade...",
      initialText: lastAtvFilterState ? lastAtvFilterState.text : "",
      initialExact: lastAtvFilterState ? lastAtvFilterState.exact : {},
      filterLabels: { encarregado: "Encarregado", fiscalObra: "Fiscal de Campo", fiscalSeguranca: "Fiscal de Segurança", area: "TR / Área", componente: "Componente", disciplina: "Disciplina", executante: "Executante", status: "Status", turno: "Turno" },
      onFilterChange: function (state) { lastAtvFilterState = state; A.syncFilterToolbar("pguAtvToolbar", state); }
    });

    A.wireFilterToolbar("pguAtvToolbar", mainTable);
    A.onDelegated(A.$("pguAtvTable"), ".pgu-open", function (el) {
      var a = activitiesByUid[el.getAttribute("data-uid")];
      if (a) openDrawer(a, renderAll);
    });
    A.$("pguAtvTable").addEventListener("change", function (e) {
      var el = e.target.closest(".pgu-tend-input");
      if (!el) return;
      var field = el.getAttribute("data-field");
      saveOverrideField(el.getAttribute("data-uid"), field, el.value);
      A.toast((field === "inicioTendencia" ? "Início" : "Término") + " tendência salvo.");
      renderAll();
    });
  }

  // ------------------------------------------------------------ Tab: Linha de Base

  function renderBaseline(effs) {
    var container = A.$("pguBaselineContent");
    var desviosAtraso = effs.filter(function (e) { return e.termino && e.terminoBaseline && e.termino > e.terminoBaseline; });
    var desviosAdiantado = effs.filter(function (e) { return e.termino && e.terminoBaseline && e.termino < e.terminoBaseline; });
    var semDesvio = effs.length - desviosAtraso.length - desviosAdiantado.length;
    var linhas = desviosAtraso.concat(desviosAdiantado);

    container.innerHTML =
      '<div class="kpi-grid">' +
        kpiCard("📐", "Sem desvio vs. linha de base", A.fmtNum(semDesvio)) +
        kpiCard("⏱️", "Replanejadas para depois", A.fmtNum(desviosAtraso.length), desviosAtraso.length ? "warn" : "") +
        kpiCard("⏩", "Adiantadas vs. linha de base", A.fmtNum(desviosAdiantado.length), "blue") +
      "</div>" +
      '<div class="panel"><h3 class="panel__title">Atividades com término diferente da linha de base</h3>' +
        '<p class="panel__subtitle">A linha de base nunca é alterada — qualquer mudança de data aqui é uma nova previsão</p>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Atividade</th><th>Área</th><th>Término linha de base</th><th>Término atual</th><th>Desvio</th></tr></thead><tbody>' +
        (linhas.length ? linhas.map(function (e) {
          var dias = Math.round((new Date(e.termino) - new Date(e.terminoBaseline)) / 86400000);
          return "<tr><td>" + A.esc(e.nome) + "</td><td>" + A.esc(e.area || "—") + "</td><td>" + A.fmtDate(e.terminoBaseline) + "</td><td>" + A.fmtDate(e.termino) + "</td><td>" +
            A.badge((dias > 0 ? "+" : "") + dias + "d", dias > 0 ? "farol-atrasado" : "farol-concluido") + "</td></tr>";
        }).join("") : '<tr><td colspan="5" style="text-align:center;color:#747678;">Nenhum desvio em relação à linha de base.</td></tr>') +
        "</tbody></table></div></div>";
  }

  // ------------------------------------------------------------ shell

  function renderShell() {
    var content = A.$("content");
    content.innerHTML =
      '<div id="pguHojeContent"></div>' +
      '<div class="footnote">Atualizações de campo (status, %, observações, encarregado, turno) ficam salvas no servidor e são compartilhadas entre todo mundo — aperte 🔄 pra ver o que outras pessoas atualizaram.</div>';
    wireHojeTab();
  }

  // Botão/arquivo de importar ficam FORA do #content (não são recriados a cada renderShell), então
  // são ligados uma unica vez -- clicar no icone só abre o seletor de arquivo nativo; escolher o
  // arquivo já dispara a importação sozinha, sem precisar de um segundo clique em "Importar".
  function wireImportButton() {
    var iconBtn = A.$("pguImportIconBtn");
    var fileInput = A.$("pguImportFile");
    if (!iconBtn || !fileInput) return;
    iconBtn.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", async function () {
      var file = fileInput.files[0];
      if (!file) return;
      iconBtn.disabled = true;
      A.toast("Lendo cronograma…");
      try {
        var text = await file.text();
        var novaBase = parsePguXml(text);
        await salvarBaselineImportada(novaBase);
        window.PANEL_DATA = window.PANEL_DATA || {};
        window.PANEL_DATA.pgu = novaBase;
        A.toast("✔ Cronograma importado (" + novaBase.totalAtividades + " atividades) e compartilhado com todo mundo.");
        renderAll();
      } catch (e) {
        console.error(e);
        A.toast("Erro ao importar: " + e.message, "error");
      } finally {
        fileInput.value = "";
        iconBtn.disabled = false;
      }
    });
  }

  function renderAll() {
    var PGU = window.PANEL_DATA.pgu || { atividades: [], porArea: [], porExecutante: [], porStatus: [], projeto: {} };
    var atividades = PGU.atividades || [];
    activitiesByUid = {};
    atividades.forEach(function (a) { activitiesByUid[a.uid] = a; });
    allAtividades = atividades;
    recomputeCascade();
    var overrides = loadOverrides();
    var effs = atividades.map(function (a) { return effective(a, overrides[a.uid]); });
    FISCAL_TURNO_PREDOMINANTE = computeFiscalTurnoPredominante(effs);

    renderHoje(effs);

    A.setStatusPills([
      "PGU: " + ((PGU.projeto && PGU.projeto.nome) || "—"),
      "Gerado em " + (PGU.geradoEm || "—")
    ]);
    A.setNavBadge("pgu", atividades.filter(function (a) { return a.status === "Atrasada"; }).length, "count-bad");
  }

  renderShell();
  wireImportButton();
  (async function boot() {
    await Promise.all([loadOverridesFromSupabase(), loadBaselineFromSupabase()]);
    renderAll();
  })();
  A.wireAtualizarButton(["pgu"], async function () {
    renderShell();
    await Promise.all([loadOverridesFromSupabase(), loadBaselineFromSupabase()]);
    renderAll();
  });
  // Sem atualização automática em segundo plano -- a cada ~45s ela interrompia quem estava no
  // meio de um preenchimento (perdia foco/estado do campo, resetava seleção). Agora só puxa o
  // que outras pessoas fizeram em campo quando o encarregado aperta 🔄 na mão.
})();
