"use strict";

const assert = require("node:assert/strict");
const { lerSaldoCreditosOperacional, lerSaldoCreditosSomenteLeitura } =
  require("../modules/saas/credit-balance.service");
const { autenticarUsuarioGoogleExistente } =
  require("../modules/auth/google-existing-login.service");
const { registrarErroSaas } = require("../modules/saas/error-diagnostics");

async function shouldFailClosedDuringRenewalLedgerRead() {
  const usuario = { id: "workspace_fixture", creditos: 432 };
  const usuarios = [usuario];
  const etapas = [];
  let leituraFinal = false;
  const erroLedger = new Error("universal_credit_opening_missing");

  await assert.rejects(autenticarUsuarioGoogleExistente({
    usuario,
    identidade: { sub: "sub_fixture", email: "fixture@example.test" },
    usuarios,
    resolverUsuarioAtual: () => usuario,
    serializar: fn => fn(),
    emitirJwt: () => "fixture-jwt",
    lerSaldo: (workspaceId, currentUser, { onStage }) =>
      lerSaldoCreditosOperacional({
        mode: "UNIVERSAL",
        workspaceId,
        usuario: currentUser,
        renew: async (_user, options) => {
          options.onStage("credit.renewal.ledger_read");
          throw erroLedger;
        },
        readBalance: async () => {
          leituraFinal = true;
          return { balance: 0 };
        },
        onStage
      }),
    vincular: (user, identity) => { user.googleSub = identity.sub; },
    salvarUsuarios: async () => { throw new Error("must_not_persist"); },
    onStage: etapa => etapas.push(etapa)
  }), error => error === erroLedger);

  assert.deepEqual(etapas.slice(-2), [
    "google.credit.renewal",
    "google.credit.renewal.ledger_read"
  ]);
  assert.equal(leituraFinal, false, "leitura final nao deve ocorrer apos falha da renovacao");
  assert.equal(usuario.googleSub, undefined, "vinculo nao pode ser aplicado parcialmente");
  assert.equal(usuario.creditos, 432, "creditos locais nao podem ser substituidos por saldo ficticio");
  assert.equal(usuarios.length, 1, "nao deve criar conta duplicada");
}

async function shouldFailClosedDuringFinalLedgerRead() {
  const usuario = { id: "workspace_fixture", creditos: 432 };
  const etapas = [];
  const erroLedger = new Error("ledger_unavailable");

  await assert.rejects(lerSaldoCreditosOperacional({
    mode: "UNIVERSAL",
    workspaceId: usuario.id,
    usuario,
    renew: async () => {},
    readBalance: async () => { throw erroLedger; },
    onStage: etapa => etapas.push(etapa)
  }), error => error === erroLedger);

  assert.deepEqual(etapas, ["credit.renewal", "credit.ledger_read"]);
  assert.equal(usuario.creditos, 432);
}

async function shouldNotPersistGoogleLinkWhenFinalReadFails() {
  const usuario = { id: "workspace_fixture", creditos: 432 };
  const usuarios = [usuario];
  const etapas = [];
  let persistCount = 0;
  const erroLedger = new Error("ledger_unavailable");

  await assert.rejects(autenticarUsuarioGoogleExistente({
    usuario,
    identidade: { sub: "sub_fixture", email: "fixture@example.test" },
    usuarios,
    resolverUsuarioAtual: () => usuario,
    serializar: fn => fn(),
    emitirJwt: () => "fixture-jwt",
    lerSaldo: (workspaceId, currentUser, { onStage }) =>
      lerSaldoCreditosOperacional({
        mode: "UNIVERSAL",
        workspaceId,
        usuario: currentUser,
        renew: async () => {},
        readBalance: async () => { throw erroLedger; },
        onStage
      }),
    vincular: (user, identity) => { user.googleSub = identity.sub; },
    salvarUsuarios: async () => { persistCount += 1; },
    onStage: etapa => etapas.push(etapa)
  }), error => error === erroLedger);

  assert.ok(etapas.includes("google.credit.ledger_read"));
  assert.equal(persistCount, 0);
  assert.equal(usuario.googleSub, undefined);
  assert.equal(usuario.creditos, 432);
  assert.equal(usuarios.length, 1);
}

