"use strict";

const { resolverFilaItemId } = require("./fila-claims-shadow.service");
const { resolverOrigemFluxo } = require("../../utils/origem-fluxo");
const destinosMultiAlvo = require("../../utils/destinos-multialvo");

const LIMITE_PADRAO = 8;
const MULTIPLICADOR_DESCOBERTA = 4;
const LIMITE_DESCOBERTA_MAXIMO = 32;

function texto(valor = "", limite = 160) {
  return String(valor || "").trim().slice(0, limite);
}

function inicioMonotono() {
  return typeof process.hrtime?.bigint === "function" ? process.hrtime.bigint() : null;
}

function duracaoMs(inicio, fallback) {
  if (typeof inicio === "bigint") return Number(process.hrtime.bigint() - inicio) / 1e6;
  return Math.max(0, Date.now() - Number(fallback || Date.now()));
}

function resumoEstados(checkpoints = []) {
  return checkpoints.reduce((out, checkpoint) => {
    const estado = texto(checkpoint?.estado, 40) || "desconhecido";
    out[estado] = (out[estado] || 0) + 1;
    return out;
  }, {});
}

function agruparPorItem(checkpoints = []) {
  const grupos = new Map();
  for (const checkpoint of checkpoints) {
    const id = texto(checkpoint?.filaItemId);
    if (!id) continue;
    const grupo = grupos.get(id) || [];
    grupo.push(checkpoint);
    grupos.set(id, grupo);
  }
  return grupos;
}

function alvoIdCheckpointEntrega(alvoChave = "") {
  const valor = texto(alvoChave);
  const separador = valor.indexOf(":");
  return separador >= 0 ? valor.slice(separador + 1) : valor;
}

// Checkpoint confirmado e evidencia por alvo. Sem um snapshot completo e uma
// correspondencia exata, nao e seguro promover o destino inteiro no JSON.
function sincronizarAlvosEnviadosPorCheckpoint(oferta = {}, checkpoints = []) {
  if (!Array.isArray(oferta?.destinosEstado)) return false;
  let alterou = false;
  for (const checkpoint of Array.isArray(checkpoints) ? checkpoints : []) {
    if (texto(checkpoint?.estado, 40) !== "enviado") continue;
    const destinoChave = texto(checkpoint?.destinoChave);
    const alvoId = alvoIdCheckpointEntrega(checkpoint?.alvoChave);
    if (!destinoChave || !alvoId) continue;
    const estadoDestino = oferta.destinosEstado.find(item => texto(item?.chave) === destinoChave);
    if (!estadoDestino || !Array.isArray(estadoDestino.snapshotAlvos) || !Array.isArray(estadoDestino.alvosEstado)) continue;
    const alvoSnapshot = estadoDestino.snapshotAlvos.find(alvo => destinosMultiAlvo.chaveAlvo(alvo) === alvoId);
    const estadoAlvo = estadoDestino.alvosEstado.find(alvo => texto(alvo?.alvoId) === alvoId);
    if (!alvoSnapshot || !estadoAlvo) continue;
    if (estadoAlvo.estado !== "enviado") {
      estadoAlvo.estado = "enviado";
      estadoAlvo.enviadoEm = checkpoint?.atualizadoEm || new Date().toISOString();
      estadoAlvo.erro = "";
      alterou = true;
    }
    const consolidado = destinosMultiAlvo.estadoLogicoPorAlvos(estadoDestino);
    if (estadoDestino.estado !== consolidado) {
      estadoDestino.estado = consolidado;
      alterou = true;
    }
  }
  return alterou;
}

