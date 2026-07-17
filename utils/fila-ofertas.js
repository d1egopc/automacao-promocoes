const fs = require("fs");
const path = require("path");
const { resolverImagemUniversal } = require("../modules/imagens/resolver-imagem-universal");

let inteligenciaUniversalCache = null;
let templateUniversalCache = null;
let resumoV2Rodada = criarResumoV2Rodada();
let resumoV2Acumulado = criarResumoV2Rodada();
let resumoV2Agendado = false;

function getInteligenciaUniversal() {
  if (inteligenciaUniversalCache) return inteligenciaUniversalCache;

  inteligenciaUniversalCache = require("../modules/inteligencia-universal");
  return inteligenciaUniversalCache;
}

function getTemplateUniversal() {
  if (templateUniversalCache) return templateUniversalCache;

  templateUniversalCache = require("../modules/template-universal");
  return templateUniversalCache;
}

function criarResumoV2Rodada() {
  return {
    comparacoes: 0,
    divergencias: 0,
    categoria: 0,
    score: 0,
    preco: 0,
    cupom: 0,
    status: 0,
    clientes: {},
    marketplaces: {},
    statusV2: {}
  };
}

function incrementarContadorMapa(mapa = {}, chave = "") {
  const valor = textoComparacao(chave) || "desconhecido";
  mapa[valor] = (mapa[valor] || 0) + 1;
}

function clonarResumoV2(resumo = {}) {
  return {
    ofertasComparadas: resumo.comparacoes || 0,
    iguais: Math.max(0, (resumo.comparacoes || 0) - (resumo.divergencias || 0)),
    divergentes: resumo.divergencias || 0,
    categoria: resumo.categoria || 0,
    score: resumo.score || 0,
    preco: resumo.preco || 0,
    cupom: resumo.cupom || 0,
    status: resumo.status || 0,
    clientes: resumo.clientes || {},
    marketplaces: resumo.marketplaces || {},
    statusV2: resumo.statusV2 || {}
  };
}

function resumirLogsUniversais(logs = []) {
  if (!Array.isArray(logs)) return [];
  return logs.slice(-20);
}

function montarMetadataUniversalErro(oferta = {}, erro = null) {
  return {
    ativo: true,
    modo: "oficial",
    ok: false,
    status: "erro",
    motivo: erro?.message || "erro_inteligencia_universal",
    prioridade: null,
    score: null,
    categoria: oferta.categoria || "",
    valorEfetivo: null,
    valorEfetivoOrigem: "",
    logs: [{
      etapa: "porta_fila",
      status: "erro",
      motivo: erro?.message || "erro_inteligencia_universal"
    }]
  };
}

function textoComparacao(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

function textoComparacaoNormalizado(valor) {
  return textoComparacao(valor).toLowerCase();
}

function numeroComparacao(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const texto = String(valor)
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .trim();

  if (!texto) return null;

  const brasileiro = texto.includes(",")
    ? texto.replace(/\./g, "").replace(",", ".")
    : texto;

  const numero = Number(brasileiro);
  return Number.isFinite(numero) ? numero : null;
}

function tituloCurto(valor = "") {
  const texto = textoComparacao(valor);
  return texto.length > 80 ? `${texto.slice(0, 77)}...` : texto;
}

function campoPresente(valor) {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === "string") return valor.trim() !== "";
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}

function economiaOferta(oferta = {}, normalizada = {}) {
  const economiaDireta = oferta.economia ?? oferta.economiaValor ?? oferta.valorEconomia;
  if (campoPresente(economiaDireta)) return economiaDireta;

  const precoOriginal = numeroComparacao(normalizada.precoOriginal ?? oferta.precoOriginal ?? oferta.precoAntigo);
  const precoAtual = numeroComparacao(normalizada.precoAtual ?? oferta.precoAtual ?? oferta.preco);

  if (precoOriginal !== null && precoAtual !== null && precoOriginal > precoAtual) {
    return precoOriginal - precoAtual;
  }

  return "";
}

function temBeneficioComercial(oferta = {}, avaliacao = {}) {
  const templateInput = avaliacao.templateInput || {};
  const beneficios = [
    ...(Array.isArray(templateInput.beneficios) ? templateInput.beneficios : []),
    ...(Array.isArray(oferta.beneficios) ? oferta.beneficios : []),
    oferta.beneficioTexto,
    oferta.avisoCupom,
    oferta.aviso
  ].filter(campoPresente);

  return beneficios.length > 0;
}

