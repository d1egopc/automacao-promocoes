const assert = require("assert");
const fs = require("fs");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-mensageiro-gerente-trace-"));
process.on("exit", () => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} });
process.env.DATA_DIR = dataDir;
process.env.SERVMAQ_GERENTE_TRACE_ENABLED = "true";
process.env.SERVMAQ_GERENTE_TRACE_SECRET = "fixture-secret";

const storageUtils = require("../utils/storage");
const storage = require("../modules/mensageiro/storage");
const mensageiro = require("../modules/mensageiro");
const trace = require("../modules/mensageiro/gerente-trace");

const clienteId = "user_k3phmbkf";
const sessaoId = "user_k3phmbkf_Servmaq";
const grupoId = "120363000000000000@g.us";
const participante = "5511999999999@s.whatsapp.net";
const botJid = "5511888888888@s.whatsapp.net";

const config = {
  ativo: true,
  sessaoId,
  sessaoWhatsappId: sessaoId,
  sessaoGruposId: sessaoId,
  grupos: [grupoId],
  perfis: [{
    id: "perfil_servmaq",
    nome: "Servmaq",
    ativo: true,
    sessaoId,
    grupos: [grupoId],
    modulos: {
      gerente: {
        ativo: true,
        gruposConfigurados: true,
        grupos: [grupoId],
        configuracao: {
          regras: [{
            id: "regra_teste",
            ativo: true,
            tipo: "palavras_proibidas",
            parametros: { palavras: ["teste"] },
            acao: "apagar_avisar",
            avisoTexto: "aviso"
          }],
          isentarAdmins: true,
          isentarDono: true,
          autorizados: [],
          moderadores: []
        }
      }
    }
  }]
};

function limparTrace() {
  try { fs.rmSync(path.join(dataDir, "clientes", clienteId, trace.TRACE_FILE), { force: true }); } catch {}
}

function eventos() {
  return storageUtils.readClienteJson(clienteId, trace.TRACE_FILE, { eventos: [] }).eventos || [];
}

function mensagem({ id, fromMe = false, alvo = participante } = {}) {
  return {
    key: { id, remoteJid: grupoId, participant: alvo, fromMe },
    pushName: "Lau",
    message: { conversation: "teste" }
  };
}

function sock({ alvoAdmin = false, botAdmin = true, falharDelete = false, falharAviso = false } = {}) {
  const envios = [];
  return {
    user: { id: botJid },
    envios,
    async groupMetadata() {
      return { participants: [
        { id: botJid, admin: botAdmin ? "admin" : null },
        { id: participante, admin: alvoAdmin ? "admin" : null }
      ] };
    },
    async sendMessage(jid, payload) {
      envios.push({ jid, payload });
      if (payload.delete && falharDelete) throw new Error("delete_falhou");
      if (payload.text && falharAviso) throw new Error("aviso_falhou");
      if (payload.delete) return {};
      return { key: { id: "aviso", remoteJid: jid, fromMe: true } };
    }
  };
}

async function executar(msg, options = {}) {
  return mensageiro.tratarMensagemGrupoGerente({
    clienteId,
    sessaoId,
    sock: sock(options),
    mensagem: msg,
    planoLiberado: options.planoLiberado === undefined ? true : options.planoLiberado
  });
}

