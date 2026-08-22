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
  entradaBeta: true,
  renovacaoCreditos: "sem_renovacao",
  creditosModelo: "ciclo",
  limites: { creditosPorCiclo: 300, cicloDias: 30 },
  recursos: { whatsapp: true, social: false, admin_master: true, tokenInterno: true }
};

const planoCiclo = {
  nome: "Plano Loja",
  visivelPublicamente: true,
  contratavel: true,
  creditosModelo: "ciclo",
  limites: { creditosPorCiclo: 900, cicloDias: 30 }
};

const planoPro = {
  nome: "Pro",
  creditosModelo: "ciclo",
  limites: { creditosPorCiclo: 2000, cicloDias: 30 }
};

const planoUltimate = {
  nome: "Ultimate",
  creditosModelo: "ciclo",
  limites: { creditosPorCiclo: 4000, cicloDias: 30 }
};

const planoLegado = {
  nome: "Legado Real",
  limites: { creditos: 123, sessoes: 2 },
  marketplaces: ["amazon", "shopee"]
};

assert.deepStrictEqual(
  saas.politicaCreditosPlano(planoLegado),
  { creditosModelo: "ciclo", creditosUnicos: 123, creditosPorCiclo: 123, cicloDias: 30, renovacaoCreditos: "pagamento" },
  "plano legado deve derivar creditos do proprio plano, nao de mapa fixo"
);

const usuarioUnico = { email: "beta@teste.local" };
saas.inicializarCreditosUsuario({
  usuario: usuarioUnico,
  plano: planoUnico,
  origemCadastro: "publico",
  agora: new Date("2026-08-01T00:00:00Z")
});
assert.strictEqual(usuarioUnico.creditos, 300, "Free Beta recebe creditos iniciais do ciclo gratuito");
assert.strictEqual(usuarioUnico.creditosModelo, "ciclo");
assert.strictEqual(usuarioUnico.assinaturaStatus, "nao_aplicavel");
assert.strictEqual(usuarioUnico.proximaRenovacao, "2026-08-31T00:00:00.000Z");

saas.aplicarDebitoConta(usuarioUnico, planoUnico, 300, new Date("2026-08-20T00:00:00Z"));
assert.strictEqual(usuarioUnico.creditos, 0, "debito nao pode deixar saldo negativo");
assert.strictEqual(usuarioUnico.statusConta, "teste_esgotado", "Beta ao zerar fica esgotado");
assert.strictEqual(
  saas.renovarCreditosPorPlano(usuarioUnico, planoUnico, new Date("2026-09-01T00:00:00Z")).motivo,
  "ciclo_sem_renovacao_esgotado",
  "ciclo Beta sem renovacao nao recarrega automaticamente"
);

const usuarioCicloPendente = {};
saas.inicializarCreditosUsuario({ usuario: usuarioCicloPendente, plano: planoCiclo, origemCadastro: "publico" });
assert.strictEqual(usuarioCicloPendente.creditos, 0, "plano pago publico sem gateway nao nasce com credito");
assert.strictEqual(usuarioCicloPendente.assinaturaStatus, "pendente_pagamento");

const adminFreeSemOverride = { email: "admin-free@teste.local", origemCadastro: "admin" };
saas.inicializarCreditosUsuarioAdminManual({
  usuario: adminFreeSemOverride,
  plano: planoUnico,
  body: {}
});
assert.strictEqual(adminFreeSemOverride.creditos, 300, "Admin manual sem override deve herdar creditos unicos do plano");

const adminFreeOverride = { email: "admin-override@teste.local", origemCadastro: "admin" };
saas.inicializarCreditosUsuarioAdminManual({
  usuario: adminFreeOverride,
  plano: planoUnico,
  body: { creditosOverrideManual: true, creditos: 500 }
});
assert.strictEqual(adminFreeOverride.creditos, 500, "Admin manual com override explicito deve respeitar credito informado");

const adminFreeOverrideZero = { email: "admin-zero@teste.local", origemCadastro: "admin" };
saas.inicializarCreditosUsuarioAdminManual({
  usuario: adminFreeOverrideZero,
  plano: planoUnico,
  body: { creditos: 0 }
});
assert.strictEqual(adminFreeOverrideZero.creditos, 0, "Admin manual deve permitir override explicito para zero");

