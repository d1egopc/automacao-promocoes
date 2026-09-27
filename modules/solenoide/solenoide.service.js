"use strict";

const TAG_LOG = "[SOLENOID]";

const ESTADOS = Object.freeze({
  ABERTO: "ABERTO",
  MODERADO: "MODERADO",
  FECHADO: "FECHADO"
});

const ACOES = Object.freeze({
  NORMAL: "coleta_normal",
  REDUZIR: "reduzir_lote",
  PULAR: "pular_rodada"
});

const ORIGENS_AUTOMATICAS = new Set(["radar", "teleradar"]);

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function numero(valor, padrao = 0) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : padrao;
}

function inteiroNaoNegativo(valor) {
  return Math.max(0, Math.floor(numero(valor)));
}

function flagAtiva(valor) {
  return ["1", "true", "on", "yes"].includes(String(valor ?? "").trim().toLowerCase());
}

function modoSolenoide(env = process.env) {
  // Shadow wins when both flags are set: an accidental double flag cannot grant authority.
  if (flagAtiva(env?.SOLENOID_SHADOW)) return "shadow";
  if (flagAtiva(env?.SOLENOID_ENABLED)) return "active";
  return "off";
}

function limitar(valor, minimo, maximo) {
  return Math.max(minimo, Math.min(maximo, valor));
}

function somarMapa(destino = {}, origem = {}) {
  for (const [chave, valor] of Object.entries(objeto(origem))) {
    const nome = String(chave || "indefinido").slice(0, 80);
    destino[nome] = inteiroNaoNegativo(destino[nome]) + inteiroNaoNegativo(valor);
  }
  return destino;
}

function validarSnapshotOfc(ofc = {}) {
  const gate = objeto(ofc.gateAbsorcao);
  if (ofc.ok !== true) throw new Error("ofc_indisponivel");
  if (gate.ok !== true) throw new Error("gate_absorcao_indisponivel");
  if (gate.snapshotCompleto !== true) throw new Error("snapshot_ofc_incompleto");
  if (!Array.isArray(gate.workspaces)) throw new Error("workspaces_ofc_invalidos");
  return gate;
}

