const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const sharp = require("sharp");
const { enviarDiscord } = require("../modules/discord/discord-sender");

const raiz = path.resolve(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");

assert.ok(indexFonte.includes('"imagem_completa"'), "imagem_completa deve ter caminho explicito");
assert.ok(indexFonte.includes('"imagem_link"'), "imagem_link deve ter caminho explicito");
assert.ok(indexFonte.includes('"texto_link"'), "texto_link deve ter caminho explicito");
assert.ok(indexFonte.includes('linkFinal: linkOfertaDestino.linkFinal || ""'), "Executor deve encaminhar o linkFinal oficial");
assert.ok(indexFonte.includes('"matched-text": url'), "imagem_link deve vincular o card ao linkFinal oficial");
assert.ok(indexFonte.includes('jpegThumbnail'), "imagem_link deve montar thumbnail JPEG manual");
assert.ok(indexFonte.includes('return { text: mensagem, linkPreview: null };'), "texto_link e fallback devem suprimir preview");
assert.ok(indexFonte.includes('link_preview_options: { is_disabled: true }'), "Telegram deve suprimir preview para texto_link");
assert.ok(indexFonte.includes('imagemUrl: imagemEnvioExecutor.ok ? imagemEnvioExecutor.url : ""'), "imagem_completa deve preservar anexo atual");

function carregarHelpersTipoMidia({ baixarImagemComoBuffer, sharp } = {}) {
  const inicio = indexFonte.indexOf("function tipoMidiaDestinoExecutor");
  const fim = indexFonte.indexOf("function montarPayloadTextoTelegramPorTipoMidia", inicio);
  assert.ok(inicio >= 0 && fim > inicio, "helpers de tipo de midia devem existir no Executor");
  const contexto = {
    baixarImagemComoBuffer,
    sharp,
    Buffer,
    normalizarPrecoTextoBR: (valor) => Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    console: { log() {} }
  };
  vm.createContext(contexto);
  vm.runInContext(`${indexFonte.slice(inicio, fim)}; this.helpers = { destinoUsaImagemExecutor, montarPreviewManualWhatsapp, montarPayloadTextoWhatsappPorTipoMidia };`, contexto);
  return contexto.helpers;
}

async function main() {
  const imagensBaixadas = [];
  const imagemOriginal = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 12, g: 34, b: 56 } }
  }).png().toBuffer();
  const helpers = carregarHelpersTipoMidia({
    baixarImagemComoBuffer: async (url) => {
      imagensBaixadas.push(url);
      return imagemOriginal;
    },
    sharp
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
    }
  });
  assert.equal(payloadImagemLink.text, template, "imagem_link nao pode alterar o Template");
  assert.equal(imagensBaixadas[0], "https://images.example/produto.jpg", "imagem_link deve usar somente a imagem ja resolvida da oferta");
  assert.equal(payloadImagemLink.linkPreview["matched-text"], "https://oficial.example/produto", "card deve usar somente linkFinal, nunca o link de cupom");
  assert.equal(payloadImagemLink.linkPreview.title, "Produto oficial");
  assert.equal(payloadImagemLink.linkPreview.description, "Shopee · Por R$ 99,90");
  assert.ok(Buffer.isBuffer(payloadImagemLink.linkPreview.jpegThumbnail), "imagem_link deve produzir thumbnail JPEG Buffer");
  assert.equal(payloadImagemLink.linkPreview.jpegThumbnail.subarray(0, 2).toString("hex"), "ffd8", "thumbnail deve ser JPEG real");

  const helpersComFalha = carregarHelpersTipoMidia({
    baixarImagemComoBuffer: async () => { throw new Error("falha prevista"); },
    sharp
  });
  const payloadFalha = await helpersComFalha.montarPayloadTextoWhatsappPorTipoMidia({
    mensagem: template,
    destino: { tipoMidia: "imagem_link" },
    linkFinal: "https://oficial.example/produto",
    oferta: { titulo: "Produto oficial", marketplace: "Shopee", preco: 99.9, imagem: "https://images.example/produto.jpg" }
  });
  assert.deepEqual(payloadFalha, { text: template, linkPreview: null }, "falha de preview deve manter envio textual seguro");

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
