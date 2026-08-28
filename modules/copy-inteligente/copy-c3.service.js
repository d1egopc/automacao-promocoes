const { familiaDaCategoriaCopyV2 } = require("./familias-v2");

const FONTE_COPY_C3 = "copy_c3_factual";

const TERMOS_PROIBIDOS_COPY_C3 = [
  "menor preco",
  "melhor preco",
  "ultimas unidades",
  "ultima unidade",
  "imperdivel",
  "estoque acabando",
  "preco historico",
  "mais vendido",
  "mais potente",
  "vai acabar"
];

const FRASES_COPY_C3 = Object.freeze({
  beneficio: [
    { id: "c3_beneficio_001", texto: "Tem um detalhe extra confirmado nessa oferta." },
    { id: "c3_beneficio_002", texto: "Essa veio com um adicional que vale olhar com calma." },
    { id: "c3_beneficio_003", texto: "Nao era so o produto; tem um extra no meio." }
  ],
  resgate: [
    { id: "c3_resgate_001", texto: "Tem resgate confirmado nessa oferta." },
    { id: "c3_resgate_002", texto: "Antes de passar reto, vale ver o resgate dessa oferta." },
    { id: "c3_resgate_003", texto: "Essa trouxe um resgate para colocar na conta." }
  ],
  cupom: [
    { id: "c3_cupom_001", texto: "Tem cupom confirmado nessa oferta." },
    { id: "c3_cupom_002", texto: "O cupom entrou como detalhe extra por aqui." },
    { id: "c3_cupom_003", texto: "Quando tem cupom no meio, vale olhar duas vezes." }
  ],
  desconto_real: [
    { id: "c3_desconto_real_001", texto: "A diferenca entre os valores e real: {percentual}%." },
    { id: "c3_desconto_real_002", texto: "Aqui o De/Por confirma {economia} de diferenca." },
    { id: "c3_desconto_real_003", texto: "Esse desconto da para comprovar pelo preco anterior." }
  ],
  valor_efetivo: [
    { id: "c3_valor_efetivo_001", texto: "O valor efetivo ficou abaixo do preco exibido." },
    { id: "c3_valor_efetivo_002", texto: "Tem valor efetivo confirmado para considerar aqui." },
    { id: "c3_valor_efetivo_003", texto: "A conta final ficou diferente do preco de vitrine." }
  ],
  marca_preco: [
    { id: "c3_marca_preco_001", texto: "{marca} por {preco} chamou atencao por aqui." },
    { id: "c3_marca_preco_002", texto: "Para quem acompanha {marca}, esse valor merece uma olhada." },
    { id: "c3_marca_preco_003", texto: "{marca} apareceu com preco para comparar sem pressa." }
  ],
  categoria: [
    { id: "c3_categoria_001", texto: "Para quem estava olhando {categoria}, essa entrou no radar." },
    { id: "c3_categoria_002", texto: "Essa conversa bem com quem procura {categoria}." },
    { id: "c3_categoria_003", texto: "Dentro de {categoria}, essa merece alguns segundos." }
  ],
  preco: [
    { id: "c3_preco_001", texto: "Olha por quanto ficou: {preco}." },
    { id: "c3_preco_002", texto: "Esse valor chamou atencao por aqui: {preco}." },
    { id: "c3_preco_003", texto: "Para comparar antes de comprar, o preco esta aqui: {preco}." }
  ],
  fallback: [
    { id: "c3_fallback_001", texto: "Achado simples para olhar com calma." },
    { id: "c3_fallback_002", texto: "Essa oferta merece uma conferida sem exagero." },
    { id: "c3_fallback_003", texto: "Vale dar uma olhada nessa antes de seguir." }
  ]
});

function texto(valor = "") {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object" || typeof valor === "function") return "";
  const normalizado = String(valor).trim();
  if (!normalizado || ["undefined", "null", "nan"].includes(normalizado.toLowerCase())) return "";
  return normalizado;
}

