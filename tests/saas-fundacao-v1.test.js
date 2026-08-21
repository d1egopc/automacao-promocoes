"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

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

const planoUnico = {
  nome: "Beta Teste",
  visivelPublicamente: true,
  contratavel: true,
  creditosModelo: "unicos",
  limites: { creditosUnicos: 300 }
};

const planoCiclo = {
  nome: "Plano Loja",
  visivelPublicamente: true,
  contratavel: true,
  creditosModelo: "ciclo",
  limites: { creditosPorCiclo: 900, cicloDias: 30 }
};

const planoLegado = {
  nome: "Legado Real",
  limites: { creditos: 123, sessoes: 2 },
  marketplaces: ["amazon", "shopee"]
};

assert.deepStrictEqual(
  saas.politicaCreditosPlano(planoLegado),
  { creditosModelo: "ciclo", creditosUnicos: 123, creditosPorCiclo: 123, cicloDias: 30 },
  "plano legado deve derivar creditos do proprio plano, nao de mapa fixo"
);

const usuarioUnico = { email: "beta@teste.local" };
saas.inicializarCreditosUsuario({ usuario: usuarioUnico, plano: planoUnico, origemCadastro: "publico" });
assert.strictEqual(usuarioUnico.creditos, 300, "Free/teste recebe creditos unicos iniciais");
assert.strictEqual(usuarioUnico.creditosModelo, "unicos");
assert.strictEqual(usuarioUnico.assinaturaStatus, "nao_aplicavel");

saas.aplicarDebitoConta(usuarioUnico, planoUnico, 300, new Date("2026-08-20T00:00:00Z"));
assert.strictEqual(usuarioUnico.creditos, 0, "debito nao pode deixar saldo negativo");
assert.strictEqual(usuarioUnico.statusConta, "teste_esgotado", "teste unico ao zerar fica esgotado");
assert.strictEqual(
  saas.renovarCreditosPorPlano(usuarioUnico, planoUnico).motivo,
  "creditos_unicos_nao_renovam",
  "creditos unicos nao renovam"
);

const usuarioCicloPendente = {};
saas.inicializarCreditosUsuario({ usuario: usuarioCicloPendente, plano: planoCiclo, origemCadastro: "publico" });
assert.strictEqual(usuarioCicloPendente.creditos, 0, "plano pago publico sem gateway nao nasce com credito");
assert.strictEqual(usuarioCicloPendente.assinaturaStatus, "pendente_pagamento");

const usuarioCicloAutorizado = {
  assinaturaStatus: "pagamento_confirmado",
  creditos: 10,
  cicloAtualInicio: "2026-07-01T00:00:00.000Z",
  proximaRenovacao: "2026-08-01T00:00:00.000Z"
};
const renovacao = saas.renovarCreditosPorPlano(usuarioCicloAutorizado, planoCiclo, new Date("2026-08-20T00:00:00Z"));
assert.strictEqual(renovacao.motivo, "ciclo_renovado");
assert.strictEqual(usuarioCicloAutorizado.creditos, 900, "ciclo autorizado renova pelo plano");

const planos = {
  beta: planoUnico,
  futuro: { nome: "Ultimate Futuro", visivelPublicamente: true, contratavel: false, emBreve: true, ordem: 2 },
  interno: { nome: "Interno", visivelPublicamente: false, contratavel: true, ordem: 1 }
};

assert.deepStrictEqual(
  saas.planosPublicos(planos).map((p) => p.nome),
  ["Beta Teste", "Ultimate Futuro"],
  "GET publico deve considerar somente planos visiveis"
);
assert.strictEqual(
  saas.sanitizarPlanoPublico(planos.beta).creditos.creditosUnicos,
  300,
  "plano publico expoe apenas resumo publico de creditos"
);

const saasConfig = { cadastroPublicoAtivo: true, betaAtivo: true, maxContasFreeBeta: 1 };
const vagaOcupada = [{
  email: "ocupada@teste.local",
  plano: "Beta Teste",
  origemCadastro: "publico",
  statusConta: "ativa",
  ativo: true
}];
assert.strictEqual(
  saas.validarCadastroPublico({
    body: { nome: "Novo", email: "novo@teste.local", senha: "12345678", plano: "Beta Teste" },
    planos,
    usuarios: vagaOcupada,
    saasConfig
  }).codigo,
  "vagas_beta_esgotadas",
  "vaga beta deve ser calculada por usuarios publicos ativos"
);
vagaOcupada[0].statusConta = "teste_esgotado";
assert.strictEqual(
  saas.validarCadastroPublico({
    body: { nome: "Novo", email: "novo@teste.local", senha: "12345678", plano: "Beta Teste" },
    planos,
    usuarios: vagaOcupada,
    saasConfig
  }).ok,
  true,
  "teste esgotado deixa de ocupar vaga beta"
);