function candidatosProcessandoAtuais(itens = [], limite = LIMITE_PADRAO, limiteDescoberta) {
  const quantidade = Math.max(1, Math.min(32, Number(limite) || LIMITE_PADRAO));
  const descoberta = Math.max(
    quantidade,
    Math.min(
      LIMITE_DESCOBERTA_MAXIMO,
      Number(limiteDescoberta) || quantidade * MULTIPLICADOR_DESCOBERTA
    )
  );
  const vistos = new Set();
  const candidatos = [];
  // Itens novos entram no final da fila. A descoberta olha uma janela local
  // recente, mas preserva a ordem original dentro dela. Assim, historicos
  // congelados sem checkpoint nao consomem indefinidamente a janela util.
  const lista = Array.isArray(itens) ? itens : [];
  for (let indice = lista.length - 1; indice >= 0; indice -= 1) {
    const item = lista[indice];
    const filaItemId = texto(resolverFilaItemId(item));
    if (!filaItemId || vistos.has(filaItemId) || texto(item?.status, 40).toLowerCase() !== "processando") continue;
    vistos.add(filaItemId);
    candidatos.unshift({ filaItemId, item });
    if (candidatos.length >= descoberta) break;
  }
  return candidatos;
}

function criarRecoveryCheckpointEntrega({ repository, advisory, logger = console, now = () => Date.now(), limite = LIMITE_PADRAO } = {}) {
  if (!repository || typeof repository.listarCheckpointsEntregaPorItens !== "function" ||
    typeof repository.listarCheckpointsEntregaPorItem !== "function" ||
    typeof repository.selecionarFatiaRecoveryCheckpoint !== "function" ||
    typeof repository.transicionarCheckpointEntrega !== "function") {
    throw new Error("fila_checkpoint_recovery_repository_invalido");
  }
  if (!advisory || typeof advisory.adquirir !== "function" || typeof advisory.finalizar !== "function") {
    throw new Error("fila_checkpoint_recovery_advisory_invalido");
  }

  const logar = dados => {
    try { (typeof logger?.log === "function" ? logger : console).log("[FILA-RECOVERY-CHECKPOINT]", JSON.stringify(dados)); } catch {}
  };

  async function recuperarCliente({ clienteId = "", itens = [], relocalizarItem, onRecuperavel, onSincronizarEnviado } = {}) {
    const cliente = texto(clienteId || "admin");
    const inicio = inicioMonotono();
    const inicioFallback = now();
    const candidatosDescoberta = candidatosProcessandoAtuais(itens, limite);
    if (!candidatosDescoberta.length) return { ok: true, resultados: [] };
    let checkpointsCandidatos;
    try {
      checkpointsCandidatos = await repository.listarCheckpointsEntregaPorItens({
        clienteId: cliente,
        filaItemIds: candidatosDescoberta.map(candidato => candidato.filaItemId),
        limite: candidatosDescoberta.length
      });
    } catch {
      logar({ clienteId: cliente, filaItemId: "", origemFluxo: "", alvosPorEstado: {}, decisao: "sem_acao", duracaoMs: Math.round(duracaoMs(inicio, inicioFallback)) });
      return { ok: false, motivo: "checkpoint_indisponivel", resultados: [] };
    }

    const checkpointsPorItem = agruparPorItem(checkpointsCandidatos);
    // O lote de recovery e formado apenas por itens que possuem evidencia
    // duravel. Sem checkpoint, o historico segue congelado e nao ocupa um dos
    // slots uteis nem chega a advisory/relocalizacao.
    const elegiveis = candidatosDescoberta
      .filter(candidato => (checkpointsPorItem.get(candidato.filaItemId) || []).length > 0);
    let fatia;
    try {
      fatia = await repository.selecionarFatiaRecoveryCheckpoint({
        clienteId: cliente,
        filaItemIds: elegiveis.map(candidato => candidato.filaItemId),
        limite: Math.max(1, Math.min(8, Number(limite) || LIMITE_PADRAO))
      });
    } catch {
      logar({ clienteId: cliente, filaItemId: "", origemFluxo: "", alvosPorEstado: {}, decisao: "sem_acao", duracaoMs: Math.round(duracaoMs(inicio, inicioFallback)) });
      return { ok: false, motivo: "cursor_recovery_indisponivel", resultados: [] };
    }
    const candidatosPorId = new Map(elegiveis.map(candidato => [candidato.filaItemId, candidato]));
    const candidatos = (fatia?.filaItemIds || [])
      .map(filaItemId => candidatosPorId.get(filaItemId))
      .filter(Boolean);
    if (!candidatos.length) return { ok: true, resultados: [] };
    const resultados = [];
    for (const candidato of candidatos) {
      const { filaItemId } = candidato;
      const checkpointsIniciais = checkpointsPorItem.get(filaItemId) || [];

      const itemInicio = inicioMonotono();
      const itemInicioFallback = now();
      let decisao = "sem_acao";
      let checkpoints = [];
      let advisoryHandle = null;
      try {
        advisoryHandle = await advisory.adquirir({ clienteId: cliente, oferta: candidato.item });
        if (advisoryHandle?.resultado !== "adquirido") {
          const resultado = { filaItemId, decisao: "sem_acao", motivo: `advisory_${advisoryHandle?.resultado || "erro"}` };
          resultados.push(resultado);
          logar({
            clienteId: cliente,
            filaItemId,
            origemFluxo: texto(resolverOrigemFluxo(candidato.item), 40),
            alvosPorEstado: resumoEstados(checkpointsIniciais),
            decisao: resultado.decisao,
            duracaoMs: Math.round(duracaoMs(itemInicio, itemInicioFallback))
          });
          continue;
        }
        const item = typeof relocalizarItem === "function"
          ? await relocalizarItem({ clienteId: cliente, filaItemId, item: candidato.item })
          : null;
        if (!item || resolverFilaItemId(item) !== filaItemId || texto(item?.status, 40).toLowerCase() !== "processando") {
          decisao = "sem_acao";
        } else {
          checkpoints = await repository.listarCheckpointsEntregaPorItem({ clienteId: cliente, filaItemId }, { client: advisoryHandle.handle.client });
        if (!checkpoints.length) {
          decisao = "sem_checkpoint";
        } else {
          const estados = new Set(checkpoints.map(itemCheckpoint => itemCheckpoint.estado));
          const possuiAmbiguidade = estados.has("resultado_ambiguo");
          const iniciados = checkpoints.filter(itemCheckpoint => itemCheckpoint.estado === "envio_iniciado");

          if (iniciados.length) {
            // O inicio prova que a fronteira externa pode ter sido cruzada,
            // mas nao prova o resultado. Nesta fase ele permanece bloqueado
            // sem reclassificar historicos nem fabricar uma tentativa nova.
            decisao = "bloqueado_ambiguo";
          } else if (possuiAmbiguidade) {
            decisao = "bloqueado_ambiguo";
          } else if (checkpoints.every(itemCheckpoint => itemCheckpoint.estado === "preparado")) {
            // Nenhum efeito externo comecou. O checkpoint e preservado; a
            // proxima execucao retoma o mesmo attempt sob advisory em vez de
            // apagar evidencia ou fabricar uma tentativa nova.
            await onRecuperavel?.({ item, checkpoints });
            decisao = "recuperavel";
          } else {
            const enviados = checkpoints.filter(itemCheckpoint => itemCheckpoint.estado === "enviado");
            if (enviados.length) {
              const sincronizado = await onSincronizarEnviado?.({ item, checkpoints: enviados });
              decisao = sincronizado === true ? "sincronizado" : "sem_acao";
            }
          }
        }
        }
      } catch {
        decisao = "sem_acao";
      } finally {
        if (advisoryHandle?.resultado === "adquirido") {
          await advisory.finalizar(advisoryHandle, { statusFinal: `recovery_${decisao}` });
        }
      }
      const resultado = { filaItemId, decisao, checkpoints };
      resultados.push(resultado);
      logar({
        clienteId: cliente,
        filaItemId,
        origemFluxo: texto(resolverOrigemFluxo(candidato.item), 40),
        alvosPorEstado: resumoEstados(checkpoints),
        decisao,
        duracaoMs: Math.round(duracaoMs(itemInicio, itemInicioFallback))
      });
    }
    return { ok: true, resultados };
  }

  return { recuperarCliente, resumoEstados, candidatosProcessandoAtuais, sincronizarAlvosEnviadosPorCheckpoint };
}

module.exports = {
  LIMITE_PADRAO,
  MULTIPLICADOR_DESCOBERTA,
  LIMITE_DESCOBERTA_MAXIMO,
  criarRecoveryCheckpointEntrega,
  resumoEstados,
  candidatosProcessandoAtuais,
  sincronizarAlvosEnviadosPorCheckpoint
};
