"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "index.js"), "utf8");
const baselineSha = "1eaf582b68c333773a5882bcb8962ffcac7b9bef";
const publishedSource = execFileSync("git", ["show", `${baselineSha}:index.js`], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024
});
const { lerSaldoCreditosSomenteLeitura, lerSaldoCreditosOperacional } =
  require("../modules/saas/credit-balance.service");
const { listarUsuariosAdminSomenteLeitura } =
  require("../modules/saas/admin-users-read-model");
const { autenticarUsuarioGoogleExistente } =
  require("../modules/auth/google-existing-login.service");
const { registrarErroSaas } = require("../modules/saas/error-diagnostics");
const saasFundacao = require("../utils/saas-fundacao");

function carregarFuncao(inicio, fim, sandbox) {
  const start = source.indexOf(inicio);
  assert.notEqual(start, -1, `função não encontrada: ${inicio}`);
  const end = source.indexOf(fim, start + inicio.length);
  assert.ok(end > start, `fim da função não encontrado: ${fim}`);
  return vm.runInNewContext(`(${source.slice(start, end)})`, {
    structuredClone,
    ...sandbox
  });
}

function carregarFuncaoDe(codigo, inicio, fim, sandbox) {
  const start = codigo.indexOf(inicio);
  assert.notEqual(start, -1, `função não encontrada: ${inicio}`);
  const end = codigo.indexOf(fim, start + inicio.length);
  assert.ok(end > start, `fim da função não encontrado: ${fim}`);
  return vm.runInNewContext(`(${codigo.slice(start, end)})`, {
    structuredClone,
    ...sandbox
  });
}

function carregarHandlerRota(codigo, inicio, fim, metodo, sandbox) {
  const start = codigo.indexOf(inicio);
  assert.notEqual(start, -1, `rota não encontrada: ${inicio}`);
  const end = codigo.indexOf(fim, start + inicio.length);
  assert.ok(end > start, `fim da rota não encontrado: ${fim}`);
  let handler;
  vm.runInNewContext(codigo.slice(start, end), {
    ...sandbox,
    app: {
      [metodo](...args) { handler = args[args.length - 1]; }
    }
  });
  assert.equal(typeof handler, "function", `handler não capturado: ${inicio}`);
  return handler;
}

function criarResponseFake() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function fixtureUsuarios() {
  return [
    { id: "admin", papel: "admin_master", ativo: true },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `user_${index + 1}`,
      papel: "cliente",
      email: `cliente${index + 1}@fixture.invalid`,
      ativo: true,
      creditos: 100 + index,
      cicloAtualInicio: "2026-10-01T00:00:00.000Z",
      cicloAtualFim: "2026-10-31T00:00:00.000Z",
      proximaRenovacao: "2026-10-31T00:00:00.000Z"
    }))
  ];
}

function criarResolverGoogle(usuarios) {
  return carregarFuncao(
    "function resolverUsuarioGoogleExistente(identidade = {})",
    "async function autenticarGoogleOptimus",
    {
      encontrarUsuarioPorGoogleSub: sub => usuarios.find(usuario =>
        usuario.googleSub === sub || usuario.provedoresAuth?.google?.sub === sub
      ) || null,
      obterUsuarioPorEmailNormalizado: email => usuarios.find(usuario =>
        String(usuario.email || "").trim().toLowerCase() === String(email || "").trim().toLowerCase()
      ) || null
    }
  );
}

