const { queryEngine } = require("../database");
const { normalizarNumeroMoeda } = require("../../../utils/moeda");
const {
  marcarJobStatus,
  registrarProcessamento,
  carregarEventoBruto,
  carregarLinksEvento,
  limitarJobs
} = require("../processor.service");
const {
  calcularCotasFrescorPreImporter
} = require("../frescor-pre-importer.service");
const { normalizarTexto } = require("../normalizers");
const { classificarCategoriaOferta } = require("../../../marketplaces/inteligencia/classificador-categorias");
const {
  htmlDecode,
  extrairMeta,
  extrairJsonLd,
  corrigirImagemUrl
} = require("../../../marketplaces/mercadolivre/utils");
const {
  avaliarOfertaUniversal,
  detectarIdentidadeProdutoUniversal
} = require("../../inteligencia-universal");
const {
  resolverImagemUniversal,
  imagemUrlEfemeraUniversal,
  imagemUrlValidaUniversal
} = require("../../imagens/resolver-imagem-universal");
const {
  resolverImagemCanonicaFinalEvento
} = require("../../imagens/cache-canonico-evento");
const socialMediaStorage = require("../../social/social-media-storage");
const {
  compararRadarMirrorComImportador,
  mergeRadarMirrorMetadata,
  resumirRadarMirrorLog
} = require("../../radar/radar-mirror");
const {
  resolverPrecedenciaComercialRadar,
  resumirPrecedenciaComercialLog,
  deveLogarDivergenciaComercial,
  emitirLogRadarPrecoSuspeito,
  tituloComercialUniversalValido
} = require("../../radar/comercial-precedencia");
const { validarCoerenciaPreco } = require("../../inteligencia-universal/preco-coerencia.service");
const {
  logEngineImporterErro,
  logEngineImporterOfertaCriada
} = require("../logger");
const {
  montarOfertaUniversalEngine,
  validarContratoOfertaUniversal,
  congelarOfertaUniversal,
  resumoOfertaUniversalLog
} = require("../oferta-universal.contract");
const { normalizarDadosComerciais } = require("../../ofc-v2/normalizador-comercial");
const {
  construirEspelhoComercialV24FailOpen,
  resumoEspelhoComercialLog
} = require("../../ofc-v2/espelho-comercial");
const fidelidadeObs = require("../../fidelidade/observabilidade-v1");
const coberturaRadar = require("../../radar/cobertura-v1");
const {
  registrarOfertaUniversalCriada
} = require("../ofc/commercial-events.service");
const { classificarLinkEngine } = require("../link-role.service");

let engineOfertasMetadataDisponivel = null;

async function engineOfertasTemMetadata() {
  if (engineOfertasMetadataDisponivel !== null) return engineOfertasMetadataDisponivel;

  const resultado = await queryEngine(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_name = 'engine_ofertas'
          AND column_name = 'metadata'
     ) AS existe`
  );

  engineOfertasMetadataDisponivel = Boolean(resultado.ok && resultado.resultado.rows[0]?.existe);
  return engineOfertasMetadataDisponivel;
}

function normalizarNumero(valor = null) {
  return normalizarNumeroMoeda(valor);
}

function categoriaGenericaEngine(categoria = "") {
  const texto = normalizarTexto(categoria)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return !texto
    || texto === "mercadolivre"
    || texto === "ml"
    || texto === "marketplace"
    || texto === "generica"
    || texto === "geral"
    || texto === "diversos"
    || texto === "aliexpress"
    || texto === "awin"
    || texto === "kabum";
}

function resolverCategoriaEngine(resultado = {}, job = {}) {
  const categoria = normalizarTexto(resultado.categoria || resultado.categoriaProduto || "");
  if (!categoriaGenericaEngine(categoria)) return categoria;

  const titulo = normalizarTexto(resultado.titulo || resultado.nome || "");
  return classificarCategoriaOferta({
    titulo,
    nome: titulo,
    marketplace: resultado.marketplace || job.marketplace || job.marketplace_detectado || ""
  }, titulo);
}

function tituloGenericoMarketplaceEngine(titulo = "", marketplace = "") {
  const tituloLimpo = normalizarTexto(titulo);
  if (!tituloComercialUniversalValido(tituloLimpo, { marketplace })) return true;
  const chaveTitulo = tituloLimpo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  const chaveMarketplace = normalizarTexto(marketplace)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  if (chaveMarketplace === "aliexpress") {
    return ["produtoaliexpress", "ofertaaliexpress", "aliexpress"].includes(chaveTitulo);
  }
  return false;
}

function reclassificarCategoriaFinalEngine(oferta = {}, metadataFinal = {}, job = {}) {
  const marketplace = normalizarTexto(oferta.marketplace || job.marketplace || job.marketplace_detectado || "");
  const marketplaceChave = marketplace
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  if (marketplaceChave !== "aliexpress") {
    return { oferta, metadataFinal, reclassificada: false, motivo: "marketplace_nao_alvo" };
  }

  const categoriaAnterior = normalizarTexto(oferta.categoria || "");
  if (!categoriaGenericaEngine(categoriaAnterior)) {
    return { oferta, metadataFinal, reclassificada: false, motivo: "categoria_especifica_preservada" };
  }

  const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");
  if (tituloGenericoMarketplaceEngine(titulo, marketplaceChave)) {
    return { oferta, metadataFinal, reclassificada: false, motivo: "titulo_generico_indisponivel" };
  }

  const categoriaFinal = classificarCategoriaOferta({
    titulo,
    nome: titulo,
    marketplace,
    categoria: ""
  }, titulo);

  if (!categoriaFinal || categoriaGenericaEngine(categoriaFinal)) {
    return { oferta, metadataFinal, reclassificada: false, motivo: "classificador_sem_categoria_confiavel" };
  }

  const inteligencia = objetoSeguro(metadataFinal.inteligenciaUniversalV2);
  const comparativo = objetoSeguro(inteligencia.comparativo);

  return {
    oferta: { ...oferta, categoria: categoriaFinal },
    metadataFinal: {
      ...metadataFinal,
      inteligenciaUniversalV2: {
        ...inteligencia,
        categoria: categoriaFinal,
        comparativo: {
          ...comparativo,
          categoriaDepois: categoriaFinal
        }
      }
    },
    reclassificada: true,
    motivo: "titulo_final_radar",
    categoriaAnterior,
    categoriaFinal
  };
}
function normalizarTitulo(titulo = "") {
  return normalizarTexto(titulo)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizarValorImagem(valor) {
  if (typeof valor === "string") return normalizarTexto(valor);
  if (Array.isArray(valor)) {
    for (const item of valor) {
      const imagem = normalizarValorImagem(item);
      if (imagem) return imagem;
    }
    return "";
  }
  if (!valor || typeof valor !== "object") return "";
  return normalizarTexto(
    valor.url ||
    valor.src ||
    valor.imagem ||
    valor.image ||
    valor.thumbnail ||
    valor.imagemUrl ||
    valor.imageUrl ||
    valor.urlImagem ||
    valor.picture ||
    valor.pictureUrl ||
    ""
  );
}

function resolverImagemImportada(resultado = {}, produtoMetadata = {}) {
  const candidatos = [
    ["resultado.imagem", resultado.imagem],
    ["resultado.image", resultado.image],
    ["resultado.thumbnail", resultado.thumbnail],
    ["resultado.imagemUrl", resultado.imagemUrl],
    ["resultado.foto", resultado.foto],
    ["resultado.midia", resultado.midia],
    ["metadata.produto.imagem", produtoMetadata.imagem],
    ["metadata.produto.image", produtoMetadata.image],
    ["metadata.produto.thumbnail", produtoMetadata.thumbnail],
    ["metadata.produto.imagemUrl", produtoMetadata.imagemUrl],
    ["metadata.produto.foto", produtoMetadata.foto],
    ["metadata.produto.midia", produtoMetadata.midia]
  ];

  for (const [campo, valor] of candidatos) {
    const imagem = normalizarValorImagem(valor);
    if (imagem) return { imagem, campo };
  }

  return { imagem: "", campo: "" };
}

function adicionarCandidatoImagem(candidatos = [], origem = "", valor = "", tipo = "fallback") {
  const imagem = normalizarValorImagem(valor);
  if (!imagem) return;
  candidatos.push({ imagem, origem, tipo });
}

function adicionarCamposImagem(candidatos = [], prefixo = "", fonte = {}, tipo = "fallback") {
  const objeto = objetoSeguro(fonte);
  const camposDiretos = [
    "imagem",
    "image",
    "thumbnail",
    "imagemUrl",
    "imageUrl",
    "urlImagem",
    "foto",
    "midia",
    "imagemRadar",
    "imagemOriginal",
    "imageOriginal",
    "picture",
    "pictureUrl"
  ];
  const camposAlternativos = [
    "imagens",
    "images",
    "imageUrls",
    "image_urls",
    "fotos",
    "thumbnails",
    "galeria",
    "pictures",
    "imagensAlternativas",
    "alternativeImages",
    "product_small_image_urls"
  ];

  for (const campo of camposDiretos) {
    adicionarCandidatoImagem(candidatos, `${prefixo}.${campo}`, objeto[campo], tipo);
  }

  for (const campo of camposAlternativos) {
    adicionarCandidatoImagem(candidatos, `${prefixo}.${campo}`, objeto[campo], "fallback_alternativo");
  }
}

function resolverImagemEngineFallback({ oferta = {}, ofertaEntrada = {}, evento = {}, job = {}, link = {} } = {}) {
  const candidatos = [];
  const metadataEntrada = objetoSeguro(ofertaEntrada.metadata);
  const produtoMetadata = objetoSeguro(metadataEntrada.produto);
  const eventoMetadata = objetoSeguro(evento.metadata);
  const jobMetadata = objetoSeguro(job.metadata);
  const linkMetadata = objetoSeguro(link.metadata);

  adicionarCandidatoImagem(candidatos, "engine_ofertas.imagem", oferta.imagem, "principal");

  adicionarCamposImagem(candidatos, "resultado", ofertaEntrada, "principal");
  adicionarCamposImagem(candidatos, "metadata.produto", produtoMetadata, "principal");

  adicionarCamposImagem(candidatos, "evento.metadata", eventoMetadata, "fallback_radar");
  adicionarCamposImagem(candidatos, "link.metadata", linkMetadata, "fallback_radar");

  adicionarCamposImagem(candidatos, "job.metadata", jobMetadata, "fallback_job");
  adicionarCandidatoImagem(candidatos, "job.metadata.imagemRadar", jobMetadata.imagemRadar, "fallback_job");
  adicionarCandidatoImagem(candidatos, "job.metadata.imagemEventoOriginal", jobMetadata.imagemEventoOriginal, "fallback_job");
  adicionarCamposImagem(candidatos, "job.metadata.metadataEvento", objetoSeguro(jobMetadata.metadataEvento), "fallback_job");
  adicionarCamposImagem(candidatos, "metadata.importacao", metadataEntrada, "fallback_importacao");

  const primeiro = candidatos.find(item => item.imagem);
  if (!primeiro) {
    return {
      imagem: "",
      origem: "",
      tipo: "ausente",
      fallbackUsado: false,
      motivo: "nenhuma_fonte_de_imagem"
    };
  }

  return {
    imagem: primeiro.imagem,
    origem: primeiro.origem,
    tipo: primeiro.tipo,
    fallbackUsado: primeiro.tipo !== "principal",
    motivo: ""
  };
}

function logResolucaoImagemEngine({ job = {}, oferta = {}, resolucao = {}, motivoSemImagem = "" } = {}) {
  const base = {
    jobId: job.id || null,
    clienteId: job.cliente_id || job.clienteId || "",
    marketplace: oferta.marketplace || job.marketplace || job.marketplace_detectado || "",
    titulo: oferta.titulo || "",
    origem: resolucao.origem || oferta.imagemOrigem || "nenhuma",
    fallbackUsado: resolucao.fallbackUsado === true,
    motivo: motivoSemImagem || resolucao.motivo || ""
  };

  if (oferta.imagem && resolucao.fallbackUsado === true) {
    console.log("[ENGINE-IMAGEM-FALLBACK-USADO]", JSON.stringify(base));
    return;
  }

  if (oferta.imagem) {
    console.log("[ENGINE-IMAGEM-ORIGEM]", JSON.stringify(base));
    return;
  }

  console.log("[ENGINE-IMAGEM-AUSENTE]", JSON.stringify(base));
}

async function buscarJobsProntos({ limite = 10, marketplace = "" } = {}) {
  const params = [];
  const filtros = ["j.status = 'pronto_para_importar'"];
  const marketplaceExpr = "LOWER(COALESCE(NULLIF(TRIM(marketplace), ''), NULLIF(TRIM(marketplace_detectado), ''), ''))";
  const marketplaceExprJob = "LOWER(COALESCE(NULLIF(TRIM(j.marketplace), ''), NULLIF(TRIM(j.marketplace_detectado), ''), ''))";
  const marketplaceFiltro = String(marketplace || "").trim().toLowerCase();
  const cotas = calcularCotasFrescorPreImporter(limite);

  if (marketplaceFiltro) {
    params.push(marketplaceFiltro);
    filtros.push(`${marketplaceExprJob} = $${params.length}`);
  }

  params.push(cotas.aguaNova);
  const paramAguaNova = params.length;
  params.push(cotas.frescaEmRisco);
  const paramFrescaEmRisco = params.length;
  params.push(cotas.frescaCirculavel);
  const paramFrescaCirculavel = params.length;
  params.push(cotas.limpeza);
  const paramLimpeza = params.length;
  params.push(cotas.totalSelecao);
  const paramLimite = params.length;

  const resultado = await queryEngine(
    `WITH base AS (
       SELECT j.id, j.uuid, j.evento_id, j.oferta_id, j.cliente_id, j.marketplace_detectado,
              j.marketplace, j.status, j.motivo_final, j.metadata, j.prioridade,
              j.criado_em, j.atualizado_em,
              e.capturado_em AS evento_capturado_em,
              e.criado_em AS evento_criado_em,
              e.origem AS evento_origem,
              e.origem_tipo AS evento_origem_tipo,
              e.metadata AS evento_metadata,
              COALESCE(e.capturado_em, j.criado_em) AS origem_comercial_pre_importer,
              CASE
                WHEN COALESCE(e.capturado_em, j.criado_em) < NOW() - INTERVAL '30 minutes' THEN 1
                ELSE 0
              END AS bucket_frescor_pre_importer,
              CASE
                WHEN COALESCE(e.capturado_em, j.criado_em) < NOW() - INTERVAL '30 minutes' THEN 'expirada'
                WHEN COALESCE(e.capturado_em, j.criado_em) >= NOW() - INTERVAL '5 minutes' THEN 'agua_nova'
                WHEN COALESCE(e.capturado_em, j.criado_em) < NOW() - INTERVAL '20 minutes' THEN 'fresca_em_risco'
                ELSE 'fresca_circulavel'
              END AS lane_vazao_pre_importer
         FROM engine_jobs_cliente j
         LEFT JOIN engine_eventos_brutos e ON e.id = j.evento_id
        WHERE ${filtros.join(" AND ")}
     ),
     agua_nova_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, atualizado_em DESC NULLS LAST, id ASC
              ) AS workspace_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'agua_nova'
     ),
     agua_nova AS (
       SELECT *, 0 AS bucket_selecao_pre_importer
         FROM agua_nova_ranked
        ORDER BY workspace_rank_pre_importer ASC, COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, atualizado_em DESC NULLS LAST, id ASC
        LIMIT $${paramAguaNova}
     ),
     fresca_em_risco_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
              ) AS workspace_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'fresca_em_risco'
     ),
     fresca_em_risco AS (
       SELECT *, 1 AS bucket_selecao_pre_importer
         FROM fresca_em_risco_ranked
        ORDER BY workspace_rank_pre_importer ASC, COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
        LIMIT $${paramFrescaEmRisco}
     ),
     fresca_circulavel_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, atualizado_em DESC NULLS LAST, id ASC
              ) AS workspace_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'fresca_circulavel'
     ),
     fresca_circulavel AS (
       SELECT *, 2 AS bucket_selecao_pre_importer
         FROM fresca_circulavel_ranked
        ORDER BY workspace_rank_pre_importer ASC, COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, atualizado_em DESC NULLS LAST, id ASC
        LIMIT $${paramFrescaCirculavel}
     ),
     limpeza_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
              ) AS workspace_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'expirada'
     ),
     limpeza AS (
       SELECT *, 3 AS bucket_selecao_pre_importer
         FROM limpeza_ranked
        ORDER BY workspace_rank_pre_importer ASC, origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
        LIMIT $${paramLimpeza}
     )
     SELECT *
       FROM (
         SELECT * FROM agua_nova
         UNION ALL
         SELECT * FROM fresca_em_risco
         UNION ALL
         SELECT * FROM fresca_circulavel
         UNION ALL
         SELECT * FROM limpeza
       ) selecionados
      ORDER BY bucket_selecao_pre_importer ASC,
               workspace_rank_pre_importer ASC,
               COALESCE(prioridade, 0) DESC,
               CASE WHEN lane_vazao_pre_importer = 'fresca_em_risco' THEN origem_comercial_pre_importer END ASC NULLS LAST,
               CASE WHEN lane_vazao_pre_importer <> 'fresca_em_risco' THEN origem_comercial_pre_importer END DESC NULLS LAST,
               atualizado_em DESC NULLS LAST,
               id ASC
      LIMIT $${paramLimite}`,
    params
  );

  const resumoMarketplace = await queryEngine(
    `SELECT ${marketplaceExpr} AS marketplace, COUNT(*)::int AS total
       FROM engine_jobs_cliente
      WHERE status = 'pronto_para_importar'
      GROUP BY ${marketplaceExpr}
      ORDER BY total DESC, marketplace ASC
      LIMIT 20`
  );

  const amostra = await queryEngine(
    `SELECT id, cliente_id, marketplace, marketplace_detectado, status, motivo_final,
            atualizado_em
       FROM engine_jobs_cliente
      WHERE status = 'pronto_para_importar'
      ORDER BY atualizado_em ASC NULLS FIRST, id ASC
      LIMIT 5`
  );

  console.log("[ENGINE-IMPORTER-BUSCA-JOBS]", {
    statusBuscado: "pronto_para_importar",
    marketplaceFiltro,
    totalEncontrados: resultado.ok ? resultado.resultado.rows.length : 0,
    totalProntoPorMarketplace: resumoMarketplace.ok ? resumoMarketplace.resultado.rows : [],
    amostraJobs: amostra.ok ? amostra.resultado.rows : [],
    erro: resultado.ok ? "" : (resultado.erro || resultado.motivo || "")
  });

  if (!resultado.ok) return { ok: false, jobs: [], motivo: resultado.motivo, erro: resultado.erro };
  return { ok: true, jobs: resultado.resultado.rows };
}
async function tentarMarcarImportando(jobId) {
  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET status = 'importando', atualizado_em = NOW()
      WHERE id = $1 AND status = 'pronto_para_importar'
      RETURNING id, status`,
    [jobId]
  );

  if (!resultado.ok) return { ok: false, motivo: resultado.motivo, erro: resultado.erro };
  return { ok: resultado.resultado.rowCount > 0, ignorado: resultado.resultado.rowCount === 0 };
}

