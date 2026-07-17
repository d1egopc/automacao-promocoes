const ALIASES_DIRETOS = [
  "imageUrl",
  "image",
  "thumbnail",
  "thumbnailUrl",
  "foto",
  "fotoUrl",
  "imagemOriginal",
  "image_original",
  "product_main_image_url",
  "landingImage",
  "ogImage",
  "twitterImage",
  "imagemRadar",
];

const ALIASES_OBJETO = [
  "url",
  "src",
  "secure_url",
  "secureUrl",
  "imageUrl",
  "imagemUrl",
];

const ESTRUTURAS_CONHECIDAS = [
  "images",
  "imagens",
  "pictures",
  "fotos",
  "product_small_image_urls",
];

const CONTAINERS_BRUTOS = [
  "metadata",
  "produto",
  "payload",
  "raw",
  "dadosBrutos",
  "evento_metadata",
  "job_metadata",
  "link_metadata",
];

const MAX_PROFUNDIDADE = 5;
const MAX_TENTATIVAS = 30;

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

function coletarDeValor(valor, origem, camada, confianca, candidatos, visitados, profundidade = 0) {
  if (valor == null || profundidade > MAX_PROFUNDIDADE) return;

  if (typeof valor === "string") {
    candidatos.push(candidato(valor, origem, camada, confianca));
    return;
  }

  if (Array.isArray(valor)) {
    valor.forEach((item, index) => {
      coletarDeValor(item, `${origem}[${index}]`, camada, confianca, candidatos, visitados, profundidade + 1);
    });
    return;
  }

  if (typeof valor !== "object") return;
  if (visitados.has(valor)) return;
  visitados.add(valor);

  for (const alias of ALIASES_OBJETO) {
    if (Object.prototype.hasOwnProperty.call(valor, alias)) {
      coletarDeValor(valor[alias], `${origem}.${alias}`, camada, confianca, candidatos, visitados, profundidade + 1);
    }
  }

  if (Object.prototype.hasOwnProperty.call(valor, "string")) {
    coletarDeValor(valor.string, `${origem}.string`, camada, confianca, candidatos, visitados, profundidade + 1);
  }
}

function coletarDoContainerBruto(valor, origem, candidatos, visitados, profundidade = 0) {
  if (valor == null || profundidade > MAX_PROFUNDIDADE) return;
  if (typeof valor === "string" || Array.isArray(valor)) {
    coletarDeValor(valor, origem, "payload", 70, candidatos, visitados, profundidade);
    return;
  }
  if (typeof valor !== "object") return;
  if (visitados.has(valor)) return;
  visitados.add(valor);

  for (const alias of ["imagemUrl", "imagem", ...ALIASES_DIRETOS, ...ALIASES_OBJETO]) {
    if (Object.prototype.hasOwnProperty.call(valor, alias)) {
      coletarDeValor(valor[alias], `${origem}.${alias}`, "payload", 70, candidatos, visitados, profundidade + 1);
    }
  }

  for (const estrutura of ESTRUTURAS_CONHECIDAS) {
    if (Object.prototype.hasOwnProperty.call(valor, estrutura)) {
      coletarDeValor(valor[estrutura], `${origem}.${estrutura}`, "payload", 70, candidatos, visitados, profundidade + 1);
    }
  }

  if (valor.jsonLd && Object.prototype.hasOwnProperty.call(valor.jsonLd, "image")) {
    coletarDeValor(valor.jsonLd.image, `${origem}.jsonLd.image`, "payload", 70, candidatos, visitados, profundidade + 1);
  }

  for (const container of CONTAINERS_BRUTOS) {
    if (Object.prototype.hasOwnProperty.call(valor, container)) {
      coletarDoContainerBruto(valor[container], `${origem}.${container}`, candidatos, visitados, profundidade + 1);
    }
  }
}

function coletarCamposImagemConhecidos(valor, origem, candidatos, visitados, profundidade = 0) {
  if (valor == null || profundidade > MAX_PROFUNDIDADE) return;
  if (typeof valor === "string" || Array.isArray(valor)) {
    coletarDeValor(valor, origem, "payload", 70, candidatos, visitados, profundidade);
    return;
  }
  if (typeof valor !== "object") return;
  if (visitados.has(valor)) return;
  visitados.add(valor);

  for (const alias of ["imagemUrl", "imagem", ...ALIASES_DIRETOS]) {
    if (Object.prototype.hasOwnProperty.call(valor, alias)) {
      coletarDeValor(valor[alias], `${origem}.${alias}`, "payload", 70, candidatos, visitados, profundidade + 1);
    }
  }

  for (const estrutura of ESTRUTURAS_CONHECIDAS) {
    if (Object.prototype.hasOwnProperty.call(valor, estrutura)) {
      coletarDeValor(valor[estrutura], `${origem}.${estrutura}`, "payload", 70, candidatos, visitados, profundidade + 1);
    }
  }

  if (valor.jsonLd && Object.prototype.hasOwnProperty.call(valor.jsonLd, "image")) {
    coletarDeValor(valor.jsonLd.image, `${origem}.jsonLd.image`, "payload", 70, candidatos, visitados, profundidade + 1);
  }
}

