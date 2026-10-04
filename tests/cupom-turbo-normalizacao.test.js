const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
const filaOfertasFonte = fs.readFileSync(path.join(raiz, "utils", "fila-ofertas.js"), "utf8");

function extrairDeclaracao(nome, prefixo = "function", fonte = indexFonte) {
  const inicio = fonte.indexOf(`${prefixo} ${nome}`);
  assert(inicio >= 0, `declaracao ${nome} deve existir`);
  const fimAssinatura = fonte.indexOf(") {", inicio);
  assert(fimAssinatura >= 0, `assinatura ${nome} deve estar completa`);
  const abre = fimAssinatura + 2;
  let profundidade = 0;
  for (let i = abre; i < fonte.length; i += 1) {
    if (fonte[i] === "{") profundidade += 1;
    if (fonte[i] === "}") profundidade -= 1;
    if (profundidade === 0) return fonte.slice(inicio, i + 1);
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

const inicioTiposFila = filaOfertasFonte.indexOf("const TIPOS_CUPOM_PRIORIDADE_CONFIAVEL");
const fimTiposFila = filaOfertasFonte.indexOf("function prioridadeMinimaCupomConfiavel", inicioTiposFila);
assert(inicioTiposFila >= 0 && fimTiposFila > inicioTiposFila, "piso confiavel deve existir junto da decisao V2");

const fonteDecisaoV2 = [
  filaOfertasFonte.slice(inicioTiposFila, fimTiposFila),
  extrairDeclaracao("prioridadeMinimaCupomConfiavel", "function", filaOfertasFonte),
  extrairDeclaracao("aplicarDecisaoEngineV2Oficial", "function", filaOfertasFonte),
  "resultadoV2 = { prioridadeMinimaCupomConfiavel, aplicarDecisaoEngineV2Oficial };"
].join("\n");
const contextoV2 = {
  resultadoV2: null,
  Number,
  String,
  Boolean,
  Set,
  Date,
  obterConfigEngineV2: () => ({ modo: "oficial" }),
  textoComparacaoNormalizado: valor => String(valor || "").trim().toLowerCase(),
  statusOperacionalV2: () => "pendente",
  tituloCurto: valor => String(valor || "")
};
vm.runInNewContext(fonteDecisaoV2, contextoV2, { filename: "cupom-turbo-engine-v2-contract.js" });
const { aplicarDecisaoEngineV2Oficial } = contextoV2.resultadoV2;

function aplicarV2(oferta, prioridade, motivo = "inteligencia_universal_aprovada") {
  oferta.inteligenciaUniversalV2 = { status: "avaliada", prioridade, motivo };
  aplicarDecisaoEngineV2Oficial(oferta, { logger: { log() {} } });
  return oferta;
}

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

{
  const oferta = aplicarV2({ cupom: "RADAR10", cupomTipo: "texto_radar" }, 70);
  assert.strictEqual(oferta.prioridadeEnvio, 95);
  assert.strictEqual(oferta.prioridadeFila, 95);
  assert.strictEqual(oferta.prioridade, 95);
}

{
  const oferta = aplicarV2({ cupom: "CLONE15", tipoCupom: "texto_clonador" }, 80);
  assert.strictEqual(oferta.prioridadeEnvio, 95);
}

{
  const oferta = aplicarV2({ cupom: "REAL20", cupomTipo: "real" }, 70);
  assert.strictEqual(oferta.prioridadeEnvio, 110);
}

{
  const oferta = aplicarV2({ cupom: "REAL20", cupomTipo: "real" }, 120);
  assert.strictEqual(oferta.prioridadeEnvio, 120);
}

{
  const confirmada = aplicarV2({ cupom: "CONFIRMADO20", cupomConfirmado: true }, 70);
  const validada = aplicarV2({ cupom: "VALIDADO20", cupomValidado: true }, 80);
  assert.strictEqual(confirmada.prioridadeEnvio, 110);
  assert.strictEqual(validada.prioridadeEnvio, 110);
}

{
  const oferta = aplicarV2({ cupom: "TALVEZ10", cupomTipo: "provavel", possivelCupom: true }, 80);
  assert.strictEqual(oferta.prioridadeEnvio, 80);
}

for (const cupom of ["COPIADO", "APPLIED", "SEM CUPOM"]) {
  const oferta = aplicarV2({ cupom, cupomTipo: "real" }, 70);
  assert.strictEqual(oferta.prioridadeEnvio, 70, `${cupom} nao deve ser promovido`);
}

{
  const suspeita = aplicarV2({ cupom: "SUSPEITO10", cupomTipo: "texto_radar", cupomSuspeito: true }, 70);
  const incompativel = aplicarV2({
    cupom: "INCOMPATIVEL10",
    cupomTipo: "texto_clonador",
    cupomMonetarioIncompativel: true
  }, 80);
  assert.strictEqual(suspeita.prioridadeEnvio, 70);
  assert.strictEqual(incompativel.prioridadeEnvio, 80);
}

{
  const oferta = aplicarV2({
    prioridadeEnvio: 100,
    prioridadeFila: 130,
    motivoPrioridade: "Regra legitima mais forte",
    cupom: "FORTE20",
    cupomTipo: "real"
  }, 120);
  assert.strictEqual(oferta.prioridadeEnvio, 130);
  assert.strictEqual(oferta.motivoPrioridade, "Regra legitima mais forte");
}

{
  const oferta = aplicarV2({ cupom: "RADAR10", cupomTipo: "texto_radar" }, 70);
  assert.strictEqual(cupomFastLaneTipo(oferta), "real_detectado");
}

console.log("cupom-turbo-normalizacao: PASS");