async function registrarEtapaImportacao(jobId, etapa, status, motivo = "", detalhes = {}) {
  return registrarProcessamento(jobId, etapa, status, motivo, {
    ...detalhes,
    fase: "importacao"
  });
}

function normalizarOfertaImportada(resultado = {}, job = {}) {
  const produtoMetadata = resultado?.metadata?.produto && typeof resultado.metadata.produto === "object"
    ? resultado.metadata.produto
    : {};
  const imagemResolvida = resolverImagemImportada(resultado, produtoMetadata);
  const tituloImportado = normalizarTexto(resultado.titulo || resultado.nome || "");
  const marketplaceTitulo = normalizarTexto(resultado.marketplace || job.marketplace || job.marketplace_detectado);
  const tituloSeguro = tituloComercialUniversalValido(tituloImportado, { marketplace: marketplaceTitulo }) ? tituloImportado : "";

  return {
    ok: resultado.ok !== false,
    marketplace: marketplaceTitulo,
    titulo: tituloSeguro,
    tituloNormalizado: normalizarTitulo(tituloSeguro),
    preco: normalizarNumero(resultado.preco || resultado.precoAtual || produtoMetadata.precoAtual || produtoMetadata.preco),
    precoOriginal: normalizarNumero(resultado.precoOriginal || resultado.precoAntigo || produtoMetadata.precoOriginal || produtoMetadata.precoAntigo),
    imagem: imagemResolvida.imagem,
    imagemOrigem: normalizarTexto(resultado.imagemOrigem || imagemResolvida.campo),
    statusHttp: normalizarNumero(resultado.statusHttp),
    shopId: normalizarTexto(resultado.shopId || produtoMetadata.shopId || ""),
    itemId: normalizarTexto(resultado.itemId || produtoMetadata.itemId || ""),
    produtoIdDetectado: normalizarTexto(resultado.produtoIdDetectado || resultado.produtoId || produtoMetadata.produtoId || ""),
    linkOriginal: normalizarTexto(resultado.linkOriginal || ""),
    linkExpandido: normalizarTexto(resultado.linkExpandido || resultado.urlFinal || ""),
    linkAfiliado: normalizarTexto(resultado.linkAfiliado || resultado.linkFinal || resultado.link || ""),
    categoria: resolverCategoriaEngine(resultado, job),
    cupom: normalizarTexto(resultado.cupom || ""),
    cupomTipo: normalizarTexto(resultado.cupomTipo || resultado.tipoCupom || ""),
    score: normalizarNumero(resultado.score),
    metadata: resultado.metadata || resultado
  };
}

async function buscarImagemAnteriorEngine(oferta = {}, job = {}) {
  if (oferta.imagem || normalizarMarketplaceMemoria(oferta.marketplace) !== "mercadolivre") {
    return { imagem: "", origem: "", motivo: oferta.imagem ? "imagem_importer_presente" : "marketplace_nao_ml" };
  }

  const identidade = detectarIdentidadeProdutoUniversal(oferta);
  const produtoId = normalizarTexto(identidade.produtoIdDetectado || "").toUpperCase();
  if (!/^MLB\d+$/.test(produtoId)) {
    return { imagem: "", origem: "", motivo: "mlb_nao_detectado" };
  }

  const ofertaAtualId = Number(job.oferta_id) || 0;
  const usarMetadata = await engineOfertasTemMetadata();
  const campoMetadata = usarMetadata ? "COALESCE(metadata::text, '')" : "''";
  const resultado = await queryEngine(
    `SELECT id, imagem
       FROM engine_ofertas
      WHERE id <> $2
        AND NULLIF(TRIM(COALESCE(imagem, '')), '') IS NOT NULL
        AND LOWER(REGEXP_REPLACE(COALESCE(marketplace, ''), '[[:space:]_-]+', '', 'g')) IN ('ml', 'mercadolivre')
        AND UPPER(CONCAT_WS(' ', link_original, link_expandido, link_afiliado, ${campoMetadata})) LIKE '%' || $1 || '%'
      ORDER BY atualizada_em DESC NULLS LAST, id DESC
      LIMIT 1`,
    [produtoId, ofertaAtualId]
  );

  if (!resultado.ok) {
    return { imagem: "", origem: "", motivo: "consulta_historico_falhou" };
  }

  const anterior = resultado.resultado.rows[0];
  const imagem = normalizarTexto(anterior?.imagem || "");
  return imagem
    ? { imagem, origem: `engine_ofertas.imagem:${anterior.id}`, motivo: "imagem_historica_mesmo_mlb" }
      : { imagem: "", origem: "", motivo: "historico_mesmo_mlb_sem_imagem" };
}

function extrairMlbImagem(url = "") {
  return normalizarTexto(url).match(/\bMLB-?(\d{6,})\b/i)?.[1] || "";
}

function normalizarMlbImagem(valor = "") {
  const id = normalizarTexto(valor).match(/\bMLB-?(\d{6,})\b/i)?.[1] ||
    normalizarTexto(valor).match(/\b(\d{6,})\b/)?.[1] ||
    "";
  return id ? `MLB${id}` : "";
}

function normalizarImagemMercadoLivre(valor = "") {
  const bruto = normalizarValorImagem(valor);
  if (!bruto) return "";

  let imagem = htmlDecode(corrigirImagemUrl(bruto)).trim();
  if (imagem.startsWith("//")) imagem = `https:${imagem}`;

  try {
    const parsed = new URL(imagem);
    const host = parsed.hostname.toLowerCase();
    const dominioSeguro = host === "mlstatic.com" || host.endsWith(".mlstatic.com") || host.endsWith(".mercadolivre.com.br");
    return ["http:", "https:"].includes(parsed.protocol) && dominioSeguro ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function decodificarPayloadMercadoLivre(valor = "") {
  return htmlDecode(String(valor || ""))
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u003F/gi, "?")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003D/gi, "=")
    .replace(/&amp;/gi, "&");
}

