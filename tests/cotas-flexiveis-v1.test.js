const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  normalizarLimitesPlano,
  dentroDoLimite,
  limiteAtingido,
  avaliarMarketplacePlano
} = require("../utils/cotas-flexiveis-planos");

const raiz = path.resolve(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
const discordRoutesFonte = fs.readFileSync(path.join(raiz, "modules/discord/discord.routes.js"), "utf8");

function trechoEntre(fonte, inicio, fim) {
  const ini = fonte.indexOf(inicio);
  assert.ok(ini >= 0, `trecho inicial nao encontrado: ${inicio}`);
  const end = fonte.indexOf(fim, ini + inicio.length);
  assert.ok(end > ini, `trecho final nao encontrado: ${fim}`);
  return fonte.slice(ini, end);
}

function assertUsoConexoes({ whatsapp = 0, telegram = 0, discord = 0, limite, esperado, mensagem }) {
  const total = whatsapp + telegram + discord;
  assert.strictEqual(dentroDoLimite(total, limite), esperado, mensagem);
}

const legado = normalizarLimitesPlano({
  limites: { sessoes: 2 },
  marketplaces: ["mercadolivre", "amazon", "shopee"]
});
assert.strictEqual(legado.maxConexoes, 2, "plano legado deve promover sessoes para maxConexoes");
assert.strictEqual(legado.sessoes, 2, "plano legado deve preservar espelho sessoes");
assert.strictEqual(legado.maxMarketplacesSelecionados, 3, "plano legado deve usar marketplaces liberados como fallback");
const canonico = normalizarLimitesPlano({ limites: { maxConexoes: 6, sessoes: 2 }, marketplaces: [] });
assert.strictEqual(canonico.maxConexoes, 6, "maxConexoes deve ser autoridade canonica");
assert.strictEqual(canonico.sessoes, 6, "sessoes legado deve espelhar maxConexoes quando o campo novo existe");

assertUsoConexoes({ whatsapp: 2, limite: 2, esperado: true, mensagem: "2 WA com limite 2 deve caber" });
assert.ok(limiteAtingido(2, 2), "2/2 deve bloquear terceira conexao");
assertUsoConexoes({ telegram: 2, limite: 2, esperado: true, mensagem: "2 Telegram com limite 2 deve caber" });
assertUsoConexoes({ whatsapp: 1, telegram: 1, limite: 2, esperado: true, mensagem: "1 WA + 1 Telegram com limite 2 deve caber" });
assertUsoConexoes({ whatsapp: 1, telegram: 1, discord: 1, limite: 3, esperado: true, mensagem: "combinacao com Discord permitido deve somar na cota unica" });
assertUsoConexoes({ whatsapp: 1, telegram: 1, discord: 1, limite: 2, esperado: false, mensagem: "terceiro canal deve exceder 2/2" });

const liberados = ["mercadolivre", "amazon", "shopee", "aliexpress", "awin"];
const selecionados = ["mercadolivre", "amazon", "shopee"];
assert.deepStrictEqual(
  avaliarMarketplacePlano({ marketplace: "aliexpress", liberados, selecionados, limite: 3 }).codigo,
  "limite_do_plano_atingido",
  "quarto marketplace deve ser recusado por limite"
);
assert.strictEqual(
  avaliarMarketplacePlano({ marketplace: "amazon", liberados, selecionados, limite: 3 }).ok,
  true,
  "edicao de marketplace ja selecionado nao deve consumir vaga"
);
assert.strictEqual(
  avaliarMarketplacePlano({ marketplace: "aliexpress", liberados, selecionados: ["mercadolivre", "amazon"], limite: 3 }).ok,
  true,
  "troca/remocao deve liberar vaga para outro marketplace"
);
assert.deepStrictEqual(
  avaliarMarketplacePlano({ marketplace: "magalu", liberados, selecionados: [], limite: 3 }).codigo,
  "recurso_nao_disponivel_no_plano",
  "marketplace OFF deve continuar bloqueado por recurso"
);

const helpers = trechoEntre(indexFonte, "function obterLimitesPlanoReq", "function obterLimiteDestinosReq");
assert.ok(helpers.includes("contarConexoesWorkspace"), "backend deve ter autoridade unica de contagem de conexoes");
assert.ok(helpers.includes("listarSessoesWhatsappCota"), "contagem deve incluir WhatsApp");
assert.ok(helpers.includes("listarTelegramsCota"), "contagem deve incluir Telegram");
assert.ok(helpers.includes("listarDiscordCota"), "contagem deve incluir Discord");
assert.ok(helpers.includes("validarNovaConexaoReq"), "criacao deve validar cota compartilhada");
assert.ok(helpers.includes("validarCotaTelegramReq"), "Telegram deve validar lista pretendida sem duplicar edicao");
assert.ok(helpers.includes("validarCotaDiscordCliente"), "Discord deve validar guild pretendida sem duplicar reconexao");

const rotaMe = trechoEntre(indexFonte, 'app.get("/me"', "// ================= INTEGRAÇÕES");
assert.ok(rotaMe.includes("limitesPlanoAtual"), "/me deve expor limites normalizados");
assert.ok(rotaMe.includes("conexoes: usoConexoes.total"), "/me deve expor consumo.conexoes");
assert.ok(rotaMe.includes("marketplacesSelecionados: marketplacesSelecionados.length"), "/me deve expor consumo.marketplacesSelecionados");
assert.ok(rotaMe.includes("sessoes: usoConexoes.whatsapp"), "/me deve preservar consumo.sessoes legado");

const rotaAdmin = trechoEntre(indexFonte, 'app.post("/admin/planos"', 'app.delete("/admin/planos/:nome"');
assert.ok(rotaAdmin.includes("maxConexoes"), "Admin deve salvar maxConexoes");
assert.ok(rotaAdmin.includes("maxMarketplacesSelecionados"), "Admin deve salvar maxMarketplacesSelecionados");
assert.ok(rotaAdmin.includes("sessoes: maxConexoes"), "Admin deve preservar sessoes como espelho legado");

const rotaSessoes = trechoEntre(indexFonte, 'app.post("/sessoes"', 'app.delete("/sessoes/:id"');
assert.ok(rotaSessoes.includes("validarNovaConexaoReq"), "POST /sessoes deve usar cota compartilhada");

const rotaTelegram = trechoEntre(indexFonte, 'app.post("/telegram"', "function textoTelegram");
assert.ok(rotaTelegram.includes("validarCotaTelegramReq(req, destinos)"), "POST /telegram deve validar lista pretendida");

const rotaIntegracoes = trechoEntre(indexFonte, 'app.post("/integracoes/:marketplace"', 'app.delete("/integracoes/:marketplace"');
assert.ok(rotaIntegracoes.includes("validarMarketplacePlanoReq"), "POST /integracoes deve usar autoridade de plano/limite");
assert.ok(rotaIntegracoes.includes("payloadErroPlano"), "POST /integracoes deve retornar erro estruturado");

assert.ok(discordRoutesFonte.includes("validarCotaConexaoDiscord"), "Discord deve receber validador de cota");
assert.ok(discordRoutesFonte.includes("validarCotaConexaoDiscord(clienteId, dados?.guildId)"), "Discord deve validar antes de salvar guild");

console.log("cotas-flexiveis-v1.test.js OK");
