"use strict";

// One-shot local load measurement. Only the marketplace and provider edges
// are deterministic fixtures; ingress, admission, runners and fanout are real.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");
const { Client, Pool } = require("pg");
const root = path.join(__dirname, "..");
const ingressTarget = Number(process.env.UF_CONTINUOUS_LOAD_TARGET || 500);
if (![500,700].includes(ingressTarget)) throw new Error("unsupported_continuous_load_target");
const label = `CONTINUOUS_${ingressTarget}`;
const schema = `uf_cont${ingressTarget}_${crypto.randomBytes(6).toString("hex")}`;
const port = Number(process.env.UF_TEST_PG_PORT || 55433);
const config = { host: "127.0.0.1", port, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const workspaces = Array.from({ length: 8 }, (_, i) => `ws_load_${i}`);
const integration = { ativo: true, credenciais: { tag: "fixture-tag" } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(q * sorted.length) - 1].toFixed(2));
};
const count = rows => Number(rows[0]?.n || 0);
process.env.DATA_DIR = path.join(root, ".local-test-tmp", schema);
process.env.PGSSLMODE = "disable";
process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;

async function run() {
  const nativeLog = console.log;
  const db = new Client(config);
  let enginePool, clonePool, lifecyclePool, bootstrap, installed = false;
  let evidenceValidated = false;
  const deniedJournalPath = path.join(process.env.DATA_DIR,"denied-attempts.jsonl");
  const deniedLedgerPath = path.join(process.env.DATA_DIR,"denied-final-ledger.json");
  const reportPath = path.join(process.env.DATA_DIR,"continuous-report.json");
  const cpuStart = process.cpuUsage();
  const wallStart = Date.now();
  const rssStart = process.memoryUsage().rss;
  let rssMax = rssStart, eventLoopLagMax = 0, poolWaitMax = 0;
  let poolSaturationMax = 0, poolAcquireCount = 0;
  const poolWaits = [], admissionDenials = new Map();
  const admissionAttempts = new Map();
  const firstIngressBySerial = new Map(), manualOffers = [];
  const pendingSecondArms = [];
  let lifecycleLastAttempt = null;
  const loop = monitorEventLoopDelay({ resolution: 20 });
  const counters = { ingress: 0, radarIngress: 0, cloneIngress: 0,
    dedupBlocked: 0, lifecycleTicks: 0, lifecycleDueFound: 0,
    lifecycleProcessed: 0, lifecycleLeaseSkips: 0,
    lifecycleLagMax: 0, fanoutArms: 0, fanoutAcks: 0,
    partialCreated: 0, partialAfterFirstAck: 0, partialSecondAck: 0,
    manualIngress: 0,
    maxHot: 0, maxWaiting: 0, failures: [] };
  const queued = [], confirmations = [], couponByUrl = new Map();
  const fanoutStates = [];
  const ingressRecords = [];
  let lastIngressSnapshot, afterSettleSnapshot;
  let workerBusy = false, workerError = null, workerTimer = null;
  let metricsTimer = null;
  const measureLog = () => {};
  function instrumentPool(pool) {
    const connect = pool.connect.bind(pool);
    pool.connect = function (callback) {
      const started = performance.now();
      poolSaturationMax = Math.max(poolSaturationMax,
        pool.totalCount - pool.idleCount + pool.waitingCount);
      const record = client => {
        const ms = performance.now() - started;
        poolAcquireCount++;
        poolWaits.push(ms);
        poolWaitMax = Math.max(poolWaitMax, ms);
        poolSaturationMax = Math.max(poolSaturationMax,
          pool.totalCount - pool.idleCount + pool.waitingCount);
        if (client && !client.__ufMeasured) {
          client.__ufMeasured = true;
          const query = client.query.bind(client);
          client.query = function (sql, params, cb) {
            const statement = typeof sql === "string" ? sql : sql?.text || "";
            const values = Array.isArray(params) ? params : sql?.values || [];
            const isJob = /INSERT INTO engine_jobs_cliente\s*\(/i.test(statement);
            const key = isJob ? `${values[0]}:${values[2]}` : null;
            const attemptedAt = isJob ? new Date().toISOString() : null;
            const observe = (error, result) => {
              if (!isJob) return;
              const attempts = admissionAttempts.get(key) || [];
              const outcome = String(error?.message || "").includes("UF_HOT_ADMISSION_DENIED")
                ? "denied" : error ? "error" : result?.rows?.[0]?.id ? "job_created" : "no_new_job";
              attempts.push({ at: attemptedAt, outcome,
                jobId: result?.rows?.[0]?.id || null });
              admissionAttempts.set(key, attempts);
              if (outcome === "denied") {
                admissionDenials.set(key, (admissionDenials.get(key) || 0) + 1);
                fs.appendFileSync(deniedJournalPath, JSON.stringify({
                  eventoId: values[0], clienteId: values[2], deniedAt: attemptedAt,
                  denialCount: admissionDenials.get(key), attemptCount: attempts.length
                }) + "\n");
              }
            };
            if (typeof cb === "function") return query(sql, params, (error, result) => {
              observe(error, result); cb(error, result);
            });
            if (typeof params === "function") return query(sql, (error, result) => {
              observe(error, result); params(error, result);
            });
            const result = query(sql, params);
            return result?.then ? result.then(value => { observe(null,value); return value; },
              error => { observe(error); throw error; }) : result;
          };
        }
        return client;
      };
      if (typeof callback === "function") return connect((error, client, release) => {
        if (!error) record(client);
        callback(error, client, release);
      });
      return connect().then(record);
    };
  }
  async function scalar(sql, params = []) {
    return count((await db.query(sql, params)).rows);
  }
  async function snapshot() {
    const hot = await scalar(`SELECT hot_used AS n FROM engine_hot_admission_control WHERE id=1`);
    const waiting = await scalar(`SELECT COUNT(*)::int AS n FROM
      engine_radar_replay_intents_candidate WHERE status='pendente'`) +
      await scalar(`SELECT COUNT(*)::int AS n FROM clonador_grupos_buffer
        WHERE status='capturada'`);
    counters.maxHot = Math.max(counters.maxHot, hot);
    counters.maxWaiting = Math.max(counters.maxWaiting, waiting);
    assert(hot <= 25, `hot_limit_violated:${hot}`);
    return { hot, waiting };
  }
  async function reconcileDenied() {
    const keys = [...admissionDenials.keys()];
    if (!keys.length) return [];
    const eventIds = [...new Set(keys.map(key => Number(key.split(":")[0])))];
    const events = (await db.query(`SELECT id,origem,fonte,hash_evento,
      capturado_em,metadata FROM engine_eventos_brutos WHERE id=ANY($1::bigint[])`,
    [eventIds])).rows;
    const jobs = (await db.query(`SELECT id,evento_id,cliente_id,status
      FROM engine_jobs_cliente WHERE evento_id=ANY($1::bigint[])`,[eventIds])).rows;
    const intents = (await db.query(`SELECT evento_id,cliente_id,status,job_id,
      capturado_em,atualizado_em FROM engine_radar_replay_intents_candidate
      WHERE evento_id=ANY($1::bigint[])`,[eventIds])).rows;
    const bufferIds = events.map(event => /^clonador_grupos:(\d+)$/.exec(
      event.hash_evento || "")?.[1]).filter(Boolean).map(Number);
    const buffers = bufferIds.length ? (await db.query(`SELECT id,cliente_id,
      status,capturado_em,updated_at,metadata FROM clonador_grupos_buffer
      WHERE id=ANY($1::bigint[])`,[bufferIds])).rows : [];
    const eventById = new Map(events.map(row => [String(row.id),row]));
    const jobByKey = new Map(jobs.map(row =>
      [`${row.evento_id}:${row.cliente_id}`,row]));
    const intentByKey = new Map(intents.map(row =>
      [`${row.evento_id}:${row.cliente_id}`,row]));
    const bufferById = new Map(buffers.map(row => [String(row.id),row]));
    const { avaliarFrescorPreImporter } =
      require("../modules/engine/frescor-pre-importer.service");
    return keys.map(key => {
      const [eventoId,clienteId] = key.split(":");
      const event = eventById.get(eventoId);
      const job = jobByKey.get(key);
      const intent = intentByKey.get(key);
      const bufferId = /^clonador_grupos:(\d+)$/.exec(event?.hash_evento || "")?.[1];
      const buffer = bufferById.get(bufferId);
      const attempts = admissionAttempts.get(key) || [];
      const denials = attempts.filter(attempt => attempt.outcome === "denied");
      const t0 = event?.capturado_em || intent?.capturado_em || buffer?.capturado_em;
      const freshness = t0 ? avaliarFrescorPreImporter({
        evento_id: Number(eventoId),evento_capturado_em: t0,
        evento_origem: event?.origem || event?.fonte || "",
        evento_metadata: event?.metadata || {}
      }) : {};
      const overloadFact = buffer?.metadata?.overloadNotAdmitted;
      const expiryReason = buffer?.metadata?.admissionWait?.motivo ||
        overloadFact?.motivo;
      const expired = intent?.status === "expirada" ||
        (buffer?.status === "ignorada" &&
          expiryReason === "captura_vencida_na_espera");
      const erro = buffer?.status === "erro" ||
        (buffer?.status === "ignorada" && !expired);
      const stillRetriable = intent?.status === "pendente" ||
        ["capturada","processando"].includes(buffer?.status);
      const finalState = job ? "EVENTUALLY_ADMITTED" : expired
        ? "EXPIRED_WITH_TERMINAL_FACT" : erro ? "ERROR_PROVEN"
        : stillRetriable ? "STILL_RETRIABLE" : "UNKNOWN";
      return {
        eventoId:Number(eventoId),clienteId,origin:event?.origem || event?.fonte || null,
        t0:t0 ? new Date(t0).toISOString() : null,
        freshnessDeadline:freshness.expiraEmComercial || null,
        denialCount:admissionDenials.get(key),
        firstDeniedAt:denials[0]?.at || null,
        lastDeniedAt:denials.at(-1)?.at || null,
        retryCount:Math.max(0,attempts.length-1),
        lastRetryAt:attempts.length>1 ? attempts.at(-1).at : null,
        intentStatus:intent?.status || null,
        bufferStatus:buffer?.status || null,
        jobId:job?.id || intent?.job_id || null,
        terminalFact:expired ? intent?.status === "expirada"
          ? { source:"radar_replay_intent",status:"expirada",
            at:intent.atualizado_em } : { source:"clonador_grupos_buffer",
            status:buffer.status,reason:expiryReason,
            at:buffer.metadata?.admissionWait?.terminalizadaEm || buffer.updated_at }
          : erro ? { source:overloadFact
              ? "clonador_grupos_buffer.overloadNotAdmitted"
              : "clonador_grupos_buffer",
            status:buffer.status,
            reason:expiryReason || buffer.metadata?.clonadorGruposBridge?.motivo || null,
            limit:overloadFact?.limite || null,
            at:buffer.updated_at } : null,
        finalState,
        lostIntentBug:finalState === "UNKNOWN" && !intent && !buffer && !job
      };
    });
  }
  try {
    await db.connect();
    const identity = (await db.query(`SELECT current_database() db,
      host(inet_server_addr()) host,inet_server_port() port,
      current_setting('data_directory') data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    await db.query(`CREATE SCHEMA ${schema}`); installed = true;
    await db.query(`SET search_path TO ${schema},public`);
    for (const file of ["schema.sql", "admission-gate.candidate.sql",
      "radar-replay.candidate.sql"]) {
      await db.query(fs.readFileSync(path.join(root,"modules","engine",file),"utf8"));
    }
    const lifecycleModule = require("../modules/engine/lifecycle-steady.candidate");
    const { projectionDdl } = lifecycleModule;
    await db.query(projectionDdl());
    await db.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_max_staleness)
      VALUES (1,25,0,'UNKNOWN',interval '5 minutes')`);
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    require("../utils/storage").writeGlobalJson("usuarios.json",
      workspaces.map(id => ({ id, ativo: true, plano: "pro" })));
    const workspace = require("../modules/workspace");
    workspace.avaliarWorkspaceParaEngine = id =>
      ({ elegivelEngine: workspaces.includes(id) });
    require("../modules/imagens/cache-canonico-evento")
      .resolverImagemCanonicaEvento = async () => ({ imagemStatus: "nao_resolvida",
        imagemEnviavel: false });
    const { getEnginePool } = require("../modules/engine/database");
    enginePool = getEnginePool();
    clonePool = new Pool({ ...config, max: 4,
      options: `-c search_path=${schema},public` });
    lifecyclePool = new Pool({ ...config, max: 1,
      options: `-c search_path=${schema},public` });
    for (const pool of [enginePool, clonePool, lifecyclePool]) instrumentPool(pool);
    const realLifecycle = lifecycleModule.runSteadyLifecycle;
    lifecycleModule.runSteadyLifecycle = async args => {
      const result = await realLifecycle(args);
      counters.lifecycleTicks++;
      counters.lifecycleDueFound += Number(result.selected || 0);
      counters.lifecycleProcessed += result.terminalized?.length || 0;
      if (result.skipped) counters.lifecycleLeaseSkips++;
      return result;
    };
    const { criarRepositorioClonadorGrupos } =
      require("../modules/clonador-grupos/repository");
    const { criarServicoClonadorGrupos } =
      require("../modules/clonador-grupos/service");
    const { criarBridgeClonadorGrupos } =
      require("../modules/clonador-grupos/bridge");
    const { registrarEventoBruto } = require("../modules/engine/inbox.service");
    const { recuperarIntencoesRadarCandidatas } =
      require("../modules/engine/radar-replay-runtime.candidate");
    const { criarHandlerRadarServidor } =
      require("./helpers/universal-flow-radar-server-handler");
    const { criarBootstrapLocalCandidato } =
      require("../modules/engine/universal-flow-local-bootstrap.candidate");
    const { processarJobsPendentesEngine } =
      require("../modules/engine/processor.runner");
    const { validarJobsDiagnosticadosEngine } =
      require("../modules/engine/validator.runner");
    const { importarJobsProntosEngine } =
      require("../modules/engine/importer/importer.runner");
    const { distribuirOfertasEngine } =
      require("../modules/engine/distributor/distributor.runner");
    const repo = criarRepositorioClonadorGrupos({ pool: clonePool,
      queryEngine: async (sql, params = []) => {
        try { return { ok: true, resultado: await clonePool.query(sql, params) }; }
        catch (error) { return { ok: false, motivo: "fixture_query_failed",
          erro: error.message }; }
      }, pushWaitLimitPerWorkspace: 4 });
    await repo.prepararSchema();
    for (const id of workspaces) {
      await repo.salvarConfig(id, { ativo: true });
      await repo.substituirFontes(id, [{ sessaoId: "session_a",
        grupoJid: `${id}@g.us`, grupoNome: id, ativo: true }]);
      await repo.substituirDestinos(id, ["dest_A", "dest_B", "dest_C"]);
    }
    const cloneService = criarServicoClonadorGrupos({ repository: repo,
      clienteTemRecurso: () => true, exigirCapturaFactualCandidata: true,
      logger: { log() {} } });
    const bridge = criarBridgeClonadorGrupos({ repository: repo,
      registrarEventoBruto, aplicarFrescorEsperaCandidato: true,
      resolverRedirectUniversal: async url => ({ ok: true, urlOriginal: url,
        urlFinal: url, urlExpandida: url, marketplaceDetectado: "amazon",
        status: "resolvido" }), logger: { log() {} } });
    bootstrap = criarBootstrapLocalCandidato({ lifecyclePool,
      lifecycleLimit: 10, lifecycleIntervalMs: 1000,
      replayIntervalMs: 1000, cloneIntervalMs: 1000,
      persistWatchdog: async state => {
        if (lifecycleLastAttempt !== null && state.lastAttempt !== lifecycleLastAttempt)
          counters.lifecycleLagMax = Math.max(counters.lifecycleLagMax,
            state.lastAttempt - lifecycleLastAttempt);
        lifecycleLastAttempt = state.lastAttempt;
        await db.query(`UPDATE engine_hot_admission_control SET
          health=$1,lifecycle_last_success=$2 WHERE id=1`, [
          state.lastSuccess ? "HEALTHY" : "UNKNOWN",
          state.lastSuccess ? new Date(state.lastSuccess) : null]);
      },
      runRadarReplay: () => recuperarIntencoesRadarCandidatas({ limite: 20 }),
      runClonePass: () => bridge.processarCapturasPendentes({ limite: 20 })
    });
    console.log = measureLog;
    const started = await bootstrap.start();
    assert.equal(started.ok, true, JSON.stringify(started));
    const radarByWorkspace = Object.fromEntries(workspaces.map(id => [id,
      criarHandlerRadarServidor(input => registrarEventoBruto(input, {
        clientes: [id], radarReplayCandidate: true,
        validarWorkspaceRadarCandidate: candidate => candidate === id }))]));
    const integrationByWorkspace = Object.fromEntries(workspaces.map(id =>
      [id, { amazon: integration }]));
    const validWorkspace = () => ({ elegivelEngine: true });
    const destinations = Object.fromEntries(workspaces.map((id, index) => [id,
      index === 7 ? [{ id: "dest_C", ativo: true, tipo: "telegram",
        botToken: "fixture", chatId: `${id}:C`, marketplaces: ["amazon"],
        categorias: ["Categoria incompativel"] }] : [
        { id: "dest_A", ativo: true, tipo: "telegram", botToken: "fixture",
          chatId: `${id}:A`, marketplaces: ["amazon"], categorias: [] },
        { id: "dest_B", ativo: true, tipo: "telegram", botToken: "fixture",
          chatId: `${id}:B`, marketplaces: ["amazon"], categorias: [] },
        { id: "dest_C", ativo: true, tipo: "telegram", botToken: "fixture",
          chatId: `${id}:C`, marketplaces: ["amazon"],
          categorias: ["Categoria incompativel"] }
      ]]));
    const distributorContext = { clientesValidos: workspaces,
      avaliarWorkspaceParaEngine: validWorkspace,
      destinosPorCliente: destinations,
      validarCreditos: async () => ({ ok: true }) };
    const indexSource = fs.readFileSync(path.join(root,"index.js"),"utf8");
    const fanoutStart = indexSource.indexOf("function destinoFanoutId(");
    const fanoutEnd = indexSource.indexOf("function garantirSnapshotAlvosFanout(",fanoutStart);
    assert(fanoutStart >= 0 && fanoutEnd > fanoutStart);
    const { destinoJaEnviadoFanout, registrarDestinoEstadoFanout } =
      new Function("destinoNomeLog", `${indexSource.slice(fanoutStart,fanoutEnd)}
        return {destinoJaEnviadoFanout,registrarDestinoEstadoFanout};`)(
        destination => destination.nome || destination.id);
    const { criarCoordenadorEnvioProdutoDestino } =
      require("../modules/manual-v2/ofertas-v2-envio-claim");
    const manualStorage = require("../modules/manual-v2/manual-offers.storage");
    const { processarEnvioAutomaticoDestino } =
      require("../modules/fila/processar-envio-automatico-destino");
    const held = new Set(), reservations = new Set();
    const coordinator = criarCoordenadorEnvioProdutoDestino({
      advisory: { adquirir: async ({ clienteId, oferta }) => {
        const key = `${clienteId}:${oferta.id}`;
        if (held.has(key)) return { resultado: "ocupado" };
        held.add(key);
        return { resultado: "adquirido", handle: { key,
          client: { release() {} } } };
      }, finalizar: async state => { held.delete(state.handle.key);
        return { liberado: true }; } },
      reserva: { consultar: async (_, id, key) => reservations.has(`${id}:${key}`),
        preparar: async (_, id, key) => { reservations.add(`${id}:${key}`);
          return `token:${key}`; },
        descartar: async (_, id, key) => { reservations.delete(`${id}:${key}`); } }
    });
    async function sendArm(item, destination) {
      counters.fanoutArms++;
      const result = await processarEnvioAutomaticoDestino({
        clienteId: item.clienteId, oferta: item.offer,
        destinoId: destination.id, coordenador: coordinator,
        revalidar: () => ({ ok: true, bloqueada: false }),
        liberarAdvisoryFila: () => true,
        prepararMensagem: () => ({ texto: `Oferta ${item.offer.id}` }),
        enviar: async () => ({ enviado: true, tentouEnvio: true,
          providerMessageId: `fixture-${item.clientId}-${item.offer.id}-${destination.id}` }),
        processarResultado: async ack => {
          assert.equal(ack.enviado, true);
          registrarDestinoEstadoFanout(item.offer,destination,"enviado",
            { motivo: "envio_confirmado" });
          confirmations.push(ack.providerMessageId);
          counters.fanoutAcks++;
        }, aoBloqueio: reason => { throw new Error(`arm_block:${reason}`); }
      });
      assert.equal(result.resultado,"enviado");
    }
    async function flushFanout(limit = 4) {
      for (let i = 0; i < limit && queued.length; i++) {
        const item = queued.shift();
        const ds = destinations[item.clientId];
        item.offer.destinosEstado = [];
        for (const d of ds) registrarDestinoEstadoFanout(item.offer,d,
          d.id === "dest_C" ? "nao_compativel" : "aguardando",
          { motivo: d.id === "dest_C" ? "categoria_incompativel" : "destino_compativel" });
        await sendArm(item,ds[0]);
        const partial = Boolean(ds[1] && fanoutStates.length % 4 === 0);
        if (partial) {
          counters.partialCreated++;
          const a = item.offer.destinosEstado.find(x=>x.id==="dest_A");
          const b = item.offer.destinosEstado.find(x=>x.id==="dest_B");
          const c = item.offer.destinosEstado.find(x=>x.id==="dest_C");
          assert.equal(a?.estado,"enviado");
          assert.equal(b?.estado,"aguardando");
          assert.equal(c?.estado,"nao_compativel");
          assert.equal(destinoJaEnviadoFanout(item.offer,ds[1]),false);
          counters.partialAfterFirstAck++;
          pendingSecondArms.push({ item, destination: ds[1] });
        } else if (ds[1]) await sendArm(item,ds[1]);
        assert.equal(item.offer.destinosEstado.find(x=>x.id==="dest_C").estado,
          "nao_compativel");
        fanoutStates.push({ clientId: item.clientId,
          offerId: item.offer.id, states: item.offer.destinosEstado });
      }
      if (pendingSecondArms.length && (queued.length === 0 || pendingSecondArms.length >= 4)) {
        const { item, destination } = pendingSecondArms.shift();
        await sendArm(item,destination);
        assert.equal(destinoJaEnviadoFanout(item.offer,destination),true);
        counters.partialSecondAck++;
      }
    }
    async function tick() {
      if (workerBusy || workerError) return;
      workerBusy = true;
      try {
        await bootstrap.replayTick();
        await bootstrap.cloneTick();
        const p = await processarJobsPendentesEngine({ limite: 35,
          clientesValidos: workspaces,
          avaliarWorkspaceParaEngine: validWorkspace });
        const v = await validarJobsDiagnosticadosEngine({ limite: 35,
          clientesValidos: workspaces,
          avaliarWorkspaceParaEngine: validWorkspace,
          integracoesPorCliente: integrationByWorkspace });
        const imp = await importarJobsProntosEngine({ limite: 18,
          marketplace: "amazon", deps: {
            getIntegracaoCliente: () => integration,
            importarAmazon: async url => ({
              titulo: "Fone Bluetooth Premium com Estojo", precoAtual: 199.9,
              precoOriginal: 249.9,
              imagem: "https://example.invalid/fixture-image.jpg",
              linkOriginal: url, linkAfiliado: `${url}?tag=fixture-tag`,
              categoria: "Eletronicos", cupom: couponByUrl.get(url) || "",
              cupomTipo: couponByUrl.has(url) ? "real" : "" })
          } });
        if (p.erros || v.erro_validacao || imp.erros) throw new Error(
          `runner_error:${JSON.stringify({p:p.erros,v:v.erro_validacao,i:imp.erros})}`);
        const categories = (await db.query(`SELECT DISTINCT categoria
          FROM engine_ofertas WHERE categoria IS NOT NULL`)).rows
          .map(row => row.categoria);
        for (const ds of Object.values(destinations)) {
          for (const d of ds) if (d.id !== "dest_C") d.categorias = categories;
        }
        const d = await distribuirOfertasEngine({ limite: 18,
          contexto: distributorContext,
          deps: { universalFlowFreshnessCandidate: true,
            decidirAbsorcaoWorkspace: async () => ({ ativo: false, permitir: true }),
            adicionarOfertaNaFilaGlobal: async (clientId,itemFila) => {
              queued.push({ clientId, offer: itemFila });
              return { ok: true, itemFila };
            } } });
        if (d.erros) throw new Error(`distributor_error:${d.erros}`);
        await flushFanout(8);
        await snapshot();
      } catch (error) { workerError = error; }
      finally { workerBusy = false; }
    }
    workerTimer = setInterval(() => { void tick(); }, 200);
    metricsTimer = setInterval(() => {
      rssMax = Math.max(rssMax, process.memoryUsage().rss);
      eventLoopLagMax = Math.max(eventLoopLagMax, loop.max / 1e6);
    }, 100);
    loop.enable();
    for (let i = 0; i < ingressTarget; i++) {
      if (workerError) throw workerError;
      const duplicateOf = i % 100 === 97 || i % 100 === 99 ?
        ingressRecords[i - 10] : null;
      const clientId = duplicateOf?.clientId ||
        (i % 2 === 0 ? workspaces[0] : workspaces[1 + (i % 7)]);
      const origin = duplicateOf?.origin ||
        (ingressTarget === 700 && clientId === workspaces[7]
          ? "clonador_grupos" : i % 5 < 3 ? "radar" : "clonador_grupos");
      const turbo = i % 20 === 1 || i % 20 === 5 || i % 20 === 11;
      const age = i % 20 === 0 ? 35 : i % 20 === 1 ? 15 :
        i % 20 === 5 ? 5 : i % 20 === 2 ? 20 : 1 + i % 3;
      const serial = duplicateOf?.serial ?? i;
      const url = duplicateOf?.url ||
        `https://www.amazon.com.br/dp/B0${String(serial+1).padStart(8,"0")}`;
      const message = duplicateOf?.message ||
        `Produto ${serial} ${url}${turbo ? "\nCupom: APP20" : ""}`;
      const t0Seconds = duplicateOf?.t0Seconds ??
        Math.floor((Date.now() - age * 60000) / 1000);
      const t0 = new Date(t0Seconds * 1000).toISOString();
      const ingressAt = Date.now();
      if (!firstIngressBySerial.has(serial)) firstIngressBySerial.set(serial, ingressAt);
      if (turbo) couponByUrl.set(url,"APP20");
      counters.ingress++;
      if (i % 50 === 49) {
        counters.manualIngress++;
        const offer = manualStorage.criarOfertaManualV2(clientId, {
          marketplace: "amazon", titulo: `Manual real ${i}`,
          urlOriginal: url, urlAfiliada: `${url}?tag=fixture-tag`,
          precoAtual: "199.90", imagem: "https://example.invalid/manual.jpg"
        });
        manualOffers.push({ clientId, id: offer.id });
        ingressRecords.push({ origin: "manual_v2", clientId,
          result: offer, t0, t0Seconds, serial, url, message, ingressAt });
      } else if (origin === "radar") {
        counters.radarIngress++;
        const result = await radarByWorkspace[clientId]({
          sessaoId: "fixture", grupoNome: `Continuous ${ingressTarget}`,
          grupoId: `${clientId}:radar`, texto: message,
          linksCapturados: [url], aguardarAckEngine: true,
          origemAutorizadaInternamente: true,
          origemTipo: "whatsapp", raw: { messageTimestamp: t0Seconds } });
        if (result?.duplicado) counters.dedupBlocked++;
        ingressRecords.push({ origin, clientId, result, t0, t0Seconds,
          serial, url, message, ingressAt });
      } else {
        counters.cloneIngress++;
        const id = duplicateOf?.cloneMessageId || `continuous_${serial}`;
        const result = await cloneService.capturarMensagemWhatsapp({
          clienteId: clientId, sessaoId: "session_a",
          mensagem: { key: { remoteJid: `${clientId}@g.us`,
            id, fromMe: false }, messageTimestamp: t0Seconds,
          message: { conversation: message } } });
        if (result?.motivo && /duplic/i.test(result.motivo)) counters.dedupBlocked++;
        ingressRecords.push({ origin, clientId, result, t0, t0Seconds,
          serial, url, message, cloneMessageId: id, ingressAt });
      }
      if (i % 20 === 0) await snapshot();
      await sleep(45 + i % 20);
    }
    lastIngressSnapshot = await snapshot();
    const settleDeadline = Date.now() + 120000;
    while (Date.now() < settleDeadline) {
      if (workerError) throw workerError;
      await tick();
      const current = await snapshot();
      if (current.hot === 0 && current.waiting === 0 && queued.length === 0) {
        const denied = await reconcileDenied();
        if (denied.every(pair => ["EVENTUALLY_ADMITTED",
          "EXPIRED_WITH_TERMINAL_FACT","ERROR_PROVEN"].includes(pair.finalState))) {
          afterSettleSnapshot = current;
          break;
        }
      }
      await sleep(200);
    }
    if (!afterSettleSnapshot) afterSettleSnapshot = await snapshot();
    clearInterval(workerTimer); workerTimer = null;
    while (workerBusy) await sleep(50);
    while (pendingSecondArms.length) await flushFanout(0);
    const jobs = (await db.query(`SELECT j.id,j.evento_id,j.cliente_id,j.status,
      j.engine_hot_accounted,j.criado_em,j.oferta_id,j.metadata,
      e.capturado_em,e.criado_em AS evento_criado_em,e.texto_original,e.origem,e.fonte
      FROM engine_jobs_cliente j JOIN engine_eventos_brutos e ON e.id=j.evento_id`)).rows;
    const offers = (await db.query(`SELECT o.id,o.evento_id,o.status,o.motivo_status,
      o.criada_em,o.atualizada_em,o.capturada_em,o.metadata,
      j.cliente_id,e.origem,e.capturado_em AS evento_capturado_em
      FROM engine_ofertas o JOIN engine_jobs_cliente j ON j.oferta_id=o.id
      JOIN engine_eventos_brutos e ON e.id=j.evento_id`)).rows;
    assert(offers.every(o=>o.capturada_em?.getTime()===
      o.evento_capturado_em?.getTime()),"offer_t0_rejuvenated");
    const ids = new Set(jobs.map(j => `${j.evento_id}:${j.cliente_id}`));
    const hotJobs = jobs.filter(j => j.engine_hot_accounted);
    const pendingIntent = (await db.query(`SELECT capturado_em
      FROM engine_radar_replay_intents_candidate WHERE status='pendente'`)).rows;
    const pendingClone = (await db.query(`SELECT capturado_em
      FROM clonador_grupos_buffer WHERE status='capturada'`)).rows;
    const capacityRows = (await db.query(`SELECT cliente_id,
      metadata #>> '{overloadNotAdmitted,motivo}' AS reason
      FROM clonador_grupos_buffer WHERE status='ignorada' AND
      metadata #>> '{overloadNotAdmitted,motivo}' LIKE 'espera_workspace_cheia%'`)).rows;
    const capacityByWorkspace = Object.fromEntries(workspaces.map(id =>
      [id,capacityRows.filter(row => row.cliente_id === id).length]));
    const radarExpired = await scalar(`SELECT COUNT(*)::int AS n FROM
      engine_radar_replay_intents_candidate WHERE status='expirada'`);
    const cloneExpired = await scalar(`SELECT COUNT(*)::int AS n FROM
      clonador_grupos_buffer WHERE status='ignorada' AND
      (metadata #>> '{admissionWait,motivo}'='captura_vencida_na_espera' OR
       metadata #>> '{overloadNotAdmitted,motivo}'='captura_vencida_na_espera')`);
    const deniedLedger = await reconcileDenied();
    fs.writeFileSync(deniedLedgerPath,
      JSON.stringify({ schema,generatedAt:new Date().toISOString(),
        pairs:deniedLedger },null,2) + "\n");
    console.log = nativeLog;
    for (const pair of deniedLedger) nativeLog("DENIED_PAIR " + JSON.stringify({
      eventoId:pair.eventoId,clienteId:pair.clienteId,
      denialCount:pair.denialCount,finalState:pair.finalState,
      jobId:pair.jobId,terminalFact:pair.terminalFact
    }));
    const deniedTotal = [...admissionDenials.values()].reduce((a,b)=>a+b,0);
    const deniedAdmitted = deniedLedger.filter(x=>
      x.finalState==="EVENTUALLY_ADMITTED").length;
    const deniedExpired = deniedLedger.filter(x=>
      x.finalState==="EXPIRED_WITH_TERMINAL_FACT").length;
    const deniedRetriable = deniedLedger.filter(x=>
      x.finalState==="STILL_RETRIABLE").length;
    const deniedError = deniedLedger.filter(x=>
      x.finalState==="ERROR_PROVEN").length;
    const deniedUnknown = deniedLedger.filter(x=>x.finalState==="UNKNOWN").length;
    const lostIntentBug = deniedLedger.some(x=>x.lostIntentBug);
    const persistedManual = manualOffers.map(({clientId,id})=>
      manualStorage.buscarOfertaManualV2(clientId,id));
    const wrongManual = persistedManual.filter(offer=>!offer ||
      offer.status!=="salva" || Boolean(offer.expiraEm || offer.terminalDueAt ||
        offer.classificacaoTurboCandidata || offer.turbo)).length;
    const oldest = rows => rows.length ? Math.max(0,
      ...rows.map(row => Date.now() - new Date(row.capturado_em).getTime())) : 0;
    const dur = (a,b) => Math.max(0,new Date(b).getTime()-new Date(a).getTime());
    const joined = jobs.filter(j=>j.oferta_id).map(j=>({j,
      o:offers.find(o=>String(o.id)===String(j.oferta_id))})).filter(x=>x.o);
    const captureToJob = jobs.map(j=>dur(j.capturado_em,j.criado_em));
    const captureToOffer = joined.map(x=>dur(x.j.capturado_em,x.o.criada_em));
    const serialOf = j => Number(/\bProduto (\d+)\b/.exec(j.texto_original || "")?.[1]);
    const ingressToJobDurations = jobs.map(j=>{
      const ingress = firstIngressBySerial.get(serialOf(j));
      return Number.isFinite(ingress) ? Math.max(0,j.criado_em.getTime()-ingress) : null;
    }).filter(Number.isFinite);
    const jobToOffer = joined.map(x=>dur(x.j.criado_em,x.o.criada_em));
    const captureAgeAtIngress = ingressRecords.filter(x=>x.origin!=="manual_v2")
      .map(x=>Math.max(0,x.ingressAt-new Date(x.t0).getTime()));
    const offerToDistributor = offers.filter(o=>["fila","retida"].includes(o.status))
      .map(o=>dur(o.criada_em,o.atualizada_em));
    const workspaceProgress = Object.fromEntries(workspaces.map(id => [id,{
      jobs:jobs.filter(j=>j.cliente_id===id).length,
      offers:offers.filter(o=>o.cliente_id===id).length }]));
    const workspaceFirstJobWait = Object.fromEntries(workspaces.map(id => {
      const ingressAt = Math.min(...ingressRecords.filter(record =>
        record.clientId===id && record.origin!=="manual_v2").map(record=>record.ingressAt));
      const firstJobAt = Math.min(...jobs.filter(job=>job.cliente_id===id)
        .map(job=>job.criado_em.getTime()));
      return [id,Number.isFinite(ingressAt) && Number.isFinite(firstJobAt)
        ? Math.max(0,firstJobAt-ingressAt) : null];
    }));
    const originProgress = Object.fromEntries(["radar","clonador_grupos"].map(origin=>
      [origin,{jobs:jobs.filter(j=>j.origem===origin).length,
        offers:offers.filter(o=>o.origem===origin).length}]));
    const cpu = process.cpuUsage(cpuStart);
    const elapsed = Date.now()-wallStart;
    rssMax = Math.max(rssMax, process.memoryUsage().rss);
    const report = {
      TOTAL_INGRESS:counters.ingress,
      TOTAL_ADMITTED:jobs.length,
      TOTAL_JOBS_CREATED:jobs.length,
      TOTAL_OFFERS_CREATED:offers.length,
      TOTAL_TERMINALIZED:jobs.filter(j=>[
        "expirada_operacional","ignorado","erro"].includes(j.status)).length,
      TOTAL_WAITING_ADMISSION:pendingIntent.length+pendingClone.length,
      TOTAL_OVERLOAD_NOT_ADMITTED:deniedLedger.length-deniedAdmitted,
      ADMISSION_DENIED_TOTAL:deniedTotal,
      ADMISSION_DENIED_UNIQUE:deniedLedger.length,
      ADMISSION_DENIED_PAIRS:deniedLedger.length,
      ADMISSION_DENIED_RETRIED:deniedLedger.filter(x=>x.retryCount>0).length,
      ADMISSION_DENIED_EVENTUALLY_ADMITTED:deniedAdmitted,
      ADMISSION_DENIED_EXPIRED:deniedExpired,
      DENIED_EVENTUALLY_ADMITTED:deniedAdmitted,
      DENIED_EXPIRED_WITH_TERMINAL_FACT:deniedExpired,
      DENIED_STILL_RETRIABLE:deniedRetriable,
      DENIED_ERROR_PROVEN:deniedError,
      DENIED_UNKNOWN:deniedUnknown,
      DENIED_WITHOUT_FACTUAL_DESTINATION:deniedRetriable+deniedUnknown,
      LOST_INTENT_BUG:lostIntentBug,
      OVERLOAD_NOT_ADMITTED_FINAL:deniedExpired+deniedError,
      ADMISSION_DENIED_UNRESOLVED:deniedRetriable+deniedUnknown,
      DENIED_LEDGER_PATH:deniedLedgerPath,
      LAB_SCHEMA:schema,
      CAPACITY_REJECT_TOTAL:capacityRows.length,
      CAPACITY_REJECT_RATE:Number((capacityRows.length/ingressTarget).toFixed(4)),
      CAPACITY_REJECT_BY_WORKSPACE:capacityByWorkspace,
      CAPACITY_REJECT_BY_ORIGIN:{ radar:0,clonador_grupos:capacityRows.length },
      NORMAL_EXPIRED_FACTS:radarExpired+cloneExpired,
      MAX_HOT_SET:counters.maxHot,FINAL_HOT_SET:afterSettleSnapshot.hot,
      OLDEST_LIVE_AGE:oldest(hotJobs),
      OLDEST_WAITING_AGE:oldest([...pendingIntent,...pendingClone]),
      DUPLICATE_JOBS:jobs.length-ids.size,DEDUP_BLOCKED:counters.dedupBlocked,
      FRESHNESS_BLOCKED_NORMAL:offers.filter(o=>o.status==="retida" &&
        o.motivo_status==="captura_expirada_pos_classificacao" &&
        o.metadata?.classificacaoTurboCandidata?.turbo!==true).length,
      FRESHNESS_BLOCKED_TURBO:offers.filter(o=>o.status==="retida" &&
        o.motivo_status==="captura_expirada_pos_classificacao" &&
        o.metadata?.classificacaoTurboCandidata?.turbo===true).length,
      WORKSPACE_PROGRESS:workspaceProgress,ORIGIN_PROGRESS:originProgress,
      WORKSPACE_FIRST_JOB_WAIT_MS:workspaceFirstJobWait,
      CLONADOR_INGRESS:counters.cloneIngress,
      CLONADOR_OFFERS:originProgress.clonador_grupos.offers,
      RADAR_INGRESS:counters.radarIngress,
      RADAR_OFFERS:originProgress.radar.offers,
      FANOUT_ARMS_CREATED:counters.fanoutArms,
      FANOUT_ACKS:counters.fanoutAcks,
      FANOUT_PENDING_FINAL:fanoutStates.reduce((total,item)=>total+
        item.states.filter(state=>state.estado==="aguardando").length,0)+
        queued.length*2,
      PARTIAL_FANOUT_CREATED:counters.partialCreated,
      PARTIAL_FANOUT_AFTER_FIRST_ACK:counters.partialAfterFirstAck,
      PARTIAL_FANOUT_SECOND_ARM_ACK:counters.partialSecondAck,
      PARTIAL_FANOUT_LOST:fanoutStates.filter(item=>
        item.states.some(state=>state.id==="dest_A" && state.estado==="enviado") &&
        item.states.some(state=>state.id==="dest_B" && state.estado==="aguardando")).length,
      CAPTURE_AGE_AT_INGRESS_P50:percentile(captureAgeAtIngress,.5),
      CAPTURE_AGE_AT_INGRESS_P95:percentile(captureAgeAtIngress,.95),
      INGRESS_TO_JOB_P50:percentile(ingressToJobDurations,.5),
      INGRESS_TO_JOB_P95:percentile(ingressToJobDurations,.95),
      INGRESS_TO_JOB_MATCHED:ingressToJobDurations.length,
      JOB_TO_OFFER_P50:percentile(jobToOffer,.5),
      JOB_TO_OFFER_P95:percentile(jobToOffer,.95),
      CAPTURE_TO_JOB_P50:percentile(captureToJob,.5),
      CAPTURE_TO_JOB_P95:percentile(captureToJob,.95),
      CAPTURE_TO_OFFER_P50:percentile(captureToOffer,.5),
      CAPTURE_TO_OFFER_P95:percentile(captureToOffer,.95),
      OFFER_TO_DISTRIBUTOR_P50:percentile(offerToDistributor,.5),
      OFFER_TO_DISTRIBUTOR_P95:percentile(offerToDistributor,.95),
      LIFECYCLE_PROCESSED:counters.lifecycleProcessed,
      LIFECYCLE_TICKS:counters.lifecycleTicks,
      LIFECYCLE_DUE_FOUND:counters.lifecycleDueFound,
      LIFECYCLE_LEASE_SKIPS:counters.lifecycleLeaseSkips,
      LIFECYCLE_LAG_MAX:counters.lifecycleLagMax,
      POOL_WAIT_P50:percentile(poolWaits,.5),
      POOL_WAIT_P95:percentile(poolWaits,.95),POOL_WAIT_MAX:poolWaitMax,
      POOL_ACQUIRE_COUNT:poolAcquireCount,
      POOL_SATURATION_MAX:poolSaturationMax,
      MANUAL_V2_INGRESS:counters.manualIngress,
      MANUAL_V2_OFFERS:persistedManual.filter(Boolean).length,
      MANUAL_V2_WRONG_EXPIRATIONS:wrongManual,
      EVENT_LOOP_LAG:eventLoopLagMax,RSS_START:rssStart,RSS_MAX:rssMax,
      EVENT_LOOP_LAG_MAX:eventLoopLagMax,
      RSS_END:process.memoryUsage().rss,
      CPU_OBSERVED:Number(((cpu.user+cpu.system)/1000/elapsed*100).toFixed(2)),
      HOT_SET_AT_LAST_INGRESS:lastIngressSnapshot.hot,
      HOT_SET_AFTER_SETTLE:afterSettleSnapshot.hot,
      WAITING_AT_LAST_INGRESS:lastIngressSnapshot.waiting,
      WAITING_AFTER_SETTLE:afterSettleSnapshot.waiting,
      WALL_MS:elapsed,POOL_SAMPLES:poolWaits.length,
      ACK_IDS_UNIQUE:new Set(confirmations).size===confirmations.length,
      OFFER_T0_PRESERVED:true,
      FANOUT_PARTIAL_ALIVE:counters.partialAfterFirstAck>0,
      MANUAL_V2_PRESERVED:require("../modules/engine/post-classification-freshness.candidate")
        .avaliarFrescorPosClassificacaoCandidato({ origem:"manual_v2",
          evento_capturado_em:new Date(Date.now()-180*60000).toISOString() }).ok
    };
    report.WAITING_AT_PEAK = counters.maxWaiting;
    report.WAITING_FINAL = afterSettleSnapshot.waiting;
    report.RADAR_PROGRESS = originProgress.radar.jobs > 0;
    report.CLONADOR_PROGRESS = originProgress.clonador_grupos.jobs > 0;
    report.WORKSPACE_FAIRNESS = Object.values(workspaceProgress)
      .every(value => value.jobs > 0);
    report.ORIGIN_FAIRNESS = report.RADAR_PROGRESS && report.CLONADOR_PROGRESS;
    report.FANOUT_PRESERVED = report.PARTIAL_FANOUT_CREATED > 0 &&
      report.PARTIAL_FANOUT_SECOND_ARM_ACK === report.PARTIAL_FANOUT_CREATED &&
      report.PARTIAL_FANOUT_LOST === 0 && report.FANOUT_PENDING_FINAL === 0;
    report.FRESHNESS_PRESERVED = report.OFFER_T0_PRESERVED &&
      report.FRESHNESS_BLOCKED_TURBO > 0 && report.NORMAL_EXPIRED_FACTS > 0;
    report.NO_DUPLICATE_JOB_REGRESSION = report.DUPLICATE_JOBS === 0;
    report[`RESOURCE_BEHAVIOR_ACCEPTABLE_${ingressTarget}`] =
      report.RSS_END < report.RSS_MAX && report.POOL_ACQUIRE_COUNT > 0 &&
      Number.isFinite(report.POOL_WAIT_P95);
    report[`${label}_COMPLETED`] = report.TOTAL_INGRESS === ingressTarget;
    report[`${label}_CONVERGES`] = report.FINAL_HOT_SET === 0 &&
      report.WAITING_FINAL === 0 &&
      report.DENIED_WITHOUT_FACTUAL_DESTINATION === 0;
    report[`${label}_VALIDATED`] = report[`${label}_COMPLETED`] &&
      report[`${label}_CONVERGES`] && report.DENIED_UNKNOWN === 0 &&
      report.DENIED_STILL_RETRIABLE === 0 &&
      !report.LOST_INTENT_BUG && report.NO_DUPLICATE_JOB_REGRESSION &&
      report.RADAR_PROGRESS && report.CLONADOR_PROGRESS &&
      report.WORKSPACE_FAIRNESS && report.ORIGIN_FAIRNESS &&
      report.FANOUT_PRESERVED && report.FRESHNESS_PRESERVED &&
      report.MANUAL_V2_PRESERVED && report.MANUAL_V2_WRONG_EXPIRATIONS === 0 &&
      report[`RESOURCE_BEHAVIOR_ACCEPTABLE_${ingressTarget}`];
    if (ingressTarget === 500)
      report.READY_FOR_CONTINUOUS_700 = report[`${label}_VALIDATED`];
    report.READY_FOR_INDEPENDENT_REVIEW = ingressTarget === 700 &&
      report[`${label}_VALIDATED`];
    assert.equal(report.TOTAL_INGRESS,ingressTarget);
    assert.equal(report.DUPLICATE_JOBS,0);
    assert.equal(report.ACK_IDS_UNIQUE,true);
    assert.equal(report.MANUAL_V2_PRESERVED,true);
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n");
    console.log = nativeLog;
    nativeLog(`${label}_REPORT ` + JSON.stringify(report));
    evidenceValidated = report[`${label}_VALIDATED`];
  } catch (error) {
    console.log = nativeLog;
    nativeLog(`${label}_PARTIAL ` + JSON.stringify({
      ingress:counters.ingress,radarIngress:counters.radarIngress,
      cloneIngress:counters.cloneIngress,maxHot:counters.maxHot,
      maxWaiting:counters.maxWaiting,lastIngressSnapshot,
      afterSettleSnapshot,rssStart,rssMax,rssEnd:process.memoryUsage().rss,
      error:String(error?.message || error)
    }));
    throw error;
  } finally {
    if (workerTimer) clearInterval(workerTimer);
    if (metricsTimer) clearInterval(metricsTimer);
    loop.disable();
    if (bootstrap) bootstrap.stop();
    while (workerBusy) await sleep(50);
    console.log = nativeLog;
    if (enginePool) await enginePool.end().catch(()=>{});
    if (clonePool) await clonePool.end().catch(()=>{});
    if (lifecyclePool) await lifecyclePool.end().catch(()=>{});
    if (installed && evidenceValidated && ingressTarget === 500)
      await db.query(`DROP SCHEMA ${schema} CASCADE`).catch(()=>{});
    else if (installed) nativeLog(`${label}_SCHEMA_PRESERVED ` + schema);
    await db.end().catch(()=>{});
  }
}
run().catch(error=>{console.error(`${label}_ABORT`,error.stack||String(error));
  process.exitCode=1;});
