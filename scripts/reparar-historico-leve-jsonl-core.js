"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HISTORICO_LEVE_INCREMENTAL_DIR = "fila-historico-leve-incremental";

const ALVOS_PADRAO = [
  { clienteId: "user_zbbk3fdr", arquivos: ["2026-09-07.jsonl", "2026-09-08.jsonl"] },
  { clienteId: "user_pss60lus", arquivos: ["2026-09-15.jsonl"] }
];

const CONFLITO_ENGINE_32325 = {
  clienteId: "user_pss60lus",
  chave: "9ec91f673a15ef9199d65133e2341aa812c765ff",
  id: "engine_32325_1789441822771",
  statusOperacionalCanonico: "enviado"
};

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function statusNormalizado(valor = "") {
  return texto(valor).toLowerCase();
}

function clienteSeguro(clienteId = "admin") {
  return texto(clienteId || "admin") || "admin";
}

function idItem(item = {}, fallback = -1) {
  return texto(item.id || item.filaItemId || item.ofertaId || item.engineOfertaId || (fallback >= 0 ? `indice_${fallback}` : ""));
}

function statusItem(item = {}) {
  return statusNormalizado(item.status || item.estado || item.statusOperacional || "");
}

function sha1(valor = "") {
  return crypto.createHash("sha1").update(String(valor)).digest("hex");
}

function sha256(valor = "") {
  return crypto.createHash("sha256").update(String(valor)).digest("hex");
}

function chaveHistoricoLeveFallback(clienteId = "admin", item = {}, posicaoFallback = -1) {
  const base = [
    clienteSeguro(clienteId),
    idItem(item, posicaoFallback),
    statusItem(item),
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || "")
  ].join("|");
  return sha1(base);
}

function identidadeRegistro(clienteId = "admin", registro = {}, posicaoFallback = -1) {
  const chave = texto(registro?.chave);
  if (chave) return `chave:${chave}`;
  const item = registro?.item && typeof registro.item === "object" ? registro.item : registro;
  return `chave:${chaveHistoricoLeveFallback(clienteId, item, posicaoFallback)}`;
}

function caminhoArquivo(dataDir, clienteId, arquivo) {
  return path.join(dataDir, "clientes", clienteSeguro(clienteId), HISTORICO_LEVE_INCREMENTAL_DIR, arquivo);
}

function normalizarArquivoJsonl(nome = "") {
  const arquivo = texto(nome);
  return /\.jsonl$/i.test(arquivo) ? arquivo : `${arquivo}.jsonl`;
}

function normalizarAlvos(opcoes = {}) {
  const clientesFiltro = new Set((opcoes.clientes || []).map(clienteSeguro));
  const arquivosFiltro = new Set((opcoes.arquivos || []).map(normalizarArquivoJsonl));
  const base = Array.isArray(opcoes.alvos) && opcoes.alvos.length ? opcoes.alvos : ALVOS_PADRAO;
  const alvos = [];
  for (const alvo of base) {
    const clienteId = clienteSeguro(alvo.clienteId);
    if (clientesFiltro.size && !clientesFiltro.has(clienteId)) continue;
    const arquivos = (alvo.arquivos || [])
      .map(normalizarArquivoJsonl)
      .filter(arquivo => !arquivosFiltro.size || arquivosFiltro.has(arquivo));
    if (arquivos.length) alvos.push({ clienteId, arquivos });
  }
  return alvos;
}

function lerArquivoJsonl(file, fsImpl = fs) {
  const existe = fsImpl.existsSync(file);
  if (!existe) {
    return {
      ok: true,
      existe: false,
      file,
      linhas: [],
      linhasAtuais: 0,
      bytesAtuais: 0,
      hashAtual: sha256("")
    };
  }
  const conteudo = fsImpl.readFileSync(file, "utf8");
  const hashAtual = sha256(conteudo);
  const bytesAtuais = Buffer.byteLength(conteudo, "utf8");
  const linhas = [];
  const partes = conteudo.split(/\r?\n/);
  for (let indice = 0; indice < partes.length; indice += 1) {
    const raw = partes[indice];
    if (!raw.trim()) continue;
    try {
      const registro = JSON.parse(raw);
      linhas.push({ file, linha: indice + 1, raw, registro });
    } catch (erro) {
      return {
        ok: false,
        existe: true,
        file,
        motivo: "jsonl_malformado",
        erro: erro?.message || "jsonl_malformado",
        linha: indice + 1,
        linhasAtuais: linhas.length,
        bytesAtuais,
        hashAtual
      };
    }
  }
  return {
    ok: true,
    existe: true,
    file,
    linhas,
    linhasAtuais: linhas.length,
    bytesAtuais,
    hashAtual
  };
}

