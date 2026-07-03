const path = require("path");
const { getEnginePool, engineDbHabilitado } = require("../database");
const { limitarJobs } = require("../processor.service");
const { normalizarTexto } = require("../normalizers");
const {
  clienteValidoEngine,
  marketplaceAtivoClienteEngine
} = require("../validator.service");
const filaOfertas = require("../../../utils/fila-ofertas");
const destinosUtils = require("../../../utils/destinos");


function logQueryErroDistribuidor({ etapa = "", ofertaId = null, jobId = null, clienteId = "", err = null, resultado = {}, queryResumo = "" } = {}) {
  console.log("[ENGINE-DISTRIBUIDOR-QUERY-ERRO]", {
    etapa,
    ofertaId,
    jobId,
    clienteId,
    erroMessage: err?.message || resultado.erro || resultado.message || "",
    erroCode: err?.code || resultado.erroCode || resultado.code || resultado.codigo || "",
    erroDetail: err?.detail || resultado.erroDetail || resultado.detail || "",
    erroHint: err?.hint || resultado.erroHint || resultado.hint || "",
    queryResumo
  });
}

async function queryDistribuidor({ etapa = "", ofertaId = null, jobId = null, clienteId = "", queryResumo = "", sql = "", params = [] } = {}) {
  const pool = getEnginePool();
  if (!pool) {
    const resultado = {
      ok: false,
      motivo: engineDbHabilitado() ? "pool_indisponivel" : "database_url_ausente",
      erro: engineDbHabilitado() ? "pool_indisponivel" : "database_url_ausente"
    };
    logQueryErroDistribuidor({ etapa, ofertaId, jobId, clienteId, resultado, queryResumo });
    return resultado;
  }

  try {
    const resultado = await pool.query(sql, params);
    return { ok: true, resultado };
  } catch (err) {
    logQueryErroDistribuidor({ etapa, ofertaId, jobId, clienteId, err, queryResumo });
    return {
      ok: false,
      motivo: "query_falhou",
      erro: err.message,
      erroCode: err.code || "",
      erroDetail: err.detail || "",
      erroHint: err.hint || ""
    };
  }
}
function normalizarMarketplace(valor = "") {
  return normalizarTexto(valor).toLowerCase();
}

function limitarDistribuicao(valor = 10) {
  return limitarJobs(valor || 10);
}

function normalizarChave(valor = "") {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function numeroComparavel(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2) : String(valor || "").trim();
}

function ofertaJaExisteNaFila(fila = [], oferta = {}) {
  const clienteId = String(oferta.cliente_id || oferta.clienteId || "").trim();
  const linkOriginal = normalizarChave(oferta.link_original || oferta.linkOriginal || "");
  const linkAfiliado = normalizarChave(oferta.link_afiliado || oferta.linkAfiliado || "");
  const titulo = normalizarChave(oferta.titulo || oferta.nome || "");
  const preco = numeroComparavel(oferta.preco || oferta.precoAtual);

  return fila.some(item => {
    if (String(item?.clienteId || "") !== clienteId) return false;

    const itemLinkOriginal = normalizarChave(item.linkOriginal || item.link_original || "");
    const itemLinkAfiliado = normalizarChave(item.linkAfiliado || item.link || item.linkFinal || "");
    const itemTitulo = normalizarChave(item.titulo || item.nome || "");
    const itemPreco = numeroComparavel(item.preco || item.precoAtual);

    if (linkOriginal && (linkOriginal === itemLinkOriginal || linkOriginal === itemLinkAfiliado)) return true;
    if (linkAfiliado && (linkAfiliado === itemLinkAfiliado || linkAfiliado === itemLinkOriginal)) return true;
    return Boolean(titulo && preco && titulo === itemTitulo && preco === itemPreco);
  });
}

function getFilaFileSeguro(deps = {}, clienteId = "admin") {
  if (typeof deps.getFilaFile === "function") return deps.getFilaFile(clienteId);
  if (typeof deps.getClientePath === "function") return path.join(deps.getClientePath(clienteId), "fila.json");
  return path.join(process.env.DATA_DIR || "/data", "clientes", String(clienteId || "admin"), "fila.json");
}

function carregarFilaCliente(clienteId = "admin", deps = {}) {
  return filaOfertas.carregarFila({
    fila: [],
    clienteId,
    getFilaFile: id => getFilaFileSeguro(deps, id),
    readClienteJson: deps.readClienteJson,
    logger: console
  }).filter(item => String(item?.clienteId || "") === String(clienteId));
}

