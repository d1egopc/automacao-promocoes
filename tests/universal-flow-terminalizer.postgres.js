"use strict";

// Todas as tabelas gravadas por este teste sao TEMP e somem ao encerrar a sessao.
const assert = require("node:assert/strict");
const path = require("node:path");
const { Client } = require("pg");
const { terminalizarJobsPreImporter, sqlElegibilidadeTerminalizer, STATUS_TERMINALIZAVEIS } =
  require("../modules/engine/terminalizer-pre-importer.service");
const { sqlFrescorComercialPreImporter } = require("../modules/engine/frescor-pre-importer.service");
const { buscarReposicaoGrupoPreImporter } = require("../modules/engine/fairness-slot-pre-importer.service");
const { montarGruposFairness, reivindicarSlotFairness } = require("../modules/engine/processor-fairness.service");
const importerFairness = require("../modules/engine/importer/importer-fairness.service");

async function inserir(client, id, workspace, ageMin, metadata = {}, status = "pendente") {
  const capturadoEm = new Date(Date.now() - ageMin * 60000);
  await client.query(
    `INSERT INTO engine_eventos_brutos (id, origem, origem_tipo, metadata, capturado_em)
     VALUES ($1, 'synthetic_terminalizer', 'synthetic', '{}'::jsonb, $2)`,
    [id, capturadoEm]
  );
  await client.query(
    `INSERT INTO engine_jobs_cliente (id, evento_id, cliente_id, status, metadata, criado_em)
     VALUES ($1, $1, $2, $3, $4::jsonb, $5)`,
    [id, workspace, status, JSON.stringify(metadata), capturadoEm]
  );
}

