const { queryEngine } = require("../engine/database");
const {
  resolverImagemUniversal,
  imagemUrlValidaUniversal,
  imagemUrlEfemeraUniversal
} = require("./resolver-imagem-universal");
const socialMediaStorage = require("../social/social-media-storage");

const cacheImagemCanonicaEvento = new Map();

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function objetoSeguro(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function removerRadarMirrorMetadata(valor = {}) {
  const metadata = objetoSeguro(valor);
  const saida = { ...metadata };
  delete saida.radarMirror;
  return saida;
}

function removerRadarMirrorObjeto(valor = {}) {
  const objeto = objetoSeguro(valor);
  if (!Object.keys(objeto).length) return objeto;
  return {
    ...objeto,
    ...(objeto.metadata ? { metadata: removerRadarMirrorMetadata(objeto.metadata) } : {})
  };
}

function listaSegura(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarMarketplace(valor = "") {
  const marketplace = texto(valor).toLowerCase().replace(/[\s_-]+/g, "");
  if (marketplace === "ml" || marketplace.includes("mercadolivre")) return "mercadolivre";
  if (marketplace.includes("amazon")) return "amazon";
  if (marketplace.includes("shopee")) return "shopee";
  if (marketplace.includes("aliexpress")) return "aliexpress";
  if (marketplace.includes("kabum")) return "kabum";
  if (marketplace.includes("awin")) return "awin";
  return marketplace;
}

function extrairMlb(valor = "") {
  return texto(valor).match(/\bMLB-?(\d{6,})\b/i)?.[1] || "";
}

function coletarTextosLinks(links = [], metadataEvento = {}) {
  const textos = [];
  const adicionar = (valor) => {
    const item = texto(valor);
    if (item) textos.push(item);
  };

  for (const link of Array.isArray(links) ? links : [links].filter(Boolean)) {
    if (typeof link === "string") {
      adicionar(link);
      continue;
    }
    if (!link || typeof link !== "object") continue;
    adicionar(link.url);
    adicionar(link.urlOriginal);
    adicionar(link.url_original);
    adicionar(link.urlExpandida);
    adicionar(link.url_expandida);
    adicionar(link.linkResolvido);
    adicionar(link.linkOriginalCapturado);
  }

  const redirects = Array.isArray(metadataEvento?.redirectsRadar) ? metadataEvento.redirectsRadar : [];
  for (const redirect of redirects) {
    adicionar(redirect?.linkOriginalCapturado);
    adicionar(redirect?.linkResolvido);
  }

  return textos;
}

function detectarProdutoIdCanonico({ marketplace = "", linksExtraidos = [], metadataEvento = {} } = {}) {
  const produtoMetadata = objetoSeguro(metadataEvento.produto);
  const candidatos = [
    metadataEvento.produtoIdDetectado,
    metadataEvento.produtoId,
    metadataEvento.mlb,
    produtoMetadata.produtoIdDetectado,
    produtoMetadata.produtoId,
    produtoMetadata.mlb,
    produtoMetadata.itemId
  ].map(texto).filter(Boolean);

  if (normalizarMarketplace(marketplace) === "mercadolivre") {
    for (const candidato of candidatos) {
      const mlb = extrairMlb(candidato) || candidato.replace(/[^0-9]/g, "");
      if (mlb) return `MLB${mlb}`;
    }
    for (const link of coletarTextosLinks(linksExtraidos, metadataEvento)) {
      const mlb = extrairMlb(link);
      if (mlb) return `MLB${mlb}`;
    }
  }

  return candidatos[0] || "";
}

function chaveImagemCanonicaEvento({ eventoId = "", marketplace = "", produtoId = "" } = {}) {
  return [
    texto(eventoId) || "sem_evento",
    normalizarMarketplace(marketplace) || "sem_marketplace",
    texto(produtoId).toUpperCase() || "sem_produto"
  ].join(":");
}

function origemRadarMensagem(radarMirror = {}) {
  const midia = objetoSeguro(radarMirror.midia);
  const origem = texto(midia.imagemOrigem || radarMirror.imagemOrigem).toLowerCase();
  return origem === "mensagem" || origem === "radar_mirror/mensagem";
}

function origemRadarThumbnail(radarMirror = {}) {
  const midia = objetoSeguro(radarMirror.midia);
  const origem = texto(midia.imagemOrigem || radarMirror.imagemOrigem).toLowerCase();
  return origem === "thumbnail" || origem === "radar_mirror/thumbnail";
}

function encontrarImagemRadarMirror(metadataEvento = {}, { permitirThumbnailFallback = false } = {}) {
  const radarMirror = objetoSeguro(metadataEvento.radarMirror);
  const origem = origemRadarMensagem(radarMirror)
    ? "radar_mirror/mensagem"
    : (permitirThumbnailFallback && origemRadarThumbnail(radarMirror) ? "radar_mirror/thumbnail" : "");
  if (!origem) return { radarMirror: null, imagemOriginal: "", origem: "" };
  const midia = objetoSeguro(radarMirror.midia);
  const imagemOriginal = texto(
    midia.imagemMaterializada ||
    radarMirror.imagemMaterializada ||
    midia.imagemDuravel ||
    radarMirror.imagemDuravel ||
    midia.imagemEnviavel ||
    radarMirror.imagemEnviavel ||
    midia.imagemOriginal ||
    radarMirror.imagemOriginal ||
    midia.imagem ||
    radarMirror.imagem ||
    midia.imagemUrl ||
    radarMirror.imagemUrl
  );
  return { radarMirror, imagemOriginal, origem };
}

function encontrarImagemRadarMirrorMensagem(metadataEvento = {}) {
  return encontrarImagemRadarMirror(metadataEvento);
}

function nomeLogicoImagemCanonica({ eventoId = "", marketplace = "", produtoId = "" } = {}) {
  return `evento_${texto(eventoId) || "sem_evento"}_${normalizarMarketplace(marketplace) || "marketplace"}_${texto(produtoId).replace(/[^a-zA-Z0-9_-]/g, "_") || "produto"}`;
}

async function baixarImagemCanonica(url = "", contexto = {}) {
  const fetchImpl = contexto.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(contexto.timeoutMs || 6500));

  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "OptimusPromo/1.0 (+https://go.optimuspromo.com.br)",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    const statusHttp = Number(response.status || 0);
    if (!response.ok) return { ok: false, motivo: `http_${statusHttp || "erro"}`, statusHttp };
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const storage = contexto.storage || socialMediaStorage;
    const mimeReal = storage.detectarMime ? storage.detectarMime(buffer) : "";
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

function resultadoImagemCanonica({ chave, eventoId, marketplace, produtoId, imagem = "", origem = "", status = "nao_resolvida", motivo = "", materializada = false, extra = {} } = {}) {
  const temImagem = Boolean(imagem);
  return {
    ok: temImagem,
    chave,
    eventoId,
    marketplace: normalizarMarketplace(marketplace),
    produtoId,
    imagemCanonicaDuravel: imagem,
    imagem,
    imagemUrl: imagem,
    imagemOrigem: origem || (temImagem ? "imagem_canonica_evento" : "nenhuma"),
    imagemStatus: status,
    imagemRecuperavel: temImagem,
    imagemDuravel: temImagem,
    imagemEnviavel: temImagem,
    motivo: motivo || (temImagem ? "" : "sem_candidato"),
    materializada,
    materializacoes: materializada ? 1 : 0,
    resolvidaEm: new Date().toISOString(),
    ...extra
  };
}

function resultadoImagemPreliminar({ chave, eventoId, marketplace, produtoId, status = "nao_resolvida_ainda", motivo = "enriquecimento_oficial_pendente", materializacoes = 0, radarMirrorMaterializacao = null } = {}) {
  return resultadoImagemCanonica({
    chave,
    eventoId,
    marketplace,
    produtoId,
    status,
    motivo,
    extra: {
      preliminar: true,
      enriquecimentoPendente: true,
      imagemCanonicaFinal: false,
      materializacoes,
      ...(radarMirrorMaterializacao ? {
        radarMirrorMaterializacao
      } : {})
    }
  });
}

async function resolverPorRadarMirror({ chave, eventoId, marketplace, produtoId, metadataEvento, deps = {}, permitirThumbnailFallback = false } = {}) {
  const { imagemOriginal, origem } = encontrarImagemRadarMirror(metadataEvento, { permitirThumbnailFallback });
  if (!imagemOriginal) return null;
  const validacao = imagemUrlValidaUniversal(imagemOriginal);
  if (!validacao.ok) {
    return resultadoImagemCanonica({ chave, eventoId, marketplace, produtoId, motivo: validacao.motivo || "radar_url_invalida" });
  }
  const statusPreservada = origem === "radar_mirror/thumbnail" ? "radar_mirror_thumbnail_preservada" : "radar_mirror_preservada";
  const statusMaterializada = origem === "radar_mirror/thumbnail" ? "radar_mirror_thumbnail_materializada" : "radar_mirror_materializada";

  if (!imagemUrlEfemeraUniversal(validacao.url)) {
    return resultadoImagemCanonica({
      chave,
      eventoId,
      marketplace,
      produtoId,
      imagem: validacao.url,
      origem,
      status: statusPreservada
    });
  }

  const download = await baixarImagemCanonica(validacao.url, deps);
  if (!download.ok) {
    const motivo = download.motivo || "materializacao_falhou";
    return {
      falhou: true,
      motivo,
      statusHttp: download.statusHttp ?? null,
      materializacoes: 1,
      radarMirrorMaterializacao: {
        status: "falha",
        origem,
        urlOriginal: validacao.url,
        motivo,
        statusHttp: download.statusHttp ?? null,
        bytes: download.bytes ?? null,
        storage: "social_media_storage",
        materializacoes: 1,
        cacheCanonico: true
      }
    };
  }

  try {
    const storage = deps.storage || socialMediaStorage;
    const salva = storage.salvar({
      clienteId: "engine",
      buffer: download.buffer,
      mimeType: download.mimeType,
      nomeLogico: nomeLogicoImagemCanonica({ eventoId, marketplace, produtoId })
    });
    return resultadoImagemCanonica({
      chave,
      eventoId,
      marketplace,
      produtoId,
      imagem: salva.url,
      origem,
      status: statusMaterializada,
      materializada: true,
      extra: {
        urlOriginal: validacao.url,
        mimeType: salva.mimeType,
        bytes: salva.bytes,
        storage: "social_media_storage"
      }
    });
  } catch (erro) {
    const motivo = erro.message || "storage_falhou";
    return {
      falhou: true,
      motivo,
      materializacoes: 1,
      radarMirrorMaterializacao: {
        status: "falha",
        origem,
        urlOriginal: validacao.url,
        motivo,
        statusHttp: download.statusHttp ?? null,
        bytes: download.bytes ?? null,
        storage: "social_media_storage",
        materializacoes: 1,
        cacheCanonico: true
      }
    };
  }
}

function resolverPorCandidatosEvento({ chave, eventoId, marketplace, produtoId, metadataEvento } = {}) {
  const resolvida = resolverImagemUniversal({
    ...objetoSeguro(metadataEvento),
    metadata: objetoSeguro(metadataEvento)
  }, {
    evento: { metadata: metadataEvento },
    job: { metadata: { metadataEvento } }
  });

  if (!resolvida.imagem) return null;
  return resultadoImagemCanonica({
    chave,
    eventoId,
    marketplace,
    produtoId,
    imagem: resolvida.imagem,
    origem: resolvida.imagemOrigem || "evento.metadata",
    status: resolvida.imagemStatus || "resolvida_evento",
    extra: {
      imagemTentativas: resolvida.imagemTentativas || []
    }
  });
}

async function buscarHistoricoMesmoMlb(produtoId = "", deps = {}) {
  if (typeof deps.buscarImagemHistorica === "function") return deps.buscarImagemHistorica(produtoId);
  const mlb = texto(produtoId).toUpperCase();
  if (!/^MLB\d+$/.test(mlb)) return { imagem: "", origem: "", motivo: "mlb_ausente" };

  const resultado = await queryEngine(
    `SELECT id, imagem
       FROM engine_ofertas
      WHERE NULLIF(TRIM(COALESCE(imagem, '')), '') IS NOT NULL
        AND LOWER(REGEXP_REPLACE(COALESCE(marketplace, ''), '[[:space:]_-]+', '', 'g')) IN ('ml', 'mercadolivre')
        AND UPPER(CONCAT_WS(' ', link_original, link_expandido, link_afiliado, COALESCE(metadata::text, ''))) LIKE '%' || $1 || '%'
      ORDER BY atualizada_em DESC NULLS LAST, id DESC
      LIMIT 1`,
    [mlb]
  );
  if (!resultado.ok) return { imagem: "", origem: "", motivo: "consulta_historico_falhou" };
  const anterior = resultado.resultado.rows[0];
  const imagem = texto(anterior?.imagem || "");
  return imagem
    ? { imagem, origem: `engine_ofertas.imagem:${anterior.id}`, motivo: "imagem_historica_mesmo_mlb" }
    : { imagem: "", origem: "", motivo: "historico_mesmo_mlb_sem_imagem" };
}

async function buscarImagemOficialMl(produtoId = "", deps = {}) {
  if (typeof deps.buscarImagemOficialMl === "function") return deps.buscarImagemOficialMl(produtoId);
  const mlb = texto(produtoId).replace(/[^0-9]/g, "");
  if (!mlb) return { imagem: "", origem: "", motivo: "mlb_api_ausente" };
  const { buscarImagemOficialMercadoLivrePorMlb } = require("../engine/importer/importer.service");
  return buscarImagemOficialMercadoLivrePorMlb(`MLB${mlb}`, deps);
}

async function resolverImagemCanonicaEvento(entrada = {}, deps = {}) {
  const eventoId = entrada.eventoId;
  const marketplace = normalizarMarketplace(entrada.marketplace || entrada.marketplaceDetectado || "");
  const metadataEvento = objetoSeguro(entrada.metadataEvento);
  const produtoId = detectarProdutoIdCanonico({
    marketplace,
    linksExtraidos: entrada.linksExtraidos,
    metadataEvento
  });
  const chave = chaveImagemCanonicaEvento({ eventoId, marketplace, produtoId });
  if (cacheImagemCanonicaEvento.has(chave)) {
    return { ...cacheImagemCanonicaEvento.get(chave), cacheHit: true };
  }

  let materializacoes = 0;
  let ultimoMotivo = "";
  let motivoRadarNaoPublicavel = "";
  let radarMirrorMaterializacao = null;

  const evento = resolverPorCandidatosEvento({ chave, eventoId, marketplace, produtoId, metadataEvento });
  if (evento?.ok) {
    const resultado = {
      ...evento,
      materializacoes,
      ...(radarMirrorMaterializacao ? { radarMirrorMaterializacao } : {})
    };
    cacheImagemCanonicaEvento.set(chave, resultado);
    return { ...resultado, cacheHit: false };
  }

  const radarBruto = encontrarImagemRadarMirror(metadataEvento, { permitirThumbnailFallback: true });
  if (radarBruto?.imagemOriginal) {
    motivoRadarNaoPublicavel = radarBruto.origem === "radar_mirror/thumbnail"
      ? "imagem_radar_thumbnail_nao_publicavel"
      : "imagem_radar_nao_publicavel";
    ultimoMotivo = motivoRadarNaoPublicavel;
  }

  if (deps.preliminar === true) {
    const preliminar = resultadoImagemPreliminar({
      chave,
      eventoId,
      marketplace,
      produtoId,
      status: radarMirrorMaterializacao ? "radar_falhou_enriquecimento_pendente" : "nao_resolvida_ainda",
      motivo: radarMirrorMaterializacao ? "fonte_radar_imagem_falhou" : (ultimoMotivo || "enriquecimento_oficial_pendente"),
      materializacoes,
      radarMirrorMaterializacao
    });
    cacheImagemCanonicaEvento.set(chave, preliminar);
    return { ...preliminar, cacheHit: false };
  }

  if (marketplace === "mercadolivre" && /^MLB\d+$/.test(texto(produtoId).toUpperCase())) {
    const oficial = await buscarImagemOficialMl(produtoId, deps);
    const oficialResolvida = resolverImagemUniversal({ imagem: oficial.imagem || "" });
    if (oficialResolvida.imagem) {
      const resultado = resultadoImagemCanonica({
        chave,
        eventoId,
        marketplace,
        produtoId,
        imagem: oficialResolvida.imagem,
        origem: oficial.origem || "api_oficial_mlb",
        status: "api_oficial_mlb",
        extra: {
          materializacoes,
          ...(radarMirrorMaterializacao ? { radarMirrorMaterializacao } : {}),
          linkResolvido: oficial.linkResolvido || "",
          statusHttp: oficial.statusHttp ?? null,
          apiConsultada: oficial.apiConsultada === true,
          autenticacao: oficial.autenticacao || ""
        }
      });
      cacheImagemCanonicaEvento.set(chave, resultado);
      return { ...resultado, cacheHit: false };
    }
    ultimoMotivo = oficial.motivo || ultimoMotivo;

    const historico = await buscarHistoricoMesmoMlb(produtoId, deps);
    const historicoResolvido = resolverImagemUniversal({ imagem: historico.imagem || "" });
    if (historicoResolvido.imagem) {
      const resultado = resultadoImagemCanonica({
        chave,
        eventoId,
        marketplace,
        produtoId,
        imagem: historicoResolvido.imagem,
        origem: historico.origem || "historico_mesmo_mlb",
        status: "historico_mesmo_mlb",
        extra: {
          materializacoes,
          ...(radarMirrorMaterializacao ? { radarMirrorMaterializacao } : {})
        }
      });
      cacheImagemCanonicaEvento.set(chave, resultado);
      return { ...resultado, cacheHit: false };
    }
    ultimoMotivo = historico.motivo || ultimoMotivo;
  }

  const semImagem = resultadoImagemCanonica({
    chave,
    eventoId,
    marketplace,
    produtoId,
    motivo: motivoRadarNaoPublicavel || ultimoMotivo || "sem_candidato",
    extra: {
      materializacoes,
      ...(radarMirrorMaterializacao ? { radarMirrorMaterializacao } : {})
    }
  });
  cacheImagemCanonicaEvento.set(chave, semImagem);
  return { ...semImagem, cacheHit: false };
}

function mesclarProdutoMetadata(metadataEvento = {}, ofertaEnriquecida = {}) {
  const metadataOferta = objetoSeguro(ofertaEnriquecida.metadata);
  const produtoEvento = objetoSeguro(metadataEvento.produto);
  const produtoOferta = objetoSeguro(metadataOferta.produto);
  return {
    ...produtoEvento,
    ...produtoOferta,
    produtoIdDetectado: texto(
      ofertaEnriquecida.produtoIdDetectado ||
      ofertaEnriquecida.produtoId ||
      ofertaEnriquecida.itemId ||
      produtoOferta.produtoIdDetectado ||
      produtoOferta.produtoId ||
      produtoOferta.itemId ||
      produtoEvento.produtoIdDetectado ||
      produtoEvento.produtoId ||
      produtoEvento.itemId
    ),
    mlb: texto(
      ofertaEnriquecida.mlb ||
      produtoOferta.mlb ||
      produtoEvento.mlb ||
      ofertaEnriquecida.produtoIdDetectado ||
      ofertaEnriquecida.itemId
    ),
    imagemCandidatos: [
      ...listaSegura(produtoOferta.imagemCandidatos),
      ...listaSegura(ofertaEnriquecida.imagemCandidatos),
      ...listaSegura(produtoEvento.imagemCandidatos)
    ],
    images: [
      ...listaSegura(produtoOferta.images),
      ...listaSegura(ofertaEnriquecida.images),
      ...listaSegura(produtoEvento.images)
    ],
    pictures: [
      ...listaSegura(produtoOferta.pictures),
      ...listaSegura(ofertaEnriquecida.pictures),
      ...listaSegura(produtoEvento.pictures)
    ],
    secure_thumbnail: texto(ofertaEnriquecida.secure_thumbnail || produtoOferta.secure_thumbnail || produtoEvento.secure_thumbnail),
    thumbnail: texto(ofertaEnriquecida.thumbnail || produtoOferta.thumbnail || produtoEvento.thumbnail),
    thumbnailUrl: texto(ofertaEnriquecida.thumbnailUrl || produtoOferta.thumbnailUrl || produtoEvento.thumbnailUrl),
    picture_url: texto(ofertaEnriquecida.picture_url || produtoOferta.picture_url || produtoEvento.picture_url)
  };
}

function montarOfertaImagemFinal(metadataEvento = {}, ofertaEnriquecida = {}) {
  const metadataOferta = objetoSeguro(ofertaEnriquecida.metadata);
  const produto = mesclarProdutoMetadata(metadataEvento, ofertaEnriquecida);
  return {
    ...objetoSeguro(metadataEvento),
    ...ofertaEnriquecida,
    metadata: {
      ...metadataEvento,
      ...metadataOferta,
      produto
    }
  };
}

function resultadoFinalDeImagemResolvida({ chave, eventoId, marketplace, produtoId, resolvida = {}, origemFallback = "", statusFallback = "imagem_canonica_final", extra = {} } = {}) {
  return resultadoImagemCanonica({
    chave,
    eventoId,
    marketplace,
    produtoId,
    imagem: resolvida.imagem || resolvida.imagemUrl || "",
    origem: resolvida.imagemOrigem || origemFallback || "imagem_canonica_final",
    status: resolvida.imagemStatus || statusFallback,
    extra: {
      imagemCanonicaFinal: true,
      enriquecimentoPendente: false,
      imagemTentativas: resolvida.imagemTentativas || [],
      ...extra
    }
  });
}

function imagemUrlNormalizada(valor = "") {
  const validacao = imagemUrlValidaUniversal(valor);
  return validacao.ok ? validacao.url : texto(valor);
}

function imagemMercadoLivreOficialUrl(valor = "") {
  const validacao = imagemUrlValidaUniversal(valor);
  if (!validacao.ok) return false;
  try {
    const host = new URL(validacao.url).hostname.toLowerCase();
    return host === "mlstatic.com" || host.endsWith(".mlstatic.com");
  } catch {
    return false;
  }
}

function extrairDimensoesImagemMl(valor = {}) {
  const dimensoes = objetoSeguro(valor);
  const largura = Number(
    dimensoes.width ??
    dimensoes.w ??
    dimensoes.largura ??
    dimensoes.imagemLargura ??
    dimensoes.imageWidth
  );
  const altura = Number(
    dimensoes.height ??
    dimensoes.h ??
    dimensoes.altura ??
    dimensoes.imagemAltura ??
    dimensoes.imageHeight
  );
  if (Number.isFinite(largura) && Number.isFinite(altura) && largura > 0 && altura > 0) {
    return { largura, altura };
  }

  const textoDimensoes = texto(dimensoes.size || dimensoes.dimensions || dimensoes.dimensoes || "");
  const match = textoDimensoes.match(/\b(\d{2,5})\s*x\s*(\d{2,5})\b/i);
  return match ? { largura: Number(match[1]), altura: Number(match[2]) } : null;
}

function classificarQualidadeImagemMercadoLivre(url = "", metadados = {}) {
  const imagem = texto(url);
  const dimensoes = extrairDimensoesImagemMl(metadados);
  const contexto = texto([
    imagem,
    metadados.origem,
    metadados.imagemOrigem,
    metadados.tipo,
    metadados.alt,
    metadados.alt_text,
    metadados.title,
    metadados.titulo
  ].filter(Boolean).join(" "));
  const contextoVisual = texto([
    imagem,
    metadados.tipo,
    metadados.alt,
    metadados.alt_text,
    metadados.title,
    metadados.titulo
  ].filter(Boolean).join(" "));
  const motivos = [];
  const varianteT = /-T\.(?:webp|jpe?g|png)(?:$|[?#])/i.test(imagem);
  const varianteMuitoPequena = /-(?:S|M|A)\.(?:webp|jpe?g|png)(?:$|[?#])/i.test(imagem);
  const urlThumbnail = /(?:^|[\/_.-])thumb(?:nail)?(?:[\/_.-]|$)|secure_thumbnail|thumbnail/i.test(contexto);
  const artePromocional = /banner|template|watermark|marca[-_ ]?d[ae]?[-_ ]?agua|tatuagem|rodape|footer|promocional|promo[-_ ]?card|placeholder|generic|generica/i.test(contextoVisual);
  const dimensaoPequena = Boolean(dimensoes && dimensoes.largura <= 220 && dimensoes.altura <= 220);
  const deformada = Boolean(
    dimensoes &&
    dimensoes.largura > 0 &&
    dimensoes.altura > 0 &&
    Math.max(dimensoes.largura / dimensoes.altura, dimensoes.altura / dimensoes.largura) > 2.4
  );
  if (varianteT) motivos.push("mercadolivre_thumbnail_t");
  if (varianteMuitoPequena) motivos.push("mercadolivre_variante_pequena");
  if (urlThumbnail) motivos.push("mercadolivre_url_thumbnail");
  if (dimensaoPequena) motivos.push("mercadolivre_dimensao_ate_220");
  if (deformada) motivos.push("mercadolivre_dimensao_deformada");
  if (artePromocional) motivos.push("mercadolivre_sinal_arte_promocional");
  return {
    baixa: motivos.length > 0,
    motivo: motivos[0] || "",
    motivos,
    variante: varianteT ? "T" : "",
    dimensoes
  };
}

function pesoOrigemImagemMercadoLivre(origem = "") {
  const valor = texto(origem).toLowerCase();
  if (/^api_mercadolibre\.items\.pictures\[\d+\]\.secure_url$/.test(valor)) return 1000;
  if (/^api_mercadolibre\.items\.pictures\[\d+\]\.url$/.test(valor)) return 980;
  if (valor === "original_picture") return 960;
  if (/^jsonld\.image(?:\[\d+\])?$/.test(valor)) return 940;
  if (valor.includes("pictures.secure_url")) return 920;
  if (valor.includes("pictures.url")) return 900;
  if (valor === "picture_url") return 860;
  if (valor === "polycard.picture_template") return 840;
  if (valor === "og:image") return 760;
  if (valor === "twitter:image") return 740;
  if (valor === "importador_ml_mlb" || valor === "adapter.imagem" || valor === "adapter.image") return 720;
  if (valor === "secure_thumbnail") return 420;
  if (valor === "thumbnail" || valor === "thumbnailurl" || valor === "thumbnail_url") return 360;
  return 500;
}

function pontuarCandidatoImagemMercadoLivre(candidato = {}) {
  const qualidade = classificarQualidadeImagemMercadoLivre(candidato.imagem || candidato.imagemUrl || "", candidato);
  const dimensoes = qualidade.dimensoes || {};
  const area = Number(dimensoes.largura || 0) * Number(dimensoes.altura || 0);
  const bonusDimensao = area >= 1_000_000 ? 80 : area >= 409_600 ? 55 : area >= 160_000 ? 30 : 0;
  const bonus2x = /_2X_/i.test(candidato.imagem || candidato.imagemUrl || "") ? 20 : 0;
  const penalidadeBaixa = qualidade.baixa ? 1000 : 0;
  return {
    score: pesoOrigemImagemMercadoLivre(candidato.imagemOrigem || candidato.origem || "") + bonusDimensao + bonus2x - penalidadeBaixa,
    qualidade
  };
}

function origemImagemRadar(valor = {}) {
  const item = objetoSeguro(valor);
  const origem = texto(item.imagemOrigem || item.origem || item.imagemStatus || item.status).toLowerCase();
  const linhagem = texto([
    item.imagemBaseOrigem,
    item.origemImagemFinal,
    item.origemSelecionada,
    item.imagemFallbackRadarOrigem
  ].filter(Boolean).join(" ")).toLowerCase();
  const imagem = texto(item.imagem || item.imagemUrl || item.imagemCanonicaDuravel || item.url || "").toLowerCase();
  return (
    origem === "radar_mirror/mensagem" ||
    origem.startsWith("radar_mirror/") ||
    /radar|mirror|mensagem|grupo|whatsapp|telegram|clonador/.test(linhagem) ||
    /(radar_whatsapp|radar_telegram|\/social\/midia\/publica\/engine\/|mmg\.whatsapp\.net)/i.test(imagem)
  );
}

function origemImagemOficialMarketplace(origem = "") {
  const valor = texto(origem).toLowerCase();
  if (!valor || /radar|mirror|mensagem|grupo|whatsapp|telegram|clonador/.test(valor)) return false;
  if (/thumbnail|preview/.test(valor)) return false;
  return (
    valor === "imagem" ||
    valor === "imagemurl" ||
    valor === "imageurl" ||
    valor === "image" ||
    valor === "urlimagem" ||
    valor === "product_main_image_url" ||
    valor === "api_productofferv2.imageurl" ||
    valor === "jsonld.image" ||
    valor === "og:image" ||
    valor === "twitter:image" ||
    valor === "landingimage" ||
    valor === "data-old-hires" ||
    valor === "html/gallery" ||
    valor === "product_small_image_urls" ||
    valor === "metadata.produto.product_main_image_url" ||
    valor === "metadata.produto.imageurl" ||
    valor === "metadata.produto.image" ||
    valor === "metadata.produto.images" ||
    valor === "metadata.produto.pictures" ||
    valor === "metadata.produto.imagemcandidatos" ||
    valor.startsWith("images[") ||
    valor.startsWith("pictures[") ||
    valor.startsWith("product_small_image_urls[") ||
    valor.startsWith("metadata.produto.images[") ||
    valor.startsWith("metadata.produto.pictures[") ||
    valor.startsWith("metadata.produto.imagemcandidatos[")
  );
}

function adicionarCandidatoImagemOficial(candidatos = [], valor, origem = "", extra = {}) {
  const origemTexto = texto(origem);
  if (!origemImagemOficialMarketplace(origemTexto)) return;
  if (origemImagemRadar({ imagemOrigem: origemTexto, imagemStatus: extra.imagemStatus || extra.status })) return;

  const valores = [];
  if (typeof valor === "string") valores.push({ url: valor, metadata: extra });
  else if (Array.isArray(valor)) {
    valor.forEach((item, indice) => {
      adicionarCandidatoImagemOficial(candidatos, item, `${origemTexto}[${indice}]`, extra);
    });
    return;
  } else if (valor && typeof valor === "object") {
    const item = objetoSeguro(valor);
    const url = texto(
      item.url ||
      item.secure_url ||
      item.src ||
      item.href ||
      item.imageUrl ||
      item.image_url ||
      item.image ||
      item.imagem ||
      item.picture_url ||
      item.original_picture
    );
    valores.push({ url, metadata: { ...extra, ...item } });
  }

  for (const candidato of valores) {
    const validacao = imagemUrlValidaUniversal(candidato.url);
    if (!validacao.ok || imagemUrlEfemeraUniversal(validacao.url)) continue;
    if (origemImagemRadar({
      ...candidato.metadata,
      imagem: validacao.url,
      imagemUrl: validacao.url,
      imagemOrigem: origemTexto
    })) continue;
    const dimensoes = extrairDimensoesImagemMl(candidato.metadata);
    const area = dimensoes ? dimensoes.largura * dimensoes.altura : 0;
    candidatos.push({
      imagem: validacao.url,
      imagemUrl: validacao.url,
      imagemOrigem: origemTexto,
      imagemStatus: "imagem_oficial_marketplace",
      imagemConfianca: 130,
      imagemDimensoes: dimensoes,
      score: pesoOrigemImagemOficialMarketplace(origemTexto) + Math.min(area / 10000, 100)
    });
  }
}

function pesoOrigemImagemOficialMarketplace(origem = "") {
  const valor = texto(origem).toLowerCase();
  if (valor.includes("product_main_image_url")) return 1000;
  if (valor.includes("api_productofferv2.imageurl")) return 980;
  if (valor.includes("jsonld.image")) return 960;
  if (valor.includes("landingimage") || valor.includes("data-old-hires") || valor.includes("html/gallery")) return 940;
  if (valor.includes("metadata.produto.image") || valor.includes("metadata.produto.pictures")) return 920;
  if (valor === "imagem" || valor === "imagemurl" || valor === "imageurl" || valor === "image") return 900;
  if (valor === "og:image" || valor === "twitter:image") return 860;
  if (valor.includes("product_small_image_urls")) return 820;
  if (valor.includes("pictures[") || valor.includes("images[")) return 800;
  return 700;
}

function resolverImagemOficialMarketplaceDisponivel({ ofertaImagem = {}, ofertaEnriquecida = {}, metadataEvento = {} } = {}) {
  const metadataOferta = objetoSeguro(ofertaEnriquecida.metadata);
  const produtoOferta = objetoSeguro(metadataOferta.produto);
  const produtoEvento = objetoSeguro(metadataEvento.produto);
  const produto = objetoSeguro(objetoSeguro(ofertaImagem.metadata).produto);
  const candidatos = [];

  if (!origemImagemRadar(ofertaEnriquecida)) {
    adicionarCandidatoImagemOficial(candidatos, ofertaEnriquecida.imagem, ofertaEnriquecida.imagemOrigem || "imagem", ofertaEnriquecida);
    adicionarCandidatoImagemOficial(candidatos, ofertaEnriquecida.imagemUrl, ofertaEnriquecida.imagemOrigem || "imagemUrl", ofertaEnriquecida);
    adicionarCandidatoImagemOficial(candidatos, ofertaEnriquecida.imageUrl, "imageUrl", ofertaEnriquecida);
  }

  adicionarCandidatoImagemOficial(candidatos, ofertaEnriquecida.product_main_image_url, "product_main_image_url", ofertaEnriquecida);
  adicionarCandidatoImagemOficial(candidatos, ofertaEnriquecida.landingImage, "landingImage", ofertaEnriquecida);
  adicionarCandidatoImagemOficial(candidatos, ofertaEnriquecida["data-old-hires"], "data-old-hires", ofertaEnriquecida);
  adicionarCandidatoImagemOficial(candidatos, ofertaImagem.ogImage, "og:image", ofertaImagem);
  adicionarCandidatoImagemOficial(candidatos, ofertaImagem.twitterImage, "twitter:image", ofertaImagem);
  adicionarCandidatoImagemOficial(candidatos, objetoSeguro(ofertaImagem.jsonLd).image, "jsonLd.image", objetoSeguro(ofertaImagem.jsonLd));

  const fontesProduto = [
    ["metadata.produto.product_main_image_url", produto.product_main_image_url || produtoOferta.product_main_image_url || produtoEvento.product_main_image_url],
    ["metadata.produto.imageUrl", produto.imageUrl || produtoOferta.imageUrl || produtoEvento.imageUrl],
    ["metadata.produto.image", produto.image || produtoOferta.image || produtoEvento.image],
    ["metadata.produto.images", produto.images || produtoOferta.images || produtoEvento.images],
    ["metadata.produto.pictures", produto.pictures || produtoOferta.pictures || produtoEvento.pictures],
    ["metadata.produto.imagemCandidatos", produto.imagemCandidatos || produtoOferta.imagemCandidatos || produtoEvento.imagemCandidatos],
    ["product_small_image_urls", produto.product_small_image_urls || produtoOferta.product_small_image_urls || produtoEvento.product_small_image_urls]
  ];
  for (const [origem, valor] of fontesProduto) adicionarCandidatoImagemOficial(candidatos, valor, origem);
  adicionarCandidatoImagemOficial(candidatos, ofertaEnriquecida.images, "images");
  adicionarCandidatoImagemOficial(candidatos, ofertaEnriquecida.pictures, "pictures");
  adicionarCandidatoImagemOficial(candidatos, ofertaEnriquecida.imagemCandidatos, "metadata.produto.imagemCandidatos");

  candidatos.sort((a, b) => b.score - a.score);
  return candidatos[0] || null;
}

function montarResultadoImagemOficialMarketplace({ chave, eventoId, marketplace, produtoId, resolvida = {}, cacheAtual = {}, linkResolvido = "" } = {}) {
  return resultadoFinalDeImagemResolvida({
    chave,
    eventoId,
    marketplace,
    produtoId,
    resolvida,
    statusFallback: "imagem_oficial_marketplace",
    extra: {
      materializacoes: Number(cacheAtual.materializacoes || 0),
      ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {}),
      linkResolvido,
      prioridadeImagemGlobal: "oficial_marketplace"
    }
  });
}

function origemImagemMercadoLivreSegura(origem = "") {
  const valor = texto(origem).toLowerCase();
  if (!valor || valor.includes("radar_mirror")) return false;
  return (
    /^jsonld\.image(?:\[\d+\])?$/.test(valor) ||
    valor === "og:image" ||
    valor === "twitter:image" ||
    /^pictures(?:\.|\[\d+\]\.)/.test(valor) ||
    valor.includes(".pictures[") ||
    valor.includes("pictures.secure_url") ||
    valor.includes("pictures.url") ||
    valor.includes("api_mercadolivre.items.pictures") ||
    valor === "secure_thumbnail" ||
    valor === "thumbnail" ||
    valor === "thumbnailurl" ||
    valor === "thumbnail_url" ||
    valor === "picture_url" ||
    valor === "importador_ml_mlb" ||
    valor === "adapter.imagem" ||
    valor === "adapter.image" ||
    valor === "polycard.picture_template"
  );
}

function extrairMlbObjetoImagemMercadoLivre(valor = {}) {
  const item = objetoSeguro(valor);
  const candidatos = [
    item.produtoIdDetectado,
    item.produtoId,
    item.mlb,
    item.itemId,
    item.item_id
  ];
  for (const candidato of candidatos) {
    const bruto = texto(candidato);
    if (!bruto) continue;
    const mlb = extrairMlb(bruto) || bruto.replace(/[^0-9]/g, "");
    if (mlb) return `MLB${mlb}`;
  }

  const links = [
    item.linkOriginal,
    item.linkExpandido,
    item.linkAfiliado,
    item.urlFinal,
    item.linkResolvido,
    item.permalink,
    item.urlProduto,
    item.produtoUrl
  ];
  for (const link of links) {
    const mlb = extrairMlb(link);
    if (mlb) return `MLB${mlb}`;
  }

  return "";
}

function candidatoMlAssociadoAoProduto(valor = {}, produtoId = "", associadoPeloProduto = false) {
  const esperado = texto(produtoId).toUpperCase();
  if (!esperado) return false;
  const detectado = extrairMlbObjetoImagemMercadoLivre(valor);
  if (detectado) return detectado === esperado;
  return associadoPeloProduto === true;
}

function candidatoImagemMlCompativelComProduto(valor = {}, produtoId = "") {
  const esperado = texto(produtoId).toUpperCase();
  if (!esperado) return true;
  const detectado = extrairMlbObjetoImagemMercadoLivre(valor);
  return !detectado || detectado === esperado;
}

function dadosImagemMl(valor, origemFallback = "") {
  if (typeof valor === "string") {
    return { url: valor, origem: origemFallback, metadados: {} };
  }
  if (!valor || typeof valor !== "object") return { url: "", origem: origemFallback, metadados: {} };
  return {
    url: texto(valor.url || valor.secure_url || valor.secureUrl || valor.src || valor.imageUrl || valor.imagemUrl || valor.imagem || valor.thumbnail || valor.secure_thumbnail),
    origem: texto(valor.origem || valor.imagemOrigem || valor.tipo || origemFallback),
    metadados: valor
  };
}

function resolverCandidatoMlSeguroContraRadar(valor, {
  origemFallback = "",
  produtoId = "",
  associadoPeloProduto = false,
  urlsBaixaQualidade = new Set()
} = {}) {
  const dados = dadosImagemMl(valor, origemFallback);
  if (!dados.url || !origemImagemMercadoLivreSegura(dados.origem)) return null;
  if (!candidatoMlAssociadoAoProduto(dados.metadados, produtoId, associadoPeloProduto)) return null;

  const validacao = imagemUrlValidaUniversal(dados.url);
  if (!validacao.ok || imagemUrlEfemeraUniversal(validacao.url)) return null;
  if (urlsBaixaQualidade.has(imagemUrlNormalizada(validacao.url))) return null;

  const qualidadeMl = classificarQualidadeImagemMercadoLivre(validacao.url, dados.metadados);
  if (qualidadeMl.baixa) return null;

  return {
    imagem: validacao.url,
    imagemUrl: validacao.url,
    imagemOrigem: dados.origem,
    imagemStatus: "importador_ml_mlb",
    imagemConfianca: 120,
    imagemUrlPresente: true,
    imagemRecuperavel: true,
    imagemDuravel: true,
    imagemEnviavel: true,
    imagemQualidadeMercadoLivre: qualidadeMl
  };
}

function resolverImagemMlSeguraParaVencerRadar(ofertaImagem = {}, produtoId = "", urlsBaixaQualidade = new Set()) {
  const oferta = objetoSeguro(ofertaImagem);
  const metadata = objetoSeguro(oferta.metadata);
  const produto = objetoSeguro(metadata.produto);
  const jsonLd = objetoSeguro(oferta.jsonLd || produto.jsonLd);
  const produtoMlb = detectarProdutoIdCanonico({
    marketplace: "mercadolivre",
    linksExtraidos: [oferta.linkExpandido, oferta.linkOriginal, oferta.urlFinal, oferta.linkResolvidoImagem].filter(Boolean),
    metadataEvento: {
      produto,
      produtoIdDetectado: oferta.produtoIdDetectado || oferta.produtoId || oferta.itemId || produto.produtoIdDetectado || produto.produtoId || produto.mlb || produto.itemId || ""
    }
  });
  const associadoPeloProduto = texto(produtoMlb).toUpperCase() === texto(produtoId).toUpperCase();
  const avaliados = new Set();
  const candidatosValidos = [];
  const tentar = (valor, origemFallback = "", associado = associadoPeloProduto) => {
    const candidato = resolverCandidatoMlSeguroContraRadar(valor, {
      origemFallback,
      produtoId,
      associadoPeloProduto: associado,
      urlsBaixaQualidade
    });
    const chave = candidato?.imagem ? imagemUrlNormalizada(candidato.imagem) : "";
    if (!candidato || avaliados.has(chave)) return;
    avaliados.add(chave);
    const pontuacao = pontuarCandidatoImagemMercadoLivre(candidato);
    candidatosValidos.push({
      ...candidato,
      imagemPontuacaoMercadoLivre: pontuacao.score,
      imagemQualidadeMercadoLivre: pontuacao.qualidade
    });
  };

  const diretos = [
    [oferta.imagem, oferta.imagemOrigem || "importador_ml_mlb", true],
    [oferta.imagemUrl, oferta.imagemOrigem || "importador_ml_mlb", true],
    [oferta.image, oferta.imagemOrigem || "adapter.image", true],
    [oferta.imageUrl, oferta.imagemOrigem || "adapter.image", true],
    [oferta.ogImage || oferta.imagemOg, "og:image", true],
    [oferta.twitterImage || oferta.imagemTwitter, "twitter:image", true],
    [oferta.picture_url, "picture_url", true],
    [oferta.secure_thumbnail, "secure_thumbnail", true],
    [oferta.thumbnail, "thumbnail", true],
    [oferta.thumbnailUrl, "thumbnailUrl", true],
    [produto.picture_url, "picture_url", associadoPeloProduto],
    [produto.secure_thumbnail, "secure_thumbnail", associadoPeloProduto],
    [produto.thumbnail, "thumbnail", associadoPeloProduto],
    [produto.thumbnailUrl, "thumbnailUrl", associadoPeloProduto]
  ];
  for (const [valor, origem, associado] of diretos) {
    tentar(valor, origem, associado);
  }

  const listas = [
    [Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image].filter(Boolean), "jsonLd.image", true],
    [oferta.imagemCandidatos, "imagemCandidatos", true],
    [oferta.images, "images", true],
    [oferta.pictures, "pictures", true],
    [produto.imagemCandidatos, "metadata.produto.imagemCandidatos", associadoPeloProduto],
    [produto.images, "metadata.produto.images", associadoPeloProduto],
    [produto.pictures, "metadata.produto.pictures", associadoPeloProduto]
  ];
  for (const [lista, origem, associado] of listas) {
    listaSegura(lista).forEach((item, indice) => tentar(item, `${origem}[${indice}]`, associado));
  }

  candidatosValidos.sort((a, b) => {
    if (b.imagemPontuacaoMercadoLivre !== a.imagemPontuacaoMercadoLivre) {
      return b.imagemPontuacaoMercadoLivre - a.imagemPontuacaoMercadoLivre;
    }
    return texto(a.imagem).localeCompare(texto(b.imagem));
  });

  return candidatosValidos[0] || null;
}

function sanitizarCandidatosImagemMercadoLivre(valor, { produtoId = "", urlsBaixaQualidade = new Set() } = {}, profundidade = 0) {
  if (valor == null || profundidade > 7) return valor;

  if (typeof valor === "string") {
    const normalizada = imagemUrlNormalizada(valor);
    if (urlsBaixaQualidade.has(normalizada)) return "";
    return imagemMercadoLivreOficialUrl(valor) ? valor : "";
  }

  if (Array.isArray(valor)) {
    return valor
      .map((item) => sanitizarCandidatosImagemMercadoLivre(item, { produtoId, urlsBaixaQualidade }, profundidade + 1))
      .filter((item) => item !== null && item !== undefined && item !== "");
  }

  if (typeof valor !== "object") return valor;
  if (!candidatoImagemMlCompativelComProduto(valor, produtoId)) return null;

  const urlObjeto = imagemUrlNormalizada(valor.url || valor.secure_url || valor.secureUrl || valor.src || valor.imageUrl || valor.imagemUrl || "");
  if (urlObjeto && urlsBaixaQualidade.has(urlObjeto)) return null;

  const saida = {};
  for (const [chave, item] of Object.entries(valor)) {
    const sanitizado = sanitizarCandidatosImagemMercadoLivre(item, { produtoId, urlsBaixaQualidade }, profundidade + 1);
    if (sanitizado !== null && sanitizado !== undefined && sanitizado !== "") saida[chave] = sanitizado;
  }
  return saida;
}

function montarResultadoFallbackImagemMlBaixa({ chave, eventoId, marketplace, produtoId, resolvida = {}, cacheAtual = {}, linkResolvido = "" } = {}) {
  return resultadoFinalDeImagemResolvida({
    chave,
    eventoId,
    marketplace,
    produtoId,
    resolvida,
    origemFallback: resolvida.imagemOrigem || "importador_ml_mlb",
    statusFallback: "mercadolivre_thumbnail_fallback",
    extra: {
      materializacoes: Number(cacheAtual.materializacoes || 0),
      ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {}),
      linkResolvido,
      imagemQualidadeMercadoLivre: "baixa_fallback_final"
    }
  });
}

function resultadoSemImagemPublicavel({ chave, eventoId, marketplace, produtoId, motivo = "imagem_radar_nao_publicavel", cacheAtual = {}, linkResolvido = "", radarFallback = null, extra = {} } = {}) {
  return resultadoImagemCanonica({
    chave,
    eventoId,
    marketplace,
    produtoId,
    status: "nao_resolvida",
    motivo,
    extra: {
      imagemCanonicaFinal: true,
      enriquecimentoPendente: false,
      materializacoes: Number(cacheAtual.materializacoes || 0),
      ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {}),
      ...(linkResolvido ? { linkResolvido } : {}),
      ...(radarFallback?.imagem ? {
        imagemFallbackRadarDisponivel: true,
        imagemFallbackRadarOrigem: radarFallback.imagemOrigem || radarFallback.origem || "",
        imagemFallbackRadarStatus: radarFallback.imagemStatus || radarFallback.status || ""
      } : {}),
      ...extra
    }
  });
}

function resolverImagemUniversalMercadoLivrePreferindoQualidade(ofertaImagem = {}, contexto = {}, { produtoId = "", urlsBaixaQualidade = new Set(), fallbackBaixa = null } = {}) {
  let fallbackImagemMlBaixa = fallbackBaixa;
  const urlsBaixas = new Set([...urlsBaixaQualidade]);

  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const ofertaDisputa = sanitizarCandidatosImagemMercadoLivre(ofertaImagem, { produtoId, urlsBaixaQualidade: urlsBaixas }) || {};
    const resolvida = resolverImagemUniversal(ofertaDisputa, contexto);
    if (!resolvida.imagem) return { resolvida: null, fallbackBaixa: fallbackImagemMlBaixa, urlsBaixaQualidade: urlsBaixas };

    const qualidadeMl = classificarQualidadeImagemMercadoLivre(resolvida.imagem, resolvida);
    if (!qualidadeMl.baixa) return { resolvida, fallbackBaixa: fallbackImagemMlBaixa, urlsBaixaQualidade: urlsBaixas };

    urlsBaixas.add(imagemUrlNormalizada(resolvida.imagem));
    fallbackImagemMlBaixa = fallbackImagemMlBaixa || {
      ...resolvida,
      imagemStatus: "mercadolivre_thumbnail_fallback",
      imagemQualidadeMercadoLivre: qualidadeMl
    };
  }

  return { resolvida: null, fallbackBaixa: fallbackImagemMlBaixa, urlsBaixaQualidade: urlsBaixas };
}

async function resolverImagemCanonicaFinalEvento(entrada = {}, deps = {}) {
  const eventoId = entrada.eventoId;
  const marketplace = normalizarMarketplace(entrada.marketplace || entrada.marketplaceDetectado || entrada.ofertaEnriquecida?.marketplace || "");
  const metadataEvento = objetoSeguro(entrada.metadataEvento);
  const ofertaEnriquecida = objetoSeguro(entrada.ofertaEnriquecida);
  const produtoMetadata = mesclarProdutoMetadata(metadataEvento, ofertaEnriquecida);
  const produtoId = detectarProdutoIdCanonico({
    marketplace,
    linksExtraidos: [
      ...listaSegura(entrada.linksExtraidos),
      ofertaEnriquecida.linkExpandido,
      ofertaEnriquecida.linkOriginal,
      ofertaEnriquecida.linkAfiliado,
      ofertaEnriquecida.urlFinal,
      ofertaEnriquecida.linkResolvidoImagem
    ].filter(Boolean),
    metadataEvento: {
      ...metadataEvento,
      produto: produtoMetadata,
      produtoIdDetectado: produtoMetadata.produtoIdDetectado || produtoMetadata.produtoId || produtoMetadata.mlb || ""
    }
  });
  const chave = chaveImagemCanonicaEvento({ eventoId, marketplace, produtoId });
  const cacheAtual = {
    ...objetoSeguro(objetoSeguro(ofertaEnriquecida.metadata).imagemCacheCanonico),
    ...objetoSeguro(cacheImagemCanonicaEvento.get(chave))
  };
  const ehMercadoLivreComMlb = marketplace === "mercadolivre" && /^MLB\d+$/.test(texto(produtoId).toUpperCase());
  let fallbackImagemMlBaixa = null;
  let fallbackImagemRadar = null;
  let fallbackCacheRadar = null;
  const urlsMlBaixaQualidade = new Set();
  const linkResolvidoImagem = ofertaEnriquecida.linkResolvidoImagem || ofertaEnriquecida.linkExpandido || ofertaEnriquecida.urlFinal || "";
  const ofertaImagem = montarOfertaImagemFinal(metadataEvento, ofertaEnriquecida);
  const contextoImagem = {
    evento: { metadata: metadataEvento },
    job: { metadata: { metadataEvento } },
    ofertaEntrada: entrada.ofertaEntrada,
    link: entrada.link
  };
  const metadataEventoSemRadar = removerRadarMirrorMetadata(metadataEvento);
  const contextoImagemSemRadar = {
    evento: { metadata: metadataEventoSemRadar },
    job: { metadata: { metadataEvento: metadataEventoSemRadar } },
    ofertaEntrada: removerRadarMirrorObjeto(entrada.ofertaEntrada),
    link: removerRadarMirrorObjeto(entrada.link)
  };
  const imagemOficialMarketplace = ehMercadoLivreComMlb
    ? null
    : resolverImagemOficialMarketplaceDisponivel({ ofertaImagem, ofertaEnriquecida, metadataEvento });

  if (cacheAtual.imagemCanonicaDuravel && cacheAtual.imagemCanonicaFinal === true) {
    if (!ehMercadoLivreComMlb) {
      if (imagemOficialMarketplace?.imagem) {
        const resultado = montarResultadoImagemOficialMarketplace({
          chave,
          eventoId,
          marketplace,
          produtoId,
          resolvida: imagemOficialMarketplace,
          cacheAtual,
          linkResolvido: linkResolvidoImagem
        });
        cacheImagemCanonicaEvento.set(chave, resultado);
        return { ...resultado, cacheHit: false };
      }
      if (origemImagemRadar(cacheAtual)) {
        fallbackImagemRadar = {
          imagem: cacheAtual.imagemCanonicaDuravel,
          imagemUrl: cacheAtual.imagemCanonicaDuravel,
          imagemOrigem: cacheAtual.imagemOrigem || "radar_mirror/mensagem",
          imagemStatus: cacheAtual.imagemStatus || "radar_mirror_materializada",
          imagemTentativas: cacheAtual.imagemTentativas || []
        };
        fallbackCacheRadar = { ...cacheAtual, cacheHit: true };
      } else {
        return { ...cacheAtual, cacheHit: true };
      }
    }

    if (ehMercadoLivreComMlb) {
    const qualidadeCacheMl = classificarQualidadeImagemMercadoLivre(cacheAtual.imagemCanonicaDuravel, cacheAtual);
    if (!qualidadeCacheMl.baixa && !origemImagemRadar(cacheAtual)) {
      return { ...cacheAtual, cacheHit: true };
    }

    if (qualidadeCacheMl.baixa) {
      urlsMlBaixaQualidade.add(imagemUrlNormalizada(cacheAtual.imagemCanonicaDuravel));
      fallbackImagemMlBaixa = {
        imagem: cacheAtual.imagemCanonicaDuravel,
        imagemUrl: cacheAtual.imagemCanonicaDuravel,
        imagemOrigem: cacheAtual.imagemOrigem || "cache_canonico_ml",
        imagemStatus: "mercadolivre_thumbnail_fallback",
        imagemQualidadeMercadoLivre: qualidadeCacheMl,
        imagemTentativas: cacheAtual.imagemTentativas || []
      };
    } else {
      fallbackImagemRadar = {
        imagem: cacheAtual.imagemCanonicaDuravel,
        imagemUrl: cacheAtual.imagemCanonicaDuravel,
        imagemOrigem: cacheAtual.imagemOrigem || "radar_mirror/mensagem",
        imagemStatus: cacheAtual.imagemStatus || "radar_mirror_materializada",
        imagemTentativas: cacheAtual.imagemTentativas || []
      };
      fallbackCacheRadar = { ...cacheAtual, cacheHit: true };
    }
    }
  }

  if (ehMercadoLivreComMlb) {
    const imagemImportador = texto(ofertaEnriquecida.imagem || ofertaEnriquecida.imagemUrl || "");
    const imagemImportadorResolvida = resolverImagemUniversal({
      imagem: imagemImportador,
      imagemOrigem: ofertaEnriquecida.imagemOrigem || "importador_ml_mlb",
      imagemConfianca: 120
    });
    if (imagemImportadorResolvida.imagem) {
      const qualidadeMl = classificarQualidadeImagemMercadoLivre(imagemImportadorResolvida.imagem, ofertaEnriquecida);
      if (qualidadeMl.baixa) {
        urlsMlBaixaQualidade.add(imagemUrlNormalizada(imagemImportadorResolvida.imagem));
        fallbackImagemMlBaixa = {
          ...imagemImportadorResolvida,
          imagemOrigem: ofertaEnriquecida.imagemOrigem || "importador_ml_mlb",
          imagemStatus: "mercadolivre_thumbnail_fallback",
          imagemQualidadeMercadoLivre: qualidadeMl
        };
      } else {
        if (origemImagemRadar(imagemImportadorResolvida)) {
          fallbackImagemRadar = fallbackImagemRadar || {
            ...imagemImportadorResolvida,
            imagemOrigem: ofertaEnriquecida.imagemOrigem || "radar_mirror/mensagem",
            imagemStatus: imagemImportadorResolvida.imagemStatus || "radar_mirror_materializada"
          };
        } else {
        const resultado = resultadoFinalDeImagemResolvida({
          chave,
          eventoId,
          marketplace,
          produtoId,
          resolvida: {
            ...imagemImportadorResolvida,
            imagemOrigem: ofertaEnriquecida.imagemOrigem || "importador_ml_mlb",
            imagemStatus: "importador_ml_mlb"
          },
          extra: {
            materializacoes: Number(cacheAtual.materializacoes || 0),
            ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {}),
            linkResolvido: linkResolvidoImagem
          }
        });
        cacheImagemCanonicaEvento.set(chave, resultado);
        return { ...resultado, cacheHit: false };
        }
      }
    }
  }

  if (!ehMercadoLivreComMlb && imagemOficialMarketplace?.imagem) {
    const resultado = montarResultadoImagemOficialMarketplace({
      chave,
      eventoId,
      marketplace,
      produtoId,
      resolvida: imagemOficialMarketplace,
      cacheAtual,
      linkResolvido: linkResolvidoImagem
    });
    cacheImagemCanonicaEvento.set(chave, resultado);
    return { ...resultado, cacheHit: false };
  }

  const disputaMl = ehMercadoLivreComMlb
    ? resolverImagemUniversalMercadoLivrePreferindoQualidade(ofertaImagem, contextoImagemSemRadar, {
        produtoId,
        urlsBaixaQualidade: urlsMlBaixaQualidade,
        fallbackBaixa: fallbackImagemMlBaixa
      })
    : { resolvida: resolverImagemUniversal(ofertaImagem, contextoImagem), fallbackBaixa: fallbackImagemMlBaixa };
  const resolvida = disputaMl.resolvida || {};
  fallbackImagemMlBaixa = disputaMl.fallbackBaixa || fallbackImagemMlBaixa;
  if (resolvida.imagem) {
    if (
      origemImagemRadar(resolvida) ||
      (fallbackImagemRadar?.imagem && imagemUrlNormalizada(resolvida.imagem) === imagemUrlNormalizada(fallbackImagemRadar.imagem))
    ) {
      fallbackImagemRadar = fallbackImagemRadar || resolvida;
    } else {
    const resultado = resultadoFinalDeImagemResolvida({
      chave,
      eventoId,
      marketplace,
      produtoId,
      resolvida,
      extra: {
        materializacoes: Number(cacheAtual.materializacoes || 0),
        ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {}),
        linkResolvido: linkResolvidoImagem
      }
    });
    cacheImagemCanonicaEvento.set(chave, resultado);
    return { ...resultado, cacheHit: false };
    }
  }

  let ultimoMotivo = "nenhuma_fonte_de_imagem";
  if (ehMercadoLivreComMlb) {
    if (fallbackImagemRadar?.imagem) {
      const candidatoSeguroContraRadar = resolverImagemMlSeguraParaVencerRadar(ofertaImagem, produtoId, urlsMlBaixaQualidade);
      if (candidatoSeguroContraRadar?.imagem) {
        const resultado = resultadoFinalDeImagemResolvida({
          chave,
          eventoId,
          marketplace,
          produtoId,
          resolvida: candidatoSeguroContraRadar,
          extra: {
            materializacoes: Number(cacheAtual.materializacoes || 0),
            ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {}),
            linkResolvido: linkResolvidoImagem
          }
        });
        cacheImagemCanonicaEvento.set(chave, resultado);
        return { ...resultado, cacheHit: false };
      }

      const oficialAntesDoRadar = await buscarImagemOficialMl(produtoId, deps);
      const oficialResolvidaAntesDoRadar = resolverImagemUniversal({ imagem: oficialAntesDoRadar.imagem || "" });
      if (oficialResolvidaAntesDoRadar.imagem) {
        const resultado = resultadoImagemCanonica({
          chave,
          eventoId,
          marketplace,
          produtoId,
          imagem: oficialResolvidaAntesDoRadar.imagem,
          origem: oficialAntesDoRadar.origem || "api_oficial_mlb",
          status: "api_oficial_mlb",
          extra: {
            imagemCanonicaFinal: true,
            enriquecimentoPendente: false,
            materializacoes: Number(cacheAtual.materializacoes || 0),
            ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {}),
            linkResolvido: oficialAntesDoRadar.linkResolvido || "",
            statusHttp: oficialAntesDoRadar.statusHttp ?? null,
            apiConsultada: oficialAntesDoRadar.apiConsultada === true,
            autenticacao: oficialAntesDoRadar.autenticacao || "",
            imagemFallbackRadarDisponivel: true,
            imagemFallbackRadarOrigem: fallbackImagemRadar.imagemOrigem || ""
          }
        });
        cacheImagemCanonicaEvento.set(chave, resultado);
        return { ...resultado, cacheHit: false };
      }

      const historicoAntesDoRadar = await buscarHistoricoMesmoMlb(produtoId, deps);
      const historicoResolvidoAntesDoRadar = resolverImagemUniversal({ imagem: historicoAntesDoRadar.imagem || "" });
      if (historicoResolvidoAntesDoRadar.imagem) {
        const resultado = resultadoImagemCanonica({
          chave,
          eventoId,
          marketplace,
          produtoId,
          imagem: historicoResolvidoAntesDoRadar.imagem,
          origem: historicoAntesDoRadar.origem || "historico_mesmo_mlb",
          status: "historico_mesmo_mlb",
          extra: {
            imagemCanonicaFinal: true,
            enriquecimentoPendente: false,
            materializacoes: Number(cacheAtual.materializacoes || 0),
            ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {}),
            imagemFallbackRadarDisponivel: true,
            imagemFallbackRadarOrigem: fallbackImagemRadar.imagemOrigem || ""
          }
        });
        cacheImagemCanonicaEvento.set(chave, resultado);
        return { ...resultado, cacheHit: false };
      }

      const resultado = resultadoSemImagemPublicavel({
        chave,
        eventoId,
        marketplace,
        produtoId,
        cacheAtual: fallbackCacheRadar || cacheAtual,
        linkResolvido: linkResolvidoImagem,
        radarFallback: fallbackImagemRadar,
        motivo: "imagem_radar_nao_publicavel"
      });
      cacheImagemCanonicaEvento.set(chave, resultado);
      return { ...resultado, cacheHit: false };
    }

    const oficial = await buscarImagemOficialMl(produtoId, deps);
    const oficialResolvida = resolverImagemUniversal({ imagem: oficial.imagem || "" });
    if (oficialResolvida.imagem) {
      const resultado = resultadoImagemCanonica({
        chave,
        eventoId,
        marketplace,
        produtoId,
        imagem: oficialResolvida.imagem,
        origem: oficial.origem || "api_oficial_mlb",
        status: "api_oficial_mlb",
        extra: {
          imagemCanonicaFinal: true,
          enriquecimentoPendente: false,
          materializacoes: Number(cacheAtual.materializacoes || 0),
          ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {}),
          linkResolvido: oficial.linkResolvido || "",
          statusHttp: oficial.statusHttp ?? null,
          apiConsultada: oficial.apiConsultada === true,
          autenticacao: oficial.autenticacao || ""
        }
      });
      cacheImagemCanonicaEvento.set(chave, resultado);
      return { ...resultado, cacheHit: false };
    }
    ultimoMotivo = oficial.motivo || ultimoMotivo;

    const historico = await buscarHistoricoMesmoMlb(produtoId, deps);
    const historicoResolvido = resolverImagemUniversal({ imagem: historico.imagem || "" });
    if (historicoResolvido.imagem) {
      const resultado = resultadoImagemCanonica({
        chave,
        eventoId,
        marketplace,
        produtoId,
        imagem: historicoResolvido.imagem,
        origem: historico.origem || "historico_mesmo_mlb",
        status: "historico_mesmo_mlb",
        extra: {
          imagemCanonicaFinal: true,
          enriquecimentoPendente: false,
          materializacoes: Number(cacheAtual.materializacoes || 0),
          ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {})
        }
      });
      cacheImagemCanonicaEvento.set(chave, resultado);
      return { ...resultado, cacheHit: false };
    }
    ultimoMotivo = historico.motivo || ultimoMotivo;
  }

  const radarMensagemBruta = encontrarImagemRadarMirror(metadataEvento);
  if (radarMensagemBruta?.imagemOriginal) {
    const resultado = resultadoSemImagemPublicavel({
      chave,
      eventoId,
      marketplace,
      produtoId,
      cacheAtual,
      linkResolvido: linkResolvidoImagem,
      radarFallback: {
        imagem: radarMensagemBruta.imagemOriginal,
        imagemOrigem: radarMensagemBruta.origem,
        imagemStatus: "radar_mirror_nao_publicavel"
      },
      motivo: "imagem_radar_nao_publicavel"
    });
    cacheImagemCanonicaEvento.set(chave, resultado);
    return { ...resultado, cacheHit: false };
  }

  const radarThumbnailBruto = encontrarImagemRadarMirror(metadataEvento, { permitirThumbnailFallback: true });
  if (radarThumbnailBruto?.imagemOriginal) {
    const resultado = resultadoSemImagemPublicavel({
      chave,
      eventoId,
      marketplace,
      produtoId,
      cacheAtual,
      linkResolvido: linkResolvidoImagem,
      radarFallback: {
        imagem: radarThumbnailBruto.imagemOriginal,
        imagemOrigem: radarThumbnailBruto.origem || "radar_mirror/thumbnail",
        imagemStatus: "radar_mirror_thumbnail_nao_publicavel"
      },
      motivo: "imagem_radar_thumbnail_nao_publicavel"
    });
    cacheImagemCanonicaEvento.set(chave, resultado);
    return { ...resultado, cacheHit: false };
  }

  if (fallbackImagemRadar?.imagem) {
    const resultado = resultadoSemImagemPublicavel({
      chave,
      eventoId,
      marketplace,
      produtoId,
      cacheAtual: fallbackCacheRadar || cacheAtual,
      linkResolvido: linkResolvidoImagem,
      radarFallback: fallbackImagemRadar,
      motivo: "imagem_radar_nao_publicavel"
    });
    cacheImagemCanonicaEvento.set(chave, resultado);
    return { ...resultado, cacheHit: false };
  }

  if (fallbackImagemMlBaixa?.imagem) {
    const resultado = montarResultadoFallbackImagemMlBaixa({
      chave,
      eventoId,
      marketplace,
      produtoId,
      resolvida: fallbackImagemMlBaixa,
      cacheAtual,
      linkResolvido: linkResolvidoImagem
    });
    cacheImagemCanonicaEvento.set(chave, resultado);
    return { ...resultado, cacheHit: false };
  }

  const semImagemFinal = resultadoImagemCanonica({
    chave,
    eventoId,
    marketplace,
    produtoId,
    status: "nao_resolvida",
    motivo: ultimoMotivo || "nenhuma_fonte_de_imagem",
    extra: {
      imagemCanonicaFinal: true,
      enriquecimentoPendente: false,
      materializacoes: Number(cacheAtual.materializacoes || 0),
      ...(cacheAtual.radarMirrorMaterializacao ? { radarMirrorMaterializacao: cacheAtual.radarMirrorMaterializacao } : {})
    }
  });
  cacheImagemCanonicaEvento.set(chave, semImagemFinal);
  return { ...semImagemFinal, cacheHit: false };
}

