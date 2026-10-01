"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { DEFAULT_CONNECTION_CONFIG } = require("@whiskeysockets/baileys");

const originalConsoleError = console.error;
const observabilidade = require("../modules/whatsapp/baileys-session-observability.service");

assert.strictEqual(console.error, originalConsoleError, "carregar modulo nao pode alterar console.error");

const {
  classificarErroSignal,
  criarContextoSocketBaileys,
  criarFabricaRepositorioSignalContextual,
  criarLoggerBaileysContextual,
  hashIdentificador,
  obterContextoSignalAtual,
  registrarTelemetriaCredsUpdate
} = observabilidade;

function criarLoggerMemoria(bindings = {}, destino = []) {
  const logger = { level: "info" };
  for (const nivel of ["trace", "debug", "info", "warn", "error"]) {
    logger[nivel] = (...args) => destino.push({ nivel, bindings: { ...bindings }, args });
  }
  logger.child = extras => criarLoggerMemoria({ ...bindings, ...(extras || {}) }, destino);
  logger.destino = destino;
  return logger;
}

function contexto(sessaoId, socketGeracao) {
  return criarContextoSocketBaileys({
    clienteId: `cliente_${sessaoId}`,
    workspaceId: `workspace_${sessaoId}`,
    sessaoId,
    sessaoIdNormalizado: `normalizada_${sessaoId}`,
    socketGeracao
  });
}

function deferred() {
  let resolver;
  const promise = new Promise(resolve => {
    resolver = resolve;
  });
  return { promise, resolver };
}

