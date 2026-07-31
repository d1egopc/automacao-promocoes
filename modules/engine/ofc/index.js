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

module.exports = {
  executarObservabilidadeOfc,
  coletarMetricasOfc,
  calcularConsumoReal,
  calcularPressaoOperacional,
  calcularReservaDinamicaOfc,
  criarPlanoShadowOfc
};
