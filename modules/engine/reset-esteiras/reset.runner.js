"use strict";

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_LOTE_TAMANHO,
  GRUPOS_ESTEIRA,
  STATUS_FINAL_EXPIRADO,
  limitarLote,
  gerarOperationId,
  stableStringify,
  sanitizarItem,
  hashObjeto,
  hashCurto,
  identidadeItem,
  classificarItemResetEsteira,
  resumoLeveItem
} = require("./criterios.service");

function dataDir(opcoes = {}) {
  return opcoes.dataDir || process.env.DATA_DIR || "/data";
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const texto = fs.readFileSync(file, "utf8");
    if (!texto) return fallback;
    return JSON.parse(texto);
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(file, dados, opcoes = {}) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const conteudo = JSON.stringify(dados, null, 2);
  fs.writeFileSync(tmp, conteudo);
  if (opcoes.falharAntesRename === true) {
    const erro = new Error("falha_injetada_antes_rename");
    erro.tmpFile = tmp;
    throw erro;
  }
  fs.renameSync(tmp, file);
  return true;
}

function workspaceSeguro(valor = "") {
  const texto = String(valor || "").trim();
  if (!texto || texto.includes("..") || texto.includes("/") || texto.includes("\\") || !/^[a-zA-Z0-9_.-]+$/.test(texto)) {
    throw new Error("workspace_id_inseguro");
  }
  return texto;
}

function clientesDir(opcoes = {}) {
  return path.join(dataDir(opcoes), "clientes");
}

function filaPath(workspaceId = "", opcoes = {}) {
  return path.join(clientesDir(opcoes), workspaceSeguro(workspaceId), "fila.json");
}

function operacaoDir(operationId = "", opcoes = {}) {
  return path.join(dataDir(opcoes), "reset-esteiras", workspaceSeguro(operationId));
}

function caminhosOperacao(operationId = "", opcoes = {}) {
  const base = operacaoDir(operationId, opcoes);
  return {
    base,
    manifest: path.join(base, "manifest.json"),
    hashes: path.join(base, "hashes.json"),
    snapshot: path.join(base, "snapshot"),
    lotes: path.join(base, "lotes"),
    rollback: path.join(base, "rollback"),
    execute: path.join(base, "execute"),
    historico: path.join(base, "historico-expirados-fluxo-vivo.json")
  };
}

function listarWorkspaces(opcoes = {}) {
  const dir = clientesDir(opcoes);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entrada => entrada.isDirectory())
    .map(entrada => entrada.name)
    .filter(nome => fs.existsSync(path.join(dir, nome, "fila.json")))
    .sort();
}

function incrementar(mapa = {}, chave = "") {
  const k = String(chave || "desconhecido");
  mapa[k] = (mapa[k] || 0) + 1;
}

function media(valores = []) {
  if (!valores.length) return null;
  return Math.round(valores.reduce((total, valor) => total + valor, 0) / valores.length);
}

function percentil(valores = [], p = 0.95) {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.max(0, Math.ceil(ordenados.length * p) - 1));
  return ordenados[indice];
}

function mediana(valores = []) {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : Math.round((ordenados[meio - 1] + ordenados[meio]) / 2);
}

function amostra(lista = []) {
  const ids = lista.map(item => item.identidade?.chave || "");
  return {
    primeira: ids.slice(0, 5),
    ultima: ids.slice(Math.max(0, ids.length - 5))
  };
}

function estatisticasRegistros(registros = []) {
  const idades = registros.map(item => item.idadeMs).filter(valor => Number.isFinite(valor));
  const porStatus = {};
  const porMarketplace = {};
  const porDestino = {};
  for (const item of registros) {
    incrementar(porStatus, item.statusAnterior || "sem_status");
    incrementar(porMarketplace, item.marketplace || "desconhecido");
    incrementar(porDestino, item.destinoId || "sem_destino");
  }
  return {
    total: registros.length,
    porStatus,
    porMarketplace,
    porDestino,
    idadeMinimaMs: idades.length ? Math.min(...idades) : null,
    idadeMediaMs: media(idades),
    idadeMedianaMs: mediana(idades),
    idadeP95Ms: percentil(idades, 0.95),
    idadeMaximaMs: idades.length ? Math.max(...idades) : null,
    amostra: amostra(registros)
  };
}

