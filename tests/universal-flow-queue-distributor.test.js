"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { criarCallbackFilaUniversal } =
  require("../modules/engine/universal-queue-distributor.adapter");

test("Distributor adapter carries exact workspace, offer, T0 payload and fanout", async () => {
  const calls = [];
  const callback = criarCallbackFilaUniversal({ pool: { connect() {} },
    resolveTelegramTargets: (workspaceId, destination) => {
      assert.equal(workspaceId, "ws_A");
      assert.equal(destination.id, "tg");
      return [{ targetKey: "bot_1:chat_1", connectionId: "bot_1" }];
    },
    enqueueFn: async input => { calls.push(input); return {
      itemId: 91, operationEpochStartedAt: "2026-10-10T12:00:00.000Z"
    }; } });
  const payload = { clienteId: "ws_A", engineOfertaId: 7, engineJobId: 9,
    imagem: "https://example.test/image", linkAfiliado: "https://example.test/aff" };
  const result = await callback("ws_A", payload, {
    oferta: { id: 7, job_id: 9 },
    destinosCompativeis: [
      { id: "wa", tipo: "whatsapp", alvos: [
        { grupoId: "g1", sessao: "s1" },
        { grupoId: "g2", sessao: "s1" }
      ] },
      { id: "tg", tipo: "telegram" }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.itemFila.id, "universal_91");
  assert.equal(calls[0].workspaceId, "ws_A");
  assert.equal(calls[0].itemPayload, payload);
  assert.deepEqual(calls[0].destinations, [
    { destinationId: "wa", channel: "whatsapp", targetKey: "g1", connectionId: "s1",
      destinationNameSnapshot: "wa", targetLabelSnapshot: "g1" },
    { destinationId: "wa", channel: "whatsapp", targetKey: "g2", connectionId: "s1",
      destinationNameSnapshot: "wa", targetLabelSnapshot: "g2" },
    { destinationId: "tg", channel: "telegram", targetKey: "bot_1:chat_1",
      connectionId: "bot_1", destinationNameSnapshot: "tg",
      targetLabelSnapshot: "bot_1:chat_1" }
  ]);
});

test("unresolved Telegram fanout fails closed instead of claiming a logical send", async () => {
  const callback = criarCallbackFilaUniversal({ pool: { connect() {} },
    enqueueFn: async () => { throw new Error("should_not_call"); } });
  const result = await callback("ws_A", { clienteId: "ws_A",
    engineOfertaId: 7, engineJobId: 9 }, { oferta: { id: 7, job_id: 9 },
    destinosCompativeis: [{ id: "tg", tipo: "telegram" }] });
  assert.equal(result.ok, false);
  assert.equal(result.motivo, "distributor_target_snapshot_unproven");
});

test("two workspaces cannot cross-provide an offer", async () => {
  const callback = criarCallbackFilaUniversal({ pool: { connect() {} },
    enqueueFn: async () => { throw new Error("should_not_call"); } });
  const result = await callback("ws_B", { clienteId: "ws_A",
    engineOfertaId: 7, engineJobId: 9 }, {
    oferta: { id: 7, job_id: 9 }, destinosCompativeis: []
  });
  assert.equal(result.ok, false);
  assert.equal(result.motivo, "queue_distributor_identity_unproven");
});

test("distributor uses the current pool for each admission and does not retry uncertainty", async () => {
  const first = { connect() {}, ended: false };
  const second = { connect() {}, ended: false };
  let active = first;
  const seen = [];
  const callback = criarCallbackFilaUniversal({ pool: first, getPool: () => active,
    enqueueFn: async ({ pool: selected }) => {
      seen.push(selected);
      if (selected.ended) throw new Error("pool_ended");
      return { itemId: 9, operationEpochStartedAt: "2026-10-10T12:00:00Z" };
    } });
  const item = { clienteId: "ws_A", engineOfertaId: 7, engineJobId: 9 };
  const context = { oferta: { id: 7, job_id: 9 },
    destinosCompativeis: [{ id: "wa", tipo: "whatsapp",
      alvos: [{ grupoId: "g1", sessao: "s1" }] }] };
  assert.equal((await callback("ws_A", item, context)).ok, true);
  first.ended = true;
  active = second;
  assert.equal((await callback("ws_A", item, context)).ok, true);
  assert.deepEqual(seen, [first, second]);
  active = null;
  assert.equal((await callback("ws_A", item, context)).ok, false);
  assert.equal(seen.length, 2);
});