function extrairJsonObjetoBalanceado(texto = "", indiceAbertura = -1) {
  if (indiceAbertura < 0 || texto[indiceAbertura] !== "{") return null;
  let profundidade = 0;
  let emString = false;
  let escape = false;
  for (let i = indiceAbertura; i < texto.length; i += 1) {
    const char = texto[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === "\"") {
      emString = !emString;
      continue;
    }
    if (emString) continue;
    if (char === "{") profundidade += 1;
    if (char === "}") {
      profundidade -= 1;
      if (profundidade === 0) {
        const bruto = texto.slice(indiceAbertura, i + 1);
        try {
          return { objeto: JSON.parse(bruto), fim: i + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extrairValorJsonStringImagemMl(bloco = "", campo = "") {
  return decodificarPayloadMercadoLivre(
    String(bloco || "").match(new RegExp(`"${campo}"\\s*:\\s*"([^"]*)"`, "i"))?.[1] || ""
  );
}

function extrairContextoPictureTemplateMl(texto = "", indiceCard = 0) {
  const antes = texto.slice(Math.max(0, indiceCard - 50000), indiceCard);
  const matches = [...antes.matchAll(/"picture_template"\s*:\s*"([^"]+)"/gi)];
  const template = decodificarPayloadMercadoLivre(matches.at(-1)?.[1] || "");
  const contextoInicio = antes.lastIndexOf("\"polycard_context\"");
  const blocoContexto = contextoInicio >= 0 ? antes.slice(contextoInicio) : antes;
  return {
    picture_template: template,
    picture_size_default: extrairValorJsonStringImagemMl(blocoContexto, "picture_size_default") || "V",
    picture_square_default: extrairValorJsonStringImagemMl(blocoContexto, "picture_square_default") || "Q"
  };
}

function normalizarTemplateImagemPolycardMl(template = "") {
  const valor = decodificarPayloadMercadoLivre(template).trim();
  if (!valor) return "";
  try {
    const exemplo = valor
      .replace(/\{square\}/g, "Q")
      .replace(/\{2x\}/g, "")
      .replace(/\{id\}/g, "000000-MLB000000000_000000")
      .replace(/\{size\}/g, "V")
      .replace(/\{sanitized_title\}/g, "");
    const parsed = new URL(exemplo);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || !(host === "mlstatic.com" || host.endsWith(".mlstatic.com"))) return "";
    if (!/\{id\}/.test(valor)) return "";
    return valor;
  } catch {
    return "";
  }
}

function normalizarPictureIdPolycardMl(pictureId = "") {
  const valor = normalizarTexto(pictureId);
  if (!valor || /[<>{}\\/\s]/.test(valor)) return "";
  return /^[A-Z0-9_-]+-[A-Z]{3}\d+_\d{6}$/i.test(valor) ? valor : "";
}

function montarUrlImagemPolycardMl({ template = "", pictureId = "", square = "", size = "" } = {}) {
  const templateSeguro = normalizarTemplateImagemPolycardMl(template);
  const idSeguro = normalizarPictureIdPolycardMl(pictureId);
  if (!templateSeguro || !idSeguro) return "";
  const squareSeguro = normalizarTexto(square || "Q").replace(/[^A-Z0-9]/gi, "") || "Q";
  const sizeSeguro = normalizarTexto(size || "V").replace(/[^A-Z0-9]/gi, "") || "V";
  const montada = templateSeguro
    .replace(/\{square\}/g, squareSeguro)
    .replace(/\{2x\}/g, "")
    .replace(/\{id\}/g, idSeguro)
    .replace(/\{size\}/g, sizeSeguro)
    .replace(/\{sanitized_title\}/g, "");
  const imagem = normalizarImagemMercadoLivre(montada);
  if (!imagem || !imagem.includes(idSeguro)) return "";
  return imagem;
}

function tokensProdutoImagemMl(valor = "") {
  const stop = new Set([
    "para", "com", "por", "de", "da", "do", "das", "dos", "uma", "uns", "nas", "nos",
    "cupom", "promocao", "promo", "preco", "esgotando", "isso", "copo", "agua", "olha",
    "mercado", "livre", "original", "oferta", "imperdivel", "kit"
  ]);
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 4 && !stop.has(token))
    .filter((token, index, todos) => todos.indexOf(token) === index);
}

function textoIdentidadeComercialImagemMl(oferta = {}) {
  const metadata = objetoSeguro(oferta.metadata);
  const radarMirror = objetoSeguro(metadata.radarMirror);
  return [
    oferta.titulo,
    oferta.nome,
    oferta.textoOriginal,
    oferta.textoComercialOriginal,
    metadata.textoOriginal,
    metadata.textoComercialOriginal,
    radarMirror.textoOriginal,
    radarMirror.textoComercial,
    radarMirror.mensagemOriginal
  ].filter(Boolean).join(" ");
}

function cardPolycardConflitaComOfertaMl(card = {}, oferta = {}) {
  const textoOferta = textoIdentidadeComercialImagemMl(oferta);
  const tituloCard = normalizarTexto(card.title || card.titulo || "");
  if (!textoOferta || !tituloCard) return false;
  const tokensOferta = tokensProdutoImagemMl(textoOferta);
  const tokensCard = tokensProdutoImagemMl(tituloCard);
  if (tokensOferta.length < 2 || tokensCard.length < 2) return false;
  return !tokensCard.some(token => tokensOferta.includes(token));
}

function extrairImagemPolycardMercadoLivreHtml(html = "", mlbEsperado = "", oferta = {}) {
  const mlb = normalizarMlbImagem(mlbEsperado);
  if (!mlb) return { imagem: "", origem: "", motivo: "mlb_polycard_ausente" };
  const texto = decodificarPayloadMercadoLivre(html);
  const regexMetadata = /"metadata"\s*:\s*\{/gi;
  let match;
  let ultimoMotivo = "polycard_sem_card_compativel";
  let encontrouCardEsperado = false;
  while ((match = regexMetadata.exec(texto)) !== null) {
    const inicioMetadata = texto.indexOf("{", match.index);
    const metadata = extrairJsonObjetoBalanceado(texto, inicioMetadata);
    if (!metadata?.objeto) continue;
    const idCard = normalizarMlbImagem(metadata.objeto.id || "");
    if (idCard !== mlb) {
      if (!encontrouCardEsperado) ultimoMotivo = "polycard_mlb_divergente";
      continue;
    }
    encontrouCardEsperado = true;

    const contexto = extrairContextoPictureTemplateMl(texto, match.index);
    const picturesIndex = texto.indexOf("\"pictures\"", metadata.fim);
    if (picturesIndex < 0) {
      ultimoMotivo = "polycard_sem_pictures";
      continue;
    }
    const inicioPictures = texto.indexOf("{", picturesIndex);
    const pictures = extrairJsonObjetoBalanceado(texto, inicioPictures);
    if (!pictures?.objeto) {
      ultimoMotivo = "polycard_pictures_malformado";
      continue;
    }

    const picture = Array.isArray(pictures.objeto.pictures) ? pictures.objeto.pictures[0] : null;
    const pictureId = normalizarPictureIdPolycardMl(picture?.id || "");
    if (!pictureId) {
      ultimoMotivo = "polycard_picture_id_ausente";
      continue;
    }

    const card = {
      metadata: metadata.objeto,
      title: String(texto.slice(metadata.fim, Math.min(texto.length, metadata.fim + 2200))
        .match(/"title"\s*:\s*\{\s*"text"\s*:\s*"([^"]+)"/i)?.[1] || "")
    };
    if (cardPolycardConflitaComOfertaMl(card, oferta)) {
      return {
        imagem: "",
        origem: "",
        motivo: "polycard_conflito_identidade",
        conflitoIdentidade: true,
        metadataId: idCard,
        pictureId,
        tituloPolycard: card.title
      };
    }

    const imagem = montarUrlImagemPolycardMl({
      template: contexto.picture_template,
      pictureId,
      square: pictures.objeto.square || contexto.picture_square_default,
      size: contexto.picture_size_default
    });
    if (!imagem) {
      ultimoMotivo = "polycard_template_invalido";
      continue;
    }

    return {
      imagem,
      origem: "polycard.picture_template",
      motivo: "polycard_picture_id_imagem_recuperada",
      metadataId: idCard,
      productId: metadata.objeto.product_id || "",
      userProductId: metadata.objeto.user_product_id || "",
      pictureId,
      linkResolvido: metadata.objeto.url || "",
      tituloPolycard: card.title
    };
  }
  return { imagem: "", origem: "", motivo: ultimoMotivo };
}

async function validarImagemPolycardMercadoLivre(candidato = {}, opcoes = {}) {
  const imagem = normalizarImagemMercadoLivre(candidato.imagem || "");
  if (!imagem) return { ...candidato, imagem: "", motivo: candidato.motivo || "polycard_imagem_invalida" };
  const fetchImpl = opcoes.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(opcoes.timeoutMs || 4500));
  try {
    const response = await fetchImpl(imagem, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        "Accept": "image/webp,image/*,*/*",
        "Range": "bytes=0-2047"
      }
    });
    const contentType = String(response.headers?.get?.("content-type") || response.headers?.["content-type"] || "");
    if (typeof response.arrayBuffer === "function") {
      await response.arrayBuffer().catch(() => null);
    }
    if (response.status >= 200 && response.status < 400 && /^image\//i.test(contentType)) {
      return {
        ...candidato,
        imagem,
        statusHttp: response.status,
        contentType,
        motivo: candidato.motivo || "polycard_picture_id_imagem_recuperada"
      };
    }
    return {
      ...candidato,
      imagem: "",
      statusHttp: response.status,
      contentType,
      motivo: /^image\//i.test(contentType) ? `polycard_http_${response.status}` : "polycard_http_nao_imagem"
    };
  } catch (erro) {
    return {
      ...candidato,
      imagem: "",
      statusHttp: null,
      motivo: erro?.name === "AbortError" ? "timeout_polycard_picture" : `falha_polycard_picture:${erro.message}`
    };
  } finally {
    clearTimeout(timer);
  }
}

function extrairImagemHtmlMercadoLivre(html = "") {
  const jsonLd = extrairJsonLd(html);
  const candidatos = [
    ["jsonLd.image", Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image],
    ["og:image", extrairMeta(html, "og:image")],
    ["twitter:image", extrairMeta(html, "twitter:image")]
  ];

  const camposThumbnail = /"(thumbnail|thumbnailUrl|secure_url|picture_url)"\s*:\s*"([^"]+)"/gi;
  let match;
  while ((match = camposThumbnail.exec(String(html || ""))) !== null) {
    candidatos.push([`html.${match[1]}`, match[2]]);
  }

  for (const [origem, valor] of candidatos) {
    const imagem = normalizarImagemMercadoLivre(valor);
    if (imagem) return { imagem, origem };
  }

  return { imagem: "", origem: "nenhuma" };
}

function extrairImagemOficialMercadoLivreApi(dados = {}) {
  const candidatos = [];
  const adicionar = (origem, valor) => {
    const imagem = normalizarImagemMercadoLivre(valor);
    if (!imagem || candidatos.some(item => item.imagem === imagem)) return;
    candidatos.push({ imagem, origem });
  };

  const pictures = Array.isArray(dados.pictures) ? dados.pictures : [];
  pictures.forEach((picture, indice) => {
    if (!picture || typeof picture !== "object") return;
    adicionar(`api_mercadolibre.items.pictures[${indice}].secure_url`, picture.secure_url);
    adicionar(`api_mercadolibre.items.pictures[${indice}].url`, picture.url);
  });

  adicionar("api_mercadolibre.items.secure_thumbnail", dados.secure_thumbnail);
  adicionar("api_mercadolibre.items.thumbnail", dados.thumbnail);
  adicionar("api_mercadolibre.items.thumbnailUrl", dados.thumbnailUrl || dados.thumbnail_url);
  adicionar("api_mercadolibre.items.picture_url", dados.picture_url);

  return candidatos[0] || { imagem: "", origem: "nenhuma" };
}

async function buscarImagemOficialMercadoLivrePorMlb(mlb = "", opcoes = {}) {
  const id = normalizarTexto(mlb).replace(/[^0-9]/g, "");
  if (!id) {
    return { imagem: "", origem: "", statusHttp: null, motivo: "mlb_api_ausente" };
  }

  const accessToken = resolverAccessTokenMercadoLivreImagem(opcoes);
  const urlApi = `https://api.mercadolibre.com/items/MLB${id}`;
  if (!accessToken) {
    return {
      imagem: "",
      origem: "",
      linkResolvido: urlApi,
      statusHttp: null,
      motivo: "api_oficial_mlb_token_ausente",
      apiConsultada: false,
      autenticacao: "ausente"
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(opcoes.timeoutMs || 6500));
  const fetchImpl = opcoes.fetchImpl || globalThis.fetch;

  try {
    const response = await fetchImpl(urlApi, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "OptimusPromo/1.0 (+https://go.optimuspromo.com.br)",
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`
      }
    });

    if (response.status >= 400) {
      return {
        imagem: "",
        origem: "",
        linkResolvido: urlApi,
        statusHttp: response.status,
        motivo: `api_oficial_mlb_http_${response.status}`,
        apiConsultada: true,
        autenticacao: "bearer"
      };
    }

    const dados = await response.json();
    const imagemApi = extrairImagemOficialMercadoLivreApi(dados);
    return {
      imagem: imagemApi.imagem,
      origem: imagemApi.imagem ? imagemApi.origem : "",
      linkResolvido: urlApi,
      statusHttp: response.status,
      motivo: imagemApi.imagem ? "api_oficial_mlb_imagem_recuperada" : "api_oficial_mlb_sem_imagem",
      apiConsultada: true,
      autenticacao: "bearer"
    };
  } catch (erro) {
    return {
      imagem: "",
      origem: "",
      linkResolvido: urlApi,
      statusHttp: null,
      motivo: erro?.name === "AbortError" ? "timeout_api_oficial_mlb" : `falha_api_oficial_mlb:${erro.message}`,
      apiConsultada: true,
      autenticacao: "bearer"
    };
  } finally {
    clearTimeout(timer);
  }
}

function resolverAccessTokenMercadoLivreImagem(opcoes = {}) {
  const direto = normalizarTexto(
    opcoes.accessToken ||
    opcoes.access_token ||
    opcoes.bearerToken ||
    opcoes.tokenMercadoLivre ||
    ""
  );
  if (direto) return direto;

  const credenciais = objetoSeguro(opcoes.credenciais);
  const tokenCredenciais = normalizarTexto(
    credenciais.accessToken ||
    credenciais.access_token ||
    credenciais.bearerToken ||
    credenciais.oauthAccessToken ||
    credenciais.oauth_access_token ||
    credenciais.tokenMercadoLivre ||
    ""
  );
  if (tokenCredenciais) return tokenCredenciais;

  if (typeof opcoes.getIntegracaoCliente === "function") {
    const clienteId = normalizarTexto(opcoes.clienteId || opcoes.job?.cliente_id || opcoes.job?.clienteId || "");
    const integracao = opcoes.getIntegracaoCliente(clienteId || "admin", "mercadolivre");
    return resolverAccessTokenMercadoLivreImagem({
      credenciais: integracao?.credenciais || {},
      accessToken: integracao?.accessToken || integracao?.access_token || ""
    });
  }

  return "";
}

function extrairCanonicalImagemMercadoLivre(html = "") {
  return htmlDecode(
    String(html || "").match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ||
    String(html || "").match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1] ||
    extrairMeta(html, "og:url") ||
    ""
  ).trim();
}

function extrairUrlProdutoImagemMercadoLivre(html = "", mlbEsperado = "") {
  const candidatos = [
    extrairCanonicalImagemMercadoLivre(html),
    ...String(html || "").matchAll(/"permalink"\s*:\s*"([^"]*MLB[^"]*)"/gi),
    ...String(html || "").matchAll(/"canonicalUrl"\s*:\s*"([^"]*MLB[^"]*)"/gi),
    ...String(html || "").matchAll(/"url"\s*:\s*"([^"]*MLB[^"]*)"/gi),
    ...String(html || "").matchAll(/href=["']([^"']*(?:produto\.mercadolivre\.com\.br\/MLB|mercadolivre\.com\.br\/p\/MLB)[^"']*)["']/gi)
  ].map(item => Array.isArray(item) ? item[1] : item);

  for (const candidato of candidatos) {
    const url = htmlDecode(String(candidato || ""))
      .replace(/\\u002f/gi, "/")
      .replace(/\\\//g, "/")
      .replace(/&amp;/gi, "&")
      .trim();
    if (urlCanonicaImagemMercadoLivreSegura(url, mlbEsperado)) return url;
  }

  return "";
}

function urlCanonicaImagemMercadoLivreSegura(url = "", mlbEsperado = "") {
  try {
    const parsed = new URL(normalizarTexto(url));
    const path = parsed.pathname || "";
    return parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase().endsWith("mercadolivre.com.br") &&
      (/\/MLB-?\d+/i.test(path) || /\/p\/MLB/i.test(path) || /\/permalink\/MLB/i.test(path)) &&
      extrairMlbImagem(parsed.toString()) === mlbEsperado;
  } catch {
    return false;
  }
}

function urlGenericaMlbMercadoLivre(url = "") {
  try {
    const parsed = new URL(normalizarTexto(url));
    return parsed.hostname.toLowerCase() === "produto.mercadolivre.com.br" &&
      /^\/MLB-?\d+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function adicionarUrlImagemMercadoLivre(candidatos, url = "", mlb = "", origem = "") {
  const valor = normalizarTexto(url);
  if (!valor) return;
  try {
    const parsed = new URL(valor);
    const host = parsed.hostname.toLowerCase();
    const urlFinal = parsed.toString();
    const meliLa = host === "meli.la" || host.endsWith(".meli.la");
    const produtoMl = host.endsWith("mercadolivre.com.br") && extrairMlbImagem(urlFinal) === mlb;
    if (!meliLa && !produtoMl) return;
    if (candidatos.some(item => item.url === urlFinal)) return;
    candidatos.push({
      url: urlFinal,
      origem,
      meliLa,
      generica: produtoMl && urlGenericaMlbMercadoLivre(urlFinal)
    });
  } catch {}
}

function coletarValoresTecnicosImagemMercadoLivre(oferta = {}) {
  const metadata = objetoSeguro(oferta.metadata);
  const produto = objetoSeguro(metadata.produto);
  const resolucaoRadar = objetoSeguro(metadata.resolucaoRadar);
  const imagemAuditoria = objetoSeguro(metadata.imagemAuditoria);
  const adapter = objetoSeguro(metadata.adapter);

  return {
    preferenciais: [
      oferta.linkResolvidoImagem,
      metadata.linkResolvidoImagem,
      imagemAuditoria.linkResolvidoImagem,
      oferta.urlFinal,
      metadata.urlFinalImportador,
      produto.urlFinal,
      produto.permalink,
      produto.canonical,
      produto.canonicalUrl,
      produto.linkResolvidoImagem,
      adapter.urlFinal,
      adapter.permalink,
      resolucaoRadar.linkResolvido,
      resolucaoRadar.urlResolvida,
      resolucaoRadar.urlExpandida
    ],
    base: [
      oferta.linkExpandido,
      metadata.linkExpandidoEngine,
      resolucaoRadar.linkOriginalLimpo,
      oferta.linkOriginal,
      metadata.linkOriginalEngine
    ]
  };
}

function montarCandidatosUrlImagemMercadoLivre(oferta = {}, mlb = "") {
  const candidatos = [];
  const valores = coletarValoresTecnicosImagemMercadoLivre(oferta);
  for (const url of valores.preferenciais) adicionarUrlImagemMercadoLivre(candidatos, url, mlb, "tecnica_preferencial");
  for (const url of valores.base) adicionarUrlImagemMercadoLivre(candidatos, url, mlb, "tecnica_base");
  if (mlb) adicionarUrlImagemMercadoLivre(candidatos, `https://produto.mercadolivre.com.br/MLB${mlb}`, mlb, "mlb_generico");

  return candidatos.sort((a, b) => {
    const peso = item => item.generica ? 10 : 0;
    return peso(a) - peso(b);
  });
}

async function buscarImagemCanonicaMercadoLivre(oferta = {}, opcoes = {}) {
  const valoresTecnicos = coletarValoresTecnicosImagemMercadoLivre(oferta);
  const textoIdentidade = [
    oferta.produtoIdDetectado,
    oferta.produtoId,
    oferta.itemId,
    ...valoresTecnicos.preferenciais,
    ...valoresTecnicos.base
  ].join(" ");
  const mlbNormalizado = normalizarMlbImagem(textoIdentidade);
  const mlb = extrairMlbImagem(mlbNormalizado);
  const candidatosUrl = montarCandidatosUrlImagemMercadoLivre(oferta, mlb);
  const urlInicial = candidatosUrl[0]?.url || "";

  if (!urlInicial || !mlb) {
    return { imagem: "", origem: "", linkResolvido: urlInicial || "", statusHttp: null, motivo: "url_canonica_mlb_ausente" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  const options = {
    redirect: "follow",
    signal: controller.signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9"
    }
  };
  const fetchImpl = opcoes.fetchImpl || globalThis.fetch;

  try {
    let linkResolvido = urlInicial;
    let statusHttp = null;
    let motivoHtml = "";

    for (let indice = 0; indice < candidatosUrl.length; indice += 1) {
      const candidato = candidatosUrl[indice];
      let response = await fetchImpl(candidato.url, options);
      let html = await response.text();
      linkResolvido = response.url || candidato.url;
      statusHttp = response.status;
      let bloqueado = /captcha|account-verification|access denied|robot check|verifique[^<]{0,80}rob/i.test(html);
      const imagemPolycard = extrairImagemPolycardMercadoLivreHtml(html, mlb, oferta);
      if (imagemPolycard.imagem) {
        const imagemPolycardValidada = await validarImagemPolycardMercadoLivre(imagemPolycard, {
          fetchImpl,
          timeoutMs: opcoes.timeoutMsImagemPolycard
        });
        if (imagemPolycardValidada.imagem) {
          return {
            imagem: imagemPolycardValidada.imagem,
            origem: imagemPolycardValidada.origem,
            linkResolvido: imagemPolycardValidada.linkResolvido || linkResolvido,
            statusHttp: imagemPolycardValidada.statusHttp ?? statusHttp,
            motivo: imagemPolycardValidada.motivo,
            pictureId: imagemPolycardValidada.pictureId || "",
            productId: imagemPolycardValidada.productId || "",
            userProductId: imagemPolycardValidada.userProductId || ""
          };
        }
        motivoHtml = imagemPolycardValidada.motivo || motivoHtml;
      } else if (imagemPolycard.conflitoIdentidade) {
        motivoHtml = imagemPolycard.motivo || "polycard_conflito_identidade";
      }
      let linkResolvidoSeguro = urlCanonicaImagemMercadoLivreSegura(linkResolvido, mlb);
      let podeUsarHtmlAtual = !candidato.meliLa || linkResolvidoSeguro;
      let imagemExtraida = statusHttp < 400 && !bloqueado && podeUsarHtmlAtual ? extrairImagemHtmlMercadoLivre(html) : { imagem: "", origem: "nenhuma" };
      const canonical = extrairUrlProdutoImagemMercadoLivre(html, mlb);

      if (!imagemExtraida.imagem && urlCanonicaImagemMercadoLivreSegura(canonical, mlb) && canonical !== linkResolvido) {
        response = await fetchImpl(canonical, options);
        html = await response.text();
        linkResolvido = response.url || canonical;
        statusHttp = response.status;
        bloqueado = /captcha|account-verification|access denied|robot check|verifique[^<]{0,80}rob/i.test(html);
        linkResolvidoSeguro = urlCanonicaImagemMercadoLivreSegura(linkResolvido, mlb);
        podeUsarHtmlAtual = linkResolvidoSeguro || urlCanonicaImagemMercadoLivreSegura(canonical, mlb);
        imagemExtraida = statusHttp < 400 && !bloqueado && podeUsarHtmlAtual ? extrairImagemHtmlMercadoLivre(html) : { imagem: "", origem: "nenhuma" };
      }

      if (imagemExtraida.imagem) {
        return {
          imagem: imagemExtraida.imagem,
          origem: `canonical.${imagemExtraida.origem}`,
          linkResolvido,
          statusHttp,
          motivo: "imagem_canonica_recuperada"
        };
      }

      motivoHtml = statusHttp >= 400 ? `http_${statusHttp}` : (bloqueado ? "html_bloqueado" : "html_sem_imagem_valida");
    }

    const imagemApi = await buscarImagemOficialMercadoLivrePorMlb(mlb, opcoes);
    if (imagemApi.imagem) {
      return {
        imagem: imagemApi.imagem,
        origem: imagemApi.origem,
        linkResolvido: imagemApi.linkResolvido || linkResolvido,
        statusHttp: imagemApi.statusHttp ?? statusHttp,
        motivo: imagemApi.motivo
      };
    }

    return {
      imagem: "",
      origem: "",
      linkResolvido: imagemApi.linkResolvido || linkResolvido,
      statusHttp: imagemApi.statusHttp ?? statusHttp,
      motivo: imagemApi.motivo || motivoHtml
    };
  } catch (erro) {
    const imagemApi = await buscarImagemOficialMercadoLivrePorMlb(mlb, opcoes);
    if (imagemApi.imagem) {
      return {
        imagem: imagemApi.imagem,
        origem: imagemApi.origem,
        linkResolvido: imagemApi.linkResolvido || urlInicial,
        statusHttp: imagemApi.statusHttp ?? null,
        motivo: imagemApi.motivo
      };
    }

    return {
      imagem: "",
      origem: "",
      linkResolvido: imagemApi.linkResolvido || urlInicial,
      statusHttp: imagemApi.statusHttp ?? null,
      motivo: imagemApi.motivo || (erro?.name === "AbortError" ? "timeout_url_canonica" : `falha_url_canonica:${erro.message}`)
    };
  } finally {
    clearTimeout(timer);
  }
}

function objetoSeguro(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function encontrarRadarMirrorMensagem(oferta = {}, contexto = {}) {
  const fontes = [
    oferta?.metadata?.radarMirror,
    oferta?.radarMirror,
    contexto?.ofertaEntrada?.metadata?.radarMirror,
    contexto?.evento?.metadata?.radarMirror,
    contexto?.job?.metadata?.radarMirror,
    contexto?.job?.metadata?.metadataEvento?.radarMirror
  ];

  for (const radarMirror of fontes) {
    if (!radarMirror || typeof radarMirror !== "object") continue;
    const midia = objetoSeguro(radarMirror.midia);
    const origemMidia = normalizarTexto(midia.imagemOrigem || radarMirror.imagemOrigem || "").toLowerCase();
    const imagemOriginal = normalizarTexto(
      midia.imagemOriginal ||
      radarMirror.imagemOriginal ||
      midia.imagem ||
      radarMirror.imagem ||
      midia.imagemUrl ||
      radarMirror.imagemUrl ||
      ""
    );
    if (origemMidia === "mensagem" && imagemOriginal) {
      return { radarMirror, midia, imagemOriginal };
    }
  }

  return { radarMirror: null, midia: {}, imagemOriginal: "" };
}

function nomeLogicoImagemRadar(job = {}, oferta = {}) {
  const jobId = normalizarTexto(job.id || job.jobId || "");
  const titulo = normalizarTexto(oferta.titulo || oferta.nome || "oferta")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "oferta";
  return `radar_${jobId || "sem_job"}_${titulo}`;
}

async function baixarBufferImagem(url = "", opcoes = {}) {
  const fetchImpl = opcoes.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, motivo: "fetch_indisponivel" };
  }

  const controller = new AbortController();
  const timeoutMs = Number(opcoes.timeoutMs || process.env.OPTIMUS_IMAGEM_MATERIALIZACAO_TIMEOUT_MS || 8000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resposta = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "OptimusImageMaterializer/1.0"
      }
    });
    const statusHttp = resposta.status || 0;
    if (!resposta.ok) return { ok: false, motivo: `http_${statusHttp}`, statusHttp };

    const tamanhoDeclarado = Number(resposta.headers?.get?.("content-length") || 0);
    const limiteBytes = 8 * 1024 * 1024;
    if (Number.isFinite(tamanhoDeclarado) && tamanhoDeclarado > limiteBytes) {
      return { ok: false, motivo: "imagem_tamanho_excedido", statusHttp, bytes: tamanhoDeclarado };
    }

    const arrayBuffer = await resposta.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) return { ok: false, motivo: "imagem_vazia", statusHttp };
    if (buffer.length > limiteBytes) return { ok: false, motivo: "imagem_tamanho_excedido", statusHttp, bytes: buffer.length };

    const mimeReal = socialMediaStorage.detectarMime(buffer);
    if (!mimeReal || !mimeReal.startsWith("image/")) {
      return { ok: false, motivo: "mime_nao_imagem", statusHttp, bytes: buffer.length };
    }

    return { ok: true, buffer, mimeType: mimeReal, statusHttp, bytes: buffer.length };
  } catch (erro) {
    return { ok: false, motivo: erro?.name === "AbortError" ? "timeout_materializacao" : `falha_download:${erro.message}` };
  } finally {
    clearTimeout(timer);
  }
}

function aplicarRadarMirrorMaterializado(oferta = {}, radarMirror = {}, materializada = {}) {
  const metadata = objetoSeguro(oferta.metadata);
  const radarAtual = objetoSeguro(metadata.radarMirror || radarMirror);
  const midiaAtual = objetoSeguro(radarAtual.midia);
  const radarMirrorAtualizado = {
    ...radarAtual,
    midia: {
      ...midiaAtual,
      imagemOrigem: midiaAtual.imagemOrigem || "mensagem",
      imagemMaterializada: materializada.url,
      imagemDuravel: materializada.url,
      imagemEnviavel: materializada.url,
      imagemStatus: "imagem_enviavel",
      imagemMaterializadaEm: new Date().toISOString(),
      imagemMaterializacaoOrigem: "radar_mirror/mensagem"
    }
  };

  return {
    ...oferta,
    metadata: {
      ...metadata,
      radarMirror: radarMirrorAtualizado,
      imagemMaterializacao: {
        status: "materializada",
        origem: "radar_mirror/mensagem",
        urlOriginal: materializada.urlOriginal,
        urlDuravel: materializada.url,
        mimeType: materializada.mimeType,
        bytes: materializada.bytes,
        storage: "social_media_storage",
        materializadaEm: new Date().toISOString()
      }
    }
  };
}

function encontrarImagemCanonicaEvento(oferta = {}, contexto = {}) {
  const fontes = [
    objetoSeguro(oferta.metadata),
    objetoSeguro(contexto?.ofertaEntrada?.metadata),
    objetoSeguro(contexto?.evento?.metadata),
    objetoSeguro(contexto?.job?.metadata),
    objetoSeguro(contexto?.job?.metadata?.metadataEvento)
  ];

  let falhaMaterializacaoRadar = null;
  for (const fonte of fontes) {
    const cache = objetoSeguro(fonte.imagemCacheCanonico);
    const radarMirrorMaterializacao = objetoSeguro(cache.radarMirrorMaterializacao);
    const bloqueada = cache.bloquearRematerializacaoRadar === true
      || (radarMirrorMaterializacao.status === "falha" && radarMirrorMaterializacao.origem === "radar_mirror/mensagem");
    const imagem = normalizarTexto(
      fonte.imagemCanonicaDuravel ||
      cache.imagemCanonicaDuravel ||
      fonte.imagemUrl ||
      fonte.imagem
    );
    if (imagem) {
      const validacao = imagemUrlValidaUniversal(imagem);
      if (validacao.ok && !imagemUrlEfemeraUniversal(validacao.url) && fonte.imagemEnviavel !== false && cache.imagemEnviavel !== false) {
        return {
          imagem: validacao.url,
          origem: normalizarTexto(fonte.imagemOrigem || cache.origem || "imagem_canonica_evento"),
          status: normalizarTexto(fonte.imagemStatus || cache.status || "imagem_canonica_evento"),
          cache
        };
      }
    }
    if (bloqueada && !falhaMaterializacaoRadar) {
      falhaMaterializacaoRadar = {
        imagem: "",
        origem: "radar_mirror/mensagem",
        status: normalizarTexto(cache.status || "cache_canonico_evento_falha"),
        motivo: normalizarTexto(cache.motivo || radarMirrorMaterializacao.motivo || "materializacao_canonica_falhou"),
        falhaMaterializacaoRadar: true,
        cache: {
          ...cache,
          radarMirrorMaterializacao
        }
      };
    }
  }

  if (falhaMaterializacaoRadar) return falhaMaterializacaoRadar;
  return { imagem: "", origem: "", status: "", cache: {} };
}

