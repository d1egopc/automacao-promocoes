"use strict";
const net = require("node:net");

const CARDS = Object.freeze([
  "groupManager",
  "attendance",
  "commands",
  "welcome",
  "farewell",
  "scheduled",
  "faq",
  "flows",
  "quickReplies",
]);
const CATALOG = Object.freeze(
  [
    ["palavras_proibidas", "Palavras proibidas"],
    ["ofensas", "Ofensas"],
    ["sexual", "Conteúdo sexual explícito"],
    ["pornografia", "Pornografia"],
    ["politica", "Divulgação política"],
    ["links_externos", "Links externos"],
    ["spam", "Spam"],
    ["repeticao", "Repetição"],
    ["midia_bloqueada", "Mídias"],
  ].map(([id, name]) => Object.freeze({ id, name })),
);
const INTENTS = Object.freeze([
  "greeting",
  "support",
  "groups",
  "storefront",
  "landing",
  "hours",
  "human",
  "fallback",
]);
const DEFAULT_RESPONSES = Object.freeze({
  greeting: "{saudacao}! Como podemos ajudar?",
  support: "Fale com nosso atendimento: {contato}",
  groups: "Conheça nossos grupos: {grupos}",
  storefront: "Confira nossa Vitrine: {vitrine}",
  landing: "Visite nossa página: {landing}",
  hours: "Nosso horário: {horario}",
  human: "Fale com uma pessoa: {contato}",
  fallback:
    "Como podemos ajudar? Escolha atendimento, grupos, Vitrine ou horário.",
});
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function text(value, max = 500) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail("campo_invalido");
  return value.trim();
}
function list(value, max = 50) {
  if (!Array.isArray(value) || value.length > max) fail("lista_invalida");
  return [...new Set(value.map((item) => text(item, 200)))];
}
function publicUrl(value) {
  if (!value) return "";
  const raw = text(value, 2048);
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("link_publico_invalido");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname.includes(".") ||
    net.isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
    /(?:^|\.)(local|internal|invalid|test)$/.test(url.hostname)
  )
    fail("link_publico_invalido");
  return url.href;
}
function normalizeIntelligence(input = {}) {
  const responses = {};
  for (const intent of INTENTS)
    responses[intent] = text(
      input.responses?.[intent] ?? DEFAULT_RESPONSES[intent],
      2000,
    );
  return {
    version: 4,
    enabled: input.enabled === true,
    groupGreetings: false,
    fallbackEnabled: input.fallbackEnabled === true,
    cooldownSeconds: Math.max(
      30,
      Math.min(86400, Number(input.cooldownSeconds) || 300),
    ),
    responses,
    publicContact: publicUrl(input.publicContact || ""),
    groupInvites: (input.groupInvites ? list(input.groupInvites, 10) : []).map(
      publicUrl,
    ),
    openingHours: text(input.openingHours || "", 250),
  };
}
function normalizeModeration(input = {}) {
  const rules = input.rules || [];
  if (!Array.isArray(rules) || rules.length > 30) fail("regras_invalidas");
  const ids = new Set();
  return {
    version: 4,
    uncertainty: "observe",
    professionalTopics: list(input.professionalTopics || [], 30),
    rules: rules.map((rule, i) => {
      const id = text(rule.id || "rule_" + i, 100);
      if (ids.has(id) || !CATALOG.some((item) => item.id === rule.category))
        fail("regra_invalida");
      ids.add(id);
      if (!["observe", "delete", "delete_warn"].includes(rule.action))
        fail("acao_invalida");
      return {
        id,
        category: rule.category,
        enabled: rule.enabled === true,
        action: rule.action,
        terms: list(rule.terms || [], 60),
        allowedDomains: list(rule.allowedDomains || [], 30).map((domain) => {
          if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(domain))
            fail("dominio_invalido");
          return domain.toLowerCase();
        }),
        media: list(rule.media || [], 5).filter((item) =>
          ["imagem", "video", "audio", "documento", "sticker"].includes(item),
        ),
        threshold: Math.max(2, Math.min(30, Number(rule.threshold) || 4)),
        windowSeconds: Math.max(
          5,
          Math.min(300, Number(rule.windowSeconds) || 30),
        ),
        warning: text(
          rule.warning || "Mensagem removida pela regra do grupo.",
          500,
        ),
      };
    }),
  };
}
function settings(profile) {
  return {
    universalEnabled: profile.execution?.version === 4,
    activatedAt: profile.execution?.activatedAt || null,
    migrationVersion:
      profile.cards?.groupManager?.configuration?.v4?.migrationVersion || 0,
    intelligence: normalizeIntelligence(
      profile.cards?.attendance?.configuration?.v4,
    ),
    moderation: normalizeModeration(
      profile.cards?.groupManager?.configuration?.v4,
    ),
  };
}
function lightProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    sessionId: profile.sessionId,
    active: profile.active === true,
    revision: profile.revision,
    destinations: profile.destinations || [],
    cards: Object.fromEntries(
      CARDS.map((card) => [
        card,
        {
          active: profile.cards?.[card]?.active === true,
          revision: profile.cards?.[card]?.revision || 1,
        },
      ]),
    ),
    ...settings(profile),
  };
}
function validateImages(value, previous, depth = 0) {
  if (depth > 12) fail("configuracao_profunda");
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (
      ["imagem", "imagemUrl"].includes(key) &&
      item &&
      item !== previous?.[key]
    ) {
      if (
        typeof item !== "string" ||
        item.length > 7 * 1024 * 1024 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(item)
      )
        fail("imagem_invalida");
      const bytes = Buffer.from(item.split(",")[1], "base64");
      const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp =
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP";
      if (
        bytes.length > 5 * 1024 * 1024 ||
        !(item.startsWith("data:image/png;")
          ? png
          : item.startsWith("data:image/jpeg;")
            ? jpeg
            : webp)
      )
        fail("imagem_invalida");
    }
    if (item && typeof item === "object")
      validateImages(item, previous?.[key], depth + 1);
  }
}
module.exports = {
  CARDS,
  CATALOG,
  INTENTS,
  DEFAULT_RESPONSES,
  fail,
  text,
  list,
  publicUrl,
  normalizeIntelligence,
  normalizeModeration,
  settings,
  lightProfile,
  validateImages,
};
