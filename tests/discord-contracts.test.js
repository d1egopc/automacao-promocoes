const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  normalizarCanal
} = require("../modules/templates-clientes/resolver");
const {
  sanitizarDestinoManualV2
} = require("../modules/manual-v2/manual-destinations");
const {
  normalizarDestinoAgendadoManualV2
} = require("../modules/manual-v2/manual-offers.contract");
const {
  sanitizarDestinoAgendado
} = require("../modules/manual-v2/manual-offers.storage");

const raiz = path.resolve(__dirname, "..");
const ler = (relativo) => fs.readFileSync(path.join(raiz, relativo), "utf8");

assert.strictEqual(normalizarCanal("whatsapp"), "whatsapp", "WhatsApp deve continuar WhatsApp");
assert.strictEqual(normalizarCanal("telegram"), "telegram", "Telegram deve continuar Telegram");
assert.strictEqual(normalizarCanal("discord"), "discord", "Discord nao deve ser normalizado como WhatsApp");
assert.strictEqual(normalizarCanal("", { tipo: "discord" }), "discord", "Destino Discord deve preservar canal no template");

const destinoDiscordBloqueadoPlano = sanitizarDestinoManualV2(
  { id: "dest_discord", nome: "Discord teste", tipo: "discord", ativo: true },
  { plano: { recursos: { discord: false, whatsapp: true, telegram: true } } }
);
assert.strictEqual(destinoDiscordBloqueadoPlano.tipo, "discord", "Manual V2 deve preservar tipo Discord");
assert.strictEqual(destinoDiscordBloqueadoPlano.utilizavel, false, "Discord sem plano deve ficar indisponivel");
assert.strictEqual(destinoDiscordBloqueadoPlano.motivoIndisponivel, "Canal indisponivel no plano atual");

const destinoDiscordSemSender = sanitizarDestinoManualV2(
  { id: "dest_discord", nome: "Discord teste", tipo: "discord", ativo: true },
  { plano: { recursos: { discord: true, whatsapp: true, telegram: true } } }
);
assert.strictEqual(destinoDiscordSemSender.tipo, "discord", "Manual V2 deve preservar Discord mesmo com plano liberado");
assert.strictEqual(destinoDiscordSemSender.utilizavel, false, "Discord sem sender real deve ficar indisponivel");
assert.strictEqual(destinoDiscordSemSender.motivoIndisponivel, "Envio Discord indisponivel");

const destinoDiscordOperacional = sanitizarDestinoManualV2(
  { id: "dest_discord", nome: "Discord teste", tipo: "discord", ativo: true, conexaoId: "discord_a", channelId: "canal_a" },
  {
    plano: { recursos: { discord: true, whatsapp: true, telegram: true } },
    discordSenderDisponivel: true,
    discordConexoes: [{ id: "discord_a", guildName: "Servidor A", ativo: true }],
    discordCanaisPorConexao: {
      discord_a: [{ id: "canal_a", nome: "ofertas", utilizavel: true }]
    }
  }
);
assert.strictEqual(destinoDiscordOperacional.utilizavel, true, "D6 deve liberar Discord operacional somente com conexao/canal/sender");
assert.strictEqual(destinoDiscordOperacional.identificacaoVisual, "Servidor A #ofertas");

assert.strictEqual(
  sanitizarDestinoManualV2(
    { id: "wa", nome: "WA", tipo: "whatsapp", grupo: "grupo@g.us", conexaoId: "sessao", ativo: true },
    {
      plano: { recursos: { whatsapp: true } },
      sessoes: { sessao: {} },
      statusSessao: { sessao: "open" }
    }
  ).tipo,
  "whatsapp",
  "WhatsApp deve seguir reconhecido"
);
assert.strictEqual(
  sanitizarDestinoManualV2(
    { id: "tg", nome: "TG", tipo: "telegram", chatId: "-100", ativo: true },
    {
      plano: { recursos: { telegram: true } },
      telegrams: [{ ativo: true, botToken: "token_teste", chatId: "-100", chaves: ["tg", "-100"] }]
    }
  ).tipo,
  "telegram",
  "Telegram deve seguir reconhecido"
);