function itemRegistro(registro = {}) {
  return registro?.item && typeof registro.item === "object" ? registro.item : registro;
}

function statusOperacionalRegistro(registro = {}) {
  return statusNormalizado(registro.statusOperacional || itemRegistro(registro).status || registro.statusPublico || "");
}

function statusPublicoRegistro(registro = {}) {
  return statusNormalizado(registro.statusPublico || "");
}

function idRegistro(registro = {}) {
  const item = itemRegistro(registro);
  return texto(registro.id || item.id || item.filaItemId || registro.ofertaId || item.ofertaId || registro.engineOfertaId || item.engineOfertaId);
}

function timestampTerminalRegistro(registro = {}) {
  const item = itemRegistro(registro);
  return texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || registro.registradoEm || "");
}

function origemRegistro(registro = {}) {
  const item = itemRegistro(registro);
  const campos = [
    registro.origem,
    registro.motivo,
    registro.fonte,
    registro.detalheRef?.arquivo,
    item.detalheRef?.arquivo,
    item.origem,
    item.motivo,
    item.fonte
  ].map(texto).join(" ").toLowerCase();

  if (campos.includes("fila.json")) return "hook_fila_json";
  if (campos.includes("fila-historico.json") || campos.includes("backfill")) return "backfill_fila_historico";
  return "desconhecida";
}

function assinaturaTerminal(registro = {}) {
  return [
    idRegistro(registro),
    statusPublicoRegistro(registro),
    statusOperacionalRegistro(registro),
    timestampTerminalRegistro(registro)
  ].join("|");
}

function resumoLinha(linha = {}) {
  const registro = linha.registro || {};
  return {
    arquivo: path.basename(linha.file || ""),
    linha: linha.linha || 0,
    chave: texto(registro.chave || "").slice(0, 40),
    identidade: linha.identidade || "",
    id: idRegistro(registro),
    statusPublico: statusPublicoRegistro(registro),
    statusOperacional: statusOperacionalRegistro(registro),
    origem: origemRegistro(registro),
    timestampTerminal: timestampTerminalRegistro(registro),
    registradoEm: texto(registro.registradoEm || "")
  };
}

function compararCanonicos(a, b) {
  const origemA = origemRegistro(a.registro);
  const origemB = origemRegistro(b.registro);
  if (origemA === "hook_fila_json" && origemB !== "hook_fila_json") return -1;
  if (origemB === "hook_fila_json" && origemA !== "hook_fila_json") return 1;

  const ta = Date.parse(a.registro?.registradoEm || timestampTerminalRegistro(a.registro));
  const tb = Date.parse(b.registro?.registradoEm || timestampTerminalRegistro(b.registro));
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return (a.ordemGlobal || 0) - (b.ordemGlobal || 0);
}

function eConflitoConhecidoEngine32325(clienteId, linhas = []) {
  if (clienteSeguro(clienteId) !== CONFLITO_ENGINE_32325.clienteId) return false;
  return linhas.some(linha => texto(linha.registro?.chave) === CONFLITO_ENGINE_32325.chave) &&
    linhas.some(linha => idRegistro(linha.registro) === CONFLITO_ENGINE_32325.id);
}

