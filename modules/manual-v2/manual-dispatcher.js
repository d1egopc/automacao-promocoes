const {
  buscarOfertaManualV2
} = require("./manual-offers.storage");
const {
  listarDestinosManuaisV2
} = require("./manual-destinations");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function agoraIso(deps = {}) {
  return typeof deps.now === "function" ? deps.now() : new Date().toISOString();
}

function destinoId(destino = {}) {
  return texto(destino.id || destino.destinoId || destino.value);
}

function tipoDestino(destino = {}) {
  const tipo = texto(destino.tipo).toLowerCase();
  if (tipo === "telegram") return "telegram";
  if (tipo === "discord") return "discord";
  return "whatsapp";
}

function nomeDestino(destino = {}) {
  return texto(destino.nome || destino.titulo || destino.label || destino.destino || destinoId(destino));
}

function listarDestinosCliente(destinosPorCliente = {}, clienteId = "admin") {
  const origem = destinosPorCliente?.[clienteId];
  if (Array.isArray(origem)) return origem;
  if (origem && typeof origem === "object") {
    return Object.values(origem).flatMap((item) => Array.isArray(item) ? item : []);
  }
  return [];
}

function conexaoWhatsapp(destino = {}) {
  return texto(destino.conexaoId || destino.sessao || destino.sessaoId || destino.idSessao);
}

