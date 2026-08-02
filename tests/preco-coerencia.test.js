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

resultado = validarCoerenciaPreco({ precoAtual: "", precoOriginal: "" }, {
  ofertaEntrada: {
    metadata: {
      radarMirror: {
        preco: {
          atualCapturado: 399.83,
          origem: "texto_radar",
          confianca: "media",
          marcadorComercial: "Por"
        },
        comercial: {
          precoAtual: {
            valor: 399.83,
            tipo: "preco_atual",
            evidencia: "R$ 399,83",
            nivelEvidencia: "alta"
          }
        }
      }
    }
  }
});
assert.strictEqual(resultado.bloquear, false);
assert.strictEqual(resultado.classificacao, CLASSIFICACOES_PRECO.CONFIAVEL);
assert.strictEqual(resultado.motivo, "preco_radar_mirror_confiavel");

resultado = validarCoerenciaPreco({ precoAtual: "", precoOriginal: "" }, {
  ofertaEntrada: {
    metadata: {
      radarMirror: {
        preco: {
          atualCapturado: 9,
          origem: "texto_radar",
          confianca: "media",
          marcadorComercial: "parcelamento"
        },
        comercial: {
          precoAtual: {
            valor: 9,
            tipo: "parcelamento",
            evidencia: "9x sem juros",
            nivelEvidencia: "alta"
          }
        }
      }
    }
  }
});
assert.strictEqual(resultado.bloquear, true);
assert.strictEqual(resultado.motivo, "preco_atual_sem_evidencia");

function validarRadarMirrorBloqueado({ tipo, evidencia, valor = 10, marcadorComercial = "preco" }) {
  const retorno = validarCoerenciaPreco({ precoAtual: "", precoOriginal: "" }, {
    ofertaEntrada: {
      metadata: {
        radarMirror: {
          preco: {
            atualCapturado: valor,
            origem: "texto_radar",
            confianca: "alta",
            marcadorComercial
          },
          comercial: {
            precoAtual: {
              valor,
              tipo,
              evidencia,
              nivelEvidencia: "alta"
            }
          }
        }
      }
    }
  });
  assert.strictEqual(retorno.bloquear, true, `${tipo} nao deve sustentar preco atual`);
  assert.strictEqual(retorno.motivo, "preco_atual_sem_evidencia");
}

validarRadarMirrorBloqueado({ tipo: "frete", evidencia: "Frete R$ 10,00" });
validarRadarMirrorBloqueado({ tipo: "percentual", evidencia: "15% OFF", marcadorComercial: "desconto percentual" });
validarRadarMirrorBloqueado({ tipo: "quantidade_vendida", evidencia: "122 vendidos", valor: 122 });
validarRadarMirrorBloqueado({ tipo: "faixa_preco", evidencia: "R$ 40 a R$ 78", marcadorComercial: "faixa de precos" });
validarRadarMirrorBloqueado({ tipo: "preco_ambiguo", evidencia: "R$ 40 ou R$ 78", marcadorComercial: "preco ambiguo" });
validarRadarMirrorBloqueado({ tipo: "valor_cupom", evidencia: "Cupom de R$ 10,00", marcadorComercial: "cupom" });
validarRadarMirrorBloqueado({ tipo: "cashback", evidencia: "R$ 20,00 de cashback", marcadorComercial: "beneficio cashback" });

console.log("preco-coerencia.test.js OK");
