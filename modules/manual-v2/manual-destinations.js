function texto(valor = "") {
  return String(valor ?? "").trim();
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function tipoDestino(destino = {}) {
  const tipo = texto(destino.tipo).toLowerCase();
  if (tipo === "telegram") return "telegram";
  if (tipo === "discord") return "discord";
  return "whatsapp";
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

function conexaoDiscord(destino = {}) {
  return texto(destino.conexaoId || destino.sessao || destino.idConexao);
}

function canalDiscord(destino = {}) {
  return texto(destino.channelId || destino.canalId || destino.grupo || destino.canal);
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

function destinoUnitarioReconhecivel(destino = {}) {
  if (!destino || typeof destino !== "object" || Array.isArray(destino)) return false;
  const id = destinoId(destino);
  const tipo = texto(destino.tipo);
  const nome = nomeDestino(destino);
  const conexao = texto(destino.conexaoId || destino.sessao || destino.sessaoId || destino.idSessao || destino.idConexao);
  const alvo = texto(
    destino.channelId ||
    destino.canalId ||
    destino.chatId ||
    destino.grupoId ||
    destino.grupo ||
    destino.canal ||
    lista(destino.gruposWhatsapp)[0] ||
    lista(destino.telegramDestinos)[0]
  );

  if (id && (tipo || nome || conexao || alvo)) return true;
  if (tipo && (nome || conexao || alvo)) return true;
  if (conexao && alvo) return true;
  return false;
}

function listarDestinosCliente(destinosPorCliente = {}, clienteId = "admin") {
  const origem = destinosPorCliente?.[clienteId];
  if (Array.isArray(origem)) return origem;
  if (origem && typeof origem === "object") {
    const destinos = [];
    const vistos = new Set();
    const adicionar = (destino, chave = "") => {
      if (!destinoUnitarioReconhecivel(destino)) return;
      const dedupe = destinoId(destino) || texto(chave);
      if (dedupe) {
        if (vistos.has(dedupe)) return;
        vistos.add(dedupe);
      }
      destinos.push(destino);
    };

    for (const [chave, item] of Object.entries(origem)) {
      if (Array.isArray(item)) {
        for (const destino of item) adicionar(destino, chave);
      } else {
        adicionar(item, chave);
      }
    }

    return destinos;
  }
  return [];
}

function listarTelegramsCliente(configsPorCliente = {}, clienteId = "admin") {
  const destinos = configsPorCliente?.[clienteId]?.telegram?.destinos;
  return lista(destinos).map(normalizarTelegramInterno);
}

function listarDiscordConexoesCliente(deps = {}, clienteId = "admin") {
  if (Array.isArray(deps.discordConexoes)) return deps.discordConexoes;
  const origem = deps.discordConexoesPorCliente?.[clienteId];
  if (Array.isArray(origem)) return origem;
  return [];
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

function resolverDiscordConexao(destino = {}, contexto = {}) {
  const id = conexaoDiscord(destino);
  if (!id) return null;
  return lista(contexto.discordConexoes).find((conexao) => texto(conexao.id) === id) || null;
}

function canaisDiscordDaConexao(conexaoId = "", contexto = {}) {
  const mapa = contexto.discordCanaisPorConexao || {};
  const canais = mapa[texto(conexaoId)];
  return Array.isArray(canais) ? canais : null;
}

function resolverCanalDiscord(destino = {}, contexto = {}) {
  const conexaoId = conexaoDiscord(destino);
  const channelId = canalDiscord(destino);
  if (!conexaoId || !channelId) return null;
  const canais = canaisDiscordDaConexao(conexaoId, contexto);
  if (!canais) return null;
  return canais.find((canal) => texto(canal.id) === channelId) || null;
}

function destinoVisualSeguro(destino = {}, contexto = {}) {
  const tipo = tipoDestino(destino);
  if (tipo === "telegram") {
    return texto(destino.nome || destino.titulo || destino.label || destino.apelido || destino.username || "Canal Telegram");
  }
  if (tipo === "discord") {
    const conexao = resolverDiscordConexao(destino, contexto) || {};
    const canalResolvido = resolverCanalDiscord(destino, contexto) || {};
    const servidor = texto(destino.guildName || destino.servidorNome || destino.servidor || conexao.guildName);
    const canal = texto(destino.channelName || destino.grupoNome || destino.canalNome || canalResolvido.nome);
    if (servidor && canal) return `${servidor} #${canal}`;
    if (canal) return `#${canal}`;
    return texto(destino.nome || destino.titulo || destino.label || "Canal Discord");
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

  if (tipo === "discord") {
    if (!planoPermite(contexto.plano, "discord")) return "Canal indisponivel no plano atual";
    if (contexto.discordSenderDisponivel !== true) return "Envio Discord indisponivel";
    const conexaoId = conexaoDiscord(destino);
    const channelId = canalDiscord(destino);
    if (!conexaoId) return "Servidor Discord nao definido";
    if (!channelId) return "Canal Discord nao definido";
    const conexao = resolverDiscordConexao(destino, contexto);
    if (!conexao) return "Servidor Discord nao encontrado";
    if (conexao.ativo === false) return "Servidor Discord desconectado";
    const canais = canaisDiscordDaConexao(conexaoId, contexto);
    if (!canais) return "Canal Discord nao validado";
    const canal = resolverCanalDiscord(destino, contexto);
    if (!canal) return "Canal Discord nao encontrado";
    if (canal.utilizavel !== true) {
      return texto(canal.motivoIndisponivel) || "Canal Discord indisponivel";
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
    identificacaoVisual: destinoVisualSeguro(destino, contexto)
  };
}

function listarDestinosManuaisV2(clienteId = "admin", deps = {}) {
  const cliente = texto(clienteId) || "admin";
  const destinos = listarDestinosCliente(deps.destinosPorCliente || {}, cliente);
  const contexto = {
    plano: deps.plano || {},
    sessoes: deps.sessoes || {},
    statusSessao: deps.statusSessao || {},
    telegrams: listarTelegramsCliente(deps.configsPorCliente || {}, cliente),
    discordConexoes: listarDiscordConexoesCliente(deps, cliente),
    discordCanaisPorConexao: deps.discordCanaisPorConexao || {},
    discordSenderDisponivel: deps.discordSenderDisponivel === true || typeof deps.enviarDiscord === "function"
  };

  return destinos
    .filter((destino) => destino && typeof destino === "object")
    .map((destino) => sanitizarDestinoManualV2(destino, contexto));
}

async function resolverContextoDiscordManualV2(clienteId = "admin", destinos = [], deps = {}) {
  const cliente = texto(clienteId) || "admin";
  const contexto = {
    discordConexoes: listarDiscordConexoesCliente(deps, cliente),
    discordCanaisPorConexao: { ...(deps.discordCanaisPorConexao || {}) },
    discordSenderDisponivel: deps.discordSenderDisponivel === true || typeof deps.enviarDiscord === "function"
  };

  if (typeof deps.listarConexoesDiscord === "function") {
    try {
      const conexoes = deps.listarConexoesDiscord(cliente, deps.discordStorageOptions || {});
      if (Array.isArray(conexoes)) contexto.discordConexoes = conexoes;
    } catch (_e) {
      contexto.discordConexoes = [];
    }
  }

  if (typeof deps.listarCanaisDiscord !== "function") return contexto;

  const conexoesPorId = new Map(lista(contexto.discordConexoes).map((conexao) => [texto(conexao.id), conexao]));
  const idsConexao = new Set(
    lista(destinos)
      .filter((destino) => tipoDestino(destino) === "discord")
      .map(conexaoDiscord)
      .filter(Boolean)
  );

  for (const conexaoId of idsConexao) {
    if (Object.prototype.hasOwnProperty.call(contexto.discordCanaisPorConexao, conexaoId)) continue;
    const conexao = conexoesPorId.get(conexaoId);
    if (!conexao || conexao.ativo === false || !texto(conexao.guildId)) {
      contexto.discordCanaisPorConexao[conexaoId] = [];
      continue;
    }

    try {
      const canais = await deps.listarCanaisDiscord({
        guildId: conexao.guildId,
        env: deps.env || process.env,
        httpClient: deps.httpClient
      });
      contexto.discordCanaisPorConexao[conexaoId] = Array.isArray(canais) ? canais : [];
    } catch (_e) {
      contexto.discordCanaisPorConexao[conexaoId] = [];
    }
  }

  return contexto;
}

async function listarDestinosManuaisV2Async(clienteId = "admin", deps = {}) {
  const cliente = texto(clienteId) || "admin";
  const destinos = listarDestinosCliente(deps.destinosPorCliente || {}, cliente);
  const discordContexto = await resolverContextoDiscordManualV2(cliente, destinos, deps);
  return listarDestinosManuaisV2(cliente, {
    ...deps,
    discordConexoes: discordContexto.discordConexoes,
    discordCanaisPorConexao: discordContexto.discordCanaisPorConexao,
    discordSenderDisponivel: discordContexto.discordSenderDisponivel
  });
}

module.exports = {
  listarDestinosManuaisV2,
  listarDestinosManuaisV2Async,
  resolverContextoDiscordManualV2,
  sanitizarDestinoManualV2
};