function agregarSinaisOfc(ofc = {}, extras = {}) {
  const gate = validarSnapshotOfc(ofc);
  const workspaces = [];
  const estoquePorMarketplace = Object.create(null);

  for (const workspace of gate.workspaces) {
    const item = objeto(workspace);
    const buffer = objeto(item.bufferVivoShadow);
    const topologia = item.topologiaOperacionalPotencial === true;
    const fonteValida = item.fonteFilaValida === true;
    const executorApto = item.automacaoExecutorAtiva === true
      && item.creditosExecutorAptos !== false
      && inteiroNaoNegativo(item.destinosAptos) > 0;

    if (!topologia || !fonteValida) continue;

    const estoqueUtil = inteiroNaoNegativo(buffer.bufferAtualUtil);
    const estoqueAlvo = inteiroNaoNegativo(buffer.bufferAlvo);
    const possuiDeficitExplicito = Object.prototype.hasOwnProperty.call(buffer, "deficitBuffer")
      && Number.isFinite(Number(buffer.deficitBuffer));
    const deficit = executorApto
      ? (possuiDeficitExplicito
        ? inteiroNaoNegativo(buffer.deficitBuffer)
        : Math.max(0, estoqueAlvo - estoqueUtil))
      : 0;

    somarMapa(estoquePorMarketplace, buffer.pressaoPorMarketplace);
    workspaces.push({
      executorApto,
      destinosAptos: inteiroNaoNegativo(item.destinosAptos),
      estoqueUtil,
      estoqueAlvo,
      deficit,
      semEstoqueUtil: executorApto && estoqueAlvo > 0 && estoqueUtil === 0,
      estadoEsteira: String(item.estadoDaEsteira || item.estado || "").toUpperCase()
    });
  }

  const operacionais = workspaces.filter(item => item.executorApto);
  const demandaUnidades = operacionais.reduce((total, item) => total + item.deficit, 0);
  const estoqueUtil = operacionais.reduce((total, item) => total + item.estoqueUtil, 0);
  const estoqueAlvo = operacionais.reduce((total, item) => total + item.estoqueAlvo, 0);
  // Excess stock in one workspace cannot mask hunger or inflate pressure in another.
  const estoqueParaPressao = operacionais.reduce(
    (total, item) => total + Math.min(item.estoqueUtil, item.estoqueAlvo),
    0
  );
  const workspacesComDeficit = operacionais.filter(item => item.deficit > 0).length;
  const workspacesSemEstoqueUtil = operacionais.filter(item => item.semEstoqueUtil).length;
  const workspacesSaturados = operacionais.filter(item => item.estadoEsteira === "SATURADA").length;
  const workspacesLimitados = operacionais.filter(item => item.estadoEsteira === "LIMITADA").length;
  const totalPressionados = workspacesSaturados + workspacesLimitados;
  const razaoPressao = estoqueAlvo > 0 ? estoqueParaPressao / estoqueAlvo : 0;
  const lagMs = Math.max(0, numero(
    extras.eventLoopLagMs,
    ofc?.observabilidadeCiclo?.eventLoopLagMaxMs
  ));
  const poolWaitMs = Math.max(0, numero(extras.poolWaitMs));
  const cpuPercent = Math.max(0, numero(extras.cpuPercent));
  const rssPressure = extras.rssPressure === true;
  const pressaoAlta = workspacesSaturados > 0
    || (operacionais.length > 0 && totalPressionados / operacionais.length >= 0.5)
    || razaoPressao >= 1
    || lagMs >= 1000
    || poolWaitMs >= 500
    || cpuPercent >= 180
    || rssPressure;
  const pressaoCrescente = pressaoAlta
    || totalPressionados > 0
    || razaoPressao >= 0.7
    || lagMs >= 250
    || poolWaitMs >= 100
    || cpuPercent >= 120;

  return {
    demanda: {
      unidades: demandaUnidades,
      workspacesOperacionais: operacionais.length,
      workspacesComDeficit,
      workspacesSemEstoqueUtil,
      destinosAptos: operacionais.reduce((total, item) => total + item.destinosAptos, 0),
      turboFactual: inteiroNaoNegativo(extras.turboFactual)
    },
    estoque: {
      util: estoqueUtil,
      alvo: estoqueAlvo,
      excedente: Math.max(0, estoqueUtil - estoqueAlvo),
      porMarketplace: estoquePorMarketplace
    },
    pressao: {
      nivel: pressaoAlta ? "alta" : (pressaoCrescente ? "crescente" : "baixa"),
      workspacesSaturados,
      workspacesLimitados,
      razaoEstoqueAlvo: Number(razaoPressao.toFixed(3)),
      eventLoopLagMs: lagMs,
      poolWaitMs,
      cpuPercent,
      rssPressure
    }
  };
}

function classificarEstado(sinais = {}) {
  const demanda = objeto(sinais.demanda);
  const estoque = objeto(sinais.estoque);
  const pressao = objeto(sinais.pressao);
  const motivos = [];
  let estado;

  if (inteiroNaoNegativo(demanda.workspacesOperacionais) === 0) {
    estado = ESTADOS.FECHADO;
    motivos.push("sem_demanda_operacional_agora");
  } else if (inteiroNaoNegativo(demanda.unidades) > 0) {
    if (inteiroNaoNegativo(demanda.workspacesSemEstoqueUtil) > 0) motivos.push("workspace_sem_estoque_util");
    motivos.push("demanda_supera_estoque_util");
    if (pressao.nivel === "alta") {
      estado = ESTADOS.MODERADO;
      motivos.push("pressao_alta_limita_abertura");
    } else {
      estado = ESTADOS.ABERTO;
    }
  } else if (pressao.nivel === "alta") {
    estado = ESTADOS.FECHADO;
    motivos.push("pressao_operacional_alta");
  } else if (inteiroNaoNegativo(estoque.util) >= inteiroNaoNegativo(estoque.alvo)) {
    estado = ESTADOS.FECHADO;
    motivos.push("estoque_util_suficiente");
  } else {
    estado = ESTADOS.MODERADO;
    motivos.push("estoque_proximo_do_alvo");
  }

  return { estado, motivos };
}