function grupoWhatsapp(destino = {}) {
  return texto(destino.grupo || destino.chatId || destino.canal || lista(destino.gruposWhatsapp)[0]);
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

function listarTelegramsCliente(configsPorCliente = {}, clienteId = "admin") {
  return lista(configsPorCliente?.[clienteId]?.telegram?.destinos)
    .map(normalizarTelegramInterno);
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

function resultadoErro({ destinoId = "", nome = "", tipo = "", erro = "", enviadoEm = "" } = {}) {
  return {
    destinoId,
    nome,
    tipo,
    status: "erro",
    enviadoEm,
    erro: texto(erro) || "Erro ao enviar"
  };
}

function resultadoSucesso({ destinoId = "", nome = "", tipo = "", enviadoEm = "" } = {}) {
  return {
    destinoId,
    nome,
    tipo,
    status: "enviado",
    enviadoEm,
    erro: ""
  };
}

function adaptarOfertaManualParaTemplate(oferta = {}) {
  const linkFinal = texto(oferta.urlAfiliada || oferta.urlOriginal);
  return {
    ...oferta,
    nome: texto(oferta.titulo || oferta.nome),
    titulo: texto(oferta.titulo || oferta.nome),
    preco: texto(oferta.precoAtual || oferta.preco),
    precoAtual: texto(oferta.precoAtual || oferta.preco),
    precoAntigo: texto(oferta.precoAnterior || oferta.precoAntigo || oferta.precoOriginal),
    precoOriginal: texto(oferta.precoAnterior || oferta.precoOriginal || oferta.precoAntigo),
    link: linkFinal,
    linkAfiliado: linkFinal,
    linkFinal,
    categoriaProduto: texto(oferta.categoria || oferta.categoriaProduto),
    origem: "manual_v2",
    manualV2: true
  };
}

function montarMensagemManualV2(oferta = {}, destino = {}, deps = {}) {
  const entradaTemplate = adaptarOfertaManualParaTemplate(oferta);
  if (typeof deps.montarMensagemOferta === "function") {
    return deps.montarMensagemOferta(entradaTemplate, {
      clienteId: oferta.clienteId,
      destino,
      canal: tipoDestino(destino),
      plano: deps.plano || {}
    });
  }

  return [
    entradaTemplate.titulo,
    entradaTemplate.precoAtual ? `Por: ${entradaTemplate.precoAtual}` : "",
    entradaTemplate.linkFinal
  ].filter(Boolean).join("\n");
}

async function enviarWhatsappManual({ destino, oferta, mensagem, deps }) {
  const conexaoId = conexaoWhatsapp(destino);
  const grupo = grupoWhatsapp(destino);
  const sock = deps.sessoes?.[conexaoId];
  if (!sock) throw new Error("Sessao WhatsApp desconectada");
  if (!grupo) throw new Error("Grupo WhatsApp nao definido");
  if (typeof deps.enviarWhatsApp !== "function") throw new Error("Primitiva WhatsApp indisponivel");

  await deps.enviarWhatsApp({
    sock,
    grupo,
    mensagem,
    midia: texto(oferta.imagem) ? { origem: "imagemUrl", imagemUrl: texto(oferta.imagem) } : null,
    corrigirImagemUrl: deps.corrigirImagemUrl || ((url) => url)
  });
}

async function enviarTelegramManual({ destino, mensagem, deps, clienteId }) {
  const telegram = resolverTelegramDestino(destino, listarTelegramsCliente(deps.configsPorCliente || {}, clienteId));
  if (!telegram || !telegram.ativo || !telegram.botToken || !telegram.chatId) {
    throw new Error("Telegram nao configurado");
  }
  if (typeof deps.enviarTelegram !== "function") throw new Error("Primitiva Telegram indisponivel");

  await deps.enviarTelegram({
    httpClient: deps.httpClient,
    tel: {
      botToken: telegram.botToken,
      chatId: telegram.chatId
    },
    mensagem,
    midia: null,
    corrigirImagemUrl: deps.corrigirImagemUrl || ((url) => url)
  });
}

function criarRetornoBase(ok = false, ofertaId = "", erro = "") {
  return {
    ok,
    ofertaId,
    enviados: 0,
    erros: erro ? 1 : 0,
    creditosDebitados: 0,
    resultados: erro ? [resultadoErro({ erro })] : []
  };
}

async function enviarOfertaManualV2({ clienteId = "admin", ofertaId = "", destinosIds = [] } = {}, deps = {}) {
  const cliente = texto(clienteId) || "admin";
  const idOferta = texto(ofertaId);
  const idsSolicitados = lista(destinosIds).map(texto).filter(Boolean);

  if (!idsSolicitados.length) {
    return criarRetornoBase(false, idOferta, "Nenhum destino selecionado");
  }

  const buscarOferta = deps.buscarOfertaManualV2 || buscarOfertaManualV2;
  const oferta = buscarOferta(cliente, idOferta, deps.storageOptions || {});
  if (!oferta) {
    return criarRetornoBase(false, idOferta, "Oferta Manual V2 nao encontrada");
  }

  const plano = typeof deps.resolverPlanoManualV2 === "function"
    ? deps.resolverPlanoManualV2(cliente)
    : deps.plano || {};
  const destinosOriginais = listarDestinosCliente(deps.destinosPorCliente || {}, cliente);
  const destinosSanitizados = listarDestinosManuaisV2(cliente, {
    destinosPorCliente: deps.destinosPorCliente || {},
    configsPorCliente: deps.configsPorCliente || {},
    sessoes: deps.sessoes || {},
    statusSessao: deps.statusSessao || {},
    plano
  });
  const mapaOriginal = new Map(destinosOriginais.map((destino) => [destinoId(destino), destino]));
  const mapaSanitizado = new Map(destinosSanitizados.map((destino) => [destino.id, destino]));

  const retorno = criarRetornoBase(true, oferta.id || idOferta);
  const usuarioTemCreditos = typeof deps.usuarioTemCreditos === "function"
    ? deps.usuarioTemCreditos
    : () => true;
  const debitarCreditos = typeof deps.debitarCreditos === "function"
    ? deps.debitarCreditos
    : () => true;

  for (const destinoIdSolicitado of idsSolicitados) {
    const destinoSeguro = mapaSanitizado.get(destinoIdSolicitado);
    const destino = mapaOriginal.get(destinoIdSolicitado);
    const destinoBase = {
      destinoId: destinoIdSolicitado,
      nome: destinoSeguro?.nome || nomeDestino(destino || {}),
      tipo: destinoSeguro?.tipo || tipoDestino(destino || {})
    };

    if (!destino || !destinoSeguro) {
      retorno.erros += 1;
      retorno.resultados.push(resultadoErro({
        ...destinoBase,
        erro: "Destino nao encontrado"
      }));
      continue;
    }

    if (!destinoSeguro.utilizavel) {
      retorno.erros += 1;
      retorno.resultados.push(resultadoErro({
        ...destinoBase,
        erro: destinoSeguro.motivoIndisponivel || "Destino indisponivel"
      }));
      continue;
    }

    if (!usuarioTemCreditos(cliente, 1)) {
      retorno.erros += 1;
      retorno.resultados.push(resultadoErro({
        ...destinoBase,
        erro: "Sem creditos"
      }));
      continue;
    }

    try {
      const mensagem = montarMensagemManualV2(oferta, destino, { ...deps, plano });
      const tipo = tipoDestino(destino);
      if (tipo === "telegram") {
        await enviarTelegramManual({ destino, mensagem, deps, clienteId: cliente });
      } else if (tipo === "whatsapp") {
        await enviarWhatsappManual({ destino, oferta, mensagem, deps });
      } else {
        throw new Error("Canal Discord ainda nao disponivel");
      }

      const debitou = debitarCreditos(cliente, 1);
      if (!debitou) {
        retorno.erros += 1;
        retorno.resultados.push(resultadoErro({
          ...destinoBase,
          erro: "Falha ao debitar creditos"
        }));
        continue;
      }

      retorno.enviados += 1;
      retorno.creditosDebitados += 1;
      retorno.resultados.push(resultadoSucesso({
        ...destinoBase,
        enviadoEm: agoraIso(deps)
      }));
    } catch (e) {
      retorno.erros += 1;
      retorno.resultados.push(resultadoErro({
        ...destinoBase,
        erro: e.message || "Falha no envio"
      }));
    }
  }

  retorno.ok = retorno.enviados > 0;
  return retorno;
}

module.exports = {
  adaptarOfertaManualParaTemplate,
  enviarOfertaManualV2
};
