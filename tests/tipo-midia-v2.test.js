const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { enviarDiscord } = require("../modules/discord/discord-sender");
const tipoMidiaV2 = require("../modules/destinos/tipo-midia-v2");

const raiz = path.resolve(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
const helperFonte = fs.readFileSync(path.join(raiz, "modules", "destinos", "tipo-midia-v2.js"), "utf8");

assert.ok(helperFonte.includes('"imagem_completa"'), "imagem_completa deve ter caminho explicito");
assert.ok(helperFonte.includes('"imagem_link"'), "imagem_link deve ter caminho explicito");
assert.ok(helperFonte.includes('"texto_link"'), "texto_link deve ter caminho explicito");
assert.ok(indexFonte.includes('linkFinal: linkOfertaDestino.linkFinal || ""'), "Executor deve encaminhar o linkFinal oficial");
assert.ok(helperFonte.includes('"matched-text": url'), "imagem_link deve vincular o card ao linkFinal oficial");
assert.ok(helperFonte.includes('jpegThumbnail'), "imagem_link deve montar thumbnail JPEG manual");
assert.ok(helperFonte.includes('width: 800, height: 800'), "imagem_link deve limitar thumbnail HQ a 800px");
assert.ok(helperFonte.includes('mediaTypeOverride: "thumbnail-link"'), "imagem_link deve usar o upload oficial de thumbnail-link");
assert.ok(helperFonte.includes('linkPreview: null'), "texto_link e fallback devem suprimir preview");
assert.ok(helperFonte.includes('link_preview_options: { is_disabled: true }'), "Telegram deve suprimir preview para texto_link");
assert.ok(indexFonte.includes('imagemUrl: imagemEnvioExecutor.ok ? imagemEnvioExecutor.url : ""'), "imagem_completa deve preservar anexo atual");

function carregarHelpersTipoMidia({ baixarImagemComoBuffer, sharp, prepareWAMessageMedia, logs = [] } = {}) {
  const logger = { log(...args) { logs.push(args); } };
  return {
    destinoUsaImagemExecutor: tipoMidiaV2.destinoUsaImagem,
    montarPreviewManualWhatsapp: (entrada) => tipoMidiaV2.montarPreviewWhatsapp({ ...entrada, baixarImagem: baixarImagemComoBuffer, prepareWAMessageMedia, logger }),
    montarPayloadTextoWhatsappPorTipoMidia: (entrada) => tipoMidiaV2.montarPayloadTextoWhatsappPorTipoMidia({ ...entrada, baixarImagem: baixarImagemComoBuffer, prepareWAMessageMedia, logger })
  };
}

async function main() {
  const imagensBaixadas = [];
  const uploadsHq = [];
  const upload = async () => ({});
  const imagemOriginal = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 12, g: 34, b: 56 } }
  }).png().toBuffer();
  const logsHq = [];
  const helpers = carregarHelpersTipoMidia({
    baixarImagemComoBuffer: async (url) => {
      imagensBaixadas.push(url);
      return imagemOriginal;
    },
    sharp,
    prepareWAMessageMedia: async ({ image }, opcoes) => {
      uploadsHq.push({ image, opcoes });
      return {
        imageMessage: {
          directPath: "/mms/thumbnail-link",
          mediaKey: Buffer.alloc(32, 1),
          mediaKeyTimestamp: 123,
          width: 800,
          height: 800,
          fileSha256: Buffer.alloc(32, 2),
          fileEncSha256: Buffer.alloc(32, 3)
        }
      };
    },
    logs: logsHq
  });
  assert.equal(helpers.destinoUsaImagemExecutor({}), true, "legado ausente deve continuar com imagem");
  assert.equal(helpers.destinoUsaImagemExecutor({ tipoMidia: "imagem" }), true, "legado imagem deve continuar com imagem");
  assert.equal(helpers.destinoUsaImagemExecutor({ tipoMidia: "link" }), true, "legado link deve continuar com imagem");
  assert.equal(helpers.destinoUsaImagemExecutor({ tipoMidia: "texto" }), false, "legado texto deve continuar textual");
  assert.equal(helpers.destinoUsaImagemExecutor({ tipoMidia: "imagem_completa" }), true, "imagem_completa deve anexar imagem");

  const template = "Cupom: TESTE\\nhttps://auxiliar.example/cupom\\nhttps://oficial.example/produto";
  const payloadImagemLink = await helpers.montarPayloadTextoWhatsappPorTipoMidia({
    mensagem: template,
    destino: { tipoMidia: "imagem_link" },
    linkFinal: "https://oficial.example/produto",
    oferta: {
      titulo: "Produto oficial",
      marketplace: "Shopee",
      preco: 99.9,
      imagem: "https://images.example/produto.jpg"
    },
    upload
  });
  assert.equal(payloadImagemLink.text, template, "imagem_link nao pode alterar o Template");
  assert.equal(imagensBaixadas[0], "https://images.example/produto.jpg", "imagem_link deve usar somente a imagem ja resolvida da oferta");
  assert.equal(payloadImagemLink.linkPreview["matched-text"], "https://oficial.example/produto", "card deve usar somente linkFinal, nunca o link de cupom");
  assert.equal(payloadImagemLink.linkPreview.title, "Produto oficial");
  assert.equal(payloadImagemLink.linkPreview.description, "Shopee · Por R$ 99,90");
  assert.ok(Buffer.isBuffer(payloadImagemLink.linkPreview.jpegThumbnail), "imagem_link deve produzir thumbnail JPEG Buffer");
  assert.equal(payloadImagemLink.linkPreview.jpegThumbnail.subarray(0, 2).toString("hex"), "ffd8", "thumbnail deve ser JPEG real");
  assert.equal(uploadsHq.length, 1, "imagem_link deve preparar thumbnail HQ uma unica vez");
  assert.ok(Buffer.isBuffer(uploadsHq[0].image), "HQ deve reutilizar buffer da imagem sem novo download");
  assert.equal(uploadsHq[0].opcoes.upload, upload, "HQ deve usar upload autenticado da sessao WhatsApp");
  assert.equal(uploadsHq[0].opcoes.mediaTypeOverride, "thumbnail-link");
  assert.equal(payloadImagemLink.linkPreview.highQualityThumbnail.directPath, "/mms/thumbnail-link");
  assert.ok(Buffer.isBuffer(payloadImagemLink.linkPreview.highQualityThumbnail.mediaKey));
  assert.ok(Buffer.isBuffer(payloadImagemLink.linkPreview.jpegThumbnail));
  assert.equal(logsHq.some(([tag, contexto]) => tag === "[EXECUTOR-LINK-PREVIEW-HQ]" && contexto.hqTentado && contexto.hqAnexado), true);
  assert.equal(JSON.stringify(logsHq).includes("oficial.example"), false, "telemetria HQ nao pode expor linkFinal");
  assert.equal(JSON.stringify(logsHq).includes(template), false, "telemetria HQ nao pode expor Template");

  const helpersComFalha = carregarHelpersTipoMidia({
    baixarImagemComoBuffer: async () => { throw new Error("falha prevista"); },
    sharp,
    prepareWAMessageMedia: async () => ({})
  });
  const payloadFalha = await helpersComFalha.montarPayloadTextoWhatsappPorTipoMidia({
    mensagem: template,
    destino: { tipoMidia: "imagem_link" },
    linkFinal: "https://oficial.example/produto",
    oferta: { titulo: "Produto oficial", marketplace: "Shopee", preco: 99.9, imagem: "https://images.example/produto.jpg" }
  });
  assert.deepEqual(payloadFalha, { text: template, linkPreview: null }, "falha de preview deve manter envio textual seguro");

  const logsFalhaHq = [];
  const helpersComFalhaHq = carregarHelpersTipoMidia({
    baixarImagemComoBuffer: async () => imagemOriginal,
    sharp,
    prepareWAMessageMedia: async () => { throw new Error("falha upload hq"); },
    logs: logsFalhaHq
  });
  const payloadFalhaHq = await helpersComFalhaHq.montarPayloadTextoWhatsappPorTipoMidia({
    mensagem: template,
    destino: { tipoMidia: "imagem_link" },
    linkFinal: "https://oficial.example/produto",
    oferta: { titulo: "Produto oficial", marketplace: "Shopee", preco: 99.9, imagem: "https://images.example/produto.jpg" },
    upload
  });
  assert.ok(payloadFalhaHq.linkPreview.jpegThumbnail, "falha HQ deve preservar preview JPEG atual");
  assert.equal(payloadFalhaHq.linkPreview.highQualityThumbnail, undefined, "falha HQ nao pode impedir envio");
  assert.equal(logsFalhaHq.some(([tag, contexto]) => tag === "[EXECUTOR-LINK-PREVIEW-HQ-FALLBACK]" && contexto.motivoFallback === "hq_upload_erro"), true);
  assert.equal(logsFalhaHq.some(([tag, contexto]) => tag === "[EXECUTOR-LINK-PREVIEW-HQ]" && contexto.hqTentado && !contexto.hqAnexado && contexto.motivoFallback === "hq_upload_erro"), true);

  for (const campoAusente of ["directPath", "mediaKey"]) {
    const logsRetornoIncompleto = [];
    const helpersComRetornoIncompleto = carregarHelpersTipoMidia({
      baixarImagemComoBuffer: async () => imagemOriginal,
      sharp,
      prepareWAMessageMedia: async () => {
        const imageMessage = {
          directPath: "/mms/thumbnail-link",
          mediaKey: Buffer.alloc(32, 1),
          mediaKeyTimestamp: 123,
          width: 800,
          height: 800,
          fileSha256: Buffer.alloc(32, 2),
          fileEncSha256: Buffer.alloc(32, 3)
        };
        delete imageMessage[campoAusente];
        return { imageMessage };
      },
      logs: logsRetornoIncompleto
    });
    const payloadRetornoIncompleto = await helpersComRetornoIncompleto.montarPayloadTextoWhatsappPorTipoMidia({
      mensagem: template,
      destino: { tipoMidia: "imagem_link" },
      linkFinal: "https://oficial.example/produto",
      oferta: { titulo: "Produto oficial", marketplace: "Shopee", preco: 99.9, imagem: "https://images.example/produto.jpg" },
      upload
    });
    assert.ok(Buffer.isBuffer(payloadRetornoIncompleto.linkPreview.jpegThumbnail));
    assert.equal(payloadRetornoIncompleto.linkPreview.highQualityThumbnail, undefined);
    assert.equal(logsRetornoIncompleto.some(([tag, contexto]) => tag === "[EXECUTOR-LINK-PREVIEW-HQ-FALLBACK]" && contexto.motivoFallback === "hq_retorno_incompleto"), true);
    assert.equal(logsRetornoIncompleto.some(([tag, contexto]) => tag === "[EXECUTOR-LINK-PREVIEW-HQ]" && contexto.hqTentado && !contexto.hqAnexado && contexto.motivoFallback === "hq_retorno_incompleto" && contexto.camposHq[campoAusente] === false), true);
  }

  const payloadTextoLink = await helpers.montarPayloadTextoWhatsappPorTipoMidia({
    mensagem: template,
    destino: { tipoMidia: "texto_link" },
    linkFinal: "https://oficial.example/produto"
  });
  assert.deepEqual(payloadTextoLink, { text: template, linkPreview: null }, "texto_link deve suprimir preview sem remover URLs");

  const payloadTextoLegado = await helpers.montarPayloadTextoWhatsappPorTipoMidia({
    mensagem: template,
    destino: { tipoMidia: "texto" },
    linkFinal: "https://oficial.example/produto"
  });
  assert.deepEqual(payloadTextoLegado, { text: template }, "texto legado deve preservar preview automatico atual");

  const { generateWAMessageContent } = await import("@whiskeysockets/baileys/lib/Utils/messages.js");
  const previewOficial = payloadImagemLink.linkPreview;
  const opcoes = {
    logger: { debug() {}, warn() {}, error() {} },
    getUrlInfo: async () => { throw new Error("nao deve buscar outra URL"); },
    upload: async () => ({})
  };
  const rico = await generateWAMessageContent({ text: template, linkPreview: previewOficial }, opcoes);
  assert.equal(rico.extendedTextMessage.text, template, "imagem_link nao pode alterar o Template");
  assert.equal(rico.extendedTextMessage.matchedText, previewOficial["matched-text"], "preview deve apontar ao linkFinal oficial");
  assert.equal(rico.extendedTextMessage.thumbnailDirectPath, "/mms/thumbnail-link", "Baileys deve serializar o thumbnail HQ");
  assert.equal(rico.extendedTextMessage.thumbnailWidth, 800);
  assert.equal(rico.extendedTextMessage.thumbnailHeight, 800);
  assert.ok(Buffer.isBuffer(rico.extendedTextMessage.thumbnailSha256));
  assert.ok(Buffer.isBuffer(rico.extendedTextMessage.thumbnailEncSha256));

  const semPreview = await generateWAMessageContent({ text: template, linkPreview: null }, opcoes);
  assert.equal(semPreview.extendedTextMessage.text, template, "texto_link nao pode alterar o Template");
  assert.equal(semPreview.extendedTextMessage.matchedText, undefined, "texto_link nao pode criar card");

  const chamadas = [];
  const resultadoDiscord = await enviarDiscord({
    channelId: "canal",
    mensagem: template,
    suprimirEmbeds: true,
    config: { botToken: "token", imageAllowedHosts: "" },
    httpClient: { post: async (_url, body) => { chamadas.push(body); return { status: 200, data: { id: "msg", channel_id: "canal" } }; } }
  });
  assert.equal(resultadoDiscord.ok, true);
  assert.equal(chamadas[0].content, template, "Discord nao pode alterar o Template");
  assert.equal(chamadas[0].flags, 4, "texto_link deve suprimir embed no Discord");
  console.log("OK tipo-midia-v2");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