function prepararDirs(caminhos) {
  ensureDir(caminhos.base);
  ensureDir(caminhos.snapshot);
  ensureDir(caminhos.lotes);
  ensureDir(caminhos.rollback);
  ensureDir(caminhos.execute);
}

function criarRegistroSnapshot({ workspaceId, arquivoOrigem, indiceOriginal, item, classificacao, operationId, loteNumero = null } = {}) {
  const identidade = classificacao.identidade || identidadeItem(item);
  const sanitized = sanitizarItem(item);
  const timestamps = {};
  for (const campo of ["dataEntradaFila", "criadoEm", "adicionadoEm", "entradaFilaEm", "updatedAt", "atualizadoEm", "enviadoEm", "dataEnvio"]) {
    if (item?.[campo]) timestamps[campo] = item[campo];
  }
  return {
    operationId,
    workspaceId,
    arquivoOrigem,
    indiceOriginal,
    identidade,
    id: item.id || item.filaItemId || item.fila_item_id || "",
    ofertaId: item.ofertaId || item.oferta_id || item.idOferta || "",
    jobId: item.jobId || item.job_id || item.engineJobId || "",
    destinoId: item.destinoId || item.destino_id || item.destino || item.chatId || item.grupoId || item.jid || item.canalId || "",
    statusAnterior: item.status || item.situacao || "",
    dataEntradaFila: item.dataEntradaFila || item.criadoEm || item.adicionadoEm || item.createdAt || "",
    timestamps,
    grupo: classificacao.grupo,
    motivo: classificacao.motivo,
    bucket: classificacao.bucket,
    marketplace: item.marketplace || item.marketplaceDetectado || item.loja || "",
    idadeMs: classificacao.idadeMs ?? null,
    ttlMs: classificacao.ttlMs ?? null,
    hashIndividual: identidade.hashIndividual,
    lote: loteNumero,
    item: sanitized
  };
}

function analisarWorkspace({ workspaceId, operationId, cutoffMs, agoraMs, loteTamanho, opcoes }) {
  const arquivoOrigem = filaPath(workspaceId, opcoes);
  const fila = readJson(arquivoOrigem, []);
  const itens = Array.isArray(fila) ? fila : [];
  const contagemIdentidades = {};
  for (const item of itens) {
    const chave = identidadeItem(item).chave;
    contagemIdentidades[chave] = (contagemIdentidades[chave] || 0) + 1;
  }

  const grupos = {
    [GRUPOS_ESTEIRA.PRESERVAR_HISTORICO]: [],
    [GRUPOS_ESTEIRA.PRESERVAR_ATIVO]: [],
    [GRUPOS_ESTEIRA.EXPIRAR]: [],
    [GRUPOS_ESTEIRA.AUDITAR]: []
  };

  for (let indice = 0; indice < itens.length; indice += 1) {
    const item = itens[indice];
    const identidade = identidadeItem(item);
    const colidiu = contagemIdentidades[identidade.chave] > 1;
    const classificacao = classificarItemResetEsteira(item, { agoraMs, cutoffMs, colidiu });
    const registro = criarRegistroSnapshot({ workspaceId, arquivoOrigem, indiceOriginal: indice, item, classificacao, operationId });
    grupos[registro.grupo].push(registro);
  }

  let lote = 1;
  for (let i = 0; i < grupos[GRUPOS_ESTEIRA.EXPIRAR].length; i += loteTamanho) {
    for (const registro of grupos[GRUPOS_ESTEIRA.EXPIRAR].slice(i, i + loteTamanho)) {
      registro.lote = lote;
    }
    lote += 1;
  }

  return { workspaceId, arquivoOrigem, totalFila: itens.length, grupos };
}