function scoreUniversal(metadata = {}) {
  return metadata.score?.score ?? metadata.score ?? null;
}

function statusEquivalenteV1V2(statusV1, statusV2) {
  const v1 = textoComparacaoNormalizado(statusV1);
  const v2 = textoComparacaoNormalizado(statusV2);

  if (v1 === "pendente" && v2 === "aprovada") return true;
  if (v1 === "aprovada" && v2 === "pendente") return true;
  if (v1 === "retida" && v2 === "retida") return true;
  if (v1 === "erro" && v2 === "erro") return true;

  return v1 === v2;
}

function adicionarComparacaoDivergencia(divergencias, campo, v1, v2, comparar = null) {
  const temV1 = v1 !== null && v1 !== undefined && textoComparacao(v1) !== "";

  if (!temV1) {
    divergencias.push({ campo, status: "sem_base_v1" });
    return;
  }

  const iguais = typeof comparar === "function"
    ? comparar(v1, v2)
    : textoComparacaoNormalizado(v1) === textoComparacaoNormalizado(v2);

  if (!iguais) {
    divergencias.push({
      campo,
      status: "divergente",
      v1,
      v2: v2 ?? ""
    });
  }
}

function camposDivergentesLog(divergencias = []) {
  const camposPermitidos = new Set(["categoria", "score", "status", "preco", "cupom"]);

  return divergencias
    .filter(item => item.status === "divergente" && camposPermitidos.has(item.campo))
    .map(item => item.campo);
}

function registrarResumoV2Rodada(divergencias = [], logger = console, meta = {}) {
  const camposDivergentes = camposDivergentesLog(divergencias);

  resumoV2Rodada.comparacoes += 1;
  resumoV2Acumulado.comparacoes += 1;
  if (camposDivergentes.length > 0) resumoV2Rodada.divergencias += 1;
  if (camposDivergentes.length > 0) resumoV2Acumulado.divergencias += 1;

  incrementarContadorMapa(resumoV2Rodada.clientes, meta.clienteId);
  incrementarContadorMapa(resumoV2Rodada.marketplaces, meta.marketplace);
  incrementarContadorMapa(resumoV2Rodada.statusV2, meta.statusV2);
  incrementarContadorMapa(resumoV2Acumulado.clientes, meta.clienteId);
  incrementarContadorMapa(resumoV2Acumulado.marketplaces, meta.marketplace);
  incrementarContadorMapa(resumoV2Acumulado.statusV2, meta.statusV2);

  camposDivergentes.forEach(campo => {
    if (Object.prototype.hasOwnProperty.call(resumoV2Rodada, campo)) {
      resumoV2Rodada[campo] += 1;
    }
    if (Object.prototype.hasOwnProperty.call(resumoV2Acumulado, campo)) {
      resumoV2Acumulado[campo] += 1;
    }
  });

  if (resumoV2Agendado) return;

  resumoV2Agendado = true;
  setImmediate(() => {
    const resumo = resumoV2Rodada;
    resumoV2Rodada = criarResumoV2Rodada();
    resumoV2Agendado = false;

    const resumoLog = {
      rodada: clonarResumoV2(resumo),
      acumulado: clonarResumoV2(resumoV2Acumulado)
    };

    logger.log("[V2-RESUMO]", JSON.stringify(resumoLog));
  });
}

function obterConfigEngineV2() {
  const modo = textoComparacaoNormalizado(process.env.ENGINE_V2_MODO || "full");
  const modoSeguro = modo === "shadow" ? "shadow" : "full";
  return { modo: modoSeguro };
}

function statusOperacionalV2(metadata = {}) {
  const status = textoComparacaoNormalizado(metadata.status);

  if (status === "aprovada") return "pendente";
  if (status === "retida") return "retida";
  if (status === "erro") return "erro";

  return metadata.ok === true ? "pendente" : "retida";
}

