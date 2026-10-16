"use strict";

const express = require("express");
const { inferirFamilia, inferirFamiliaRascunho, registroDinamicoPadrao } = require("./dynamic-resolver-registry");
const { validarUrlPublica } = require("./safe-redirect-http");
const { classificarLinkEngine } = require("../../engine/link-role.service");
const { criarContratoPreparacaoLinks } = require("../../engine/preparacao-links.service");
const { normalizarMotivoTecnicoRedirect } = require("./redirect-diagnostic-code");
const {
  detectarMarketplaceRedirect, listarResolversRedirect, resolverRedirectUniversal,
  urlAmazonComAsinExplicito, urlMercadoLivreComMlbExplicito
} = require("./redirect-resolver");

const segmentosEstruturais = new Set([
  "r", "go", "redirect", "out", "url", "link", "links", "product", "products", "item", "items",
  "p", "dp", "gp", "coupon", "coupons", "cupom", "resgate", "offer", "offers", "checkout",
  "shop", "store", "app", "pc", "pdp", "catalog", "detail", "details", "promotion", "promotions"
]);
const papeisPreview = new Set(["nao_informado", "produto", "app", "pc", "moedas", "moda", "resgate"]);
const metodosPreview = new Set(["http_redirect", "html_contextual", "html_marketplace_url",
  "meta_refresh", "window_location", "parametro_e_html_produto", "http_sem_redirect"]);

function ocorrenciasPreview(body = {}) {
  if (!body || typeof body !== "object") throw new Error("PREVIEW_OCORRENCIAS_INVALIDAS");
  const entradas = body.ocorrencias === undefined
    ? [{ urlExemplo: body.urlExemplo, papel: body.papel }]
    : body.ocorrencias;
  if (!Array.isArray(entradas) || entradas.length < 1 || entradas.length > 5)
    throw new Error("PREVIEW_OCORRENCIAS_INVALIDAS");
  return entradas.map(item => {
    const urlExemplo = item?.urlExemplo;
    const papel = item?.papel === undefined ? "nao_informado" : item.papel;
    if (typeof urlExemplo !== "string" || !urlExemplo || urlExemplo !== urlExemplo.trim() ||
        urlExemplo.length > 2048) throw new Error("PREVIEW_OCORRENCIAS_INVALIDAS");
    if (!papeisPreview.has(papel)) throw new Error("PREVIEW_PAPEL_INVALIDO");
    return { urlExemplo, papel };
  });
}

// Only the administrative preview owns this contract. A discovered destination is
// recorded as a redirect candidate, never as a prepared commercial/affiliate link.
function montarContratoPreview(ocorrencias, analises) {
  return criarContratoPreparacaoLinks({
    linksOriginais: ocorrencias.map(item => item.urlExemplo),
    linksPreparados: [],
    redirects: analises.map((analise, indice) => ({
      linkOriginalCapturado: ocorrencias[indice].urlExemplo,
      linkResolvido: analise.ok ? (analise.resultado.urlExpandida || analise.resultado.urlFinal || "") : "",
      marketplaceDetectado: analise.ok ? analise.marketplace : "",
      status: analise.ok ? "resolvido" : "falhou",
      motivo: analise.ok ? "" : normalizarMotivoTecnicoRedirect(analise.resultado),
      papelOriginal: ocorrencias[indice].papel,
      proveniencia: "admin_links_preview"
    })),
    identidadesCanonicas: []
  });
}

function projecaoPreview(registro, ocorrencias, analises) {
  const contrato = montarContratoPreview(ocorrencias, analises);
  return {
    ok: analises.every(item => item.ok),
    modo: "previsualizacao_sem_ingresso",
    prontoComercial: false,
    rascunhoId: registro.id,
    contrato: {
      linksOriginais: contrato.linksOriginais.length,
      destinosCandidatos: contrato.redirects.filter(item => item.status === "resolvido").length,
      linksPreparados: contrato.linksPreparados.length,
      identidadesCanonicas: contrato.identidadesCanonicas.length
    },
    ocorrencias: analises.map((analise, indice) => ({
      indice,
      papelOriginal: ocorrencias[indice].papel,
      proveniencia: "admin_links_preview",
      statusDestino: analise.ok ? "candidato_encontrado" : "nao_encontrado",
      destinoCandidato: analise.ok ? analise.debug.destino : "",
      marketplaceCandidato: analise.ok ? analise.marketplace : "nao_comprovado",
      metodo: analise.ok && metodosPreview.has(analise.metodo) ? analise.metodo : "nao_comprovado",
      identidade: analise.ok ? "pendente" : "nao_comprovada",
      afiliacao: "nao_comprovada",
      produtoConfirmado: false,
      afiliacaoConfirmada: false,
      motivoTecnico: analise.ok ? null : normalizarMotivoTecnicoRedirect(analise.resultado)
    }))
  };
}

