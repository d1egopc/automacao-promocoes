"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { avaliarFrescorEsperaClonador } = require("../modules/clonador-grupos/wait-freshness.candidate");
const { criarBridgeClonadorGrupos } = require("../modules/clonador-grupos/bridge");
const { avaliarFrescorPreImporter } = require("../modules/engine/frescor-pre-importer.service");

test("Clonador waiting uses shared Normal/Turbo authority and excludes Manual V2", () => {
  const now = Date.now();
  const capturedAt = new Date(now - 15 * 60 * 1000).toISOString();
  const normal = avaliarFrescorEsperaClonador({ capturadoEm: capturedAt, metadata: {} }, now);
  const turbo = avaliarFrescorEsperaClonador({ capturadoEm: capturedAt,
    metadata: { cupomTurbo: true } }, now);
  const manual = avaliarFrescorEsperaClonador({ capturadoEm: capturedAt,
    metadata: { manualV2: true } }, now);
  assert.equal(normal.expirada, false);
  assert.equal(normal.ttlMs, 30 * 60 * 1000);
  assert.equal(turbo.expirada, true);
  assert.equal(turbo.ttlMs, 10 * 60 * 1000);
  assert.equal(manual.expirada, false);
  assert.equal(manual.manualV2, true);
  assert.equal(normal.origemComercialMs, Date.parse(capturedAt));
});

test("expired waiting capture is compacted before Engine event or job", async () => {
  let engineCalls = 0;
  let compacted = null;
  const item = { id: "91", clienteId: "ws_a", status: "processando",
    capturadoEm: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    metadata: { cupomTurbo: true }, links: ["https://example.invalid/x"] };
  const repo = {
    ignorarCapturaVencidaAguardando: async (id, motivo, tipoFluxo) => {
      compacted = { id, motivo, tipoFluxo };
      return { ...item, status: "ignorada", textoOriginal: "", links: [] };
    }
  };
  const bridge = criarBridgeClonadorGrupos({
    repository: repo,
    aplicarFrescorEsperaCandidato: true,
    registrarEventoBruto: async () => { engineCalls += 1; return { ok: true }; }
  });
  const result = await bridge.processarItem(item);
  assert.equal(result.ignorada, true);
  assert.equal(result.motivo, "EXPIRED_BEFORE_ADMISSION");
  assert.deepEqual(compacted, { id: "91", motivo: "EXPIRED_BEFORE_ADMISSION",
    tipoFluxo: "cupom_turbo" });
  assert.equal(engineCalls, 0);
});

test("explicit capture-time Turbo marker reaches the Engine event unchanged", async () => {
  const capturedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  let registered = null;
  const item = { id: "92", clienteId: "ws_a", sessaoId: "s", grupoJid: "g@g.us",
    mensagemId: "m", textoOriginal: "Oferta", links: ["https://example.invalid/p"],
    capturadoEm: capturedAt, metadata: { cupomTurbo: true, tipoFluxo: "cupom_turbo" } };
  const bridge = criarBridgeClonadorGrupos({
    aplicarFrescorEsperaCandidato: true,
    repository: {
      listarDestinos: async () => [],
      atualizarBufferStatus: async () => ({ ...item, status: "pronta" })
    },
    resolverRedirectUniversal: async () => ({ ok: false, status: "ignorado" }),
    extrairComercialUniversal: () => ({}),
    registrarEventoBruto: async event => {
      registered = event;
      return { ok: true, id: 92, jobsCriados: 1, jobsExistentes: 0 };
    },
    logger: { log() {} }
  });
  assert.equal((await bridge.processarItem(item)).ok, true);
  assert.equal(registered.capturadoEm, capturedAt);
  assert.equal(registered.metadata.cupomTurbo, true);
  assert.equal(registered.metadata.tipoFluxo, "cupom_turbo");
  const frescor = avaliarFrescorPreImporter({ evento_capturado_em: registered.capturadoEm,
    evento_metadata: registered.metadata }, { agoraMs: Date.now() });
  assert.equal(frescor.tipoFluxo, "cupom_turbo");
  assert.equal(frescor.ttlMs, 10 * 60 * 1000);
});

test("bridge pass expires waiting captures without a new capture", async () => {
  let expiryCalls = 0;
  const bridge = criarBridgeClonadorGrupos({
    aplicarFrescorEsperaCandidato: true,
    repository: {
      expirarEsperaVencida: async ({ limite }) => {
        expiryCalls += 1;
        assert.equal(limite, 2);
        return { ok: true, expiradas: 2 };
      },
      reivindicarProximaCaptura: async () => null
    }
  });
  const result = await bridge.processarCapturasPendentes({ limite: 2 });
  assert.equal(expiryCalls, 1);
  assert.equal(result.expiradasNaEspera, 2);
  assert.equal(result.vazia, true);
});
