"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  getClienteJsonPath,
  getClientePath,
  readClienteJson,
  writeClienteJson
} = require("../../utils/storage");
const {
  FILA_VIVA_ARQUIVO,
  FILA_LEGADA_ARQUIVO,
  classificarItemFilaV2,
  projetarFilaV2
} = require("./fila-v2-shadow");

const FLAG_OPERACIONAL_ATIVA = "FILA_V2_OPERACIONAL_ATIVA";
const FLAG_ROLLOUT_ATIVO = "FILA_V2_OPERACIONAL_ROLLOUT";
const FLAG_CANARY_CLIENTES = "FILA_V2_OPERACIONAL_CANARY_CLIENTES";
const FLAG_2B1_SHADOW_ATIVA = "FILA_V2_2B1_SHADOW_ATIVA";
const HISTORICO_INCREMENTAL_DIR = "fila-historico-incremental";
const TAG_TELEMETRIA = "[FILA-V2-OPERACIONAL]";
const TAG_CANARY_WRITER = "[FILA-V2-CANARY-WRITE]";
const TAG_2C = "[FILA-V2-2C]";
const FLAG_CHECKPOINT_MUTACOES = "FILA_V2_CHECKPOINT_MUTACOES";
const FLAG_CHECKPOINT_INTERVALO_MS = "FILA_V2_CHECKPOINT_INTERVALO_MS";
const FLAG_CHECKPOINT_MAX_DIRTY_MS = "FILA_V2_CHECKPOINT_MAX_DIRTY_MS";
const DEFAULT_CHECKPOINT_MUTACOES = 25;
const DEFAULT_CHECKPOINT_INTERVALO_MS = 60_000;
const DEFAULT_CHECKPOINT_MAX_DIRTY_MS = 120_000;
const cacheChavesHistorico = new Map();

function texto(valor = "") {
  return String(valor || "").trim();
}

function clienteSeguro(clienteId = "admin") {
  return texto(clienteId || "admin") || "admin";
}

