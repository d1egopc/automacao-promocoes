"use strict";

const fs = require("fs");
const {
  itemVivoOperacional,
  statusItem,
  timestampFila,
  JANELA_EXECUTOR_MS
} = require("./fila-store");

const FILA_VIVA_ARQUIVO = "fila-viva.json";
const FILA_HISTORICO_ARQUIVO = "fila-historico.json";
const FILA_LEGADA_ARQUIVO = "fila.json";
const FILA_PROJECAO_LEVE_ARQUIVO = "fila-projecao-leve.json";
const INTERVALO_SHADOW_MS = 5 * 60 * 1000;

const STATUS_HISTORICO_EXPLICITO = new Set([
  "enviado",
  "enviada",
  "historico",
  "expirada",
  "expirado",
  "expirada_operacional",
  "expirado_operacional",
  "erro_final",
  "erro_permanente",
  "falha_final",
  "cancelada",
  "cancelado",
  "descartada",
  "descartado"
]);

const MOTIVOS_RETIDA_OPERACIONAL = [
  "intervalo",
  "aguardando",
  "fora_horario",
  "fora_da_janela",
  "limite_diario",
  "sessao",
  "proxima_tentativa"
];

const MOTIVOS_RETIDA_TERMINAL = [
  "sem_destino",
  "sem destino",
  "destino_compativel",
  "categoria_nao_marcada",
  "marketplace_nao_marcado",
  "repetida",
  "duplicata",
  "preco_suspeito",
  "retida_terminal"
];

function texto(valor = "") {
  return String(valor || "").trim();
}

function textoLimitado(valor = "", limite = 240) {
  const bruto = texto(valor);
  if (!bruto) return "";
  return bruto.length > limite ? `${bruto.slice(0, Math.max(0, limite - 3))}...` : bruto;
}

function textoNormalizado(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clienteItem(item = {}) {
  return texto(item.clienteId || item.cliente_id || "admin") || "admin";
}

function idItem(item = {}, indice = -1) {
  return texto(
    item.id ||
    item.ofertaId ||
    item.oferta_id ||
    item.engineOfertaId ||
    item.engine_oferta_id ||
    item.idOferta
  ) || `indice:${indice}`;
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const normalizado = texto(valor);
    if (normalizado) return normalizado;
  }
  return "";
}

function precoExibivelItemFila(item = {}) {
  const valor = item.precoAtual ?? item.preco ?? item.valorEfetivo ?? item.precoFinal ?? item.precoExibivel ?? "";
  if (valor === null || valor === undefined || valor === "") return "";
  return typeof valor === "number" ? valor : textoLimitado(valor, 80);
}

function imagemRefItemFila(item = {}) {
  return textoLimitado(
    primeiroTexto(
      item.imagemUsada,
      item.imagemFinal,
      item.imagemRef,
      item.imagemOriginal,
      item.thumbnail,
      item.thumbRef,
      item.imagemThumb,
      item.imagemThumbnail,
      item.imagemUrl,
      item.image,
      item.imagem
    ),
    500
  );
}

function thumbnailRefItemFila(item = {}) {
  return textoLimitado(
    primeiroTexto(
      item.thumbRef,
      item.thumbnail,
      item.thumbnailUrl,
      item.imagemThumb,
      item.imagemThumbnail,
      item.imagemPequena,
      item.imageThumbnail,
      item.metadata?.thumbnail,
      item.metadata?.thumbnailUrl
    ),
    500
  );
}

function categoriaItemFila(item = {}) {
  return textoLimitado(primeiroTexto(
    item.categoriaCanonica,
    item.categoriaCanônica,
    item.categoriaPersistida,
    item.categoriaProduto,
    item.categoriaDetectada,
    item.categoria,
    item.departamento,
    item.subcategoria
  ), 120);
}

function urlOriginalItemFila(item = {}) {
  return textoLimitado(
    primeiroTexto(
      item.urlOriginalProduto,
      item.produtoUrl,
      item.urlProduto,
      item.linkProduto,
      item.linkOriginal,
      item.urlOriginal,
      item.linkOriginalRadar,
      item.linkCapturado
    ),
    800
  );
}

