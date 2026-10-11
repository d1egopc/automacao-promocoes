"use strict";

function isoFromTimestamp(value) {
  const raw = value && typeof value === "object" &&
    typeof value.toNumber === "function" ? value.toNumber() : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return "";
  const ms = raw > 1000000000000 ? raw : raw * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function isoExplicit(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function capturaFactualRadarCandidata({ origemTipo = "", fonte = "", raw,
  capturadaEm } = {}) {
  if (fonte === "teleradar") return isoExplicit(capturadaEm);
  if (origemTipo === "whatsapp") {
    return isoFromTimestamp(raw?.messageTimestamp);
  }
  if (origemTipo === "telegram") {
    const message = raw?.message || raw?.channel_post ||
      raw?.edited_message || raw?.edited_channel_post || raw;
    return isoFromTimestamp(message?.date);
  }
  return "";
}

module.exports = { capturaFactualRadarCandidata };
