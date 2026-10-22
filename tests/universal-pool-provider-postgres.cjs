"use strict";

const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { criarPreflightFilaUniversal } = require("../modules/engine/universal-queue-preflight");
const { criarCallbackFilaUniversal } = require("../modules/engine/universal-queue-distributor.adapter");

async function main() {
  const url = process.env.POOL_PROVIDER_TEST_DATABASE_URL;
  if (!url) throw new Error("disposable_database_required");
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(parsed.pathname, "/optimus_universal_fixture");
  const first = new Pool({ connectionString: url });
  const second = new Pool({ connectionString: url });
  let active = first;
  const now = Date.parse("2026-10-10T12:30:00Z");
  const passed = async () => ({ ok: true });
  let admissions = 0;
  const preflight = criarPreflightFilaUniversal({ pool: first, getPool: () => active,
    now: () => now, readClock: async ({ pool }) => {
      const result = await pool.query("SELECT current_setting('server_version_num')::int AS version");
      assert.ok(result.rows[0].version >= 170000);
      return null;
    }, resolveDestination: async () => ({ ok: true,
      destination: { id: "d1", tipo: "whatsapp", intervaloMinutos: 2.5 } }),
    checkWindow: passed, checkDailyLimit: passed, checkSession: passed,
    checkCredits: passed, checkMedia: passed, checkLinks: passed,
    checkDedup: passed, renderMessage: async () => ({ ok: true, message: "fixture" }) });
  const distributor = criarCallbackFilaUniversal({ pool: first, getPool: () => active,
    enqueueFn: async ({ pool }) => {
      await pool.query("SELECT 1");
      admissions += 1;
      return { itemId: admissions, operationEpochStartedAt: "2026-10-10T11:00:00Z" };
    } });
  const claim = { workspace_id: "ws_A", destination_id: "d1",
    capturado_em: "2026-10-10T12:10:00Z",
    operationEpochStartedAt: "2026-10-10T11:00:00Z",
    evento_id: 1, oferta_id: 2, origem_fluxo: "optimus",
    item_payload: { clienteId: "ws_A", engineOfertaId: 2,
      marketplace: "mercadolivre", titulo: "Fixture" } };
  const item = { clienteId: "ws_A", engineOfertaId: 2, engineJobId: 3 };
  const context = { oferta: { id: 2, job_id: 3 },
    destinosCompativeis: [{ id: "d1", tipo: "whatsapp",
      alvos: [{ grupoId: "fixture", sessao: "fixture" }] }] };
  try {
    assert.equal((await preflight(claim)).ready, true);
    assert.equal((await distributor("ws_A", item, context)).ok, true);
    await first.end();
    active = second;
    assert.equal((await preflight(claim)).ready, true);
    assert.equal((await distributor("ws_A", item, context)).ok, true);
    assert.equal(admissions, 2);
    active = first;
    await assert.rejects(preflight(claim), /Cannot use a pool after calling end on the pool/);
    const failed = await distributor("ws_A", item, context);
    assert.equal(failed.ok, false);
    assert.equal(admissions, 2);
    active = second;
    assert.equal((await preflight(claim)).ready, true);
    assert.equal((await distributor("ws_A", item, context)).ok, true);
    assert.equal(admissions, 3);
    console.log("PG17_POOL_ROTATION_PASS");
  } finally {
    await first.end().catch(() => {});
    await second.end().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
