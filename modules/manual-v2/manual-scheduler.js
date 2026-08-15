const storagePadrao = require("./manual-offers.storage");
const dispatcherPadrao = require("./manual-dispatcher");

const GRACE_PADRAO_MS = 30 * 60 * 1000;
// Lock minimo: cobre concorrencia local e grava lease no storage; coordenacao perfeita entre processos fica para infra futura.
const locksMemoria = new Set();

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function inteiro(valor = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? Math.floor(numero) : 0;
}

function agoraIso(deps = {}) {
  return typeof deps.now === "function" ? deps.now() : new Date().toISOString();
}

function resolverGraceMs(deps = {}) {
  const configurado = deps.graceMs ?? process.env.MANUAL_V2_AGENDAMENTO_GRACE_MS;
  const numero = Number(configurado);
  return Number.isFinite(numero) && numero >= 0 ? numero : GRACE_PADRAO_MS;
}

function resolverDeps(deps = {}) {
  return {
    listarOfertasManuaisV2: deps.listarOfertasManuaisV2 || storagePadrao.listarOfertasManuaisV2,
    buscarOfertaManualV2: deps.buscarOfertaManualV2 || storagePadrao.buscarOfertaManualV2,
    atualizarMetadadosEnvioManualV2: deps.atualizarMetadadosEnvioManualV2 || storagePadrao.atualizarMetadadosEnvioManualV2,
    atualizarMetadadosAgendamentoManualV2:
      deps.atualizarMetadadosAgendamentoManualV2 || storagePadrao.atualizarMetadadosAgendamentoManualV2,
    enviarOfertaManualV2: deps.enviarOfertaManualV2 || dispatcherPadrao.enviarOfertaManualV2,
    storageOptions: deps.storageOptions || {}
  };
}

function chaveLock(clienteId = "admin", ofertaId = "") {
  return `${texto(clienteId) || "admin"}:${texto(ofertaId)}`;
}

