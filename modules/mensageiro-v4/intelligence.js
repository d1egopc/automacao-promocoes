"use strict";
const { normalizeIntelligence } = require("./model");
function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function intent(text) {
  const t = normalize(text).slice(0, 2000);
  if (/^(oi|ola|bom dia|boa tarde|boa noite)[!.\s]*$/.test(t))
    return "greeting";
  if (/\b(humano|pessoa|atendente)\b/.test(t)) return "human";
  if (/\b(atendimento|ajuda|suporte)\b/.test(t)) return "support";
  if (/\b(grupo|grupos|comunidade)\b/.test(t)) return "groups";
  if (/\b(vitrine|ofertas|catalogo)\b/.test(t)) return "storefront";
  if (/\b(landing|pagina|site)\b/.test(t)) return "landing";
  if (/\b(horario|abre|fecha|expediente)\b/.test(t)) return "hours";
  return "fallback";
}
function reply({
  text,
  configuration,
  resources = {},
  group = false,
  now = Date.now(),
}) {
  const c = normalizeIntelligence(configuration);
  if (!c.enabled || group) return null;
  const selected = intent(text);
  if (selected === "fallback" && !c.fallbackEnabled) return null;
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  const values = {
    saudacao: hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite",
    contato: c.publicContact || resources.publicContact || "",
    grupos: (c.groupInvites.length
      ? c.groupInvites
      : resources.groupInvites || []
    ).join("\n"),
    vitrine: resources.storefront || "",
    landing: resources.landing || "",
    horario: c.openingHours,
    nome: resources.businessName || "",
  };
  let missing = false;
  const output = c.responses[selected].replace(/\{([a-z]+)\}/g, (_, key) => {
    if (!Object.hasOwn(values, key) || !values[key]) {
      missing = true;
      return "";
    }
    return values[key];
  });
  return missing || !output.trim()
    ? null
    : { intent: selected, text: output, cooldownSeconds: c.cooldownSeconds };
}
module.exports = { normalize, intent, reply };
