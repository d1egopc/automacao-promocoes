"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const filaOfertas = require("../utils/fila-ofertas");

function loggerCaptura() {
  const eventos = [];
  return {
    eventos,
    log(prefixo, payload) {
      if (prefixo === "[FILA-LEGACY-PHYSICAL-READ]") eventos.push(JSON.parse(payload));
    },
    error() {}
  };
}

function semPayloadComercial(evento) {
  const serializado = JSON.stringify(evento);
  for (const campo of ["titulo", "link", "cupom", "ofertaId", "itens"]) {
    assert(!serializado.includes(`\"${campo}\"`), `payload nao deve conter ${campo}`);
  }
}

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "fila-ofertas-observability-"));
const dataAnterior = process.env.DATA_DIR;
process.env.DATA_DIR = raiz;

try {
  const workspace = "cliente_observabilidade";
  const dir = path.join(raiz, "clientes", workspace);
  const file = path.join(dir, "fila.json");
  fs.mkdirSync(dir, { recursive: true });
  const conteudo = JSON.stringify([
    { id: "a", clienteId: workspace, titulo: "segredo", cupom: "NAO_LOGAR" },
    { id: "b", clienteId: workspace }
  ]);
  fs.writeFileSync(file, conteudo);

  const loggerDireto = loggerCaptura();
  let contentReads = 0;
  const readOriginal = fs.readFileSync;
  fs.readFileSync = function (...args) {
    if (path.resolve(args[0]) === path.resolve(file)) contentReads += 1;
    return readOriginal.apply(this, args);
  };

  let resultadoDireto;
  try {
    resultadoDireto = filaOfertas.carregarFila({
      fila: [{ id: "outro", clienteId: "outro" }],
      clienteId: workspace,
      getFilaFile: () => file,
      logger: loggerDireto,
      callerTag: "radar_pre_dedupe"
    });
  } finally {
    fs.readFileSync = readOriginal;
  }

  assert.strictEqual(contentReads, 1, "instrumentacao nao pode adicionar content read");
  assert.deepStrictEqual(resultadoDireto.map(item => item.id), ["outro", "a", "b"]);
  assert.strictEqual(loggerDireto.eventos.length, 1);
  assert.strictEqual(loggerDireto.eventos[0].callerTag, "radar_pre_dedupe");
  assert.strictEqual(loggerDireto.eventos[0].workspace, workspace);
  assert.strictEqual(loggerDireto.eventos[0].bytes, Buffer.byteLength(conteudo));
  assert(Number.isFinite(loggerDireto.eventos[0].readMs));
  assert(Number.isFinite(loggerDireto.eventos[0].parseMs));
  semPayloadComercial(loggerDireto.eventos[0]);

  const loggerInjetado = loggerCaptura();
  let injectedReads = 0;
  const resultadoInjetado = filaOfertas.carregarFila({
    fila: [],
    clienteId: workspace,
    getFilaFile: () => file,
    readClienteJson() {
      injectedReads += 1;
      return JSON.parse(conteudo);
    },
    logger: loggerInjetado,
    callerTag: "distributor_dedupe_legacy"
  });

  assert.strictEqual(injectedReads, 1);
  assert.deepStrictEqual(resultadoInjetado.map(item => item.id), ["a", "b"]);
  assert.strictEqual(loggerInjetado.eventos.length, 1);
  assert.strictEqual(loggerInjetado.eventos[0].callerTag, "distributor_dedupe_legacy");
  assert.strictEqual(loggerInjetado.eventos[0].bytes, Buffer.byteLength(conteudo));
  assert.strictEqual(loggerInjetado.eventos[0].readMs, null);
  assert.strictEqual(loggerInjetado.eventos[0].parseMs, null);
  semPayloadComercial(loggerInjetado.eventos[0]);

  const loggerSemStat = loggerCaptura();
  let readsSemStat = 0;
  const resultadoSemStat = filaOfertas.carregarFila({
    fila: [],
    clienteId: workspace,
    getFilaFile: () => path.join(dir, "fila-inexistente.json"),
    readClienteJson() {
      readsSemStat += 1;
      return JSON.parse(conteudo);
    },
    logger: loggerSemStat
  });
  assert.strictEqual(readsSemStat, 1, "falha de stat nao pode repetir content read");
  assert.deepStrictEqual(resultadoSemStat.map(item => item.id), ["a", "b"]);
  assert.strictEqual(loggerSemStat.eventos[0].callerTag, "desconhecido");
  assert.strictEqual(loggerSemStat.eventos[0].bytes, 0);

  let telemetriaTentada = 0;
  const resultadoLoggerFalha = filaOfertas.carregarFila({
    fila: [],
    clienteId: workspace,
    getFilaFile: () => file,
    readClienteJson: () => JSON.parse(conteudo),
    logger: {
      log(prefixo) {
        if (prefixo === "[FILA-LEGACY-PHYSICAL-READ]") {
          telemetriaTentada += 1;
          throw new Error("telemetria_indisponivel");
        }
      },
      error() {}
    }
  });
  assert.strictEqual(telemetriaTentada, 1);
  assert.deepStrictEqual(resultadoLoggerFalha.map(item => item.id), ["a", "b"]);

  const fontes = {
    index: fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8"),
    distributor: fs.readFileSync(
      path.join(__dirname, "..", "modules", "engine", "distributor", "distributor.service.js"),
      "utf8"
    ),
    inteligencia: fs.readFileSync(
      path.join(__dirname, "..", "marketplaces", "inteligencia", "index.js"),
      "utf8"
    )
  };
  for (const tag of [
    "fila_boot",
    "executor_lazy_init",
    "executor_fallback",
    "engine_distributor_legacy",
    "distributor_dedupe_legacy",
    "inteligencia_boot",
    "radar_pre_dedupe"
  ]) {
    assert(
      Object.values(fontes).some(fonte => fonte.includes(`\"${tag}\"`)),
      `origem produtiva sem tag explicita: ${tag}`
    );
  }

  console.log("fila ofertas physical read observability: PASS");
} finally {
  if (dataAnterior === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = dataAnterior;
  fs.rmSync(raiz, { recursive: true, force: true });
}