function salvarFilaCliente(clienteId = "admin", filaCliente = [], deps = {}) {
  return filaOfertas.salvarFila({
    fila: filaCliente,
    clienteId,
    getFilaFile: id => getFilaFileSeguro(deps, id),
    writeClienteJson: deps.writeClienteJson,
    logger: console
  });
}

function obterDestinosCliente(clienteId = "admin", contexto = {}) {
  const destinosCliente = contexto.destinosPorCliente?.[clienteId];
  if (Array.isArray(destinosCliente)) return destinosCliente;
  if (destinosCliente && typeof destinosCliente === "object") {
    return Object.values(destinosCliente).filter(Array.isArray).flat();
  }

  const configCliente = contexto.configsPorCliente?.[clienteId] || {};
  if (Array.isArray(configCliente.destinosInteligentes)) return configCliente.destinosInteligentes;
  if (Array.isArray(configCliente.destinos)) return configCliente.destinos;
  if (Array.isArray(contexto.configGlobal?.destinosInteligentes)) return contexto.configGlobal.destinosInteligentes;
  return [];
}

function analisarDestinosOferta(clienteId = "admin", oferta = {}, contexto = {}) {
  const destinos = obterDestinosCliente(clienteId, contexto);
  const compativeis = [];
  const rejeitados = [];

  for (const destino of destinos) {
    const analise = destinosUtils.analisarDestinoOferta(destino, {
      marketplace: oferta.marketplace,
      categoria: oferta.categoria,
      categoriaProduto: oferta.categoria,
      titulo: oferta.titulo,
      termo: oferta.titulo
    });

    if (analise.aceita) compativeis.push({ destino, analise });
    else rejeitados.push({ destino, analise });
  }

  return { destinos, compativeis, rejeitados };
}

function categoriasDestinoRetencao(destinos = []) {
  const categorias = new Set();

  for (const destino of Array.isArray(destinos) ? destinos : []) {
    const lista = destino?.categorias || destino?.categoriasPermitidas || [];
    for (const categoria of Array.isArray(lista) ? lista : []) {
      const texto = normalizarTexto(categoria);
      if (texto) categorias.add(texto);
    }
  }

  return [...categorias];
}
function motivoDestinoRetido(analise = {}) {
  if (!analise.destinos.length) return "sem_destino";
  if (analise.rejeitados.length && analise.rejeitados.every(item => item.analise?.motivo === "marketplace")) return "marketplace_bloqueado";
  if (analise.rejeitados.length && analise.rejeitados.every(item => item.analise?.motivo === "categoria")) return "categoria_bloqueada";
  return "sem_destino";
}

function montarItemFilaEngine(oferta = {}) {
  const linkAfiliado = normalizarTexto(oferta.link_afiliado || oferta.link_expandido || oferta.link_original || "");
  const linkOriginal = normalizarTexto(oferta.link_original || oferta.link_expandido || linkAfiliado || "");
  const titulo = normalizarTexto(oferta.titulo || "");
  const cupom = normalizarTexto(oferta.cupom || "");
  const cupomTipo = normalizarTexto(oferta.tipo_cupom || oferta.cupomTipo || oferta.tipoCupom || "");
  const beneficioExtra = normalizarTexto(oferta.beneficio_extra || oferta.beneficioExtra || "");
  const avisoCupom = normalizarTexto(oferta.aviso_cupom || oferta.avisoCupom || "");

  return {
    id: `engine_${oferta.id}_${Date.now()}`,
    engineOfertaId: oferta.id,
    engineOfertaUuid: oferta.uuid,
    engineJobId: oferta.job_id,
    clienteId: normalizarTexto(oferta.cliente_id),
    marketplace: normalizarMarketplace(oferta.marketplace),
    titulo,
    nome: titulo,
    preco: oferta.preco,
    precoAtual: oferta.preco,
    precoOriginal: oferta.preco_original,
    imagem: normalizarTexto(oferta.imagem || ""),
    linkOriginal,
    linkAfiliado,
    link: linkAfiliado,
    linkFinal: linkAfiliado,
    categoria: normalizarTexto(oferta.categoria || ""),
    score: oferta.score,
    cupom,
    tipoCupom: cupomTipo,
    cupomTipo,
    avisoCupom,
    beneficioExtra,
    beneficioTexto: beneficioExtra,
    origem: "engine",
    origemDetalhe: "Engine V2",
    status: "pendente",
    statusDetalhe: "Aguardando envio",
    destinosEnviados: [],
    logsEnvio: [],
    enviadoEm: "",
    dataEnvio: "",
    criadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    dataEntradaFila: new Date().toISOString()
  };
}

