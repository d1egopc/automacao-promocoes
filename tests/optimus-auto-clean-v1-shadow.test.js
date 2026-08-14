"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  TTL_PADRAO,
  autoCleanShadowAtivo,
  autoCleanExecuteAtivo,
  criarPoliticaRetencao,
  avaliarRegistroAutoClean,
  executarAutoCleanShadow,
  executarAutoCleanShadowSeguro,
  executarAutoCleanExecute,
  executarJobsPostgresAutoClean,
  executarOfertasPostgresAutoClean,
  executarFilaJsonAutoClean,
  executarArquivosAutoClean,
  MATRIZ_STATUS_AUTO_CLEAN,
  auditarFilaJson,
  inventariarArquivosPorCategoria,
  memoriaComercialStatus
} = require("../modules/engine/auto-clean/auto-clean.service");

const AGORA = Date.parse("2026-08-03T12:00:00.000Z");

function isoAtras(ms) {
  return new Date(AGORA - ms).toISOString();
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "optimus-auto-clean-shadow-"));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function escreverJson(file, dados) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(dados, null, 2));
}

function tocarArquivo(file, conteudo, mtimeMs) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, conteudo);
  const data = new Date(mtimeMs);
  fs.utimesSync(file, data, data);
}

function capturarLogger() {
  const logs = [];
  return {
    logs,
    logger: {
      log: (...args) => logs.push(args.join(" "))
    }
  };
}

function criarPoolJobsAutoClean(batches = []) {
  const chamadas = [];
  let indiceBatch = 0;
  const client = {
    async query(sql, params = []) {
      chamadas.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (/pg_try_advisory_xact_lock/i.test(sql)) return { rows: [{ locked: true }] };
      if (/WITH candidatos/i.test(sql)) {
        if (/ofertas_removidas/i.test(sql)) {
          const batch = batches[indiceBatch] || {};
          indiceBatch += 1;
          return {
            rows: [{
              ofertas_removidas: batch.ofertas || 0,
              bytes_ofertas: batch.bytesOfertas || 0
            }]
          };
        }
        const batch = batches[indiceBatch] || {};
        indiceBatch += 1;
        return {
          rows: [{
            jobs_removidos: batch.jobs || 0,
            processamentos_removidos: batch.processamentos || 0,
            eventos_comerciais_removidos: batch.eventos || 0,
            bytes_jobs: batch.bytesJobs || 0,
            bytes_processamentos: batch.bytesProcessamentos || 0,
            bytes_eventos_comerciais: batch.bytesEventos || 0
          }]
        };
      }
      throw new Error(`query inesperada: ${sql}`);
    },
    release() {
      chamadas.push({ sql: "RELEASE", params: [] });
    }
  };

  return {
    chamadas,
    pool: {
      async connect() {
        chamadas.push({ sql: "CONNECT", params: [] });
        return client;
      }
    }
  };
}

