"use strict";

const assert = require("assert");

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

const D1 = "user_40qdblgt";
const ROGER = "user_9hqs434h";

function oferta(id, clienteId, extra = {}) {
  return {
    id,
    evento_id: 1000 + id,
    job_id: 2000 + id,
    cliente_id: clienteId,
    marketplace: extra.marketplace || "mercadolivre",
    titulo: extra.titulo || `Oferta ${id}`,
    categoria: extra.categoria || "Gamer e Hardware",
    status: "importada",
    metadata: {},
    ...extra
  };
}

function destino(extra = {}) {
  return {
    id: extra.id || "destino_1",
    nome: extra.nome || "OP GERAL",
    ativo: extra.ativo !== false,
    tipo: extra.tipo || "whatsapp",
    marketplaces: extra.marketplaces || ["mercadolivre", "shopee", "aliexpress", "awin"],
    categorias: extra.categorias || ["Gamer e Hardware"],
    ...extra
  };
}

function prepararRunner(candidatos, decidirGate) {
  limparModulo("../modules/engine/distributor/distributor.runner");
  const adicionados = [];
  const buscas = [];

  mockModulo("../modules/engine/distributor/distributor.service", {
    limitarDistribuicao: valor => Number(valor || 10),
    buscarOfertasDistribuiveis: async ({ limite = 10, excluirOfertaIds = [] } = {}) => {
      buscas.push({ limite, excluirOfertaIds: [...excluirOfertaIds] });
      const excluidos = new Set((excluirOfertaIds || []).map(String));
      return { ok: true, ofertas: candidatos.filter(item => !excluidos.has(String(item.id))).slice(0, limite) };
    },
    tentarMarcarDistribuindo: async () => ({ ok: true }),
    marcarOfertaStatus: async () => ({ ok: true }),
    restaurarOfertaStatusSeDistribuindo: async () => ({ ok: true }),
    registrarEtapaDistribuicao: async () => ({ ok: true }),
    validarOfertaParaDistribuicao: async () => ({
      ok: true,
      destinosCompativeis: 1,
      destinosCompativeisDetalhes: [{ destino: "OP GERAL", tipoMidia: "imagem" }]
    }),
    adicionarOfertaNaFilaCliente: async ofertaEntrada => {
      adicionados.push(ofertaEntrada.cliente_id);
      return { ok: true, itemFila: { id: `fila_${ofertaEntrada.id}`, status: "pendente" } };
    }
  });

  mockModulo("../modules/engine/ofc/commercial-events.service", {
    registrarDistribuicaoFinal: async () => ({ ok: true }),
    registrarFilaClienteAdicionada: async () => ({ ok: true })
  });

  const runner = require("../modules/engine/distributor/distributor.runner");
  return { runner, adicionados, buscas, decidirGate };
}

async function testarRogerBloqueadoNaoConsomeD1() {
  const { runner, adicionados, buscas } = prepararRunner([
    oferta(1, ROGER, { prioridade: 100 }),
    oferta(2, ROGER, { prioridade: 99 }),
    oferta(3, D1, { prioridade: 98 })
  ]);

  const resultado = await runner.distribuirOfertasEngine({
    limite: 1,
    deps: {
      maxCandidatosDistributor: 5,
      decidirAbsorcaoWorkspace: async ({ workspaceId }) => {
        if (workspaceId === ROGER) {
          return {
            ativo: true,
            permitir: false,
            motivo: "sessao_ou_integracao_inapta",
            estadoDaEsteira: "FECHADA",
            quantidadeAceitaAgora: 0,
            pressaoEsteiraViva: 3,
            filaAlvo: 0,
            capacidadeAtual: 0
          };
        }
        return { ativo: false, permitir: true, quantidadeAceitaAgora: 1, motivo: "gate_desabilitado" };
      }
    }
  });

  assert.strictEqual(resultado.adicionadasFila, 1);
  assert.deepStrictEqual(adicionados, [D1]);
  assert.strictEqual(resultado.distributorVivo.candidatosGateBloqueados, 2);
  assert.strictEqual(resultado.distributorVivo.distribuicoesUteis, 1);
  assert.strictEqual(resultado.distributorVivo.motivoEncerramento, "capacidade_util_atendida");
  assert(buscas.length >= 3, "deve continuar buscando apos Gate bloqueado");
}

