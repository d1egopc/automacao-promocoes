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

function encontrarImagemRadarMirrorMensagem(metadataEvento = {}) {
  const radarMirror = objetoSeguro(metadataEvento.radarMirror);
  if (!origemRadarMensagem(radarMirror)) return { radarMirror: null, imagemOriginal: "" };
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
  return { radarMirror, imagemOriginal };
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

async function resolverPorRadarMirror({ chave, eventoId, marketplace, produtoId, metadataEvento, deps = {} } = {}) {
  const { imagemOriginal } = encontrarImagemRadarMirrorMensagem(metadataEvento);
  if (!imagemOriginal) return null;
  const validacao = imagemUrlValidaUniversal(imagemOriginal);
  if (!validacao.ok) {
    return resultadoImagemCanonica({ chave, eventoId, marketplace, produtoId, motivo: validacao.motivo || "radar_url_invalida" });
  }

  if (!imagemUrlEfemeraUniversal(validacao.url)) {
    return resultadoImagemCanonica({
      chave,
      eventoId,
      marketplace,
      produtoId,
      imagem: validacao.url,
      origem: "radar_mirror/mensagem",
      status: "radar_mirror_preservada"
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
        origem: "radar_mirror/mensagem",
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
      origem: "radar_mirror/mensagem",
      status: "radar_mirror_materializada",
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
        origem: "radar_mirror/mensagem",
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
  return buscarImagemOficialMercadoLivrePorMlb(`MLB${mlb}`);
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
  let radarMirrorMaterializacao = null;
  const radar = await resolverPorRadarMirror({ chave, eventoId, marketplace, produtoId, metadataEvento, deps });
  if (radar?.ok) {
    cacheImagemCanonicaEvento.set(chave, radar);
    return { ...radar, cacheHit: false };
  }
  if (radar?.falhou) {
    materializacoes += Number(radar.materializacoes || 0);
    ultimoMotivo = radar.motivo || "";
    radarMirrorMaterializacao = radar.radarMirrorMaterializacao || null;
  }

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

  if (marketplace === "mercadolivre" && /^MLB\d+$/.test(texto(produtoId).toUpperCase())) {
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
          statusHttp: oficial.statusHttp ?? null
        }
      });
      cacheImagemCanonicaEvento.set(chave, resultado);
      return { ...resultado, cacheHit: false };
    }
    ultimoMotivo = oficial.motivo || ultimoMotivo;
  }

  const semImagem = resultadoImagemCanonica({
    chave,
    eventoId,
    marketplace,
    produtoId,
    motivo: ultimoMotivo || "sem_candidato",
    extra: {
      materializacoes,
      ...(radarMirrorMaterializacao ? { radarMirrorMaterializacao } : {})
    }
  });
  cacheImagemCanonicaEvento.set(chave, semImagem);
  return { ...semImagem, cacheHit: false };
}

function aplicarImagemCanonicaMetadata(metadata = {}, imagemCanonica = {}) {
  const base = objetoSeguro(metadata);
  if (!imagemCanonica?.imagemCanonicaDuravel) {
    const radarMirrorMaterializacao = objetoSeguro(imagemCanonica.radarMirrorMaterializacao);
    const falhaRadarMirror = radarMirrorMaterializacao.status === "falha"
      && radarMirrorMaterializacao.origem === "radar_mirror/mensagem";
    return {
      ...base,
      imagemCacheCanonico: {
        chave: imagemCanonica.chave || "",
        produtoId: imagemCanonica.produtoId || "",
        status: imagemCanonica.imagemStatus || "nao_resolvida",
        motivo: imagemCanonica.motivo || "sem_candidato",
        imagemEnviavel: false,
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
  aplicarImagemCanonicaMetadata,
  chaveImagemCanonicaEvento,
  detectarProdutoIdCanonico,
  _limparCacheImagemCanonicaEvento
};
