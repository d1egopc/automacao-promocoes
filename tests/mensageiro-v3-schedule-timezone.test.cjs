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

function request(server, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const address = server.address();
    const req = http.request({
      host: "127.0.0.1", port: address.port, method: "POST", path: "/mensageiro",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
    }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

(async () => {
  let now = Date.parse("2026-10-23T10:00:00.000Z");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mensageiro-v3-timezone-"));
  const filePath = path.join(dir, "state.json");
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 3, revision: 0, workspaces: {}, deletedIds: { profiles: {}, schedules: {} } }));
  const store = new V3Store({ filePath, clock: () => now });
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/mensageiro", createLegacyCompatRoutes({ store, clock: () => now, getClienteId: () => "workspace-a", usuarioTemRecurso: () => true }).router);
  const server = app.listen(0);
  const image = `data:image/jpeg;base64,${Buffer.from("fixture-image").toString("base64")}`;
  const profileDraft = {
    id: "draft-profile", nome: "Perfil", ativo: true, sessaoId: "session-a", grupos: ["group-a", "group-b"],
    modulos: { programacoes: { ativo: true } }
  };
  try {
    const created = await request(server, {
      perfis: [profileDraft],
      programacoes: [{
        id: "draft-schedule", perfilId: "draft-profile", nome: "Boa noite", ativo: true,
        tipo: "horario", horario: "18:30", timezone: "America/Sao_Paulo",
        nextRunAt: "2026-10-24T18:43:02.000Z", grupos: ["group-a", "group-b"],
        conteudos: [{ id: "image-1", tipo: "imagem", texto: "Legenda", imagem: image }]
      }]
    });
    assert.equal(created.status, 200);
    const profile = created.body.perfis[0];
    const scheduleId = created.body.programacoes[0].id;
    assert.equal(store.getSchedule("workspace-a", scheduleId).nextRunAt, "2026-10-23T21:30:00.000Z");

    const edited = await request(server, {
      perfis: [{ id: profile.id, nome: profile.nome, ativo: true, sessaoId: "session-a", modulos: { programacoes: { ativo: true } } }],
      programacoes: [{
        id: scheduleId, perfilId: profile.id, nome: "Boa noite", ativo: true,
        tipo: "horario", horario: "19:30", timezone: "America/Sao_Paulo",
        nextRunAt: "2026-10-24T18:43:02.000Z", grupos: ["group-a", "group-b"],
        conteudos: [{ id: "image-1", tipo: "imagem", texto: "Legenda", imagem: image }]
      }]
    });
    assert.equal(edited.status, 200);
    const afterTimingEdit = store.getSchedule("workspace-a", scheduleId);
    assert.equal(afterTimingEdit.nextRunAt, "2026-10-23T22:30:00.000Z", "horário alterado recalcula em BRT, ignorando nextRunAt antigo");
    assert.deepEqual(afterTimingEdit.destinations, ["group-a", "group-b"]);
    assert.equal(afterTimingEdit.content.conteudos[0].imagem, image);

    const beforeNonTimingSave = afterTimingEdit.nextRunAt;
    const nonTiming = await request(server, {
      perfis: [{ id: profile.id, nome: profile.nome, ativo: true, sessaoId: "session-a" }],
      programacoes: [{
        id: scheduleId, perfilId: profile.id, nome: "Boa noite atualizada", ativo: true,
        conteudos: [{ id: "image-1", tipo: "imagem", texto: "Legenda nova", imagem: image }]
      }]
    });
    assert.equal(nonTiming.status, 200);
    const afterNonTimingSave = store.getSchedule("workspace-a", scheduleId);
    assert.equal(afterNonTimingSave.nextRunAt, beforeNonTimingSave, "salvar conteúdo não desloca o horário");
    assert.deepEqual(afterNonTimingSave.destinations, ["group-a", "group-b"]);

    const dated = await request(server, {
      perfis: [{ id: profile.id, nome: profile.nome, ativo: true, sessaoId: "session-a" }],
      programacoes: [{
        id: scheduleId, perfilId: profile.id, nome: "Boa noite atualizada", ativo: true,
        tipo: "horario", data: "2026-10-24", horario: "19:30", timezone: "America/Sao_Paulo",
        nextRunAt: "2026-10-24T18:43:02.000Z"
      }]
    });
    assert.equal(dated.status, 200);
    assert.equal(store.getSchedule("workspace-a", scheduleId).nextRunAt, "2026-10-24T22:30:00.000Z", "data explícita recalcula a ocorrência futura");

    const utc = await request(server, {
      perfis: [{ id: profile.id, nome: profile.nome, ativo: true, sessaoId: "session-a" }],
      programacoes: [{
        id: scheduleId, perfilId: profile.id, nome: "Boa noite atualizada", ativo: true,
        tipo: "horario", horario: "19:30", timezone: "UTC", nextRunAt: "2026-10-24T18:43:02.000Z"
      }]
    });
    assert.equal(utc.status, 200);
    assert.equal(store.getSchedule("workspace-a", scheduleId).nextRunAt, "2026-10-24T19:30:00.000Z", "troca de timezone usa a zona escolhida");

    const backToBrazil = await request(server, {
      perfis: [{ id: profile.id, nome: profile.nome, ativo: true, sessaoId: "session-a" }],
      programacoes: [{
        id: scheduleId, perfilId: profile.id, nome: "Boa noite atualizada", ativo: true,
        tipo: "horario", data: "", horario: "19:30", timezone: "America/Sao_Paulo", nextRunAt: "2026-10-24T18:43:02.000Z"
      }]
    });
    assert.equal(backToBrazil.status, 200);
    assert.equal(store.getSchedule("workspace-a", scheduleId).nextRunAt, "2026-10-23T22:30:00.000Z");

    now = Date.parse("2026-10-23T22:30:00.000Z");
    const scheduler = new V3Scheduler({
      store, clock: () => now, isWorkspaceMigrated: () => true,
      transport: { authorizeSend: async () => true, sendMessage: async () => ({ confirmed: true, transportMessageId: "msg-1" }) }
    });
    assert.equal((await scheduler.tick()).sent.length, 2, "uma ocorrência envia para os dois destinos");
    assert.equal((await scheduler.tick()).sent.length, 0, "a ocorrência não duplica");
    assert.equal(store.getSchedule("workspace-a", scheduleId).nextRunAt, "2026-10-24T22:30:00.000Z", "próximo dia preserva 19h30 BRT");
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("mensageiro-v3-schedule-timezone.test.cjs OK");
})().catch(error => { console.error(error); process.exitCode = 1; });
