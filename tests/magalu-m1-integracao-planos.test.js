"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "magalu-m1-"));

const {
  marketplaceRules,
  validarIntegracao,
  mascararIntegracao
} = require("../utils/integracoes");
const {
  credencialFingerprintIntegracao,
  obterSaudeIntegracaoAtual,
  registrarResultadoSaudeIntegracao,
  reiniciarSaudeIntegracaoSeCredencialMudou
} = require("../utils/alertas-integracoes");
const {
  testarIntegracaoMarketplace
} = require("../utils/testar-integracao-marketplace");

const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const trechoSalvarIntegracao = indexFonte.slice(
  indexFonte.indexOf('app.post("/integracoes/:marketplace"'),
  indexFonte.indexOf('app.delete("/integracoes/:marketplace"', indexFonte.indexOf('app.post("/integracoes/:marketplace"'))
);
const trechoSalvarPlano = indexFonte.slice(
  indexFonte.indexOf('app.post("/admin/planos"'),
  indexFonte.indexOf("function confirmacaoExclusaoValida", indexFonte.indexOf('app.post("/admin/planos"'))
);

assert.deepStrictEqual(marketplaceRules.magalu.required, ["promoterId"], "Magalu deve usar promoterId no contrato existente");
assert.deepStrictEqual(marketplaceRules.magalu.allowed, ["promoterId"], "Magalu deve persistir somente promoterId nesta fase");

const valida = validarIntegracao("magalu", {
  promoterId: " d1egopc ",
  token: "nao-deve-persistir"
});
assert.strictEqual(valida.ok, true, "promoterId deve ser suficiente para salvar Magalu");
assert.deepStrictEqual(valida.clean, { promoterId: "d1egopc" }, "credencial Magalu deve ser sanitizada para promoterId");
assert.deepStrictEqual(
  mascararIntegracao(valida.clean),
  { promoterId: "••••••••••••••••" },
  "reveal/masking deve seguir o mecanismo atual"
);

assert.ok(
  trechoSalvarPlano.includes("marketplaces: Array.isArray(body.marketplaces)") &&
    trechoSalvarPlano.includes("? body.marketplaces"),
  "Admin deve conseguir gravar a lista dinamica de marketplaces do plano, incluindo magalu"
);
assert.ok(
  trechoSalvarIntegracao.includes("const liberados = plano?.marketplaces || []") &&
    trechoSalvarIntegracao.includes("!liberados.includes(marketplace)") &&
    trechoSalvarIntegracao.includes("return res.status(403)"),
  "Backend deve continuar autoridade e bloquear integracao quando o plano nao libera o marketplace"
);
assert.ok(
  !trechoSalvarIntegracao.includes("magalu") &&
    !trechoSalvarPlano.includes("magalu") &&
    !trechoSalvarPlano.includes("premium"),
  "Gate de Magalu nao deve hardcodar nome de plano nem regra especial"
);

const clienteId = "cliente_magalu_m1";
const configA = { credenciais: { promoterId: "d1egopc" } };
const configB = { credenciais: { promoterId: "outra-loja" } };
const fpA = credencialFingerprintIntegracao("magalu", configA);
const fpB = credencialFingerprintIntegracao("magalu", configB);

assert.ok(fpA.startsWith("sha256:"), "Magalu deve gerar fingerprint");
assert.notStrictEqual(fpA, fpB, "trocar promoterId deve trocar fingerprint");
assert.strictEqual(
  obterSaudeIntegracaoAtual(clienteId, "magalu", configA).status,
  "desconhecida",
  "campo preenchido nao deve virar verde automaticamente"
);

registrarResultadoSaudeIntegracao(clienteId, "magalu", {
  ok: true,
  marketplace: "magalu",
  status: "ok",
  codigo: "ok",
  credencialFingerprint: fpA
}, "manual");
assert.strictEqual(
  obterSaudeIntegracaoAtual(clienteId, "magalu", configA).status,
  "saudavel",
  "saude verde so existe quando ha prova registrada para o fingerprint atual"
);

reiniciarSaudeIntegracaoSeCredencialMudou(clienteId, "magalu", configB);
assert.strictEqual(
  obterSaudeIntegracaoAtual(clienteId, "magalu", configB).status,
  "desconhecida",
  "mudanca de promoterId deve reiniciar saude pelo mecanismo homologado"
);

(async () => {
  const resultado = await testarIntegracaoMarketplace("cliente_magalu_m1", "magalu", configB);
  assert.strictEqual(resultado.ok, false, "teste funcional Magalu ainda nao deve fabricar sucesso");
  assert.strictEqual(resultado.codigo, "teste_magalu_nao_disponivel");
  assert.strictEqual(resultado.saude.status, "desconhecida");

  for (const proibido of [
    "processarFila",
    "adicionarOfertaInicioFila",
    "prepararOfertaGlobal",
    "Distributor",
    "Radar",
    "Oferta Universal"
  ]) {
    assert.ok(!trechoSalvarIntegracao.includes(proibido), `Integracao Magalu M1 nao deve tocar rio automatico: ${proibido}`);
  }

  console.log("magalu-m1-integracao-planos.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
