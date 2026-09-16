"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const filaHistoricoPolicy = require("../../utils/fila-historico-policy");
const {
  projetarItemFilaLeve,
  FILA_PROJECAO_LEVE_ARQUIVO
} = require("./fila-v2-shadow");

const HISTORICO_LEVE_INCREMENTAL_DIR = "fila-historico-leve-incremental";
const HISTORICO_INCREMENTAL_DIR = "fila-historico-incremental";
const ARQUIVOS_DETALHE_REF_PERMITIDOS = new Set([
  "",
  HISTORICO_LEVE_INCREMENTAL_DIR,
  HISTORICO_INCREMENTAL_DIR,
  FILA_PROJECAO_LEVE_ARQUIVO,
  "fila-historico.json",
  "fila.json"
]);
const DIA_MS = 24 * 60 * 60 * 1000;
const JANELA_PUBLICA_DIAS_PADRAO = 7;
const VISAO_PROCESSADAS = "processadas";
const VISAO_ENVIADAS = "enviadas";
const VISAO_PARCIAIS = "parciais";
const VISAO_NAO_ENVIADAS = "nao_enviadas";
const VISAO_COM_ERRO = "com_erro";
const FORMATADOR_DIA_PUBLICO_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoLimitado(valor = "", limite = 240) {
  const bruto = texto(valor);
  if (!bruto) return "";
  return bruto.length > limite ? `${bruto.slice(0, Math.max(0, limite - 3))}...` : bruto;
}

function normalizarTexto(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clienteSeguro(valor = "admin") {
  return texto(valor || "admin") || "admin";
}

function timestampMs(valor) {
  if (!valor) return null;
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  const textoValor = String(valor).trim();
  const brasileiro = textoValor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (brasileiro) {
    const msBr = Date.UTC(
      Number(brasileiro[3]),
      Number(brasileiro[2]) - 1,
      Number(brasileiro[1]),
      Number(brasileiro[4]) + 3,
      Number(brasileiro[5]),
      Number(brasileiro[6] || 0)
    );
    if (Number.isFinite(msBr)) return msBr;
  }
  const ms = Date.parse(textoValor);
  return Number.isFinite(ms) ? ms : null;
}

function isoOuVazio(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const t = texto(valor);
    if (t) return t;
  }
  return "";
}

function dataArquivoIso(ms) {
  return isoOuVazio(ms).slice(0, 10);
}

function dataDiaPublica(ms, timeZone = "America/Sao_Paulo") {
  if (!Number.isFinite(ms)) return "";
  if (!timeZone || timeZone === "America/Sao_Paulo") {
    return FORMATADOR_DIA_PUBLICO_SP.format(new Date(ms));
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(ms));
}

