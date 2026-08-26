"use strict";

const TAG_INFRA_MEMORY_SNAPSHOT = "[INFRA-MEMORY-SNAPSHOT]";
const INTERVALO_INFRA_MEMORY_SNAPSHOT_MS = 5 * 60 * 1000;
const EVENTOS_SOCKET_WHATSAPP = [
  "messages.upsert",
  "group-participants.update",
  "creds.update"
];

let timerInfraMemorySnapshot = null;

function numeroSeguro(valor = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? Math.round(numero) : 0;
}

function mb(valor = 0) {
  return Math.round((numeroSeguro(valor) / 1024 / 1024) * 10) / 10;
}

function objetoSimples(valor) {
  return valor && typeof valor === "object" ? valor : {};
}

function chavesObjeto(valor) {
  return Object.keys(objetoSimples(valor));
}

function tamanhoEstrutura(valor) {
  if (!valor) return 0;
  if (typeof valor === "function") {
    try {
      return numeroSeguro(valor());
    } catch (_) {
      return "erro";
    }
  }
  if (typeof valor.size === "number") return numeroSeguro(valor.size);
  if (Array.isArray(valor)) return numeroSeguro(valor.length);
  if (typeof valor === "object") return chavesObjeto(valor).length;
  return 0;
}

function criarMemoriaSnapshot(memoria = process.memoryUsage()) {
  const rss = numeroSeguro(memoria.rss);
  const heapUsed = numeroSeguro(memoria.heapUsed);
  const heapTotal = numeroSeguro(memoria.heapTotal);
  const external = numeroSeguro(memoria.external);
  const arrayBuffers = numeroSeguro(memoria.arrayBuffers);

  return {
    rss,
    heapUsed,
    heapTotal,
    external,
    arrayBuffers,
    rssMb: mb(rss),
    heapUsedMb: mb(heapUsed),
    heapTotalMb: mb(heapTotal),
    externalMb: mb(external),
    arrayBuffersMb: mb(arrayBuffers)
  };
}

function criarCpuSnapshot(cpu = process.cpuUsage(), delta = null) {
  const userMsTotal = Math.round(numeroSeguro(cpu.user) / 1000);
  const systemMsTotal = Math.round(numeroSeguro(cpu.system) / 1000);
  const cpuFinal = {
    userMsTotal,
    systemMsTotal,
    totalMs: userMsTotal + systemMsTotal
  };

  if (delta && typeof delta === "object") {
    const userMsDelta = Math.round(numeroSeguro(delta.user) / 1000);
    const systemMsDelta = Math.round(numeroSeguro(delta.system) / 1000);
    cpuFinal.userMsDelta = userMsDelta;
    cpuFinal.systemMsDelta = systemMsDelta;
    cpuFinal.totalMsDelta = userMsDelta + systemMsDelta;
  }

  return cpuFinal;
}

function normalizarStatusSessao(status = "") {
  return String(status || "").trim().toLowerCase();
}

function classificarStatusSessao(status = "") {
  const valor = normalizarStatusSessao(status);
  if (!valor) return "desconhecido";
  if (valor === "open" || valor === "aberto" || valor === "connected" || valor === "conectado") return "open";
  if (/connecting|conectando|qr|reconnect|reconect|inicializ|pendente/.test(valor)) return "connecting";
  if (/logged.?out|logout|closed|close|desconect|erro_auth|apagada|resetada|desativada|terminal/.test(valor)) {
    return "closedLoggedOut";
  }
  return "desconhecido";
}

function contarSessoesWhatsapp({ sessoes = {}, statusSessao = {}, sessoesMeta = {} } = {}) {
  const ids = new Set([
    ...chavesObjeto(sessoes),
    ...chavesObjeto(statusSessao),
    ...chavesObjeto(sessoesMeta)
  ]);
  const resumo = {
    total: ids.size,
    open: 0,
    connecting: 0,
    closedLoggedOut: 0,
    desconhecido: 0
  };

  for (const id of ids) {
    const meta = objetoSimples(sessoesMeta[id]);
    const status = statusSessao[id] || meta.status || "";
    const classe = classificarStatusSessao(status);
    resumo[classe] = numeroSeguro(resumo[classe]) + 1;
  }

  return resumo;
}

