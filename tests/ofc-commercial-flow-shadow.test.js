const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  TIPOS_EVENTO_COMERCIAL,
  metadataSanitizada,
  montarChaveIdempotencia,
  normalizarEventoComercial,
  registrarEventoComercialSeguro
} = require("../modules/engine/ofc/commercial-events.service");
const {
  calcularFluxoComercialShadow,
  criarFluxoComercialShadowOfc
} = require("../modules/engine/ofc/commercial-flow.service");
const {
  calcularCapacidadeComercialTeorica
} = require("../modules/engine/ofc/commercial-capacity.service");
const {
  SQL_SCHEMA_EVENTOS_COMERCIAIS,
  prepararSchemaEventosComerciaisSeguro
} = require("../modules/engine/ofc/commercial-events.repository");

const metadata = metadataSanitizada({
  status: "enviado",
  motivo: "envio_confirmado",
  token: "segredo",
  cookie: "sessao",
  link: "https://exemplo.com/?token=abc",
  textoCompleto: "nao deve ir",
  destinosEnviados: 2
});

assert.deepStrictEqual(metadata, {
  status: "enviado",
  motivo: "envio_confirmado",
  destinosEnviados: 2
});

const evento = normalizarEventoComercial({
  tipoEvento: TIPOS_EVENTO_COMERCIAL.EXECUTOR_ENVIADO,
  clienteId: "user_a",
  ofertaId: "123",
  jobId: "456",
  filaItemId: "fila_1",
  marketplace: "MercadoLivre",
  metadata: {
    status: "enviado",
    motivo: "envio_confirmado",
    senha: "nao"
  }
});

assert.strictEqual(evento.tipoEvento, "executor_enviado");
assert.strictEqual(evento.clienteId, "user_a");
assert.strictEqual(evento.workspaceId, "user_a");
assert.strictEqual(evento.ofertaId, 123);
assert.strictEqual(evento.jobId, 456);
assert.strictEqual(evento.marketplace, "mercadolivre");
assert.strictEqual(evento.metadata.senha, undefined);
assert.ok(evento.chaveIdempotencia.includes("executor_enviado"));
assert.strictEqual(
  montarChaveIdempotencia(evento),
  evento.chaveIdempotencia
);