function agoraIso(agora = Date.now()) {
  const ms = Number(agora || Date.now());
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

function statusItem(item = {}) {
  return texto(item.status || item.estado || "pendente").toLowerCase();
}

function idItem(item = {}, indice = -1) {
  return texto(
    item.id ||
    item.ofertaId ||
    item.oferta_id ||
    item.engineOfertaId ||
    item.engine_oferta_id ||
    item.idOferta
  ) || `indice:${indice}`;
}

function normalizarEntradaViva(valor = {}, indice = 0, agora = Date.now()) {
  if (valor && typeof valor === "object" && valor.item && typeof valor.item === "object") {
    return {
      posicaoLegada: Number.isInteger(Number(valor.posicaoLegada)) ? Number(valor.posicaoLegada) : indice,
      bucket: valor.bucket || "viva",
      motivoBucket: valor.motivoBucket || "",
      status: valor.status || statusItem(valor.item),
      id: valor.id || idItem(valor.item, indice),
      item: valor.item
    };
  }

  const item = valor && typeof valor === "object" ? valor : {};
  const classificacao = classificarItemFilaV2(item, { agora });
  return {
    posicaoLegada: indice,
    bucket: classificacao.bucket || "viva",
    motivoBucket: classificacao.motivo || "normalizado_operacional",
    status: statusItem(item),
    id: idItem(item, indice),
    item
  };
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function modoRollout(valor = "") {
  const modo = texto(valor).toLowerCase();
  if (["legacy", "canary", "global"].includes(modo)) return modo;
  return "legacy";
}

function listaCanaryClientes(valor = "") {
  return [...new Set(
    texto(valor)
      .split(/[\s,;|]+/)
      .map(clienteSeguro)
      .filter(Boolean)
  )];
}

function resolverModoOperacional(env = process.env) {
  return {
    operacionalAtivo: flagAtiva(FLAG_OPERACIONAL_ATIVA, env),
    shadow2B1Ativo: flagAtiva(FLAG_2B1_SHADOW_ATIVA, env),
    rolloutOperacional: modoRollout(env?.[FLAG_ROLLOUT_ATIVO] || ""),
    canaryClientes: listaCanaryClientes(env?.[FLAG_CANARY_CLIENTES] || "")
  };
}

function deveUsarFilaV2Operacional(clienteId = "admin", env = process.env) {
  const modo = resolverModoOperacional(env);
  if (modo.operacionalAtivo) return true;
  if (modo.rolloutOperacional === "global") return true;
  if (modo.rolloutOperacional === "canary") {
    return modo.canaryClientes.includes(clienteSeguro(clienteId));
  }
  return false;
}

function normalizarEntradasViva(valor = [], agora = Date.now()) {
  return lista(valor).map((item, indice) => normalizarEntradaViva(item, indice, agora));
}

function caminhoJsonCliente(clienteId = "admin", arquivo = "", deps = {}) {
  const resolver = deps.getClienteJsonPath || getClienteJsonPath;
  return typeof resolver === "function" ? resolver(clienteSeguro(clienteId), arquivo) : "";
}

function caminhoDirCliente(clienteId = "admin", deps = {}) {
  const resolver = deps.getClientePath || getClientePath;
  if (typeof resolver === "function") return resolver(clienteSeguro(clienteId));
  const filaPath = caminhoJsonCliente(clienteId, FILA_VIVA_ARQUIVO, deps);
  return filaPath ? path.dirname(filaPath) : "";
}

function tamanhoArquivo(file = "", fsImpl = fs) {
  try {
    return file && fsImpl.existsSync(file) ? fsImpl.statSync(file).size : 0;
  } catch {
    return 0;
  }
}

function statArquivoSeguro(file = "", fsImpl = fs) {
  try {
    if (!file || !fsImpl.existsSync(file)) return { existe: false, bytes: 0, mtimeMs: 0 };
    const stat = fsImpl.statSync(file);
    return {
      existe: true,
      bytes: Number(stat.size || 0),
      mtimeMs: Number(stat.mtimeMs || 0)
    };
  } catch {
    return { existe: false, bytes: 0, mtimeMs: 0 };
  }
}

function tamanhoJsonBytes(valor) {
  try {
    return Buffer.byteLength(JSON.stringify(valor), "utf8");
  } catch {
    return 0;
  }
}

function numeroLimite(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(maximo, Math.max(minimo, Math.floor(numero)));
}

function politicaCheckpointLegado(env = process.env) {
  return {
    mutacoes: numeroLimite(env?.[FLAG_CHECKPOINT_MUTACOES], DEFAULT_CHECKPOINT_MUTACOES, 1, 1000),
    intervaloMs: numeroLimite(env?.[FLAG_CHECKPOINT_INTERVALO_MS], DEFAULT_CHECKPOINT_INTERVALO_MS, 5_000, 3_600_000),
    maxDirtyMs: numeroLimite(env?.[FLAG_CHECKPOINT_MAX_DIRTY_MS], DEFAULT_CHECKPOINT_MAX_DIRTY_MS, 5_000, 3_600_000)
  };
}

function logOperacional(logger = console, payload = {}) {
  try {
    const destino = logger && typeof logger.log === "function" ? logger : console;
    destino.log(TAG_TELEMETRIA, JSON.stringify(payload));
  } catch {}
}

function log2C(logger = console, payload = {}) {
  try {
    const destino = logger && typeof logger.log === "function" ? logger : console;
    destino.log(TAG_2C, JSON.stringify(payload));
  } catch {}
}

function hashCurto(valor = "") {
  return crypto.createHash("sha1").update(String(valor || "")).digest("hex").slice(0, 12);
}

function lerJsonArquivoDireto(file = "", fallback = null, fsImpl = fs) {
  if (!file) return { ok: false, motivo: "caminho_indisponivel", valor: fallback, bytes: 0 };
  try {
    if (!fsImpl.existsSync(file)) {
      const tmpExiste = fsImpl.existsSync(`${file}.tmp`);
      return {
        ok: false,
        motivo: tmpExiste ? "arquivo_principal_ausente_tmp_presente" : "arquivo_ausente",
        valor: fallback,
        bytes: 0
      };
    }
    const textoArquivo = fsImpl.readFileSync(file, "utf8");
    const bytes = Buffer.byteLength(textoArquivo || "", "utf8");
    if (!textoArquivo.trim()) {
      return { ok: false, motivo: "arquivo_vazio", valor: fallback, bytes };
    }
    const valor = JSON.parse(textoArquivo);
    const stat = statArquivoSeguro(file, fsImpl);
    return { ok: true, motivo: "ok", valor, bytes, mtimeMs: stat.mtimeMs || 0 };
  } catch (erro) {
    const stat = statArquivoSeguro(file, fsImpl);
    return {
      ok: false,
      motivo: "json_corrompido",
      erro: erro?.message || "erro_json",
      valor: fallback,
      bytes: stat.bytes || tamanhoArquivo(file, fsImpl),
      mtimeMs: stat.mtimeMs || 0
    };
  }
}

function lerFilaLegada(clienteId = "admin", deps = {}) {
  const leitor = deps.readClienteJson || readClienteJson;
  try {
    const valor = typeof leitor === "function"
      ? leitor(clienteSeguro(clienteId), FILA_LEGADA_ARQUIVO, [])
      : [];
    return Array.isArray(valor) ? valor : [];
  } catch {
    return [];
  }
}

function cloneSet(set = new Set()) {
  return new Set(Array.from(set || []));
}

function resumosEntradasHistorico(clienteId = "admin", entradas = [], agora = Date.now()) {
  const resumo = {
    total: 0,
    ids: new Set(),
    chaves: new Set(),
    status: {},
    vivosEssenciais: 0,
    enviadosRecentes: 0,
    terminais: 0
  };

  for (const entrada of lista(entradas)) {
    const normalizada = normalizarEntradaViva(entrada, entrada?.posicaoLegada || 0, agora);
    const item = normalizada.item || {};
    const classificacao = classificarItemFilaV2(item, { agora });
    const chave = chaveHistorico(clienteId, item, normalizada.posicaoLegada);
    const id = normalizada.id;
    resumo.total += 1;
    resumo.ids.add(id);
    resumo.chaves.add(chave);
    resumo.status[normalizada.status || "desconhecido"] = (resumo.status[normalizada.status || "desconhecido"] || 0) + 1;
    if (classificacao.bucket === "viva") resumo.vivosEssenciais += 1;
    if (classificacao.motivo === "enviado_recente_executor_2h") resumo.enviadosRecentes += 1;
    if (classificacao.bucket === "historico") resumo.terminais += 1;
  }

  return resumo;
}

function chaveHistoricoLegada(clienteId = "admin", item = {}, posicaoLegada = -1) {
  const base = [
    clienteSeguro(clienteId),
    idItem(item, posicaoLegada),
    statusItem(item),
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || ""),
    String(posicaoLegada)
  ].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function chaveHistoricoAtual(clienteId = "admin", item = {}, posicaoLegada = -1) {
  const base = [
    clienteSeguro(clienteId),
    idItem(item, posicaoLegada),
    statusItem(item),
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || "")
  ].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function normalizarChave(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function numeroComparavel(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2) : texto(valor);
}

function identidadesItemFilaV2(item = {}) {
  const identidades = [];
  const camposId = [
    item.id,
    item.ofertaId,
    item.oferta_id,
    item.engineOfertaId,
    item.engine_oferta_id,
    item.idOferta
  ];

  for (const valor of camposId) {
    const id = texto(valor);
    if (id) identidades.push(`id:${id}`);
  }

  const produtoId = normalizarChave(item.produtoId || item.produto_id || item.sku || "");
  if (produtoId) identidades.push(`produto:${produtoId}`);

  const linkOriginal = normalizarChave(item.linkOriginal || item.link_original || "");
  const linkAfiliado = normalizarChave(item.linkAfiliado || item.link || item.linkFinal || "");
  if (linkOriginal) identidades.push(`link:${linkOriginal}`);
  if (linkAfiliado) identidades.push(`link:${linkAfiliado}`);

  const titulo = normalizarChave(item.titulo || item.nome || "");
  const preco = numeroComparavel(item.preco || item.precoAtual);
  if (titulo && preco) identidades.push(`titulo_preco:${titulo}|${preco}`);

  return [...new Set(identidades)];
}

function identidadePrincipalItemFilaV2(item = {}, indice = -1) {
  return identidadesItemFilaV2(item)[0] || `indice:${indice}`;
}

function rankStatusFilaV2(status = "") {
  const valor = statusItem({ status });
  if (["enviado", "enviada", "finalizado", "concluido", "concluida"].includes(valor)) return 60;
  if (["expirada_operacional", "expirado", "expirada", "cancelada", "descartada"].includes(valor)) return 55;
  if (["enviando", "processando"].includes(valor)) return 45;
  if (["erro", "falha", "retida"].includes(valor)) return 35;
  if (["pendente", "novo", "nova"].includes(valor)) return 20;
  return 10;
}

function escolherItemMaisAvancadoFilaV2(atual = {}, candidato = {}) {
  const rankAtual = rankStatusFilaV2(statusItem(atual));
  const rankCandidato = rankStatusFilaV2(statusItem(candidato));
  if (rankCandidato > rankAtual) return { item: candidato, trocou: true, motivo: "status_mais_avancado" };
  return { item: atual, trocou: false, motivo: "preservar_legado_ou_empate" };
}

function mesclarFilaLegadaComViva(clienteId = "admin", filaLegadaCliente = [], entradasViva = [], opcoes = {}) {
  const cliente = clienteSeguro(clienteId);
  const agora = opcoes.agora || Date.now();
  const filaFinal = [];
  const indicePorIdentidade = new Map();
  let itensInseridos = 0;
  let itensAtualizados = 0;
  let duplicatasEvitadas = 0;
  let statusPreservados = 0;

  for (const item of lista(filaLegadaCliente)) {
    if (clienteSeguro(item?.clienteId || "admin") !== cliente) continue;
    const indice = filaFinal.length;
    filaFinal.push(item);
    for (const identidade of identidadesItemFilaV2(item)) {
      if (!indicePorIdentidade.has(identidade)) indicePorIdentidade.set(identidade, indice);
    }
  }

  for (const entrada of normalizarEntradasViva(entradasViva, agora)) {
    if (entrada.bucket !== "viva") continue;
    const itemViva = entrada.item || {};
    if (clienteSeguro(itemViva?.clienteId || cliente) !== cliente) continue;
    const identidades = identidadesItemFilaV2(itemViva);
    let indiceExistente = -1;
    for (const identidade of identidades) {
      if (indicePorIdentidade.has(identidade)) {
        indiceExistente = indicePorIdentidade.get(identidade);
        break;
      }
    }

    if (indiceExistente >= 0) {
      duplicatasEvitadas += 1;
      const itemLegado = filaFinal[indiceExistente] || {};
      const itemVivaComIndice = {
        ...itemViva,
        posicaoLegada: Number.isInteger(Number(itemLegado.posicaoLegada))
          ? Number(itemLegado.posicaoLegada)
          : indiceExistente
      };
      const escolhido = escolherItemMaisAvancadoFilaV2(itemLegado, itemVivaComIndice);
      if (escolhido.trocou) {
        filaFinal[indiceExistente] = escolhido.item;
        itensAtualizados += 1;
      } else {
        statusPreservados += 1;
      }
      for (const identidade of identidades) {
        if (!indicePorIdentidade.has(identidade)) indicePorIdentidade.set(identidade, indiceExistente);
      }
      continue;
    }

    const indiceNovo = filaFinal.length;
    filaFinal.push({
      ...itemViva,
      posicaoLegada: Number.isInteger(Number(entrada.posicaoLegada)) ? Number(entrada.posicaoLegada) : indiceNovo
    });
    itensInseridos += 1;
    for (const identidade of identidades) indicePorIdentidade.set(identidade, indiceNovo);
    if (!identidades.length) indicePorIdentidade.set(identidadePrincipalItemFilaV2(itemViva, indiceNovo), indiceNovo);
  }

  return {
    ok: true,
    clienteId: cliente,
    filaCliente: filaFinal,
    totalLegado: lista(filaLegadaCliente).length,
    totalViva: normalizarEntradasViva(entradasViva, agora).filter(entrada => entrada.bucket === "viva").length,
    totalFinal: filaFinal.length,
    itensInseridos,
    itensAtualizados,
    duplicatasEvitadas,
    statusPreservados
  };
}

function lerFilaVivaParaMerge(clienteId = "admin", deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const caminhoViva = caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(caminhoViva, [], fsImpl);
  if (!leitura.ok && !["arquivo_ausente", "arquivo_vazio"].includes(leitura.motivo)) {
    return {
      ok: false,
      motivo: leitura.motivo,
      erro: leitura.erro,
      entradas: [],
      bytes: leitura.bytes || 0,
      mtimeMs: leitura.mtimeMs || 0
    };
  }

  return {
    ok: true,
    motivo: leitura.motivo,
    entradas: normalizarEntradasViva(leitura.valor, deps.agora || Date.now()),
    bytes: leitura.bytes || 0,
    mtimeMs: leitura.mtimeMs || 0
  };
}

function filaVivaMaisNovaQueLegado(clienteId = "admin", deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const viva = statArquivoSeguro(caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps), fsImpl);
  const legado = statArquivoSeguro(caminhoJsonCliente(cliente, FILA_LEGADA_ARQUIVO, deps), fsImpl);
  return {
    ok: true,
    clienteId: cliente,
    vivaExiste: viva.existe,
    legadoExiste: legado.existe,
    vivaMtimeMs: viva.mtimeMs,
    legadoMtimeMs: legado.mtimeMs,
    bytesFilaViva: viva.bytes,
    bytesLegado: legado.bytes,
    maisNova: viva.existe && (!legado.existe || viva.mtimeMs > legado.mtimeMs)
  };
}

function escreverFilaViva(clienteId = "admin", entradas = [], deps = {}) {
  const escritor = deps.writeClienteJson || writeClienteJson;
  if (typeof escritor !== "function") {
    return { ok: false, motivo: "writeClienteJson_indisponivel" };
  }
  const normalizada = normalizarEntradasViva(entradas, deps.agora || Date.now())
    .filter(entrada => entrada.bucket === "viva");
  try {
    const ok = escritor(clienteSeguro(clienteId), FILA_VIVA_ARQUIVO, normalizada);
    return {
      ok: ok !== false,
      motivo: ok === false ? "write_retorno_false" : "fila_viva_escrita",
      totalViva: normalizada.length,
      bytesFilaViva: tamanhoJsonBytes(normalizada)
    };
  } catch (erro) {
    return {
      ok: false,
      motivo: "erro_escrita_fila_viva",
      erro: erro?.message || "erro_escrita"
    };
  }
}

function inserirItemFilaVivaIncremental(clienteId = "admin", item = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const agora = deps.agora || Date.now();
  const fsImpl = deps.fs || fs;
  const caminhoViva = caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(caminhoViva, [], fsImpl);

  if (!leitura.ok && !["arquivo_ausente", "arquivo_vazio"].includes(leitura.motivo)) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    log2C(deps.logger, {
      versao: 1,
      evento: "insert_viva_incremental",
      clienteId: cliente,
      ok: false,
      fallbackLegado: true,
      motivo: leitura.motivo,
      bytesLidosViva: leitura.bytes || 0,
      insertVivaMs: duracaoMs
    });
    return {
      ok: false,
      motivo: leitura.motivo,
      erro: leitura.erro,
      fallbackLegado: true,
      bytesLidosViva: leitura.bytes || 0,
      insertVivaMs: duracaoMs
    };
  }

  const entradasExistentes = normalizarEntradasViva(leitura.valor, agora)
    .filter(entrada => entrada.bucket === "viva");
  const posicaoLegada = Number.isInteger(Number(deps.posicaoLegada))
    ? Number(deps.posicaoLegada)
    : entradasExistentes.length;
  const entradaNova = normalizarEntradaViva(item, posicaoLegada, agora);

  if (entradaNova.bucket !== "viva") {
    const historico = appendHistoricoIncremental(cliente, entradaNova, { ...deps, agora });
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    log2C(deps.logger, {
      versao: 1,
      evento: "insert_terminal_historico_incremental",
      clienteId: cliente,
      ok: historico.ok === true,
      motivo: historico.motivo,
      bytesHistorico: historico.bytes || 0,
      insertVivaMs: duracaoMs
    });
    return {
      ok: historico.ok === true,
      motivo: historico.motivo,
      entrada: entradaNova,
      item: entradaNova.item,
      terminalHistorico: true,
      bytesHistorico: historico.bytes || 0,
      insertVivaMs: duracaoMs
    };
  }

  const idNovo = entradaNova.id;
  const jaExiste = entradasExistentes.some(entrada => entrada.id === idNovo);
  const entradasAtualizadas = jaExiste
    ? entradasExistentes.map(entrada => entrada.id === idNovo ? entradaNova : entrada)
    : entradasExistentes.concat(entradaNova);
  const escrita = escreverFilaViva(cliente, entradasAtualizadas, { ...deps, agora });
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);

  if (escrita.ok !== true || deps.logSucesso === true) {
    log2C(deps.logger, {
      versao: 1,
      evento: "insert_viva_incremental",
      clienteId: cliente,
      ok: escrita.ok === true,
      fallbackLegado: escrita.ok !== true,
      idempotente: jaExiste,
      totalViva: escrita.totalViva || entradasAtualizadas.length,
      bytesLidosViva: leitura.bytes || 0,
      bytesFilaViva: escrita.bytesFilaViva || 0,
      insertVivaMs: duracaoMs
    });
  }

  return {
    ok: escrita.ok === true,
    motivo: escrita.motivo,
    entrada: entradaNova,
    item: entradaNova.item,
    idempotente: jaExiste,
    totalViva: escrita.totalViva || entradasAtualizadas.length,
    bytesLidosViva: leitura.bytes || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    insertVivaMs: duracaoMs,
    fallbackLegado: escrita.ok !== true
  };
}