function aplicarDecisaoEngineV2Oficial(oferta = {}, contexto = {}) {
  const logger = contexto.logger || console;
  const clienteId = contexto.clienteId || oferta.clienteId || "admin";
  const config = obterConfigEngineV2();
  const v2 = oferta.inteligenciaUniversalV2 || {};
  const resumoModo = {
    modo: config.modo,
    clienteId,
    marketplace: oferta.marketplace || contexto.marketplace || ""
  };

  logger.log("[ENGINE-V2-MODO]", JSON.stringify(resumoModo));

  if (config.modo === "shadow") {
    logger.log("[ENGINE-V2-FALLBACK-V1]", JSON.stringify({
      ...resumoModo,
      motivo: "rollback_shadow"
    }));
    return oferta;
  }

  if (textoComparacaoNormalizado(v2.status) === "erro") {
    logger.log("[ENGINE-V2-FALLBACK-V1]", JSON.stringify({
      ...resumoModo,
      motivo: v2.motivo || "erro_v2"
    }));
    return oferta;
  }

  const statusAnterior = oferta.status || "";
  const prioridadeAnterior = oferta.prioridadeEnvio ?? oferta.prioridadeFila ?? oferta.prioridade ?? "";
  const statusAplicado = statusOperacionalV2(v2);

  oferta.status = statusAplicado;
  oferta.statusDetalhe = v2.motivo || oferta.statusDetalhe || "";
  oferta.motivo = v2.motivo || oferta.motivo || "";

  if (v2.prioridade !== null && v2.prioridade !== undefined) {
    oferta.prioridadeEnvio = v2.prioridade;
    oferta.prioridadeFila = v2.prioridade;
    oferta.prioridade = v2.prioridade;
    oferta.motivoPrioridade = v2.motivo || "Inteligencia Universal V2";
  }

  oferta.engineV2Decisao = {
    ativo: true,
    modo: config.modo,
    statusV2: v2.status || "",
    statusAplicado,
    motivo: v2.motivo || "",
    prioridade: v2.prioridade ?? null,
    aplicadoEm: new Date().toISOString()
  };

  logger.log("[ENGINE-V2-DECISAO-APLICADA]", JSON.stringify({
    clienteId,
    marketplace: oferta.marketplace || contexto.marketplace || "",
    titulo: tituloCurto(oferta.titulo || oferta.nome || ""),
    modo: config.modo,
    statusAnterior,
    statusV2: v2.status || "",
    statusAplicado,
    prioridadeAnterior,
    prioridadeV2: v2.prioridade ?? ""
  }));

  return oferta;
}

