"use strict";

// Real Engine runner transitions on isolated local PostgreSQL. Only the
// marketplace adapter's external response is deterministic fixture data.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const root = path.join(__dirname, "..");
const schema = `uf_fair_real_${crypto.randomBytes(6).toString("hex")}`;
process.env.DATA_DIR = path.join(root, ".local-test-tmp", schema);
process.env.PGSSLMODE = "disable";
process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:55433/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
const { projectionDdl, runSteadyLifecycle } =
  require("../modules/engine/lifecycle-steady.candidate");
const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const workspaces = ["ws_dom", ...Array.from({ length: 25 }, (_, i) => `ws_${String(i + 1).padStart(2, "0")}`)];
const integration = { ativo: true, credenciais: { tag: "fixture-tag" } };

async function seed(db, scenario, workspaceId, origin, serial) {
  const url = `https://www.amazon.com.br/dp/B0${String(serial).padStart(8, "0")}`;
  const capturedAt = new Date(Date.now() - 2 * 60000);
  const event = (await db.query(`INSERT INTO engine_eventos_brutos
    (origem,fonte,origem_tipo,sessao_id,grupo_id,texto_original,
     links_extraidos,marketplace_detectado,hash_evento,metadata,capturado_em)
    VALUES ($1,$1,'whatsapp','fixture','fixture', 'Produto ' || $2,
      jsonb_build_array($3::text),'amazon',$4,$5::jsonb,$6)
    RETURNING id`, [origin, scenario, url, `${scenario}:${serial}`,
    JSON.stringify({ origemFluxo: origin === "clonador_grupos" ? origin : "optimus" }),
    capturedAt])).rows[0];
  await db.query(`INSERT INTO engine_links
    (evento_id,url_original,url_normalizada,url_expandida,marketplace_detectado)
    VALUES ($1,$2,$2,$2,'amazon')`, [event.id, url]);
  const job = (await db.query(`INSERT INTO engine_jobs_cliente
    (evento_id,cliente_id,marketplace_detectado,marketplace,status,metadata)
    VALUES ($1,$2,'amazon','amazon','pendente',$3::jsonb) RETURNING id`,
  [event.id, workspaceId, JSON.stringify({ origemFluxo: origin === "clonador_grupos" ? origin : "optimus" })])).rows[0];
  return { id: String(job.id), workspaceId, origin, scenario };
}

