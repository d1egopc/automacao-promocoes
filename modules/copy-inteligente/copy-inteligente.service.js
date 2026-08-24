const crypto = require("crypto");
const { BANCO_FRASES_V1 } = require("./banco-frases.v1");
const { resolverIntencaoCopy, normalizarSinaisCopy, texto } = require("./resolver-intencao");
const {
  TTL_PADRAO_MS,
  lerCacheCopy,
  salvarCacheCopy,
  fraseImediatamenteAnterior,
  registrarFrase,
  tamanhoCacheCopyInteligente
} = require("./cache");

const MAX_CARACTERES = 64;
const MAX_PALAVRAS = 10;
const MIN_PALAVRAS = 2;

function hashCurto(valor = "") {
  return crypto.createHash("sha1").update(String(valor || "")).digest("hex").slice(0, 16);
}

function planoPermiteTituloIa(plano = {}) {
  return plano?.recursos?.tituloIa === true;
}

function ofertaIdCopy(oferta = {}) {
  return texto(oferta.engineOfertaId || oferta.ofertaId || oferta.id || oferta.jobId || "");
}

function valorComercialSanitizado(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return "";
  try {
    const url = new URL(bruto);
    return `${url.hostname}${url.pathname}`.slice(0, 240);
  } catch (_) {
    return bruto
      .replace(/[?#].*$/, "")
      .replace(/\s+/g, " ")
      .slice(0, 120);
  }
}

function primeiroValorComercial(oferta = {}, campos = []) {
  for (const campo of campos) {
    const direto = texto(oferta[campo]);
    if (direto) return direto;
  }
  return "";
}

function primeiroLinkResgate(oferta = {}) {
  const direto = primeiroValorComercial(oferta, ["linkResgate"]);
  if (direto) return direto;

  for (const lista of [oferta.linksResgate, oferta.linksComerciais]) {
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      if (!item || typeof item !== "object") continue;
      const tipo = texto([item.tipo, item.papel, item.role].filter(Boolean).join(" ")).toLowerCase();
      if (lista === oferta.linksComerciais && !tipo.includes("resgate")) continue;
      const link = primeiroValorComercial(item, ["afiliado", "resolvido", "original", "url"]);
      if (link) return link;
    }
  }

  return "";
}

function precoComercial(oferta = {}) {
  return texto(oferta.precoAtual ?? oferta.preco ?? oferta.precoPor ?? "");
}

function hashSinaisComerciais(oferta = {}, sinais = normalizarSinaisCopy(oferta)) {
  const base = {
    cupomCodigo: primeiroValorComercial(oferta, ["cupom", "cupomCodigo", "codigoCupom", "cupomTexto"]),
    linkResgate: valorComercialSanitizado(primeiroLinkResgate(oferta)),
    desconto: primeiroValorComercial(oferta, ["descontoPercentual", "desconto", "economia", "economiaValor", "valorEconomia"]),
    freteGratis: sinais.freteGratis === true,
    beneficio: primeiroValorComercial(oferta, ["beneficioExtra", "beneficioTexto", "beneficioDetectado"]),
    parcelamento: primeiroValorComercial(oferta, ["parcelamento"]),
    sazonal: primeiroValorComercial(oferta, ["sazonalidade", "eventoSazonal", "campanhaSazonal", "validade"]),
    flags: {
      cupom: sinais.cupom === true,
      resgate: sinais.resgate === true,
      desconto: sinais.desconto === true,
      beneficio: sinais.beneficio === true
    }
  };
  return hashCurto(JSON.stringify(base));
}

function identidadeOfertaCopy(oferta = {}, sinais = normalizarSinaisCopy(oferta)) {
  const id = ofertaIdCopy(oferta);
  if (id) {
    return {
      cacheavel: true,
      tipo: "id",
      valor: hashCurto(id)
    };
  }

  const tituloOriginal = texto(sinais.tituloOriginal);
  if (!tituloOriginal) {
    return {
      cacheavel: false,
      tipo: "sem_identidade",
      valor: ""
    };
  }

  const fingerprint = {
    marketplace: sinais.marketplace,
    tituloOriginal,
    categoria: sinais.categoria,
    preco: precoComercial(oferta),
    linkProduto: valorComercialSanitizado(primeiroValorComercial(oferta, ["linkAfiliado", "linkFinal", "link", "url"])),
    identificadorComercial: primeiroValorComercial(oferta, ["produtoId", "productId", "itemId", "sku", "asin", "mlb"]),
    sinaisHash: hashSinaisComerciais(oferta, sinais)
  };

  if (!fingerprint.linkProduto && !fingerprint.identificadorComercial) {
    return {
      cacheavel: false,
      tipo: "fingerprint_insuficiente",
      valor: ""
    };
  }

  return {
    cacheavel: true,
    tipo: "fingerprint",
    valor: hashCurto(JSON.stringify(fingerprint))
  };
}

function chaveSinais(clienteId = "admin", oferta = {}, sinais = normalizarSinaisCopy(oferta)) {
  const identidade = identidadeOfertaCopy(oferta, sinais);
  if (!identidade.cacheavel) return "";
  const base = {
    clienteId: texto(clienteId) || "admin",
    identidade: identidade.valor,
    identidadeTipo: identidade.tipo,
    tituloOriginal: sinais.tituloOriginal,
    categoria: sinais.categoria,
    marketplace: sinais.marketplace,
    cupom: sinais.cupom,
    resgate: sinais.resgate,
    desconto: sinais.desconto,
    beneficio: sinais.beneficio,
    freteGratis: sinais.freteGratis,
    parcelamento: sinais.parcelamento,
    sazonal: sinais.sazonal,
    sinaisHash: hashSinaisComerciais(oferta, sinais)
  };
  return hashCurto(JSON.stringify(base));
}

function requisitoAtendido(requisito = "", sinais = {}) {
  const req = texto(requisito);
  if (!req) return true;
  return sinais[req] === true;
}

function requisitosAtendidos(frase = {}, sinais = {}) {
  const requisitos = Array.isArray(frase.exige) ? frase.exige : [];
  return requisitos.every(req => requisitoAtendido(req, sinais));
}

function tamanhoValido(frase = "") {
  const out = texto(frase);
  if (!out || out.length > MAX_CARACTERES) return false;
  const palavras = out.split(/\s+/).filter(Boolean);
  return palavras.length >= MIN_PALAVRAS && palavras.length <= MAX_PALAVRAS;
}

function fraseAfirmaSemProva(frase = "", sinais = {}) {
  const normalizada = texto(frase)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/\b(?:ultimas unidades|vai acabar|estoque|menor preco|melhor preco)\b/.test(normalizada)) return true;
  if (/\bfrete gratis\b/.test(normalizada) && sinais.freteGratis !== true) return true;
  if (/\bcupom\b/.test(normalizada) && sinais.cupom !== true) return true;
  if (/\b(?:desconto|economia|off)\b|(?:\d+\s*%)/.test(normalizada) && sinais.desconto !== true) return true;
  if (/\bcashback\b/.test(normalizada) && sinais.beneficio !== true) return true;
  if (/\bparcel(?:a|amento|ado)\b/.test(normalizada) && sinais.parcelamento !== true) return true;
  if (/\b(?:beneficio exclusivo|beneficio extra|resgate)\b/.test(normalizada) && sinais.resgate !== true && sinais.beneficio !== true) return true;
  if (/\b(?:corre|urgente|so hoje|por pouco tempo)\b/.test(normalizada)) return true;
  return false;
}