function parseDiaArquivo(nome = "") {
  const match = String(nome || "").match(/^(\d{4})-(\d{2})-(\d{2})\.jsonl$/);
  if (!match) return null;
  const ms = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function marcoProcessadaItem(item = {}) {
  const candidatos = [
    ["dataEntradaFila", item.dataEntradaFila],
    ["filaCriadoEm", item.filaCriadoEm],
    ["adicionadoEm", item.adicionadoEm],
    ["criadoEm", item.criadoEm],
    ["createdAt", item.createdAt],
    ["created_at", item.created_at]
  ];
  for (const [campo, valor] of candidatos) {
    const ms = timestampMs(valor);
    if (Number.isFinite(ms)) {
      return { ok: true, campo, valor: String(valor), ms };
    }
  }
  return { ok: false, campo: "", valor: "", ms: null };
}

function timestampResultadoItem(item = {}) {
  for (const valor of [
    item.finalizadoEm,
    item.enviadoEm,
    item.dataEnvio,
    item.erroEm,
    item.retidaEm,
    item.expiradaEm,
    item.updatedAt,
    item.atualizadoEm
  ]) {
    const ms = timestampMs(valor);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function hashCurto(valor = "") {
  return crypto.createHash("sha1").update(String(valor || "")).digest("hex");
}

function idExecucaoItem(item = {}, indice = -1) {
  return texto(
    item.id ||
    item.filaItemId ||
    item.itemFilaId ||
    item.filaId ||
    item.idFila ||
    item.execucaoId ||
    item.executionId ||
    item.distribuicaoId ||
    item.distributionId ||
    item.jobId ||
    item.job_id ||
    item.ofertaOperacionalId ||
    item.operacionalId ||
    item.ofertaId ||
    item.oferta_id ||
    item.engineOfertaId ||
    item.engine_oferta_id ||
    item.idOferta
  ) || `indice:${indice}`;
}

function identidadeFallback(clienteId = "admin", item = {}, indice = -1) {
  const nascimento = primeiroTexto(
    item.dataEntradaFila,
    item.criadoEm,
    item.createdAt,
    item.adicionadoEm,
    item.filaCriadoEm
  ) || `pos:${indice}`;
  const base = [
    clienteSeguro(clienteId),
    idExecucaoItem(item, indice),
    nascimento
  ].join("|");
  return `fallback:${hashCurto(base)}`;
}

function identidadesRegistro(registro = {}, indice = -1, clienteIdPadrao = "admin") {
  const item = registro?.item && typeof registro.item === "object" ? registro.item : registro;
  const cliente = clienteSeguro(registro?.clienteId || item?.clienteId || clienteIdPadrao);
  const ids = [];
  const chave = texto(registro?.chave || item?.chave);
  const detalheId = texto(registro?.detalheRef?.id || item?.detalheRef?.id);
  const id = idExecucaoItem(item, indice);
  if (chave) ids.push(`chave:${chave}`);
  if (id) ids.push(`id:${id}`);
  if (detalheId) ids.push(`id:${detalheId}`);
  ids.push(identidadeFallback(cliente, item, indice));
  return [...new Set(ids)];
}

function identidadePrincipal(registro = {}, indice = -1, clienteIdPadrao = "admin") {
  const identidades = identidadesRegistro(registro, indice, clienteIdPadrao);
  const porId = identidades.find(id => id.startsWith("id:"));
  return porId || identidades[0] || "";
}

function registroDentroJanela(ms, opcoes = {}) {
  if (!Number.isFinite(ms)) return false;
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const periodo = normalizarTexto(opcoes.periodo || "");
  if (periodo === "hoje") {
    return dataDiaPublica(ms, opcoes.timeZone) === dataDiaPublica(agoraMs, opcoes.timeZone);
  }
  const janelaDias = Number(opcoes.janelaDias || JANELA_PUBLICA_DIAS_PADRAO);
  if (!Number.isFinite(janelaDias) || janelaDias <= 0) return true;
  return ms >= agoraMs - janelaDias * DIA_MS && ms <= agoraMs + DIA_MS;
}

function resultadoPublicoTerminal(item = {}) {
  const destinos = Array.isArray(item.destinos) && item.destinos.length
    ? item.destinos
    : (Array.isArray(item.destinosEstado) ? item.destinosEstado : []);
  if (destinos.length) {
    const aplicaveis = destinos.filter(destino => {
      if (destino?.aplicavel === false) return false;
      const estado = normalizarTexto(destino?.estado || destino?.status || destino?.resultado || "");
      return ![
        "nao compativel",
        "nao_compativel",
        "naocompativel",
        "incompativel",
        "nao aplicavel",
        "nao_aplicavel",
        "naoaplicavel",
        "bloqueado repeticao 2h",
        "bloqueado_repeticao_2h"
      ].includes(estado);
    });
    if (aplicaveis.length === 0) return "nao_enviado";
    if (aplicaveis.length > 0) {
      const enviados = aplicaveis.filter(destino => {
        const estado = normalizarTexto(destino?.estado || destino?.status || destino?.resultado || "");
        return estado === "enviado" || estado === "enviada" || destino?.enviado === true || destino?.ok === true || Boolean(destino?.enviadoEm || destino?.dataEnvio);
      }).length;
      const falhas = aplicaveis.filter(destino => {
        const estado = normalizarTexto(destino?.estado || destino?.status || destino?.resultado || "");
        return estado.includes("erro") || estado.includes("falha") || estado.includes("bloqueado") || estado === "nao enviado" || estado === "nao_enviado";
      }).length;
      if (enviados >= aplicaveis.length) return "enviado";
      if (enviados > 0 && (falhas > 0 || enviados < aplicaveis.length)) return "parcial";
      return "nao_enviado";
    }
  }

  const statusPublico = normalizarTexto(item.statusPublico);
  if (statusPublico === "enviado") return "enviado";
  if (statusPublico === "parcial") return "parcial";
  if (statusPublico === "nao enviado" || statusPublico === "nao_enviado") return "nao_enviado";

  const progresso = item.progresso && typeof item.progresso === "object" ? item.progresso : {};
  const total = Number(progresso.total || 0);
  const enviados = Number(progresso.enviados || 0);
  if (total > 0) {
    if (enviados >= total) return "enviado";
    if (enviados > 0) return "parcial";
    return "nao_enviado";
  }

  const status = normalizarTexto(item.statusOperacional || item.status || item.estado);
  if (["enviado", "enviada", "historico", "sucesso"].includes(status)) return "enviado";
  return "nao_enviado";
}

function destinosPublicosItem(item = {}) {
  if (Array.isArray(item.destinos) && item.destinos.length) return item.destinos;
  if (Array.isArray(item.destinosEstado) && item.destinosEstado.length) return item.destinosEstado;
  if (Array.isArray(item.destinosEnviados) && item.destinosEnviados.length) return item.destinosEnviados;
  return [];
}

function estadoDestinoPublico(destino = {}) {
  return normalizarTexto(destino?.estado || destino?.status || destino?.resultado || destino?.motivo || "");
}

function destinoNaoAplicavelPublico(destino = {}) {
  if (destino?.aplicavel === false) return true;
  const estado = estadoDestinoPublico(destino);
  return [
    "nao compativel",
    "nao_compativel",
    "naocompativel",
    "incompativel",
    "nao aplicavel",
    "nao_aplicavel",
    "naoaplicavel",
    "bloqueado repeticao 2h",
    "bloqueado_repeticao_2h"
  ].includes(estado);
}

function destinoEnviadoPublico(destino = {}) {
  const estado = estadoDestinoPublico(destino);
  return estado === "enviado" ||
    estado === "enviada" ||
    destino?.enviado === true ||
    destino?.ok === true ||
    Boolean(destino?.enviadoEm || destino?.dataEnvio);
}

function destinoFalhouPublico(destino = {}) {
  const estado = estadoDestinoPublico(destino);
  return estado.includes("erro") ||
    estado.includes("falha") ||
    estado.includes("exception") ||
    estado.includes("excecao") ||
    estado === "nao enviado" ||
    estado === "nao_enviado";
}

function itemTemImagemFinalValida(item = {}) {
  return Boolean(primeiroTexto(
    item.imagemUsada,
    item.imagemFinal,
    item.imagemCanonicaFinal,
    item.imagemRef,
    item.imagemOriginal,
    item.imagem,
    item.image,
    item.foto
  ));
}

function numeroPublico(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function itemTerminalOuEncerrado(item = {}) {
  if (Number.isFinite(timestampResultadoItem(item))) return true;
  if (itemEhTerminal(item)) return true;
  const status = normalizarTexto(item.statusOperacional || item.statusPublico || item.status || item.estado);
  return status.includes("expirada") ||
    status.includes("finaliz") ||
    status === "terminal" ||
    status === "historico";
}

function evidenciaDestinosElegiveisNoEvento(item = {}) {
  const valores = [
    item.destinosElegiveis,
    item.destinosElegiveisTotal,
    item.totalDestinosElegiveis,
    item.destinosEsperados,
    item.totalDestinosEsperados,
    item.destinosPlanejados,
    item.totalDestinosPlanejados,
    item.destinosResolvidosEsperados,
    item.totalDestinosResolvidosEsperados,
    item?.roteamento?.destinosElegiveis,
    item?.roteamento?.totalDestinosElegiveis,
    item?.fanout?.destinosElegiveis,
    item?.fanout?.totalDestinosElegiveis
  ];
  return valores.some(valor => {
    if (Array.isArray(valor)) return valor.length > 0;
    if (valor && typeof valor === "object") return Object.keys(valor).length > 0;
    return numeroPublico(valor) > 0;
  });
}

function motivoErroPublicoTerminal(item = {}) {
  const terminal = itemTerminalOuEncerrado(item);
  const destinos = destinosPublicosItem(item);
  const aplicaveis = destinos.filter(destino => !destinoNaoAplicavelPublico(destino));
  const enviadosDestinos = aplicaveis.filter(destinoEnviadoPublico).length;
  const falhasDestinos = aplicaveis.filter(destinoFalhouPublico).length;
  const progresso = item.progresso && typeof item.progresso === "object" ? item.progresso : {};
  const totalProgresso = numeroPublico(progresso.total);
  const enviadosProgresso = numeroPublico(progresso.enviados);
  const errosProgresso = numeroPublico(progresso.erros);
  const totalEsperado = Math.max(aplicaveis.length, totalProgresso);
  const enviados = Math.max(enviadosDestinos, enviadosProgresso);
  const textoFalha = normalizarTexto([
    item.erro,
    item.erroEnvio,
    item.motivoErro,
    item.motivoTecnico,
    item.motivoFinal,
    item.motivo,
    item.statusDetalhe,
    item.statusOperacional,
    item.status
  ].filter(Boolean).join(" "));
  const falhaExplicita = falhasDestinos > 0 ||
    errosProgresso > 0 ||
    textoFalha.includes("erro") ||
    textoFalha.includes("falha") ||
    textoFalha.includes("exception") ||
    textoFalha.includes("excecao");

  if (falhaExplicita) return "falha_envio";
  if (terminal && enviados > 0 && totalEsperado > enviados) return "envio_parcial";
  if (terminal && !itemTemImagemFinalValida(item)) return "sem_imagem";
  if (terminal && destinos.length === 0 && totalEsperado === 0 && evidenciaDestinosElegiveisNoEvento(item)) return "sem_destino";
  return null;
}

function hostUrlSeguro(url = "") {
  try {
    const parsed = new URL(texto(url));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pathUrlSeguro(url = "") {
  try {
    const parsed = new URL(texto(url));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.pathname.toLowerCase();
  } catch {
    return "";
  }
}

function hostEhTransporteUrl(host = "") {
  if (!host) return false;
  if (host === "go.optimuspromo.com.br" || host.endsWith(".go.optimuspromo.com.br")) return true;
  return [
    "amzn.to",
    "a.co",
    "meli.la",
    "s.shopee.com.br",
    "shope.ee",
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "encurtador.com.br"
  ].some(curto => host === curto || host.endsWith(`.${curto}`));
}

function urlPareceProdutoReal(url = "") {
  const host = hostUrlSeguro(url);
  const pathname = pathUrlSeguro(url);
  if (!host || hostEhTransporteUrl(host)) return false;
  if (/\/(produto|product|produtos|dp|gp\/product|item|itm|p)(\/|$)/i.test(pathname)) return true;
  if (/\/[A-Z0-9]{10}(\/|$)/i.test(pathname)) return true;
  if (/\/MLB-?\d+/i.test(pathname)) return true;
  return false;
}

function urlTemDestinoUtil(url = "") {
  const host = hostUrlSeguro(url);
  const pathname = pathUrlSeguro(url);
  if (!host) return false;
  const pathLimpo = String(pathname || "").replace(/\/+$/g, "");
  if (!pathLimpo) return false;
  return !/^\/(?:home|homepage)?$/i.test(pathLimpo);
}

function urlEhOrigemOperacional(url = "") {
  const host = hostUrlSeguro(url);
  const pathname = pathUrlSeguro(url);
  if (!host) return false;
  if (host === "chat.whatsapp.com" || host.endsWith(".chat.whatsapp.com")) return true;
  if (host === "whatsapp.com" || host.endsWith(".whatsapp.com")) {
    return /\/(?:channel|channels|groups?|invite|c)\b/i.test(pathname);
  }
  if (host === "wa.me" || host.endsWith(".wa.me")) return true;
  if (host === "t.me" || host.endsWith(".t.me") || host === "telegram.me" || host.endsWith(".telegram.me")) return true;
  return false;
}

function campoLinkPrincipalOferta(campo = "") {
  return [
    "linkFinal",
    "linkAfiliado",
    "link_afiliado",
    "link",
    "url"
  ].includes(texto(campo));
}

function campoLinkProdutoPreservado(campo = "") {
  return [
    "linkOriginal",
    "urlOriginal",
    "urlOriginalProjetada"
  ].includes(texto(campo));
}

function classificarUrlOferta(campo = "", url = "") {
  const campoNormalizado = texto(campo);
  const campoBase = campoNormalizado.split(".").pop() || campoNormalizado;
  const valor = texto(url);
  const host = hostUrlSeguro(valor);
  if (!valor || !host) return { tipo: "desconhecido", confiavel: false, campo: campoNormalizado, url: "" };

  if (urlEhOrigemOperacional(valor) || /(?:radar|clonador|capturad|origem|grupo|mensagem|canal)/i.test(campoNormalizado)) {
    return { tipo: "origem operacional", confiavel: false, campo: campoNormalizado, url: valor };
  }

  if (["urlOriginalProduto", "produtoUrl", "urlProduto", "linkProduto"].includes(campoBase)) {
    return { tipo: "produto original real", confiavel: urlTemDestinoUtil(valor), campo: campoNormalizado, url: valor };
  }

  if (campoLinkProdutoPreservado(campoBase)) {
    if (urlPareceProdutoReal(valor)) {
      return { tipo: "produto original real", confiavel: true, campo: campoNormalizado, url: valor };
    }
    if (urlTemDestinoUtil(valor)) {
      return {
        tipo: hostEhTransporteUrl(host) ? "shortlink/transport do produto" : "link preservado do produto",
        confiavel: true,
        campo: campoNormalizado,
        url: valor
      };
    }
  }

  if (campoLinkPrincipalOferta(campoBase) || /afiliad|affiliate|awin|linkfinal|linkotimizado|linkoptimus/i.test(campoNormalizado)) {
    return {
      tipo: hostEhTransporteUrl(host) ? "shortlink/transport do produto" : "afiliado do produto",
      confiavel: urlTemDestinoUtil(valor),
      campo: campoNormalizado,
      url: valor
    };
  }

  if (hostEhTransporteUrl(host) || ["linkOriginalRadar"].includes(campoBase)) {
    return { tipo: "shortlink/transport", confiavel: false, campo: campoNormalizado, url: valor };
  }

  return { tipo: "desconhecido", confiavel: false, campo: campoNormalizado, url: valor };
}

function linksEstruturadosProduto(item = {}) {
  const candidatos = [];
  const adicionar = (campoBase, link) => {
    if (!link || typeof link !== "object") return;
    const tipo = normalizarTexto(link.tipo || link.papel || link.role || link.categoria || "");
    if (tipo && /(resgate|cupom|coupon|voucher)/i.test(tipo)) return;
    for (const campo of ["urlOriginal", "linkOriginal", "linkProduto", "url", "link", "linkFinal", "linkAfiliado", "resolvido", "afiliado"]) {
      candidatos.push([`${campoBase}.${campo}`, link[campo]]);
    }
  };

  for (const campoBase of ["linksProduto", "linksApp", "linksPc", "linksComerciais"]) {
    const lista = Array.isArray(item[campoBase]) ? item[campoBase] : [];
    for (const link of lista) adicionar(campoBase, link);
  }

  return candidatos;
}

function escolherUrlOriginalConfiavel(item = {}, projetado = {}) {
  const candidatos = [
    ["linkFinal", item.linkFinal],
    ["linkAfiliado", item.linkAfiliado],
    ["link_afiliado", item.link_afiliado],
    ["linkOtimizado", item.linkOtimizado],
    ["linkOptimizado", item.linkOptimizado],
    ["urlFinal", item.urlFinal],
    ["urlExpandida", item.urlExpandida],
    ["linkExpandido", item.linkExpandido],
    ["urlOriginalProduto", item.urlOriginalProduto],
    ["produtoUrl", item.produtoUrl],
    ["urlProduto", item.urlProduto],
    ["linkProduto", item.linkProduto],
    ["linkOriginal", item.linkOriginal],
    ["urlOriginal", item.urlOriginal],
    ["urlOriginalProjetada", projetado.urlOriginal],
    ...linksEstruturadosProduto(item),
    ["link", item.link],
    ["url", item.url]
  ];
  for (const [campo, valor] of candidatos) {
    const classificado = classificarUrlOferta(campo, valor);
    if (classificado.confiavel) return classificado;
  }
  const primeiroClassificado = candidatos
    .map(([campo, valor]) => classificarUrlOferta(campo, valor))
    .find(itemClassificado => itemClassificado.url);
  return primeiroClassificado || { tipo: "desconhecido", confiavel: false, campo: "", url: "" };
}

function statusPublicoHistorico(resultadoPublico = "", tipoVisao = "") {
  if (resultadoPublico === "enviado") return "enviada";
  if (tipoVisao === VISAO_COM_ERRO) return "erro";
  if (["parcial", "nao_enviado", "nao enviado"].includes(normalizarTexto(resultadoPublico))) return "erro";
  return "processada";
}

function itemEhTerminal(item = {}) {
  const statusPublico = normalizarTexto(item.statusPublico);
  if (statusPublico === "em distribuicao") return false;
  if (["enviado", "parcial", "nao enviado"].includes(statusPublico)) return true;
  return filaHistoricoPolicy.classificarEstadoFila({
    ...item,
    status: item.statusOperacional || item.statusPublico || item.status || item.estado
  }).estado === "final";
}

function normalizarItemPublico(origem = {}, dados = {}) {
  const item = origem?.item && typeof origem.item === "object" ? origem.item : origem;
  const projetado = dados.projetado || projetarItemFilaLeve(item, {
    clienteId: dados.clienteId,
    indice: dados.indice,
    agora: dados.agoraMs
  });
  const processada = dados.processada || marcoProcessadaItem(item);
  const resultadoMs = Number.isFinite(dados.resultadoMs) ? dados.resultadoMs : timestampResultadoItem(item);
  const timestamp = dados.tipoVisao === VISAO_PROCESSADAS
    ? processada.ms
    : (Number.isFinite(resultadoMs) ? resultadoMs : processada.ms);
  const statusResultado = dados.resultadoPublico || "";
  const statusPublico = statusPublicoHistorico(statusResultado, dados.tipoVisao);
  const detalheRef = item.detalheRef && typeof item.detalheRef === "object"
    ? item.detalheRef
    : projetado.detalheRef;

  return {
    id: projetado.id,
    chave: texto(origem?.chave || item.chave),
    clienteId: clienteSeguro(dados.clienteId || projetado.clienteId || item.clienteId),
    titulo: projetado.titulo,
    marketplace: projetado.marketplace,
    categoria: textoLimitado(primeiroTexto(
      projetado.categoria,
      item.categoriaCanonica,
      item.categoriaCanônica,
      item.categoriaPersistida,
      item.categoriaProduto,
      item.categoriaDetectada,
      item.categoria,
      item.departamento,
      item.subcategoria
    ), 120),
    imagemRef: projetado.imagemRef,
    thumbRef: projetado.imagemRef,
    precoExibivel: projetado.precoExibivel,
    urlOriginal: primeiroTexto(item.urlOriginalProduto, item.produtoUrl, item.urlProduto, item.linkProduto),
    canal: projetado.canal,
    destinoResumo: primeiroTexto(projetado.destinoNome, projetado.destinoId),
    destinos: Array.isArray(projetado.destinos) ? projetado.destinos : [],
    statusPublico,
    resultadoPublico: statusPublico,
    statusVisual: statusPublico,
    statusFinalVisual: statusPublico,
    motivoErroPublico: dados.motivoErroPublico || null,
    marco: dados.tipoVisao === VISAO_PROCESSADAS ? "processada" : "resultado_distribuicao",
    tipoVisao: dados.tipoVisao,
    timestamp: isoOuVazio(timestamp),
    processadaEm: isoOuVazio(processada.ms),
    processadaCampo: processada.campo,
    enviadoEm: projetado.enviadoEm,
    finalizadoEm: projetado.finalizadoEm || isoOuVazio(resultadoMs),
    progresso: projetado.progresso,
    motivoPublico: textoLimitado(primeiroTexto(projetado.motivoPublico, item.motivoPublico, item.motivoFinal, item.motivoRetencao, item.motivo, item.erro), 240),
    detalheRef: {
      arquivo: texto(detalheRef?.arquivo || ""),
      id: texto(detalheRef?.id || projetado.id)
    },
    identidade: dados.identidade
  };
}

function visaoTerminalPublica(resultadoPublico = "") {
  if (resultadoPublico === "enviado") return VISAO_ENVIADAS;
  if (resultadoPublico === "parcial") return VISAO_PARCIAIS;
  return VISAO_NAO_ENVIADAS;
}

function visaoIncluiTerminal(visao = VISAO_PROCESSADAS, resultadoPublico = "", motivoErroPublico = null) {
  const tipoTerminal = visaoTerminalPublica(resultadoPublico);
  return visao === tipoTerminal || (visao === VISAO_COM_ERRO && Boolean(motivoErroPublico));
}

function ordenarRegistrosPublicos(a, b) {
  const ta = timestampMs(a.timestamp) || 0;
  const tb = timestampMs(b.timestamp) || 0;
  if (tb !== ta) return tb - ta;
  return String(a.identidade || a.id || "").localeCompare(String(b.identidade || b.id || ""));
}

function upsertPorIdentidade(mapa, registro) {
  const chave = registro.identidade;
  if (!chave) return;
  const atual = mapa.get(chave);
  if (!atual || ordenarRegistrosPublicos(registro, atual) < 0) {
    mapa.set(chave, registro);
  }
}

function removerPorIdentidades(projecaoAtual = {}, identidades = new Set(), clienteId = "admin", agoraMs = Date.now(), motivo = "hot_remove") {
  const atual = Array.isArray(projecaoAtual.itens) ? projecaoAtual.itens : [];
  const restantes = atual.filter(entrada => !identidadesRegistro(entrada, -1, clienteId).some(id => identidades.has(id)));
  return montarProjecaoHot(clienteId, restantes, agoraMs, motivo);
}

function registroCombinaFiltros(registro = {}, filtros = {}) {
  const marketplace = normalizarTexto(filtros.marketplace);
  const canal = normalizarTexto(filtros.canal);
  const destino = normalizarTexto(filtros.destino);
  const q = normalizarTexto(filtros.q || filtros.busca);
  if (marketplace && !normalizarTexto(registro.marketplace).includes(marketplace)) return false;
  if (canal && !normalizarTexto(registro.canal).includes(canal)) return false;
  if (destino) {
    const alvoDestino = normalizarTexto([
      registro.destinoResumo,
      ...(Array.isArray(registro.destinos) ? registro.destinos.map(d => `${d.destinoNome || ""} ${d.destinoId || ""} ${d.canal || ""}`) : [])
    ].join(" "));
    if (!alvoDestino.includes(destino)) return false;
  }
  if (q) {
    const alvo = normalizarTexto([
      registro.titulo,
      registro.marketplace,
      registro.destinoResumo,
      registro.motivoPublico
    ].join(" "));
    if (!alvo.includes(q)) return false;
  }
  return true;
}

function paginar(itens = [], opcoes = {}) {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(opcoes.limit || 50))));
  const pageQuery = Math.floor(Number(opcoes.page || 0));
  const offsetQuery = Math.max(0, Math.floor(Number(opcoes.offset || 0)));
  const page = Math.max(1, pageQuery || Math.floor(offsetQuery / limit) + 1);
  const offset = (page - 1) * limit;
  const totalFiltrado = Number.isFinite(Number(opcoes.totalFiltradoOverride))
    ? Number(opcoes.totalFiltradoOverride)
    : itens.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltrado / limit));
  return {
    page,
    limit,
    offset,
    totalFiltrado,
    totalPages,
    hasMore: page < totalPages,
    itens: itens.slice(offset, offset + limit)
  };
}

function construirReadModelPublicoPorMarcos(params = {}) {
  const inicio = process.hrtime.bigint();
  const agoraMs = Number(params.agoraMs || Date.now());
  const clienteId = clienteSeguro(params.clienteId || "admin");
  if (params.exigirProjectionReady === true && params.projectionReady !== true) {
    return {
      ok: false,
      motivo: "projection_not_ready",
      versao: 1,
      clienteId,
      projectionReady: false,
      visao: texto(params.visao || params.filtros?.visao || VISAO_PROCESSADAS) || VISAO_PROCESSADAS,
      metricas: {
        processadas: 0,
        enviadas: 0,
        parciais: 0,
        naoEnviadas: 0,
        comErro: 0,
        emDistribuicao: 0,
        fechaMatematicamente: true
      },
      listas: {
        processadas: [],
        enviadas: [],
        parciais: [],
        naoEnviadas: [],
        comErro: []
      },
      pagina: paginar([], params),
      itens: [],
      diagnostico: {
        duracaoMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6),
        bloqueadoPorProjectionReady: true
      }
    };
  }
  const hot = Array.isArray(params.hot) ? params.hot : [];
  const historicoLeve = Array.isArray(params.historicoLeve) ? params.historicoLeve : [];
  const filtros = params.filtros || {};
  const visao = texto(params.visao || filtros.visao || VISAO_PROCESSADAS) || VISAO_PROCESSADAS;
  const somenteMetricas = params.somenteMetricas === true;
  const periodo = normalizarTexto(params.periodo || filtros.periodo || "");
  const janelaDiasPublica = periodo === "hoje" ? 1 : Number(params.janelaDias || JANELA_PUBLICA_DIAS_PADRAO);
  const filtrosAtivos = Boolean(
    normalizarTexto(filtros.marketplace) ||
    normalizarTexto(filtros.canal) ||
    normalizarTexto(filtros.destino) ||
    normalizarTexto(filtros.q || filtros.busca)
  );
  const leiturasFisicas = Number(params.leiturasFisicas || 0);
  const bytesLidos = Number(params.bytesLidos || 0);
  const listaSolicitada = new Map();
  const processadasIds = new Set();
  const enviadasIds = new Set();
  const parciaisIds = new Set();
  const naoEnviadasIds = new Set();
  const comErroIds = new Set();
  const terminaisIdentidades = new Set();
  const terminaisPrincipais = new Set();
  const terminaisResultadoPorIdentidade = new Map();
  let invisiveisAntesMarco = 0;
  let hotRemovidosPorTerminal = 0;
  let historicoLeveConsiderado = 0;

  function registrarListaSeSolicitada(tipoVisao, registro) {
    if (!somenteMetricas && tipoVisao === visao) {
      upsertPorIdentidade(listaSolicitada, registro);
    }
  }

  for (let indice = 0; indice < historicoLeve.length; indice += 1) {
    const registro = historicoLeve[indice] || {};
    const item = registro.item && typeof registro.item === "object" ? registro.item : registro;
    const processada = marcoProcessadaItem(item);
    if (!processada.ok) continue;
    const resultadoMs = timestampResultadoItem(item);
    const resultadoReferenciaMs = Number.isFinite(resultadoMs) ? resultadoMs : processada.ms;
    const dentroProcessada = registroDentroJanela(processada.ms, { agoraMs, janelaDias: janelaDiasPublica, periodo });
    const dentroTerminal = registroDentroJanela(resultadoReferenciaMs, { agoraMs, janelaDias: janelaDiasPublica, periodo });
    if (!dentroProcessada && !dentroTerminal) continue;
    historicoLeveConsiderado += 1;
    const identidades = identidadesRegistro(registro, indice, clienteId);
    identidades.forEach(id => terminaisIdentidades.add(id));
    const identidade = identidadePrincipal(registro, indice, clienteId);
    terminaisPrincipais.add(identidade);
    const resultadoPublico = resultadoPublicoTerminal({
      ...item,
      statusPublico: registro.statusPublico || item.statusPublico,
      statusOperacional: registro.statusOperacional || item.statusOperacional || registro.status
    });
    const motivoErroPublico = motivoErroPublicoTerminal({
      ...item,
      statusPublico: registro.statusPublico || item.statusPublico,
      statusOperacional: registro.statusOperacional || item.statusOperacional || registro.status
    });
    terminaisResultadoPorIdentidade.set(identidade, resultadoPublico);
    const precisaProjetar = filtrosAtivos ||
      (!somenteMetricas && ((dentroProcessada && visao === VISAO_PROCESSADAS) ||
      (dentroTerminal && visaoIncluiTerminal(visao, resultadoPublico, motivoErroPublico))));
    const projetado = precisaProjetar
      ? projetarItemFilaLeve(item, {
          clienteId,
          indice,
          agora: agoraMs
        })
      : null;
    let processadaPublica = null;
    if (dentroProcessada && (filtrosAtivos || (!somenteMetricas && visao === VISAO_PROCESSADAS))) {
      processadaPublica = normalizarItemPublico(registro, {
        clienteId,
        indice,
        agoraMs,
        projetado,
        processada,
        resultadoMs,
        tipoVisao: VISAO_PROCESSADAS,
        resultadoPublico,
        motivoErroPublico: null,
        identidade
      });
    }
    if (dentroProcessada && (!filtrosAtivos || registroCombinaFiltros(processadaPublica, filtros))) {
      processadasIds.add(identidade);
      if (processadaPublica) registrarListaSeSolicitada(VISAO_PROCESSADAS, processadaPublica);
    }
    const tipoVisaoTerminal = visaoTerminalPublica(resultadoPublico);
    let terminalPublico = null;
    if (dentroTerminal && (filtrosAtivos || (!somenteMetricas && visaoIncluiTerminal(visao, resultadoPublico, motivoErroPublico)))) {
      terminalPublico = normalizarItemPublico(registro, {
        clienteId,
        indice,
        agoraMs,
        projetado,
        processada,
        resultadoMs,
        tipoVisao: tipoVisaoTerminal,
        resultadoPublico,
        motivoErroPublico,
        identidade
      });
    }
    if (dentroTerminal && (!filtrosAtivos || registroCombinaFiltros(terminalPublico, filtros))) {
      if (resultadoPublico === "enviado") enviadasIds.add(identidade);
      else if (resultadoPublico === "parcial") parciaisIds.add(identidade);
      else naoEnviadasIds.add(identidade);
      if (terminalPublico) registrarListaSeSolicitada(tipoVisaoTerminal, terminalPublico);
      if (motivoErroPublico) comErroIds.add(identidade);
      if (terminalPublico && motivoErroPublico) registrarListaSeSolicitada(VISAO_COM_ERRO, {
        ...terminalPublico,
        tipoVisao: VISAO_COM_ERRO,
        statusPublico: "erro",
        resultadoPublico: "erro",
        statusVisual: "erro",
        statusFinalVisual: "erro",
        motivoErroPublico
      });
    }
  }

  for (let indice = 0; indice < hot.length; indice += 1) {
    const item = hot[indice] || {};
    const processada = marcoProcessadaItem(item);
    if (!processada.ok) {
      invisiveisAntesMarco += 1;
      continue;
    }
    if (!registroDentroJanela(processada.ms, { agoraMs, janelaDias: janelaDiasPublica, periodo })) continue;
    const identidades = identidadesRegistro(item, indice, clienteId);
    const jaTerminal = identidades.some(id => terminaisIdentidades.has(id));
    if (jaTerminal || itemEhTerminal(item)) {
      hotRemovidosPorTerminal += 1;
      continue;
    }
    const identidade = identidadePrincipal(item, indice, clienteId);
    const projetado = projetarItemFilaLeve(item, {
      clienteId,
      indice,
      agora: agoraMs
    });
    let processadaPublica = null;
    if (filtrosAtivos || (!somenteMetricas && visao === VISAO_PROCESSADAS)) {
      processadaPublica = normalizarItemPublico(item, {
        clienteId,
        indice,
        agoraMs,
        projetado,
        processada,
        tipoVisao: VISAO_PROCESSADAS,
        resultadoPublico: "em_distribuicao",
        identidade
      });
    }
    if (!filtrosAtivos || registroCombinaFiltros(processadaPublica, filtros)) {
      processadasIds.add(identidade);
      if (processadaPublica) registrarListaSeSolicitada(VISAO_PROCESSADAS, processadaPublica);
    }
  }

  const metricas = {
    processadas: processadasIds.size,
    enviadas: enviadasIds.size,
    parciais: parciaisIds.size,
    naoEnviadas: naoEnviadasIds.size,
    comErro: comErroIds.size,
    emDistribuicao: [...processadasIds].filter(id => !terminaisPrincipais.has(id)).length
  };
  metricas.fechaMatematicamente = metricas.enviadas + metricas.parciais + metricas.naoEnviadas + metricas.emDistribuicao === metricas.processadas;

  const listaBase = [...listaSolicitada.values()].sort(ordenarRegistrosPublicos);
  const totalVisao = visao === VISAO_ENVIADAS
    ? metricas.enviadas
    : visao === VISAO_PARCIAIS
      ? metricas.parciais
      : visao === VISAO_NAO_ENVIADAS
        ? metricas.naoEnviadas
        : visao === VISAO_COM_ERRO
          ? metricas.comErro
          : metricas.processadas;
  const pagina = paginar(listaBase, { ...params, totalFiltradoOverride: totalVisao });
  const listas = {
    processadas: visao === VISAO_PROCESSADAS ? listaBase : [],
    enviadas: visao === VISAO_ENVIADAS ? listaBase : [],
    parciais: visao === VISAO_PARCIAIS ? listaBase : [],
    naoEnviadas: visao === VISAO_NAO_ENVIADAS ? listaBase : [],
    comErro: visao === VISAO_COM_ERRO ? listaBase : []
  };
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
  return {
    ok: true,
    versao: 1,
    clienteId,
    marcoProcessada: {
      campoPrimario: "dataEntradaFila",
      fallbacks: ["filaCriadoEm", "adicionadoEm", "criadoEm", "createdAt", "created_at"],
      origem: "item_ja_adicionado_a_fila"
    },
    projectionReady: params.projectionReady === true,
    visao,
    metricas,
    listas,
    pagina,
    itens: pagina.itens,
    totalFiltrado: pagina.totalFiltrado,
    page: pagina.page,
    limit: pagina.limit,
    offset: pagina.offset,
    totalPages: pagina.totalPages,
    hasMore: pagina.hasMore,
    diagnostico: {
      hotLidos: hot.length,
      historicoLeveLidos: historicoLeve.length,
      historicoLeveConsiderado,
      visaoMaterializada: visao,
      itensMaterializados: listaBase.length,
      somenteMetricas,
      invisiveisAntesMarco,
      hotRemovidosPorTerminal,
      terminaisComIdentidade: terminaisResultadoPorIdentidade.size,
      leiturasFisicas,
      bytesLidos,
      duracaoMs
    }
  };
}

