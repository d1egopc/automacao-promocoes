function textoId(valor = "") {
  return String(valor || "").trim();
}

function chaveTelegram(valor = "") {
  return textoId(valor).toLowerCase();
}

function idsTelegramRegistro(item = {}) {
  return [
    item.id,
    item.telegramId,
    item.botId,
    item.conexaoId,
    item.chatId,
    item.chat_id,
    item.nome,
    item.apelido,
    item.canal,
    item.grupo,
    item.label,
    item.titulo
  ].map(chaveTelegram).filter(Boolean);
}

function idsTelegramDestino(destino = {}) {
  const selecionados = Array.isArray(destino.telegramDestinos)
    ? destino.telegramDestinos
    : Array.isArray(destino.telegramIds)
      ? destino.telegramIds
      : [];

  return [
    ...selecionados,
    destino.telegramId,
    destino.botId,
    destino.conexaoId,
    destino.sessao,
    destino.grupo,
    destino.chatId,
    destino.chat_id,
    destino.canal
  ].map(chaveTelegram).filter(Boolean);
}

function normalizarTelegram(item = {}, origem = "config") {
  if (!item || typeof item !== "object") return null;

  const botToken = textoId(item.botToken || item.bot_token || item.token);
  const chatId = textoId(item.chatId || item.chat_id || item.canal || item.grupo);

  if (!botToken && !chatId) return null;

  return {
    ...item,
    origem,
    botToken,
    chatId,
    id: textoId(item.id || item.telegramId || item.botId || chatId || item.nome),
    nome: textoId(item.nome || item.apelido || item.label || item.titulo || chatId),
    ativo: item.ativo !== false
  };
}

function adicionarTelegram(lista, item, origem) {
  if (origem === "destino") {
    const token = textoId(item?.botToken || item?.bot_token || item?.token);
    const chatId = textoId(item?.chatId || item?.chat_id || item?.canal || item?.grupo);
    if (!token || !chatId) return;
  }

  const tel = normalizarTelegram(item, origem);
  if (tel) lista.push(tel);
}

function coletarTelegramsCliente({
  clienteId = "admin",
  destino = {},
  configsPorCliente = {},
  integracoesPorCliente = {},
  configGlobal = {}
}) {
  const lista = [];
  const configCliente = configsPorCliente?.[clienteId] || {};

  for (const item of Array.isArray(configCliente.telegram?.destinos) ? configCliente.telegram.destinos : []) {
    adicionarTelegram(lista, item, "configsPorCliente.telegram.destinos");
  }

  const credenciais = integracoesPorCliente?.[clienteId]?.telegram?.credenciais;
  adicionarTelegram(lista, credenciais, "integracoesPorCliente.telegram.credenciais");

  adicionarTelegram(lista, destino, "destino");

  if (clienteId === "admin") {
    for (const item of Array.isArray(configGlobal?.telegram?.destinos) ? configGlobal.telegram.destinos : []) {
      adicionarTelegram(lista, item, "config.telegram.destinos");
    }
  }

  const porChave = new Map();
  for (const tel of lista) {
    const chave = chaveTelegram(tel.id || tel.chatId || tel.nome);
    if (!chave || porChave.has(chave)) continue;
    porChave.set(chave, tel);
  }

  return [...porChave.values()];
}

function resolverTelegramsDestino(opcoes = {}) {
  const telegrams = coletarTelegramsCliente(opcoes);
  const idsDestino = idsTelegramDestino(opcoes.destino || {});

  let selecionados = idsDestino.length
    ? telegrams.filter(tel => idsTelegramRegistro(tel).some(id => idsDestino.includes(id)))
    : telegrams.filter(tel => tel.ativo !== false);
  let usouFallbackAtivos = false;

  if (!selecionados.length && idsDestino.length) {
    selecionados = telegrams.filter(tel => tel.ativo !== false);
    usouFallbackAtivos = selecionados.length > 0;
  }

  return {
    telegrams,
    idsDestino,
    selecionados: selecionados.filter(tel => tel.ativo !== false),
    usouFallbackAtivos
  };
}

function logTelegramEnvio(dados = {}) {
  console.log("[TELEGRAM-ENVIO]", {
    clienteId: dados.clienteId,
    fluxo: dados.fluxo || "",
    destinoId: dados.destinoId || "",
    destinoEncontrado: !!dados.destinoEncontrado,
    tipoDestino: dados.tipoDestino || "",
    tokenEncontrado: !!dados.tokenEncontrado,
    canalIdEncontrado: !!dados.canalIdEncontrado,
    grupoIdEncontrado: !!dados.grupoIdEncontrado,
    telegramConfiguradoEncontrado: !!dados.telegramConfiguradoEncontrado,
    telegramsEncontrados: dados.telegramsEncontrados || 0,
    fallbackAtivos: !!dados.fallbackAtivos,
    motivoRecusa: dados.motivoRecusa || ""
  });
}

module.exports = {
  resolverTelegramsDestino,
  logTelegramEnvio
};
