"use strict";

const ARQUIVO_VITRINE = "vitrine.json";
const ARQUIVO_SLUGS = "vitrine-slugs.json";
const VITRINE_RETENCAO_MS = 72 * 60 * 60 * 1000;
const VITRINE_MAX_OFERTAS = 192;
const VITRINE_LIMIT_PADRAO = 20;
const VITRINE_LIMIT_MAXIMO = 50;

const SLUGS_RESERVADOS = new Set([
  "admin",
  "api",
  "auth",
  "automacao",
  "campanhas",
  "config",
  "conexoes",
  "dashboard",
  "debug",
  "destinos",
  "discord",
  "engine",
  "fila",
  "historico",
  "integracoes",
  "login",
  "manual-v2",
  "me",
  "mensageiro",
  "ofertas",
  "planos",
  "r",
  "radar",
  "sessoes",
  "social",
  "status",
  "storage",
  "telegram",
  "templates",
  "telemetria",
  "v",
  "vitrine",
  "whatsapp"
]);

const CAMPOS_TECNICOS_BLOQUEADOS = new Set([
  "clienteId",
  "workspaceId",
  "token",
  "cookie",
  "cookies",
  "authorization",
  "headers",
  "credenciais",
  "integracoes",
  "integracaoId",
  "integrationId",
  "engineJobId",
  "jobId",
  "eventoId",
  "destinosEnviados",
  "destinosEstado",
  "logs",
  "debug"
]);

function texto(valor = "") {
  return String(valor || "").trim();
}

function erro(codigo, statusCode = 400) {
  const e = new Error(codigo);
  e.statusCode = statusCode;
  return e;
}

function contemHtml(valor = "") {
  const s = texto(valor);
  return /<[^>]*>|[<>]/.test(s);
}

function validarSemHtml(valor = "", campo = "campo") {
  if (contemHtml(valor)) {
    throw erro(`${campo}_nao_aceita_html`, 400);
  }
}

function limitar(valor = "", max = 280) {
  return texto(valor).slice(0, max);
}

function normalizarSlug(valor = "") {
  const slug = texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(slug)) {
    throw erro("slug_invalido", 400);
  }

  if (SLUGS_RESERVADOS.has(slug)) {
    throw erro("slug_reservado", 400);
  }

  return slug;
}

function normalizarUrlHttps(valor = "", campo = "url") {
  const original = texto(valor);
  if (!original) return "";
  validarSemHtml(original, campo);

  let url;
  try {
    url = new URL(original);
  } catch {
    throw erro(`${campo}_invalida`, 400);
  }

  if (url.protocol !== "https:") {
    throw erro(`${campo}_invalida`, 400);
  }

  return url.toString().slice(0, 500);
}

function normalizarLinksPublicos(entrada = {}) {
  const links = entrada && typeof entrada === "object" ? entrada : {};
  return {
    whatsapp: normalizarUrlHttps(links.whatsapp || links.WhatsApp || "", "whatsapp"),
    telegram: normalizarUrlHttps(links.telegram || links.Telegram || "", "telegram"),
    instagram: normalizarUrlHttps(links.instagram || links.Instagram || "", "instagram"),
    discord: normalizarUrlHttps(links.discord || links.Discord || "", "discord")
  };
}

function vitrinePadrao(clienteId = "") {
  return {
    versao: 1,
    clienteId: texto(clienteId),
    config: {
      ativa: false,
      slug: "",
      nomePublico: "",
      logo: "",
      descricao: "",
      links: {
        whatsapp: "",
        telegram: "",
        instagram: "",
        discord: ""
      },
      atualizadoEm: ""
    },
    ofertas: []
  };
}

function normalizarVitrine(clienteId = "", dados = {}) {
  const base = vitrinePadrao(clienteId);
  const entrada = dados && typeof dados === "object" ? dados : {};
  const config = entrada.config && typeof entrada.config === "object" ? entrada.config : entrada;
  const linksEntrada = config.links || config.linksPublicos || {};

  return {
    ...base,
    ...entrada,
    versao: 1,
    clienteId: texto(clienteId || entrada.clienteId || ""),
    config: {
      ...base.config,
      ...config,
      ativa: config.ativa === true,
      slug: config.slug ? normalizarSlug(config.slug) : "",
      nomePublico: limitar(config.nomePublico || "", 80),
      logo: normalizarUrlHttps(config.logo || "", "logo"),
      descricao: limitar(config.descricao || "", 300),
      links: normalizarLinksPublicos(linksEntrada),
      atualizadoEm: texto(config.atualizadoEm || "")
    },
    ofertas: Array.isArray(entrada.ofertas) ? entrada.ofertas : []
  };
}

