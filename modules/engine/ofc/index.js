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
const {
  calcularFluxoComercialShadow,
  criarFluxoComercialShadowOfc
} = require("./commercial-flow.service");
const {
  criarGateAbsorcaoShadowOfc,
  montarGateWorkspace,
  classificarEstadoEsteira
} = require("./absorption-gate.service");
const {
  TIPOS_EVENTO_COMERCIAL,
  normalizarEventoComercial,
  prepararSchemaEventosComerciaisSeguro,
  registrarEventoComercialSeguro
} = require("./commercial-events.service");
const {
  consultarJobsEmCursoSuspeitos
} = require("./stuck-jobs.repository");

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
  criarFluxoVivoShadowOfc,
  calcularFluxoComercialShadow,
  criarFluxoComercialShadowOfc,
  criarGateAbsorcaoShadowOfc,
  montarGateWorkspace,
  classificarEstadoEsteira,
  TIPOS_EVENTO_COMERCIAL,
  normalizarEventoComercial,
  prepararSchemaEventosComerciaisSeguro,
  registrarEventoComercialSeguro,
  consultarJobsEmCursoSuspeitos
};