assert.strictEqual(
  saas.validarCadastroPublico({
    body: { nome: "Novo", email: "novo@teste.local", senha: "12345678", plano: "Ultimate Futuro" },
    planos,
    usuarios: [],
    saasConfig: { cadastroPublicoAtivo: true }
  }).codigo,
  "plano_nao_contratavel",
  "plano em breve/nao contratavel aparece mas nao pode ser contratado"
);

const rotaAdminUsuarios = trechoEntre(indexFonte, 'app.post("/admin/usuarios"', 'app.put("/admin/usuarios/:id"');
assert.ok(rotaAdminUsuarios.includes("senhaHash"), "Admin deve persistir senhaHash");
assert.ok(rotaAdminUsuarios.includes("await gerarSenhaHash"), "Admin deve hashear senha");
assert.ok(!rotaAdminUsuarios.includes("senha: body.senha"), "Admin nao pode persistir senha em texto");

const rotaLogin = trechoEntre(indexFonte, 'app.post("/login"', 'app.get("/",');
assert.ok(rotaLogin.includes("migrarSenhaLegadaSeNecessario"), "login deve migrar senha legada apos sucesso");
const migracaoSenha = trechoEntre(indexFonte, "async function migrarSenhaLegadaSeNecessario", 'app.post("/login"');
assert.ok(migracaoSenha.includes("delete usuario.senha"), "migracao deve remover senha plaintext legada");
assert.ok(migracaoSenha.includes("salvarUsuarios()"), "migracao deve persistir senhaHash");

const rotaPutUsuario = trechoEntre(indexFonte, 'app.put("/admin/usuarios/:id"', 'app.post("/minha-config"');
assert.ok(rotaPutUsuario.includes("auditoriaCreditos"), "ajuste manual de creditos deve registrar auditoria");
assert.ok(rotaPutUsuario.includes("anterior: creditosAntes"), "auditoria deve guardar saldo anterior");
assert.ok(rotaPutUsuario.includes("novo: usuario.creditos"), "auditoria deve guardar novo saldo");

const helperPlano = trechoEntre(indexFonte, "function getPlanoPorNome", "// =============== FUNCAO GERAR LINK AFILIADO SHOPEE");
assert.ok(!helperPlano.includes("planos?.free"), "resolver plano nao deve cair em free hardcoded");

const criacaoPlanos = trechoEntre(indexFonte, "function criarPlanosPadrao", "function normalizarRecursosPlanosRuntime");
assert.ok(!/\b(free|pro|premium|enterprise|ultimate|starter)\b/i.test(criacaoPlanos), "runtime nao deve recriar planos por nome");
assert.ok(!criacaoPlanos.includes("salvarPlanos()"), "runtime nao deve persistir planos padrao automaticamente");

const blocoCreditos = trechoEntre(indexFonte, "// ================= CREDITOS =================", "// ================= FUNCAO SALVA PLANO");
assert.ok(!blocoCreditos.includes("CREDITOS_PLANO"), "creditos nao devem usar mapa estatico");
assert.ok(blocoCreditos.includes("renovarCreditosPorPlano"), "renovacao deve vir do plano");
assert.ok(blocoCreditos.includes("aplicarDebitoConta"), "debito deve atualizar status da conta");

const blocoPublico = trechoEntre(indexFonte, 'app.get("/public/saas-config"', 'app.get("/admin/usuarios"');
assert.ok(blocoPublico.includes('app.get("/public/planos"'), "deve expor planos publicos read-only");
assert.ok(blocoPublico.includes('app.post("/cadastro"'), "deve preparar contrato de cadastro");
assert.ok(indexFonte.includes("saasFundacao.executarCadastroAtomico"), "cadastro deve usar helper atomico com rollback");
assert.ok(indexFonte.includes("cadastroPublicoAtivo"), "cadastro deve respeitar flag publica");

(async () => {
  const hash = await bcrypt.hash("senhateste", 10);
  assert.ok(await bcrypt.compare("senhateste", hash), "bcryptjs operacional para senhaHash");

  const usuariosRollback = [];
  const configsRollback = {};
  await assert.rejects(
    () => saas.executarCadastroAtomico({
      body: { nome: "Rollback", email: "rollback@teste.local", senha: "12345678", plano: "Beta Teste" },
      planos: { beta: planoUnico },
      usuarios: usuariosRollback,
      configsPorCliente: configsRollback,
      saasConfig: { cadastroPublicoAtivo: true },
      gerarId: () => "cliente_rollback",
      gerarSenhaHash: async () => "hash_seguro",
      prepararConfig: () => ({ rioOficial: true }),
      salvarUsuarios: () => true,
      salvarConfigsClientes: () => {
        throw new Error("falha_storage");
      }
    }),
    (erro) => erro.codigo === "cadastro_rollback_executado",
    "falha de persistencia deve acionar rollback"
  );
  assert.deepStrictEqual(usuariosRollback, [], "rollback remove usuario criado pela metade");
  assert.deepStrictEqual(configsRollback, {}, "rollback remove workspace/config criado pela metade");

  console.log("saas-fundacao-v1.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