function recuperarFilaVivaDoLegado(clienteId = "admin", deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const filaLegada = Array.isArray(deps.filaLegada)
    ? deps.filaLegada.filter(item => clienteSeguro(item?.clienteId || "admin") === cliente)
    : lerFilaLegada(cliente, deps);
  const projecao = projetarFilaV2(filaLegada, { agora: deps.agora || Date.now() });
  const escrita = escreverFilaViva(cliente, projecao.viva, deps);
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);

  logOperacional(deps.logger, {
    versao: 1,
    evento: "recovery_viva",
    clienteId: cliente,
    ok: escrita.ok === true,
    fonte: "fila_json_legado",
    motivo: escrita.motivo,
    totalLegado: projecao.totalLegado,
    totalViva: projecao.totalViva,
    totalHistorico: projecao.totalHistorico,
    divergencias: projecao.comparacao?.divergencias || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    duracaoMs
  });

  return {
    ok: escrita.ok === true,
    fonte: "fila_json_legado",
    motivo: escrita.motivo,
    recovery: true,
    entradas: projecao.viva,
    itens: projecao.viva.map(entrada => entrada.item),
    projecao,
    escrita
  };
}

function mapaPorId(entradas = []) {
  const mapa = new Map();
  for (const entrada of lista(entradas)) {
    const normalizada = normalizarEntradaViva(entrada, entrada?.posicaoLegada || 0, Date.now());
    const chave = normalizada.id;
    if (!mapa.has(chave)) {
      mapa.set(chave, normalizada);
    }
  }
  return mapa;
}

