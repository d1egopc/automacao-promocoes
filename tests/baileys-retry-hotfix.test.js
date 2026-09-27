const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  BAILEYS_VERSION,
  TARGET_RELATIVE,
  ORIGINAL_BLOCK,
  PATCHED_BLOCK,
  aplicarPatch
} = require("../scripts/apply-baileys-retry-hotfix.cjs");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function compilarBloco(bloco) {
  return new AsyncFunction(
    "retryMutex",
    "ws",
    "getBinaryNodeChild",
    "node",
    "sendRetryRequest",
    "retryRequestDelayMs",
    "delay",
    "logger",
    bloco
  );
}

function boomConnectionClosed() {
  const error = new Error("Connection Closed");
  error.output = { statusCode: 428 };
  return error;
}

function dependenciasExecucao({ mutex, ws, sendRetryRequest, delay, logger } = {}) {
  return [
    mutex,
    ws,
    () => null,
    { attrs: {} },
    sendRetryRequest,
    25,
    delay,
    logger || { debug() {} }
  ];
}

async function capturarUnhandled(executar) {
  const rejeicoes = [];
  const handler = (reason) => rejeicoes.push(reason);
  process.on("unhandledRejection", handler);
  try {
    await executar();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    return rejeicoes;
  } finally {
    process.off("unhandledRejection", handler);
  }
}

