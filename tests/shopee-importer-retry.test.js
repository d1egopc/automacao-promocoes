const assert = require("assert");

function mockModulo(relativo, exports) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
  return resolvido;
}

async function testarPersistenciaRetry() {
  const chamadas = [];
  mockModulo("../modules/engine/database", {
    queryEngine: async (sql, params = []) => {
      chamadas.push({ sql, params });
      return { ok: true, resultado: { rowCount: 1, rows: [{ id: 11, status: "pronto_para_importar", tentativas: 1 }] } };
    }
  });
  mockModulo("../modules/engine/processor.service", {
    marcarJobStatus: async () => ({ ok: true }),
    registrarProcessamento: async () => ({ ok: true }),
    carregarEventoBruto: async () => ({ ok: true }),
    carregarLinksEvento: async () => ({ ok: true }),
    limitarJobs: valor => Number(valor || 10)
  });
  delete require.cache[require.resolve("../modules/engine/importer/importer.service")];
  const service = require("../modules/engine/importer/importer.service");
  const agendamento = await service.agendarRetryAfiliacaoShopee({ id: 11, metadata: {} }, { origem: "teste" }, {
    agora: new Date("2026-09-17T12:00:00.000Z")
  });
  assert.strictEqual(agendamento.ok, true);
  assert.strictEqual(agendamento.tentativa, 1);
  assert.strictEqual(agendamento.atrasoMs, 30_000);
  assert.strictEqual(agendamento.proximaTentativaEm, "2026-09-17T12:00:30.000Z");
  assert.match(chamadas[0].sql, /status = 'pronto_para_importar'/);
  assert.match(chamadas[0].sql, /tentativas = COALESCE\(tentativas, 0\) \+ 1/);
  const estado = JSON.parse(chamadas[0].params[1]);
  assert.strictEqual(estado.tentativas, 1);
  assert.strictEqual(estado.proximaTentativaEmMs, Date.parse("2026-09-17T12:00:30.000Z"));
  assert.strictEqual(service.planoRetryAfiliacaoShopee({ metadata: { afiliacaoWorkspaceRetry: { tentativas: 1 } } }).atrasoMs, 120_000);
  assert.strictEqual(service.planoRetryAfiliacaoShopee({ metadata: { afiliacaoWorkspaceRetry: { tentativas: 2 } } }).atrasoMs, 300_000);
  assert.deepStrictEqual(service.planoRetryAfiliacaoShopee({ metadata: { afiliacaoWorkspaceRetry: { tentativas: 3 } } }), {
    reagendar: false,
    tentativa: 4,
    tentativasAnteriores: 3
  });
  await service.buscarJobsProntos({ limite: 1 });
  const consultaElegibilidade = chamadas.find(chamada => /WITH base AS/.test(chamada.sql));
  assert.ok(consultaElegibilidade, "worker consulta jobs persistidos");
  assert.match(consultaElegibilidade.sql, /afiliacaoWorkspaceRetry,proximaTentativaEmMs/);
  assert.match(consultaElegibilidade.sql, /EXTRACT\(EPOCH FROM NOW\(\)\)/);
}