function compararVivaComLegadoInterno(clienteId = "admin", entradasViva = [], filaLegada = [], deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const legadoCliente = lista(filaLegada).filter(item => clienteSeguro(item?.clienteId || "admin") === cliente);
  const projecao = projetarFilaV2(legadoCliente, { agora: deps.agora || Date.now() });
  const vivaNormalizada = normalizarEntradasViva(entradasViva, deps.agora || Date.now());
  const idsEsperados = projecao.viva.map(entrada => entrada.id);
  const idsViva = vivaNormalizada.map(entrada => entrada.id);
  const mapaEsperado = mapaPorId(projecao.viva);
  const mapaAtual = mapaPorId(vivaNormalizada);
  const idsAusentes = [];
  const idsExtras = [];
  const statusDivergentes = [];
  const idsDuplicados = [];
  const idsRecentesAusentes = [];

  const contagemViva = new Map();
  for (const id of idsViva) {
    contagemViva.set(id, (contagemViva.get(id) || 0) + 1);
  }
  for (const [id, quantidade] of contagemViva.entries()) {
    if (quantidade > 1) idsDuplicados.push(id);
  }

  for (const id of idsEsperados) {
    const esperado = mapaEsperado.get(id);
    const atual = mapaAtual.get(id);
    if (!atual) {
      idsAusentes.push(id);
      if (esperado && esperado.bucket === "viva" && esperado.motivoBucket === "enviado_recente_executor_2h") {
        idsRecentesAusentes.push(id);
      }
      continue;
    }
    if (statusItem(esperado.item) !== statusItem(atual.item) || esperado.bucket !== atual.bucket) {
      statusDivergentes.push(id);
    }
    if ((esperado.motivoBucket || "") !== (atual.motivoBucket || "")) {
      statusDivergentes.push(id);
    }
  }

  for (const id of idsViva) {
    if (!mapaEsperado.has(id)) idsExtras.push(id);
  }

  const divergencias =
    idsAusentes.length +
    idsExtras.length +
    statusDivergentes.length +
    idsDuplicados.length +
    idsRecentesAusentes.length;

  return {
    ok: divergencias === 0,
    totalLegado: legadoCliente.length,
    totalVivaEsperado: idsEsperados.length,
    totalVivaAtual: idsViva.length,
    idsAusentes: idsAusentes.slice(0, 20),
    idsExtras: idsExtras.slice(0, 20),
    statusDivergentes: Array.from(new Set(statusDivergentes)).slice(0, 20),
    idsDuplicados: idsDuplicados.slice(0, 20),
    idsRecentesAusentes: idsRecentesAusentes.slice(0, 20),
    divergencias
  };
}