function escolherCanonicoGrupo(clienteId, identidade, linhas = []) {
  if (linhas.length <= 1) {
    return { tipo: "unico", canonica: linhas[0], removidas: [], conflito: false };
  }

  if (eConflitoConhecidoEngine32325(clienteId, linhas)) {
    const enviadas = linhas.filter(linha =>
      idRegistro(linha.registro) === CONFLITO_ENGINE_32325.id &&
      statusOperacionalRegistro(linha.registro) === CONFLITO_ENGINE_32325.statusOperacionalCanonico
    );
    if (enviadas.length) {
      const canonica = [...enviadas].sort(compararCanonicos)[0];
      return {
        tipo: "conflito_engine_32325_corrupcao_stale",
        canonica,
        removidas: linhas.filter(linha => linha !== canonica),
        conflito: true,
        resolvido: true
      };
    }
  }

  const assinaturas = new Set(linhas.map(linha => assinaturaTerminal(linha.registro)));
  const status = new Set(linhas.map(linha => `${statusPublicoRegistro(linha.registro)}|${statusOperacionalRegistro(linha.registro)}`));
  if (assinaturas.size > 1 && status.size > 1) {
    return {
      tipo: "conflito_desconhecido_preservado",
      canonica: null,
      removidas: [],
      conflito: true,
      resolvido: false,
      linhasPreservadas: linhas
    };
  }

  const canonica = [...linhas].sort(compararCanonicos)[0];
  const origens = new Set(linhas.map(linha => origemRegistro(linha.registro)));
  const tipo = origens.has("hook_fila_json") && origens.has("backfill_fila_historico")
    ? "duplicata_hook_backfill_mesmo_terminal"
    : "duplicata_redundante_mesmo_terminal";
  return {
    tipo,
    canonica,
    removidas: linhas.filter(linha => linha !== canonica),
    conflito: false,
    resolvido: true
  };
}

function montarConteudoJsonl(linhas = []) {
  if (!linhas.length) return "";
  return `${linhas.map(linha => JSON.stringify(linha.registro)).join("\n")}\n`;
}

