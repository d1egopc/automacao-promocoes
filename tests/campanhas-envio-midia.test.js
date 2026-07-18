const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-campanhas-envio-"));
process.env.DATA_DIR = dataDir;
process.env.CAMPANHAS_MEDIA_ORFA_TTL_MS = "1000";

const { readClienteJson, writeClienteJson } = require("../utils/storage");
const {
  salvarMidiaTemporaria,
  obterMidiaTemporaria,
  marcarMidiaEmUso,
  excluirMidiaTemporaria
} = require("../campanhas/midiaTemporaria");
const { enviarCampanhaManual } = require("../campanhas/enviarCampanha");

function png() {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
}

function mp4() {
  return Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42", "ascii"), Buffer.alloc(64, 2)]);
}

function pdf() {
  return Buffer.concat([Buffer.from("%PDF-1.4\n", "ascii"), Buffer.alloc(64, 3)]);
}

function criarSock() {
  const chamadas = [];
  return {
    chamadas,
    async sendMessage(grupo, msg) {
      chamadas.push({ grupo, msg });
      return { ok: true };
    }
  };
}

function criarHttp() {
  const chamadas = [];
  return {
    chamadas,
    async post(url, body, config) {
      chamadas.push({ url, body, config });
      return { data: { ok: true } };
    }
  };
}

function contexto({ sock = criarSock(), http = criarHttp(), creditos = true } = {}) {
  const debitos = [];
  return {
    sock,
    http,
    debitos,
    args: {
      clienteId: "cliente_a",
      mensagem: "Campanha oficial",
      destinosIds: ["wa", "tg"],
      destinosPorCliente: {
        cliente_a: {
          lista: [
            { id: "wa", tipo: "whatsapp", nome: "WhatsApp", conexaoId: "sessao_a", gruposWhatsapp: ["grupo_a"] },
            { id: "tg", tipo: "telegram", nome: "Telegram", telegramDestinos: [{ botToken: "token_tg", chatId: "chat_a" }] }
          ]
        }
      },
      sessoes: { sessao_a: sock },
      configsPorCliente: { cliente_a: { telegram: { destinos: [] } } },
      usuarioTemCreditos: () => creditos,
      debitarCreditos: (clienteId, qtd) => debitos.push({ clienteId, qtd }),
      corrigirImagemUrl: url => url,
      httpClient: http,
      esperaMsTelegram: 0,
      esperaMsWhatsApp: 0
    }
  };
}

async function publicar(extra = {}, opcoes = {}) {
  const ctx = contexto(opcoes);
  const resultado = await enviarCampanhaManual({ ...ctx.args, ...extra });
  return { ...ctx, resultado };
}

