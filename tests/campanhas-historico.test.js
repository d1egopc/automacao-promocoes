const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-campanhas-historico-"));
process.env.DATA_DIR = dataDir;

const { salvarMidiaTemporaria, obterMidiaTemporaria } = require("../campanhas/midiaTemporaria");
const {
  listarHistoricoCampanhas,
  obterCampanhaHistorico,
  ARQUIVO_HISTORICO
} = require("../campanhas/historicoCampanhas");
const { enviarCampanhaManual } = require("../campanhas/enviarCampanha");

function png() {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
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

function contexto() {
  const sock = criarSock();
  const http = { chamadas: [], async post(url, body) { this.chamadas.push({ url, body }); return { data: { ok: true } }; } };
  const debitos = [];
  return {
    sock,
    http,
    debitos,
    args: {
      clienteId: "cliente_hist",
      mensagem: "Mensagem da campanha",
      destinosIds: ["wa", "tg"],
      destinosPorCliente: {
        cliente_hist: {
          lista: [
            { id: "wa", tipo: "whatsapp", nome: "Destino WhatsApp", conexaoId: "sessao_hist", gruposWhatsapp: ["grupo_hist"] },
            { id: "tg", tipo: "telegram", nome: "Destino Telegram", telegramDestinos: [{ botToken: "token_hist", chatId: "chat_hist" }] }
          ]
        }
      },
      sessoes: { sessao_hist: sock },
      configsPorCliente: { cliente_hist: { telegram: { destinos: [] } } },
      usuarioTemCreditos: () => true,
      debitarCreditos: (clienteId, qtd) => debitos.push({ clienteId, qtd }),
      corrigirImagemUrl: url => url,
      httpClient: http,
      esperaMsTelegram: 0,
      esperaMsWhatsApp: 0
    }
  };
}

(async () => {
  const midia = salvarMidiaTemporaria({
    clienteId: "cliente_hist",
    buffer: png(),
    nomeOriginal: "arte-campanha.png",
    mimeType: "image/png",
    tipo: "imagem"
  });

  const ctx = contexto();
  const resultado = await enviarCampanhaManual({ ...ctx.args, midiaId: midia.midiaId });

  assert.strictEqual(resultado.enviados, 2);
  assert.strictEqual(resultado.erros, 0);
  assert.ok(resultado.campanhaId, "resultado deve retornar campanhaId sem quebrar contrato antigo");
  assert.strictEqual(resultado.status, "enviada");
  assert.throws(() => obterMidiaTemporaria("cliente_hist", midia.midiaId), /campanhas_midia_nao_encontrada/, "arquivo temporario deve ser removido apos envio");

  const historico = listarHistoricoCampanhas("cliente_hist");
  assert.strictEqual(historico.length, 1);
  const registro = historico[0];
  assert.strictEqual(registro.campanhaId, resultado.campanhaId);
  assert.strictEqual(registro.clienteId, "cliente_hist");
  assert.strictEqual(registro.tipo, "imagem");
  assert.strictEqual(registro.mensagem, "Mensagem da campanha");
  assert.strictEqual(registro.legenda, "Mensagem da campanha");
  assert.strictEqual(registro.nomeOriginal, "arte-campanha.png");
  assert.strictEqual(registro.mimeType, "image/png");
  assert.strictEqual(registro.bytes, 72);
  assert.strictEqual(registro.enviados, 2);
  assert.strictEqual(registro.erros, 0);
  assert.strictEqual(registro.status, "enviada");
  assert.ok(registro.criadoEm);
  assert.ok(registro.iniciadoEm);
  assert.ok(registro.concluidoEm);
  assert.strictEqual(registro.destinos.length, 2);
  assert.strictEqual(registro.destinos[0].nome, "Destino WhatsApp");
  assert.strictEqual(registro.destinos[0].gruposWhatsappQuantidade, 1);
  assert.strictEqual(registro.destinos[1].nome, "Destino Telegram");
  assert.strictEqual(registro.destinos[1].telegramDestinosQuantidade, 1);
  assert.ok(!Object.prototype.hasOwnProperty.call(registro, "buffer"), "historico nao pode armazenar binario");
  assert.ok(!Object.prototype.hasOwnProperty.call(registro, "caminho"), "historico nao pode expor caminho fisico");

  const item = obterCampanhaHistorico("cliente_hist", resultado.campanhaId);
  assert.strictEqual(item.campanhaId, resultado.campanhaId);
  assert.strictEqual(listarHistoricoCampanhas("cliente_outro").length, 0, "historico nao pode vazar entre clientes");
  assert.strictEqual(ARQUIVO_HISTORICO, "campanhas-historico.json");

  console.log("campanhas-historico.test.js OK");
})();