function destinoCanalLeve(destino = {}) {
  return textoLimitado(primeiroTexto(destino.canal, destino.tipo, destino.type, destino.plataforma), 80);
}

function destinoIdLeve(destino = {}) {
  return textoLimitado(primeiroTexto(destino.destinoId, destino.id, destino.chatId, destino.grupoId, destino.canalId), 120);
}

function destinoNomeLeve(destino = {}) {
  return textoLimitado(nomeDestinoPublico(
    destino.destinoNome,
    destino.destino_nome,
    destino.destinoLabel,
    destino.grupoNome,
    destino.nomeGrupo,
    destino.channelName,
    destino.canalNome,
    destino.nomeCanal,
    destino.chatName,
    destino.chatTitle,
    destino.tituloDestino,
    destino.nome,
    destino.name,
    destino.label,
    destino.titulo
  ), 160);
}

function destinoIdItemLeve(item = {}) {
  return textoLimitado(primeiroTexto(item.destinoId, item.destino_id, item.chatId, item.grupoId, item.canalId), 120);
}

function destinoNomeItemLeve(item = {}) {
  return textoLimitado(nomeDestinoPublico(
    item.destinoNome,
    item.destino_nome,
    item.destinoLabel,
    item.grupoNome,
    item.nomeGrupo,
    item.channelName,
    item.canalNome,
    item.nomeCanal,
    item.chatName,
    item.chatTitle,
    item.tituloDestino,
    item.nomeDestino,
    item.destino
  ), 160);
}

function nomeDestinoPublico(...candidatos) {
  let nomeOperacional = "";
  for (const candidato of candidatos) {
    const valor = texto(candidato).trim();
    if (!valor) continue;
    const normalizado = textoNormalizado(valor).replace(/[^a-z0-9]+/g, "");
    if (["clonador", "clonadorgrupos", "origemclonador", "radar", "origemradar"].includes(normalizado)) {
      nomeOperacional = nomeOperacional || valor;
      continue;
    }
    return valor;
  }
  return nomeOperacional;
}

function estadoDestinoLeve(destino = {}) {
  return textoNormalizado(destino.estado || destino.status || destino.resultado || "");
}

function destinoAplicavelLeve(destino = {}) {
  const estado = estadoDestinoLeve(destino);
  if (!estado) return true;
  return ![
    "nao_compativel",
    "não_compativel",
    "naocompativel",
    "incompativel",
    "incompatível",
    "nao_aplicavel",
    "não_aplicavel",
    "naoaplicavel",
    "bloqueado_repeticao_2h"
  ].includes(estado);
}

function destinoEnviadoLeve(destino = {}) {
  const estado = estadoDestinoLeve(destino);
  if (estado === "enviado" || estado === "enviada") return true;
  if (destino.enviado === true || destino.ok === true) return true;
  if (destino.enviadoEm || destino.dataEnvio) return true;
  return false;
}

function destinoErroLeve(destino = {}) {
  const estado = estadoDestinoLeve(destino);
  return Boolean(
    estado.includes("erro") ||
    estado.includes("falha") ||
    estado.includes("nao_compativel") ||
    estado.includes("incompativel") ||
    estado.includes("bloqueado")
  );
}

function destinosEstadoLeves(item = {}) {
  const estados = Array.isArray(item.destinosEstado) ? item.destinosEstado : [];
  if (estados.length) {
    return estados.map(destino => ({
      destinoId: destinoIdLeve(destino),
      destinoNome: destinoNomeLeve(destino),
      canal: destinoCanalLeve(destino),
      estado: textoLimitado(primeiroTexto(destino.estado, destino.status, destino.resultado), 80),
      aplicavel: destinoAplicavelLeve(destino),
      enviado: destinoEnviadoLeve(destino),
      erro: destinoErroLeve(destino)
    }));
  }

  const destinos = Array.isArray(item.destinos) ? item.destinos : [];
  if (destinos.length) {
    return destinos.map(destino => ({
      destinoId: destinoIdLeve(destino),
      destinoNome: destinoNomeLeve(destino),
      canal: destinoCanalLeve(destino),
      estado: "",
      aplicavel: true,
      enviado: false,
      erro: false
    }));
  }

  const destinoId = destinoIdItemLeve(item);
  const destinoNome = destinoNomeItemLeve(item);
  const canal = destinoCanalLeve(item);
  return destinoId || destinoNome || canal
    ? [{ destinoId, destinoNome, canal, estado: "", aplicavel: true, enviado: false, erro: false }]
    : [];
}

