"use strict";

const COBERTURA_NORMAL_MINUTOS = 10;
const COBERTURA_TURBO_MINUTOS = 5;
const TTL_NORMAL_MS = 30 * 60 * 1000;
const TTL_TURBO_MS = 10 * 60 * 1000;

const STATUS_BUFFER_VIVO = new Set([
  "pendente",
  "novo",
  "aguardando",
  "aguardando_envio",
  "pronto",
  "pronta",
  "programado",
  "programada",
  "enviando",
  "em_envio",
  "processando_envio",
  "tentando_envio",
  "tentativa_envio",
  "processando",
  "em_processamento",
  "erro_temporario",
  "erro_retry",
  "retry",
  "aguardando_retry",
  "falha_temporaria",
  "reprocessar"
]);

const CAMPOS_TIMESTAMP_BUFFER = [
  "dataEntradaFila",
  "adicionadoEm",
  "createdAt",
  "adicionado_em",
  "dataEntrada",
  "entradaFilaEm",
  "dataFila",
  "dataCriacao",
  "timestamp",
  "incluidoEm",
  "inseridoEm",
  "recebidoEm",
  "importadoEm",
  "criado_em",
  "criadoEm"
];

const CAMPOS_DESTINO_BUFFER = [
  "destinoId",
  "destino_id",
  "destino",
  "chatId",
  "grupoId",
  "jid",
  "canalId"
];

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function chave(valor = "") {
  return texto(valor).toLowerCase();
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function limitarNaoNegativo(valor = 0) {
  return Math.max(0, numero(valor));
}

function tipoFluxoOferta(entrada = {}) {
  const oferta = objeto(entrada.oferta);
  const tipo = chave(
    entrada.tipoFluxo ||
    entrada.tipoOperacional ||
    entrada.tipo_operacional ||
    oferta.tipoFluxo ||
    oferta.tipoOperacional ||
    oferta.tipo_operacional
  );
  const turbo = entrada.cupomTurbo === true ||
    oferta.cupomTurbo === true ||
    oferta.cupom_turbo === true ||
    tipo === "cupom_turbo";
  return turbo ? "cupom_turbo" : "oferta_comum";
}

function coberturaFluxoMinutos(tipoFluxo = "") {
  return tipoFluxo === "cupom_turbo" ? COBERTURA_TURBO_MINUTOS : COBERTURA_NORMAL_MINUTOS;
}

function ttlFluxoMs(tipoFluxo = "") {
  return tipoFluxo === "cupom_turbo" ? TTL_TURBO_MS : TTL_NORMAL_MS;
}

function slotsCobertura(coberturaMinutos = 0, intervaloMinutos = 1) {
  const cobertura = Number(coberturaMinutos);
  const intervalo = Number(intervaloMinutos);
  if (!Number.isFinite(cobertura) || !Number.isFinite(intervalo) || cobertura <= 0 || intervalo <= 0) return 0;
  return Math.max(0, Math.floor(cobertura / intervalo));
}

function timestampBufferItem(item = {}) {
  for (const campo of CAMPOS_TIMESTAMP_BUFFER) {
    const bruto = texto(item?.[campo]);
    if (!bruto) continue;
    const ms = Date.parse(bruto);
    if (Number.isFinite(ms)) return { ms, campo };
  }
  return { ms: null, campo: "" };
}

function statusBufferItem(item = {}) {
  return chave(item.status ?? item.situacao);
}

function destinoId(destino = {}, indice = 0) {
  return texto(
    destino.destinoId ||
    destino.id ||
    destino.destino_id ||
    destino.jid ||
    destino.chatId ||
    destino.nome ||
    destino.destino ||
    `destino_${indice + 1}`
  );
}

function nomesDestino(destino = {}, indice = 0) {
  return [
    destinoId(destino, indice),
    texto(destino.nome),
    texto(destino.destino),
    texto(destino.chatId),
    texto(destino.jid)
  ].filter(Boolean);
}

function valorItem(item = {}, campos = []) {
  for (const campo of campos) {
    const valor = texto(item?.[campo]);
    if (valor) return valor;
  }
  return "";
}

function marketplaceItem(item = {}) {
  return valorItem(item, ["marketplace", "marketplace_detectado", "marketplaceDetectado"]);
}

function categoriaItem(item = {}) {
  return valorItem(item, ["categoria", "categoria_nome", "categoriaNome"]);
}

function midiaItem(item = {}) {
  return valorItem(item, ["tipoMidia", "tipo_midia", "midia", "mediaType"]);
}

function destinoItem(item = {}) {
  return CAMPOS_DESTINO_BUFFER.map(campo => texto(item?.[campo])).filter(Boolean);
}

function itemCompativelComOferta(item = {}, contexto = {}) {
  const marketplaceOferta = chave(contexto.marketplace);
  const categoriaOferta = chave(contexto.categoria);
  const midiaOferta = chave(contexto.tipoMidia);
  const marketplace = chave(marketplaceItem(item));
  const categoria = chave(categoriaItem(item));
  const midia = chave(midiaItem(item));

  if (marketplaceOferta && marketplace && marketplace !== marketplaceOferta) return false;
  if (categoriaOferta && categoria && categoria !== categoriaOferta) return false;
  if (midiaOferta && midia && midia !== midiaOferta) return false;
  return true;
}

function itemCompativelComDestinos(item = {}, destinos = []) {
  const candidatos = destinoItem(item);
  if (!candidatos.length) return true;
  const permitidos = new Set(destinos.flatMap((destino, indice) => nomesDestino(destino, indice)));
  return candidatos.some(valor => permitidos.has(valor));
}

function normalizarCapacidadeDestino(item = {}, indice = 0, coberturaMinutos = COBERTURA_NORMAL_MINUTOS) {
  const intervalo = numero(item.intervaloEfetivo ?? item.intervaloNormal ?? item.intervaloMinutos, 0);
  const slotsFuturos = item.aptoAgora === false
    ? 0
    : limitarNaoNegativo(
      item.slotsFuturosUtilizaveis ??
      item[`slots${coberturaMinutos}Min`] ??
      item[`capacidade${coberturaMinutos}Min`] ??
      slotsCobertura(coberturaMinutos, intervalo)
    );

  return {
    destinoId: destinoId(item, indice),
    nome: texto(item.nome || item.destino || item.destinoId || item.id || `destino_${indice + 1}`),
    tipo: texto(item.tipo || item.canal || ""),
    marketplace: texto(item.marketplace || ""),
    categoria: texto(item.categoria || ""),
    tipoMidia: texto(item.tipoMidia || item.tipo_midia || ""),
    aptoAgora: item.aptoAgora !== false,
    janelaAbertaAgora: item.janelaAbertaAgora !== false && item.aptoAgora !== false,
    integracaoApta: item.integracaoApta !== false,
    limiteDiarioRestante: item.limiteDiarioRestante ?? null,
    intervaloNormal: item.intervaloNormal ?? null,
    intervaloTurbo: item.intervaloTurbo ?? null,
    intervaloEfetivo: intervalo || null,
    proximoHorarioPermitido: item.proximoHorarioPermitido || item.proximaTentativaEm || item.proximoEnvioEm || null,
    slotsFuturosUtilizaveis: slotsFuturos,
    bufferAtualDestino: 0,
    deficitDestino: slotsFuturos
  };
}

function destinosDaOferta(destinos = [], contexto = {}) {
  const marketplaceOferta = chave(contexto.marketplace);
  const categoriaOferta = chave(contexto.categoria);
  const midiaOferta = chave(contexto.tipoMidia);
  return lista(destinos).filter(destino => {
    if (destino.aptoAgora === false) return false;
    const marketplace = chave(destino.marketplace);
    const categoria = chave(destino.categoria);
    const midia = chave(destino.tipoMidia || destino.tipo_midia);
    if (marketplaceOferta && marketplace && marketplace !== marketplaceOferta) return false;
    if (categoriaOferta && categoria && categoria !== categoriaOferta) return false;
    if (midiaOferta && midia && midia !== midiaOferta) return false;
    return true;
  });
}

function incrementar(mapa = {}, chaveMapa = "", valor = 1) {
  const k = texto(chaveMapa) || "indefinido";
  mapa[k] = (mapa[k] || 0) + valor;
}

function calcularBufferAtualUtil({ filaItens = [], destinosAptos = [], contexto = {}, agoraMs = Date.now(), tipoFluxo = "oferta_comum" } = {}) {
  const ttlMs = ttlFluxoMs(tipoFluxo);
  const itens = [];
  const ignorados = [];
  const pressaoPorDestino = {};
  const pressaoPorMarketplace = {};
  const pressaoPorCategoria = {};

  for (const item of lista(filaItens)) {
    const status = statusBufferItem(item);
    const id = item.id || item.filaItemId || item.ofertaId || item.oferta_id || null;
    if (!STATUS_BUFFER_VIVO.has(status)) {
      ignorados.push({ id, status, motivo: "status_fora_buffer_vivo" });
      continue;
    }

    const timestamp = timestampBufferItem(item);
    if (timestamp.ms === null) {
      ignorados.push({ id, status, motivo: "sem_timestamp_buffer_vivo" });
      continue;
    }

    const idadeMs = Math.max(0, agoraMs - timestamp.ms);
    if (idadeMs >= ttlMs) {
      ignorados.push({ id, status, idadeMs, ttlMs, motivo: "fora_frescor_buffer_vivo" });
      continue;
    }

    if (!itemCompativelComOferta(item, contexto)) {
      ignorados.push({ id, status, motivo: "fora_braco_oferta" });
      continue;
    }

    if (!itemCompativelComDestinos(item, destinosAptos)) {
      ignorados.push({ id, status, motivo: "destino_incompativel" });
      continue;
    }

    const destinosItem = destinoItem(item);
    const destino = destinosItem[0] || "sem_destino_explicito";
    const marketplace = marketplaceItem(item) || contexto.marketplace || "sem_marketplace";
    const categoria = categoriaItem(item) || contexto.categoria || "sem_categoria";
    incrementar(pressaoPorDestino, destino);
    incrementar(pressaoPorMarketplace, marketplace);
    incrementar(pressaoPorCategoria, categoria);
    itens.push({
      id,
      status,
      destino,
      marketplace,
      categoria,
      idadeMs,
      timestampCampo: timestamp.campo,
      motivo: "item_fresco_util"
    });
  }

  return {
    total: itens.length,
    itens,
    ignorados,
    pressaoPorDestino,
    pressaoPorMarketplace,
    pressaoPorCategoria
  };
}

function motivoEstado({ destinosAptos = [], slotsFuturosUtilizaveis = 0, deficitBuffer = 0, bufferAtualUtil = 0 } = {}) {
  if (!destinosAptos.length) return "sem_destino_apto_para_oferta";
  if (slotsFuturosUtilizaveis <= 0) return "sem_slot_futuro_utilizavel";
  if (deficitBuffer > 0) return "capacidade_real_por_braco_disponivel";
  if (bufferAtualUtil <= slotsFuturosUtilizaveis) return "buffer_vivo_saudavel";
  return "buffer_vivo_cheio";
}

function calcularBufferVivoWorkspace(entrada = {}) {
  const agoraMs = numero(entrada.agoraMs, Date.now());
  const oferta = objeto(entrada.oferta);
  const tipoFluxo = tipoFluxoOferta(entrada);
  const coberturaMinutos = numero(entrada.coberturaMinutos, coberturaFluxoMinutos(tipoFluxo));
  const workspaceId = texto(entrada.workspaceId || entrada.clienteId || oferta.cliente_id);
  const marketplace = texto(entrada.marketplace || oferta.marketplace);
  const categoria = texto(entrada.categoria || oferta.categoria);
  const tipoMidia = texto(entrada.tipoMidia || oferta.tipoMidia || oferta.tipo_midia);
  const contexto = { marketplace, categoria, tipoMidia };
  const destinosResumo = objeto(entrada.destinosResumo);
  const capacidadeBase = lista(destinosResumo.capacidadePorDestino).length
    ? lista(destinosResumo.capacidadePorDestino)
    : lista(entrada.destinosCompativeis);
  const capacidadePorDestino = capacidadeBase.map((item, indice) =>
    normalizarCapacidadeDestino(item, indice, coberturaMinutos)
  );
  const destinosAptos = destinosDaOferta(capacidadePorDestino, contexto);
  const buffer = calcularBufferAtualUtil({
    filaItens: entrada.filaItens,
    destinosAptos,
    contexto,
    agoraMs,
    tipoFluxo
  });

  for (const destino of capacidadePorDestino) {
    const nomes = new Set(nomesDestino(destino));
    destino.bufferAtualDestino = buffer.itens.filter(item =>
      item.destino === "sem_destino_explicito" || nomes.has(item.destino)
    ).length;
    destino.deficitDestino = Math.max(0, destino.slotsFuturosUtilizaveis - destino.bufferAtualDestino);
  }

  const slotsFuturosUtilizaveis = destinosAptos.reduce((total, item) => total + limitarNaoNegativo(item.slotsFuturosUtilizaveis), 0);
  const bufferAlvo = slotsFuturosUtilizaveis;
  const bufferAtualUtil = buffer.total;
  const deficitBuffer = Math.max(0, bufferAlvo - bufferAtualUtil);
  const estado = deficitBuffer > 0
    ? "ABAIXO_DO_ALVO"
    : (bufferAtualUtil > bufferAlvo ? "CHEIO" : "SAUDAVEL");
  const motivo = motivoEstado({ destinosAptos, slotsFuturosUtilizaveis, deficitBuffer, bufferAtualUtil });

  return {
    workspaceId,
    estado,
    bufferAlvo,
    bufferAtualUtil,
    deficitBuffer,
    slotsFuturosUtilizaveis,
    capacidadePorOferta: {
      ofertaId: entrada.ofertaId ?? oferta.id ?? null,
      marketplace,
      categoria,
      tipoMidia,
      tipoFluxo,
      coberturaMinutos,
      destinosAptos: destinosAptos.length,
      slotsFuturosUtilizaveis,
      bufferAtualUtil,
      deficitBuffer,
      aceitarPeloBufferVivo: deficitBuffer > 0
    },
    capacidadePorDestino,
    pressaoPorDestino: buffer.pressaoPorDestino,
    pressaoPorMarketplace: buffer.pressaoPorMarketplace,
    pressaoPorCategoria: buffer.pressaoPorCategoria,
    motivo,
    itensBufferUtil: buffer.itens,
    itensIgnorados: buffer.ignorados,
    flowAtual: entrada.flowAtual || null,
    saudeAgregada: entrada.saudeAgregada || null,
    aplicouMudancas: false
  };
}

function resumirDivergenciaBufferVivo(bufferVivo = {}, comparacao = {}) {
  const flowAtual = objeto(comparacao.flowAtual || bufferVivo.flowAtual);
  const saudeAgregada = objeto(comparacao.saudeAgregada || bufferVivo.saudeAgregada);
  const aceitarBufferVivo = bufferVivo.deficitBuffer > 0;
  const aceitarFlow = flowAtual.aceitarAgora === true;
  const divergencias = [];
  if (typeof flowAtual.aceitarAgora === "boolean" && aceitarBufferVivo !== aceitarFlow) {
    divergencias.push("decisao_flow_diferente_buffer_vivo");
  }
  if (Number.isFinite(Number(flowAtual.nivelAlvo)) && Number(flowAtual.nivelAlvo) !== Number(bufferVivo.bufferAlvo)) {
    divergencias.push("nivel_alvo_flow_diferente_buffer_vivo");
  }
  if (Number.isFinite(Number(flowAtual.bufferAtual)) && Number(flowAtual.bufferAtual) !== Number(bufferVivo.bufferAtualUtil)) {
    divergencias.push("buffer_atual_flow_diferente_buffer_util");
  }
  if (Number.isFinite(Number(saudeAgregada.capacidade)) && Number(saudeAgregada.capacidade) > 0 && bufferVivo.deficitBuffer <= 0) {
    divergencias.push("capacidade_agregada_nao_utilizavel_para_oferta");
  }
  return {
    divergente: divergencias.length > 0,
    divergencias,
    aceitarBufferVivo,
    aceitarFlow,
    bufferAlvo: bufferVivo.bufferAlvo,
    bufferAtualUtil: bufferVivo.bufferAtualUtil,
    deficitBuffer: bufferVivo.deficitBuffer,
    motivoBufferVivo: bufferVivo.motivo,
    motivoFlow: flowAtual.motivo || "",
    capacidadeAgregada: saudeAgregada.capacidade ?? null
  };
}

module.exports = {
  calcularBufferVivoWorkspace,
  resumirDivergenciaBufferVivo,
  coberturaFluxoMinutos,
  ttlFluxoMs,
  slotsCobertura
};