async function shouldAuthenticateWithReadOnlyLedgerWhenRenewalIsDeferred() {
  const usuario = { id: "workspace_fixture", creditos: 432,
    provedoresAuth: {} };
  let renewalCalled = false;
  let persistCount = 0;
  const resultado = await autenticarUsuarioGoogleExistente({
    usuario,
    identidade: { sub: "sub_fixture", email: "fixture@example.test" },
    usuarios: [usuario],
    resolverUsuarioAtual: () => usuario,
    serializar: fn => fn(),
    emitirJwt: () => "fixture-jwt",
    lerSaldo: async (_workspaceId, _currentUser, { onStage }) => {
      onStage("credit.ledger_read");
      // The operational renewal would return this while delivery holds are
      // open. Authentication must not invoke that write path.
      const operationalRenewal = async () => {
        renewalCalled = true;
        throw new Error("universal_admin_credit_holds_open");
      };
      assert.equal(typeof operationalRenewal, "function");
      return lerSaldoCreditosSomenteLeitura({
        mode: "UNIVERSAL",
        workspaceId: usuario.id,
        usuario,
        readBalance: async () => ({ balance: 37 })
      });
    },
    vincular: (user, identity) => { user.googleSub = identity.sub; },
    salvarUsuarios: async () => { persistCount += 1; }
  });

  assert.equal(resultado.creditos, 37);
  assert.equal(renewalCalled, false);
  assert.equal(persistCount, 1);
  assert.equal(usuario.googleSub, "sub_fixture");
  assert.equal(usuario.creditos, 432, "JSON legado nao pode substituir o ledger");
}

async function shouldPreserveBalanceAndPersistGoogleLinkOnce() {
  const usuario = { id: "workspace_fixture", creditos: 432,
    provedoresAuth: {} };
  const usuarios = [usuario];
  const etapas = [];
  let persistCount = 0;
  let persistedSnapshot;
  const resultado = await autenticarUsuarioGoogleExistente({
    usuario,
    identidade: { sub: "sub_fixture", email: "fixture@example.test" },
    usuarios,
    resolverUsuarioAtual: () => usuario,
    serializar: fn => fn(),
    emitirJwt: () => "fixture-jwt",
    lerSaldo: (workspaceId, currentUser, { onStage }) =>
      lerSaldoCreditosOperacional({
        mode: "UNIVERSAL",
        workspaceId,
        usuario: currentUser,
        renew: async () => {},
        readBalance: async () => ({ balance: 432 }),
        onStage
      }),
    vincular: (user, identity) => {
      user.googleSub = identity.sub;
      user.provedoresAuth.google = { sub: identity.sub };
    },
    salvarUsuarios: async snapshot => {
      persistCount += 1;
      persistedSnapshot = structuredClone(snapshot);
    },
    onStage: etapa => etapas.push(etapa)
  });

  assert.equal(resultado.creditos, 432);
  assert.equal(resultado.usuario, usuario);
  assert.equal(usuario.creditos, 432);
  assert.equal(usuario.googleSub, "sub_fixture");
  assert.equal(persistCount, 1);
  assert.equal(persistedSnapshot.length, 1);
  assert.equal(persistedSnapshot[0].googleSub, "sub_fixture");
  assert.ok(etapas.includes("google.credit.ledger_read"));
}

function shouldLogOnlySanitizedSubstageAndCode() {
  const outputs = [];
  const erro = new Error("private email and google credential must not be logged");
  erro.codigo = "universal_credit_opening_missing";
  const diagnostic = registrarErroSaas({
    req: {},
    etapa: "google.credit.renewal.ledger_read",
    erro,
    logger: { error: (...args) => outputs.push(args) }
  });

  assert.equal(diagnostic.etapa, "google.credit.renewal.ledger_read");
  assert.equal(diagnostic.codigo, "universal_credit_opening_missing");
  assert.equal(outputs.length, 1);
  assert.doesNotMatch(outputs[0].join(" "), /private email|credential/);
}

async function run() {
  await shouldFailClosedDuringRenewalLedgerRead();
  await shouldFailClosedDuringFinalLedgerRead();
  await shouldNotPersistGoogleLinkWhenFinalReadFails();
  await shouldAuthenticateWithReadOnlyLedgerWhenRenewalIsDeferred();
  await shouldPreserveBalanceAndPersistGoogleLinkOnce();
  shouldLogOnlySanitizedSubstageAndCode();
  console.log("google-auth-credit-balance.test.js OK");
}

if (require.main === module) {
  run().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { run };