assert.strictEqual(
  normalizarDestinoAgendadoManualV2({ id: "d1", tipo: "discord" }).tipo,
  "discord",
  "Snapshot de agendamento deve preservar Discord"
);
assert.strictEqual(
  sanitizarDestinoAgendado({ id: "d1", tipo: "discord" }).tipo,
  "discord",
  "Storage Manual V2 deve preservar Discord em snapshots sanitizados"
);

const indexFonte = ler("index.js");
assert.ok(indexFonte.includes('discord: booleanPlano("discord"'), "Admin/backend deve persistir recurso discord pelo mecanismo de planos");
assert.ok(indexFonte.includes("discord: false"), "Planos padrao devem conhecer discord sem liberar por hardcode");
assert.ok(indexFonte.includes('app.use("/discord", criarRotasDiscord'), "D2 deve registrar rotas Discord pelo modulo isolado");
assert.ok(indexFonte.includes("validarDestinoDiscord"), "D3 deve validar destino Discord no backend");
assert.ok(indexFonte.includes('req.path === "/discord/callback"'), "Callback Discord deve ser liberado pelo auth via state assinado");
assert.ok(!/DISCORD_BOT_TOKEN|discord\.com\/api/i.test(indexFonte), "Index nao deve conter token/API Discord direto");

for (const [arquivo, fonte] of [
  ["manual-destinations", ler("modules/manual-v2/manual-destinations.js")],
  ["templates-resolver", ler("modules/templates-clientes/resolver.js")]
]) {
  assert.ok(!/processarFila|adicionarOfertaInicioFila|prepararOfertaGlobal|Distributor|Oferta Universal|fila\.json|manual-dispatcher|manual-scheduler/i.test(fonte), `${arquivo} nao deve tocar rio automatico`);
}

const manualDispatcher = ler("modules/manual-v2/manual-dispatcher.js");
assert.ok(manualDispatcher.includes("enviarDiscord"), "D6 deve chamar sender Discord somente pelo dispatcher Manual V2");
assert.ok(!/processarFila|adicionarOfertaInicioFila|prepararOfertaGlobal|Distributor|Radar|Engine|Oferta Universal|fila\.json|enviarParaDestinoInteligente|enviarCampanhaManual/i.test(manualDispatcher), "manual-dispatcher nao deve tocar rio automatico");

const discordRoutes = ler("modules/discord/discord.routes.js");
assert.ok(discordRoutes.includes("enviarDiscord"), "D5 deve permitir teste tecnico chamando somente o sender Discord");
assert.ok(discordRoutes.includes("MENSAGEM_TESTE_DISCORD"), "D5 deve usar mensagem fixa de teste");
assert.ok(!/processarFila|adicionarOfertaInicioFila|prepararOfertaGlobal|Distributor|Radar|Oferta Universal|fila\.json|manual-v2|manual-dispatcher|manual-scheduler|credito|creditos/i.test(discordRoutes), "discord-routes nao deve tocar rio automatico/manual/credito");

for (const [arquivo, fonte] of [
  ["discord-storage", ler("modules/discord/discord-connections.storage.js")],
  ["discord-channels", ler("modules/discord/discord-channels.js")],
  ["discord-oauth-state", ler("modules/discord/discord-oauth-state.storage.js")],
  ["discord-oauth", ler("modules/discord/discord-oauth.js")]
]) {
  assert.ok(!/processarFila|adicionarOfertaInicioFila|prepararOfertaGlobal|Distributor|Radar|Oferta Universal|fila\.json|enviarDiscord|sendMessage|manual-dispatcher|manual-scheduler/i.test(fonte), `${arquivo} nao deve tocar envio/rio automatico`);
}

const discordSender = ler("modules/discord/discord-sender.js");
assert.ok(!/processarFila|adicionarOfertaInicioFila|prepararOfertaGlobal|Distributor|Radar|Engine|Oferta Universal|manual-v2|manual-dispatcher|credito|creditos|fila\.json/i.test(discordSender), "discord-sender deve permanecer primitivo");

console.log("discord-contracts.test.js OK");
