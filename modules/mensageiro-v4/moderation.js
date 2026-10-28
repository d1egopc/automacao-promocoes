"use strict";
const crypto = require("node:crypto");
const { normalize } = require("./intelligence");
const { normalizeModeration } = require("./model");
const identity = require("../mensageiro/gerente-identidade");
const { _internals } = require("../mensageiro/gerente.service");
function body(message) {
  const m = message?.message || {};
  return String(
    m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      "",
  ).slice(0, 16000);
}
function media(message) {
  const m = message?.message || {};
  return m.imageMessage
    ? "imagem"
    : m.videoMessage
      ? "video"
      : m.audioMessage
        ? "audio"
        : m.documentMessage
          ? "documento"
          : m.stickerMessage
            ? "sticker"
            : "";
}
class Moderator {
  constructor() {
    this.windows = new Map();
    this.metadata = new WeakMap();
  }
  evaluate(profile, message, now = Date.now()) {
    const base = profile.cards.groupManager.configuration || {};
    const configuration = { ...base, ...base.configuracao, v4: base.v4 };
    const text = body(message),
      normalized = normalize(text),
      group = message.key.remoteJid,
      sender = message.key.participant || "";
    // Preserve current deterministic rules and priority. Newly offered categories
    // require explicit terms; a domain never implies politics/sexual content.
    for (const rule of configuration.universal ? [] : configuration.regras || []) {
      if (!rule.ativo) continue;
      let violated = false;
      if (["flood", "excesso_mensagens", "repeticao"].includes(rule.tipo)) {
        const params = rule.parametros || {};
        if (
          rule.tipo === "repeticao" &&
          normalized.length < (params.minCaracteres || 8)
        )
          continue;
        const count = this.window(
          profile,
          message,
          rule.id,
          rule.tipo === "repeticao" ? normalized : "*",
          now,
          Math.max(3, params.janelaSegundos || 30),
        );
        if (count === null)
          return { id: rule.id, action: "observe", uncertain: true };
        violated =
          rule.tipo === "repeticao"
            ? count >= (params.repeticoes || 3)
            : count > (params.maxMensagens || 5);
      } else
        violated = Boolean(
          _internals.encontrarViolacaoDeterministica({
            regras: [rule],
            texto: text,
            tipoMidia: media(message),
            contexto: {},
          }),
        );
      if (violated)
        return {
          id: rule.id,
          action:
            rule.acao === "apagar"
              ? "delete"
              : rule.acao === "apagar_avisar"
                ? "delete_warn"
                : "review",
          warning: rule.avisoTexto || "Mensagem removida pela regra do grupo.",
        };
    }
    const v4 = configuration.universal || normalizeModeration(configuration.v4);
    for (const rule of v4.rules) {
      if (!rule.enabled) continue;
      let violated = false;
      if (rule.category === "links_externos")
        violated = _internals.extrairUrls(text).some((raw) => {
          try {
            const host = new URL(
              /^https?:\/\//i.test(raw) ? raw : "https://" + raw,
            ).hostname.toLowerCase();
            return !rule.allowedDomains.some(
              (d) => host === d || host.endsWith("." + d),
            );
          } catch {
            return false;
          }
        });
      else if (rule.category === "midia_bloqueada")
        violated = rule.media.includes(media(message));
      else if (["spam", "repeticao"].includes(rule.category)) {
        if (rule.category === "repeticao" && !normalized) continue;
        const count = this.window(
          profile,
          message,
          rule.id,
          rule.category === "repeticao" ? normalized : "*",
          now,
          rule.windowSeconds,
        );
        if (count === null)
          return { id: rule.id, action: "observe", uncertain: true };
        violated = count >= rule.threshold;
      } else
        violated = rule.terms.some((term) => {
          const n = normalize(term);
          return (
            n &&
            (" " + normalized.replace(/[^\p{L}\p{N}]+/gu, " ") + " ").includes(
              " " + n + " ",
            )
          );
        });
      // Professional words are descriptive context, never a bypass of a rule.
      if (violated)
        return { id: rule.id, action: rule.action, warning: rule.warning,
          strikes:rule.strikes,strikeWindowMinutes:rule.strikeWindowMinutes };
    }
    return null;
  }
  window(profile, message, ruleId, content, now, seconds) {
    if (!message.key?.id) return null;
    const fingerprint = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");
    const key = JSON.stringify([
      profile.workspaceId,
      profile.id,
      message.key.remoteJid,
      message.key.participant || "",
      ruleId,
      fingerprint,
    ]);
    for (const [k, entries] of this.windows)
      if (now - entries[entries.length - 1].at > 300000) this.windows.delete(k);
    if (this.windows.size >= 2000 && !this.windows.has(key)) return null;
    const entries = (this.windows.get(key) || []).filter(
      (e) => now - e.at < seconds * 1000,
    );
    const id = crypto.createHash("sha256").update(message.key.id).digest("hex");
    if (!entries.some((e) => e.id === id)) entries.push({ id, at: now });
    this.windows.set(key, entries.slice(-31));
    return entries.length;
  }
  async permission(sock, group, sender, force = false) {
    let cache = this.metadata.get(sock);
    if (!cache) {
      cache = new Map();
      this.metadata.set(sock, cache);
    }
    let entry = cache.get(group);
    if (force || !entry || Date.now() - entry.at > 20000) {
      let timer;
      try {
        const metadata = await Promise.race([
          sock.groupMetadata(group),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("metadata_timeout")),
              1500,
            );
          }),
        ]);
        entry = { at: Date.now(), metadata };
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(group, entry);
      } finally {
        clearTimeout(timer);
      }
    }
    const participants = entry.metadata?.participants || [];
    const target = participants.find((p) =>
      identity
        .aliasesParticipanteGerente(p)
        .includes(identity.normalizarAliasJidGerente(sender)),
    );
    const bot = identity.resolverBotAdminGerente(sock, entry.metadata);
    if (!target || !bot.botEncontrado) return { known: false };
    return {
      known: true,
      botAdmin: bot.botAdmin,
      admin: identity.participanteAdminGerente(target),
      owner: target.admin === "superadmin",
      aliases: identity.aliasesParticipanteGerente(target),
    };
  }
  exempt(configuration, permission, sender) {
    configuration = { ...configuration, ...configuration.configuracao };
    if(configuration.universal && (permission.admin || permission.owner)) return true;
    if (configuration.isentarAdmins !== false && permission.admin) return true;
    if (configuration.isentarDono !== false && permission.owner) return true;
    const aliases = new Set(
      [sender, ...(permission.aliases || [])].map(
        identity.normalizarAliasJidGerente,
      ),
    );
    return [
      ...(configuration.autorizados || []),
      ...(configuration.moderadores || []),
    ].some(
      (id) =>
        aliases.has(identity.normalizarAliasJidGerente(id)) ||
        [...aliases].some((a) => a.split("@")[0] === id),
    );
  }
}
module.exports = { Moderator, body };
