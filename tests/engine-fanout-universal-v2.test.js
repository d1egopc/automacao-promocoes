const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-engine-fanout-v2-"));

const { writeGlobalJson } = require("../utils/storage");

const CLIENTES_BASE = [
  { id: "d1egopc_teste", nome: "D1EGOPCOFICIAL", ativo: true },
  { id: "roger_teste", nome: "ROGEROFICIAL", ativo: true },
  { id: "wolf_teste", nome: "WOLFOFICIAL", ativo: true }
];

writeGlobalJson("usuarios.json", [
  { id: "admin", nome: "Admin", ativo: true, papel: "admin_master" },
  ...CLIENTES_BASE,
  { id: "quarto_workspace_teste", nome: "QUARTO TESTE", ativo: true }
]);

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

async function executarFanoutJobs({ marketplace, links, clientes, existentes = [] }) {
  limparModulo("../modules/engine/jobs.service");
  const existentesSet = new Set(existentes);
  const clientesInseridos = [];

  mockModulo("../modules/engine/database", {
    queryEngine: async (sql, params = []) => {
      if (/WITH jobs_admin/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ jobs_ignorados: 0, ofertas_retidas: 0 }] } };
      }

      if (/INSERT INTO engine_jobs_cliente/i.test(sql)) {
        const clienteId = params[2];
        clientesInseridos.push(clienteId);
        return {
          ok: true,
          resultado: {
            rows: existentesSet.has(clienteId) ? [] : [{ id: 1000 + clientesInseridos.length }]
          }
        };
      }

      return { ok: true, resultado: { rows: [] } };
    }
  });

  const jobs = require("../modules/engine/jobs.service");
  const retorno = await jobs.criarJobsParaClientes({
    eventoId: 900,
    clientes,
    marketplaceDetectado: marketplace,
    linksExtraidos: links,
    metadataEvento: { coberturaTraceId: `cov_${marketplace}` }
  });

  return { retorno, clientesInseridos };
}