function criarAuthGoogle({ usuarios, falhaSaldo, falhaJwt, falhaPersistencia, logs = [] }) {
  const resolverUsuarioGoogleExistente = criarResolverGoogle(usuarios);
  let tentativasCadastroPublico = 0;
  let leiturasSaldo = 0;
  let gravacoesUsuarios = 0;
  let usuariosPersistidos = structuredClone(usuarios);
  const identidade = {
    sub: "sub-google-fixture",
    email: "cliente1@fixture.invalid",
    emailVerificado: true,
    nome: "Cliente Fixture"
  };
  const lerSaldoGoogleFixture = async () => {
    leiturasSaldo++;
    if (falhaSaldo) throw falhaSaldo;
    return usuarios[1].creditos;
  };
  const funcao = carregarFuncao(
    "async function autenticarGoogleOptimus(idToken = \"\", body = {}, contexto = {})",
    "app.post(\"/auth/google\"",
    {
      console: { log: (...args) => logs.push(args.join(" ")) },
      validarGoogleIdToken: async idToken => {
        assert.equal(idToken, "token-sintetico-nao-registravel");
        return identidade;
      },
      resolverUsuarioGoogleExistente,
      executarCadastroSaasSerializado: fn => fn(),
      executarCadastroGooglePublicoAtomico: async () => {
        tentativasCadastroPublico++;
        throw new Error("cadastro público está desativado");
      },
      autenticarUsuarioGoogleExistente,
      usuarios,
      emitirJwtOptimusUsuario: () => {
        if (falhaJwt) throw new TypeError("jwt_secret_internal_only");
        return "jwt-sintetico";
      },
      saldoCreditosParaExibicao: lerSaldoGoogleFixture,
      saldoCreditosGoogleSomenteLeitura: lerSaldoGoogleFixture,
      vincularGoogleUsuario: (usuario, id) => {
        usuario.googleSub = usuario.googleSub || id.sub;
        usuario.googleEmail = id.email;
        usuario.provedoresAuth = usuario.provedoresAuth || {};
        usuario.provedoresAuth.google = {
          sub: id.sub,
          email: id.email,
          emailVerificado: id.emailVerificado
        };
      },
      salvarUsuarios: next => {
        gravacoesUsuarios++;
        if (falhaPersistencia) throw new Error("persistencia interna falhou");
        usuariosPersistidos = structuredClone(next);
      },
      salvarUsuariosSnapshot: next => {
        gravacoesUsuarios++;
        if (falhaPersistencia) throw new Error("persistencia interna falhou");
        usuariosPersistidos = structuredClone(next);
      },
      payloadLoginUsuario: async (usuario, token, creditos) => ({
        ok: true,
        token,
        usuario: { id: usuario.id, creditos }
      })
    }
  );
  const context = { requestId: "00000000-0000-4000-8000-000000000001" };
  return {
    run: () => funcao("token-sintetico-nao-registravel", {}, context),
    context,
    get tentativasCadastroPublico() { return tentativasCadastroPublico; },
    get leiturasSaldo() { return leiturasSaldo; },
    get gravacoesUsuarios() { return gravacoesUsuarios; },
    get usuariosPersistidos() { return usuariosPersistidos; },
    logs
  };
}

test("saldo Universal read-only não renova nem altera o usuário", async () => {
  const usuario = { id: "workspace-a", creditos: 19, cicloAtualFim: "antes" };
  let renewCalls = 0;
  let readCalls = 0;
  const balance = await lerSaldoCreditosSomenteLeitura({
    mode: "UNIVERSAL",
    workspaceId: usuario.id,
    usuario,
    readBalance: async ({ workspaceId }) => {
      readCalls++;
      assert.equal(workspaceId, usuario.id);
      return { balance: 71 };
    },
    renew: async () => { renewCalls++; }
  });
  assert.equal(balance, 71);
  assert.equal(readCalls, 1);
  assert.equal(renewCalls, 0);
  assert.deepEqual(usuario, { id: "workspace-a", creditos: 19, cicloAtualFim: "antes" });
});