function progressoDestinosLeve(item = {}) {
  const destinos = destinosEstadoLeves(item);
  const status = statusItem(item);
  const aplicaveis = destinos.filter(destino => destino.aplicavel !== false);
  const base = destinos.length ? aplicaveis : destinos;
  const total = base.length || (status === "enviado" || status === "enviada" ? 1 : 0);
  const enviados = base.length
    ? base.filter(destino => destino.enviado).length
    : (status === "enviado" || status === "enviada" ? 1 : 0);
  const erros = base.filter(destino => destino.erro).length;
  const pendentes = Math.max(0, total - enviados - erros);

  return { enviados, total, pendentes, erros };
}

function statusPublicoLeve(item = {}, opcoes = {}) {
  const status = statusItem(item);
  const progresso = opcoes.progresso || progressoDestinosLeve(item);
  const possuiDestinosDeclarados = Array.isArray(item.destinosEstado) && item.destinosEstado.length > 0;
  if (possuiDestinosDeclarados && progresso.total === 0) return "nao_enviado";
  if (progresso.total > 0) {
    if (progresso.enviados > 0 && progresso.enviados < progresso.total) return "em_distribuicao";
    if (progresso.enviados >= progresso.total) return "enviado";
  }
  if (status === "enviado" || status === "enviada") return "enviado";
  const classificacao = classificarItemFilaV2(item, { agora: opcoes.agora || Date.now() });
  return classificacao.bucket === "viva" ? "em_distribuicao" : "nao_enviado";
}

function finalizadoEmLeve(item = {}) {
  return primeiroTexto(
    item.finalizadoEm,
    item.enviadoEm,
    item.dataEnvio,
    item.expiradoEm,
    item.erroEm,
    item.updatedAt,
    item.atualizadoEm
  );
}

function motivoItem(item = {}) {
  return textoNormalizado([
    item.motivoRetencao,
    item.motivo,
    item.motivoFinal,
    item.statusDetalhe,
    item.statusDetalheVisual,
    item.erro
  ].filter(Boolean).join(" "));
}

function enviadoRecenteExecutor(item = {}, agora = Date.now()) {
  const status = statusItem(item);
  if (status !== "enviado" && status !== "enviada") return false;
  const enviadoEmMs = timestampFila(item.enviadoEm || item.dataEnvio);
  return Number.isFinite(enviadoEmMs) &&
    enviadoEmMs <= agora &&
    agora - enviadoEmMs < JANELA_EXECUTOR_MS;
}

function erroRecuperavel(item = {}) {
  return Boolean(item.proximaTentativaEnvioEm || item.retry || item.recuperavel);
}

function retidaOperacional(item = {}) {
  if (item.retidaTerminal === true) return false;
  if (item.proximaTentativaEnvioEm) return true;
  const motivo = motivoItem(item);
  if (MOTIVOS_RETIDA_OPERACIONAL.some(parte => motivo.includes(parte))) return true;
  if (MOTIVOS_RETIDA_TERMINAL.some(parte => motivo.includes(parte))) return false;
  return false;
}