function aplicarImagemCanonicaEventoOferta(oferta = {}, imagemCanonica = {}) {
  if (!imagemCanonica?.imagem) return oferta;
  const metadata = objetoSeguro(oferta.metadata);
  const deveAplicarComoPrincipal = !oferta.imagem || /^radar_mirror/.test(imagemCanonica.origem || "");

  return {
    ...oferta,
    ...(deveAplicarComoPrincipal ? {
      imagem: imagemCanonica.imagem,
      imagemUrl: imagemCanonica.imagem,
      imagemOrigem: imagemCanonica.origem || "imagem_canonica_evento",
      imagemStatus: imagemCanonica.status || "imagem_canonica_evento",
      imagemRecuperavel: true,
      imagemDuravel: true,
      imagemEnviavel: true
    } : {}),
    metadata: {
      ...metadata,
      imagemCanonicaDuravel: imagemCanonica.imagem,
      imagemOrigem: imagemCanonica.origem || "imagem_canonica_evento",
      imagemStatus: imagemCanonica.status || "imagem_canonica_evento",
      imagemRecuperavel: true,
      imagemDuravel: true,
      imagemEnviavel: true,
      imagemCacheCanonico: {
        ...objetoSeguro(imagemCanonica.cache),
        imagemCanonicaDuravel: imagemCanonica.imagem,
        origem: imagemCanonica.origem || "imagem_canonica_evento",
        status: imagemCanonica.status || "imagem_canonica_evento",
        imagemEnviavel: true
      }
    }
  };
}

function aplicarFalhaCanonicaEventoOferta(oferta = {}, imagemCanonica = {}) {
  const metadata = objetoSeguro(oferta.metadata);
  return {
    ...oferta,
    metadata: {
      ...metadata,
      imagemCacheCanonico: {
        ...objetoSeguro(imagemCanonica.cache),
        status: imagemCanonica.status || "cache_canonico_evento_falha",
        motivo: imagemCanonica.motivo || "materializacao_canonica_falhou",
        imagemEnviavel: false,
        bloquearRematerializacaoRadar: true
      }
    }
  };
}

function aplicarImagemCanonicaFinalOferta(oferta = {}, imagemCanonica = {}) {
  const metadata = objetoSeguro(oferta.metadata);
  const temImagem = Boolean(imagemCanonica?.imagemCanonicaDuravel || imagemCanonica?.imagem);
  const imagem = imagemCanonica.imagemCanonicaDuravel || imagemCanonica.imagem || "";
  const imagemCacheCanonico = {
    ...objetoSeguro(metadata.imagemCacheCanonico),
    chave: imagemCanonica.chave || metadata.imagemCacheCanonico?.chave || "",
    produtoId: imagemCanonica.produtoId || metadata.imagemCacheCanonico?.produtoId || "",
    status: imagemCanonica.imagemStatus || (temImagem ? "imagem_canonica_final" : "nao_resolvida"),
    motivo: imagemCanonica.motivo || (temImagem ? "" : "nenhuma_fonte_de_imagem"),
    origem: imagemCanonica.imagemOrigem || metadata.imagemCacheCanonico?.origem || "",
    imagemCanonicaDuravel: imagem,
    imagemEnviavel: temImagem,
    preliminar: false,
    enriquecimentoPendente: false,
    imagemCanonicaFinal: true,
    materializacoes: Number(imagemCanonica.materializacoes || metadata.imagemCacheCanonico?.materializacoes || 0),
    cacheHit: imagemCanonica.cacheHit === true,
    resolvidaEm: imagemCanonica.resolvidaEm || new Date().toISOString(),
    ...(imagemCanonica.radarMirrorMaterializacao ? {
      radarMirrorMaterializacao: imagemCanonica.radarMirrorMaterializacao
    } : {})
  };

  return {
    ...oferta,
    ...(temImagem ? {
      imagem,
      imagemUrl: imagem,
      imagemOrigem: imagemCanonica.imagemOrigem || oferta.imagemOrigem || "imagem_canonica_final",
      imagemStatus: imagemCanonica.imagemStatus || "imagem_canonica_final",
      imagemRecuperavel: true,
      imagemDuravel: true,
      imagemEnviavel: true
    } : {
      imagemStatus: imagemCanonica.imagemStatus || oferta.imagemStatus || "nao_resolvida",
      imagemEnviavel: false
    }),
    metadata: {
      ...metadata,
      imagemCanonicaFinal: true,
      imagemCanonicaDuravel: imagem,
      imagemOrigem: temImagem ? (imagemCanonica.imagemOrigem || oferta.imagemOrigem || "imagem_canonica_final") : (oferta.imagemOrigem || "nenhuma"),
      imagemStatus: temImagem ? (imagemCanonica.imagemStatus || "imagem_canonica_final") : "nao_resolvida",
      imagemRecuperavel: temImagem,
      imagemDuravel: temImagem,
      imagemEnviavel: temImagem,
      imagemCacheCanonico
    }
  };
}

async function materializarImagemRadarMirrorSeNecessario(ofertaEntrada = {}, contexto = {}) {
  const oferta = ofertaEntrada && typeof ofertaEntrada === "object" ? ofertaEntrada : {};
  const imagemCanonicaEvento = encontrarImagemCanonicaEvento(oferta, contexto);
  if (imagemCanonicaEvento.imagem) {
    return {
      oferta: aplicarImagemCanonicaEventoOferta(oferta, imagemCanonicaEvento),
      status: "cache_canonico_evento",
      motivo: "imagem_canonica_pre_fanout",
      urlDuravel: imagemCanonicaEvento.imagem
    };
  }
  if (imagemCanonicaEvento.falhaMaterializacaoRadar) {
    return {
      oferta: aplicarFalhaCanonicaEventoOferta(oferta, imagemCanonicaEvento),
      status: "cache_canonico_evento_falha",
      motivo: imagemCanonicaEvento.motivo || "materializacao_canonica_falhou",
      urlOriginal: imagemCanonicaEvento.cache?.radarMirrorMaterializacao?.urlOriginal || ""
    };
  }

  const { radarMirror, imagemOriginal } = encontrarRadarMirrorMensagem(oferta, contexto);
  if (!radarMirror || !imagemOriginal) return { oferta, status: "sem_imagem_radar", motivo: "radar_sem_imagem" };

  const validacao = imagemUrlValidaUniversal(imagemOriginal);
  if (!validacao.ok) return { oferta, status: "nao_materializada", motivo: validacao.motivo || "url_invalida" };
  if (!imagemUrlEfemeraUniversal(validacao.url)) {
    return { oferta, status: "nao_necessaria", motivo: "imagem_radar_nao_efemera", url: validacao.url };
  }

  const download = await baixarBufferImagem(validacao.url, contexto);
  if (!download.ok) {
    return {
      oferta: {
        ...oferta,
        metadata: {
          ...objetoSeguro(oferta.metadata),
          imagemMaterializacao: {
            status: "falha",
            origem: "radar_mirror/mensagem",
            urlOriginal: validacao.url,
            motivo: download.motivo || "materializacao_falhou",
            statusHttp: download.statusHttp ?? null,
            storage: "social_media_storage"
          }
        }
      },
      status: "falha",
      motivo: download.motivo || "materializacao_falhou",
      urlOriginal: validacao.url
    };
  }

  try {
    const storage = contexto.storage || socialMediaStorage;
    const salva = storage.salvar({
      clienteId: contexto.job?.cliente_id || contexto.job?.clienteId || oferta.clienteId || "admin",
      buffer: download.buffer,
      mimeType: download.mimeType,
      nomeLogico: nomeLogicoImagemRadar(contexto.job, oferta)
    });
    return {
      oferta: aplicarRadarMirrorMaterializado(oferta, radarMirror, {
        urlOriginal: validacao.url,
        url: salva.url,
        mimeType: salva.mimeType,
        bytes: salva.bytes
      }),
      status: "materializada",
      urlOriginal: validacao.url,
      urlDuravel: salva.url,
      mimeType: salva.mimeType,
      bytes: salva.bytes
    };
  } catch (erro) {
    return {
      oferta: {
        ...oferta,
        metadata: {
          ...objetoSeguro(oferta.metadata),
          imagemMaterializacao: {
            status: "falha",
            origem: "radar_mirror/mensagem",
            urlOriginal: validacao.url,
            motivo: erro.message || "storage_falhou",
            storage: "social_media_storage"
          }
        }
      },
      status: "falha",
      motivo: erro.message || "storage_falhou",
      urlOriginal: validacao.url
    };
  }
}

function normalizarDadosComerciaisV24Seguro({ oferta = {}, ofertaEntrada = {}, job = {}, evento = {} } = {}) {
  try {
    return {
      ok: true,
      contrato: normalizarDadosComerciais({
        marketplace: oferta.marketplace || job.marketplace || job.marketplace_detectado || "",
        precoAtual: oferta.preco ?? ofertaEntrada.precoAtual ?? ofertaEntrada.preco,
        precoAnterior: oferta.precoOriginal ?? ofertaEntrada.precoOriginal ?? ofertaEntrada.precoAntigo,
        descontoPercentual: ofertaEntrada.descontoPercentual || ofertaEntrada.percentual || "",
        valorCupom: ofertaEntrada.valorCupom || ofertaEntrada.cupomValor || "",
        precoComCupom: ofertaEntrada.precoComCupom || ofertaEntrada.precoCupom || "",
        parcelamento: ofertaEntrada.parcelamento || "",
        moeda: oferta.moeda || ofertaEntrada.moeda || "BRL",
        origem: `engine_importer:${oferta.marketplace || job.marketplace || job.marketplace_detectado || "desconhecido"}`,
        textoOriginal: evento.texto_original || evento.textoOriginal || ""
      })
    };
  } catch (erro) {
    console.log("[OFC-V2.4-COMERCIAL-ERRO]", JSON.stringify({
      workspaceId: job.cliente_id || job.clienteId || "",
      marketplace: oferta.marketplace || job.marketplace || job.marketplace_detectado || "",
      ofertaId: job.oferta_id || null,
      jobId: job.id || null,
      motivo: "normalizador_comercial_exception",
      erro: String(erro?.message || "erro_desconhecido").slice(0, 180),
      aplicouMudancasOperacionais: false
    }));
    return {
      ok: false,
      contrato: null,
      motivo: "normalizador_comercial_exception",
      erro: String(erro?.message || "erro_desconhecido").slice(0, 180)
    };
  }
}

function construirEspelhoComercialV24Seguro({ oferta = {}, ofertaEntrada = {}, job = {}, evento = {}, link = {}, metadata = {}, comercialNormalizado = null } = {}) {
  const resultado = construirEspelhoComercialV24FailOpen({ oferta, ofertaEntrada, job, evento, link, metadata, comercialNormalizado });
  if (!resultado.ok) {
    console.log("[OFC-V2.4-ESPELHO-COMERCIAL-ERRO]", JSON.stringify({
      workspaceId: job.cliente_id || job.clienteId || "",
      marketplace: oferta.marketplace || job.marketplace || job.marketplace_detectado || "",
      ofertaId: job.oferta_id || null,
      jobId: job.id || null,
      motivo: resultado.motivo || "espelho_comercial_exception",
      erro: String(resultado.erro || "erro_desconhecido").slice(0, 180),
      aplicouMudancasOperacionais: false
    }));
  }
  return resultado;
}

function papelComercialIntegridade(papel = "") {
  const chave = normalizarTexto(papel)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .trim();

  if (["link_app", "app"].includes(chave)) return "link_app";
  if (["link_pc", "pc", "site", "desktop"].includes(chave)) return "link_pc";
  if (["link_moedas", "moedas", "coins"].includes(chave)) return "link_moedas";
  if (["produto", "link_produto", "cta", "link"].includes(chave)) return "produto";
  if (["resgate", "link_resgate"].includes(chave)) return "link_resgate";
  if (["cupom", "voucher"].includes(chave)) return "cupom";
  return chave || "desconhecido";
}

function tipoComercialIntegridade(papel = "") {
  const normalizado = papelComercialIntegridade(papel);
  if (normalizado === "link_resgate" || normalizado === "cupom") return "resgate";
  if (normalizado === "link_app") return "app";
  if (normalizado === "link_pc") return "pc";
  if (normalizado === "link_moedas") return "moedas";
  return normalizado;
}

function chaveUrlComercialIntegridade(url = "") {
  const valor = normalizarTexto(url);
  if (!valor) return "";
  try {
    const parsed = new URL(valor);
    parsed.hash = "";
    return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${parsed.pathname}`.replace(/\/+$/, "");
  } catch (_) {
    return valor.replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function chaveUrlExataComercialIntegridade(url = "") {
  const valor = normalizarTexto(url);
  if (!valor) return "";
  try {
    const parsed = new URL(valor);
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "").toLowerCase();
  } catch (_) {
    return valor.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function chavesUrlOcorrenciaComercial(item = {}) {
  const metadata = objetoSeguro(item.metadata);
  return [
    item.urlOriginal,
    item.url_original,
    item.url,
    item.original,
    item.href,
    item.resolvido,
    item.urlExpandida,
    item.url_expandida,
    item.urlNormalizada,
    item.url_normalizada,
    item.urlProduto,
    item.urlDestinoFuncional,
    item.urlUsadaNaConversao,
    item.sourceValuesUsado,
    item.conversaoWorkspace?.urlOriginal,
    item.conversaoWorkspace?.sourceValuesUsado,
    metadata.linkOriginalCapturado,
    metadata.linkResolvido,
    metadata.urlProduto
  ].map(url => ({
    exata: chaveUrlExataComercialIntegridade(url),
    funcional: chaveUrlComercialIntegridade(url)
  })).filter(chave => chave.exata || chave.funcional);
}

function papeisComerciaisCompativeis(a = "", b = "") {
  const papelA = papelComercialIntegridade(a);
  const papelB = papelComercialIntegridade(b);
  if (!papelA || !papelB || papelA === "desconhecido" || papelB === "desconhecido") return false;
  if (papelA === papelB) return true;
  const resgate = new Set(["cupom", "link_resgate", "resgate"]);
  if (resgate.has(papelA) && resgate.has(papelB)) return true;
  return false;
}

function normalizarRotaFuncional(valor = "") {
  const texto = normalizarTexto(valor);
  if (!texto) return "";
  try {
    return new URL(texto).pathname.replace(/\/+$/, "").toLowerCase();
  } catch (_) {
    return texto.replace(/\/+$/, "").toLowerCase();
  }
}

function papelPadraoMarketplaceRadar(url = "", marketplace = "") {
  const valor = normalizarTexto(url);
  const mp = normalizarTexto(marketplace)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!valor) return "";
  if (/mercadolivre\.com|meli\.la/i.test(valor) && /mercadolivre|mercado_livre|ml/.test(mp)) return "produto";
  if (/amazon\.com|amzn\.to/i.test(valor) && /amazon/.test(mp)) return "produto";
  if (/kabum\.com\.br|awin1?\.com|awin\.com/i.test(valor) && /kabum|awin/.test(mp)) return "produto";
  return "";
}

function destinoFuncionalDivergenteComercial(item = {}) {
  const destinoOriginal = objetoSeguro(item.destinoFuncionalOriginal);
  const destinoFinal = objetoSeguro(item.destinoFuncionalFinal);
  const tipoOriginal = normalizarTexto(destinoOriginal.tipo || "");
  const tipoFinal = normalizarTexto(destinoFinal.tipo || "");
  const tiposIgnorados = new Set(["", "desconhecido", "indisponivel"]);

  if (!tiposIgnorados.has(tipoOriginal) && !tiposIgnorados.has(tipoFinal) && tipoOriginal !== tipoFinal) {
    return true;
  }

  const shopOriginal = normalizarTexto(destinoOriginal.shopId || "");
  const itemOriginal = normalizarTexto(destinoOriginal.itemId || "");
  const shopFinal = normalizarTexto(destinoFinal.shopId || "");
  const itemFinal = normalizarTexto(destinoFinal.itemId || "");
  if (shopOriginal && itemOriginal && shopFinal && itemFinal) {
    return shopOriginal !== shopFinal || itemOriginal !== itemFinal;
  }

  const rotaOriginal = normalizarRotaFuncional(destinoOriginal.rota || destinoOriginal.url || "");
  const rotaFinal = normalizarRotaFuncional(destinoFinal.rota || destinoFinal.url || "");
  if (rotaOriginal && rotaFinal && rotaOriginal !== rotaFinal) return true;

  const destinoEsperado = chaveUrlComercialIntegridade(item.urlDestinoFuncional || item.uedOriginal || "");
  const destinoAfiliado = chaveUrlComercialIntegridade(item.uedFinalDecodificado || item.destinoFuncional || "");
  if (destinoEsperado && destinoAfiliado && destinoEsperado !== destinoAfiliado) return true;

  return false;
}

function dominioShopeeComercial(valor = "") {
  const texto = normalizarTexto(valor);
  if (!texto) return false;
  try {
    const host = new URL(texto).hostname.replace(/^www\./i, "").toLowerCase();
    return host === "s.shopee.com.br" || host === "shopee.com.br" || host.endsWith(".shopee.com.br");
  } catch (_) {
    return /(^|\/\/|\.)(s\.)?shopee\.com\.br\b/i.test(texto);
  }
}

function produtoShopeeRadarPreservado(item = {}, ocorrencia = {}) {
  const tipo = tipoComercialIntegridade(item.tipo || item.papel || item.papelLink || "");
  if (tipo !== "produto") return false;
  if (item.renderizavel !== true || !normalizarTexto(item.urlAfiliadaWorkspace || item.urlAfiliada || item.linkAfiliado || "")) return false;
  if (!papeisComerciaisCompativeis(item.papel || item.papelLink || item.tipo || "", ocorrencia.papel)) return false;

  const urlsOrigem = [
    item.urlOriginal,
    item.url,
    item.original,
    item.href,
    item.urlExpandida,
    item.resolvido,
    ocorrencia.urlOriginal
  ].filter(Boolean);
  if (!urlsOrigem.length || !urlsOrigem.every(dominioShopeeComercial)) return false;

  const motivo = normalizarTexto(item.motivoConversao || item.motivo || "");
  if (/produto_shopee_destino_divergente|ocorrencia_nao_capturada_radar/i.test(motivo)) return false;

  const destinoOriginal = objetoSeguro(item.destinoFuncionalOriginal);
  const destinoFinal = objetoSeguro(item.destinoFuncionalFinal);
  const shopOriginal = normalizarTexto(destinoOriginal.shopId || "");
  const itemOriginal = normalizarTexto(destinoOriginal.itemId || "");
  const shopFinal = normalizarTexto(destinoFinal.shopId || "");
  const itemFinal = normalizarTexto(destinoFinal.itemId || "");
  if (shopOriginal && itemOriginal && shopFinal && itemFinal) {
    return shopOriginal === shopFinal && itemOriginal === itemFinal;
  }

  return itemCorrespondeOcorrenciaRadar(item, ocorrencia);
}

function montarOcorrenciaRadarComercial(item = {}, indice = 0, marketplace = "", evento = {}) {
  const url = normalizarTexto(
    item.urlOriginal ||
    item.url_original ||
    item.url ||
    item.original ||
    item.href ||
    item.urlExpandida ||
    item.url_expandida ||
    ""
  );
  if (!url) return null;

  const classificacao = classificarLinkEngine({
    marketplace,
    evento,
    link: item,
    url
  });
  const papelClassificado = papelComercialIntegridade(item.papel || item.papelLink || item.tipo || classificacao.papelLink || "");
  const papel = papelClassificado && papelClassificado !== "desconhecido"
    ? papelClassificado
    : papelComercialIntegridade(papelPadraoMarketplaceRadar(url, marketplace));
  if (!papel || papel === "desconhecido") return null;

  const ordemCaptura = Number(item.ordemCaptura || item.ordem || item.indiceCaptura || indice + 1) || (indice + 1);
  return {
    papel,
    urlOriginal: url,
    ordemCaptura,
    ocorrenciaId: normalizarTexto(item.ocorrenciaId || item.idOcorrencia || item.id || `radar:${papel}:${ordemCaptura}`),
    chaves: chavesUrlOcorrenciaComercial({
      ...item,
      urlOriginal: url,
      url
    })
  };
}

function ocorrenciasRadarComerciais({ evento = {}, metadata = {}, ofertaEntrada = {}, marketplace = "" } = {}) {
  const ocorrencias = [];
  const vistos = new Set();
  const mp = normalizarTexto(marketplace || ofertaEntrada.marketplace || metadata.marketplace || "");

  function adicionar(item = {}, indice = 0) {
    const ocorrencia = montarOcorrenciaRadarComercial(item, indice, mp, evento);
    if (!ocorrencia) return;
    const chave = `${ocorrencia.ocorrenciaId}|${ocorrencia.papel}|${ocorrencia.ordemCaptura}|${ocorrencia.urlOriginal}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    ocorrencias.push(ocorrencia);
  }

  const linksEvento = Array.isArray(evento.links_extraidos) ? evento.links_extraidos : [];
  linksEvento.forEach((url, indice) => adicionar({ urlOriginal: url, url, ordemCaptura: indice + 1 }, indice));

  const radarMirrorLinks = [
    ...(Array.isArray(metadata?.radarMirror?.links?.encontrados) ? metadata.radarMirror.links.encontrados : []),
    ...(Array.isArray(metadata?.radarMirror?.comercial?.links?.classificados) ? metadata.radarMirror.comercial.links.classificados : [])
  ];
  radarMirrorLinks.forEach((item, indice) => adicionar(item, ocorrencias.length + indice));

  if (!ocorrencias.length && Array.isArray(ofertaEntrada?.metadata?.linksClassificados)) {
    ofertaEntrada.metadata.linksClassificados.forEach((item, indice) => adicionar(item, indice));
  }

  return ocorrencias.sort((a, b) => Number(a.ordemCaptura || 0) - Number(b.ordemCaptura || 0));
}