function lerIndiceSlugs({ readGlobalJson } = {}) {
  const lido = readGlobalJson(ARQUIVO_SLUGS, null);
  const entrada = lido && typeof lido === "object" ? lido : {};
  const slugsFonte = entrada.slugs && typeof entrada.slugs === "object" ? entrada.slugs : {};
  const slugs = {};

  for (const [slug, clienteId] of Object.entries(slugsFonte)) {
    try {
      slugs[normalizarSlug(slug)] = texto(clienteId);
    } catch {}
  }

  return {
    versao: 1,
    atualizadoEm: texto(entrada.atualizadoEm || ""),
    slugs
  };
}

function salvarIndiceSlugs(indice = {}, { writeGlobalJson } = {}) {
  const proximo = {
    versao: 1,
    atualizadoEm: new Date().toISOString(),
    slugs: indice.slugs && typeof indice.slugs === "object" ? indice.slugs : {}
  };

  writeGlobalJson(ARQUIVO_SLUGS, proximo);
  return proximo;
}

function lerVitrineWorkspace(clienteId = "", deps = {}) {
  const lido = deps.readClienteJson(clienteId, ARQUIVO_VITRINE, null);
  return normalizarVitrine(clienteId, lido || {});
}

function salvarVitrineWorkspace(clienteId = "", vitrine = {}, deps = {}) {
  const normalizada = normalizarVitrine(clienteId, vitrine);
  deps.writeClienteJson(clienteId, ARQUIVO_VITRINE, normalizada);
  return normalizada;
}

function normalizarPayloadConfig(body = {}, atual = {}) {
  const payload = body && typeof body === "object" ? body : {};
  validarSemHtml(payload.nomePublico || "", "nomePublico");
  validarSemHtml(payload.descricao || "", "descricao");

  const linksEntrada = payload.links || payload.linksPublicos || {};

  return {
    ativa: Object.prototype.hasOwnProperty.call(payload, "ativa")
      ? payload.ativa === true
      : atual.ativa === true,
    slug: Object.prototype.hasOwnProperty.call(payload, "slug")
      ? (payload.slug ? normalizarSlug(payload.slug) : "")
      : texto(atual.slug || ""),
    nomePublico: limitar(payload.nomePublico ?? atual.nomePublico ?? "", 80),
    logo: normalizarUrlHttps(payload.logo ?? atual.logo ?? "", "logo"),
    descricao: limitar(payload.descricao ?? atual.descricao ?? "", 300),
    links: normalizarLinksPublicos({
      ...(atual.links || {}),
      ...linksEntrada
    }),
    atualizadoEm: new Date().toISOString()
  };
}

function salvarConfigVitrine(clienteId = "", body = {}, deps = {}) {
  const atual = lerVitrineWorkspace(clienteId, deps);
  const config = normalizarPayloadConfig(body, atual.config);
  const indice = lerIndiceSlugs(deps);
  const slugAnterior = texto(atual.config.slug || "");
  const slugNovo = texto(config.slug || "");

  if (config.ativa === true && !slugNovo) {
    throw erro("slug_obrigatorio", 400);
  }

  if (slugNovo) {
    const donoAtual = indice.slugs[slugNovo];
    if (donoAtual && String(donoAtual) !== String(clienteId)) {
      throw erro("slug_indisponivel", 409);
    }
  }

  if (slugAnterior && indice.slugs[slugAnterior] === String(clienteId)) {
    delete indice.slugs[slugAnterior];
  }

  if (slugNovo) {
    indice.slugs[slugNovo] = String(clienteId);
  }

  salvarIndiceSlugs(indice, deps);

  const proxima = {
    ...atual,
    config,
    ofertas: aplicarRetencaoOfertas(atual.ofertas)
  };

  return {
    vitrine: salvarVitrineWorkspace(clienteId, proxima, deps),
    config
  };
}

