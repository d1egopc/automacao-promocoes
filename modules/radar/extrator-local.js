const RADAR_EXTRATOR_LOCAL_MODO = "observacao";
const VERSAO_EXTRATOR_LOCAL = "radar_extrator_local_v1";

const CONFIANCA = {
  ALTA: "alta",
  MEDIA: "media",
  BAIXA: "baixa",
  AUSENTE: "ausente"
};

const LIMITES_EXTRATOR_LOCAL = {
  TEXTO_MAX: 6000,
  LINKS_MAX: 20,
  PRECOS_MAX: 30,
  AMBIGUIDADES_MAX: 10,
  AVISOS_MAX: 10,
  EVIDENCIA_MAX: 80
};

const PADRAO_VALOR_BR = "\\d{1,3}(?:\\.\\d{3})*(?:,\\d{2})?|\\d+(?:,\\d{2})?";

const GENERICOS_TITULO = [
  "corre",
  "oferta",
  "oferta imperdivel",
  "promocao",
  "menor preco",
  "aproveite",
  "ultimas unidades",
  "imperdivel",
  "link",
  "cupom"
];

function campo(valor = null, confianca = CONFIANCA.AUSENTE, evidencia = null, extras = {}) {
  return {
    valor,
    confianca,
    evidencia: limitarEvidencia(evidencia),
    ...extras
  };
}

function limitarEvidencia(evidencia = null) {
  if (evidencia == null) return null;
  return String(evidencia).slice(0, LIMITES_EXTRATOR_LOCAL.EVIDENCIA_MAX);
}

function adicionarLimitado(lista = [], item = null, limite = LIMITES_EXTRATOR_LOCAL.AVISOS_MAX) {
  if (!item || lista.length >= limite) return;
  lista.push(item);
}

function normalizarTexto(texto = "") {
  return String(texto || "")
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "\n");
}

function textoSemAcentos(texto = "") {
  return normalizarTexto(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarPrecoBrasileiro(valor = "") {
  const bruto = String(valor || "").trim();
  if (!bruto) return null;
  if (/^-/.test(bruto)) return null;

  const limpo = bruto.replace(/[^\d.,]/g, "");
  if (!limpo || !/\d/.test(limpo)) return null;

  let normalizado = limpo;
  const temVirgula = normalizado.includes(",");
  const temPonto = normalizado.includes(".");

  if (temVirgula) {
    normalizado = normalizado.replace(/\./g, "").replace(",", ".");
  } else if (temPonto) {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(normalizado)) {
      normalizado = normalizado.replace(/\./g, "");
    } else {
      const partes = normalizado.split(".");
      if (partes.length > 2) {
        const centavos = partes.pop();
        normalizado = `${partes.join("")}.${centavos}`;
      }
    }
  }

  const numero = Number(normalizado);
  if (!Number.isFinite(numero) || numero <= 0 || numero > 1000000) return null;
  return Math.round(numero * 100) / 100;
}

function detectarShortlink(link = "") {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
    return [
      "meli.la",
      "amzn.to",
      "s.shopee.com.br",
      "a.aliexpress.com",
      "bit.ly",
      "tinyurl.com"
    ].includes(host);
  } catch {
    return false;
  }
}

