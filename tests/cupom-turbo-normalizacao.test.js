const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");

function extrairDeclaracao(nome, prefixo = "function") {
  const inicio = indexFonte.indexOf(`${prefixo} ${nome}`);
  assert(inicio >= 0, `declaracao ${nome} deve existir`);
  const fimAssinatura = indexFonte.indexOf(") {", inicio);
  assert(fimAssinatura >= 0, `assinatura ${nome} deve estar completa`);
  const abre = fimAssinatura + 2;
  let profundidade = 0;
  for (let i = abre; i < indexFonte.length; i += 1) {
    if (indexFonte[i] === "{") profundidade += 1;
    if (indexFonte[i] === "}") profundidade -= 1;
    if (profundidade === 0) return indexFonte.slice(inicio, i + 1);
  }
  throw new Error(`declaracao ${nome} incompleta`);
}

const inicioTipos = indexFonte.indexOf("const TIPOS_CUPOM_EVIDENCIA_CONFIAVEL");
const fimTipos = indexFonte.indexOf("function evidenciaCupomRealConfiavel", inicioTipos);
assert(inicioTipos >= 0 && fimTipos > inicioTipos, "tipos confiaveis devem existir antes do normalizador");

const fonteContrato = [
  extrairDeclaracao("prioridadeEnvioOferta"),
  indexFonte.slice(inicioTipos, fimTipos),
  extrairDeclaracao("evidenciaCupomRealConfiavel"),
  extrairDeclaracao("normalizarEvidenciaCupomReal"),
  extrairDeclaracao("aplicarPrioridadeEnvioOferta"),
  extrairDeclaracao("ofertaExpiradaParaEnvio"),
  extrairDeclaracao("cupomFastLaneTipo"),
  extrairDeclaracao("rankFastLaneCupom"),
  extrairDeclaracao("dataFilaMs"),
  extrairDeclaracao("ordenarPendentesPorPrioridade"),
  "resultado = { aplicarPrioridadeEnvioOferta, cupomFastLaneTipo, ordenarPendentesPorPrioridade };"
].join("\n");

const contexto = { resultado: null, Date, Number, String, Boolean, Set };
vm.runInNewContext(fonteContrato, contexto, { filename: "cupom-turbo-index-contract.js" });
const {
  aplicarPrioridadeEnvioOferta,
  cupomFastLaneTipo,
  ordenarPendentesPorPrioridade
} = contexto.resultado;

{
  const oferta = { prioridadeEnvio: 70, motivoPrioridade: "Oferta comum" };
  aplicarPrioridadeEnvioOferta(oferta);
  assert.strictEqual(oferta.prioridadeEnvio, 70);
  assert.strictEqual(cupomFastLaneTipo(oferta), "");
}

{
  const oferta = {
    prioridadeEnvio: 70,
    motivoPrioridade: "Prioridade anterior",
    cupom: "RADAR10",
    cupomTipo: "texto_radar"
  };
  aplicarPrioridadeEnvioOferta(oferta);
  assert.strictEqual(oferta.prioridadeEnvio, 95);
  assert.strictEqual(oferta.cupomTipo, "detectado");
  assert.strictEqual(cupomFastLaneTipo(oferta), "real_detectado");
}

{
  const oferta = {
    prioridadeEnvio: 80,
    motivoPrioridade: "Prioridade anterior",
    cupom: "CLONE15",
    tipoCupom: "texto_clonador"
  };
  aplicarPrioridadeEnvioOferta(oferta);
  assert.strictEqual(oferta.prioridadeEnvio, 95);
  assert.strictEqual(oferta.cupomTipo, "detectado");
  assert.strictEqual(cupomFastLaneTipo(oferta), "real_detectado");
}

{
  const oferta = {
    prioridadeEnvio: 110,
    motivoPrioridade: "Regra legitima mais forte",
    cupom: "FORTE20",
    cupomTipo: "texto_radar",
    tipoCupom: "real"
  };
  aplicarPrioridadeEnvioOferta(oferta);
  assert.strictEqual(oferta.prioridadeEnvio, 110);
  assert.strictEqual(oferta.cupomTipo, "real");
  assert.strictEqual(oferta.motivoPrioridade, "Regra legitima mais forte");
}

{
  const oferta = {
    prioridadeEnvio: 80,
    motivoPrioridade: "Cupom provavel",
    cupomTipo: "provavel",
    possivelCupom: true,
    beneficioExtra: "Beneficio possivel"
  };
  aplicarPrioridadeEnvioOferta(oferta);
  assert.strictEqual(oferta.prioridadeEnvio, 80);
  assert.strictEqual(cupomFastLaneTipo(oferta), "provavel");
}

{
  const oferta = {
    prioridadeEnvio: 70,
    motivoPrioridade: "Oferta comum",
    cupom: "COPIADO",
    cupomTipo: "texto_radar"
  };
  aplicarPrioridadeEnvioOferta(oferta);
  assert.strictEqual(oferta.prioridadeEnvio, 70);
  assert.strictEqual(cupomFastLaneTipo(oferta), "");
}

{
  const aplicarPrioridadeFonte = extrairDeclaracao("aplicarPrioridadeEnvioOferta");
  assert(
    aplicarPrioridadeFonte.indexOf("normalizarEvidenciaCupomReal(oferta)") <
      aplicarPrioridadeFonte.indexOf("oferta.prioridadeEnvio !== undefined && oferta.motivoPrioridade"),
    "evidencia confiavel deve ser normalizada antes do early return"
  );
}

{
  const { ordenarCandidatosPorDemanda } = require("../modules/demand-scheduler/demand-scheduler.service");
  const candidatos = [
    {
      elegivel: true,
      oferta: { id: "cupom" },
      ranking: { prioridade: 95, scoreFinal: 100, fanoutUrgente: false },
      destinosLiberados: [{ liberado: true, turboAplicado: true, intervaloMs: 90000, esperaMs: 90000 }]
    },
    {
      elegivel: true,
      oferta: { id: "fanout" },
      ranking: { prioridade: 40, scoreFinal: 1, fanoutUrgente: true },
      destinosLiberados: [{ liberado: true, turboAplicado: false, intervaloMs: 150000, esperaMs: 150000 }]
    }
  ];
  const ordenados = ordenarCandidatosPorDemanda(candidatos, { agora: Date.now() }, itens => itens);
  assert.strictEqual(ordenados[0].oferta.id, "fanout");
}

{
  const cupom = {
    id: "cupom",
    prioridadeEnvio: 70,
    motivoPrioridade: "Prioridade anterior",
    cupom: "MESMO10",
    cupomTipo: "texto_radar",
    criadoEm: "2026-10-03T12:00:01.000Z"
  };
  const comum = {
    id: "comum",
    prioridadeEnvio: 70,
    motivoPrioridade: "Oferta comum",
    criadoEm: "2026-10-03T12:00:00.000Z"
  };
  aplicarPrioridadeEnvioOferta(cupom);
  const ordenadas = ordenarPendentesPorPrioridade([comum, cupom]);
  assert.strictEqual(ordenadas[0].id, "cupom");
  assert.strictEqual(cupom.prioridadeEnvio, 95);
}

console.log("cupom-turbo-normalizacao: PASS");
