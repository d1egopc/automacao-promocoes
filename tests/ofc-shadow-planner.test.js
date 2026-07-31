const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  calcularConsumoReal,
  calcularPressaoOperacional,
  criarPlanoShadowOfc
} = require("../modules/engine/ofc");

const consumo = calcularConsumoReal({
  janelaMinutos: 10,
  etapas: [
    { etapa: "diagnostico_final", status: "ok", total: 20 },
    { etapa: "validacao_final", status: "ok", total: 10 }
  ]
});

assert.strictEqual(consumo.eventos, 30);
assert.strictEqual(consumo.eventosPorMinuto, 3);

const pressao = calcularPressaoOperacional({
  status: [
    { status: "pendente", total: 120, mais_antigo_em: new Date(Date.now() - 60000).toISOString() },
    { status: "diagnosticado", total: 20 },
    { status: "pronto_para_importar", total: 8 }
  ]
}, consumo);

assert.strictEqual(pressao.pendentes, 120);
assert.strictEqual(pressao.backlogOperacional, 148);
assert.strictEqual(pressao.backlogMaiorQueConsumo, true);

const plano = criarPlanoShadowOfc({
  consumoReal: consumo,
  pressao,
  reservatorio: {
    porMarketplace: [
      { nome: "shopee", total: 80, status: { pendente: 80 }, idadeMaisAntigoMs: 60000 },
      { nome: "mercadolivre", total: 40, status: { pendente: 40 }, idadeMaisAntigoMs: 30000 }
    ],
    porCliente: [
      { nome: "user_a", total: 70, status: { pendente: 70 }, idadeMaisAntigoMs: 60000 }
    ]
  }
}, {
  janelaAlvoMinutos: 5,
  pisoOperacional: 10,
  tetoShadow: 100
});

assert.strictEqual(plano.modo, "shadow");
assert.strictEqual(plano.aplicouMudancas, false);
assert.strictEqual(plano.reserva.reservaPorConsumo, 15);
assert.strictEqual(plano.reserva.reservaDesejada, 15);
assert.strictEqual(plano.marketplacesPressionados[0].marketplace, "shopee");

const processorService = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "processor.service.js"), "utf8");
assert(
  processorService.includes("WHERE status = 'pendente'"),
  "Fase 0 nao pode alterar a busca atual do Worker"
);
assert(
  processorService.includes("ORDER BY criado_em ASC, id ASC"),
  "Fase 0 nao pode alterar a ordenacao atual do Worker"
);

const orchestrator = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "orchestrator.runner.js"), "utf8");
assert(orchestrator.includes("executarObservabilidadeOfc"), "orquestrador deve chamar OFC em modo observabilidade");
assert(orchestrator.includes("resumo.etapas.ofc"), "resultado do OFC deve ser auditavel no resumo");

console.log("ofc-shadow-planner.test.js OK");
