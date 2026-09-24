"use strict";

const express = require("express");
const { inferirFamilia, registroDinamicoPadrao } = require("./dynamic-resolver-registry");
const { validarUrlPublica } = require("./safe-redirect-http");
const { classificarLinkEngine } = require("../../engine/link-role.service");
const {
  detectarMarketplaceRedirect, listarResolversRedirect, resolverRedirectUniversal,
  urlAmazonComAsinExplicito, urlMercadoLivreComMlbExplicito
} = require("./redirect-resolver");

const segmentosEstruturais = new Set([
  "r", "go", "redirect", "out", "url", "link", "links", "product", "products", "item", "items",
  "p", "dp", "gp", "coupon", "coupons", "cupom", "resgate", "offer", "offers", "checkout",
  "shop", "store", "app", "pc", "pdp", "catalog", "detail", "details", "promotion", "promotions"
]);

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

function criarRotasResolversDinamicos({ registry = null, resolve = resolverRedirectUniversal } = {}) {
  const router = express.Router();
  const getStore = () => registry || registroDinamicoPadrao();
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
      "RESOLVER_NAO_ENCONTRADO", "URL_BLOQUEADA_SEGURANCA", "RESOLVER_HARDCODED", "ATIVO_INVALIDO"]);
    return res.status(codigo === "RESOLVER_DUPLICADO" ? 409 : publico.has(codigo) ? 400 : 500)
      .json({ ok: false, erro: publico.has(codigo) ? codigo : "LINK_RESOLVER_OPERATION_FAILED" });
  }
  router.get("/", (_req, res) => {
    try { return res.json({ ok: true, resolvers: getStore().listar().map(registroPublico) }); }
    catch (error) { return erro(res, error); }
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

module.exports = { criarRotasResolversDinamicos, diagnosticoSeguro, tipoResultado };
