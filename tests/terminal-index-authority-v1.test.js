"use strict";

const assert = require("assert");

const authority = require("../modules/fila/terminal-index-authority");

function env(overrides = {}) {
  return {
    FILA_TERMINAL_INDEX_AUTHORITY: "1",
    FILA_TERMINAL_INDEX_AUTHORITY_CANARY_CLIENTES: "cliente-canary",
    FILA_TERMINAL_INDEX_AUTHORITY_FENCE: "1",
    ...overrides
  };
}

function fenceSnapshot(overrides = {}) {
  return {
    ok: true,
    eligible: true,
    pending: false,
    metadataLockPresent: false,
    epoch: 4,
    ...overrides
  };
}

function validacao(overrides = {}) {
  const { index: indexOverrides = {}, proof: proofOverrides = {}, ...rest } = overrides;
  const index = {
    sourceRevision: "source-1",
    generation: 7,
    revision: "revision-1",
    entries: { "item-1": ["enviado", 3] },
    ...indexOverrides
  };
  const proof = {
    sourceRevision: "source-1",
    generation: 7,
    revision: "revision-1",
    sources: {
      legacy: { identity: { size: 270 } },
      incremental: [{ identity: { size: 30 } }]
    },
    ...proofOverrides
  };
  return {
    valido: true,
    motivo: "terminal_index_valido",
    bytes: 4096,
    index,
    proof,
    ...rest
  };
}

function sequencia(valores) {
  let indice = 0;
  return () => valores[Math.min(indice++, valores.length - 1)];
}

function coordenada(overrides = {}) {
  return authority.marcarCoordenada({
    env: env(),
    identidadePrimariaExataFilaV2: item => String(item.id || ""),
    fenceSnapshot: () => fenceSnapshot(),
    validarTerminalIndex: () => validacao(),
    ...overrides
  });
}

function decidir(overrides = {}, item = { id: "item-1" }) {
  return authority.decidirAuthority("cliente-canary", item, coordenada(overrides));
}

function testeFlagsEGates() {
  authority.resetarMetricasAuthorityParaTeste();
  let valida = 0;
  let snapshot = 0;
  const base = {
    validarTerminalIndex: () => { valida += 1; return validacao(); },
    fenceSnapshot: () => { snapshot += 1; return fenceSnapshot(); }
  };

  assert.strictEqual(authority.decidirAuthority("cliente-canary", { id: "item-1" }, {
    ...base,
    identidadePrimariaExataFilaV2: item => item.id,
    env: {}
  }).reasonCode, "authority_disabled");
  assert.strictEqual(authority.decidirAuthority("cliente-canary", { id: "item-1" }, {
    ...base,
    identidadePrimariaExataFilaV2: item => item.id,
    env: env({ FILA_TERMINAL_INDEX_AUTHORITY: "0" })
  }).reasonCode, "authority_disabled");
  assert.strictEqual(decidir({ env: env({ FILA_TERMINAL_INDEX_AUTHORITY_CANARY_CLIENTES: "outro" }) }).reasonCode, "workspace_not_canary");
  assert.strictEqual(authority.decidirAuthority("cliente-canary", { id: "item-1" }, {
    ...base,
    env: env(),
    identidadePrimariaExataFilaV2: item => item.id
  }).reasonCode, "not_coordinated");
  assert.strictEqual(decidir({ env: env({ FILA_TERMINAL_INDEX_AUTHORITY_FENCE: "0" }) }).reasonCode, "fence_disabled");
  assert.strictEqual(valida, 0);
  assert.strictEqual(snapshot, 0);
}

function testeFalhasFailClosed() {
  assert.strictEqual(decidir({ fenceSnapshot: () => fenceSnapshot({ ok: false, eligible: false, reasonCode: "state_absent" }) }).decision, "legacy");
  assert.strictEqual(decidir({ fenceSnapshot: () => fenceSnapshot({ eligible: false, pending: true, reasonCode: "owner_active" }) }).decision, "legacy");
  assert.strictEqual(decidir({ fenceSnapshot: () => fenceSnapshot({ metadataLockPresent: true, ok: false, eligible: false }) }).decision, "legacy");
  assert.strictEqual(decidir({ validarTerminalIndex: () => ({ valido: false, motivo: "terminal_index_source_stale" }) }).decision, "legacy");
  assert.strictEqual(decidir({ validarTerminalIndex: () => { throw new Error("validator_failure"); } }).reasonCode, "authority_exception");
  assert.strictEqual(decidir({ identidadePrimariaExataFilaV2: () => "" }).reasonCode, "identity_missing");
  assert.strictEqual(decidir({ validarTerminalIndex: () => validacao({ index: { sourceRevision: "" } }) }).decision, "legacy");
  assert.strictEqual(decidir({ fenceSnapshot: () => ({ ok: true, eligible: true, pending: false, metadataLockPresent: false, epoch: -1 }) }).decision, "legacy");
}