function acaoDoEstado(estado = ESTADOS.ABERTO) {
  if (estado === ESTADOS.FECHADO) return ACOES.PULAR;
  if (estado === ESTADOS.MODERADO) return ACOES.REDUZIR;
  return ACOES.NORMAL;
}

function criarHisterese({ amostrasParaMudar = 2 } = {}) {
  const minimo = Math.max(1, Math.floor(numero(amostrasParaMudar, 2)));
  let atual = null;
  let pendente = null;
  let amostrasPendentes = 0;

  function aplicar(candidato, { imediato = false } = {}) {
    if (!atual) {
      atual = candidato;
      return { estado: atual, mudou: true, amostrasPendentes: 0 };
    }
    if (candidato === atual) {
      pendente = null;
      amostrasPendentes = 0;
      return { estado: atual, mudou: false, amostrasPendentes: 0 };
    }
    if (imediato) {
      atual = candidato;
      pendente = null;
      amostrasPendentes = 0;
      return { estado: atual, mudou: true, amostrasPendentes: 0 };
    }
    if (pendente !== candidato) {
      pendente = candidato;
      amostrasPendentes = 1;
    } else {
      amostrasPendentes += 1;
    }
    if (amostrasPendentes >= minimo) {
      atual = candidato;
      pendente = null;
      amostrasPendentes = 0;
      return { estado: atual, mudou: true, amostrasPendentes: 0 };
    }
    return { estado: atual, mudou: false, pendente, amostrasPendentes };
  }

  return {
    aplicar,
    estadoAtual: () => atual
  };
}

function planoColetor(decisao = {}, { marketplace = "", limite = 1 } = {}) {
  const limiteLegado = Math.max(1, Math.floor(numero(limite, 1)));
  if (decisao.aplicouMudancas !== true || decisao.failOpen === true) {
    return {
      marketplace: String(marketplace || ""),
      limiteOriginal: limiteLegado,
      executar: true,
      limite: limiteLegado,
      alterou: false,
      motivo: decisao.failOpen === true ? "fail_open" : "sem_autoridade"
    };
  }
  if (decisao.estado === ESTADOS.FECHADO) {
    return {
      marketplace: String(marketplace || ""),
      limiteOriginal: limiteLegado,
      executar: false,
      limite: limiteLegado,
      alterou: true,
      motivo: "solenoide_fechado"
    };
  }
  if (decisao.estado === ESTADOS.MODERADO) {
    return {
      marketplace: String(marketplace || ""),
      limiteOriginal: limiteLegado,
      executar: true,
      limite: Math.max(1, Math.ceil(limiteLegado * 0.5)),
      alterou: true,
      motivo: "solenoide_moderado"
    };
  }
  return {
    marketplace: String(marketplace || ""),
    limiteOriginal: limiteLegado,
    executar: true,
    limite: limiteLegado,
    alterou: false,
    motivo: "solenoide_aberto"
  };
}

function logarDecisao(logger, decisao = {}) {
  if (!logger || typeof logger.log !== "function") return;
  const sinais = objeto(decisao.sinais);
  try {
    logger.log(TAG_LOG, JSON.stringify({
      rodadaId: String(decisao.rodadaId || "").slice(0, 100),
      modo: decisao.modo,
      estado: decisao.estado,
      estadoCandidato: decisao.estadoCandidato,
      demanda: sinais.demanda || {},
      estoqueUtil: sinais.estoque?.util ?? null,
      estoqueAlvo: sinais.estoque?.alvo ?? null,
      pressao: sinais.pressao || {},
      motivos: lista(decisao.motivos).slice(0, 6),
      histerese: decisao.histerese || {},
      acaoQueFaria: decisao.acao,
      coletores: lista(decisao.coletores).map(item => String(item || "").slice(0, 40)),
      aplicouMudancas: decisao.aplicouMudancas === true,
      failOpen: decisao.failOpen === true
    }));
  } catch (_) {}
}

