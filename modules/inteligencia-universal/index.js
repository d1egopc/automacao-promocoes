const { avaliarOfertaUniversal, montarTemplateInput } = require("./oferta-universal.service");
const { normalizarOfertaUniversal } = require("./normalizacao.service");
const { validarOfertaUniversal } = require("./validacao.service");
const { classificarCategoriaUniversal } = require("./categoria.service");
const { calcularScoreUniversal } = require("./score.service");
const { avaliarMemoriaUniversal, detectarIdentidadeProdutoUniversal } = require("./memoria.service");
const { analisarBeneficiosUniversal } = require("./beneficios.service");
const { avaliarDestinoUniversal } = require("./destino.service");
const { decidirOfertaUniversal, calcularPrioridadeUniversal } = require("./decisao.service");
const {
  construirMetadataIntelligenceV1,
  avaliarIntelligenceV1Global,
  modoGlobalIntelligenceV1
} = require("./foundation-v1.service");
const {
  memoryMode,
  buildMemoryRecord,
  readThroughMemoryV1,
  scheduleMemoryObservation,
  memoryRuntimeStatus
} = require("./memory-v1.service");

module.exports = {
  avaliarOfertaUniversal,
  montarTemplateInput,
  normalizarOfertaUniversal,
  validarOfertaUniversal,
  classificarCategoriaUniversal,
  calcularScoreUniversal,
  avaliarMemoriaUniversal,
  detectarIdentidadeProdutoUniversal,
  analisarBeneficiosUniversal,
  avaliarDestinoUniversal,
  decidirOfertaUniversal,
  calcularPrioridadeUniversal,
  construirMetadataIntelligenceV1,
  avaliarIntelligenceV1Global,
  modoGlobalIntelligenceV1,
  memoryMode,
  buildMemoryRecord,
  readThroughMemoryV1,
  scheduleMemoryObservation,
  memoryRuntimeStatus
};