(async () => {
  const texto = await publicar({ destinosIds: ["wa"] });
  assert.strictEqual(texto.resultado.enviados, 1, "texto deve enviar via WhatsApp");
  assert.strictEqual(texto.sock.chamadas[0].msg.text, "Campanha oficial");

  const antiga = await publicar({ imagemUrl: "https://cdn.optimus.test/arte.jpg" });
  assert.strictEqual(antiga.resultado.enviados, 2, "imagemUrl antiga deve continuar funcionando");
  assert.strictEqual(antiga.sock.chamadas[0].msg.image.url, "https://cdn.optimus.test/arte.jpg");
  assert.ok(antiga.http.chamadas.some(call => call.url.includes("/sendPhoto")), "Telegram deve usar sendPhoto para imagemUrl");

  const imagem = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: png(), nomeOriginal: "arte.png", mimeType: "image/png", tipo: "imagem" });
  const envioImagem = await publicar({ midiaId: imagem.midiaId, imagemUrl: "https://cdn.optimus.test/ignorar.jpg" });
  assert.strictEqual(envioImagem.resultado.enviados, 2, "imagem via midiaId deve enviar WhatsApp e Telegram");
  assert.ok(Buffer.isBuffer(envioImagem.sock.chamadas[0].msg.image), "WhatsApp deve receber buffer de imagem do midiaId");
  assert.ok(envioImagem.http.chamadas.some(call => call.url.includes("/sendPhoto")), "Telegram deve usar sendPhoto para imagem via midiaId");
  assert.throws(() => obterMidiaTemporaria("cliente_a", imagem.midiaId), /campanhas_midia_nao_encontrada/, "midiaId deve ser removido apos envio definitivo");

  const video = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: mp4(), nomeOriginal: "video.mp4", mimeType: "video/mp4", tipo: "video" });
  const envioVideo = await publicar({ midiaId: video.midiaId });
  assert.ok(Buffer.isBuffer(envioVideo.sock.chamadas[0].msg.video), "WhatsApp deve receber buffer de video");
  assert.ok(envioVideo.http.chamadas.some(call => call.url.includes("/sendVideo")), "Telegram deve usar sendVideo");

  const documento = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: pdf(), nomeOriginal: "regulamento.pdf", mimeType: "application/pdf", tipo: "documento" });
  const envioDocumento = await publicar({ midiaId: documento.midiaId });
  assert.ok(Buffer.isBuffer(envioDocumento.sock.chamadas[0].msg.document), "WhatsApp deve receber buffer de documento");
  assert.strictEqual(envioDocumento.sock.chamadas[0].msg.fileName, "regulamento.pdf");
  assert.ok(envioDocumento.http.chamadas.some(call => call.url.includes("/sendDocument")), "Telegram deve usar sendDocument");

  await assert.rejects(
    () => publicar({ midiaId: "midia_inexistente" }),
    /campanhas_midia_nao_encontrada/,
    "midiaId inexistente deve falhar antes do envio"
  );

  const midiaOutroCliente = salvarMidiaTemporaria({ clienteId: "cliente_b", buffer: png(), nomeOriginal: "outra.png", mimeType: "image/png", tipo: "imagem" });
  await assert.rejects(
    () => publicar({ midiaId: midiaOutroCliente.midiaId }),
    /campanhas_midia_nao_encontrada/,
    "cliente nao pode usar midia de outro cliente"
  );

  const incompatível = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: png(), nomeOriginal: "audio.png", mimeType: "image/png", tipo: "imagem" });
  const indice = readClienteJson("cliente_a", "campanhas-midia-temp.json", []);
  writeClienteJson("cliente_a", "campanhas-midia-temp.json", indice.map(item => item.id === incompatível.midiaId ? { ...item, tipo: "audio" } : item));
  await assert.rejects(
    () => publicar({ midiaId: incompatível.midiaId }),
    /campanhas_midia_tipo_incompativel/,
    "tipo incompatível deve ser rejeitado"
  );
  assert.strictEqual(obterMidiaTemporaria("cliente_a", incompatível.midiaId).status, "associada", "falha antes do envio deve preservar arquivo");
  excluirMidiaTemporaria("cliente_a", incompatível.midiaId, { forcar: true });

  const concorrente = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: png(), nomeOriginal: "concorrente.png", mimeType: "image/png", tipo: "imagem" });
  marcarMidiaEmUso({ clienteId: "cliente_a", midiaId: concorrente.midiaId });
  await assert.rejects(
    () => publicar({ midiaId: concorrente.midiaId }),
    /campanhas_midia_em_processamento/,
    "mesmo midiaId em processamento nao deve iniciar outra execucao"
  );
  excluirMidiaTemporaria("cliente_a", concorrente.midiaId, { forcar: true });

  const preservada = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: png(), nomeOriginal: "preservada.png", mimeType: "image/png", tipo: "imagem" });
  await assert.rejects(
    () => publicar({ midiaId: preservada.midiaId, destinosIds: [] }),
    /Nenhum destino selecionado/,
    "falha antes de iniciar envio deve rejeitar"
  );
  assert.strictEqual(obterMidiaTemporaria("cliente_a", preservada.midiaId).status, "temporaria", "falha antes do envio deve preservar midia solta");

  console.log("campanhas-envio-midia.test.js OK");
})();