function itemCorrespondeOcorrenciaRadar(item = {}, ocorrencia = {}) {
  if (!papeisComerciaisCompativeis(item.papel || item.papelLink || item.tipo || "", ocorrencia.papel)) return false;
  const chavesItem = chavesUrlOcorrenciaComercial(item);
  if (!chavesItem.length || !Array.isArray(ocorrencia.chaves) || !ocorrencia.chaves.length) return false;

  return chavesItem.some(itemChave => ocorrencia.chaves.some(radarChave => (
    (itemChave.exata && radarChave.exata && itemChave.exata === radarChave.exata) ||
    (itemChave.funcional && radarChave.funcional && itemChave.funcional === radarChave.funcional)
  )));
}

function aplicarGuardaOcorrenciasRadar(links = [], ocorrenciasRadar = []) {
  if (!Array.isArray(links) || !links.length || !Array.isArray(ocorrenciasRadar) || !ocorrenciasRadar.length) {
    return {
      linksComerciais: Array.isArray(links) ? links : [],
      descartados: [],
      ocorrenciasRadar: Array.isArray(ocorrenciasRadar) ? ocorrenciasRadar : [],
      aplicada: false
    };
  }

  const usados = new Set();
  const linksComerciais = [];
  const descartados = [];

  for (const item of links) {
    const indiceRadar = ocorrenciasRadar.findIndex((ocorrencia, indice) => !usados.has(indice) && itemCorrespondeOcorrenciaRadar(item, ocorrencia));
    if (indiceRadar < 0) {
      descartados.push({
        ...item,
        renderizavel: false,
        seguro: false,
        urlAfiliada: "",
        urlAfiliadaWorkspace: "",
        urlOptimus: "",
        conversaoStatus: "falhou",
        motivoConversao: "ocorrencia_nao_capturada_radar",
        motivo: "ocorrencia_nao_capturada_radar"
      });
      continue;
    }

    usados.add(indiceRadar);
    const radar = ocorrenciasRadar[indiceRadar];
    const divergente = destinoFuncionalDivergenteComercial(item) && !produtoShopeeRadarPreservado(item, radar);
    linksComerciais.push({
      ...item,
      papel: item.papel || item.tipo || radar.papel,
      tipo: tipoComercialIntegridade(item.tipo || item.papel || radar.papel),
      ordemCaptura: radar.ordemCaptura,
      ocorrenciaId: item.ocorrenciaId || radar.ocorrenciaId,
      radarOcorrenciaId: radar.ocorrenciaId,
      urlOriginalRadar: radar.urlOriginal,
      renderizavel: divergente ? false : item.renderizavel === true,
      seguro: divergente ? false : item.seguro === true,
      urlAfiliada: divergente ? "" : item.urlAfiliada,
      urlAfiliadaWorkspace: divergente ? "" : item.urlAfiliadaWorkspace,
      urlOptimus: divergente ? "" : item.urlOptimus,
      conversaoStatus: divergente ? "falhou" : item.conversaoStatus,
      motivoConversao: divergente ? "destino_funcional_divergente_radar" : item.motivoConversao,
      motivo: divergente ? "destino_funcional_divergente_radar" : item.motivo
    });
  }

  return {
    linksComerciais,
    descartados,
    ocorrenciasRadar,
    aplicada: true
  };
}

function afiliadoGlobalCorrespondeOcorrenciaIntegridade(item = {}, oferta = {}, ofertaEntrada = {}, urlOriginal = "", urlExpandida = "") {
  const ctaAfiliado = normalizarTexto(oferta.linkAfiliado || "");
  if (!ctaAfiliado) return false;
  const principal = normalizarTexto(
    oferta.linkOriginal ||
    oferta.urlOriginal ||
    ofertaEntrada.linkOriginal ||
    ofertaEntrada.link_original ||
    ofertaEntrada?.metadata?.linkOriginalEngine ||
    ""
  );
  if (!principal) return false;
  const chavePrincipal = chaveUrlComercialIntegridade(principal);
  const candidatos = [
    urlOriginal,
    urlExpandida,
    item.url,
    item.original,
    item.href,
    item.resolvido,
    item.urlNormalizada,
    item.url_normalizada
  ].map(chaveUrlComercialIntegridade).filter(Boolean);
  return candidatos.some(chave => chave === chavePrincipal);
}

function coletarLinksIntegridadeComercial({ oferta = {}, ofertaEntrada = {}, metadata = {} } = {}) {
  const classificados = Array.isArray(ofertaEntrada?.metadata?.linksClassificados)
    ? ofertaEntrada.metadata.linksClassificados
    : [];
  const existentes = Array.isArray(metadata.linksComerciais)
    ? metadata.linksComerciais
    : [];
  const links = [];
  let ordemAutomatica = 0;
  const ctaAfiliado = normalizarTexto(oferta.linkAfiliado || "");

  function adicionar(item = {}, origem = "") {
    ordemAutomatica += 1;
    const papel = papelComercialIntegridade(item.papel || item.papelLink || item.tipo || item.role || "");
    const urlOriginal = normalizarTexto(item.urlOriginal || item.url || item.original || item.href || "");
    const urlExpandida = normalizarTexto(item.urlExpandida || item.expandida || "");
    const urlAfiliadaWorkspace = normalizarTexto(item.urlAfiliadaWorkspace || item.urlAfiliada || item.afiliado || item.linkAfiliado || "");
    const urlAfiliada = urlAfiliadaWorkspace;
    const urlRenderizavel = normalizarTexto(urlAfiliada || item.renderizarUrl || "");
    const urlBase = urlOriginal || urlExpandida || urlRenderizavel;
    const ordemCaptura = Number(item.ordemCaptura || item.ordem || item.indiceCaptura || ordemAutomatica) || ordemAutomatica;
    const ocorrenciaId = normalizarTexto(item.ocorrenciaId || item.idOcorrencia || "");

    if (!papel || papel === "desconhecido" || !urlBase) return;

    const afiliadoGlobalSeguro = afiliadoGlobalCorrespondeOcorrenciaIntegridade(item, oferta, ofertaEntrada, urlOriginal, urlExpandida);
    const convertidoWorkspace = item.convertidoWorkspace === true
      || item.workspaceConvertido === true
      || item.linkAfiliadoWorkspace === true
      || Boolean(urlAfiliada && urlAfiliada === ctaAfiliado)
      || Boolean(urlRenderizavel && urlRenderizavel === ctaAfiliado)
      || afiliadoGlobalSeguro;
    const renderizavel = item.renderizavel === true || convertidoWorkspace;
    const urlAfiliadaFinal = renderizavel
      ? (urlAfiliada || urlRenderizavel || (afiliadoGlobalSeguro ? ctaAfiliado : ""))
      : "";

    links.push({
      papel,
      tipo: tipoComercialIntegridade(papel),
      urlOriginal,
      urlExpandida,
      urlAfiliada: urlAfiliadaFinal,
      urlAfiliadaWorkspace: urlAfiliadaFinal,
      urlOptimus: normalizarTexto(item.urlOptimus || ""),
      ordemCaptura,
      ocorrenciaId,
      renderizavel,
      seguro: renderizavel,
      origem: origem || item.origem || "integridade_comercial",
      conversaoStatus: normalizarTexto(item.conversaoStatus || (renderizavel ? "convertida" : "falhou")),
      motivoConversao: normalizarTexto(item.motivoConversao || item.conversaoWorkspace?.motivo || ""),
      motivo: normalizarTexto(item.papelLinkMotivo || item.motivo || item.motivoConversao || item.conversaoWorkspace?.motivo || (renderizavel ? "cta_workspace_convertido" : "preservado_nao_renderizavel")),
      destinoFuncionalOriginal: item.destinoFuncionalOriginal || null,
      destinoFuncionalFinal: item.destinoFuncionalFinal || null,
      urlDestinoFuncional: normalizarTexto(item.urlDestinoFuncional || ""),
      uedOriginal: normalizarTexto(item.uedOriginal || ""),
      uedFinalDecodificado: normalizarTexto(item.uedFinalDecodificado || ""),
      urlUsadaNaConversao: normalizarTexto(item.urlUsadaNaConversao || ""),
      sourceValuesUsado: normalizarTexto(item.sourceValuesUsado || "")
    });
  }

  for (const item of existentes) adicionar(item, "metadata.linksComerciais");
  for (const item of classificados) adicionar(item, "adapter.linksClassificados");

  return links;
}

function campoRadarConfiavel(campo = {}) {
  if (!campo || typeof campo !== "object") return false;
  const confianca = normalizarTexto(campo.confianca || campo.confidence || "").toLowerCase();
  const valor = campo.valor ?? campo.texto ?? campo.evidencia ?? "";
  return ["alta", "media", "high", "medium"].includes(confianca) && valor !== null && valor !== undefined && valor !== "";
}

function textoEventoComercial(evento = {}, metadata = {}) {
  return normalizarTexto(
    evento.texto_original ||
    evento.textoOriginal ||
    evento.texto ||
    metadata.textoOriginal ||
    metadata.textoComercialOriginal ||
    ""
  );
}

function evidenciaComercialRadar({ evento = {}, metadata = {}, radarMirror = null } = {}) {
  const mirror = radarMirror || metadata?.radarMirror || {};
  const comercial = objetoSeguro(mirror.comercial);
  const cupom = objetoSeguro(comercial.cupom || mirror.cupom);
  const textoOriginal = textoEventoComercial(evento, metadata);
  const textoNormalizado = textoOriginal
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return {
    preco: campoRadarConfiavel(comercial.precoAtual || mirror.preco?.atualCapturado),
    precoDe: campoRadarConfiavel(comercial.precoAnterior || comercial.precoAntigo || mirror.preco?.anteriorCapturado),
    pix: campoRadarConfiavel(comercial.precoPix) || /\bpix\b/.test(textoNormalizado),
    cupom: campoRadarConfiavel(cupom) || /\b(?:cupom|voucher|codigo|resgate)\b/.test(textoNormalizado),
    beneficio: Boolean(
      campoRadarConfiavel(comercial.beneficio) ||
      campoRadarConfiavel(comercial.descontoPercentual) ||
      campoRadarConfiavel(comercial.moedasShopee) ||
      /\b(?:off|desconto|cupom|voucher|codigo|moeda|moedas|cashback|leve|ganhe|resgate)\b/.test(textoNormalizado)
    )
  };
}

function origemRadarComercial({ evento = {}, metadata = {}, radarMirror = null } = {}) {
  const mirror = radarMirror || metadata?.radarMirror || null;
  if (mirror && typeof mirror === "object" && Object.keys(mirror).length > 0) return true;
  if (textoEventoComercial(evento, metadata)) return true;
  if (Array.isArray(evento?.links_extraidos) && evento.links_extraidos.length > 0) return true;
  if (Array.isArray(metadata?.radarMirror?.links?.encontrados) && metadata.radarMirror.links.encontrados.length > 0) return true;
  if (Array.isArray(metadata?.radarMirror?.comercial?.links?.classificados) && metadata.radarMirror.comercial.links.classificados.length > 0) return true;
  return false;
}

function aplicarProtecaoCamposComerciaisRadar({ oferta = {}, metadata = {}, comercialNormalizado = null, evento = {}, radarMirror = null } = {}) {
  const evidencia = evidenciaComercialRadar({ evento, metadata, radarMirror });
  const proxima = { ...oferta };
  const origemRadar = origemRadarComercial({ evento, metadata, radarMirror });
  if (!origemRadar) {
    return { oferta: proxima, evidencia, aplicada: false };
  }
  const precoAtual = normalizarNumero(comercialNormalizado?.precoAtual);
  const precoConfiavelRadar = comercialNormalizado?.precoConfiavel === true
    && precoAtual !== null
    && /radar|texto_radar/i.test(normalizarTexto(comercialNormalizado?.precoOrigem || proxima.origemPreco || ""));

  if (precoConfiavelRadar) {
    proxima.preco = precoAtual;
    proxima.precoAtual = precoAtual;
    proxima.precoPor = precoAtual;
    proxima.precoPublicacao = precoAtual;
    proxima.origemPreco = "radar";
  }

  if (!evidencia.pix) {
    delete proxima.precoPix;
    delete proxima.condicaoPix;
    delete proxima.descontoPix;
  }

  if (!evidencia.cupom) {
    for (const campo of ["cupom", "codigoCupom", "codigo_cupom", "cupomTexto", "cupomCodigo"]) {
      delete proxima[campo];
    }
    proxima.cupomConfirmado = false;
    proxima.possivelCupom = false;
  }

  if (!evidencia.beneficio) {
    for (const campo of ["beneficioTexto", "beneficioExtra", "descricaoBeneficio", "avisoCupom"]) {
      delete proxima[campo];
    }
  }

  return { oferta: proxima, evidencia, aplicada: true };
}

function aplicarPonteIntegridadeComercial({ oferta = {}, ofertaEntrada = {}, metadata = {}, comercialNormalizado = null, evento = {}, radarMirror = null } = {}) {
  const precoAtual = normalizarNumero(comercialNormalizado?.precoAtual);
  const precoExistente = normalizarNumero(oferta.preco);
  const precoConfiavel = comercialNormalizado?.precoConfiavel === true && precoAtual !== null;
  const origemPreco = normalizarTexto(
    comercialNormalizado?.precoOrigem
    || ofertaEntrada.precoOrigem
    || ofertaEntrada.origemPreco
    || ofertaEntrada.metadata?.precoOrigem
    || ""
  );
  const protecaoRadar = aplicarProtecaoCamposComerciaisRadar({
    oferta,
    metadata,
    comercialNormalizado,
    evento,
    radarMirror
  });
  const ofertaProtegida = protecaoRadar.oferta || oferta;
  const linksColetados = coletarLinksIntegridadeComercial({ oferta: ofertaProtegida, ofertaEntrada, metadata });
  const ocorrenciasRadar = ocorrenciasRadarComerciais({
    evento,
    metadata,
    ofertaEntrada,
    marketplace: ofertaProtegida.marketplace || oferta.marketplace || ofertaEntrada.marketplace || ""
  });
  const guardaRadar = aplicarGuardaOcorrenciasRadar(linksColetados, ocorrenciasRadar);
  const linksComerciais = guardaRadar.linksComerciais;
  const integridadeComercial = {
    versao: "v1",
    precoValidado: precoConfiavel ? {
      valor: precoAtual,
      origem: origemPreco || "comercial_normalizado",
      confiavel: true
    } : null,
    linksComerciais,
    guardaRadar: {
      aplicada: guardaRadar.aplicada,
      totalOcorrenciasRadar: ocorrenciasRadar.length,
      totalLinksEntrada: linksColetados.length,
      totalLinksRenderizaveis: linksComerciais.filter(item => item.renderizavel === true).length,
      totalDescartados: guardaRadar.descartados.length,
      evidenciasProtegidas: protecaoRadar.evidencia,
      protecaoCamposRadar: protecaoRadar.aplicada === true
    },
    linksDescartadosRadar: guardaRadar.descartados,
    aplicouMudancasOperacionais: false
  };
  const ofertaCorrigida = precoExistente === null && precoConfiavel
    ? { ...ofertaProtegida, preco: precoAtual }
    : ofertaProtegida;
  const metadataCorrigido = {
    ...metadata,
    integridadeComercial,
    ...(guardaRadar.aplicada ? { linksComerciais } : (linksComerciais.length ? { linksComerciais } : {}))
  };

  return { oferta: ofertaCorrigida, metadata: metadataCorrigido, integridadeComercial };
}

function emitirLogsEspelhoComercialV24(resultado = {}, contexto = {}) {
  if (!resultado.ok || !resultado.espelhoComercial) return;
  const resumo = resumoEspelhoComercialLog(resultado, contexto);
  console.log(resumo.confiavel ? "[OFC-V2.4-ESPELHO-COMERCIAL-CRIADO]" : "[OFC-V2.4-ESPELHO-COMERCIAL-INCOMPLETO]", JSON.stringify(resumo));
  if (resultado.imagemComercial) {
    console.log("[OFC-V2.4-IMAGEM-COMERCIAL-SELECIONADA]", JSON.stringify({
      workspaceId: resumo.workspaceId,
      marketplace: resumo.marketplace,
      ofertaId: resumo.ofertaId,
      jobId: resumo.jobId,
      imagemOrigem: resultado.imagemComercial.origemSelecionada || "",
      imagemLimpa: resultado.imagemComercial.imagemLimpa === true,
      imagemOficial: resultado.imagemComercial.imagemOficial === true,
      possuiMarcaFonte: resultado.imagemComercial.possuiMarcaFonte === true,
      motivoSelecao: resultado.imagemComercial.motivoSelecao || "",
      aplicouMudancasOperacionais: false
    }));
  }
  if (resultado.templateEspelhoShadow) {
    console.log("[OFC-V2.4-TEMPLATE-ESPELHO-SHADOW]", JSON.stringify({
      workspaceId: resumo.workspaceId,
      marketplace: resumo.marketplace,
      ofertaId: resumo.ofertaId,
      jobId: resumo.jobId,
      ok: resultado.templateEspelhoShadow.ok === true,
      linhas: resultado.templateEspelhoShadow.linhas || 0,
      aplicouMudancasOperacionais: false
    }));
  }
}

