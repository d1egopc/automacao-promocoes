const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { htmlPreview, renderizarPng } = require("../src/renderer.service");
const { hashPayload } = require("../src/contract");

const imagem = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
const base = {
  clienteIdInterno: "visual_sintetico", ofertaId: "oferta_sintetica",
  template: {
    faixaSuperiorAtiva: true, faixaSuperiorTexto: "OFERTA", faixaSuperiorCor: "#f97316",
    faixaInferiorAtiva: true, mostrarCardPreco: true, seloAtivo: true,
    mostrarDataAvisoPreco: true, textoAvisoPreco: "Preços sujeitos a alteração.",
    posicaoCard: "bottom-left", seloPosicao: "bottom-right"
  },
  dados: { imagem: "https://example.test/sintetica.png", preco: "99.90", cupom: "TESTE", marketplace: "amazon" },
  cta: 'COMENTE "PROMO"', dataPublicacao: "2026-10-17", versao: 1
};
const payload = { ...base, hash: hashPayload(base) };

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
  });
  try {
    const png = await renderizarPng(payload, {
      browserFactory: async () => browser,
      baixarImagem: async () => ({ buffer: imagem, mimeType: "image/png" })
    });
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), 1080);
    assert.equal(png.readUInt32BE(20), 1080);
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
    try {
      await page.setContent(htmlPreview({ template: require("../src/contract").normalizarTemplateVisual(base.template), dados: base.dados, cta: base.cta, dataPublicacao: base.dataPublicacao, imagemSrc: `data:image/png;base64,${imagem.toString("base64")}` }));
      const caixas = await page.evaluate(() => {
        const caixa = seletor => { const r = document.querySelector(seletor).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
        return { aviso: caixa(".price-notice"), card: caixa(".card"), selo: caixa(".badge"), cta: caixa(".bottom-band"), texto: document.querySelector(".price-notice").innerText };
      });
      assert.match(caixas.texto, /Oferta do dia · 17\/10\/2026/);
      assert.ok(caixas.card.bottom <= caixas.aviso.top, "aviso não cobre preço");
      assert.ok(caixas.selo.bottom <= caixas.aviso.top, "aviso não cobre selo");
      assert.ok(caixas.aviso.bottom <= caixas.cta.top, "aviso não cobre CTA");
    } finally { await page.close(); }
    const saida = path.join(process.env.SOCIAL_VISUAL_OUTPUT_DIR || os.tmpdir(), "optimus-social-price-notice-visual.png");
    fs.writeFileSync(saida, png);
    console.log(JSON.stringify({ ok: true, png: saida, bytes: png.length }));
  } finally { await browser.close(); }
})().catch(erro => { console.error(erro); process.exitCode = 1; });