function atualizarProjecaoHotPorItem(projecaoAtual = {}, item = {}, opcoes = {}) {
  const clienteId = clienteSeguro(opcoes.clienteId || projecaoAtual.clienteId || item.clienteId || "admin");
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const atual = Array.isArray(projecaoAtual.itens) ? [...projecaoAtual.itens] : [];
  const idsItem = new Set(identidadesRegistro(item, -1, clienteId));
  const semItem = atual.filter(entrada => !identidadesRegistro(entrada, -1, clienteId).some(id => idsItem.has(id)));
  const processada = marcoProcessadaItem(item);
  if (!processada.ok || itemEhTerminal(item)) {
    return montarProjecaoHot(clienteId, semItem, agoraMs, itemEhTerminal(item) ? "terminal_removido" : "sem_marco_processada");
  }
  const projetado = {
    ...projetarItemFilaLeve({ ...item, clienteId }, { clienteId, agora: agoraMs }),
    statusPublico: "em_distribuicao"
  };
  return montarProjecaoHot(clienteId, [...semItem, projetado], agoraMs, "hot_upsert");
}

function removerProjecaoHotPorItem(projecaoAtual = {}, item = {}, opcoes = {}) {
  const clienteId = clienteSeguro(opcoes.clienteId || projecaoAtual.clienteId || item.clienteId || "admin");
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const idsItem = new Set(identidadesRegistro(item, -1, clienteId));
  return montarProjecaoHot(clienteId, removerPorIdentidades(projecaoAtual, idsItem, clienteId, agoraMs, "hot_remove").itens, agoraMs, "hot_remove");
}