function segmentoEstruturalSeguro(segmento) {
  let decodificado;
  try { decodificado = decodeURIComponent(segmento); } catch { return false; }
  return /^[a-z0-9_-]{1,24}$/i.test(decodificado) && segmentosEstruturais.has(decodificado.toLowerCase());
}

function urlDebugSeguro(valor) {
  try {
    const url = new URL(valor);
    const caminho = url.pathname.split("/").filter(Boolean)
      .map(segmento => segmentoEstruturalSeguro(segmento) ? decodeURIComponent(segmento).toLowerCase() : "[redacted]");
    return `${url.hostname}${caminho.length ? `/${caminho.join("/")}` : "/"}`;
  } catch { return ""; }
}

function tipoResultado(resultado) {
  const url = resultado.urlExpandida || resultado.urlFinal || "";
  const classificacao = classificarLinkEngine({ marketplace: resultado.marketplaceDetectado, url });
  if (classificacao.papelLink && classificacao.papelLink !== "desconhecido") return classificacao.papelLink;
  return resultado.chaveCanonica || urlAmazonComAsinExplicito(url) || urlMercadoLivreComMlbExplicito(url)
    ? "produto" : "nao_determinado";
}

function diagnosticoSeguro(entrada, resultado) {
  const final = resultado.urlExpandida || resultado.urlFinal || "";
  return {
    ok: resultado.ok === true,
    entrada: urlDebugSeguro(entrada),
    destino: urlDebugSeguro(final),
    marketplace: resultado.ok ? resultado.marketplaceDetectado : "",
    tipo: resultado.ok ? tipoResultado(resultado) : "nao_determinado",
    metodo: resultado.metodo || "",
    motivo: resultado.ok ? "validado" : (resultado.motivo || "destino_invalido"),
    // O resolvedor não expõe headers, cookies, queries ou credenciais.
    hops: Array.isArray(resultado.hops) ? resultado.hops.map(hop => urlDebugSeguro(hop.url)) : []
  };
}

function registroPublico(registro) {
  const { urlExemplo: _privado, ...publico } = registro;
  return publico;
}