function testeHitMissSemLeituraPesada() {
  let validacoes = 0;
  let snapshots = 0;
  const base = {
    validarTerminalIndex: () => { validacoes += 1; return validacao(); },
    fenceSnapshot: () => { snapshots += 1; return fenceSnapshot(); }
  };
  const hit = decidir(base);
  assert.strictEqual(hit.decision, "authority");
  assert.strictEqual(hit.proved, true);
  assert.strictEqual(hit.hit, true);
  assert.strictEqual(hit.status, "enviado");
  assert.strictEqual(hit.bytesAvoidedEstimate, 300);
  assert.strictEqual(hit.indexBytes, 4096);
  assert.strictEqual(validacoes, 2);
  assert.strictEqual(snapshots, 2);

  const miss = decidir({
    ...base,
    validarTerminalIndex: () => validacao({ index: { entries: {} } })
  }, { id: "item-ausente" });
  assert.strictEqual(miss.decision, "authority");
  assert.strictEqual(miss.proved, false);
  assert.strictEqual(miss.hit, false);
  assert.strictEqual(miss.reasonCode, "authority_miss");
}

function testeCorridasPrePos() {
  const epochChanged = decidir({
    fenceSnapshot: sequencia([fenceSnapshot({ epoch: 10 }), fenceSnapshot({ epoch: 11 })])
  });
  assert.strictEqual(epochChanged.decision, "legacy");
  assert.strictEqual(epochChanged.reasonCode, "authority_snapshot_changed");

  const aba = decidir({
    fenceSnapshot: sequencia([
      fenceSnapshot({ epoch: 10 }),
      fenceSnapshot({ epoch: 11 })
    ])
  });
  assert.strictEqual(aba.decision, "legacy");

  const sourceChanged = decidir({
    validarTerminalIndex: sequencia([
      validacao(),
      validacao({ index: { sourceRevision: "source-2" }, proof: { sourceRevision: "source-2" } })
    ])
  });
  assert.strictEqual(sourceChanged.decision, "legacy");

  const generationChanged = decidir({
    validarTerminalIndex: sequencia([
      validacao(),
      validacao({ index: { generation: 8 }, proof: { generation: 8 } })
    ])
  });
  assert.strictEqual(generationChanged.decision, "legacy");

  const revisionChanged = decidir({
    validarTerminalIndex: sequencia([
      validacao(),
      validacao({ index: { revision: "revision-2" }, proof: { revision: "revision-2" } })
    ])
  });
  assert.strictEqual(revisionChanged.decision, "legacy");

  const rewriteAfterPost = decidir({
    fenceSnapshot: sequencia([fenceSnapshot({ epoch: 20 }), fenceSnapshot({ epoch: 20 })])
  });
  assert.strictEqual(rewriteAfterPost.decision, "authority");
}

function testeIntegracaoComSpies() {
  const integracaoObrigatoria = process.env.TERMINAL_INDEX_AUTHORITY_REQUIRE_INTEGRATION === "1";
  let filaOperacional;
  try {
    filaOperacional = require("../modules/fila/fila-operacional-v2");
  } catch (erro) {
    if (erro?.code === "MODULE_NOT_FOUND" && String(erro.message).includes("sharp")) {
      if (integracaoObrigatoria) throw erro;
      console.log("terminal-index-authority-v1: integration SKIP (sharp ausente localmente; gate CI instala dependências)");
      return;
    }
    throw erro;
  }

  let legado = 0;
  let tecnico = 0;
  const leitores = {
    lerHistoricoLegadoCliente() { legado += 1; return { ok: true, historico: [] }; },
    lerItensHistoricoTecnicoParaLeve() { tecnico += 1; return { itens: [] }; }
  };
  const hit = filaOperacional.provarItemTerminalizadoNoHistorico("cliente-canary", { id: "item-1" }, {
    ...coordenada(),
    ...leitores
  });
  assert.strictEqual(hit.provado, true);
  assert.strictEqual(hit.terminalIndexAuthority, true);
  assert.strictEqual(legado, 0);
  assert.strictEqual(tecnico, 0);

  const miss = filaOperacional.provarItemTerminalizadoNoHistorico("cliente-canary", { id: "item-ausente" }, {
    ...coordenada({ validarTerminalIndex: () => validacao({ index: { entries: {} } }) }),
    ...leitores
  });
  assert.strictEqual(miss.provado, false);
  assert.strictEqual(miss.terminalIndexAuthority, true);
  assert.strictEqual(legado, 0);
  assert.strictEqual(tecnico, 0);

  const fallback = filaOperacional.provarItemTerminalizadoNoHistorico("cliente-canary", { id: "item-1" }, {
    ...leitores,
    env: env(),
    agora: Date.now()
  });
  assert.strictEqual(fallback.terminalIndexAuthority, undefined);
  assert.strictEqual(legado, 1);
  assert.strictEqual(tecnico, 1);
  console.log("terminal-index-authority-v1: integration executed");
}

function main() {
  testeFlagsEGates();
  testeFalhasFailClosed();
  testeHitMissSemLeituraPesada();
  testeCorridasPrePos();
  testeIntegracaoComSpies();
  console.log("terminal-index-authority-v1: ok");
}

main();
