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

module.exports = {
  executarObservabilidadeOfc,
  coletarMetricasOfc,
  calcularConsumoReal,
  calcularPressaoOperacional,
  calcularReservaDinamicaOfc,
  criarPlanoShadowOfc,
  selecionarFilaAtivaShadow,
  criarFilaAtivaShadowOfc
};