function hashConjunto(registros = []) {
  return hashObjeto(registros.map(item => item.identidade?.chave || "").sort());
}

function montarManifest({ operationId, operationStartedAt, cutoffCongelado, loteTamanho, workspaces }) {
  const totais = {
    preservarHistorico: 0,
    preservarAtivo: 0,
    expirar: 0,
    auditar: 0,
    totalFila: 0
  };
  const porWorkspace = {};
  for (const workspace of workspaces) {
    const resumo = {
      totalFila: workspace.totalFila,
      preservarHistorico: workspace.grupos[GRUPOS_ESTEIRA.PRESERVAR_HISTORICO].length,
      preservarAtivo: workspace.grupos[GRUPOS_ESTEIRA.PRESERVAR_ATIVO].length,
      expirar: workspace.grupos[GRUPOS_ESTEIRA.EXPIRAR].length,
      auditar: workspace.grupos[GRUPOS_ESTEIRA.AUDITAR].length,
      hashes: {
        preservarHistorico: hashConjunto(workspace.grupos[GRUPOS_ESTEIRA.PRESERVAR_HISTORICO]),
        preservarAtivo: hashConjunto(workspace.grupos[GRUPOS_ESTEIRA.PRESERVAR_ATIVO]),
        expirar: hashConjunto(workspace.grupos[GRUPOS_ESTEIRA.EXPIRAR]),
        auditar: hashConjunto(workspace.grupos[GRUPOS_ESTEIRA.AUDITAR])
      },
      estatisticas: {
        expirar: estatisticasRegistros(workspace.grupos[GRUPOS_ESTEIRA.EXPIRAR]),
        auditar: estatisticasRegistros(workspace.grupos[GRUPOS_ESTEIRA.AUDITAR]),
        preservarAtivo: estatisticasRegistros(workspace.grupos[GRUPOS_ESTEIRA.PRESERVAR_ATIVO])
      }
    };
    porWorkspace[workspace.workspaceId] = resumo;
    totais.totalFila += resumo.totalFila;
    totais.preservarHistorico += resumo.preservarHistorico;
    totais.preservarAtivo += resumo.preservarAtivo;
    totais.expirar += resumo.expirar;
    totais.auditar += resumo.auditar;
  }
  return {
    ok: true,
    modo: "dry-run",
    aplicouMudancasOperacionais: false,
    operationId,
    operationStartedAt,
    cutoffCongelado,
    loteTamanho,
    criterioHash: hashObjeto({ cutoffCongelado, grupos: GRUPOS_ESTEIRA, statusFinal: STATUS_FINAL_EXPIRADO }),
    totais,
    porWorkspace
  };
}

function registroSemPayload(registro = {}) {
  const { item: _item, ...restante } = registro;
  return restante;
}

function workspaceSnapshotSeguro(workspace = {}) {
  return {
    workspaceId: workspace.workspaceId,
    arquivoOrigem: workspace.arquivoOrigem,
    totalFila: workspace.totalFila,
    grupos: Object.fromEntries(Object.entries(workspace.grupos || {}).map(([grupo, registros]) => [
      grupo,
      (Array.isArray(registros) ? registros : []).map(registroSemPayload)
    ]))
  };
}