function criarBase({ texto, links, marketplaceDetectado, origemTipo, grupoId, grupoNome, capturadaEm, metadadosMidia }) {
  const linksNormalizados = Array.isArray(links)
    ? links.map(link => String(link || "").trim()).filter(Boolean).slice(0, LIMITES_EXTRATOR_LOCAL.LINKS_MAX)
    : [];
  return {
    versao: VERSAO_EXTRATOR_LOCAL,
    modo: RADAR_EXTRATOR_LOCAL_MODO,
    links: linksNormalizados,
    marketplace: campo(marketplaceDetectado || null, marketplaceDetectado ? CONFIANCA.ALTA : CONFIANCA.AUSENTE, marketplaceDetectado || null),
    titulo: campo(null),
    precoAtual: campo(null, CONFIANCA.AUSENTE, null, { tipo: "desconhecido" }),
    precoAnterior: campo(null),
    parcelamento: {
      quantidade: null,
      valorParcela: null,
      confianca: CONFIANCA.AUSENTE
    },
    cupom: {
      codigo: null,
      beneficioTexto: null,
      valor: null,
      percentual: null,
      confianca: CONFIANCA.AUSENTE,
      evidencia: null
    },
    desconto: {
      percentual: null,
      valorEconomia: null,
      confianca: CONFIANCA.AUSENTE
    },
    validade: {
      valorTexto: null,
      confianca: CONFIANCA.AUSENTE
    },
    imagemMensagem: {
      presente: Boolean(metadadosMidia?.imagemPresente || metadadosMidia?.hasImage || metadadosMidia?.imagem),
      referenciaInterna: metadadosMidia?.referenciaInterna || null,
      confianca: (metadadosMidia?.imagemPresente || metadadosMidia?.hasImage || metadadosMidia?.imagem) ? CONFIANCA.ALTA : CONFIANCA.AUSENTE
    },
    origem: {
      tipo: origemTipo || null,
      grupoId: grupoId || null,
      grupoNome: grupoNome || null,
      capturadaEm: capturadaEm || null
    },
    ambiguidades: [],
    avisos: []
  };
}

function extrairLinhasCandidatasTitulo(texto = "", links = []) {
  const linksSet = new Set(links);
  return normalizarTexto(texto)
    .split("\n")
    .map(linha => linha.trim())
    .filter(Boolean)
    .filter(linha => !linksSet.has(linha))
    .filter(linha => !/(?:https?:\/\/|www\.)/i.test(linha))
    .filter(linha => !/(?:^|\s)(?:r\$|\d+[,.]\d{2}|\d+\s*x\s*de|cupom|codigo|c[oó]digo|frete|economize|desconto|pix|cart[aã]o|boleto)(?:\s|:|$)/i.test(linha))
    .filter(linha => !/^(?:use|aplique|resgate|compre|garanta|corre|aproveite)\b/i.test(linha))
    .filter(linha => !/^[@#]/.test(linha));
}

function extrairTitulo(texto = "", links = []) {
  const linhas = extrairLinhasCandidatasTitulo(texto, links);
  for (const linha of linhas) {
    const normalizada = textoSemAcentos(linha).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalizada || GENERICOS_TITULO.includes(normalizada)) continue;
    if (normalizada.length < 8 || normalizada.split(/\s+/).length < 2) continue;
    return campo(linha.slice(0, 180), CONFIANCA.MEDIA, linha.slice(0, 80));
  }
  return campo(null);
}

function coletarValoresMoeda(texto = "") {
  const fonte = normalizarTexto(texto);
  const regex = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?!\s*%)|(?:r\$\s*)(\d{1,3}(?:\.\d{3})+|\d{2,6})(?![\d.,%])/gi;
  const valores = [];
  let limitado = false;
  let match;
  while ((match = regex.exec(fonte))) {
    if (valores.length >= LIMITES_EXTRATOR_LOCAL.PRECOS_MAX) {
      limitado = true;
      break;
    }
    const evidencia = match[0];
    const valorCapturado = match[1] || match[2];
    const inicio = Math.max(0, match.index - 28);
    const fim = Math.min(fonte.length, match.index + evidencia.length + 28);
    const linhaInicio = fonte.lastIndexOf("\n", match.index) + 1;
    const proximaQuebra = fonte.indexOf("\n", match.index);
    const linhaFim = proximaQuebra === -1 ? fonte.length : proximaQuebra;
    valores.push({
      valor: normalizarPrecoBrasileiro(valorCapturado),
      evidencia: limitarEvidencia(evidencia),
      contexto: fonte.slice(inicio, fim),
      linha: fonte.slice(linhaInicio, linhaFim)
    });
  }
  const filtrados = valores.filter(item => item.valor != null);
  filtrados.limitado = limitado;
  return filtrados;
}

