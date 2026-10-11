"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { selecionarAlvosParaProvider } =
  require("../modules/engine/universal-target-provider-bridge");
const { criarDispatcherProviderExistentePorAlvo } =
  require("../modules/engine/universal-target-provider-bridge");

test("legacy provider keeps its existing multi-target fanout", () => {
  const alvos = [{ grupoId: "A" }, { grupoId: "B" }];
  assert.deepEqual(selecionarAlvosParaProvider({ canal: "whatsapp", alvos }), alvos);
});

test("Universal provider can see exactly one WhatsApp or Discord target", () => {
  assert.deepEqual(selecionarAlvosParaProvider({ canal: "whatsapp",
    alvos: [{ grupoId: "A" }, { grupoId: "B" }], targetKey: "B" }),
  [{ grupoId: "B" }]);
  assert.deepEqual(selecionarAlvosParaProvider({ canal: "discord",
    alvos: [{ channelId: "C" }, { channelId: "D" }], targetKey: "C" }),
  [{ channelId: "C" }]);
});

test("Universal Telegram selection uses the existing checkpoint target key", () => {
  assert.deepEqual(selecionarAlvosParaProvider({ canal: "telegram",
    alvos: [{ id: "telegram_1" }, { id: "telegram_2" }],
    targetKey: "integracao:telegram_2" }), [{ id: "telegram_2" }]);
});

test("Universal target cannot silently fall through or multiply", () => {
  assert.throws(() => selecionarAlvosParaProvider({ canal: "whatsapp",
    alvos: [{ grupoId: "A" }], targetKey: "B" }), /not_unique/);
  assert.throws(() => selecionarAlvosParaProvider({ canal: "discord",
    alvos: [{ channelId: "A" }, { channelId: "A" }], targetKey: "A" }),
  /not_unique/);
});

test("existing provider ACK maps to one durable Universal target fact", async () => {
  const claim = { queue_item_id: 17, workspace_id: "ws_A",
    target_key: "group_B", channel: "whatsapp" };
  const prepared = { oferta: { titulo: "Oferta" },
    destination: { id: "dest_A", tipo: "whatsapp" },
    rendered: { message: "mensagem" } };
  let starts = 0;
  const dispatch = criarDispatcherProviderExistentePorAlvo({
    resolveConfigCliente: () => ({}),
    send: async (_dest, offer, _msg, _workspace, _config, options) => {
      assert.equal(offer.id, "universal_17");
      assert.equal(options.universalTargetKey, "group_B");
      await options.beforeUniversalProvider({ canal: "whatsapp",
        alvo: { grupoId: "group_B" } });
      options.onUniversalTargetCheckpoint({ canal: "whatsapp",
        alvo: { grupoId: "group_B" }, checkpoint: {
          ok: true, resposta: { key: { id: "wa_msg_1" } },
          contexto: { estado: "enviado", attemptId: "attempt_1" }
        } });
      options.onUniversalCreditResult({ attemptId: "attempt_1",
        debitou: true, marcadorDuravel: true });
      return { enviado: true, tentouEnvio: true };
    }
  });
  assert.deepEqual(await dispatch(claim, prepared,
    { startAttempt: async () => { starts += 1; } }), {
    confirmed: true, confirmationKey: "attempt_1",
    providerMessageId: "wa_msg_1", creditDebited: true });
  assert.equal(starts, 1);
});

test("provider precheck denial never starts the durable send", async () => {
  const dispatch = criarDispatcherProviderExistentePorAlvo({
    resolveConfigCliente: () => ({}),
    send: async () => ({ enviado: false, tentouEnvio: false,
      motivo: "session_closed" })
  });
  const result = await dispatch({ queue_item_id: 1, workspace_id: "ws_A",
    target_key: "A", channel: "whatsapp" }, {
    oferta: {}, destination: { id: "d" }, rendered: { message: "x" }
  }, { startAttempt: async () => { throw new Error("must_not_start"); } });
  assert.equal(result.reason, "session_closed");
  assert.equal(result.confirmed, undefined);
});

test("a factual send remains sent when credit bookkeeping fails", async () => {
  const dispatch = criarDispatcherProviderExistentePorAlvo({
    resolveConfigCliente: () => ({}),
    send: async (_d, _o, _m, _w, _c, options) => {
      await options.beforeUniversalProvider({ canal: "discord",
        alvo: { channelId: "C" } });
      options.onUniversalTargetCheckpoint({ canal: "discord",
        alvo: { channelId: "C" }, checkpoint: { ok: true,
          resposta: { messageId: "dc_msg_1" },
          contexto: { estado: "enviado", attemptId: "attempt_dc" } } });
      options.onUniversalCreditResult({ attemptId: "attempt_dc",
        debitou: false, marcadorDuravel: false });
      return { enviado: true, tentouEnvio: true };
    }
  });
  assert.deepEqual(await dispatch({ queue_item_id: 1, workspace_id: "ws_A",
    target_key: "C", channel: "discord" }, {
    oferta: {}, destination: { id: "d" }, rendered: { message: "x" }
  }, { startAttempt: async () => {} }), {
    confirmed: true, confirmationKey: "attempt_dc",
    providerMessageId: "dc_msg_1", creditDebited: false });
});

test("a persisted provider ACK survives a later sender exception", async () => {
  const dispatch = criarDispatcherProviderExistentePorAlvo({
    resolveConfigCliente: () => ({}),
    send: async (_d, _o, _m, _w, _c, options) => {
      await options.beforeUniversalProvider({ canal: "whatsapp",
        alvo: { grupoId: "A" } });
      options.onUniversalTargetCheckpoint({ canal: "whatsapp",
        alvo: { grupoId: "A" }, checkpoint: { ok: true,
          resposta: { key: { id: "wa_msg_2" } },
          contexto: { estado: "enviado", attemptId: "attempt_2" } } });
      throw new Error("later_telemetry_failed");
    }
  });
  assert.deepEqual(await dispatch({ queue_item_id: 2, workspace_id: "ws_A",
    target_key: "A", channel: "whatsapp" }, {
    oferta: {}, destination: { id: "d" }, rendered: { message: "x" }
  }, { startAttempt: async () => {} }), {
    confirmed: true, confirmationKey: "attempt_2",
    providerMessageId: "wa_msg_2", creditDebited: false
  });
});

test("provider response without compatible checkpoint never confirms", async () => {
  const dispatch = criarDispatcherProviderExistentePorAlvo({
    resolveConfigCliente: () => ({}),
    send: async (_d, _o, _m, _w, _c, options) => {
      await options.beforeUniversalProvider({ canal: "whatsapp",
        alvo: { grupoId: "A" } });
      return { enviado: true, tentouEnvio: true };
    }
  });
  const result = await dispatch({ queue_item_id: 1, workspace_id: "ws_A",
    target_key: "A", channel: "whatsapp" }, {
    oferta: {}, destination: { id: "d" }, rendered: { message: "x" }
  }, { startAttempt: async () => {} });
  assert.equal(result.confirmed, false);
});
