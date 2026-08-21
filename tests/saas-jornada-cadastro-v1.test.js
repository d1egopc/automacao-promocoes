"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const saas = require("../utils/saas-fundacao");

const raiz = path.resolve(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");

function trechoEntre(fonte, inicio, fim) {
  const ini = fonte.indexOf(inicio);
  assert.ok(ini >= 0, `trecho inicial nao encontrado: ${inicio}`);
  const end = fonte.indexOf(fim, ini + inicio.length);
  assert.ok(end > ini, `trecho final nao encontrado: ${fim}`);
  return fonte.slice(ini, end);
}

function plano(nome, extra = {}) {
  return {
    nome,
    visivelPublicamente: true,
    contratavel: true,
    emBreve: false,
    marketplaces: ["amazon", "shopee"],
    recursos: { whatsapp: true, telegram: true, discord: false },
    limites: { maxConexoes: 2, destinos: 3, creditosUnicos: 100 },
    creditosModelo: "unicos",
    ...extra
  };
}

function criarAmbiente() {
  const usuarios = [];
  const configsPorCliente = {};
  const planos = {
    teste: plano("Teste Dinamico"),
    interno: plano("Interno Restrito", {
      visivelPublicamente: false,
      contratavel: false,
      limites: { creditosUnicos: 77 }
    }),
    futuro: plano("Plano Futuro", {
      visivelPublicamente: true,
      contratavel: false,
      emBreve: true
    }),
    ciclo: plano("Ciclo Loja", {
      creditosModelo: "ciclo",
      limites: { creditosPorCiclo: 900, cicloDias: 30 },
      marketplaces: ["amazon"],
      recursos: { whatsapp: true }
    })
  };
  let proximoId = 1;
  let salvouUsuarios = 0;
  let salvouConfigs = 0;

  return {
    usuarios,
    configsPorCliente,
    planos,
    gerarId: () => `user_jornada_${proximoId++}`,
    gerarSenhaHash: senha => bcrypt.hash(senha, 4),
    prepararConfig: (_configAtual, usuario) => ({
      workspaceId: usuario.id,
      arquiteturaComercial: "rio_oficial",
      automacaoAtiva: false
    }),
    salvarUsuarios: () => {
      salvouUsuarios += 1;
      return true;
    },
    salvarConfigsClientes: () => {
      salvouConfigs += 1;
      return true;
    },
    metricas: () => ({ salvouUsuarios, salvouConfigs })
  };
}

function payloadSemSegredo(valor) {
  const texto = JSON.stringify(valor);
  assert.ok(!/senhaHash|passwordHash|hash|senha|password|pass/i.test(texto), "payload nao deve expor senha/hash");
}

async function cadastrar(env, body, opcoes = {}) {
  return saas.executarCadastroAtomico({
    body,
    planos: env.planos,
    usuarios: env.usuarios,
    configsPorCliente: env.configsPorCliente,
    saasConfig: opcoes.saasConfig || { cadastroPublicoAtivo: true, betaAtivo: false },
    contexto: opcoes.contexto || "publico",
    origemCadastro: opcoes.origemCadastro,
    autorizarCicloTeste: opcoes.autorizarCicloTeste,
    idempotencyKey: opcoes.idempotencyKey,
    gerarId: env.gerarId,
    gerarSenhaHash: env.gerarSenhaHash,
    prepararConfig: env.prepararConfig,
    salvarUsuarios: env.salvarUsuarios,
    salvarConfigsClientes: opcoes.salvarConfigsClientes || env.salvarConfigsClientes,
    agora: opcoes.agora || new Date("2026-08-21T00:00:00.000Z")
  });
}

(async () => {
  const blocoInterno = trechoEntre(indexFonte, 'app.post("/admin/cadastro-interno"', 'app.get("/admin/usuarios"');
  assert.ok(blocoInterno.includes("exigirAdminMasterEstrito"), "cadastro interno deve exigir Auth Admin estrito");
  assert.ok(!blocoInterno.includes("getClienteId(req)"), "cadastro interno nao pode usar fallback Admin");
  assert.ok(indexFonte.includes("criarSerializadorCadastro"), "cadastro SaaS deve usar serializacao oficial contra corrida");
  assert.ok(indexFonte.includes('app.post("/cadastro"'), "cadastro publico deve continuar existindo");

  const env = criarAmbiente();
  const usuario = await cadastrar(env, {
    nome: "Cliente Valido",
    email: " CLIENTE@EXEMPLO.COM ",
    senha: "12345678",
    plano: "Teste Dinamico"
  });
  assert.strictEqual(usuario.email, "cliente@exemplo.com", "email deve ser normalizado");
  assert.strictEqual(usuario.papel, "cliente");
  assert.strictEqual(usuario.origemCadastro, "publico");
  assert.strictEqual(usuario.plano, "Teste Dinamico");
  assert.strictEqual(usuario.creditos, 100);
  assert.ok(usuario.senhaHash, "senhaHash deve ser persistido");
  assert.ok(!usuario.senha, "senha plaintext nunca deve ser persistida");
  assert.ok(await bcrypt.compare("12345678", usuario.senhaHash), "senhaHash deve validar login futuro");
  assert.deepStrictEqual(env.configsPorCliente[usuario.id], {
    workspaceId: usuario.id,
    arquiteturaComercial: "rio_oficial",
    automacaoAtiva: false
  });

  const token = jwt.sign({ clienteId: usuario.id, papel: usuario.papel, plano: usuario.plano }, "segredo_teste", { expiresIn: "5m" });
  const decoded = jwt.verify(token, "segredo_teste");
  assert.strictEqual(decoded.clienteId, usuario.id, "login/JWT deve apontar para workspace criado");
  const planoUsuario = saas.buscarPlanoCadastro(env.planos, usuario.plano);
  assert.deepStrictEqual(planoUsuario.marketplaces, ["amazon", "shopee"], "/me deve conseguir derivar marketplaces do plano");
  assert.deepStrictEqual(planoUsuario.recursos, { whatsapp: true, telegram: true, discord: false }, "/me deve conseguir derivar recursos do plano");
  assert.strictEqual(planoUsuario.limites.maxConexoes, 2, "/me deve conseguir derivar limites do plano");

  const payloadMe = {
    ok: true,
    usuario: {
      id: usuario.id,
      email: usuario.email,
      plano: usuario.plano,
      creditos: usuario.creditos,
      papel: usuario.papel,
      recursos: planoUsuario.recursos,
      limites: planoUsuario.limites
    }
  };
  payloadSemSegredo(payloadMe);

  await assert.rejects(
    () => cadastrar(env, { nome: "Duplicado", email: "cliente@exemplo.com", senha: "12345678", plano: "Teste Dinamico" }),
    erro => erro.codigo === "email_ja_cadastrado",
    "email duplicado deve falhar"
  );
  await assert.rejects(
    () => cadastrar(env, { nome: "Email ruim", email: "email-invalido", senha: "12345678", plano: "Teste Dinamico" }),
    erro => erro.codigo === "email_invalido",
    "email invalido deve falhar"
  );
  await assert.rejects(
    () => cadastrar(env, { nome: "Senha curta", email: "curta@example.com", senha: "123", plano: "Teste Dinamico" }),
    erro => erro.codigo === "senha_minima",
    "senha curta deve falhar"
  );
  await assert.rejects(
    () => cadastrar(env, { nome: "Sem plano", email: "semplano@example.com", senha: "12345678", plano: "Plano Que Nao Existe" }),
    erro => erro.codigo === "plano_publico_nao_encontrado",
    "plano inexistente deve falhar"
  );
  await assert.rejects(
    () => cadastrar(env, { nome: "Futuro", email: "futuro@example.com", senha: "12345678", plano: "Plano Futuro" }),
    erro => erro.codigo === "plano_nao_contratavel",
    "plano nao contratavel deve falhar no contexto publico"
  );

  const interno = await cadastrar(env, {
    nome: "Interno",
    email: "interno@example.com",
    senha: "12345678",
    plano: "Interno Restrito"
  }, {
    contexto: "admin/teste",
    origemCadastro: "admin/teste",
    saasConfig: { cadastroPublicoAtivo: false }
  });
  assert.strictEqual(interno.origemCadastro, "admin/teste");
  assert.strictEqual(interno.plano, "Interno Restrito", "Admin pode atribuir plano existente nao publico/nao contratavel");
  assert.strictEqual(interno.creditos, 77);

  const envRollback = criarAmbiente();
  await assert.rejects(
    () => cadastrar(envRollback, {
      nome: "Rollback",
      email: "rollback@example.com",
      senha: "12345678",
      plano: "Teste Dinamico"
    }, {
      salvarConfigsClientes: () => {
        throw new Error("falha_config");
      }
    }),
    erro => erro.codigo === "cadastro_rollback_executado",
    "falha na segunda persistencia deve acionar rollback"
  );
  assert.deepStrictEqual(envRollback.usuarios, [], "rollback nao deixa usuario pela metade");
  assert.deepStrictEqual(envRollback.configsPorCliente, {}, "rollback nao deixa workspace/config pela metade");

  const usuarioCredito = { creditos: 5, creditosInicializadosEm: "2026-08-01T00:00:00.000Z" };
  saas.inicializarCreditosUsuario({ usuario: usuarioCredito, plano: env.planos.teste });
  assert.strictEqual(usuarioCredito.creditos, 5, "creditos unicos nao podem ser reinicializados por engano");

  const cicloPendente = {
    assinaturaStatus: "pendente_pagamento",
    creditos: 0,
    cicloAtualInicio: "2026-07-01T00:00:00.000Z",
    proximaRenovacao: "2026-08-01T00:00:00.000Z"
  };
  assert.strictEqual(
    saas.renovarCreditosPorPlano(cicloPendente, env.planos.ciclo, new Date("2026-08-21T00:00:00.000Z")).motivo,
    "assinatura_suspensa_sem_pagamento",
    "data vencida sozinha nao pode gerar creditos"
  );
  assert.strictEqual(cicloPendente.creditos, 0);

  const cicloInterno = await cadastrar(env, {
    nome: "Ciclo Interno",
    email: "ciclo@example.com",
    senha: "12345678",
    plano: "Ciclo Loja"
  }, {
    contexto: "admin/teste",
    origemCadastro: "admin/teste",
    autorizarCicloTeste: true,
    idempotencyKey: "ciclo-teste-1",
    saasConfig: { cadastroPublicoAtivo: false }
  });
  assert.strictEqual(cicloInterno.creditos, 900, "mecanismo interno explicito abre ciclo de teste");
  cicloInterno.creditos = 10;
  assert.strictEqual(
    saas.abrirCicloCreditosAutorizado(cicloInterno, env.planos.ciclo, { idempotencyKey: "ciclo-teste-1" }).motivo,
    "ciclo_ja_aberto",
    "mesma idempotencyKey nao pode conceder creditos duas vezes"
  );
  assert.strictEqual(cicloInterno.creditos, 10);

  const envBeta = criarAmbiente();
  assert.strictEqual(
    saas.contarVagasFreeBeta({
      usuarios: envBeta.usuarios,
      planos: envBeta.planos,
      maxContasFreeBeta: 1
    }).disponiveis,
    1
  );
  const beta = await cadastrar(envBeta, {
    nome: "Beta Um",
    email: "beta1@example.com",
    senha: "12345678",
    plano: "Teste Dinamico"
  }, {
    saasConfig: { cadastroPublicoAtivo: true, betaAtivo: true, maxContasFreeBeta: 1 }
  });
  assert.strictEqual(beta.creditosModelo, "unicos");
  assert.strictEqual(
    saas.contarVagasFreeBeta({
      usuarios: envBeta.usuarios,
      planos: envBeta.planos,
      maxContasFreeBeta: 1
    }).disponiveis,
    0,
    "primeira conta ocupa ultima vaga beta"
  );
  await assert.rejects(
    () => cadastrar(envBeta, {
      nome: "Beta Dois",
      email: "beta2@example.com",
      senha: "12345678",
      plano: "Teste Dinamico"
    }, {
      saasConfig: { cadastroPublicoAtivo: true, betaAtivo: true, maxContasFreeBeta: 1 }
    }),
    erro => erro.codigo === "vagas_beta_esgotadas",
    "segunda conta nao pode ocupar vaga beta inexistente"
  );
  beta.statusConta = "teste_esgotado";
  assert.strictEqual(
    saas.contarVagasFreeBeta({
      usuarios: envBeta.usuarios,
      planos: envBeta.planos,
      maxContasFreeBeta: 1
    }).disponiveis,
    1,
    "teste esgotado libera vaga beta sem apagar conta"
  );

  const serializar = saas.criarSerializadorCadastro("teste_concorrencia_beta");
  let liberarPrimeiro;
  const primeiro = serializar(() => new Promise(resolve => {
    liberarPrimeiro = () => resolve("primeiro_ok");
  }));
  await assert.rejects(
    () => serializar(() => Promise.resolve("segundo_nao_deve_entrar")),
    erro => erro.codigo === "cadastro_em_andamento",
    "duas requisicoes simultaneas nao podem entrar juntas na ultima vaga beta"
  );
  liberarPrimeiro();
  assert.strictEqual(await primeiro, "primeiro_ok");

  const blocoAdminAuth = trechoEntre(indexFonte, 'app.get("/admin/usuarios"', 'app.post("/minha-config"');
  assert.ok(blocoAdminAuth.includes("exigirAdminMasterEstrito"), "rotas Admin legadas continuam protegidas");
  assert.ok(!indexFonte.includes("senha: validacao.senha"), "cadastro nao pode persistir senha plaintext");

  console.log("saas-jornada-cadastro-v1.test.js OK");
})().catch(e => {
  console.error(e);
  process.exit(1);
});