const adminLegadoSemOverride = { email: "admin-legado@teste.local", origemCadastro: "admin" };
saas.inicializarCreditosUsuarioAdminManual({
  usuario: adminLegadoSemOverride,
  plano: planoLegado,
  body: {}
});
assert.strictEqual(adminLegadoSemOverride.creditos, 123, "Admin manual sem override deve provisionar creditos do plano legado/ciclo");
assert.strictEqual(adminLegadoSemOverride.assinaturaStatus, "manual");

const adminCicloAutorizado = { id: "admin_ciclo", email: "admin-ciclo@teste.local", origemCadastro: "admin" };
saas.inicializarCreditosUsuarioAdminManual({
  usuario: adminCicloAutorizado,
  plano: planoCiclo,
  body: { autorizarCicloTeste: true, idempotencyKey: "admin-ciclo-teste" },
  agora: new Date("2026-08-20T00:00:00.000Z")
});
assert.strictEqual(adminCicloAutorizado.creditos, 900, "Admin manual autorizado deve abrir ciclo com creditos do plano");
assert.strictEqual(adminCicloAutorizado.ultimoCicloCreditoId, "admin-ciclo-teste");

const freeEsgotadoParaPro = {
  plano: "Free",
  planoAssinatura: "Free",
  creditos: 0,
  statusConta: "teste_esgotado",
  assinaturaStatus: "nao_aplicavel"
};
saas.aplicarTrocaManualPlanoAdmin({
  usuario: freeEsgotadoParaPro,
  plano: planoPro,
  planoIdentidade: "plano_pro"
});
assert.strictEqual(freeEsgotadoParaPro.plano, "plano_pro");
assert.strictEqual(freeEsgotadoParaPro.planoAssinatura, "plano_pro");
assert.strictEqual(freeEsgotadoParaPro.creditos, 2000, "Free esgotado -> Pro deve repor saldo do plano");
assert.strictEqual(freeEsgotadoParaPro.statusConta, "ativa", "Troca para plano pago nao pode manter teste_esgotado");

const freeSaldoParaPro = { plano: "Free", planoAssinatura: "Free", creditos: 120, statusConta: "ativa" };
saas.aplicarTrocaManualPlanoAdmin({ usuario: freeSaldoParaPro, plano: planoPro, planoIdentidade: "plano_pro" });
assert.strictEqual(freeSaldoParaPro.creditos, 2000, "Free com saldo residual -> Pro nao soma saldo antigo");

const datasOriginais = {
  cicloAtualInicio: "2026-08-01T00:00:00.000Z",
  cicloAtualFim: "2026-08-31T00:00:00.000Z",
  proximaRenovacao: "2026-08-31T00:00:00.000Z"
};
const proParaUltimate = {
  plano: "Pro",
  planoAssinatura: "Pro",
  creditos: 1300,
  statusConta: "ativa",
  assinaturaStatus: "ativa",
  ...datasOriginais
};
saas.aplicarTrocaManualPlanoAdmin({ usuario: proParaUltimate, plano: planoUltimate, planoIdentidade: "plano_ultimate" });
assert.strictEqual(proParaUltimate.creditos, 4000, "Pro -> Ultimate deve sobrescrever saldo para novo plano");
assert.deepStrictEqual({
  cicloAtualInicio: proParaUltimate.cicloAtualInicio,
  cicloAtualFim: proParaUltimate.cicloAtualFim,
  proximaRenovacao: proParaUltimate.proximaRenovacao
}, datasOriginais, "Troca manual nao deve alterar datas/ciclo");

const ultimateParaPro = { plano: "Ultimate", planoAssinatura: "Ultimate", creditos: 4000, assinaturaStatus: "ativa", ...datasOriginais };
saas.aplicarTrocaManualPlanoAdmin({ usuario: ultimateParaPro, plano: planoPro, planoIdentidade: "plano_pro" });
assert.strictEqual(ultimateParaPro.creditos, 2000, "Ultimate -> Pro deve sobrescrever saldo para o plano menor");

const trocaComOverrideZero = { plano: "Free", planoAssinatura: "Free", creditos: 0, statusConta: "teste_esgotado" };
saas.aplicarTrocaManualPlanoAdmin({
  usuario: trocaComOverrideZero,
  plano: planoPro,
  planoIdentidade: "plano_pro",
  body: { creditosOverrideManual: true, creditos: 0 }
});
assert.strictEqual(trocaComOverrideZero.creditos, 0, "Override manual na troca deve respeitar zero explicito");
assert.strictEqual(trocaComOverrideZero.statusConta, "ativa");

