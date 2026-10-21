"use strict";

const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { V3Scheduler } = require("../modules/mensageiro-v3/src/v3/scheduler");
const { createLegacyCompatRoutes } = require("../modules/mensageiro-v3/legacy-compat");

function request(server, method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const address = server.address();
    const req = http.request({ host: "127.0.0.1", port: address.port, method, path: url, headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {} }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createFixture(clock = Date.now) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mensageiro-v3-compat-"));
  const filePath = path.join(dir, "state.json");
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 3, revision: 0, workspaces: {}, deletedIds: { profiles: {}, schedules: {} } }));
  const store = new V3Store({ filePath, clock });
  const app = express();
  app.use(express.json());
  const mounted = createLegacyCompatRoutes({ store, clock, getClienteId: () => "workspace-a", usuarioTemRecurso: () => true });
  app.use("/mensageiro", mounted.router);
  const server = app.listen(0);
  return { dir, filePath, store, server };
}

(async () => {
  let fakeNow = Date.parse("2026-10-21T10:00:00.000Z");
  const fixture = createFixture(() => fakeNow);
  try {
    const empty = await request(fixture.server, "GET", "/mensageiro");
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.perfis, []);
    assert.equal(empty.body.v3, true);
    const draftProfileId = "ui-temporary-profile-id";
    const draftScheduleId = "ui-temporary-schedule-id";
    const draft = {
      perfis: [{
        id: draftProfileId,
        nome: "Perfil original",
        ativo: true,
        sessaoId: "session-a",
        grupos: ["group-a"],
        modulos: {
          boasVindas: { ativo: true, conteudoConfigurado: true, configuracao: { mensagem: "bem-vindo" } },
          despedida: { ativo: false, configuracao: { mensagem: "até logo" } },
          comandos: { ativo: true, grupos: ["group-a"], gruposConfigurados: true },
          programacoes: { ativo: false },
          gerente: { ativo: true, grupos: ["group-a"], gruposConfigurados: true, configuracao: { regras: [] } }
        }
      }],
      comandos: [{ id: "cmd-1", perfilId: draftProfileId, nome: "Oi", ativo: true, gatilhos: ["oi"], resposta: { tipo: "texto", texto: "olá" } }],
      programacoes: [{ id: draftScheduleId, perfilId: draftProfileId, nome: "Diária", ativo: false, tipo: "intervalo", intervaloMinutos: 150, grupos: ["group-a"], conteudos: [{ id: "content-1", tipo: "texto", texto: "oferta" }] }]
    };
    const saved = await request(fixture.server, "POST", "/mensageiro", draft);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.source, "mensageiro_v3_compat");
    assert.equal(saved.body.v3, true);
    assert.equal(saved.body.perfis.length, 1);
    const profile = saved.body.perfis[0];
    assert.notEqual(profile.id, draftProfileId, "IDs V3 não reutilizam IDs temporários do formulário");
    assert.equal(profile.modulos.boasVindas.configuracao.mensagem, "bem-vindo");
    assert.equal(profile.modulos.gerente.ativo, true);
    assert.equal(saved.body.comandos[0].perfilId, profile.id);
    assert.equal(saved.body.programacoes[0].perfilId, profile.id);
    assert.equal(saved.body.programacoes[0].ativo, false);
    assert.deepEqual(Object.keys(fixture.store.getProfile("workspace-a", profile.id).cards).sort(), [
      "attendance", "commands", "faq", "farewell", "flows", "groupManager", "quickReplies", "scheduled", "welcome"
    ]);

    // The original form sends horario/data, not an absolute nextRunAt. The
    // compat boundary must translate it before the persisted V3 scheduler
    // sees the record, and the instant must survive a restart.
    const activeSchedule = await request(fixture.server, "POST", "/mensageiro", {
      perfis: [{
        id: profile.id,
        nome: "Perfil original",
        ativo: true,
        sessaoId: "session-a",
        modulos: { programacoes: { ativo: true } }
      }],
      programacoes: [{
        perfilId: profile.id,
        nome: "Horário mock",
        ativo: true,
        tipo: "horario",
        horario: "07:01",
        timezone: "America/Sao_Paulo",
        grupos: ["group-a"],
        conteudos: [{ id: "content-schedule", tipo: "texto", texto: "mensagem mock" }]
      }]
    });
    assert.equal(activeSchedule.status, 200);
    const persistedSchedule = fixture.store.listSchedules("workspace-a", { includeInactive: true })[0];
    assert.match(persistedSchedule.nextRunAt, /^2026-10-21T10:01:00\.000Z$/);
    const restartedStore = new V3Store({ filePath: fixture.filePath, clock: () => fakeNow });
    fakeNow = Date.parse("2026-10-21T10:01:00.000Z");
    const scheduler = new V3Scheduler({
      store: restartedStore,
      clock: () => fakeNow,
      isWorkspaceMigrated: () => true,
      transport: {
        authorizeSend: async () => true,
        sendMessage: async () => ({ confirmed: true, transportMessageId: "mock-message-1" })
      }
    });
    const scheduledRun = await scheduler.tick();
    assert.equal(scheduledRun.sent.length, 1);
    assert.equal(scheduledRun.sent[0].destination, "group-a");
    assert.equal(restartedStore.listSchedules("workspace-a", { includeInactive: true })[0].active, false);

    const atendimento = await request(fixture.server, "POST", `/mensageiro/perfis/${profile.id}/atendimento`, {
      atendimentoAtivo: true,
      faqAtivo: true,
      fluxosAtivo: false,
      respostasRapidasAtivo: true,
      gatilhos: [
        { id: "faq-1", ativo: true, categoria: "faq", palavrasObrigatorias: ["preço"], respostas: [{ tipo: "texto", conteudo: "consulte" }] },
        { id: "att-1", ativo: true, categoria: "atendimento", palavrasObrigatorias: ["oi"], respostas: [{ tipo: "texto", conteudo: "olá" }] }
      ],
      respostasRapidas: [{ id: "quick-1", nome: "pix", ativo: true, gatilhos: ["pix"], resposta: { tipo: "texto", conteudo: "chave" } }]
    });
    assert.equal(atendimento.status, 200);
    assert.equal(atendimento.body.ativo, true);
    assert.equal(atendimento.body.faqAtivo, true);
    assert.equal(atendimento.body.respostasRapidasAtivo, true);
    assert.equal(atendimento.body.gatilhos.length, 2);
    const persisted = fixture.store.getProfile("workspace-a", profile.id);
    assert.equal(persisted.cards.attendance.active, true);
    assert.equal(persisted.cards.faq.active, true);
    assert.equal(persisted.cards.quickReplies.active, true);

    const triggerPreview = await request(fixture.server, "POST", "/mensageiro/testar-gatilho", { texto: "oi" });
    assert.equal(triggerPreview.status, 200);
    assert.equal(triggerPreview.body.dryRun, true);
    assert.equal(triggerPreview.body.envio, false);
    assert.equal(triggerPreview.body.executaria, true);
    assert.equal(triggerPreview.body.encontrou, true);
    assert.equal(triggerPreview.body.gatilho.id, "att-1");
    const triggerMiss = await request(fixture.server, "POST", "/mensageiro/testar-gatilho", { texto: "sem correspondência" });
    assert.equal(triggerMiss.body.executaria, false);

    // These are legacy informational histories. V3 execution uses its durable
    // claims/audit ledger; empty legacy arrays must not block card operation.
    const history = await request(fixture.server, "GET", "/mensageiro/historico");
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.historico, []);
    const infractions = await request(fixture.server, "GET", "/mensageiro/gerente/infracoes?perfilId=" + encodeURIComponent(profile.id));
    assert.equal(infractions.status, 200);
    assert.deepEqual(infractions.body.infracoes, []);

    const reloaded = await request(fixture.server, "GET", "/mensageiro");
    assert.equal(reloaded.body.perfis[0].modulos.comandos.comandos[0].id, "cmd-1");
    assert.equal(reloaded.body.atendimento.gatilhos.length, 2);

    const deleted = await request(fixture.server, "DELETE", `/mensageiro/perfis/${profile.id}`, { confirmar: true });
    assert.equal(deleted.status, 200);
    const afterDelete = await request(fixture.server, "GET", "/mensageiro");
    assert.deepEqual(afterDelete.body.perfis, []);
    assert.deepEqual(afterDelete.body.programacoes, []);

    // A fresh store instance sees the same tombstone and cannot resurrect the
    // deleted profile or schedule after a simulated restart.
    const finalRestartedStore = new V3Store({ filePath: fixture.filePath });
    assert.equal(finalRestartedStore.listProfiles("workspace-a").length, 0);
    assert.equal(Object.keys(finalRestartedStore.snapshot().deletedIds.profiles).length, 1);
    assert.equal(Object.keys(finalRestartedStore.snapshot().deletedIds.schedules).length, 2);
  } finally {
    await new Promise(resolve => fixture.server.close(resolve));
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
  console.log("mensageiro-v3-original-ui-compat.test.cjs OK");
})().catch(error => { console.error(error); process.exitCode = 1; });
