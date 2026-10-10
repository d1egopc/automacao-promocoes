"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { criarServicoClonadorGrupos } =
  require("../modules/clonador-grupos/service");

test("listener Clonador candidato preserva messageTimestamp e falha fechado", async () => {
  const inserted = [];
  const repo = {
    lerConfig: async () => ({ ativo: true }),
    listarFontes: async () => [{ ativo: true, sessaoId: "session_a",
      grupoJid: "group_a@g.us", grupoNome: "Group A" }],
    inserirBufferCaptura: async input => {
      inserted.push(input);
      return { inserido: true, item: { id: inserted.length } };
    }
  };
  const service = criarServicoClonadorGrupos({ repository: repo,
    clienteTemRecurso: () => true, exigirCapturaFactualCandidata: true,
    logger: { log() {} } });
  const seconds = 1791547200;
  const base = { clienteId: "workspace_a", sessaoId: "session_a",
    mensagem: { key: { remoteJid: "group_a@g.us", id: "m1", fromMe: false },
      messageTimestamp: { toNumber: () => seconds },
      message: { conversation: "Oferta https://example.invalid/item" } } };
  const captured = await service.capturarMensagemWhatsapp(base);
  assert.equal(captured.capturada, true);
  assert.equal(inserted.length, 1);
  assert.equal(new Date(inserted[0].capturadoEm).toISOString(),
    new Date(seconds * 1000).toISOString());
  const missing = await service.capturarMensagemWhatsapp({ ...base,
    mensagem: { ...base.mensagem, messageTimestamp: null,
      key: { ...base.mensagem.key, id: "m2" } } });
  assert.equal(missing.capturada, false);
  assert.equal(missing.motivo, "captura_sem_tempo_factual");
  assert.equal(inserted.length, 1);
});