test("reproduz na baseline 1eaf a falha compartilhada e o vínculo parcial Google", async () => {
  const erroSaldo = Object.assign(new Error("injected universal balance read failure"), {
    code: "universal_credit_opening_missing"
  });
  const usuario = { id: "user_existente", email: "cliente@fixture.invalid", ativo: true };
  const usuarios = [usuario];
  let persistido = structuredClone(usuarios);
  const authOriginal = carregarFuncaoDe(
    publishedSource,
    "async function autenticarGoogleOptimus(idToken = \"\", body = {})",
    'app.post("/auth/google"',
    {
      validarGoogleIdToken: async () => ({
        sub: "sub-sintetico",
        email: usuario.email,
        emailVerificado: true
      }),
      resolverUsuarioGoogleExistente: () => usuario,
      executarCadastroGooglePublicoAtomico: async () => {
        throw new Error("não deveria registrar conta existente");
      },
      vincularGoogleUsuario: (alvo, identidade) => { alvo.googleSub = identidade.sub; },
      salvarUsuarios: () => { persistido = structuredClone(usuarios); },
      normalizarEmailAuth: email => String(email).toLowerCase(),
      emitirJwtOptimusUsuario: () => "jwt-sintetico",
      payloadLoginUsuario: async () => { throw erroSaldo; },
      console: { log: () => {} }
    }
  );

  await assert.rejects(authOriginal("token-sintetico"), error => error === erroSaldo);
  assert.equal(persistido[0].googleSub, "sub-sintetico",
    "a baseline salva vínculo antes da leitura de saldo que falha");

  const inicioRota = publishedSource.indexOf('app.get("/admin/usuarios"');
  const fimRota = publishedSource.indexOf('app.get("/admin/planos"', inicioRota);
  assert.ok(inicioRota >= 0 && fimRota > inicioRota);
  const rotaSource = publishedSource.slice(inicioRota, fimRota);
  let handler;
  vm.runInNewContext(rotaSource, {
    app: { get: (_path, _middleware, callback) => { handler = callback; } },
    exigirAdminMasterEstrito: (_req, _res, next) => next?.(),
    isAdminMaster: () => true,
    usuarios,
    usuarioAdminComSaldoOperacional: async () => { throw erroSaldo; },
    Promise
  });
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler({}, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.codigo, "saldo_operacional_indisponivel");

  const trechoSaldo = publishedSource.slice(
    publishedSource.indexOf("async function saldoCreditosParaExibicao"),
    publishedSource.indexOf("async function reservarCreditoEnvioManualV2")
  );
  const trechoAdmin = publishedSource.slice(
    publishedSource.indexOf("async function usuarioAdminComSaldoOperacional"),
    publishedSource.indexOf("async function executarCadastroPublicoAtomico")
  );
  const trechoPayloadGoogle = publishedSource.slice(
    publishedSource.indexOf("async function payloadLoginUsuario"),
    publishedSource.indexOf("function resolverFinanceiroUsuarioMe")
  );
  assert.ok(trechoSaldo.includes("renovarCreditosUniversalSeNecessario"));
  assert.ok(trechoSaldo.includes("lerSaldoUniversal"));
  assert.ok(trechoAdmin.includes("saldoCreditosParaExibicao"));
  assert.ok(trechoPayloadGoogle.includes("saldoCreditosParaExibicao"));
});

test("renovação permanece explícita no caminho operacional", async () => {
  const ordem = [];
  const usuario = { id: "workspace-b" };
  const balance = await lerSaldoCreditosOperacional({
    mode: "UNIVERSAL",
    workspaceId: usuario.id,
    usuario,
    renew: async user => { ordem.push(`renew:${user.id}`); },
    readBalance: async ({ workspaceId }) => {
      ordem.push(`read:${workspaceId}`);
      return { balance: 200 };
    }
  });
  assert.equal(balance, 200);
  assert.deepEqual(ordem, ["renew:workspace-b", "read:workspace-b"]);
});

test("Admin Master retorna os nove usuários sem renovar ou escrever", async () => {
  const usuarios = fixtureUsuarios();
  const antes = structuredClone(usuarios);
  const lidos = [];
  const resposta = await listarUsuariosAdminSomenteLeitura({
    usuarios,
    mode: "UNIVERSAL",
    sanitizar: usuario => ({ id: usuario.id, papel: usuario.papel }),
    lerSaldo: async (workspaceId) => {
      lidos.push(workspaceId);
      return 300 + Number(workspaceId.split("_")[1]);
    }
  });
  assert.equal(resposta.length, 9);
  assert.equal(resposta[0].creditos, null);
  assert.deepEqual(lidos, usuarios.slice(1).map(usuario => usuario.id));
  assert.deepEqual(usuarios, antes, "a listagem não pode mutar cadastro ou ciclo");
});

test("falha de saldo individual não vira lista vazia nem saldo zero", async () => {
  const usuarios = fixtureUsuarios();
  const erroOriginal = Object.assign(new Error("saldo indisponível"), {
    code: "universal_credit_opening_missing"
  });
  await assert.rejects(
    listarUsuariosAdminSomenteLeitura({
      usuarios,
      mode: "UNIVERSAL",
      sanitizar: usuario => ({ id: usuario.id }),
      lerSaldo: async workspaceId => {
        if (workspaceId === "user_3") throw erroOriginal;
        return 1;
      }
    }),
    error => error === erroOriginal
  );
});