async function testarTodosBloqueadosSemLoopInfinito() {
  const { runner, adicionados } = prepararRunner([
    oferta(10, ROGER),
    oferta(11, ROGER)
  ]);

  const resultado = await runner.distribuirOfertasEngine({
    limite: 1,
    deps: {
      maxCandidatosDistributor: 4,
      decidirAbsorcaoWorkspace: async () => ({
        ativo: true,
        permitir: false,
        motivo: "sessao_ou_integracao_inapta",
        estadoDaEsteira: "FECHADA",
        quantidadeAceitaAgora: 0
      })
    }
  });

  assert.strictEqual(resultado.adicionadasFila, 0);
  assert.deepStrictEqual(adicionados, []);
  assert.strictEqual(resultado.distributorVivo.candidatosGateBloqueados, 2);
  assert.strictEqual(resultado.distributorVivo.motivoEncerramento, "candidatos_esgotados");
}

async function testarWorkspaceSaturadoNaoRecebe() {
  const { runner, adicionados } = prepararRunner([
    oferta(20, D1)
  ]);

  const resultado = await runner.distribuirOfertasEngine({
    limite: 1,
    deps: {
      decidirAbsorcaoWorkspace: async () => ({
        ativo: true,
        permitir: false,
        motivo: "esteira_saturada",
        estadoDaEsteira: "SATURADA",
        quantidadeAceitaAgora: 0
      })
    }
  });

  assert.strictEqual(resultado.adicionadasFila, 0);
  assert.deepStrictEqual(adicionados, []);
  assert.strictEqual(resultado.distributorVivo.candidatosGateBloqueados, 1);
}

async function testarBacklogBloqueadoNaoCausaStarvationGlobal() {
  const candidatos = [];
  for (let i = 1; i <= 24; i += 1) {
    candidatos.push(oferta(i, ROGER, { marketplace: "mercadolivre", prioridade: 100 - i }));
  }
  candidatos.push(oferta(101, D1, { marketplace: "shopee", prioridade: 80 }));
  candidatos.push(oferta(102, "workspace_4", { marketplace: "amazon", prioridade: 79 }));

  const { runner, adicionados } = prepararRunner(candidatos);

  const resultado = await runner.distribuirOfertasEngine({
    limite: 2,
    deps: {
      decidirAbsorcaoWorkspace: async ({ workspaceId }) => {
        if (workspaceId === ROGER) {
          return {
            ativo: true,
            permitir: false,
            motivo: "sessao_ou_integracao_inapta",
            estadoDaEsteira: "FECHADA",
            quantidadeAceitaAgora: 0
          };
        }
        return { ativo: false, permitir: true, quantidadeAceitaAgora: 1, motivo: "gate_desabilitado" };
      }
    }
  });

  assert.strictEqual(resultado.adicionadasFila, 2);
  assert.deepStrictEqual(adicionados.sort(), [D1, "workspace_4"].sort());
  assert(resultado.distributorVivo.candidatosGateBloqueados >= 1, "deve registrar candidatos bloqueados");
  assert.strictEqual(resultado.distributorVivo.motivoEncerramento, "capacidade_util_atendida");
  assert(resultado.distributorVivo.limiteOperacionalCandidatos >= 100, "deve haver limite operacional seguro maior que a capacidade util");
}

