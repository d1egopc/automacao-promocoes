const fs = require("fs");
const path = require("path");
const { criarContadorFinalizacoes } = require("./drainage-metrics.service");
const { readGlobalJson, readClienteJson, getClienteJsonPath } = require("../../../utils/storage");
const { listarClientesAtivos } = require("../../../utils/usuarios-atividade");
const destinosUtils = require("../../../utils/destinos");
const {
  destinoPossuiIntegracaoBasica,
  numeroIntervaloDestino
} = require("./commercial-capacity.service");
const {
  destinoAceitaTurboCupom,
  resolverCadenciaDestino
} = require("../cadencia.service");
const { consultarEventosAbsorcaoPorWorkspace } = require("./absorption-gate.repository");
const {
  calcularBufferVivoWorkspace,
  resumirDivergenciaBufferVivo
} = require("./buffer-vivo-workspace.service");

const BUCKET_STATUS = {
  PENDENTE_VIVO: "pendente_vivo",
  EM_TENTATIVA: "em_tentativa",
  ERRO_TEMPORARIO_RECUPERAVEL: "erro_temporario_recuperavel",
  ENVIADO_HISTORICO: "enviado_historico",
  ERRO_FINAL: "erro_final",
  CANCELADO: "cancelado",
  EXPIRADO: "expirado",
  STATUS_DESCONHECIDO: "status_desconhecido"
};

const STATUS_PENDENTES_VIVOS = new Set([
  "pendente",
  "novo",
  "aguardando",
  "aguardando_envio",
  "pronto",
  "pronta",
  "programado",
  "programada"
]);

const STATUS_EM_TENTATIVA = new Set([
  "enviando",
  "em_envio",
  "processando_envio",
  "tentando_envio",
  "tentativa_envio",
  "processando",
  "em_processamento"
]);

const STATUS_ERROS_TEMPORARIOS = new Set([
  "erro_temporario",
  "erro_retry",
  "retry",
  "aguardando_retry",
  "falha_temporaria",
  "reprocessar"
]);

const STATUS_ENVIADOS = new Set([
  "enviado",
  "enviada",
  "sucesso",
  "publicado",
  "publicada"
]);

const STATUS_ERROS_FINAIS = new Set([
  "erro",
  "erro_final",
  "falha_final",
  "executor_erro_final",
  "nao_enviado",
  "nao_enviada",
  "sem_destino",
  "sem_creditos"
]);

const STATUS_CANCELADOS = new Set([
  "cancelado",
  "cancelada",
  "retida",
  "retido",
  "retida_v2",
  "bloqueado",
  "bloqueada"
]);

const STATUS_EXPIRADOS = new Set([
  "expirado",
  "expirada",
  "expirada_operacional",
  "expirado_operacional"
]);

const STATUS_HISTORICO = new Set([
  "historico",
  "historico_operacional",
  "arquivado",
  "arquivada",
  "arquivo"
]);

const CAMPOS_TIMESTAMP_FILA = [
  "criadoEm",
  "criado_em",
  "adicionadoEm",
  "adicionado_em",
  "dataEntradaFila",
  "dataEntrada",
  "entradaFilaEm",
  "dataFila",
  "dataCriacao",
  "createdAt",
  "timestamp",
  "incluidoEm",
  "inseridoEm",
  "recebidoEm",
  "importadoEm"
];

const TTL_ESTEIRA_MS = {
  cupom_turbo: 10 * 60 * 1000,
  resgate: 30 * 60 * 1000,
  cupom: 30 * 60 * 1000,
  radar: 30 * 60 * 1000,
  comum: 30 * 60 * 1000,
  desconhecido: 30 * 60 * 1000
};

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function resultadoLeituraFila({ ok = false, itens = [], motivo = "", collectedAtMs = Date.now() } = {}) {
  return {
    ok: ok === true && Array.isArray(itens),
    itens: Array.isArray(itens) ? itens : [],
    motivo: ok === true && Array.isArray(itens) ? "" : String(motivo || "fila_fonte_invalida"),
    collectedAtMs: Number.isFinite(Number(collectedAtMs)) ? Number(collectedAtMs) : Date.now()
  };
}

