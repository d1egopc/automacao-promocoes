const ALIASES_DIRETOS = [
  "imageUrl",
  "image_url",
  "image",
  "foto",
  "fotoUrl",
  "imagemOriginal",
  "image_original",
  "picture_url",
  "pictureUrl",
  "original_picture",
  "product_main_image_url",
  "landingImage",
  "ogImage",
  "twitterImage",
  "imagemRadar",
  "urlImagem",
];

const ALIASES_THUMBNAIL = [
  "thumbnail",
  "thumbnailUrl",
  "thumbnail_url",
  "secure_thumbnail",
  "secureThumbnail",
];

const ALIASES_OBJETO = [
  "url",
  "src",
  "secure_url",
  "secureUrl",
  "imageUrl",
  "imagemUrl",
  "secure_thumbnail",
];

const ESTRUTURAS_CONHECIDAS = [
  "images",
  "imagens",
  "pictures",
  "fotos",
  "product_small_image_urls",
  "galeria",
  "imagemCandidatos",
];

const CONTAINERS_BRUTOS = [
  "metadata",
  "produto",
  "dadosProduto",
  "payload",
  "raw",
  "dadosBrutos",
  "evento_metadata",
  "job_metadata",
  "link_metadata",
];

const MAX_PROFUNDIDADE = 5;
const MAX_TENTATIVAS = 30;
const MAX_CANDIDATOS_IMAGEM = 30;

function decodificarEntidadesBasicas(valor) {
  return String(valor || "").trim().replace(/&amp;/g, "&");
}

function hostEhIpPrivado(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const partes = ipv4.slice(1).map(Number);
    if (partes.some((parte) => Number.isNaN(parte) || parte < 0 || parte > 255)) return true;
    const [a, b] = partes;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }

  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    return true;
  }

  return false;
}

