"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

process.env.DATA_DIR = path.join(__dirname, "..", ".local-test-tmp", "uf-social-source-empty");
const source = require("../modules/social/universal-opportunities.source");
const storage = require("../modules/social/storage");

const epoch = "2026-10-10T10:00:00.000Z";
const captured = new Date(Date.now() - 5 * 60_000).toISOString();
let mode = "UNIVERSAL";
const payload = {
  titulo: "Oferta comercial", marketplace: "amazon", precoAtual: 99,
  imagem: "https://cdn.example.test/offer.jpg",
  linkAfiliado: "https://go.example.test/offer",
  ofertaUniversal: true, score: 90, status: "pendente"
};
const rows = [
  { id: 1, operation_epoch_started_at: epoch, workspace_id: "ws_a",
    oferta_id: 101, origem_fluxo: "radar", capturado_em: captured,
    item_payload: { ...payload, clienteId: "ws_a" } },
  { id: 2, operation_epoch_started_at: epoch, workspace_id: "ws_b",
    oferta_id: 101, origem_fluxo: "clonador", capturado_em: captured,
    item_payload: { ...payload, clienteId: "ws_b", titulo: "Outra workspace" } },
  { id: 3, operation_epoch_started_at: epoch, workspace_id: "ws_a",
    oferta_id: 102, origem_fluxo: "radar", capturado_em: captured,
    item_payload: { ...payload, clienteId: "ws_a", titulo: "Ja enviada",
      ofertaUniversal: false, score: 40, cupom: "",
      linkAfiliado: "https://go.example.test/offer-102" } },
  { id: 4, operation_epoch_started_at: epoch, workspace_id: "ws_a",
    oferta_id: 103, origem_fluxo: "radar", capturado_em: captured,
    item_payload: { ...payload, clienteId: "ws_a", expiraEm: "2020-01-01T00:00:00.000Z" } },
  { id: 5, operation_epoch_started_at: epoch, workspace_id: "ws_a",
    oferta_id: 104, origem_fluxo: "radar",
    capturado_em: new Date(Date.now() - 31 * 60_000).toISOString(),
    item_payload: { ...payload, clienteId: "ws_a", titulo: "Normal vencida",
      linkAfiliado: "https://go.example.test/offer-104" } }
];
const pool = {
  async query(sql, params) {
    if (sql.includes("FROM engine_operation_state")) {
      return { rows: [{ mode, operation_epoch_started_at: epoch }] };
    }
    assert.match(sql, /operation_epoch_started_at=\$1 AND workspace_id=\$2/);
    let found = rows.filter(row => row.operation_epoch_started_at === params[0] &&
      row.workspace_id === params[1]);
    if (sql.includes("AND id=$3")) found = found.filter(row => String(row.id) === String(params[2]));
    if (sql.includes("oferta_id=$3")) found = found.filter(row => String(row.oferta_id) === String(params[2]));
    return { rows: found };
  }
};
source.configurarFonteUniversalSocial({ getMode: () => mode, getPool: () => pool });

(async () => {
  const a = await storage.listarOportunidadesSocialOperacional("ws_a", 50);
  const b = await storage.listarOportunidadesSocialOperacional("ws_b", 50);
  assert.deepEqual(new Set(a.map(item => item.ofertaId)), new Set(["101", "102"]));
  assert.deepEqual(b.map(item => item.ofertaId), ["101"]);
  assert.equal(a.some(item => item.ofertaId === "legacy_only"), false);
  assert.equal(a.some(item => item.ofertaId === "104"), false);
  assert.equal(a.find(item => item.ofertaId === "101").recenciaConfiavel, true);
  assert.equal(a.find(item => item.ofertaId === "101").criadoEm, captured,
    "Social deve usar o T0 factual, nao o horario de projecao");
  assert.equal((await storage.validarOportunidadeSocialManualOperacional("ws_a", "101")).ok, true);
  assert.equal((await storage.validarOportunidadeSocialManualOperacional("ws_a", "legacy_only")).ok, false);
  assert.equal((await storage.validarOportunidadeSocialManualOperacional("ws_a", "104")).ok, false);
  assert.equal((await source.encontrarItemUniversalSocial("ws_b", "universal_1")), null);

  source.configurarFonteUniversalSocial({ getMode: () => mode,
    getPool: () => ({ query: async () => { throw new Error("db_unavailable"); } }) });
  await assert.rejects(storage.listarOportunidadesSocialOperacional("ws_a"), /db_unavailable/);

  source.configurarFonteUniversalSocial({ getMode: () => mode, getPool: () => pool });

  mode = "LEGACY";
  const legacy = await storage.listarOportunidadesSocialOperacional("ws_a", 50);
  assert.deepEqual(legacy, []);
  console.log("universal_flow_social_opportunities=PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