function materializarSnapshot({ caminhos, workspaces }) {
  const hashes = {};
  let lotesTotal = 0;
  for (const workspace of workspaces) {
    const snapshotFile = path.join(caminhos.snapshot, `${workspace.workspaceId}.json`);
    writeJsonAtomic(snapshotFile, workspaceSnapshotSeguro(workspace), {});
    hashes[workspace.workspaceId] = {
      expirar: hashConjunto(workspace.grupos[GRUPOS_ESTEIRA.EXPIRAR]),
      auditar: hashConjunto(workspace.grupos[GRUPOS_ESTEIRA.AUDITAR]),
      preservarAtivo: hashConjunto(workspace.grupos[GRUPOS_ESTEIRA.PRESERVAR_ATIVO])
    };

    const porLote = new Map();
    for (const registro of workspace.grupos[GRUPOS_ESTEIRA.EXPIRAR]) {
      const lote = registro.lote || 1;
      if (!porLote.has(lote)) porLote.set(lote, []);
      porLote.get(lote).push(registro);
    }
    for (const [lote, registros] of porLote.entries()) {
      lotesTotal += 1;
      writeJsonAtomic(path.join(caminhos.lotes, `${workspace.workspaceId}-${lote}.json`), {
        workspaceId: workspace.workspaceId,
        lote,
        grupo: GRUPOS_ESTEIRA.EXPIRAR,
        total: registros.length,
        registros
      }, {});
    }
  }
  writeJsonAtomic(caminhos.hashes, hashes, {});
  return { hashes, lotesTotal };
}

async function executarDryRunResetEsteiras(opcoes = {}) {
  const loteTamanho = limitarLote(opcoes.loteTamanho || opcoes.batchSize || DEFAULT_LOTE_TAMANHO);
  const operationStartedAt = opcoes.operationStartedAt ? new Date(opcoes.operationStartedAt) : new Date();
  const cutoffCongelado = opcoes.cutoffCongelado ? new Date(opcoes.cutoffCongelado) : operationStartedAt;
  const operationId = opcoes.operationId || gerarOperationId();
  const caminhos = caminhosOperacao(operationId, opcoes);
  prepararDirs(caminhos);

  const workspaces = listarWorkspaces(opcoes).map(workspaceId => analisarWorkspace({
    workspaceId,
    operationId,
    cutoffMs: cutoffCongelado.getTime(),
    agoraMs: operationStartedAt.getTime(),
    loteTamanho,
    opcoes
  }));

  const manifest = montarManifest({
    operationId,
    operationStartedAt: operationStartedAt.toISOString(),
    cutoffCongelado: cutoffCongelado.toISOString(),
    loteTamanho,
    workspaces
  });
  const materializacao = materializarSnapshot({ caminhos, workspaces });
  manifest.hashes = materializacao.hashes;
  manifest.quantidadeLotes = materializacao.lotesTotal;
  manifest.snapshotDir = caminhos.base;
  writeJsonAtomic(caminhos.manifest, manifest, {});
  writeJsonAtomic(path.join(caminhos.rollback, "README.json"), {
    operationId,
    aviso: "rollback usa arquivos em execute/*.json gerados somente pelo execute confirmado"
  }, {});

  console.log("[ENGINE-RESET-ESTEIRAS-DRY-RUN]", JSON.stringify({
    operationId,
    aplicouMudancasOperacionais: false,
    totais: manifest.totais,
    quantidadeLotes: manifest.quantidadeLotes
  }));

  return manifest;
}

function carregarManifest(operationId, opcoes = {}) {
  const caminhos = caminhosOperacao(operationId, opcoes);
  const manifest = readJson(caminhos.manifest, null);
  if (!manifest) throw new Error("operation_id_nao_encontrado");
  return { caminhos, manifest };
}

function validarConfirmacao(operationId = "", confirmOperationId = "", modo = "execute") {
  if (!operationId || !confirmOperationId || String(operationId) !== String(confirmOperationId)) {
    throw new Error(`${modo}_exige_confirm_operation_id`);
  }
}

function localizarIndicePorIdentidade(fila = [], registro = {}) {
  const chave = registro.identidade?.chave || "";
  const encontrados = [];
  for (let i = 0; i < fila.length; i += 1) {
    if (identidadeItem(fila[i]).chave === chave) encontrados.push(i);
  }
  return encontrados;
}