async function testarRunner() {
  const finais = [];
  const agendados = [];
  let resultadoAdapter = { ok: false, retriavel: true, motivo: "afiliacao_workspace_incompleta", motivoDetalhe: "afiliacao_workspace_nao_confirmada" };
  let gravacoes = 0;
  mockModulo("../modules/engine/importer/importer.service", {
    buscarJobsProntos: async () => ({ ok: true, jobs: [] }),
    tentarMarcarImportando: async () => ({ ok: true }),
    registrarEtapaImportacao: async () => ({ ok: true }),
    carregarEventoBruto: async () => ({ ok: true, evento: { id: "evento_1" } }),
    carregarLinksEvento: async () => ({ ok: true, links: [{ url_original: "https://shopee.test/original" }] }),
    gravarOfertaEngine: async () => {
      gravacoes += 1;
      return { ok: true, ofertaId: "oferta_1" };
    },
    marcarJobOfertaCriada: async () => ({ ok: true }),
    marcarJobRetidaV2: async () => ({ ok: true }),
    marcarJobErroImportacao: async (id, motivo, detalhes) => {
      finais.push({ id, motivo, detalhes });
      return { ok: true };
    },
    agendarRetryAfiliacaoShopee: async () => ({ ok: false, motivo: "nao_deve_usar_importado" })
  });
  mockModulo("../modules/engine/processor.service", {
    limitarJobs: valor => Number(valor || 10),
    marcarJobStatus: async () => ({ ok: true }),
    registrarProcessamento: async () => ({ ok: true })
  });
  mockModulo("../utils/usuarios-atividade", { usuarioAtivo: () => true, logUsuarioInativoIgnorado: () => {} });
  mockModulo("../modules/engine/importer/adapters/shopee.adapter", { importarShopeeEngine: async () => resultadoAdapter });
  for (const [relativo, nome] of [
    ["../modules/engine/importer/adapters/mercadolivre.adapter", "importarMercadoLivreEngine"],
    ["../modules/engine/importer/adapters/amazon.adapter", "importarAmazonEngine"],
    ["../modules/engine/importer/adapters/aliexpress.adapter", "importarAliExpressEngine"],
    ["../modules/engine/importer/adapters/awin.adapter", "importarAwinEngine"],
    ["../modules/engine/importer/adapters/magalu.adapter", "importarProdutoMagaluEngine"]
  ]) mockModulo(relativo, { [nome]: async () => ({ ok: false }) });
  delete require.cache[require.resolve("../modules/engine/importer/importer.runner")];
  const runner = require("../modules/engine/importer/importer.runner");
  const job = { id: "job_1", evento_id: "evento_1", cliente_id: "workspace_1", marketplace: "shopee", metadata: {} };

  const retry = await runner.importarJobPronto(job, {
    deps: {
      agendarRetryAfiliacaoShopee: async (jobRecebido, detalhes) => {
        agendados.push({ jobRecebido, detalhes });
        return { ok: true, tentativa: 1, proximaTentativaEm: "2026-09-17T12:00:30.000Z" };
      }
    }
  });
  assert.strictEqual(retry.reagendado, true);
  assert.strictEqual(agendados.length, 1);
  assert.strictEqual(finais.length, 0, "falha transitoria nao pode virar erro_importacao imediato");
  assert.strictEqual(gravacoes, 0, "retry nao cria oferta/fila/template/sender");

  resultadoAdapter = { ok: false, retriavel: false, motivo: "afiliacao_workspace_incompleta", motivoDetalhe: "afiliacao_workspace_divergente" };
  const divergente = await runner.importarJobPronto({ ...job, id: "job_2" }, { deps: { agendarRetryAfiliacaoShopee: async () => { throw new Error("nao_deve_agendar"); } } });
  assert.strictEqual(divergente.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(agendados.length, 1, "an de terceiro nao agenda retry");
  assert.strictEqual(finais.at(-1).motivo, "afiliacao_workspace_incompleta");

  resultadoAdapter = { ok: false, retriavel: true, motivo: "afiliacao_workspace_incompleta", motivoDetalhe: "afiliacao_workspace_nao_confirmada" };
  const esgotado = await runner.importarJobPronto({ ...job, id: "job_3", metadata: { afiliacaoWorkspaceRetry: { tentativas: 3 } } }, {
    deps: { agendarRetryAfiliacaoShopee: async () => ({ ok: false, esgotado: true, tentativa: 4 }) }
  });
  assert.strictEqual(esgotado.motivo, "afiliacao_workspace_nao_confirmada_apos_retries");
  assert.strictEqual(finais.at(-1).motivo, "afiliacao_workspace_nao_confirmada_apos_retries");

  resultadoAdapter = { ok: true, titulo: "Produto Shopee", preco: 10, linkAfiliado: "https://s.shopee.com.br/workspace" };
  const recuperado = await runner.importarJobPronto({ ...job, id: "job_4", metadata: { afiliacaoWorkspaceRetry: { tentativas: 1 } } });
  assert.strictEqual(recuperado.ok, true);
  assert.strictEqual(gravacoes, 1, "retry recuperado reutiliza o mesmo job e cria uma unica oferta");
}

(async () => {
  await testarPersistenciaRetry();
  await testarRunner();
  console.log("shopee-importer-retry.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
