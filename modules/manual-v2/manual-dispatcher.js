const {
  buscarOfertaManualV2
} = require("./manual-offers.storage");
const {
  listarDestinosManuaisV2Async,
  listarDestinosCliente
} = require("./manual-destinations");
const {
  normalizarAlvosDestino
} = require("../../utils/destinos-multialvo");
const {
  normalizarModoLinkDestino
} = require("../links/link-optimus");

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

function conexaoWhatsapp(destino = {}) {
  const alvo = normalizarAlvosDestino(destino).find((item) => item.tipo === "whatsapp") || {};
  return texto(alvo.conexaoId || alvo.sessao || destino.conexaoId || destino.sessao || destino.sessaoId || destino.idSessao);
}

function grupoWhatsapp(destino = {}) {
  const alvo = normalizarAlvosDestino(destino).find((item) => item.tipo === "whatsapp") || {};
  return texto(alvo.grupoId || destino.grupo || destino.grupoId || destino.chatId || destino.canal || lista(destino.gruposWhatsapp)[0]);
}

function gruposWhatsappDestino(destino = {}) {
  const alvos = normalizarAlvosDestino(destino)
    .filter((item) => item.tipo === "whatsapp")
    .map((item) => texto(item.grupoId))
    .filter(Boolean);
  if (alvos.length) return alvos;
  return [grupoWhatsapp(destino)].filter(Boolean);
}

function canalDiscord(destino = {}) {
  const alvo = normalizarAlvosDestino(destino).find((item) => item.tipo === "discord") || {};
  return texto(alvo.channelId || alvo.canalId || destino.channelId || destino.canalId || destino.grupo || destino.canal);
}