function aplicarComparacaoV1V2Sombra(oferta = {}, contexto = {}, camposUniversais = {}) {
  const logger = contexto.logger || console;

  try {
    const v2 = oferta.inteligenciaUniversalV2 || {};
    const divergencias = [];
    const scoreV1 = oferta.score ?? oferta.radarScore ?? oferta.prioridadeEnvio;
    const scoreV2 = scoreUniversal(v2);
    const categoriaV1 = oferta.categoria || oferta.categoriaProduto;
    const categoriaV2 = v2.categoria;
    const statusV1 = oferta.status || oferta.decisao || oferta.decisaoRadar;
    const statusV2 = v2.status;
    const motivoV1 = oferta.motivo || oferta.statusDetalhe;
    const motivoV2 = v2.motivo;
    const precoV1 = oferta.precoAtual ?? oferta.preco;
    const precoV2 = v2.valorEfetivo ?? camposUniversais.valorEfetivo ?? camposUniversais.precoAtual;
    const cupomV1 = oferta.cupom;
    const cupomV2 = camposUniversais.cupom || oferta.cupomInfo?.cupom || "";
    const beneficiosV2 = Array.isArray(camposUniversais.beneficios)
      ? camposUniversais.beneficios.join(" | ")
      : "";

    adicionarComparacaoDivergencia(divergencias, "categoria", categoriaV1, categoriaV2);
    adicionarComparacaoDivergencia(divergencias, "score", scoreV1, scoreV2, (a, b) => {
      const n1 = numeroComparacao(a);
      const n2 = numeroComparacao(b);
      if (n1 === null || n2 === null) return textoComparacao(a) === textoComparacao(b);
      return Math.abs(n1 - n2) < 0.01;
    });
    adicionarComparacaoDivergencia(
      divergencias,
      "status",
      statusV1,
      statusV2,
      statusEquivalenteV1V2
    );
    adicionarComparacaoDivergencia(divergencias, "motivo", motivoV1, motivoV2);
    adicionarComparacaoDivergencia(divergencias, "preco", precoV1, precoV2, (a, b) => {
      const n1 = numeroComparacao(a);
      const n2 = numeroComparacao(b);
      if (n1 === null || n2 === null) return textoComparacao(a) === textoComparacao(b);
      return Math.abs(n1 - n2) < 0.01;
    });
    adicionarComparacaoDivergencia(
      divergencias,
      "cupom",
      cupomV1,
      cupomV2 || beneficiosV2,
      (a, b) => textoComparacaoNormalizado(b).includes(textoComparacaoNormalizado(a))
    );

    const totalDivergencias = divergencias.filter(
      item => item.status === "divergente"
    ).length;
    const divergenciasLog = camposDivergentesLog(divergencias);

    oferta.comparacaoV1V2 = {
      ativo: true,
      modo: "sombra",
      divergencias,
      totalDivergencias,
      geradoEm: new Date().toISOString()
    };

    const resumo = {
      clienteId: contexto.clienteId || oferta.clienteId || "admin",
      marketplace: camposUniversais.marketplace || oferta.marketplace || "",
      titulo: tituloCurto(camposUniversais.titulo || oferta.titulo || oferta.nome || ""),
      categoriaV1: categoriaV1 || "",
      categoriaV2: categoriaV2 || "",
      scoreV1: scoreV1 ?? "",
      scoreV2: scoreV2 ?? "",
      statusV1: statusV1 || "",
      statusV2: statusV2 || "",
      totalDivergencias
    };

    logger.log("[INTELIGENCIA-V1-V2-COMPARACAO]", JSON.stringify(resumo));

    if (divergenciasLog.length > 0) {
      const resumoDivergencia = {
        clienteId: resumo.clienteId,
        marketplace: resumo.marketplace,
        titulo: resumo.titulo,
        divergencias: divergenciasLog
      };

      logger.log("[INTELIGENCIA-V1-V2-DIVERGENCIA]", JSON.stringify(resumoDivergencia));
    }

    registrarResumoV2Rodada(divergencias, logger, {
      clienteId: resumo.clienteId,
      marketplace: resumo.marketplace,
      statusV2: resumo.statusV2
    });
  } catch (e) {
    oferta.comparacaoV1V2 = {
      ativo: true,
      modo: "sombra",
      divergencias: [{ campo: "comparador", status: "erro", motivo: e.message }],
      totalDivergencias: 0,
      geradoEm: new Date().toISOString()
    };
  }

  return oferta;
}

function montarOfertaTemplateUniversalSombra(oferta = {}, normalizada = {}, avaliacao = {}) {
  const templateInput = avaliacao.templateInput || {};

  return {
    titulo: normalizada.titulo || oferta.titulo || "",
    marketplace: normalizada.marketplace || oferta.marketplace || "",
    precoAtual: normalizada.precoAtual ?? oferta.precoAtual,
    precoOriginal: normalizada.precoOriginal ?? oferta.precoOriginal,
    categoria: avaliacao.categoria || normalizada.categoria || oferta.categoria || "",
    cupom: normalizada.cupom || oferta.cupom || "",
    cupomTipo: normalizada.cupomTipo || oferta.cupomTipo || "",
    beneficios: Array.isArray(templateInput.beneficios)
      ? templateInput.beneficios
      : (Array.isArray(oferta.beneficios) ? oferta.beneficios : []),
    valorEfetivo: avaliacao.valorEfetivo ?? oferta.valorEfetivo,
    linkAfiliado: normalizada.linkAfiliado || oferta.linkAfiliado || "",
    imagem: normalizada.imagem || oferta.imagem || ""
  };
}

