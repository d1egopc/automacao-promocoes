"use strict";

const { createHash } = require("node:crypto");
const janelasTraceIngresso = new Map();

function listenerCountSeguro(ev, evento) {
  if (!ev || !evento) return null;
  if (typeof ev.listenerCount === "function") return ev.listenerCount(evento);
  if (typeof ev.listeners === "function") return ev.listeners(evento).length;
  return null;
}

function criarEstadoListeners(sock) {
  if (!sock || typeof sock !== "object") return {};
  if (!sock.__optimusListeners || typeof sock.__optimusListeners !== "object") {
    Object.defineProperty(sock, "__optimusListeners", {
      value: {},
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return sock.__optimusListeners;
}

function marcarSocketAtual({ sessoes = {}, geracoes = {}, sessaoId = "", sock, logger = console, motivo = "" } = {}) {
  if (!sessaoId || !sock) {
    return { ok: false, motivo: "sessao_ou_socket_ausente" };
  }

  const socketGeracao = Number(geracoes[sessaoId] || 0) + 1;
  geracoes[sessaoId] = socketGeracao;

  Object.defineProperty(sock, "__optimusSocketGeracao", {
    value: socketGeracao,
    enumerable: false,
    configurable: true,
    writable: true
  });

  sessoes[sessaoId] = sock;

  logger?.log?.("[WHATSAPP-SOCKET-ATUAL]", JSON.stringify({
    sessaoId,
    socketGeracao,
    motivo: motivo || "socket_atualizado"
  }));

  return { ok: true, socketGeracao };
}

function socketEhAtual(sessoes = {}, sessaoId = "", sock) {
  return Boolean(sessaoId && sock && sessoes[sessaoId] === sock);
}

function diagnosticarEntradaUpsert({ workspaceId = "", sessaoId = "", socketGeracao = "", messages = [], type = "", logger = console, env = process.env, agoraMs = Date.now() } = {}) {
  if (!workspaceId || !sessaoId || env.OPTIMUS_MENSAGEIRO_V3_DIAGNOSTIC_WORKSPACE !== workspaceId ||
      env.OPTIMUS_MENSAGEIRO_V3_DIAGNOSTIC_SESSION !== sessaoId) return 0;

  const chave = `${workspaceId}:${sessaoId}`;
  let janela = janelasTraceIngresso.get(chave);
  if (!janela || agoraMs - janela.inicio >= 60_000) {
    janela = { inicio: agoraMs, emitidos: 0 };
    janelasTraceIngresso.set(chave, janela);
  }

  const lote = Array.isArray(messages) ? messages : [];
  const tipoEvento = type === "notify" || type === "append" ? type : "outro";
  const totalMensagens = lote.length;
  let registrados = 0;
  for (const mensagem of lote.length ? lote : [null]) {
    if (janela.emitidos >= 120) break;
    try {
      const grupoId = String(mensagem?.key?.remoteJid || "");
      const groupHash = grupoId.endsWith("@g.us")
        ? createHash("sha256").update(grupoId).digest("hex").slice(0, 12)
        : "";
      logger?.warn?.("[MENSAGEIRO-V3-UPSERT-INGRESS]", JSON.stringify({
        workspaceId,
        sessaoId,
        socketGeracao,
        tipoEvento,
        totalMensagens,
        groupHash,
        fromMe: typeof mensagem?.key?.fromMe === "boolean" ? mensagem.key.fromMe : null,
        stage: "listener_entry",
        reason: "before_filters"
      }));
      registrados++;
    } catch (_) {
      // A telemetria nunca pode bloquear o despacho de mensagens.
    } finally {
      janela.emitidos++;
    }
  }
  return registrados;
}

function registrarListenerUnicoSocket({
  sock,
  evento = "",
  chave = "",
  handler,
  logger = console,
  sessaoId = "",
  socketGeracao = "",
  motivoRegistro = ""
} = {}) {
  if (!sock?.ev || typeof sock.ev.on !== "function" || !evento || typeof handler !== "function") {
    return { ok: false, registrado: false, motivo: "socket_ou_handler_invalido" };
  }

  const estado = criarEstadoListeners(sock);
  const chaveListener = chave || evento;
  const totalAntes = listenerCountSeguro(sock.ev, evento);
  const anterior = estado[chaveListener];
  const mesmoRegistro = anterior?.emissor === sock.ev && anterior?.evento === evento;
  const listaDisponivel = typeof sock.ev.listeners === "function";
  const handlerPresente = listaDisponivel && mesmoRegistro
    ? sock.ev.listeners(evento).includes(anterior.handler)
    : null;

  if (anterior && anterior.evento !== evento) {
    return { ok: false, registrado: false, motivo: "chave_listener_em_uso" };
  }

  if (mesmoRegistro && (handlerPresente === true || (handlerPresente === null && totalAntes !== 0))) {
    logger?.log?.("[WHATSAPP-LISTENER-UPSERT]", JSON.stringify({
      sessaoId,
      socketGeracao,
      evento,
      listenerUpsertRegistrado: false,
      motivoRegistro: motivoRegistro || "ja_registrado",
      totalListeners: totalAntes,
      contagemDisponivel: totalAntes !== null
    }));
    return { ok: true, registrado: false, totalListeners: totalAntes };
  }

  sock.ev.on(evento, handler);
  estado[chaveListener] = { emissor: sock.ev, evento, handler };

  const totalDepois = listenerCountSeguro(sock.ev, evento);
  logger?.log?.("[WHATSAPP-LISTENER-UPSERT]", JSON.stringify({
    sessaoId,
    socketGeracao,
    evento,
    listenerUpsertRegistrado: true,
    motivoRegistro: motivoRegistro || "registrado",
    totalListeners: totalDepois,
    contagemDisponivel: totalDepois !== null
  }));

  return { ok: true, registrado: true, totalListeners: totalDepois };
}

module.exports = {
  listenerCountSeguro,
  marcarSocketAtual,
  registrarListenerUnicoSocket,
  socketEhAtual,
  diagnosticarEntradaUpsert
};