function lerFilaViva(clienteId = "admin", deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const file = caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(file, null, fsImpl);

  if (leitura.ok && Array.isArray(leitura.valor)) {
    const entradas = normalizarEntradasViva(leitura.valor, deps.agora || Date.now())
      .filter(entrada => entrada.bucket === "viva");
    const legado = deps.filaLegada || lerFilaLegada(cliente, deps);
    const comparacao = compararVivaComLegado(cliente, entradas, legado, deps);
    if (!comparacao.ok) {
      const recovery = recuperarFilaVivaDoLegado(cliente, {
        ...deps,
        motivoRecovery: "viva_divergente_legado",
        logger: deps.logger
      });
      const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
      logOperacional(deps.logger, {
        versao: 1,
        evento: "divergencia_viva_legado",
        clienteId: cliente,
        ok: false,
        totalLegado: comparacao.totalLegado,
        totalViva: comparacao.totalVivaAtual,
        divergencias: comparacao.divergencias,
        idsRecentesAusentes: comparacao.idsRecentesAusentes.length,
        idsDuplicados: comparacao.idsDuplicados.length,
        idsExtras: comparacao.idsExtras.length,
        idsAusentes: comparacao.idsAusentes.length,
        duracaoMs
      });
      return {
        ...recovery,
        fallbackLegado: true,
        motivoFallback: "viva_divergente_legado",
        comparacao
      };
    }
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "read_fila_viva",
      clienteId: cliente,
      ok: true,
      fonte: "fila_viva",
      totalViva: entradas.length,
      bytesFilaViva: leitura.bytes || 0,
      fallbackLegado: false,
      divergencias: 0,
      duracaoMs
    });
    return {
      ok: true,
      fonte: "fila_viva",
      recovery: false,
      entradas,
      itens: entradas.map(entrada => entrada.item),
      bytes: leitura.bytes || 0,
      comparacao
    };
  }

  const recovery = recuperarFilaVivaDoLegado(cliente, {
    ...deps,
    motivoRecovery: leitura.motivo,
    logger: deps.logger
  });
  return {
    ...recovery,
    fallbackLegado: true,
    motivoFallback: leitura.motivo,
    erroFallback: leitura.erro || ""
  };
}

function dataSegmentoHistorico(item = {}, agora = Date.now()) {
  const candidatos = [
    item.enviadoEm,
    item.dataEnvio,
    item.finalizadoEm,
    item.retidaEm,
    item.erroEm,
    item.expiradaEm,
    item.atualizadoEm,
    item.updatedAt
  ];
  for (const valor of candidatos) {
    const ms = Date.parse(valor);
    if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  }
  return agoraIso(agora).slice(0, 10);
}

function chaveHistorico(clienteId = "admin", item = {}, posicaoLegada = -1) {
  const base = [
    clienteSeguro(clienteId),
    idItem(item, posicaoLegada),
    statusItem(item),
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || "")
  ].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function caminhoSegmentoHistorico(clienteId = "admin", item = {}, deps = {}) {
  const dirCliente = caminhoDirCliente(clienteId, deps);
  if (!dirCliente) return "";
  const dir = path.join(dirCliente, HISTORICO_INCREMENTAL_DIR);
  const data = dataSegmentoHistorico(item, deps.agora || Date.now());
  return path.join(dir, `${data}.jsonl`);
}

function chaveCacheHistorico(file = "") {
  return texto(file);
}

function limparCacheHistorico() {
  cacheChavesHistorico.clear();
  return true;
}

function invalidaCacheHistorico(file = "") {
  const chave = chaveCacheHistorico(file);
  if (chave) cacheChavesHistorico.delete(chave);
}

function lerCacheHistorico(file = "", fsImpl = fs, logger = console, clienteId = "admin") {
  const chaveArquivo = chaveCacheHistorico(file);
  if (!chaveArquivo) {
    return {
      chaves: new Set(),
      bytes: 0,
      linhas: 0,
      cacheHit: false,
      motivo: "caminho_indisponivel"
    };
  }

  let stat = null;
  try {
    stat = fsImpl.existsSync(file) ? fsImpl.statSync(file) : null;
  } catch {
    stat = null;
  }

  const cached = cacheChavesHistorico.get(chaveArquivo);
  if (cached && stat && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    logOperacional(logger, {
      versao: 1,
      evento: "cache_hit_dedupe",
      clienteId: clienteSeguro(clienteId),
      fileHash: hashCurto(file),
      linhas: cached.linhas || 0,
      bytes: cached.bytes || 0
    });
    return {
      chaves: cloneSet(cached.chaves),
      bytes: cached.bytes || 0,
      linhas: cached.linhas || 0,
      cacheHit: true,
      motivo: "cache_hit"
    };
  }

  const chaves = new Set();
  let bytes = 0;
  let linhas = 0;
  try {
    if (file && fsImpl.existsSync(file)) {
      const conteudo = fsImpl.readFileSync(file, "utf8");
      bytes = Buffer.byteLength(conteudo || "", "utf8");
      const partes = (conteudo || "").split(/\r?\n/);
      for (const linha of partes) {
        if (!linha.trim()) continue;
        try {
          const registro = JSON.parse(linha);
          const clienteRegistro = texto(registro?.clienteId || clienteId);
          const itemRegistro = registro?.item && typeof registro.item === "object" ? registro.item : {};
          const posicaoRegistro = Number.isInteger(Number(registro?.posicaoLegada))
            ? Number(registro.posicaoLegada)
            : -1;
          const chaveAtual = texto(registro?.chave) || chaveHistoricoAtual(clienteRegistro, itemRegistro, posicaoRegistro);
          const chaveLegada = texto(registro?.chaveLegada) || chaveHistoricoLegada(clienteRegistro, itemRegistro, posicaoRegistro);
          if (chaveAtual) chaves.add(chaveAtual);
          if (chaveLegada) chaves.add(chaveLegada);
          linhas += 1;
        } catch {}
      }
    }
  } catch {}

  const snapshot = {
    chaves,
    bytes,
    linhas,
    mtimeMs: stat ? Number(stat.mtimeMs || 0) : 0,
    size: stat ? Number(stat.size || 0) : 0
  };
  cacheChavesHistorico.set(chaveArquivo, snapshot);
  logOperacional(logger, {
    versao: 1,
    evento: "cache_miss_dedupe",
    clienteId: clienteSeguro(clienteId),
    fileHash: hashCurto(file),
    linhas: snapshot.linhas,
    bytes: snapshot.bytes
  });
  return {
    chaves: cloneSet(snapshot.chaves),
    bytes: snapshot.bytes,
    linhas: snapshot.linhas,
    cacheHit: false,
    motivo: "cache_miss"
  };
}