function aplicarTemplateUniversalSombra(oferta = {}, contexto = {}, camposUniversais = null) {
  const logger = contexto.logger || console;
  const ofertaTemplate = camposUniversais || montarOfertaTemplateUniversalSombra(oferta);

  try {
    const { gerarTemplateUniversal } = getTemplateUniversal();
    const texto = gerarTemplateUniversal(ofertaTemplate);

    oferta.templateUniversalV2 = {
      ativo: true,
      modo: "sombra",
      texto,
      temImagem: Boolean(ofertaTemplate.imagem),
      marketplace: ofertaTemplate.marketplace || contexto.marketplace || "",
      geradoEm: new Date().toISOString()
    };

    const resumoTemplate = {
      marketplace: oferta.templateUniversalV2.marketplace,
      titulo: tituloCurto(ofertaTemplate.titulo || oferta.titulo || ""),
      tamanhoTexto: texto.length,
      temImagem: oferta.templateUniversalV2.temImagem,
      temCupom: Boolean(ofertaTemplate.cupom),
      temLinkAfiliado: Boolean(ofertaTemplate.linkAfiliado),
      sucesso: true
    };

    logger.log("[TEMPLATE-UNIVERSAL-SOMBRA]", JSON.stringify(resumoTemplate));
  } catch (e) {
    oferta.templateUniversalV2 = {
      ativo: true,
      modo: "sombra",
      texto: "",
      temImagem: Boolean(ofertaTemplate.imagem),
      marketplace: ofertaTemplate.marketplace || contexto.marketplace || "",
      geradoEm: new Date().toISOString(),
      erro: e.message
    };

    logger.error("[TEMPLATE-UNIVERSAL-ERRO]", {
      clienteId: contexto.clienteId || oferta.clienteId || "admin",
      marketplace: oferta.marketplace || contexto.marketplace || "",
      titulo: oferta.titulo || "",
      erro: e.message
    });
  }

  return oferta;
}

function aplicarPortaUniversalFila(oferta = {}, contexto = {}) {
  oferta = resolverImagemUniversal(oferta, { origem: contexto.origem || "fila_legacy" });
  const logger = contexto.logger || console;

  try {
    const {
      avaliarOfertaUniversal,
      normalizarOfertaUniversal
    } = getInteligenciaUniversal();

    const contextoUniversal = {
      origem: contexto.origem || oferta.origem || "fila",
      clienteId: contexto.clienteId || oferta.clienteId || "admin",
      marketplace: contexto.marketplace || oferta.marketplace || "",
      logger
    };

    const normalizada = normalizarOfertaUniversal(oferta, contextoUniversal);
    const avaliacao = avaliarOfertaUniversal(oferta, contextoUniversal);
    const score = avaliacao.score?.score ?? avaliacao.score ?? null;

    oferta.ofertaUniversal = true;
    oferta.versaoOfertaUniversal = "v2-oficial";
    oferta.inteligenciaUniversalV2 = {
      ativo: true,
      modo: "oficial",
      ok: avaliacao.ok === true,
      status: avaliacao.status || "avaliada",
      motivo: avaliacao.motivo || "",
      prioridade: avaliacao.prioridade ?? null,
      score,
      categoria: avaliacao.categoria || normalizada.categoria || oferta.categoria || "",
      valorEfetivo: avaliacao.valorEfetivo ?? null,
      valorEfetivoOrigem: avaliacao.valorEfetivoOrigem || "",
      logs: resumirLogsUniversais(avaliacao.logs)
    };

    const auditoriaCampos = {
      clienteId: contextoUniversal.clienteId,
      marketplace: normalizada.marketplace || oferta.marketplace || "",
      titulo: tituloCurto(normalizada.titulo || oferta.titulo || oferta.nome || ""),
      categoria: oferta.inteligenciaUniversalV2.categoria || "",
      precoAtual: normalizada.precoAtual ?? oferta.precoAtual ?? oferta.preco ?? "",
      precoAntigo: normalizada.precoOriginal ?? oferta.precoOriginal ?? oferta.precoAntigo ?? "",
      economia: economiaOferta(oferta, normalizada),
      cupom: normalizada.cupom || oferta.cupom || "",
      avaliacao: score,
      linkAfiliado: campoPresente(normalizada.linkAfiliado || oferta.linkAfiliado || oferta.linkFinal || oferta.link),
      beneficioComercial: temBeneficioComercial(oferta, avaliacao),
      origem: contextoUniversal.origem
    };

    logger.log("[OFERTA-UNIVERSAL-OFICIAL]", JSON.stringify({
      clienteId: contextoUniversal.clienteId,
      marketplace: normalizada.marketplace,
      titulo: normalizada.titulo,
      ok: oferta.inteligenciaUniversalV2.ok,
      status: oferta.inteligenciaUniversalV2.status,
      motivo: oferta.inteligenciaUniversalV2.motivo,
      prioridade: oferta.inteligenciaUniversalV2.prioridade,
      score: oferta.inteligenciaUniversalV2.score,
      categoria: oferta.inteligenciaUniversalV2.categoria,
      precoAtual: auditoriaCampos.precoAtual,
      precoAntigo: auditoriaCampos.precoAntigo,
      economia: auditoriaCampos.economia,
      cupom: auditoriaCampos.cupom,
      temLinkAfiliado: auditoriaCampos.linkAfiliado,
      beneficioComercial: auditoriaCampos.beneficioComercial,
      origem: contextoUniversal.origem
    }));

    logger.log("[ENGINE-V2-AUDITORIA-CAMPOS]", JSON.stringify({
      clienteId: auditoriaCampos.clienteId,
      marketplace: auditoriaCampos.marketplace,
      titulo: auditoriaCampos.titulo,
      origem: auditoriaCampos.origem,
      campos: {
        marketplace: campoPresente(auditoriaCampos.marketplace),
        titulo: campoPresente(auditoriaCampos.titulo),
        categoria: campoPresente(auditoriaCampos.categoria),
        precoAtual: campoPresente(auditoriaCampos.precoAtual),
        precoAntigo: campoPresente(auditoriaCampos.precoAntigo),
        economia: campoPresente(auditoriaCampos.economia),
        cupom: campoPresente(auditoriaCampos.cupom),
        avaliacao: campoPresente(auditoriaCampos.avaliacao),
        linkAfiliado: auditoriaCampos.linkAfiliado,
        beneficioComercial: auditoriaCampos.beneficioComercial
      }
    }));

    aplicarDecisaoEngineV2Oficial(oferta, contextoUniversal);

    const camposUniversaisSombra = montarOfertaTemplateUniversalSombra(
      oferta,
      normalizada,
      avaliacao
    );

    aplicarComparacaoV1V2Sombra(oferta, contextoUniversal, camposUniversaisSombra);
    aplicarTemplateUniversalSombra(oferta, contextoUniversal, camposUniversaisSombra);

    return oferta;
  } catch (e) {
    oferta.ofertaUniversal = true;
    oferta.versaoOfertaUniversal = "v2-oficial";
    oferta.inteligenciaUniversalV2 = montarMetadataUniversalErro(oferta, e);

    logger.error("[OFERTA-UNIVERSAL-ERRO]", {
      clienteId: contexto.clienteId || oferta.clienteId || "admin",
      marketplace: oferta.marketplace || "",
      titulo: oferta.titulo || oferta.nome || "",
      erro: e.message
    });

    aplicarTemplateUniversalSombra(oferta, contexto);
    const configEngineV2Erro = obterConfigEngineV2();
    logger.log("[ENGINE-V2-MODO]", JSON.stringify({
      modo: configEngineV2Erro.modo,
      clienteId: contexto.clienteId || oferta.clienteId || "admin",
      marketplace: oferta.marketplace || ""
    }));
    logger.log("[ENGINE-V2-FALLBACK-V1]", JSON.stringify({
      modo: configEngineV2Erro.modo,
      clienteId: contexto.clienteId || oferta.clienteId || "admin",
      marketplace: oferta.marketplace || "",
      motivo: e.message || "erro_v2"
    }));
    aplicarComparacaoV1V2Sombra(oferta, contexto);

    return oferta;
  }
}

