const assert = require("assert");

const {
  prioridadeMinimaCupomConfiavel
} = require("../modules/cupom/prioridade-cupom");

let prioridadeV2Mock = 70;
const databasePath = require.resolve("../modules/engine/database");
const inteligenciaPath = require.resolve("../modules/inteligencia-universal");

require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    queryEngine: async () => ({ ok: true, resultado: { rows: [] } })
  }
};
require.cache[inteligenciaPath] = {
  id: inteligenciaPath,
  filename: inteligenciaPath,
  loaded: true,
  exports: {
    avaliarOfertaUniversal: () => ({
      ok: true,
      status: "aprovada",
      motivo: "teste_prioridade_importer",
      score: 70,
      prioridade: prioridadeV2Mock,
      ofertaUniversal: {},
      memoria: {},
      valorEfetivoDetalhes: {}
    }),
    detectarIdentidadeProdutoUniversal: () => ({
      produtoIdDetectado: "",
      tipoIdentidade: ""
    })
  }
};

const {
  aplicarSombraInteligenciaUniversalV2,
  resolverPrioridadeCupomImporter
} = require("../modules/engine/importer/importer.service");

function prioridadeImporter(oferta, prioridadeV2) {
  return resolverPrioridadeCupomImporter(oferta, prioridadeV2);
}

const positivos = [
  [{ cupom: "RADAR10", cupomTipo: "texto_radar" }, 70, 95],
  [{ cupom: "RADAR10", cupomTipo: "texto_radar" }, 80, 95],
  [{ cupom: "CLONE15", tipoCupom: "texto_clonador" }, 85, 95],
  [{ cupom: "REAL20", cupomTipo: "real" }, 70, 110],
  [{ cupom: "CONF20", cupomConfirmado: true }, 90, 110],
  [{ cupom: "VALID20", cupomValidado: true }, 100, 110],
  [{ cupom: "RADAR10", cupomTipo: "texto_radar" }, 120, 120],
  [{ cupom: "RADAR10", cupomTipo: "texto_radar", prioridade: 105 }, 70, 105],
  [{ cupom: "REAL20", cupomTipo: "real", prioridadeEnvio: 120 }, 70, 120]
];

for (const [oferta, prioridadeV2, esperado] of positivos) {
  assert.strictEqual(prioridadeImporter(oferta, prioridadeV2).prioridadeFinal, esperado);
}

const negativos = [
  { cupom: "TALVEZ10", cupomTipo: "provavel", possivelCupom: true },
  { cupom: "COPIADO", cupomTipo: "texto_radar" },
  { cupom: "APPLIED", cupomTipo: "texto_radar" },
  { cupom: "APPEARANCE", cupomTipo: "texto_radar" },
  { cupom: "APPLINK", cupomTipo: "texto_radar" },
  { cupom: "SEM CUPOM", cupomTipo: "texto_radar" },
  { cupom: "" },
  { beneficioExtra: "Frete gratis" },
  { cupom: "80MM" },
  { cupom: "SUSPEITO10", cupomTipo: "texto_radar", cupomSuspeito: true },
  { cupom: "INCOMPATIVEL10", cupomTipo: "texto_clonador", cupomMonetarioIncompativel: true }
];

for (const oferta of negativos) {
  const resultado = prioridadeImporter(oferta, 70);
  assert.strictEqual(resultado.prioridadeMinimaCupom, 0);
  assert.strictEqual(resultado.prioridadeFinal, 70);
}

const casosReais = [
  { ofertaId: 87278, jobId: 360935, prioridadeV2: 80 },
  { ofertaId: 87109, jobId: 359214, prioridadeV2: 70 },
  { ofertaId: 87113, jobId: 359207, prioridadeV2: 70 },
  { ofertaId: 87075, jobId: 358506, prioridadeV2: 80 }
];

for (const caso of casosReais) {
  const resultado = prioridadeImporter(
    { cupom: "CUPOM_REAL_MASCARADO", cupomTipo: "texto_radar" },
    caso.prioridadeV2
  );
  assert.strictEqual(resultado.prioridadeFinal, 95, `replay ${caso.ofertaId}/${caso.jobId}`);
}

