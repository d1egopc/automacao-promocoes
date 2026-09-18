"use strict";

const {
  normalizarSlugLojaMagalu
} = require("./magalu-affiliate-link");

const MAGAZINE_VOCE_HOST = "www.magazinevoce.com.br";
const DEFAULT_TIMEOUT_MS = 2500;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarId(valor = "") {
  return texto(valor).toLowerCase();
}

function decodificarHtml(valor = "") {
  return String(valor || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x2f;|&#47;/gi, "/")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function urlSegura(valor = "", base = "") {
  try {
    const url = new URL(decodificarHtml(valor), base || undefined);
    if (url.protocol !== "https:") return null;
    return url;
  } catch (_) {
    return null;
  }
}

function hostnameMlcdnSeguro(valor = "") {
  const url = urlSegura(valor);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return host === "mlcdn.com.br" || host.endsWith(".mlcdn.com.br");
}

function normalizarImagemMlcdn(valor = "") {
  const url = urlSegura(valor);
  if (!url || !hostnameMlcdnSeguro(url.toString()) || !url.pathname || url.pathname === "/") return "";
  return url.toString();
}

function dimensoesImagem(valor = "") {
  const match = texto(valor).match(/\/(\d{2,4})x(\d{2,4})\//i);
  return match
    ? { largura: Number(match[1]), altura: Number(match[2]) }
    : { largura: 0, altura: 0 };
}

function produtoIdDoHref(valor = "") {
  const url = urlSegura(valor, "https://www.magazinevoce.com.br");
  if (!url) return "";
  const match = url.pathname.match(/\/p\/([^/]+)/i);
  return decodificarHtml(match?.[1] || "");
}

function hrefDoProdutoExato(valor = "", produtoId = "") {
  const idHref = produtoIdDoHref(valor);
  return Boolean(idHref && normalizarId(idHref) === normalizarId(produtoId));
}

function atributosTag(tag = "") {
  const atributos = {};
  const re = /([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/gi;
  let match;
  while ((match = re.exec(tag))) atributos[match[1].toLowerCase()] = decodificarHtml(match[3]);
  return atributos;
}

function urlsDeSrcset(valor = "") {
  return String(valor || "")
    .split(",")
    .map(item => item.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function imagensDoBloco(bloco = "") {
  const candidatas = [];
  const imgRe = /<img\b([^>]*)>/gi;
  let match;
  while ((match = imgRe.exec(bloco))) {
    const attrs = atributosTag(match[1]);
    candidatas.push(attrs.src, attrs["data-src"], attrs["data-lazy-src"]);
    candidatas.push(...urlsDeSrcset(attrs.srcset));
  }
  const urlsBrutas = bloco.match(/https?:\\?\/\\?\/[^\s"'<>]+/gi) || [];
  candidatas.push(...urlsBrutas.filter(url => /mlcdn\.com\.br/i.test(url)));
  return candidatas.map(normalizarImagemMlcdn).filter(Boolean);
}

function produtosJsonLd(html = "") {
  const produtos = [];
  const scriptRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  const visitar = valor => {
    if (!valor || typeof valor !== "object") return;
    if (Array.isArray(valor)) {
      valor.forEach(visitar);
      return;
    }
    const tipo = Array.isArray(valor["@type"]) ? valor["@type"] : [valor["@type"]];
    if (tipo.some(item => String(item || "").toLowerCase() === "product")) produtos.push(valor);
    if (valor["@graph"]) visitar(valor["@graph"]);
  };
  while ((match = scriptRe.exec(html))) {
    try {
      visitar(JSON.parse(decodificarHtml(match[1])));
    } catch (_) {
      // JSON-LD inválido não deve virar evidência.
    }
  }
  return produtos;
}

function idsProdutoJsonLd(produto = {}) {
  return [produto.sku, produto.productID, produto.productId, produto.mpn]
    .map(texto)
    .filter(Boolean);
}

function urlsImagemJsonLd(produto = {}) {
  const imagens = Array.isArray(produto.image) ? produto.image : [produto.image];
  const offerUrl = produto.offers && !Array.isArray(produto.offers) ? produto.offers.url : "";
  return [...imagens, offerUrl].filter(Boolean);
}

function cardsProduto(html = "") {
  const cards = [];
  const cardRe = /<a\b([^>]*href=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = cardRe.exec(html))) {
    const attrs = atributosTag(match[1]);
    const href = attrs.href || "";
    if (!href) continue;
    cards.push({ href, html: match[0], imagens: imagensDoBloco(match[2]) });
  }
  return cards;
}

function encontrarProdutoExato(html = "", produtoId = "") {
  const esperado = normalizarId(produtoId);
  const cards = cardsProduto(html);
  const cardsExatos = cards.filter(card => hrefDoProdutoExato(card.href, produtoId));
  const jsonldTodos = produtosJsonLd(html);
  const jsonlds = jsonldTodos.filter(produto =>
    idsProdutoJsonLd(produto).some(id => normalizarId(id) === esperado) &&
    urlsImagemJsonLd(produto).some(url => hrefDoProdutoExato(url, produtoId))
  );
  const jsonldDivergente = jsonldTodos.length > 0 && jsonlds.length === 0;

  const candidatos = [];
  for (const card of cardsExatos) {
    for (const imagem of card.imagens) candidatos.push({ imagem, origem: "card", href: card.href });
  }
  for (const produto of jsonlds) {
    for (const imagem of urlsImagemJsonLd(produto)) {
      const url = normalizarImagemMlcdn(imagem);
      if (url) candidatos.push({ imagem: url, origem: "jsonld", href: produto.offers?.url || "" });
    }
  }

  const unicos = new Map();
  for (const candidato of candidatos) {
    if (!candidato.imagem || !hrefDoProdutoExato(candidato.href, produtoId)) continue;
    if (!unicos.has(candidato.imagem)) {
      unicos.set(candidato.imagem, {
        ...candidato,
        ...dimensoesImagem(candidato.imagem)
      });
    }
  }
  const imagens = [...unicos.values()].sort((a, b) =>
    (b.largura * b.altura) - (a.largura * a.altura)
  );
  return {
    produtoId,
    skuConfirmado: !jsonldDivergente && (jsonlds.length > 0 || cardsExatos.length > 0),
    hrefConfirmado: !jsonldDivergente && (cardsExatos.length > 0 || jsonlds.length > 0),
    cardsEncontrados: cardsExatos.length,
    candidatos: imagens,
    imagem: imagens[0]?.imagem || "",
    motivo: imagens.length && !jsonldDivergente ? "imagem_mlcdn_confirmada" :
      (jsonldDivergente ? "magalu_imagem_busca_sku_divergente" :
        (cardsExatos.length || jsonlds.length ? "magalu_imagem_busca_sem_imagem" : "magalu_imagem_busca_sem_produto_exato"))
  };
}

function timeoutMsValido(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? Math.min(Math.trunc(numero), 10000) : DEFAULT_TIMEOUT_MS;
}

function promessaComAbort(promessa, controller, timeoutMs) {
  let timer = null;
  const timeout = new Promise((_, rejeitar) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      const erro = new Error("magalu_request_timeout");
      erro.name = "AbortError";
      rejeitar(erro);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promessa), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function cancelarBodyComLimite(body) {
  if (typeof body?.cancel !== "function") return;
  try {
    await promessaComAbort(body.cancel(), null, 250);
  } catch (_) {
    // O cancelamento do body é best-effort; a resposta já foi rejeitada/finalizada.
  }
}

async function lerRespostaTextoComTimeout(fetchFn, url, timeoutMs) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const inicio = Date.now();
  let resposta = null;
  try {
    resposta = await promessaComAbort(
      fetchFn(url, controller ? { signal: controller.signal, redirect: "follow" } : { redirect: "follow" }),
      controller,
      timeoutMs
    );
    const restante = Math.max(1, timeoutMs - (Date.now() - inicio));
    const html = await promessaComAbort(resposta.text(), controller, restante);
    return { resposta, html };
  } finally {
    await cancelarBodyComLimite(resposta?.body);
  }
}

async function validarImagemOficialHttp(url = "", { fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = {
    ok: false,
    statusHttp: 0,
    urlFinal: "",
    contentType: "",
    motivoFinal: "magalu_imagem_http_invalida"
  };
  if (typeof fetchFn !== "function") return { ...base, motivoFinal: "magalu_imagem_fetch_indisponivel" };

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let resposta = null;
  try {
    resposta = await promessaComAbort(
      fetchFn(url, controller ? { signal: controller.signal, redirect: "follow" } : { redirect: "follow" }),
      controller,
      timeoutMsValido(timeoutMs)
    );
    const statusHttp = Number(resposta.status || 0);
    const finalUrl = urlSegura(resposta.url || url);
    const urlFinal = finalUrl?.toString() || "";
    const hostFinalValido = Boolean(finalUrl && hostnameMlcdnSeguro(urlFinal));
    const contentType = texto(resposta.headers?.get?.("content-type") || resposta.headers?.["content-type"] || "")
      .toLowerCase()
      .split(";", 1)[0]
      .trim();
    if (statusHttp < 200 || statusHttp >= 300) {
      return { ...base, statusHttp, urlFinal, contentType, motivoFinal: `magalu_imagem_http_${statusHttp || "erro"}` };
    }
    if (!hostFinalValido) return { ...base, statusHttp, urlFinal, contentType, motivoFinal: "magalu_imagem_host_final_invalido" };
    if (!contentType.startsWith("image/")) return { ...base, statusHttp, urlFinal, contentType, motivoFinal: "magalu_imagem_content_type_invalido" };
    return { ok: true, statusHttp, urlFinal, contentType, motivoFinal: "magalu_imagem_http_confirmada" };
  } catch (erro) {
    return {
      ...base,
      motivoFinal: erro?.name === "AbortError" ? "magalu_imagem_timeout" : "magalu_imagem_fetch_falhou"
    };
  } finally {
    await cancelarBodyComLimite(resposta?.body);
  }
}

function bloqueioBusca(html = "") {
  return /az-request-verify|complete\s+o\s+captcha|captcha\s+magalu|data-testid=["']captcha/i.test(html);
}

function urlImagemResumo(url = "") {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch (_) {
    return "";
  }
}

async function resolverImagemMagazineVoce({
  productId = "",
  promoterId = "",
  slugWorkspace = "",
  fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const esperado = texto(productId);
  const slug = normalizarSlugLojaMagalu(slugWorkspace || promoterId);
  const retornoBase = {
    ok: false,
    imagem: "",
    productId: esperado,
    slugWorkspace: slug,
    statusHttp: 0,
    skuConfirmado: false,
    hrefConfirmado: false,
    candidatos: [],
    motivoFinal: ""
  };
  if (!esperado) return { ...retornoBase, motivoFinal: "magalu_imagem_busca_product_id_ausente" };
  if (!slug) return { ...retornoBase, motivoFinal: "magalu_imagem_busca_slug_ausente" };
  if (typeof fetchFn !== "function") return { ...retornoBase, motivoFinal: "magalu_imagem_busca_fetch_indisponivel" };

  const urlBusca = `https://${MAGAZINE_VOCE_HOST}/${encodeURIComponent(slug)}/busca/${encodeURIComponent(esperado)}/`;
  try {
    const leitura = await lerRespostaTextoComTimeout(fetchFn, urlBusca, timeoutMsValido(timeoutMs));
    const resposta = leitura.resposta;
    const html = leitura.html;
    const statusHttp = Number(resposta.status || 0);
    const finalUrl = urlSegura(resposta.url || urlBusca);
    const mesmaFonte = finalUrl && finalUrl.hostname.toLowerCase() === MAGAZINE_VOCE_HOST;
    if (!mesmaFonte) return { ...retornoBase, statusHttp, motivoFinal: "magalu_imagem_busca_host_final_invalido" };
    if (!resposta.ok) return { ...retornoBase, statusHttp, motivoFinal: `magalu_imagem_busca_http_${statusHttp || "erro"}` };
    if (bloqueioBusca(html)) return { ...retornoBase, statusHttp, motivoFinal: "magalu_imagem_busca_captcha" };

    const encontrado = encontrarProdutoExato(html, esperado);
    const base = { ...retornoBase, statusHttp, skuConfirmado: encontrado.skuConfirmado, hrefConfirmado: encontrado.hrefConfirmado, candidatos: encontrado.candidatos };
    if (!encontrado.imagem || !encontrado.skuConfirmado || !encontrado.hrefConfirmado) {
      return { ...base, motivoFinal: encontrado.motivo };
    }
    const validacaoHttp = await validarImagemOficialHttp(encontrado.imagem, {
      fetchFn,
      timeoutMs: timeoutMsValido(timeoutMs)
    });
    if (!validacaoHttp.ok) return { ...base, validacaoHttp, motivoFinal: validacaoHttp.motivoFinal };
    return {
      ...base,
      ok: true,
      imagem: encontrado.imagem,
      validacaoHttp,
      motivoFinal: "imagem_mlcdn_confirmada",
      imagemSelecionadaResumo: urlImagemResumo(encontrado.imagem)
    };
  } catch (erro) {
    const motivoFinal = erro?.name === "AbortError" ? "magalu_imagem_busca_timeout" : "magalu_imagem_busca_fetch_falhou";
    return { ...retornoBase, motivoFinal };
  }
}

module.exports = {
  resolverImagemMagazineVoce,
  encontrarProdutoExato,
  normalizarImagemMlcdn,
  hostnameMlcdnSeguro,
  urlImagemResumo
};