function appendHistoricoIncremental(clienteId = "admin", entradaOuItem = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const entrada = normalizarEntradaViva(entradaOuItem, entradaOuItem?.posicaoLegada || 0, deps.agora || Date.now());
  const item = entrada.item || {};
  const file = caminhoSegmentoHistorico(cliente, item, deps);
  const chave = chaveHistorico(cliente, item, entrada.posicaoLegada);
  const chaveLegada = chaveHistoricoLegada(cliente, item, entrada.posicaoLegada);
  let leituraCache = {
    chaves: new Set(),
    bytes: 0,
    linhas: 0,
    cacheHit: false,
    motivo: "nao_carregado"
  };

  if (!file) {
    return { ok: false, motivo: "caminho_historico_indisponivel", chave };
  }

  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    leituraCache = lerCacheHistorico(file, fsImpl, deps.logger, cliente);
    const existentes = leituraCache.chaves;
    if (existentes.has(chave) || existentes.has(chaveLegada)) {
      const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
      logOperacional(deps.logger, {
        versao: 1,
        evento: "historico_append",
        clienteId: cliente,
        ok: true,
        idempotente: true,
        cacheHit: leituraCache.cacheHit === true,
        status: entrada.status || statusItem(item),
        bytesAppend: 0,
        duracaoMs
      });
      logOperacional(deps.logger, {
        versao: 1,
        evento: "append_idempotente_ignorado",
        clienteId: cliente,
        cacheHit: leituraCache.cacheHit === true,
        status: entrada.status || statusItem(item),
        fileHash: hashCurto(file),
        duracaoMs
      });
      return { ok: true, idempotente: true, motivo: "historico_ja_registrado", chave, chaveLegada, file };
    }

    const registro = {
      versao: 1,
      chave,
      chaveLegada,
      clienteId: cliente,
      id: entrada.id || idItem(item, entrada.posicaoLegada),
      status: entrada.status || statusItem(item),
      posicaoLegada: entrada.posicaoLegada,
      motivoBucket: entrada.motivoBucket || "",
      registradoEm: agoraIso(deps.agora || Date.now()),
      item
    };
    const linha = `${JSON.stringify(registro)}\n`;
    fsImpl.appendFileSync(file, linha, "utf8");
    try {
      const stat = fsImpl.existsSync(file) ? fsImpl.statSync(file) : null;
      cacheChavesHistorico.set(chaveCacheHistorico(file), {
        chaves: new Set([...existentes, chave, chaveLegada]),
        bytes: (stat ? stat.size : (leituraCache.bytes || 0)) + Buffer.byteLength(linha, "utf8"),
        linhas: (leituraCache.linhas || 0) + 1,
        mtimeMs: stat ? Number(stat.mtimeMs || 0) : 0,
        size: stat ? Number(stat.size || 0) : 0
      });
    } catch {}
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "historico_append",
      clienteId: cliente,
      ok: true,
      idempotente: false,
      cacheHit: leituraCache.cacheHit === true,
      status: registro.status,
      bytesAppend: Buffer.byteLength(linha, "utf8"),
      duracaoMs
    });
    return {
      ok: true,
      idempotente: false,
      motivo: "historico_append_ok",
      chave,
      chaveLegada,
      file,
      bytesAppend: Buffer.byteLength(linha, "utf8")
    };
  } catch (erro) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "historico_append",
      clienteId: cliente,
      ok: false,
      cacheHit: leituraCache.cacheHit === true,
      status: entrada.status || statusItem(item),
      erro: erro?.message || "erro_append_historico",
      duracaoMs
    });
    return {
      ok: false,
      motivo: "erro_append_historico",
      erro: erro?.message || "erro_append",
      chave,
      chaveLegada,
      file
    };
  }
}

function itemTerminalParaHistorico(item = {}, agora = Date.now()) {
  const classificacao = classificarItemFilaV2(item, { agora });
  return classificacao.bucket === "historico";
}

function moverTerminalParaHistorico(clienteId = "admin", filaViva = [], alvo = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const entradas = normalizarEntradasViva(filaViva, deps.agora || Date.now());
  const alvoId = idItem(alvo?.item || alvo, alvo?.posicaoLegada || -1);
  const entrada = entradas.find(item => item.id === alvoId) ||
    normalizarEntradaViva(alvo?.item ? alvo : { item: alvo, posicaoLegada: alvo?.posicaoLegada }, alvo?.posicaoLegada || -1, deps.agora || Date.now());

  if (!itemTerminalParaHistorico(entrada.item, deps.agora || Date.now())) {
    return { ok: false, motivo: "item_nao_terminal", removeuDaViva: false };
  }

  const historico = appendHistoricoIncremental(cliente, entrada, deps);
  if (!historico.ok) {
    logOperacional(deps.logger, {
      versao: 1,
      evento: "transicao_terminal",
      clienteId: cliente,
      ok: false,
      motivo: "historico_falhou_item_permanece_vivo",
      removeuDaViva: false
    });
    return {
      ok: false,
      motivo: "historico_falhou_item_permanece_vivo",
      removeuDaViva: false,
      historico
    };
  }

  const restante = entradas.filter(item => item.id !== entrada.id);
  const escrita = escreverFilaViva(cliente, restante, deps);
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
  if (!escrita.ok) {
    logOperacional(deps.logger, {
      versao: 1,
      evento: "conflito_viva_historico",
      clienteId: cliente,
      ok: false,
      historicoOk: true,
      vivaOk: false,
      cacheHit: true,
      removeuDaViva: false,
      totalVivaAntes: entradas.length,
      totalVivaDepois: entradas.length,
      fileHash: hashCurto(caminhoSegmentoHistorico(cliente, entrada.item || {}, deps))
    });
  }
  logOperacional(deps.logger, {
    versao: 1,
    evento: "transicao_terminal",
      clienteId: cliente,
      ok: escrita.ok === true,
      removeuDaViva: escrita.ok === true,
      totalVivaAntes: entradas.length,
      totalVivaDepois: escrita.ok === true ? restante.length : entradas.length,
      historicoOk: true,
      duracaoMs
    });

  return {
    ok: escrita.ok === true,
    motivo: escrita.ok ? "terminal_movido_para_historico" : "historico_ok_viva_nao_atualizada",
    removeuDaViva: escrita.ok === true,
    historico,
    escrita,
    filaViva: escrita.ok ? restante : entradas
  };
}

function compararVivaComLegado(clienteId = "admin", entradasViva = [], filaLegada = [], deps = {}) {
  return compararVivaComLegadoInterno(clienteId, entradasViva, filaLegada, deps);
}

function flagAtiva(nome, env = process.env) {
  return String(env?.[nome] || "").trim().toLowerCase() === "true";
}

function modoOperacional(env = process.env) {
  return resolverModoOperacional(env);
}