const usuarioCicloAutorizado = {
  assinaturaStatus: "pagamento_confirmado",
  creditos: 10,
  cicloAtualInicio: "2026-07-01T00:00:00.000Z",
  proximaRenovacao: "2026-08-01T00:00:00.000Z"
};
const renovacao = saas.renovarCreditosPorPlano(usuarioCicloAutorizado, planoCiclo, new Date("2026-08-20T00:00:00Z"));
assert.strictEqual(renovacao.motivo, "assinatura_suspensa_sem_pagamento");
assert.strictEqual(usuarioCicloAutorizado.creditos, 0, "data vencida sem pagamento confirmado nao renova creditos");
assert.strictEqual(usuarioCicloAutorizado.assinaturaStatus, "suspensa");

const freeEsgotadoCreditoAdmin = {
  id: "user_free_admin",
  workspaceId: "workspace_free_admin",
  plano: "Beta Teste",
  creditos: 0,
  statusConta: "teste_esgotado",
  assinaturaStatus: "nao_aplicavel"
};
saas.aplicarCreditoManualAdmin({
  usuario: freeEsgotadoCreditoAdmin,
  plano: planoUnico,
  quantidade: 500,
  agora: new Date("2026-08-20T00:00:00Z")
});
assert.strictEqual(freeEsgotadoCreditoAdmin.creditos, 500, "Free esgotado + credito Admin deve receber saldo manual");
assert.strictEqual(freeEsgotadoCreditoAdmin.statusConta, "ativa", "credito Admin deve retirar bloqueio operacional teste_esgotado");
assert.strictEqual(freeEsgotadoCreditoAdmin.assinaturaStatus, "nao_aplicavel", "Free nao vira assinatura paga");
assert.strictEqual(freeEsgotadoCreditoAdmin.plano, "Beta Teste", "credito Admin nao altera plano");
assert.strictEqual(freeEsgotadoCreditoAdmin.workspaceId, "workspace_free_admin", "credito Admin preserva workspace");
assert.strictEqual(
  saas.renovarCreditosPorPlano(freeEsgotadoCreditoAdmin, planoUnico, new Date("2026-08-21T00:00:00Z")).motivo,
  "credito_admin_manual_vigente",
  "/me/renovador nao pode destruir concessao Admin vigente"
);
assert.strictEqual(freeEsgotadoCreditoAdmin.creditos, 500);
saas.aplicarDebitoConta(freeEsgotadoCreditoAdmin, planoUnico, 500, new Date("2026-08-21T00:00:00Z"));
assert.strictEqual(freeEsgotadoCreditoAdmin.creditos, 0, "debito consome credito Admin normalmente");
assert.strictEqual(freeEsgotadoCreditoAdmin.statusConta, "teste_esgotado", "saldo Admin zerado volta a bloquear Free");

const freeCreditoAdminExpirado = {
  plano: "Beta Teste",
  creditos: 120,
  statusConta: "ativa",
  assinaturaStatus: "nao_aplicavel",
  creditosAdminManualAtivo: true,
  creditosAdminManualExpiraEm: "2026-08-10T00:00:00.000Z"
};
assert.strictEqual(
  saas.renovarCreditosPorPlano(freeCreditoAdminExpirado, planoUnico, new Date("2026-08-20T00:00:00Z")).motivo,
  "credito_admin_manual_expirado",
  "virada da validade Admin deve expirar saldo residual Free"
);
assert.strictEqual(freeCreditoAdminExpirado.creditos, 0);
assert.strictEqual(freeCreditoAdminExpirado.creditosAdminManualAtivo, false);