test("login de conta existente ignora cadastro público desativado e preserva créditos/ciclo", async () => {
  const usuarios = fixtureUsuarios();
  const antes = structuredClone(usuarios[1]);
  const fluxo = criarAuthGoogle({ usuarios });
  const resposta = await fluxo.run();
  assert.deepEqual(resposta, {
    ok: true,
    token: "jwt-sintetico",
    usuario: { id: "user_1", creditos: usuarios[1].creditos }
  });
  assert.equal(fluxo.tentativasCadastroPublico, 0);
  assert.equal(fluxo.gravacoesUsuarios, 1);
  assert.equal(fluxo.usuariosPersistidos[1].googleSub, "sub-google-fixture");
  assert.equal(usuarios[1].googleSub, "sub-google-fixture");
  assert.ok(!fluxo.logs.join("\n").includes("token-sintetico-nao-registravel"));
  assert.ok(!fluxo.logs.join("\n").includes("cliente1@fixture.invalid"));
  assert.ok(!fluxo.logs.join("\n").includes("jwt-sintetico"));
  for (const campo of ["creditos", "cicloAtualInicio", "cicloAtualFim", "proximaRenovacao"]) {
    assert.equal(usuarios[1][campo], antes[campo], `${campo} deve ser preservado`);
  }
});

test("novo cadastro Google usa JWT pré-emitido e saldo retornado sem regravar vínculo", async () => {
  const usuario = { id: "user_novo", nome: "Novo", email: "novo@fixture.invalid",
    papel: "cliente", plano: "Beta Fixture", ativo: true };
  let jwtChamadas = 0;
  let saldoChamadas = 0;
  let cadastros = 0;
  const funcao = carregarFuncao(
    "async function autenticarGoogleOptimus(idToken = \"\", body = {}, contexto = {})",
    'app.post("/auth/google"',
    {
      validarGoogleIdToken: async () => ({
        sub: "sub-novo",
        email: usuario.email,
        emailVerificado: true
      }),
      resolverUsuarioGoogleExistente: () => null,
      executarCadastroGooglePublicoAtomico: async () => {
        cadastros++;
        return { usuario, criado: true, token: "jwt-pré-emitido" };
      },
      emitirJwtOptimusUsuario: () => { jwtChamadas++; throw new Error("JWT duplicado"); },
      saldoCreditosParaExibicao: async id => {
        saldoChamadas++;
        assert.equal(id, usuario.id);
        return 321;
      },
      payloadLoginUsuario: async (alvo, token, creditos) => ({
        ok: true, token, usuario: { id: alvo.id, creditos }
      })
    }
  );
  const contexto = {};
  const resposta = await funcao("token-sintético", {}, contexto);
  assert.deepEqual(resposta, {
    ok: true,
    token: "jwt-pré-emitido",
    usuario: { id: "user_novo", creditos: 321 }
  });
  assert.equal(jwtChamadas, 0);
  assert.equal(saldoChamadas, 1);
  assert.equal(cadastros, 1);
  assert.equal(contexto.etapa, "google.balance_read");
});

test("falha de JWT no novo cadastro Google ocorre antes de persistir usuário ou vínculo", async () => {
  const usuarios = [];
  let persistencias = 0;
  const cadastro = carregarFuncao(
    "async function executarCadastroGooglePublicoAtomico(identidade = {}, body = {}, contexto = {})",
    "async function executarCadastroInternoAdminAtomico",
    {
      executarCadastroSaasSerializado: fn => fn(),
      resolverUsuarioGoogleExistente: () => null,
      obterConfigSaasAtual: () => ({ cadastroPublicoAtivo: true }),
      saasFundacao: {
        validarCadastro: () => ({ ok: true, plano: { nome: "Beta Fixture" } }),
        executarCadastroAtomico: async () => {
          persistencias++;
          usuarios.push({ id: "novo_google", googleSub: "sub-novo" });
          return usuarios[0];
        }
      },
      planos: { beta: {} },
      usuarios,
      configsPorCliente: {},
      gerarId: () => "novo_google",
      emitirJwtOptimusUsuario: () => { throw new TypeError("fixture jwt failure"); },
      aplicarArquiteturaComercialRioOficial: config => config,
      salvarUsuarios: () => {},
      salvarConfigsClientes: () => {},
      transicaoCadastroCreditosUniversal: () => ({})
    }
  );
  await assert.rejects(cadastro({
    sub: "sub-novo",
    email: "novo@fixture.invalid",
    nome: "Novo"
  }), /fixture jwt failure/);
  assert.equal(persistencias, 0);
  assert.equal(usuarios.length, 0);
});

