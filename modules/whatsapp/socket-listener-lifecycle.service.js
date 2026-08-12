"use strict";

function listenerCountSeguro(ev, evento) {
  if (!ev || !evento) return 0;
  if (typeof ev.listenerCount === "function") return ev.listenerCount(evento);
  if (typeof ev.listeners === "function") return ev.listeners(evento).length;
  return 0;
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

  if (estado[chaveListener] && totalAntes > 0) {
    logger?.log?.("[WHATSAPP-LISTENER-UPSERT]", JSON.stringify({
      sessaoId,
      socketGeracao,
      listenerUpsertRegistrado: false,
      motivoRegistro: motivoRegistro || "ja_registrado",
      totalListeners: totalAntes
    }));
    return { ok: true, registrado: false, totalListeners: totalAntes };
  }

  sock.ev.on(evento, handler);
  estado[chaveListener] = true;

  const totalDepois = listenerCountSeguro(sock.ev, evento);
  logger?.log?.("[WHATSAPP-LISTENER-UPSERT]", JSON.stringify({
    sessaoId,
    socketGeracao,
    listenerUpsertRegistrado: true,
    motivoRegistro: motivoRegistro || "registrado",
    totalListeners: totalDepois
  }));

  return { ok: true, registrado: true, totalListeners: totalDepois };
}

module.exports = {
  listenerCountSeguro,
  marcarSocketAtual,
  registrarListenerUnicoSocket,
  socketEhAtual
};