function textoMinusculo(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function numero(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const bruto = texto(valor);
  if (!bruto) return null;
  const limpo = bruto
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const convertido = Number(limpo);
  return Number.isFinite(convertido) ? convertido : null;
}

function formatarMoedaCopyC3(valor) {
  const n = numero(valor);
  if (n === null) return "";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function hashEstavelCopyC3(valor = "") {
  const textoHash = String(valor || "");
  let hash = 2166136261;
  for (let i = 0; i < textoHash.length; i += 1) {
    hash ^= textoHash.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function contemTermoProibidoCopyC3(valor = "") {
  const normalizado = textoMinusculo(valor);
  return TERMOS_PROIBIDOS_COPY_C3.some(termo => normalizado.includes(termo));
}

function recursoCopyC3Ativo(plano = {}) {
  return plano?.recursos?.copyC3Factual === true;
}

function destinoIaAtivo(destino = {}) {
  return textoMinusculo(destino?.tituloOferta) === "ia";
}

function categoriaFinalCopyC3(oferta = {}) {
  const v2 = oferta.inteligenciaUniversalV2 && typeof oferta.inteligenciaUniversalV2 === "object"
    ? oferta.inteligenciaUniversalV2
    : {};
  return texto(v2.categoria) || texto(oferta.categoria) || texto(oferta.categoriaProduto);
}

function marcaConfiavelCopyC3(oferta = {}) {
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const produto = metadata.produto && typeof metadata.produto === "object" ? metadata.produto : {};
  return texto(produto.marca) || texto(oferta.marca);
}

function tituloFactualCopyC3(oferta = {}) {
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const autoridade = metadata.autoridadeFactual && typeof metadata.autoridadeFactual === "object"
    ? metadata.autoridadeFactual
    : {};
  const produto = metadata.produto && typeof metadata.produto === "object" ? metadata.produto : {};
  return texto(oferta.tituloFactual) ||
    texto(autoridade.tituloFactual) ||
    texto(autoridade.titulo) ||
    texto(produto.titulo);
}

function cupomConfirmadoCopyC3(oferta = {}) {
  const cupom = texto(oferta.cupom) || texto(oferta.codigoCupom) || texto(oferta.cupomCodigo);
  if (!cupom) return "";

  const normalizado = textoMinusculo(cupom);
  if (/\b(?:tem|ha)\s+cupom\b/.test(normalizado)) return "";
  if (/\bcupom\s+disponivel\b/.test(normalizado)) return "";
  if (/\bconsulte\s+(?:o\s+)?cupom\b/.test(normalizado)) return "";
  if (/\bsem\s+cupom\b/.test(normalizado)) return "";
  if (/\bate\s+\d+(?:[,.]\d+)?\s*%/.test(normalizado)) return "";

  return cupom;
}

function beneficioConfirmadoCopyC3(oferta = {}) {
  return "";
}

function resgateConfirmadoCopyC3(oferta = {}) {
  return "";
}

function valorEfetivoComprovadoCopyC3(oferta = {}) {
  const v2 = oferta.inteligenciaUniversalV2 && typeof oferta.inteligenciaUniversalV2 === "object"
    ? oferta.inteligenciaUniversalV2
    : {};
  const valorEfetivo = numero(v2.valorEfetivo ?? oferta.valorEfetivo);
  const precoAtual = numero(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
  const origem = textoMinusculo(v2.valorEfetivoOrigem || oferta.valorEfetivoOrigem);
  const comprovado = v2.valorEfetivoComprovado === true || oferta.valorEfetivoComprovado === true;
  if (valorEfetivo === null || precoAtual === null || valorEfetivo <= 0 || valorEfetivo >= precoAtual) return null;
  if (!comprovado) return null;
  if (!/^(cupom_|pix$|pix_|desconto_|preco_final_confirmado$|preco_pix_cupom$)/.test(origem)) return null;
  return valorEfetivo;
}

function descontoRealCopyC3(oferta = {}) {
  const precoAtual = numero(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
  const precoOriginal = numero(oferta.precoOriginal ?? oferta.precoAnterior ?? oferta.precoDe);
  if (precoAtual === null || precoOriginal === null || precoOriginal <= precoAtual || precoAtual <= 0) return null;
  const economia = precoOriginal - precoAtual;
  const percentual = Math.round((economia / precoOriginal) * 100);
  if (!Number.isFinite(percentual) || percentual <= 0) return null;
  return { precoAtual, precoOriginal, economia, percentual };
}

function extrairFatosCopyC3(oferta = {}) {
  const categoria = categoriaFinalCopyC3(oferta);
  const precoAtual = numero(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
  const tituloFactual = tituloFactualCopyC3(oferta);
  return {
    tituloFactual,
    categoria,
    familia: familiaDaCategoriaCopyV2(categoria),
    marketplace: texto(oferta.marketplace),
    precoAtual,
    precoFormatado: formatarMoedaCopyC3(precoAtual),
    precoOriginal: numero(oferta.precoOriginal ?? oferta.precoAnterior ?? oferta.precoDe),
    cupom: cupomConfirmadoCopyC3(oferta),
    beneficio: beneficioConfirmadoCopyC3(oferta),
    resgate: resgateConfirmadoCopyC3(oferta),
    valorEfetivo: valorEfetivoComprovadoCopyC3(oferta),
    descontoReal: descontoRealCopyC3(oferta),
    marca: marcaConfiavelCopyC3(oferta)
  };
}

function escolherFatoCopyC3(fatos = {}) {
  if (fatos.resgate) return { intencao: "resgate", fatoUsado: "resgate_confirmado", confianca: "alta" };
  if (fatos.beneficio) return { intencao: "beneficio", fatoUsado: "beneficio_confirmado", confianca: "alta" };
  if (fatos.cupom) return { intencao: "cupom", fatoUsado: "cupom_confirmado", confianca: "alta" };
  if (fatos.descontoReal) return { intencao: "desconto_real", fatoUsado: "desconto_real_comprovado", confianca: "alta" };
  if (fatos.valorEfetivo !== null && fatos.valorEfetivo !== undefined) return { intencao: "valor_efetivo", fatoUsado: "valor_efetivo_comprovado", confianca: "alta" };
  if (fatos.marca && fatos.precoFormatado) return { intencao: "marca_preco", fatoUsado: "marca_preco", confianca: "media" };
  if (fatos.categoria && fatos.categoria !== "Diversos") return { intencao: "categoria", fatoUsado: "categoria_final", confianca: "media" };
  if (fatos.precoFormatado) return { intencao: "preco", fatoUsado: "preco_comercial_oficial", confianca: "media" };
  return { intencao: "fallback", fatoUsado: "fallback_neutro", confianca: "baixa" };
}

function aplicarVariaveisCopyC3(textoFrase = "", fatos = {}) {
  const desconto = fatos.descontoReal || {};
  return textoFrase
    .replace(/\{percentual\}/g, String(desconto.percentual || ""))
    .replace(/\{economia\}/g, formatarMoedaCopyC3(desconto.economia) || "")
    .replace(/\{preco\}/g, fatos.precoFormatado || "")
    .replace(/\{marca\}/g, fatos.marca || "")
    .replace(/\{categoria\}/g, fatos.categoria || "essa categoria")
    .replace(/\s+/g, " ")
    .trim();
}

function escolherFraseCopyC3({ fatos = {}, decisao = {}, oferta = {}, clienteId = "admin" } = {}) {
  const pool = FRASES_COPY_C3[decisao.intencao] || FRASES_COPY_C3.fallback;
  const assinatura = [
    clienteId,
    oferta.id,
    oferta.engineOfertaId,
    oferta.ofertaId,
    oferta.produtoId,
    oferta.linkAfiliado,
    oferta.linkOriginal,
    fatos.tituloFactual,
    fatos.categoria,
    decisao.intencao
  ].map(texto).join("|");
  const indice = hashEstavelCopyC3(assinatura) % pool.length;
  const escolhida = pool[indice];
  return {
    fraseId: escolhida.id,
    texto: aplicarVariaveisCopyC3(escolhida.texto, fatos)
  };
}

function resolverCopyC3({ oferta = {}, destino = {}, clienteId = "admin", plano = {} } = {}) {
  if (!destinoIaAtivo(destino)) return { ok: false, motivoFallback: "destino_original" };
  if (!recursoCopyC3Ativo(plano)) return { ok: false, motivoFallback: "copy_c3_desabilitada" };

  const fatos = extrairFatosCopyC3(oferta);
  const decisao = escolherFatoCopyC3(fatos);
  if (decisao.intencao === "fallback" && !fatos.tituloFactual && !fatos.categoria && !fatos.precoFormatado) {
    return { ok: false, motivoFallback: "sem_fatos_c3" };
  }

  const frase = escolherFraseCopyC3({ fatos, decisao, oferta, clienteId });
  if (!frase.texto || contemTermoProibidoCopyC3(frase.texto)) {
    return { ok: false, motivoFallback: "frase_c3_rejeitada" };
  }

  return {
    ok: true,
    ganchoComercialC3: frase.texto,
    tituloIa: frase.texto,
    fraseId: frase.fraseId,
    fatoUsado: decisao.fatoUsado,
    intencao: decisao.intencao,
    familia: fatos.familia,
    categoriaOficial: fatos.categoria,
    confianca: decisao.confianca,
    fonte: FONTE_COPY_C3,
    cacheHit: false
  };
}

module.exports = {
  FONTE_COPY_C3,
  FRASES_COPY_C3,
  TERMOS_PROIBIDOS_COPY_C3,
  contemTermoProibidoCopyC3,
  extrairFatosCopyC3,
  escolherFatoCopyC3,
  resolverCopyC3,
  formatarMoedaCopyC3
};
