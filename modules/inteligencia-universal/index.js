const { avaliarOfertaUniversal, montarTemplateInput } = require("./oferta-universal.service");
const { normalizarOfertaUniversal } = require("./normalizacao.service");
const { validarOfertaUniversal } = require("./validacao.service");
const { classificarCategoriaUniversal } = require("./categoria.service");
const { calcularScoreUniversal } = require("./score.service");
const { avaliarMemoriaUniversal } = require("./memoria.service");
const { analisarBeneficiosUniversal } = require("./beneficios.service");
const { avaliarDestinoUniversal } = require("./destino.service");
const { decidirOfertaUniversal, calcularPrioridadeUniversal } = require("./decisao.service");

module.exports = {
  avaliarOfertaUniversal,
  montarTemplateInput,
  normalizarOfertaUniversal,
  validarOfertaUniversal,
  classificarCategoriaUniversal,
  calcularScoreUniversal,
  avaliarMemoriaUniversal,
  analisarBeneficiosUniversal,
  avaliarDestinoUniversal,
  decidirOfertaUniversal,
  calcularPrioridadeUniversal
};