async function run() {
  const db = new Client(config);
  let installed = false;
  let enginePool;
  const nativeLog = console.log;
  try {
    await db.connect();
    const identity = (await db.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    await db.query(`CREATE SCHEMA ${schema}`); installed = true;
    await db.query(`SET search_path TO ${schema},public`);
    for (const file of ["schema.sql", "admission-gate.candidate.sql"]) {
      await db.query(fs.readFileSync(path.join(root, "modules", "engine", file), "utf8"));
    }
    await db.query(projectionDdl());
    await db.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,300,0,'UNKNOWN',NULL,interval '5 minutes')`);
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    require("../utils/storage").writeGlobalJson("usuarios.json",
      workspaces.map(id => ({ id, ativo: true, plano: "pro" })));
    const { getEnginePool } = require("../modules/engine/database");
    enginePool = getEnginePool();
    const lifecycle = await runSteadyLifecycle({ pool: enginePool, limit: 4 });
    assert.equal(lifecycle.ok, true);
    await db.query(`UPDATE engine_hot_admission_control
      SET health='HEALTHY',lifecycle_last_success=NOW() WHERE id=1`);
    const { processarJobsPendentesEngine } = require("../modules/engine/processor.runner");
    const { validarJobsDiagnosticadosEngine } = require("../modules/engine/validator.runner");
    const { importarJobsProntosEngine } = require("../modules/engine/importer/importer.runner");
    const integrations = Object.fromEntries(workspaces.map(id => [id, { amazon: integration }]));
    const validWorkspace = () => ({ elegivelEngine: true });
    const importerDeps = {
      getIntegracaoCliente: () => integration,
      importarAmazon: async url => ({ titulo: "Fone Bluetooth Premium com Estojo",
        precoAtual: 199.9, precoOriginal: 249.9,
        imagem: "https://example.invalid/fixture-image.jpg",
        linkOriginal: url, linkAfiliado: `${url}?tag=fixture-tag`,
        categoria: "Eletronicos" })
    };
    let serial = 1;
    async function pass(limit) {
      const processor = await processarJobsPendentesEngine({ limite: limit,
        clientesValidos: workspaces, avaliarWorkspaceParaEngine: validWorkspace });
      const validator = await validarJobsDiagnosticadosEngine({ limite: limit,
        clientesValidos: workspaces, avaliarWorkspaceParaEngine: validWorkspace,
        integracoesPorCliente: integrations });
      const importer = await importarJobsProntosEngine({ limite: limit,
        marketplace: "amazon", deps: importerDeps });
      assert.equal(processor.erros, 0, JSON.stringify(processor));
      assert.equal(validator.erro_validacao, 0, JSON.stringify(validator));
      assert.equal(importer.erros, 0, JSON.stringify(importer));
      return { processor: processor.diagnosticados,
        validator: validator.pronto_para_importar,
        importer: importer.ofertaCriada };
    }
    async function states(items) {
      const rows = (await db.query(`SELECT id,cliente_id,status,
        metadata->>'origemFluxo' AS origem_fluxo,oferta_id
        FROM engine_jobs_cliente WHERE id=ANY($1::bigint[])`,
      [items.map(item => item.id)])).rows;
      assert.equal(rows.length, items.length);
      return rows;
    }
    console.log = () => {};
    const results = {};
    for (const [name, n, limit] of [["eight_two", 8, 2], ["twentyfive_one", 25, 1]]) {
      const items = [];
      for (let i = 0; i < n; i++) {
        items.push(await seed(db, name, workspaces[i + 1],
          i % 2 ? "clonador_grupos" : "radar", serial++));
      }
      const rounds = [];
      for (let i = 0; i < Math.ceil(n / limit); i++) rounds.push(await pass(limit));
      const actual = await states(items);
      assert(actual.every(row => row.status === "oferta_criada" && row.oferta_id));
      assert(actual.some(row => row.origem_fluxo === "optimus"));
      assert(actual.some(row => row.origem_fluxo === "clonador_grupos"));
      assert(rounds.every(row => row.processor === limit &&
        row.validator === limit && row.importer === limit));
      results[name] = { jobs: n, slots: limit, rounds: rounds.length,
        sameIdsCompleted: actual.length };
    }
    const dominant = [];
    const small = [];
    for (let i = 0; i < 8; i++) small.push(await seed(db, "dominant_small",
      workspaces[i + 1], i % 2 ? "clonador_grupos" : "radar", serial++));
    for (let i = 0; i < 20; i++) dominant.push(await seed(db, "dominant_small",
      "ws_dom", "radar", serial++));
    for (let i = 0; i < 18; i++) {
      await pass(2);
      dominant.push(await seed(db, "dominant_small", "ws_dom", "radar", serial++));
    }
    const smallStates = await states(small);
    assert(smallStates.every(row => row.status === "oferta_criada" && row.oferta_id));
    results.dominantSmall = { smallCompleted: smallStates.length,
      dominantContinuouslyReplenished: true };
    const remainingDominant = (await states(dominant))
      .filter(row => row.status !== "oferta_criada").length;
    results.dominantSmall.remainingDominant = remainingDominant;
    // Clear the earlier workspace backlog so origin scenarios exercise only
    // the jobs seeded below, with the same runner transitions at every stage.
    for (let i = 0; i < 4; i++) await pass(20);
    assert((await states(dominant)).every(row => row.status === "oferta_criada"));
    for (const [name, heavy, light] of [
      ["optimus_heavy_clonador_light", "radar", "clonador_grupos"],
      ["clonador_heavy_optimus_light", "clonador_grupos", "radar"]
    ]) {
      const items = [];
      for (let i = 0; i < 10; i++) items.push(await seed(db, name, "ws_01", heavy, serial++));
      const lightItem = await seed(db, name, "ws_01", light, serial++);
      items.push(lightItem);
      await pass(1);
      await pass(1);
      const afterTwo = await states(items);
      assert.equal(afterTwo.find(row => String(row.id) === lightItem.id).status,
        "oferta_criada", `${name}: light origin did not progress within two rounds`);
      for (let i = 0; i < 9; i++) await pass(1);
      assert((await states(items)).every(row => row.status === "oferta_criada"));
      results[name] = { jobs: items.length, lightCompletedWithinRounds: 2,
        sameIdsCompleted: items.length };
    }
    for (const [name, origin] of [
      ["optimus_only", "radar"], ["clonador_only", "clonador_grupos"]
    ]) {
      const items = [];
      for (let i = 0; i < 4; i++) items.push(await seed(db, name, "ws_01", origin, serial++));
      for (let i = 0; i < 4; i++) {
        const counts = await pass(1);
        assert.deepEqual(counts, { processor: 1, validator: 1, importer: 1 });
      }
      assert((await states(items)).every(row => row.status === "oferta_criada"));
      results[name] = { jobs: items.length, sameIdsCompleted: items.length,
        wastedRounds: 0 };
    }
    console.log = nativeLog;
    nativeLog(JSON.stringify({ candidate: "fairness_real_runner_transitions",
      results, manualStatusChanges: 0, externalMarketplaceCalls: 0 }));
  } finally {
    console.log = nativeLog;
    if (enginePool) await enginePool.end().catch(() => {});
    if (installed) await db.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await db.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
