"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-origem-fluxo-"));

const { writeGlobalJson } = require("../utils/storage");
writeGlobalJson("usuarios.json", [{ id: "workspace_fluxo", ativo: true, plano: "pro" }]);
writeGlobalJson("planos.json", {
  pro: {
    nome: "pro",
    ativo: true,
    marketplaces: ["mercadolivre"],
    recursos: { automacao: true }
  }
});

function limparModulo(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mockModulo(relativo, exports) {
  const resolvido = limparModulo(relativo);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

async function testarEventoEJob(origem, origemFluxo) {
  limparModulo("../modules/engine/inbox.service");
  let metadataPersistida = null;
  let metadataJobRecebida = null;

  mockModulo("../modules/engine/database", {
    queryEngine: async (sql, params = []) => {
      if (/INSERT INTO engine_eventos_brutos/i.test(sql)) {
        metadataPersistida = JSON.parse(params[10]);
        return { ok: true, resultado: { rows: [{ id: 7101 }] }, metricas: {} };
      }
      return { ok: true, resultado: { rows: [] }, metricas: {} };
    }
  });
  mockModulo("../modules/engine/jobs.service", {
    criarJobsParaClientes: async entrada => {
      metadataJobRecebida = entrada.metadataEvento;
      return { ok: true, criados: 1, existentes: 0 };
    }
  });

  const { registrarEventoBruto } = require("../modules/engine/inbox.service");
  const retorno = await registrarEventoBruto({
    origem,
    origemFluxo,
    origemTipo: "whatsapp",
    grupoId: "grupo_fluxo@g.us",
    textoOriginal: `Oferta ${origemFluxo} https://meli.la/fluxo`,
    linksExtraidos: ["https://meli.la/fluxo"],
    metadata: { marcadorPreservado: true }
  }, { clientes: ["workspace_fluxo"] });

  assert.strictEqual(retorno.ok, true);
  assert.strictEqual(metadataPersistida.origemFluxo, origemFluxo);
  assert.strictEqual(metadataPersistida.marcadorPreservado, true);
  assert.strictEqual(metadataJobRecebida.origemFluxo, origemFluxo);
}

async function testarMetadataJob() {
  limparModulo("../modules/engine/jobs.service");
  let metadataJobPersistida = null;
  mockModulo("../modules/engine/database", {
    getEnginePool: () => null,
    queryEngine: async (sql, params = []) => {
      if (/WITH jobs_admin/i.test(sql)) return { ok: true, resultado: { rows: [] } };
      if (/INSERT INTO engine_jobs_cliente/i.test(sql)) {
        metadataJobPersistida = JSON.parse(params[4]);
        return { ok: true, resultado: { rows: [{ id: 7201 }] } };
      }
      return { ok: true, resultado: { rows: [] } };
    }
  });
  mockModulo("../modules/imagens/cache-canonico-evento", {
    resolverImagemCanonicaEvento: async () => ({ imagemStatus: "nao_resolvida", imagemEnviavel: false }),
    aplicarImagemCanonicaMetadata: metadata => ({ ...metadata })
  });

  const { criarJobsParaClientes } = require("../modules/engine/jobs.service");
  const retorno = await criarJobsParaClientes({
    eventoId: 7101,
    clientes: ["workspace_fluxo"],
    marketplaceDetectado: "mercadolivre",
    linksExtraidos: ["https://meli.la/fluxo"],
    metadataEvento: {
      origemFluxo: "clonador_grupos",
      clonadorGrupos: { bufferId: "715", destinoIds: ["destino_clone"] }
    }
  });

  assert.strictEqual(retorno.criados, 1);
  assert.strictEqual(metadataJobPersistida.origemFluxo, "clonador_grupos");
  assert.strictEqual(metadataJobPersistida.metadataEvento.origemFluxo, "clonador_grupos");
  assert.strictEqual(metadataJobPersistida.metadataEvento.clonadorGrupos.bufferId, "715");
}

(async () => {
  const origemFluxo = require("../utils/origem-fluxo");
  assert.strictEqual(origemFluxo.resolverOrigemFluxoExplicita({ origemFluxo: "optimus" }), "optimus");
  assert.strictEqual(origemFluxo.resolverOrigemFluxoExplicita({ origemFluxo: "clonador_grupos" }), "clonador_grupos");
  assert.strictEqual(origemFluxo.resolverOrigemFluxo({ origem: "radar" }), "optimus");
  assert.strictEqual(origemFluxo.resolverOrigemFluxo({ origem: "clonador_grupos" }), "clonador_grupos");
  assert.strictEqual(origemFluxo.resolverOrigemFluxo({ origem: "engine_importer" }), "");
  assert.strictEqual(
    origemFluxo.resolverOrigemFluxo({ origemFluxo: "optimus", metadata: { clonadorGrupos: { bufferId: "antigo" } } }),
    "optimus",
    "origem explicita deve preceder fallback legado"
  );

  await testarEventoEJob("radar", "optimus");
  await testarEventoEJob("clonador_grupos", "clonador_grupos");
  await testarMetadataJob();

  limparModulo("../modules/engine/importer/importer.service");
  const importer = require("../modules/engine/importer/importer.service");
  const ofertaNormalizada = importer.normalizarOfertaImportada(
    { ok: true, titulo: "Produto", marketplace: "mercadolivre", preco: 100, metadata: {} },
    { metadata: { origemFluxo: "clonador_grupos" } }
  );
  assert.strictEqual(ofertaNormalizada.origemFluxo, "clonador_grupos");
  assert.strictEqual(ofertaNormalizada.ok, true);

  const { montarOfertaUniversalEngine } = require("../modules/engine/oferta-universal.contract");
  const universal = montarOfertaUniversalEngine({
    oferta: {
      origem: "engine_importer",
      origemFluxo: "clonador_grupos",
      marketplace: "mercadolivre",
      titulo: "Produto",
      preco: 100,
      linkAfiliado: "https://meli.la/afiliado"
    },
    job: { id: 7201, evento_id: 7101, cliente_id: "workspace_fluxo" },
    evento: { origem: "clonador_grupos", capturado_em: new Date().toISOString() },
    metadata: { origemFluxo: "clonador_grupos" }
  });
  assert.strictEqual(universal.origem, "engine_importer", "origem tecnica deve permanecer intacta");
  assert.strictEqual(universal.origemFluxo, "clonador_grupos");

  limparModulo("../modules/engine/distributor/distributor.service");
  const distributor = require("../modules/engine/distributor/distributor.service");
  const itemFila = distributor.montarItemFilaEngine({
    id: 7301,
    uuid: "oferta-7301",
    job_id: 7201,
    cliente_id: "workspace_fluxo",
    origem: "clonador_grupos",
    marketplace: "mercadolivre",
    titulo: "Produto",
    preco: 100,
    link_original: "https://meli.la/original",
    link_afiliado: "https://meli.la/afiliado",
    metadata: {
      origemFluxo: "clonador_grupos",
      clonadorGrupos: { bufferId: "715", destinoIds: ["destino_clone"] }
    }
  });
  assert.strictEqual(itemFila.origem, "engine", "origem tecnica da fila deve permanecer intacta");
  assert.strictEqual(itemFila.origemFluxo, "clonador_grupos");
  assert.strictEqual(itemFila.metadata.clonadorGrupos.bufferId, "715");

  const itemLegado = distributor.montarItemFilaEngine({
    id: 7302,
    cliente_id: "workspace_fluxo",
    origem: "radar",
    marketplace: "mercadolivre",
    titulo: "Produto legado",
    preco: 90,
    link_afiliado: "https://meli.la/legado",
    metadata: {}
  });
  assert.strictEqual(itemLegado.origemFluxo, "optimus", "item antigo usa fallback sem alterar origem tecnica");

  const itemLegadoClonador = distributor.montarItemFilaEngine({
    id: 7303,
    cliente_id: "workspace_fluxo",
    origem: "engine_importer",
    marketplace: "mercadolivre",
    titulo: "Produto legado Clonador",
    preco: 80,
    link_afiliado: "https://meli.la/legado-clone",
    metadata: { clonadorGrupos: { bufferId: "antigo_715", destinoIds: ["destino_clone"] } }
  });
  assert.strictEqual(itemLegadoClonador.origemFluxo, "clonador_grupos");
  assert.strictEqual(itemLegadoClonador.origem, "engine");

  const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert(/registrarEventoBrutoEngineRadar\(\{[\s\S]*?origem:\s*"radar",[\s\S]*?origemFluxo:\s*"optimus"/.test(indexFonte));

  console.log("OK: origemFluxo preservada de forma explicita ate o item de fila");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
