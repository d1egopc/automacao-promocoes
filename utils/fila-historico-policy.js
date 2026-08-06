"use strict";

const HISTORICO_DETALHADO_MS = 24 * 60 * 60 * 1000;
const HISTORICO_COMPACTO_MS = 7 * 24 * 60 * 60 * 1000;

const STATUS_VIVO = new Set([
  "pendente",
  "aguardando",
  "pronta",
  "pronto",
  "processando",
  "enviando",
  "em_tentativa",
  "tentando",
  "tentativa_futura",
  "erro_temporario",
  "erro_retry",
  "erro_recuperavel",
  "retry"
]);

const STATUS_PROCESSANDO = new Set(["processando", "enviando", "em_tentativa", "tentando"]);
const STATUS_ENVIADO = new Set(["enviado", "historico", "publicado", "sucesso"]);
const STATUS_FINAL = new Set([
  "cancelada",
  "cancelado",
  "erro_final",
  "erro_permanente",
  "falha_final",
  "expirada",
  "expirado",
  "expirada_operacional",
  "expirado_operacional",
  "flow_nao_aceita"
]);

const MOTIVOS_RETIDA_TERMINAL = new Set([
  "retida_preco_shopee_suspeito",
  "retida_canonica_ja_existente",
  "duplicidade_fila",
  "repetida_no_executor_2h",
  "produto_invalido",
  "produto_nao_comprovado",
  "titulo_ausente",
  "link_afiliado_ausente"
]);