function imagemDiscordManual(oferta = {}) {
  return texto(
    oferta.imagemCanonicaDuravel ||
    oferta.imagemDuravel ||
    oferta.imagemEnviavel ||
    oferta.imagemMaterializada ||
    oferta.imagemUrl ||
    oferta.imagem
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

function resultadoSucesso({
  destinoId = "",
  nome = "",
  tipo = "",
  enviadoEm = "",
  messageId = "",
  statusHttp = null,
  imagemEnviada
} = {}) {
  const resultado = {
    destinoId,
    nome,
    tipo,
    status: "enviado",
    enviadoEm,
    erro: ""
  };
  const idMensagem = texto(messageId);
  const status = Number(statusHttp || 0) || 0;
  if (idMensagem) resultado.messageId = idMensagem;
  if (status) resultado.statusHttp = status;
  if (typeof imagemEnviada === "boolean") {
    resultado.imagemEnviada = imagemEnviada;
  }
  return resultado;
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

function destinoUsaLinkOptimus(destino = {}) {
  return normalizarModoLinkDestino(destino?.modoLink) === "optimus";
}

function erroLinkOptimusManualV2(motivo = "manual_v2_link_optimus_nao_aplicado") {
  const erro = new Error(motivo);
  erro.codigo = motivo;
  erro.motivo = motivo;
  return erro;
}

function resolverOfertaLinkManualV2({ oferta = {}, destino = {}, clienteId = "admin", plano = null, deps = {} } = {}) {
  const modoOptimus = destinoUsaLinkOptimus(destino);
  if (typeof deps.resolverLinkOfertaPorDestino !== "function") {
    if (modoOptimus) throw erroLinkOptimusManualV2("manual_v2_link_optimus_resolver_indisponivel");
    return oferta;
  }

  let resultado;
  try {
    resultado = deps.resolverLinkOfertaPorDestino({
      oferta,
      destino,
      clienteId,
      plano,
      recursos: plano?.recursos,
      configGlobal: deps.configGlobal
    });
  } catch (_erro) {
    if (modoOptimus) throw erroLinkOptimusManualV2("manual_v2_link_optimus_resolucao_falhou");
    return oferta;
  }

  if (modoOptimus && (resultado?.aplicado !== true || !resultado?.oferta)) {
    throw erroLinkOptimusManualV2("manual_v2_link_optimus_nao_aplicado");
  }

  return resultado?.oferta || oferta;
}

async function enviarWhatsappManual({ destino, oferta, mensagem, deps }) {
  const conexaoId = conexaoWhatsapp(destino);
  const grupos = gruposWhatsappDestino(destino);
  const sock = deps.sessoes?.[conexaoId];
  if (!sock) throw new Error("Sessao WhatsApp desconectada");
  if (!grupos.length) throw new Error("Grupo WhatsApp nao definido");
  if (typeof deps.enviarWhatsApp !== "function") throw new Error("Primitiva WhatsApp indisponivel");

  for (const grupo of grupos) {
    await deps.enviarWhatsApp({
      sock,
      grupo,
      mensagem,
      midia: texto(oferta.imagem) ? { origem: "imagemUrl", imagemUrl: texto(oferta.imagem) } : null,
      corrigirImagemUrl: deps.corrigirImagemUrl || ((url) => url)
    });
  }
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

async function enviarDiscordManual({ destino, oferta, mensagem, deps }) {
  const channelId = canalDiscord(destino);
  if (!channelId) throw new Error("Canal Discord nao definido");
  if (typeof deps.enviarDiscord !== "function") throw new Error("Primitiva Discord indisponivel");

  const resultado = await deps.enviarDiscord({
    channelId,
    mensagem,
    imagemUrl: imagemDiscordManual(oferta),
    env: deps.env || process.env,
    httpClient: deps.httpClient,
    now: deps.now
  });

  if (!resultado?.ok) {
    throw new Error(resultado?.erro || "discord_envio_falhou");
  }

  const messageId = texto(resultado.messageId);
  const statusHttp = Number(resultado.statusHttp || 0) || 0;
  if (statusHttp < 200 || statusHttp >= 300) {
    throw new Error("discord_status_http_invalido");
  }
  if (!messageId) {
    throw new Error("discord_resposta_sem_message_id");
  }

  return {
    messageId,
    statusHttp,
    imagemEnviada: Boolean(resultado.imagemEnviada)
  };
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

function destinosPorClienteAtual(deps = {}) {
  if (typeof deps.getDestinosPorCliente === "function") {
    return deps.getDestinosPorCliente() || {};
  }
  return deps.destinosPorCliente || {};
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
  const destinosPorCliente = destinosPorClienteAtual(deps);
  const destinosOriginais = listarDestinosCliente(destinosPorCliente, cliente);
  const destinosSanitizados = await listarDestinosManuaisV2Async(cliente, {
    destinosPorCliente,
    configsPorCliente: deps.configsPorCliente || {},
    sessoes: deps.sessoes || {},
    statusSessao: deps.statusSessao || {},
    plano,
    discordConexoes: deps.discordConexoes || [],
    discordConexoesPorCliente: deps.discordConexoesPorCliente || {},
    discordCanaisPorConexao: deps.discordCanaisPorConexao || {},
    listarConexoesDiscord: deps.listarConexoesDiscord,
    listarCanaisDiscord: deps.listarCanaisDiscord,
    enviarDiscord: deps.enviarDiscord,
    discordSenderDisponivel: deps.discordSenderDisponivel,
    env: deps.env,
    httpClient: deps.httpClient
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
      const ofertaParaMensagem = resolverOfertaLinkManualV2({
        oferta,
        destino,
        clienteId: cliente,
        plano,
        deps
      });
      const mensagem = montarMensagemManualV2(ofertaParaMensagem, destino, { ...deps, plano });
      const tipo = tipoDestino(destino);
      let detalhesEnvio = {};
      if (tipo === "telegram") {
        await enviarTelegramManual({ destino, mensagem, deps, clienteId: cliente });
      } else if (tipo === "whatsapp") {
        await enviarWhatsappManual({ destino, oferta: ofertaParaMensagem, mensagem, deps });
      } else if (tipo === "discord") {
        detalhesEnvio = await enviarDiscordManual({ destino, oferta: ofertaParaMensagem, mensagem, deps });
      } else {
        throw new Error("Canal indisponivel");
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
        enviadoEm: agoraIso(deps),
        ...detalhesEnvio
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
  imagemDiscordManual,
  enviarOfertaManualV2
};