function getFallbackFileSeguro(getFilaFile, clienteId = "admin") {
  if (typeof getFilaFile !== "function") {
    throw new Error("storage_fila_nao_injetado");
  }

  const file = getFilaFile(clienteId);
  const base = path.resolve(process.env.DATA_DIR || "/data");
  const resolvido = path.resolve(file);

  if (!resolvido.startsWith(`${base}${path.sep}`)) {
    throw new Error("caminho_fila_inseguro");
  }

  return resolvido;
}

function salvarFila({ fila = [], clienteId = "admin", getFilaFile, writeClienteJson, logger = console } = {}) {
  try {
    const filaCliente = fila.filter(
      o => String(o.clienteId || "admin") === String(clienteId)
    );

    if (typeof writeClienteJson === "function") {
      writeClienteJson(clienteId, "fila.json", filaCliente);
      return true;
    }

    const file = getFallbackFileSeguro(getFilaFile, clienteId);

    fs.writeFileSync(
      file,
      JSON.stringify(filaCliente, null, 2)
    );

    return true;
  } catch (e) {
    logger.error("ERRO AO SALVAR FILA:", e.message);
    return false;
  }
}

function carregarFila({ fila = [], clienteId = "admin", getFilaFile, readClienteJson, logger = console } = {}) {
  try {
    let filaCliente;

    if (typeof readClienteJson === "function") {
      filaCliente = readClienteJson(clienteId, "fila.json", []);
    } else {
      const file = getFallbackFileSeguro(getFilaFile, clienteId);

      if (!fs.existsSync(file)) {
        return fila;
      }

      const data = fs.readFileSync(file, "utf8");

      if (!data) {
        return fila;
      }

      filaCliente = JSON.parse(data);
    }

    const filaLimpa = filaCliente.filter(
      o => o?.clienteId
    );

    const filaSemCliente = fila.filter(
      o => String(o.clienteId || "admin") !== String(clienteId)
    );

    logger.log(`Fila carregada do cliente: ${clienteId}`);

    return [
      ...filaSemCliente,
      ...filaLimpa
    ];
  } catch (e) {
    logger.error("ERRO AO CARREGAR FILA:", e.message);
    return fila;
  }
}

