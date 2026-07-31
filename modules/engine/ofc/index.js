const { executarObservabilidadeOfc } = require("./controller.runner");
const {
  coletarMetricasOfc,
  calcularConsumoReal,
  calcularPressaoOperacional
} = require("./metrics.service");
const {
  calcularReservaDinamicaOfc,
  criarPlanoShadowOfc
} = require("./planner.service");
const {
  selecionarFilaAtivaShadow,
  criarFilaAtivaShadowOfc
} = require("./active-queue.service");
const {
  detectarSinaisOperacionais,
  ttlOperacionalSugeridoMs,
  temperaturaOperacionalSugerida,
  avaliarOportunidadeOperacional
} = require("./policy.service");
const {
  calcularPressaoOperacionalV2,
  calcularSaudeOperacional,
  criarPlanoOperacionalV2Shadow
} = require("./operational-shadow.service");
const {
  calcularFluxoVivoShadow,
  criarFluxoVivoShadowOfc
} = require("./live-flow.service");

module.exports = {
  executarObservabilidadeOfc,
  coletarMetricasOfc,
  calcularConsumoReal,
  calcularPressaoOperacional,
  calcularReservaDinamicaOfc,
  criarPlanoShadowOfc,
  selecionarFilaAtivaShadow,
  criarFilaAtivaShadowOfc,
  detectarSinaisOperacionais,
  ttlOperacionalSugeridoMs,
  temperaturaOperacionalSugerida,
  avaliarOportunidadeOperacional,
  calcularPressaoOperacionalV2,
  calcularSaudeOperacional,
  criarPlanoOperacionalV2Shadow,
  calcularFluxoVivoShadow,
  criarFluxoVivoShadowOfc
};
