"use strict";

const {
  criarLocalWorkerRepository
} = require("./local-worker.repository");
const {
  normalizarImagemMlcdn,
  hostnameMlcdnSeguro,
  validarImagemOficialHttp
} = require("../marketplaces/magalu/magalu-image-resolver");

const MAGALU_CAPABILITY = "magalu_image_v1";
const MAGALU_TASK_TYPE = "imagem_oficial";

function texto(valor = "") { return String(valor ?? "").trim(); }

function capacidadesValidas(valor) {
  return (Array.isArray(valor) ? valor : []).map(texto).filter(Boolean);
}

function listaIdsAutorizados(valor) {
  const origem = Array.isArray(valor) ? valor : texto(valor).split(",");
  return origem.map(texto).filter(Boolean);
}

function slugTecnicoMagalu(valor) {
  const slug = texto(valor).toLowerCase();
  return /^[a-z0-9-]{2,80}$/.test(slug) ? slug : "";
}

function hostnameMlcdnValido(valor = "") {
  const host = texto(valor).toLowerCase().replace(/\.$/, "");
  return host === "mlcdn.com.br" || host.endsWith(".mlcdn.com.br");
}

function erro(motivo, statusCode = 400, detalhe = "") {
  const e = new Error(motivo);
  e.codigo = motivo;
  e.statusCode = statusCode;
  if (detalhe) e.detalhe = detalhe;
  return e;
}

