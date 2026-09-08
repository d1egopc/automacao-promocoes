const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { enviarDiscord } = require("../modules/discord/discord-sender");

const raiz = path.resolve(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");

assert.ok(indexFonte.includes('"imagem_completa"'), "imagem_completa deve ter caminho explicito");
assert.ok(indexFonte.includes('"imagem_link"'), "imagem_link deve ter caminho explicito");
assert.ok(indexFonte.includes('"texto_link"'), "texto_link deve ter caminho explicito");
assert.ok(indexFonte.includes('linkFinal: linkOfertaDestino.linkFinal || ""'), "Executor deve encaminhar o linkFinal oficial");
assert.ok(indexFonte.includes('await getUrlInfo(linkFinal)'), "imagem_link deve gerar preview pelo linkFinal");
assert.ok(indexFonte.includes('return { text: mensagem, linkPreview: null };'), "texto_link e fallback devem suprimir preview");
assert.ok(indexFonte.includes('link_preview_options: { is_disabled: true }'), "Telegram deve suprimir preview para texto_link");
assert.ok(indexFonte.includes('imagemUrl: imagemEnvioExecutor.ok ? imagemEnvioExecutor.url : ""'), "imagem_completa deve preservar anexo atual");

function carregarHelpersTipoMidia(getUrlInfo) {
  const inicio = indexFonte.indexOf("function tipoMidiaDestinoExecutor");
  const fim = indexFonte.indexOf("function montarPayloadTextoTelegramPorTipoMidia", inicio);
  assert.ok(inicio >= 0 && fim > inicio, "helpers de tipo de midia devem existir no Executor");
  const contexto = { getUrlInfo, console: { log() {} } };
  vm.createContext(contexto);
  vm.runInContext(`${indexFonte.slice(inicio, fim)}; this.helpers = { destinoUsaImagemExecutor, montarPayloadTextoWhatsappPorTipoMidia };`, contexto);
  return contexto.helpers;
}

async function main() {
  const chamadasPreview = [];
  const helpers = carregarHelpersTipoMidia(async (url) => {
    chamadasPreview.push(url);
    return { "matched-text": url, title: "Produto oficial" };
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
    linkFinal: "https://oficial.example/produto"
  });
  assert.equal(payloadImagemLink.text, template, "imagem_link nao pode alterar o Template");
  assert.equal(chamadasPreview[0], "https://oficial.example/produto", "imagem_link deve consultar somente linkFinal");
  assert.equal(payloadImagemLink.linkPreview["matched-text"], "https://oficial.example/produto");

  const helpersComFalha = carregarHelpersTipoMidia(async () => { throw new Error("falha prevista"); });
  const payloadFalha = await helpersComFalha.montarPayloadTextoWhatsappPorTipoMidia({
    mensagem: template,
    destino: { tipoMidia: "imagem_link" },
    linkFinal: "https://oficial.example/produto"
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
  const previewOficial = {
    "matched-text": "https://oficial.example/produto",
    title: "Produto oficial",
    description: "Card oficial"
  };
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