function sincronizarCanaryEscrita(params = {}, deps = {}, opcoes = {}) {
  const cliente = clienteSeguro(params.clienteId || "admin");
  const env = opcoes.env || deps.env || process.env;
  const modo = resolverModoOperacional(env);

  if (!deveUsarFilaV2Operacional(cliente, env)) {
    return {
      ok: true,
      pulou: true,
      motivo: "rollout_desativado",
      ...modo
    };
  }

  const inicio = process.hrtime.bigint();
  const filaLegada = Array.isArray(params.fila)
    ? params.fila.filter(item => clienteSeguro(item?.clienteId || "admin") === cliente)
    : lerFilaLegada(cliente, { ...opcoes, ...deps });
  const agora = params.agora || deps.agora || Date.now();
  const projecao = projetarFilaV2(filaLegada, { agora });
  const escrita = escreverFilaViva(cliente, projecao.viva, { ...opcoes, ...deps, agora });
  const comparacao = compararVivaComLegado(cliente, projecao.viva, filaLegada, { ...opcoes, ...deps, agora });
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
  const logger = params.logger || deps.logger || opcoes.logger || console;

  logOperacional(logger, {
    versao: 1,
    evento: "canary_write_operacional",
    clienteId: cliente,
    rollout: modo.rolloutOperacional,
    canaryClientes: modo.canaryClientes.length,
    ok: escrita.ok === true && comparacao.ok === true,
    totalLegado: projecao.totalLegado,
    totalViva: projecao.totalViva,
    totalHistorico: projecao.totalHistorico,
    divergencias: comparacao.divergencias || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    fallbackLegado: escrita.ok !== true || comparacao.ok !== true,
    duracaoMs
  });

  console.log(TAG_CANARY_WRITER, JSON.stringify({
    versao: 1,
    clienteId: cliente,
    rollout: modo.rolloutOperacional,
    canaryAtivo: true,
    ok: escrita.ok === true && comparacao.ok === true,
    totalLegado: projecao.totalLegado,
    totalViva: projecao.totalViva,
    totalHistorico: projecao.totalHistorico,
    divergencias: comparacao.divergencias || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    fallbackLegado: escrita.ok !== true || comparacao.ok !== true,
    duracaoMs
  }));

  return {
    ok: escrita.ok === true && comparacao.ok === true,
    pulou: false,
    ...modo,
    projecao,
    escrita,
    comparacao
  };
}

function criarControladorCheckpointLegadoV2(opcoes = {}) {
  const politica = opcoes.politica || politicaCheckpointLegado(opcoes.env || process.env);
  const estados = new Map();

  function obterEstado(clienteId = "admin") {
    const cliente = clienteSeguro(clienteId);
    if (!estados.has(cliente)) {
      estados.set(cliente, {
        clienteId: cliente,
        dirty: false,
        mutacoes: 0,
        dirtyDesde: 0,
        ultimoCheckpoint: 0,
        checkpoints: 0,
        ultimoMotivo: "",
        generation: 0,
        checkpointEmAndamento: false,
        checkpointGeneration: 0,
        checkpointMutacoes: 0,
        checkpointConcurrentSkip: 0
      });
    }
    return estados.get(cliente);
  }

  function snapshot(clienteId = "admin", agora = Date.now()) {
    const estado = obterEstado(clienteId);
    return {
      clienteId: estado.clienteId,
      dirty: estado.dirty,
      mutacoes: estado.mutacoes,
      dirtyAgeMs: estado.dirty && estado.dirtyDesde ? Math.max(0, agora - estado.dirtyDesde) : 0,
      checkpoints: estado.checkpoints,
      ultimoMotivo: estado.ultimoMotivo,
      generation: estado.generation,
      checkpointEmAndamento: estado.checkpointEmAndamento,
      checkpointGeneration: estado.checkpointGeneration,
      checkpointConcurrentSkip: estado.checkpointConcurrentSkip
    };
  }

  function marcarDirty(clienteId = "admin", motivo = "mutacao_viva", agora = Date.now()) {
    const estado = obterEstado(clienteId);
    if (!estado.dirty) {
      estado.dirty = true;
      estado.dirtyDesde = agora;
    }
    estado.mutacoes += 1;
    estado.ultimoMotivo = texto(motivo || "mutacao_viva");
    estado.generation += 1;
    return snapshot(clienteId, agora);
  }

  function deveCheckpoint(clienteId = "admin", opcoesCheckpoint = {}) {
    const agora = opcoesCheckpoint.agora || Date.now();
    const estado = obterEstado(clienteId);
    if (!estado.dirty) return { deve: false, motivo: "limpo", estado: snapshot(clienteId, agora), politica };
    if (opcoesCheckpoint.forcar) return { deve: true, motivo: opcoesCheckpoint.motivo || "forcado", estado: snapshot(clienteId, agora), politica };
    const dirtyAgeMs = estado.dirtyDesde ? Math.max(0, agora - estado.dirtyDesde) : 0;
    const desdeCheckpointMs = estado.ultimoCheckpoint ? Math.max(0, agora - estado.ultimoCheckpoint) : dirtyAgeMs;
    if (estado.mutacoes >= politica.mutacoes) {
      return { deve: true, motivo: "mutacoes", estado: snapshot(clienteId, agora), politica };
    }
    if (desdeCheckpointMs >= politica.intervaloMs) {
      return { deve: true, motivo: "intervalo", estado: snapshot(clienteId, agora), politica };
    }
    if (dirtyAgeMs >= politica.maxDirtyMs) {
      return { deve: true, motivo: "max_dirty", estado: snapshot(clienteId, agora), politica };
    }
    return { deve: false, motivo: "aguardando_batch", estado: snapshot(clienteId, agora), politica };
  }

  function iniciarCheckpoint(clienteId = "admin", opcoesCheckpoint = {}) {
    const agora = opcoesCheckpoint.agora || Date.now();
    const estado = obterEstado(clienteId);
    if (estado.checkpointEmAndamento) {
      estado.checkpointConcurrentSkip += 1;
      return {
        deve: false,
        motivo: "checkpoint_em_andamento",
        checkpointConcurrentSkip: true,
        estado: snapshot(clienteId, agora),
        politica
      };
    }

    const decisao = deveCheckpoint(clienteId, opcoesCheckpoint);
    if (!decisao.deve) return decisao;

    estado.checkpointEmAndamento = true;
    estado.checkpointGeneration = estado.generation;
    estado.checkpointMutacoes = estado.mutacoes;
    return {
      ...decisao,
      generationInicial: estado.checkpointGeneration,
      mutacoesCapturadas: estado.checkpointMutacoes,
      estado: snapshot(clienteId, agora)
    };
  }

  function concluirCheckpoint(clienteId = "admin", opcoesConclusao = {}) {
    const agora = opcoesConclusao.agora || Date.now();
    const estado = obterEstado(clienteId);
    const generationInicial = Number(opcoesConclusao.generationInicial || estado.checkpointGeneration || 0);
    const mutacoesCapturadas = Number(opcoesConclusao.mutacoesCapturadas || estado.checkpointMutacoes || 0);

    estado.checkpointEmAndamento = false;
    estado.checkpointGeneration = 0;
    estado.checkpointMutacoes = 0;

    if (opcoesConclusao.ok !== true) {
      estado.dirty = true;
      if (!estado.dirtyDesde) estado.dirtyDesde = agora;
      estado.ultimoMotivo = texto(opcoesConclusao.motivo || "checkpoint_falhou");
      return snapshot(clienteId, agora);
    }

    if (estado.generation === generationInicial) {
      estado.dirty = false;
      estado.mutacoes = 0;
      estado.dirtyDesde = 0;
    } else {
      estado.dirty = true;
      estado.mutacoes = Math.max(1, estado.mutacoes - mutacoesCapturadas);
      if (!estado.dirtyDesde) estado.dirtyDesde = agora;
    }
    estado.ultimoCheckpoint = agora;
    estado.checkpoints += 1;
    estado.ultimoMotivo = texto(opcoesConclusao.motivo || "checkpoint_confirmado");
    return snapshot(clienteId, agora);
  }

  function confirmarCheckpoint(clienteId = "admin", opcoesConfirmacao = {}) {
    const agora = opcoesConfirmacao.agora || Date.now();
    const estado = obterEstado(clienteId);
    estado.dirty = false;
    estado.mutacoes = 0;
    estado.dirtyDesde = 0;
    estado.ultimoCheckpoint = agora;
    estado.checkpoints += 1;
    estado.ultimoMotivo = texto(opcoesConfirmacao.motivo || "checkpoint_confirmado");
    return snapshot(clienteId, agora);
  }

  function pendentes(agora = Date.now()) {
    return Array.from(estados.values())
      .filter(estado => estado.dirty)
      .map(estado => snapshot(estado.clienteId, agora));
  }

  return {
    politica,
    marcarDirty,
    deveCheckpoint,
    iniciarCheckpoint,
    concluirCheckpoint,
    confirmarCheckpoint,
    snapshot,
    pendentes
  };
}

