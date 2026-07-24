const assert = require("assert");
const {
  CLASSIFICACOES_PRECO,
  validarCoerenciaPreco
} = require("../modules/inteligencia-universal/preco-coerencia.service");

let resultado = validarCoerenciaPreco({ precoAtual: "0,90", precoOriginal: "59,87" });
assert.strictEqual(resultado.bloquear, true);
assert.strictEqual(resultado.classificacao, CLASSIFICACOES_PRECO.SUSPEITO);
assert.strictEqual(resultado.motivo, "desconto_extremo_sem_cupom_confirmado");

resultado = validarCoerenciaPreco({
  precoAtual: "1.704,04",
  precoOriginal: "1.899,00",
  valorCupom: "100,00",
  cupomTipo: "monetario_confirmado"
});
assert.strictEqual(resultado.bloquear, false);
assert.strictEqual(resultado.classificacao, CLASSIFICACOES_PRECO.CONFIAVEL);

resultado = validarCoerenciaPreco({ precoAtual: "17.990,00" }, {
  ofertaEntrada: {
    metadata: {
      comparacaoRadarLocal: {
        precoAtualLocal: 17.99,
        precoAtualImportador: 17990
      }
    }
  }
});
assert.strictEqual(resultado.bloquear, true);
assert.strictEqual(resultado.classificacao, CLASSIFICACOES_PRECO.DIVERGENTE);

resultado = validarCoerenciaPreco({ precoAtual: "4,99", precoOriginal: "" });
assert.strictEqual(resultado.bloquear, false);
assert.strictEqual(resultado.classificacao, CLASSIFICACOES_PRECO.CONFIAVEL);

console.log("preco-coerencia.test.js OK");