(async () => {
  const client = new Client({ host: "127.0.0.1", port: 55433, user: "postgres",
    database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const identity = (await client.query("SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS data_dir")).rows[0];
    assert.equal(identity.db, "optimus_universal_fixture");
    assert.equal(identity.host, "127.0.0.1");
    assert.equal(identity.port, 55433);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    for (const table of ["engine_eventos_brutos", "engine_jobs_cliente", "engine_fairness_origem_fluxo",
      "engine_processamentos", "engine_eventos_comerciais"]) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    let terminalizerSelection = null;
    let afterTerminalizerSelection = null;
    const pool = { connect: async () => ({ query: async (...args) => {
      const result = await client.query(...args);
      if (/^WITH heads AS MATERIALIZED/i.test(String(args[0]).trim())) {
        terminalizerSelection = args;
        if (afterTerminalizerSelection) await afterTerminalizerSelection();
      }
      return result;
    }, release() {} }) };
    for (let i = 0; i < 8; i += 1) await inserir(client, 1000 + i, `ws_${i}`, 60);
    const servido = new Set();
    for (let round = 0; round < 4; round += 1) {
      const result = await terminalizarJobsPreImporter({ limite: 2, pool });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.terminalizados.length, 2);
      for (const job of result.terminalizados) servido.add(job.cliente_id);
    }
    assert.equal(servido.size, 8);
    const replay = await terminalizarJobsPreImporter({ limite: 2, pool });
    assert.equal(replay.ok, true);
    assert.equal(replay.terminalizados.length, 0);
    const facts = (await client.query(`SELECT
      (SELECT COUNT(*)::int FROM engine_jobs_cliente WHERE status='expirada_operacional') AS jobs,
      (SELECT COUNT(*)::int FROM engine_processamentos) AS processamentos,
      (SELECT COUNT(*)::int FROM engine_eventos_comerciais) AS eventos`)).rows[0];
    assert.deepEqual(facts, { jobs: 8, processamentos: 8, eventos: 8 });

    await inserir(client, 2001, "manual", 120, { manualV2: true });
    await inserir(client, 2002, "turbo", 12, { tipoFluxo: " cupom_turbo " });
    await inserir(client, 2003, "retry_futuro", 60,
      { localWorkerImageRetry: { proximaTentativaEmMs: String(Date.now() + 3600000) } },
      "pronto_para_importar");
    await inserir(client, 2004, "normal_vivo", 1);
    const special = await terminalizarJobsPreImporter({ limite: 10, pool });
    assert.equal(special.ok, true, JSON.stringify(special));
    assert.deepEqual(special.terminalizados.map(job => Number(job.id)), [2002]);
    const terminal = (await client.query(`SELECT criado_em, metadata->>'terminalOcorridoEm' AS terminal_em,
      status FROM engine_jobs_cliente WHERE id=2002`)).rows[0];
    assert.equal(terminal.status, "expirada_operacional");
    assert(new Date(terminal.terminal_em) > new Date(terminal.criado_em));

    await inserir(client, 2010, "manual_after_select", 60);
    await inserir(client, 2011, "retry_after_select", 60, {}, "pronto_para_importar");
    afterTerminalizerSelection = async () => {
      await client.query("UPDATE engine_jobs_cliente SET metadata=metadata || '{\"manualV2\":true}'::jsonb WHERE id=2010");
      await client.query("UPDATE engine_jobs_cliente SET metadata=metadata || jsonb_build_object('localWorkerImageRetry', jsonb_build_object('proximaTentativaEmMs', $1::text)) WHERE id=2011", [String(Date.now() + 3600000)]);
    };
    const mudaramDepoisDaSelecao = await terminalizarJobsPreImporter({ limite: 10, pool });
    afterTerminalizerSelection = null;
    assert.equal(mudaramDepoisDaSelecao.ok, true, JSON.stringify(mudaramDepoisDaSelecao));
    assert.equal(mudaramDepoisDaSelecao.terminalizados.length, 0,
      "Manual e retry futuro apos selecao nao podem ser terminalizados");
    const protegidos = (await client.query("SELECT id, status FROM engine_jobs_cliente WHERE id IN (2010,2011) ORDER BY id")).rows;
    assert.deepEqual(protegidos.map(job => job.status), ["pendente", "pronto_para_importar"]);

    await inserir(client, 3001, "ttl_cross", 1, { origemFluxo: "optimus" });
    await inserir(client, 3002, "ttl_cross", 29.99, { origemFluxo: "optimus" });
    await inserir(client, 3003, "ttl_cross", 1, { origemFluxo: "optimus" });
    const baseJob = (id, indiceBaseline) => ({ id, cliente_id: "ttl_cross", origemFluxo: "optimus",
      lane_vazao_pre_importer: "agua_nova", indiceBaseline });
    const grupo = montarGruposFairness([baseJob(3001, 0), baseJob(3002, 1)],
      [baseJob(3001, 0), baseJob(3002, 1), baseJob(3003, 2)])[0];
    const primeiro = await reivindicarSlotFairness(grupo, 0, { pool });
    assert.equal(primeiro.ok, true, JSON.stringify(primeiro));
    assert.equal(Number(primeiro.job?.id), 3001);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const segundo = await reivindicarSlotFairness(grupo, 1, {
      pool, plano: primeiro.plano, idsReservados: new Set([3001])
    });
    assert.equal(segundo.ok, true, JSON.stringify(segundo));
    assert.equal(Number(segundo.job?.id), 3003, "slot vencido deve receber candidato vivo da mesma workspace");
    const vencido = (await client.query("SELECT status FROM engine_jobs_cliente WHERE id=3002")).rows[0];
    assert.equal(vencido.status, "pendente", "tentativa de claim vencida deve ser revertida");

    const origemJob = (id, workspace, origem, indiceBaseline = 0) => ({ id, cliente_id: workspace,
      origemFluxo: origem, origemFluxoHead: true, lane_vazao_pre_importer: "agua_nova", indiceBaseline });
    await inserir(client, 4001, "origin_alt", 1, { origemFluxo: "optimus" });
    await inserir(client, 4002, "origin_alt", 1, { origemFluxo: "clonador_grupos" });
    const grupoA = montarGruposFairness([origemJob(4001, "origin_alt", "optimus")],
      [origemJob(4001, "origin_alt", "optimus"), origemJob(4002, "origin_alt", "clonador_grupos")])[0];
    const origemA = await reivindicarSlotFairness(grupoA, 0, { pool });
    assert.equal(Number(origemA.job?.id), 4001, JSON.stringify(origemA));
    await inserir(client, 4003, "origin_alt", 1, { origemFluxo: "optimus" });
    const grupoB = montarGruposFairness([origemJob(4003, "origin_alt", "optimus")],
      [origemJob(4003, "origin_alt", "optimus"), origemJob(4002, "origin_alt", "clonador_grupos")])[0];
    const origemB = await reivindicarSlotFairness(grupoB, 0, { pool });
    assert.equal(Number(origemB.job?.id), 4002, JSON.stringify(origemB));
    for (const [id, workspace, origem] of [[4011, "only_clone", "clonador_grupos"],
      [4012, "only_optimus", "optimus"]]) {
      await inserir(client, id, workspace, 1, { origemFluxo: origem });
      const item = origemJob(id, workspace, origem);
      const grupoUnico = montarGruposFairness([item], [item])[0];
      const saida = await reivindicarSlotFairness(grupoUnico, 0, { pool });
      assert.equal(Number(saida.job?.id), id, JSON.stringify(saida));
    }

    await inserir(client, 5001, "importer_retry_recheck", 1, {}, "pronto_para_importar");
    await inserir(client, 5002, "importer_retry_recheck", 1, {}, "pronto_para_importar");
    const importerJob = (id, indiceBaseline) => ({ id, cliente_id: "importer_retry_recheck",
      marketplace: "mercadolivre", origemFluxo: "optimus", lane_vazao_pre_importer: "agua_nova",
      indiceBaseline, workspace_rank_pre_importer: indiceBaseline + 1 });
    const importerGrupo = importerFairness.montarGruposFairness([importerJob(5001, 0)],
      [importerJob(5001, 0), importerJob(5002, 1)])[0];
    await client.query(`UPDATE engine_jobs_cliente SET metadata=jsonb_build_object(
      'localWorkerImageRetry', jsonb_build_object('proximaTentativaEmMs', $2::text)) WHERE id=$1`,
    [5001, String(Date.now() + 3600000)]);
    const importerReposto = await importerFairness.reivindicarSlotFairness(importerGrupo, 0, { pool });
    assert.equal(Number(importerReposto.job?.id), 5002, JSON.stringify(importerReposto));
    assert.equal((await client.query("SELECT status FROM engine_jobs_cliente WHERE id=5001")).rows[0].status,
      "pronto_para_importar", "retry futuro na hora do claim deve ser revertido");
    console.log("UNIVERSAL_TERMINALIZER " + JSON.stringify({
      workspaces8Slots2: servido.size, facts, replay: replay.terminalizados.length,
      turboDead: special.terminalizados.length, terminalMarker: Boolean(terminal.terminal_em),
      ttlCrossReplacement: Number(segundo.job.id), originAlternation: [Number(origemA.job.id), Number(origemB.job.id)],
      onlyCloneAndOptimus: true, importerRetryRecheckReplacement: Number(importerReposto.job.id)
    }));

    if (process.argv.includes("--with-100k")) {
      for (const table of ["engine_eventos_comerciais", "engine_processamentos", "engine_fairness_origem_fluxo",
        "engine_jobs_cliente", "engine_eventos_brutos"]) await client.query(`TRUNCATE ${table}`);
      await client.query(`INSERT INTO engine_eventos_brutos
        SELECT e.* FROM public.engine_eventos_brutos e
        WHERE e.metadata->>'fixtureKind'='legacy_expired'`);
      await client.query(`INSERT INTO engine_jobs_cliente
        SELECT j.* FROM public.engine_jobs_cliente j
        JOIN public.engine_eventos_brutos e ON e.id=j.evento_id
        WHERE e.metadata->>'fixtureKind'='legacy_expired'`);
      await client.query("ANALYZE engine_eventos_brutos");
      await client.query("ANALYZE engine_jobs_cliente");
      const before = (await client.query("SELECT COUNT(*)::int AS n FROM engine_jobs_cliente WHERE status='pendente'")).rows[0].n;
      assert.equal(before, 100000);
      const start = performance.now();
      const batch = await terminalizarJobsPreImporter({ limite: 10, pool });
      const elapsedMs = Math.round(performance.now() - start);
      assert.equal(batch.ok, true, JSON.stringify(batch));
      assert.equal(batch.terminalizados.length, 10);
      assert.equal(new Set(batch.terminalizados.map(job => job.cliente_id)).size, 10);
      const after = (await client.query("SELECT COUNT(*)::int AS n FROM engine_jobs_cliente WHERE status='pendente'")).rows[0].n;
      assert.equal(after, 99990);
      assert(terminalizerSelection, "terminalizer selection SQL must be captured");
      const explain = (await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${terminalizerSelection[0]}`,
        terminalizerSelection[1]
      )).rows[0]["QUERY PLAN"][0];
      const nodes = [];
      function visit(plan) {
        nodes.push({ type: plan["Node Type"], actualRows: plan["Actual Rows"], loops: plan["Actual Loops"],
          rowsRemovedByFilter: plan["Rows Removed by Filter"] || 0,
          sharedHit: plan["Shared Hit Blocks"] || 0, sharedRead: plan["Shared Read Blocks"] || 0,
          tempRead: plan["Temp Read Blocks"] || 0, tempWritten: plan["Temp Written Blocks"] || 0 });
        for (const child of plan.Plans || []) visit(child);
      }
      visit(explain.Plan);
      console.log("UNIVERSAL_TERMINALIZER_100K_PLAN " + JSON.stringify({
        planningTimeMs: explain["Planning Time"], executionTimeMs: explain["Execution Time"],
        nodes
      }));
      console.log("UNIVERSAL_TERMINALIZER_100K " + JSON.stringify({ before, after, batch: 10,
        elapsedMs, bootstrapMs: batch.bootstrapMs, selecaoMs: batch.selecaoMs }));
    }

    if (process.argv.includes("--compare-architectures")) {
      // A1: prazo indexado + fairness existente sem disponibilidade projetada.
      // A2: mesma tabela de fairness, com prazo do proximo vivo como projeção minima.
      // B: head separado. Tudo neste schema TEMP, sem integrar writers de produto.
      for (const table of ["engine_eventos_comerciais", "engine_processamentos", "engine_fairness_origem_fluxo",
        "engine_jobs_cliente", "engine_eventos_brutos"]) await client.query(`TRUNCATE ${table}`);
      await client.query(`INSERT INTO engine_eventos_brutos SELECT e.*
        FROM public.engine_eventos_brutos e WHERE e.metadata->>'fixtureKind'='legacy_expired'`);
      await client.query(`INSERT INTO engine_jobs_cliente SELECT j.*
        FROM public.engine_jobs_cliente j JOIN public.engine_eventos_brutos e ON e.id=j.evento_id
        WHERE e.metadata->>'fixtureKind'='legacy_expired'`);
      assert.equal((await client.query("SELECT COUNT(*)::int AS n FROM engine_jobs_cliente")).rows[0].n, 100000);
      await client.query("ALTER TABLE engine_jobs_cliente ADD COLUMN expira_comercial_em timestamptz");
      const frescor = sqlFrescorComercialPreImporter("j", "e");
      const vivos = (await client.query("SELECT id FROM engine_jobs_cliente ORDER BY id DESC LIMIT 4"))
        .rows.map(row => Number(row.id));
      await client.query("UPDATE engine_jobs_cliente SET metadata='{}'::jsonb WHERE id=ANY($1::bigint[])", [vivos]);
      await client.query(`UPDATE engine_eventos_brutos SET capturado_em=NOW()-INTERVAL '1 minute',
        metadata='{}'::jsonb,origem='synthetic_normal',origem_tipo='synthetic_normal'
        WHERE id IN (SELECT evento_id FROM engine_jobs_cliente WHERE id=ANY($1::bigint[]))`, [vivos]);
      await client.query(`UPDATE engine_jobs_cliente j SET expira_comercial_em=
        CASE WHEN ${frescor.manual} THEN NULL ELSE ${frescor.expiraEm} END
        FROM engine_eventos_brutos e WHERE e.id=j.evento_id`);
      await client.query(`CREATE INDEX uf_compare_ws_expiry_idx ON engine_jobs_cliente
        (cliente_id,expira_comercial_em DESC,id DESC)
        WHERE status='pendente' AND expira_comercial_em IS NOT NULL`);
      await client.query("UPDATE engine_jobs_cliente SET cliente_id='hot_ws'");
      await client.query("VACUUM (ANALYZE) engine_jobs_cliente");
      const concentratedSql = `SELECT id FROM engine_jobs_cliente
        WHERE cliente_id='hot_ws' AND status='pendente' AND expira_comercial_em>NOW()
        ORDER BY expira_comercial_em DESC,id DESC LIMIT $1`;
      const concentrated = [];
      for (const limit of [1, 2, 4]) {
        const rows = (await client.query(concentratedSql, [limit])).rows.map(row => Number(row.id));
        assert.equal(rows.length, limit);
        const plan = (await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${concentratedSql}`,
          [limit])).rows[0]["QUERY PLAN"][0];
        concentrated.push({ limit, rows, planningMs: plan["Planning Time"],
          executionMs: plan["Execution Time"], root: plan.Plan["Node Type"],
          childIndex: plan.Plan.Plans?.[0]?.["Index Name"] || plan.Plan["Index Name"] || null });
      }
      const highPriorityId = Number((await client.query(
        "SELECT id FROM engine_jobs_cliente ORDER BY id DESC OFFSET 4 LIMIT 1"
      )).rows[0].id);
      await client.query("UPDATE engine_jobs_cliente SET metadata='{}'::jsonb,prioridade=100 WHERE id=$1", [highPriorityId]);
      await client.query(`UPDATE engine_eventos_brutos SET capturado_em=NOW()-INTERVAL '4 minutes',
        metadata='{}'::jsonb,origem='synthetic_normal',origem_tipo='synthetic_normal'
        WHERE id=(SELECT evento_id FROM engine_jobs_cliente WHERE id=$1)`, [highPriorityId]);
      await client.query(`UPDATE engine_jobs_cliente j SET expira_comercial_em=
        CASE WHEN ${frescor.manual} THEN NULL ELSE ${frescor.expiraEm} END
        FROM engine_eventos_brutos e WHERE e.id=j.evento_id AND j.id=$1`, [highPriorityId]);
      const canonical = await buscarReposicaoGrupoPreImporter(client,
        { clienteId: "hot_ws", lane: "agua_nova" }, "pendente", []);
      const expiryPrefix = (await client.query(concentratedSql, [4])).rows.map(row => Number(row.id));
      assert(canonical.some(row => Number(row.id) === highPriorityId));
      assert(!expiryPrefix.includes(highPriorityId));
      const priorityCounterexample = { highPriorityId,
        canonicalIds: canonical.map(row => Number(row.id)), expiryPrefixIds: expiryPrefix };
      await client.query("UPDATE engine_jobs_cliente SET prioridade=0 WHERE id=$1", [highPriorityId]);
      await client.query(`UPDATE engine_eventos_brutos SET capturado_em=NOW()-INTERVAL '2 days'
        WHERE id=(SELECT evento_id FROM engine_jobs_cliente WHERE id=$1)`, [highPriorityId]);
      await client.query(`UPDATE engine_jobs_cliente j SET expira_comercial_em=
        CASE WHEN ${frescor.manual} THEN NULL ELSE ${frescor.expiraEm} END
        FROM engine_eventos_brutos e WHERE e.id=j.evento_id AND j.id=$1`, [highPriorityId]);

      await client.query("UPDATE engine_jobs_cliente SET cliente_id='dist_ws_'||LPAD(id::text,12,'0')");
      await client.query("VACUUM (ANALYZE) engine_jobs_cliente");
      await client.query(`INSERT INTO engine_fairness_origem_fluxo (cliente_id,etapa,lane)
        SELECT cliente_id,'diagnostico_final','agua_nova' FROM engine_jobs_cliente`);
      await client.query("ALTER TABLE engine_fairness_origem_fluxo ADD COLUMN proximo_vivo_em timestamptz");
      await client.query(`UPDATE engine_fairness_origem_fluxo f SET proximo_vivo_em=j.expira_comercial_em
        FROM engine_jobs_cliente j WHERE j.cliente_id=f.cliente_id
          AND j.status='pendente' AND j.expira_comercial_em>NOW()`);
      await client.query(`CREATE INDEX uf_compare_fair_ready_idx ON engine_fairness_origem_fluxo
        (etapa,lane,ultimo_atendimento_em ASC NULLS FIRST,cliente_id)
        WHERE proximo_vivo_em IS NOT NULL`);
      await client.query("VACUUM (ANALYZE) engine_fairness_origem_fluxo");
      await client.query(`CREATE TEMP TABLE uf_compare_heads AS SELECT cliente_id,
        (proximo_vivo_em>NOW()) AS pronto,ultimo_atendimento_em
        FROM engine_fairness_origem_fluxo`);
      await client.query("ALTER TABLE uf_compare_heads ADD PRIMARY KEY(cliente_id)");
      await client.query(`CREATE INDEX uf_compare_head_ready_idx ON uf_compare_heads
        (ultimo_atendimento_em ASC NULLS FIRST,cliente_id) WHERE pronto`);
      await client.query("ANALYZE uf_compare_heads");

      const nextJob = `SELECT j.id FROM engine_jobs_cliente j
        WHERE j.cliente_id=f.cliente_id AND j.status='pendente'
          AND j.expira_comercial_em>NOW()
        ORDER BY j.expira_comercial_em DESC,j.id DESC LIMIT 1`;
      const noProjectionSql = `SELECT f.cliente_id,j.id FROM engine_fairness_origem_fluxo f
        CROSS JOIN LATERAL (${nextJob}) j
        WHERE f.etapa='diagnostico_final' AND f.lane='agua_nova'
        ORDER BY f.ultimo_atendimento_em ASC NULLS FIRST,f.cliente_id LIMIT 4`;
      const fairProjectionSql = `SELECT f.cliente_id,j.id FROM engine_fairness_origem_fluxo f
        CROSS JOIN LATERAL (${nextJob}) j
        WHERE f.etapa='diagnostico_final' AND f.lane='agua_nova'
          AND f.proximo_vivo_em>NOW()
        ORDER BY f.ultimo_atendimento_em ASC NULLS FIRST,f.cliente_id LIMIT 4`;
      const headSql = `SELECT h.cliente_id,j.id FROM uf_compare_heads h
        CROSS JOIN LATERAL (SELECT j.id FROM engine_jobs_cliente j
          WHERE j.cliente_id=h.cliente_id AND j.status='pendente'
            AND j.expira_comercial_em>NOW()
          ORDER BY j.expira_comercial_em DESC,j.id DESC LIMIT 1) j
        WHERE h.pronto ORDER BY h.ultimo_atendimento_em ASC NULLS FIRST,h.cliente_id LIMIT 4`;
      async function comparePlan(label, sql, expectIds = vivos) {
        const rows = (await client.query(sql)).rows;
        assert.equal(rows.length, 4);
        assert.equal(new Set(rows.map(row => Number(row.id))).size, 4);
        if (expectIds) assert.deepEqual(new Set(rows.map(row => Number(row.id))), new Set(expectIds));
        const plan = (await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`))
          .rows[0]["QUERY PLAN"][0];
        const scans = [];
        const walk = node => {
          if (/Scan$/.test(node["Node Type"])) scans.push({ type: node["Node Type"],
            relation: node["Relation Name"] || null, index: node["Index Name"] || null,
            rows: node["Actual Rows"], loops: node["Actual Loops"],
            filtered: node["Rows Removed by Filter"] || 0 });
          for (const child of node.Plans || []) walk(child);
        };
        walk(plan.Plan);
        return { label, planningMs: plan["Planning Time"], executionMs: plan["Execution Time"],
          tempRead: plan.Plan["Temp Read Blocks"] || 0, tempWritten: plan.Plan["Temp Written Blocks"] || 0,
          scans };
      }
      const distributed = [];
      await client.query("SET statement_timeout='20000ms'");
      try {
        distributed.push(await comparePlan("A1_existing_fairness_no_ready_projection", noProjectionSql));
      } catch (error) {
        if (error.code !== "57014") throw error;
        distributed.push({ label: "A1_existing_fairness_no_ready_projection", timedOutMs: 20000 });
      } finally {
        await client.query("SET statement_timeout=0");
      }
      distributed.push(await comparePlan("A2_existing_fairness_with_ready_projection", fairProjectionSql));
      distributed.push(await comparePlan("B_separate_head", headSql));
      // Passagem do tempo nao atualiza automaticamente a fairness: 99.996
      // linhas antes vivas ficam com prazo passado, ainda presentes no indice
      // parcial IS NOT NULL. Uma segunda ordem por prazo pode evitar o scan.
      await client.query(`UPDATE engine_fairness_origem_fluxo
        SET proximo_vivo_em=NOW()-INTERVAL '1 day' WHERE proximo_vivo_em IS NULL`);
      await client.query("VACUUM (ANALYZE) engine_fairness_origem_fluxo");
      distributed.push(await comparePlan("A2_stale_expiry_only_fair_order", fairProjectionSql));
      await client.query(`CREATE INDEX uf_compare_fair_expiry_idx ON engine_fairness_origem_fluxo
        (etapa,lane,proximo_vivo_em) WHERE proximo_vivo_em IS NOT NULL`);
      await client.query("ANALYZE engine_fairness_origem_fluxo");
      distributed.push(await comparePlan("A2_stale_with_expiry_range_index", fairProjectionSql));

      // Caso denso e canônico: todos os eventos passam a ser recentes;
      // recalcular o prazo pela mesma expressao, sem valor inventado no job.
      await client.query(`UPDATE engine_eventos_brutos SET capturado_em=NOW()-INTERVAL '1 minute'
        WHERE metadata->>'fixtureKind'='legacy_expired'`);
      await client.query(`UPDATE engine_jobs_cliente j SET expira_comercial_em=
        CASE WHEN ${frescor.manual} THEN NULL ELSE ${frescor.expiraEm} END
        FROM engine_eventos_brutos e WHERE e.id=j.evento_id`);
      await client.query(`UPDATE engine_fairness_origem_fluxo f SET proximo_vivo_em=j.expira_comercial_em
        FROM engine_jobs_cliente j WHERE j.cliente_id=f.cliente_id`);
      await client.query("UPDATE uf_compare_heads SET pronto=TRUE");
      await client.query("VACUUM (ANALYZE) engine_jobs_cliente");
      await client.query("VACUUM (ANALYZE) engine_fairness_origem_fluxo");
      await client.query("VACUUM (ANALYZE) uf_compare_heads");
      distributed.push(await comparePlan("A2_dense_100k_live", fairProjectionSql, null));
      distributed.push(await comparePlan("B_dense_100k_live", headSql, null));
      const storage = (await client.query(`SELECT
        pg_relation_size('uf_compare_ws_expiry_idx'::regclass)::bigint AS job_expiry_index,
        pg_relation_size('uf_compare_fair_ready_idx'::regclass)::bigint AS fair_ready_index,
        pg_relation_size('uf_compare_fair_expiry_idx'::regclass)::bigint AS fair_expiry_index,
        pg_total_relation_size('uf_compare_heads'::regclass)::bigint AS separate_head_total`)).rows[0];
      console.log("UNIVERSAL_ARCHITECTURE_COMPARISON " + JSON.stringify({
        concentrated, priorityCounterexample, distributed, workspaces: 100000,
        sparseLive: vivos.length, denseLive: 100000, storage,
        note: "TEMP read/seed plans only; A2 and B both require unimplemented transactional writer coverage"
      }));
    }

    if (process.argv.includes("--candidate-index")) {
      // LOCAL/TEMP only: the projection is populated by the same shared SQL authority.
      for (const table of ["engine_eventos_comerciais", "engine_processamentos", "engine_fairness_origem_fluxo",
        "engine_jobs_cliente", "engine_eventos_brutos"]) await client.query(`TRUNCATE ${table}`);
      await client.query(`INSERT INTO engine_eventos_brutos
        SELECT e.* FROM public.engine_eventos_brutos e
        WHERE e.metadata->>'fixtureKind' IN ('legacy_expired', 'historical_terminal')`);
      await client.query(`INSERT INTO engine_jobs_cliente
        SELECT j.* FROM public.engine_jobs_cliente j
        JOIN public.engine_eventos_brutos e ON e.id=j.evento_id
        WHERE e.metadata->>'fixtureKind' IN ('legacy_expired', 'historical_terminal')`);
      const counts = (await client.query(`SELECT status, COUNT(*)::int AS total
        FROM engine_jobs_cliente GROUP BY status ORDER BY status`)).rows;
      assert.equal(counts.reduce((sum, row) => sum + row.total, 0), 200000);
      await client.query("ALTER TABLE engine_jobs_cliente ADD COLUMN expira_comercial_em timestamptz");
      const frescor = sqlFrescorComercialPreImporter("j", "e");
      await client.query(`UPDATE engine_jobs_cliente j
        SET expira_comercial_em = CASE WHEN ${frescor.manual} THEN NULL ELSE ${frescor.expiraEm} END
        FROM engine_eventos_brutos e WHERE e.id=j.evento_id`);
      const status = "('pendente','diagnosticado','pronto_para_importar','pronto_sem_utilidade')";
      await client.query(`CREATE INDEX uf_terminal_due_idx ON engine_jobs_cliente
        (expira_comercial_em, id) WHERE status IN ${status} AND expira_comercial_em IS NOT NULL`);
      await client.query(`CREATE INDEX uf_terminal_ws_due_idx ON engine_jobs_cliente
        (cliente_id, expira_comercial_em, id)
        WHERE status IN ${status} AND expira_comercial_em IS NOT NULL`);
      await client.query("ANALYZE engine_jobs_cliente");
      await client.query(`INSERT INTO engine_fairness_origem_fluxo (cliente_id, etapa, lane)
        SELECT DISTINCT cliente_id, 'diagnostico_final', 'expirada'
        FROM engine_jobs_cliente WHERE status IN ${status}
        ON CONFLICT DO NOTHING`);
      await client.query("ANALYZE engine_fairness_origem_fluxo");
      await client.query(`CREATE TEMP TABLE uf_terminal_heads (
        cliente_id text PRIMARY KEY, proximo_expira_em timestamptz,
        pronto boolean NOT NULL, ultimo_atendimento_em timestamptz)`);
      await client.query(`INSERT INTO uf_terminal_heads (cliente_id, proximo_expira_em, pronto)
        SELECT cliente_id, MIN(expira_comercial_em), TRUE
          FROM engine_jobs_cliente WHERE status IN ${status}
         GROUP BY cliente_id`);
      await client.query(`INSERT INTO uf_terminal_heads (cliente_id, proximo_expira_em, pronto)
        SELECT 'future_ws_'||g, NOW()+INTERVAL '1 day', FALSE FROM generate_series(1,100000) g`);
      await client.query(`CREATE INDEX uf_terminal_heads_due_idx ON uf_terminal_heads
        (proximo_expira_em, cliente_id) WHERE NOT pronto AND proximo_expira_em IS NOT NULL`);
      await client.query(`CREATE INDEX uf_terminal_heads_ready_idx ON uf_terminal_heads
        (ultimo_atendimento_em ASC NULLS FIRST, cliente_id) WHERE pronto`);
      await client.query("ANALYZE uf_terminal_heads");
      const queryGlobal = `SELECT j.id, j.cliente_id FROM engine_jobs_cliente j
        WHERE j.status IN ${status} AND j.expira_comercial_em <= NOW()
        ORDER BY j.expira_comercial_em, j.id LIMIT 10`;
      const queryGuarded = `WITH due AS MATERIALIZED (
        SELECT j.id, j.expira_comercial_em
          FROM engine_jobs_cliente j
         WHERE j.status IN ${status} AND j.expira_comercial_em <= NOW()
         ORDER BY j.expira_comercial_em, j.id LIMIT 40
         FOR UPDATE OF j SKIP LOCKED
      )
        SELECT j.id, j.cliente_id
        FROM due d
        JOIN engine_jobs_cliente j ON j.id=d.id
        LEFT JOIN engine_eventos_brutos e ON e.id=j.evento_id
        WHERE ${sqlElegibilidadeTerminalizer()}
        ORDER BY d.expira_comercial_em, j.id LIMIT 10`;
      const queryFair = `SELECT f.cliente_id, j.id
        FROM engine_fairness_origem_fluxo f
        CROSS JOIN LATERAL (
          SELECT id FROM engine_jobs_cliente j
          WHERE j.cliente_id=f.cliente_id AND j.status IN ${status}
            AND j.expira_comercial_em <= NOW()
          ORDER BY j.expira_comercial_em, j.id LIMIT 1
        ) j
        WHERE f.etapa='diagnostico_final' AND f.lane='expirada'
        ORDER BY f.ultimo_atendimento_em NULLS FIRST, f.cliente_id LIMIT 10`;
      const queryReadyHeads = `WITH workspaces AS MATERIALIZED (
        SELECT h.cliente_id FROM uf_terminal_heads h WHERE h.pronto
        ORDER BY h.ultimo_atendimento_em ASC NULLS FIRST, h.cliente_id
        LIMIT 10 FOR UPDATE OF h SKIP LOCKED
      )
      SELECT w.cliente_id, j.id FROM workspaces w CROSS JOIN LATERAL (
        SELECT j.id FROM engine_jobs_cliente j
        WHERE j.cliente_id=w.cliente_id AND j.status IN ${status}
          AND j.expira_comercial_em <= NOW()
        ORDER BY j.expira_comercial_em,j.id LIMIT 1
      ) j`;
      const queryPromoter = `SELECT cliente_id FROM uf_terminal_heads
        WHERE NOT pronto AND proximo_expira_em <= NOW()
        ORDER BY proximo_expira_em,cliente_id LIMIT 10 FOR UPDATE SKIP LOCKED`;
      async function plano(label, sql, params = []) {
        const plan = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params))
          .rows[0]["QUERY PLAN"][0];
        const nodes = [];
        function walk(node) {
          nodes.push({ type: node["Node Type"], index: node["Index Name"] || null,
            rows: node["Actual Rows"], loops: node["Actual Loops"],
            filtered: node["Rows Removed by Filter"] || 0,
            tempRead: node["Temp Read Blocks"] || 0, tempWritten: node["Temp Written Blocks"] || 0 });
          for (const child of node.Plans || []) walk(child);
        }
        walk(plan.Plan);
        console.log("UNIVERSAL_TERMINALIZER_CANDIDATE_PLAN " + JSON.stringify({ label,
          planningTimeMs: plan["Planning Time"], executionTimeMs: plan["Execution Time"], nodes }));
      }
      await plano("100k_dead_plus_100k_terminal_global", queryGlobal);
      await plano("100k_dead_full_guard_and_lock", queryGuarded, [STATUS_TERMINALIZAVEIS]);
      await plano("100k_dead_plus_100k_terminal_fair", queryFair);
      await plano("indexed_ready_heads_80_due_100k_future", queryReadyHeads);
      await plano("indexed_promoter_100k_future", queryPromoter);
      for (const lote of [1, 50, 100]) {
        await plano(`100k_dead_global_batch_${lote}`,
          queryGlobal.replace(/LIMIT 10$/, `LIMIT ${lote}`));
      }
      await client.query(`UPDATE engine_jobs_cliente
        SET metadata=COALESCE(metadata,'{}'::jsonb)||'{"manualV2":true}'::jsonb
        WHERE status='pendente'`);
      await client.query(`UPDATE engine_jobs_cliente SET metadata=metadata-'manualV2'
        WHERE id IN (SELECT id FROM engine_jobs_cliente WHERE status='pendente'
          ORDER BY criado_em DESC, id DESC LIMIT 10)`);
      await client.query(`UPDATE engine_jobs_cliente j
        SET expira_comercial_em = CASE WHEN ${frescor.manual} THEN NULL ELSE ${frescor.expiraEm} END
        FROM engine_eventos_brutos e WHERE e.id=j.evento_id AND j.status='pendente'`);
      // A massa de UPDATEs da fixture cria versoes mortas que nao representam
      // o estado estacionario apos backfill; mede-se tambem apos VACUUM local.
      await client.query("VACUUM (ANALYZE) engine_jobs_cliente");
      assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM engine_jobs_cliente
        WHERE status='pendente' AND expira_comercial_em <= NOW()`)).rows[0].n, 10);
      await plano("99990_manual_before_10_dead_global", queryGlobal);
      await plano("99990_manual_full_guard_and_lock", queryGuarded, [STATUS_TERMINALIZAVEIS]);
      await plano("99990_manual_before_10_dead_fair", queryFair);
      await client.query(`UPDATE uf_terminal_heads h
        SET proximo_expira_em=q.proximo, pronto=COALESCE(q.proximo<=NOW(),FALSE)
        FROM (SELECT cliente_id, MIN(expira_comercial_em) AS proximo
                FROM engine_jobs_cliente WHERE status IN ${status}
               GROUP BY cliente_id) q WHERE h.cliente_id=q.cliente_id`);
      await client.query("ANALYZE uf_terminal_heads");
      await plano("indexed_ready_heads_2_due_100k_future", queryReadyHeads);
      await client.query(`UPDATE engine_jobs_cliente
        SET metadata=COALESCE(metadata,'{}'::jsonb)||'{"manualV2":true}'::jsonb
        WHERE status='pendente' AND expira_comercial_em IS NOT NULL`);
      await client.query(`UPDATE engine_jobs_cliente j
        SET expira_comercial_em = CASE WHEN ${frescor.manual} THEN NULL ELSE ${frescor.expiraEm} END
        FROM engine_eventos_brutos e WHERE e.id=j.evento_id AND j.status='pendente'
          AND j.expira_comercial_em IS NOT NULL`);
      await client.query("VACUUM (ANALYZE) engine_jobs_cliente");
      await client.query(`UPDATE uf_terminal_heads h
        SET proximo_expira_em=NULL, pronto=FALSE
        WHERE h.cliente_id NOT LIKE 'future_ws_%'`);
      await client.query("VACUUM (ANALYZE) uf_terminal_heads");
      await plano("no_due_backlog_global", queryGlobal);
      await plano("no_due_backlog_fair", queryFair);
      await plano("no_due_backlog_ready_heads", queryReadyHeads);
      await plano("no_due_backlog_promoter_100k_future", queryPromoter);
      console.log("UNIVERSAL_TERMINALIZER_CANDIDATE " + JSON.stringify({
        rows: counts, workspaces: (await client.query(`SELECT COUNT(*)::int AS n
          FROM engine_fairness_origem_fluxo`)).rows[0].n,
        indexBytes: (await client.query(`SELECT pg_relation_size('uf_terminal_due_idx')::bigint AS global,
          pg_relation_size('uf_terminal_ws_due_idx')::bigint AS workspace,
          pg_relation_size('uf_terminal_heads_ready_idx')::bigint AS head_ready,
          pg_relation_size('uf_terminal_heads_due_idx')::bigint AS head_schedule,
          pg_relation_size('uf_terminal_heads')::bigint AS head_table`)).rows[0]
      }));
      // Contraexemplo de custo do fallback de claim: LIMIT 4 restringe a saida,
      // mas nao necessariamente a leitura sob lock de fairness.
      await client.query("UPDATE engine_jobs_cliente SET cliente_id='hot_ws' WHERE status='pendente'");
      await client.query("VACUUM (ANALYZE) engine_jobs_cliente");
      let reposicaoSql = null;
      const trackedClient = { query: (...args) => {
        reposicaoSql = args;
        return client.query(...args);
      } };
      const reposicao = await buscarReposicaoGrupoPreImporter(trackedClient,
        { clienteId: "hot_ws", lane: "fresca_circulavel" }, "pendente", []);
      assert.equal(reposicao.length, 4);
      const reposicaoPlan = (await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${reposicaoSql[0]}`, reposicaoSql[1]
      )).rows[0]["QUERY PLAN"][0];
      const scans = [];
      function collectScans(node, target = scans) {
        if (/Scan$/.test(node["Node Type"])) target.push({ type: node["Node Type"],
          relation: node["Relation Name"] || null, index: node["Index Name"] || null,
          rows: node["Actual Rows"], loops: node["Actual Loops"],
          filtered: node["Rows Removed by Filter"] || 0,
          sharedHit: node["Shared Hit Blocks"] || 0, sharedRead: node["Shared Read Blocks"] || 0,
          localHit: node["Local Hit Blocks"] || 0, localRead: node["Local Read Blocks"] || 0,
          tempRead: node["Temp Read Blocks"] || 0, tempWritten: node["Temp Written Blocks"] || 0 });
        for (const child of node.Plans || []) collectScans(child, target);
      }
      collectScans(reposicaoPlan.Plan);
      console.log("UNIVERSAL_CLAIM_REPLACEMENT_100K_PLAN " + JSON.stringify({
        returned: reposicao.length, planningTimeMs: reposicaoPlan["Planning Time"],
        executionTimeMs: reposicaoPlan["Execution Time"], scans
      }));

      // Alternativa B: indice de workspace/status elimina terminais, mas nao
      // torna bounded um workspace com 100k candidatos Manual vivos.
      await client.query(`CREATE INDEX uf_replacement_ws_status_idx ON engine_jobs_cliente
        ((COALESCE(NULLIF(BTRIM(cliente_id), ''), 'workspace_desconhecido')), status)`);
      await client.query("ANALYZE engine_jobs_cliente");
      const expressionPlan = (await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${reposicaoSql[0]}`, reposicaoSql[1]
      )).rows[0]["QUERY PLAN"][0];
      const expressionScans = [];
      collectScans(expressionPlan.Plan, expressionScans);
      console.log("UNIVERSAL_REPLACEMENT_EXPRESSION_INDEX_PLAN " + JSON.stringify({
        planningTimeMs: expressionPlan["Planning Time"],
        executionTimeMs: expressionPlan["Execution Time"],
        tempRead: expressionPlan.Plan["Temp Read Blocks"] || 0,
        tempWritten: expressionPlan.Plan["Temp Written Blocks"] || 0,
        scans: expressionScans
      }));

      // Cenario A: 100k no mesmo workspace, somente quatro vivos; usa a
      // projeção de vencimento preenchida pela autoridade compartilhada.
      await client.query("UPDATE engine_jobs_cliente SET metadata=metadata-'manualV2' WHERE status='pendente'");
      const vivos = (await client.query(`SELECT id FROM engine_jobs_cliente WHERE status='pendente'
        ORDER BY id DESC LIMIT 4`)).rows.map(row => Number(row.id));
      await client.query("UPDATE engine_jobs_cliente SET metadata='{}'::jsonb WHERE id=ANY($1::bigint[])", [vivos]);
      await client.query(`UPDATE engine_eventos_brutos
        SET capturado_em=NOW()-INTERVAL '1 minute', metadata='{}'::jsonb,
            origem='synthetic_normal', origem_tipo='synthetic_normal'
        WHERE id IN (SELECT evento_id FROM engine_jobs_cliente WHERE id=ANY($1::bigint[]))`, [vivos]);
      await client.query(`UPDATE engine_jobs_cliente j
        SET expira_comercial_em = CASE WHEN ${frescor.manual} THEN NULL ELSE ${frescor.expiraEm} END
        FROM engine_eventos_brutos e WHERE e.id=j.evento_id AND j.status='pendente'`);
      await client.query("VACUUM (ANALYZE) engine_jobs_cliente");
      const aliveGroup = { clienteId: "hot_ws", lane: "agua_nova" };
      const selectedAlive = await buscarReposicaoGrupoPreImporter(trackedClient, aliveGroup, "pendente", []);
      assert.deepEqual(new Set(selectedAlive.map(job => Number(job.id))), new Set(vivos));
      const legacyAlivePlan = (await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${reposicaoSql[0]}`, reposicaoSql[1]
      )).rows[0]["QUERY PLAN"][0];
      const indexedAliveSql = `WITH prefixo AS MATERIALIZED (
        SELECT id, expira_comercial_em FROM engine_jobs_cliente
         WHERE cliente_id=$1 AND status='pendente' AND expira_comercial_em>NOW()
         ORDER BY expira_comercial_em DESC,id DESC LIMIT 4
      ) SELECT j.id FROM prefixo p JOIN engine_jobs_cliente j ON j.id=p.id
        LEFT JOIN engine_eventos_brutos e ON e.id=j.evento_id
       WHERE ${frescor.vivo} AND ${frescor.lane}=$2
       ORDER BY COALESCE(j.prioridade,0) DESC,
                COALESCE(e.capturado_em,j.criado_em) DESC,j.id ASC`;
      const indexedAlive = (await client.query(indexedAliveSql, ["hot_ws", "agua_nova"]))
        .rows.map(row => Number(row.id));
      assert.deepEqual(new Set(indexedAlive), new Set(vivos));
      const indexedAlivePlan = (await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${indexedAliveSql}`, ["hot_ws", "agua_nova"]
      )).rows[0]["QUERY PLAN"][0];
      const legacyAliveScans = [];
      const indexedAliveScans = [];
      collectScans(legacyAlivePlan.Plan, legacyAliveScans);
      collectScans(indexedAlivePlan.Plan, indexedAliveScans);
      console.log("UNIVERSAL_REPLACEMENT_FOUR_LIVE_100K " + JSON.stringify({
        legacy: { planningTimeMs: legacyAlivePlan["Planning Time"],
          executionTimeMs: legacyAlivePlan["Execution Time"], scans: legacyAliveScans },
        projected: { planningTimeMs: indexedAlivePlan["Planning Time"],
          executionTimeMs: indexedAlivePlan["Execution Time"],
          tempRead: indexedAlivePlan.Plan["Temp Read Blocks"] || 0,
          tempWritten: indexedAlivePlan.Plan["Temp Written Blocks"] || 0,
          scans: indexedAliveScans },
        expectedIds: vivos, projectedIds: indexedAlive
      }));

      // Cenario B: 100k distribuidos; 76 de 80 workspaces sem job vivo.
      // Seed completo e somente de migration local, nao manutenção operacional.
      await client.query(`UPDATE engine_jobs_cliente
        SET cliente_id='dist_ws_'||(id % 80)::text WHERE status='pendente'`);
      await client.query("VACUUM (ANALYZE) engine_jobs_cliente");
      await client.query(`CREATE TEMP TABLE uf_live_heads (
        cliente_id text PRIMARY KEY, pronto boolean NOT NULL,
        ultimo_atendimento_em timestamptz)`);
      await client.query(`INSERT INTO uf_live_heads(cliente_id,pronto)
        SELECT w.cliente_id,EXISTS (
          SELECT 1 FROM engine_jobs_cliente j
           WHERE j.cliente_id=w.cliente_id AND j.status='pendente'
             AND j.expira_comercial_em>NOW()
        ) FROM (SELECT DISTINCT cliente_id FROM engine_jobs_cliente
                 WHERE status='pendente') w`);
      await client.query(`CREATE INDEX uf_live_heads_ready_idx ON uf_live_heads
        (ultimo_atendimento_em ASC NULLS FIRST,cliente_id) WHERE pronto`);
      await client.query("ANALYZE uf_live_heads");
      const distributedSql = `WITH workspaces AS MATERIALIZED (
        SELECT cliente_id FROM uf_live_heads WHERE pronto
        ORDER BY ultimo_atendimento_em ASC NULLS FIRST,cliente_id
        LIMIT 4 FOR UPDATE SKIP LOCKED
      ) SELECT w.cliente_id,j.id FROM workspaces w CROSS JOIN LATERAL (
        SELECT id FROM engine_jobs_cliente j
         WHERE j.cliente_id=w.cliente_id AND j.status='pendente'
           AND j.expira_comercial_em>NOW()
         ORDER BY j.expira_comercial_em DESC,j.id DESC LIMIT 1
      ) j`;
      const distributed = (await client.query(distributedSql)).rows;
      assert.deepEqual(new Set(distributed.map(row => Number(row.id))), new Set(vivos));
      const distributedPlan = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        ${distributedSql}`)).rows[0]["QUERY PLAN"][0];
      const distributedScans = [];
      collectScans(distributedPlan.Plan, distributedScans);
      console.log("UNIVERSAL_REPLACEMENT_DISTRIBUTED_100K " + JSON.stringify({
        headCounts: (await client.query(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER(WHERE pronto)::int AS ready FROM uf_live_heads`)).rows[0],
        planningTimeMs: distributedPlan["Planning Time"],
        executionTimeMs: distributedPlan["Execution Time"], scans: distributedScans,
        tempRead: distributedPlan.Plan["Temp Read Blocks"] || 0,
        tempWritten: distributedPlan.Plan["Temp Written Blocks"] || 0
      }));
      await client.query(`INSERT INTO uf_live_heads(cliente_id,pronto)
        SELECT 'empty_ws_'||g,FALSE FROM generate_series(1,100000) g`);
      await client.query("ANALYZE uf_live_heads");
      const manyHeadsPlan = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        ${distributedSql}`)).rows[0]["QUERY PLAN"][0];
      const manyHeadsScans = [];
      collectScans(manyHeadsPlan.Plan, manyHeadsScans);
      console.log("UNIVERSAL_REPLACEMENT_DISTRIBUTED_100K_HEADS " + JSON.stringify({
        heads: 100080, ready: 4, planningTimeMs: manyHeadsPlan["Planning Time"],
        executionTimeMs: manyHeadsPlan["Execution Time"], scans: manyHeadsScans,
        tempRead: manyHeadsPlan.Plan["Temp Read Blocks"] || 0,
        tempWritten: manyHeadsPlan.Plan["Temp Written Blocks"] || 0
      }));
    }
  } finally {
    await client.end().catch(() => {});
  }
})().catch(error => {
  console.error("UNIVERSAL_TERMINALIZER_FATAL", error.stack || String(error));
  process.exitCode = 1;
});
