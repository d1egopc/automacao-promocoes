const assert = require("assert");
const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "..", "index.js");
const destinosUtils = require("../utils/destinos");
const fonte = fs.readFileSync(indexPath, "utf8");

function trechoEntre(inicioMarcador, fimMarcador) {
  const inicio = fonte.indexOf(inicioMarcador);
  assert(inicio >= 0, `${inicioMarcador} deve existir`);
  const fim = fonte.indexOf(fimMarcador, inicio + inicioMarcador.length);
  assert(fim > inicio, `${fimMarcador} deve existir apos ${inicioMarcador}`);
  return fonte.slice(inicio, fim);
}

function pos(trecho, marcador) {
  const indice = trecho.indexOf(marcador);
  assert(indice >= 0, `${marcador} deve existir no trecho`);
  return indice;
}

function comAgoraLocal(hora, fn) {
  const DateOriginal = global.Date;
  const [h, m] = hora.split(":").map(Number);
  const instante = new DateOriginal(2026, 8, 6, h, m, 0);

  class DateFake extends DateOriginal {
    constructor(...args) {
      if (!args.length) return new DateOriginal(instante.getTime());
      return new DateOriginal(...args);
    }

    static now() {
      return instante.getTime();
    }

    static parse(valor) {
      return DateOriginal.parse(valor);
    }

    static UTC(...args) {
      return DateOriginal.UTC(...args);
    }
  }

  global.Date = DateFake;
  try {
    return fn();
  } finally {
    global.Date = DateOriginal;
  }
}

const processarFila = trechoEntre(
  "async function processarFila",
  "// ================= ENVIO MANUAL"
);
const runnerGlobal = trechoEntre(
  "async function rodarProcessadorFilaGlobal",
  "setInterval(() => {"
);
const rodarMarketplace = trechoEntre(
  "async function rodarMarketplaceEspecifico",
  "const retornoFarejador = await farejador"
);
const trechoEnvioDestino = trechoEntre(
  "async function enviarParaDestinoInteligente",
  "function logProcessarFilaResumo"
);

assert(
  !runnerGlobal.includes("Fila pausada fora do horario configurado") &&
    !runnerGlobal.includes("if (!podeRodarAgora())"),
  "Executor global deve continuar avaliando workspaces mesmo com janela global fechada"
);

assert(
  !processarFila.includes("fora_janela_global") &&
    !processarFila.includes("if (!podeRodarAgora())"),
  "processarFila nao deve aplicar precedencia de horario global"
);

assert(
  rodarMarketplace.includes("if (!podeRodarAgora()) return;"),
  "orquestrador de marketplaces deve preservar a regra temporal global"
);

assert(
  pos(trechoEnvioDestino, "if (!destinoAceitaOferta(destino, oferta))") <
    pos(trechoEnvioDestino, "if (!opcoes.ignorarHorario && !destinoDentroHorario(destino))"),
  "envio por destino deve preservar compatibilidade antes da janela individual"
);

assert(
  processarFila.includes("const limite = destinoLimiteDiarioDisponivel(clienteId, destino);") &&
    processarFila.includes("if (!limite.ok)") &&
    processarFila.includes("const intervalo = item.intervalo;") &&
    processarFila.includes("if (!intervalo.liberado)"),
  "processarFila deve preservar limite diario e cooldown por destino"
);

assert.strictEqual(
  comAgoraLocal("23:30", () => destinosUtils.destinoDentroHorario({ ativo: true, horarioInicio: "07:00", horarioFim: "01:30" })),
  true,
  "janela individual cruzando meia-noite deve abrir antes de 00:00"
);

assert.strictEqual(
  comAgoraLocal("00:30", () => destinosUtils.destinoDentroHorario({ ativo: true, horarioInicio: "07:00", horarioFim: "01:30" })),
  true,
  "janela individual cruzando meia-noite deve seguir aberta depois de 00:00"
);

assert.strictEqual(
  comAgoraLocal("01:31", () => destinosUtils.destinoDentroHorario({ ativo: true, horarioInicio: "07:00", horarioFim: "01:30" })),
  false,
  "janela individual cruzando meia-noite deve fechar apos o fim"
);

assert.strictEqual(
  comAgoraLocal("23:51", () => destinosUtils.destinoDentroHorario({ ativo: true, horarioInicio: "07:30", horarioFim: "23:50" })),
  false,
  "destino individual fora do horario deve continuar bloqueado"
);

assert.strictEqual(
  comAgoraLocal("08:00", () => destinosUtils.destinoDentroHorario({ ativo: true, horarioInicio: "07:30", horarioFim: "23:50" })),
  true,
  "destino individual aberto deve continuar apto pelo horario"
);

console.log("executor-relogio-multiworkspace.test.js OK");
