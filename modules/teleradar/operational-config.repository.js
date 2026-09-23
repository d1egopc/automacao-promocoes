"use strict";

const {
  createTeleradarJsonStore,
  scopedKey,
  validateTeleRadarContext
} = require("./checkpoint.repository");
const { parseTime } = require("./capture-gate");

const OPERATIONAL_CONFIG_FILE = "teleradar-operational-config.json";
const LEGACY_DEFAULT_CONFIG = Object.freeze({
  monitoramentoAtivo: false,
  horarioInicio: "00:00",
  horarioFim: "23:59",
  monitoramentoAtivadoEm: null,
  updatedAt: null
});

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("TELERADAR_CLOCK_INVALID");
  return date.toISOString();
}

function validateTime(value, field) {
  const text = String(value || "");
  if (parseTime(text) === null) throw new Error(`TELERADAR_${field.toUpperCase()}_INVALID`);
  return text;
}

function normalizeConfig(value, { allowMissing = false } = {}) {
  if (value === null || value === undefined) {
    if (allowMissing) return { ...LEGACY_DEFAULT_CONFIG };
    throw new Error("TELERADAR_OPERATIONAL_CONFIG_INVALID");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.monitoramentoAtivo !== "boolean") {
    throw new Error("TELERADAR_OPERATIONAL_CONFIG_INVALID");
  }
  const activatedAt = value.monitoramentoAtivadoEm === null || value.monitoramentoAtivadoEm === undefined
    ? null
    : iso(value.monitoramentoAtivadoEm);
  const updatedAt = value.updatedAt === null || value.updatedAt === undefined ? null : iso(value.updatedAt);
  return {
    monitoramentoAtivo: value.monitoramentoAtivo,
    horarioInicio: validateTime(value.horarioInicio, "horario_inicio"),
    horarioFim: validateTime(value.horarioFim, "horario_fim"),
    monitoramentoAtivadoEm: activatedAt,
    updatedAt
  };
}

function createOperationalConfigRepository({ store = createTeleradarJsonStore(), context, clock = () => new Date() } = {}) {
  const validContext = validateTeleRadarContext(context);
  const key = scopedKey("operational-config", validContext);

  async function get() {
    const state = await store.read(validContext, OPERATIONAL_CONFIG_FILE);
    return Object.freeze(normalizeConfig(state.entries[key], { allowMissing: true }));
  }

  async function setMonitoringActive(monitoramentoAtivo) {
    if (typeof monitoramentoAtivo !== "boolean") throw new Error("TELERADAR_MONITORAMENTO_ATIVO_INVALID");
    const now = iso(clock());
    return store.mutate(validContext, OPERATIONAL_CONFIG_FILE, entries => {
      const current = normalizeConfig(entries[key], { allowMissing: true });
      const next = {
        ...current,
        monitoramentoAtivo,
        monitoramentoAtivadoEm: monitoramentoAtivo && current.monitoramentoAtivo !== true
          ? now
          : current.monitoramentoAtivadoEm,
        updatedAt: now
      };
      entries[key] = { ...next, context: validContext };
      return next;
    });
  }

  async function setSchedule({ horarioInicio, horarioFim } = {}) {
    const start = validateTime(horarioInicio, "horario_inicio");
    const end = validateTime(horarioFim, "horario_fim");
    const now = iso(clock());
    return store.mutate(validContext, OPERATIONAL_CONFIG_FILE, entries => {
      const current = normalizeConfig(entries[key], { allowMissing: true });
      const next = {
        ...current,
        horarioInicio: start,
        horarioFim: end,
        monitoramentoAtivadoEm: current.monitoramentoAtivo === true ? now : current.monitoramentoAtivadoEm,
        updatedAt: now
      };
      entries[key] = { ...next, context: validContext };
      return next;
    });
  }

  return Object.freeze({ get, setMonitoringActive, setSchedule });
}

module.exports = {
  OPERATIONAL_CONFIG_FILE,
  LEGACY_DEFAULT_CONFIG,
  normalizeConfig,
  createOperationalConfigRepository
};
