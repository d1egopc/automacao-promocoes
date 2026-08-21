const assert = require("assert");
const fs = require("fs");
const path = require("path");

const saas = require("../utils/saas-fundacao");
const { normalizarLimitesPlano } = require("../utils/cotas-flexiveis-planos");

const raiz = path.resolve(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");

function aplicarEdicaoPlano(planos, body) {
  const identidade = saas.resolverIdentidadePlanoEdicao(planos, body);
  const anterior = identidade.planoAnterior || {};
  planos[identidade.chavePlano] = {
    ...anterior,
    id: identidade.id,
    nome: identidade.nome,
    preco: body.preco ?? anterior.preco ?? "",
    visivelPublicamente: body.visivelPublicamente ?? anterior.visivelPublicamente ?? false,
    contratavel: body.contratavel ?? anterior.contratavel ?? false,
    limites: body.limites || anterior.limites || {},
    marketplaces: body.marketplaces || anterior.marketplaces || [],
    recursos: body.recursos || anterior.recursos || {},
    aliasesLegados: [...new Set([
      ...(Array.isArray(anterior.aliasesLegados) ? anterior.aliasesLegados : []),
      identidade.entradaAnterior?.chave,
      anterior.nome
    ].filter(Boolean))]
  };
  return planos[identidade.chavePlano];
}

const planos = {
  enterprise: {
    nome: "enterprise",
    preco: "R$ 497",
    visivelPublicamente: true,
    contratavel: true,
    creditosModelo: "ciclo",
    limites: {
      maxConexoes: 8,
      sessoes: 8,
      destinos: 50,
      enviosDia: 5000,
      creditosPorCiclo: 2000,
      cicloDias: 30
    },
    marketplaces: ["mercadolivre", "amazon", "shopee"],
    recursos: { whatsapp: true, telegram: true, discord: true, analytics: true }
  }
};

saas.normalizarPlanosSaasRuntime(planos);
assert.strictEqual(planos.enterprise.id, "enterprise", "plano legado deve receber id estavel derivado da chave");

const capitalizado = aplicarEdicaoPlano(planos, {
  id: "enterprise",
  chaveOriginal: "enterprise",
  nome: "Enterprise"
});
assert.strictEqual(capitalizado.id, "enterprise", "capitalizacao nao altera id");
assert.deepStrictEqual(Object.keys(planos), ["enterprise"], "enterprise -> Enterprise deve manter um unico registro");
assert.strictEqual(planos.enterprise.nome, "Enterprise");

const renomeado = aplicarEdicaoPlano(planos, {
  id: "enterprise",
  chaveOriginal: "enterprise",
  nome: "Optimus Enterprise"
});
assert.strictEqual(renomeado.id, "enterprise", "renomear label comercial preserva id");
assert.deepStrictEqual(Object.keys(planos), ["enterprise"], "Enterprise -> Optimus Enterprise nao cria novo registro");

assert.strictEqual(
  saas.buscarEntradaPlano(planos, "enterprise").plano.nome,
  "Optimus Enterprise",
  "usuario legado em enterprise continua resolvendo o plano"
);
assert.strictEqual(
  saas.buscarEntradaPlano(planos, "Enterprise").plano.nome,
  "Optimus Enterprise",
  "alias antigo continua aceito"
);

const planoPorId = saas.buscarPlanoCadastro(planos, "enterprise");
assert.strictEqual(planoPorId.nome, "Optimus Enterprise", "cadastro por ID deve localizar plano");
assert.strictEqual(
  saas.validarCadastroPublico({
    body: { nome: "Cliente", email: "cliente-id@teste.local", senha: "12345678", plano: "enterprise" },
    planos,
    usuarios: [],
    saasConfig: { cadastroPublicoAtivo: true }
  }).ok,
  true,
  "cadastro por ID funciona"
);
assert.strictEqual(
  saas.validarCadastroPublico({
    body: { nome: "Cliente", email: "cliente-nome@teste.local", senha: "12345678", plano: "Enterprise" },
    planos,
    usuarios: [],
    saasConfig: { cadastroPublicoAtivo: true }
  }).ok,
  true,
  "cadastro por nome legado continua compativel"
);

const publico = saas.planosPublicos(planos).map(saas.sanitizarPlanoPublico);
assert.strictEqual(publico.length, 1, "/public/planos nao duplica apos rename por id");
assert.strictEqual(publico[0].id, "enterprise", "/public/planos expoe id publico sanitizado");
assert.strictEqual(publico[0].nome, "Optimus Enterprise", "/public/planos mostra novo nome comercial");

assert.strictEqual(
  saas.politicaCreditosPlano(saas.buscarEntradaPlano(planos, "enterprise").plano).creditosPorCiclo,
  2000,
  "assinatura/creditos continuam lendo contrato do mesmo plano"
);
assert.strictEqual(
  normalizarLimitesPlano(saas.buscarEntradaPlano(planos, "Enterprise").plano, {}).maxConexoes,
  8,
  "cotas continuam equivalentes por alias legado"
);
assert.strictEqual(
  saas.buscarEntradaPlano(planos, "enterprise").plano.recursos.analytics,
  true,
  "recursos e locks continuam resolvendo pelo mesmo contrato"
);

const conflito = {
  enterprise: { id: "enterprise", nome: "Enterprise" },
  Enterprise: { id: "Enterprise", nome: "Enterprise" }
};
const conflitos = saas.detectarConflitosIdentidadePlanos(conflito);
assert.ok(conflitos.some((item) => item.alias === "enterprise" && item.entradas.length === 2), "duplicidade enterprise + Enterprise deve ser detectada");
assert.strictEqual(saas.buscarEntradaPlano(conflito, "Enterprise").chave, "Enterprise", "chave exata deve vencer alias case-insensitive em duplicidade");
assert.deepStrictEqual(Object.keys(conflito), ["enterprise", "Enterprise"], "detectar conflito nao remove registros");

assert.ok(indexFonte.includes("resolverIdentidadePlanoEdicao(planos, body)"), "POST /admin/planos deve resolver identidade estavel");
assert.ok(indexFonte.includes("planos[chavePlano] ="), "POST /admin/planos deve salvar pela chave estavel");
assert.ok(!indexFonte.includes("planos[nomePlano] ="), "POST /admin/planos nao pode salvar por nome comercial");
assert.ok(indexFonte.includes("conflitosIdentidade"), "GET /admin/planos deve reportar conflitos sem reconciliar");

console.log("planos-identidade-estavel-v1.test.js OK");
