"use strict";

const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const { monitorEventLoopDelay, performance } = require("perf_hooks");
const ativo = process.env.PERF_PAINEL_LATENCIA !== "0";

const contexto = new AsyncLocalStorage();
const inicioProcesso = process.hrtime.bigint();
const histograma = monitorEventLoopDelay({ resolution: 20 });
let eluAnterior = performance.eventLoopUtilization();
let cpuAnterior = process.cpuUsage();
let amostragemIniciada = false;
let requestSeq = 0;
let engine = { rodadaId: "", etapa: "inativo" };
let lagJanelaMaxMs = 0;
const saltWorkspace = crypto.randomBytes(16);

function ms(inicio) {
  return Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
}

function rotaSegura(req) {
  const path = req.path || "";
  const metodo = req.method || "";
  if (path === "/fila" || path === "/fila/status" || path === "/destinos" ||
      path === "/sessoes" || path === "/automacao" || path === "/automacao/status" ||
      path === "/integracoes" || path === "/integracoes/alertas" ||
      path === "/telegram" || path === "/discord/conexoes" ||
      path === "/mensageiro" || path === "/vitrine" ||
      path === "/radar/config" || path === "/manual-v2/ofertas" ||
      path === "/manual-v2/config" || path === "/manual-v2/listas" ||
      path === "/manual-v2/achados") return `${metodo} ${path}`;
  if (metodo === "POST" && /^\/integracoes\/[^/]+$/.test(path)) return "POST /integracoes/:marketplace";
  if (metodo === "GET" && /^\/grupos\/[^/]+$/.test(path)) return "GET /grupos/:id";
  return "";
}

function iniciar(req) {
  if (!ativo) return;
  const rota = rotaSegura(req);
  if (!rota) return;
  req.painelLatencia = {
    rota,
    inicio: process.hrtime.bigint(),
    requestId: `painel_${Date.now()}_${++requestSeq}`
  };
}

function marcarEntradaHandler(req) {
  if (req.painelLatencia && !req.painelLatencia.handlerInicio) {
    req.painelLatencia.handlerInicio = process.hrtime.bigint();
  }
}

function classeArquivo(file) {
  const nome = String(file || "").replace(/\\/g, "/").split("/").pop();
  return /^(fila|destinos|destinos_clientes|integracoes|manual_ofertas_v2|manual_config_v2|manual_listas_v2|manual_achados_v2|radar-config)\.json$/.test(nome)
    ? nome : "outro_json";
}

function registrar(tipo, nome, duracaoMs, bytes = 0) {
  try {
    const atual = contexto.getStore();
    if (!atual || atual.finalizado) return;
    const chave = `${tipo}:${nome}`;
    if (!atual.etapas[chave] && Object.keys(atual.etapas).length >= 24) return;
    const etapa = atual.etapas[chave] || { n: 0, totalMs: 0, bytes: 0, maxMs: 0 };
    const duracao = Math.max(0, Math.round((Number(duracaoMs) || 0) * 100) / 100);
    etapa.n += 1;
    etapa.totalMs = Math.round((etapa.totalMs + duracao) * 100) / 100;
    etapa.maxMs = Math.max(etapa.maxMs, duracao);
    etapa.bytes += Math.max(0, Number(bytes) || 0);
    atual.etapas[chave] = etapa;
  } catch {
    // Diagnóstico não pode alterar o resultado de leitura/escrita/SQL.
  }
}

function registrarArquivo(operacao, file, duracaoMs, bytes) {
  if (!contexto.getStore()) return;
  registrar("arquivo", `${operacao}:${classeArquivo(file)}`, duracaoMs, bytes);
}

function registrarDb(poolMs, sqlMs) {
  if (!contexto.getStore()) return;
  if (poolMs !== null && poolMs !== undefined) registrar("db", "pool_wait", poolMs);
  if (sqlMs !== null && sqlMs !== undefined) registrar("db", "sql", sqlMs);
}

function registrarEtapa(nome, duracaoMs) {
  if (!contexto.getStore()) return;
  registrar("handler", String(nome).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 48), duracaoMs);
}

function alterarEtapaEngine(rodadaId, etapa) {
  engine = { rodadaId: String(rodadaId || "").slice(0, 48), etapa: String(etapa || "inativo").slice(0, 48) };
}

function anexar(req, res, next, obterClienteId) {
  const marca = req.painelLatencia;
  if (!marca) return next();
  const iniciado = process.hrtime.bigint();
  const ateContextoMs = Math.round(Number(iniciado - marca.inicio) / 1e6);
  const atual = { etapas: Object.create(null), finalizado: false };
  const engineInicio = { ...engine };
  let finalizado = false;
  function concluir(encerramento) {
    if (finalizado) return;
    finalizado = true;
    atual.finalizado = true;
    try {
      const totalMs = ms(marca.inicio);
      const nivel = totalMs > 1000 ? "critico" : totalMs > 500 ? "lento" : "normal";
      let clienteId = "";
      try { clienteId = obterClienteId(req) || ""; } catch {}
      const resumo = {
        requestId: marca.requestId,
        workspaceHash: clienteId ? crypto.createHmac("sha256", saltWorkspace).update(String(clienteId)).digest("hex").slice(0, 12) : null,
        rota: marca.rota,
        status: res.statusCode,
        encerramento,
        nivel,
        backendMs: totalMs,
        ateContextoMs,
        aposContextoMs: Math.max(0, totalMs - ateContextoMs),
        ateHandlerMs: marca.handlerInicio ? Math.round(Number(marca.handlerInicio - marca.inicio) / 1e6) : null,
        etapas: nivel === "normal" ? undefined : atual.etapas,
        engineInicio,
        engineFim: { ...engine },
        lagJanelaMaxMs,
        rssMb: Math.round(process.memoryUsage().rss / 1048576)
      };
      console.log("[PERF PAINEL REQUEST]", JSON.stringify(resumo));
    } catch {
      // Uma falha no diagnóstico nunca derruba a resposta.
    }
  }
  res.once("finish", () => concluir("finish"));
  res.once("close", () => concluir("close"));
  return contexto.run(atual, next);
}

function iniciarAmostragem() {
  if (!ativo || amostragemIniciada) return;
  amostragemIniciada = true;
  histograma.enable();
  const timer = setInterval(() => {
    try {
      const elu = performance.eventLoopUtilization(eluAnterior);
      eluAnterior = performance.eventLoopUtilization();
      const cpu = process.cpuUsage(cpuAnterior);
      cpuAnterior = process.cpuUsage();
      lagJanelaMaxMs = Math.round(histograma.max / 1e6);
      console.log("[PERF PAINEL PROCESSO]", JSON.stringify({
        desdeInicioMs: ms(inicioProcesso),
        lagMaxMs: lagJanelaMaxMs,
        lagP95Ms: Math.round(histograma.percentile(95) / 1e6),
        elu: Math.round(elu.utilization * 1000) / 1000,
        cpuMs: Math.round((cpu.user + cpu.system) / 1000),
        rssMb: Math.round(process.memoryUsage().rss / 1048576),
        workerOfcOn: process.env.OFC_READONLY_WORKER === "true",
        engine: { ...engine }
      }));
      histograma.reset();
    } catch {
      // Amostragem best-effort; não afeta o ciclo comercial.
    }
  }, 15000);
  timer.unref();
}

module.exports = { iniciar, marcarEntradaHandler, anexar, registrarArquivo, registrarDb, registrarEtapa, alterarEtapaEngine, iniciarAmostragem };