function lerFilaWorkspaceSnapshot(clienteId = "", opcoes = {}) {
  const clock = typeof opcoes.clock === "function" ? opcoes.clock : Date.now;
  const coletadoEm = () => Number(clock());
  const medidor = opcoes.medidorCiclo;
  const clockPerf = medidor?.clock || (() => 0);

  // A injeção de teste usa o mesmo contrato metadatado da leitura produtiva.
  // O leitor genérico readClienteJson não é aceito aqui porque seu fallback []
  // não distingue fila realmente vazia de arquivo ausente/corrompido.
  if (typeof opcoes.readFilaSnapshot === "function") {
    try {
      const leitura = opcoes.readFilaSnapshot(clienteId);
      medidor?.registrarLeitura({ lido: leitura?.ok === true, itens: Array.isArray(leitura?.itens) ? leitura.itens.length : 0 });
      return resultadoLeituraFila({
        ok: leitura?.ok === true,
        itens: leitura?.itens,
        motivo: leitura?.motivo || "fila_fonte_invalida",
        collectedAtMs: Number.isFinite(Number(leitura?.collectedAtMs))
          ? Number(leitura.collectedAtMs) : coletadoEm()
      });
    } catch {
      medidor?.registrarLeitura({ lido: false });
      return resultadoLeituraFila({ motivo: "fila_erro_leitura", collectedAtMs: coletadoEm() });
    }
  }

  const resolverPath = typeof opcoes.getClienteJsonPath === "function" ? opcoes.getClienteJsonPath : getClienteJsonPath;
  const lerArquivo = typeof opcoes.readFileSync === "function" ? opcoes.readFileSync : fs.readFileSync;
  let texto;
  let bytesArquivoObservados = null;
  let leituraMs = 0;
  let parseMs = 0;
  const inicioLeitura = clockPerf();
  try {
    const arquivo = resolverPath(clienteId, "fila.json");
    if (medidor && !opcoes.readFileSync) {
      try { bytesArquivoObservados = fs.statSync(arquivo).size; } catch {}
    }
    texto = lerArquivo(arquivo, "utf8");
    leituraMs = Math.max(0, clockPerf() - inicioLeitura);
  } catch (erro) {
    medidor?.registrarLeitura({ lido: false, leituraMs: Math.max(0, clockPerf() - inicioLeitura) });
    return resultadoLeituraFila({
      motivo: erro?.code === "ENOENT" ? "fila_ausente" : "fila_erro_leitura",
      collectedAtMs: coletadoEm()
    });
  }

  if (typeof texto !== "string" || texto.trim() === "") {
    medidor?.registrarLeitura({ lido: true, leituraMs, bytesArquivoObservados, caracteresLidos: texto?.length || 0 });
    return resultadoLeituraFila({ motivo: "fila_arquivo_vazio", collectedAtMs: coletadoEm() });
  }

  let itens;
  const inicioParse = clockPerf();
  try {
    itens = JSON.parse(texto);
    parseMs = Math.max(0, clockPerf() - inicioParse);
  } catch {
    medidor?.registrarLeitura({ lido: true, leituraMs, parseMs: Math.max(0, clockPerf() - inicioParse),
      bytesArquivoObservados, caracteresLidos: texto.length });
    return resultadoLeituraFila({ motivo: "fila_json_corrompido", collectedAtMs: coletadoEm() });
  }
  medidor?.registrarLeitura({ lido: true, leituraMs, parseMs, bytesArquivoObservados, caracteresLidos: texto.length,
    itens: Array.isArray(itens) ? itens.length : 0 });
  return resultadoLeituraFila({
    ok: Array.isArray(itens),
    itens,
    motivo: "fila_formato_invalido",
    collectedAtMs: coletadoEm()
  });
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function numeroPositivo(valor, padrao = null) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function arredondar(valor, casas = 2) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function porMinuto(total, janelaMinutos) {
  return arredondar(numero(total) / Math.max(1, numero(janelaMinutos, 15)), 2);
}

function statusFila(item = {}) {
  return String(item?.status ?? item?.situacao ?? "").toLowerCase().trim();
}

function classificarStatusFila(item = {}) {
  const status = statusFila(item);
  if (STATUS_PENDENTES_VIVOS.has(status)) return BUCKET_STATUS.PENDENTE_VIVO;
  if (STATUS_EM_TENTATIVA.has(status)) return BUCKET_STATUS.EM_TENTATIVA;
  if (STATUS_ERROS_TEMPORARIOS.has(status)) return BUCKET_STATUS.ERRO_TEMPORARIO_RECUPERAVEL;
  if (STATUS_ENVIADOS.has(status)) return BUCKET_STATUS.ENVIADO_HISTORICO;
  if (STATUS_ERROS_FINAIS.has(status)) return BUCKET_STATUS.ERRO_FINAL;
  if (STATUS_CANCELADOS.has(status)) return BUCKET_STATUS.CANCELADO;
  if (STATUS_EXPIRADOS.has(status)) return BUCKET_STATUS.EXPIRADO;
  if (STATUS_HISTORICO.has(status)) return BUCKET_STATUS.ENVIADO_HISTORICO;
  return BUCKET_STATUS.STATUS_DESCONHECIDO;
}

function itemVivoFila(item = {}) {
  return [
    BUCKET_STATUS.PENDENTE_VIVO,
    BUCKET_STATUS.EM_TENTATIVA,
    BUCKET_STATUS.ERRO_TEMPORARIO_RECUPERAVEL
  ].includes(classificarStatusFila(item));
}

function destinosDoCliente(mapa = {}, clienteId = "") {
  const bruto = mapa?.[clienteId];
  if (Array.isArray(bruto)) return bruto;
  if (bruto && typeof bruto === "object") return Object.values(bruto).filter(Array.isArray).flat();
  return [];
}

function carregarDestinosPorCliente(opcoes = {}) {
  return opcoes.destinosPorCliente || objeto(readGlobalJson("destinos_clientes.json", readGlobalJson("destinos.json", {})));
}

function carregarUsuarios(opcoes = {}) {
  if (Array.isArray(opcoes.usuarios)) return opcoes.usuarios;
  const usuarios = readGlobalJson("usuarios.json", []);
  return Array.isArray(usuarios) ? usuarios : [];
}

function carregarConfiguracaoExecutor(clienteId = "", opcoes = {}, configsGlobais = {}, configPadrao = {}) {
  if (opcoes.configsPorCliente && Object.prototype.hasOwnProperty.call(opcoes.configsPorCliente, clienteId)) {
    return objeto(opcoes.configsPorCliente[clienteId]);
  }
  if (typeof opcoes.readConfigCliente === "function") {
    return objeto(opcoes.readConfigCliente(clienteId, "config.json", null) || configsGlobais[clienteId] || configPadrao);
  }
  // readClienteJson cria diretorios ausentes; a observacao Shadow nao deve escrever nada.
  if (/^[a-zA-Z0-9_.-]+$/.test(clienteId) && !clienteId.includes("..")) {
    const arquivo = path.join(process.env.DATA_DIR || "/data", "clientes", clienteId, "config.json");
    try {
      const configCliente = JSON.parse(fs.readFileSync(arquivo, "utf8"));
      if (configCliente && typeof configCliente === "object" && !Array.isArray(configCliente)) return configCliente;
    } catch (erro) {
      if (erro.code !== "ENOENT") return {};
    }
  }
  return objeto(configsGlobais[clienteId] || configPadrao);
}

function usuarioPorId(usuarios = [], clienteId = "") {
  return usuarios.find(usuario => String(usuario?.id || "") === String(clienteId || "")) || null;
}

function timestampFila(item = {}) {
  for (const campo of CAMPOS_TIMESTAMP_FILA) {
    const data = new Date(item?.[campo] || "");
    const ms = data.getTime();
    if (Number.isFinite(ms)) return { ms, campo };
  }
  return { ms: null, campo: "" };
}

function destinoId(destino = {}, indice = 0) {
  return String(destino.id || destino.destinoId || destino.jid || destino.chatId || destino.nome || `destino_${indice + 1}`).trim();
}

function normalizarTexto(valor = "") {
  return String(valor || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function itemDestinadoAoDestino(item = {}, destino = {}, indice = 0) {
  const id = destinoId(destino, indice);
  const candidatos = [
    item.destinoId,
    item.destino_id,
    item.destino,
    item.chatId,
    item.grupoId,
    item.jid,
    item.canalId
  ].map(valor => String(valor || "").trim()).filter(Boolean);

  if (!candidatos.length) return true;
  return candidatos.includes(id);
}

function destinoItem(item = {}) {
  return String(
    item.destinoId ||
    item.destino_id ||
    item.destino ||
    item.chatId ||
    item.grupoId ||
    item.jid ||
    item.canalId ||
    "sem_destino"
  ).trim() || "sem_destino";
}

function marketplaceItem(item = {}) {
  return normalizarTexto(
    item.marketplace ||
    item.marketplaceDetectado ||
    item.marketplace_detectado ||
    item.loja ||
    item.origemMarketplace ||
    "desconhecido"
  ) || "desconhecido";
}

function possuiValor(item = {}, campos = []) {
  for (const campo of campos) {
    const valor = item?.[campo];
    if (Array.isArray(valor) && valor.length) return true;
    if (valor && typeof valor === "object" && Object.keys(valor).length) return true;
    if (String(valor || "").trim()) return true;
  }
  return false;
}

function tipoOperacionalFila(item = {}) {
  if (item.cupomTurbo === true || item.turbo === true || normalizarTexto(item.modoEnvio || item.modo) === "cupomturbo") return "cupom_turbo";
  if (possuiValor(item, ["linkResgate", "linksResgate", "urlResgate"]) || possuiValor(objeto(item.links), ["resgate", "linksResgate"])) return "resgate";
  if (possuiValor(item, ["cupom", "codigoCupom", "codigosCupom", "cupons", "instrucaoCupom", "cupomTexto"])) return "cupom";
  if (item.origem === "radar" || item.radar === true || objeto(item.metadata).radarMirror) return "radar";
  if (marketplaceItem(item) === "desconhecido") return "desconhecido";
  return "comum";
}

function ttlEsteiraMs(item = {}) {
  return TTL_ESTEIRA_MS[tipoOperacionalFila(item)] || TTL_ESTEIRA_MS.desconhecido;
}

function proximaTentativaFilaMs(item = {}) {
  const candidatos = [
    item.proximaTentativaEnvioEm,
    item.proxima_tentativa,
    item.proximaTentativa,
    item.tentarNovamenteEm,
    item.retryEm,
    item.cooldownAte
  ];

  for (const candidato of candidatos) {
    const ms = new Date(candidato || "").getTime();
    if (Number.isFinite(ms)) return ms;
  }

  return null;
}

function motivoInelegivelDefinitivo(item = {}) {
  const textoMotivos = [
    item.motivo,
    item.motivoFinal,
    item.motivo_final,
    item.motivoRetencao,
    item.motivo_status,
    item.statusDetalhe,
    item.status_detalhe,
    item.erroFinal,
    item.erro_final
  ].map(normalizarTexto).filter(Boolean).join(" ");

  if (!textoMotivos) return "";

  if (/categoria.*incompativel|categoria_nao_marcada|categoria.*nao.*marcad/.test(textoMotivos)) return "categoria_incompativel";
  if (/marketplace.*desabilitad|marketplace_nao_marcado|marketplace.*nao.*marcad/.test(textoMotivos)) return "marketplace_desabilitado";
  if (/sem_destino|destino.*incompativel|nenhum_destino|sem_clientes_operacionais/.test(textoMotivos)) return "sem_destino_compativel";
  if (/integracao_ausente|integracao.*ausent|credencial.*ausent|sessao.*inapta/.test(textoMotivos)) return "integracao_ausente";
  if (/erro_final|falha_final|rejeitad.*definitiv|bloqueio_definitiv/.test(textoMotivos)) return "erro_final";

  return "";
}

function itemPressionaCapacidade(item = {}, agora = Date.now(), contexto = {}) {
  const bucket = classificarStatusFila(item);
  if (!itemVivoFila(item)) {
    return { pressiona: false, bucket, motivo: "status_fora_pressao_viva" };
  }

  const motivoDefinitivo = motivoInelegivelDefinitivo(item);
  if (motivoDefinitivo) {
    return { pressiona: false, bucket, motivo: motivoDefinitivo };
  }

  const timestamp = timestampFila(item);
  if (timestamp.ms === null) {
    return { pressiona: false, bucket, motivo: "sem_timestamp_operacional" };
  }

  const agoraMs = Number(agora || contexto.agoraMs || Date.now());
  const ttlMs = ttlEsteiraMs(item);
  const idadeMs = Math.max(0, agoraMs - timestamp.ms);
  if (idadeMs >= ttlMs) {
    return { pressiona: false, bucket, motivo: "ttl_operacional_vencido", idadeMs, ttlMs, timestampCampo: timestamp.campo };
  }

  const proximaMs = proximaTentativaFilaMs(item);
  const expiraMs = timestamp.ms + ttlMs;
  if (proximaMs !== null && proximaMs > expiraMs) {
    return {
      pressiona: false,
      bucket,
      motivo: "cooldown_ultrapassa_ttl_operacional",
      idadeMs,
      ttlMs,
      proximaTentativaMs: proximaMs,
      timestampCampo: timestamp.campo
    };
  }

  return {
    pressiona: true,
    bucket,
    motivo: proximaMs !== null && proximaMs > agoraMs ? "cooldown_curto_vivo" : "item_fresco_vivo",
    idadeMs,
    ttlMs,
    proximaTentativaMs: proximaMs,
    timestampCampo: timestamp.campo
  };
}

function incrementar(mapa = {}, chave = "") {
  const k = String(chave || "desconhecido");
  mapa[k] = (mapa[k] || 0) + 1;
}

function percentil(valores = [], p = 0.95) {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.max(0, Math.ceil(ordenados.length * p) - 1));
  return ordenados[indice];
}

function media(valores = []) {
  if (!valores.length) return null;
  return Math.round(valores.reduce((total, valor) => total + valor, 0) / valores.length);
}

function mediana(valores = []) {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  if (ordenados.length % 2) return ordenados[meio];
  return Math.round((ordenados[meio - 1] + ordenados[meio]) / 2);
}

function faixaIdade(idadeMs = 0) {
  const min = idadeMs / 60000;
  if (min <= 5) return "itensAte5Min";
  if (min <= 10) return "itens5a10Min";
  if (min <= 15) return "itens10a15Min";
  if (min <= 30) return "itens15a30Min";
  if (min <= 60) return "itens30a60Min";
  if (min <= 120) return "itens1a2h";
  return "itensAcima2h";
}

function criarFaixasVazias() {
  return {
    itensAte5Min: 0,
    itens5a10Min: 0,
    itens10a15Min: 0,
    itens15a30Min: 0,
    itens30a60Min: 0,
    itens1a2h: 0,
    itensAcima2h: 0
  };
}

function classificarItemEsteiraShadow(item = {}, { agoraMs = Date.now(), janelaAbertaAgora = false } = {}) {
  const bucket = classificarStatusFila(item);
  if (bucket === BUCKET_STATUS.STATUS_DESCONHECIDO) return "aguardandoAuditoria";
  if (!itemVivoFila(item)) return "foraPressaoViva";

  const timestamp = timestampFila(item);
  if (timestamp.ms === null) return "aguardandoAuditoria";

  const idadeMs = Math.max(0, agoraMs - timestamp.ms);
  const ttlMs = ttlEsteiraMs(item);
  if (idadeMs >= ttlMs) return "vencidosOperacionalmente";
  if (!janelaAbertaAgora && idadeMs >= Math.min(30 * 60 * 1000, ttlMs * 0.5)) return "candidatosExpiracao";
  if (idadeMs >= ttlMs * 0.7) return "candidatosExpiracao";
  return "aindaVivos";
}

function resumoFilaWorkspace(clienteId = "", opcoes = {}) {
  const lerFila = opcoes.readClienteJson || readClienteJson;
  const agora = Number(opcoes.agoraMs || Date.now());
  const janelaAbertaAgora = opcoes.janelaAbertaAgora === true;
  const filaFoiFornecida = Object.prototype.hasOwnProperty.call(opcoes, "filaItens");
  const fila = filaFoiFornecida ? lista(opcoes.filaItens) : lista(lerFila(clienteId, "fila.json", []));
  const finalizacoes = criarContadorFinalizacoes({ clienteId, agoraMs: opcoes.finalizacoesAgoraMs ?? agora, janelaMinutos: opcoes.janelaMinutos || 15 });
  const contagem = {
    pendente_vivo: 0,
    em_tentativa: 0,
    erro_temporario_recuperavel: 0,
    enviado_historico: 0,
    erro_final: 0,
    cancelado: 0,
    expirado: 0,
    status_desconhecido: 0
  };
  const porStatus = {};
  const porMarketplace = {};
  const porDestino = {};
  const porTipoOperacional = {};
  const camposTimestampEncontrados = {};
  const idades = [];
  const idadesAcionaveis = [];
  const idadesHistoricas = [];
  const faixas = criarFaixasVazias();
  const pressaoContagem = {
    pendente_vivo: 0,
    em_tentativa: 0,
    erro_temporario_recuperavel: 0
  };
  const motivosForaPressaoViva = {};
  const itensPressaoViva = [];
  let itensSemTimestamp = 0;
  let aindaVivos = 0;
  let candidatosExpiracao = 0;
  let vencidosOperacionalmente = 0;
  let aguardandoAuditoria = 0;
  let expiredAliveCount = 0;
  let expiredProcessingCount = 0;
  let expiredPendingCount = 0;

  for (const item of fila) {
    const statusReal = statusFila(item) || "sem_status";
    const bucket = classificarStatusFila(item);
    contagem[bucket] = (contagem[bucket] || 0) + 1;
    incrementar(porStatus, statusReal);
    finalizacoes.observar(item);

    if (!itemVivoFila(item)) continue;

    incrementar(porMarketplace, marketplaceItem(item));
    incrementar(porDestino, destinoItem(item));
    incrementar(porTipoOperacional, tipoOperacionalFila(item));

    const timestamp = timestampFila(item);
    if (timestamp.ms === null) {
      itensSemTimestamp += 1;
    } else {
      camposTimestampEncontrados[timestamp.campo] = (camposTimestampEncontrados[timestamp.campo] || 0) + 1;
      const idadeMs = Math.max(0, agora - timestamp.ms);
      idades.push(idadeMs);
      faixas[faixaIdade(idadeMs)] += 1;
      if (idadeMs >= ttlEsteiraMs(item)) {
        expiredAliveCount += 1;
        if (bucket === BUCKET_STATUS.EM_TENTATIVA) expiredProcessingCount += 1;
        if (bucket === BUCKET_STATUS.PENDENTE_VIVO) expiredPendingCount += 1;
      }
    }

    const classificacao = classificarItemEsteiraShadow(item, { agoraMs: agora, janelaAbertaAgora });
    if (classificacao === "aindaVivos") aindaVivos += 1;
    if (classificacao === "candidatosExpiracao") candidatosExpiracao += 1;
    if (classificacao === "vencidosOperacionalmente") vencidosOperacionalmente += 1;
    if (classificacao === "aguardandoAuditoria") aguardandoAuditoria += 1;

    const pressao = itemPressionaCapacidade(item, agora, { janelaAbertaAgora });
    if (pressao.pressiona) {
      idadesAcionaveis.push(pressao.idadeMs);
      pressaoContagem[bucket] = (pressaoContagem[bucket] || 0) + 1;
      itensPressaoViva.push({
        id: item.id || item.filaItemId || item.ofertaId || item.engineOfertaId || null,
        status: statusReal,
        bucket,
        idadeMs: pressao.idadeMs,
        ttlMs: pressao.ttlMs,
        motivo: pressao.motivo,
        proximaTentativaMs: pressao.proximaTentativaMs ?? null,
        destinoRefs: [item.destinoId, item.destino_id, item.destino, item.chatId, item.grupoId, item.jid, item.canalId]
          .map(valor => String(valor || "").trim()).filter(Boolean)
      });
    } else {
      incrementar(motivosForaPressaoViva, pressao.motivo || "fora_pressao_viva");
      if (timestamp.ms !== null) idadesHistoricas.push(Math.max(0, agora - timestamp.ms));
    }
  }

  const pressaoEsteiraViva = pressaoContagem.pendente_vivo + pressaoContagem.em_tentativa + pressaoContagem.erro_temporario_recuperavel;
  const totalEnviadosHistorico = contagem.enviado_historico;

  return {
    itens: fila,
    finalizacoesComerciaisObservadas: finalizacoes.resumo(),
    fonteFilaValida: opcoes.fonteFilaValida !== false,
    fonteFilaMotivo: opcoes.fonteFilaValida === false ? String(opcoes.fonteFilaMotivo || "fila_fonte_invalida") : "",
    fonteFilaColetadaEmMs: Number.isFinite(Number(opcoes.fonteFilaColetadaEmMs))
      ? Number(opcoes.fonteFilaColetadaEmMs) : null,
    quantidadeFilaAtual: pressaoEsteiraViva,
    pressaoEsteiraViva,
    pressaoVivaConfirmada: pressaoEsteiraViva,
    queueDepthRaw: contagem.pendente_vivo + contagem.em_tentativa + contagem.erro_temporario_recuperavel,
    queueDepthActionable: itensPressaoViva.length,
    oldestAgeRaw: idades.length ? Math.max(...idades) : 0,
    oldestActionableAge: idadesAcionaveis.length ? Math.max(...idadesAcionaveis) : 0,
    oldestHistoricalAge: idadesHistoricas.length ? Math.max(...idadesHistoricas) : 0,
    expiredAliveCount,
    expiredProcessingCount,
    expiredPendingCount,
    pressaoPendenteVivo: pressaoContagem.pendente_vivo,
    pressaoEmTentativa: pressaoContagem.em_tentativa,
    pressaoErroTemporarioRecuperavel: pressaoContagem.erro_temporario_recuperavel,
    itensPressaoViva,
    itensPressaoVivaTotal: itensPressaoViva.length,
    motivosForaPressaoViva,
    pendente_vivo: contagem.pendente_vivo,
    em_tentativa: contagem.em_tentativa,
    erro_temporario_recuperavel: contagem.erro_temporario_recuperavel,
    enviado_historico: contagem.enviado_historico,
    erro_final: contagem.erro_final,
    cancelado: contagem.cancelado,
    expirado: contagem.expirado,
    status_desconhecido: contagem.status_desconhecido,
    pendentesVivos: contagem.pendente_vivo,
    emTentativaEnvio: contagem.em_tentativa,
    errosTemporariosRecuperaveis: contagem.erro_temporario_recuperavel,
    enviados: contagem.enviado_historico,
    errosFinais: contagem.erro_final,
    cancelados: contagem.cancelado,
    expirados: contagem.expirado,
    historico: 0,
    totalEnviadosHistorico,
    idadeMinimaVivaMs: idades.length ? Math.min(...idades) : null,
    idadeMediaVivaMs: media(idades),
    idadeMedianaVivaMs: mediana(idades),
    idadeP95VivaMs: percentil(idades, 0.95),
    idadeMaximaVivaMs: idades.length ? Math.max(...idades) : null,
    idadeItemMaisAntigoFila: idades.length ? Math.max(...idades) : null,
    idadeMaisAntigaViva: idades.length ? Math.max(...idades) : null,
    itensSemTimestamp,
    ...faixas,
    porStatus,
    porMarketplace,
    porDestino,
    porTipoOperacional,
    camposTimestampEncontrados,
    aindaVivos,
    candidatosExpiracao,
    vencidosOperacionalmente,
    aguardandoAuditoria
  };
}

function limiteDiarioRestante(usuario = {}) {
  const candidatos = [
    usuario.limiteDiarioRestante,
    usuario.limite_diario_restante,
    usuario.creditosRestantesDia,
    usuario.creditosDiaRestantes
  ];
  for (const candidato of candidatos) {
    const n = Number(candidato);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function limiteDiarioDestino(destino = {}) {
  const limite = numeroPositivo(
    destino.limiteDiario ?? destino.limite_diario ?? destino.limiteEnviosDia ?? destino.limiteDiarioEnvios,
    null
  );
  const enviadosHoje = numero(destino.enviosHoje ?? destino.enviadosHoje ?? destino.enviosRealizadosHoje, 0);
  const restanteExplicito = destino.limiteDiarioRestante ?? destino.limite_diario_restante ?? destino.enviosRestantesHoje;
  const restante = Number.isFinite(Number(restanteExplicito))
    ? Math.max(0, Number(restanteExplicito))
    : (limite === null ? null : Math.max(0, limite - enviadosHoje));
  return { limite, enviadosHoje, restante };
}

function turboAplicavelDestino(destino = {}) {
  return destinoAceitaTurboCupom(destino);
}

function integracaoAptaDestino(destino = {}) {
  if (destino.integracaoApta === false || destino.integracao_apta === false) return false;
  if (destino.cookiesVencidos === true || destino.cookieVencido === true || destino.cookies_expirados === true) return false;
  const status = normalizarTexto(destino.statusIntegracao || destino.integracaoStatus || destino.statusSessao || destino.status);
  if (["inapta", "inapto", "vencida", "vencido", "desconectada", "desconectado", "bloqueada", "bloqueado"].includes(status)) return false;
  const erro = normalizarTexto(destino.erroIntegracao || destino.motivoInapto || destino.motivoBloqueio || "");
  if (/cookie|credencial|token|sessao/.test(erro) && /vencid|expirad|invalid|ausent|inapt/.test(erro)) return false;
  return destinoPossuiIntegracaoBasica(destino);
}

function slotsCobertura(coberturaMinutos = 0, intervaloMinutos = 1) {
  const cobertura = Number(coberturaMinutos);
  const intervalo = Number(intervaloMinutos);
  if (!Number.isFinite(cobertura) || !Number.isFinite(intervalo) || cobertura <= 0 || intervalo <= 0) return 0;
  return Math.max(0, Math.floor(cobertura / intervalo));
}

function capacidadeDestinoShadow(destino = {}, indice = 0, filaItens = []) {
  const id = destinoId(destino, indice);
  const ativo = destino?.ativo !== false;
  const integracaoConfigurada = ativo && destinoPossuiIntegracaoBasica(destino);
  const integracaoApta = integracaoConfigurada && integracaoAptaDestino(destino);
  const janelaAbertaAgora = ativo && integracaoApta && destinosUtils.destinoDentroHorario(destino);
  const limiteDiario = limiteDiarioDestino(destino);
  const limiteOk = limiteDiario.restante === null || limiteDiario.restante > 0;
  const destinoApto = janelaAbertaAgora && limiteOk;
  const intervaloNormal = numeroIntervaloDestino(destino);
  const turboAplicavel = destinoApto && turboAplicavelDestino(destino);
  const cadencia = resolverCadenciaDestino({
    destino,
    considerarTurboSemOferta: turboAplicavel
  });
  const intervaloTurbo = cadencia.intervaloTurboMin || cadencia.intervaloEfetivoMin;
  const intervaloEfetivo = turboAplicavel ? cadencia.intervaloEfetivoMin : intervaloNormal;
  const filaVivaDestino = lista(filaItens).filter(item => itemVivoFila(item) && itemDestinadoAoDestino(item, destino, indice)).length;

  const slots5Min = destinoApto ? slotsCobertura(5, intervaloEfetivo) : 0;
  const slots10Min = destinoApto ? slotsCobertura(10, intervaloEfetivo) : 0;
  const slots15Min = destinoApto ? slotsCobertura(15, intervaloEfetivo) : 0;

  return {
    destinoId: id,
    tipo: String(destino.tipo || destino.canal || "").toLowerCase(),
    destinoHabilitado: ativo,
    integracaoConfigurada,
    janelaAbertaAgora,
    integracaoApta,
    limiteDiarioConfigurado: limiteDiario.limite,
    enviosRealizadosHoje: limiteDiario.enviadosHoje,
    limiteDiarioRestante: limiteDiario.restante,
    intervaloNormal: arredondar(intervaloNormal, 2),
    intervaloTurbo: arredondar(intervaloTurbo, 2),
    turboAplicavel,
    intervaloEfetivo: arredondar(intervaloEfetivo, 2),
    cadenciaModo: cadencia.modo,
    filaVivaDestino,
    slots5Min,
    slots10Min,
    slots15Min,
    capacidade5Min: slots5Min,
    capacidade10Min: slots10Min,
    capacidade15Min: slots15Min,
    aptoAgora: destinoApto
  };
}

function metricasEventosWorkspace(linhas = []) {
  const mapa = new Map();
  for (const linha of lista(linhas)) {
    const id = String(linha.workspace_id || linha.cliente_id || "").trim();
    if (!id) continue;
    mapa.set(id, {
      ofertasCriadas: numero(linha.ofertas_criadas),
      itensAdicionadosFila: numero(linha.itens_adicionados_fila),
      distribuicoesFinais: numero(linha.distribuicoes_finais),
      enviosConfirmados: numero(linha.envios_confirmados),
      enviosErroFinal: numero(linha.envios_erro_final)
    });
  }
  return mapa;
}

function avaliarDestinosWorkspace(destinos = [], janelaMinutos = 15, filaItens = []) {
  const capacidadePorDestino = lista(destinos).map((destino, indice) => capacidadeDestinoShadow(destino, indice, filaItens));
  const destinosAtivos = capacidadePorDestino.filter(item => item.destinoHabilitado).length;
  const destinosTopologiaPotencial = capacidadePorDestino
    .filter(item => item.destinoHabilitado && item.integracaoConfigurada).length;
  const integracoesAptas = capacidadePorDestino.filter(item => item.integracaoApta).length;
  const destinosAptos = capacidadePorDestino.filter(item => item.aptoAgora).length;
  const destinosFechados = capacidadePorDestino.length - destinosAptos;
  const slots5Min = capacidadePorDestino.reduce((total, item) => total + item.slots5Min, 0);
  const slots10Min = capacidadePorDestino.reduce((total, item) => total + item.slots10Min, 0);
  const slots15Min = capacidadePorDestino.reduce((total, item) => total + item.slots15Min, 0);

  return {
    destinosAtivos,
    destinosTopologiaPotencial,
    topologiaOperacionalPotencial: destinosTopologiaPotencial > 0,
    integracoesAptas,
    destinosAptos,
    destinosFechados,
    janelaAbertaAgora: destinosAptos > 0,
    automacaoAtiva: destinosAtivos > 0 && integracoesAptas > 0,
    capacidadePorDestino,
    slots5Min,
    slots10Min,
    slots15Min,
    filaAlvo5Min: slots5Min,
    filaAlvo10Min: slots10Min,
    filaAlvo15Min: slots15Min,
    filaAlvo: slots10Min,
    capacidadeTeorica: slots15Min,
    intervaloNormal: capacidadePorDestino.find(item => item.aptoAgora)?.intervaloNormal || null,
    intervaloTurbo: capacidadePorDestino.find(item => item.turboAplicavel)?.intervaloTurbo || null,
    turboAplicavel: capacidadePorDestino.some(item => item.turboAplicavel)
  };
}

function classificarEstadoEsteira({ janelaAbertaAgora, automacaoAtiva, destinosAptos, filaAlvo15Min, capacidadeUtilizada, capacidadeAbsorcaoAgora, pressaoEsteiraViva } = {}) {
  if (!automacaoAtiva) return { estado: "FECHADA", motivo: "automacao_sem_destino_ativo" };
  if (!janelaAbertaAgora || destinosAptos <= 0) return { estado: "FECHADA", motivo: "janela_fechada_ou_sem_destino_apto" };
  if (filaAlvo15Min <= 0) return { estado: "FECHADA", motivo: "capacidade_dinamica_zero" };
  if (pressaoEsteiraViva >= filaAlvo15Min || capacidadeAbsorcaoAgora <= 0) return { estado: "SATURADA", motivo: "pressao_viva_acima_da_fila_alvo" };
  if (pressaoEsteiraViva >= filaAlvo15Min * 0.7 || capacidadeAbsorcaoAgora < 1) return { estado: "LIMITADA", motivo: "pouca_capacidade_livre" };
  if (pressaoEsteiraViva > 0 || (capacidadeUtilizada !== null && capacidadeUtilizada >= 0.4)) return { estado: "ESTAVEL", motivo: "esteira_viva_com_fluxo_controlado" };
  return { estado: "LIVRE", motivo: "capacidade_dinamica_livre_para_agua_nova" };
}

function logBufferVivoGateShadow(bufferVivo = {}, divergencia = {}) {
  try {
    console.log("[BUFFER-VIVO-SHADOW]", JSON.stringify({
      origem: "gate_absorcao_shadow",
      workspaceId: String(bufferVivo.workspaceId || "").trim(),
      estado: bufferVivo.estado,
      bufferAlvo: bufferVivo.bufferAlvo,
      bufferAtualUtil: bufferVivo.bufferAtualUtil,
      deficitBuffer: bufferVivo.deficitBuffer,
      slotsFuturosUtilizaveis: bufferVivo.slotsFuturosUtilizaveis,
      motivo: bufferVivo.motivo,
      capacidadeAgregada: divergencia.capacidadeAgregada,
      aplicouMudancas: false
    }));
    console.log("[BUFFER-VIVO-CAPACIDADE-POR-BRACO]", JSON.stringify({
      origem: "gate_absorcao_shadow",
      workspaceId: String(bufferVivo.workspaceId || "").trim(),
      capacidadePorOferta: bufferVivo.capacidadePorOferta || {},
      capacidadePorDestino: lista(bufferVivo.capacidadePorDestino).map(item => ({
        destinoId: item.destinoId,
        nome: item.nome,
        tipo: item.tipo,
        aptoAgora: item.aptoAgora === true,
        janelaAbertaAgora: item.janelaAbertaAgora === true,
        integracaoApta: item.integracaoApta === true,
        intervaloEfetivo: item.intervaloEfetivo,
        slotsFuturosUtilizaveis: item.slotsFuturosUtilizaveis,
        bufferAtualDestino: item.bufferAtualDestino,
        deficitDestino: item.deficitDestino,
        limiteDiarioRestante: item.limiteDiarioRestante,
        proximoHorarioPermitido: item.proximoHorarioPermitido
      })),
      pressaoPorDestino: bufferVivo.pressaoPorDestino || {},
      pressaoPorMarketplace: bufferVivo.pressaoPorMarketplace || {},
      pressaoPorCategoria: bufferVivo.pressaoPorCategoria || {},
      aplicouMudancas: false
    }));
    if (divergencia.divergente) {
      console.log("[BUFFER-VIVO-DIVERGENCIA-FLOW]", JSON.stringify({
        origem: "gate_absorcao_shadow",
        workspaceId: String(bufferVivo.workspaceId || "").trim(),
        divergencias: lista(divergencia.divergencias),
        motivoBufferVivo: divergencia.motivoBufferVivo,
        capacidadeAgregada: divergencia.capacidadeAgregada,
        bufferAlvo: bufferVivo.bufferAlvo,
        bufferAtualUtil: bufferVivo.bufferAtualUtil,
        deficitBuffer: bufferVivo.deficitBuffer,
        aplicouMudancas: false
      }));
    }
  } catch (_) {}
}

function montarGateWorkspace({ clienteId = "", usuario = {}, configExecutor = {}, destinos = [], fila = {}, eventos = {}, janelaMinutos = 15 } = {}) {
  const destinosResumo = avaliarDestinosWorkspace(destinos, janelaMinutos, fila.itens || []);
  const automacaoExecutorAtiva = configExecutor.automacaoAtiva === true;
  const saldoTexto = typeof usuario.creditos === "string" ? usuario.creditos.trim() : "";
  const saldoInformado = typeof usuario.creditos === "number"
    || /^\d+(?:\.\d+)?$/.test(saldoTexto);
  const creditos = saldoInformado ? Number(usuario.creditos) : NaN;
  const creditosEstado = !Number.isFinite(creditos) || creditos < 0 ? "DESCONHECIDO"
    : creditos >= 1 ? "SUFICIENTE" : "INSUFICIENTE";
  const creditosExecutorAptos = creditosEstado === "DESCONHECIDO" ? null : creditosEstado === "SUFICIENTE";
  const workspaceAptoAgora = automacaoExecutorAtiva && creditosExecutorAptos !== false
    && destinosResumo.destinosAptos > 0;
  const destinosAptosIds = new Set(destinosResumo.capacidadePorDestino
    .filter(destino => destino.aptoAgora).map(destino => destino.destinoId));
  const itensAcionaveis = workspaceAptoAgora ? lista(fila.itensPressaoViva)
    .filter(item => !lista(item.destinoRefs).length || item.destinoRefs.some(id => destinosAptosIds.has(id))) : [];
  const queueDepthActionable = itensAcionaveis.length;
  const oldestActionableAge = itensAcionaveis.length
    ? Math.max(...itensAcionaveis.map(item => numero(item.idadeMs))) : 0;
  const slotsComCreditos = creditosEstado !== "DESCONHECIDO"
    ? Math.min(destinosResumo.slots15Min, Math.max(0, Math.floor(creditos))) : destinosResumo.slots15Min;
  const capacityUnknownSlots = automacaoExecutorAtiva && creditosEstado === "DESCONHECIDO"
    ? destinosResumo.slots15Min : 0;
  const capacityUnknownWorkspaces = capacityUnknownSlots > 0 ? 1 : 0;
  const capacityEffectiveComplete = capacityUnknownWorkspaces === 0;
  const capacityEffectiveKnown = workspaceAptoAgora && capacityEffectiveComplete
    ? Math.max(0, slotsComCreditos - queueDepthActionable) : 0;
  const capacityEffective = capacityEffectiveKnown;
  const enviosUltimos15Min = numero(eventos.enviosConfirmados);
  const consumoComercialUltimos15Min = enviosUltimos15Min;
  const entradaComercialUltimos15Min = numero(eventos.ofertasCriadas);
  const saida15Min = consumoComercialUltimos15Min;
  const saldoFluxo = entradaComercialUltimos15Min - saida15Min;
  const entrandoMaisQueSaindo = saldoFluxo > 0;
  const pressaoEsteiraViva = numero(fila.pressaoEsteiraViva);
  const filaAlvoWorkspace = destinosResumo.filaAlvo15Min;
  const capacidadeAbsorcaoAgora = Math.max(0, filaAlvoWorkspace - pressaoEsteiraViva);
  const capacidadeUtilizada = filaAlvoWorkspace > 0
    ? arredondar(pressaoEsteiraViva / filaAlvoWorkspace, 2)
    : null;
  const velocidadeExecutor = porMinuto(enviosUltimos15Min, janelaMinutos);
  const tempoEstimadoEsvaziarEsteira = velocidadeExecutor > 0
    ? arredondar(pressaoEsteiraViva / velocidadeExecutor, 2)
    : null;
  const quantidadeQueAceitariaAgora = destinosResumo.janelaAbertaAgora
    ? Math.max(0, capacidadeAbsorcaoAgora)
    : 0;
  const quantidadeQueRecusariaAgora = quantidadeQueAceitariaAgora > 0 ? 0 : 1;
  const bufferVivoShadow = calcularBufferVivoWorkspace({
    workspaceId: clienteId,
    destinosResumo,
    filaItens: fila.itens || [],
    saudeAgregada: {
      filaAlvo5Min: destinosResumo.filaAlvo5Min,
      filaAlvo10Min: destinosResumo.filaAlvo10Min,
      filaAlvo15Min: destinosResumo.filaAlvo15Min,
      pressaoEsteiraViva,
      capacidade: capacidadeAbsorcaoAgora
    }
  });
  const bufferVivoDivergencia = resumirDivergenciaBufferVivo(bufferVivoShadow);
  logBufferVivoGateShadow(bufferVivoShadow, bufferVivoDivergencia);
  const classificacao = classificarEstadoEsteira({
    ...destinosResumo,
    filaAlvo15Min: destinosResumo.filaAlvo15Min,
    capacidadeUtilizada,
    capacidadeAbsorcaoAgora,
    pressaoEsteiraViva
  });

  return {
    workspaceId: clienteId,
    estado: classificacao.estado,
    estadoDaEsteira: classificacao.estado,
    motivo: classificacao.motivo,
    totalEnviadosHistorico: numero(fila.totalEnviadosHistorico),
    finalizacoesComerciaisObservadas: fila.finalizacoesComerciaisObservadas || null,
    pressaoEsteiraViva,
    pressaoVivaConfirmada: numero(fila.pressaoVivaConfirmada, pressaoEsteiraViva),
    queueDepthRaw: numero(fila.queueDepthRaw),
    queueDepthActionable,
    oldestAgeRaw: numero(fila.oldestAgeRaw),
    oldestActionableAge,
    oldestHistoricalAge: numero(fila.oldestHistoricalAge),
    expiredAliveCount: numero(fila.expiredAliveCount),
    expiredProcessingCount: numero(fila.expiredProcessingCount),
    expiredPendingCount: numero(fila.expiredPendingCount),
    capacityTheoretical: destinosResumo.slots15Min,
    capacityEffective,
    capacityEffectiveKnown,
    capacityEffectiveComplete,
    capacityUnknownWorkspaces,
    capacityUnknownSlots,
    automacaoExecutorAtiva,
    creditosExecutorAptos,
    creditosEstado,
    statusDesconhecido: numero(fila.status_desconhecido),
    itensSemTimestamp: numero(fila.itensSemTimestamp),
    fonteFilaValida: fila.fonteFilaValida === true,
    fonteFilaMotivo: fila.fonteFilaValida === true ? "" : String(fila.fonteFilaMotivo || "fila_fonte_invalida"),
    fonteFilaColetadaEmMs: Number.isFinite(Number(fila.fonteFilaColetadaEmMs))
      ? Number(fila.fonteFilaColetadaEmMs) : null,
    topologiaOperacionalPotencial: destinosResumo.topologiaOperacionalPotencial === true,
    destinosTopologiaPotencial: numero(destinosResumo.destinosTopologiaPotencial),
    pendente_vivo: numero(fila.pendente_vivo),
    em_tentativa: numero(fila.em_tentativa),
    erro_temporario_recuperavel: numero(fila.erro_temporario_recuperavel),
    enviado_historico: numero(fila.enviado_historico),
    erro_final: numero(fila.erro_final),
    cancelado: numero(fila.cancelado),
    expirado: numero(fila.expirado),
    pendentesVivos: numero(fila.pendentesVivos),
    emTentativaEnvio: numero(fila.emTentativaEnvio),
    errosTemporariosRecuperaveis: numero(fila.errosTemporariosRecuperaveis),
    enviados: numero(fila.enviados),
    errosFinais: numero(fila.errosFinais),
    cancelados: numero(fila.cancelados),
    expirados: numero(fila.expirados),
    historico: numero(fila.historico),
    idadeMinimaVivaMs: fila.idadeMinimaVivaMs ?? null,
    idadeMediaVivaMs: fila.idadeMediaVivaMs ?? null,
    idadeMedianaVivaMs: fila.idadeMedianaVivaMs ?? null,
    idadeP95VivaMs: fila.idadeP95VivaMs ?? null,
    idadeMaximaVivaMs: fila.idadeMaximaVivaMs ?? null,
    idadeMaisAntigaViva: fila.idadeMaximaVivaMs ?? null,
    idadeItemMaisAntigoFila: fila.idadeMaximaVivaMs ?? null,
    idadeMaisAntiga: fila.idadeMaximaVivaMs ?? null,
    faixasIdade: {
      itensAte5Min: numero(fila.itensAte5Min),
      itens5a10Min: numero(fila.itens5a10Min),
      itens10a15Min: numero(fila.itens10a15Min),
      itens15a30Min: numero(fila.itens15a30Min),
      itens30a60Min: numero(fila.itens30a60Min),
      itens1a2h: numero(fila.itens1a2h),
      itensAcima2h: numero(fila.itensAcima2h)
    },
    porStatus: objeto(fila.porStatus),
    porMarketplace: objeto(fila.porMarketplace),
    porDestino: objeto(fila.porDestino),
    porTipoOperacional: objeto(fila.porTipoOperacional),
    camposTimestampEncontrados: objeto(fila.camposTimestampEncontrados),
    aindaVivos: numero(fila.aindaVivos),
    candidatosExpiracao: numero(fila.candidatosExpiracao),
    vencidosOperacionalmente: numero(fila.vencidosOperacionalmente),
    aguardandoAuditoria: numero(fila.aguardandoAuditoria),
    janelaAbertaAgora: destinosResumo.janelaAbertaAgora,
    automacaoAtiva: destinosResumo.automacaoAtiva,
    integracoesAptas: destinosResumo.integracoesAptas,
    destinosAptos: destinosResumo.destinosAptos,
    destinosFechados: destinosResumo.destinosFechados,
    limiteDiarioRestante: limiteDiarioRestante(usuario),
    quantidadeFilaAtual: pressaoEsteiraViva,
    filaAtual: pressaoEsteiraViva,
    capacidadePorDestino: destinosResumo.capacidadePorDestino,
    intervaloNormal: destinosResumo.intervaloNormal,
    intervaloTurbo: destinosResumo.intervaloTurbo,
    turboAplicavel: destinosResumo.turboAplicavel,
    velocidadeExecutor,
    enviosUltimos15Min,
    consumoComercialUltimos15Min,
    entradaComercialUltimos15Min,
    entrada15Min: entradaComercialUltimos15Min,
    saida15Min,
    saldoFluxo,
    entrandoMaisQueSaindo,
    slots5Min: destinosResumo.slots5Min,
    slots10Min: destinosResumo.slots10Min,
    slots15Min: destinosResumo.slots15Min,
    filaAlvo5Min: destinosResumo.filaAlvo5Min,
    filaAlvo10Min: destinosResumo.filaAlvo10Min,
    filaAlvo15Min: destinosResumo.filaAlvo15Min,
    filaAlvo: destinosResumo.filaAlvo,
    capacidadeAbsorcaoAgora,
    capacidadeAbsorcaoShadow: capacidadeAbsorcaoAgora,
    capacidadeTeorica: destinosResumo.capacidadeTeorica,
    capacidadeUtilizada,
    tempoEstimadoEsvaziarEsteira,
    bufferVivoShadow,
    bufferVivoDivergencia,
    quantidadeQueAceitariaAgora,
    quantidadeQueRecusariaAgora
  };
}

function resumirGate(workspaces = []) {
  const porEstado = {};
  let aceitariamAgora = 0;
  let recusariamAgora = 0;
  let pressaoEsteiraViva = 0;
  let queueDepthRaw = 0;
  let queueDepthActionable = 0;
  let oldestAgeRaw = 0;
  let oldestActionableAge = 0;
  let oldestHistoricalAge = 0;
  let capacityTheoretical = 0;
  let capacityEffective = 0;
  let capacityEffectiveKnown = 0;
  let capacityUnknownWorkspaces = 0;
  let capacityUnknownSlots = 0;
  let expiredAliveCount = 0;
  let expiredProcessingCount = 0;
  let expiredPendingCount = 0;
  let statusDesconhecido = 0;
  let itensSemTimestamp = 0;
  let candidatosExpiracao = 0;
  let vencidosOperacionalmente = 0;
  let aguardandoAuditoria = 0;
  for (const item of lista(workspaces)) {
    porEstado[item.estado] = (porEstado[item.estado] || 0) + 1;
    aceitariamAgora += numero(item.quantidadeQueAceitariaAgora);
    recusariamAgora += numero(item.quantidadeQueRecusariaAgora);
    pressaoEsteiraViva += numero(item.pressaoEsteiraViva);
    queueDepthRaw += numero(item.queueDepthRaw);
    queueDepthActionable += numero(item.queueDepthActionable);
    oldestAgeRaw = Math.max(oldestAgeRaw, numero(item.oldestAgeRaw));
    oldestActionableAge = Math.max(oldestActionableAge, numero(item.oldestActionableAge));
    oldestHistoricalAge = Math.max(oldestHistoricalAge, numero(item.oldestHistoricalAge));
    capacityTheoretical += numero(item.capacityTheoretical);
    capacityEffective += numero(item.capacityEffective);
    capacityEffectiveKnown += numero(item.capacityEffectiveKnown);
    capacityUnknownWorkspaces += numero(item.capacityUnknownWorkspaces);
    capacityUnknownSlots += numero(item.capacityUnknownSlots);
    expiredAliveCount += numero(item.expiredAliveCount);
    expiredProcessingCount += numero(item.expiredProcessingCount);
    expiredPendingCount += numero(item.expiredPendingCount);
    statusDesconhecido += numero(item.statusDesconhecido);
    itensSemTimestamp += numero(item.itensSemTimestamp);
    candidatosExpiracao += numero(item.candidatosExpiracao);
    vencidosOperacionalmente += numero(item.vencidosOperacionalmente);
    aguardandoAuditoria += numero(item.aguardandoAuditoria);
  }
  return {
    porEstado,
    aceitariamAgora,
    recusariamAgora,
    pressaoEsteiraViva,
    queueDepthRaw,
    queueDepthActionable,
    oldestAgeRaw,
    oldestActionableAge,
    oldestHistoricalAge,
    capacityTheoretical,
    capacityEffective,
    capacityEffectiveKnown,
    capacityEffectiveComplete: capacityUnknownWorkspaces === 0,
    capacityUnknownWorkspaces,
    capacityUnknownSlots,
    expiredAliveCount,
    expiredProcessingCount,
    expiredPendingCount,
    statusDesconhecido,
    itensSemTimestamp,
    candidatosExpiracao,
    vencidosOperacionalmente,
    aguardandoAuditoria
  };
}

async function criarGateAbsorcaoShadowOfc(opcoes = {}) {
  const clock = typeof opcoes.clock === "function" ? opcoes.clock : Date.now;
  const inicio = clock();
  const janelaMinutos = Math.max(1, Math.min(120, Math.floor(Number(opcoes.janelaMinutos) || 15)));

  try {
    const consultarEventos = opcoes.consultarEventosAbsorcao || consultarEventosAbsorcaoPorWorkspace;
    const eventos = await consultarEventos({ janelaMinutos });
    if (!eventos.ok) {
      return {
        ok: false,
        modo: "shadow",
        aplicouMudancas: false,
        failSafe: true,
        motivo: eventos.motivo || "eventos_absorcao_indisponiveis",
        erro: eventos.erro || "",
        duracaoMs: Math.max(0, clock() - inicio)
      };
    }

    const usuarios = carregarUsuarios(opcoes);
    const clientesAtivos = typeof opcoes.listarClientesAtivos === "function"
      ? opcoes.listarClientesAtivos()
      : listarClientesAtivos({ usuarios });
    const destinosPorCliente = carregarDestinosPorCliente(opcoes);
    const lerConfigGlobalShadow = arquivo => {
      try { return objeto(JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR || "/data", arquivo), "utf8"))); }
      catch (_) { return {}; }
    };
    const configsGlobais = objeto(opcoes.configsPorCliente || lerConfigGlobalShadow("configs_clientes.json"));
    const configPadrao = objeto(opcoes.configPadrao || lerConfigGlobalShadow("config.json"));
    const eventosPorWorkspace = metricasEventosWorkspace(eventos.porWorkspace);
    const workspaces = [];
    const fontesInvalidasPorMotivo = {};
    const fontesInvalidasRelevantesPorMotivo = {};
    let fontesInvalidasIrrelevantes = 0;

    for (const clienteId of lista(clientesAtivos)) {
      const id = String(clienteId || "").trim();
      if (!id) continue;
      const destinos = destinosDoCliente(destinosPorCliente, id);
      const destinosPreview = avaliarDestinosWorkspace(destinos, janelaMinutos, []);
      const leituraFila = lerFilaWorkspaceSnapshot(id, opcoes);
      if (!leituraFila.ok) {
        incrementar(fontesInvalidasPorMotivo, leituraFila.motivo);
        if (destinosPreview.topologiaOperacionalPotencial) {
          incrementar(fontesInvalidasRelevantesPorMotivo, leituraFila.motivo);
        } else {
          fontesInvalidasIrrelevantes += 1;
        }
      }
      workspaces.push(montarGateWorkspace({
        clienteId: id,
        usuario: usuarioPorId(usuarios, id) || {},
        configExecutor: carregarConfiguracaoExecutor(id, opcoes, configsGlobais, configPadrao),
        destinos,
        fila: resumoFilaWorkspace(id, {
          ...opcoes,
          filaItens: leituraFila.itens,
          fonteFilaValida: leituraFila.ok,
          fonteFilaMotivo: leituraFila.motivo,
          fonteFilaColetadaEmMs: leituraFila.collectedAtMs,
          janelaMinutos,
          finalizacoesAgoraMs: inicio,
          janelaAbertaAgora: destinosPreview.janelaAbertaAgora
        }),
        eventos: eventosPorWorkspace.get(id) || {},
        janelaMinutos
      }));
    }

    const resumo = resumirGate(workspaces);
    const fontesInvalidasTotais = Object.values(fontesInvalidasPorMotivo)
      .reduce((total, quantidade) => total + numero(quantidade), 0);
    const fontesInvalidasRelevantes = Object.values(fontesInvalidasRelevantesPorMotivo)
      .reduce((total, quantidade) => total + numero(quantidade), 0);
    return {
      ok: true,
      modo: "shadow",
      aplicouMudancas: false,
      snapshotCompleto: fontesInvalidasRelevantes === 0,
      collectedAtMs: clock(),
      fontesInvalidasCount: fontesInvalidasRelevantes,
      fontesInvalidasTotais,
      fontesInvalidasRelevantes,
      fontesInvalidasIrrelevantes,
      fontesInvalidasPorMotivo,
      fontesInvalidasRelevantesPorMotivo,
      janelaMinutos,
      totalWorkspaces: workspaces.length,
      finalizacoesComerciaisObservadas: {
        disponivel: workspaces.some(w => w.fonteFilaValida),
        total: workspaces.reduce((n, w) => n + (w.fonteFilaValida ? w.finalizacoesComerciaisObservadas?.total || 0 : 0), 0),
        semIdentidadeOuHorario: workspaces.reduce((n, w) => n + (w.finalizacoesComerciaisObservadas?.semIdentidadeOuHorario || 0), 0),
        completo: fontesInvalidasTotais === 0 && workspaces.every(w => w.finalizacoesComerciaisObservadas?.semIdentidadeOuHorario === 0),
        fontesInvalidas: fontesInvalidasTotais,
        observadoEmMs: inicio,
        motivo: fontesInvalidasTotais > 0 ? "filas_ausentes_ou_invalidas" : ""
      },
      totalWorkspacesCadastrais: workspaces.length,
      totalWorkspacesTopologiaOperacional: workspaces
        .filter(item => item.topologiaOperacionalPotencial === true).length,
      resumo,
      workspaces,
      duracaoMs: Math.max(0, clock() - inicio)
    };
  } catch (e) {
    return {
      ok: false,
      modo: "shadow",
      aplicouMudancas: false,
      failSafe: true,
      motivo: "gate_absorcao_exception",
      erro: e?.message || "",
      duracaoMs: Math.max(0, clock() - inicio)
    };
  }
}

module.exports = {
  BUCKET_STATUS,
  CAMPOS_TIMESTAMP_FILA,
  TTL_ESTEIRA_MS,
  classificarStatusFila,
  lerFilaWorkspaceSnapshot,
  itemVivoFila,
  itemPressionaCapacidade,
  timestampFila,
  tipoOperacionalFila,
  classificarItemEsteiraShadow,
  resumoFilaWorkspace,
  slotsCobertura,
  capacidadeDestinoShadow,
  avaliarDestinosWorkspace,
  classificarEstadoEsteira,
  montarGateWorkspace,
  resumirGate,
  criarGateAbsorcaoShadowOfc
};