(async () => {
  const registros = [];
  const primeira = await registrarEventoComercialSeguro(evento, {
    repositorio: async item => {
      registros.push(item);
      return { ok: true, inserido: true, id: 1 };
    }
  });
  assert.strictEqual(primeira.ok, true);
  assert.strictEqual(primeira.evento.chaveIdempotencia, evento.chaveIdempotencia);
  assert.strictEqual(registros.length, 1);

  const falha = await registrarEventoComercialSeguro(evento, {
    repositorio: async () => ({ ok: false, motivo: "db_falhou", erro: "timeout" })
  });
  assert.strictEqual(falha.ok, false);
  assert.strictEqual(falha.motivo, "db_falhou");

  const sqlExecutado = [];
  const schemaOk = await prepararSchemaEventosComerciaisSeguro({
    query: async sql => {
      sqlExecutado.push(sql);
      return { ok: true, resultado: { rows: [], rowCount: 0 } };
    }
  });
  assert.strictEqual(schemaOk.ok, true);
  assert.strictEqual(schemaOk.tabelaDisponivel, true);
  assert.strictEqual(schemaOk.indiceIdempotenciaDisponivel, true);
  assert(sqlExecutado.some(sql => /CREATE TABLE IF NOT EXISTS engine_eventos_comerciais/i.test(sql)));
  assert(sqlExecutado.some(sql => /idx_engine_eventos_comerciais_chave/i.test(sql)));
  assert.strictEqual(sqlExecutado.some(sql => /gen_random_uuid|pgcrypto|\buuid\b/i.test(sql)), false);

  const schemaSegundoBoot = await prepararSchemaEventosComerciaisSeguro({
    query: async sql => {
      sqlExecutado.push(sql);
      return { ok: true, resultado: { rows: [], rowCount: 0 } };
    }
  });
  assert.strictEqual(schemaSegundoBoot.ok, true);

  const schemaErro = await prepararSchemaEventosComerciaisSeguro({
    query: async () => ({ ok: false, motivo: "ddl_falhou", erro: "permissao" })
  });
  assert.strictEqual(schemaErro.ok, false);
  assert.strictEqual(schemaErro.failSafe, true);
  assert.strictEqual(schemaErro.motivo, "ddl_falhou");

  const fluxo = calcularFluxoComercialShadow({
    dados: {
      ok: true,
      janelaMinutos: 10,
      eventos: [
        { tipo_evento: "oferta_universal_criada", total: 20 },
        { tipo_evento: "distribuicao_final", total: 10 },
        { tipo_evento: "fila_cliente_adicionada", total: 8 },
        { tipo_evento: "executor_enviado", total: 5 },
        { tipo_evento: "executor_erro_final", total: 2 }
      ],
      porMarketplace: [{ tipo_evento: "executor_enviado", marketplace: "amazon", total: 5 }],
      porCliente: [{ tipo_evento: "executor_enviado", cliente_id: "user_a", total: 5 }],
      porCanal: [{ tipo_evento: "executor_enviado", canal: "whatsapp", total: 5 }],
      radarOferta: {
        total: 3,
        total_sem_vinculo: 1,
        media_ms: 1000,
        mediana_ms: 800,
        p95_ms: 1500
      }
    },
    capacidade: {
      ok: true,
      workspacesAptosAgora: 2,
      destinosAptosAgora: 3,
      capacidadeComercialTeoricaPorMinuto: 0.6
    },
    duracaoMs: 4
  });

  assert.strictEqual(fluxo.modo, "shadow");
  assert.strictEqual(fluxo.aplicouMudancas, false);
  assert.strictEqual(fluxo.ofertasCriadasPorMinuto, 2);
  assert.strictEqual(fluxo.ofertasDistribuidasPorMinuto, 1);
  assert.strictEqual(fluxo.itensAdicionadosFilaPorMinuto, 0.8);
  assert.strictEqual(fluxo.enviosConfirmadosPorMinuto, 0.5);
  assert.strictEqual(fluxo.enviosErroFinalPorMinuto, 0.2);
  assert.strictEqual(fluxo.consumoComercialPorMinuto, 0.5);
  assert.strictEqual(fluxo.demandaDistribuidaPorMinuto, 0.8);
  assert.strictEqual(fluxo.workspacesAptosAgora, 2);
  assert.strictEqual(fluxo.destinosAptosAgora, 3);
  assert.strictEqual(fluxo.tempoMedioRadarOfertaMs, 1000);
  assert.strictEqual(fluxo.medianaRadarOfertaMs, 800);
  assert.strictEqual(fluxo.p95RadarOfertaMs, 1500);

  const semAmostra = calcularFluxoComercialShadow({
    dados: {
      ok: true,
      janelaMinutos: 15,
      eventos: [],
      radarOferta: { total: 0 }
    },
    capacidade: { ok: false, motivo: "sem_fonte" }
  });
  assert.strictEqual(semAmostra.tempoMedioRadarOfertaMs, null);
  assert.strictEqual(semAmostra.radarOfertaDisponivel, false);
  assert.strictEqual(semAmostra.capacidadeComercialDisponivel, false);
  assert.strictEqual(semAmostra.aplicouMudancas, false);

  const capacidade = calcularCapacidadeComercialTeorica({
    listarClientesAtivos: () => ["user_a", "user_b"],
    destinosPorCliente: {
      user_a: [
        { ativo: true, tipo: "whatsapp", id: "grupo_a", horarioInicio: "00:00", horarioFim: "23:59", intervaloMinutos: 5 },
        { ativo: false, tipo: "telegram", botToken: "x", chatId: "1" }
      ],
      user_b: {
        sessao1: [
          { ativo: true, tipo: "telegram", botToken: "token", chatId: "123", horarioInicio: "00:00", horarioFim: "23:59", intervaloMinutos: 10 }
        ]
      }
    }
  });
  assert.strictEqual(capacidade.ok, true);
  assert.strictEqual(capacidade.workspacesAptosAgora, 2);
  assert.strictEqual(capacidade.destinosAptosAgora, 2);
  assert.strictEqual(capacidade.capacidadeComercialTeoricaPorMinuto, 0.3);

  const criado = await criarFluxoComercialShadowOfc({
    janelaMinutos: 10,
    consultarFluxoComercial: async () => ({
      ok: true,
      janelaMinutos: 10,
      eventos: [{ tipo_evento: "executor_enviado", total: 10 }],
      radarOferta: { total: 0 }
    }),
    calcularCapacidade: () => ({ ok: true, workspacesAptosAgora: 1, destinosAptosAgora: 1, capacidadeComercialTeoricaPorMinuto: 0.2 })
  });
  assert.strictEqual(criado.ok, true);
  assert.strictEqual(criado.consumoComercialPorMinuto, 1);
  assert.strictEqual(criado.aplicouMudancas, false);

  const erro = await criarFluxoComercialShadowOfc({
    consultarFluxoComercial: async () => ({ ok: false, motivo: "query_falhou", erro: "db" }),
    calcularCapacidade: () => ({ ok: true })
  });
  assert.strictEqual(erro.ok, false);
  assert.strictEqual(erro.failSafe, true);
  assert.strictEqual(erro.aplicouMudancas, false);

  const schema = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "schema.sql"), "utf8");
  assert(schema.includes("CREATE TABLE IF NOT EXISTS engine_eventos_comerciais"));
  assert(schema.includes("idx_engine_eventos_comerciais_chave"));
  assert(!schema.includes("idx_engine_eventos_comerciais_uuid"));

  const repo = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "ofc", "commercial-flow.repository.js"), "utf8");
  assert(repo.includes("engine_eventos_brutos e"));
  assert(repo.includes("engine_jobs_cliente j"));
  assert(repo.includes("engine_ofertas o"));
  assert(repo.includes("e.metadata ? 'radarMirror'"));
  assert(repo.includes("o.metadata ? 'radarMirror'"));
  assert(repo.includes("j.metadata ? 'radarMirror'"));

  const controller = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "ofc", "controller.runner.js"), "utf8");
  assert(controller.includes("[OFC-FLUXO-COMERCIAL-SHADOW]"));
  assert(controller.includes("[OFC-FLUXO-COMERCIAL-ERRO]"));

  for (const arquivoWorker of [
    path.join("modules", "engine", "orchestrator.runner.js"),
    path.join("modules", "engine", "processor.runner.js"),
    path.join("modules", "engine", "processor.service.js")
  ]) {
    const fonteWorker = fs.readFileSync(path.join(__dirname, "..", arquivoWorker), "utf8");
    assert(!fonteWorker.includes("commercial-flow"), `${arquivoWorker} nao deve depender do fluxo comercial OFC`);
    assert(!fonteWorker.includes("engine_eventos_comerciais"), `${arquivoWorker} nao deve consultar eventos comerciais`);
  }

  console.log("ofc-commercial-flow-shadow.test.js OK");
})().catch(e => {
  console.error(e);
  process.exit(1);
});
