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

function inferirFamiliaRascunho(urlExemplo) {
  let url;
  try { url = new URL(String(urlExemplo || "")); }
  catch { throw new Error("URL_EXEMPLO_INVALIDA"); }
  const partes = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
      !url.hostname.includes(".") || url.href.length > 2048 || url.pathname.length > 512 ||
      partes.length < 1 || partes.length > 4 ||
      partes.slice(0, -1).some(parte => !/^[a-z0-9_-]{1,64}$/i.test(parte)) ||
      !/^[a-z0-9_-]{1,256}$/i.test(partes.at(-1))) {
    throw new Error("URL_EXEMPLO_INVALIDA");
  }
  return { host: url.hostname.toLowerCase(),
    pathPrefix: partes.length === 1 ? "/" : `/${partes.slice(0, -1).join("/")}/`,
    pathMode: "one_segment_suffix",
    urlExemplo: url.toString() };
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
    registros = dados.records.map(item => item.tipo === "investigacao_pendente"
      ? { ...item, estado: "investigacao_pendente", ativo: false } : item);
  }

  function salvar(proximos) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporario = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      const fd = fs.openSync(temporario, "wx", 0o600);
      try {
        // The deployed V1 reader already forbids activating a draft. Preserve
        // that guard on rollback; only the new reader projects this as pending.
        const records = proximos.map(item => item.estado === "investigacao_pendente"
          ? { ...item, estado: "rascunho", tipo: "investigacao_pendente", ativo: false } : item);
        fs.writeFileSync(fd, JSON.stringify({ version: 1, records }));
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
    return registros.find(item => item.estado !== "investigacao_pendente" && item.ativo === true && item.host === url.hostname.toLowerCase() &&
      (item.pathPrefix.endsWith("/") ? url.pathname.startsWith(item.pathPrefix) : url.pathname === item.pathPrefix) &&
      (item.pathMode !== "one_segment_suffix" ||
        /^[a-z0-9_-]{1,256}$/i.test(url.pathname.slice(item.pathPrefix.length)))) || null;
  }
  function adicionar(familia, diagnostico = {}) {
    if (registros.some(item => item.estado !== "investigacao_pendente" && item.host === familia.host && item.pathPrefix === familia.pathPrefix)) throw new Error("RESOLVER_DUPLICADO");
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
  function adicionarRascunho(familia, diagnostico = {}) {
    if (registros.some(item => item.estado !== "investigacao_pendente" && item.host === familia.host && item.pathPrefix === familia.pathPrefix))
      throw new Error("RESOLVER_DUPLICADO");
    const agora = new Date().toISOString();
    const novo = {
      id: crypto.randomUUID(), host: familia.host, pathPrefix: familia.pathPrefix,
      pathMode: familia.pathMode, ativo: false, estado: "rascunho", urlExemplo: familia.urlExemplo,
      criadoEm: agora, atualizadoEm: agora, ultimoTesteEm: agora,
      ultimoSucessoEm: "", ultimoMarketplaceDetectado: diagnostico.marketplace || "",
      ultimoTipoDetectado: "nao_determinado", falhasConsecutivas: 0,
      ultimoDebugSeguro: diagnostico.debug || null,
      metodoDescoberto: diagnostico.metodo || ""
    };
    salvar([...registros, novo]);
    return { ...novo };
  }
  function atualizar(id, alteracoes) {
    const atual = buscar(id);
    if (!atual) throw new Error("RESOLVER_NAO_ENCONTRADO");
    if (["rascunho", "investigacao_pendente"].includes(atual.estado) && alteracoes?.ativo === true)
      throw new Error("RASCUNHO_NAO_HOMOLOGADO");
    const proximo = { ...atual, ...alteracoes, id: atual.id, host: atual.host, pathPrefix: atual.pathPrefix,
      urlExemplo: atual.urlExemplo, atualizadoEm: new Date().toISOString() };
    salvar(registros.map(item => item.id === id ? proximo : item));
    return { ...proximo };
  }
  function adicionarInvestigacao(diagnostico, workspaceId) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(workspaceId || "") ||
        diagnostico?.resultado !== "investigacao_pendente" || diagnostico.investigacaoElegivel !== true)
      throw new Error("INVESTIGACAO_INVALIDA");
    const agora = new Date().toISOString();
    // This record contains no source URL/query, response body, headers or free-form exception.
    const novo = {
      id: crypto.randomUUID(), ativo: false, estado: "investigacao_pendente",
      workspaceId, host: diagnostico.host, pathPrefix: diagnostico.caminhoSanitizado,
      criadoEm: agora, atualizadoEm: agora, ultimoTesteEm: agora, ultimoSucessoEm: "",
      falhasConsecutivas: 0, ultimoMarketplaceDetectado: diagnostico.marketplaceCandidato === "nao_comprovado"
        ? "" : diagnostico.marketplaceCandidato,
      ultimoTipoDetectado: "nao_determinado", metodoDescoberto: "",
      ultimoDebugSeguro: {
        ok: false, entrada: diagnostico.urlOriginalSanitizada,
        destino: diagnostico.urlExpandidaSanitizada, metodo: diagnostico.metodo,
        motivo: diagnostico.motivoTecnico, etapa: diagnostico.etapa,
        statusHttp: diagnostico.statusHttp, hops: diagnostico.hops.map(item => item.url)
      }
    };
    salvar([...registros, novo]);
    return { ...novo };
  }
  function homologar(id, diagnostico = {}) {
    const atual = buscar(id);
    if (!atual || atual.estado !== "rascunho" || atual.ativo !== false)
      throw new Error("RASCUNHO_NAO_HOMOLOGADO");
    if (diagnostico.ok !== true || diagnostico.exemplosHomologados !== 2 ||
        !diagnostico.marketplace || diagnostico.metodo !== atual.metodoDescoberto)
      throw new Error("RASCUNHO_REVALIDACAO_FALHOU");
    const agora = new Date().toISOString();
    const proximo = { ...atual, estado: "homologado", ativo: true,
      homologadoEm: agora, ultimoTesteEm: agora, ultimoSucessoEm: agora,
      ultimoMarketplaceDetectado: diagnostico.marketplace,
      ultimoTipoDetectado: diagnostico.tipo || "nao_determinado",
      metodoHomologado: diagnostico.metodo, exemplosHomologados: 2,
      ultimoDebugSeguro: diagnostico.debug, falhasConsecutivas: 0, atualizadoEm: agora };
    salvar(registros.map(item => item.id === id ? proximo : item));
    return { ...proximo };
  }
  function excluir(id) {
    if (!buscar(id)) throw new Error("RESOLVER_NAO_ENCONTRADO");
    salvar(registros.filter(item => item.id !== id));
  }
  return { listar, buscar, localizar, adicionar, adicionarRascunho, adicionarInvestigacao, homologar, atualizar, excluir };
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

module.exports = { criarRegistroDinamico, inferirFamilia, inferirFamiliaRascunho, registroDinamicoPadrao };
