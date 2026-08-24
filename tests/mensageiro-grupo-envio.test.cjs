const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-mensageiro-grupo-"));
process.env.DATA_DIR = dataDir;

const { writeGlobalJson } = require("../utils/storage");
const storage = require("../modules/mensageiro/storage");
const mensageiro = require("../modules/mensageiro/service");

writeGlobalJson("usuarios.json", [{ id: "cliente_mensageiro", ativo: true }]);

function criarSock({ semKey = false, falharDelete = false } = {}) {
  const envios = [];
  return {
    envios,
    async sendMessage(jid, payload) {
      envios.push({ jid, payload });
      if (payload.delete && falharDelete) {
        throw new Error("delete_falhou");
      }
      if (payload.delete || semKey) return {};
      return { key: { remoteJid: jid, id: `msg_${envios.length}`, fromMe: true } };
    }
  };
}

function configurar(dados = {}) {
  storage.setMensageiroCliente("cliente_mensageiro", {
    ativo: true,
    sessaoId: "sessao_mensageiro",
    sessaoWhatsappId: "sessao_mensageiro",
    sessaoGruposId: "sessao_mensageiro",
    boasVindasAtivo: true,
    despedidaAtivo: true,
    mensagemBoasVindas: "Bem-vindo {numero}",
    mensagemDespedida: "Ate mais {numero}",
    imagemBoasVindas: "",
    imagemDespedida: "",
    grupos: ["grupo_monitorado@g.us"],
    ...dados
  });
}

async function disparar({ action = "add", participante = "5511999999999@s.whatsapp.net", grupo = "grupo_monitorado@g.us", sock = criarSock() } = {}) {
  await mensageiro.tratarEventoGrupoMensageiro({
    clienteId: "cliente_mensageiro",
    sessaoId: "sessao_mensageiro",
    sock,
    evento: { id: grupo, participants: [participante], action }
  });
  return sock;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  configurar();
  let sock = await disparar({ participante: "5511000000001@s.whatsapp.net" });
  assert.strictEqual(sock.envios.length, 1, "config antiga deve enviar no privado");
  assert.strictEqual(sock.envios[0].jid, "5511000000001@s.whatsapp.net", "boas-vindas PV preserva destino privado");
  assert.deepStrictEqual(sock.envios[0].payload, { text: "Bem-vindo 5511000000001" }, "boas-vindas PV preserva payload de texto");

  sock = await disparar({ action: "remove", participante: "5511000000002@s.whatsapp.net" });
  assert.strictEqual(sock.envios[0].jid, "5511000000002@s.whatsapp.net", "despedida PV preserva destino privado");
  assert.deepStrictEqual(sock.envios[0].payload, { text: "Ate mais 5511000000002" }, "despedida PV preserva payload de texto");

  configurar({
    boasVindasEnvio: { destino: "grupo", modoGrupo: "texto", mensagemTemporaria: false, apagarAposSegundos: 20 }
  });
  sock = await disparar({ participante: "5511000000003@s.whatsapp.net", grupo: "grupo_nao_monitorado@g.us" });
  assert.strictEqual(sock.envios.length, 0, "grupo nao monitorado nao deve receber mensagem");

  sock = await disparar({ participante: "5511000000004@s.whatsapp.net" });
  assert.strictEqual(sock.envios.length, 1, "grupo monitorado deve receber mensagem");
  assert.strictEqual(sock.envios[0].jid, "grupo_monitorado@g.us", "modo grupo envia no grupo");
  assert.deepStrictEqual(sock.envios[0].payload, { text: "Bem-vindo 5511000000004" }, "grupo texto deve montar payload correto");

  const imagemBase64 = `data:image/png;base64,${Buffer.from("fake-image").toString("base64")}`;
  configurar({
    imagemBoasVindas: imagemBase64,
    boasVindasEnvio: { destino: "grupo", modoGrupo: "imagem", mensagemTemporaria: false, apagarAposSegundos: 20 }
  });
  sock = await disparar({ participante: "5511000000005@s.whatsapp.net" });
  assert.ok(Buffer.isBuffer(sock.envios[0].payload.image), "grupo imagem deve enviar buffer quando imagem vem em base64");
  assert.ok(!("caption" in sock.envios[0].payload), "grupo somente imagem nao deve enviar caption");

  configurar({
    imagemBoasVindas: imagemBase64,
    boasVindasEnvio: { destino: "grupo", modoGrupo: "imagem_texto", mensagemTemporaria: false, apagarAposSegundos: 20 }
  });
  sock = await disparar({ participante: "5511000000006@s.whatsapp.net" });
  assert.ok(Buffer.isBuffer(sock.envios[0].payload.image), "grupo imagem/texto deve enviar imagem");
  assert.strictEqual(sock.envios[0].payload.caption, "Bem-vindo 5511000000006", "grupo imagem/texto deve enviar caption");
  await sleep(1100);
  assert.strictEqual(sock.envios.length, 1, "temporaria off nao agenda delete");

  configurar({
    boasVindasEnvio: { destino: "grupo", modoGrupo: "texto", mensagemTemporaria: true, apagarAposSegundos: 1 }
  });
  sock = await disparar({ participante: "5511000000007@s.whatsapp.net" });
  await sleep(1100);
  assert.strictEqual(sock.envios.length, 2, "temporaria on deve chamar delete");
  assert.deepStrictEqual(sock.envios[1], {
    jid: "grupo_monitorado@g.us",
    payload: { delete: { remoteJid: "grupo_monitorado@g.us", id: "msg_1", fromMe: true } }
  }, "delete deve usar somente a key da propria mensagem enviada");

  sock = criarSock({ falharDelete: true });
  await disparar({ participante: "5511000000008@s.whatsapp.net", sock });
  await sleep(1100);
  assert.strictEqual(sock.envios.length, 2, "falha de delete nao deve quebrar o listener");

  sock = criarSock({ semKey: true });
  await disparar({ participante: "5511000000009@s.whatsapp.net", sock });
  await sleep(1100);
  assert.strictEqual(sock.envios.length, 1, "sem key retornada nao deve tentar delete nem quebrar");

  const routesFonte = fs.readFileSync(path.join(__dirname, "..", "modules", "mensageiro", "routes.js"), "utf8");
  assert.ok(routesFonte.includes("await otimizarBase64(dados.imagemBoasVindas)"), "imagem de boas-vindas continua passando pela otimizacao atual");
  assert.ok(routesFonte.includes("await otimizarBase64(dados.imagemDespedida)"), "imagem de despedida continua passando pela otimizacao atual");
  assert.ok(routesFonte.includes('router.post("/config"'), "rota de Atendimento permanece separada");

  console.log("mensageiro-grupo-envio.test.cjs OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
