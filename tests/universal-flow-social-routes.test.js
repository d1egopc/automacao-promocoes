"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
process.env.DATA_DIR = path.join(__dirname, "..", ".local-test-tmp", "uf-social-routes-empty");
const express = require("express");
const fonte = require("../modules/social/universal-opportunities.source");
const criarRotasSocial = require("../modules/social/routes");
const { carregarOfertaClienteOperacional } = require("../modules/social/instagram");

const epoch = "2026-10-10T10:00:00.000Z";
let fail = false;
fonte.configurarFonteUniversalSocial({ getMode: () => "UNIVERSAL", getPool: () => ({
  async query(sql, params) {
    if (fail) throw new Error("db_unavailable");
    if (sql.includes("FROM engine_operation_state")) {
      return { rows: [{ mode: "UNIVERSAL", operation_epoch_started_at: epoch }] };
    }
    return { rows: params?.[1] === "ws_a" ? [{
      id: 11, operation_epoch_started_at: epoch, oferta_id: 101,
      origem_fluxo: "radar", capturado_em: new Date(Date.now() - 60_000).toISOString(),
      item_payload: { clienteId: "ws_a", titulo: "Pendente no PostgreSQL",
        marketplace: "amazon", precoAtual: 90, imagem: "https://cdn.test/x.jpg",
        linkAfiliado: "https://go.test/x", status: "pendente" }
    }] : [] };
  }
}) });

(async () => {
  const app = express();
  app.use(express.json());
  app.use("/social", criarRotasSocial({
    getClienteId: req => req.headers["x-workspace"],
    usuarioTemRecurso: () => true
  }));
  const server = await new Promise(resolve => {
    const current = app.listen(0, "127.0.0.1", () => resolve(current));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async workspace => fetch(`${base}/social/oportunidades`, {
      headers: { "x-workspace": workspace }
    });
    const a = await get("ws_a");
    assert.equal(a.status, 200);
    assert.deepEqual((await a.json()).oportunidades.map(item => item.ofertaId), ["101"]);
    const b = await get("ws_b");
    assert.equal((await b.json()).total, 0);
    const ofertaInstagram = await carregarOfertaClienteOperacional("ws_a", "101");
    assert.equal(ofertaInstagram.linkAfiliado, "https://go.test/x");
    await assert.rejects(carregarOfertaClienteOperacional("ws_b", "101"),
      /oferta_nao_encontrada/);
    const simulation = await fetch(`${base}/social/automatico/simular`, {
      method: "POST", headers: { "x-workspace": "ws_a" }
    });
    assert.equal((await simulation.json()).ok, true);
    fail = true;
    const unavailable = await get("ws_a");
    assert.equal(unavailable.status, 503);
    console.log("universal_flow_social_routes=PASS");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
