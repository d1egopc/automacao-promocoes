"use strict";

const MAX_FONTES_ATIVAS = 4;
const STATUS_BUFFER = new Set(["capturada", "processando", "pronta", "encaminhada", "repetida", "erro"]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function erro(codigo = "clonador_grupos_erro", statusCode = 400, detalhes = {}) {
  const e = new Error(codigo);
  e.codigo = codigo;
  e.statusCode = statusCode;
  e.detalhes = detalhes;
  return e;
}

function destinoIdOficial(destino = {}) {
  return texto(destino.id || destino.destinoId);
}

function grupoIdOficial(grupo = {}) {
  return texto(grupo.id || grupo.grupoId || grupo.jid || grupo.remoteJid || grupo.value);
}

function normalizarFonteEntrada(fonte = {}) {
  const sessaoId = texto(fonte.sessaoId || fonte.sessao_id || fonte.sessao || fonte.sessionId);
  const grupoJid = texto(fonte.grupoJid || fonte.grupo_jid || fonte.grupoId || fonte.id || fonte.jid || fonte.remoteJid);
  return {
    sessaoId,
    grupoJid,
    grupoNome: texto(fonte.grupoNome || fonte.grupo_nome || fonte.nome || fonte.name || fonte.subject),
    ativo: fonte.ativo !== false
  };
}

function normalizarDestinoEntrada(valor) {
  return texto(typeof valor === "string" ? valor : valor?.destinoId || valor?.id);
}

function normalizarLinksEntrada(links = []) {
  const vistos = new Set();
  const saida = [];
  for (const link of Array.isArray(links) ? links : []) {
    const valor = texto(link);
    if (!valor || vistos.has(valor)) continue;
    vistos.add(valor);
    saida.push(valor);
  }
  return saida.slice(0, 20);
}

function extrairMensagemInterna(mensagem = {}) {
  let atual = mensagem?.message || mensagem || {};
  for (let i = 0; i < 8; i += 1) {
    if (atual?.ephemeralMessage?.message) {
      atual = atual.ephemeralMessage.message;
      continue;
    }
    if (atual?.viewOnceMessage?.message) {
      atual = atual.viewOnceMessage.message;
      continue;
    }
    if (atual?.viewOnceMessageV2?.message) {
      atual = atual.viewOnceMessageV2.message;
      continue;
    }
    if (atual?.documentWithCaptionMessage?.message) {
      atual = atual.documentWithCaptionMessage.message;
      continue;
    }
    break;
  }
  return atual || {};
}

function extrairTextoMensagemBasico(mensagem = {}) {
  const conteudo = extrairMensagemInterna(mensagem);
  return [
    conteudo.conversation,
    conteudo.extendedTextMessage?.text,
    conteudo.imageMessage?.caption,
    conteudo.videoMessage?.caption,
    conteudo.documentMessage?.caption
  ].filter(Boolean).join("\n").trim();
}

function timestampMensagemIso(valor = null) {
  const bruto = typeof valor === "object" && valor !== null && typeof valor.toNumber === "function"
    ? valor.toNumber()
    : Number(valor || 0);
  if (!Number.isFinite(bruto) || bruto <= 0) return new Date().toISOString();
  const ms = bruto > 1000000000000 ? bruto : bruto * 1000;
  return new Date(ms).toISOString();
}

function tipoMensagem(conteudo = {}) {
  return Object.keys(conteudo || {}).find(chave => Boolean(conteudo[chave])) || "";
}

function metadadosSegurosMensagem(mensagem = {}, extras = {}) {
  const conteudo = extrairMensagemInterna(mensagem);
  const tipo = tipoMensagem(conteudo);
  return {
    origem: "whatsapp",
    participant: texto(mensagem?.key?.participant || mensagem?.participant),
    pushName: texto(mensagem?.pushName),
    fromMe: mensagem?.key?.fromMe === true,
    tipoMensagem: tipo,
    messageTimestamp: mensagem?.messageTimestamp || null,
    midia: {
      presente: Boolean(conteudo.imageMessage || conteudo.videoMessage || conteudo.documentMessage || conteudo.audioMessage || conteudo.stickerMessage),
      tipo: conteudo.imageMessage ? "image" : conteudo.videoMessage ? "video" : conteudo.documentMessage ? "document" : conteudo.audioMessage ? "audio" : conteudo.stickerMessage ? "sticker" : ""
    },
    ...extras
  };
}

function deduplicarFontes(fontes = []) {
  const mapa = new Map();
  for (const fonte of fontes.map(normalizarFonteEntrada)) {
    if (!fonte.sessaoId || !fonte.grupoJid) {
      throw erro("fonte_incompleta", 400);
    }
    mapa.set(`${fonte.sessaoId}|${fonte.grupoJid}`, fonte);
  }
  return [...mapa.values()];
}

function deduplicarDestinos(destinoIds = []) {
  return [...new Set(destinoIds.map(normalizarDestinoEntrada).filter(Boolean))];
}

function criarServicoClonadorGrupos(deps = {}) {
  const repo = deps.repository;
  if (!repo) throw new Error("repository_obrigatorio");

  function clienteAtual(req) {
    const clienteId = typeof deps.getClienteId === "function"
      ? deps.getClienteId(req)
      : req?.clienteId || req?.usuario?.id || "";
    return texto(clienteId);
  }

  function exigirCliente(req) {
    const clienteId = clienteAtual(req);
    if (!clienteId) throw erro("workspace_nao_identificada", 401);
    return clienteId;
  }

  function exigirFeature(req) {
    const permitido = typeof deps.usuarioTemRecurso === "function"
      ? deps.usuarioTemRecurso(req, "clonador_grupos")
      : req?.usuario?.papel === "admin_master";
    if (!permitido) throw erro("recurso_nao_disponivel_no_plano", 403, { recurso: "clonador_grupos" });
  }

  function clienteTemFeatureRuntime(clienteId) {
    if (typeof deps.clienteTemRecurso === "function") {
      return deps.clienteTemRecurso(clienteId, "clonador_grupos") === true;
    }
    return false;
  }

  function listarSessoesWorkspace(clienteId) {
    const lista = typeof deps.listarSessoesWorkspace === "function"
      ? deps.listarSessoesWorkspace(clienteId)
      : [];
    return (Array.isArray(lista) ? lista : [])
      .map(sessao => typeof sessao === "string" ? sessao : sessao?.id || sessao?.sessaoId)
      .map(texto)
      .filter(Boolean);
  }

  async function listarGruposSessao(clienteId, sessaoId) {
    const lista = typeof deps.listarGruposSessao === "function"
      ? await deps.listarGruposSessao(clienteId, sessaoId)
      : [];
    return (Array.isArray(lista) ? lista : [])
      .map(grupo => ({
        id: grupoIdOficial(grupo),
        grupoJid: grupoIdOficial(grupo),
        nome: texto(grupo.nome || grupo.name || grupo.subject || "Grupo sem nome") || "Grupo sem nome",
        sessaoId
      }))
      .filter(grupo => grupo.grupoJid);
  }

  function listarDestinosWorkspace(clienteId) {
    const lista = typeof deps.listarDestinosOficiais === "function"
      ? deps.listarDestinosOficiais(clienteId)
      : [];
    return (Array.isArray(lista) ? lista : [])
      .map(destino => ({
        id: destinoIdOficial(destino),
        destinoId: destinoIdOficial(destino),
        nome: texto(destino.nome || destino.label || destino.destinoNome || "Destino"),
        tipo: texto(destino.tipo || destino.canal),
        ativo: destino.ativo !== false
      }))
      .filter(destino => destino.destinoId);
  }

  async function validarFonte(clienteId, fonte) {
    const sessoes = listarSessoesWorkspace(clienteId);
    if (!sessoes.includes(fonte.sessaoId)) {
      throw erro("sessao_fora_workspace", 403, { sessaoId: fonte.sessaoId });
    }

    const grupos = await listarGruposSessao(clienteId, fonte.sessaoId);
    const grupo = grupos.find(item => item.grupoJid === fonte.grupoJid);
    if (!grupo) {
      throw erro("grupo_fora_sessao_workspace", 403, {
        sessaoId: fonte.sessaoId,
        grupoJid: fonte.grupoJid
      });
    }

    return {
      ...fonte,
      grupoNome: fonte.grupoNome || grupo.nome
    };
  }

  async function obterConfig(req) {
    exigirFeature(req);
    const clienteId = exigirCliente(req);
    const config = await repo.lerConfig(clienteId);
    return { ok: true, config };
  }

  async function salvarConfig(req, body = {}) {
    exigirFeature(req);
    const clienteId = exigirCliente(req);
    const config = await repo.salvarConfig(clienteId, { ativo: body.ativo === true });
    return { ok: true, config };
  }

  async function obterGruposDisponiveis(req, sessaoFiltro = "") {
    exigirFeature(req);
    const clienteId = exigirCliente(req);
    const sessoes = listarSessoesWorkspace(clienteId);
    const filtro = texto(sessaoFiltro);
    if (filtro && !sessoes.includes(filtro)) {
      throw erro("sessao_fora_workspace", 403, { sessaoId: filtro });
    }

    const alvoSessoes = filtro ? [filtro] : sessoes;
    const gruposPorSessao = [];
    for (const sessaoId of alvoSessoes) {
      gruposPorSessao.push({
        sessaoId,
        grupos: await listarGruposSessao(clienteId, sessaoId)
      });
    }

    return {
      ok: true,
      sessoes: alvoSessoes,
      grupos: gruposPorSessao.flatMap(item => item.grupos),
      gruposPorSessao
    };
  }

  async function listarFontes(req) {
    exigirFeature(req);
    const clienteId = exigirCliente(req);
    return { ok: true, fontes: await repo.listarFontes(clienteId) };
  }

  async function salvarFontes(req, body = {}) {
    exigirFeature(req);
    const clienteId = exigirCliente(req);
    const fontesEntrada = Array.isArray(body.fontes) ? body.fontes : [];
    const fontes = deduplicarFontes(fontesEntrada);
    const ativas = fontes.filter(fonte => fonte.ativo !== false);
    if (ativas.length > MAX_FONTES_ATIVAS) {
      throw erro("limite_fontes_ativas_excedido", 400, {
        limite: MAX_FONTES_ATIVAS,
        atual: ativas.length
      });
    }

    const validadas = [];
    for (const fonte of fontes) {
      validadas.push(await validarFonte(clienteId, fonte));
    }

    return { ok: true, fontes: await repo.substituirFontes(clienteId, validadas) };
  }

  async function listarDestinosElegiveis(req) {
    exigirFeature(req);
    const clienteId = exigirCliente(req);
    return { ok: true, destinos: listarDestinosWorkspace(clienteId) };
  }

  async function listarDestinosSelecionados(req) {
    exigirFeature(req);
    const clienteId = exigirCliente(req);
    return { ok: true, destinos: await repo.listarDestinos(clienteId) };
  }

  async function salvarDestinos(req, body = {}) {
    exigirFeature(req);
    const clienteId = exigirCliente(req);
    const destinoIdsEntrada = Array.isArray(body.destinoIds)
      ? body.destinoIds
      : (Array.isArray(body.destinos) ? body.destinos : []);
    const destinoIds = deduplicarDestinos(destinoIdsEntrada);
    const oficiais = new Set(listarDestinosWorkspace(clienteId).map(destino => destino.destinoId));
    const invalidos = destinoIds.filter(destinoId => !oficiais.has(destinoId));
    if (invalidos.length) {
      throw erro("destino_fora_workspace", 403, { destinoIds: invalidos });
    }

    return { ok: true, destinos: await repo.substituirDestinos(clienteId, destinoIds) };
  }

  async function listarBuffer(req, query = {}) {
    exigirFeature(req);
    const clienteId = exigirCliente(req);
    const status = texto(query.status).toLowerCase();
    if (status && !STATUS_BUFFER.has(status)) throw erro("status_buffer_invalido", 400, { status });
    return {
      ok: true,
      itens: await repo.listarBuffer(clienteId, {
        status,
        limit: query.limit
      })
    };
  }

  async function capturarMensagemWhatsapp(entrada = {}) {
    const logger = deps.logger || console;
    const clienteId = texto(entrada.clienteId);
    const sessaoId = texto(entrada.sessaoId);
    const mensagem = entrada.mensagem || {};
    const grupoJid = texto(entrada.grupoJid || mensagem?.key?.remoteJid);
    const mensagemId = texto(entrada.mensagemId || mensagem?.key?.id);

    try {
      if (!clienteId || !sessaoId) return { ok: true, capturada: false, motivo: "workspace_ou_sessao_ausente" };
      if (!grupoJid.endsWith("@g.us")) return { ok: true, capturada: false, motivo: "nao_grupo" };
      if (mensagem?.key?.fromMe === true) return { ok: true, capturada: false, motivo: "mensagem_propria" };
      if (!mensagemId) return { ok: true, capturada: false, motivo: "mensagem_id_ausente" };
      if (!clienteTemFeatureRuntime(clienteId)) return { ok: true, capturada: false, motivo: "recurso_indisponivel" };

      const config = await repo.lerConfig(clienteId);
      if (config?.ativo !== true) return { ok: true, capturada: false, motivo: "config_inativa" };

      const fontes = await repo.listarFontes(clienteId);
      const fonte = fontes.find(item =>
        item?.ativo !== false &&
        texto(item.sessaoId) === sessaoId &&
        texto(item.grupoJid) === grupoJid
      );
      if (!fonte) return { ok: true, capturada: false, motivo: "fonte_nao_selecionada" };

      const textoExtraido = typeof deps.extrairTextoMensagem === "function"
        ? deps.extrairTextoMensagem(mensagem)
        : extrairTextoMensagemBasico(mensagem);
      const textoOriginal = String(textoExtraido ?? "");
      const links = typeof deps.extrairLinksMensagem === "function"
        ? normalizarLinksEntrada(deps.extrairLinksMensagem(textoOriginal))
        : normalizarLinksEntrada(String(textoOriginal || "").match(/https?:\/\/[^\s]+/g) || []);
      const metadata = metadadosSegurosMensagem(mensagem, entrada.metadata || {});
      const grupoNome = texto(entrada.grupoNome || fonte.grupoNome);

      const resultado = await repo.inserirBufferCaptura({
        clienteId,
        sessaoId,
        grupoJid,
        grupoNome,
        mensagemId,
        textoOriginal,
        links,
        capturadoEm: entrada.capturadoEm || timestampMensagemIso(mensagem.messageTimestamp),
        status: "capturada",
        metadata
      });

      if (resultado.inserido && typeof logger.log === "function") {
        logger.log("[CLONADOR-CAPTURA]", JSON.stringify({
          clienteId,
          sessaoId,
          grupoJid,
          mensagemId,
          links: links.length,
          tamanhoTexto: textoOriginal.length
        }));
      }

      return {
        ok: true,
        capturada: resultado.inserido === true,
        motivo: resultado.inserido ? "capturada" : "duplicada",
        item: resultado.item
      };
    } catch (e) {
      if (typeof logger.log === "function") {
        logger.log("[CLONADOR-CAPTURA-IGNORADA]", JSON.stringify({
          clienteId,
          sessaoId,
          grupoJid,
          mensagemId,
          motivo: e.codigo || e.message || "erro_captura"
        }));
      }
      return { ok: false, capturada: false, motivo: e.codigo || e.message || "erro_captura" };
    }
  }

  return {
    obterConfig,
    salvarConfig,
    obterGruposDisponiveis,
    listarFontes,
    salvarFontes,
    listarDestinosElegiveis,
    listarDestinosSelecionados,
    salvarDestinos,
    listarBuffer,
    capturarMensagemWhatsapp
  };
}

module.exports = {
  MAX_FONTES_ATIVAS,
  criarServicoClonadorGrupos,
  destinoIdOficial,
  grupoIdOficial
};