function logarDecisaoOrigem(logger, decisao = {}) {
  if (!logger || typeof logger.log !== "function") return;
  try {
    logger.log(TAG_LOG, JSON.stringify({
      origem: decisao.origem,
      modo: decisao.modo,
      auto: decisao.auto === true,
      manual: decisao.manual === true,
      foraHorario: decisao.foraHorario === true,
      estado: decisao.estado,
      faria: decisao.acao,
      permitido: decisao.permitido === true,
      aplicado: decisao.aplicouMudancas === true,
      bypass: decisao.bypass || "",
      failOpen: decisao.failOpen === true
    }));
  } catch (_) {}
}

function criarSolenoide({
  env = process.env,
  logger = console,
  amostrasParaMudar = 2,
  clock = () => Date.now(),
  decisaoMaxAgeMs = 5 * 60 * 1000,
  intervaloLogOrigemMs = 60 * 1000
} = {}) {
  const histerese = criarHisterese({ amostrasParaMudar });
  const alternanciaModeradaPorOrigem = new Map();
  const ultimoLogOrigem = new Map();
  let ultimaDecisao = null;

  function agoraMs() {
    const valor = clock();
    const ms = valor instanceof Date ? valor.getTime() : Number(valor);
    return Number.isFinite(ms) ? ms : Date.now();
  }

  function guardarDecisao(decisao) {
    ultimaDecisao = Object.freeze({ ...decisao });
    return ultimaDecisao;
  }

  function logarOrigemComThrottle(decisao) {
    if (decisao.modo === "off") return;
    const assinatura = [
      decisao.origem,
      decisao.modo,
      decisao.auto,
      decisao.manual,
      decisao.foraHorario,
      decisao.estado,
      decisao.acao,
      decisao.permitido,
      decisao.bypass,
      decisao.failOpen
    ].join("|");
    const agora = agoraMs();
    const anterior = ultimoLogOrigem.get(assinatura);
    if (Number.isFinite(anterior) && agora - anterior < intervaloLogOrigemMs) return;
    if (ultimoLogOrigem.size >= 32) ultimoLogOrigem.clear();
    ultimoLogOrigem.set(assinatura, agora);
    logarDecisaoOrigem(logger, decisao);
  }

  function modo() {
    return modoSolenoide(env);
  }

  function avaliar({ ofc = {}, pressaoSistema = {}, rodadaId = "", coletores = [] } = {}) {
    const modoAtual = modo();
    const avaliadoEmMs = agoraMs();
    if (modoAtual === "off") {
      return guardarDecisao({
        rodadaId,
        modo: "off",
        estado: ESTADOS.ABERTO,
        acao: ACOES.NORMAL,
        aplicouMudancas: false,
        legadoExato: true,
        failOpen: false,
        avaliadoEmMs
      });
    }

    try {
      const sinais = agregarSinaisOfc(ofc, pressaoSistema);
      const candidato = classificarEstado(sinais);
      const aberturaUrgente = candidato.estado === ESTADOS.ABERTO
        && inteiroNaoNegativo(sinais.demanda.workspacesSemEstoqueUtil) > 0;
      const estabilizado = histerese.aplicar(candidato.estado, { imediato: aberturaUrgente });
      const decisao = {
        rodadaId,
        modo: modoAtual,
        estado: estabilizado.estado,
        estadoCandidato: candidato.estado,
        acao: acaoDoEstado(estabilizado.estado),
        aplicouMudancas: modoAtual === "active",
        autorizadoParaExecucao: modoAtual === "active",
        failOpen: false,
        motivos: candidato.motivos,
        histerese: {
          mudou: estabilizado.mudou === true,
          pendente: estabilizado.pendente || "",
          amostrasPendentes: inteiroNaoNegativo(estabilizado.amostrasPendentes),
          amostrasParaMudar: Math.max(1, Math.floor(numero(amostrasParaMudar, 2))),
          aberturaUrgente
        },
        sinais,
        coletores: lista(coletores),
        avaliadoEmMs
      };
      logarDecisao(logger, decisao);
      return guardarDecisao(decisao);
    } catch (erro) {
      const decisao = {
        rodadaId,
        modo: modoAtual,
        estado: ESTADOS.ABERTO,
        estadoCandidato: ESTADOS.ABERTO,
        acao: ACOES.NORMAL,
        aplicouMudancas: false,
        autorizadoParaExecucao: false,
        failOpen: true,
        motivos: [String(erro?.message || "erro_solenoide").slice(0, 120)],
        coletores: lista(coletores),
        avaliadoEmMs
      };
      logarDecisao(logger, decisao);
      return guardarDecisao(decisao);
    }
  }

  function avaliarOrigem({
    origem,
    manualAtivo,
    dentroHorario,
    solenoideAuto,
    decisao = ultimaDecisao
  } = {}) {
    const origemNormalizada = String(origem || "").trim().toLowerCase();
    if (!ORIGENS_AUTOMATICAS.has(origemNormalizada)) {
      return { permitido: true, aplicado: false, bypass: "origem_fora_da_autoridade", failOpen: true };
    }

    const base = {
      origem: origemNormalizada,
      modo: modo(),
      auto: solenoideAuto === true,
      manual: manualAtivo === true,
      foraHorario: dentroHorario !== true,
      estado: decisao?.estado || ESTADOS.ABERTO,
      acao: decisao?.acao || ACOES.NORMAL,
      permitido: true,
      aplicouMudancas: false,
      failOpen: false,
      bypass: ""
    };

    if (manualAtivo !== true) {
      const resultado = { ...base, permitido: false, bypass: "controle_manual_off" };
      logarOrigemComThrottle(resultado);
      return resultado;
    }
    if (dentroHorario !== true) {
      const resultado = { ...base, permitido: false, bypass: "fora_horario" };
      logarOrigemComThrottle(resultado);
      return resultado;
    }
    if (solenoideAuto !== true) {
      const resultado = { ...base, bypass: "toggle_off" };
      logarOrigemComThrottle(resultado);
      return resultado;
    }
    if (base.modo === "off") {
      const resultado = { ...base, bypass: "solenoide_off" };
      logarOrigemComThrottle(resultado);
      return resultado;
    }

    const idadeDecisaoMs = agoraMs() - numero(decisao?.avaliadoEmMs, Number.NaN);
    if (!decisao || !Number.isFinite(idadeDecisaoMs) || idadeDecisaoMs < 0 || idadeDecisaoMs > decisaoMaxAgeMs) {
      const resultado = { ...base, bypass: "decisao_ausente_ou_expirada", failOpen: true };
      logarOrigemComThrottle(resultado);
      return resultado;
    }
    if (decisao.failOpen === true) {
      const resultado = { ...base, bypass: "decisao_fail_open", failOpen: true };
      logarOrigemComThrottle(resultado);
      return resultado;
    }
    if (base.modo === "shadow") {
      const resultado = { ...base, bypass: "shadow" };
      logarOrigemComThrottle(resultado);
      return resultado;
    }
    if (decisao.estado === ESTADOS.FECHADO) {
      const resultado = { ...base, permitido: false, aplicouMudancas: true };
      alternanciaModeradaPorOrigem.delete(origemNormalizada);
      logarOrigemComThrottle(resultado);
      return resultado;
    }
    if (decisao.estado === ESTADOS.MODERADO) {
      const proxima = !(alternanciaModeradaPorOrigem.get(origemNormalizada) === true);
      alternanciaModeradaPorOrigem.set(origemNormalizada, proxima);
      const resultado = {
        ...base,
        permitido: proxima,
        aplicouMudancas: !proxima,
        bypass: proxima ? "moderado_amostra_permitida" : ""
      };
      logarOrigemComThrottle(resultado);
      return resultado;
    }

    alternanciaModeradaPorOrigem.delete(origemNormalizada);
    const resultado = { ...base, estado: ESTADOS.ABERTO, acao: ACOES.NORMAL };
    logarOrigemComThrottle(resultado);
    return resultado;
  }

  return {
    modo,
    avaliar,
    avaliarOrigem,
    obterUltimaDecisao: () => ultimaDecisao,
    planoColetor: (decisao, entrada) => planoColetor(decisao, entrada)
  };
}

const solenoideGlobal = criarSolenoide();

module.exports = {
  ACOES,
  ESTADOS,
  TAG_LOG,
  acaoDoEstado,
  agregarSinaisOfc,
  classificarEstado,
  criarHisterese,
  criarSolenoide,
  logarDecisaoOrigem,
  modoSolenoide,
  planoColetor,
  solenoideGlobal
};
