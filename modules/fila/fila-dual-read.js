"use strict";

const FLAG_DUAL_READ_ATIVA = "FILA_V2_DUAL_READ_ATIVA";
const TAG_TELEMETRIA = "[FILA-V2-DUAL-READ]";
const INTERVALO_LOG_PADRAO_MS = 5 * 60 * 1000;
const COOLDOWN_RECOVERY_VIVA_INVALIDA_MS = 2 * 60 * 1000;
const ultimoLogPorChave = new Map();

function texto(valor = "") {
  return String(valor || "").trim();
}

function idOferta(oferta = {}) {
  return texto(
    oferta.id ||
    oferta.ofertaId ||
    oferta.engineOfertaId ||
    oferta.engine_oferta_id ||
    oferta.idOferta
  );
}

function numero(valor, fallback = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : fallback;
}

function contextoSeguro(contexto = {}) {
  const seguro = {};
  for (const [chave, valor] of Object.entries(contexto || {})) {
    if (valor == null) continue;
    if (typeof valor === "string") {
      seguro[chave] = valor.slice(0, 160);
      continue;
    }
    if (typeof valor === "number" && Number.isFinite(valor)) {
      seguro[chave] = valor;
      continue;
    }
    if (typeof valor === "boolean") {
      seguro[chave] = valor;
    }
  }
  return seguro;
}

function flagAtiva(nome, env = process.env) {
  return String(env?.[nome] || "").trim().toLowerCase() === "true";
}

function modoDualRead(env = process.env) {
  return flagAtiva(FLAG_DUAL_READ_ATIVA, env);
}

function selecionarFilaReadOnly({
  fila = [],
  clienteIdAlvo = null,
  agora = Date.now(),
  configPadrao = {},
  configsPorCliente = {},
  ordenarPendentesPorPrioridade,
  ofertaExpiradaParaEnvio,
  avaliarOfertaParaSelecaoFilaViva,
  ordenarOfertasFilaViva
} = {}) {
  if (typeof ordenarPendentesPorPrioridade !== "function") {
    throw new Error("ordenarPendentesPorPrioridade_invalido");
  }
  if (typeof ofertaExpiradaParaEnvio !== "function") {
    throw new Error("ofertaExpiradaParaEnvio_invalido");
  }
  if (typeof avaliarOfertaParaSelecaoFilaViva !== "function") {
    throw new Error("avaliarOfertaParaSelecaoFilaViva_invalido");
  }
  if (typeof ordenarOfertasFilaViva !== "function") {
    throw new Error("ordenarOfertasFilaViva_invalido");
  }

  const clienteLog = String(clienteIdAlvo || "admin");
  const pendentes = Array.isArray(fila)
    ? fila.filter(o => {
        const mesmoCliente =
          !clienteIdAlvo ||
          String(o?.clienteId || "admin") === String(clienteIdAlvo);
        if (!mesmoCliente) return false;
        if (o?.status !== "pendente") return false;
        const clienteIdOferta = o.clienteId || "admin";
        const configClienteOferta = configsPorCliente?.[clienteIdOferta] || configPadrao;
        return configClienteOferta.automacaoAtiva === true;
      })
    : [];

  const contadores = {
    avaliadas: 0,
    expiradas: 0,
    semDestinoCompativel: 0,
    semDestinoLiberadoAgora: 0,
    outrosBloqueios: 0
  };

  const candidatosVivos = [];

  for (const oferta of ordenarPendentesPorPrioridade(pendentes)) {
    contadores.avaliadas += 1;

    if (ofertaExpiradaParaEnvio(oferta, agora)) {
      contadores.expiradas += 1;
      continue;
    }

    const clienteIdOferta = oferta.clienteId || "admin";
    const configClienteOferta = configsPorCliente?.[clienteIdOferta] || configPadrao;
    const avaliacao = avaliarOfertaParaSelecaoFilaViva(oferta, clienteIdOferta, configClienteOferta, { agora });

    if (avaliacao.elegivel) {
      candidatosVivos.push(avaliacao);
      continue;
    }

    if (avaliacao.motivo === "sem_destino_compativel") {
      contadores.semDestinoCompativel += 1;
    } else if (avaliacao.motivo === "sem_destino_liberado_agora") {
      contadores.semDestinoLiberadoAgora += 1;
    } else {
      contadores.outrosBloqueios += 1;
    }
  }

  const candidatosOrdenados = ordenarOfertasFilaViva(candidatosVivos, { agora });
  const selecionada = candidatosOrdenados[0] || null;

  return {
    ok: true,
    clienteId: clienteLog,
    motivo: selecionada ? "selecionada" : "sem_candidato",
    totalPendentes: pendentes.length,
    totalElegiveis: candidatosVivos.length,
    candidatosVivos,
    candidatosOrdenados,
    contadores,
    selecionada
  };
}