async function main() {
  const raiz = path.resolve(__dirname, "..");
  const targetPath = path.join(raiz, TARGET_RELATIVE);
  const source = fs.readFileSync(targetPath, "utf8");
  assert.equal(source.includes(ORIGINAL_BLOCK), false);
  assert.equal(source.split(PATCHED_BLOCK).length - 1, 1);
  assert.equal(source.includes("const retryMutex = makeMutex();"), true);
  assert.equal(source.includes("if (retryCount >= maxMsgRetryCount)"), true);
  assert.equal(source.includes("retryCount += 1;"), true);
  assert.equal(source.includes("msgRetryCache.set(key, retryCount);"), true);
  assert.equal(PATCHED_BLOCK.includes("await delay(retryRequestDelayMs);"), true);

  const mutexModulePath = path.join(
    raiz,
    "node_modules",
    "@whiskeysockets",
    "baileys",
    "lib",
    "Utils",
    "make-mutex.js"
  );
  const { makeMutex } = await import(pathToFileURL(mutexModulePath).href);
  const executarOriginal = compilarBloco(ORIGINAL_BLOCK);
  const executarPatched = compilarBloco(PATCHED_BLOCK);

  // Reproduz o incidente original: a Promise do mutex fica desacoplada.
  {
    const ws = { isOpen: true };
    const rejeicoes = await capturarUnhandled(async () => {
      await executarOriginal(...dependenciasExecucao({
        mutex: makeMutex(),
        ws,
        sendRetryRequest: async () => {
          ws.isOpen = false;
          throw boomConnectionClosed();
        },
        delay: async () => {}
      }));
    });
    assert.equal(rejeicoes.length, 1);
    assert.equal(rejeicoes[0].message, "Connection Closed");
    assert.equal(rejeicoes[0].output.statusCode, 428);
  }

  // Mesmo cenário no hotfix: zero unhandledRejection e processo vivo.
  {
    const ws = { isOpen: true };
    let tentativas = 0;
    const rejeicoes = await capturarUnhandled(async () => {
      await executarPatched(...dependenciasExecucao({
        mutex: makeMutex(),
        ws,
        sendRetryRequest: async () => {
          tentativas += 1;
          ws.isOpen = false;
          throw boomConnectionClosed();
        },
        delay: async () => {}
      }));
    });
    assert.equal(tentativas, 1);
    assert.deepEqual(rejeicoes, []);
  }

  // Socket aberto preserva retry e delay exatamente uma vez.
  {
    let tentativas = 0;
    let delays = 0;
    await executarPatched(...dependenciasExecucao({
      mutex: makeMutex(),
      ws: { isOpen: true },
      sendRetryRequest: async () => { tentativas += 1; },
      delay: async (ms) => { assert.equal(ms, 25); delays += 1; }
    }));
    assert.equal(tentativas, 1);
    assert.equal(delays, 1);
  }

  // Socket já fechado não tenta retry, receipt ou delay.
  {
    let tentativas = 0;
    let delays = 0;
    await executarPatched(...dependenciasExecucao({
      mutex: makeMutex(),
      ws: { isOpen: false },
      sendRetryRequest: async () => { tentativas += 1; },
      delay: async () => { delays += 1; }
    }));
    assert.equal(tentativas, 0);
    assert.equal(delays, 0);
  }

  // Erros arbitrários continuam visíveis ao try/catch externo.
  {
    await assert.rejects(
      executarPatched(...dependenciasExecucao({
        mutex: makeMutex(),
        ws: { isOpen: true },
        sendRetryRequest: async () => { throw new Error("unexpected retry failure"); },
        delay: async () => {}
      })),
      /unexpected retry failure/
    );
  }

  // O mutex continua serializando retries da mesma sessão.
  {
    const mutex = makeMutex();
    let ativos = 0;
    let pico = 0;
    let tentativas = 0;
    const executar = () => executarPatched(...dependenciasExecucao({
      mutex,
      ws: { isOpen: true },
      sendRetryRequest: async () => {
        tentativas += 1;
        ativos += 1;
        pico = Math.max(pico, ativos);
        await new Promise((resolve) => setTimeout(resolve, 5));
        ativos -= 1;
      },
      delay: async () => {}
    }));
    await Promise.all([executar(), executar(), executar()]);
    assert.equal(tentativas, 3);
    assert.equal(pico, 1);
  }

  // Mutexes pertencem ao socket: duas sessões continuam independentes.
  {
    const sessaoA = { ws: { isOpen: true }, estado: "open", retries: 0 };
    const sessaoB = { ws: { isOpen: true }, estado: "open", retries: 0 };
    let ativos = 0;
    let picoGlobal = 0;
    const rodar = (sessao, mutex, falhar) => executarPatched(...dependenciasExecucao({
      mutex,
      ws: sessao.ws,
      sendRetryRequest: async () => {
        sessao.retries += 1;
        ativos += 1;
        picoGlobal = Math.max(picoGlobal, ativos);
        await new Promise((resolve) => setTimeout(resolve, 5));
        ativos -= 1;
        if (falhar) {
          sessao.ws.isOpen = false;
          sessao.estado = "reconnecting";
          throw boomConnectionClosed();
        }
      },
      delay: async () => {}
    }));

    await Promise.all([
      rodar(sessaoA, makeMutex(), true),
      rodar(sessaoB, makeMutex(), false)
    ]);
    assert.equal(picoGlobal, 2);
    assert.deepEqual(sessaoA, { ws: { isOpen: false }, estado: "reconnecting", retries: 1 });
    assert.deepEqual(sessaoB, { ws: { isOpen: true }, estado: "open", retries: 1 });

    sessaoA.ws.isOpen = true;
    sessaoA.estado = "open";
    await rodar(sessaoA, makeMutex(), false);
    assert.equal(sessaoA.estado, "open");
    assert.equal(sessaoA.retries, 2);
  }

  // Aplicação persistente é exata, idempotente e falha fechado.
  {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "baileys-retry-hotfix-"));
    try {
      const pacoteDir = path.join(temp, "node_modules", "@whiskeysockets", "baileys");
      const arquivo = path.join(temp, TARGET_RELATIVE);
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      fs.writeFileSync(
        path.join(pacoteDir, "package.json"),
        JSON.stringify({ version: BAILEYS_VERSION }),
        "utf8"
      );
      const originalCompleto = `prefixo\n${ORIGINAL_BLOCK}\nsufixo\n`;
      fs.writeFileSync(arquivo, originalCompleto, "utf8");
      const primeira = aplicarPatch({ rootDir: temp, log() {} });
      assert.equal(primeira.status, "applied");
      assert.equal(
        fs.readFileSync(arquivo, "utf8"),
        originalCompleto.replace(ORIGINAL_BLOCK, PATCHED_BLOCK)
      );
      const segunda = aplicarPatch({ rootDir: temp, log() {} });
      assert.equal(segunda.status, "already_applied");
      fs.writeFileSync(
        path.join(pacoteDir, "package.json"),
        JSON.stringify({ version: "6.7.24" }),
        "utf8"
      );
      assert.throws(() => aplicarPatch({ rootDir: temp, log() {} }), /Versão Baileys inesperada/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }

  // Sanity: centenas de retries sem listeners, handles ou heap crescentes de forma relevante.
  {
    const listenersAntes = process.listenerCount("unhandledRejection");
    const handlesAntes = process._getActiveHandles().length;
    const heapAntes = process.memoryUsage().heapUsed;
    const mutex = makeMutex();
    for (let i = 0; i < 500; i += 1) {
      await executarPatched(...dependenciasExecucao({
        mutex,
        ws: { isOpen: true },
        sendRetryRequest: async () => {},
        delay: async () => {}
      }));
    }
    await new Promise((resolve) => setImmediate(resolve));
    const heapDepois = process.memoryUsage().heapUsed;
    assert.equal(process.listenerCount("unhandledRejection"), listenersAntes);
    assert.ok(process._getActiveHandles().length <= handlesAntes + 1);
    assert.ok(heapDepois - heapAntes < 32 * 1024 * 1024);
  }

  console.log("Baileys retry hotfix: 12/12 PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