function extrairParcelamento(texto = "") {
  const match = normalizarTexto(texto).match(/\b(\d{1,2})\s*x\s*(?:de\s*)?(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i);
  if (!match) {
    return {
      quantidade: null,
      valorParcela: null,
      confianca: CONFIANCA.AUSENTE
    };
  }
  return {
    quantidade: Number(match[1]),
    valorParcela: normalizarPrecoBrasileiro(match[2]),
    confianca: CONFIANCA.ALTA
  };
}

function extrairPrecos(texto = "") {
  const fonte = normalizarTexto(texto);
  const valorBr = PADRAO_VALOR_BR;
  const resultado = {
    precoAtual: campo(null, CONFIANCA.AUSENTE, null, { tipo: "desconhecido" }),
    precoAnterior: campo(null),
    desconto: {
      percentual: null,
      valorEconomia: null,
      confianca: CONFIANCA.AUSENTE
    },
    ambiguidades: []
  };

  const dePor = fonte.match(new RegExp(`\\b(?:de|era)\\s*(?:r\\$\\s*)?(${valorBr})\\s*(?:por|agora)\\s*(?:r\\$\\s*)?(${valorBr})`, "i"));
  if (dePor) {
    const anterior = normalizarPrecoBrasileiro(dePor[1]);
    const atual = normalizarPrecoBrasileiro(dePor[2]);
    resultado.precoAnterior = campo(anterior, anterior ? CONFIANCA.ALTA : CONFIANCA.AUSENTE, dePor[1]);
    resultado.precoAtual = campo(atual, atual ? CONFIANCA.ALTA : CONFIANCA.AUSENTE, dePor[2], { tipo: "final" });
    if (anterior && atual && anterior > atual) {
      resultado.desconto = {
        percentual: Math.round(((anterior - atual) / anterior) * 100),
        valorEconomia: Math.round((anterior - atual) * 100) / 100,
        confianca: CONFIANCA.ALTA
      };
    }
    return resultado;
  }

  const pix = fonte.match(new RegExp(`(?:r\\$\\s*)?(${valorBr})\\s*(?:no\\s*)?pix\\b|\\b(?:no\\s*)?pix\\s*(?:r\\$\\s*)(${valorBr})`, "i"));
  if (pix) {
    resultado.precoAtual = campo(normalizarPrecoBrasileiro(pix[1] || pix[2]), CONFIANCA.ALTA, pix[0], { tipo: "pix" });
  }

  const cartao = fonte.match(new RegExp(`(?:r\\$\\s*)?(${valorBr})\\s*(?:no\\s*)?cart[aã]o\\b|\\b(?:no\\s*)?cart[aã]o\\s*(?:r\\$\\s*)(${valorBr})`, "i"));
  if (!resultado.precoAtual.valor && cartao) {
    resultado.precoAtual = campo(normalizarPrecoBrasileiro(cartao[1] || cartao[2]), CONFIANCA.ALTA, cartao[0], { tipo: "cartao" });
  }

  const precoMarcado = fonte.match(new RegExp(`\\b(?:por|agora|preco|preço)\\s*:?\\s*(?:r\\$\\s*)(${valorBr})`, "i"));
  if (!resultado.precoAtual.valor && precoMarcado) {
    resultado.precoAtual = campo(normalizarPrecoBrasileiro(precoMarcado[1]), CONFIANCA.ALTA, precoMarcado[0], { tipo: "final" });
  }

  const valores = coletarValoresMoeda(fonte);
  if (valores.limitado) {
    resultado.ambiguidades.push({
      tipo: "limite_precos_atingido",
      limite: LIMITES_EXTRATOR_LOCAL.PRECOS_MAX
    });
  }
  const valoresNaoParcelas = valores.filter(item => !/\d{1,2}\s*x\s*(?:de\s*)?(?:r\$\s*)?$/i.test(item.linha.slice(0, Math.max(0, item.linha.indexOf(item.evidencia)))));
  const valoresProduto = valoresNaoParcelas.filter(item => !/\b(?:cupom|economize|economia|frete|acima\s+de|valor\s+minimo|valor\s+m[ií]nimo)\b/i.test(item.linha));

  if (!resultado.precoAtual.valor && valoresProduto.length === 1) {
    resultado.precoAtual = campo(valoresProduto[0].valor, CONFIANCA.MEDIA, valoresProduto[0].evidencia, { tipo: "desconhecido" });
  } else if (!resultado.precoAtual.valor && valoresProduto.length > 1) {
    adicionarLimitado(resultado.ambiguidades, {
      tipo: "multiplos_precos_sem_marcador",
      quantidade: valoresProduto.length
    }, LIMITES_EXTRATOR_LOCAL.AMBIGUIDADES_MAX);
    resultado.precoAtual = campo(null, CONFIANCA.BAIXA, null, { tipo: "desconhecido" });
  }

  const economia = fonte.match(/\b(?:economize|economia)\s*(?:de\s*)?(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+)/i);
  if (economia) {
    resultado.desconto.valorEconomia = normalizarPrecoBrasileiro(economia[1]);
    resultado.desconto.confianca = CONFIANCA.MEDIA;
  }

  resultado.ambiguidades = resultado.ambiguidades.slice(0, LIMITES_EXTRATOR_LOCAL.AMBIGUIDADES_MAX);
  return resultado;
}

function extrairCupom(texto = "", radarCupomMensagem = {}) {
  const fonte = normalizarTexto(texto);
  const cupomCodigo = typeof radarCupomMensagem.extrairCupomTextoRadar === "function"
    ? radarCupomMensagem.extrairCupomTextoRadar(fonte)
    : "";
  const beneficioValor = fonte.match(/\bcupom\s+de\s*(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+)(?:\s|$)/i);
  const percentual = fonte.match(/\b(?:ganhe|cupom|desconto)\s+(\d{1,2})%/i);
  const cupomProvavel = /\b(?:tem\s+cupom|cupom\s+dispon[ií]vel|desconto\s+no\s+carrinho|aplique\s+o\s+cupom\s+da\s+p[aá]gina)\b/i.test(fonte);

  if (cupomCodigo && !cupomProvavel && !["DISPONIVEL", "DISPONIVELNO", "CARRINHO"].includes(cupomCodigo)) {
    return {
      codigo: cupomCodigo,
      beneficioTexto: null,
      valor: beneficioValor ? normalizarPrecoBrasileiro(beneficioValor[1]) : null,
      percentual: percentual ? Number(percentual[1]) : null,
      confianca: CONFIANCA.ALTA,
      evidencia: cupomCodigo
    };
  }

  if (beneficioValor || percentual) {
    return {
      codigo: null,
      beneficioTexto: beneficioValor ? beneficioValor[0].trim() : percentual[0].trim(),
      valor: beneficioValor ? normalizarPrecoBrasileiro(beneficioValor[1]) : null,
      percentual: percentual ? Number(percentual[1]) : null,
      confianca: CONFIANCA.MEDIA,
      evidencia: beneficioValor ? beneficioValor[0].trim() : percentual[0].trim()
    };
  }

  if (cupomProvavel) {
    return {
      codigo: null,
      beneficioTexto: "cupom provavel",
      valor: null,
      percentual: null,
      confianca: CONFIANCA.BAIXA,
      evidencia: "cupom provavel"
    };
  }

  return {
    codigo: null,
    beneficioTexto: null,
    valor: null,
    percentual: null,
    confianca: CONFIANCA.AUSENTE,
    evidencia: null
  };
}

function extrairValidade(texto = "") {
  const fonte = normalizarTexto(texto);
  const padroes = [
    /\bv[aá]lido\s+at[eé]\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/i,
    /\bsomente\s+hoje\b/i,
    /\bat[eé]\s+meia[-\s]?noite\b/i,
    /\benquanto\s+durarem\s+os\s+estoques\b/i
  ];
  for (const padrao of padroes) {
    const match = fonte.match(padrao);
    if (match) {
      return {
        valorTexto: match[0],
        confianca: CONFIANCA.MEDIA
      };
    }
  }
  return {
    valorTexto: null,
    confianca: CONFIANCA.AUSENTE
  };
}

function extrairEvidenciasRadarLocal(entrada = {}, deps = {}) {
  const {
    textoOriginal = "",
    links = [],
    marketplaceDetectado = "",
    origemTipo = "",
    grupoId = "",
    grupoNome = "",
    capturadaEm = null,
    metadadosMidia = null
  } = entrada;
  const textoCompleto = normalizarTexto(textoOriginal);
  const texto = textoCompleto.slice(0, LIMITES_EXTRATOR_LOCAL.TEXTO_MAX);
  const resultado = criarBase({
    texto,
    links,
    marketplaceDetectado,
    origemTipo,
    grupoId,
    grupoNome,
    capturadaEm,
    metadadosMidia
  });

  if (textoCompleto.length > texto.length) {
    adicionarLimitado(resultado.avisos, {
      tipo: "texto_limitado",
      limite: LIMITES_EXTRATOR_LOCAL.TEXTO_MAX
    }, LIMITES_EXTRATOR_LOCAL.AVISOS_MAX);
  }

  if (Array.isArray(links) && links.length > resultado.links.length) {
    adicionarLimitado(resultado.avisos, {
      tipo: "links_limitados",
      limite: LIMITES_EXTRATOR_LOCAL.LINKS_MAX
    }, LIMITES_EXTRATOR_LOCAL.AVISOS_MAX);
  }

  if (resultado.links.some(detectarShortlink) && !marketplaceDetectado) {
    resultado.marketplace.confianca = CONFIANCA.BAIXA;
    adicionarLimitado(resultado.avisos, { tipo: "shortlink_sem_resolucao" }, LIMITES_EXTRATOR_LOCAL.AVISOS_MAX);
  }

  resultado.titulo = extrairTitulo(texto, resultado.links);
  const precos = extrairPrecos(texto);
  resultado.precoAtual = precos.precoAtual;
  resultado.precoAnterior = precos.precoAnterior;
  resultado.desconto = precos.desconto;
  for (const ambiguidade of precos.ambiguidades) {
    adicionarLimitado(resultado.ambiguidades, ambiguidade, LIMITES_EXTRATOR_LOCAL.AMBIGUIDADES_MAX);
  }
  resultado.parcelamento = extrairParcelamento(texto);
  resultado.cupom = extrairCupom(texto, deps.radarCupomMensagem);
  resultado.validade = extrairValidade(texto);

  return resultado;
}

function resumirExtratorLocalParaLog(extracao = {}, duracaoMs = 0) {
  return {
    versao: extracao.versao || VERSAO_EXTRATOR_LOCAL,
    origemTipo: extracao.origem?.tipo || "",
    marketplaceDetectado: extracao.marketplace?.valor || "",
    quantidadeLinks: Array.isArray(extracao.links) ? extracao.links.length : 0,
    tituloEncontrado: Boolean(extracao.titulo?.valor),
    tituloConfianca: extracao.titulo?.confianca || CONFIANCA.AUSENTE,
    precoAtualEncontrado: Boolean(extracao.precoAtual?.valor),
    precoAtualConfianca: extracao.precoAtual?.confianca || CONFIANCA.AUSENTE,
    precoAtualTipo: extracao.precoAtual?.tipo || "desconhecido",
    precoAnteriorEncontrado: Boolean(extracao.precoAnterior?.valor),
    precoAnteriorConfianca: extracao.precoAnterior?.confianca || CONFIANCA.AUSENTE,
    cupomCodigoEncontrado: Boolean(extracao.cupom?.codigo),
    cupomConfianca: extracao.cupom?.confianca || CONFIANCA.AUSENTE,
    validadeEncontrada: Boolean(extracao.validade?.valorTexto),
    imagemMensagemPresente: Boolean(extracao.imagemMensagem?.presente),
    quantidadeAmbiguidades: Array.isArray(extracao.ambiguidades) ? extracao.ambiguidades.length : 0,
    duracaoMs
  };
}

function normalizarNumeroComparacao(valor) {
  const numero = typeof valor === "number" ? valor : normalizarPrecoBrasileiro(valor);
  return Number.isFinite(numero) ? numero : null;
}

function gerarComparacaoPassivaRadarLocal(extracao = {}, oferta = {}) {
  const precoImportador = normalizarNumeroComparacao(
    oferta.precoAtual ?? oferta.preco ?? oferta.valor ?? null
  );
  const precoAnteriorImportador = normalizarNumeroComparacao(
    oferta.precoOriginal ?? oferta.precoAnterior ?? oferta.precoDe ?? null
  );
  const precoLocal = normalizarNumeroComparacao(extracao.precoAtual?.valor);
  const precoAnteriorLocal = normalizarNumeroComparacao(extracao.precoAnterior?.valor);
  const tituloImportadorExiste = Boolean(oferta.titulo || oferta.nome);
  const cupomImportadorExiste = Boolean(oferta.cupom || oferta.codigoCupom);
  const imagemImportadorExiste = Boolean(oferta.imagem || oferta.image || oferta.imagemUrl || oferta.thumbnail);

  const camposPreencheriamVazio = [];
  if (extracao.titulo?.valor && !tituloImportadorExiste) camposPreencheriamVazio.push("titulo");
  if (precoLocal != null && precoImportador == null) camposPreencheriamVazio.push("precoAtual");
  if (precoAnteriorLocal != null && precoAnteriorImportador == null) camposPreencheriamVazio.push("precoAnterior");
  if (extracao.cupom?.codigo && !cupomImportadorExiste) camposPreencheriamVazio.push("cupom");
  if (extracao.imagemMensagem?.presente && !imagemImportadorExiste) camposPreencheriamVazio.push("imagem");

  const camposDivergentes = [];
  if (precoLocal != null && precoImportador != null && Math.abs(precoLocal - precoImportador) >= 0.01) camposDivergentes.push("precoAtual");
  if (precoAnteriorLocal != null && precoAnteriorImportador != null && Math.abs(precoAnteriorLocal - precoAnteriorImportador) >= 0.01) camposDivergentes.push("precoAnterior");
  if (extracao.cupom?.codigo && cupomImportadorExiste && extracao.cupom.codigo !== String(oferta.cupom || oferta.codigoCupom || "").toUpperCase()) camposDivergentes.push("cupom");

  return {
    versao: extracao.versao || VERSAO_EXTRATOR_LOCAL,
    marketplace: extracao.marketplace?.valor || oferta.marketplace || "",
    tituloLocalExiste: Boolean(extracao.titulo?.valor),
    tituloImportadorExiste,
    precoAtualLocal: precoLocal,
    precoAtualImportador: precoImportador,
    precoAnteriorLocal: precoAnteriorLocal,
    precoAnteriorImportador,
    cupomLocalExiste: Boolean(extracao.cupom?.codigo),
    cupomImportadorExiste,
    imagemMensagemPresente: Boolean(extracao.imagemMensagem?.presente),
    imagemImportadorExiste,
    camposPreencheriamVazio,
    camposDivergentes,
    confiancas: {
      titulo: extracao.titulo?.confianca || CONFIANCA.AUSENTE,
      precoAtual: extracao.precoAtual?.confianca || CONFIANCA.AUSENTE,
      precoAnterior: extracao.precoAnterior?.confianca || CONFIANCA.AUSENTE,
      cupom: extracao.cupom?.confianca || CONFIANCA.AUSENTE
    }
  };
}

module.exports = {
  RADAR_EXTRATOR_LOCAL_MODO,
  VERSAO_EXTRATOR_LOCAL,
  CONFIANCA,
  extrairEvidenciasRadarLocal,
  resumirExtratorLocalParaLog,
  gerarComparacaoPassivaRadarLocal,
  normalizarPrecoBrasileiro
};
