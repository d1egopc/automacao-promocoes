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
const MAGALU_OPPORTUNITY_CAPABILITY = "magalu_opportunity_v1";
const MAGALU_OPPORTUNITY_TASK_TYPE = "oportunidade_oficial";
const ML_CAPABILITY = "ml_image_v1";
const ML_TASK_TYPE = "imagem_oficial";
const ML_RESULT_TTL_MS = 10 * 60 * 1000;
const MAGALU_OPPORTUNITY_PRODUCT_ID = "ofertasdodiamundo";
const MAGALU_OPPORTUNITY_URL = "https://www.magazineluiza.com.br/selecao/ofertasdodiamundo/";
const MAGALU_OPPORTUNITY_TTL_MS = 10 * 60 * 1000;

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

function hostMercadoLivreValido(valor = "") {
  try {
    const host = new URL(texto(valor)).hostname.toLowerCase().replace(/\.$/, "");
    return host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br") || host === "mercadolibre.com" || host.endsWith(".mercadolibre.com");
  } catch (_) { return false; }
}

function urlMlstaticValida(valor = "") {
  try {
    const url = new URL(texto(valor));
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return url.protocol === "https:" && (host === "mlstatic.com" || host.endsWith(".mlstatic.com")) && url.pathname !== "/";
  } catch (_) { return false; }
}

function urlMercadoLivreProdutoValida(valor = "", productId = "") {
  try {
    const url = new URL(texto(valor));
    if (url.protocol !== "https:" || !hostMercadoLivreValido(url.toString())) return false;
    const esperado = texto(productId).toUpperCase();
    const observado = url.pathname.match(/(?:^|[^A-Z0-9])MLB-?(\d+)(?:[^0-9]|$)/i)?.[1];
    return Boolean(esperado && observado && `MLB${observado}`.toUpperCase() === esperado);
  } catch (_) { return false; }
}