function classificarItemFilaV2(item = {}, opcoes = {}) {
  const agora = Number(opcoes.agora || Date.now());
  const status = statusItem(item);

  if (itemVivoOperacional(item)) {
    return { bucket: "viva", motivo: "status_operacional" };
  }

  if (enviadoRecenteExecutor(item, agora)) {
    return { bucket: "viva", motivo: "enviado_recente_executor_2h" };
  }

  if (status === "erro") {
    return erroRecuperavel(item)
      ? { bucket: "viva", motivo: "erro_recuperavel" }
      : { bucket: "historico", motivo: "erro_terminal" };
  }

  if (status === "retida" || status === "retido") {
    return retidaOperacional(item)
      ? { bucket: "viva", motivo: "retida_operacional" }
      : { bucket: "historico", motivo: "retida_terminal" };
  }

  if (STATUS_HISTORICO_EXPLICITO.has(status)) {
    return { bucket: "historico", motivo: enviadoRecenteExecutor(item, agora) ? "enviado_recente_executor_2h" : "status_terminal" };
  }

  return { bucket: "viva", motivo: "fallback_conservador" };
}

function entradaShadow(item = {}, indice = 0, classificacao = {}) {
  return {
    posicaoLegada: indice,
    bucket: classificacao.bucket || "",
    motivoBucket: classificacao.motivo || "",
    status: statusItem(item),
    id: idItem(item, indice),
    item
  };
}

function projetarFilaV2(filaLegada = [], opcoes = {}) {
  const agora = Number(opcoes.agora || Date.now());
  const fila = Array.isArray(filaLegada) ? filaLegada : [];
  const viva = [];
  const historico = [];
  const statusViva = {};
  const statusHistorico = {};

  fila.forEach((item, indice) => {
    const classificacao = classificarItemFilaV2(item, { agora });
    const entrada = entradaShadow(item, indice, classificacao);
    if (classificacao.bucket === "historico") {
      historico.push(entrada);
      statusHistorico[entrada.status || "desconhecido"] = (statusHistorico[entrada.status || "desconhecido"] || 0) + 1;
    } else {
      viva.push(entrada);
      statusViva[entrada.status || "desconhecido"] = (statusViva[entrada.status || "desconhecido"] || 0) + 1;
    }
  });

  const unificada = recomporEntradasLegadas(viva, historico);
  const comparacao = compararFilaLegada(fila, unificada);

  return {
    ok: comparacao.divergencias === 0,
    totalLegado: fila.length,
    totalViva: viva.length,
    totalHistorico: historico.length,
    viva,
    historico,
    unificada,
    comparacao,
    statusViva,
    statusHistorico
  };
}

function projetarItemFilaLeve(item = {}, opcoes = {}) {
  const indice = Number.isFinite(Number(opcoes.indice)) ? Number(opcoes.indice) : -1;
  const progresso = progressoDestinosLeve(item);
  const destinos = destinosEstadoLeves(item);
  const primeiroDestino = destinos[0] || {};
  const statusOperacional = statusItem(item);
  const statusPublico = statusPublicoLeve(item, { ...opcoes, progresso });

  return {
    versao: 1,
    id: idItem(item, indice),
    ofertaId: textoLimitado(primeiroTexto(item.ofertaId, item.oferta_id, item.idOferta), 120),
    engineOfertaId: textoLimitado(primeiroTexto(item.engineOfertaId, item.engine_oferta_id), 120),
    clienteId: clienteItem(item),
    titulo: textoLimitado(primeiroTexto(item.titulo, item.nome, item.produto), 240),
    marketplace: textoLimitado(primeiroTexto(item.marketplace, item.mercado), 80),
    categoria: categoriaItemFila(item),
    imagemRef: imagemRefItemFila(item),
    thumbRef: thumbnailRefItemFila(item),
    urlOriginal: urlOriginalItemFila(item),
    precoExibivel: precoExibivelItemFila(item),
    statusPublico,
    statusOperacional,
    canal: primeiroDestino.canal || textoLimitado(primeiroTexto(item.canal, item.tipoCanal), 80),
    destinoId: primeiroDestino.destinoId || destinoIdItemLeve(item),
    destinoNome: primeiroDestino.destinoNome || destinoNomeItemLeve(item),
    destinos: destinos.map(destino => ({
      destinoId: destino.destinoId,
      destinoNome: destino.destinoNome,
      canal: destino.canal,
      estado: destino.estado,
      aplicavel: destino.aplicavel !== false
    })),
    progresso,
    motivoPublico: textoLimitado(primeiroTexto(
      item.statusDetalheVisual,
      item.motivoPublico,
      item.motivoRetencao,
      item.motivo,
      item.statusDetalhe,
      item.erro
    ), 240),
    criadoEm: primeiroTexto(item.criadoEm, item.createdAt, item.dataEntradaFila, item.adicionadoEm),
    enviadoEm: primeiroTexto(item.enviadoEm, item.dataEnvio),
    finalizadoEm: finalizadoEmLeve(item),
    updatedAt: primeiroTexto(item.updatedAt, item.atualizadoEm, item.enviadoEm, item.dataEnvio, item.criadoEm, item.createdAt),
    detalheRef: {
      arquivo: FILA_LEGADA_ARQUIVO,
      id: idItem(item, indice)
    }
  };
}