function existeEquivalente(fila = [], registro = {}) {
  const chave = registro.identidade?.chave || "";
  const ofertaId = String(registro.ofertaId || "").trim();
  const jobId = String(registro.jobId || "").trim();
  return fila.some(item => {
    const identidade = identidadeItem(item);
    if (chave && identidade.chave === chave) return true;
    if (ofertaId && String(item.ofertaId || item.oferta_id || item.idOferta || "") === ofertaId) return true;
    if (jobId && String(item.jobId || item.job_id || item.engineJobId || "") === jobId) return true;
    return false;
  });
}

function executarLoteWorkspace(lote = {}, manifest = {}, caminhos = {}, opcoes = {}) {
  const workspaceId = lote.workspaceId;
  const file = filaPath(workspaceId, opcoes);
  const filaAtual = readJson(file, []);
  if (!Array.isArray(filaAtual)) throw new Error("fila_json_invalida");
  const cutoffMs = new Date(manifest.cutoffCongelado).getTime();
  const agoraMs = Date.now();
  const removidos = [];
  const pulados = [];
  const indicesRemover = [];

  for (const registro of lote.registros || []) {
    const indices = localizarIndicePorIdentidade(filaAtual, registro);
    if (indices.length !== 1) {
      pulados.push({ identidade: registro.identidade, motivo: indices.length ? "identidade_ambigua_execute" : "item_nao_encontrado" });
      continue;
    }
    const indice = indices[0];
    const itemAtual = filaAtual[indice];
    const hashAtual = identidadeItem(itemAtual).hashIndividual;
    if (hashAtual !== registro.hashIndividual) {
      pulados.push({ identidade: registro.identidade, motivo: "hash_individual_divergente" });
      continue;
    }
    const classificacaoAtual = classificarItemResetEsteira(itemAtual, { agoraMs, cutoffMs, colidiu: false });
    if (classificacaoAtual.grupo !== GRUPOS_ESTEIRA.EXPIRAR) {
      pulados.push({ identidade: registro.identidade, motivo: `grupo_atual_${classificacaoAtual.grupo}` });
      continue;
    }
    indicesRemover.push(indice);
    removidos.push({ ...registro, removidoEm: new Date().toISOString(), historicoLeve: resumoLeveItem(itemAtual, classificacaoAtual) });
  }

  const novaFila = filaAtual.filter((_, indice) => !indicesRemover.includes(indice));
  if (removidos.length) writeJsonAtomic(file, novaFila, opcoes);

  const historico = readJson(caminhos.historico, []);
  const historicoAtualizado = historico.concat(removidos.map(item => item.historicoLeve));
  if (removidos.length) writeJsonAtomic(caminhos.historico, historicoAtualizado, opcoes);

  return { workspaceId, lote: lote.lote, removidos, pulados, antes: filaAtual.length, depois: novaFila.length };
}

async function executarResetEsteiras(opcoes = {}) {
  validarConfirmacao(opcoes.operationId, opcoes.confirmOperationId, "execute");
  const { caminhos, manifest } = carregarManifest(opcoes.operationId, opcoes);
  const arquivos = fs.existsSync(caminhos.lotes) ? fs.readdirSync(caminhos.lotes).filter(nome => nome.endsWith(".json")).sort() : [];
  const maxLotes = Number(opcoes.maxLotes || 0);
  const resultados = [];
  let processados = 0;

  for (const arquivo of arquivos) {
    if (maxLotes > 0 && processados >= maxLotes) break;
    const lote = readJson(path.join(caminhos.lotes, arquivo), null);
    if (!lote) continue;
    const resultado = executarLoteWorkspace(lote, manifest, caminhos, opcoes);
    resultados.push(resultado);
    writeJsonAtomic(path.join(caminhos.execute, arquivo), resultado, {});
    processados += 1;
  }

  const resumo = {
    ok: true,
    modo: "execute",
    operationId: opcoes.operationId,
    lotesProcessados: resultados.length,
    removidos: resultados.reduce((total, item) => total + item.removidos.length, 0),
    pulados: resultados.reduce((total, item) => total + item.pulados.length, 0),
    aplicouMudancasOperacionais: resultados.some(item => item.removidos.length > 0),
    resultados
  };
  console.log("[ENGINE-RESET-ESTEIRAS-EXECUTE]", JSON.stringify({
    operationId: resumo.operationId,
    lotesProcessados: resumo.lotesProcessados,
    removidos: resumo.removidos,
    pulados: resumo.pulados
  }));
  return resumo;
}

