(function publicarMagaluLocalResolver(global) {
  "use strict";
  const HOST = "www.magazinevoce.com.br";
  const CAPABILITY = "magalu_image_v1";
  function texto(v) { return String(v ?? "").trim(); }
  function decode(v) { return texto(v).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#x2f;|&#47;/gi, "/"); }
  function urlSeguro(v, base) { try { const u = new URL(decode(v), base); return u.protocol === "https:" ? u : null; } catch (_) { return null; } }
  function hostMlcdn(v) { const u = urlSeguro(v); if (!u) return false; return u.hostname === "mlcdn.com.br" || u.hostname.endsWith(".mlcdn.com.br"); }
  function imagemMlcdn(v) { const u = urlSeguro(v); return u && hostMlcdn(u.toString()) && u.pathname !== "/" ? u.toString() : ""; }
  function attrs(tag) { const out = {}; const re = /([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/gi; let m; while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decode(m[3]); return out; }
  function idHref(v, expected) { const u = urlSeguro(v, `https://${HOST}`); const m = u?.pathname.match(/\/p\/([^/]+)/i); return Boolean(m && texto(m[1]).toLowerCase() === texto(expected).toLowerCase()); }
  function dims(v) { const m = texto(v).match(/\/(\d{2,4})x(\d{2,4})\//i); return { largura: m ? Number(m[1]) : 0, altura: m ? Number(m[2]) : 0 }; }
  function parse(html, productId) {
    const expected = texto(productId).toLowerCase(); const candidates = [];
    const anchors = /<a\b([^>]*href=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi; let match;
    while ((match = anchors.exec(html))) {
      const a = attrs(match[1]); if (!idHref(a.href, productId)) continue;
      const images = /<img\b([^>]*)>/gi; let im;
      while ((im = images.exec(match[2]))) { const ia = attrs(im[1]); for (const raw of [ia.src, ia["data-src"], ia["data-lazy-src"], ...(ia.srcset || "").split(",").map(x => x.trim().split(/\s+/)[0])]) { const image = imagemMlcdn(raw); if (image) candidates.push({ imagem: image, href: a.href, origem: "card", ...dims(image) }); } }
    }
    const ld = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let lm;
    while ((lm = ld.exec(html))) { try { const value = JSON.parse(decode(lm[1])); const list = Array.isArray(value) ? value : (Array.isArray(value?.["@graph"]) ? value["@graph"] : [value]); for (const product of list) { if (String(product?.["@type"] || "").toLowerCase() !== "product") continue; const ids = [product.sku, product.productID, product.productId, product.mpn].map(texto).map(x => x.toLowerCase()); const href = product.offers?.url || ""; if (!ids.includes(expected) || !idHref(href, productId)) continue; const images = Array.isArray(product.image) ? product.image : [product.image]; for (const raw of images) { const image = imagemMlcdn(raw); if (image) candidates.push({ imagem: image, href, origem: "jsonld", ...dims(image) }); } } } catch (_) {} }
    const unique = [...new Map(candidates.map(item => [item.imagem, item])).values()].sort((a, b) => b.largura * b.altura - a.largura * a.altura);
    return { skuConfirmado: candidates.length > 0, hrefConfirmado: candidates.length > 0, candidatos: unique, imagem: unique[0]?.imagem || "" };
  }
  function desafio(html) { return /az-request-verify|captcha|complete\s+o\s+captcha/i.test(html); }
  async function fetchWithTimeout(url, timeoutMs = 4000, options = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...options, redirect: "follow", signal: controller.signal }); } finally { clearTimeout(timer); }
  }
  async function fetchTextWithTimeout(url, timeoutMs = 4000) {
    const controller = new AbortController(); let response = null; let timer = null;
    const limite = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); const erro = new Error("magalu_busca_timeout"); erro.name = "AbortError"; reject(erro); }, timeoutMs); });
    try {
      response = await Promise.race([fetch(url, { redirect: "follow", signal: controller.signal }), limite]);
      const html = await Promise.race([response.text(), limite]);
      return { response, html };
    } finally {
      if (timer) clearTimeout(timer);
      try {
        const cancelamento = response?.body?.cancel?.();
        cancelamento?.catch?.(() => {});
      } catch (_) {}
    }
  }
  async function identificar({ productId, slugWorkspace }) {
    const slug = encodeURIComponent(texto(slugWorkspace).toLowerCase().replace(/[^a-z0-9-]/g, "")); const id = texto(productId); if (!slug || !id) throw new Error("identidade_magalu_incompleta");
    const url = `https://${HOST}/${slug}/busca/${encodeURIComponent(id)}/`; const leitura = await fetchTextWithTimeout(url); const response = leitura.response; const finalUrl = new URL(response.url || url); const html = leitura.html;
    if (finalUrl.hostname.toLowerCase() !== HOST || !response.ok) throw new Error(`busca_magalu_http_${response.status}`);
    if (desafio(html)) throw new Error("magalu_imagem_busca_captcha");
    const found = parse(html, id); if (!found.imagem || !found.skuConfirmado || !found.hrefConfirmado) throw new Error("magalu_imagem_produto_nao_confirmado");
    return { marketplace: "magalu", productId: id, imagemOficialUrl: found.imagem, provaTecnica: { origem: "local_first_party", source: "magazinevoce_busca", productId: id, skuConfirmado: true, hrefConfirmado: true, hrefProduto: found.candidatos[0]?.href || "", imagemOficialUrl: found.imagem }, capability: CAPABILITY };
  }
  async function provarImagem({ productId, imagemOficialUrl, provaTecnica }) {
    const id = texto(productId);
    const prova = provaTecnica || {};
    if (!id || texto(prova.productId).toLowerCase() !== id.toLowerCase() || prova.skuConfirmado !== true || prova.hrefConfirmado !== true || !idHref(prova.hrefProduto, id) || !hostMlcdn(imagemOficialUrl)) throw new Error("magalu_imagem_produto_nao_confirmado");
    const imageResponse = await fetchWithTimeout(imagemOficialUrl, 4000); const finalImage = new URL(imageResponse.url || imagemOficialUrl); const ct = texto(imageResponse.headers.get("content-type")).toLowerCase();
    try {
      const cancelamento = imageResponse.body?.cancel?.();
      cancelamento?.catch?.(() => {});
    } catch (_) {}
    if (!imageResponse.ok || !hostMlcdn(finalImage.toString()) || finalImage.protocol !== "https:" || !ct.startsWith("image/")) throw new Error("magalu_imagem_http_nao_confirmada");
    return { marketplace: "magalu", productId: id, imagemOficialUrl: finalImage.toString(), provaTecnica: { ...provaPublica(prova), hostFinal: finalImage.hostname, imagemOficialUrl: finalImage.toString() }, capability: CAPABILITY };
  }
  function provaPublica(prova = {}) {
    return { origem: texto(prova.origem), source: texto(prova.source), productId: texto(prova.productId), skuConfirmado: prova.skuConfirmado === true, hrefConfirmado: prova.hrefConfirmado === true, hrefProduto: texto(prova.hrefProduto) };
  }
  async function resolver({ productId, slugWorkspace }) {
    const identificado = await identificar({ productId, slugWorkspace });
    return provarImagem({ productId, imagemOficialUrl: identificado.imagemOficialUrl, provaTecnica: identificado.provaTecnica });
  }
  global.OptimusMagaluLocalResolver = { resolver, identificar, provarImagem, parse, hostMlcdn, imagemMlcdn, CAPABILITY };
  if (typeof module !== "undefined" && module.exports) module.exports = global.OptimusMagaluLocalResolver;
})(typeof globalThis !== "undefined" ? globalThis : self);