function resumirSelecao(resultado = {}) {
  const selecionada = resultado?.selecionada || null;
  return {
    ok: resultado?.ok !== false,
    motivo: texto(resultado?.motivo || (selecionada ? "selecionada" : "sem_candidato")),
    selecionadaId: idOferta(selecionada?.oferta || selecionada),
    lane: texto(selecionada?.ranking?.lane || ""),
    scoreFinal: numero(selecionada?.ranking?.scoreFinal, 0),
    destinosCompativeis: numero(selecionada?.destinosCompativeis, 0),
    destinosLiberados: numero(Array.isArray(selecionada?.destinosLiberados) ? selecionada.destinosLiberados.length : 0, 0),
    totalPendentes: numero(resultado?.totalPendentes, 0),
    totalElegiveis: numero(resultado?.totalElegiveis, 0),
    avaliadas: numero(resultado?.contadores?.avaliadas, 0)
  };
}

function resumirAntidup(resultado = {}) {
  const bloqueio = resultado?.bloquear === true || resultado?.bloqueada === true;
  return {
    ok: resultado?.ok !== false,
    bloquear: bloqueio,
    motivo: texto(resultado?.motivo || ""),
    statusAnterior: texto(resultado?.statusAnterior || ""),
    ofertaAnteriorId: idOferta(resultado?.ofertaAnterior || {}),
    identidade: texto(resultado?.identidade || ""),
    enviadaEmAnterior: texto(resultado?.enviadaEmAnterior || "")
  };
}

function deveRegistrarLog(chave = "", agora = Date.now(), divergente = false, forcar = false, intervaloMs = INTERVALO_LOG_PADRAO_MS) {
  if (!chave) return false;
  if (forcar || divergente) {
    ultimoLogPorChave.set(chave, agora);
    return true;
  }

  const ultimo = ultimoLogPorChave.get(chave) || 0;
  if (agora - ultimo >= intervaloMs) {
    ultimoLogPorChave.set(chave, agora);
    return true;
  }

  return false;
}

function emitirLog(logger = console, payload = {}) {
  const destino = logger && typeof logger.log === "function" ? logger : console;
  destino.log(TAG_TELEMETRIA, JSON.stringify(payload));
}

function compararSelecaoDualRead({
  clienteId = "admin",
  legado = {},
  sombra = null,
  contexto = {},
  logger = console,
  forcar = false,
  intervaloMs = INTERVALO_LOG_PADRAO_MS,
  agora = Date.now()
} = {}) {
  const inicio = process.hrtime.bigint();
  const chave = `selecao:${String(clienteId || "admin")}`;
  const resumoLegado = resumirSelecao(legado);
  const resumoSombra = sombra ? resumirSelecao(sombra) : {
    ok: false,
    motivo: "shadow_indisponivel",
    selecionadaId: "",
    lane: "",
    scoreFinal: 0,
    destinosCompativeis: 0,
    destinosLiberados: 0,
    totalPendentes: 0,
    totalElegiveis: 0,
    avaliadas: 0
  };
  const comparavel = Boolean(sombra && sombra.ok !== false);
  const equivalente = comparavel &&
    resumoLegado.selecionadaId === resumoSombra.selecionadaId &&
    resumoLegado.motivo === resumoSombra.motivo;
  const divergente = comparavel && !equivalente;
  const payload = {
    versao: 1,
    componente: "selecao",
    clienteId: texto(clienteId || "admin") || "admin",
    comparavel,
    equivalente,
    divergente,
    shadowIndisponivel: !comparavel,
    legado: resumoLegado,
    sombra: resumoSombra,
    ...contextoSeguro(contexto),
    tempoComparacaoMs: Math.max(0, Math.round(Number(process.hrtime.bigint() - inicio) / 1e6))
  };

  const deveLogar = comparavel
    ? deveRegistrarLog(chave, agora, divergente, forcar, intervaloMs)
    : deveRegistrarLog(`${chave}:shadow_indisponivel`, agora, false, forcar, intervaloMs);
  if (deveLogar) {
    emitirLog(logger, payload);
  }

  return {
    ...payload,
    logado: deveLogar
  };
}