async function testarValidacoesDeDestino() {
  mockModulo("../utils/usuarios-atividade", {
    usuarioAtivo: () => true,
    logUsuarioInativoIgnorado: () => false
  });
  limparModulo("../modules/engine/distributor/distributor.service");
  const service = require("../modules/engine/distributor/distributor.service");

  const contexto = {
    clientesValidos: [D1],
    marketplacesAtivosPorCliente: { [D1]: { aliexpress: true, awin: true } },
    destinosPorCliente: {
      [D1]: [destino({ marketplaces: ["aliexpress", "awin"], categorias: ["Gamer e Hardware"] })]
    }
  };

  const aliLiteral = await service.validarOfertaParaDistribuicao({
    cliente_id: D1,
    marketplace: "aliexpress",
    categoria: "AliExpress",
    titulo: "Teclado Mecanico Ajazz X Nacodex NK61 Switch Red"
  }, contexto);
  assert.strictEqual(aliLiteral.ok, true, "AliExpress literal deve reclassificar pelo titulo");

  const aliProibida = await service.validarOfertaParaDistribuicao({
    cliente_id: D1,
    marketplace: "aliexpress",
    categoria: "AliExpress",
    titulo: "Vestido feminino verao floral"
  }, contexto);
  assert.strictEqual(aliProibida.ok, false, "categoria realmente fora do destino continua bloqueada");
  assert.strictEqual(aliProibida.motivo, "categoria_bloqueada");

  const kabumSeguro = await service.validarOfertaParaDistribuicao({
    cliente_id: D1,
    marketplace: "kabum",
    categoria: "KaBuM",
    titulo: "Headset Gamer Sem Fio HyperX Cloud III"
  }, contexto);
  assert.strictEqual(kabumSeguro.ok, true, "KaBuM deve equivaler ao canal AWIN autorizado");

  const awinDesconhecido = await service.validarOfertaParaDistribuicao({
    cliente_id: D1,
    marketplace: "awin",
    categoria: "AWIN",
    titulo: "Produto de anunciante externo"
  }, {
    ...contexto,
    destinosPorCliente: { [D1]: [destino({ marketplaces: ["amazon"], categorias: ["Gamer e Hardware"] })] }
  });
  assert.strictEqual(awinDesconhecido.ok, false, "AWIN fora do canal permitido continua bloqueado");
  assert.strictEqual(awinDesconhecido.motivo, "marketplace_bloqueado");

  const fila = [{ clienteId: D1, titulo: "Placa MSI", preco: 611, linkOriginal: "https://s.shopee.com.br/produto-a" }];
  assert.strictEqual(service.ofertaJaExisteNaFila(fila, {
    cliente_id: D1,
    titulo: "Placa MSI",
    preco: 611,
    link_original: "https://s.shopee.com.br/produto-a"
  }), true, "Shopee duplicada identica continua bloqueada");
  assert.strictEqual(service.ofertaJaExisteNaFila(fila, {
    cliente_id: D1,
    titulo: "Placa MSI",
    preco: 599,
    link_original: "https://s.shopee.com.br/produto-b"
  }), false, "Shopee com melhoria real e identidade distinta segue elegivel para a memoria oficial");
}

async function testarQueryExcluiIdsComPlaceholders() {
  const consultas = [];
  mockModulo("../modules/engine/database", {
    engineDbHabilitado: () => true,
    getEnginePool: () => ({
      query: async (sql, params = []) => {
        consultas.push({ sql, params });
        if (String(sql).includes("information_schema.columns")) {
          return { rows: [{ existe: true }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    })
  });

  limparModulo("../modules/engine/distributor/distributor.service");
  const service = require("../modules/engine/distributor/distributor.service");

  const resultado = await service.buscarOfertasDistribuiveis({
    limite: 7,
    marketplace: "AliExpress",
    clienteId: D1,
    excluirOfertaIds: [1, 2, 2, "x"]
  });

  assert.strictEqual(resultado.ok, true);
  const consultaPrincipal = consultas.find(item => String(item.sql).includes("FROM engine_ofertas"));
  assert(consultaPrincipal, "deve executar a consulta principal de ofertas");
  assert(consultaPrincipal.sql.includes("LOWER(COALESCE(o.marketplace, '')) = $1"));
  assert(consultaPrincipal.sql.includes("j.cliente_id = $2"));
  assert(consultaPrincipal.sql.includes("NOT (o.id = ANY($3::bigint[]))"));
  assert(consultaPrincipal.sql.includes("LIMIT $4"));
  assert(consultaPrincipal.sql.includes("ordem_workspace_marketplace"));
  assert(consultaPrincipal.sql.includes("ordem_marketplace"));
  assert(/PARTITION BY LOWER\(COALESCE\(o\.marketplace, ''\)\), j\.cliente_id/i.test(consultaPrincipal.sql));
  assert(/ORDER BY ordem_workspace_marketplace ASC/i.test(consultaPrincipal.sql));
  assert.deepStrictEqual(consultaPrincipal.params, ["aliexpress", D1, [1, 2], 7]);
}
(async () => {
  await testarRogerBloqueadoNaoConsomeD1();
  await testarTodosBloqueadosSemLoopInfinito();
  await testarWorkspaceSaturadoNaoRecebe();
  await testarBacklogBloqueadoNaoCausaStarvationGlobal();
  await testarValidacoesDeDestino();
  await testarQueryExcluiIdsComPlaceholders();
  console.log("distributor-vivo-sem-starvation.test.js OK");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
