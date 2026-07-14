const { normalizarPayloadRenderer, formatarPrecoBRL, VERSAO_TEMPLATE_VISUAL } = require("./contract");
const { baixarImagemSegura } = require("./image-proxy");
const socialArtStorage = require("./social-art-storage");

let browserPromise = null;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function log(evento = "", dados = {}) {
  console.log(evento, JSON.stringify(dados));
}

function escaparHtml(valor = "") {
  return texto(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imagemDataUri(buffer = Buffer.alloc(0), mimeType = "image/png") {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function posicaoCard(posicao = "bottom-left") {
  const mapa = {
    "bottom-left": "left: 24px; bottom: 24px;",
    "bottom-right": "right: 24px; bottom: 24px;",
    "top-left": "left: 24px; top: 24px;",
    "top-right": "right: 24px; top: 24px;"
  };
  return mapa[posicao] || mapa["bottom-left"];
}

function margemCard(cfg = {}) {
  const top = cfg.faixaSuperiorAtiva && texto(cfg.posicaoCard).startsWith("top") ? "margin-top: 56px;" : "";
  const bottom = cfg.faixaInferiorAtiva && texto(cfg.posicaoCard).startsWith("bottom") ? "margin-bottom: 64px;" : "";
  return `${top}${bottom}`;
}

function htmlPreview({ template = {}, dados = {}, cta = "", imagemSrc = "" } = {}) {
  const precoAntigo = template.mostrarPrecoAntigo && dados.precoAntigo
    ? `<span class="old">De ${escaparHtml(formatarPrecoBRL(dados.precoAntigo))}</span>`
    : "";
  const preco = dados.preco
    ? `<span class="price" style="color:${template.corDestaquePreco}">${escaparHtml(formatarPrecoBRL(dados.preco))}</span>`
    : "";
  const cupom = template.mostrarCupom && dados.cupom
    ? `<span class="coupon" style="background:${template.corDestaquePreco}"><span>🎟️</span><span>${escaparHtml(dados.cupom)}</span></span>`
    : "";
  const marketplace = template.mostrarMarketplace && dados.marketplace
    ? `<span class="market">${escaparHtml(dados.marketplace)}</span>`
    : "";
  const faixaSuperior = template.faixaSuperiorAtiva
    ? `<div class="top-band" style="background:${template.faixaSuperiorCor}">${escaparHtml(template.faixaSuperiorTexto)}</div>`
    : "";
  const faixaInferior = template.faixaInferiorAtiva
    ? `<div class="bottom-band" style="background:${template.corMoldura}"><span>🔥</span><span>${escaparHtml(cta)}</span></div>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  html, body { width: 1080px; height: 1080px; margin: 0; overflow: hidden; background: transparent; font-family: Inter, Arial, Helvetica, sans-serif; }
  .art { position: relative; width: 1080px; height: 1080px; overflow: hidden; background: #eef2f7; border: 8px solid ${template.corMoldura}; }
  .image-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #f1f5f9; }
  .image-wrap img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .top-band { position: absolute; inset: 0 0 auto 0; height: 48px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 22px; font-weight: 800; text-transform: uppercase; letter-spacing: .15em; box-shadow: 0 2px 8px rgba(15, 23, 42, .18); }
  .card { position: absolute; ${posicaoCard(template.posicaoCard)} ${margemCard(template)} max-width: 54%; min-width: 290px; padding: 34px 42px; border-radius: 32px; text-align: center; background: ${template.corCard}; border: 4px solid ${template.corMoldura}; box-shadow: 0 24px 52px rgba(15, 23, 42, .24); }
  .stack { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .old { color: #94a3b8; font-size: 22px; font-weight: 600; line-height: 1; text-decoration: line-through; font-variant-numeric: tabular-nums; }
  .price { font-size: 78px; font-weight: 950; line-height: .95; letter-spacing: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .coupon { margin-top: 8px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 999px; padding: 14px 28px; color: #fff; font-size: 22px; font-weight: 850; line-height: 1; text-transform: uppercase; letter-spacing: .08em; box-shadow: 0 4px 14px rgba(15, 23, 42, .18); }
  .market { margin-top: 7px; color: rgba(100, 116, 139, .85); font-size: 17px; font-weight: 700; line-height: 1; text-transform: uppercase; letter-spacing: .14em; }
  .bottom-band { position: absolute; inset: auto 0 0 0; height: 64px; display: flex; align-items: center; justify-content: center; gap: 14px; color: #fff; font-size: 25px; font-weight: 850; text-transform: uppercase; letter-spacing: .14em; box-shadow: 0 -2px 12px rgba(15, 23, 42, .22); }
</style>
</head>
<body>
  <div class="art">
    <div class="image-wrap"><img src="${imagemSrc}" alt="" /></div>
    ${faixaSuperior}
    <div class="card"><div class="stack">${precoAntigo}${preco}${cupom}${marketplace}</div></div>
    ${faixaInferior}
  </div>
</body>
</html>`;
}

async function obterBrowser() {
  if (!browserPromise) {
    const { chromium } = require("playwright");
    browserPromise = chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"]
    });
  }
  return browserPromise;
}

async function renderizarPng(payloadEntrada = {}, {
  fetchImpl,
  browserFactory = obterBrowser,
  baixarImagem = baixarImagemSegura
} = {}) {
  const payload = normalizarPayloadRenderer(payloadEntrada);
  log("[SOCIAL-ARTE-RENDER-INICIO]", {
    clienteId: payload.clienteIdInterno,
    ofertaId: payload.ofertaId,
    hash: payload.hash.slice(0, 16),
    templateVersao: VERSAO_TEMPLATE_VISUAL
  });

  const imagem = await baixarImagem(payload.dados.imagem, { fetchImpl });
  const browser = await browserFactory();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(htmlPreview({
      template: payload.template,
      dados: payload.dados,
      cta: payload.cta,
      imagemSrc: imagemDataUri(imagem.buffer, imagem.mimeType)
    }), { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      })));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    return await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1080, height: 1080 } });
  } finally {
    await page.close().catch(() => {});
  }
}

async function renderizarSalvar(payloadEntrada = {}, deps = {}) {
  const payload = normalizarPayloadRenderer(payloadEntrada);
  try {
    const png = await renderizarPng(payload, deps);
    const salvo = await (deps.storageSalvar || socialArtStorage.salvar)({
      clienteId: payload.clienteIdInterno,
      ofertaId: payload.ofertaId,
      hash: payload.hash,
      buffer: png,
      mimeType: "image/png"
    });
    log(salvo.cache ? "[SOCIAL-ARTE-RENDER-CACHE]" : "[SOCIAL-ARTE-RENDER-SUCESSO]", {
      clienteId: payload.clienteIdInterno,
      ofertaId: payload.ofertaId,
      hash: payload.hash.slice(0, 16),
      bytes: png.length,
      cache: salvo.cache === true
    });
    return {
      ok: true,
      imagemUrlPublica: salvo.imagemUrlPublica,
      hash: payload.hash,
      templateVersao: VERSAO_TEMPLATE_VISUAL,
      cache: salvo.cache === true
    };
  } catch (erro) {
    log("[SOCIAL-ARTE-RENDER-ERRO]", {
      clienteId: payload.clienteIdInterno,
      ofertaId: payload.ofertaId,
      hash: payload.hash.slice(0, 16),
      erro: texto(erro.message).slice(0, 180)
    });
    throw erro;
  }
}

async function encerrarBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => {});
}

module.exports = {
  htmlPreview,
  renderizarPng,
  renderizarSalvar,
  encerrarBrowser
};
