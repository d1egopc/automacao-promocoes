const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-mensageiro-bot-"));
process.env.DATA_DIR = dataDir;

const { writeGlobalJson } = require("../utils/storage");
const storage = require("../modules/mensageiro/storage");
const mensageiro = require("../modules/mensageiro/service");

writeGlobalJson("usuarios.json", [{ id: "cliente_bot", ativo: true }]);

function criarSock({ falharMencao = false } = {}) {
  const envios = [];
  return {
    envios,
    async sendMessage(jid, payload) {
      envios.push({ jid, payload });
      if (falharMencao && payload?.mentions?.length) {
        throw new Error("mencao_falhou");
      }
      return { key: { remoteJid: jid, id: `cmd_${envios.length}`, fromMe: true } };
    }
  };
}

function configurar(comandos, extras = {}) {
  storage.setMensageiroCliente("cliente_bot", {
    ativo: true,
    sessaoId: "sessao_bot",
    sessaoWhatsappId: "sessao_bot",
    sessaoGruposId: "sessao_bot",
    grupos: ["grupo_1@g.us", "grupo_2@g.us"],
    comandos,
    ...extras
  });
}

async function disparar({ texto = "!pix", grupo = "grupo_1@g.us", participante = "5511999999999@s.whatsapp.net", fromMe = false, id = "msg_1", sock = criarSock() } = {}) {
  await mensageiro.tratarMensagemGrupoComando({
    clienteId: "cliente_bot",
    sessaoId: "sessao_bot",
    sock,
    planoLiberado: true,
    mensagem: {
      key: {
        remoteJid: grupo,
        participant: participante,
        fromMe,
        id
      },
      pushName: "Joao",
      message: { conversation: texto }
    }
  });
  return sock;
}

const comandoPix = {
  id: "cmd_pix",
  ativo: true,
  nome: "Pix",
  gatilhos: ["!pix", "pix"],
  correspondencia: "exato",
  grupos: [],
  mencionarAutor: false,
  resposta: { tipo: "texto", texto: "Chave PIX", imagem: "" },
  cooldownSegundos: 5,
  cooldownParticipanteSegundos: 5
};