function contarListenerSocket(sock, evento = "") {
  const emissor = sock?.ev || sock?.events || sock;
  if (!emissor || !evento) return 0;
  try {
    if (typeof emissor.listenerCount === "function") return numeroSeguro(emissor.listenerCount(evento));
    if (typeof emissor.listeners === "function") return tamanhoEstrutura(emissor.listeners(evento));
  } catch (_) {
    return 0;
  }
  return 0;
}

function contarSocketsWhatsapp(sessoes = {}) {
  const resumo = {
    vivosConhecidos: 0,
    listeners: EVENTOS_SOCKET_WHATSAPP.reduce((acc, evento) => {
      acc[evento] = { total: 0, maxPorSocket: 0 };
      return acc;
    }, {})
  };

  for (const sock of Object.values(objetoSimples(sessoes))) {
    if (!sock) continue;
    resumo.vivosConhecidos += 1;
    for (const evento of EVENTOS_SOCKET_WHATSAPP) {
      const totalSocket = contarListenerSocket(sock, evento);
      resumo.listeners[evento].total += totalSocket;
      resumo.listeners[evento].maxPorSocket = Math.max(resumo.listeners[evento].maxPorSocket, totalSocket);
    }
  }

  return resumo;
}

function contarFila(fila = []) {
  const itens = Array.isArray(fila) ? fila : [];
  const resumo = {
    total: itens.length,
    pendentes: 0,
    enviados: 0,
    erro: 0
  };

  for (const item of itens) {
    const status = normalizarStatusSessao(item?.status);
    if (status === "pendente") resumo.pendentes += 1;
    else if (status === "enviado" || status === "enviada") resumo.enviados += 1;
    else if (status === "erro" || status === "falha") resumo.erro += 1;
  }

  return resumo;
}

function contarClientes({ usuarios = [], configsPorCliente = {}, destinosPorCliente = {}, integracoesPorCliente = {} } = {}) {
  const usuariosLista = Array.isArray(usuarios) ? usuarios : [];
  const workspaces = new Set([
    ...usuariosLista.map(usuario => String(usuario?.id || "").trim()).filter(Boolean),
    ...chavesObjeto(configsPorCliente),
    ...chavesObjeto(destinosPorCliente),
    ...chavesObjeto(integracoesPorCliente)
  ]);

  return {
    usuariosTotal: usuariosLista.length,
    usuariosAtivos: usuariosLista.filter(usuario => usuario?.ativo !== false).length,
    usuariosInativos: usuariosLista.filter(usuario => usuario?.ativo === false).length,
    workspacesConhecidos: workspaces.size
  };
}

function resumirTimers(timers = {}) {
  const resumo = {};
  let conhecidos = 0;
  let ativos = 0;

  for (const [nome, dados] of Object.entries(objetoSimples(timers))) {
    conhecidos += 1;
    const item = dados && typeof dados === "object" ? dados : { ativo: Boolean(dados) };
    const ativo = item.ativo !== false;
    if (ativo) ativos += 1;
    resumo[nome] = {
      ativo,
      intervaloMs: Number.isFinite(Number(item.intervaloMs)) ? Number(item.intervaloMs) : null
    };
  }

  return {
    conhecidos,
    ativos,
    itens: resumo
  };
}

function resumirEstruturas(estruturas = {}) {
  const resumo = {};
  for (const [nome, valor] of Object.entries(objetoSimples(estruturas))) {
    resumo[nome] = tamanhoEstrutura(valor);
  }
  return resumo;
}

function resolverFontes(fontes = {}) {
  if (typeof fontes !== "function") return objetoSimples(fontes);
  try {
    return objetoSimples(fontes());
  } catch (_) {
    return {};
  }
}