function projetarFilaLeve(filaLegada = [], opcoes = {}) {
  const cliente = texto(opcoes.clienteId || "");
  const fila = Array.isArray(filaLegada) ? filaLegada : [];
  const itens = [];
  const vistos = new Map();

  fila.forEach((item, indice) => {
    if (cliente && clienteItem(item) !== cliente) return;
    const projetado = projetarItemFilaLeve(item, { ...opcoes, indice });
    const chave = projetado.id || `indice:${indice}`;
    if (vistos.has(chave)) {
      itens[vistos.get(chave)] = projetado;
      return;
    }
    vistos.set(chave, itens.length);
    itens.push(projetado);
  });

  const contadores = {
    total: itens.length,
    emDistribuicao: itens.filter(item => item.statusPublico === "em_distribuicao").length,
    enviados: itens.filter(item => item.statusPublico === "enviado").length,
    naoEnviados: itens.filter(item => item.statusPublico === "nao_enviado").length
  };

  return {
    versao: 1,
    clienteId: cliente || "",
    geradoEm: new Date(Number(opcoes.agora || Date.now())).toISOString(),
    total: itens.length,
    contadores,
    itens
  };
}

function atualizarItemProjecaoLeveFila(projecaoAtual = {}, item = {}, opcoes = {}) {
  const cliente = opcoes.clienteId || projecaoAtual.clienteId || clienteItem(item);
  const atual = Array.isArray(projecaoAtual?.itens) ? [...projecaoAtual.itens] : [];
  const projetado = projetarItemFilaLeve(item, opcoes);
  const indice = atual.findIndex(entrada => entrada.id === projetado.id);
  if (indice >= 0) {
    atual[indice] = projetado;
  } else {
    atual.push(projetado);
  }

  const contadores = {
    total: atual.length,
    emDistribuicao: atual.filter(entrada => entrada.statusPublico === "em_distribuicao").length,
    enviados: atual.filter(entrada => entrada.statusPublico === "enviado").length,
    naoEnviados: atual.filter(entrada => entrada.statusPublico === "nao_enviado").length
  };

  return {
    versao: 1,
    clienteId: cliente,
    geradoEm: new Date(Number(opcoes.agora || Date.now())).toISOString(),
    total: atual.length,
    contadores,
    itens: atual
  };
}

function compararProjecaoLeveComLegado(filaLegada = [], projecaoLeve = {}, opcoes = {}) {
  const esperada = projetarFilaLeve(filaLegada, opcoes);
  const atual = Array.isArray(projecaoLeve?.itens) ? projecaoLeve.itens : [];
  const divergencias = {
    total: esperada.itens.length === atual.length ? 0 : Math.abs(esperada.itens.length - atual.length) || 1,
    ids: 0,
    statusPublico: 0,
    destinos: 0,
    campos: 0
  };
  const porId = new Map(atual.map(item => [item.id, item]));

  for (const itemEsperado of esperada.itens) {
    const itemAtual = porId.get(itemEsperado.id);
    if (!itemAtual) {
      divergencias.ids += 1;
      continue;
    }
    if (itemAtual.statusPublico !== itemEsperado.statusPublico) divergencias.statusPublico += 1;
    if (
      Number(itemAtual.progresso?.enviados || 0) !== Number(itemEsperado.progresso?.enviados || 0) ||
      Number(itemAtual.progresso?.total || 0) !== Number(itemEsperado.progresso?.total || 0)
    ) {
      divergencias.destinos += 1;
    }
    for (const campo of ["clienteId", "titulo", "marketplace", "precoExibivel", "criadoEm", "enviadoEm", "updatedAt"]) {
      if ((itemAtual[campo] || "") !== (itemEsperado[campo] || "")) divergencias.campos += 1;
    }
  }

  const totalDivergencias = divergencias.total + divergencias.ids + divergencias.statusPublico + divergencias.destinos + divergencias.campos;
  return {
    ok: totalDivergencias === 0,
    divergencias: totalDivergencias,
    ...divergencias,
    esperadoTotal: esperada.itens.length,
    atualTotal: atual.length
  };
}