test("falha posterior de saldo não persiste vínculo Google", async () => {
  const usuarios = fixtureUsuarios();
  const erroOriginal = Object.assign(new Error("balance database unavailable"), {
    code: "08006"
  });
  const fluxo = criarAuthGoogle({ usuarios, falhaSaldo: erroOriginal });
  await assert.rejects(fluxo.run(), error => error === erroOriginal);
  assert.equal(fluxo.gravacoesUsuarios, 0);
  assert.equal(usuarios[1].googleSub, undefined);
  assert.equal(fluxo.usuariosPersistidos[1].googleSub, undefined);
});

test("falha ao emitir JWT não consulta saldo nem persiste vínculo", async () => {
  const usuarios = fixtureUsuarios();
  const fluxo = criarAuthGoogle({ usuarios, falhaJwt: true });
  await assert.rejects(fluxo.run(), error => error instanceof TypeError);
  assert.equal(fluxo.leiturasSaldo, 0);
  assert.equal(fluxo.gravacoesUsuarios, 0);
  assert.equal(usuarios[1].googleSub, undefined);
});

test("falha de persistência deixa vínculo ausente na memória e no snapshot", async () => {
  const usuarios = fixtureUsuarios();
  const fluxo = criarAuthGoogle({ usuarios, falhaPersistencia: true });
  await assert.rejects(fluxo.run(), /persistencia interna falhou/);
  assert.equal(fluxo.gravacoesUsuarios, 1);
  assert.equal(usuarios[1].googleSub, undefined);
  assert.equal(fluxo.usuariosPersistidos[1].googleSub, undefined);
});

test("guardas de conta inativa e conflito de sub continuam anteriores à associação", async () => {
  const usuarios = fixtureUsuarios();
  const resolver = criarResolverGoogle(usuarios);
  usuarios[1].ativo = false;
  assert.throws(() => resolver({
    sub: "novo-sub",
    email: usuarios[1].email
  }), error => error.codigo === "usuario_inativo" && error.statusCode === 403);

  usuarios[1].ativo = true;
  usuarios[1].googleSub = "sub-legitimo";
  assert.throws(() => resolver({
    sub: "sub-diferente",
    email: usuarios[1].email
  }), error => error.codigo === "google_sub_divergente" && error.statusCode === 409);

  usuarios[1].googleSub = "";
  usuarios[1].provedoresAuth = { google: { sub: "sub-legitimo-aninhado" } };
  assert.throws(() => resolver({
    sub: "sub-diferente-aninhado",
    email: usuarios[1].email
  }), error => error.codigo === "google_sub_divergente" && error.statusCode === 409);
  usuarios[1].provedoresAuth = {};
  usuarios[2].googleSub = "sub-colidido";
  assert.throws(() => resolver({
    sub: "sub-colidido",
    email: usuarios[1].email
  }), error => error.codigo === "google_sub_conflitante" && error.statusCode === 409);
});

test("associação Google concorrente revalida sub sob o lock SaaS", async () => {
  const usuarios = fixtureUsuarios();
  const usuario = usuarios[1];
  const resolver = criarResolverGoogle(usuarios);
  const serializar = saasFundacao.criarSerializadorCadastro("google_fixture");
  let persistencias = 0;
  const deps = identidade => ({
    usuario,
    identidade,
    usuarios,
    resolverUsuarioAtual: resolver,
    serializar,
    emitirJwt: () => "jwt-sintetico",
    lerSaldo: async () => usuario.creditos,
    vincular: (alvo, id) => { alvo.googleSub = id.sub; },
    salvarUsuarios: async next => { persistencias++; assert.equal(next[1].googleSub, "sub-primeiro"); }
  });
  await autenticarUsuarioGoogleExistente(deps({
    sub: "sub-primeiro",
    email: usuario.email,
    emailVerificado: true
  }));
  await assert.rejects(
    autenticarUsuarioGoogleExistente(deps({
      sub: "sub-segundo",
      email: usuario.email,
      emailVerificado: true
    })),
    error => error.codigo === "google_sub_divergente" && error.statusCode === 409
  );
  assert.equal(persistencias, 1);
  assert.equal(usuario.googleSub, "sub-primeiro");
});

