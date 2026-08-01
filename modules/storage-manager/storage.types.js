"use strict";

const CATEGORIAS_STORAGE = Object.freeze({
  CLIENTES: "clientes",
  FILAS: "filas",
  SESSOES: "sessoes_auth_whatsapp",
  SNAPSHOTS: "snapshots_reset",
  BACKUPS: "backups",
  LOGS: "logs",
  TEMPORARIOS: "temporarios",
  CACHES: "caches",
  MIDIAS: "midias",
  ORFAOS: "orfaos",
  OUTROS: "outros"
});

const CLASSIFICACAO_STORAGE = Object.freeze({
  VERDE: "VERDE",
  AMARELO: "AMARELO",
  VERMELHO: "VERMELHO"
});

const POLITICAS_RETENCAO_PADRAO = Object.freeze({
  snapshotsDias: 30,
  logsDias: 15,
  backupsDias: 60,
  temporariosHoras: 24,
  historicoDias: null
});

const STATUS_FILA = Object.freeze({
  HISTORICO: ["enviado", "historico", "publicado", "sucesso"],
  FINAL: [
    "retida",
    "retido",
    "cancelada",
    "cancelado",
    "erro_final",
    "erro_permanente",
    "falha_final",
    "expirada",
    "expirado",
    "expirada_operacional",
    "expirado_operacional"
  ],
  ATIVO: [
    "pendente",
    "aguardando",
    "pronta",
    "pronto",
    "processando",
    "enviando",
    "em_tentativa",
    "tentando",
    "erro_temporario",
    "erro_retry",
    "retry"
  ],
  PROCESSANDO: ["processando", "enviando", "em_tentativa", "tentando"]
});

const LIMIARES_HEALTH = Object.freeze({
  excelente: 90,
  bom: 75,
  atencao: 55,
  critico: 30
});

module.exports = {
  CATEGORIAS_STORAGE,
  CLASSIFICACAO_STORAGE,
  POLITICAS_RETENCAO_PADRAO,
  STATUS_FILA,
  LIMIARES_HEALTH
};