"use strict";

const assert = require("assert");

const bootstrap = require("../utils/clean-install-bootstrap");
const links = require("../modules/links");
const saas = require("../utils/saas-fundacao");

function criarEnvAdmin(extra = {}) {
  return {
    OPTIMUS_ADMIN_MASTER_EMAIL: "admin.clean@example.com",
    OPTIMUS_ADMIN_MASTER_PASSWORD: "senha-super-segura",
    OPTIMUS_ADMIN_MASTER_NAME: "Admin Limpo",
    ...extra
  };
}

function hashSyncFake(senha) {
  return `$2b$10$hashfake.${Buffer.from(String(senha)).toString("hex").slice(0, 20)}`;
}

{
  const usuarios = [];
  const planos = {};
  let salvouUsuarios = 0;
  let salvouPlanos = 0;

  const primeiroBoot = bootstrap.aplicarBootstrapInstalacaoLimpa({
    usuarios,
    planos,
    env: criarEnvAdmin(),
    gerarSenhaHashSync: hashSyncFake,
    salvarUsuarios: () => { salvouUsuarios += 1; },
    salvarPlanos: () => { salvouPlanos += 1; },
    logger: { log() {} }
  });

  assert.strictEqual(primeiroBoot.adminMaster.alterou, true, "boot vazio deve criar Admin Master via env");
  assert.strictEqual(primeiroBoot.planos.alterou, true, "boot vazio deve criar planos oficiais");
  assert.strictEqual(usuarios.length, 1, "Admin Master nasce uma unica vez");
  assert.strictEqual(usuarios[0].papel, "admin_master");
  assert.strictEqual(usuarios[0].email, "admin.clean@example.com");
  assert.ok(usuarios[0].senhaHash, "Admin Master deve persistir senhaHash");
  assert.ok(!usuarios[0].senha, "Admin Master nao pode persistir senha plaintext");
  assert.ok(!JSON.stringify(usuarios).includes("senha-super-segura"), "senha de bootstrap nao pode vazar para storage");
  assert.ok(Object.keys(planos).length >= 4, "catalogo minimo deve conter os planos oficiais atuais do contrato SaaS");
  assert.ok(saas.buscarEntradaPlano(planos, "Beta Teste"), "Beta Teste deve nascer do catalogo atual");
  assert.ok(saas.buscarEntradaPlano(planos, "Ultimate"), "Ultimate deve nascer do catalogo atual");
  assert.strictEqual(salvouUsuarios, 1, "primeiro boot deve persistir usuarios uma vez");
  assert.strictEqual(salvouPlanos, 1, "primeiro boot deve persistir planos uma vez");

  const snapshotUsuarios = JSON.stringify(usuarios);
  const snapshotPlanos = JSON.stringify(planos);
  const segundoBoot = bootstrap.aplicarBootstrapInstalacaoLimpa({
    usuarios,
    planos,
    env: criarEnvAdmin({
      OPTIMUS_ADMIN_MASTER_EMAIL: "outro-admin@example.com",
      OPTIMUS_ADMIN_MASTER_PASSWORD: "outra-senha-segura"
    }),
    gerarSenhaHashSync: hashSyncFake,
    salvarUsuarios: () => { salvouUsuarios += 1; },
    salvarPlanos: () => { salvouPlanos += 1; },
    logger: { log() {} }
  });

  assert.strictEqual(segundoBoot.adminMaster.alterou, false, "segundo boot nao duplica Admin Master");
  assert.strictEqual(segundoBoot.planos.alterou, false, "segundo boot nao duplica planos");
  assert.strictEqual(JSON.stringify(usuarios), snapshotUsuarios, "segundo boot nao sobrescreve Admin existente");
  assert.strictEqual(JSON.stringify(planos), snapshotPlanos, "segundo boot nao reseta catalogo existente");
  assert.strictEqual(salvouUsuarios, 1, "segundo boot idempotente nao repersiste usuario");
  assert.strictEqual(salvouPlanos, 1, "segundo boot idempotente nao repersiste planos");
}

{
  const usuarios = [{
    id: "admin_existente",
    email: "admin.existente@example.com",
    papel: "admin_master",
    ativo: true,
    senhaHash: "$2b$10$existente"
  }];
  const planos = {
    custom: {
      id: "custom",
      nome: "Plano Custom",
      limites: { creditosPorCiclo: 777 }
    }
  };
  const snapshot = JSON.stringify({ usuarios, planos });

  const resultado = bootstrap.aplicarBootstrapInstalacaoLimpa({
    usuarios,
    planos,
    env: criarEnvAdmin(),
    gerarSenhaHashSync: hashSyncFake,
    salvarUsuarios: () => { throw new Error("nao_deve_salvar_usuario_existente"); },
    salvarPlanos: () => { throw new Error("nao_deve_salvar_plano_existente"); },
    logger: { log() {} }
  });

  assert.strictEqual(resultado.adminMaster.motivo, "admin_master_existente_preservado");
  assert.strictEqual(resultado.planos.motivo, "planos_existentes_preservados");
  assert.strictEqual(JSON.stringify({ usuarios, planos }), snapshot, "bootstrap nao sobrescreve estado valido existente");
}

{
  const usuarios = [];
  const resultado = bootstrap.bootstrapAdminMaster({
    usuarios,
    env: {},
    gerarSenhaHashSync: hashSyncFake,
    salvarUsuarios: () => { throw new Error("nao_deve_salvar_sem_env"); }
  });

  assert.strictEqual(resultado.alterou, false, "sem env sensivel nao cria Admin ficticio");
  assert.strictEqual(resultado.motivo, "env_admin_master_incompleta");
  assert.deepStrictEqual(usuarios, [], "sem env nao cria usuario historico nem ficticio");
}

assert.deepStrictEqual(
  links.resolverDominioPublicoOptimusEnv({
    OPTIMUS_PUBLIC_BASE_URL: "https://go.optimuspromo.com.br/",
    RAILWAY_PUBLIC_DOMAIN: "railway.example"
  }),
  { dominio: "https://go.optimuspromo.com.br", origem: "env" },
  "env generica deve substituir semanticamente Railway"
);

assert.deepStrictEqual(
  links.resolverDominioPublicoOptimusEnv({
    RAILWAY_PUBLIC_DOMAIN: "railway.example"
  }),
  { dominio: "https://railway.example", origem: "railway" },
  "Railway continua fallback de transicao"
);

console.log("clean-install-bootstrap.test.js OK");
