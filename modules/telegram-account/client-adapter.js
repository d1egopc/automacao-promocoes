"use strict";

// Este é o único arquivo do backend autorizado a importar teleproto.
const { Api, TelegramClient } = require("teleproto");
const { StringSession } = require("teleproto/sessions");
const { NewMessage } = require("teleproto/events");
const {
  parseApiId,
  CHAT_TYPES,
  normalizarChat,
  normalizarIdentity,
  normalizarMessage,
  validarAccountScope
} = require("./account.contract");

function safeError(error) {
  return String(error?.errorMessage || error?.code || error?.name || "telegram_error").slice(0, 120);
}

function maskedPhone(phone) {
  const value = String(phone || "");
  if (!value) return null;
  return value.length <= 4 ? "*".repeat(value.length) : `${value.slice(0, -4).replace(/\d/g, "*")}${value.slice(-4)}`;
}

function chatType(entity) {
  if (entity instanceof Api.Channel) return entity.megagroup ? "supergroup" : "channel";
  if (entity instanceof Api.Chat || entity instanceof Api.ChatForbidden) return "group";
  return "unknown";
}

function peerId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    for (const key of ["userId", "channelId", "chatId", "id"]) {
      if (value[key] !== null && value[key] !== undefined) return String(value[key]);
    }
  }
  return String(value);
}

function messageChatId(event, message) {
  return peerId(event?.chatId) || peerId(message?.chatId) || peerId(message?.peerId?.chatId) || peerId(message?.peerId?.channelId);
}

function messageSenderId(message) {
  return peerId(message?.senderId) || peerId(message?.fromId);
}

function normalizeIncomingMessage(event, accountId, chat) {
  const message = event?.message || {};
  const mediaType = message.media?.className || message.media?.constructor?.name || null;
  const hasMedia = Boolean(mediaType && mediaType !== "MessageMediaEmpty");
  const senderId = messageSenderId(message);
  const outgoing = Boolean(message.out || message.isOutgoing || senderId === String(accountId));
  const messageNoForwards = Boolean(message.noforwards);
  const chatNoForwards = Boolean(chat?.noforwards);
  const protectedContent = messageNoForwards || chatNoForwards;
  return normalizarMessage({
    accountId: String(accountId),
    chatId: messageChatId(event, message),
    chatKey: messageChatId(event, message),
    messageId: message.id,
    senderId,
    outgoing,
    isOutgoing: outgoing,
    text: protectedContent ? undefined : String(message.message || ""),
    textSource: protectedContent ? undefined : hasMedia ? "caption" : "text",
    hasMedia,
    mediaType,
    entities: protectedContent ? undefined : message.entities || [],
    protectedContent,
    messageNoForwards,
    chatNoForwards
  });
}