function instanteOferta(oferta = {}) {
  const valor = oferta.ultimoEnvioEm || oferta.enviadoEm || oferta.dataEnvio || oferta.atualizadoEm || oferta.criadoEm || "";
  const ts = Date.parse(valor);
  return Number.isFinite(ts) ? ts : 0;
}

function urlPublica(valor = "") {
  try {
    const url = new URL(texto(valor));
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function urlRedirectOptimus(valor = "") {
  try {
    const url = new URL(texto(valor));
    if (url.protocol !== "https:") return "";
    if (url.hostname !== "go.optimuspromo.com.br") return "";
    if (!url.pathname.startsWith("/r/")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function sanitizarLinkComercial(link = {}) {
  if (!link || typeof link !== "object") return null;
  if (link.renderizavel === false) return null;

  const url = urlRedirectOptimus(
    link.urlOptimus ||
    link.redirectOptimus ||
    link.urlAfiliadaWorkspace ||
    link.urlAfiliada ||
    link.afiliado ||
    link.linkAfiliado ||
    link.url ||
    link.link ||
    ""
  );
  if (!url) return null;

  return {
    papel: limitar(link.papel || link.tipo || "", 40),
    label: limitar(link.label || link.titulo || "", 80),
    url
  };
}

function sanitizarLinksComerciais(links = []) {
  if (!Array.isArray(links)) return [];
  return links
    .map(sanitizarLinkComercial)
    .filter(Boolean)
    .slice(0, 8);
}

function listaTextoPublica(valor = [], maxItens = 8, maxTexto = 80) {
  const lista = Array.isArray(valor) ? valor : valor ? [valor] : [];
  const vistos = new Set();
  const saida = [];

  for (const item of lista) {
    const textoItem = limitar(item, maxTexto);
    const chave = textoItem.toLowerCase();
    if (!textoItem || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(textoItem);
    if (saida.length >= maxItens) break;
  }

  return saida;
}

function sanitizarOfertaPublica(oferta = {}) {
  const entrada = oferta && typeof oferta === "object" ? oferta : {};
  const cupons = listaTextoPublica(entrada.cupons || entrada.cupom || entrada.codigoCupom || [], 8, 40);
  const saida = {
    id: limitar(entrada.idPublico || entrada.ofertaId || entrada.id || "", 80),
    titulo: limitar(entrada.titulo || entrada.nome || "", 180),
    imagem: urlPublica(entrada.imagem || entrada.image || entrada.thumbnail || ""),
    marketplace: limitar(entrada.marketplace || "", 60),
    categoria: limitar(entrada.categoria || "", 80),
    preco: limitar(entrada.preco ?? entrada.precoAtual ?? "", 40),
    precoAnterior: limitar(entrada.precoAnterior ?? entrada.precoDe ?? "", 40),
    desconto: limitar(entrada.desconto || entrada.percentualDesconto || "", 40),
    cupom: limitar(entrada.cupom || entrada.codigoCupom || cupons[0] || "", 120),
    cupons,
    beneficios: listaTextoPublica(entrada.beneficios || entrada.beneficioTexto || entrada.beneficio || [], 6, 120),
    moedas: typeof entrada.moedas === "boolean" ? entrada.moedas : limitar(entrada.moedas || "", 80),
    enviadoEm: texto(entrada.ultimoEnvioEm || entrada.enviadoEm || ""),
    linksComerciais: sanitizarLinksComerciais(entrada.linksComerciais || [])
  };

  for (const campo of Object.keys(saida)) {
    if (CAMPOS_TECNICOS_BLOQUEADOS.has(campo)) delete saida[campo];
  }

  return saida;
}

function aplicarRetencaoOfertas(ofertas = [], agora = Date.now()) {
  if (!Array.isArray(ofertas)) return [];

  return ofertas
    .filter((oferta) => {
      const ts = instanteOferta(oferta);
      return ts > 0 && agora - ts <= VITRINE_RETENCAO_MS;
    })
    .sort((a, b) => instanteOferta(b) - instanteOferta(a))
    .slice(0, VITRINE_MAX_OFERTAS)
    .map(sanitizarOfertaPublica);
}

function normalizarPaginacao(opcoes = {}) {
  const page = Math.max(1, Math.floor(Number(opcoes.page) || 1));
  const limitBruto = Math.floor(Number(opcoes.limit) || VITRINE_LIMIT_PADRAO);
  const limit = Math.max(1, Math.min(VITRINE_LIMIT_MAXIMO, limitBruto));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function paginarOfertasPublicas(ofertas = [], opcoes = {}) {
  const retidas = aplicarRetencaoOfertas(ofertas);
  const { page, limit, offset } = normalizarPaginacao(opcoes);
  const total = retidas.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pageFinal = Math.min(page, totalPages);
  const offsetFinal = (pageFinal - 1) * limit;

  return {
    ofertas: retidas.slice(offsetFinal, offsetFinal + limit),
    pagination: {
      page: pageFinal,
      limit,
      total,
      totalPages,
      hasPrev: pageFinal > 1,
      hasNext: pageFinal < totalPages
    }
  };
}

function chaveOferta(oferta = {}) {
  return texto(oferta.idPublico || oferta.ofertaId || oferta.id || oferta.linkAfiliado || oferta.titulo || "");
}

function upsertOfertaVitrine(clienteId = "", oferta = {}, deps = {}) {
  const atual = lerVitrineWorkspace(clienteId, deps);
  if (atual.config.ativa !== true) {
    return { ok: false, motivo: "vitrine_inativa" };
  }

  const chave = chaveOferta(oferta);
  if (!chave) {
    throw erro("oferta_vitrine_invalida", 400);
  }

  const base = atual.ofertas.filter((item) => chaveOferta(item) !== chave);
  const agoraIso = new Date().toISOString();
  const proximaOferta = {
    ...oferta,
    idPublico: oferta.idPublico || chave,
    ultimoEnvioEm: oferta.ultimoEnvioEm || oferta.enviadoEm || agoraIso
  };

  const ofertas = aplicarRetencaoOfertas([proximaOferta, ...base]);
  const vitrine = salvarVitrineWorkspace(clienteId, { ...atual, ofertas }, deps);
  return { ok: true, oferta: sanitizarOfertaPublica(proximaOferta), vitrine };
}

function payloadConfig(config = {}) {
  return {
    ativa: config.ativa === true,
    slug: texto(config.slug || ""),
    nomePublico: texto(config.nomePublico || ""),
    logo: texto(config.logo || ""),
    descricao: texto(config.descricao || ""),
    links: normalizarLinksPublicos(config.links || {}),
    atualizadoEm: texto(config.atualizadoEm || "")
  };
}

function payloadPublico(vitrine = {}, opcoes = {}) {
  const config = payloadConfig(vitrine.config || {});
  const pagina = paginarOfertasPublicas(vitrine.ofertas || [], opcoes);
  return {
    slug: config.slug,
    nomePublico: config.nomePublico,
    logo: config.logo,
    descricao: config.descricao,
    links: config.links,
    atualizadoEm: config.atualizadoEm,
    ofertas: pagina.ofertas,
    pagination: pagina.pagination
  };
}

function buscarVitrinePublicaPorSlug(slugEntrada = "", deps = {}, opcoes = {}) {
  const slug = normalizarSlug(slugEntrada);
  const indice = lerIndiceSlugs(deps);
  const clienteId = indice.slugs[slug];
  if (!clienteId) return null;

  const vitrine = lerVitrineWorkspace(clienteId, deps);
  if (vitrine.config.ativa !== true) return null;
  if (vitrine.config.slug !== slug) return null;

  return payloadPublico(vitrine, opcoes);
}

module.exports = {
  ARQUIVO_SLUGS,
  ARQUIVO_VITRINE,
  SLUGS_RESERVADOS,
  VITRINE_MAX_OFERTAS,
  VITRINE_RETENCAO_MS,
  VITRINE_LIMIT_MAXIMO,
  VITRINE_LIMIT_PADRAO,
  aplicarRetencaoOfertas,
  buscarVitrinePublicaPorSlug,
  contemHtml,
  lerIndiceSlugs,
  lerVitrineWorkspace,
  normalizarSlug,
  normalizarUrlHttps,
  payloadConfig,
  payloadPublico,
  paginarOfertasPublicas,
  salvarConfigVitrine,
  salvarVitrineWorkspace,
  sanitizarOfertaPublica,
  upsertOfertaVitrine
};