function normalizarMarketplaceMemoria(valor = "") {
  const marketplace = normalizarTexto(valor).toLowerCase().replace(/[\s_-]+/g, "");
  if (marketplace === "ml" || marketplace.includes("mercadolivre")) return "mercadolivre";
  if (marketplace.includes("amazon")) return "amazon";
  if (marketplace.includes("shopee")) return "shopee";
  if (marketplace.includes("aliexpress")) return "aliexpress";
  if (marketplace.includes("kabum")) return "kabum";
  if (marketplace.includes("awin")) return "awin";
  if (marketplace.includes("magalu") || marketplace.includes("magazineluiza")) return "magalu";
  return marketplace;
}

function mapearOfertaMemoria(row = {}) {
  const inteligenciaV2 = row?.metadata?.inteligenciaUniversalV2 && typeof row.metadata.inteligenciaUniversalV2 === "object"
    ? row.metadata.inteligenciaUniversalV2
    : {};
  const oferta = {
    id: row.id,
    clienteId: row.cliente_id || "",
    marketplace: row.marketplace || "",
    titulo: row.titulo || "",
    tituloNormalizado: row.titulo_normalizado || "",
    preco: row.preco,
    precoAtual: row.preco,
    precoOriginal: row.preco_original,
    cupom: row.cupom || "",
    cupomTipo: row.tipo_cupom || "",
    tipoCupom: row.tipo_cupom || "",
    beneficioTexto: row.beneficio_extra || row.metadata?.beneficioTexto || row.metadata?.beneficioExtra || "",
    beneficioExtra: row.beneficio_extra || row.metadata?.beneficioExtra || "",
    linkOriginal: row.link_original || "",
    linkExpandido: row.link_expandido || "",
    linkAfiliado: row.link_afiliado || "",
    categoria: row.categoria || "",
    score: row.score,
    prioridade: row.prioridade,
    valorEfetivo: inteligenciaV2.valorEfetivo ?? null,
    valorEfetivoCentavos: inteligenciaV2.valorEfetivoCentavos ?? null,
    valorEfetivoOrigem: inteligenciaV2.valorEfetivoOrigem || "",
    valorEfetivoDetalhes: inteligenciaV2.valorEfetivoDetalhes || {},
    status: row.status || "",
    capturadaEm: row.capturada_em || row.criada_em || "",
    criadaEm: row.memoria_em || row.criada_em || "",
    metadata: row.metadata || {}
  };

  const identidade = detectarIdentidadeProdutoUniversal(oferta);
  return {
    ...oferta,
    produtoIdDetectado: identidade.produtoIdDetectado,
    tipoIdentidade: identidade.tipoIdentidade
  };
}

async function buscarMemoriaAnterioresEngine(oferta = {}, job = {}) {
  const clienteId = normalizarTexto(job.cliente_id || job.clienteId || "");
  const marketplace = normalizarMarketplaceMemoria(oferta.marketplace || job.marketplace || job.marketplace_detectado || "");
  const identidadeAtual = detectarIdentidadeProdutoUniversal(oferta);
  const usarMetadata = await engineOfertasTemMetadata();
  const campoMetadata = usarMetadata ? "o.metadata" : "'{}'::jsonb AS metadata";

  if (!clienteId || !marketplace) {
    console.log("[ENGINE-V2-MEMORIA]", JSON.stringify({
      jobId: job.id,
      clienteId,
      marketplace,
      memoriaDisponivel: false,
      memoria: "sem_historico",
      totalMemoriaCandidatos: 0,
      totalMemoriaAnteriores: 0,
      motivoMemoria: !clienteId ? "cliente_id_ausente" : "marketplace_ausente",
      produtoIdDetectado: identidadeAtual.produtoIdDetectado
    }));
    return {
      memoriaDisponivel: false,
      memoria: [],
      motivo: !clienteId ? "cliente_id_ausente" : "marketplace_ausente"
    };
  }

  const resultado = await queryEngine(
    `SELECT o.id, o.marketplace, o.titulo, o.titulo_normalizado,
            o.preco, o.preco_original, o.cupom, o.tipo_cupom,
            o.beneficio_extra, o.link_original, o.link_expandido,
            o.link_afiliado, o.categoria, o.score, o.prioridade,
            ${campoMetadata}, o.status, o.capturada_em, o.criada_em,
            COALESCE(publicacao.publicada_em, o.criada_em) AS memoria_em,
            j.cliente_id
       FROM engine_ofertas o
       JOIN engine_jobs_cliente j ON j.oferta_id = o.id
       LEFT JOIN LATERAL (
         SELECT MAX(p.criado_em) AS publicada_em
           FROM engine_processamentos p
          WHERE p.job_id = j.id
            AND p.etapa = 'distribuicao_final'
            AND p.status = 'ok'
            AND p.motivo = 'adicionada_fila'
       ) publicacao ON TRUE
      WHERE j.cliente_id = $1
        AND o.status = 'fila'
        AND CASE
              WHEN LOWER(REGEXP_REPLACE(COALESCE(o.marketplace, ''), '[[:space:]_-]+', '', 'g')) IN ('ml', 'mercadolivre') THEN 'mercadolivre'
              WHEN LOWER(REGEXP_REPLACE(COALESCE(o.marketplace, ''), '[[:space:]_-]+', '', 'g')) LIKE '%amazon%' THEN 'amazon'
              WHEN LOWER(REGEXP_REPLACE(COALESCE(o.marketplace, ''), '[[:space:]_-]+', '', 'g')) LIKE '%shopee%' THEN 'shopee'
              WHEN LOWER(REGEXP_REPLACE(COALESCE(o.marketplace, ''), '[[:space:]_-]+', '', 'g')) LIKE '%aliexpress%' THEN 'aliexpress'
              WHEN LOWER(REGEXP_REPLACE(COALESCE(o.marketplace, ''), '[[:space:]_-]+', '', 'g')) LIKE '%kabum%' THEN 'kabum'
              WHEN LOWER(REGEXP_REPLACE(COALESCE(o.marketplace, ''), '[[:space:]_-]+', '', 'g')) LIKE '%awin%' THEN 'awin'
              ELSE LOWER(REGEXP_REPLACE(COALESCE(o.marketplace, ''), '[[:space:]_-]+', '', 'g'))
            END = $2
        AND ($3::bigint IS NULL OR o.id <> $3::bigint)
        AND COALESCE(publicacao.publicada_em, o.criada_em) >= NOW() - INTERVAL '30 days'
      ORDER BY COALESCE(publicacao.publicada_em, o.criada_em) DESC NULLS LAST, o.id DESC
      LIMIT 300`,
    [clienteId, marketplace, job.oferta_id || null]
  );

  if (!resultado.ok) {
    console.log("[ENGINE-V2-MEMORIA-ERRO]", JSON.stringify({
      jobId: job.id,
      clienteId,
      marketplace,
      memoriaDisponivel: false,
      motivo: resultado.motivo || "query_falhou",
      erro: resultado.erro || ""
    }));
    return {
      memoriaDisponivel: false,
      memoria: [],
      motivo: "erro_consulta_memoria"
    };
  }

  const memoria = resultado.resultado.rows.map(mapearOfertaMemoria);
  console.log("[ENGINE-V2-MEMORIA]", JSON.stringify({
    jobId: job.id,
    clienteId,
    marketplace,
    memoriaDisponivel: true,
    memoria: memoria.length ? "historico_carregado" : "sem_historico",
    totalMemoriaCandidatos: memoria.length,
    totalMemoriaAnteriores: memoria.length,
    motivoMemoria: memoria.length ? "historico_operacional_fila_30d" : "sem_historico_operacional_fila_30d",
    produtoIdDetectado: identidadeAtual.produtoIdDetectado,
    tipoIdentidade: identidadeAtual.tipoIdentidade,
    metadataDisponivel: usarMetadata,
    dataMemoriaOrigem: "engine_processamentos.distribuicao_final; fallback engine_ofertas.criada_em",
    ofertaAtualIdExcluida: job.oferta_id || null
  }));

  return {
    memoriaDisponivel: true,
    memoria,
    motivo: memoria.length ? "historico_operacional_fila_30d" : "sem_historico_operacional_fila_30d"
  };
}

async function aplicarSombraInteligenciaUniversalV2(oferta = {}, ofertaEntrada = {}, job = {}) {
  try {
    const consultaMemoria = await buscarMemoriaAnterioresEngine(oferta, job);
    const memoriaCandidatos = Array.isArray(consultaMemoria.memoria) ? consultaMemoria.memoria : [];
    const produtoMetadata = objetoSeguro(ofertaEntrada?.metadata?.produto);
    const resultadoV2 = avaliarOfertaUniversal({
      clienteId: job.cliente_id || job.clienteId || "",
      titulo: oferta.titulo,
      marketplace: oferta.marketplace,
      precoAtual: oferta.preco,
      preco: oferta.preco,
      precoOriginal: oferta.precoOriginal,
      precoAntigo: oferta.precoOriginal,
      cupom: oferta.cupom,
      cupomTipo: oferta.cupomTipo,
      tipoCupom: oferta.cupomTipo,
      valorCupom: ofertaEntrada.valorCupom || ofertaEntrada.cupomValor || produtoMetadata.valorCupom || produtoMetadata.cupomValor || "",
      percentualCupom: ofertaEntrada.percentualCupom || ofertaEntrada.cupomPercentual || produtoMetadata.percentualCupom || produtoMetadata.cupomPercentual || "",
      precoPix: ofertaEntrada.precoPix || produtoMetadata.precoPix || "",
      descontoPix: ofertaEntrada.descontoPix || produtoMetadata.descontoPix || "",
      beneficioTexto: ofertaEntrada.beneficioTexto || ofertaEntrada.beneficioExtra || ofertaEntrada.avisoCupom || "",
      beneficioExtra: ofertaEntrada.beneficioExtra || "",
      avisoCupom: ofertaEntrada.avisoCupom || "",
      parcelamento: ofertaEntrada.parcelamento || "",
      freteGratis: ofertaEntrada.freteGratis === true,
      freteValor: ofertaEntrada.freteValor || ofertaEntrada.valorFrete || produtoMetadata.freteValor || produtoMetadata.valorFrete || "",
      cashback: ofertaEntrada.cashback || "",
      cashbackValor: ofertaEntrada.cashbackValor || produtoMetadata.cashbackValor || "",
      cashbackPercentual: ofertaEntrada.cashbackPercentual || produtoMetadata.cashbackPercentual || "",
      beneficios: Array.isArray(ofertaEntrada.beneficios)
        ? ofertaEntrada.beneficios
        : (Array.isArray(produtoMetadata.beneficios) ? produtoMetadata.beneficios : []),
      metadata: ofertaEntrada.metadata || {},
      imagem: oferta.imagem,
      shopId: oferta.shopId || produtoMetadata.shopId || "",
      itemId: oferta.itemId || produtoMetadata.itemId || "",
      produtoIdDetectado: oferta.produtoIdDetectado || produtoMetadata.produtoId || "",
      linkOriginal: oferta.linkOriginal,
      linkExpandido: oferta.linkExpandido,
      linkAfiliado: oferta.linkAfiliado,
      categoria: oferta.categoria,
      score: oferta.score,
      origem: "engine_importer"
    }, {
      clienteId: job.cliente_id || job.clienteId || "",
      origem: "engine_importer",
      exigirLinkAfiliado: true,
      memoriaAnteriores: memoriaCandidatos,
      memoriaDisponivel: consultaMemoria.memoriaDisponivel === true,
      memoriaMotivoIndisponivel: consultaMemoria.motivo || ""
    });

    const scoreCalculadoV2 = normalizarNumero(resultadoV2.score?.score ?? resultadoV2.score);
    const prioridadeCalculadaV2 = normalizarNumero(resultadoV2.prioridade);
    const scoreV2 = scoreCalculadoV2 ?? prioridadeCalculadaV2 ?? 0;
    const prioridadeV2 = prioridadeCalculadaV2 ?? scoreV2;
    const ofertaUniversal = resultadoV2.ofertaUniversal || {};
    const memoriaV2 = resultadoV2.memoria || {};
    const valorEfetivoDetalhes = objetoSeguro(resultadoV2.valorEfetivoDetalhes);
    const totalMemoriaCandidatos = memoriaCandidatos.length;
    const coerenciaPreco = validarCoerenciaPreco({
      ...oferta,
      precoAtual: oferta.preco,
      preco: oferta.preco,
      precoOriginal: oferta.precoOriginal,
      valorCupom: ofertaEntrada.valorCupom || ofertaEntrada.cupomValor || produtoMetadata.valorCupom || produtoMetadata.cupomValor || "",
      percentualCupom: ofertaEntrada.percentualCupom || ofertaEntrada.cupomPercentual || produtoMetadata.percentualCupom || produtoMetadata.cupomPercentual || "",
      cupomTipo: oferta.cupomTipo || ofertaEntrada.cupomTipo || ofertaEntrada.tipoCupom || produtoMetadata.cupomTipo || produtoMetadata.tipoCupom || ""
    }, {
      ofertaEntrada,
      job
    });
    const statusFinalV2 = coerenciaPreco.bloquear ? "retida" : (resultadoV2.status || "");
    const motivoFinalV2 = coerenciaPreco.bloquear ? coerenciaPreco.motivo : (resultadoV2.motivo || "");
    const okFinalV2 = resultadoV2.ok === true && coerenciaPreco.bloquear !== true;

    if (coerenciaPreco.bloquear) {
      console.log("[PRECO-COERENCIA]", JSON.stringify({
        jobId: job.id,
        clienteId: job.cliente_id || job.clienteId || "",
        marketplace: oferta.marketplace || "",
        classificacao: coerenciaPreco.classificacao,
        motivo: coerenciaPreco.motivo,
        precoAtual: coerenciaPreco.precoAtual,
        precoOriginal: coerenciaPreco.precoOriginal,
        radarPrecoAtual: coerenciaPreco.radarPrecoAtual,
        importadorPrecoAtual: coerenciaPreco.importadorPrecoAtual,
        cupomConfirmado: coerenciaPreco.cupomConfirmado === true
      }));
    }

    console.log("[V2-MEMORIA-DECISAO]", JSON.stringify({
      clienteId: job.cliente_id || job.clienteId || "",
      marketplace: oferta.marketplace || "",
      produtoIdDetectado: memoriaV2.produtoIdDetectado || "",
      memoriaDisponivel: memoriaV2.memoriaDisponivel === true,
      totalMemoriaCandidatos,
      totalMemoriaCompativeis: memoriaV2.totalMemoriaCompativeis || 0,
      totalMemoriaJanela2h: memoriaV2.totalMemoriaJanela2h || 0,
      valorEfetivoAtual: memoriaV2.valorEfetivoAtual ?? null,
      menorValorEfetivoJanela: memoriaV2.menorValorEfetivoJanela ?? null,
      memoriaOficialStatus: memoriaV2.memoriaOficialStatus || "neutra",
      memoriaOficialMotivo: memoriaV2.memoriaOficialMotivo || "",
      memoriaOficialShadowStatus: memoriaV2.memoriaOficialShadowStatus || "neutra",
      memoriaOficialShadowMotivo: memoriaV2.memoriaOficialShadowMotivo || "",
      motivoMemoria: memoriaV2.motivoMemoria || memoriaV2.motivo || "",
      repeticaoIdentica: memoriaV2.repeticaoIdentica === true,
      historicoCompativelSemMelhoria: memoriaV2.historicoCompativelSemMelhoria === true,
      precoCaiu: memoriaV2.precoCaiu === true,
      cupomNovo: memoriaV2.cupomNovo === true,
      beneficioMelhorou: memoriaV2.beneficioMelhorou === true,
      valorEfetivo: resultadoV2.valorEfetivo ?? null,
      valorEfetivoOrigem: resultadoV2.valorEfetivoOrigem || "",
      valorEfetivoComprovado: valorEfetivoDetalhes.comprovado === true,
      score: scoreV2,
      prioridade: prioridadeV2,
      status: statusFinalV2,
      motivoDecisao: motivoFinalV2
    }));

    return {
      ok: okFinalV2,
      oferta: {
        ...oferta,
        score: scoreV2 !== null ? scoreV2 : oferta.score,
        prioridade: prioridadeV2 !== null ? prioridadeV2 : 0
      },
      metadata: {
        inteligenciaUniversalV2: {
          modo: "oficial",
          ok: okFinalV2,
          status: statusFinalV2,
          motivo: motivoFinalV2,
          motivoDecisao: motivoFinalV2,
          score: scoreV2,
          prioridade: prioridadeV2,
          categoria: resultadoV2.categoria || "",
          valorEfetivo: resultadoV2.valorEfetivo ?? null,
          valorEfetivoCentavos: resultadoV2.valorEfetivoCentavos ?? null,
          valorEfetivoOrigem: resultadoV2.valorEfetivoOrigem || "",
          valorEfetivoComprovado: valorEfetivoDetalhes.comprovado === true,
          valorEfetivoDetalhes,
          precoCoerencia: coerenciaPreco,
          memoria: memoriaV2,
          memoriaDisponivel: memoriaV2.memoriaDisponivel === true,
          destino: resultadoV2.destino || {},
          templateInput: resultadoV2.templateInput || {},
          totalMemoriaCandidatos,
          totalMemoriaAnteriores: totalMemoriaCandidatos,
          totalMemoriaCompativeis: memoriaV2.totalMemoriaCompativeis || 0,
          totalMemoriaJanela2h: memoriaV2.totalMemoriaJanela2h || 0,
          valorEfetivoAtual: memoriaV2.valorEfetivoAtual ?? null,
          menorValorEfetivoJanela: memoriaV2.menorValorEfetivoJanela ?? null,
          memoriaOficialStatus: memoriaV2.memoriaOficialStatus || "neutra",
          memoriaOficialMotivo: memoriaV2.memoriaOficialMotivo || "",
          memoriaOficial: {
            disponivel: memoriaV2.memoriaDisponivel === true,
            status: memoriaV2.memoriaOficialStatus || "neutra",
            motivo: memoriaV2.memoriaOficialMotivo || "",
            totalCandidatos: totalMemoriaCandidatos,
            totalCompativeis: memoriaV2.totalMemoriaCompativeis || 0,
            totalJanela2h: memoriaV2.totalMemoriaJanela2h || 0,
            valorEfetivoAtual: memoriaV2.valorEfetivoAtual ?? null,
            menorValorEfetivoJanela: memoriaV2.menorValorEfetivoJanela ?? null
          },
          memoriaOficialShadowStatus: memoriaV2.memoriaOficialShadowStatus || "neutra",
          memoriaOficialShadowMotivo: memoriaV2.memoriaOficialShadowMotivo || "",
          motivoMemoria: memoriaV2.motivoMemoria || memoriaV2.motivo || "",
          produtoIdDetectado: memoriaV2.produtoIdDetectado || "",
          precoCaiu: memoriaV2.precoCaiu === true,
          cupomNovo: memoriaV2.cupomNovo === true,
          beneficioMelhorou: memoriaV2.beneficioMelhorou === true,
          repeticaoIdentica: memoriaV2.repeticaoIdentica === true,
          historicoCompativelSemMelhoria: memoriaV2.historicoCompativelSemMelhoria === true,
          comparativo: {
            precoAntes: oferta.preco,
            precoDepois: ofertaUniversal.precoAtual ?? oferta.preco,
            cupomAntes: oferta.cupom || "",
            cupomDepois: ofertaUniversal.cupom || "",
            categoriaAntes: oferta.categoria || "",
            categoriaDepois: resultadoV2.categoria || ofertaUniversal.categoria || "",
            scoreAntes: oferta.score ?? null,
            scoreDepois: scoreV2
          },
          logs: resultadoV2.logs || []
        }
      }
    };
  } catch (err) {
    console.log("[ENGINE-V2-ERRO]", JSON.stringify({
      jobId: job.id,
      clienteId: job.cliente_id || job.clienteId || "",
      marketplace: oferta.marketplace || "",
      erro: err.message
    }));

    return {
      ok: false,
      oferta: { ...oferta, prioridade: 0 },
      metadata: {
        inteligenciaUniversalV2: {
          modo: "oficial",
          ok: false,
          status: "retida",
          motivo: "erro_avaliacao_v2",
          motivoDecisao: "erro_avaliacao_v2",
          memoriaDisponivel: false,
          memoriaOficialStatus: "indisponivel",
          memoriaOficialMotivo: "erro_avaliacao_v2",
          memoriaOficial: {
            disponivel: false,
            status: "indisponivel",
            motivo: "erro_avaliacao_v2",
            totalCandidatos: 0,
            totalCompativeis: 0,
            totalJanela2h: 0,
            valorEfetivoAtual: null,
            menorValorEfetivoJanela: null
          },
          valorEfetivo: null,
          valorEfetivoOrigem: "erro_avaliacao_v2",
          valorEfetivoComprovado: false,
          valorEfetivoDetalhes: { comprovado: false },
          erro: err.message
        }
      }
    };
  }
}