async function main() {
  assert.strictEqual(typeof DEFAULT_CONNECTION_CONFIG.logger?.child, "function");
  assert.strictEqual(typeof DEFAULT_CONNECTION_CONFIG.makeSignalRepository, "function");
  assert.strictEqual(console.error, originalConsoleError);

  assert.strictEqual(classificarErroSignal("Bad MAC"), "bad_mac");
  assert.strictEqual(classificarErroSignal("Invalid PreKey ID"), "invalid_prekey_id");
  assert.strictEqual(classificarErroSignal("No matching sessions found for message"), "no_matching_sessions");
  assert.strictEqual(
    classificarErroSignal("Key used already or never filled"),
    "key_used_already_or_never_filled"
  );
  assert.strictEqual(classificarErroSignal(Object.assign(new Error("No sessions"), {
    name: "SessionError"
  })), "session_error");
  assert.strictEqual(classificarErroSignal("erro comum"), "");

  const base = criarLoggerMemoria();
  const contextoA = contexto("sessao_A", 1);
  const contextoB = contexto("sessao_B", 7);
  const loggerA = criarLoggerBaileysContextual({ loggerBase: base, contexto: contextoA });
  const loggerB = criarLoggerBaileysContextual({ loggerBase: base, contexto: contextoB });

  loggerA.error({
    key: { id: "msg-A", remoteJid: "5511999999999@s.whatsapp.net" },
    err: Object.assign(new Error("Bad MAC"), { stack: "stack-token-secreto" }),
    creds: "creds-nao-serializar",
    keys: "keys-nao-serializar"
  }, "failed to decrypt message");
  loggerB.error({
    key: { id: "msg-B", remoteJid: "5511888888888@s.whatsapp.net" },
    err: new Error("Invalid PreKey ID")
  }, "failed to decrypt message");

  assert.strictEqual(base.destino[0].bindings.sessaoId, "sessao_A");
  assert.strictEqual(base.destino[0].bindings.socketGeracao, 1);
  assert.strictEqual(base.destino[1].bindings.sessaoId, "sessao_B");
  assert.strictEqual(base.destino[1].bindings.socketGeracao, 7);
  assert.strictEqual(base.destino[0].args[0].erroTipo, "bad_mac");
  assert.strictEqual(base.destino[1].args[0].erroTipo, "invalid_prekey_id");

  loggerA.info({
    msgAttrs: {
      id: "retry-A",
      from: "5511777777777@s.whatsapp.net",
      participant: "5511666666666@s.whatsapp.net",
      content: "nao_deve_aparecer",
      token: "token-nao-serializar",
      qr: "qr-nao-serializar"
    },
    retryCount: 2
  }, "sent retry receipt");

  const retry = base.destino[2];
  assert.strictEqual(retry.bindings.sessaoId, "sessao_A");
  assert.strictEqual(retry.args[0].evento, "baileys_retry_receipt");
  assert.strictEqual(retry.args[0].messageId, "retry-A");
  assert.strictEqual(retry.args[0].remoteJidHash, hashIdentificador("5511777777777@s.whatsapp.net"));
  assert.strictEqual(JSON.stringify(retry).includes("5511777777777"), false);

  const fabricaBAninhada = criarFabricaRepositorioSignalContextual({
    criarRepositorio: () => ({
      async decryptGroupMessage() {
        assert.strictEqual(obterContextoSignalAtual(), contextoB, "nested deve usar contexto interno B");
        assert.strictEqual(console.error, originalConsoleError);
        return "resultado-B";
      }
    }),
    contexto: contextoB,
    logger: loggerB
  });
  const repositorioB = fabricaBAninhada({});

  const fabricaAAninhada = criarFabricaRepositorioSignalContextual({
    criarRepositorio: () => ({
      async decryptMessage() {
        assert.strictEqual(obterContextoSignalAtual(), contextoA, "nested deve iniciar no contexto A");
        const resultadoInterno = await repositorioB.decryptGroupMessage({});
        assert.strictEqual(resultadoInterno, "resultado-B");
        assert.strictEqual(obterContextoSignalAtual(), contextoA, "nested deve restaurar contexto externo A");
        assert.strictEqual(console.error, originalConsoleError);
        return "resultado-A";
      }
    }),
    contexto: contextoA,
    logger: loggerA
  });

  assert.strictEqual(await fabricaAAninhada({}).decryptMessage({}), "resultado-A");
  assert.strictEqual(obterContextoSignalAtual(), undefined, "ALS deve estar vazio apos sucesso");
  assert.strictEqual(console.error, originalConsoleError, "sucesso nao pode alterar console.error");

  const liberarA = deferred();
  const liberarB = deferred();
  const observadosConcorrentes = [];
  const fabricaConcorrente = (ctx, logger, liberar) => criarFabricaRepositorioSignalContextual({
    criarRepositorio: () => ({
      async decryptMessage() {
        observadosConcorrentes.push([ctx.sessaoId, obterContextoSignalAtual()?.sessaoId, "antes"]);
        assert.strictEqual(console.error, originalConsoleError);
        await liberar.promise;
        observadosConcorrentes.push([ctx.sessaoId, obterContextoSignalAtual()?.sessaoId, "depois"]);
        assert.strictEqual(console.error, originalConsoleError);
        return ctx.sessaoId;
      }
    }),
    contexto: ctx,
    logger
  })({});

  const concorrenteA = fabricaConcorrente(contextoA, loggerA, liberarA).decryptMessage({});
  const concorrenteB = fabricaConcorrente(contextoB, loggerB, liberarB).decryptMessage({});
  assert.strictEqual(obterContextoSignalAtual(), undefined, "ALS externo deve continuar vazio durante concorrencia");
  assert.strictEqual(console.error, originalConsoleError);
  liberarB.resolver();
  liberarA.resolver();
  assert.deepStrictEqual(await Promise.all([concorrenteA, concorrenteB]), ["sessao_A", "sessao_B"]);
  assert.deepStrictEqual(observadosConcorrentes, [
    ["sessao_A", "sessao_A", "antes"],
    ["sessao_B", "sessao_B", "antes"],
    ["sessao_B", "sessao_B", "depois"],
    ["sessao_A", "sessao_A", "depois"]
  ]);
  assert.strictEqual(obterContextoSignalAtual(), undefined, "ALS deve estar vazio apos concorrencia");
  assert.strictEqual(console.error, originalConsoleError, "concorrencia nao pode alterar console.error");

  const erroOriginal = Object.assign(new Error("Bad MAC"), {
    cause: new Error("causa-secreta"),
    stack: "stack-secreto-imutavel"
  });
  const propriedadesErro = {
    message: erroOriginal.message,
    name: erroOriginal.name,
    stack: erroOriginal.stack,
    cause: erroOriginal.cause
  };
  const antesErroAlvo = base.destino.length;
  const fabricaComErro = criarFabricaRepositorioSignalContextual({
    criarRepositorio: () => ({
      async decryptMessage() {
        assert.strictEqual(obterContextoSignalAtual(), contextoA);
        assert.strictEqual(console.error, originalConsoleError, "erro nao pode alterar console.error");
        throw erroOriginal;
      }
    }),
    contexto: contextoA,
    logger: loggerA
  });

  let erroCapturado;
  try {
    await fabricaComErro({}).decryptMessage({});
  } catch (erro) {
    erroCapturado = erro;
  }
  assert.strictEqual(erroCapturado, erroOriginal, "wrapper deve relancar o mesmo objeto de erro");
  assert.strictEqual(erroCapturado.message, propriedadesErro.message);
  assert.strictEqual(erroCapturado.name, propriedadesErro.name);
  assert.strictEqual(erroCapturado.stack, propriedadesErro.stack);
  assert.strictEqual(erroCapturado.cause, propriedadesErro.cause);
  assert.strictEqual(obterContextoSignalAtual(), undefined, "ALS deve estar vazio apos excecao");
  assert.strictEqual(console.error, originalConsoleError, "excecao nao pode alterar console.error");

  const logsErroAlvo = base.destino.slice(antesErroAlvo)
    .filter(item => item.args[0]?.evento === "baileys_signal_error");
  assert.strictEqual(logsErroAlvo.length, 1);
  assert.strictEqual(logsErroAlvo[0].bindings.sessaoId, "sessao_A");
  assert.strictEqual(logsErroAlvo[0].bindings.socketGeracao, 1);
  assert.strictEqual(logsErroAlvo[0].args[0].erroTipo, "bad_mac");

  const antesErroComum = base.destino.length;
  const erroComum = new Error("falha comum fora da taxonomia");
  const fabricaErroComum = criarFabricaRepositorioSignalContextual({
    criarRepositorio: () => ({ decryptMessage: async () => { throw erroComum; } }),
    contexto: contextoB,
    logger: loggerB
  });
  await assert.rejects(() => fabricaErroComum({}).decryptMessage({}), erro => erro === erroComum);
  assert.strictEqual(base.destino.length, antesErroComum, "erro nao alvo nao deve gerar log adicional");
  assert.strictEqual(obterContextoSignalAtual(), undefined);
  assert.strictEqual(console.error, originalConsoleError);

  const erroComLoggerFalho = new Error("Invalid PreKey ID");
  const fabricaLoggerFalho = criarFabricaRepositorioSignalContextual({
    criarRepositorio: () => ({ decryptMessage: async () => { throw erroComLoggerFalho; } }),
    contexto: contextoA,
    logger: { error: () => { throw new Error("logger indisponivel"); } }
  });
  await assert.rejects(
    () => fabricaLoggerFalho({}).decryptMessage({}),
    erro => erro === erroComLoggerFalho
  );
  assert.strictEqual(obterContextoSignalAtual(), undefined);
  assert.strictEqual(console.error, originalConsoleError);

  const logsCreds = [];
  registrarTelemetriaCredsUpdate({
    contexto: contextoA,
    socketAtual: true,
    timestamp: "2026-10-01T18:00:00.000Z",
    logger: { log: (...args) => logsCreds.push(args) }
  });
  registrarTelemetriaCredsUpdate({
    contexto: contextoB,
    socketAtual: false,
    timestamp: "2026-10-01T18:00:01.000Z",
    logger: { log: (...args) => logsCreds.push(args) }
  });
  const credsAtual = JSON.parse(logsCreds[0][1]);
  const credsObsoleto = JSON.parse(logsCreds[1][1]);
  assert.deepStrictEqual(
    [credsAtual.sessaoId, credsAtual.socketGeracao, credsAtual.socketAtual],
    ["sessao_A", 1, true]
  );
  assert.deepStrictEqual(
    [credsObsoleto.sessaoId, credsObsoleto.socketGeracao, credsObsoleto.socketAtual],
    ["sessao_B", 7, false]
  );

  const serializado = JSON.stringify({ eventos: base.destino, logsCreds });
  for (const segredo of [
    "nao_deve_aparecer",
    "stack-token-secreto",
    "creds-nao-serializar",
    "keys-nao-serializar",
    "token-nao-serializar",
    "qr-nao-serializar",
    "stack-secreto-imutavel",
    "causa-secreta",
    "5511999999999@s.whatsapp.net",
    "5511888888888@s.whatsapp.net",
    "5511777777777@s.whatsapp.net",
    "5511666666666@s.whatsapp.net"
  ]) {
    assert.strictEqual(serializado.includes(segredo), false, `segredo/JID nao pode ser serializado: ${segredo}`);
  }

  const fonte = fs.readFileSync(
    path.join(__dirname, "../modules/whatsapp/baileys-session-observability.service.js"),
    "utf8"
  );
  assert.strictEqual(/console\.error\s*=/.test(fonte), false, "producao nao pode atribuir console.error");
  assert.strictEqual(/\b(?:readFile|stat|setTimeout|setInterval)\b/.test(fonte), false);

  const indexFonte = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  assert.strictEqual(indexFonte.includes("instalarCapturaConsoleSignal"), false);
  assert.ok(indexFonte.includes("logger: loggerBaileys"));
  assert.ok(indexFonte.includes("makeSignalRepository: criarFabricaRepositorioSignalContextual"));
  assert.ok(indexFonte.includes("socketAtual: socketEhAtual(sessoes, id, sock)"));

  const sessionCipherFonte = fs.readFileSync(require.resolve("libsignal/src/session_cipher.js"), "utf8");
  const cryptoSignalFonte = fs.readFileSync(require.resolve("libsignal/src/crypto.js"), "utf8");
  assert.ok(sessionCipherFonte.includes('console.error("Session error:" + e, e.stack)'));
  assert.ok(sessionCipherFonte.includes('throw new errors.SessionError("No matching sessions found for message")'));
  assert.ok(sessionCipherFonte.includes("throw new errors.MessageCounterError('Key used already or never filled')"));
  assert.ok(cryptoSignalFonte.includes('throw new Error("Bad MAC")'));

  assert.strictEqual(console.error, originalConsoleError, "teste completo deve preservar console.error");
  console.log("baileys-session-observability.test.js OK");
}

main().catch(erro => {
  assert.strictEqual(console.error, originalConsoleError);
  console.error(erro);
  process.exitCode = 1;
});
