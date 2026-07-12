const { queryEngine } = require("../database");
const {
  marcarJobStatus,
  registrarProcessamento,
  carregarEventoBruto,
  carregarLinksEvento,
  limitarJobs
} = require("../processor.service");
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
  logEngineImporterErro,
  logEngineImporterOfertaCriada
} = require("../logger");

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
  if (valor === null || valor === undefined || valor === "") return null;
  const texto = String(valor)
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .trim();

  if (!texto) return null;

  let numero = Number(texto);
  if (!Number.isFinite(numero)) {
    numero = Number(texto.replace(/\./g, "").replace(",", "."));
  }

  return Number.isFinite(numero) ? numero : null;
}

function categoriaGenericaEngine(categoria = "") {
  const texto = normalizarTexto(categoria)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return !texto || texto === "mercadolivre" || texto === "ml" || texto === "marketplace" || texto === "generica" || texto === "geral";
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
  const filtros = ["status = 'pronto_para_importar'"];
  const marketplaceExpr = "LOWER(COALESCE(NULLIF(TRIM(marketplace), ''), NULLIF(TRIM(marketplace_detectado), ''), ''))";
  const marketplaceFiltro = String(marketplace || "").trim().toLowerCase();

  if (marketplaceFiltro) {
    params.push(marketplaceFiltro);
    filtros.push(`${marketplaceExpr} = $${params.length}`);
  }

  params.push(limitarJobs(limite));

  const resultado = await queryEngine(
    `SELECT id, uuid, evento_id, oferta_id, cliente_id, marketplace_detectado,
            marketplace, status, motivo_final, metadata, criado_em, atualizado_em
       FROM engine_jobs_cliente
      WHERE ${filtros.join(" AND ")}
      ORDER BY atualizado_em ASC NULLS FIRST, id ASC
      LIMIT $${params.length}`,
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

  return {
    ok: resultado.ok !== false,
    marketplace: normalizarTexto(resultado.marketplace || job.marketplace || job.marketplace_detectado),
    titulo: normalizarTexto(resultado.titulo || resultado.nome || ""),
    tituloNormalizado: normalizarTitulo(resultado.titulo || resultado.nome || ""),
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

function extrairCanonicalImagemMercadoLivre(html = "") {
  return htmlDecode(
    String(html || "").match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ||
    String(html || "").match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1] ||
    extrairMeta(html, "og:url") ||
    ""
  ).trim();
}

function urlCanonicaImagemMercadoLivreSegura(url = "", mlbEsperado = "") {
  try {
    const parsed = new URL(normalizarTexto(url));
    return parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase().endsWith("mercadolivre.com.br") &&
      extrairMlbImagem(parsed.toString()) === mlbEsperado;
  } catch {
    return false;
  }
}

async function buscarImagemCanonicaMercadoLivre(oferta = {}) {
  const urls = [oferta.linkExpandido, oferta.linkOriginal]
    .map(normalizarTexto)
    .filter(Boolean);
  const urlInicial = urls.find(url => extrairMlbImagem(url) && /mercadolivre\.com\.br/i.test(url));
  const mlb = extrairMlbImagem(urlInicial);

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

  try {
    let response = await fetch(urlInicial, options);
    let html = await response.text();
    let linkResolvido = response.url || urlInicial;
    let statusHttp = response.status;
    let bloqueado = /captcha|account-verification|access denied|robot check|verifique[^<]{0,80}rob/i.test(html);
    let imagemExtraida = statusHttp < 400 && !bloqueado ? extrairImagemHtmlMercadoLivre(html) : { imagem: "", origem: "nenhuma" };
    const canonical = extrairCanonicalImagemMercadoLivre(html);

    if (!imagemExtraida.imagem && urlCanonicaImagemMercadoLivreSegura(canonical, mlb) && canonical !== linkResolvido) {
      response = await fetch(canonical, options);
      html = await response.text();
      linkResolvido = response.url || canonical;
      statusHttp = response.status;
      bloqueado = /captcha|account-verification|access denied|robot check|verifique[^<]{0,80}rob/i.test(html);
      imagemExtraida = statusHttp < 400 && !bloqueado ? extrairImagemHtmlMercadoLivre(html) : { imagem: "", origem: "nenhuma" };
    }

    const motivo = imagemExtraida.imagem
      ? "imagem_canonica_recuperada"
      : (statusHttp >= 400 ? `http_${statusHttp}` : (bloqueado ? "html_bloqueado" : "html_sem_imagem_valida"));

    return {
      imagem: imagemExtraida.imagem,
      origem: imagemExtraida.imagem ? `canonical.${imagemExtraida.origem}` : "",
      linkResolvido,
      statusHttp,
      motivo
    };
  } catch (erro) {
    return {
      imagem: "",
      origem: "",
      linkResolvido: urlInicial,
      statusHttp: null,
      motivo: erro?.name === "AbortError" ? "timeout_url_canonica" : `falha_url_canonica:${erro.message}`
    };
  } finally {
    clearTimeout(timer);
  }
}

function objetoSeguro(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function normalizarMarketplaceMemoria(valor = "") {
  const marketplace = normalizarTexto(valor).toLowerCase().replace(/[\s_-]+/g, "");
  if (marketplace === "ml" || marketplace.includes("mercadolivre")) return "mercadolivre";
  if (marketplace.includes("amazon")) return "amazon";
  if (marketplace.includes("shopee")) return "shopee";
  if (marketplace.includes("aliexpress")) return "aliexpress";
  if (marketplace.includes("kabum")) return "kabum";
  if (marketplace.includes("awin")) return "awin";
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
      status: resultadoV2.status || "",
      motivoDecisao: resultadoV2.motivo || ""
    }));

    return {
      ok: true,
      oferta: {
        ...oferta,
        score: scoreV2 !== null ? scoreV2 : oferta.score,
        prioridade: prioridadeV2 !== null ? prioridadeV2 : 0
      },
      metadata: {
        inteligenciaUniversalV2: {
          modo: "oficial",
          ok: resultadoV2.ok === true,
          status: resultadoV2.status || "",
          motivo: resultadoV2.motivo || "",
          motivoDecisao: resultadoV2.motivo || "",
          score: scoreV2,
          prioridade: prioridadeV2,
          categoria: resultadoV2.categoria || "",
          valorEfetivo: resultadoV2.valorEfetivo ?? null,
          valorEfetivoCentavos: resultadoV2.valorEfetivoCentavos ?? null,
          valorEfetivoOrigem: resultadoV2.valorEfetivoOrigem || "",
          valorEfetivoComprovado: valorEfetivoDetalhes.comprovado === true,
          valorEfetivoDetalhes,
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
  let oferta = normalizarOfertaImportada(ofertaEntrada, job);
  const temImagemImporter = Boolean(oferta.imagem);
  const campoImagemImporter = oferta.imagemOrigem || "";
  const sombraV2 = await aplicarSombraInteligenciaUniversalV2(oferta, ofertaEntrada, job);
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
    motivo: "nao_necessario"
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
    imagemCanonica = await buscarImagemCanonicaMercadoLivre(oferta);
    if (imagemCanonica.imagem) {
      oferta.imagem = imagemCanonica.imagem;
      oferta.imagemOrigem = imagemCanonica.origem;
      imagemResolucaoEngine = {
        imagem: imagemCanonica.imagem,
        origem: imagemCanonica.origem,
        tipo: "fallback_canonico_ml",
        fallbackUsado: true,
        motivo: imagemCanonica.motivo || ""
      };
    }
  }

  const identidadeImagem = detectarIdentidadeProdutoUniversal(oferta);
  const motivoSemImagem = oferta.imagem
    ? ""
    : (imagemCanonica.motivo || imagemAnterior.motivo || "imagem_nao_encontrada");
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
      linkResolvido: imagemCanonica.linkResolvido || oferta.linkExpandido || link?.url_expandida || "",
      statusHttp: imagemCanonica.statusHttp ?? oferta.statusHttp ?? ofertaEntrada.statusHttp ?? null,
      temImagemParser: temImagemImporter,
      temImagemHistorica: Boolean(imagemAnterior.imagem),
      imagemFinal: oferta.imagem || "",
      origemImagemFinal: imagemOrigemFinal,
      motivoSemImagem
    }));
  }

  const metadataBase = objetoSeguro(oferta.metadata || ofertaEntrada.metadata || {});
  const metadataFinal = {
    ...metadataBase,
    ...objetoSeguro(sombraV2.metadata || {}),
    imagemOrigem: imagemOrigemFinal,
    imagemFallbackUsado,
    imagemAusenteMotivo,
    imagemAuditoria: {
      temImagemImporter,
      temImagemEngine: Boolean(oferta.imagem),
      campoImagemUsado: imagemOrigemFinal === "nenhuma" ? "" : imagemOrigemFinal,
      origemImagem: imagemOrigemFinal,
      fallbackUsado: imagemFallbackUsado,
      ausenciaMotivo: imagemAusenteMotivo,
      motivoSemImagem: imagemAusenteMotivo,
      temImagemHistorica: Boolean(imagemAnterior.imagem),
      linkResolvidoImagem: imagemCanonica.linkResolvido || oferta.linkExpandido || "",
      statusHttpImagem: imagemCanonica.statusHttp ?? oferta.statusHttp ?? ofertaEntrada.statusHttp ?? null
    }
  };
  const inteligenciaV2 = objetoSeguro(metadataFinal.inteligenciaUniversalV2);
  const retidaV2 = inteligenciaV2.status === "retida" || sombraV2.ok === false;
  const statusPersistencia = retidaV2 ? "retida_v2" : "importada";
  const motivoPersistencia = retidaV2
    ? (inteligenciaV2.motivoDecisao || inteligenciaV2.motivo || "retida_v2")
    : null;
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
      WHERE id = $1
      RETURNING id, status, oferta_id`,
    [jobId, ofertaId]
  );

  if (!resultado.ok) {
    logEngineImporterErro({ jobId, etapa: "marcar_oferta_criada", motivo: resultado.motivo, erro: resultado.erro || "" });
  }

  return resultado;
}

async function marcarJobRetidaV2(jobId, ofertaId, motivo = "retida_v2") {
  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET status = 'retida_v2', oferta_id = $2, motivo_final = $3, atualizado_em = NOW()
      WHERE id = $1
      RETURNING id, status, oferta_id, motivo_final`,
    [jobId, ofertaId, motivo || "retida_v2"]
  );

  if (!resultado.ok) {
    logEngineImporterErro({ jobId, etapa: "marcar_retida_v2", motivo: resultado.motivo, erro: resultado.erro || "" });
  }

  return resultado;
}

async function marcarJobErroImportacao(jobId, motivo = "erro_importacao", detalhes = {}) {
  await registrarEtapaImportacao(jobId, "importacao_finalizada", "erro", motivo, detalhes);
  return marcarJobStatus(jobId, "erro_importacao", motivo);
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
  normalizarOfertaImportada
};




