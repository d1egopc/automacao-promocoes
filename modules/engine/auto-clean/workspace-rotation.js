"use strict";

const fs = require("fs");
const path = require("path");

const CURSOR_FILE = "auto-clean-fila-cursor.json";
const shadowCursors = new Map();

function selecionarRoundRobin(workspaces = [], ultimo = "", limite = 5) {
  const ordenados = [...new Set(workspaces.filter(id => typeof id === "string" && id))].sort();
  if (!ordenados.length) return { selecionados: [], ultimo: "" };
  const inicio = Math.max(0, ordenados.findIndex(id => id > ultimo));
  const quantidade = Math.min(ordenados.length, Math.max(1, Math.floor(Number(limite) || 1)));
  const selecionados = Array.from({ length: quantidade }, (_, indice) => ordenados[(inicio + indice) % ordenados.length]);
  return { selecionados, ultimo: selecionados[selecionados.length - 1] };
}

function lerCursor(dataDir, fsImpl = fs) {
  try {
    const value = JSON.parse(fsImpl.readFileSync(path.join(dataDir, CURSOR_FILE), "utf8"));
    return value?.version === 1 && typeof value.ultimoWorkspace === "string" ? value.ultimoWorkspace : "";
  } catch {
    return "";
  }
}

function salvarCursor(dataDir, ultimoWorkspace, fsImpl = fs) {
  const destino = path.join(dataDir, CURSOR_FILE);
  const tmp = `${destino}.${process.pid}.${Date.now()}.tmp`;
  fsImpl.writeFileSync(tmp, JSON.stringify({ version: 1, ultimoWorkspace }));
  fsImpl.renameSync(tmp, destino);
}

function selecionarShadow(dataDir, workspaces, limite) {
  const ultimo = shadowCursors.has(dataDir) ? shadowCursors.get(dataDir) : lerCursor(dataDir);
  const resultado = selecionarRoundRobin(workspaces, ultimo, limite);
  shadowCursors.set(dataDir, resultado.ultimo);
  return resultado.selecionados;
}

module.exports = { CURSOR_FILE, selecionarRoundRobin, lerCursor, salvarCursor, selecionarShadow };