function coletarDoContextoConhecido(valor, origem, candidatos, visitados, profundidade = 0) {
  if (valor == null || profundidade > MAX_PROFUNDIDADE) return;
  if (typeof valor !== "object") return;
  if (visitados.has(valor)) return;
  visitados.add(valor);

  coletarCamposImagemConhecidos(valor, origem, candidatos, visitados, profundidade);

  if (valor.metadata && typeof valor.metadata === "object") {
    coletarCamposImagemConhecidos(valor.metadata, `${origem}.metadata`, candidatos, visitados, profundidade + 1);
    if (valor.metadata.produto && typeof valor.metadata.produto === "object") {
      coletarCamposImagemConhecidos(valor.metadata.produto, `${origem}.metadata.produto`, candidatos, visitados, profundidade + 2);
    }
    if (valor.metadata.importacao && typeof valor.metadata.importacao === "object") {
      coletarCamposImagemConhecidos(valor.metadata.importacao, `${origem}.metadata.importacao`, candidatos, visitados, profundidade + 2);
    }
  }

  for (const container of ["metadataEvento", "evento_metadata", "job_metadata", "link_metadata"]) {
    if (valor[container] && typeof valor[container] === "object") {
      coletarCamposImagemConhecidos(valor[container], `${origem}.${container}`, candidatos, visitados, profundidade + 1);
    }
  }
}


function coletarCandidatos(oferta, contexto = {}) {
  const candidatos = [];
  const visitados = new WeakSet();

  if (Object.prototype.hasOwnProperty.call(oferta, "imagemUrl")) {
    coletarDeValor(oferta.imagemUrl, "imagemUrl", "oficial", 100, candidatos, visitados);
  }
  if (Object.prototype.hasOwnProperty.call(oferta, "imagem")) {
    coletarDeValor(oferta.imagem, "imagem", "oficial", 100, candidatos, visitados);
  }

  for (const alias of ALIASES_DIRETOS) {
    if (Object.prototype.hasOwnProperty.call(oferta, alias)) {
      coletarDeValor(oferta[alias], alias, "alias", 90, candidatos, visitados);
    }
  }

  for (const estrutura of ESTRUTURAS_CONHECIDAS) {
    if (Object.prototype.hasOwnProperty.call(oferta, estrutura)) {
      coletarDeValor(oferta[estrutura], estrutura, "estrutura", 80, candidatos, visitados);
    }
  }

  if (oferta.jsonLd && Object.prototype.hasOwnProperty.call(oferta.jsonLd, "image")) {
    coletarDeValor(oferta.jsonLd.image, "jsonLd.image", "estrutura", 80, candidatos, visitados);
  }

  for (const container of CONTAINERS_BRUTOS) {
    if (Object.prototype.hasOwnProperty.call(oferta, container)) {
      coletarDoContainerBruto(oferta[container], container, candidatos, visitados);
    }
  }

  const fontesContexto = [
    ["contexto.ofertaEntrada", contexto.ofertaEntrada],
    ["contexto.evento", contexto.evento],
    ["contexto.link", contexto.link],
    ["contexto.job", contexto.job],
  ];

  for (const [origem, valor] of fontesContexto) {
    if (valor) coletarDoContextoConhecido(valor, origem, candidatos, visitados);
  }

  return candidatos;
}

function statusParaCamada(camada) {
  if (camada === "oficial") return "preservada";
  if (camada === "payload") return "resolvida_payload_bruto";
  return "resolvida_alias";
}

function resolverImagemUniversal(ofertaEntrada = {}, contexto = {}) {
  const ofertaOriginal = ofertaEntrada && typeof ofertaEntrada === "object" ? ofertaEntrada : {};
  const oferta = { ...ofertaOriginal };

  if (oferta.imagemStatus && imagemUrlValidaUniversal(oferta.imagemUrl).ok) {
    const validacao = imagemUrlValidaUniversal(oferta.imagemUrl);
    return {
      ...oferta,
      imagem: validacao.url,
      imagemUrl: validacao.url,
      imagemOrigem: oferta.imagemOrigem || "imagemUrl",
      imagemConfianca: typeof oferta.imagemConfianca === "number" ? oferta.imagemConfianca : 100,
      imagemResolvidaEm: oferta.imagemResolvidaEm || new Date().toISOString(),
      imagemTentativas: Array.isArray(oferta.imagemTentativas) ? oferta.imagemTentativas.slice(0, MAX_TENTATIVAS) : [],
    };
  }

  const tentativas = [];
  const candidatos = coletarCandidatos(oferta, contexto);
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

    registrarTentativa(tentativas, item.origem, "selecionada", "", item.confianca);
    return {
      ...oferta,
      imagem: validacao.url,
      imagemUrl: validacao.url,
      imagemStatus: statusParaCamada(item.camada),
      imagemOrigem: item.origem,
      imagemConfianca: item.confianca,
      imagemResolvidaEm: new Date().toISOString(),
      imagemTentativas: tentativas,
    };
  }

  return {
    ...oferta,
    imagem: "",
    imagemUrl: "",
    imagemStatus: "nao_resolvida",
    imagemOrigem: oferta.imagemOrigem || "nenhuma",
    imagemConfianca: 0,
    imagemResolvidaEm: oferta.imagemResolvidaEm || new Date().toISOString(),
    imagemTentativas: tentativas,
  };
}

module.exports = {
  resolverImagemUniversal,
  imagemUrlValidaUniversal,
};
