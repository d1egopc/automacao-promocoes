function texto(valor = "") {
  return String(valor ?? "").trim();
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function tipoDestino(destino = {}) {
  return texto(destino.tipo).toLowerCase() === "telegram" ? "telegram" : "whatsapp";
}

function destinoId(destino = {}) {
  return texto(destino.id || destino.destinoId || destino.value);
}

function nomeDestino(destino = {}) {
  return texto(destino.nome || destino.titulo || destino.label || destino.destino || destinoId(destino));
}

function conexaoWhatsapp(destino = {}) {
  return texto(destino.conexaoId || destino.sessao || destino.sessaoId || destino.idSessao);
}

function grupoWhatsapp(destino = {}) {
  return texto(destino.grupo || destino.chatId || destino.canal || lista(destino.gruposWhatsapp)[0]);
}

function chatIdDestino(destino = {}) {
  return texto(
    destino.chatId ||
    destino.grupoId ||
    destino.canalId ||
    destino.channelId ||
    destino.grupo ||
    destino.canal ||
    lista(destino.telegramDestinos)[0]
  );
}

function chavesTelegram(destino = {}) {
  return [
    destino.id,
    destino.botId,
    destino.telegramId,
    destino.destinoId,
    destino.nome,
    destino.apelido,
    destino.username,
    destino.chatId,
    destino.grupoId,
    destino.canalId,
    destino.channelId,
    destino.grupo,
    destino.canal
  ].map(texto).filter(Boolean);
}

function normalizarTelegramInterno(telegram = {}) {
  const botToken = texto(telegram.botToken || telegram.token || telegram.telegramToken);
  const chatId = texto(telegram.chatId || telegram.grupoId || telegram.canalId || telegram.channelId || telegram.grupo || telegram.canal);
  return {
    ativo: telegram.ativo !== false,
    botToken,
    chatId,
    chaves: chavesTelegram(telegram)
  };
}

function listarDestinosCliente(destinosPorCliente = {}, clienteId = "admin") {
  const origem = destinosPorCliente?.[clienteId];
  if (Array.isArray(origem)) return origem;
  if (origem && typeof origem === "object") {
    return Object.values(origem).flatMap((item) => Array.isArray(item) ? item : []);
  }
  return [];
}

function listarTelegramsCliente(configsPorCliente = {}, clienteId = "admin") {
  const destinos = configsPorCliente?.[clienteId]?.telegram?.destinos;
  return lista(destinos).map(normalizarTelegramInterno);
}

function planoPermite(plano = {}, recurso = "") {
  if (!plano || typeof plano !== "object") return true;
  if (!plano.recursos || typeof plano.recursos !== "object") return true;
  return plano.recursos[recurso] === true;
}

function sessaoWhatsappAberta(sessoes = {}, statusSessao = {}, conexaoId = "") {
  const id = texto(conexaoId);
  if (!id || !sessoes?.[id]) return false;
  const status = texto(statusSessao?.[id]).toLowerCase();
  return !status || status === "open" || status === "aberto";
}

function resolverTelegramDestino(destino = {}, telegrams = []) {
  const chavesDestino = new Set([
    ...chavesTelegram(destino),
    ...lista(destino.telegramDestinos).flatMap((item) =>
      item && typeof item === "object" ? chavesTelegram(item) : [texto(item)].filter(Boolean)
    )
  ]);

  if (!chavesDestino.size) return null;

  return telegrams.find((telegram) =>
    telegram.chaves.some((chave) => chavesDestino.has(chave)) ||
    (telegram.chatId && chavesDestino.has(telegram.chatId))
  ) || null;
}

function destinoVisualSeguro(destino = {}) {
  const tipo = tipoDestino(destino);
  if (tipo === "telegram") {
    return texto(destino.nome || destino.titulo || destino.label || destino.apelido || destino.username || "Canal Telegram");
  }
  return grupoWhatsapp(destino);
}

function motivoIndisponivel(destino = {}, contexto = {}) {
  const tipo = tipoDestino(destino);
  if (destino.ativo === false) return "Destino inativo";

  if (tipo === "whatsapp") {
    if (!planoPermite(contexto.plano, "whatsapp")) return "Canal indisponivel no plano atual";
    const conexaoId = conexaoWhatsapp(destino);
    if (!conexaoId) return "Sessao WhatsApp nao definida";
    if (!grupoWhatsapp(destino)) return "Grupo WhatsApp nao definido";
    if (!contexto.sessoes?.[conexaoId]) return "Sessao WhatsApp desconectada";
    if (!sessaoWhatsappAberta(contexto.sessoes, contexto.statusSessao, conexaoId)) {
      return "Sessao WhatsApp desconectada";
    }
    return "";
  }

  if (!planoPermite(contexto.plano, "telegram")) return "Canal indisponivel no plano atual";
  const telegram = resolverTelegramDestino(destino, contexto.telegrams || []);
  const chatId = telegram?.chatId || chatIdDestino(destino);
  if (!telegram || !telegram.ativo || !telegram.botToken || !chatId) {
    return "Telegram nao configurado";
  }
  return "";
}

function sanitizarDestinoManualV2(destino = {}, contexto = {}) {
  const motivo = motivoIndisponivel(destino, contexto);
  const id = destinoId(destino);
  return {
    id,
    nome: nomeDestino(destino),
    tipo: tipoDestino(destino),
    ativo: destino.ativo !== false,
    utilizavel: Boolean(id && !motivo),
    motivoIndisponivel: id ? motivo : "Destino sem identificador",
    identificacaoVisual: destinoVisualSeguro(destino)
  };
}

function listarDestinosManuaisV2(clienteId = "admin", deps = {}) {
  const cliente = texto(clienteId) || "admin";
  const destinos = listarDestinosCliente(deps.destinosPorCliente || {}, cliente);
  const contexto = {
    plano: deps.plano || {},
    sessoes: deps.sessoes || {},
    statusSessao: deps.statusSessao || {},
    telegrams: listarTelegramsCliente(deps.configsPorCliente || {}, cliente)
  };

  return destinos
    .filter((destino) => destino && typeof destino === "object")
    .map((destino) => sanitizarDestinoManualV2(destino, contexto));
}

module.exports = {
  listarDestinosManuaisV2,
  sanitizarDestinoManualV2
};
