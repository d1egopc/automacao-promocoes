const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

const helpersPlano = trechoEntre(
  indexFonte,
  "function recursoDestinoPlano",
  "function textoDiscordExecutor"
);
assert.ok(helpersPlano.includes("recurso_nao_disponivel_no_plano"), "backend deve expor codigo estavel para recurso bloqueado");
assert.ok(helpersPlano.includes("limite_do_plano_atingido"), "backend deve expor codigo estavel para limite atingido");
assert.ok(helpersPlano.includes("validarRecursosDestinosPlano"), "POST /destinos deve ter validador central de recurso por canal");
assert.ok(helpersPlano.includes("validarLimiteDestinosPlano"), "POST /destinos deve ter validador central de limite");
assert.ok(helpersPlano.includes("usuario?.limites?.destinos"), "limite de destinos deve considerar usuario.limites.destinos quando existir");
assert.ok(helpersPlano.includes("if (isAdminMaster(req)) return;"), "Admin Master nao deve sofrer bloqueio de plano nos validadores");

const normalizadorDiscord = trechoEntre(
  indexFonte,
  "async function normalizarDestinosContratoComDiscord",
  "function numeroIntervaloValido"
);
assert.ok(
  normalizadorDiscord.includes('throw criarErroRecursoPlano("discord")'),
  "POST /destinos deve preservar bloqueio Discord com contrato estruturado"
);

const rotaTelegram = trechoEntre(indexFonte, 'app.post("/telegram"', "function textoTelegram");
assert.ok(rotaTelegram.includes('usuarioTemRecurso(req, "telegram")'), "POST /telegram deve bloquear plano sem Telegram");
assert.ok(rotaTelegram.includes('criarErroRecursoPlano("telegram")'), "POST /telegram deve retornar recurso telegram estruturado");

const rotaDestinos = trechoEntre(indexFonte, 'app.post("/destinos"', 'app.delete("/destinos/:id"');
assert.ok(rotaDestinos.includes("normalizarDestinosContratoComDiscord"), "POST /destinos deve continuar normalizando/validando Discord");
assert.ok(rotaDestinos.includes("destinosAtuais"), "POST /destinos deve comparar lista atual para distinguir criacao de edicao");
assert.ok(rotaDestinos.includes("validarRecursosDestinosPlano"), "POST /destinos deve bloquear canais sem recurso");
assert.ok(rotaDestinos.includes("validarLimiteDestinosPlano"), "POST /destinos deve aplicar limite real de destinos");
assert.ok(rotaDestinos.includes("payloadErroPlano"), "POST /destinos deve devolver contrato de erro estruturado");

const rotaSessoes = trechoEntre(indexFonte, 'app.post("/sessoes"', 'app.delete("/sessoes/:id"');
assert.ok(rotaSessoes.includes('usuarioTemRecurso(req, "whatsapp")'), "POST /sessoes deve bloquear plano sem WhatsApp");
assert.ok(rotaSessoes.includes('criarErroRecursoPlano("whatsapp")'), "POST /sessoes deve retornar recurso whatsapp estruturado");
assert.ok(rotaSessoes.includes('codigo: "limite_do_plano_atingido"'), "POST /sessoes deve estruturar limite de sessoes");
assert.ok(rotaSessoes.includes('recurso: "sessoes"'), "limite de sessoes deve continuar sendo contrato de sessoes WhatsApp");

const rotaConectar = trechoEntre(indexFonte, 'app.post("/conectar"', 'app.post("/grupos/:id/refresh"');
assert.ok(rotaConectar.includes('usuarioTemRecurso(req, "whatsapp")'), "POST /conectar deve bloquear plano sem WhatsApp");
assert.ok(rotaConectar.includes('codigo: "limite_do_plano_atingido"'), "POST /conectar deve estruturar limite de sessoes");
assert.ok(rotaConectar.includes("atual:"), "POST /conectar deve informar quantidade atual");

assert.ok(discordRoutesFonte.includes("function erroRecursoDiscordPlano"), "rotas Discord devem ter payload estruturado local");
assert.strictEqual(
  (discordRoutesFonte.match(/erroRecursoDiscordPlano\(\)/g) || []).length,
  4,
  "Discord deve usar payload estruturado nos tres gates existentes"
);
assert.ok(discordRoutesFonte.includes('codigo: "recurso_nao_disponivel_no_plano"'), "Discord deve retornar codigo estavel");
assert.ok(discordRoutesFonte.includes('recurso: "discord"'), "Discord deve retornar recurso discord");

console.log("ux-planos-v2-2a-backend.test.js OK");
