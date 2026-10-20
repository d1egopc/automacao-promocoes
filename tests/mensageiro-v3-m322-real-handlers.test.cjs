const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Keep the disposable legacy-handler audit files on the candidate filesystem;
// the Windows sandbox can deny rename() under its Temp provider.
const dir = fs.mkdtempSync(path.join(__dirname, ".m322-runtime-"));
process.env.DATA_DIR = dir;
fs.writeFileSync(path.join(dir, "usuarios.json"), JSON.stringify([{ id: "ws-v3", ativo: true }]));

const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { createWorkspaceFence } = require("../modules/mensageiro-v3/workspace-fence");
const { createHandlerBridge } = require("../modules/mensageiro-v3/handler-bridge");
const { createV3HandlerAdapters } = require("../modules/mensageiro-v3/handler-adapters");

test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

function setup() {
  const filePath = path.join(dir, `${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 3, revision: 0, workspaces: {}, deletedIds: { profiles: {}, schedules: {} } }));
  const store = new V3Store({ filePath });
  const profile = store.createProfile({ workspaceId: "ws-v3", sessionId: "sess-v3", name: "V3" });
  store.updateProfile("ws-v3", profile.id, { active: true, destinations: ["123@g.us"] });
  return { store, profileId: profile.id };
}

function bridgeFor(store) {
  const fence = createWorkspaceFence({ migratedWorkspaceIds: ["ws-v3"] });
  return createHandlerBridge({ fence, store, v3Handlers: createV3HandlerAdapters({ store }), legacyHandlers: {} });
}

function sock(calls) {
  return {
    async sendMessage(to, payload) { calls.push({ to, payload }); return { key: { id: `sent-${calls.length}` } }; },
    async sendPresenceUpdate() {}
  };
}

test("M3.2.2 — comando real usa somente configuração V3 e desativação bloqueia", async () => {
  const { store, profileId } = setup();
  store.saveCard("ws-v3", profileId, "commands", {
    active: true,
    commands: [{ id: "cmd-v3", ativo: true, gatilhos: ["ping"], resposta: { tipo: "texto", texto: "pong-v3" } }]
  });
  const calls = [];
  const bridge = bridgeFor(store);
  const message = { key: { id: "m1", remoteJid: "123@g.us", participant: "5511999999999@s.whatsapp.net" }, message: { conversation: "ping" } };
  const result = await bridge.dispatch({ workspaceId: "ws-v3", profileId, card: "commands", args: { mensagem: message, sock: sock(calls), planoLiberado: true, sessaoId: "sess-v3" }, eventId: "m1" });
  assert.equal(result.ok, true);
  assert.equal(calls[0].payload.text, "pong-v3");
  store.saveCard("ws-v3", profileId, "commands", { active: false });
  const blocked = await bridge.dispatch({ workspaceId: "ws-v3", profileId, card: "commands", args: { mensagem: { ...message, key: { ...message.key, id: "m2" } }, sock: sock(calls), planoLiberado: true, sessaoId: "sess-v3" }, eventId: "m2" });
  assert.equal(blocked.reason, "card_v3_inativo");
  assert.equal(calls.length, 1);
});

test("M3.2.2 — atendimento real usa gatilho V3 e não consulta configuração legada", async () => {
  const { store, profileId } = setup();
  store.saveCard("ws-v3", profileId, "attendance", {
    active: true,
    configuration: {
      escopo: "privado",
      cooldownMinutos: 1,
      gatilhos: [{ id: "g-v3", ativo: true, modo: "todas", tipoCorrespondencia: "contem", palavrasObrigatorias: ["oi"], respostas: [{ tipo: "texto", conteudo: "atendimento-v3" }] }]
    }
  });
  const calls = [];
  const message = { key: { id: "a1", remoteJid: "5511999999999@s.whatsapp.net" }, message: { conversation: "oi" } };
  const result = await bridgeFor(store).dispatch({ workspaceId: "ws-v3", profileId, card: "attendance", args: { mensagem: message, sock: sock(calls), planoLiberado: true, sessaoId: "sess-v3" }, eventId: "a1" });
  assert.equal(result.ok, true);
  assert.equal(calls[0].payload.text, "atendimento-v3");
});

test("M3.2.2 — gerente real respeita regra V3, OFF e exclusão", async () => {
  const { store, profileId } = setup();
  store.saveCard("ws-v3", profileId, "groupManager", {
    active: true,
    configuration: { grupos: ["123@g.us"], gruposConfigurados: true, configuracao: { regras: [{ id: "r-v3", ativo: true, tipo: "palavras_proibidas", parametros: { palavras: ["proibido"] }, acao: "apagar_avisar", textoAviso: "respeite" }] } }
  });
  const calls = [];
  const s = sock(calls);
  s.user = { id: "bot@s.whatsapp.net" };
  s.groupMetadata = async () => ({ participants: [{ id: "bot@s.whatsapp.net", admin: "admin" }, { id: "5511999999999@s.whatsapp.net" }] });
  s.groupParticipantsUpdate = async () => {};
  const message = { key: { id: "g1", remoteJid: "123@g.us", participant: "5511999999999@s.whatsapp.net" }, message: { conversation: "proibido" } };
  const result = await bridgeFor(store).dispatch({ workspaceId: "ws-v3", profileId, card: "groupManager", args: { mensagem: message, sock: s, planoLiberado: true, sessaoId: "sess-v3" }, eventId: "g1" });
  assert.equal(result.ok, true);
  assert.ok(calls.length >= 1);
  store.saveCard("ws-v3", profileId, "groupManager", { active: false });
  const blocked = await bridgeFor(store).dispatch({ workspaceId: "ws-v3", profileId, card: "groupManager", args: { mensagem: { ...message, key: { ...message.key, id: "g2" } }, sock: s, planoLiberado: true, sessaoId: "sess-v3" }, eventId: "g2" });
  assert.equal(blocked.reason, "card_v3_inativo");
  store.deleteProfile("ws-v3", profileId);
  assert.equal((await bridgeFor(store).dispatch({ workspaceId: "ws-v3", profileId, card: "groupManager", args: { mensagem: { ...message, key: { ...message.key, id: "g3" } }, sock: s, planoLiberado: true, sessaoId: "sess-v3" }, eventId: "g3" })).reason, "card_v3_inativo");
});

test("M3.2.2 — boas-vindas, despedida, FAQ e respostas rápidas usam cards V3 sem herança", async () => {
  const { store, profileId } = setup();
  store.saveCard("ws-v3", profileId, "welcome", { active: true, configuration: { mensagem: "bem-vindo V3", envio: { destino: "grupo", modoGrupo: "texto" } } });
  store.saveCard("ws-v3", profileId, "farewell", { active: true, configuration: { mensagem: "ate logo V3", envio: { destino: "privado", modoGrupo: "texto" } } });
  store.saveCard("ws-v3", profileId, "faq", { active: true, configuration: { gatilhos: [{ id: "faq-v3", categoria: "faq", ativo: true, modo: "todas", tipoCorrespondencia: "contem", palavrasObrigatorias: ["ajuda"], respostas: [{ tipo: "texto", conteudo: "faq-v3" }] }] } });
  store.saveCard("ws-v3", profileId, "flows", { active: true, configuration: { gatilhos: [{ id: "flow-v3", categoria: "fluxos", ativo: true, modo: "todas", tipoCorrespondencia: "contem", palavrasObrigatorias: ["seguir"], respostas: [{ tipo: "texto", conteudo: "fluxo-v3" }] }] } });
  store.saveCard("ws-v3", profileId, "quickReplies", { active: true, configuration: { respostasRapidas: [{ id: "qr-v3", ativo: true, gatilhos: ["atalho"], resposta: { tipo: "texto", conteudo: "rapida-v3" } }] } });
  const calls = [];
  const bridge = bridgeFor(store);
  const event = { id: "123@g.us", action: "add", participants: ["5511999999999@s.whatsapp.net"] };
  const welcome = await bridge.dispatch({ workspaceId: "ws-v3", profileId, card: "welcome", args: { evento: event, sock: sock(calls), sessaoId: "sess-v3" }, eventId: "welcome-1" });
  assert.equal(welcome.ok, true);
  assert.equal(calls[0].payload.text, "bem-vindo V3");
  const farewellCalls = [];
  const farewell = await bridge.dispatch({ workspaceId: "ws-v3", profileId, card: "farewell", args: { evento: { id: "123@g.us", action: "remove", participants: ["5511999999999@s.whatsapp.net"] }, sock: sock(farewellCalls), sessaoId: "sess-v3" }, eventId: "farewell-1" });
  assert.equal(farewell.ok, true);
  assert.equal(farewellCalls[0].payload.text, "ate logo V3");
  const faqCalls = [];
  const faq = await bridge.dispatch({ workspaceId: "ws-v3", profileId, card: "faq", args: { mensagem: { key: { id: "faq-1", remoteJid: "5511999999999@s.whatsapp.net" }, message: { conversation: "ajuda" } }, sock: sock(faqCalls), planoLiberado: true, sessaoId: "sess-v3" }, eventId: "faq-1" });
  assert.equal(faq.ok, true);
  assert.equal(faqCalls[0].payload.text, "faq-v3");
  const flowCalls = [];
  const flow = await bridge.dispatch({ workspaceId: "ws-v3", profileId, card: "flows", args: { mensagem: { key: { id: "flow-1", remoteJid: "5511999999999@s.whatsapp.net" }, message: { conversation: "seguir" } }, sock: sock(flowCalls), planoLiberado: true, sessaoId: "sess-v3" }, eventId: "flow-1" });
  assert.equal(flow.ok, true);
  assert.equal(flowCalls[0].payload.text, "fluxo-v3");
  const quickCalls = [];
  const quick = await bridge.dispatch({ workspaceId: "ws-v3", profileId, card: "quickReplies", args: { mensagem: { key: { id: "qr-1", remoteJid: "5511999999999@s.whatsapp.net" }, message: { conversation: "atalho" } }, sock: sock(quickCalls), planoLiberado: true, sessaoId: "sess-v3" }, eventId: "qr-1" });
  assert.equal(quick.ok, true);
  assert.equal(quickCalls[0].payload.text, "rapida-v3");
});