function urlOportunidadeMagaluValida(valor = "") {
  try {
    const url = new URL(texto(valor));
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && url.hostname.toLowerCase() === "www.magazineluiza.com.br"
      && url.pathname.replace(/\/+$/, "/") === "/selecao/ofertasdodiamundo/";
  } catch {
    return false;
  }
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
  const agora = typeof opcoes.agora === "function" ? opcoes.agora : () => new Date();
  const onOpportunityResult = typeof opcoes.onOpportunityResult === "function" ? opcoes.onOpportunityResult : null;

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
    if (texto(capability) && !capacidadesValidas(worker.capabilities).includes(capability)) throw erro("capability_nao_autorizada", 403);
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

  function validarResultadoOportunidade({ task, capability, accessible, indicatorFound, finalUrl, checkedAt } = {}) {
    if (!task) throw erro("task_inexistente", 404);
    if (task.marketplace !== "magalu" || task.type !== MAGALU_OPPORTUNITY_TASK_TYPE || task.productId !== MAGALU_OPPORTUNITY_PRODUCT_ID) throw erro("task_oportunidade_invalida");
    if (task.capability !== MAGALU_OPPORTUNITY_CAPABILITY || texto(capability) !== MAGALU_OPPORTUNITY_CAPABILITY) throw erro("capability_invalida");
    if (accessible !== true || typeof indicatorFound !== "boolean") throw erro("resultado_oportunidade_invalido");
    if (!urlOportunidadeMagaluValida(finalUrl) || texto(task.sourceUrl) !== MAGALU_OPPORTUNITY_URL) throw erro("url_oportunidade_invalida");
    const instante = new Date(checkedAt);
    const agoraMs = agora().getTime();
    if (!Number.isFinite(instante.getTime()) || instante.getTime() > agoraMs + 30_000 || agoraMs - instante.getTime() >= MAGALU_OPPORTUNITY_TTL_MS) throw erro("resultado_oportunidade_stale");
    return {
      accessible: true,
      indicatorFound,
      finalUrl: new URL(finalUrl).toString(),
      checkedAt: instante.toISOString(),
      source: "local_first_party"
    };
  }

  function validarResultadoMercadoLivre({ task, capability, marketplace, productId, imagemOficialUrl, provaTecnica, finalUrl, checkedAt } = {}) {
    if (!task) throw erro("task_inexistente", 404);
    if (task.marketplace !== "mercadolivre" || texto(marketplace).toLowerCase() !== "mercadolivre") throw erro("marketplace_invalido");
    if (task.type !== ML_TASK_TYPE || task.capability !== ML_CAPABILITY || texto(capability) !== ML_CAPABILITY) throw erro("capability_invalida");
    if (!/^MLB\d+$/i.test(texto(task.productId)) || texto(productId).toUpperCase() !== texto(task.productId).toUpperCase()) throw erro("product_id_divergente");
    const prova = provaTecnica && typeof provaTecnica === "object" ? provaTecnica : {};
    if (texto(prova.provenance) !== "local_worker.ml_image_v1" || texto(prova.source) !== "local_first_party") throw erro("prova_origem_invalida");
    if (texto(prova.productIdObserved).toUpperCase() !== texto(task.productId).toUpperCase() || prova.sameProductObject !== true) throw erro("prova_produto_nao_confirmada");
    let final;
    try { final = new URL(texto(finalUrl || prova.finalUrl)); } catch (_) { throw erro("prova_final_url_invalida"); }
    if (!urlMercadoLivreProdutoValida(final.toString(), task.productId)) throw erro("prova_final_url_invalida");
    const instante = new Date(checkedAt || prova.checkedAt);
    const agoraMs = agora().getTime();
    if (!Number.isFinite(instante.getTime()) || instante.getTime() > agoraMs + 30_000 || agoraMs - instante.getTime() >= ML_RESULT_TTL_MS) throw erro("resultado_ml_stale");
    const urlImagem = texto(imagemOficialUrl);
    if (!urlMlstaticValida(urlImagem)) throw erro("imagem_host_invalido");
    return { productId: texto(task.productId).toUpperCase(), imageUrl: urlImagem, finalUrl: final.toString(), checkedAt: instante.toISOString(), prova };
  }

  async function validarImagemMercadoLivreHttp(url = "") {
    if (typeof fetchFn !== "function") throw erro("ml_imagem_fetch_indisponivel");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), imageTimeoutMs);
    let response = null;
    try {
      response = await fetchFn(url, { redirect: "follow", signal: controller.signal });
      const finalUrl = new URL(response.url || url);
      const contentType = texto(response.headers?.get?.("content-type") || "").toLowerCase().split(";", 1)[0];
      if (!response.ok || !urlMlstaticValida(finalUrl.toString()) || !contentType.startsWith("image/")) throw erro("ml_imagem_http_nao_confirmada");
      return { urlFinal: finalUrl.toString(), statusHttp: response.status, contentType };
    } finally {
      clearTimeout(timer);
      try { await response?.body?.cancel?.(); } catch (_) {}
    }
  }

  async function resultado({ worker, taskId, leaseToken, marketplace, productId, imagemOficialUrl, provaTecnica, capability, accessible, indicatorFound, finalUrl, checkedAt } = {}) {
    validarWorker(worker, "");
    const task = await repo.obterTask(taskId);
    if (!task) throw erro("task_inexistente", 404);
    validarWorker(worker, task.capability);
    if (task.capability === MAGALU_OPPORTUNITY_CAPABILITY) {
      const metadata = validarResultadoOportunidade({ task, capability, accessible, indicatorFound, finalUrl, checkedAt });
      const conclusao = await repo.completarTecnica({ taskId, workerId: worker.workerId, leaseToken, metadata });
      if (conclusao?.ok && onOpportunityResult) onOpportunityResult(metadata);
      return conclusao;
    }
    if (task.capability === ML_CAPABILITY) {
      const validado = validarResultadoMercadoLivre({ task, capability, marketplace, productId, imagemOficialUrl, provaTecnica, finalUrl, checkedAt });
      const http = await validarImagemMercadoLivreHttp(validado.imageUrl);
      return repo.completar({
        taskId,
        workerId: worker.workerId,
        leaseToken,
        imageUrl: http.urlFinal,
        proof: {
          ...validado.prova,
          capability: ML_CAPABILITY,
          provenance: "local_worker.ml_image_v1",
          productId: validado.productId,
          productIdObserved: validado.productId,
          sameProductObject: true,
          finalUrl: validado.finalUrl,
          checkedAt: validado.checkedAt,
          imagemOficialUrl: http.urlFinal,
          statusHttp: http.statusHttp,
          contentType: http.contentType,
          hostFinal: new URL(http.urlFinal).hostname
        },
        metadata: { origem: "local_first_party", capability: ML_CAPABILITY, statusHttp: http.statusHttp, contentType: http.contentType, finalUrl: validado.finalUrl, checkedAt: validado.checkedAt }
      });
    }
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
    validarWorker(worker, "");
    const task = await repo.obterTask(taskId);
    if (!task) throw erro("task_inexistente", 404);
    validarWorker(worker, task.capability);
    const meta = task.capability === MAGALU_OPPORTUNITY_CAPABILITY
      ? {
          accessible: false,
          finalUrl: urlOportunidadeMagaluValida(metadata?.finalUrl) ? new URL(metadata.finalUrl).toString() : "",
          checkedAt: Number.isFinite(new Date(metadata?.checkedAt).getTime()) ? new Date(metadata.checkedAt).toISOString() : agora().toISOString()
        }
      : metadata;
    return repo.falhar({ taskId, workerId: worker.workerId, leaseToken, motivo: texto(motivo) || "worker_falhou", metadata: meta });
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

  async function garantirImagemMercadoLivre({ productId, sourceUrl = "" } = {}) {
    const pid = texto(productId).toUpperCase();
    if (!/^MLB\d+$/.test(pid) || !urlMercadoLivreProdutoValida(sourceUrl, pid)) return { ok: false, motivo: "task_ml_invalida" };
    return repo.garantirTask({
      type: ML_TASK_TYPE,
      marketplace: "mercadolivre",
      productId: pid,
      sourceUrl,
      capability: ML_CAPABILITY,
      idempotencyKey: `mercadolivre:${pid}:${ML_TASK_TYPE}`,
      maxAttempts: 3,
      ttlMs: 15 * 60 * 1000,
      reutilizarCompleted: false
    });
  }

  async function obterTaskImagemMagalu({ productId } = {}) {
    const task = await repo.obterTaskAtiva({ marketplace: "magalu", productId, type: MAGALU_TASK_TYPE });
    return task ? { ok: true, task } : { ok: true, task: null };
  }

  async function obterImagemCache({ marketplace, productId } = {}) {
    return repo.obterCache({ marketplace, productId });
  }

  async function obterOportunidadeMagaluRecente() {
    if (typeof repo.obterUltimaTask !== "function") return { ok: true, resultado: null, task: null };
    const task = await repo.obterUltimaTask({
      marketplace: "magalu",
      productId: MAGALU_OPPORTUNITY_PRODUCT_ID,
      type: MAGALU_OPPORTUNITY_TASK_TYPE,
      capability: MAGALU_OPPORTUNITY_CAPABILITY
    });
    if (!task || task.status !== "completed") return { ok: true, resultado: null, task };
    try {
      const metadata = validarResultadoOportunidade({ task, capability: task.capability, ...task.resultMetadata });
      return { ok: true, resultado: metadata, task };
    } catch (_) {
      return { ok: true, resultado: null, task };
    }
  }

  async function garantirOportunidadeMagalu() {
    const ultima = typeof repo.obterUltimaTask === "function"
      ? await repo.obterUltimaTask({ marketplace: "magalu", productId: MAGALU_OPPORTUNITY_PRODUCT_ID, type: MAGALU_OPPORTUNITY_TASK_TYPE, capability: MAGALU_OPPORTUNITY_CAPABILITY })
      : null;
    if (ultima && ["pending", "leased"].includes(ultima.status)) return { ok: true, criada: false, task: ultima };
    const referenciaMs = Date.parse(ultima?.updatedAt || ultima?.completedAt || "");
    if (ultima && ["failed", "expired"].includes(ultima.status) && Number.isFinite(referenciaMs) && agora().getTime() - referenciaMs < MAGALU_OPPORTUNITY_TTL_MS) {
      return { ok: true, criada: false, task: ultima, backoff: true };
    }
    return repo.garantirTask({
      type: MAGALU_OPPORTUNITY_TASK_TYPE,
      marketplace: "magalu",
      productId: MAGALU_OPPORTUNITY_PRODUCT_ID,
      sourceUrl: MAGALU_OPPORTUNITY_URL,
      capability: MAGALU_OPPORTUNITY_CAPABILITY,
      idempotencyKey: `magalu:${MAGALU_OPPORTUNITY_PRODUCT_ID}:${MAGALU_OPPORTUNITY_TASK_TYPE}`,
      maxAttempts: 1,
      ttlMs: MAGALU_OPPORTUNITY_TTL_MS,
      reutilizarCompleted: false
    });
  }

  async function status() { return repo.status(); }

  return { ensureSchema, registrarWorker, autenticar, claim, heartbeat, resultado, falha, revogar, garantirImagemMagalu, garantirImagemMercadoLivre, obterTaskImagemMagalu, obterImagemCache, garantirOportunidadeMagalu, obterOportunidadeMagaluRecente, status, MAGALU_CAPABILITY, MAGALU_TASK_TYPE, MAGALU_OPPORTUNITY_CAPABILITY, MAGALU_OPPORTUNITY_TASK_TYPE, ML_CAPABILITY, ML_TASK_TYPE };
}

module.exports = { criarLocalWorkerService, MAGALU_CAPABILITY, MAGALU_TASK_TYPE, MAGALU_OPPORTUNITY_CAPABILITY, MAGALU_OPPORTUNITY_TASK_TYPE, MAGALU_OPPORTUNITY_PRODUCT_ID, MAGALU_OPPORTUNITY_URL, MAGALU_OPPORTUNITY_TTL_MS, ML_CAPABILITY, ML_TASK_TYPE, urlOportunidadeMagaluValida };