function criarInfraMemorySnapshot(fontesEntrada = {}, opcoes = {}) {
  const fontes = resolverFontes(fontesEntrada);
  return {
    versao: 1,
    coletadoEm: new Date(opcoes.agoraMs || Date.now()).toISOString(),
    memoria: criarMemoriaSnapshot(opcoes.memoria || process.memoryUsage()),
    cpu: criarCpuSnapshot(opcoes.cpu || process.cpuUsage(), opcoes.cpuDelta || null),
    whatsapp: {
      sessoes: contarSessoesWhatsapp({
        sessoes: fontes.sessoes,
        statusSessao: fontes.statusSessao,
        sessoesMeta: fontes.sessoesMeta
      }),
      sockets: contarSocketsWhatsapp(fontes.sessoes)
    },
    estruturas: resumirEstruturas(fontes.estruturas || fontes.caches || {}),
    fila: contarFila(fontes.fila),
    clientes: contarClientes({
      usuarios: fontes.usuarios,
      configsPorCliente: fontes.configsPorCliente,
      destinosPorCliente: fontes.destinosPorCliente,
      integracoesPorCliente: fontes.integracoesPorCliente
    }),
    timers: resumirTimers(fontes.timers || {})
  };
}

function intervaloConfiguradoMs(intervaloMs) {
  const configurado = Number(intervaloMs ?? process.env.INFRA_MEMORY_SNAPSHOT_INTERVAL_MS);
  if (Number.isFinite(configurado) && configurado > 0) return Math.max(60 * 1000, Math.round(configurado));
  return INTERVALO_INFRA_MEMORY_SNAPSHOT_MS;
}

function infraMemoryTelemetryHabilitada() {
  return String(process.env.INFRA_MEMORY_SNAPSHOT_ENABLED || "true").toLowerCase() !== "false";
}

function iniciarInfraMemoryTelemetry(opcoes = {}) {
  if (!infraMemoryTelemetryHabilitada()) return { ok: true, iniciado: false, motivo: "desabilitado" };
  if (timerInfraMemorySnapshot) return { ok: true, iniciado: false, motivo: "ja_iniciado" };

  const intervaloMs = intervaloConfiguradoMs(opcoes.intervaloMs);
  const logger = typeof opcoes.logger === "function" ? opcoes.logger : console.log;
  const setIntervalFn = typeof opcoes.setIntervalFn === "function" ? opcoes.setIntervalFn : setInterval;
  const fontes = opcoes.fontes || {};
  let cpuAnterior = process.cpuUsage();

  const emitir = () => {
    const cpuAtual = process.cpuUsage();
    const cpuDelta = process.cpuUsage(cpuAnterior);
    cpuAnterior = cpuAtual;
    const snapshot = criarInfraMemorySnapshot(fontes, { cpu: cpuAtual, cpuDelta });
    logger(TAG_INFRA_MEMORY_SNAPSHOT, JSON.stringify(snapshot));
  };

  timerInfraMemorySnapshot = setIntervalFn(emitir, intervaloMs);
  if (typeof timerInfraMemorySnapshot?.unref === "function") timerInfraMemorySnapshot.unref();

  return { ok: true, iniciado: true, intervaloMs };
}

function pararInfraMemoryTelemetry(clearIntervalFn = clearInterval) {
  if (!timerInfraMemorySnapshot) return false;
  clearIntervalFn(timerInfraMemorySnapshot);
  timerInfraMemorySnapshot = null;
  return true;
}

module.exports = {
  TAG_INFRA_MEMORY_SNAPSHOT,
  INTERVALO_INFRA_MEMORY_SNAPSHOT_MS,
  EVENTOS_SOCKET_WHATSAPP,
  criarMemoriaSnapshot,
  criarCpuSnapshot,
  classificarStatusSessao,
  contarSessoesWhatsapp,
  contarSocketsWhatsapp,
  contarFila,
  contarClientes,
  resumirTimers,
  resumirEstruturas,
  criarInfraMemorySnapshot,
  intervaloConfiguradoMs,
  iniciarInfraMemoryTelemetry,
  pararInfraMemoryTelemetry
};