async function gravarOfertaEngine(job = {}, evento = {}, link = {}, ofertaEntrada = {}) {
  const fidelidadeTraceIdPrincipal = fidelidadeObs.flagAtiva()
    ? fidelidadeObs.resolverFidelidadeTraceId(ofertaEntrada, ofertaEntrada.metadata, evento, evento.metadata, job, link)
    : "";
  const contextoFidelidadeImportador = fidelidadeTraceIdPrincipal
    ? { fidelidadeTraceId: fidelidadeTraceIdPrincipal }
    : {};
  fidelidadeObs.registrarSnapshot("importador_entrada", {
    ...contextoFidelidadeImportador,
    job,
    evento,
    link,
    oferta: ofertaEntrada,
    clienteId: job.cliente_id || job.clienteId || "",
    marketplace: job.marketplace || job.marketplace_detectado || ""
  });
  fidelidadeObs.registrarLinks("importador_entrada", {
    ...contextoFidelidadeImportador,
    job,
    evento,
    link,
    oferta: ofertaEntrada,
    links: evento.links_extraidos || [],
    linkProduto: link.url_expandida || link.url_original || ofertaEntrada.linkOriginal || ""
  });
  fidelidadeObs.registrarImagem("importador_entrada", {
    ...contextoFidelidadeImportador,
    job,
    evento,
    link,
    oferta: ofertaEntrada,
    imagem: ofertaEntrada.imagem || ofertaEntrada.image || ofertaEntrada.imagemUrl || ofertaEntrada.thumbnail || "",
    status: ofertaEntrada.imagem || ofertaEntrada.image || ofertaEntrada.imagemUrl || ofertaEntrada.thumbnail
      ? "URL_http_presente"
      : "ausente_no_importador"
  });
  let oferta = normalizarOfertaImportada(ofertaEntrada, job);
  if (fidelidadeTraceIdPrincipal) {
    oferta = {
      ...oferta,
      fidelidadeTraceId: fidelidadeTraceIdPrincipal,
      metadata: {
        ...(oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {}),
        fidelidadeTraceId: fidelidadeTraceIdPrincipal
      }
    };
  }
  const coberturaTraceIdPrincipal = coberturaRadar.flagAtiva()
    ? (
      ofertaEntrada.coberturaTraceId ||
      ofertaEntrada.metadata?.coberturaTraceId ||
      evento.coberturaTraceId ||
      evento.metadata?.coberturaTraceId ||
      job.coberturaTraceId ||
      job.metadata?.coberturaTraceId ||
      job.metadata?.metadataEvento?.coberturaTraceId ||
      ""
    )
    : "";
  if (coberturaTraceIdPrincipal) {
    oferta = {
      ...oferta,
      coberturaTraceId: coberturaTraceIdPrincipal,
      metadata: {
        ...(oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {}),
        coberturaTraceId: coberturaTraceIdPrincipal
      }
    };
  }
  const materializacaoRadarMirror = await materializarImagemRadarMirrorSeNecessario(oferta, {
    origem: "engine_importer",
    ofertaEntrada,
    evento,
    job,
    link
  });
  oferta = materializacaoRadarMirror.oferta || oferta;
  if (materializacaoRadarMirror.status && materializacaoRadarMirror.status !== "sem_imagem_radar") {
    console.log("[IMAGEM-RADAR-MIRROR-MATERIALIZACAO]", JSON.stringify({
      jobId: job.id || null,
      eventoId: job.evento_id || null,
      clienteId: job.cliente_id || job.clienteId || "",
      marketplace: oferta.marketplace || job.marketplace || job.marketplace_detectado || "",
      status: materializacaoRadarMirror.status,
      motivo: materializacaoRadarMirror.motivo || "",
      origem: "radar_mirror/mensagem",
      urlOriginalHost: (() => {
        try { return new URL(materializacaoRadarMirror.urlOriginal || "").hostname; } catch (_) { return ""; }
      })(),
      urlDuravelHost: (() => {
        try { return new URL(materializacaoRadarMirror.urlDuravel || "").hostname; } catch (_) { return ""; }
      })(),
      mimeType: materializacaoRadarMirror.mimeType || "",
      bytes: materializacaoRadarMirror.bytes || 0
    }));
  }

  oferta = resolverImagemUniversal(oferta, {
    origem: "engine_importer",
    ofertaEntrada,
    evento,
    job,
    link,
  });
  const temImagemImporter = Boolean(oferta.imagem);
  const campoImagemImporter = oferta.imagemOrigem || "";
  fidelidadeObs.registrarSnapshot("importador_saida", {
    ...contextoFidelidadeImportador,
    job,
    evento,
    link,
    oferta,
    clienteId: job.cliente_id || job.clienteId || "",
    marketplace: oferta.marketplace || job.marketplace || job.marketplace_detectado || ""
  });
  fidelidadeObs.registrarImagem("importador_saida", {
    ...contextoFidelidadeImportador,
    job,
    evento,
    link,
    oferta,
    imagem: oferta.imagem || "",
    imagemOrigem: oferta.imagemOrigem || "",
    status: oferta.imagem ? "URL_http_presente" : "ausente_no_importador",
    motivo: oferta.imagem ? "" : "imagem_nao_resolvida_apos_importador"
  });
  fidelidadeObs.registrarIdentidade("importador_saida", {
    ...contextoFidelidadeImportador,
    job,
    evento,
    link,
    oferta,
    marketplaceInicial: job.marketplace_detectado || "",
    marketplaceImportador: oferta.marketplace || "",
    marketplaceFinal: oferta.marketplace || "",
    urlOriginal: oferta.linkOriginal || link.url_original || "",
    produtoIdImportado: oferta.produtoIdDetectado || oferta.itemId || ""
  });
  fidelidadeObs.registrarPreco("importador_saida", {
    ...contextoFidelidadeImportador,
    job,
    evento,
    oferta,
    precoDe: oferta.precoOriginal,
    precoPor: oferta.preco,
    precoImportador: ofertaEntrada.preco || ofertaEntrada.precoAtual || ""
  });
  fidelidadeObs.registrarCupom("importador_saida", {
    ...contextoFidelidadeImportador,
    job,
    evento,
    oferta,
    cupom: oferta.cupom,
    produzidoPor: "normalizarOfertaImportada"
  });
  let sombraV2 = await aplicarSombraInteligenciaUniversalV2(oferta, ofertaEntrada, job);
  oferta = sombraV2.oferta || oferta;
  let imagemResolucaoEngine = resolverImagemEngineFallback({ oferta, ofertaEntrada, evento, job, link });

  if (!oferta.imagem && imagemResolucaoEngine.imagem) {
    oferta.imagem = imagemResolucaoEngine.imagem;
    oferta.imagemOrigem = imagemResolucaoEngine.origem;
  }

  const imagemAnterior = await buscarImagemAnteriorEngine(oferta, job);
  let imagemCanonica = {
    imagem: "",
    origem: "",
    linkResolvido: oferta.linkExpandido || oferta.linkOriginal || "",
    statusHttp: oferta.statusHttp ?? ofertaEntrada.statusHttp ?? null,
    motivo: ""
  };

  if (!oferta.imagem && imagemAnterior.imagem) {
    oferta.imagem = imagemAnterior.imagem;
    oferta.imagemOrigem = imagemAnterior.origem;
    imagemResolucaoEngine = {
      imagem: imagemAnterior.imagem,
      origem: imagemAnterior.origem,
      tipo: "fallback_historico",
      fallbackUsado: true,
      motivo: imagemAnterior.motivo || ""
    };
  }

  if (!oferta.imagem && normalizarMarketplaceMemoria(oferta.marketplace) === "mercadolivre") {
    imagemCanonica = await buscarImagemCanonicaMercadoLivre(oferta, {
      clienteId: job.cliente_id || job.clienteId || "",
      job,
      getIntegracaoCliente: deps.getIntegracaoCliente
    });
    if (imagemCanonica.imagem) {
      oferta.imagem = imagemCanonica.imagem;
      oferta.imagemOrigem = imagemCanonica.origem;
      oferta.linkResolvidoImagem = imagemCanonica.linkResolvido || "";
      imagemResolucaoEngine = {
        imagem: imagemCanonica.imagem,
        origem: imagemCanonica.origem,
        tipo: "fallback_canonico_ml",
        fallbackUsado: true,
        motivo: imagemCanonica.motivo || ""
      };
    }
  }

  const imagemCanonicaFinal = await resolverImagemCanonicaFinalEvento({
    eventoId: job.evento_id,
    marketplace: oferta.marketplace || job.marketplace || job.marketplace_detectado || "",
    linksExtraidos: evento.links_extraidos || [],
    metadataEvento: {
      ...objetoSeguro(job.metadata?.metadataEvento),
      ...objetoSeguro(evento.metadata)
    },
    ofertaEntrada,
    ofertaEnriquecida: oferta,
    job,
    link
  });
  oferta = aplicarImagemCanonicaFinalOferta(oferta, imagemCanonicaFinal);
  if (imagemCanonicaFinal.imagemCanonicaDuravel) {
    imagemResolucaoEngine = {
      imagem: imagemCanonicaFinal.imagemCanonicaDuravel,
      origem: imagemCanonicaFinal.imagemOrigem || "imagem_canonica_final",
      tipo: "imagem_canonica_final",
      fallbackUsado: !temImagemImporter,
      motivo: imagemCanonicaFinal.motivo || ""
    };
  }

  const identidadeImagem = detectarIdentidadeProdutoUniversal(oferta);
  const motivoFallbackImagem = imagemResolucaoEngine.motivo === "nenhuma_fonte_de_imagem"
    ? "sem_candidato"
    : imagemResolucaoEngine.motivo;
  const motivoSemImagem = oferta.imagem
    ? ""
    : (imagemCanonicaFinal.motivo || imagemCanonica.motivo || imagemAnterior.motivo || motivoFallbackImagem || "nenhuma_fonte_de_imagem");
  const imagemOrigemFinal = oferta.imagemOrigem || campoImagemImporter || "nenhuma";
  const imagemFallbackUsado = Boolean(oferta.imagem && (imagemResolucaoEngine.fallbackUsado === true || !temImagemImporter));
  const imagemAusenteMotivo = oferta.imagem ? "" : motivoSemImagem;
  logResolucaoImagemEngine({
    job,
    oferta,
    resolucao: {
      ...imagemResolucaoEngine,
      origem: imagemOrigemFinal,
      fallbackUsado: imagemFallbackUsado
    },
    motivoSemImagem: imagemAusenteMotivo
  });

  if (normalizarMarketplaceMemoria(oferta.marketplace) === "mercadolivre") {
    console.log("[ML-IMAGEM-FALLBACK]", JSON.stringify({
      clienteId: job.cliente_id || job.clienteId || "",
      titulo: oferta.titulo || "",
      produtoIdDetectado: identidadeImagem.produtoIdDetectado || "",
      linkOriginal: oferta.linkOriginal || link?.url_original || "",
      linkResolvido: imagemCanonicaFinal.linkResolvido || imagemCanonica.linkResolvido || oferta.linkExpandido || link?.url_expandida || "",
      statusHttp: imagemCanonicaFinal.statusHttp ?? imagemCanonica.statusHttp ?? oferta.statusHttp ?? ofertaEntrada.statusHttp ?? null,
      temImagemParser: temImagemImporter,
      temImagemHistorica: Boolean(imagemAnterior.imagem),
      imagemFinal: oferta.imagem || "",
      origemImagemFinal: imagemOrigemFinal,
      motivoSemImagem
    }));
  }

  const metadataEvento = objetoSeguro(evento.metadata || {});
  const metadataBase = objetoSeguro(oferta.metadata || ofertaEntrada.metadata || {});
  const radarMirrorBase = metadataBase.radarMirror || metadataEvento.radarMirror || null;
  const radarMirrorComparado = radarMirrorBase
    ? compararRadarMirrorComImportador(radarMirrorBase, oferta)
    : null;
  let metadataFinal = mergeRadarMirrorMetadata({
    ...metadataEvento,
    ...metadataBase,
    ...objetoSeguro(sombraV2.metadata || {}),
    ...(coberturaTraceIdPrincipal ? { coberturaTraceId: coberturaTraceIdPrincipal } : {}),
    ...(fidelidadeTraceIdPrincipal ? { fidelidadeTraceId: fidelidadeTraceIdPrincipal } : {}),
    imagemOrigem: imagemOrigemFinal,
    imagemFallbackUsado,
    imagemAusenteMotivo,
    imagemStatus: oferta.imagemStatus || (oferta.imagem ? "imagem_enviavel" : "nao_resolvida"),
    imagemUrlPresente: oferta.imagemUrlPresente === true || Boolean(oferta.imagem),
    imagemRecuperavel: oferta.imagemRecuperavel === true,
    imagemDuravel: oferta.imagemDuravel === true,
    imagemEnviavel: oferta.imagemEnviavel === true,
    imagemAuditoria: {
      temImagemImporter,
      temImagemEngine: Boolean(oferta.imagem),
      campoImagemUsado: imagemOrigemFinal === "nenhuma" ? "" : imagemOrigemFinal,
      origemImagem: imagemOrigemFinal,
      fallbackUsado: imagemFallbackUsado,
      ausenciaMotivo: imagemAusenteMotivo,
      motivoSemImagem: imagemAusenteMotivo,
      status: oferta.imagemStatus || (oferta.imagem ? "imagem_enviavel" : "nao_resolvida"),
      urlPresente: oferta.imagemUrlPresente === true || Boolean(oferta.imagem),
      recuperavel: oferta.imagemRecuperavel === true,
      duravel: oferta.imagemDuravel === true,
      enviavel: oferta.imagemEnviavel === true,
      materializacao: materializacaoRadarMirror.status || "",
      temImagemHistorica: Boolean(imagemAnterior.imagem),
      linkResolvidoImagem: imagemCanonicaFinal.linkResolvido || imagemCanonica.linkResolvido || oferta.linkExpandido || "",
      statusHttpImagem: imagemCanonicaFinal.statusHttp ?? imagemCanonica.statusHttp ?? oferta.statusHttp ?? ofertaEntrada.statusHttp ?? null
    }
  }, radarMirrorComparado);
  if (radarMirrorComparado) {
    console.log("[RADAR-MIRROR-PRESERVADO]", JSON.stringify({
      ...resumirRadarMirrorLog(radarMirrorComparado, {
        clienteId: job.cliente_id || job.clienteId || "",
        marketplace: oferta.marketplace || ""
      }),
      etapa: "engine_ofertas"
    }));
    const resultadoPrecedenciaComercial = resolverPrecedenciaComercialRadar({
      ofertaImportador: oferta,
      radarMirror: radarMirrorComparado,
      metadata: metadataFinal,
      clienteId: job.cliente_id || job.clienteId || "",
      marketplace: oferta.marketplace || ""
    });
    metadataFinal = resultadoPrecedenciaComercial?.metadata || metadataFinal;
    oferta = resultadoPrecedenciaComercial?.oferta || oferta;
    console.log("[RADAR-COMERCIAL-RESOLVIDO]", JSON.stringify({
      ...resumirPrecedenciaComercialLog(resultadoPrecedenciaComercial),
      etapa: "engine_ofertas"
    }));
    if (deveLogarDivergenciaComercial(resultadoPrecedenciaComercial)) {
      console.log("[RADAR-COMERCIAL-DIVERGENCIA]", JSON.stringify({
        ...resumirPrecedenciaComercialLog(resultadoPrecedenciaComercial),
        etapa: "engine_ofertas"
      }));
    }
    emitirLogRadarPrecoSuspeito(resultadoPrecedenciaComercial, "engine_ofertas");
  }
  const categoriaFinalResolvida = reclassificarCategoriaFinalEngine(oferta, metadataFinal, job);
  oferta = categoriaFinalResolvida.oferta || oferta;
  metadataFinal = categoriaFinalResolvida.metadataFinal || metadataFinal;
  if (radarMirrorComparado) {
    sombraV2 = await aplicarSombraInteligenciaUniversalV2(oferta, ofertaEntrada, job);
    oferta = sombraV2.oferta || oferta;
    metadataFinal = {
      ...metadataFinal,
      ...objetoSeguro(sombraV2.metadata || {})
    };
  }
  const inteligenciaV2 = objetoSeguro(metadataFinal.inteligenciaUniversalV2);
  const retidaV2 = inteligenciaV2.status === "retida" || sombraV2.ok === false;
  const statusPersistencia = retidaV2 ? "retida_v2" : "importada";
  const motivoPersistencia = retidaV2
    ? (inteligenciaV2.motivoDecisao || inteligenciaV2.motivo || "retida_v2")
    : null;
  const resultadoComercialV24 = normalizarDadosComerciaisV24Seguro({ oferta, ofertaEntrada, job, evento });
  const comercialNormalizadoV24 = resultadoComercialV24.contrato;
  const ponteIntegridadeComercial = aplicarPonteIntegridadeComercial({
    oferta,
    ofertaEntrada,
    metadata: metadataFinal,
    comercialNormalizado: comercialNormalizadoV24,
    evento,
    radarMirror: radarMirrorComparado
  });
  oferta = ponteIntegridadeComercial.oferta || oferta;
  metadataFinal = ponteIntegridadeComercial.metadata || metadataFinal;
  const resultadoEspelhoComercialV24 = construirEspelhoComercialV24Seguro({
    oferta,
    ofertaEntrada,
    job,
    evento,
    link,
    metadata: metadataFinal,
    comercialNormalizado: comercialNormalizadoV24
  });
  metadataFinal = {
    ...metadataFinal,
    ofcV24: {
      ...(objetoSeguro(metadataFinal.ofcV24)),
      comercialNormalizado: comercialNormalizadoV24,
      erroComercialNormalizado: resultadoComercialV24.ok ? null : {
        motivo: resultadoComercialV24.motivo,
        erro: resultadoComercialV24.erro
      },
      integridadeComercial: ponteIntegridadeComercial.integridadeComercial,
      espelhoComercial: resultadoEspelhoComercialV24.espelhoComercial,
      documentoComercialCanonico: resultadoEspelhoComercialV24.documentoComercialCanonico,
      erroBlocosComerciais: resultadoEspelhoComercialV24.documentoComercialCanonico?.erroBlocosComerciais || null,
      imagemComercial: resultadoEspelhoComercialV24.imagemComercial,
      templateEspelhoShadow: resultadoEspelhoComercialV24.templateEspelhoShadow,
      erroEspelhoComercial: resultadoEspelhoComercialV24.ok ? null : {
        motivo: resultadoEspelhoComercialV24.motivo,
        erro: resultadoEspelhoComercialV24.erro
      },
      aplicouMudancasOperacionais: false,
      fonte: "normalizador_comercial_shadow"
    }
  };
  emitirLogsEspelhoComercialV24(resultadoEspelhoComercialV24, {
    workspaceId: job.cliente_id || job.clienteId || "",
    marketplace: oferta.marketplace || job.marketplace || job.marketplace_detectado || "",
    ofertaId: job.oferta_id || null,
    jobId: job.id || null
  });
  if (comercialNormalizadoV24) {
    console.log(comercialNormalizadoV24.precoConfiavel ? "[OFC-V2.4-COMERCIAL-NORMALIZADO]" : "[OFC-V2.4-COMERCIAL-INVALIDO]", JSON.stringify({
      workspaceId: job.cliente_id || job.clienteId || "",
      marketplace: comercialNormalizadoV24.marketplace,
      ofertaId: job.oferta_id || null,
      jobId: job.id || null,
      precoAtual: comercialNormalizadoV24.precoAtual,
      precoAnterior: comercialNormalizadoV24.precoAnterior,
      descontoPercentual: comercialNormalizadoV24.descontoPercentual,
      precoComCupom: comercialNormalizadoV24.precoComCupom,
      precoOrigem: comercialNormalizadoV24.precoOrigem,
      precoConfiavel: comercialNormalizadoV24.precoConfiavel,
      motivo: comercialNormalizadoV24.avisoPreco || "",
      calculadoEm: comercialNormalizadoV24.calculadoEm
    }));
  }
  const ofertaUniversalInicial = montarOfertaUniversalEngine({
    oferta,
    ofertaEntrada,
    job,
    evento,
    link,
    metadata: metadataFinal,
    status: statusPersistencia,
    motivo: motivoPersistencia || ""
  });
  const validacaoOfertaUniversal = validarContratoOfertaUniversal(ofertaUniversalInicial);
  metadataFinal = {
    ...metadataFinal,
    ofertaUniversalSchemaVersion: ofertaUniversalInicial.schemaVersion,
    ofertaUniversal: congelarOfertaUniversal(ofertaUniversalInicial),
    ofertaUniversalValidacao: validacaoOfertaUniversal
  };

  console.log("[OFERTA-UNIVERSAL-CRIADA]", JSON.stringify(resumoOfertaUniversalLog(ofertaUniversalInicial, validacaoOfertaUniversal)));
  console.log(validacaoOfertaUniversal.ok ? "[OFERTA-UNIVERSAL-VALIDADA]" : "[OFERTA-UNIVERSAL-REJEITADA]", JSON.stringify(resumoOfertaUniversalLog(ofertaUniversalInicial, validacaoOfertaUniversal)));
  if (retidaV2) {
    console.log("[OFERTA-UNIVERSAL-RETIDA]", JSON.stringify({
      ...resumoOfertaUniversalLog(ofertaUniversalInicial, validacaoOfertaUniversal),
      motivo: motivoPersistencia || "retida_v2"
    }));
  }
  console.log("[ENGINE-V2-INTELIGENCIA-APLICADA]", JSON.stringify({
    jobId: job.id || null,
    eventoId: job.evento_id || null,
    workspaceId: job.cliente_id || job.clienteId || "",
    marketplace: oferta.marketplace || "",
    score: inteligenciaV2.score ?? oferta.score ?? null,
    prioridade: inteligenciaV2.prioridade ?? oferta.prioridade ?? null,
    categoria: inteligenciaV2.categoria || oferta.categoria || "",
    status: inteligenciaV2.status || "",
    motivo: inteligenciaV2.motivoDecisao || inteligenciaV2.motivo || ""
  }));
  console.log("[ENGINE-V2-AFILIACAO-CONCLUIDA]", JSON.stringify({
    jobId: job.id || null,
    eventoId: job.evento_id || null,
    workspaceId: job.cliente_id || job.clienteId || "",
    marketplace: oferta.marketplace || "",
    statusConversao: ofertaUniversalInicial.afiliacao.statusConversao,
    temUrlBase: Boolean(ofertaUniversalInicial.afiliacao.urlBase),
    temUrlAfiliada: Boolean(ofertaUniversalInicial.afiliacao.urlAfiliada)
  }));
  const valores = [
    job.evento_id,
    link?.id || null,
    oferta.marketplace,
    oferta.titulo,
    oferta.tituloNormalizado,
    oferta.preco,
    oferta.precoOriginal,
    oferta.cupom,
    oferta.cupomTipo,
    ofertaEntrada.beneficioExtra || "",
    oferta.imagem,
    oferta.linkOriginal || link?.url_original || "",
    oferta.linkExpandido || link?.url_expandida || link?.url_normalizada || "",
    oferta.linkAfiliado,
    oferta.categoria,
    oferta.score,
    oferta.prioridade || 0,
    evento?.capturado_em || new Date(),
    statusPersistencia,
    motivoPersistencia
  ];

  let resultado;
  const metadataOferta = JSON.stringify(metadataFinal);
  const usarMetadata = await engineOfertasTemMetadata();

  if (job.oferta_id) {
    if (usarMetadata) {
      resultado = await queryEngine(
        `UPDATE engine_ofertas
            SET evento_id = $1,
                link_id = $2,
                marketplace = $3,
                titulo = $4,
                titulo_normalizado = $5,
                preco = $6,
                preco_original = $7,
                moeda = 'BRL',
                cupom = $8,
                tipo_cupom = $9,
                beneficio_extra = $10,
                imagem = $11,
                link_original = $12,
                link_expandido = $13,
                link_afiliado = $14,
                categoria = $15,
                score = $16,
                prioridade = $17,
                origem = 'engine_importer',
                status = $19,
                motivo_status = $20,
                capturada_em = $18,
                metadata = $21::jsonb,
                atualizada_em = NOW()
          WHERE id = $22
          RETURNING id, uuid`,
        [...valores, metadataOferta, job.oferta_id]
      );
    } else {
      resultado = await queryEngine(
        `UPDATE engine_ofertas
            SET evento_id = $1,
                link_id = $2,
                marketplace = $3,
                titulo = $4,
                titulo_normalizado = $5,
                preco = $6,
                preco_original = $7,
                moeda = 'BRL',
                cupom = $8,
                tipo_cupom = $9,
                beneficio_extra = $10,
                imagem = $11,
                link_original = $12,
                link_expandido = $13,
                link_afiliado = $14,
                categoria = $15,
                score = $16,
                prioridade = $17,
                origem = 'engine_importer',
                status = $19,
                motivo_status = $20,
                capturada_em = $18,
                atualizada_em = NOW()
          WHERE id = $21
          RETURNING id, uuid`,
        [...valores, job.oferta_id]
      );
    }
  } else if (usarMetadata) {
    resultado = await queryEngine(
      `INSERT INTO engine_ofertas (
         evento_id, link_id, marketplace, titulo, titulo_normalizado,
         preco, preco_original, moeda, cupom, tipo_cupom, beneficio_extra,
         imagem, link_original, link_expandido, link_afiliado, categoria,
         score, prioridade, origem, status, motivo_status, capturada_em, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'BRL', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'engine_importer', $19, $20, $18, $21::jsonb)
       RETURNING id, uuid`,
      [...valores, metadataOferta]
    );
  } else {
    resultado = await queryEngine(
      `INSERT INTO engine_ofertas (
         evento_id, link_id, marketplace, titulo, titulo_normalizado,
         preco, preco_original, moeda, cupom, tipo_cupom, beneficio_extra,
         imagem, link_original, link_expandido, link_afiliado, categoria,
         score, prioridade, origem, status, motivo_status, capturada_em
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'BRL', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'engine_importer', $19, $20, $18)
       RETURNING id, uuid`,
      valores
    );
  }

  if (!resultado.ok) {
    logEngineImporterErro({ jobId: job.id, etapa: "oferta_gravada", motivo: resultado.motivo, erro: resultado.erro || "" });
    return { ok: false, motivo: resultado.motivo || "oferta_gravacao_falhou", erro: resultado.erro || "" };
  }

  const ofertaId = resultado.resultado.rows[0]?.id;
  if (!ofertaId) {
    return { ok: false, motivo: "oferta_nao_retornada" };
  }

  if (usarMetadata) {
    const ofertaUniversalPersistida = congelarOfertaUniversal({
      ...metadataFinal.ofertaUniversal,
      ofertaId,
      atualizadoEm: new Date().toISOString()
    });
    metadataFinal = {
      ...metadataFinal,
      ofertaUniversal: ofertaUniversalPersistida
    };
    const atualizacaoMetadata = await queryEngine(
      `UPDATE engine_ofertas
          SET metadata = $2::jsonb,
              atualizada_em = NOW()
        WHERE id = $1
        RETURNING id`,
      [ofertaId, JSON.stringify(metadataFinal)]
    );
    if (!atualizacaoMetadata.ok) {
      logEngineImporterErro({
        jobId: job.id,
        ofertaId,
        etapa: "oferta_universal_metadata",
        motivo: atualizacaoMetadata.motivo || "metadata_update_falhou",
        erro: atualizacaoMetadata.erro || ""
      });
      return {
        ok: false,
        motivo: atualizacaoMetadata.motivo || "oferta_universal_metadata_falhou",
        erro: atualizacaoMetadata.erro || ""
      };
    }
  }

  if (normalizarMarketplaceMemoria(oferta.marketplace) === "shopee") {
    const precoAuditoria = objetoSeguro(
      metadataFinal.precoAuditoria || metadataFinal.produto?.precoAuditoria || {}
    );
    const templateInputV2 = objetoSeguro(metadataFinal.inteligenciaUniversalV2?.templateInput || {});
    console.log("[SHOPEE-PRECO-AUDITORIA]", JSON.stringify({
      etapa: "engine_ofertas",
      jobId: job.id || null,
      clienteId: job.cliente_id || job.clienteId || "",
      urlOriginal: oferta.linkOriginal || link?.url_original || "",
      urlExpandida: oferta.linkExpandido || link?.url_expandida || "",
      shopId: oferta.shopId || "",
      itemId: oferta.itemId || "",
      titulo: oferta.titulo || "",
      precoTextoRadar: precoAuditoria.precoTextoRadar || "",
      precoApi: precoAuditoria.precoApi ?? "",
      precoBruto: precoAuditoria.precoBruto ?? "",
      precoNormalizado: precoAuditoria.precoNormalizado ?? "",
      precoAdapter: precoAuditoria.precoAdapter ?? ofertaEntrada.preco ?? ofertaEntrada.precoAtual ?? null,
      precoEngine: oferta.preco ?? null,
      precoTemplate: templateInputV2.precoAtual ?? oferta.preco ?? null,
      origemPreco: precoAuditoria.origemPreco || "",
      motivoEscolhaPreco: precoAuditoria.motivoEscolhaPreco || "",
      campoPrecoUsado: precoAuditoria.campoPrecoUsado || "",
      tipoCampoPrecoUsado: precoAuditoria.tipoCampoPrecoUsado || "",
      precoAntesNormalizacao: precoAuditoria.precoAntesNormalizacao ?? "",
      precoDepoisNormalizacao: precoAuditoria.precoDepoisNormalizacao ?? "",
      normalizadorAplicado: precoAuditoria.normalizadorAplicado || "",
      suspeitaFator100: precoAuditoria.suspeitaFator100 === true
    }));
  }

  logEngineImporterOfertaCriada({
    jobId: job.id,
    ofertaId,
    clienteId: job.cliente_id || job.clienteId || "",
    marketplace: oferta.marketplace,
    titulo: oferta.titulo,
    preco: oferta.preco,
    precoOriginal: oferta.precoOriginal,
    cupom: oferta.cupom,
    linkAfiliado: oferta.linkAfiliado,
    temImagem: Boolean(oferta.imagem),
    imagemPreview: normalizarTexto(oferta.imagem || "").slice(0, 140),
    categoria: oferta.categoria,
    score: oferta.score,
    prioridade: oferta.prioridade || 0,
    inteligenciaV2: metadataFinal.inteligenciaUniversalV2 ? {
      modo: metadataFinal.inteligenciaUniversalV2.modo,
      status: metadataFinal.inteligenciaUniversalV2.status,
      motivoDecisao: metadataFinal.inteligenciaUniversalV2.motivoDecisao,
      memoria: metadataFinal.inteligenciaUniversalV2.memoria?.motivo || "",
      memoriaDisponivel: metadataFinal.inteligenciaUniversalV2.memoriaDisponivel === true,
      totalMemoriaCandidatos: metadataFinal.inteligenciaUniversalV2.totalMemoriaCandidatos || 0,
      totalMemoriaAnteriores: metadataFinal.inteligenciaUniversalV2.totalMemoriaAnteriores || 0,
      totalMemoriaCompativeis: metadataFinal.inteligenciaUniversalV2.totalMemoriaCompativeis || 0,
      totalMemoriaJanela2h: metadataFinal.inteligenciaUniversalV2.totalMemoriaJanela2h || 0,
      valorEfetivoAtual: metadataFinal.inteligenciaUniversalV2.valorEfetivoAtual ?? null,
      menorValorEfetivoJanela: metadataFinal.inteligenciaUniversalV2.menorValorEfetivoJanela ?? null,
      memoriaOficialStatus: metadataFinal.inteligenciaUniversalV2.memoriaOficialStatus || "neutra",
      memoriaOficialMotivo: metadataFinal.inteligenciaUniversalV2.memoriaOficialMotivo || "",
      memoriaOficialShadowStatus: metadataFinal.inteligenciaUniversalV2.memoriaOficialShadowStatus || "neutra",
      memoriaOficialShadowMotivo: metadataFinal.inteligenciaUniversalV2.memoriaOficialShadowMotivo || "",
      motivoMemoria: metadataFinal.inteligenciaUniversalV2.motivoMemoria || "",
      produtoIdDetectado: metadataFinal.inteligenciaUniversalV2.produtoIdDetectado || "",
      precoCaiu: metadataFinal.inteligenciaUniversalV2.precoCaiu === true,
      cupomNovo: metadataFinal.inteligenciaUniversalV2.cupomNovo === true,
      beneficioMelhorou: metadataFinal.inteligenciaUniversalV2.beneficioMelhorou === true,
      repeticaoIdentica: metadataFinal.inteligenciaUniversalV2.repeticaoIdentica === true,
      historicoCompativelSemMelhoria: metadataFinal.inteligenciaUniversalV2.historicoCompativelSemMelhoria === true,
      valorEfetivo: metadataFinal.inteligenciaUniversalV2.valorEfetivo ?? null,
      valorEfetivoCentavos: metadataFinal.inteligenciaUniversalV2.valorEfetivoCentavos ?? null,
      valorEfetivoOrigem: metadataFinal.inteligenciaUniversalV2.valorEfetivoOrigem || "",
      valorEfetivoComprovado: metadataFinal.inteligenciaUniversalV2.valorEfetivoComprovado === true,
      valorEfetivoDetalhes: metadataFinal.inteligenciaUniversalV2.valorEfetivoDetalhes || {}
    } : null,
    status: statusPersistencia,
    atualizada: Boolean(job.oferta_id)
  });
  void registrarOfertaUniversalCriada({
    job,
    ofertaId,
    oferta,
    status: statusPersistencia,
    motivo: motivoPersistencia || "oferta_criada"
  });
  return {
    ok: true,
    ofertaId,
    ofertaUuid: resultado.resultado.rows[0]?.uuid,
    oferta,
    retidaV2,
    statusV2: inteligenciaV2.status || "",
    motivoV2: motivoPersistencia || ""
  };
}
async function marcarJobOfertaCriada(jobId, ofertaId) {
  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET status = 'oferta_criada', oferta_id = $2, motivo_final = 'oferta_criada', atualizado_em = NOW()
      WHERE id = $1 AND status = 'importando'
      RETURNING id, status, oferta_id`,
    [jobId, ofertaId]
  );

  if (!resultado.ok) {
    logEngineImporterErro({ jobId, etapa: "marcar_oferta_criada", motivo: resultado.motivo, erro: resultado.erro || "" });
  }

  if (resultado.ok && resultado.resultado.rowCount === 0) {
    logEngineImporterErro({ jobId, etapa: "marcar_oferta_criada", motivo: "job_nao_importando", erro: "" });
    return { ...resultado, ok: false, ignorado: true, motivo: "job_nao_importando" };
  }

  return resultado;
}

async function marcarJobRetidaV2(jobId, ofertaId, motivo = "retida_v2") {
  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET status = 'retida_v2', oferta_id = $2, motivo_final = $3, atualizado_em = NOW()
      WHERE id = $1 AND status = 'importando'
      RETURNING id, status, oferta_id, motivo_final`,
    [jobId, ofertaId, motivo || "retida_v2"]
  );

  if (!resultado.ok) {
    logEngineImporterErro({ jobId, etapa: "marcar_retida_v2", motivo: resultado.motivo, erro: resultado.erro || "" });
  }

  if (resultado.ok && resultado.resultado.rowCount === 0) {
    logEngineImporterErro({ jobId, etapa: "marcar_retida_v2", motivo: "job_nao_importando", erro: "" });
    return { ...resultado, ok: false, ignorado: true, motivo: "job_nao_importando" };
  }

  return resultado;
}