function compararAntidupDualRead({
  clienteId = "admin",
  legado = {},
  sombra = null,
  contexto = {},
  logger = console,
  forcar = false,
  intervaloMs = INTERVALO_LOG_PADRAO_MS,
  agora = Date.now()
} = {}) {
  const inicio = process.hrtime.bigint();
  const chave = `antidup:${String(clienteId || "admin")}`;
  const resumoLegado = resumirAntidup(legado);
  const resumoSombra = sombra ? resumirAntidup(sombra) : {
    ok: false,
    bloquear: false,
    motivo: "shadow_indisponivel",
    statusAnterior: "",
    ofertaAnteriorId: "",
    identidade: "",
    enviadaEmAnterior: ""
  };
  const comparavel = Boolean(sombra && sombra.ok !== false);
  const equivalente = comparavel &&
    resumoLegado.bloquear === resumoSombra.bloquear &&
    resumoLegado.motivo === resumoSombra.motivo &&
    resumoLegado.ofertaAnteriorId === resumoSombra.ofertaAnteriorId;
  const divergente = comparavel && !equivalente;
  const payload = {
    versao: 1,
    componente: "anti_duplicidade",
    clienteId: texto(clienteId || "admin") || "admin",
    comparavel,
    equivalente,
    divergente,
    shadowIndisponivel: !comparavel,
    legado: resumoLegado,
    sombra: resumoSombra,
    ...contextoSeguro(contexto),
    tempoComparacaoMs: Math.max(0, Math.round(Number(process.hrtime.bigint() - inicio) / 1e6))
  };

  const deveLogar = comparavel
    ? deveRegistrarLog(chave, agora, divergente, forcar, intervaloMs)
    : deveRegistrarLog(`${chave}:shadow_indisponivel`, agora, false, forcar, intervaloMs);
  if (deveLogar) {
    emitirLog(logger, payload);
  }

  return {
    ...payload,
    logado: deveLogar
  };
}

function criarControladorFilaDualRead(opcoes = {}) {
  const intervaloMs = Number(opcoes.intervaloMs ?? INTERVALO_LOG_PADRAO_MS);
  const cooldownRecuperacaoMs = Number(opcoes.cooldownRecuperacaoMs ?? COOLDOWN_RECOVERY_VIVA_INVALIDA_MS);
  const logger = opcoes.logger || console;
  const env = opcoes.env || process.env;
  const cooldownRecuperacaoPorCliente = new Map();

  function lerFilaVivaComCooldown(clienteId = "admin", deps = {}, leitor = null) {
    const cliente = texto(clienteId || "admin") || "admin";
    const agora = Number(deps?.agora || Date.now());
    const registroCooldown = cooldownRecuperacaoPorCliente.get(cliente);

    if (registroCooldown && Number(registroCooldown.ate || 0) > agora) {
      return {
        ok: false,
        recovery: false,
        fallbackLegado: true,
        motivoFallback: "cooldown_viva_invalida",
        motivo: registroCooldown.motivo || "cooldown_viva_invalida",
        recuperacaoBloqueada: true,
        cooldownAte: registroCooldown.ate,
        cooldownMotivo: registroCooldown.motivo || "cooldown_viva_invalida"
      };
    }
    if (registroCooldown) {
      cooldownRecuperacaoPorCliente.delete(cliente);
    }

    let leitura;
    try {
      if (typeof leitor === "function") {
        leitura = leitor(cliente, deps);
      } else {
        leitura = { ok: false, fallbackLegado: true, motivoFallback: "leitor_viva_invalido" };
      }
    } catch (erro) {
      leitura = {
        ok: false,
        fallbackLegado: true,
        motivoFallback: "erro_leitura_viva",
        erroFallback: String(erro?.message || erro || "")
      };
    }

    const falhou = leitura?.ok === false || leitura?.fallbackLegado === true;
    if (falhou) {
      const motivo = texto(
        leitura?.motivoFallback ||
        leitura?.motivo ||
        leitura?.erroFallback ||
        "viva_invalida"
      );
      cooldownRecuperacaoPorCliente.set(cliente, {
        ate: agora + cooldownRecuperacaoMs,
        motivo
      });
    } else {
      cooldownRecuperacaoPorCliente.delete(cliente);
    }

    return leitura;
  }

  return {
    ativo: modoDualRead(env),
    selecionarFilaReadOnly: params => selecionarFilaReadOnly(params),
    lerFilaVivaComCooldown,
    compararSelecao: params => compararSelecaoDualRead({
      logger,
      intervaloMs,
      ...params
    }),
    compararAntidup: params => compararAntidupDualRead({
      logger,
      intervaloMs,
      ...params
    })
  };
}

module.exports = {
  FLAG_DUAL_READ_ATIVA,
  TAG_TELEMETRIA,
  INTERVALO_LOG_PADRAO_MS,
  modoDualRead,
  selecionarFilaReadOnly,
  compararSelecaoDualRead,
  compararAntidupDualRead,
  criarControladorFilaDualRead
};