function analisarCliente(dataDir, alvo, opcoes = {}) {
  const fsImpl = opcoes.fs || fs;
  const clienteId = clienteSeguro(alvo.clienteId);
  const arquivos = alvo.arquivos.map(normalizarArquivoJsonl);
  const leituras = [];
  const erros = [];
  let ordemGlobal = 0;

  for (const arquivo of arquivos) {
    const file = caminhoArquivo(dataDir, clienteId, arquivo);
    const leitura = lerArquivoJsonl(file, fsImpl);
    leituras.push({ arquivo, ...leitura });
    if (!leitura.ok) erros.push({ arquivo, file, motivo: leitura.motivo, linha: leitura.linha, erro: leitura.erro });
  }

  if (erros.length) {
    return {
      ok: false,
      clienteId,
      motivo: "jsonl_malformado",
      erros,
      arquivos: leituras.map(leitura => ({
        arquivo: leitura.arquivo,
        file: leitura.file,
        linhasAtuais: leitura.linhasAtuais || 0,
        hashAtual: leitura.hashAtual || "",
        ok: leitura.ok
      }))
    };
  }

  const grupos = new Map();
  const linhasPorArquivo = new Map();
  for (const leitura of leituras) {
    const linhasArquivo = [];
    for (const linha of leitura.linhas) {
      ordemGlobal += 1;
      linha.ordemGlobal = ordemGlobal;
      linha.arquivo = leitura.arquivo;
      linha.identidade = identidadeRegistro(clienteId, linha.registro, linha.linha - 1);
      linhasArquivo.push(linha);
      if (!grupos.has(linha.identidade)) grupos.set(linha.identidade, []);
      grupos.get(linha.identidade).push(linha);
    }
    linhasPorArquivo.set(leitura.arquivo, linhasArquivo);
  }

  const manter = new Set();
  const remover = new Set();
  const decisoes = [];
  let duplicatas = 0;
  let conflitos = 0;
  let conflitosResolvidos = 0;
  let conflitosPreservados = 0;

  for (const [identidade, linhas] of grupos.entries()) {
    if (linhas.length > 1) duplicatas += linhas.length - 1;
    const decisao = escolherCanonicoGrupo(clienteId, identidade, linhas);
    if (decisao.conflito) {
      conflitos += 1;
      if (decisao.resolvido) conflitosResolvidos += 1;
      else conflitosPreservados += 1;
    }
    if (decisao.canonica) manter.add(decisao.canonica);
    for (const linha of decisao.linhasPreservadas || []) manter.add(linha);
    for (const linha of decisao.removidas || []) remover.add(linha);
    if ((decisao.removidas || []).length || decisao.conflito) {
      decisoes.push({
        identidade,
        tipo: decisao.tipo,
        conflito: decisao.conflito,
        resolvido: decisao.resolvido === true,
        totalGrupo: linhas.length,
        canonicaSelecionada: decisao.canonica ? resumoLinha(decisao.canonica) : null,
        linhasRemovidas: (decisao.removidas || []).map(resumoLinha),
        linhasPreservadas: (decisao.linhasPreservadas || []).map(resumoLinha)
      });
    }
  }

  for (const linhas of grupos.values()) {
    if (linhas.length === 1) manter.add(linhas[0]);
  }

  const arquivosResumo = [];
  let linhasAtuais = 0;
  let linhasFinais = 0;
  let bytesAtuais = 0;
  let bytesFinais = 0;
  for (const leitura of leituras) {
    const atuais = linhasPorArquivo.get(leitura.arquivo) || [];
    const finais = atuais.filter(linha => !remover.has(linha));
    const conteudoSimulado = montarConteudoJsonl(finais);
    const bytesFinal = Buffer.byteLength(conteudoSimulado, "utf8");
    linhasAtuais += leitura.linhasAtuais || 0;
    linhasFinais += finais.length;
    bytesAtuais += leitura.bytesAtuais || 0;
    bytesFinais += bytesFinal;
    arquivosResumo.push({
      arquivo: leitura.arquivo,
      file: leitura.file,
      existe: leitura.existe,
      linhasAtuais: leitura.linhasAtuais || 0,
      chavesAtuais: new Set(atuais.map(linha => linha.identidade)).size,
      duplicatasAtuais: Math.max(0, atuais.length - new Set(atuais.map(linha => linha.identidade)).size),
      linhasFinais: finais.length,
      chavesFinais: new Set(finais.map(linha => linha.identidade)).size,
      duplicatasFinais: Math.max(0, finais.length - new Set(finais.map(linha => linha.identidade)).size),
      linhasRemover: atuais.filter(linha => remover.has(linha)).length,
      bytesAtuais: leitura.bytesAtuais || 0,
      bytesFinais: bytesFinal,
      bytesEstimadosDelta: bytesFinal - (leitura.bytesAtuais || 0),
      hashAtual: leitura.hashAtual,
      hashSimulado: sha256(conteudoSimulado),
      alterado: conteudoSimulado !== (leitura.existe ? fsImpl.readFileSync(leitura.file, "utf8") : "")
    });
  }

  return {
    ok: true,
    clienteId,
    dryRun: opcoes.apply !== true,
    linhasAtuais,
    chavesAtuais: grupos.size,
    duplicatas,
    conflitos,
    conflitosResolvidos,
    conflitosPreservados,
    linhasRemover: remover.size,
    linhasFinais,
    chavesFinais: new Set(Array.from(manter).map(linha => linha.identidade)).size,
    duplicatasFinais: Math.max(0, linhasFinais - new Set(Array.from(manter).map(linha => linha.identidade)).size),
    bytesAtuais,
    bytesFinais,
    bytesEstimadosDelta: bytesFinais - bytesAtuais,
    arquivos: arquivosResumo,
    decisoes,
    _linhasPorArquivo: linhasPorArquivo,
    _remover: remover
  };
}

function validarConteudoJsonl(conteudo = "") {
  let linhas = 0;
  const chaves = new Set();
  const partes = conteudo.split(/\r?\n/);
  for (let indice = 0; indice < partes.length; indice += 1) {
    const linha = partes[indice];
    if (!linha.trim()) continue;
    const registro = JSON.parse(linha);
    linhas += 1;
    if (registro?.chave) chaves.add(texto(registro.chave));
  }
  return { ok: true, linhas, chaves: chaves.size };
}