function fraseSegura(frase = {}, sinais = {}) {
  const textoFrase = texto(frase.texto);
  return Boolean(
    textoFrase &&
    tamanhoValido(textoFrase) &&
    requisitosAtendidos(frase, sinais) &&
    !fraseAfirmaSemProva(textoFrase, sinais)
  );
}

function escolherFrase({ intencao = "oportunidade", sinais = {}, chaveOferta = "", clienteId = "admin" } = {}) {
  const frases = (BANCO_FRASES_V1[intencao] || []).filter(frase => fraseSegura(frase, sinais));
  const candidatas = frases.length ? frases : (BANCO_FRASES_V1.oportunidade || []).filter(frase => fraseSegura(frase, sinais));
  if (!candidatas.length) return null;

  const hash = parseInt(hashCurto(`${chaveOferta}:${intencao}`).slice(0, 8), 16);
  const historicoKey = `${texto(clienteId) || "admin"}:${intencao}`;
  let indice = hash % candidatas.length;
  const anterior = fraseImediatamenteAnterior(historicoKey);

  if (candidatas.length > 1 && candidatas[indice]?.texto === anterior) {
    indice = (indice + 1) % candidatas.length;
  }

  const escolhida = candidatas[indice] || null;
  if (escolhida) registrarFrase(historicoKey, escolhida.texto);
  return escolhida;
}

