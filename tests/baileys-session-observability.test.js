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

  const peerA = "5511111111111:18@lid";
  const peerB = "5522222222222@s.whatsapp.net";
  const grupo = "120363000000000000@g.us";
  const autor = "5533333333333:2@lid";
  const newsletter = "120363444444444444@newsletter";
  const ciphertext = Buffer.from("ciphertext-secreto");
  const liberarFalhaA = deferred();
  const liberarFalhaB = deferred();
  const erroPeerA = new Error("Bad MAC");
  const erroPeerB = new Error("Invalid PreKey ID");
  const argsPeerA = { jid: peerA, type: "msg", ciphertext };
  const argsPeerB = { jid: peerB, type: "pkmsg", ciphertext };
  const antesAtribuicao = base.destino.length;
  const repoFalho = (ctx, logger, esperado, liberar, erro) => criarFabricaRepositorioSignalContextual({
    criarRepositorio: () => ({
      async decryptMessage(argumento) {
        assert.strictEqual(argumento, esperado, "argumentos do decrypt devem ser identicos");
        assert.strictEqual(obterContextoSignalAtual(), ctx);
        await liberar.promise;
        throw erro;
      }
    }),
    contexto: ctx,
    logger
  })({});
  const falhaA = repoFalho(contextoA, loggerA, argsPeerA, liberarFalhaA, erroPeerA)
    .decryptMessage(argsPeerA);
  const falhaB = repoFalho(contextoB, loggerB, argsPeerB, liberarFalhaB, erroPeerB)
    .decryptMessage(argsPeerB);
  liberarFalhaB.resolver();
  liberarFalhaA.resolver();
  const falhas = await Promise.allSettled([falhaA, falhaB]);
  assert.strictEqual(falhas[0].reason, erroPeerA);
  assert.strictEqual(falhas[1].reason, erroPeerB);

  const eventosConcorrentes = base.destino.slice(antesAtribuicao)
    .filter(item => item.args[0]?.evento === "baileys_signal_error");
  assert.strictEqual(eventosConcorrentes.length, 2);
  assert.deepStrictEqual(eventosConcorrentes.map(item => [
    item.bindings.sessaoId,
    item.bindings.socketGeracao,
    item.args[0].peerHash,
    item.args[0].signalAddressHash,
    item.args[0].peerType,
    item.args[0].deviceId,
    item.args[0].decryptKind,
    item.args[0].messageType
  ]), [
    ["sessao_B", 7, hashIdentificador(peerB), hashIdentificador("5522222222222.0"),
      "s.whatsapp.net", 0, "direct", "pkmsg"],
    ["sessao_A", 1, hashIdentificador(peerA), hashIdentificador("5511111111111.18"),
      "lid", 18, "direct", "msg"]
  ]);

  const testarFalha = async (nome, argumento, erro) => {
    const antes = base.destino.length;
    const repo = criarFabricaRepositorioSignalContextual({
      criarRepositorio: () => ({
        [nome]: async recebido => {
          assert.strictEqual(recebido, argumento);
          throw erro;
        }
      }),
      contexto: contextoA,
      logger: loggerA
    })({});
    await assert.rejects(() => repo[nome](argumento), capturado => capturado === erro);
    return base.destino.slice(antes).find(item => item.args[0]?.evento === "baileys_signal_error")?.args[0];
  };
  const mesmoPeerOutroDevice = await testarFalha("decryptMessage", {
    jid: "5511111111111@lid", type: "msg", ciphertext
  }, new Error("Bad MAC"));
  assert.strictEqual(mesmoPeerOutroDevice.peerHash, hashIdentificador("5511111111111@lid"));
  assert.strictEqual(mesmoPeerOutroDevice.deviceId, 0);
  assert.strictEqual(mesmoPeerOutroDevice.signalAddressHash, hashIdentificador("5511111111111.0"));
  assert.notStrictEqual(mesmoPeerOutroDevice.signalAddressHash, eventosConcorrentes[1].args[0].signalAddressHash);

  const liberarDevice0 = deferred();
  const liberarDevice18 = deferred();
  const antesDevices = base.destino.length;
  const repoDevices = criarFabricaRepositorioSignalContextual({
    criarRepositorio: () => ({
      async decryptMessage(argumento) {
        if (argumento.jid === peerA) await liberarDevice18.promise;
        else await liberarDevice0.promise;
        throw new Error("Bad MAC");
      }
    }),
    contexto: contextoA,
    logger: loggerA
  })({});
  const device0 = repoDevices.decryptMessage({ jid: "5511111111111@lid", type: "msg", ciphertext });
  const device18 = repoDevices.decryptMessage({ jid: peerA, type: "msg", ciphertext });
  liberarDevice18.resolver();
  liberarDevice0.resolver();
  const resultadosDevices = await Promise.allSettled([device0, device18]);
  assert.ok(resultadosDevices.every(item => item.status === "rejected"));
  const eventosDevices = base.destino.slice(antesDevices)
    .filter(item => item.args[0]?.evento === "baileys_signal_error")
    .map(item => item.args[0]);
  assert.deepStrictEqual(eventosDevices.map(item => [item.deviceId, item.signalAddressHash])
    .sort((a, b) => a[0] - b[0]), [
    [0, hashIdentificador("5511111111111.0")],
    [18, hashIdentificador("5511111111111.18")]
  ]);

  const grupoFalho = await testarFalha("decryptGroupMessage", {
    group: grupo, authorJid: autor, msg: ciphertext
  }, new Error("Bad MAC"));
  assert.strictEqual(grupoFalho.peerHash, hashIdentificador(autor));
  assert.strictEqual(grupoFalho.groupHash, hashIdentificador(grupo));
  assert.strictEqual(grupoFalho.peerType, "lid");
  assert.strictEqual(grupoFalho.deviceId, 2);
  assert.strictEqual(grupoFalho.decryptKind, "group");
  assert.strictEqual(grupoFalho.messageType, "skmsg");
  assert.strictEqual(grupoFalho.signalAddressHash, undefined);

  const newsletterFalho = await testarFalha("decryptMessage", {
    jid: newsletter, type: "pkmsg", ciphertext
  }, new Error("No matching sessions found for message"));
  assert.strictEqual(newsletterFalho.peerHash, hashIdentificador(newsletter));
  assert.strictEqual(newsletterFalho.peerType, "newsletter");
  assert.strictEqual(newsletterFalho.signalAddressHash, hashIdentificador("120363444444444444.0"));
  assert.strictEqual(newsletterFalho.messageType, "pkmsg");

  const nomeErroPrivado = new Error("Bad MAC");
  nomeErroPrivado.name = `erro-${peerA}`;
  const eventoNomePrivado = await testarFalha("decryptMessage", {
    jid: peerA, type: "msg", ciphertext
  }, nomeErroPrivado);
  assert.strictEqual(eventoNomePrivado.erroNome, "Error");
  assert.strictEqual(nomeErroPrivado.name, `erro-${peerA}`);

  const antesSucesso = base.destino.length;
  const resultadoSucesso = Buffer.from("resultado-secreto");
  const argumentosSucesso = { jid: peerA, type: "msg", ciphertext };
  const repoSucesso = criarFabricaRepositorioSignalContextual({
    criarRepositorio: () => ({ decryptMessage: async argumento => {
      assert.strictEqual(argumento, argumentosSucesso);
      return resultadoSucesso;
    } }),
    contexto: contextoA,
    logger: loggerA
  })({});
  assert.strictEqual(await repoSucesso.decryptMessage(argumentosSucesso), resultadoSucesso);
  assert.strictEqual(base.destino.length, antesSucesso, "sucesso nao gera signal_error");

  const antesErroComum = base.destino.length;
  const erroComum = new Error("falha comum fora da taxonomia");
  let leiturasJidErroComum = 0;
  const argumentoErroComum = {
    get jid() {
      leiturasJidErroComum += 1;
      return peerB;
    },
    type: "msg",
    ciphertext
  };
  const fabricaErroComum = criarFabricaRepositorioSignalContextual({
    criarRepositorio: () => ({ decryptMessage: async () => { throw erroComum; } }),
    contexto: contextoB,
    logger: loggerB
  });
  await assert.rejects(
    () => fabricaErroComum({}).decryptMessage(argumentoErroComum),
    erro => erro === erroComum
  );
  assert.strictEqual(base.destino.length, antesErroComum, "erro nao alvo nao deve gerar log adicional");
  assert.strictEqual(leiturasJidErroComum, 0, "erro nao alvo nao deve examinar JID");
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
    "5511666666666@s.whatsapp.net",
    peerA,
    peerB,
    grupo,
    autor,
    newsletter,
    "ciphertext-secreto",
    "resultado-secreto"
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