function montarProjecaoHot(clienteId, itens, agoraMs, motivo = "reconcile_hot") {
  const normalizados = (Array.isArray(itens) ? itens : []).filter(item => {
    const processada = marcoProcessadaItem(item);
    return processada.ok && !itemEhTerminal(item);
  });
  return {
    versao: 1,
    tipo: "fila_projecao_hot",
    clienteId: clienteSeguro(clienteId),
    geradoEm: isoOuVazio(agoraMs),
    motivo,
    total: normalizados.length,
    contadores: {
      total: normalizados.length,
      emDistribuicao: normalizados.length
    },
    itens: normalizados
  };
}

function reconciliarProjecaoHotDaFila(filaMemoria = [], opcoes = {}) {
  const clienteId = clienteSeguro(opcoes.clienteId || "admin");
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const itens = [];
  for (const item of Array.isArray(filaMemoria) ? filaMemoria : []) {
    if (clienteSeguro(item?.clienteId || "admin") !== clienteId) continue;
    if (!marcoProcessadaItem(item).ok || itemEhTerminal(item)) continue;
    itens.push({
      ...projetarItemFilaLeve({ ...item, clienteId }, { clienteId, agora: agoraMs }),
      statusPublico: "em_distribuicao"
    });
  }
  return {
    projectionReady: true,
    fonte: "fila_memoria",
    arquivo: FILA_PROJECAO_LEVE_ARQUIVO,
    projecao: montarProjecaoHot(clienteId, itens, agoraMs, "reconcile_fila_memoria")
  };
}

