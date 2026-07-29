const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-workspace-registry-"));

const { writeGlobalJson, writeClienteJson } = require("../utils/storage");

writeGlobalJson("usuarios.json", [
  { id: "admin", nome: "Admin", papel: "admin_master", ativo: true, plano: "master" },
  { id: "cliente_ativo", nome: "Cliente Ativo", ativo: true, plano: "pro", creditos: 10 },
  { id: "cliente_inativo", nome: "Cliente Inativo", ativo: false, plano: "pro", creditos: 10 },
  { id: "cliente_sem_plano", nome: "Sem Plano", ativo: true, creditos: 10 },
  { id: "cliente_sem_permissao", nome: "Sem Permissao", ativo: true, plano: "manual", creditos: 10 }
]);

writeGlobalJson("planos.json", {
  pro: {
    nome: "pro",
    ativo: true,
    marketplaces: ["mercadolivre", "shopee", "amazon"],
    recursos: { automacao: true, whatsapp: true }
  },
  manual: {
    nome: "manual",
    ativo: true,
    marketplaces: ["amazon"],
    recursos: { automacao: false }
  }
});

writeGlobalJson("integracoes.json", {
  cliente_ativo: { amazon: { ativo: true, credenciais: { tag: "nao_logar" } } }
});
writeGlobalJson("configs_clientes.json", {
  cliente_ativo: { automacaoAtiva: false }
});
writeClienteJson("cliente_ativo", "destinos.json", [{
  id: "destino_1",
  ativo: true,
  marketplaces: ["amazon"]
}]);

function limparModulo(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mockModulo(relativo, exports) {
  const resolvido = limparModulo(relativo);
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports
  };
}

(async () => {
  const registry = require("../modules/workspace");

  const admin = registry.obterWorkspace("admin", { log: false });
  assert.strictEqual(admin.existente, true);
  assert.strictEqual(admin.tipo, "admin");
  assert.strictEqual(admin.comercial, false);
  assert.strictEqual(registry.avaliarWorkspaceParaEngine("admin", { log: false }).motivo, "workspace_admin");

  const ativo = registry.obterWorkspace("cliente_ativo", { log: false });
  assert.strictEqual(ativo.existente, true);
  assert.strictEqual(ativo.tipo, "cliente");
  assert.strictEqual(ativo.comercial, true);
  assert.strictEqual(ativo.ativo, true);
  assert.deepStrictEqual(ativo.marketplacesPermitidos, ["mercadolivre", "shopee", "amazon"]);
  assert.strictEqual(ativo.operacional.automacaoAtiva, false, "automacao desligada nao exclui workspace do Registry");
  assert.strictEqual(registry.avaliarWorkspaceParaEngine("cliente_ativo", { log: false }).motivo, "elegivel");

  const inativo = registry.obterWorkspace("cliente_inativo", { log: false });
  assert.strictEqual(inativo.existente, true);
  assert.strictEqual(inativo.ativo, false);
  assert.strictEqual(registry.avaliarWorkspaceParaEngine("cliente_inativo", { log: false }).motivo, "workspace_inativo");

  const semPlano = registry.obterWorkspace("cliente_sem_plano", { log: false });
  assert.strictEqual(semPlano.existente, true);
  assert.strictEqual(semPlano.comercial, true);
  assert.strictEqual(registry.avaliarWorkspaceParaEngine("cliente_sem_plano", { log: false }).motivo, "workspace_sem_plano");

  const semPermissao = registry.avaliarWorkspaceParaEngine("cliente_sem_permissao", { log: false });
  assert.strictEqual(semPermissao.elegivelEngine, false);
  assert(semPermissao.motivos.includes("plano_sem_permissao"));

  const inexistente = registry.obterWorkspace("cliente_inexistente", { log: false });
  assert.strictEqual(inexistente.existente, false);
  assert.strictEqual(registry.avaliarWorkspaceParaEngine("cliente_inexistente", { log: false }).motivo, "workspace_inexistente");

  writeGlobalJson("usuarios.json", [
    { id: "admin", nome: "Admin", papel: "admin_master", ativo: true, plano: "master" },
    { id: "cliente_ativo", nome: "Cliente Ativo", ativo: true, plano: "pro", creditos: 10 },
    { id: "cliente_inativo", nome: "Cliente Inativo", ativo: false, plano: "pro", creditos: 10 },
    { id: "cliente_sem_plano", nome: "Sem Plano", ativo: true, creditos: 10 },
    { id: "cliente_sem_permissao", nome: "Sem Permissao", ativo: true, plano: "manual", creditos: 10 },
    { id: "cliente_novo", nome: "Cliente Novo", ativo: true, plano: "pro", creditos: 10 }
  ]);

  const elegiveis = registry.listarWorkspaceIdsElegiveisEngine({ log: false });
  assert(elegiveis.includes("cliente_ativo"));
  assert(elegiveis.includes("cliente_novo"), "cliente novo entra automaticamente sem lista fixa");
  assert(!elegiveis.includes("admin"), "admin nao entra no fan-out");
  assert(!elegiveis.includes("cliente_inativo"));
  assert(!elegiveis.includes("cliente_sem_plano"));
  assert(!elegiveis.includes("cliente_sem_permissao"));

  limparModulo("../modules/engine/jobs.service");
  const inseridos = [];
  mockModulo("../modules/engine/database", {
    queryEngine: async (sql, params = []) => {
      if (/WITH jobs_admin/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ jobs_ignorados: 0, ofertas_retidas: 0 }] } };
      }
      if (/INSERT INTO engine_jobs_cliente/i.test(sql)) {
        inseridos.push(params[2]);
        return {
          ok: true,
          resultado: {
            rows: params[2] === "cliente_ativo" ? [] : [{ id: 900 + inseridos.length }]
          }
        };
      }
      return { ok: true, resultado: { rows: [] } };
    }
  });

  const jobs = require("../modules/engine/jobs.service");
  const retorno = await jobs.criarJobsParaClientes({
    eventoId: 321,
    clientes: ["admin", "cliente_ativo", "cliente_novo", "cliente_inativo", "cliente_sem_plano", "cliente_inexistente"],
    marketplaceDetectado: "amazon",
    linksExtraidos: ["https://amzn.to/produto"],
    metadataEvento: { coberturaTraceId: "cov_workspace_registry" }
  });

  assert.strictEqual(retorno.criados, 1);
  assert.strictEqual(retorno.existentes, 1);
  assert.deepStrictEqual(inseridos, ["cliente_ativo", "cliente_novo"]);

  const fonteJobs = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "jobs.service.js"), "utf8");
  assert(!/user_[a-z0-9]+/i.test(fonteJobs), "jobs.service nao deve conter ID fixo user_*");

  console.log("workspace-registry-engine-v2.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