const proPendenteCreditoAdmin = {
  plano: "Pro",
  planoAssinatura: "Pro",
  creditos: 0,
  statusConta: "ativa",
  assinaturaStatus: "pagamento_pendente",
  pagamentoUltimoStatus: "pagamento_pendente",
  cicloAtualInicio: "2026-08-01T00:00:00.000Z",
  cicloAtualFim: "2026-08-31T00:00:00.000Z",
  proximaRenovacao: "2026-08-31T00:00:00.000Z"
};
saas.aplicarCreditoManualAdmin({
  usuario: proPendenteCreditoAdmin,
  plano: planoPro,
  quantidade: 500,
  agora: new Date("2026-08-20T00:00:00Z")
});
assert.strictEqual(proPendenteCreditoAdmin.creditos, 500, "pagamento pendente + credito Admin deve operar com saldo");
assert.strictEqual(proPendenteCreditoAdmin.assinaturaStatus, "pagamento_pendente", "credito Admin nao marca assinatura como paga");
assert.strictEqual(
  saas.renovarCreditosPorPlano(proPendenteCreditoAdmin, planoPro, new Date("2026-08-21T00:00:00Z")).motivo,
  "credito_admin_manual_vigente",
  "renovador deve respeitar credito Admin em pagamento pendente"
);

const proSuspensoCreditoAdmin = {
  id: "user_pro_admin",
  plano: "Pro",
  planoAssinatura: "Pro",
  creditos: 0,
  statusConta: "ativa",
  assinaturaStatus: "suspensa",
  pagamentoUltimoStatus: "vencido_sem_pagamento",
  cicloAtualInicio: "2026-07-01T00:00:00.000Z",
  cicloAtualFim: "2026-08-01T00:00:00.000Z",
  proximaRenovacao: "2026-08-01T00:00:00.000Z",
  auditoriaAssinatura: [{ tipo: "pagamento_simulado", pagamentoId: "pay_antigo" }]
};
saas.aplicarCreditoManualAdmin({
  usuario: proSuspensoCreditoAdmin,
  plano: planoPro,
  quantidade: 500,
  agora: new Date("2026-08-20T00:00:00Z")
});
assert.strictEqual(proSuspensoCreditoAdmin.creditos, 500, "suspensa + credito Admin deve receber saldo");
assert.strictEqual(proSuspensoCreditoAdmin.assinaturaStatus, "suspensa", "credito Admin nao simula pagamento");
assert.strictEqual(proSuspensoCreditoAdmin.pagamentoUltimoStatus, "vencido_sem_pagamento", "credito Admin nao altera historico financeiro");
assert.strictEqual(proSuspensoCreditoAdmin.auditoriaAssinatura.length, 1, "credito Admin nao cria evento financeiro falso");
assert.strictEqual(
  saas.renovarCreditosPorPlano(proSuspensoCreditoAdmin, planoPro, new Date("2026-08-20T00:01:00Z")).motivo,
  "credito_admin_manual_vigente",
  "renovador nao pode zerar imediatamente credito Admin em conta suspensa"
);
assert.strictEqual(proSuspensoCreditoAdmin.creditos, 500);
assert.strictEqual(saas.creditoAdminManualAtivo(proSuspensoCreditoAdmin, new Date("2026-08-21T00:00:00Z")), true);

assert.strictEqual(
  saas.renovarCreditosPorPlano(proSuspensoCreditoAdmin, planoPro, new Date("2026-09-20T00:00:00Z")).motivo,
  "assinatura_suspensa_sem_pagamento",
  "virada da validade Admin deve voltar a respeitar vencimento financeiro"
);
assert.strictEqual(proSuspensoCreditoAdmin.creditos, 0, "saldo Admin residual expira");
assert.strictEqual(proSuspensoCreditoAdmin.creditosAdminManualAtivo, false);