test("falha de Google tem requestId, etapa, código e classe sem token ou PII", () => {
  const capturado = [];
  const tokenSintetico = "token-sintetico-nao-registravel";
  const erro = Object.assign(new TypeError(`email=cliente@fixture.invalid token=${tokenSintetico}`), {
    code: "08006"
  });
  const req = { get: () => "00000000-0000-4000-8000-000000000002" };
  const diagnostico = registrarErroSaas({
    req,
    etapa: "google.balance_read",
    erro,
    logger: { error: (...args) => capturado.push(args.join(" ")) }
  });
  const texto = capturado.join("\n");
  assert.equal(diagnostico.requestId, "00000000-0000-4000-8000-000000000002");
  assert.equal(diagnostico.etapa, "google.balance_read");
  assert.equal(diagnostico.codigo, "08006");
  assert.equal(diagnostico.classeExcecao, "TypeError");
  assert.ok(!texto.includes(tokenSintetico));
  assert.ok(!texto.includes("cliente@fixture.invalid"));
  assert.ok(!texto.includes(erro.message));

  const tokenCodeError = Object.assign(new Error("opaque"), { code: tokenSintetico });
  const tokenCodeDiagnostic = registrarErroSaas({
    req: {},
    etapa: "google.balance_read",
    erro: tokenCodeError,
    codigoFallback: "google_auth_falhou",
    logger: { error: (...args) => capturado.push(args.join(" ")) }
  });
  assert.equal(tokenCodeDiagnostic.codigo, "google_auth_falhou");
  assert.ok(!capturado.join("\n").includes(tokenSintetico));
});

test("rotas usam o read model e devolvem erro explícito em falha", () => {
  const adminRouteStart = source.indexOf('app.get("/admin/usuarios"');
  const adminRouteEnd = source.indexOf('app.get("/admin/planos"', adminRouteStart);
  const adminRoute = source.slice(adminRouteStart, adminRouteEnd);
  assert.ok(adminRoute.includes("listarUsuariosAdminSomenteLeituraAtual()"));
  assert.ok(adminRoute.includes("res.status(503)"));
  assert.ok(adminRoute.includes("requestId: diagnostico.requestId"));
  assert.ok(!adminRoute.includes("usuarioAdminComSaldoOperacional"));
});

test("handlers HTTP retornam falhas explícitas com requestId sem vazar detalhes", async () => {
  const logs = [];
  const logger = { error: (...args) => logs.push(args.join(" ")) };
  const requestId = "00000000-0000-4000-8000-000000000003";
  const req = { body: { credential: "token-sintetico-nao-registravel" },
    get: () => requestId };

  const handlerAdmin = carregarHandlerRota(
    source,
    'app.get("/admin/usuarios"',
    'app.get("/admin/planos"',
    "get",
    {
      exigirAdminMasterEstrito: () => {},
      isAdminMaster: () => true,
      listarUsuariosAdminSomenteLeituraAtual: async () => {
        throw Object.assign(new Error("private email and database detail"), {
          code: "08006"
        });
      },
      registrarErroSaas: args => registrarErroSaas({ ...args, logger })
    }
  );
  const adminResponse = criarResponseFake();
  await handlerAdmin(req, adminResponse);
  assert.equal(adminResponse.statusCode, 503);
  assert.equal(adminResponse.body.codigo, "saldo_operacional_indisponivel");
  assert.equal(adminResponse.body.requestId, requestId);
  assert.equal(Object.hasOwn(adminResponse.body, "usuarios"), false);

  const handlerGoogle = carregarHandlerRota(
    source,
    'app.post("/auth/google"',
    'app.post("/login"',
    "post",
    {
      googleAuthRateLimit: () => {},
      obterRequestIdSaas: reqAtual => {
        reqAtual.requestId = requestId;
        return requestId;
      },
      autenticarGoogleOptimus: async token => {
        assert.equal(token, "token-sintetico-nao-registravel");
        throw Object.assign(new TypeError(`credential=${token} email=private@fixture.invalid`), {
          code: "08006"
        });
      },
      registrarErroSaas: args => registrarErroSaas({ ...args, logger })
    }
  );
  const googleResponse = criarResponseFake();
  await handlerGoogle(req, googleResponse);
  assert.equal(googleResponse.statusCode, 503);
  assert.equal(googleResponse.body.codigo, "google_auth_falhou");
  assert.equal(googleResponse.body.requestId, requestId);
  assert.ok(!JSON.stringify(googleResponse.body).includes("token-sintetico"));
  assert.ok(!JSON.stringify(googleResponse.body).includes("private@fixture.invalid"));
  assert.ok(!logs.join("\n").includes("token-sintetico-nao-registravel"));
  assert.ok(!logs.join("\n").includes("private@fixture.invalid"));
  assert.ok(!logs.join("\n").includes("database detail"));
});