function adicionarOfertaFila(fila = [], oferta, contexto = {}) {
  if (!oferta) return false;

  const ofertaFinal = aplicarPortaUniversalFila(oferta, {
    ...contexto,
    origem: contexto.origem || oferta.origem || "fila_push"
  });

  fila.push(ofertaFinal);

  const logger = contexto.logger || console;
  logger.log("[FILA-PORTA-UNIVERSAL]", {
    acao: "push",
    clienteId: ofertaFinal.clienteId || contexto.clienteId || "admin",
    marketplace: ofertaFinal.marketplace || "",
    ok: ofertaFinal.inteligenciaUniversalV2?.ok === true,
    status: ofertaFinal.inteligenciaUniversalV2?.status || ""
  });

  return true;
}

function adicionarOfertaInicioFila(fila = [], oferta, contexto = {}) {
  if (!oferta) return false;

  const ofertaFinal = aplicarPortaUniversalFila(oferta, {
    ...contexto,
    origem: contexto.origem || oferta.origem || "fila_unshift"
  });

  fila.unshift(ofertaFinal);

  const logger = contexto.logger || console;
  logger.log("[FILA-PORTA-UNIVERSAL]", {
    acao: "unshift",
    clienteId: ofertaFinal.clienteId || contexto.clienteId || "admin",
    marketplace: ofertaFinal.marketplace || "",
    ok: ofertaFinal.inteligenciaUniversalV2?.ok === true,
    status: ofertaFinal.inteligenciaUniversalV2?.status || ""
  });

  return true;
}

function buscarOfertaFila(fila = [], { id, clienteId = "admin", index } = {}) {
  if (index != null) {
    const oferta = fila[index];

    if (
      oferta &&
      String(oferta.clienteId || "admin") === String(clienteId)
    ) {
      return { oferta, index };
    }

    return { oferta: null, index: -1 };
  }

  const indexEncontrado = fila.findIndex(item =>
    String(item.id) === String(id) &&
    String(item.clienteId || "admin") === String(clienteId)
  );

  return {
    oferta: indexEncontrado >= 0 ? fila[indexEncontrado] : null,
    index: indexEncontrado
  };
}

function atualizarStatusFila(fila = [], { id, clienteId = "admin", status, statusDetalhe, erro, erroEm } = {}) {
  const resultado = buscarOfertaFila(fila, { id, clienteId });

  if (!resultado.oferta) return null;

  if (status != null) resultado.oferta.status = status;
  if (statusDetalhe != null) resultado.oferta.statusDetalhe = statusDetalhe;
  if (erro != null) resultado.oferta.erro = erro;
  if (erroEm != null) resultado.oferta.erroEm = erroEm;

  return resultado.oferta;
}

function limparFilaAntiga(fila = [], { clienteId = "admin", status = "" } = {}) {
  const antes = fila.length;

  const novaFila = fila.filter(item => {
    const dono = String(item.clienteId || "admin");

    const mesmoCliente =
      dono === String(clienteId);

    const mesmoStatus =
      status
        ? String(item.status) === String(status)
        : true;

    return !(mesmoCliente && mesmoStatus);
  });

  return {
    fila: novaFila,
    removidos: antes - novaFila.length
  };
}

module.exports = {
  adicionarOfertaFila,
  adicionarOfertaInicioFila,
  aplicarPortaUniversalFila,
  aplicarComparacaoV1V2Sombra,
  aplicarTemplateUniversalSombra,
  atualizarStatusFila,
  salvarFila,
  limparFilaAntiga,
  buscarOfertaFila,
  carregarFila
};