async function buscarOfertasDistribuiveis({ limite = 10, marketplace = "", clienteId = "" } = {}) {
  const params = [];
  const filtros = ["o.status IN ('importada', 'oferta_criada')"];

  if (marketplace) {
    params.push(normalizarMarketplace(marketplace));
    filtros.push(`LOWER(COALESCE(o.marketplace, '')) = $${params.length}`);
  }

  if (clienteId) {
    params.push(String(clienteId).trim());
    filtros.push(`j.cliente_id = $${params.length}`);
  }

  params.push(limitarDistribuicao(limite));

  const resultado = await queryDistribuidor({
    etapa: "buscar_ofertas_distribuiveis",
    queryResumo: "SELECT engine_ofertas JOIN engine_jobs_cliente",
    sql: `SELECT o.id, o.uuid, o.evento_id, o.link_id, o.marketplace, o.titulo,
            o.preco, o.preco_original, o.cupom, o.tipo_cupom, o.beneficio_extra,
            o.imagem, o.link_original, o.link_expandido,
            o.link_afiliado, o.categoria, o.score, o.status, o.motivo_status,
            o.criada_em, o.atualizada_em, j.id AS job_id, j.cliente_id
       FROM engine_ofertas o
       JOIN engine_jobs_cliente j ON j.oferta_id = o.id
      WHERE ${filtros.join(" AND ")}
      ORDER BY o.atualizada_em ASC NULLS FIRST, o.id ASC
      LIMIT $${params.length}`,
    params
  });

  if (!resultado.ok) {
    return { ok: false, ofertas: [], motivo: resultado.motivo, erro: resultado.erro, erroCode: resultado.erroCode || "" };
  }
  return { ok: true, ofertas: resultado.resultado.rows };
}

async function tentarMarcarDistribuindo(ofertaId, contextoLog = {}) {
  const resultado = await queryDistribuidor({
    etapa: "marcar_distribuindo",
    ofertaId,
    queryResumo: "UPDATE engine_ofertas SET status = distribuindo",
    sql: `UPDATE engine_ofertas
        SET status = 'distribuindo', motivo_status = NULL, atualizada_em = NOW()
      WHERE id = $1 AND status IN ('importada', 'oferta_criada')
      RETURNING id, status`,
    params: [ofertaId]
  });

  if (!resultado.ok) {
    return { ok: false, motivo: resultado.motivo, erro: resultado.erro, erroCode: resultado.erroCode || "" };
  }
  return { ok: resultado.resultado.rowCount > 0, ignorado: resultado.resultado.rowCount === 0 };
}

async function marcarOfertaStatus(ofertaId, status, motivo = "", contextoLog = {}) {
  const resultado = await queryDistribuidor({
    etapa: "marcar_status_oferta",
    ofertaId,
    clienteId: contextoLog.clienteId || "",
    queryResumo: "UPDATE engine_ofertas SET status/motivo_status",
    sql: `UPDATE engine_ofertas
        SET status = $2, motivo_status = $3, atualizada_em = NOW()
      WHERE id = $1
      RETURNING id, status, motivo_status`,
    params: [ofertaId, status, motivo || null]
  });

  return resultado;
}

