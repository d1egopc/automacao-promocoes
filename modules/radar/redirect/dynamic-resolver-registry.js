"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_FILE = "/data/link-resolvers/dynamic-resolvers.json";

function inferirFamilia(urlExemplo) {
  const url = new URL(String(urlExemplo || ""));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("URL_EXEMPLO_INVALIDA");
  }
  const host = url.hostname.toLowerCase();
  const partes = url.pathname.split("/").filter(Boolean);
  if (!host.includes(".") || partes.length < 2 || url.port) throw new Error("FAMILIA_NAO_INFERIVEL");
  const pathPrefix = `/${partes.slice(0, -1).join("/")}/`;
  return { host, pathPrefix, urlExemplo: url.toString() };
}

function criarRegistroDinamico({ file = DEFAULT_FILE } = {}) {
  let registros = [];
  if (fs.existsSync(file)) {
    let dados;
    try {
      dados = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      throw new Error("LINK_RESOLVERS_STORAGE_INVALIDO");
    }
    if (dados?.version !== 1 || !Array.isArray(dados.records)) throw new Error("LINK_RESOLVERS_STORAGE_INVALIDO");
    registros = dados.records;
  }

  function salvar(proximos) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporario = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      const fd = fs.openSync(temporario, "wx", 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({ version: 1, records: proximos }));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporario, file);
      registros = proximos;
    } finally {
      if (fs.existsSync(temporario)) fs.unlinkSync(temporario);
    }
  }

  function listar() { return registros.map(item => ({ ...item })); }
  function buscar(id) { return registros.find(item => item.id === id) || null; }
  function localizar(urlTexto) {
    let url;
    try { url = new URL(String(urlTexto || "")); } catch { return null; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    return registros.find(item => item.ativo === true && item.host === url.hostname.toLowerCase() &&
      (item.pathPrefix.endsWith("/") ? url.pathname.startsWith(item.pathPrefix) : url.pathname === item.pathPrefix)) || null;
  }
  function adicionar(familia, diagnostico = {}) {
    if (registros.some(item => item.host === familia.host && item.pathPrefix === familia.pathPrefix)) throw new Error("RESOLVER_DUPLICADO");
    const agora = new Date().toISOString();
    const novo = {
      id: crypto.randomUUID(), host: familia.host, pathPrefix: familia.pathPrefix,
      ativo: true, urlExemplo: familia.urlExemplo, criadoEm: agora, atualizadoEm: agora,
      ultimoTesteEm: agora, ultimoSucessoEm: agora,
      ultimoMarketplaceDetectado: diagnostico.marketplace || "",
      ultimoTipoDetectado: diagnostico.tipo || "",
      falhasConsecutivas: 0, ultimoDebugSeguro: diagnostico.debug || null
    };
    salvar([...registros, novo]);
    return { ...novo };
  }
  function atualizar(id, alteracoes) {
    const atual = buscar(id);
    if (!atual) throw new Error("RESOLVER_NAO_ENCONTRADO");
    const proximo = { ...atual, ...alteracoes, id: atual.id, host: atual.host, pathPrefix: atual.pathPrefix,
      urlExemplo: atual.urlExemplo, atualizadoEm: new Date().toISOString() };
    salvar(registros.map(item => item.id === id ? proximo : item));
    return { ...proximo };
  }
  function excluir(id) {
    if (!buscar(id)) throw new Error("RESOLVER_NAO_ENCONTRADO");
    salvar(registros.filter(item => item.id !== id));
  }
  return { listar, buscar, localizar, adicionar, atualizar, excluir };
}

let registroPadrao;
let falhaPadrao;
function registroDinamicoPadrao() {
  if (falhaPadrao) throw falhaPadrao;
  if (!registroPadrao) {
    try { registroPadrao = criarRegistroDinamico(); }
    catch (erro) { falhaPadrao = erro; throw erro; }
  }
  return registroPadrao;
}

module.exports = { criarRegistroDinamico, inferirFamilia, registroDinamicoPadrao };