function arquivosHistoricoLevePorJanela(dir, opcoes = {}) {
  const fsImpl = opcoes.fs || fs;
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const periodo = normalizarTexto(opcoes.periodo || "");
  const janelaDias = periodo === "hoje" ? 1 : Number(opcoes.janelaDias || JANELA_PUBLICA_DIAS_PADRAO);
  const minDiaMs = Date.parse(dataArquivoIso(agoraMs - Math.max(0, janelaDias - 1) * DIA_MS) + "T00:00:00.000Z");
  const maxDiaMs = Date.parse(dataArquivoIso(agoraMs) + "T00:00:00.000Z");
  try {
    if (!fsImpl.existsSync(dir)) return [];
    return fsImpl.readdirSync(dir)
      .filter(nome => {
        const diaMs = parseDiaArquivo(nome);
        return Number.isFinite(diaMs) && diaMs >= minDiaMs && diaMs <= maxDiaMs;
      })
      .sort((a, b) => String(b).localeCompare(String(a)))
      .map(nome => path.join(dir, nome));
  } catch {
    return [];
  }
}

function lerHistoricoLeveJsonlPorJanela(params = {}) {
  const fsImpl = params.fs || fs;
  const dir = params.dir || params.historicoDir || "";
  const arquivos = arquivosHistoricoLevePorJanela(dir, { ...params, fs: fsImpl });
  const registros = [];
  let bytesLidos = 0;
  let invalidos = 0;
  for (const arquivo of arquivos) {
    let conteudo = "";
    try {
      conteudo = fsImpl.readFileSync(arquivo, "utf8");
      bytesLidos += Buffer.byteLength(conteudo, "utf8");
    } catch {
      invalidos += 1;
      continue;
    }
    for (const linha of conteudo.split(/\r?\n/)) {
      if (!linha.trim()) continue;
      try {
        registros.push(JSON.parse(linha));
      } catch {
        invalidos += 1;
      }
    }
  }
  return {
    registros,
    arquivos,
    leiturasFisicas: arquivos.length,
    bytesLidos,
    invalidos
  };
}