function aplicarCliente(resultado, opcoes = {}) {
  if (!resultado.ok) return { ok: false, motivo: resultado.motivo || "analise_invalida", aplicados: [] };
  const fsImpl = opcoes.fs || fs;
  const timestamp = opcoes.timestampBackup || new Date().toISOString().replace(/[:.]/g, "-");
  const aplicados = [];

  for (const arquivo of resultado.arquivos || []) {
    if (!arquivo.alterado) continue;
    const linhas = resultado._linhasPorArquivo.get(arquivo.arquivo) || [];
    const finais = linhas.filter(linha => !resultado._remover.has(linha));
    const conteudoFinal = montarConteudoJsonl(finais);
    const validacao = validarConteudoJsonl(conteudoFinal);
    if (validacao.linhas !== arquivo.linhasFinais) {
      return { ok: false, motivo: "validacao_contagem_falhou", arquivo: arquivo.arquivo, validacao };
    }

    const dir = path.dirname(arquivo.file);
    const backup = `${arquivo.file}.bak.${timestamp}`;
    const tmp = path.join(dir, `${path.basename(arquivo.file)}.tmp.${process.pid}.${timestamp}`);
    fsImpl.copyFileSync(arquivo.file, backup);
    fsImpl.writeFileSync(tmp, conteudoFinal, "utf8");
    const conteudoTmp = fsImpl.readFileSync(tmp, "utf8");
    const validacaoTmp = validarConteudoJsonl(conteudoTmp);
    if (validacaoTmp.linhas !== arquivo.linhasFinais || sha256(conteudoTmp) !== arquivo.hashSimulado) {
      try { fsImpl.unlinkSync(tmp); } catch {}
      return { ok: false, motivo: "validacao_tmp_falhou", arquivo: arquivo.arquivo, backup, tmp, validacaoTmp };
    }
    fsImpl.renameSync(tmp, arquivo.file);
    aplicados.push({ arquivo: arquivo.arquivo, file: arquivo.file, backup, linhasAntes: arquivo.linhasAtuais, linhasDepois: arquivo.linhasFinais });
  }

  return { ok: true, aplicados };
}

function repararHistoricoLeveJsonl(opcoes = {}) {
  const fsImpl = opcoes.fs || fs;
  const dataDir = path.resolve(opcoes.dataDir || process.env.DATA_DIR || "/data");
  const alvos = normalizarAlvos(opcoes);
  const clientes = alvos.map(alvo => analisarCliente(dataDir, alvo, { ...opcoes, fs: fsImpl }));
  const okAnalise = clientes.every(cliente => cliente.ok);
  const resultado = {
    ok: okAnalise,
    apply: opcoes.apply === true,
    dryRun: opcoes.apply !== true,
    dataDir,
    alvos: alvos.map(alvo => ({ clienteId: alvo.clienteId, arquivos: alvo.arquivos })),
    clientes: clientes.map(cliente => {
      const { _linhasPorArquivo, _remover, ...publico } = cliente;
      return publico;
    })
  };

  if (!okAnalise || opcoes.apply !== true) return resultado;

  const aplicacoes = [];
  for (const cliente of clientes) {
    const applyCliente = aplicarCliente(cliente, { ...opcoes, fs: fsImpl });
    aplicacoes.push({ clienteId: cliente.clienteId, ...applyCliente });
    if (!applyCliente.ok) {
      resultado.ok = false;
      resultado.motivo = applyCliente.motivo;
      resultado.aplicacoes = aplicacoes;
      return resultado;
    }
  }
  resultado.aplicacoes = aplicacoes;
  return resultado;
}

module.exports = {
  ALVOS_PADRAO,
  CONFLITO_ENGINE_32325,
  HISTORICO_LEVE_INCREMENTAL_DIR,
  repararHistoricoLeveJsonl,
  analisarCliente,
  aplicarCliente,
  identidadeRegistro,
  chaveHistoricoLeveFallback,
  origemRegistro,
  statusOperacionalRegistro,
  statusPublicoRegistro
};