function logCopy(evento = "", payload = {}) {
  try {
    console.log(`[${String(evento || "").toUpperCase()}]`, JSON.stringify({
      ofertaId: texto(payload.ofertaId).slice(0, 80),
      intencao: texto(payload.intencao).slice(0, 40),
      fonte: texto(payload.fonte).slice(0, 40),
      motivoFallback: texto(payload.motivoFallback || payload.motivo).slice(0, 80),
      cacheHit: payload.cacheHit === true
    }));
  } catch (_) {
    // Observabilidade de copy nunca pode interferir no envio.
  }
}

function fallback(motivo = "fallback_original", extra = {}) {
  if (extra.log !== false) {
    logCopy("copy_inteligente_fallback_original", {
      ...extra,
      motivoFallback: motivo
    });
  }
  return {
    ok: false,
    tituloIa: "",
    intencao: "",
    fonte: "fallback_original",
    motivoFallback: motivo,
    cacheHit: false
  };
}

function resolverCopyInteligente({ oferta = {}, destino = {}, clienteId = "admin", plano = {}, ttlMs = TTL_PADRAO_MS } = {}) {
  try {
    if (String(destino?.tituloOferta || "").trim().toLowerCase() !== "ia") {
      return fallback("destino_original", { log: false });
    }
    if (!planoPermiteTituloIa(plano)) {
      return fallback("feature_tituloIa_indisponivel", { clienteId, ofertaId: ofertaIdCopy(oferta) });
    }

    const resolucao = resolverIntencaoCopy(oferta);
    const sinais = resolucao.sinais || normalizarSinaisCopy(oferta);
    const chaveOferta = chaveSinais(clienteId, oferta, sinais);
    const cacheKey = chaveOferta ? `${texto(clienteId) || "admin"}:${chaveOferta}` : "";
    if (cacheKey) {
      const cached = lerCacheCopy(cacheKey);
      if (cached?.tituloIa && tamanhoValido(cached.tituloIa)) {
        logCopy("copy_inteligente_cache_hit", {
          ofertaId: ofertaIdCopy(oferta),
          intencao: cached.intencao,
          fonte: cached.fonte,
          cacheHit: true
        });
        return { ...cached, cacheHit: true };
      }
    }

    const frase = escolherFrase({
      intencao: resolucao.intencao,
      sinais,
      chaveOferta,
      clienteId
    });

    if (!frase) {
      return fallback("frase_segura_indisponivel", {
        clienteId,
        ofertaId: ofertaIdCopy(oferta),
        intencao: resolucao.intencao
      });
    }

    const resultado = {
      ok: true,
      tituloIa: frase.texto,
      intencao: resolucao.intencao,
      fonte: "banco_frases_v1",
      motivo: resolucao.motivo,
      cacheHit: false
    };
    if (cacheKey) salvarCacheCopy(cacheKey, resultado, ttlMs);
    logCopy("copy_inteligente_resolvida", {
      ofertaId: ofertaIdCopy(oferta),
      intencao: resultado.intencao,
      fonte: resultado.fonte,
      cacheHit: false
    });
    return resultado;
  } catch (erro) {
    return fallback("erro_motor_copy", {
      clienteId,
      ofertaId: ofertaIdCopy(oferta),
      motivo: erro?.message || "erro"
    });
  }
}

module.exports = {
  MAX_CARACTERES,
  MAX_PALAVRAS,
  MIN_PALAVRAS,
  hashCurto,
  planoPermiteTituloIa,
  ofertaIdCopy,
  valorComercialSanitizado,
  hashSinaisComerciais,
  identidadeOfertaCopy,
  chaveSinais,
  requisitoAtendido,
  fraseAfirmaSemProva,
  fraseSegura,
  escolherFrase,
  tamanhoCacheCopyInteligente,
  resolverCopyInteligente
};