function benchmarkProjecaoLeveFila(filaLegada = [], opcoes = {}) {
  const inicio = process.hrtime.bigint();
  const projecao = projetarFilaLeve(filaLegada, opcoes);
  const duracaoProjecaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
  const bytesLegado = tamanhoJsonBytes(Array.isArray(filaLegada) ? filaLegada : []);
  const bytesProjecao = tamanhoJsonBytes(projecao);
  const inicioListagem = process.hrtime.bigint();
  const listagem20 = projecao.itens.slice(0, 20);
  const tempoListar20Ms = Math.round(Number(process.hrtime.bigint() - inicioListagem) / 1e6);
  const inicioContagem = process.hrtime.bigint();
  const contadores = {
    emDistribuicao: projecao.itens.filter(item => item.statusPublico === "em_distribuicao").length,
    enviados: projecao.itens.filter(item => item.statusPublico === "enviado").length,
    naoEnviados: projecao.itens.filter(item => item.statusPublico === "nao_enviado").length
  };
  const tempoContarMs = Math.round(Number(process.hrtime.bigint() - inicioContagem) / 1e6);

  return {
    total: projecao.itens.length,
    bytesLegado,
    bytesProjecao,
    bytesMediosLegado: projecao.itens.length ? Math.round(bytesLegado / projecao.itens.length) : 0,
    bytesMediosProjecao: projecao.itens.length ? Math.round(bytesProjecao / projecao.itens.length) : 0,
    reducaoPercentual: bytesLegado > 0 ? Number(((1 - (bytesProjecao / bytesLegado)) * 100).toFixed(2)) : 0,
    duracaoProjecaoMs,
    tempoListar20Ms,
    tempoContarMs,
    listagem20: listagem20.length,
    contadores
  };
}

function recomporEntradasLegadas(viva = [], historico = []) {
  return [...(Array.isArray(viva) ? viva : []), ...(Array.isArray(historico) ? historico : [])]
    .sort((a, b) => Number(a?.posicaoLegada || 0) - Number(b?.posicaoLegada || 0))
    .map(entrada => entrada?.item)
    .filter(Boolean);
}

function compararFilaLegada(filaLegada = [], filaUnificada = []) {
  const divergencias = {
    total: 0,
    ids: 0,
    status: 0,
    ordem: 0
  };
  const legado = Array.isArray(filaLegada) ? filaLegada : [];
  const unificada = Array.isArray(filaUnificada) ? filaUnificada : [];

  if (legado.length !== unificada.length) divergencias.total += Math.abs(legado.length - unificada.length) || 1;

  const limite = Math.min(legado.length, unificada.length);
  for (let i = 0; i < limite; i += 1) {
    const idLegado = idItem(legado[i], i);
    const idUnificado = idItem(unificada[i], i);
    if (idLegado !== idUnificado) {
      divergencias.ids += 1;
      divergencias.ordem += 1;
    }
    if (statusItem(legado[i]) !== statusItem(unificada[i])) divergencias.status += 1;
  }

  const totalDivergencias = divergencias.total + divergencias.ids + divergencias.status + divergencias.ordem;
  return {
    ok: totalDivergencias === 0,
    divergencias: totalDivergencias,
    totalDivergente: divergencias.total,
    idsDivergentes: divergencias.ids,
    statusDivergentes: divergencias.status,
    ordemDivergente: divergencias.ordem
  };
}