const matriz = [
  ...positivos.map(([oferta, prioridadeV2]) => [oferta, prioridadeV2]),
  ...negativos.map(oferta => [oferta, 70])
];

for (const [oferta, prioridadeV2] of matriz) {
  const pisoFila = prioridadeMinimaCupomConfiavel(oferta);
  const pisoImporter = prioridadeImporter(oferta, prioridadeV2).prioridadeMinimaCupom;
  assert.strictEqual(pisoImporter, pisoFila);
}

const CUPONS_INVALIDOS_BASE = new Set([
  "COPIADO",
  "APPLIED",
  "APPEARANCE",
  "APPLINK",
  "SEM CUPOM"
]);
const TIPOS_CONFIAVEIS_BASE = new Set(["texto_radar", "texto_clonador"]);

function prioridadeMinimaCupomBase(oferta = {}) {
  if (!oferta || typeof oferta !== "object") return 0;
  if (oferta.cupomSuspeito === true || oferta.cupomMonetarioIncompativel === true) return 0;

  const cupom = String(oferta.cupom || "").trim().toUpperCase();
  if (CUPONS_INVALIDOS_BASE.has(cupom)) return 0;

  const tipos = [oferta.cupomTipo, oferta.tipoCupom]
    .map(tipo => String(tipo || "").trim().toLowerCase())
    .filter(Boolean);
  if (
    tipos.includes("real") ||
    oferta.cupomConfirmado === true ||
    oferta.cupomValidado === true
  ) {
    return 110;
  }

  const evidenciaTextoConfiavel = Boolean(cupom) && tipos.some(tipo =>
    tipo === "detectado" || TIPOS_CONFIAVEIS_BASE.has(tipo)
  );
  return evidenciaTextoConfiavel ? 95 : 0;
}

const cupomsParidade = ["", "ABC123", "COPIADO", "APPLIED", "SEM CUPOM"];
const tiposParidade = [
  "real",
  "confirmado",
  "validado",
  "detectado",
  "texto_radar",
  "texto_clonador",
  "provavel"
];
let totalCasosParidade = 0;

for (const cupom of cupomsParidade) {
  for (const cupomTipo of tiposParidade) {
    for (const cupomConfirmado of [false, true]) {
      for (const cupomValidado of [false, true]) {
        for (const cupomSuspeito of [false, true]) {
          for (const cupomMonetarioIncompativel of [false, true]) {
            totalCasosParidade += 1;
            const oferta = {
              cupom,
              cupomTipo,
              cupomConfirmado,
              cupomValidado,
              cupomSuspeito,
              cupomMonetarioIncompativel
            };
            assert.strictEqual(
              prioridadeMinimaCupomConfiavel(oferta),
              prioridadeMinimaCupomBase(oferta),
              `paridade comercial: ${JSON.stringify(oferta)}`
            );
          }
        }
      }
    }
  }
}
assert.strictEqual(totalCasosParidade, 560);

(async () => {
  prioridadeV2Mock = 70;
  const sombra = await aplicarSombraInteligenciaUniversalV2({
    marketplace: "amazon",
    titulo: "Produto com cupom",
    preco: 100,
    cupom: "RADAR10",
    cupomTipo: "texto_radar",
    prioridade: 80
  });

  assert.strictEqual(sombra.oferta.prioridade, 95);
  assert.strictEqual(sombra.oferta.score, 70);
  assert.strictEqual(sombra.metadata.inteligenciaUniversalV2.prioridade, 95);
  assert.strictEqual(sombra.metadata.inteligenciaUniversalV2.prioridadeDecisaoV2, 70);
  assert.strictEqual(sombra.metadata.inteligenciaUniversalV2.prioridadeMinimaCupom, 95);
  assert.strictEqual(sombra.metadata.inteligenciaUniversalV2.prioridadeAnterior, 80);
  assert.strictEqual(sombra.metadata.inteligenciaUniversalV2.pisoPrioridadeCupomAplicado, true);

  console.log("engine-importer-cupom-prioridade: PASS");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