function imagemUrlValidaUniversal(valor) {
  const urlNormalizada = decodificarEntidadesBasicas(valor);
  if (!urlNormalizada) return { ok: false, motivo: "vazia" };
  if (/^(data|blob):/i.test(urlNormalizada)) return { ok: false, motivo: "uri_nao_http" };
  if (!/^https?:\/\//i.test(urlNormalizada)) return { ok: false, motivo: "protocolo_invalido" };
  if (/[<>\{\}\s]/.test(urlNormalizada)) return { ok: false, motivo: "url_malformada" };

  let parsed;
  try {
    parsed = new URL(urlNormalizada);
  } catch (_) {
    return { ok: false, motivo: "url_malformada" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return { ok: false, motivo: "protocolo_invalido" };
  if (hostEhIpPrivado(parsed.hostname)) return { ok: false, motivo: "host_bloqueado" };
  if (/\.svg(?:$|[?#])/i.test(parsed.pathname)) return { ok: false, motivo: "svg_bloqueado" };
  if (/placeholder|no[-_ ]?image|sem[-_ ]?imagem|imagem[-_ ]?indisponivel|not[-_ ]?found|blank|spacer|transparent|default[-_ ]?(product|image)|missing[-_ ]?image/i.test(urlNormalizada)) {
    return { ok: false, motivo: "placeholder" };
  }

  return { ok: true, url: urlNormalizada };
}

function imagemUrlEfemeraUniversal(valor) {
  const urlNormalizada = decodificarEntidadesBasicas(valor);
  if (!urlNormalizada || !/^https?:\/\//i.test(urlNormalizada)) return false;
  try {
    const parsed = new URL(urlNormalizada);
    const host = String(parsed.hostname || "").toLowerCase();
    if (host === "mmg.whatsapp.net") return true;
    if (host.endsWith(".whatsapp.net") && /\/o\d+\/v\//i.test(parsed.pathname)) return true;
  } catch (_) {
    return false;
  }
  return false;
}

function statusImagemEnviavel(camada) {
  if (camada === "radar_mirror_duravel") return "radar_mirror_materializada";
  return statusParaCamada(camada);
}

function camadaEhDuravel(camada) {
  return camada === "radar_mirror_duravel";
}

function registrarTentativa(tentativas, origem, status, motivo, confianca) {
  if (!origem || tentativas.length >= MAX_TENTATIVAS) return;
  if (tentativas.some((tentativa) => tentativa.origem === origem && tentativa.status === status)) return;
  const tentativa = { origem, status };
  if (motivo) tentativa.motivo = motivo;
  if (typeof confianca === "number") tentativa.confianca = confianca;
  tentativas.push(tentativa);
}

function candidato(valor, origem, camada, confianca) {
  return { valor, origem, camada, confianca };
}

function limiteCandidatosAtingido(estado) {
  return estado.candidatos.length >= MAX_CANDIDATOS_IMAGEM;
}

function adicionarCandidatoImagem(valor, origem, camada, confianca, estado) {
  if (limiteCandidatosAtingido(estado)) return;
  const normalizado = decodificarEntidadesBasicas(valor);
  if (!normalizado || estado.urls.has(normalizado)) return;
  estado.urls.add(normalizado);
  estado.candidatos.push(candidato(normalizado, origem, camada, confianca));
}

function coletarDeValor(valor, origem, camada, confianca, estado, profundidade = 0) {
  if (valor == null || profundidade > MAX_PROFUNDIDADE || limiteCandidatosAtingido(estado)) return;

  if (typeof valor === "string") {
    adicionarCandidatoImagem(valor, origem, camada, confianca, estado);
    return;
  }

  if (Array.isArray(valor)) {
    for (let index = 0; index < valor.length && !limiteCandidatosAtingido(estado); index += 1) {
      coletarDeValor(valor[index], `${origem}[${index}]`, camada, confianca, estado, profundidade + 1);
    }
    return;
  }

  if (typeof valor !== "object") return;
  if (estado.visitados.has(valor)) return;
  estado.visitados.add(valor);

  for (const alias of ALIASES_OBJETO) {
    if (limiteCandidatosAtingido(estado)) break;
    if (Object.prototype.hasOwnProperty.call(valor, alias)) {
      coletarDeValor(valor[alias], `${origem}.${alias}`, camada, confianca, estado, profundidade + 1);
    }
  }

  if (!limiteCandidatosAtingido(estado) && Object.prototype.hasOwnProperty.call(valor, "string")) {
    coletarDeValor(valor.string, `${origem}.string`, camada, confianca, estado, profundidade + 1);
  }
}

function coletarDoContainerBruto(valor, origem, estado, profundidade = 0) {
  if (valor == null || profundidade > MAX_PROFUNDIDADE || limiteCandidatosAtingido(estado)) return;
  if (typeof valor === "string" || Array.isArray(valor)) {
    coletarDeValor(valor, origem, "payload", 70, estado, profundidade);
    return;
  }
  if (typeof valor !== "object") return;
  if (estado.visitados.has(valor)) return;
  estado.visitados.add(valor);

  for (const alias of ["imagemUrl", "imagem", ...ALIASES_DIRETOS, ...ALIASES_THUMBNAIL, ...ALIASES_OBJETO]) {
    if (limiteCandidatosAtingido(estado)) break;
    if (Object.prototype.hasOwnProperty.call(valor, alias)) {
      coletarDeValor(valor[alias], `${origem}.${alias}`, "payload", 70, estado, profundidade + 1);
    }
  }

  for (const estrutura of ESTRUTURAS_CONHECIDAS) {
    if (limiteCandidatosAtingido(estado)) break;
    if (Object.prototype.hasOwnProperty.call(valor, estrutura)) {
      coletarDeValor(valor[estrutura], `${origem}.${estrutura}`, "payload", 70, estado, profundidade + 1);
    }
  }

  if (!limiteCandidatosAtingido(estado) && valor.jsonLd && Object.prototype.hasOwnProperty.call(valor.jsonLd, "image")) {
    coletarDeValor(valor.jsonLd.image, `${origem}.jsonLd.image`, "payload", 70, estado, profundidade + 1);
  }

  for (const container of CONTAINERS_BRUTOS) {
    if (limiteCandidatosAtingido(estado)) break;
    if (Object.prototype.hasOwnProperty.call(valor, container)) {
      coletarDoContainerBruto(valor[container], `${origem}.${container}`, estado, profundidade + 1);
    }
  }
}

function coletarCamposImagemConhecidos(valor, origem, estado, profundidade = 0) {
  if (valor == null || profundidade > MAX_PROFUNDIDADE || limiteCandidatosAtingido(estado)) return;
  if (typeof valor === "string" || Array.isArray(valor)) {
    coletarDeValor(valor, origem, "payload", 70, estado, profundidade);
    return;
  }
  if (typeof valor !== "object") return;
  if (estado.visitados.has(valor)) return;
  estado.visitados.add(valor);

  for (const alias of ["imagemUrl", "imagem", ...ALIASES_DIRETOS, ...ALIASES_THUMBNAIL]) {
    if (limiteCandidatosAtingido(estado)) break;
    if (Object.prototype.hasOwnProperty.call(valor, alias)) {
      coletarDeValor(valor[alias], `${origem}.${alias}`, "payload", 70, estado, profundidade + 1);
    }
  }

  for (const estrutura of ESTRUTURAS_CONHECIDAS) {
    if (limiteCandidatosAtingido(estado)) break;
    if (Object.prototype.hasOwnProperty.call(valor, estrutura)) {
      coletarDeValor(valor[estrutura], `${origem}.${estrutura}`, "payload", 70, estado, profundidade + 1);
    }
  }

  if (!limiteCandidatosAtingido(estado) && valor.jsonLd && Object.prototype.hasOwnProperty.call(valor.jsonLd, "image")) {
    coletarDeValor(valor.jsonLd.image, `${origem}.jsonLd.image`, "payload", 70, estado, profundidade + 1);
  }
}

function coletarDoContextoConhecido(valor, origem, estado, profundidade = 0) {
  if (valor == null || profundidade > MAX_PROFUNDIDADE || limiteCandidatosAtingido(estado)) return;
  if (typeof valor !== "object") return;
  if (estado.visitados.has(valor)) return;
  estado.visitados.add(valor);

  coletarCamposImagemConhecidos(valor, origem, estado, profundidade);

  if (!limiteCandidatosAtingido(estado) && valor.metadata && typeof valor.metadata === "object") {
    coletarCamposImagemConhecidos(valor.metadata, `${origem}.metadata`, estado, profundidade + 1);
    if (valor.metadata.produto && typeof valor.metadata.produto === "object") {
      coletarCamposImagemConhecidos(valor.metadata.produto, `${origem}.metadata.produto`, estado, profundidade + 2);
    }
    if (!limiteCandidatosAtingido(estado) && valor.metadata.importacao && typeof valor.metadata.importacao === "object") {
      coletarCamposImagemConhecidos(valor.metadata.importacao, `${origem}.metadata.importacao`, estado, profundidade + 2);
    }
  }

  for (const container of ["metadataEvento", "evento_metadata", "job_metadata", "link_metadata"]) {
    if (limiteCandidatosAtingido(estado)) break;
    if (valor[container] && typeof valor[container] === "object") {
      coletarCamposImagemConhecidos(valor[container], `${origem}.${container}`, estado, profundidade + 1);
    }
  }
}

function coletarRadarMirror(valor, origem, estado) {
  if (!valor || typeof valor !== "object" || limiteCandidatosAtingido(estado)) return;

  const midia = valor.midia && typeof valor.midia === "object" ? valor.midia : {};
  const origemMidia = String(midia.imagemOrigem || valor.imagemOrigem || "").toLowerCase();
  if (origemMidia !== "mensagem") return;

  const origemOficial = `${origem}/mensagem`;

  coletarDeValor(midia.imagemMaterializada, `${origemOficial}.midia.imagemMaterializada`, "radar_mirror_duravel", 120, estado);
  coletarDeValor(valor.imagemMaterializada, `${origemOficial}.imagemMaterializada`, "radar_mirror_duravel", 120, estado);
  coletarDeValor(midia.imagemDuravel, `${origemOficial}.midia.imagemDuravel`, "radar_mirror_duravel", 120, estado);
  coletarDeValor(valor.imagemDuravel, `${origemOficial}.imagemDuravel`, "radar_mirror_duravel", 120, estado);
  coletarDeValor(midia.imagemEnviavel, `${origemOficial}.midia.imagemEnviavel`, "radar_mirror_duravel", 120, estado);
  coletarDeValor(valor.imagemEnviavel, `${origemOficial}.imagemEnviavel`, "radar_mirror_duravel", 120, estado);
  coletarDeValor(midia.imagemOriginal, `${origemOficial}.midia.imagemOriginal`, "radar_mirror", 110, estado);
  coletarDeValor(valor.imagemOriginal, `${origemOficial}.imagemOriginal`, "radar_mirror", 110, estado);
  coletarDeValor(midia.imagem, `${origemOficial}.midia.imagem`, "radar_mirror", 110, estado);
  coletarDeValor(valor.imagem, `${origemOficial}.imagem`, "radar_mirror", 110, estado);
  coletarDeValor(midia.imagemUrl, `${origemOficial}.midia.imagemUrl`, "radar_mirror", 110, estado);
  coletarDeValor(valor.imagemUrl, `${origemOficial}.imagemUrl`, "radar_mirror", 110, estado);
}

function coletarCandidatos(oferta, contexto = {}) {
  const estado = {
    candidatos: [],
    visitados: new WeakSet(),
    urls: new Set(),
  };

  const metadataOferta = oferta && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const metadataEntrada = contexto.ofertaEntrada && typeof contexto.ofertaEntrada.metadata === "object"
    ? contexto.ofertaEntrada.metadata
    : {};
  const metadataEvento = contexto.evento && typeof contexto.evento.metadata === "object"
    ? contexto.evento.metadata
    : {};
  const metadataJob = contexto.job && typeof contexto.job.metadata === "object"
    ? contexto.job.metadata
    : {};

  coletarRadarMirror(oferta.radarMirror, "radar_mirror", estado);
  coletarRadarMirror(metadataOferta.radarMirror, "radar_mirror", estado);
  coletarRadarMirror(metadataEntrada.radarMirror, "contexto.ofertaEntrada.metadata.radarMirror", estado);
  coletarRadarMirror(metadataEvento.radarMirror, "contexto.evento.metadata.radarMirror", estado);
  coletarRadarMirror(metadataJob.radarMirror, "contexto.job.metadata.radarMirror", estado);
  coletarRadarMirror(metadataJob.metadataEvento?.radarMirror, "contexto.job.metadata.metadataEvento.radarMirror", estado);

  if (Object.prototype.hasOwnProperty.call(oferta, "imagemUrl")) {
    coletarDeValor(oferta.imagemUrl, "imagemUrl", "oficial", 100, estado);
  }
  if (!limiteCandidatosAtingido(estado) && Object.prototype.hasOwnProperty.call(oferta, "imagem")) {
    coletarDeValor(oferta.imagem, "imagem", "oficial", 100, estado);
  }

  for (const alias of ALIASES_DIRETOS) {
    if (limiteCandidatosAtingido(estado)) break;
    if (Object.prototype.hasOwnProperty.call(oferta, alias)) {
      coletarDeValor(oferta[alias], alias, "alias", 90, estado);
    }
  }

  for (const alias of ALIASES_THUMBNAIL) {
    if (limiteCandidatosAtingido(estado)) break;
    if (Object.prototype.hasOwnProperty.call(oferta, alias)) {
      coletarDeValor(oferta[alias], alias, "alias", 90, estado);
    }
  }

  for (const estrutura of ESTRUTURAS_CONHECIDAS) {
    if (limiteCandidatosAtingido(estado)) break;
    if (Object.prototype.hasOwnProperty.call(oferta, estrutura)) {
      coletarDeValor(oferta[estrutura], estrutura, "estrutura", 80, estado);
    }
  }

  if (!limiteCandidatosAtingido(estado) && oferta.jsonLd && Object.prototype.hasOwnProperty.call(oferta.jsonLd, "image")) {
    coletarDeValor(oferta.jsonLd.image, "jsonLd.image", "estrutura", 80, estado);
  }

  for (const container of CONTAINERS_BRUTOS) {
    if (limiteCandidatosAtingido(estado)) break;
    if (Object.prototype.hasOwnProperty.call(oferta, container)) {
      coletarDoContainerBruto(oferta[container], container, estado);
    }
  }

  const fontesContexto = [
    ["contexto.ofertaEntrada", contexto.ofertaEntrada],
    ["contexto.evento", contexto.evento],
    ["contexto.link", contexto.link],
    ["contexto.job", contexto.job],
  ];

  for (const [origem, valor] of fontesContexto) {
    if (limiteCandidatosAtingido(estado)) break;
    if (valor) coletarDoContextoConhecido(valor, origem, estado);
  }

  return estado.candidatos;
}

function coletarCandidatosImagemUniversal(oferta = {}, contexto = {}) {
  const candidatos = coletarCandidatos(
    oferta && typeof oferta === "object" ? oferta : {},
    contexto && typeof contexto === "object" ? contexto : {}
  );
  return candidatos
    .slice(0, MAX_CANDIDATOS_IMAGEM)
    .map((item) => item.valor);
}

function preservarCandidatosImagemUniversal(ofertaEntrada = {}, contexto = {}) {
  const oferta = ofertaEntrada && typeof ofertaEntrada === "object" ? ofertaEntrada : {};
  const metadata = oferta.metadata && typeof oferta.metadata === "object" && !Array.isArray(oferta.metadata)
    ? oferta.metadata
    : {};
  const produto = metadata.produto && typeof metadata.produto === "object" && !Array.isArray(metadata.produto)
    ? metadata.produto
    : {};
  const imagemCandidatos = coletarCandidatosImagemUniversal(oferta, contexto)
    .slice(0, MAX_CANDIDATOS_IMAGEM);

  return {
    ...oferta,
    metadata: {
      ...metadata,
      produto: {
        ...produto,
        imagemCandidatos,
      },
    },
  };
}

function statusParaCamada(camada) {
  if (camada === "oficial") return "preservada";
  if (camada === "radar_mirror_duravel") return "radar_mirror_materializada";
  if (camada === "radar_mirror") return "radar_mirror_preservada";
  if (camada === "payload") return "resolvida_payload_bruto";
  return "resolvida_alias";
}

function resolverImagemUniversal(ofertaEntrada = {}, contexto = {}) {
  const ofertaOriginal = ofertaEntrada && typeof ofertaEntrada === "object" ? ofertaEntrada : {};
  const oferta = { ...ofertaOriginal };

  if (oferta.imagemStatus && imagemUrlValidaUniversal(oferta.imagemUrl).ok && !imagemUrlEfemeraUniversal(oferta.imagemUrl)) {
    const validacao = imagemUrlValidaUniversal(oferta.imagemUrl);
    return {
      ...preservarCandidatosImagemUniversal(oferta, contexto),
      imagem: validacao.url,
      imagemUrl: validacao.url,
      imagemOrigem: oferta.imagemOrigem || "imagemUrl",
      imagemConfianca: typeof oferta.imagemConfianca === "number" ? oferta.imagemConfianca : 100,
      imagemResolvidaEm: oferta.imagemResolvidaEm || new Date().toISOString(),
      imagemTentativas: Array.isArray(oferta.imagemTentativas) ? oferta.imagemTentativas.slice(0, MAX_TENTATIVAS) : [],
      imagemUrlPresente: true,
      imagemRecuperavel: oferta.imagemRecuperavel !== false,
      imagemDuravel: oferta.imagemDuravel !== false,
      imagemEnviavel: oferta.imagemEnviavel !== false,
    };
  }

  const tentativas = [];
  const candidatos = coletarCandidatos(oferta, contexto);
  const ofertaComCandidatos = preservarCandidatosImagemUniversal(oferta, contexto);
  const urlsAvaliadas = new Set();

  for (const item of candidatos) {
    const validacao = imagemUrlValidaUniversal(item.valor);
    const chave = validacao.ok ? validacao.url : String(item.valor || "");
    if (urlsAvaliadas.has(chave)) continue;
    urlsAvaliadas.add(chave);

    if (!validacao.ok) {
      registrarTentativa(tentativas, item.origem, "rejeitada", validacao.motivo, item.confianca);
      continue;
    }

    if (imagemUrlEfemeraUniversal(validacao.url) && !camadaEhDuravel(item.camada)) {
      registrarTentativa(tentativas, item.origem, "rejeitada", "imagem_efemera_nao_materializada", item.confianca);
      continue;
    }

    registrarTentativa(tentativas, item.origem, "selecionada", "", item.confianca);
    return {
      ...ofertaComCandidatos,
      imagem: validacao.url,
      imagemUrl: validacao.url,
      imagemStatus: statusImagemEnviavel(item.camada),
      imagemOrigem: item.origem,
      imagemConfianca: item.confianca,
      imagemResolvidaEm: new Date().toISOString(),
      imagemTentativas: tentativas,
      imagemUrlPresente: true,
      imagemRecuperavel: true,
      imagemDuravel: !imagemUrlEfemeraUniversal(validacao.url),
      imagemEnviavel: true,
    };
  }

  return {
    ...ofertaComCandidatos,
    imagem: "",
    imagemUrl: "",
    imagemStatus: "nao_resolvida",
    imagemOrigem: oferta.imagemOrigem || "nenhuma",
    imagemConfianca: 0,
    imagemResolvidaEm: oferta.imagemResolvidaEm || new Date().toISOString(),
    imagemTentativas: tentativas,
    imagemUrlPresente: candidatos.some((item) => imagemUrlValidaUniversal(item.valor).ok),
    imagemRecuperavel: false,
    imagemDuravel: false,
    imagemEnviavel: false,
  };
}

module.exports = {
  MAX_CANDIDATOS_IMAGEM,
  resolverImagemUniversal,
  imagemUrlValidaUniversal,
  imagemUrlEfemeraUniversal,
  coletarCandidatosImagemUniversal,
  preservarCandidatosImagemUniversal,
};
