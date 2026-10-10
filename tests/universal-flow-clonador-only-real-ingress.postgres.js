"use strict";

// Opt-in integration fixture: real Clonador repository/listener/bridge and
// Engine event/job persistence, confined to an isolated disposable schema.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");

const port = Number(process.env.UF_TEST_PG_PORT || 55433);
const config = { host: "127.0.0.1", port, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const root = path.join(__dirname, "..");
const schema = `uf_clone_only_${crypto.randomBytes(6).toString("hex")}`;
const workspaceId = "ws_clone";
process.env.DATA_DIR = path.join(root, ".local-test-tmp", schema);
const { projectionDdl, runSteadyLifecycle } =
  require("../modules/engine/lifecycle-steady.candidate");

async function run() {
  const admin = new Client(config);
  let pool;
  let enginePool;
  let installed = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());

    await admin.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    await admin.query(`SET search_path TO ${schema},public`);
    for (const file of ["schema.sql", "admission-gate.candidate.sql"]) {
      await admin.query(fs.readFileSync(path.join(root, "modules", "engine", file), "utf8"));
    }
    await admin.query(projectionDdl());
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,16,0,'UNKNOWN',NULL,interval '5 minutes')`);

    process.env.PGSSLMODE = "disable";
    process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    require("../utils/storage").writeGlobalJson("usuarios.json", [
      { id: workspaceId, ativo: true, plano: "pro" }
    ]);
    const workspace = require("../modules/workspace");
    workspace.avaliarWorkspaceParaEngine = id => ({ elegivelEngine: id === workspaceId });
    const images = require("../modules/imagens/cache-canonico-evento");
    images.resolverImagemCanonicaEvento = async () => ({
      imagemStatus: "nao_resolvida", imagemEnviavel: false });

    const { getEnginePool } = require("../modules/engine/database");
    const { criarRepositorioClonadorGrupos } = require("../modules/clonador-grupos/repository");
    const { criarServicoClonadorGrupos } = require("../modules/clonador-grupos/service");
    const { criarBridgeClonadorGrupos } = require("../modules/clonador-grupos/bridge");
    const { registrarEventoBruto } = require("../modules/engine/inbox.service");
    enginePool = getEnginePool();
    pool = new Pool({ ...config, max: 8, options: `-c search_path=${schema},public` });
    const lifecycle = await runSteadyLifecycle({ pool, limit: 4 });
    assert.equal(lifecycle.ok, true, JSON.stringify(lifecycle));
    await admin.query(`UPDATE engine_hot_admission_control
      SET health='HEALTHY',lifecycle_last_success=NOW() WHERE id=1`);
    const repo = criarRepositorioClonadorGrupos({ pool,
      queryEngine: async (sql, params = []) => {
        try { return { ok: true, resultado: await pool.query(sql, params) }; }
        catch (error) { return { ok: false, motivo: "fixture_query_failed", erro: error.message }; }
      }, pushWaitLimitPerWorkspace: 4 });
    await repo.prepararSchema();
    await repo.salvarConfig(workspaceId, { ativo: true });
    const sources = Array.from({ length: 4 }, (_, i) => ({
      sessaoId: "session_a", grupoJid: `group_${i + 1}@g.us`,
      grupoNome: `Group ${i + 1}`, ativo: true }));
    await repo.substituirFontes(workspaceId, sources);
    await repo.substituirDestinos(workspaceId, ["dest_A", "dest_B", "dest_C"]);
    const service = criarServicoClonadorGrupos({ repository: repo,
      clienteTemRecurso: () => true, exigirCapturaFactualCandidata: true,
      logger: { log() {} } });
    const agesMinutes = [20, 5, 2, 2];
    for (let i = 0; i < sources.length; i += 1) {
      const productUrl = `https://www.amazon.com.br/dp/B0${String(i + 1).padStart(8, "0")}`;
      const t0Seconds = Math.floor((Date.now() - agesMinutes[i] * 60000) / 1000);
      const captured = await service.capturarMensagemWhatsapp({
        clienteId: workspaceId, sessaoId: "session_a",
        metadata: i === 1 ? { cupomTurbo: true, tipoFluxo: "cupom_turbo" } : {},
        mensagem: { key: { remoteJid: sources[i].grupoJid,
          id: `clone_only_${i + 1}`, fromMe: false }, messageTimestamp: t0Seconds,
        message: { conversation: `Produto ${i + 1} ${productUrl}` } }
      });
      assert.equal(captured.capturada, true, JSON.stringify(captured));
    }
    const bridge = criarBridgeClonadorGrupos({ repository: repo,
      registrarEventoBruto, aplicarFrescorEsperaCandidato: true,
      resolverRedirectUniversal: async url => ({ ok: true,
        urlOriginal: url, urlFinal: url, urlExpandida: url,
        marketplaceDetectado: "amazon", status: "resolvido" }),
      logger: { log() {} } });
    const result = await bridge.processarCapturasPendentes({ limite: 4 });
    const records = (await admin.query(`SELECT b.mensagem_id,b.status,b.capturado_em,
      b.metadata AS buffer_metadata,
      e.id AS evento_id,e.capturado_em AS evento_capturado_em,
      e.metadata AS evento_metadata,
      e.metadata->>'origemFluxo' AS origem_fluxo,
      j.id AS job_id,j.status AS job_status
      FROM clonador_grupos_buffer b
      LEFT JOIN engine_eventos_brutos e
        ON e.hash_evento='clonador_grupos:' || b.id::text
      LEFT JOIN engine_jobs_cliente j ON j.evento_id=e.id
      ORDER BY b.mensagem_id`)).rows;
    assert.equal(result.prontas, 4, JSON.stringify({ result, records }));
    assert.equal(records.length, 4);
    assert(records.every(row => row.status === "pronta" && row.evento_id && row.job_id));
    assert(records.every(row => row.origem_fluxo === "clonador_grupos"));
    assert(records.every(row => row.capturado_em.getTime() ===
      row.evento_capturado_em.getTime()));
    assert.equal(records[1].buffer_metadata.cupomTurbo,true);
    assert.equal(records[1].evento_metadata.cupomTurbo,true);
    const { avaliarFrescorPosClassificacaoCandidato } =
      require("../modules/engine/post-classification-freshness.candidate");
    assert.equal(avaliarFrescorPosClassificacaoCandidato({
      evento_capturado_em:records[0].evento_capturado_em,
      tipoOperacional:"oferta_comum"}).ok,true);
    assert.equal(avaliarFrescorPosClassificacaoCandidato({
      evento_capturado_em:records[1].evento_capturado_em,
      evento_metadata:records[1].evento_metadata,
      tipoOperacional:"cupom_turbo"}).ok,true);
    assert.equal(avaliarFrescorPosClassificacaoCandidato({
      evento_capturado_em:records[1].evento_capturado_em,
      evento_metadata:records[1].evento_metadata,
      tipoOperacional:"cupom_turbo"},
      records[1].evento_capturado_em.getTime()+15*60000).ok,false);
    const { processarJobsPendentesEngine } = require("../modules/engine/processor.runner");
    const { validarJobsDiagnosticadosEngine } = require("../modules/engine/validator.runner");
    const processor = await processarJobsPendentesEngine({ limite: 4,
      clientesValidos: [workspaceId], avaliarWorkspaceParaEngine: () => ({ elegivelEngine: true }) });
    assert.equal(processor.diagnosticados, 4, JSON.stringify(processor));
    const validator = await validarJobsDiagnosticadosEngine({ limite: 4,
      clientesValidos: [workspaceId], avaliarWorkspaceParaEngine: () => ({ elegivelEngine: true }),
      integracoesPorCliente: { [workspaceId]: { amazon: { ativo: true,
        credenciais: { tag: "fixture-tag" } } } } });
    assert.equal(validator.pronto_para_importar, 4, JSON.stringify(validator));
    const afterStages = (await admin.query(`SELECT status,count(*)::int AS n
      FROM engine_jobs_cliente GROUP BY status`)).rows;
    assert.deepEqual(afterStages, [{ status: "pronto_para_importar", n: 4 }]);
    const { importarJobsProntosEngine } = require("../modules/engine/importer/importer.runner");
    const importer = await importarJobsProntosEngine({ limite: 4, marketplace: "amazon",
      deps: {
        getIntegracaoCliente: () => ({ ativo: true, credenciais: { tag: "fixture-tag" } }),
        importarAmazon: async url => ({ titulo: "Fone Bluetooth Premium com Estojo",
          precoAtual: 199.9, precoOriginal: 249.9,
          imagem: "https://example.invalid/fixture-image.jpg",
          linkOriginal: url,
          linkAfiliado: `${url}?tag=fixture-tag`,
          categoria: "Eletronicos" })
      } });
    assert.equal(importer.ofertaCriada, 4, JSON.stringify(importer));
    const offers = (await admin.query(`SELECT o.*,j.id AS job_id,j.cliente_id,
      j.metadata AS job_metadata,e.metadata AS evento_metadata,
      e.capturado_em AS evento_capturado_em
      FROM engine_ofertas o JOIN engine_jobs_cliente j ON j.oferta_id=o.id
      JOIN engine_eventos_brutos e ON e.id=j.evento_id ORDER BY o.id`)).rows;
    assert.equal(offers.length, 4);
    assert(offers.every(row => row.capturada_em &&
      row.capturada_em.getTime() === row.evento_capturado_em.getTime()));
    const category = offers[0].categoria;
    assert(category);
    const destinations = [
      { id: "dest_A", nome: "A", ativo: true, tipo: "telegram",
        botToken: "fixture", chatId: "fixture_A", marketplaces: ["amazon"], categorias: [category] },
      { id: "dest_B", nome: "B", ativo: true, tipo: "telegram",
        botToken: "fixture", chatId: "fixture_B", marketplaces: ["amazon"], categorias: [category] },
      { id: "dest_C", nome: "C", ativo: true, tipo: "telegram",
        botToken: "fixture", chatId: "fixture_C", marketplaces: ["amazon"], categorias: ["Categoria incompativel"] }
    ];
    const distributorContext = { clientesValidos: [workspaceId],
      avaliarWorkspaceParaEngine: () => ({ elegivelEngine: true }),
      destinosPorCliente: { [workspaceId]: destinations },
      validarCreditos: async () => ({ ok: true }) };
    const { validarOfertaParaDistribuicao } =
      require("../modules/engine/distributor/distributor.service");
    for (const offer of offers) {
      const decision = await validarOfertaParaDistribuicao(offer, distributorContext);
      assert.equal(decision.ok, true, JSON.stringify(decision));
      assert.deepEqual(decision.__destinosCompativeisRaw.map(item => item.id).sort(),
        ["dest_A", "dest_B"]);
      assert.equal(decision.destinosTotal, 3);
    }
    const queued = [];
    const { distribuirOfertasEngine } =
      require("../modules/engine/distributor/distributor.runner");
    const distributor = await distribuirOfertasEngine({ limite: 4,
      clienteId: workspaceId, contexto: distributorContext,
      deps: { universalFlowFreshnessCandidate: true,
        decidirAbsorcaoWorkspace: async () => ({ ativo: false, permitir: true }),
        adicionarOfertaNaFilaGlobal: async (_clienteId, itemFila) => {
          queued.push(itemFila);
          return { ok: true, itemFila };
        } } });
    assert.equal(distributor.adicionadasFila, 4, JSON.stringify(distributor));
    assert.equal(queued.length, 4);
    const indexSource = fs.readFileSync(path.join(root, "index.js"), "utf8");
    assert.match(indexSource,/criarBridgeClonadorGrupos\(\{[\s\S]*?aplicarFrescorEsperaCandidato: true/);
    assert.match(indexSource,/distribuirOfertasEngine\(\{[\s\S]*?universalFlowFreshnessCandidate: true/);
    assert.match(indexSource,/getDepsDistribuidor: \(\) => \(\{\s*universalFlowFreshnessCandidate: true/);
    const fanoutStart = indexSource.indexOf("function destinoFanoutId(");
    const fanoutEnd = indexSource.indexOf("function garantirSnapshotAlvosFanout(", fanoutStart);
    assert(fanoutStart >= 0 && fanoutEnd > fanoutStart);
    const { destinoJaEnviadoFanout, registrarDestinoEstadoFanout } =
      new Function("destinoNomeLog", `${indexSource.slice(fanoutStart, fanoutEnd)}
        return { destinoJaEnviadoFanout, registrarDestinoEstadoFanout };`)(
        destination => destination.nome || destination.id);
    const { criarCoordenadorEnvioProdutoDestino } =
      require("../modules/manual-v2/ofertas-v2-envio-claim");
    const { processarEnvioAutomaticoDestino } =
      require("../modules/fila/processar-envio-automatico-destino");
    const held = new Set();
    const reservations = new Set();
    const coordinator = criarCoordenadorEnvioProdutoDestino({
      advisory: {
        adquirir: async ({ clienteId, oferta }) => {
          const key = `${clienteId}:${oferta.id}`;
          if (held.has(key)) return { resultado: "ocupado" };
          held.add(key);
          return { resultado: "adquirido", handle: { key, client: { release() {} } } };
        },
        finalizar: async state => { held.delete(state.handle.key);
          return { liberado: true }; }
      },
      reserva: {
        consultar: async (_, clienteId, key) => reservations.has(`${clienteId}:${key}`),
        preparar: async (_, clienteId, key) => { reservations.add(`${clienteId}:${key}`);
          return `token:${key}`; },
        descartar: async (_, clienteId, key) => { reservations.delete(`${clienteId}:${key}`); }
      }
    });
    const confirmations = [];
    const sendArm = async (queuedOffer, destination) => processarEnvioAutomaticoDestino({
      clienteId: workspaceId, oferta: queuedOffer, destinoId: destination.id,
      coordenador: coordinator,
      revalidar: () => ({ ok: true, bloqueada: false }),
      liberarAdvisoryFila: () => true,
      prepararMensagem: () => ({ texto: `Oferta ${queuedOffer.id}` }),
      enviar: async () => ({ enviado: true, tentouEnvio: true,
        providerMessageId: `fixture-${queuedOffer.id}-${destination.id}` }),
      processarResultado: async ack => {
        assert.equal(ack.enviado, true);
        registrarDestinoEstadoFanout(queuedOffer, destination, "enviado",
          { motivo: "envio_confirmado" });
        confirmations.push({ offerId: queuedOffer.id, destinationId: destination.id,
          providerMessageId: ack.providerMessageId });
      },
      aoBloqueio: reason => { throw new Error(`unexpected_arm_block:${reason}`); }
    });
    for (const queuedOffer of queued) {
      queuedOffer.destinosEstado = [];
      for (const destination of destinations) {
        registrarDestinoEstadoFanout(queuedOffer, destination,
          destination.id === "dest_C" ? "nao_compativel" : "aguardando",
          { motivo: destination.id === "dest_C" ? "categoria_incompativel" : "destino_compativel" });
      }
      assert.equal((await sendArm(queuedOffer, destinations[0])).resultado, "enviado");
      assert.equal(destinoJaEnviadoFanout(queuedOffer, destinations[0]), true);
      assert.equal(destinoJaEnviadoFanout(queuedOffer, destinations[1]), false);
      assert.equal(queuedOffer.destinosEstado.find(item => item.id === "dest_B").estado,
        "aguardando");
      assert.equal((await sendArm(queuedOffer, destinations[1])).resultado, "enviado");
      assert.equal(destinoJaEnviadoFanout(queuedOffer, destinations[1]), true);
      assert.equal(queuedOffer.destinosEstado.find(item => item.id === "dest_C").estado,
        "nao_compativel");
    }
    assert.equal(confirmations.length, 8);
    assert.equal(new Set(confirmations.map(item => item.providerMessageId)).size, 8);
    assert.equal(held.size, 0);
    for (const [ageMinutes,suffix] of [[5,"turbo_discovered_5"],
      [15,"turbo_discovered_15"]]) {
      const productUrl = `https://www.amazon.com.br/dp/${suffix === "turbo_discovered_5"
        ? "B090000005" : "B090000015"}`;
      const captured = await service.capturarMensagemWhatsapp({
        clienteId:workspaceId,sessaoId:"session_a",
        mensagem:{key:{remoteJid:sources[0].grupoJid,id:suffix,fromMe:false},
          messageTimestamp:Math.floor((Date.now()-ageMinutes*60000)/1000),
          message:{conversation:`Produto com cupom ${productUrl}`}}
      });
      assert.equal(captured.capturada,true,JSON.stringify(captured));
    }
    const discoveredBridge=await bridge.processarCapturasPendentes({limite:2});
    assert.equal(discoveredBridge.prontas,2,JSON.stringify(discoveredBridge));
    const discoveredProcessor=await processarJobsPendentesEngine({limite:2,
      clientesValidos:[workspaceId],
      avaliarWorkspaceParaEngine:()=>({elegivelEngine:true})});
    assert.equal(discoveredProcessor.diagnosticados,2,JSON.stringify(discoveredProcessor));
    const discoveredValidator=await validarJobsDiagnosticadosEngine({limite:2,
      clientesValidos:[workspaceId],
      avaliarWorkspaceParaEngine:()=>({elegivelEngine:true}),
      integracoesPorCliente:{[workspaceId]:{amazon:{ativo:true,
        credenciais:{tag:"fixture-tag"}}}}});
    assert.equal(discoveredValidator.pronto_para_importar,2,
      JSON.stringify(discoveredValidator));
    const discoveredImporter=await importarJobsProntosEngine({limite:2,
      marketplace:"amazon",deps:{
        getIntegracaoCliente:()=>({ativo:true,credenciais:{tag:"fixture-tag"}}),
        importarAmazon:async url=>({titulo:"Produto Premium com Cupom Real",
          precoAtual:199.9,precoOriginal:249.9,
          imagem:"https://example.invalid/fixture-image.jpg",
          linkOriginal:url,linkAfiliado:`${url}?tag=fixture-tag`,
          categoria:"Eletronicos",cupom:"FIXTURE10",cupomTipo:"real"})
      }});
    assert.equal(discoveredImporter.ofertaCriada,2,
      JSON.stringify(discoveredImporter));
    const discovered=(await admin.query(`SELECT b.mensagem_id,b.capturado_em,
      b.metadata AS buffer_metadata,e.capturado_em AS evento_capturado_em,
      j.id AS job_id,o.* FROM clonador_grupos_buffer b
      JOIN engine_eventos_brutos e
        ON e.hash_evento='clonador_grupos:' || b.id::text
      JOIN engine_jobs_cliente j ON j.evento_id=e.id
      JOIN engine_ofertas o ON o.id=j.oferta_id
      WHERE b.mensagem_id IN ('turbo_discovered_5','turbo_discovered_15')
      ORDER BY b.mensagem_id`)).rows;
    assert.equal(discovered.length,2);
    assert(discovered.every(row=>row.buffer_metadata.cupomTurbo!==true));
    assert(discovered.every(row=>row.capturado_em.getTime()===
      row.evento_capturado_em.getTime() &&
      row.capturado_em.getTime()===row.capturada_em.getTime()));
    assert(discovered.every(row=>row.tipo_cupom==="real" &&
      Number(row.metadata?.inteligenciaUniversalV2?.prioridadeMinimaCupom)>=95));
    assert(discovered.every(row=>
      row.metadata?.classificacaoTurboCandidata?.ancora===
        "codigo_alfanumerico_valido"));
    const byMessage=Object.fromEntries(discovered.map(row=>[row.mensagem_id,row]));
    const at5=avaliarFrescorPosClassificacaoCandidato(byMessage.turbo_discovered_5);
    const at15=avaliarFrescorPosClassificacaoCandidato(byMessage.turbo_discovered_15);
    console.log(JSON.stringify({candidate:"clonador_post_classification_clock",
      source:"listener_messageTimestamp",stages:"buffer_event_job_offer",
      importerCouponType:discovered.map(row=>row.tipo_cupom),
      importerCouponFloor:discovered.map(row=>
        row.metadata?.inteligenciaUniversalV2?.prioridadeMinimaCupom),
      at5,at15}));
    assert.equal(at5.tipoFluxo,"cupom_turbo",JSON.stringify(at5));
    assert.equal(at5.ok,true);
    assert.equal(at15.tipoFluxo,"cupom_turbo",JSON.stringify(at15));
    assert.equal(at15.ok,false);
    const discoveredQueued=[];
    const discoveredContext={...distributorContext,
      destinosPorCliente:{[workspaceId]:destinations.map(destino=>({
        ...destino,
        categorias:destino.id==="dest_C" ? destino.categorias :
          [...destino.categorias,discovered[0].categoria]
      }))}};
    const discoveredDistribution=await distribuirOfertasEngine({limite:2,
      clienteId:workspaceId,contexto:discoveredContext,
      deps:{universalFlowFreshnessCandidate:true,
        decidirAbsorcaoWorkspace:async()=>({ativo:false,permitir:true}),
        adicionarOfertaNaFilaGlobal:async(_clienteId,itemFila)=>{
          discoveredQueued.push(itemFila);
          return {ok:true,itemFila};
        }}});
    assert.equal(discoveredQueued.length,1,JSON.stringify(discoveredDistribution));
    assert.equal(String(discoveredQueued[0].engineOfertaId),
      String(byMessage.turbo_discovered_5.id));
    for (const [ageMinutes,turbo] of [[35,false],[15,true]]) {
      const suffix = turbo ? "turbo_expired" : "normal_expired";
      const expiredUrl = `https://www.amazon.com.br/dp/B0${turbo ? "90000002" : "90000001"}`;
      const captured = await service.capturarMensagemWhatsapp({
        clienteId: workspaceId,sessaoId:"session_a",
        metadata:turbo ? {cupomTurbo:true,tipoFluxo:"cupom_turbo"} : {},
        mensagem:{key:{remoteJid:sources[0].grupoJid,id:suffix,fromMe:false},
          messageTimestamp:Math.floor((Date.now()-ageMinutes*60000)/1000),
          message:{conversation:`Produto expirado ${expiredUrl}`}}
      });
      assert.equal(captured.capturada,false,JSON.stringify(captured));
      assert.equal(captured.motivo,"EXPIRED_BEFORE_ADMISSION");
    }
    const expiredPass=await bridge.processarCapturasPendentes({limite:2});
    assert.equal(expiredPass.expiradasNaEspera,0,JSON.stringify(expiredPass));
    assert.equal(expiredPass.prontas,0);
    const expiredRows=(await admin.query(`SELECT b.mensagem_id,b.status,
      e.id AS evento_id,j.id AS job_id FROM clonador_grupos_buffer b
      LEFT JOIN engine_eventos_brutos e
        ON e.hash_evento='clonador_grupos:' || b.id::text
      LEFT JOIN engine_jobs_cliente j ON j.evento_id=e.id
      WHERE b.mensagem_id IN ('normal_expired','turbo_expired')
      ORDER BY b.mensagem_id`)).rows;
    assert.equal(expiredRows.length,2);
    assert(expiredRows.every(row=>row.status==="ignorada" &&
      row.evento_id===null && row.job_id===null));
    console.log(JSON.stringify({ candidate: "clonador_only_real_ingress",
      sources: sources.length, captures: records.length, ready: result.prontas,
      events: records.filter(row => row.evento_id).length,
      jobs: records.filter(row => row.job_id).length,
      t0Preserved: true, radarEvents: (await admin.query(`SELECT count(*)::int AS n
        FROM engine_eventos_brutos WHERE origem='radar'`)).rows[0].n,
      stagesCompleted: ["listener", "repository", "wait", "bridge", "engine_event",
        "engine_job", "processor", "validator", "importer", "offer", "distributor",
        "queue_handoff", "send_boundary", "provider_ack_fixture"],
      destinationAAndBCompatible: true, destinationCIncompatible: true,
      armAThenBIndependent: true, confirmedArms: confirmations.length,
      normal20Accepted:true,turbo5Accepted:true,
      normal35Rejected:true,turbo15Rejected:true,
      completeToOfferFanout: true, fullIndexExecutorLoopInvoked: false }));
  } finally {
    if (enginePool) await enginePool.end().catch(() => {});
    if (pool) await pool.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