function criarLockId(clienteId = "admin", ofertaId = "", deps = {}) {
  if (typeof deps.lockIdFactory === "function") return texto(deps.lockIdFactory(clienteId, ofertaId));
  return `manual_v2_agendamento_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function erroResumo(resultados = []) {
  return lista(resultados)
    .filter((resultado) => texto(resultado.status).toLowerCase() === "erro" && texto(resultado.erro))
    .map((resultado) => {
      const nome = texto(resultado.nome || resultado.destinoId || "Destino");
      return `${nome}: ${texto(resultado.erro)}`;
    })
    .join("; ")
    .slice(0, 1000);
}

function destinoIdsAgendados(oferta = {}) {
  const ids = lista(oferta.destinosIds).map(texto).filter(Boolean);
  if (ids.length) return ids;
  return lista(oferta.destinosAgendados)
    .map((destino) => texto(destino.id || destino.destinoId))
    .filter(Boolean);
}

function retornoIgnorado(oferta = {}, motivo = "") {
  return {
    ok: true,
    processado: false,
    ofertaId: texto(oferta.id),
    motivo: texto(motivo)
  };
}

function retornoErro(oferta = {}, motivo = "") {
  return {
    ok: false,
    processado: false,
    ofertaId: texto(oferta.id),
    motivo: texto(motivo)
  };
}

function envioManualDoResultado(resultado = {}, oferta = {}, solicitadoEm = "", concluidoEm = "") {
  const resumo = erroResumo(resultado.resultados || []);
  return {
    solicitadoEm,
    concluidoEm,
    destinosEscolhidos: lista(oferta.destinosAgendados),
    resultados: lista(resultado.resultados),
    enviados: inteiro(resultado.enviados),
    erros: inteiro(resultado.erros),
    creditosDebitados: inteiro(resultado.creditosDebitados),
    erroResumo: resumo
  };
}

function deveIgnorarStatus(status = "") {
  const atual = texto(status).toLowerCase();
  return atual === "enviando" || atual === "enviada";
}

function validarVencimento(oferta = {}, nowMs = Date.now(), graceMs = GRACE_PADRAO_MS) {
  const agendadoMs = Date.parse(texto(oferta.agendadoPara));
  if (!Number.isFinite(agendadoMs)) return { acao: "erro", motivo: "Agendamento com data invalida" };
  if (agendadoMs > nowMs) return { acao: "ignorar", motivo: "agendamento_futuro" };
  if (nowMs - agendadoMs > graceMs) {
    return {
      acao: "erro",
      motivo: "Agendamento vencido fora da janela segura"
    };
  }
  return { acao: "processar", motivo: "" };
}

async function finalizarComoErroAntigo(clienteId = "admin", oferta = {}, deps = {}, motivo = "") {
  const storage = resolverDeps(deps);
  const agora = agoraIso(deps);
  const atualizada = storage.atualizarMetadadosAgendamentoManualV2(clienteId, oferta.id, {
    status: "erro",
    agendamentoTentativas: inteiro(oferta.agendamentoTentativas) + 1,
    agendamentoErroResumo: motivo,
    agendamentoAtualizadoEm: agora,
    limparLock: true
  }, storage.storageOptions);

  return {
    ok: false,
    processado: false,
    ofertaId: texto(oferta.id),
    motivo,
    oferta: atualizada
  };
}

async function processarOfertaAgendadaManualV2({ clienteId = "admin", ofertaId = "" } = {}, deps = {}) {
  const storage = resolverDeps(deps);
  const cliente = texto(clienteId) || "admin";
  const idOferta = texto(ofertaId);
  if (!idOferta) return retornoErro({}, "manual_v2_oferta_id_obrigatorio");
  const chave = chaveLock(cliente, idOferta);
  if (locksMemoria.has(chave)) {
    return retornoIgnorado({ id: idOferta }, "lock_memoria_ativo");
  }

  const ofertaInicial = storage.buscarOfertaManualV2(cliente, idOferta, storage.storageOptions);
  if (!ofertaInicial) return retornoErro({ id: idOferta }, "oferta_manual_v2_nao_encontrada");
  if (texto(ofertaInicial.status).toLowerCase() !== "agendada") {
    return retornoIgnorado(ofertaInicial, "status_nao_agendado");
  }
  if (deveIgnorarStatus(ofertaInicial.status)) {
    return retornoIgnorado(ofertaInicial, "status_bloqueado");
  }

  const nowMs = Date.parse(agoraIso(deps));
  const vencimento = validarVencimento(ofertaInicial, nowMs, resolverGraceMs(deps));
  if (vencimento.acao === "ignorar") return retornoIgnorado(ofertaInicial, vencimento.motivo);
  if (vencimento.acao === "erro") {
    return finalizarComoErroAntigo(cliente, ofertaInicial, deps, vencimento.motivo);
  }

  locksMemoria.add(chave);
  const lockId = criarLockId(cliente, idOferta, deps);
  const lockEm = agoraIso(deps);
  const solicitadoEm = lockEm;

  try {
    const bloqueada = storage.atualizarMetadadosAgendamentoManualV2(cliente, idOferta, {
      status: "enviando",
      agendamentoLockId: lockId,
      agendamentoLockEm: lockEm,
      agendamentoTentativas: inteiro(ofertaInicial.agendamentoTentativas) + 1,
      agendamentoErroResumo: ""
    }, storage.storageOptions);

    if (!bloqueada) return retornoErro(ofertaInicial, "oferta_manual_v2_nao_encontrada");

    const revalidada = storage.buscarOfertaManualV2(cliente, idOferta, storage.storageOptions);
    if (
      !revalidada ||
      texto(revalidada.status).toLowerCase() !== "enviando" ||
      texto(revalidada.agendamentoLockId) !== lockId
    ) {
      return retornoIgnorado(ofertaInicial, "lock_persistido_nao_confirmado");
    }

    const resultado = await storage.enviarOfertaManualV2({
      clienteId: cliente,
      ofertaId: idOferta,
      destinosIds: destinoIdsAgendados(revalidada)
    }, {
      ...deps,
      storageOptions: storage.storageOptions
    });

    const sucesso = inteiro(resultado?.enviados) > 0;
    const concluidoEm = agoraIso(deps);
    const resumo = erroResumo(resultado?.resultados || []);
    const envioManual = envioManualDoResultado(resultado || {}, revalidada, solicitadoEm, concluidoEm);

    storage.atualizarMetadadosEnvioManualV2(cliente, idOferta, {
      status: sucesso ? "enviada" : "erro",
      enviadoEm: sucesso ? concluidoEm : "",
      envioManual
    }, storage.storageOptions);

    const ofertaFinal = storage.atualizarMetadadosAgendamentoManualV2(cliente, idOferta, {
      status: sucesso ? "enviada" : "erro",
      agendamentoErroResumo: resumo,
      agendamentoAtualizadoEm: concluidoEm,
      limparLock: true
    }, storage.storageOptions);

    return {
      ok: sucesso,
      processado: true,
      ofertaId: idOferta,
      resultado,
      oferta: ofertaFinal
    };
  } finally {
    locksMemoria.delete(chave);
  }
}

async function processarAgendamentosManuaisV2Cliente({ clienteId = "admin" } = {}, deps = {}) {
  const storage = resolverDeps(deps);
  const cliente = texto(clienteId) || "admin";
  const ofertas = storage.listarOfertasManuaisV2(cliente, storage.storageOptions)
    .filter((oferta) => texto(oferta.status).toLowerCase() === "agendada");
  const resultados = [];

  for (const oferta of ofertas) {
    resultados.push(await processarOfertaAgendadaManualV2({ clienteId: cliente, ofertaId: oferta.id }, deps));
  }

  return {
    ok: true,
    clienteId: cliente,
    processados: resultados.filter((resultado) => resultado.processado).length,
    resultados
  };
}

function limparLocksMemoriaManualV2() {
  locksMemoria.clear();
}

module.exports = {
  GRACE_PADRAO_MS,
  processarOfertaAgendadaManualV2,
  processarAgendamentosManuaisV2Cliente,
  limparLocksMemoriaManualV2
};