function criarControladorFilaOperacionalV2(opcoes = {}) {
  function prepararSeHabilitado(params = {}) {
    const modo = modoOperacional(opcoes.env || process.env);
    if (!modo.shadow2B1Ativo && !modo.operacionalAtivo) {
      return { ok: true, pulou: true, motivo: "flag_desativada", ...modo };
    }

    const cliente = clienteSeguro(params.clienteId || "admin");
    const filaLegada = Array.isArray(params.fila)
      ? params.fila.filter(item => clienteSeguro(item?.clienteId || "admin") === cliente)
      : lerFilaLegada(cliente, { ...opcoes, ...params });
    const projecao = projetarFilaV2(filaLegada, { agora: params.agora || Date.now() });
    const escrita = escreverFilaViva(cliente, projecao.viva, { ...opcoes, ...params });
    const comparacao = compararVivaComLegado(cliente, projecao.viva, filaLegada, { ...opcoes, ...params });

    logOperacional(params.logger || opcoes.logger, {
      versao: 1,
      evento: "preparacao_2b1",
      clienteId: cliente,
      ok: escrita.ok === true && comparacao.ok === true,
      operacionalAtivo: modo.operacionalAtivo,
      shadow2B1Ativo: modo.shadow2B1Ativo,
      totalLegado: projecao.totalLegado,
      totalViva: projecao.totalViva,
      totalHistorico: projecao.totalHistorico,
      divergencias: comparacao.divergencias,
      idsAusentes: comparacao.idsAusentes.length,
      idsExtras: comparacao.idsExtras.length,
      idsDuplicados: comparacao.idsDuplicados.length,
      idsRecentesAusentes: comparacao.idsRecentesAusentes.length,
      fallbackLegado: false,
      bytesFilaViva: escrita.bytesFilaViva || 0
    });

    return {
      ok: escrita.ok === true && comparacao.ok === true,
      pulou: false,
      ...modo,
      projecao,
      escrita,
      comparacao
    };
  }

  return {
    prepararSeHabilitado,
    deveUsarFilaV2Operacional: clienteId => deveUsarFilaV2Operacional(clienteId, opcoes.env || process.env),
    sincronizarCanaryEscrita: (params = {}, deps = {}) => sincronizarCanaryEscrita(params, deps, opcoes),
    inserirItemFilaVivaIncremental: (clienteId, item, deps = {}) => inserirItemFilaVivaIncremental(clienteId, item, { ...opcoes, ...deps }),
    lerFilaVivaParaMerge: (clienteId, deps = {}) => lerFilaVivaParaMerge(clienteId, { ...opcoes, ...deps }),
    filaVivaMaisNovaQueLegado: (clienteId, deps = {}) => filaVivaMaisNovaQueLegado(clienteId, { ...opcoes, ...deps }),
    mesclarFilaLegadaComViva: (clienteId, filaLegadaCliente, entradasViva, deps = {}) => mesclarFilaLegadaComViva(clienteId, filaLegadaCliente, entradasViva, { ...opcoes, ...deps }),
    lerFilaViva: (clienteId, deps = {}) => lerFilaViva(clienteId, { ...opcoes, ...deps }),
    escreverFilaViva: (clienteId, entradas, deps = {}) => escreverFilaViva(clienteId, entradas, { ...opcoes, ...deps }),
    appendHistoricoIncremental: (clienteId, entrada, deps = {}) => appendHistoricoIncremental(clienteId, entrada, { ...opcoes, ...deps }),
    moverTerminalParaHistorico: (clienteId, filaViva, alvo, deps = {}) => moverTerminalParaHistorico(clienteId, filaViva, alvo, { ...opcoes, ...deps }),
    compararVivaComLegado: (clienteId, entradasViva, filaLegada, deps = {}) => compararVivaComLegado(clienteId, entradasViva, filaLegada, { ...opcoes, ...deps }),
    resetarCacheHistoricoParaTeste: limparCacheHistorico
  };
}

module.exports = {
  FLAG_OPERACIONAL_ATIVA,
  FLAG_ROLLOUT_ATIVO,
  FLAG_CANARY_CLIENTES,
  FLAG_2B1_SHADOW_ATIVA,
  FLAG_CHECKPOINT_MUTACOES,
  FLAG_CHECKPOINT_INTERVALO_MS,
  FLAG_CHECKPOINT_MAX_DIRTY_MS,
  HISTORICO_INCREMENTAL_DIR,
  TAG_TELEMETRIA,
  TAG_CANARY_WRITER,
  TAG_2C,
  DEFAULT_CHECKPOINT_MUTACOES,
  DEFAULT_CHECKPOINT_INTERVALO_MS,
  DEFAULT_CHECKPOINT_MAX_DIRTY_MS,
  normalizarEntradasViva,
  identidadesItemFilaV2,
  identidadePrincipalItemFilaV2,
  rankStatusFilaV2,
  escolherItemMaisAvancadoFilaV2,
  mesclarFilaLegadaComViva,
  lerFilaVivaParaMerge,
  filaVivaMaisNovaQueLegado,
  lerFilaViva,
  escreverFilaViva,
  inserirItemFilaVivaIncremental,
  recuperarFilaVivaDoLegado,
  appendHistoricoIncremental,
  moverTerminalParaHistorico,
  compararVivaComLegado,
  itemTerminalParaHistorico,
  politicaCheckpointLegado,
  criarControladorCheckpointLegadoV2,
  modoOperacional,
  deveUsarFilaV2Operacional,
  criarControladorFilaOperacionalV2,
  limparCacheHistorico
};
