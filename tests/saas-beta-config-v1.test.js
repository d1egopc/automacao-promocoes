"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const saas = require("../utils/saas-fundacao");

const raiz = path.resolve(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
const saasFonte = fs.readFileSync(path.join(raiz, "utils", "saas-fundacao.js"), "utf8");

function trechoEntreFonte(fonte, inicio, fim) {
  const ini = fonte.indexOf(inicio);
  assert.ok(ini >= 0, `trecho inicial nao encontrado: ${inicio}`);
  const end = fonte.indexOf(fim, ini + inicio.length);
  assert.ok(end > ini, `trecho final nao encontrado: ${fim}`);
  return fonte.slice(ini, end);
}

function trechoEntre(inicio, fim) {
  return trechoEntreFonte(indexFonte, inicio, fim);
}

const configNormalizada = saas.normalizarSaasConfig({
  betaAtivo: "true",
  cadastroPublicoAtivo: "false",
  maxContasFreeBeta: "7",
  textoBeta: "  Beta controlado  ",
  seloBeta: "  BETA  "
});

assert.deepStrictEqual(configNormalizada, {
  betaAtivo: true,
  cadastroPublicoAtivo: false,
  maxContasFreeBeta: 7,
  textoBeta: "Beta controlado",
  seloBeta: "BETA"
}, "normalizacao SaaS/Beta deve preservar somente contrato publico global");

const usuarios = [
  { id: "u_publico_ok", ativo: true, origemCadastro: "publico", statusConta: "ativo", plano: "Teste Unico" },
  { id: "u_esgotado", ativo: true, origemCadastro: "publico", statusConta: "teste_esgotado", plano: "Teste Unico" },
  { id: "u_interno", ativo: true, origemCadastro: "admin/teste", statusConta: "ativo", plano: "Teste Unico" },
  { id: "u_ciclo", ativo: true, origemCadastro: "publico", statusConta: "ativo", plano: "Pago Ciclo" },
  { id: "u_inativo", ativo: false, origemCadastro: "publico", statusConta: "ativo", plano: "Teste Unico" }
];
const planos = {
  unico: { nome: "Teste Unico", creditosModelo: "unicos", limites: { creditosUnicos: 300 } },
  ciclo: { nome: "Pago Ciclo", creditosModelo: "ciclo", limites: { creditosPorCiclo: 2000 } }
};
const vagas = saas.contarVagasFreeBeta({ usuarios, planos, maxContasFreeBeta: 3 });
assert.deepStrictEqual(vagas, { ocupadas: 1, disponiveis: 2, max: 3 }, "vaga Free Beta deve ser calculada por contrato unicos e ignorar teste esgotado");

const blocoConfig = trechoEntre("function obterConfigSaasAtual", "const executarCadastroSaasSerializado");
assert.ok(blocoConfig.includes("config.saas || config.beta || {}"), "leitura deve reaproveitar config.saas e legado config.beta");
assert.ok(blocoConfig.includes("payloadSaasConfigPublico"), "deve existir payload publico sanitizado");
assert.ok(blocoConfig.includes("payloadSaasConfigAdmin"), "deve existir payload Admin agregado");
assert.ok(blocoConfig.includes("maxContasFreeBeta: saasConfig.maxContasFreeBeta"), "Admin deve receber maxContasFreeBeta editavel");
assert.ok(blocoConfig.includes("contarVagasFreeBetaAtual"), "vagas devem vir da autoridade backend");

const rotaGetAdmin = trechoEntre('app.get("/admin/saas-config"', 'app.put("/admin/saas-config"');
assert.ok(rotaGetAdmin.includes("exigirAdminMasterEstrito"), "GET /admin/saas-config deve exigir Admin Master estrito");
assert.ok(rotaGetAdmin.includes("payloadSaasConfigAdmin()"), "GET Admin deve retornar payload agregado");

const rotaPutAdmin = trechoEntre('app.put("/admin/saas-config"', 'app.post("/admin/assinaturas/:usuarioId/pagamento-simulado"');
assert.ok(rotaPutAdmin.includes("exigirAdminMasterEstrito"), "PUT /admin/saas-config deve exigir Admin Master estrito");
assert.ok(rotaPutAdmin.includes("normalizarSaasConfigAdminInput"), "PUT deve normalizar contrato global");
assert.ok(rotaPutAdmin.includes("config.saas = proxima"), "PUT deve persistir em config.saas sem storage paralelo");
assert.ok(rotaPutAdmin.includes("salvarConfig()"), "PUT deve salvar config global existente");
assert.ok(!/usuarios\s*:/i.test(rotaPutAdmin), "PUT nao deve retornar dados de usuarios");
assert.ok(!/senha|senhaHash|tokenHash|accessToken|refreshToken/i.test(rotaPutAdmin), "rota SaaS/Beta nao deve expor segredos");

const blocoPublico = trechoEntre('app.get("/public/saas-config"', 'app.get("/public/planos"');
assert.ok(blocoPublico.includes("payloadSaasConfigPublico()"), "/public/saas-config deve continuar usando payload sanitizado");
assert.ok(!blocoPublico.includes("maxContasFreeBeta"), "publico nao deve expor campo admin direto fora de vagasFree.max");
assert.ok(!/usuarios|senha|token|segredo/i.test(blocoPublico), "publico nao deve expor usuarios ou segredos");

const blocoCadastro = trechoEntreFonte(saasFonte, "function validarCadastro", "function validarCadastroPublico");
assert.ok(blocoCadastro.includes("!saasConfig.cadastroPublicoAtivo"), "cadastro publico deve continuar fechado pela flag global");
assert.ok(blocoCadastro.includes("!planoSaas.visivelPublicamente"), "plano oculto continua fora da contratacao publica");
assert.ok(blocoCadastro.includes("!planoSaas.contratavel || planoSaas.emBreve"), "plano nao contratavel/em breve continua bloqueado");

const blocoInterno = trechoEntre('app.post("/admin/cadastro-interno"', 'app.get("/admin/saas-config"');
assert.ok(blocoInterno.includes("executarCadastroInternoAdminAtomico"), "cadastro interno Admin deve permanecer separado da flag publica");
assert.ok(blocoInterno.includes("exigirAdminMasterEstrito"), "cadastro interno continua protegido");

console.log("saas-beta-config-v1.test.js OK");