function restaurarWorkspace(registros = [], opcoes = {}) {
  if (!registros.length) return { workspaceId: "", restaurados: 0, pulados: 0 };
  const workspaceId = registros[0].workspaceId;
  const file = filaPath(workspaceId, opcoes);
  const filaAtual = readJson(file, []);
  if (!Array.isArray(filaAtual)) throw new Error("fila_json_invalida");
  let filaNova = [...filaAtual];
  let restaurados = 0;
  let pulados = 0;

  for (const registro of registros.sort((a, b) => Number(a.indiceOriginal || 0) - Number(b.indiceOriginal || 0))) {
    if (existeEquivalente(filaNova, registro)) {
      pulados += 1;
      continue;
    }
    const indice = Math.max(0, Math.min(Number(registro.indiceOriginal || filaNova.length), filaNova.length));
    filaNova.splice(indice, 0, registro.item);
    restaurados += 1;
  }

  if (restaurados > 0) writeJsonAtomic(file, filaNova, opcoes);
  return { workspaceId, restaurados, pulados };
}

async function executarRollbackResetEsteiras(opcoes = {}) {
  validarConfirmacao(opcoes.operationId, opcoes.confirmOperationId, "rollback");
  const { caminhos } = carregarManifest(opcoes.operationId, opcoes);
  const arquivos = fs.existsSync(caminhos.execute) ? fs.readdirSync(caminhos.execute).filter(nome => nome.endsWith(".json")).sort().reverse() : [];
  const porWorkspace = new Map();
  for (const arquivo of arquivos) {
    const resultado = readJson(path.join(caminhos.execute, arquivo), null);
    for (const registro of resultado?.removidos || []) {
      if (!porWorkspace.has(registro.workspaceId)) porWorkspace.set(registro.workspaceId, []);
      porWorkspace.get(registro.workspaceId).push(registro);
    }
  }

  const resultados = [];
  for (const registros of porWorkspace.values()) {
    resultados.push(restaurarWorkspace(registros, opcoes));
  }
  const resumo = {
    ok: true,
    modo: "rollback",
    operationId: opcoes.operationId,
    restaurados: resultados.reduce((total, item) => total + item.restaurados, 0),
    pulados: resultados.reduce((total, item) => total + item.pulados, 0),
    resultados
  };
  console.log("[ENGINE-RESET-ESTEIRAS-ROLLBACK]", JSON.stringify({
    operationId: resumo.operationId,
    restaurados: resumo.restaurados,
    pulados: resumo.pulados
  }));
  return resumo;
}

async function executarResetEsteirasCli(opcoes = {}) {
  const mode = String(opcoes.mode || opcoes.modo || "").toLowerCase();
  if (mode === "dry-run") return executarDryRunResetEsteiras(opcoes);
  if (mode === "execute") return executarResetEsteiras(opcoes);
  if (mode === "rollback") return executarRollbackResetEsteiras(opcoes);
  throw new Error("mode_invalido");
}

module.exports = {
  caminhosOperacao,
  filaPath,
  listarWorkspaces,
  writeJsonAtomic,
  executarDryRunResetEsteiras,
  executarResetEsteiras,
  executarRollbackResetEsteiras,
  executarResetEsteirasCli
};