(async () => {
  {
    const clientesDinamicos = CLIENTES_BASE.map(cliente => cliente.id);
    const { retorno, clientesInseridos } = await executarFanoutJobs({
      marketplace: "mercadolivre",
      links: ["https://meli.la/2HRuzPf"],
      clientes: ["admin", ...clientesDinamicos]
    });

    assert.strictEqual(retorno.criados, 3);
    assert.deepStrictEqual(clientesInseridos, clientesDinamicos);
  }

  {
    const clientesDinamicos = CLIENTES_BASE.map(cliente => cliente.id);
    clientesDinamicos.push("quarto_workspace_teste");
    const { retorno, clientesInseridos } = await executarFanoutJobs({
      marketplace: "shopee",
      links: ["https://s.shopee.com.br/903wBcqhYS"],
      clientes: clientesDinamicos
    });

    assert.strictEqual(retorno.criados, 4);
    assert.deepStrictEqual(clientesInseridos, clientesDinamicos);
    assert(clientesInseridos.includes("quarto_workspace_teste"));
  }

  {
    const clientesDinamicos = CLIENTES_BASE.map(cliente => cliente.id);
    const { retorno, clientesInseridos } = await executarFanoutJobs({
      marketplace: "amazon",
      links: ["https://amzn.to/produto"],
      clientes: clientesDinamicos,
      existentes: ["roger_teste"]
    });

    assert.strictEqual(retorno.criados, 2);
    assert.strictEqual(retorno.existentes, 1);
    assert.deepStrictEqual(clientesInseridos, clientesDinamicos);
  }

  {
    limparModulo("../modules/engine/inbox.service");
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql) => {
        if (/SELECT id\s+FROM engine_eventos_brutos/i.test(sql)) {
          return { ok: true, resultado: { rows: [{ id: 901 }] }, metricas: {} };
        }
        throw new Error(`query_nao_esperada: ${sql}`);
      }
    });
    let clientesRecebidos = [];
    mockModulo("../modules/engine/jobs.service", {
      criarJobsParaClientes: async (entrada) => {
        clientesRecebidos = entrada.clientes;
        return { ok: true, criados: 1, existentes: 2 };
      }
    });

    const inbox = require("../modules/engine/inbox.service");
    const retorno = await inbox.registrarEventoBruto({
      origem: "radar",
      origemTipo: "whatsapp",
      grupoId: "grupo@g.us",
      textoOriginal: "Oferta duplicada https://meli.la/abc",
      linksExtraidos: ["https://meli.la/abc"]
    }, {
      clientes: CLIENTES_BASE.map(cliente => cliente.id)
    });

    assert.strictEqual(retorno.duplicado, true);
    assert.strictEqual(retorno.id, 901);
    assert.strictEqual(retorno.jobsCriados, 1);
    assert.strictEqual(retorno.jobsExistentes, 2);
    assert.deepStrictEqual(clientesRecebidos, CLIENTES_BASE.map(cliente => cliente.id));
  }

  {
    mockModulo("../modules/engine/processor.service", {
      marcarJobStatus: async () => ({ ok: true }),
      registrarProcessamento: async () => ({ ok: true }),
      limitarJobs: valor => Number(valor || 20)
    });
    limparModulo("../modules/engine/validator.service");
    const validator = require("../modules/engine/validator.service");
    const contextoAmazon = {
      clientesValidos: CLIENTES_BASE.map(cliente => cliente.id),
      marketplacesAtivosPorCliente: {},
      integracoesPorCliente: {
        d1egopc_teste: { amazon: { credenciais: { tag: "d1-tag" } } },
        roger_teste: { mercadolivre: { credenciais: { tag: "roger-ml" } } },
        wolf_teste: { amazon: { credenciais: { tag: "wolf-tag" } } }
      }
    };

    const d1 = await validator.validarJobDiagnosticadoEngine({ id: 1, cliente_id: "d1egopc_teste", marketplace: "amazon" }, contextoAmazon);
    const roger = await validator.validarJobDiagnosticadoEngine({ id: 2, cliente_id: "roger_teste", marketplace: "amazon" }, contextoAmazon);
    const wolf = await validator.validarJobDiagnosticadoEngine({ id: 3, cliente_id: "wolf_teste", marketplace: "amazon" }, contextoAmazon);

    assert.strictEqual(d1.status, "pronto_para_importar");
    assert.strictEqual(roger.status, "integracao_ausente");
    assert.strictEqual(wolf.status, "pronto_para_importar");
  }

  {
    limparModulo("../modules/engine/distributor/distributor.service");
    const distributor = require("../modules/engine/distributor/distributor.service");

    for (const marketplace of ["mercadolivre", "shopee"]) {
      for (const clienteId of ["d1egopc_teste", "wolf_teste"]) {
        const retorno = await distributor.validarOfertaParaDistribuicao({
          id: `${marketplace}_${clienteId}`,
          cliente_id: clienteId,
          marketplace,
          titulo: "Oferta valida com automacao desligada",
          categoria: "geral"
        }, {
          clientesValidos: CLIENTES_BASE.map(cliente => cliente.id),
          configsPorCliente: { [clienteId]: { automacaoAtiva: false } },
          marketplacesAtivosPorCliente: { [clienteId]: { [marketplace]: true } },
          destinosPorCliente: {
            [clienteId]: [{
              id: `destino_${clienteId}`,
              nome: "OP Geral",
              ativo: true,
              marketplace,
              marketplaces: [marketplace],
              categorias: ["geral"]
            }]
          }
        });

        assert.strictEqual(retorno.ok, true, `${clienteId} deve ir para fila com automacao desligada em ${marketplace}`);
      }
    }
  }

  {
    limparModulo("../modules/engine/distributor/distributor.service");
    const distributor = require("../modules/engine/distributor/distributor.service");
    const itensFila = new Set();
    const ofertaEngine = {
      id: 501,
      job_id: 1001,
      cliente_id: "d1egopc_teste",
      marketplace: "mercadolivre",
      titulo: "Oferta criada pela Engine",
      preco: 55,
      categoria: "geral",
      link_original: "https://produto.mercadolivre.com.br/MLB-501",
      link_afiliado: "https://meli.la/afiliado501",
      metadata: { coberturaTraceId: "cov_distributor_fila" }
    };
    const deps = {
      adicionarOfertaNaFilaGlobal: (_clienteId, itemFila) => {
        const chave = `${itemFila.clienteId}:${itemFila.engineOfertaId}`;
        if (itensFila.has(chave)) return { ok: false, duplicada: true, motivo: "duplicidade_fila", itemFila };
        itensFila.add(chave);
        return { ok: true, itemFila: { ...itemFila, id: "fila_501", status: "pendente" } };
      }
    };

    const primeira = await distributor.adicionarOfertaNaFilaCliente(ofertaEngine, { deps });
    const repetida = await distributor.adicionarOfertaNaFilaCliente(ofertaEngine, { deps });

    assert.strictEqual(primeira.ok, true);
    assert.strictEqual(primeira.itemFila.id, "fila_501");
    assert.strictEqual(repetida.ok, false);
    assert.strictEqual(repetida.motivo, "duplicidade_fila");
    assert.strictEqual(itensFila.size, 1);
  }

  console.log("engine-fanout-universal-v2.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