function normalizarDetalheRef(valor = {}) {
  if (typeof valor === "string") {
    try {
      const parsed = JSON.parse(valor);
      return normalizarDetalheRef(parsed);
    } catch {
      return { arquivo: "", id: texto(valor) };
    }
  }
  if (!valor || typeof valor !== "object") return { arquivo: "", id: "" };
  return {
    arquivo: texto(valor.arquivo || valor.file || ""),
    id: texto(valor.id || valor.detalheId || valor.execucaoId || valor.itemId || "")
  };
}

function validarArquivoDetalheRef(arquivo = "") {
  const bruto = texto(arquivo);
  if (!bruto) return { ok: true, arquivo: "" };
  if (
    bruto.includes("\0") ||
    bruto.includes("..") ||
    bruto.includes("/") ||
    bruto.includes("\\") ||
    path.isAbsolute(bruto) ||
    !/^[A-Za-z0-9_.-]+$/.test(bruto)
  ) {
    return { ok: false, motivo: "detalhe_ref_arquivo_invalido", arquivo: "" };
  }
  if (!ARQUIVOS_DETALHE_REF_PERMITIDOS.has(bruto)) {
    return { ok: false, motivo: "detalhe_ref_arquivo_nao_permitido", arquivo: "" };
  }
  return { ok: true, arquivo: bruto };
}