function normalizarStatus(valor = "") {
  return String(valor || "").trim().toLowerCase();
}

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function numeroOuNull(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function timestampMs(valor) {
  if (!valor) return null;
  const ms = new Date(valor).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function primeiroTexto(item = {}, campos = []) {
  for (const campo of campos) {
    const valor = texto(item?.[campo]);
    if (valor) return valor;
  }
  return "";
}

function extrairTimestampFinal(item = {}) {
  for (const campo of ["enviadoEm", "finalizadoEm", "dataEnvio", "retidaEm", "erroEm", "expiradaEm", "atualizadoEm", "updatedAt"]) {
    const ms = timestampMs(item?.[campo]);
    if (Number.isFinite(ms)) return { campo, valor: item[campo], ms };
  }
  return { campo: null, valor: null, ms: null };
}

function extrairTimestampCriacao(item = {}) {
  for (const campo of ["criadoEm", "dataEntradaFila", "createdAt", "adicionadoEm", "capturadoEm"]) {
    const ms = timestampMs(item?.[campo]);
    if (Number.isFinite(ms)) return { campo, valor: item[campo], ms };
  }
  return { campo: null, valor: null, ms: null };
}

function motivoRetida(item = {}) {
  return normalizarStatus(
    item.motivoRetencao ||
    item.motivoFinal ||
    item.motivo ||
    item.statusMotivo ||
    item.metadata?.motivoRetencao ||
    item.metadata?.motivoFinal ||
    ""
  );
}

function retidaTerminal(item = {}) {
  const motivo = motivoRetida(item);
  if (item.retidaTerminal === true || item.terminal === true) return true;
  if (item.acionavel === true || item.reprocessavel === true) return false;
  return MOTIVOS_RETIDA_TERMINAL.has(motivo);
}

function classificarEstadoFila(item = {}) {
  const status = normalizarStatus(item.status || item.estado || "");
  if (STATUS_PROCESSANDO.has(status)) return { status, estado: "vivo", motivo: "item_processando" };
  if (STATUS_VIVO.has(status)) return { status, estado: "vivo", motivo: "item_vivo" };
  if (status === "retida" || status === "retido") {
    if (retidaTerminal(item)) return { status, estado: "final", motivo: "retida_terminal" };
    return { status, estado: "vivo", motivo: "retida_acionavel_protegida" };
  }
  if (STATUS_ENVIADO.has(status) || STATUS_FINAL.has(status)) return { status, estado: "final", motivo: "status_final" };
  if (!status) return { status, estado: "protegido", motivo: "status_ausente" };
  return { status, estado: "protegido", motivo: "status_sem_politica_final" };
}

function sanitizarMotivo(valor = "") {
  return texto(valor)
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function thumbnailLeve(valor = "") {
  const url = texto(valor);
  if (!url || url.length > 300) return "";
  if (/^(data:|blob:|file:)/i.test(url)) return "";
  if (/;base64,|base64/i.test(url)) return "";
  if (!/^https?:\/\//i.test(url)) return "";
  return url;
}

function escolherThumbnail(item = {}) {
  return thumbnailLeve(
    item.thumbnail ||
    item.thumbnailUrl ||
    item.imagemThumbnail ||
    item.imagemPequena ||
    item.imageThumbnail ||
    item.metadata?.thumbnail ||
    ""
  );
}

function registroCompactoFila(item = {}) {
  const preco = numeroOuNull(item.preco ?? item.precoAtual ?? item.valor);
  const thumbnail = escolherThumbnail(item);
  const compacto = {
    compacto: true,
    compactadoEmPolitica: "fila_historico_v1",
    id: item.id || item.filaItemId || null,
    filaItemId: item.filaItemId || item.id || null,
    ofertaId: item.ofertaId || item.engineOfertaId || item.oferta_id || null,
    workspaceId: item.workspaceId || item.clienteId || item.cliente_id || null,
    clienteId: item.clienteId || item.workspaceId || item.cliente_id || null,
    marketplace: primeiroTexto(item, ["marketplace", "origemMarketplace", "loja"]) || null,
    categoria: primeiroTexto(item, ["categoria", "categoriaProduto"]) || null,
    status: item.status || item.estado || null,
    criadoEm: item.criadoEm || item.createdAt || null,
    dataEntradaFila: item.dataEntradaFila || item.adicionadoEm || null,
    enviadoEm: item.enviadoEm || item.dataEnvio || null,
    finalizadoEm: item.finalizadoEm || item.erroEm || item.retidaEm || item.expiradaEm || null,
    destinoId: item.destinoId || item.destino?.id || null,
    destinoNome: item.destinoNome || item.destino?.nome || null,
    canal: item.canal || item.tipoDestino || item.destinoTipo || null,
    tentativas: Number.isFinite(Number(item.tentativas)) ? Number(item.tentativas) : Number.isFinite(Number(item.tentativasEnvio)) ? Number(item.tentativasEnvio) : 0,
    motivoFinal: sanitizarMotivo(item.motivoFinal || item.motivoRetencao || item.motivo || item.statusDetalhe || ""),
    preco: preco === null ? undefined : preco,
    thumbnail: thumbnail || undefined
  };

  return Object.fromEntries(Object.entries(compacto).filter(([, valor]) => valor !== undefined && valor !== null && valor !== ""));
}

function analisarItemHistoricoFila(item = {}, opcoes = {}) {
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const politica = {
    historicoDetalhadoMs: HISTORICO_DETALHADO_MS,
    historicoCompactoMs: HISTORICO_COMPACTO_MS,
    ...(opcoes.politica || {})
  };
  const estado = classificarEstadoFila(item);
  const finalTs = extrairTimestampFinal(item);
  const criacaoTs = extrairTimestampCriacao(item);
  const referenciaMs = Number.isFinite(finalTs.ms) ? finalTs.ms : criacaoTs.ms;
  const idadeMs = Number.isFinite(referenciaMs) ? Math.max(0, agoraMs - referenciaMs) : null;
  const tamanhoOriginalBytes = Buffer.byteLength(JSON.stringify(item || {}), "utf8");

  if (estado.estado !== "final") {
    return {
      acao: "preservar_integral",
      motivo: estado.motivo,
      status: estado.status,
      idadeMs,
      tamanhoOriginalBytes,
      tamanhoEstimadoBytes: tamanhoOriginalBytes,
      bytesRecuperaveis: 0,
      protegido: true,
      item
    };
  }

  if (!Number.isFinite(idadeMs)) {
    return {
      acao: "preservar_integral",
      motivo: "timestamp_final_indisponivel",
      status: estado.status,
      idadeMs: null,
      tamanhoOriginalBytes,
      tamanhoEstimadoBytes: tamanhoOriginalBytes,
      bytesRecuperaveis: 0,
      protegido: true,
      item
    };
  }

  if (idadeMs < politica.historicoDetalhadoMs) {
    return {
      acao: "preservar_integral",
      motivo: "historico_detalhado_24h",
      status: estado.status,
      idadeMs,
      tamanhoOriginalBytes,
      tamanhoEstimadoBytes: tamanhoOriginalBytes,
      bytesRecuperaveis: 0,
      protegido: true,
      item
    };
  }

  if (idadeMs >= politica.historicoCompactoMs) {
    return {
      acao: "remover",
      motivo: "historico_final_maior_7d",
      status: estado.status,
      idadeMs,
      tamanhoOriginalBytes,
      tamanhoEstimadoBytes: 0,
      bytesRecuperaveis: tamanhoOriginalBytes,
      protegido: false,
      item: null
    };
  }

  const compacto = registroCompactoFila(item);
  const tamanhoEstimadoBytes = Buffer.byteLength(JSON.stringify(compacto), "utf8");
  return {
    acao: "compactar",
    motivo: "historico_final_24h_7d",
    status: estado.status,
    idadeMs,
    tamanhoOriginalBytes,
    tamanhoEstimadoBytes,
    bytesRecuperaveis: Math.max(0, tamanhoOriginalBytes - tamanhoEstimadoBytes),
    protegido: false,
    item: compacto
  };
}

function analisarFilaHistorico(fila = [], opcoes = {}) {
  const itens = [];
  const transformada = [];
  const resumo = {
    totalItens: Array.isArray(fila) ? fila.length : 0,
    integrais: 0,
    compactaveis: 0,
    removiveis: 0,
    protegidos: 0,
    bytesOriginaisItens: 0,
    bytesEstimadosItens: 0,
    bytesRecuperaveis: 0,
    motivos: {}
  };

  for (const item of Array.isArray(fila) ? fila : []) {
    const decisao = analisarItemHistoricoFila(item, opcoes);
    itens.push(decisao);
    resumo.bytesOriginaisItens += decisao.tamanhoOriginalBytes || 0;
    resumo.bytesEstimadosItens += decisao.tamanhoEstimadoBytes || 0;
    resumo.bytesRecuperaveis += decisao.bytesRecuperaveis || 0;
    resumo.motivos[decisao.motivo] = (resumo.motivos[decisao.motivo] || 0) + 1;
    if (decisao.acao === "preservar_integral") resumo.integrais += 1;
    if (decisao.acao === "compactar") resumo.compactaveis += 1;
    if (decisao.acao === "remover") resumo.removiveis += 1;
    if (decisao.protegido) resumo.protegidos += 1;
    if (decisao.acao !== "remover") transformada.push(decisao.item);
  }

  resumo.totalApos = transformada.length;
  resumo.tamanhoJsonEstimadoAntesBytes = Buffer.byteLength(JSON.stringify(Array.isArray(fila) ? fila : []), "utf8");
  resumo.tamanhoJsonEstimadoDepoisBytes = Buffer.byteLength(JSON.stringify(transformada), "utf8");
  resumo.bytesRecuperaveisJson = Math.max(0, resumo.tamanhoJsonEstimadoAntesBytes - resumo.tamanhoJsonEstimadoDepoisBytes);
  return { resumo, itens, transformada };
}

module.exports = {
  HISTORICO_DETALHADO_MS,
  HISTORICO_COMPACTO_MS,
  STATUS_VIVO,
  STATUS_PROCESSANDO,
  STATUS_ENVIADO,
  STATUS_FINAL,
  normalizarStatus,
  classificarEstadoFila,
  analisarItemHistoricoFila,
  analisarFilaHistorico,
  registroCompactoFila,
  thumbnailLeve
};
