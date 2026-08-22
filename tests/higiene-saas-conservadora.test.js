const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-higiene-saas-"));
process.env.DATA_DIR = dataDir;

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function escreverJson(rel, dados) {
  const file = path.join(dataDir, rel);
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(dados, null, 2));
}

escreverJson("usuarios.json", [
  { id: "cliente_ativo", ativo: true, plano: "free" },
  { id: "cliente_inativo", ativo: false, plano: "free" },
  { id: "cliente_sem_plano", ativo: true }
]);
escreverJson("planos.json", {
  free: { nome: "Free", ativo: true, recursos: { engine: true } }
});
escreverJson("clientes/cliente_ativo/fila.json", []);
escreverJson("clientes/cliente_inativo/fila.json", []);
escreverJson("clientes/cliente_orfao/fila.json", [{ id: "orfao_vivo", status: "pendente", criadoEm: new Date().toISOString() }]);

const registry = require("../modules/workspace/workspace-registry");
const orfaosRegistry = registry.listarOrphanWorkspaces({ log: false });
assert.deepStrictEqual(orfaosRegistry.map(item => item.workspaceId), ["cliente_orfao"]);
assert.strictEqual(orfaosRegistry[0].classificacao, "orphan_workspace");
assert.strictEqual(registry.avaliarWorkspaceParaEngine("cliente_orfao", { log: false }).motivo, "workspace_inexistente");
assert.strictEqual(registry.avaliarWorkspaceParaEngine("cliente_inativo", { log: false }).motivo, "workspace_inativo");
assert.ok(registry.listarWorkspaceIdsElegiveisEngine({ log: false }).includes("cliente_ativo"));
assert.ok(!registry.listarWorkspaceIdsElegiveisEngine({ log: false }).includes("cliente_orfao"));

const autoClean = require("../modules/engine/auto-clean/auto-clean.service");
const orfaosAutoClean = autoClean.auditarOrphanWorkspaces({ dataDir });
assert.strictEqual(orfaosAutoClean.orphanWorkspaces, 1);
assert.deepStrictEqual(orfaosAutoClean.workspaces, ["cliente_orfao"]);
assert.strictEqual(orfaosAutoClean.aplicouMudancas, false);
assert.strictEqual(fs.existsSync(path.join(dataDir, "clientes", "cliente_orfao")), true, "orphan_workspace deve ser reportado, nao apagado");

const filas = autoClean.auditarFilaJson({ dataDir });
assert.strictEqual(filas.orphanWorkspaces, 1);
assert.ok(filas.politicaCentral === "fila_historico_policy_v1");

const storageRepository = require("../modules/storage-manager/storage.repository");

const processorServicePath = require.resolve("../modules/engine/processor.service");
delete require.cache[processorServicePath];
let carregarEventoChamadas = 0;
let carregarLinksChamadas = 0;
const etapas = [];
require.cache[processorServicePath] = {
  id: processorServicePath,
  filename: processorServicePath,
  loaded: true,
  exports: {
    carregarEventoBruto: async () => {
      carregarEventoChamadas += 1;
      return { ok: true, evento: { id: "evento_1", marketplace_detectado: "amazon" } };
    },
    carregarLinksEvento: async () => {
      carregarLinksChamadas += 1;
      return { ok: true, links: [{ url_original: "https://amazon.com.br/produto" }] };
    },
    marcarJobStatus: async (jobId, status, motivo, detalhes) => {
      etapas.push({ jobId, status, motivo, detalhes });
      return { ok: true };
    },
    registrarProcessamento: async (jobId, etapa, status, motivo, detalhes) => {
      etapas.push({ jobId, etapa, status, motivo, detalhes });
      return { ok: true };
    }
  }
};

const processorStepsPath = require.resolve("../modules/engine/processor.steps");
delete require.cache[processorStepsPath];
const processor = require("../modules/engine/processor.steps");

(async () => {
  const contexto = {
    clientesValidos: ["cliente_ativo"],
    avaliarWorkspaceParaEngine: (workspaceId) => registry.avaliarWorkspaceParaEngine(workspaceId, { log: false })
  };

  let resultado = await processor.processarJobEngine({
    id: "job_inativo",
    evento_id: "evento_inativo",
    cliente_id: "cliente_inativo"
  }, contexto);
  assert.strictEqual(resultado.motivo, "workspace_inativo");
  assert.strictEqual(carregarEventoChamadas, 0, "inativo deve sair antes de carregar evento bruto");
  assert.strictEqual(carregarLinksChamadas, 0, "inativo deve sair antes de carregar links");

  resultado = await processor.processarJobEngine({
    id: "job_orfao",
    evento_id: "evento_orfao",
    cliente_id: "cliente_orfao"
  }, contexto);
  assert.strictEqual(resultado.motivo, "workspace_inexistente");
  assert.strictEqual(carregarEventoChamadas, 0, "excluido/orfao deve sair antes de carregar evento bruto");

  resultado = await processor.processarJobEngine({
    id: "job_ativo",
    evento_id: "evento_ativo",
    cliente_id: "cliente_ativo"
  }, contexto);
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.status, "diagnosticado");
  assert.strictEqual(carregarEventoChamadas, 1, "workspace elegivel continua processando evento global");
  assert.strictEqual(carregarLinksChamadas, 1, "workspace elegivel continua usando links do evento");

  const storage = await storageRepository.auditarWorkspaces({ dataDir, limit: 10 });
  const orfaoStorage = storage.workspaces.find(item => item.workspaceId === "cliente_orfao");
  assert.strictEqual(orfaoStorage.classificacao, "orphan_workspace");
  assert.strictEqual(orfaoStorage.operacional, false);

  const shadow = await autoClean.executarAutoCleanShadow({
    dataDir,
    incluirPostgres: false,
    logger: { log() {} }
  });
  assert.strictEqual(shadow.aplicouMudancas, false);
  assert.ok(shadow.origens.some(item => item.origem === "orphan_workspace" && item.orphanWorkspaces === 1));
  assert.strictEqual(fs.existsSync(path.join(dataDir, "clientes", "cliente_orfao", "fila.json")), true, "Auto Clean shadow nao apaga fila orfa");

  console.log("higiene-saas-conservadora.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