function arquivoJsonlOrdenados(dir = "", opcoes = {}) {
  const fsImpl = opcoes.fs || fs;
  try {
    if (!dir || !fsImpl.existsSync(dir)) return [];
    return fsImpl.readdirSync(dir)
      .filter(nome => /\.jsonl$/i.test(nome))
      .sort((a, b) => String(b).localeCompare(String(a)))
      .map(nome => path.join(dir, nome));
  } catch {
    return [];
  }
}

function itemRegistroHistorico(registro = {}) {
  return registro?.item && typeof registro.item === "object" ? registro.item : registro;
}

function registroCombinaDetalheRef(registro = {}, detalheRef = {}) {
  const id = texto(detalheRef.id);
  if (!id) return false;
  const item = itemRegistroHistorico(registro);
  const candidatos = [
    registro.id,
    registro.chave,
    registro.detalheRef?.id,
    item.id,
    item.filaItemId,
    item.itemFilaId,
    item.filaId,
    item.idFila,
    item.execucaoId,
    item.executionId,
    item.distribuicaoId,
    item.distributionId,
    item.jobId,
    item.job_id,
    item.ofertaOperacionalId,
    item.operacionalId,
    item.detalheRef?.id
  ].map(texto).filter(Boolean);
  return candidatos.includes(id);
}

function lerRegistroJsonlPorDetalheRef(dir = "", detalheRef = {}, opcoes = {}) {
  const fsImpl = opcoes.fs || fs;
  const inicio = process.hrtime.bigint();
  let leiturasFisicas = 0;
  let bytesLidos = 0;
  let linhasLidas = 0;
  for (const arquivo of arquivoJsonlOrdenados(dir, { fs: fsImpl })) {
    let conteudo = "";
    try {
      conteudo = fsImpl.readFileSync(arquivo, "utf8");
      leiturasFisicas += 1;
      bytesLidos += Buffer.byteLength(conteudo || "", "utf8");
    } catch {
      continue;
    }
    for (const linha of (conteudo || "").split(/\r?\n/)) {
      if (!linha.trim()) continue;
      linhasLidas += 1;
      try {
        const registro = JSON.parse(linha);
        if (registroCombinaDetalheRef(registro, detalheRef)) {
          return {
            registro,
            arquivo,
            encontrado: true,
            leiturasFisicas,
            bytesLidos,
            linhasLidas,
            duracaoMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6)
          };
        }
      } catch {}
    }
  }
  return {
    registro: null,
    arquivo: "",
    encontrado: false,
    leiturasFisicas,
    bytesLidos,
    linhasLidas,
    duracaoMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6)
  };
}

function resumoProgressoHumano(progresso = {}) {
  const enviados = Number(progresso.enviados || 0);
  const total = Number(progresso.total || 0);
  if (total > 0) return `${enviados} de ${total}`;
  return "";
}

function montarDetalhePublicoFila({ clienteId = "admin", registroLeve = null, registroTecnico = null, detalheRef = {}, indice = -1, agoraMs = Date.now() } = {}) {
  const itemLeve = registroLeve ? itemRegistroHistorico(registroLeve) : {};
  const itemTecnico = registroTecnico ? itemRegistroHistorico(registroTecnico) : {};
  const item = { ...itemTecnico, ...itemLeve, clienteId: clienteSeguro(clienteId) };
  const projetado = projetarItemFilaLeve(item, { clienteId, indice, agora: agoraMs });
  const processada = marcoProcessadaItem(item);
  const resultadoMs = timestampResultadoItem(item);
  const resultadoPublico = resultadoPublicoTerminal({
    ...item,
    statusPublico: itemLeve.statusPublico || item.statusPublico,
    statusOperacional: itemLeve.statusOperacional || item.statusOperacional
  });
  const motivoErroPublico = motivoErroPublicoTerminal({
    ...item,
    statusPublico: itemLeve.statusPublico || item.statusPublico,
    statusOperacional: itemLeve.statusOperacional || item.statusOperacional
  });
  const statusPublico = Number.isFinite(resultadoMs) || itemEhTerminal(item)
    ? statusPublicoHistorico(resultadoPublico, visaoTerminalPublica(resultadoPublico))
    : "processada";
  const timestamp = Number.isFinite(resultadoMs) ? resultadoMs : processada.ms;
  const ref = normalizarDetalheRef(detalheRef.id ? detalheRef : (itemLeve.detalheRef || itemTecnico.detalheRef || detalheRef));
  const urlOriginal = escolherUrlOriginalConfiavel(item, projetado);

  return {
    id: projetado.id,
    chave: texto(registroLeve?.chave || registroTecnico?.chave || item.chave),
    clienteId: clienteSeguro(clienteId),
    titulo: projetado.titulo,
    marketplace: projetado.marketplace,
    categoria: textoLimitado(primeiroTexto(
      projetado.categoria,
      item.categoriaCanonica,
      item.categoriaCanônica,
      item.categoriaPersistida,
      item.categoriaProduto,
      item.categoriaDetectada,
      item.categoria,
      item.departamento,
      item.subcategoria
    ), 120),
    imagemRef: primeiroTexto(
      item.imagemUsada,
      item.imagemFinal,
      item.imagemRef,
      item.imagemOriginal,
      item.imagem,
      item.image,
      projetado.imagemRef
    ),
    thumbRef: primeiroTexto(item.thumbRef, item.thumbnail, item.imagemThumb, item.imagemThumbnail, projetado.imagemRef),
    precoExibivel: primeiroTexto(projetado.precoExibivel, item.precoExibivel, item.preco, item.precoAtual, item.valorEfetivo),
    canal: projetado.canal,
    destinoResumo: primeiroTexto(projetado.destinoNome, projetado.destinoId),
    destinos: Array.isArray(projetado.destinos) ? projetado.destinos : [],
    statusPublico,
    resultadoPublico: statusPublico,
    statusVisual: statusPublico,
    statusFinalVisual: statusPublico,
    motivoErroPublico,
    timestamp: isoOuVazio(timestamp),
    processadaEm: isoOuVazio(processada.ms),
    finalizadoEm: projetado.finalizadoEm || isoOuVazio(resultadoMs),
    progresso: projetado.progresso,
    progressoHumano: resumoProgressoHumano(projetado.progresso),
    motivoPublico: textoLimitado(primeiroTexto(projetado.motivoPublico, item.motivoPublico, item.motivoFinal, item.motivoRetencao, item.motivo, item.erro), 240),
    urlOriginal: urlOriginal.confiavel ? urlOriginal.url : "",
    urlOriginalTipo: urlOriginal.tipo,
    urlOriginalCampo: urlOriginal.confiavel ? urlOriginal.campo : "",
    detalheRef: ref,
    fontes: {
      leve: Boolean(registroLeve),
      tecnico: Boolean(registroTecnico)
    }
  };
}

