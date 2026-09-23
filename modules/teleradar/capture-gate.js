"use strict";

const TIME_ZONE = "America/Sao_Paulo";
const LOCAL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function parseTime(value) {
  const text = String(value || "");
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const [hour, minute] = text.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function localDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(LOCAL_FORMATTER.formatToParts(date).map(item => [item.type, item.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function localKey({ year, month, day, minutes }) {
  return (((year * 100 + month) * 100 + day) * 1440) + minutes;
}

function previousDay({ year, month, day }) {
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return { year: previous.getUTCFullYear(), month: previous.getUTCMonth() + 1, day: previous.getUTCDate() };
}

function evaluateTeleRadarWindow(config = {}, now = new Date()) {
  const start = parseTime(config.horarioInicio);
  const end = parseTime(config.horarioFim);
  const local = localDateTime(now);
  if (start === null || end === null || !local) {
    return Object.freeze({ withinWindow: false, windowStartKey: null });
  }
  const withinWindow = start === end || (start < end
    ? local.minutes >= start && local.minutes <= end
    : local.minutes >= start || local.minutes <= end);
  if (!withinWindow) return Object.freeze({ withinWindow: false, windowStartKey: null });
  if (start === end) {
    return Object.freeze({ withinWindow: true, windowStartKey: localKey({ ...local, minutes: 0 }) });
  }
  const startDay = start > end && local.minutes <= end ? previousDay(local) : local;
  return Object.freeze({ withinWindow: true, windowStartKey: localKey({ ...startDay, minutes: start }) });
}

function timestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  let candidate = value;
  if (typeof candidate === "number" && candidate > 0 && candidate < 1e12) candidate *= 1000;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function evaluateTeleRadarCaptureGate({
  config = {},
  sourceSelected = false,
  selectedSourceCount = 0,
  now = new Date(),
  sourceTimestamp,
  requireNewMessage = false
} = {}) {
  if (config.monitoramentoAtivo !== true) {
    return Object.freeze({ allowed: false, reason: "monitoramento_desligado", withinWindow: false });
  }
  const window = evaluateTeleRadarWindow(config, now);
  if (!window.withinWindow) {
    return Object.freeze({ allowed: false, reason: "fora_da_janela", withinWindow: false });
  }
  if (!sourceSelected) {
    return Object.freeze({
      allowed: false,
      reason: Number(selectedSourceCount || 0) > 0 ? "fonte_nao_selecionada" : "aguardando_fontes",
      withinWindow: true
    });
  }
  if (requireNewMessage) {
    const eventMs = timestampMs(sourceTimestamp);
    const nowMs = timestampMs(now);
    if (eventMs === null || nowMs === null) {
      return Object.freeze({ allowed: false, reason: "timestamp_telegram_ausente", withinWindow: true });
    }
    const activatedMs = config.monitoramentoAtivadoEm ? timestampMs(config.monitoramentoAtivadoEm) : null;
    if (config.monitoramentoAtivadoEm && activatedMs === null) {
      return Object.freeze({ allowed: false, reason: "ativacao_invalida", withinWindow: true });
    }
    if ((activatedMs !== null && eventMs <= activatedMs) || eventMs > nowMs) {
      return Object.freeze({ allowed: false, reason: "mensagem_anterior_ativacao", withinWindow: true });
    }
    const eventLocal = localDateTime(new Date(eventMs));
    if (!eventLocal || localKey(eventLocal) < window.windowStartKey) {
      return Object.freeze({ allowed: false, reason: "mensagem_anterior_janela", withinWindow: true });
    }
  }
  return Object.freeze({ allowed: true, reason: "permitido", withinWindow: true });
}

module.exports = {
  TIME_ZONE,
  parseTime,
  evaluateTeleRadarWindow,
  evaluateTeleRadarCaptureGate
};