function criarLocalWorkerService(opcoes = {}) {
  const repo = opcoes.repository || criarLocalWorkerRepository({ pool: opcoes.pool, getPool: opcoes.getPool });
  const fetchFn = opcoes.fetchFn || globalThis.fetch;
  const imageTimeoutMs = Number(opcoes.imageTimeoutMs || 3500);
  const dedicatedOwnerIds = listaIdsAutorizados(opcoes.dedicatedOwnerIds || process.env.LOCAL_WORKER_DEDICATED_OWNER_IDS || "");
  const tokenTtlMs = Math.max(60_000, Number(opcoes.tokenTtlMs || process.env.LOCAL_WORKER_TOKEN_TTL_MS || 30 * 24 * 60 * 60 * 1000));
  const technicalSlug = slugTecnicoMagalu(opcoes.magaluTechnicalSlug || process.env.LOCAL_WORKER_MAGALU_TECHNICAL_SLUG || "");

  async function ensureSchema() {
    try {
      return await repo.ensureSchema({ tokenTtlMs, dedicatedOwnerIds });
    } catch (erroSchema) {
      return { ok: false, motivo: "schema_local_worker_falhou", erro: texto(erroSchema?.message).slice(0, 180) };
    }
  }

  async function registrarWorker({ ownerId = "", workerId = "", capabilities = [MAGALU_CAPABILITY] } = {}) {
    const id = texto(ownerId);
    const autorizado = Boolean(id && dedicatedOwnerIds.includes(id));
    const caps = autorizado ? capacidadesValidas(capabilities) : [];
    if (autorizado && !caps.includes(MAGALU_CAPABILITY)) caps.push(MAGALU_CAPABILITY);
    const registrar = autorizado ? repo.registrarWorkerDedicated : repo.registrarWorkerCommunity;
    if (typeof registrar !== "function") return { ok: false, motivo: "registro_worker_indisponivel" };
    return registrar({ ownerId: id, workerId: texto(workerId), capabilities: caps, tokenTtlMs });
  }

  async function autenticar(token) { return repo.autenticarWorker(token); }

  function validarWorker(worker, capability = MAGALU_CAPABILITY) {
    if (!worker?.ok || worker.workerType !== "dedicated") throw erro("worker_nao_autorizado", 403);
    if (!dedicatedOwnerIds.includes(texto(worker.ownerId))) throw erro("worker_dedicated_nao_autorizado", 403);
    if (!capacidadesValidas(worker.capabilities).includes(capability)) throw erro("capability_nao_autorizada", 403);
  }

  async function claim({ worker, capabilities = [] } = {}) {
    validarWorker(worker);
    const caps = capacidadesValidas(capabilities);
    const permitidas = caps.length ? caps.filter(cap => capacidadesValidas(worker.capabilities).includes(cap)) : capacidadesValidas(worker.capabilities);
    return repo.claim({ workerId: worker.workerId, capabilities: permitidas });
  }

  async function heartbeat({ worker, taskId, leaseToken } = {}) {
    validarWorker(worker);
    return repo.heartbeat({ taskId, workerId: worker.workerId, leaseToken });
  }

  function validarResultadoPublico({ task, marketplace, productId, imagemOficialUrl, provaTecnica } = {}) {
    if (!task) throw erro("task_inexistente", 404);
    if (task.marketplace !== "magalu" || texto(marketplace).toLowerCase() !== "magalu") throw erro("marketplace_invalido");
    if (texto(productId) !== texto(task.productId)) throw erro("product_id_divergente");
    const url = normalizarImagemMlcdn(imagemOficialUrl);
    if (!url || !hostnameMlcdnSeguro(url)) throw erro("imagem_host_invalido");
    const prova = provaTecnica && typeof provaTecnica === "object" ? provaTecnica : {};
    // O nível de confiança já foi derivado do registro autenticado em validarWorker().
    // Campos enviados pelo worker não participam desta decisão.
    if (texto(prova.productId) !== texto(task.productId)) throw erro("prova_product_id_divergente");
    if (prova.skuConfirmado !== true || prova.hrefConfirmado !== true) throw erro("prova_produto_nao_confirmada");
    if (texto(prova.origem || prova.source) !== "local_first_party") throw erro("prova_origem_invalida");
    if (!texto(prova.hrefProduto)) throw erro("prova_href_produto_ausente");
    if (texto(prova.hrefProduto)) {
      try {
        const href = new URL(prova.hrefProduto);
        const idHref = href.pathname.match(/\/p\/([^/]+)/i)?.[1] || "";
        if (href.protocol !== "https:" || href.hostname.toLowerCase() !== "www.magazinevoce.com.br" || idHref.toLowerCase() !== texto(task.productId).toLowerCase()) throw erro("prova_href_produto_invalido");
      } catch (e) {
        if (e?.codigo === "prova_href_produto_invalido") throw e;
        throw erro("prova_href_produto_invalido");
      }
    }
    if (texto(prova.hostFinal) && !hostnameMlcdnValido(prova.hostFinal)) throw erro("prova_host_invalido");
    return { url, prova };
  }

  async function resultado({ worker, taskId, leaseToken, marketplace, productId, imagemOficialUrl, provaTecnica } = {}) {
    validarWorker(worker);
    const task = await repo.obterTask(taskId);
    const validado = validarResultadoPublico({ task, marketplace, productId, imagemOficialUrl, provaTecnica });
    const http = await validarImagemOficialHttp(validado.url, { fetchFn, timeoutMs: imageTimeoutMs });
    if (!http.ok) {
      await repo.falhar({ taskId, workerId: worker.workerId, leaseToken, motivo: http.motivoFinal, metadata: { statusHttp: http.statusHttp, contentType: http.contentType } });
      throw erro("imagem_http_nao_confirmada", 422, http.motivoFinal);
    }
    return repo.completar({
      taskId,
      workerId: worker.workerId,
      leaseToken,
      imageUrl: http.urlFinal || validado.url,
      proof: {
        ...validado.prova,
        productId: task.productId,
        imagemOficialUrl: http.urlFinal || validado.url,
        statusHttp: http.statusHttp,
        contentType: http.contentType,
        hostFinal: new URL(http.urlFinal || validado.url).hostname,
        validadoEm: new Date().toISOString()
      },
      metadata: { origem: "local_first_party", statusHttp: http.statusHttp, contentType: http.contentType }
    });
  }

  async function falha({ worker, taskId, leaseToken, motivo, metadata } = {}) {
    validarWorker(worker);
    return repo.falhar({ taskId, workerId: worker.workerId, leaseToken, motivo: texto(motivo) || "worker_falhou", metadata });
  }

  async function revogar({ worker } = {}) {
    const workerId = texto(worker?.workerId);
    if (!workerId || typeof repo.revogarWorker !== "function") return { ok: false, motivo: "worker_nao_encontrado" };
    return repo.revogarWorker({ workerId, ownerId: texto(worker?.ownerId) });
  }

  async function garantirImagemMagalu({ productId, sourceUrl = "" } = {}) {
    if (!technicalSlug) return { ok: false, motivo: "slug_tecnico_magalu_ausente" };
    return repo.garantirTask({
      type: MAGALU_TASK_TYPE,
      marketplace: "magalu",
      productId,
      sourceUrl,
      technicalSlug,
      capability: MAGALU_CAPABILITY,
      idempotencyKey: `magalu:${texto(productId)}:${MAGALU_TASK_TYPE}`,
      maxAttempts: 3,
      ttlMs: 15 * 60 * 1000
    });
  }

  async function obterTaskImagemMagalu({ productId } = {}) {
    const task = await repo.obterTaskAtiva({ marketplace: "magalu", productId, type: MAGALU_TASK_TYPE });
    return task ? { ok: true, task } : { ok: true, task: null };
  }

  async function obterImagemCache({ marketplace, productId } = {}) {
    return repo.obterCache({ marketplace, productId });
  }

  async function status() { return repo.status(); }

  return { ensureSchema, registrarWorker, autenticar, claim, heartbeat, resultado, falha, revogar, garantirImagemMagalu, obterTaskImagemMagalu, obterImagemCache, status, MAGALU_CAPABILITY, MAGALU_TASK_TYPE };
}

module.exports = { criarLocalWorkerService, MAGALU_CAPABILITY, MAGALU_TASK_TYPE };