(async () => {
  storageUtils.writeGlobalJson("usuarios.json", [{ id: clienteId, ativo: true }]);
  storage.setMensageiroCliente(clienteId, config);
  process.env.SERVMAQ_GERENTE_TRACE_SESSION_HASH = trace.hashIdentifier(sessaoId, process.env.SERVMAQ_GERENTE_TRACE_SECRET);
  process.env.SERVMAQ_GERENTE_TRACE_GROUP_HASH = trace.hashIdentifier(grupoId, process.env.SERVMAQ_GERENTE_TRACE_SECRET);

  limparTrace();
  const offWrites = [];
  process.env.SERVMAQ_GERENTE_TRACE_ENABLED = "false";
  assert.strictEqual(trace.appendTrace({
    clienteId,
    sessaoId,
    grupoId,
    codigo: "received",
    config,
    readClienteJson: () => ({}),
    writeClienteJson: () => offWrites.push(true)
  }), false, "flag desligada nao registra");
  assert.strictEqual(offWrites.length, 0, "flag desligada nao escreve");

  process.env.SERVMAQ_GERENTE_TRACE_ENABLED = "true";
  assert.strictEqual(trace.isTraceTarget({ clienteId, sessaoId, grupoId, config: storage.getMensageiroCliente(clienteId) }), true, "escopo Servmaq reconhecido");
  trace.appendTrace({ clienteId, sessaoId, grupoId, codigo: "received", config, readClienteJson: storageUtils.readClienteJson, writeClienteJson: storageUtils.writeClienteJson });
  assert.strictEqual(eventos()[0].codigo, "received");
  const serialized = JSON.stringify(eventos());
  assert.ok(!serialized.includes(sessaoId), "sessao bruta nunca persiste");
  assert.ok(!serialized.includes(grupoId), "grupo bruto nunca persiste");
  assert.ok(!serialized.includes("teste"), "texto da mensagem nunca persiste");

  limparTrace();
  await executar(mensagem({ id: "from-me", fromMe: true }));
  let codes = eventos().map(item => item.codigo);
  assert.deepStrictEqual(codes, ["handler_called", "from_me"], "fromMe fica observavel antes do gate");

  limparTrace();
  await executar(mensagem({ id: "admin", alvo: participante }), { alvoAdmin: true });
  codes = eventos().map(item => item.codigo);
  assert.deepStrictEqual(codes, ["handler_called", "profile_resolved", "rule_match", "isento"], "administrador fica marcado como isento");

  limparTrace();
  const comumSock = sock();
  await mensageiro.tratarMensagemGrupoGerente({ clienteId, sessaoId, sock: comumSock, mensagem: mensagem({ id: "comum" }), planoLiberado: true });
  codes = eventos().map(item => item.codigo);
  assert.deepStrictEqual(codes, ["handler_called", "profile_resolved", "rule_match", "delete_ok", "aviso_ok"], "participante comum percorre delete e aviso");
  assert.strictEqual(comumSock.envios.filter(item => item.payload?.delete).length, 1);
  assert.strictEqual(comumSock.envios.filter(item => item.payload?.text).length, 1);

  limparTrace();
  await executar(mensagem({ id: "sem-admin" }), { botAdmin: false });
  codes = eventos().map(item => item.codigo);
  assert.deepStrictEqual(codes, ["handler_called", "profile_resolved", "rule_match", "bot_sem_admin"], "bot sem admin fica observavel");

  limparTrace();
  await executar(mensagem({ id: "delete-erro" }), { falharDelete: true });
  codes = eventos().map(item => item.codigo);
  assert.ok(codes.includes("delete_erro"), "falha de exclusao fica observavel");

  limparTrace();
  await executar(mensagem({ id: "aviso-erro" }), { falharAviso: true });
  codes = eventos().map(item => item.codigo);
  assert.ok(codes.includes("aviso_erro"), "falha de aviso fica observavel");

  limparTrace();
  await executar(mensagem({ id: "plano" }), { planoLiberado: false });
  codes = eventos().map(item => item.codigo);
  assert.deepStrictEqual(codes, ["handler_called", "plano_nao_liberado"], "plano bloqueado fica observavel");

  limparTrace();
  storageUtils.writeGlobalJson("usuarios.json", [{ id: clienteId, ativo: false }]);
  await executar(mensagem({ id: "inativo" }));
  codes = eventos().map(item => item.codigo);
  assert.deepStrictEqual(codes, ["handler_called", "usuario_inativo"], "usuario inativo fica observavel");
  storageUtils.writeGlobalJson("usuarios.json", [{ id: clienteId, ativo: true }]);

  assert.strictEqual(trace.isTraceTarget({ clienteId: "outro_workspace", sessaoId, grupoId, config }), false, "outro workspace nunca entra no escopo");

  limparTrace();
  trace.appendTrace({
    clienteId,
    sessaoId,
    grupoId,
    codigo: "received",
    config,
    now: () => new Date(Date.now() - trace.TRACE_MAX_AGE_MS - 1).toISOString(),
    readClienteJson: storageUtils.readClienteJson,
    writeClienteJson: storageUtils.writeClienteJson
  });
  trace.appendTrace({ clienteId, sessaoId, grupoId, codigo: "received", config, readClienteJson: storageUtils.readClienteJson, writeClienteJson: storageUtils.writeClienteJson });
  assert.strictEqual(eventos().length, 1, "registros fora da janela sao removidos");

  limparTrace();
  assert.deepStrictEqual(eventos(), [], "falha anterior ao handler nao fabrica evento");

  for (let i = 0; i < 140; i += 1) {
    trace.appendTrace({ clienteId, sessaoId, grupoId, codigo: "received", config, readClienteJson: storageUtils.readClienteJson, writeClienteJson: storageUtils.writeClienteJson });
  }
  const retained = eventos();
  assert.ok(retained.length <= trace.TRACE_MAX_RECORDS, "retencao limitada");
  const tracePath = path.join(dataDir, "clientes", clienteId, trace.TRACE_FILE);
  assert.ok(fs.statSync(tracePath).size <= trace.TRACE_MAX_BYTES, "tamanho limitado");

  console.log("mensageiro gerente trace: PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