async function marcarJobErroImportacao(jobId, motivo = "erro_importacao", detalhes = {}) {
  await registrarEtapaImportacao(jobId, "importacao_finalizada", "erro", motivo, detalhes);
  return marcarJobStatus(jobId, "erro_importacao", motivo, { statusEsperado: ["importando", "pronto_para_importar"] });
}

module.exports = {
  buscarJobsProntos,
  resolverImagemEngineFallback,
  tentarMarcarImportando,
  registrarEtapaImportacao,
  carregarEventoBruto,
  carregarLinksEvento,
  gravarOfertaEngine,
  marcarJobOfertaCriada,
  marcarJobRetidaV2,
  marcarJobErroImportacao,
  normalizarOfertaImportada,
  resolverCategoriaEngine,
  reclassificarCategoriaFinalEngine,
  buscarImagemCanonicaMercadoLivre,
  buscarImagemOficialMercadoLivrePorMlb,
  extrairImagemOficialMercadoLivreApi,
  extrairImagemPolycardMercadoLivreHtml,
  montarUrlImagemPolycardMl,
  validarImagemPolycardMercadoLivre,
  materializarImagemRadarMirrorSeNecessario,
  aplicarPonteIntegridadeComercial,
  ocorrenciasRadarComerciais,
  aplicarGuardaOcorrenciasRadar
};
