(function publicarLocalWorkerRunner(global) {
  "use strict";

  const INTERVAL_MINUTES = 0.5;
  const ALARM_NAME = "optimus-local-worker-poll";
  const STORAGE_KEYS = Object.freeze({
    STATE: "optimus_local_worker_task_state_v1",
    LEASE: "optimus_local_worker_task_lease_v1",
    BREADCRUMBS: "optimus_local_worker_breadcrumbs_v1"
  });
  const STAGES = Object.freeze({
    CLAIMED: "CLAIMED",
    RESOLVING_PAGE: "RESOLVING_PAGE",
    IDENTITY_IDENTIFIED: "IDENTITY_IDENTIFIED",
    IMAGE_IDENTIFIED: "IMAGE_IDENTIFIED",
    IMAGE_PROBED: "IMAGE_PROBED",
    RESULT_PENDING: "RESULT_PENDING",
    FAILURE_PENDING: "FAILURE_PENDING",
    COMPLETED: "COMPLETED"
  });
  const MAX_BREADCRUMBS = 20;
  const MAGALU_HOST = "www.magazinevoce.com.br";
  const MAGALU_OPPORTUNITY_CAPABILITY = "magalu_opportunity_v1";
  const ML_CAPABILITY = "ml_image_v1";
  const ML_IDENTITY_CAPABILITY = "ml_identity_v1";
  const LIVENESS = Object.freeze({
    maxNoProgressCount: 2,
    maxStageAgeMs: 75_000,
    stages: Object.freeze([
      STAGES.RESOLVING_PAGE,
      STAGES.IDENTITY_IDENTIFIED,
      STAGES.IMAGE_IDENTIFIED,
      STAGES.FAILURE_PENDING
    ])
  });
  let executando = false;
  let alarmeRegistrado = false;

  function texto(valor = "") { return String(valor ?? "").trim(); }
  function agora() { return new Date().toISOString(); }
  function timestampMs(valor) {
    const numero = Date.parse(texto(valor));
    return Number.isFinite(numero) ? numero : 0;
  }
  function emitir(nome, dados = {}) {
    try { console.info(`[${nome}]`, JSON.stringify(dados)); } catch (_) {}
  }
  function erroTexto(erro, fallback = "local_worker_falhou") {
    const bruto = texto(erro?.codigo || erro?.message || erro) || fallback;
    return bruto.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 160);
  }
  function storageLocal() { return global.chrome?.storage?.local || null; }
  function storageSession() { return global.chrome?.storage?.session || null; }
  function hrefTecnico(valor) {
    try {
      const url = new URL(texto(valor), `https://${MAGALU_HOST}`);
      return url.protocol === "https:" && url.hostname.toLowerCase() === MAGALU_HOST
        ? `${url.protocol}//${url.hostname}${url.pathname}`
        : "";
    } catch (_) { return ""; }
  }
  function hostTecnico(valor) {
    try { return new URL(texto(valor)).hostname.toLowerCase(); } catch (_) { return ""; }
  }
  async function lerChave(store, chave) {
    if (!store) return null;
    const dados = await store.get(chave);
    return dados?.[chave] || null;
  }
  async function salvarChave(store, chave, valor) {
    if (!store) throw new Error("storage_indisponivel");
    await store.set({ [chave]: valor });
    return valor;
  }
  async function removerChave(store, chave) {
    if (store) await store.remove(chave);
  }
  function tarefaPublica(task = {}) {
    return {
      id: texto(task.id),
      type: texto(task.type),
      marketplace: texto(task.marketplace),
      productId: texto(task.productId),
      sourceUrl: texto(task.sourceUrl),
      capability: texto(task.capability),
      technicalSlug: texto(task.technicalSlug),
      attempt: Number(task.attempt ?? task.attempts ?? 0)
    };
  }
  function provaPublica(prova = {}) {
    const resultado = {
      origem: texto(prova.origem),
      source: texto(prova.source),
      productId: texto(prova.productId),
      skuConfirmado: prova.skuConfirmado === true,
      hrefConfirmado: prova.hrefConfirmado === true,
      hrefProduto: hrefTecnico(prova.hrefProduto || prova.href),
      hostFinal: texto(prova.hostFinal),
      imagemOficialUrl: texto(prova.imagemOficialUrl),
    };
    // Campos adicionais só fazem parte da prova quando o resolver os produz.
    // Isso preserva o contrato/shape histórico das provas Magalu.
    if (prova.provenance !== undefined) resultado.provenance = texto(prova.provenance);
    if (prova.productIdObserved !== undefined) resultado.productIdObserved = texto(prova.productIdObserved);
    if (prova.sameProductObject !== undefined) resultado.sameProductObject = prova.sameProductObject === true;
    if (prova.finalUrl !== undefined) resultado.finalUrl = texto(prova.finalUrl);
    if (prova.checkedAt !== undefined) resultado.checkedAt = texto(prova.checkedAt);
    if (prova.origin !== undefined) resultado.origin = texto(prova.origin);
    if (prova.contentType !== undefined) resultado.contentType = texto(prova.contentType);
    if (prova.statusHttp !== undefined) resultado.statusHttp = Number(prova.statusHttp || 0) || undefined;
    if (prova.capability !== undefined) resultado.capability = texto(prova.capability);
    if (prova.contractVersion !== undefined) resultado.contractVersion = Number(prova.contractVersion || 0) || undefined;
    if (prova.expectedMlb !== undefined) resultado.expectedMlb = texto(prova.expectedMlb);
    if (prova.observedMlb !== undefined) resultado.observedMlb = texto(prova.observedMlb);
    if (prova.identidadeTipo !== undefined) resultado.identidadeTipo = texto(prova.identidadeTipo);
    if (prova.origemTitulo !== undefined) resultado.origemTitulo = texto(prova.origemTitulo);
    if (prova.origemImagem !== undefined) resultado.origemImagem = texto(prova.origemImagem);
    if (prova.canonicalUrl !== undefined) resultado.canonicalUrl = texto(prova.canonicalUrl);
    if (prova.variationId !== undefined) resultado.variationId = texto(prova.variationId);
    if (prova.collectedAt !== undefined) resultado.collectedAt = texto(prova.collectedAt);
    return resultado;
  }
  function resultadoOportunidadePublico(resultado = {}) {
    return {
      accessible: resultado.accessible === true,
      indicatorFound: resultado.indicatorFound === true,
      finalUrl: texto(resultado.finalUrl),
      checkedAt: texto(resultado.checkedAt)
    };
  }
  function estadoPublico(valor = {}) {
    const agoraIso = agora();
    const causaOriginal = erroTexto(valor.originalFailureReason || (texto(valor.stage) === STAGES.FAILURE_PENDING ? valor.lastTechnicalError : ""), "");
    return {
      version: 3,
      stage: texto(valor.stage),
      task: tarefaPublica(valor.task),
      imagemOficialUrl: texto(valor.imagemOficialUrl),
      tituloOficial: texto(valor.tituloOficial),
      identidadeValidada: valor.identidadeValidada === true,
      expectedMlb: texto(valor.expectedMlb),
      observedMlb: texto(valor.observedMlb),
      origemTitulo: texto(valor.origemTitulo),
      origemImagem: texto(valor.origemImagem),
      canonicalUrl: texto(valor.canonicalUrl),
      variationId: texto(valor.variationId),
      collectedAt: texto(valor.collectedAt),
      finalUrl: texto(valor.finalUrl),
      checkedAt: texto(valor.checkedAt),
      provaTecnica: valor.provaTecnica ? provaPublica(valor.provaTecnica) : null,
      resultadoOportunidade: valor.resultadoOportunidade ? resultadoOportunidadePublico(valor.resultadoOportunidade) : null,
      failureMetadata: valor.failureMetadata ? resultadoOportunidadePublico(valor.failureMetadata) : null,
      originalFailureReason: causaOriginal,
      reportingError: erroTexto(valor.reportingError, ""),
      lastTechnicalError: causaOriginal || erroTexto(valor.lastTechnicalError, ""),
      stageEnteredAt: texto(valor.stageEnteredAt) || agoraIso,
      lastProgressAt: texto(valor.lastProgressAt) || agoraIso,
      noProgressCount: Math.max(0, Number(valor.noProgressCount || 0)),
      updatedAt: agoraIso
    };
  }
  async function lerEstado() { return lerChave(storageLocal(), STORAGE_KEYS.STATE); }
  async function salvarEstado(valor) { return salvarChave(storageLocal(), STORAGE_KEYS.STATE, estadoPublico(valor)); }
  async function lerLease() { return lerChave(storageSession(), STORAGE_KEYS.LEASE); }
  async function salvarLease(task) {
    return salvarChave(storageSession(), STORAGE_KEYS.LEASE, { taskId: texto(task.id), leaseToken: texto(task.leaseToken) });
  }
  async function registrarBreadcrumb(stage, task, detalhes = {}) {
    const store = storageLocal();
    if (!store) return;
    const existentes = await lerChave(store, STORAGE_KEYS.BREADCRUMBS);
    const seguro = {
      at: agora(),
      stage: texto(stage),
      taskId: texto(task?.id),
      productId: texto(task?.productId),
      attempt: Number(task?.attempt ?? task?.attempts ?? 0),
      motivo: erroTexto(detalhes.motivo, "").slice(0, 120),
      status: Number(detalhes.status || 0) || undefined,
      skuConfirmado: detalhes.skuConfirmado === true || undefined,
      hrefConfirmado: detalhes.hrefConfirmado === true || undefined,
      hostImagem: texto(detalhes.hostImagem) || undefined,
      taskStage: texto(detalhes.taskStage) || undefined,
      noProgressCount: Number.isFinite(Number(detalhes.noProgressCount)) ? Math.max(0, Number(detalhes.noProgressCount)) : undefined,
      stageAgeMs: Number.isFinite(Number(detalhes.stageAgeMs)) ? Math.max(0, Number(detalhes.stageAgeMs)) : undefined,
      originalFailureReason: erroTexto(detalhes.originalFailureReason, "").slice(0, 120) || undefined,
      reportingError: erroTexto(detalhes.reportingError, "").slice(0, 120) || undefined
    };
    const lista = [...(Array.isArray(existentes) ? existentes : []), seguro].slice(-MAX_BREADCRUMBS);
    await salvarChave(store, STORAGE_KEYS.BREADCRUMBS, lista);
  }
  async function limparEstado(opcoes = {}) {
    await removerChave(storageLocal(), STORAGE_KEYS.STATE);
    await removerChave(storageSession(), STORAGE_KEYS.LEASE);
    if (opcoes.limparBreadcrumbs === true) await removerChave(storageLocal(), STORAGE_KEYS.BREADCRUMBS);
  }
  function erroAmbiguo(erro) {
    const codigo = erroTexto(erro, "").toLowerCase();
    const status = Number(erro?.status || 0);
    return erro?.name === "AbortError" || status === 429 || status >= 500 || /timeout|network|failed.?to.?fetch|load.?failed/.test(codigo);
  }
  function leaseInvalido(erro) {
    const codigo = erroTexto(erro, "").toLowerCase();
    return erro?.status === 409 || /lease_invalido|lease_expirado/.test(codigo);
  }
  function autenticacaoWorkerInvalida(erro) {
    const codigo = erroTexto(erro, "").toLowerCase();
    return erro?.status === 401 || /worker_nao_autenticado|token_worker_invalido/.test(codigo);
  }
  function taskCompleta(task) {
    if (!task || !texto(task.id) || !texto(task.type) || !texto(task.productId)) return false;
    const capability = texto(task.capability);
    if (texto(task.marketplace) === "mercadolivre" && capability === ML_CAPABILITY) {
      return texto(task.type) === "imagem_oficial" && Boolean(texto(task.sourceUrl)) && /^MLB\d+$/i.test(texto(task.productId));
    }
    if (texto(task.marketplace) === "mercadolivre" && capability === ML_IDENTITY_CAPABILITY) {
      return texto(task.type) === "identidade_oficial" && Boolean(texto(task.sourceUrl)) && /^MLB\d+$/i.test(texto(task.productId));
    }
    if (texto(task.marketplace) !== "magalu") return false;
    if (capability === MAGALU_OPPORTUNITY_CAPABILITY) {
      return texto(task.type) === "oportunidade_oficial" && texto(task.sourceUrl) === global.OptimusMagaluOpportunityResolver?.URL_OFICIAL;
    }
    return capability === global.OptimusLocalWorkerClient?.CAPABILITY && Boolean(texto(task.technicalSlug));
  }
  function taskComLease(estado, lease) {
    if (!estado?.task || !lease || texto(estado.task.id) !== texto(lease.taskId) || !texto(lease.leaseToken)) return null;
    return { ...estado.task, leaseToken: texto(lease.leaseToken) };
  }
  function taskParaResultado(estado, lease) {
    if (!estado?.task) return null;
    const leaseToken = lease && texto(estado.task.id) === texto(lease.taskId) ? texto(lease.leaseToken) : "";
    return { ...estado.task, leaseToken };
  }
  function livenessAplicavel(stage) {
    return LIVENESS.stages.includes(texto(stage));
  }
  function resumoLiveness(estado = {}, agoraMs = Date.now()) {
    const inicio = timestampMs(estado.stageEnteredAt) || timestampMs(estado.lastProgressAt) || agoraMs;
    return {
      noProgressCount: Math.max(0, Number(estado.noProgressCount || 0)),
      stageAgeMs: Math.max(0, agoraMs - inicio)
    };
  }
  function livenessEsgotado(estado = {}, agoraMs = Date.now()) {
    if (!livenessAplicavel(estado.stage)) return false;
    const resumo = resumoLiveness(estado, agoraMs);
    return resumo.noProgressCount >= LIVENESS.maxNoProgressCount || resumo.stageAgeMs >= LIVENESS.maxStageAgeMs;
  }
  async function relinquishSeEsgotado(estado, task) {
    if (!livenessEsgotado(estado)) return false;
    const resumo = resumoLiveness(estado);
    await registrarBreadcrumb("LIVENESS_EXHAUSTED", task, {
      motivo: "liveness_exhausted",
      taskStage: estado.stage,
      originalFailureReason: estado.originalFailureReason,
      reportingError: estado.reportingError,
      ...resumo
    });
    await limparEstado();
    return true;
  }
  async function registrarSemProgresso(estado, task) {
    const atual = estado || {};
    const proximo = await salvarEstado({
      ...atual,
      task: atual.task || task,
      noProgressCount: Math.max(0, Number(atual.noProgressCount || 0)) + 1
    });
    return proximo;
  }
  async function validarLease(task, estado) {
    if (await relinquishSeEsgotado(estado, task)) return false;
    try {
      await registrarBreadcrumb("HEARTBEAT_START", task, { taskStage: estado?.stage });
      const resposta = await global.OptimusLocalWorkerClient.heartbeat(task.id, task.leaseToken);
      if (!resposta || resposta.ok === false) throw new Error(texto(resposta?.motivo) || "lease_invalido");
      await registrarBreadcrumb("HEARTBEAT_OK", task, { taskStage: estado?.stage });
      return true;
    } catch (erro) {
      if (leaseInvalido(erro)) {
        await registrarBreadcrumb("LEASE_INVALID", task, { motivo: "lease_invalido", status: erro?.status, taskStage: estado?.stage });
        await limparEstado();
        return false;
      }
      await registrarBreadcrumb("HEARTBEAT_ERROR", task, { motivo: erroTexto(erro), status: erro?.status, taskStage: estado?.stage });
      if (erroAmbiguo(erro)) {
        await registrarSemProgresso(estado, task);
        return false;
      }
      throw erro;
    }
  }
  async function marcarStage(estado, stage, extras = {}, opcoes = {}) {
    const mudou = texto(estado?.stage) !== texto(stage);
    const progressoEm = agora();
    const proximo = await salvarEstado({
      ...estado,
      ...extras,
      stage,
      stageEnteredAt: mudou ? progressoEm : estado?.stageEnteredAt,
      lastProgressAt: mudou ? progressoEm : estado?.lastProgressAt,
      noProgressCount: mudou ? 0 : estado?.noProgressCount
    });
    if (mudou || opcoes.registrarMesmoStage === true) {
      await registrarBreadcrumb(stage, proximo.task, {
        motivo: opcoes.motivo,
        skuConfirmado: proximo.provaTecnica?.skuConfirmado,
        hrefConfirmado: proximo.provaTecnica?.hrefConfirmado,
        hostImagem: proximo.provaTecnica?.hostFinal,
        taskStage: stage,
        noProgressCount: proximo.noProgressCount,
        originalFailureReason: proximo.originalFailureReason,
        reportingError: proximo.reportingError
      });
    }
    return proximo;
  }
  async function enviarFailure(estado, task) {
    if (!await validarLease(task, estado)) return null;
    const originalFailureReason = erroTexto(estado.originalFailureReason || estado.lastTechnicalError);
    emitir("LOCAL-WORKER-FAILURE", { taskId: texto(task.id), productId: texto(task.productId), motivo: originalFailureReason });
    await registrarBreadcrumb("FAILURE_SEND", task, { motivo: originalFailureReason, originalFailureReason, reportingError: estado.reportingError, taskStage: estado.stage });
    try {
      const resposta = await global.OptimusLocalWorkerClient.failure(task, {
        leaseToken: task.leaseToken,
        motivo: originalFailureReason.slice(0, 120),
        ...(estado.failureMetadata ? { metadata: resultadoOportunidadePublico(estado.failureMetadata) } : {})
      });
      if (!resposta || resposta.ok === false) throw new Error(texto(resposta?.motivo) || "failure_rejeitado");
      await registrarBreadcrumb("FAILURE_OK", task, { motivo: originalFailureReason, originalFailureReason, taskStage: estado.stage });
      await limparEstado();
      return resposta;
    } catch (erro) {
      if (leaseInvalido(erro)) {
        await registrarBreadcrumb("LEASE_INVALID", task, { motivo: "lease_invalido", status: erro?.status, taskStage: estado.stage });
        await limparEstado();
        return null;
      }
      if (autenticacaoWorkerInvalida(erro)) throw erro;
      const reportingError = erroTexto(erro);
      await registrarBreadcrumb("FAILURE_ERROR", task, { motivo: reportingError, originalFailureReason, reportingError, status: erro?.status, taskStage: estado.stage });
      await registrarSemProgresso({ ...estado, originalFailureReason, lastTechnicalError: originalFailureReason, reportingError }, task);
      return null;
    }
  }
  async function continuarOportunidade(estado, task) {
    let atual = estado;
    while (atual) {
      if (atual.stage === STAGES.CLAIMED) {
        atual = await marcarStage(atual, STAGES.RESOLVING_PAGE);
        continue;
      }
      if (atual.stage === STAGES.RESOLVING_PAGE) {
        if (!await validarLease(task, atual)) return;
        await registrarBreadcrumb("OPPORTUNITY_CHECK_START", task, { taskStage: atual.stage });
        const resultado = await global.OptimusMagaluOpportunityResolver.verificar({ sourceUrl: task.sourceUrl });
        if (resultado?.accessible !== true) {
          const motivo = erroTexto(resultado?.reason || "magalu_oportunidade_fonte_indisponivel");
          await registrarBreadcrumb("OPPORTUNITY_CHECK_UNAVAILABLE", task, { motivo, taskStage: atual.stage });
          const falha = await marcarStage(atual, STAGES.FAILURE_PENDING, {
            originalFailureReason: motivo,
            reportingError: "",
            lastTechnicalError: motivo,
            failureMetadata: resultadoOportunidadePublico(resultado)
          }, { motivo });
          await enviarFailure(falha, task);
          return;
        }
        await registrarBreadcrumb("OPPORTUNITY_CHECK_OK", task, { taskStage: atual.stage });
        atual = await marcarStage(atual, STAGES.RESULT_PENDING, { resultadoOportunidade: resultadoOportunidadePublico(resultado) });
        continue;
      }
      if (atual.stage === STAGES.RESULT_PENDING) {
        await registrarBreadcrumb("RESULT_SEND", task, { taskStage: atual.stage });
        const resultado = atual.resultadoOportunidade;
        try {
          const resposta = await global.OptimusLocalWorkerClient.result(task, {
            leaseToken: task.leaseToken,
            capability: MAGALU_OPPORTUNITY_CAPABILITY,
            accessible: resultado?.accessible === true,
            indicatorFound: resultado?.indicatorFound === true,
            finalUrl: texto(resultado?.finalUrl),
            checkedAt: texto(resultado?.checkedAt)
          });
          if (!resposta || resposta.ok === false) throw new Error(texto(resposta?.motivo) || "result_rejeitado");
          await registrarBreadcrumb("RESULT_OK", task, { taskStage: atual.stage });
          atual = await marcarStage(atual, STAGES.COMPLETED);
          await limparEstado();
          return;
        } catch (erro) {
          await registrarBreadcrumb("RESULT_ERROR", task, { motivo: erroTexto(erro), status: erro?.status, taskStage: atual.stage });
          if (erroAmbiguo(erro)) return;
          throw erro;
        }
      }
      if (atual.stage === STAGES.FAILURE_PENDING) {
        await enviarFailure(atual, task);
        return;
      }
      if (atual.stage === STAGES.COMPLETED) {
        await limparEstado();
        return;
      }
      throw new Error("local_worker_stage_invalido");
    }
  }
  async function continuarMercadoLivre(estado, task) {
    let atual = estado;
    while (atual) {
      if (atual.stage === STAGES.CLAIMED) {
        atual = await marcarStage(atual, STAGES.RESOLVING_PAGE);
        continue;
      }
      if (atual.stage === STAGES.RESOLVING_PAGE) {
        if (!await validarLease(task, atual)) return;
        await registrarBreadcrumb("ML_IDENTIFY_START", task, { taskStage: atual.stage });
        try {
          const resolvido = await global.OptimusMercadoLivreLocalResolver.resolver({ productId: task.productId, sourceUrl: task.sourceUrl });
          if (!resolvido?.imagemOficialUrl || !resolvido?.provaTecnica) throw new Error("ml_resultado_incompleto");
          await registrarBreadcrumb("ML_IDENTIFY_OK", task, { taskStage: atual.stage, hostImagem: hostTecnico(resolvido.imagemOficialUrl) });
          atual = await marcarStage(atual, STAGES.IMAGE_IDENTIFIED, {
            imagemOficialUrl: resolvido.imagemOficialUrl,
            finalUrl: resolvido.finalUrl,
            checkedAt: resolvido.checkedAt,
            provaTecnica: resolvido.provaTecnica
          });
          continue;
        } catch (erro) {
          await registrarBreadcrumb("ML_IDENTIFY_ERROR", task, { motivo: erroTexto(erro), status: erro?.status, taskStage: atual.stage });
          if (erroAmbiguo(erro)) { await registrarSemProgresso(atual, task); return; }
          throw erro;
        }
      }
      if (atual.stage === STAGES.IMAGE_IDENTIFIED) {
        if (!await validarLease(task, atual)) return;
        await registrarBreadcrumb("ML_PROBE_OK", task, { taskStage: atual.stage, hostImagem: hostTecnico(atual.imagemOficialUrl) });
        atual = await marcarStage(atual, STAGES.IMAGE_PROBED);
        continue;
      }
      if (atual.stage === STAGES.IMAGE_PROBED) {
        atual = await marcarStage(atual, STAGES.RESULT_PENDING);
        continue;
      }
      if (atual.stage === STAGES.RESULT_PENDING) {
        emitir("LOCAL-WORKER-ML-RESULT-ENVIO", { taskId: texto(task.id), productId: texto(task.productId) });
        try {
          const resposta = await global.OptimusLocalWorkerClient.result(task, {
            leaseToken: task.leaseToken,
            capability: ML_CAPABILITY,
            marketplace: "mercadolivre",
            productId: task.productId,
            imagemOficialUrl: atual.imagemOficialUrl,
            finalUrl: atual.finalUrl,
            checkedAt: atual.checkedAt,
            provaTecnica: atual.provaTecnica
          });
          if (!resposta || resposta.ok === false) throw new Error(texto(resposta?.motivo) || "result_rejeitado");
          await registrarBreadcrumb("ML_RESULT_OK", task, { taskStage: atual.stage, hostImagem: hostTecnico(atual.imagemOficialUrl) });
          atual = await marcarStage(atual, STAGES.COMPLETED);
          await limparEstado();
          return;
        } catch (erro) {
          await registrarBreadcrumb("ML_RESULT_ERROR", task, { motivo: erroTexto(erro), status: erro?.status, taskStage: atual.stage });
          if (erroAmbiguo(erro)) return;
          throw erro;
        }
      }
      if (atual.stage === STAGES.FAILURE_PENDING) { await enviarFailure(atual, task); return; }
      if (atual.stage === STAGES.COMPLETED) { await limparEstado(); return; }
      throw new Error("local_worker_stage_invalido");
    }
  }
  async function continuarMercadoLivreIdentidade(estado, task) {
    let atual = estado;
    while (atual) {
      if (atual.stage === STAGES.CLAIMED) {
        atual = await marcarStage(atual, STAGES.RESOLVING_PAGE);
        continue;
      }
      if (atual.stage === STAGES.RESOLVING_PAGE) {
        if (!await validarLease(task, atual)) return;
        await registrarBreadcrumb("ML_IDENTITY_START", task, { taskStage: atual.stage });
        try {
          const resolvido = await global.OptimusMercadoLivreIdentityResolver.resolver({ productId: task.productId, sourceUrl: task.sourceUrl });
          if (resolvido?.identidadeValidada !== true || !resolvido?.provaTecnica) throw new Error("ml_identity_resultado_incompleto");
          atual = await marcarStage(atual, STAGES.IDENTITY_IDENTIFIED, {
            tituloOficial: resolvido.tituloOficial,
            imagemOficialUrl: resolvido.imagemOficial,
            identidadeValidada: true,
            expectedMlb: resolvido.expectedMlb,
            observedMlb: resolvido.observedMlb,
            origemTitulo: resolvido.origemTitulo,
            origemImagem: resolvido.origemImagem,
            finalUrl: resolvido.finalUrl,
            canonicalUrl: resolvido.canonicalUrl,
            variationId: resolvido.variationId,
            collectedAt: resolvido.collectedAt,
            provaTecnica: resolvido.provaTecnica
          });
          continue;
        } catch (erro) {
          await registrarBreadcrumb("ML_IDENTITY_ERROR", task, { motivo: erroTexto(erro), status: erro?.status, taskStage: atual.stage });
          if (erroAmbiguo(erro)) { await registrarSemProgresso(atual, task); return; }
          throw erro;
        }
      }
      if (atual.stage === STAGES.IDENTITY_IDENTIFIED) {
        atual = await marcarStage(atual, STAGES.RESULT_PENDING);
        continue;
      }
      if (atual.stage === STAGES.RESULT_PENDING) {
        emitir("LOCAL-WORKER-ML-IDENTITY-RESULT-ENVIO", { taskId: texto(task.id), productId: texto(task.productId) });
        try {
          const resposta = await global.OptimusLocalWorkerClient.result(task, {
            leaseToken: task.leaseToken,
            capability: ML_IDENTITY_CAPABILITY,
            marketplace: "mercadolivre",
            productId: task.productId,
            expectedMlb: atual.expectedMlb,
            observedMlb: atual.observedMlb,
            identidadeValidada: atual.identidadeValidada === true,
            tituloOficial: atual.tituloOficial,
            imagemOficial: atual.imagemOficialUrl,
            origemTitulo: atual.origemTitulo,
            origemImagem: atual.origemImagem,
            finalUrl: atual.finalUrl,
            canonicalUrl: atual.canonicalUrl,
            variationId: atual.variationId,
            collectedAt: atual.collectedAt,
            provaTecnica: atual.provaTecnica
          });
          if (!resposta || resposta.ok === false) throw new Error(texto(resposta?.motivo) || "result_rejeitado");
          await registrarBreadcrumb("ML_IDENTITY_RESULT_OK", task, { taskStage: atual.stage });
          atual = await marcarStage(atual, STAGES.COMPLETED);
          await limparEstado();
          return;
        } catch (erro) {
          await registrarBreadcrumb("ML_IDENTITY_RESULT_ERROR", task, { motivo: erroTexto(erro), status: erro?.status, taskStage: atual.stage });
          if (erroAmbiguo(erro)) return;
          throw erro;
        }
      }
      if (atual.stage === STAGES.FAILURE_PENDING) { await enviarFailure(atual, task); return; }
      if (atual.stage === STAGES.COMPLETED) { await limparEstado(); return; }
      throw new Error("local_worker_stage_invalido");
    }
  }
  async function continuar(estado, task) {
    if (texto(task?.capability) === ML_IDENTITY_CAPABILITY) return continuarMercadoLivreIdentidade(estado, task);
    if (texto(task?.capability) === ML_CAPABILITY) return continuarMercadoLivre(estado, task);
    if (texto(task?.capability) === MAGALU_OPPORTUNITY_CAPABILITY) return continuarOportunidade(estado, task);
    let atual = estado;
    while (atual) {
      if (atual.stage === STAGES.CLAIMED) {
        atual = await marcarStage(atual, STAGES.RESOLVING_PAGE);
        continue;
      }
      if (atual.stage === STAGES.RESOLVING_PAGE) {
        if (!await validarLease(task, atual)) return;
        await registrarBreadcrumb("IDENTIFY_START", task, { taskStage: atual.stage });
        let identificado;
        try {
          identificado = await global.OptimusMagaluLocalResolver.identificar({ productId: task.productId, slugWorkspace: task.technicalSlug });
          if (!identificado?.imagemOficialUrl || !identificado?.provaTecnica) throw new Error("magalu_resultado_incompleto");
          await registrarBreadcrumb("IDENTIFY_OK", task, {
            taskStage: atual.stage,
            skuConfirmado: identificado.provaTecnica.skuConfirmado,
            hrefConfirmado: identificado.provaTecnica.hrefConfirmado,
            hostImagem: identificado.provaTecnica.hostFinal
          });
        } catch (erro) {
          await registrarBreadcrumb("IDENTIFY_ERROR", task, { motivo: erroTexto(erro), status: erro?.status, taskStage: atual.stage });
          if (erroAmbiguo(erro)) {
            await registrarSemProgresso(atual, task);
            return;
          }
          throw erro;
        }
        atual = await marcarStage(atual, STAGES.IMAGE_IDENTIFIED, { imagemOficialUrl: identificado.imagemOficialUrl, provaTecnica: identificado.provaTecnica });
        continue;
      }
      if (atual.stage === STAGES.IMAGE_IDENTIFIED) {
        if (!await validarLease(task, atual)) return;
        const provaTecnica = atual.provaTecnica;
        await registrarBreadcrumb("PROBE_START", task, {
          taskStage: atual.stage,
          skuConfirmado: provaTecnica?.skuConfirmado,
          hrefConfirmado: provaTecnica?.hrefConfirmado,
          hostImagem: hostTecnico(atual.imagemOficialUrl)
        });
        let provado;
        try {
          provado = await global.OptimusMagaluLocalResolver.provarImagem({ productId: task.productId, imagemOficialUrl: atual.imagemOficialUrl, provaTecnica });
          if (!provado?.imagemOficialUrl || !provado?.provaTecnica) throw new Error("magalu_resultado_incompleto");
          await registrarBreadcrumb("PROBE_OK", task, {
            taskStage: atual.stage,
            skuConfirmado: provado.provaTecnica.skuConfirmado,
            hrefConfirmado: provado.provaTecnica.hrefConfirmado,
            hostImagem: provado.provaTecnica.hostFinal
          });
        } catch (erro) {
          await registrarBreadcrumb("PROBE_ERROR", task, { motivo: erroTexto(erro), status: erro?.status, taskStage: atual.stage });
          if (erroAmbiguo(erro)) {
            await registrarSemProgresso(atual, task);
            return;
          }
          throw erro;
        }
        atual = await marcarStage(atual, STAGES.IMAGE_PROBED, { imagemOficialUrl: provado.imagemOficialUrl, provaTecnica: provado.provaTecnica });
        emitir("LOCAL-WORKER-MAGALU-RESOLVIDA", { taskId: texto(task.id), productId: texto(task.productId), skuConfirmado: provado.provaTecnica.skuConfirmado === true, hrefConfirmado: provado.provaTecnica.hrefConfirmado === true, origem: texto(provado.provaTecnica.origem || provado.provaTecnica.source) });
        continue;
      }
      if (atual.stage === STAGES.IMAGE_PROBED) {
        atual = await marcarStage(atual, STAGES.RESULT_PENDING);
        continue;
      }
      if (atual.stage === STAGES.RESULT_PENDING) {
        await registrarBreadcrumb("RESULT_SEND", task, { taskStage: atual.stage });
        emitir("LOCAL-WORKER-RESULT-ENVIO", { taskId: texto(task.id), productId: texto(task.productId) });
        try {
          const resposta = await global.OptimusLocalWorkerClient.result(task, { leaseToken: task.leaseToken, marketplace: "magalu", productId: task.productId, imagemOficialUrl: atual.imagemOficialUrl, provaTecnica: atual.provaTecnica });
          if (!resposta || resposta.ok === false) throw new Error(texto(resposta?.motivo) || "result_rejeitado");
          await registrarBreadcrumb("RESULT_OK", task, { taskStage: atual.stage });
          atual = await marcarStage(atual, STAGES.COMPLETED);
          emitir("LOCAL-WORKER-RESULT-OK", { taskId: texto(task.id), productId: texto(task.productId) });
          await limparEstado();
          return;
        } catch (erro) {
          await registrarBreadcrumb("RESULT_ERROR", task, { motivo: erroTexto(erro), status: erro?.status, taskStage: atual.stage });
          if (erroAmbiguo(erro)) return;
          throw erro;
        }
      }
      if (atual.stage === STAGES.FAILURE_PENDING) {
        await enviarFailure(atual, task);
        return;
      }
      if (atual.stage === STAGES.COMPLETED) {
        await limparEstado();
        return;
      }
      throw new Error("local_worker_stage_invalido");
    }
  }
  async function processar() {
    if (executando || !global.OptimusLocalWorkerClient || (!global.OptimusMagaluLocalResolver && !global.OptimusMercadoLivreLocalResolver && !global.OptimusMercadoLivreIdentityResolver && !global.OptimusMagaluOpportunityResolver)) return;
    executando = true;
    let estado = null;
    let task = null;
    let etapa = "resume";
    try {
      if (typeof global.OptimusLocalWorkerClient.bootstrap === "function") {
        etapa = "bootstrap";
        const autenticado = await global.OptimusLocalWorkerClient.bootstrap();
        if (!autenticado?.token || !autenticado?.workerId) return;
      }
      estado = await lerEstado();
      let lease = await lerLease();
      if (estado) {
        task = estado.stage === STAGES.RESULT_PENDING ? taskParaResultado(estado, lease) : taskComLease(estado, lease);
        if (!task) {
          await registrarBreadcrumb("LEASE_SESSION_MISSING", estado.task, { motivo: "lease_session_ausente" });
          await limparEstado();
          return;
        }
      } else {
        if (lease) await removerChave(storageSession(), STORAGE_KEYS.LEASE);
        etapa = "claim";
        const claimed = await global.OptimusLocalWorkerClient.claim();
        if (claimed?.ok === false) throw new Error(texto(claimed?.motivo) || "claim_falhou");
        task = claimed?.task || null;
        if (!task) return;
        if (!taskCompleta(task)) throw new Error("task_magalu_capability_invalida");
        await salvarLease(task);
        estado = await salvarEstado({ stage: STAGES.CLAIMED, task });
        task = taskComLease(estado, await lerLease());
        if (!task) throw new Error("lease_session_ausente");
        await registrarBreadcrumb(STAGES.CLAIMED, task);
        emitir("LOCAL-WORKER-TASK-INICIO", { taskId: texto(task.id), productId: texto(task.productId), marketplace: texto(task.marketplace), capability: texto(task.capability), attempts: task.attempt });
      }
      etapa = estado.stage;
      await continuar(estado, task);
    } catch (erro) {
      emitir("LOCAL-WORKER-ERRO", { etapa, taskId: texto(task?.id || estado?.task?.id), productId: texto(task?.productId || estado?.task?.productId), motivo: erroTexto(erro) });
      if (!estado || !task) return;
      estado = await lerEstado() || estado;
      if (autenticacaoWorkerInvalida(erro)) {
        await registrarBreadcrumb("WORKER_REAUTH_PENDING", task, { motivo: "worker_reauth_pendente", status: erro?.status, taskStage: estado.stage });
        await global.OptimusLocalWorkerClient.invalidarToken?.();
        return;
      }
      if (leaseInvalido(erro)) {
        if (estado.stage === STAGES.RESULT_PENDING) await registrarBreadcrumb("RESULT_RECONCILIATION_MISS", task, { motivo: "lease_invalido", status: erro?.status });
        else await registrarBreadcrumb("LEASE_INVALID", task, { motivo: "lease_invalido", status: erro?.status, taskStage: estado.stage });
        await limparEstado();
        return;
      }
      if (erroAmbiguo(erro)) {
        await registrarBreadcrumb("TASK_ERROR_AMBIGUOUS", task, { motivo: erroTexto(erro), status: erro?.status, taskStage: estado.stage });
        return;
      }
      if (estado.stage === STAGES.FAILURE_PENDING) {
        const originalFailureReason = erroTexto(estado.originalFailureReason || estado.lastTechnicalError);
        const reportingError = erroTexto(erro);
        await registrarBreadcrumb("FAILURE_ERROR", task, { motivo: reportingError, originalFailureReason, reportingError, status: erro?.status, taskStage: estado.stage });
        await registrarSemProgresso({ ...estado, originalFailureReason, lastTechnicalError: originalFailureReason, reportingError }, task);
        return;
      }
      const motivo = erroTexto(erro);
      const falha = await marcarStage(estado, STAGES.FAILURE_PENDING, { originalFailureReason: motivo, reportingError: "", lastTechnicalError: motivo }, { motivo });
      await enviarFailure(falha, task);
    } finally {
      executando = false;
    }
  }
  function aoAlarme(alarm) {
    if (alarm?.name !== ALARM_NAME) return;
    void processar().catch(erro => emitir("LOCAL-WORKER-ERRO", { etapa: "alarme", motivo: erroTexto(erro) }));
  }
  function garantirAlarme() {
    try {
      global.chrome.alarms.get(ALARM_NAME, existente => {
        if (!existente) global.chrome.alarms.create(ALARM_NAME, { periodInMinutes: INTERVAL_MINUTES });
      });
    } catch (_) {}
  }
  function iniciar() {
    if (!global.chrome?.alarms || alarmeRegistrado) return;
    try {
      global.chrome.alarms.onAlarm?.addListener(aoAlarme);
      alarmeRegistrado = true;
      garantirAlarme();
      if (typeof global.OptimusLocalWorkerClient?.bootstrap === "function") {
        void global.OptimusLocalWorkerClient.bootstrap().catch(erro => emitir("LOCAL-WORKER-ERRO", { etapa: "bootstrap", motivo: erroTexto(erro) }));
      }
    } catch (_) {}
  }
  global.OptimusLocalWorkerRunner = { iniciar, processar, limparEstado, INTERVAL_MINUTES, ALARM_NAME, STAGES, STORAGE_KEYS, MAX_BREADCRUMBS, LIVENESS, ML_CAPABILITY, ML_IDENTITY_CAPABILITY };
  if (typeof module !== "undefined" && module.exports) module.exports = global.OptimusLocalWorkerRunner;
})(typeof globalThis !== "undefined" ? globalThis : self);