function criarRotasResolversDinamicos({ registry = null, resolve = resolverRedirectUniversal,
  safeHttpDeps = null } = {}) {
  const router = express.Router();
  const getStore = () => registry || registroDinamicoPadrao();
  async function descobrir(urlExemplo) {
    const familia = inferirFamiliaRascunho(urlExemplo);
    validarUrlPublica(familia.urlExemplo);
    if (listarResolversRedirect().some(item => item.dominios.some(host =>
      familia.host === host || familia.host.endsWith(`.${host}`)))) throw new Error("RESOLVER_HARDCODED");
    // O modo administrativo não consulta a allowlist ativa e não a modifica.
    const resultado = await resolve(familia.urlExemplo, {
      adminValidation: true, dynamicRegistry: { localizar: () => null },
      descobertaContextual: true, timeout: 4500, maxRedirects: 5,
      ...(safeHttpDeps ? { safeHttpDeps } : {})
    });
    const final = resultado.urlExpandida || resultado.urlFinal || "";
    const marketplace = detectarMarketplaceRedirect(final);
    const ok = resultado.ok === true && Boolean(marketplace) &&
      marketplace === resultado.marketplaceDetectado;
    return { familia, resultado, ok, marketplace: ok ? marketplace : "", metodo: ok ? resultado.metodo : "",
      evidencia: ok && resultado.evidencia === "cta_unica_em_produto" ? resultado.evidencia : "",
      debug: diagnosticoSeguro(familia.urlExemplo, resultado) };
  }
  function projecaoDescoberta(analise) {
    return { ok: analise.ok, familia: { host: analise.familia.host, pathPrefix: analise.familia.pathPrefix,
      pathMode: analise.familia.pathMode },
      metodo: analise.metodo, destinoCandidato: analise.ok ? analise.debug.destino : "",
      marketplaceCandidato: analise.marketplace || "nao_comprovado", evidencia: analise.evidencia || "",
      motivo: analise.debug.motivo, produtoConfirmado: false, afiliacaoConfirmada: false };
  }
  async function validar(entrada) {
    validarUrlPublica(entrada);
    const resultado = await resolve(entrada, { adminValidation: true, timeout: 4500, maxRedirects: 5 });
    const final = resultado.urlExpandida || resultado.urlFinal || "";
    const identidadeValida = resultado.marketplaceDetectado === "amazon" ? urlAmazonComAsinExplicito(final) :
      resultado.marketplaceDetectado === "mercadolivre" ? urlMercadoLivreComMlbExplicito(final) :
      resultado.marketplaceDetectado === "awin" ? Boolean(resultado.chaveCanonica) : true;
    if (!resultado.ok || !final || !identidadeValida || !detectarMarketplaceRedirect(final) ||
        detectarMarketplaceRedirect(final) !== resultado.marketplaceDetectado) {
      return { ok: false, debug: diagnosticoSeguro(entrada, resultado) };
    }
    return { ok: true, marketplace: resultado.marketplaceDetectado, tipo: tipoResultado(resultado),
      debug: diagnosticoSeguro(entrada, resultado) };
  }
  function erro(res, error) {
    const codigo = String(error?.message || "");
    const publico = new Set(["URL_EXEMPLO_INVALIDA", "FAMILIA_NAO_INFERIVEL", "RESOLVER_DUPLICADO",
      "RESOLVER_NAO_ENCONTRADO", "URL_BLOQUEADA_SEGURANCA", "RESOLVER_HARDCODED", "ATIVO_INVALIDO",
      "RASCUNHO_NAO_HOMOLOGADO", "RASCUNHO_INCOMPATIVEL", "PREVIEW_OCORRENCIAS_INVALIDAS",
      "PREVIEW_PAPEL_INVALIDO"]);
    return res.status(codigo === "RESOLVER_DUPLICADO" ? 409 : publico.has(codigo) ? 400 : 500)
      .json({ ok: false, erro: publico.has(codigo) ? codigo : "LINK_RESOLVER_OPERATION_FAILED" });
  }
  router.get("/", (_req, res) => {
    try { return res.json({ ok: true, resolvers: getStore().listar().map(registroPublico) }); }
    catch (error) { return erro(res, error); }
  });
  router.post("/discover", async (req, res) => {
    try { return res.json(projecaoDescoberta(await descobrir(req.body?.urlExemplo))); }
    catch (error) { return erro(res, error); }
  });
  router.post("/drafts", async (req, res) => {
    try {
      const analise = await descobrir(req.body?.urlExemplo);
      if (!analise.ok) return res.status(422).json({ ...projecaoDescoberta(analise), erro: "DESTINO_NAO_SUPORTADO" });
      const registro = getStore().adicionarRascunho(analise.familia, {
        marketplace: analise.marketplace, metodo: analise.metodo, debug: analise.debug
      });
      return res.status(201).json({ ok: true, resolver: registroPublico(registro) });
    } catch (error) { return erro(res, error); }
  });
  router.post("/drafts/:id/engine-preview", async (req, res) => {
    try {
      const registro = getStore().buscar(req.params.id);
      if (!registro || registro.estado !== "rascunho" || registro.ativo !== false)
        throw new Error("RESOLVER_NAO_ENCONTRADO");
      const ocorrencias = ocorrenciasPreview(req.body);
      for (const item of ocorrencias) {
        const familia = inferirFamiliaRascunho(item.urlExemplo);
        if (familia.host !== registro.host || familia.pathPrefix !== registro.pathPrefix ||
            familia.pathMode !== registro.pathMode) throw new Error("RASCUNHO_INCOMPATIVEL");
      }
      const analises = [];
      for (const item of ocorrencias) analises.push(await descobrir(item.urlExemplo));
      return res.json(projecaoPreview(registro, ocorrencias, analises));
    } catch (error) { return erro(res, error); }
  });
  router.post("/drafts/:id/test", async (req, res) => {
    try {
      const registro = getStore().buscar(req.params.id);
      if (!registro || registro.estado !== "rascunho") throw new Error("RESOLVER_NAO_ENCONTRADO");
      const familia = inferirFamiliaRascunho(req.body?.urlExemplo);
      if (familia.host !== registro.host || familia.pathPrefix !== registro.pathPrefix ||
          familia.pathMode !== registro.pathMode ||
          familia.urlExemplo === registro.urlExemplo) throw new Error("RASCUNHO_INCOMPATIVEL");
      const analise = await descobrir(familia.urlExemplo);
      return res.json({ ...projecaoDescoberta(analise), reutilizavel: analise.ok &&
        analise.metodo === registro.metodoDescoberto });
    } catch (error) { return erro(res, error); }
  });
  router.post("/", async (req, res) => {
    try {
      const familia = inferirFamilia(req.body?.urlExemplo);
      validarUrlPublica(familia.urlExemplo);
      if (listarResolversRedirect().some(item => item.dominios.some(host => familia.host === host || familia.host.endsWith(`.${host}`)))) {
        throw new Error("RESOLVER_HARDCODED");
      }
      if (getStore().listar().some(item => item.host === familia.host && item.pathPrefix === familia.pathPrefix)) throw new Error("RESOLVER_DUPLICADO");
      const teste = await validar(familia.urlExemplo);
      if (!teste.ok) return res.status(teste.debug.motivo === "URL_BLOQUEADA_SEGURANCA" ? 400 : 422)
        .json({ ok: false, erro: teste.debug.motivo === "URL_BLOQUEADA_SEGURANCA" ? "URL_BLOQUEADA_SEGURANCA" : "DESTINO_NAO_SUPORTADO", debug: teste.debug });
      const registro = getStore().adicionar(familia, teste);
      console.log("[LINK-RESOLVER-DINAMICO-VALIDADO]", JSON.stringify({ host: registro.host, padrao: registro.pathPrefix,
        marketplace: teste.marketplace, tipo: teste.tipo }));
      return res.status(201).json({ ok: true, resolver: registroPublico(registro) });
    } catch (error) { return erro(res, error); }
  });
  router.post("/:id/test", async (req, res) => {
    try {
      const registro = getStore().buscar(req.params.id);
      if (!registro) throw new Error("RESOLVER_NAO_ENCONTRADO");
      const teste = await validar(registro.urlExemplo);
      const agora = new Date().toISOString();
      const atualizado = getStore().atualizar(registro.id, {
        ultimoTesteEm: agora, ultimoSucessoEm: teste.ok ? agora : registro.ultimoSucessoEm,
        ultimoMarketplaceDetectado: teste.ok ? teste.marketplace : "",
        ultimoTipoDetectado: teste.ok ? teste.tipo : "",
        falhasConsecutivas: teste.ok ? 0 : registro.falhasConsecutivas + 1,
        ultimoDebugSeguro: teste.debug
      });
      console.log(teste.ok ? "[LINK-RESOLVER-DINAMICO-VALIDADO]" : "[LINK-RESOLVER-DINAMICO-FALHA]",
        JSON.stringify({ host: registro.host, padrao: registro.pathPrefix, marketplace: teste.marketplace || "",
          tipo: teste.tipo || "", motivo: teste.ok ? "validado" : teste.debug.motivo }));
      return res.json({ ok: teste.ok, resolver: registroPublico(atualizado), debug: teste.debug });
    } catch (error) { return erro(res, error); }
  });
  router.get("/:id/debug", (req, res) => {
    try {
      const registro = getStore().buscar(req.params.id);
      if (!registro) return erro(res, new Error("RESOLVER_NAO_ENCONTRADO"));
      return res.json({ ok: true, debug: registro.ultimoDebugSeguro || null });
    } catch (error) { return erro(res, error); }
  });
  router.patch("/:id", (req, res) => {
    try {
      if (typeof req.body?.ativo !== "boolean") throw new Error("ATIVO_INVALIDO");
      return res.json({ ok: true, resolver: registroPublico(getStore().atualizar(req.params.id, { ativo: req.body.ativo })) });
    } catch (error) { return erro(res, error); }
  });
  router.delete("/:id", (req, res) => {
    try { getStore().excluir(req.params.id); return res.json({ ok: true }); }
    catch (error) { return erro(res, error); }
  });
  return router;
}

module.exports = { criarRotasResolversDinamicos, diagnosticoSeguro, tipoResultado, montarContratoPreview };