function createTelegramAccountClient(options = {}) {
  const apiId = parseApiId(options.apiId);
  const apiHash = String(options.apiHash || "");
  if (!apiHash) throw new Error("api_hash_ausente");
  const session = options.sessionStore || new StringSession(String(options.sessionString || ""));
  const scope = validarAccountScope(options.accountScope || {});
  const logger = options.logger || {};
  const onSessionChanged = typeof options.onSessionChanged === "function" ? options.onSessionChanged : async () => {};
  const onConnectionState = typeof options.onConnectionState === "function" ? options.onConnectionState : () => {};
  const onAuthError = typeof options.onAuthError === "function" ? options.onAuthError : async () => true;
  const client = options.transportClient || new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    requestRetries: 1,
    autoReconnect: true,
    reconnectRetries: 5,
    floodSleepThreshold: 30
  });
  let currentState = "disconnected";
  const handlers = new Set();

  function state(value) {
    currentState = value;
    try { onConnectionState(value); } catch {}
  }

  function authCredentials() { return { apiId, apiHash }; }

  function isFloodWait(error) {
    return Boolean(error?.seconds || error?.errorMessage === "FLOOD_WAIT" || error?.errorMessage === "FLOOD_PREMIUM_WAIT");
  }

  async function withFloodHandling(operation) {
    try {
      return await operation();
    } catch (error) {
      if (isFloodWait(error)) state("flood_wait");
      throw error;
    }
  }

  async function connect() {
    state("connecting");
    try {
      await client.connect();
      state("connected");
      return { ok: true, connectionState: currentState };
    } catch (error) {
      if (error?.seconds || error?.errorMessage === "FLOOD_WAIT") state("flood_wait");
      else state("disconnected");
      try { logger.warn?.({ code: safeError(error), scope }, "telegram_connection_failed"); } catch {}
      throw error;
    }
  }

  async function disconnect() {
    for (const item of handlers) {
      try { client.removeEventHandler(item.handler, item.event); } catch {}
    }
    handlers.clear();
    try {
      await client.disconnect();
    } finally {
      state("disconnected");
    }
    return { ok: true };
  }

  async function isAuthorized() {
    try {
      await client.api.updates.getState();
      return true;
    } catch {
      return false;
    }
  }

  async function getIdentity() {
    const authorized = await isAuthorized();
    if (!authorized) return normalizarIdentity({}, { connectionState: currentState, authorized: false });
    const me = await client.getMe();
    return normalizarIdentity({
      id: me.id?.toString(),
      firstName: me.firstName,
      lastName: me.lastName,
      username: me.username,
      phone: me.phone
    }, { connectionState: currentState, authorized: true });
  }

  async function requestLoginCode({ phone }) {
    await connect();
    const result = await withFloodHandling(() => client.sendCode(authCredentials(), String(phone || "")));
    return {
      phoneCodeHash: result.phoneCodeHash,
      codeType: result.type?.className || null,
      codeLength: result.type?.length ?? null,
      timeout: result.timeout ?? null,
      phone: maskedPhone(phone)
    };
  }

  async function signInWithCode({ phone, phoneCodeHash, code }) {
    if (!phone || !phoneCodeHash || !code) throw new Error("telegram_auth_transient_incompleto");
    await connect();
    let phoneValue = String(phone);
    let hashValue = String(phoneCodeHash);
    let codeValue = String(code);
    try {
      const result = await withFloodHandling(() => client.invoke(new Api.auth.SignIn({ phoneNumber: phoneValue, phoneCodeHash: hashValue, phoneCode: codeValue })));
      if (result instanceof Api.auth.AuthorizationSignUpRequired) throw new Error("telegram_signup_required");
      await onSessionChanged(session.save());
      return getIdentity();
    } catch (error) {
      if (error?.errorMessage === "SESSION_PASSWORD_NEEDED") throw Object.assign(new Error("telegram_2fa_required"), { code: "telegram_2fa_required" });
      throw error;
    } finally {
      phoneValue = "";
      hashValue = "";
      codeValue = "";
      phone = undefined;
      phoneCodeHash = undefined;
      code = undefined;
    }
  }

  async function signInWithPassword({ password }) {
    if (!password) throw new Error("telegram_2fa_ausente");
    await connect();
    let passwordValue = String(password);
    try {
      const user = await withFloodHandling(() => client.signInWithPassword(authCredentials(), {
        password: async () => passwordValue,
        onError: async (error) => {
          try { logger.warn?.({ code: safeError(error), scope }, "telegram_2fa_failed"); } catch {}
          return Boolean(await onAuthError(error));
        }
      }));
      await onSessionChanged(session.save());
      return getIdentity({ user });
    } finally {
      passwordValue = "";
      password = undefined;
    }
  }

  async function listParticipatingChats() {
    const chats = [];
    for await (const dialog of client.iterDialogs({ limit: 250, ignorePinned: false })) {
      const type = chatType(dialog.entity);
      if (!CHAT_TYPES.includes(type)) continue;
      chats.push(normalizarChat({
        chatId: peerId(dialog.id),
        chatKey: peerId(dialog.id),
        title: dialog.title,
        type,
        protectedContent: Boolean(dialog.entity?.noforwards)
      }));
    }
    return chats;
  }

  async function subscribeNewMessages({ allowedChatKeys = [], onMessage } = {}) {
    if (typeof onMessage !== "function") throw new Error("telegram_onMessage_obrigatorio");
    const allowedValues = typeof allowedChatKeys === "string"
      ? [allowedChatKeys]
      : Array.isArray(allowedChatKeys) ? allowedChatKeys : [...allowedChatKeys];
    const allowed = new Set(allowedValues.map(value => String(value).trim()).filter(Boolean));
    if (!allowed.size) return async () => {};
    const me = await getIdentity();
    const event = new NewMessage({ incoming: true });
    const handler = async (update) => {
      const chatId = messageChatId(update, update?.message);
      if (!allowed.has(String(chatId))) return;
      const senderId = messageSenderId(update?.message);
      const outgoing = Boolean(update?.message?.out || update?.message?.isOutgoing || senderId === me.accountId);
      if (outgoing) return;
      const chat = await update.message.getChat();
      await onMessage(normalizeIncomingMessage(update, me.accountId, chat));
    };
    client.addEventHandler(handler, event);
    const registration = { handler, event };
    handlers.add(registration);
    return async () => {
      if (!handlers.delete(registration)) return;
      client.removeEventHandler(handler, event);
    };
  }

  return Object.freeze({
    accountScope: scope,
    connect,
    disconnect,
    requestLoginCode,
    signInWithCode,
    signInWithPassword,
    isAuthorized,
    getIdentity,
    listParticipatingChats,
    subscribeNewMessages
  });
}

module.exports = {
  createTelegramAccountClient,
  normalizeIncomingMessage,
  messageChatId,
  messageSenderId
};
