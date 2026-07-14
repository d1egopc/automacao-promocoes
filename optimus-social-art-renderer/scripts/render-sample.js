const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { hashPayload } = require("../src/contract");
const { renderizarPng, encerrarBrowser } = require("../src/renderer.service");

const SAMPLE_IMAGE_URL = process.env.SAMPLE_IMAGE_URL ||
  "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?fm=jpg&fit=crop&w=1000&q=80";

function dimensoesPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) throw new Error("png_invalido");
  const assinatura = buffer.slice(0, 8).toString("hex");
  if (assinatura !== "89504e470d0a1a0a") throw new Error("png_invalido");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function payloadSample() {
  const base = {
    clienteIdInterno: "local_sample",
    ofertaId: "sample_notebook",
    template: {
      versao: 1,
      faixaSuperiorAtiva: true,
      faixaSuperiorTexto: "OFERTA RELAMPAGO",
      faixaSuperiorCor: "#f97316",
      mostrarPrecoAntigo: true,
      mostrarCupom: true,
      mostrarMarketplace: true,
      faixaInferiorAtiva: true,
      gatilho: "PROMO",
      ctaTemplate: 'COMENTE "{gatilho}"',
      posicaoCard: "bottom-left",
      corMoldura: "#0f172a",
      corCard: "#ffffff",
      corDestaquePreco: "#16a34a"
    },
    dados: {
      titulo: "Notebook Apple MacBook Pro 14",
      precoAntigo: "14999.90",
      preco: "11999.00",
      cupom: "PROMO10",
      marketplace: "amazon",
      imagem: SAMPLE_IMAGE_URL
    },
    cta: 'COMENTE "PROMO"',
    versao: 1
  };

  return {
    ...base,
    hash: hashPayload(base)
  };
}

(async () => {
  const outputDir = path.resolve(__dirname, "..", "output");
  const outputPath = path.join(outputDir, "sample-post.png");
  const inicio = performance.now();

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    const buffer = await renderizarPng(payloadSample());
    fs.writeFileSync(outputPath, buffer);

    const dimensoes = dimensoesPng(buffer);
    if (dimensoes.width !== 1080 || dimensoes.height !== 1080) {
      throw new Error(`dimensoes_invalidas_${dimensoes.width}x${dimensoes.height}`);
    }

    const tempoMs = Math.round(performance.now() - inicio);
    console.log(JSON.stringify({
      ok: true,
      arquivo: outputPath,
      bytes: buffer.length,
      width: dimensoes.width,
      height: dimensoes.height,
      tempoMs,
      imagemFonte: new URL(SAMPLE_IMAGE_URL).hostname,
      storage: "local_test_only"
    }, null, 2));
  } finally {
    await encerrarBrowser();
  }
})().catch(erro => {
  console.error(JSON.stringify({
    ok: false,
    erro: String(erro.message || erro).slice(0, 240)
  }, null, 2));
  process.exit(1);
});