function resolverDetalhePublicoFilaPorRef(params = {}) {
  const inicio = process.hrtime.bigint();
  const clienteId = clienteSeguro(params.clienteId || "admin");
  const agoraMs = Number(params.agoraMs || Date.now());
  const detalheRef = normalizarDetalheRef(params.detalheRef || { arquivo: params.arquivo, id: params.id });
  const fsImpl = params.fs || fs;
  const clientePath = params.clientePath || "";
  const historicoLeveDir = params.historicoLeveDir || (clientePath ? path.join(clientePath, HISTORICO_LEVE_INCREMENTAL_DIR) : "");
  const historicoTecnicoDir = params.historicoTecnicoDir || (clientePath ? path.join(clientePath, HISTORICO_INCREMENTAL_DIR) : "");
  const diagnostico = {
    leiturasFisicas: 0,
    bytesLidos: 0,
    linhasLidas: 0,
    leuFilaJson: false,
    maiorTrechoSyncMs: 0
  };
  if (!detalheRef.id) {
    return { ok: false, motivo: "detalhe_ref_invalido", clienteId, detalheRef, diagnostico };
  }
  const arquivoSeguro = validarArquivoDetalheRef(detalheRef.arquivo);
  if (!arquivoSeguro.ok) {
    diagnostico.totalMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    return {
      ok: false,
      motivo: arquivoSeguro.motivo,
      clienteId,
      detalheRef: { arquivo: "", id: detalheRef.id },
      diagnostico
    };
  }
  detalheRef.arquivo = arquivoSeguro.arquivo;

  let registroLeve = null;
  let registroTecnico = null;
  let fonte = "";

  const hot = Array.isArray(params.hot) ? params.hot : [];
  const hotItem = hot.find(item => registroCombinaDetalheRef(item, detalheRef));
  if (hotItem) {
    registroLeve = hotItem;
    fonte = "fila_memoria";
  }

  if (!registroLeve) {
    const leituraLeve = lerRegistroJsonlPorDetalheRef(historicoLeveDir, detalheRef, { fs: fsImpl });
    diagnostico.leiturasFisicas += leituraLeve.leiturasFisicas;
    diagnostico.bytesLidos += leituraLeve.bytesLidos;
    diagnostico.linhasLidas += leituraLeve.linhasLidas;
    diagnostico.maiorTrechoSyncMs = Math.max(diagnostico.maiorTrechoSyncMs, leituraLeve.duracaoMs);
    if (leituraLeve.encontrado) {
      registroLeve = leituraLeve.registro;
      fonte = "historico_leve";
    }
  }

  const arquivoRef = normalizarTexto(detalheRef.arquivo);
  if (historicoTecnicoDir && (arquivoRef.includes("historico incremental") || arquivoRef.includes("fila historico incremental") || arquivoRef.includes("fila-historico-incremental") || registroLeve)) {
    const leituraTecnica = lerRegistroJsonlPorDetalheRef(historicoTecnicoDir, detalheRef, { fs: fsImpl });
    diagnostico.leiturasFisicas += leituraTecnica.leiturasFisicas;
    diagnostico.bytesLidos += leituraTecnica.bytesLidos;
    diagnostico.linhasLidas += leituraTecnica.linhasLidas;
    diagnostico.maiorTrechoSyncMs = Math.max(diagnostico.maiorTrechoSyncMs, leituraTecnica.duracaoMs);
    if (leituraTecnica.encontrado) {
      registroTecnico = leituraTecnica.registro;
      fonte = registroLeve ? "historico_leve+tecnico" : "historico_tecnico";
    }
  }

  if (!registroLeve && !registroTecnico) {
    diagnostico.totalMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    return { ok: false, motivo: "detalhe_nao_encontrado", clienteId, detalheRef, diagnostico };
  }

  const detalhe = montarDetalhePublicoFila({
    clienteId,
    registroLeve,
    registroTecnico,
    detalheRef,
    agoraMs
  });
  const bytesResposta = Buffer.byteLength(JSON.stringify({ ok: true, detalhe }), "utf8");
  diagnostico.totalMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
  diagnostico.bytesResposta = bytesResposta;
  return {
    ok: true,
    clienteId,
    detalheRef,
    fonte,
    detalhe,
    diagnostico
  };
}

function benchmarkDetalhePublicoFila(params = {}) {
  const resultado = resolverDetalhePublicoFilaPorRef(params);
  return {
    ok: resultado.ok,
    motivo: resultado.motivo,
    fonte: resultado.fonte,
    leiturasFisicas: resultado.diagnostico?.leiturasFisicas || 0,
    bytesLidos: resultado.diagnostico?.bytesLidos || 0,
    bytesResposta: resultado.diagnostico?.bytesResposta || Buffer.byteLength(JSON.stringify(resultado), "utf8"),
    totalMs: resultado.diagnostico?.totalMs || 0,
    maiorTrechoSyncMs: resultado.diagnostico?.maiorTrechoSyncMs || 0,
    leuFilaJson: resultado.diagnostico?.leuFilaJson === true
  };
}

function benchmarkReadModelPublico(params = {}) {
  const inicio = process.hrtime.bigint();
  const leitura = params.historicoDir
    ? lerHistoricoLeveJsonlPorJanela(params)
    : {
        registros: Array.isArray(params.historicoLeve) ? params.historicoLeve : [],
        arquivos: [],
        leiturasFisicas: Number(params.leiturasFisicas || 0),
        bytesLidos: Number(params.bytesLidos || 0),
        invalidos: 0
      };
  const aposLeitura = process.hrtime.bigint();
  const readModel = construirReadModelPublicoPorMarcos({
    ...params,
    historicoLeve: leitura.registros,
    leiturasFisicas: leitura.leiturasFisicas,
    bytesLidos: leitura.bytesLidos
  });
  const aposReadModel = process.hrtime.bigint();
  const bytesResposta = Buffer.byteLength(JSON.stringify({
    metricas: readModel.metricas,
    itens: readModel.itens,
    page: readModel.page,
    limit: readModel.limit,
    totalFiltrado: readModel.totalFiltrado
  }), "utf8");
  return {
    ok: true,
    hot: Array.isArray(params.hot) ? params.hot.length : 0,
    historico: leitura.registros.length,
    leiturasFisicas: leitura.leiturasFisicas,
    bytesLidos: leitura.bytesLidos,
    invalidos: leitura.invalidos,
    leituraMs: Math.round(Number(aposLeitura - inicio) / 1e6),
    readModelMs: Math.round(Number(aposReadModel - aposLeitura) / 1e6),
    totalMs: Math.round(Number(aposReadModel - inicio) / 1e6),
    maiorTrechoSyncMs: Math.max(
      Math.round(Number(aposLeitura - inicio) / 1e6),
      Math.round(Number(aposReadModel - aposLeitura) / 1e6)
    ),
    bytesResposta,
    metricas: readModel.metricas,
    pagina: {
      totalFiltrado: readModel.totalFiltrado,
      page: readModel.page,
      limit: readModel.limit,
      hasMore: readModel.hasMore
    }
  };
}

module.exports = {
  HISTORICO_LEVE_INCREMENTAL_DIR,
  JANELA_PUBLICA_DIAS_PADRAO,
  VISAO_PROCESSADAS,
  VISAO_ENVIADAS,
  VISAO_PARCIAIS,
  VISAO_NAO_ENVIADAS,
  VISAO_COM_ERRO,
  marcoProcessadaItem,
  identidadesRegistro,
  identidadePrincipal,
  resultadoPublicoTerminal,
  motivoErroPublicoTerminal,
  classificarUrlOferta,
  itemEhTerminal,
  construirReadModelPublicoPorMarcos,
  atualizarProjecaoHotPorItem,
  removerProjecaoHotPorItem,
  reconciliarProjecaoHotDaFila,
  arquivosHistoricoLevePorJanela,
  lerHistoricoLeveJsonlPorJanela,
  resolverDetalhePublicoFilaPorRef,
  benchmarkReadModelPublico,
  benchmarkDetalhePublicoFila
};