async function registrarEtapaDistribuicao(jobId, etapa, status, motivo = "", detalhes = {}) {
  if (!jobId) {
    logQueryErroDistribuidor({
      etapa,
      jobId,
      ofertaId: detalhes.ofertaId || null,
      clienteId: detalhes.clienteId || "",
      resultado: { erro: "job_id_ausente" },
      queryResumo: "INSERT engine_processamentos"
    });
    return { ok: false, motivo: "job_id_ausente" };
  }

  return queryDistribuidor({
    etapa,
    jobId,
    ofertaId: detalhes.ofertaId || null,
    clienteId: detalhes.clienteId || "",
    queryResumo: "INSERT engine_processamentos",
    sql: `INSERT INTO engine_processamentos (job_id, etapa, status, motivo, detalhes)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    params: [jobId, etapa, status, motivo || null, JSON.stringify({ ...(detalhes || {}), fase: "distribuicao" })]
  });
}

async function validarOfertaParaDistribuicao(oferta = {}, contexto = {}) {
  const clienteId = normalizarTexto(oferta.cliente_id);
  const marketplace = normalizarMarketplace(oferta.marketplace);
  const configCliente = contexto.configsPorCliente?.[clienteId] || {};

  if (!clienteValidoEngine(clienteId, contexto.clientesValidos || [])) {
    return { ok: false, motivo: "cliente_invalido" };
  }

  if (configCliente.automacaoAtiva !== true) {
    return { ok: false, motivo: "automacao_desligada" };
  }

  if (!marketplaceAtivoClienteEngine(clienteId, marketplace, contexto.marketplacesAtivosPorCliente || {})) {
    return { ok: false, motivo: "marketplace_bloqueado" };
  }

  if (!normalizarTexto(oferta.categoria)) {
    return { ok: false, motivo: "categoria_bloqueada" };
  }

  if (typeof contexto.validarCreditos === "function") {
    const creditos = await contexto.validarCreditos(clienteId, oferta);
    if (creditos?.ok === false) return { ok: false, motivo: creditos.motivo || "creditos_insuficientes" };
  }

  const destinos = analisarDestinosOferta(clienteId, oferta, contexto);
  if (!destinos.compativeis.length) {
    return {
      ok: false,
      motivo: motivoDestinoRetido(destinos),
      detalhes: {
        destinosTotal: destinos.destinos.length,
        rejeitados: destinos.rejeitados.map(item => item.analise?.motivo || "")
      }
    };
  }

  return {
    ok: true,
    destinosCompativeis: destinos.compativeis.length,
    destinosTotal: destinos.destinos.length,
    destinosCompativeisDetalhes: destinos.compativeis.map(item => ({
      destino: item.destino?.nome || item.destino?.id || item.destino?.destinoId || "",
      tipoMidia: item.destino?.tipoMidia || ""
    }))
  };
}

async function adicionarOfertaNaFilaCliente(oferta = {}, contexto = {}) {
  const clienteId = normalizarTexto(oferta.cliente_id);
  const deps = contexto.deps || {};
  const itemFila = montarItemFilaEngine(oferta);

  console.log("[ENGINE-DISTRIBUIDOR-IMAGEM-AUDITORIA]", {
    etapa: "montar_item_fila",
    marketplace: normalizarMarketplace(oferta.marketplace),
    ofertaId: oferta.id,
    jobId: oferta.job_id,
    clienteId,
    temImagem: Boolean(itemFila.imagem),
    imagemPreview: normalizarTexto(itemFila.imagem || "").slice(0, 140),
    destino: "",
    tipoMidia: ""
  });

  if (typeof deps.adicionarOfertaNaFilaGlobal === "function") {
    const resultadoMemoria = deps.adicionarOfertaNaFilaGlobal(clienteId, itemFila);

    if (resultadoMemoria?.duplicada) {
      console.log("[ENGINE-DISTRIBUIDOR-FILA-DUPLICADA]", {
        clienteId,
        ofertaId: oferta.id,
        itemId: itemFila.id,
        motivo: "duplicidade_fila"
      });
      return { ok: false, motivo: "duplicidade_fila", itemFila };
    }

    if (!resultadoMemoria?.ok) {
      return { ok: false, motivo: resultadoMemoria?.motivo || "erro_fila", erro: resultadoMemoria?.erro || "" };
    }

    console.log("[ENGINE-DISTRIBUIDOR-FILA-MEMORIA]", {
      clienteId,
      ofertaId: oferta.id,
      itemId: resultadoMemoria.itemFila?.id || itemFila.id
    });

    return { ok: true, itemFila: resultadoMemoria.itemFila || itemFila };
  }

  const filaCliente = carregarFilaCliente(clienteId, deps);

  if (ofertaJaExisteNaFila(filaCliente, oferta)) {
    return { ok: false, motivo: "duplicidade_fila" };
  }

  const adicionou = filaOfertas.adicionarOfertaFila(filaCliente, itemFila);
  if (!adicionou) return { ok: false, motivo: "erro_fila" };

  const salvou = salvarFilaCliente(clienteId, filaCliente, deps);
  if (!salvou) return { ok: false, motivo: "erro_fila" };

  return { ok: true, itemFila };
}

module.exports = {
  limitarDistribuicao,
  buscarOfertasDistribuiveis,
  tentarMarcarDistribuindo,
  marcarOfertaStatus,
  registrarEtapaDistribuicao,
  validarOfertaParaDistribuicao,
  adicionarOfertaNaFilaCliente,
  montarItemFilaEngine,
  ofertaJaExisteNaFila
};