function tamanhoJsonBytes(valor) {
  try {
    return Buffer.byteLength(JSON.stringify(valor, null, 2), "utf8");
  } catch {
    return 0;
  }
}

function statBytes(file = "") {
  try {
    return fs.existsSync(file) ? fs.statSync(file).size : 0;
  } catch {
    return 0;
  }
}

function caminhoCliente(getClienteJsonPath, clienteId = "admin", arquivo = "") {
  if (typeof getClienteJsonPath !== "function") return "";
  return getClienteJsonPath(clienteId, arquivo);
}

function logShadow(logger = console, payload = {}) {
  const destino = logger && typeof logger.log === "function" ? logger : console;
  destino.log("[FILA-V2-SHADOW]", JSON.stringify(payload));
}

function shadowCompletoEvitado(opcoes = {}, params = {}, clienteId = "admin") {
  if (typeof opcoes.devePularShadowCompleto === "function") {
    try {
      return opcoes.devePularShadowCompleto({
        clienteId,
        motivo: params.motivo || "snapshot",
        agora: params.agora || Date.now()
      }) === true;
    } catch {
      return false;
    }
  }
  return opcoes.pularShadowCompleto === true;
}

function logShadowCompletoEvitado(logger = console, params = {}, clienteId = "admin") {
  const payload = {
    versao: 2,
    motivo: params.motivo || "snapshot",
    clienteId,
    pulou: true,
    shadowCompletoEvitado: true,
    motivoSkip: "fila_v2_operacional_habilitada",
    totalLegado: "nao_medido",
    totalViva: "nao_medido",
    totalHistorico: "nao_medido",
    bytesFilaJson: "nao_medido",
    bytesFilaVivaJson: "nao_medido",
    bytesFilaHistoricoJson: "nao_medido",
    tempoProjecaoMs: 0
  };
  logShadow(logger, payload);
  return { ok: true, ...payload };
}

function projetarFilaV2Shadow({
  fila = [],
  clienteId = "admin",
  motivo = "snapshot",
  agora = Date.now(),
  writeClienteJson,
  getClienteJsonPath,
  logger = console
} = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = texto(clienteId || "admin") || "admin";

  try {
    const legadoCliente = (Array.isArray(fila) ? fila : [])
      .filter(item => clienteItem(item) === cliente);
    const projecao = projetarFilaV2(legadoCliente, { agora });
    const projecaoLeve = projetarFilaLeve(legadoCliente, { clienteId: cliente, agora });
    let projecaoLeveErro = "";
    let escreveuProjecaoLeve = false;

    if (typeof writeClienteJson === "function") {
      writeClienteJson(cliente, FILA_VIVA_ARQUIVO, projecao.viva);
      writeClienteJson(cliente, FILA_HISTORICO_ARQUIVO, projecao.historico);
      try {
        writeClienteJson(cliente, FILA_PROJECAO_LEVE_ARQUIVO, projecaoLeve);
        escreveuProjecaoLeve = true;
      } catch (erroProjecaoLeve) {
        projecaoLeveErro = erroProjecaoLeve?.message || "erro_projecao_leve";
      }
    }

    const arquivoLegado = caminhoCliente(getClienteJsonPath, cliente, FILA_LEGADA_ARQUIVO);
    const arquivoViva = caminhoCliente(getClienteJsonPath, cliente, FILA_VIVA_ARQUIVO);
    const arquivoHistorico = caminhoCliente(getClienteJsonPath, cliente, FILA_HISTORICO_ARQUIVO);
    const arquivoProjecaoLeve = caminhoCliente(getClienteJsonPath, cliente, FILA_PROJECAO_LEVE_ARQUIVO);
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);

    const payload = {
      versao: 1,
      motivo,
      clienteId: cliente,
      totalLegado: projecao.totalLegado,
      totalViva: projecao.totalViva,
      totalHistorico: projecao.totalHistorico,
      divergencias: projecao.comparacao.divergencias,
      idsDivergentes: projecao.comparacao.idsDivergentes,
      statusDivergentes: projecao.comparacao.statusDivergentes,
      ordemDivergente: projecao.comparacao.ordemDivergente,
      bytesFilaJson: statBytes(arquivoLegado) || tamanhoJsonBytes(legadoCliente),
      bytesFilaVivaJson: statBytes(arquivoViva) || tamanhoJsonBytes(projecao.viva),
      bytesFilaHistoricoJson: statBytes(arquivoHistorico) || tamanhoJsonBytes(projecao.historico),
      bytesFilaProjecaoLeveJson: statBytes(arquivoProjecaoLeve) || tamanhoJsonBytes(projecaoLeve),
      projecaoLeveOk: !projecaoLeveErro,
      projecaoLeveEscrita: escreveuProjecaoLeve,
      projecaoLeveErro,
      tempoProjecaoMs: duracaoMs,
      statusViva: projecao.statusViva,
      statusHistorico: projecao.statusHistorico
    };

    logShadow(logger, payload);
    return { ok: true, ...payload, projecao, projecaoLeve };
  } catch (erro) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    const payload = {
      versao: 1,
      motivo,
      clienteId: cliente,
      ok: false,
      erro: erro?.message || "erro_shadow",
      tempoProjecaoMs: duracaoMs
    };
    logShadow(logger, payload);
    return payload;
  }
}