(async () => {
  configurar([comandoPix]);

  let sock = await disparar({ grupo: "5511999999999@s.whatsapp.net" });
  assert.strictEqual(sock.envios.length, 0, "privado nao dispara Bot");

  sock = await disparar({ fromMe: true });
  assert.strictEqual(sock.envios.length, 0, "fromMe nao dispara Bot");

  sock = await disparar({ grupo: "grupo_nao_monitorado@g.us" });
  assert.strictEqual(sock.envios.length, 0, "grupo nao monitorado nao dispara");

  configurar([{ ...comandoPix, ativo: false }]);
  sock = await disparar({ id: "msg_desativado" });
  assert.strictEqual(sock.envios.length, 0, "comando desativado nao dispara");

  configurar([comandoPix]);
  sock = await disparar({ texto: "!pix", id: "msg_exato" });
  assert.strictEqual(sock.envios.length, 1, "gatilho exato funciona");
  assert.deepStrictEqual(sock.envios[0], {
    jid: "grupo_1@g.us",
    payload: { text: "Chave PIX" }
  }, "resposta texto fica no mesmo grupo");

  configurar([{ ...comandoPix, id: "cmd_cupom", gatilhos: ["!cupom"], correspondencia: "inicia", resposta: { tipo: "texto", texto: "Cupons do dia", imagem: "" } }]);
  sock = await disparar({ texto: "!cupom amazon", id: "msg_inicia" });
  assert.strictEqual(sock.envios.length, 1, "inicia funciona");

  sock = await disparar({ texto: "!cupomamazon", id: "msg_falso_positivo" });
  assert.strictEqual(sock.envios.length, 0, "inicia nao aceita palavra grudada");

  sock = await disparar({ texto: "qualquer coisa", id: "msg_random" });
  assert.strictEqual(sock.envios.length, 0, "texto aleatorio nao dispara");

  configurar([{ ...comandoPix, id: "cmd_cooldown_grupo", cooldownSegundos: 60, cooldownParticipanteSegundos: 5 }]);
  sock = criarSock();
  await disparar({ id: "msg_cg_1", participante: "5511000000001@s.whatsapp.net", sock });
  await disparar({ id: "msg_cg_2", participante: "5511000000002@s.whatsapp.net", sock });
  assert.strictEqual(sock.envios.length, 1, "cooldown grupo bloqueia segundo envio no mesmo grupo");

  configurar([{ ...comandoPix, id: "cmd_cooldown_participante", cooldownSegundos: 5, cooldownParticipanteSegundos: 60 }]);
  sock = criarSock();
  await disparar({ id: "msg_cp_1", participante: "5511000000003@s.whatsapp.net", grupo: "grupo_1@g.us", sock });
  await disparar({ id: "msg_cp_2", participante: "5511000000003@s.whatsapp.net", grupo: "grupo_2@g.us", sock });
  assert.strictEqual(sock.envios.length, 1, "cooldown participante bloqueia mesmo autor");

  configurar([{ ...comandoPix, id: "cmd_dedupe" }]);
  sock = criarSock();
  await disparar({ id: "msg_duplicada", sock });
  await disparar({ id: "msg_duplicada", sock });
  assert.strictEqual(sock.envios.length, 1, "mesma messageId nao responde duas vezes");

  configurar([{ ...comandoPix, id: "cmd_img", resposta: { tipo: "imagem", texto: "", imagem: "https://cdn.exemplo/pix.jpg" } }]);
  sock = await disparar({ id: "msg_img" });
  assert.deepStrictEqual(sock.envios[0].payload, { image: { url: "https://cdn.exemplo/pix.jpg" } }, "resposta imagem");

  const imagemBase64 = `data:image/png;base64,${Buffer.from("fake").toString("base64")}`;
  configurar([{ ...comandoPix, id: "cmd_img_texto", resposta: { tipo: "imagem_texto", texto: "Setup", imagem: imagemBase64 } }]);
  sock = await disparar({ texto: "pix", id: "msg_img_texto" });
  assert.ok(Buffer.isBuffer(sock.envios[0].payload.image), "imagem base64 vira buffer");
  assert.strictEqual(sock.envios[0].payload.caption, "Setup", "imagem + texto usa caption");

  configurar([{ ...comandoPix, id: "cmd_mencao", mencionarAutor: true, resposta: { tipo: "texto", texto: "segue", imagem: "" } }]);
  sock = await disparar({ id: "msg_mencao", participante: "5511888888888@s.whatsapp.net" });
  assert.deepStrictEqual(sock.envios[0].payload, {
    text: "@5511888888888 segue",
    mentions: ["5511888888888@s.whatsapp.net"]
  }, "mencao correta");

  configurar([{ ...comandoPix, id: "cmd_mencao_falha", mencionarAutor: true, resposta: { tipo: "texto", texto: "segue", imagem: "" } }]);
  sock = criarSock({ falharMencao: true });
  await disparar({ id: "msg_mencao_falha", participante: "5511777777777@s.whatsapp.net", sock });
  assert.strictEqual(sock.envios.length, 2, "falha de mencao tenta novamente sem quebrar");
  assert.deepStrictEqual(sock.envios[1].payload, { text: "segue" }, "falha de mencao envia resposta sem mentions");

  configurar([{ ...comandoPix, id: "cmd_erro", resposta: { tipo: "texto", texto: "erro", imagem: "" } }]);
  const sockErro = {
    async sendMessage() {
      throw new Error("envio_falhou");
    }
  };
  await disparar({ id: "msg_erro_bot", sock: sockErro });

  const configPersistida = storage.getMensageiroCliente("cliente_bot");
  assert.ok(configPersistida.comandos.some((cmd) => cmd.id === "cmd_erro"), "config persiste e recarrega comandos");

  const historicoConfig = storage.getAtendimentoConfigCliente("cliente_bot");
  assert.ok(historicoConfig.historico.some((evento) => evento.tipo === "comando" && evento.status === "enviado"), "historico registra comando");

  storage.setMensageiroCliente("cliente_bot", {
    ativo: true,
    sessaoId: "sessao_bot",
    sessaoWhatsappId: "sessao_bot",
    sessaoGruposId: "sessao_bot",
    boasVindasAtivo: true,
    despedidaAtivo: true,
    boasVindasEnvio: { destino: "grupo", modoGrupo: "texto", mensagemTemporaria: false, apagarAposSegundos: 20 },
    despedidaEnvio: { destino: "privado", modoGrupo: "imagem_texto", mensagemTemporaria: false, apagarAposSegundos: 20 },
    mensagemBoasVindas: "Bem-vindo {numero}",
    mensagemDespedida: "Ate mais {numero}",
    grupos: ["grupo_1@g.us"],
    comandos: []
  });
  sock = criarSock();
  await mensageiro.tratarEventoGrupoMensageiro({
    clienteId: "cliente_bot",
    sessaoId: "sessao_bot",
    sock,
    evento: { id: "grupo_1@g.us", participants: ["5511666666666@s.whatsapp.net"], action: "add" }
  });
  await mensageiro.tratarEventoGrupoMensageiro({
    clienteId: "cliente_bot",
    sessaoId: "sessao_bot",
    sock,
    evento: { id: "grupo_1@g.us", participants: ["5511555555555@s.whatsapp.net"], action: "remove" }
  });
  const historicoEventosGrupo = storage.getAtendimentoConfigCliente("cliente_bot").historico;
  assert.ok(historicoEventosGrupo.some((evento) => evento.tipo === "boas_vindas"), "historico reconhece boas-vindas");
  assert.ok(historicoEventosGrupo.some((evento) => evento.tipo === "despedida"), "historico reconhece despedida");

  const antigo = storage.setMensageiroCliente("cliente_antigo", { ativo: true });
  assert.deepStrictEqual(antigo.comandos, [], "config antiga continua valida");

  const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const matchesUpsert = indexFonte.match(/messages\.upsert/g) || [];
  assert.ok(indexFonte.includes("tratarMensagemGrupoComando"), "handler entra no listener unico");
  assert.ok(matchesUpsert.length >= 1, "messages.upsert continua existente");

  console.log("mensageiro-bot-comandos.test.cjs OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