function aplicarImagemCanonicaMetadata(metadata = {}, imagemCanonica = {}) {
  const base = objetoSeguro(metadata);
  if (!imagemCanonica?.imagemCanonicaDuravel) {
    const radarMirrorMaterializacao = objetoSeguro(imagemCanonica.radarMirrorMaterializacao);
    const falhaRadarMirror = radarMirrorMaterializacao.status === "falha"
      && radarMirrorMaterializacao.origem === "radar_mirror/mensagem";
    return {
      ...base,
      imagem: "",
      imagemUrl: "",
      imagemCanonicaDuravel: "",
      imagemOrigem: imagemCanonica.imagemOrigem || "nenhuma",
      imagemStatus: imagemCanonica.imagemStatus || "nao_resolvida_ainda",
      imagemRecuperavel: false,
      imagemDuravel: false,
      imagemEnviavel: false,
      imagemCacheCanonico: {
        chave: imagemCanonica.chave || "",
        produtoId: imagemCanonica.produtoId || "",
        status: imagemCanonica.imagemStatus || "nao_resolvida",
        motivo: imagemCanonica.motivo || "sem_candidato",
        imagemEnviavel: false,
        preliminar: imagemCanonica.preliminar === true,
        enriquecimentoPendente: imagemCanonica.enriquecimentoPendente === true,
        imagemCanonicaFinal: imagemCanonica.imagemCanonicaFinal === true,
        materializacoes: Number(imagemCanonica.materializacoes || 0),
        ...(falhaRadarMirror ? {
          radarMirrorMaterializacao,
          bloquearRematerializacaoRadar: true
        } : {})
      }
    };
  }

  const radarMirror = objetoSeguro(base.radarMirror);
  const midia = objetoSeguro(radarMirror.midia);
  const radarMirrorAtualizado = /^radar_mirror/.test(imagemCanonica.imagemOrigem || "")
    ? {
        ...radarMirror,
        midia: {
          ...midia,
          imagemOrigem: midia.imagemOrigem || "mensagem",
          imagemMaterializada: imagemCanonica.imagemCanonicaDuravel,
          imagemDuravel: imagemCanonica.imagemCanonicaDuravel,
          imagemEnviavel: imagemCanonica.imagemCanonicaDuravel,
          imagemStatus: imagemCanonica.imagemStatus
        }
      }
    : radarMirror;

  return {
    ...base,
    imagem: imagemCanonica.imagemCanonicaDuravel,
    imagemUrl: imagemCanonica.imagemCanonicaDuravel,
    imagemCanonicaDuravel: imagemCanonica.imagemCanonicaDuravel,
    imagemOrigem: imagemCanonica.imagemOrigem,
    imagemStatus: imagemCanonica.imagemStatus,
    imagemRecuperavel: true,
    imagemDuravel: true,
    imagemEnviavel: true,
    ...(radarMirrorAtualizado && Object.keys(radarMirrorAtualizado).length ? { radarMirror: radarMirrorAtualizado } : {}),
    imagemCacheCanonico: {
      chave: imagemCanonica.chave || "",
      produtoId: imagemCanonica.produtoId || "",
      status: imagemCanonica.imagemStatus,
      origem: imagemCanonica.imagemOrigem,
      imagemCanonicaDuravel: imagemCanonica.imagemCanonicaDuravel,
      imagemEnviavel: true,
      preliminar: imagemCanonica.preliminar === true,
      enriquecimentoPendente: imagemCanonica.enriquecimentoPendente === true,
      imagemCanonicaFinal: imagemCanonica.imagemCanonicaFinal === true,
      materializacoes: Number(imagemCanonica.materializacoes || 0),
      ...(imagemCanonica.radarMirrorMaterializacao ? {
        radarMirrorMaterializacao: imagemCanonica.radarMirrorMaterializacao
      } : {}),
      cacheHit: imagemCanonica.cacheHit === true,
      resolvidaEm: imagemCanonica.resolvidaEm || new Date().toISOString()
    }
  };
}

function _limparCacheImagemCanonicaEvento() {
  cacheImagemCanonicaEvento.clear();
}

module.exports = {
  resolverImagemCanonicaEvento,
  resolverImagemCanonicaFinalEvento,
  aplicarImagemCanonicaMetadata,
  chaveImagemCanonicaEvento,
  detectarProdutoIdCanonico,
  _limparCacheImagemCanonicaEvento
};