function lerEntradasShadow(readClienteJson, clienteId = "admin", arquivo = "") {
  if (typeof readClienteJson !== "function") return [];
  const lido = readClienteJson(clienteId, arquivo, []);
  return Array.isArray(lido) ? lido : [];
}

function obterFilaLegadaUnificada(clienteId = "admin", deps = {}) {
  const cliente = texto(clienteId || "admin") || "admin";
  const viva = lerEntradasShadow(deps.readClienteJson, cliente, FILA_VIVA_ARQUIVO);
  const historico = lerEntradasShadow(deps.readClienteJson, cliente, FILA_HISTORICO_ARQUIVO);

  if (viva.length || historico.length) {
    return {
      ok: true,
      fonte: "fila_v2_shadow",
      fila: recomporEntradasLegadas(viva, historico)
    };
  }

  const legado = typeof deps.readClienteJson === "function"
    ? deps.readClienteJson(cliente, FILA_LEGADA_ARQUIVO, [])
    : [];

  return {
    ok: true,
    fonte: "fila_json_legado",
    fila: Array.isArray(legado) ? legado : []
  };
}

function criarControladorFilaV2Shadow(opcoes = {}) {
  const intervaloMs = Number(opcoes.intervaloMs ?? INTERVALO_SHADOW_MS);
  const ultimoPorCliente = new Map();

  function projetarSeNecessario(params = {}) {
    const cliente = texto(params.clienteId || "admin") || "admin";
    const agora = Number(params.agora || Date.now());
    const ultimo = ultimoPorCliente.get(cliente) || 0;
    const forcar = params.forcar === true;
    if (!forcar && intervaloMs > 0 && agora - ultimo < intervaloMs) {
      return { ok: true, pulou: true, motivo: "throttle_shadow", clienteId: cliente };
    }
    ultimoPorCliente.set(cliente, agora);
    if (shadowCompletoEvitado(opcoes, params, cliente)) {
      return logShadowCompletoEvitado(params.logger || opcoes.logger, params, cliente);
    }
    return projetarFilaV2Shadow({ ...opcoes, ...params, clienteId: cliente, agora });
  }

  return {
    projetarSeNecessario
  };
}

module.exports = {
  FILA_VIVA_ARQUIVO,
  FILA_HISTORICO_ARQUIVO,
  FILA_LEGADA_ARQUIVO,
  FILA_PROJECAO_LEVE_ARQUIVO,
  INTERVALO_SHADOW_MS,
  classificarItemFilaV2,
  enviadoRecenteExecutor,
  projetarFilaV2,
  projetarItemFilaLeve,
  projetarFilaLeve,
  atualizarItemProjecaoLeveFila,
  compararProjecaoLeveComLegado,
  benchmarkProjecaoLeveFila,
  projetarFilaV2Shadow,
  obterFilaLegadaUnificada,
  criarControladorFilaV2Shadow
};