async function testarTtlEStatus() {
  const politica = criarPoliticaRetencao({ loteLimite: 100 });

  const vivo = avaliarRegistroAutoClean({
    origem: "fila_json",
    tipoRegistro: "fila_json",
    status: "pendente",
    referenciaTemporal: isoAtras(10 * TTL_PADRAO.filaTerminalMs)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(vivo.elegivel, false);
  assert.strictEqual(vivo.motivo, "item_vivo");

  const flowRecente = avaliarRegistroAutoClean({
    origem: "engine_ofertas",
    tipoRegistro: "engine_ofertas",
    status: "flow_nao_aceita",
    referenciaTemporal: isoAtras(11 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(flowRecente.elegivel, false);
  assert.strictEqual(flowRecente.motivo, "dentro_ttl");

  const flowAntigo = avaliarRegistroAutoClean({
    origem: "engine_ofertas",
    tipoRegistro: "engine_ofertas",
    status: "flow_nao_aceita",
    referenciaTemporal: isoAtras(13 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(flowAntigo.elegivel, true);
  assert.strictEqual(flowAntigo.aplicouMudancas, false);

  const retidaGenerica = avaliarRegistroAutoClean({
    origem: "engine_ofertas",
    tipoRegistro: "engine_ofertas",
    status: "retida",
    referenciaTemporal: isoAtras(30 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(retidaGenerica.elegivel, false);
  assert.strictEqual(retidaGenerica.motivo, "sem_politica_ttl");

  const retidaTerminal = avaliarRegistroAutoClean({
    origem: "engine_ofertas",
    tipoRegistro: "engine_ofertas",
    status: "retida",
    ofertaTerminalConfirmada: true,
    referenciaTemporal: isoAtras(13 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(retidaTerminal.elegivel, true);

  const enviadoRecente = avaliarRegistroAutoClean({
    origem: "fila_json",
    tipoRegistro: "fila_json",
    status: "enviado",
    referenciaTemporal: isoAtras(6 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(enviadoRecente.elegivel, false);

  const enviadoAntigo = avaliarRegistroAutoClean({
    origem: "fila_json",
    tipoRegistro: "fila_json",
    status: "enviado",
    referenciaTemporal: isoAtras(26 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(enviadoAntigo.elegivel, true);

  const jobFinal11h = avaliarRegistroAutoClean({
    origem: "engine_jobs_cliente",
    tipoRegistro: "engine_jobs_cliente",
    status: "concluido",
    referenciaTemporal: isoAtras(11 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(jobFinal11h.elegivel, false, "job final com menos de 12h permanece completo");

  const jobFinal13h = avaliarRegistroAutoClean({
    origem: "engine_jobs_cliente",
    tipoRegistro: "engine_jobs_cliente",
    status: "concluido",
    referenciaTemporal: isoAtras(13 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(jobFinal13h.elegivel, true, "job final com mais de 12h entra no plano seguro");

  const jobRetryAntigo = avaliarRegistroAutoClean({
    origem: "engine_jobs_cliente",
    tipoRegistro: "engine_jobs_cliente",
    status: "retry",
    referenciaTemporal: isoAtras(10 * 24 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(jobRetryAntigo.elegivel, false);
  assert.strictEqual(jobRetryAntigo.motivo, "job_ativo");

  const jobProcessandoFresco = avaliarRegistroAutoClean({
    origem: "engine_jobs_cliente",
    tipoRegistro: "engine_jobs_cliente",
    status: "processando",
    referenciaTemporal: isoAtras(10 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(jobProcessandoFresco.elegivel, false);
  assert.strictEqual(jobProcessandoFresco.motivo, "job_ativo_fresco");

  const jobImportandoAntigo = avaliarRegistroAutoClean({
    origem: "engine_jobs_cliente",
    tipoRegistro: "engine_jobs_cliente",
    status: "importando",
    referenciaTemporal: isoAtras(40 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(jobImportandoAntigo.elegivel, false, "lease vencido nao entra em delete generico");
  assert.strictEqual(jobImportandoAntigo.motivo, "lease_expirado_operacional");

  const jobStatusDesconhecido = avaliarRegistroAutoClean({
    origem: "engine_jobs_cliente",
    tipoRegistro: "engine_jobs_cliente",
    status: "erro",
    referenciaTemporal: isoAtras(30 * 24 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(jobStatusDesconhecido.elegivel, false);
  assert.strictEqual(jobStatusDesconhecido.motivo, "sem_politica_ttl");

  const jobSemTimestamp = avaliarRegistroAutoClean({
    origem: "engine_jobs_cliente",
    tipoRegistro: "engine_jobs_cliente",
    status: "concluido"
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(jobSemTimestamp.elegivel, false);
  assert.strictEqual(jobSemTimestamp.motivo, "timestamp_indisponivel");

  for (const status of ["oferta_criada", "integracao_ausente", "retida_v2", "erro_importacao"]) {
    const recente = avaliarRegistroAutoClean({
      origem: "engine_jobs_cliente",
      tipoRegistro: "engine_jobs_cliente",
      status,
      referenciaTemporal: isoAtras(23 * 60 * 60 * 1000)
    }, { politica, agoraMs: AGORA });
    assert.strictEqual(recente.elegivel, false, `${status} recente fica dentro do TTL curto`);

    const antigo = avaliarRegistroAutoClean({
      origem: "engine_jobs_cliente",
      tipoRegistro: "engine_jobs_cliente",
      status,
      referenciaTemporal: isoAtras(25 * 60 * 60 * 1000)
    }, { politica, agoraMs: AGORA });
    assert.strictEqual(antigo.elegivel, true, `${status} antigo nao pode virar poca operacional`);
  }
}

async function testarMatrizStatusOficial() {
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.oferta_criada.vivo, true);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.importando.vivo, true);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.processando.vivo, true);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.importando.vivoAteMinutos, 30);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.processando.vivoAteMinutos, 30);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.oferta_criada.vivoAteHoras, 24);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.oferta_criada.removivelAposHoras, 24);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.integracao_ausente.removivelAposHoras, 24);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.retida_v2.removivelAposHoras, 24);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.erro_importacao.removivelAposHoras, 24);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.integracao_ausente.ttlCompactoDias, 7);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.expirada_operacional.terminal, true);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.expirada_operacional.removivelAposHoras, 12);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.expirada_operacional.historicoLeveSeparado, true);
}

async function testarDependenciasProtegidas() {
  const politica = criarPoliticaRetencao();

  const ofertaComFilaViva = avaliarRegistroAutoClean({
    origem: "engine_ofertas",
    tipoRegistro: "engine_ofertas",
    status: "flow_nao_aceita",
    referenciaTemporal: isoAtras(48 * 60 * 60 * 1000),
    temReferenciaFilaViva: true
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(ofertaComFilaViva.elegivel, false);
  assert.strictEqual(ofertaComFilaViva.motivo, "referencia_fila_viva");

  const eventoComJobAtivo = avaliarRegistroAutoClean({
    origem: "engine_eventos_brutos",
    tipoRegistro: "engine_eventos_brutos",
    status: "evento_bruto",
    referenciaTemporal: isoAtras(20 * 24 * 60 * 60 * 1000),
    temJobAtivo: true
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(eventoComJobAtivo.elegivel, false);
  assert.strictEqual(eventoComJobAtivo.motivo, "job_ativo");

  const linkComOfertaAtiva = avaliarRegistroAutoClean({
    origem: "engine_links",
    tipoRegistro: "engine_links",
    status: "link",
    referenciaTemporal: isoAtras(20 * 24 * 60 * 60 * 1000),
    temOfertaAtiva: true
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(linkComOfertaAtiva.elegivel, false);
  assert.strictEqual(linkComOfertaAtiva.motivo, "oferta_ativa");
}

async function testarFilaJsonShadow() {
  const dir = tempDir();
  const clienteDir = path.join(dir, "clientes", "user_40qdblgt");
  const filaPath = path.join(clienteDir, "fila.json");
  const fila = [];
  for (let i = 0; i < 150; i += 1) {
    fila.push({ id: `enviado_${i}`, status: "enviado", enviadoEm: isoAtras(48 * 60 * 60 * 1000), titulo: "Oferta teste" });
  }
  fila.push({ id: "vivo", status: "pendente", dataEntradaFila: isoAtras(48 * 60 * 60 * 1000) });
  escreverJson(filaPath, fila);
  const antes = fs.readFileSync(filaPath, "utf8");

  const resumo = auditarFilaJson({ dataDir: dir, agoraMs: AGORA, loteLimite: 100 });
  assert.strictEqual(resumo.quantidade, 100, "lote nao deve ultrapassar 100");
  assert.strictEqual(resumo.elegiveis, 100);
  assert.strictEqual(resumo.aplicouMudancas, false);
  assert.strictEqual(fs.readFileSync(filaPath, "utf8"), antes, "shadow nao reescreve fila");

  const dirInvalido = tempDir();
  const filaInvalida = path.join(dirInvalido, "clientes", "user_invalido", "fila.json");
  mkdirp(path.dirname(filaInvalida));
  fs.writeFileSync(filaInvalida, "{ json invalido");
  const invalidaAntes = fs.readFileSync(filaInvalida, "utf8");
  const resumoInvalido = auditarFilaJson({ dataDir: dirInvalido, agoraMs: AGORA });
  assert.strictEqual(resumoInvalido.filasInvalidas, 1);
  assert.strictEqual(fs.readFileSync(filaInvalida, "utf8"), invalidaAntes, "fila invalida nao e reescrita");
}

async function testarArquivosProtegidosEShadow() {
  const dir = tempDir();
  tocarArquivo(path.join(dir, "logs", "app.log"), "linha antiga", AGORA - 20 * 24 * 60 * 60 * 1000);
  tocarArquivo(path.join(dir, "cache", "imagem.tmp"), "cache", AGORA - 5 * 24 * 60 * 60 * 1000);
  tocarArquivo(path.join(dir, "sessions", "auth", "creds.json"), "segredo", AGORA - 60 * 24 * 60 * 60 * 1000);

  const resumos = inventariarArquivosPorCategoria({ dataDir: dir, agoraMs: AGORA, loteLimite: 100 });
  const logs = resumos.find(item => item.origem === "logs_persistidos");
  const temporarios = resumos.find(item => item.origem === "temporarios");
  assert.strictEqual(logs.elegiveis, 1);
  assert.strictEqual(temporarios.elegiveis, 1);
  assert.ok(!JSON.stringify(resumos).includes("creds.json"), "sessao/auth nao entra no inventario de limpeza");
}

async function testarMemoriaComercialIntacta() {
  const dir = tempDir();
  const memoria = path.join(dir, "ofertas_vistas.json");
  escreverJson(memoria, [{ chave: "produto", vistoEm: new Date(AGORA).toISOString() }]);
  const antes = fs.readFileSync(memoria, "utf8");
  const resumo = memoriaComercialStatus({ dataDir: dir });
  assert.strictEqual(resumo.elegiveis, 0);
  assert.strictEqual(resumo.protegidos, 1);
  assert.strictEqual(fs.readFileSync(memoria, "utf8"), antes);
}

async function testarPostgresShadowEDependencias() {
  const { logger, logs } = capturarLogger();
  const chamadas = [];
  const queryMock = async (sql, params) => {
    chamadas.push({ sql, params });
    if (/FROM engine_eventos_brutos/i.test(sql)) {
      return { ok: true, resultado: { rows: [{ id: 1, status: "evento_bruto", referencia_temporal: isoAtras(20 * 24 * 60 * 60 * 1000), bytes_estimados: 200, tem_job_ativo: true }] } };
    }
    if (/FROM engine_links/i.test(sql)) {
      return { ok: true, resultado: { rows: [{ id: 2, status: "link", referencia_temporal: isoAtras(20 * 24 * 60 * 60 * 1000), bytes_estimados: 150, tem_oferta_ativa: true }] } };
    }
    if (/FROM engine_ofertas/i.test(sql)) {
      return { ok: true, resultado: { rows: [{ id: 3, status: "flow_nao_aceita", referencia_temporal: isoAtras(26 * 60 * 60 * 1000), bytes_estimados: 300 }] } };
    }
    return { ok: true, resultado: { rows: [] } };
  };

  const resumo = await executarAutoCleanShadow({
    shadow: true,
    incluirArquivos: false,
    queryEngine: queryMock,
    agoraMs: AGORA,
    logger
  });

  assert.strictEqual(resumo.aplicouMudancas, false);
  assert.ok(chamadas.length >= 6, "inventario postgres deve consultar origens esperadas");
  const origemEventos = resumo.origens.find(item => item.origem === "engine_eventos_brutos");
  const origemLinks = resumo.origens.find(item => item.origem === "engine_links");
  const origemOfertas = resumo.origens.find(item => item.origem === "engine_ofertas");
  assert.strictEqual(origemEventos.protegidos, 1);
  assert.strictEqual(origemEventos.motivos.job_ativo, 1);
  assert.strictEqual(origemLinks.protegidos, 1);
  assert.strictEqual(origemLinks.motivos.oferta_ativa, 1);
  assert.strictEqual(origemOfertas.elegiveis, 1);
  assert.ok(logs.some(linha => linha.includes("[OPTIMUS-AUTO-CLEAN-V1-SHADOW]")));
  assert.ok(logs.some(linha => linha.includes("[OPTIMUS-AUTO-CLEAN-V1-RESUMO]")));
  assert.ok(!logs.join("\n").includes("http"));
  assert.ok(!logs.join("\n").includes("cupom"));
  assert.ok(!logs.join("\n").includes("preco"));
}

async function testarExecutePostgresControlado() {
  const { pool, chamadas } = criarPoolJobsAutoClean([
    { jobs: 2, processamentos: 5, eventos: 1, bytesJobs: 100, bytesProcessamentos: 250, bytesEventos: 50 },
    { jobs: 2, processamentos: 4, eventos: 0, bytesJobs: 100, bytesProcessamentos: 200, bytesEventos: 0 },
    { jobs: 2, processamentos: 3, eventos: 0, bytesJobs: 100, bytesProcessamentos: 150, bytesEventos: 0 },
    { jobs: 2, processamentos: 2, eventos: 0, bytesJobs: 100, bytesProcessamentos: 100, bytesEventos: 0 }
  ]);

  const resumo = await executarJobsPostgresAutoClean({
    pool,
    queryEngine: async () => ({ ok: true, resultado: { rows: [{ jobs_expirados: "0" }] } }),
    loteLimite: 2,
    lotesDbPorCiclo: 3,
    horasMinimas: 12
  });

  assert.strictEqual(resumo.ok, true);
  assert.strictEqual(resumo.lotes, 3, "execute limita lotes por ciclo");
  assert.strictEqual(resumo.jobsRemovidos, 6);
  assert.strictEqual(resumo.jobsExpiradosLease, 0);
  assert.strictEqual(resumo.processamentosRemovidos, 12);
  assert.strictEqual(resumo.eventosComerciaisRemovidos, 1);
  assert.strictEqual(resumo.aplicouMudancas, true);
  assert.strictEqual(resumo.vacuumExecutado, false);

  const deleteSql = chamadas.find(chamada => /WITH candidatos/i.test(chamada.sql));
  assert.ok(deleteSql, "batch de delete deve ser executado");
  assert.ok(
    deleteSql.sql.indexOf("eventos_removidos") < deleteSql.sql.indexOf("processamentos_removidos") &&
    deleteSql.sql.indexOf("processamentos_removidos") < deleteSql.sql.indexOf("jobs_removidos"),
    "dependencias saem antes do job principal"
  );
  assert.strictEqual(deleteSql.params[1], 12);
  assert.strictEqual(deleteSql.params[2], 2);
  assert.ok(deleteSql.params[0].includes("expirada_operacional"));
  assert.ok(deleteSql.params[0].includes("oferta_criada"));
  assert.ok(deleteSql.params[0].includes("integracao_ausente"));
  assert.ok(deleteSql.params[0].includes("retida_v2"));
  assert.ok(deleteSql.params[0].includes("erro_importacao"));
  assert.ok(!deleteSql.params[0].includes("importando"));
  assert.ok(!deleteSql.params[0].includes("processando"));
  assert.ok(deleteSql.sql.includes("WHEN status = 'oferta_criada' THEN 24"));
  assert.ok(deleteSql.sql.includes("WHEN status = 'expirada_operacional' THEN 12"));
}

async function testarExecuteOfertasPostgresD1() {
  const { pool, chamadas } = criarPoolJobsAutoClean([
    { ofertas: 2, bytesOfertas: 500 },
    { ofertas: 1, bytesOfertas: 250 },
    { ofertas: 0, bytesOfertas: 0 }
  ]);

  const resumo = await executarOfertasPostgresAutoClean({
    pool,
    loteLimite: 2,
    lotesDbPorCiclo: 3,
    horasMinimasOfertas: 12
  });

  assert.strictEqual(resumo.ok, true);
  assert.strictEqual(resumo.lotes, 2);
  assert.strictEqual(resumo.ofertasRemovidas, 3);
  assert.strictEqual(resumo.aplicouMudancas, true);
  assert.strictEqual(resumo.vacuumExecutado, false);

  const deleteSql = chamadas.find(chamada => /ofertas_removidas/i.test(chamada.sql));
  assert.ok(deleteSql, "batch D1 de engine_ofertas deve ser executado");
  assert.ok(deleteSql.sql.includes("DELETE FROM engine_ofertas"), "D1 remove somente engine_ofertas");
  assert.ok(!deleteSql.sql.includes("DELETE FROM engine_jobs_cliente"), "D1 nao remove jobs");
  assert.ok(!deleteSql.sql.includes("DELETE FROM engine_eventos_brutos"), "D1 nao remove eventos");
  assert.ok(!deleteSql.sql.includes("DELETE FROM engine_links"), "D1 nao remove links");
  assert.ok(deleteSql.sql.includes("COALESCE(o.atualizada_em, o.criada_em) < NOW() - ($1::int * INTERVAL '1 hour')"));
  assert.ok(deleteSql.sql.includes("NOT EXISTS"));
  assert.ok(deleteSql.sql.includes("j.status = ANY($2::text[])"));
  assert.ok(deleteSql.sql.includes("o.status IN ('retida','retido')"));
  assert.ok(deleteSql.sql.includes("retidaTerminal"));
  assert.ok(deleteSql.sql.includes("definitivoOperacional"));
  const deleteFinalSql = deleteSql.sql.slice(deleteSql.sql.indexOf("DELETE FROM engine_ofertas"));
  assert.ok(deleteFinalSql.includes("NOT EXISTS"), "DELETE final deve revalidar ausencia de job vivo");
  assert.ok(deleteFinalSql.includes("j.oferta_id = o.id"), "DELETE final protege corrida por oferta_id");
  assert.ok(deleteFinalSql.includes("j.evento_id = o.evento_id"), "DELETE final protege corrida por evento_id");
  assert.ok(deleteFinalSql.includes("COALESCE(o.atualizada_em, o.criada_em) < NOW() - ($1::int * INTERVAL '1 hour')"), "DELETE final revalida idade >12h");
  assert.ok(deleteFinalSql.includes("retidaTerminal"), "DELETE final revalida terminalidade");
  assert.ok((deleteSql.sql.match(/NOT EXISTS/g) || []).length >= 2, "CTE e DELETE final precisam proteger job vivo");
  assert.strictEqual(deleteSql.params[0], 12);
  assert.strictEqual(deleteSql.params[2], 2);
  assert.ok(deleteSql.params[1].includes("pendente"));
  assert.ok(deleteSql.params[1].includes("processando"));
}

async function testarCorridaOfertasPostgresD1Revalidada() {
  const chamadas = [];
  const client = {
    async query(sql, params = []) {
      chamadas.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (/pg_try_advisory_xact_lock/i.test(sql)) return { rows: [{ locked: true }] };
      if (/ofertas_removidas/i.test(sql)) {
        const deleteFinalSql = sql.slice(sql.indexOf("DELETE FROM engine_ofertas"));
        assert.ok(deleteFinalSql.includes("NOT EXISTS"), "corrida: DELETE final precisa revalidar job vivo");
        assert.ok(deleteFinalSql.includes("j.oferta_id = o.id"), "corrida: job vivo por oferta_id bloqueia delete");
        assert.ok(deleteFinalSql.includes("j.evento_id = o.evento_id"), "corrida: job vivo por evento_id bloqueia delete");
        return { rows: [{ ofertas_removidas: 0, bytes_ofertas: 0 }] };
      }
      throw new Error(`query inesperada: ${sql}`);
    },
    release() {}
  };

  const resumo = await executarOfertasPostgresAutoClean({
    pool: { async connect() { return client; } },
    loteLimite: 10,
    lotesDbPorCiclo: 1,
    horasMinimasOfertas: 12
  });

  assert.strictEqual(resumo.ok, true);
  assert.strictEqual(resumo.ofertasRemovidas, 0, "oferta selecionada deve permanecer quando a revalidacao encontra job vivo");
  assert.ok(chamadas.some(chamada => /ofertas_removidas/i.test(chamada.sql)));
}

async function testarExecutePostgresFailOpen() {
  const resumo = await executarJobsPostgresAutoClean({
    queryEngine: async () => ({ ok: true, resultado: { rows: [{ jobs_expirados: "0" }] } }),
    getEnginePool: () => ({
      async connect() {
        throw Object.assign(new Error("conexao falhou"), { code: "ECONNRESET" });
      }
    })
  });

  assert.strictEqual(resumo.ok, false);
  assert.strictEqual(resumo.failOpen, true);
  assert.strictEqual(resumo.aplicouMudancas, false);
}

async function testarExecuteFilaJsonSeguro() {
  const dir = tempDir();
  const workspace = "user_fila_execute";
  const filaPath = path.join(dir, "clientes", workspace, "fila.json");
  escreverJson(filaPath, [
    { id: "vivo", status: "pendente", criadoEm: isoAtras(10 * 24 * 60 * 60 * 1000), payloadBruto: { deveFicar: true } },
    { id: "recente", status: "enviado", enviadoEm: isoAtras(6 * 60 * 60 * 1000), payloadBruto: { deveFicar: true } },
    { id: "compactar", ofertaId: "oferta_compactar", status: "enviado", enviadoEm: isoAtras(3 * 24 * 60 * 60 * 1000), preco: 99.9, thumbnail: "https://img.test/t.jpg", payloadBruto: { html: "pesado" }, mensagemRenderizada: "texto enorme" },
    { id: "remover", status: "enviado", enviadoEm: isoAtras(8 * 24 * 60 * 60 * 1000), payloadBruto: { html: "antigo" } }
  ]);

  const resumo = executarFilaJsonAutoClean({
    dataDir: dir,
    agoraMs: AGORA,
    workspaces: [workspace],
    workspacesFilaPorCiclo: 1
  });

  assert.strictEqual(resumo.aplicouMudancas, true);
  assert.strictEqual(resumo.filasRegravadas, 1);
  assert.strictEqual(resumo.compactados, 1);
  assert.strictEqual(resumo.removidos, 1);

  const fila = JSON.parse(fs.readFileSync(filaPath, "utf8"));
  assert.ok(fila.some(item => item.id === "vivo" && item.payloadBruto));
  assert.ok(fila.some(item => item.id === "recente" && item.payloadBruto));
  const compacto = fila.find(item => item.id === "compactar");
  assert.strictEqual(compacto.compacto, true);
  assert.strictEqual(compacto.preco, 99.9);
  assert.strictEqual(compacto.thumbnail, "https://img.test/t.jpg");
  assert.ok(!JSON.stringify(compacto).includes("payloadBruto"));
  assert.ok(!JSON.stringify(compacto).includes("mensagemRenderizada"));
  assert.ok(!fila.some(item => item.id === "remover"));
}

async function testarExecuteArquivosProtegePermanentes() {
  const dir = tempDir();
  const logAntigo = path.join(dir, "logs", "app.log");
  const cacheAntigo = path.join(dir, "cache", "thumb.tmp");
  const authAntigo = path.join(dir, "auth", "sessao", "creds.json");
  const configAntiga = path.join(dir, "clientes", "user_config", "config.json");
  tocarArquivo(logAntigo, "log antigo", AGORA - 2 * 24 * 60 * 60 * 1000);
  tocarArquivo(cacheAntigo, "cache antigo", AGORA - 2 * 24 * 60 * 60 * 1000);
  tocarArquivo(authAntigo, "segredo", AGORA - 30 * 24 * 60 * 60 * 1000);
  tocarArquivo(configAntiga, "{}", AGORA - 30 * 24 * 60 * 60 * 1000);

  const resumo = executarArquivosAutoClean({ dataDir: dir, agoraMs: AGORA, loteLimite: 10 });
  assert.strictEqual(resumo.arquivosRemovidos, 2);
  assert.strictEqual(fs.existsSync(logAntigo), false);
  assert.strictEqual(fs.existsSync(cacheAntigo), false);
  assert.strictEqual(fs.existsSync(authAntigo), true);
  assert.strictEqual(fs.existsSync(configAntiga), true);
}

async function testarExecuteUniversalPorFlag() {
  const { pool } = criarPoolJobsAutoClean([
    { jobs: 1, processamentos: 2, eventos: 0, bytesJobs: 100, bytesProcessamentos: 100 }
  ]);
  const { logger, logs } = capturarLogger();
  const resumo = await executarAutoCleanShadowSeguro({
    execute: true,
    incluirArquivos: false,
    incluirPostgres: true,
    pool,
    queryEngine: async () => ({ ok: true, resultado: { rows: [] } }),
    loteLimite: 1,
    lotesDbPorCiclo: 1,
    logger
  });

  assert.strictEqual(resumo.ok, true);
  assert.strictEqual(resumo.aplicouMudancas, true);
  assert.strictEqual(resumo.execute.jobsRemovidos, 1);
  assert.ok(logs.some(linha => linha.includes("[OPTIMUS-AUTO-CLEAN-V1-EXECUTE]")));
  assert.ok(!logs.join("\n").includes("payload"));
}

async function testarFailOpenEFlags() {
  const shadowAnterior = process.env.OPTIMUS_AUTO_CLEAN_SHADOW;
  const executeAnterior = process.env.OPTIMUS_AUTO_CLEAN_EXECUTE;
  try {
    delete process.env.OPTIMUS_AUTO_CLEAN_SHADOW;
    delete process.env.OPTIMUS_AUTO_CLEAN_EXECUTE;
    assert.strictEqual(autoCleanShadowAtivo(), true, "Auto-Clean shadow/auditoria e default universal");
    assert.strictEqual(autoCleanExecuteAtivo(), false);
    process.env.OPTIMUS_AUTO_CLEAN_SHADOW = "0";
    assert.strictEqual(autoCleanShadowAtivo(), false, "rollback administrativo explicito desativa auditoria");
    process.env.OPTIMUS_AUTO_CLEAN_SHADOW = "1";
    assert.strictEqual(autoCleanShadowAtivo(), true);

    const universal = await executarAutoCleanShadowSeguro({
      incluirArquivos: false,
      queryEngine: async () => ({ ok: true, resultado: { rows: [] } }),
      logger: capturarLogger().logger
    });
    assert.strictEqual(universal.ok, true);
    assert.strictEqual(universal.pulado, undefined);
    assert.strictEqual(universal.aplicouMudancas, false);

    const { logger, logs } = capturarLogger();
    const retorno = await executarAutoCleanShadowSeguro({
      shadow: true,
      incluirArquivos: false,
      queryEngine: async () => { throw Object.assign(new Error("falha com https://segredo.test?token=1"), { code: "MOCK" }); },
      logger
    });
    assert.strictEqual(retorno.failOpen, true);
    assert.strictEqual(retorno.aplicouMudancas, false);
    assert.ok(logs.some(linha => linha.includes("[OPTIMUS-AUTO-CLEAN-V1-ERRO]")));
    assert.ok(!logs.join("\n").includes("segredo.test"));
    assert.ok(!logs.join("\n").includes("token"));
  } finally {
    if (shadowAnterior === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_SHADOW;
    else process.env.OPTIMUS_AUTO_CLEAN_SHADOW = shadowAnterior;
    if (executeAnterior === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_EXECUTE;
    else process.env.OPTIMUS_AUTO_CLEAN_EXECUTE = executeAnterior;
  }
}

(async () => {
  await testarTtlEStatus();
  await testarMatrizStatusOficial();
  await testarDependenciasProtegidas();
  await testarFilaJsonShadow();
  await testarArquivosProtegidosEShadow();
  await testarMemoriaComercialIntacta();
  await testarPostgresShadowEDependencias();
  await testarExecutePostgresControlado();
  await testarExecuteOfertasPostgresD1();
  await testarCorridaOfertasPostgresD1Revalidada();
  await testarExecutePostgresFailOpen();
  await testarExecuteFilaJsonSeguro();
  await testarExecuteArquivosProtegePermanentes();
  await testarExecuteUniversalPorFlag();
  await testarFailOpenEFlags();
  console.log("optimus-auto-clean-v1-shadow.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});