saas.aplicarCreditoManualAdmin({
  usuario: proSuspensoCreditoAdmin,
  plano: planoPro,
  quantidade: 500,
  agora: new Date("2026-09-21T00:00:00Z")
});
const pagamentoAposCreditoAdmin = saas.aplicarPagamentoSimulado(proSuspensoCreditoAdmin, planoPro, {
  estado: "aprovado",
  pagamentoId: "pay_pos_credito_admin",
  agora: new Date("2026-09-22T00:00:00Z")
});
assert.strictEqual(pagamentoAposCreditoAdmin.ok, true);
assert.strictEqual(proSuspensoCreditoAdmin.creditos, 2000, "pagamento posterior repoe saldo do plano sem somar credito Admin");
assert.strictEqual(proSuspensoCreditoAdmin.assinaturaStatus, "ativa");
assert.strictEqual(proSuspensoCreditoAdmin.creditosAdminManualAtivo, false, "pagamento aprovado encerra janela Admin");

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
  saas.sanitizarPlanoPublico(planos.beta).creditos.creditosPorCiclo,
  300,
  "plano publico expoe creditos do ciclo gratuito"
);
assert.strictEqual(saas.sanitizarPlanoPublico(planos.beta).entradaBeta, true, "plano publico expoe identidade estrutural Beta");
assert.strictEqual(saas.sanitizarPlanoPublico(planos.beta).renovacaoCreditos, "sem_renovacao", "plano publico expoe politica estrutural de renovacao");
assert.deepStrictEqual(
  saas.sanitizarPlanoPublico(planos.beta).recursos,
  { whatsapp: true },
  "plano publico expoe apenas recursos publicos habilitados e remove chaves sensiveis"
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
assert.ok(
  rotaAdminUsuarios.includes("inicializarCreditosUsuarioAdminManual"),
  "Criacao manual Admin deve reutilizar helper central de creditos"
);
assert.ok(
  !rotaAdminUsuarios.includes("creditos: Number(body.creditos || 0)"),
  "Criacao manual Admin nao pode gravar zero silencioso antes de consultar plano"
);
assert.ok(
  rotaAdminUsuarios.includes("cadastro_rollback_executado"),
  "Criacao manual Admin deve preservar rollback em falha de persistencia"
);

const rotaLogin = trechoEntre(indexFonte, 'app.post("/login"', 'app.get("/",');
assert.ok(rotaLogin.includes("migrarSenhaLegadaSeNecessario"), "login deve migrar senha legada apos sucesso");
const migracaoSenha = trechoEntre(indexFonte, "async function migrarSenhaLegadaSeNecessario", 'app.post("/login"');
assert.ok(migracaoSenha.includes("delete usuario.senha"), "migracao deve remover senha plaintext legada");
assert.ok(migracaoSenha.includes("salvarUsuarios()"), "migracao deve persistir senhaHash");

const rotaPutUsuario = trechoEntre(indexFonte, 'app.put("/admin/usuarios/:id"', 'app.post("/minha-config"');
assert.ok(rotaPutUsuario.includes("auditoriaCreditos"), "ajuste manual de creditos deve registrar auditoria");
assert.ok(rotaPutUsuario.includes("anterior: creditosAntes"), "auditoria deve guardar saldo anterior");
assert.ok(rotaPutUsuario.includes("novo: usuario.creditos"), "auditoria deve guardar novo saldo");
assert.ok(rotaPutUsuario.includes("planoMudou"), "edicao Admin deve detectar troca de plano");
assert.ok(rotaPutUsuario.includes("aplicarTrocaManualPlanoAdmin"), "troca manual de plano deve reutilizar helper central");
assert.ok(rotaPutUsuario.includes("aplicarCreditoManualAdmin"), "ajuste manual de creditos deve reutilizar helper central de reativacao Admin");
assert.ok(rotaPutUsuario.includes('Object.prototype.hasOwnProperty.call(body, "creditos")'), "edicao sem creditos nao deve forcar override silencioso");

const helperPlano = trechoEntre(indexFonte, "function getPlanoPorNome", "// =============== FUNCAO GERAR LINK AFILIADO SHOPEE");
assert.ok(!helperPlano.includes("planos?.free"), "resolver plano nao deve cair em free hardcoded");

const criacaoPlanos = trechoEntre(indexFonte, "function criarPlanosPadrao", "function normalizarRecursosPlanosRuntime");
assert.ok(!/\b(free|pro|premium|enterprise|ultimate|starter)\b/i.test(criacaoPlanos), "runtime nao deve recriar planos por nome");
assert.ok(!criacaoPlanos.includes("salvarPlanos()"), "runtime nao deve persistir planos padrao automaticamente");

const blocoCreditos = trechoEntre(indexFonte, "// ================= CREDITOS =================", "// ================= FUNCAO SALVA PLANO");
assert.ok(!blocoCreditos.includes("CREDITOS_PLANO"), "creditos nao devem usar mapa estatico");
assert.ok(blocoCreditos.includes("renovarCreditosPorPlano"), "renovacao deve vir do plano");
assert.ok(blocoCreditos.includes("aplicarDebitoConta"), "debito deve atualizar status da conta");
assert.ok(blocoCreditos.includes("function usuarioTemCreditos"), "gate de credito operacional deve continuar centralizado");
assert.ok(blocoCreditos.includes("return Number(usuario.creditos || 0) >= quantidade"), "usuarioTemCreditos deve reconhecer saldo manual vigente");

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
