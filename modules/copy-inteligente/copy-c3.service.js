const { familiaDaCategoriaCopyV2 } = require("./familias-v2");
const { normalizarSinaisCopy } = require("./resolver-intencao");
const {
  categoriaOficialCopyLocalV2,
  fatosValidatorCopyLocalV2,
  produtoContextualCopyLocalV2
} = require("./copy-local-v2.service");
const { validarCopyV2 } = require("./validator-v2");

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

const PADRAO_COPY_C3_INELEGIVEL = /\b(?:calma|avalie|avaliar|compare|comparar|antes de decidir|ponta do lapis|sem pressa|radar|contexto|analise|comparacao|valor efetivo|conta final|preco de vitrine|algoritmo|motor|classificacao)\b/i;

const FRASES_COPY_C3 = Object.freeze({
  beneficio: [
    { id: "c3_beneficio_001", texto: "{produto} com benefício extra? Vale olhar ✨" },
    { id: "c3_beneficio_002", texto: "Tem benefício extra em {produto}. Abre para conferir 👀" },
    { id: "c3_beneficio_003", texto: "Tem benefício nessa oferta de {produto} ✨" }
  ],
  resgate: [
    { id: "c3_resgate_001", texto: "Tem resgate em {produto} 🎟️" },
    { id: "c3_resgate_002", texto: "{produto} com resgate disponível? Vale abrir 🎟️" },
    { id: "c3_resgate_003", texto: "Resgate válido nessa oferta. Olha: {produto} 👀" }
  ],
  cupom: [
    { id: "c3_cupom_001", texto: "{produto} com cupom? Merece carrinho 🎟️" },
    { id: "c3_cupom_002", texto: "Tem cupom em {produto}? Aí ficou bonito 👀" },
    { id: "c3_cupom_003", texto: "{produto} já chamou atenção; com cupom então... 🎟️" },
    { id: "c3_cupom_004", texto: "Cupom em {produto}. Vale abrir 🎟️" },
    { id: "c3_cupom_005", texto: "{produto} com cupom no meio? Difícil passar reto 👀" },
    { id: "c3_cupom_006", texto: "Tem cupom nessa oferta. Olha: {produto} 🎟️" },
    { id: "c3_cupom_007", texto: "Cupom em {produto}: um bom motivo para o clique 🎟️" },
    { id: "c3_cupom_008", texto: "Cupom + {produto}? Vale conferir 👀" }
  ],
  desconto_real: [
    { id: "c3_desconto_real_001", texto: "{percentual}% OFF em {produto}? Olha isso 👀" },
    { id: "c3_desconto_real_002", texto: "{produto} com desconto? Vale o clique." },
    { id: "c3_desconto_real_003", texto: "{produto} por {preco} com desconto. Vale conferir 👀" },
    { id: "c3_desconto_real_004", texto: "{percentual}% OFF e preço de {preco}. Difícil passar reto." },
    { id: "c3_desconto_real_005", texto: "Tem desconto em {produto}. Abre essa oferta 👀" },
    { id: "c3_desconto_real_006", texto: "{produto} nesse preço? Olha isso." },
    { id: "c3_desconto_real_007", texto: "{percentual}% OFF nessa oferta de {produto}." },
    { id: "c3_desconto_real_008", texto: "{produto} nesse preço chamou atenção 👀" }
  ],
  valor_efetivo: [
    { id: "c3_valor_efetivo_001", texto: "{produto} com condição final? Olha isso 👀" },
    { id: "c3_valor_efetivo_002", texto: "O valor final de {produto} merece uma olhada." },
    { id: "c3_valor_efetivo_003", texto: "A condição final em {produto} merece uma olhada 👀" },
    { id: "c3_valor_efetivo_004", texto: "Tem condição final em {produto}. Abre a oferta." },
    { id: "c3_valor_efetivo_005", texto: "O valor de {produto} chamou atenção." },
    { id: "c3_valor_efetivo_006", texto: "{produto} ganhou um valor final que merece clique 👀" },
    { id: "c3_valor_efetivo_007", texto: "Condição real em {produto}. Vale uma olhada." },
    { id: "c3_valor_efetivo_008", texto: "{produto} com valor final? Confira aqui 👀" }
  ],
  marca_preco: [
    { id: "c3_marca_preco_001", texto: "Para quem acompanha {marca}, esse aqui merece uma olhada." },
    { id: "c3_marca_preco_002", texto: "{marca} apareceu no meio das ofertas e eu parei." },
    { id: "c3_marca_preco_003", texto: "Esse da {marca} entrou na lista para comparar com calma." },
    { id: "c3_marca_preco_004", texto: "Se {marca} estava no seu radar, olha esse aqui." },
    { id: "c3_marca_preco_005", texto: "O nome {marca} ja faz a gente olhar com mais atencao." },
    { id: "c3_marca_preco_006", texto: "{marca} com esse contexto comercial chamou minha atencao." },
    { id: "c3_marca_preco_007", texto: "Essa opcao da {marca} nao passou despercebida." },
    { id: "c3_marca_preco_008", texto: "Quando aparece {marca}, vale pelo menos comparar." }
  ],
  categoria: [
    { id: "c3_categoria_001", texto: "Para quem estava de olho em {categoria}, essa entrou no radar." },
    { id: "c3_categoria_002", texto: "Essa combina com quem estava procurando {categoria}." },
    { id: "c3_categoria_003", texto: "Dentro de {categoria}, essa merece alguns segundos." },
    { id: "c3_categoria_004", texto: "Se voce vinha olhando {categoria}, para nessa aqui." },
    { id: "c3_categoria_005", texto: "Essa tem cara de achado para quem busca {categoria}." },
    { id: "c3_categoria_006", texto: "Separei essa pelo contexto de {categoria}." },
    { id: "c3_categoria_007", texto: "Para esse tipo de compra, essa opcao merece uma olhada." },
    { id: "c3_categoria_008", texto: "Essa apareceu bem no meio do que combina com {categoria}." }
  ],
  preco: [
    { id: "c3_preco_001", texto: "O preco foi o motivo de eu separar essa aqui." },
    { id: "c3_preco_002", texto: "Essa entrou no radar pelo valor." },
    { id: "c3_preco_003", texto: "Vale comparar essa antes de decidir." },
    { id: "c3_preco_004", texto: "Trouxe essa porque o valor chamou atencao." },
    { id: "c3_preco_005", texto: "Daquelas para olhar o preco com calma." },
    { id: "c3_preco_006", texto: "Essa merece alguns segundos antes de passar." },
    { id: "c3_preco_007", texto: "O tipo de achado que vale colocar lado a lado." },
    { id: "c3_preco_008", texto: "Passando essa porque a conta merece uma olhada." }
  ],
  fallback: [
    { id: "c3_fallback_001", texto: "Achado simples para olhar com calma." },
    { id: "c3_fallback_002", texto: "Essa merece uma conferida sem exagero." },
    { id: "c3_fallback_003", texto: "Vale dar uma olhada nessa antes de seguir." },
    { id: "c3_fallback_004", texto: "Deixei essa separada porque pode fazer sentido." },
    { id: "c3_fallback_005", texto: "Essa passou pelo radar e vale alguns segundos." },
    { id: "c3_fallback_006", texto: "Olha essa com calma antes de seguir." },
    { id: "c3_fallback_007", texto: "Um achado discreto, mas que merece atencao." },
    { id: "c3_fallback_008", texto: "Sem exagero: essa vale uma espiada." }
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

function indiceDeterministicoCopyC3(assinatura = "", tamanho = 1) {
  const limite = Number(tamanho) || 1;
  let hash = hashEstavelCopyC3(assinatura);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822519) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489917) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) % limite;
}

function contemTermoProibidoCopyC3(valor = "") {
  const normalizado = textoMinusculo(valor);
  return TERMOS_PROIBIDOS_COPY_C3.some(termo => normalizado.includes(termo));
}

function recursoCopyC3Ativo(plano = {}) {
  return plano?.recursos?.tituloIa === true;
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

function categoriaApresentacaoCopyC3(categoria = "") {
  const normalizada = textoMinusculo(categoria);
  if (!normalizada || normalizada === "diversos") return "";
  if (/eletroportateis|eletrodomesticos/.test(normalizada)) return "itens para casa";
  if (/casa|moveis|decoracao/.test(normalizada)) return "coisas para casa";
  if (/perfumaria|farmacia|beleza/.test(normalizada)) return "itens de beleza e cuidado";
  if (/ferramenta/.test(normalizada)) return "ferramentas";
  if (/gamer|hardware|periferic/.test(normalizada)) return "setup e tecnologia";
  if (/computadores|informatica|notebook/.test(normalizada)) return "informatica";
  if (/celular|smartphone/.test(normalizada)) return "celulares";
  if (/tenis|chinelo|calcad/.test(normalizada)) return "calcados";
  if (/roupas|moda/.test(normalizada)) return "moda";
  if (/esporte|suplemento/.test(normalizada)) return "itens de esporte e suplementos";
  if (/automotivo|carro|moto/.test(normalizada)) return "itens automotivos";
  if (/pet/.test(normalizada)) return "coisas para pet";
  if (/mercado|alimento|bebida/.test(normalizada)) return "itens de mercado";
  return "";
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

function cupomConfirmadoCopyC3(oferta = {}, sinais = normalizarSinaisCopy(oferta)) {
  return sinais.cupom === true ? texto(sinais.cupomCodigo) : "";
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

function descontoRealCopyC3(oferta = {}, sinais = normalizarSinaisCopy(oferta)) {
  if (sinais.desconto !== true) return null;
  const precoAtual = numero(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
  const precoOriginal = numero(oferta.precoOriginal ?? oferta.precoAnterior ?? oferta.precoDe);
  if (precoAtual === null || precoOriginal === null || precoOriginal <= precoAtual || precoAtual <= 0) return null;
  const percentual = numero(oferta.descontoPercentual ?? oferta.desconto);
  if (!Number.isFinite(percentual) || percentual <= 0) return null;
  return { precoAtual, precoOriginal, percentual };
}

function extrairFatosCopyC3(oferta = {}) {
  const sinais = normalizarSinaisCopy(oferta);
  const categoria = categoriaOficialCopyLocalV2(oferta, sinais) || categoriaFinalCopyC3(oferta);
  const precoAtual = numero(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
  const tituloFactual = tituloFactualCopyC3(oferta);
  return {
    sinais,
    tituloFactual,
    produto: produtoContextualCopyLocalV2(tituloFactual) || "produto",
    categoria,
    categoriaApresentacao: categoriaApresentacaoCopyC3(categoria),
    familia: familiaDaCategoriaCopyV2(categoria),
    marketplace: texto(oferta.marketplace),
    precoAtual,
    precoFormatado: formatarMoedaCopyC3(precoAtual),
    precoOriginal: numero(oferta.precoOriginal ?? oferta.precoAnterior ?? oferta.precoDe),
    cupom: cupomConfirmadoCopyC3(oferta, sinais),
    beneficio: beneficioConfirmadoCopyC3(oferta),
    resgate: resgateConfirmadoCopyC3(oferta),
    valorEfetivo: valorEfetivoComprovadoCopyC3(oferta),
    descontoReal: descontoRealCopyC3(oferta, sinais),
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
  if (fatos.categoria && fatos.categoria !== "Diversos" && fatos.categoriaApresentacao) return { intencao: "categoria", fatoUsado: "categoria_final", confianca: "media" };
  if (fatos.precoFormatado) return { intencao: "preco", fatoUsado: "preco_comercial_oficial", confianca: "media" };
  return { intencao: "fallback", fatoUsado: "fallback_neutro", confianca: "baixa" };
}

function aplicarVariaveisCopyC3(textoFrase = "", fatos = {}) {
  const desconto = fatos.descontoReal || {};
  return textoFrase
    .replace(/\{percentual\}/g, String(desconto.percentual || ""))
    .replace(/\{economia\}/g, formatarMoedaCopyC3(desconto.economia) || "")
    .replace(/\{preco\}/g, fatos.precoFormatado || "")
    .replace(/\{valorEfetivo\}/g, formatarMoedaCopyC3(fatos.valorEfetivo) || "")
    .replace(/\{produto\}/g, fatos.produto || "produto")
    .replace(/\{marca\}/g, fatos.marca || "")
    .replace(/\{categoria\}/g, fatos.categoriaApresentacao || "")
    .replace(/\s+/g, " ")
    .trim();
}

function avaliarCandidatoCopyC3(item = {}, fatos = {}) {
  const textoFinal = aplicarVariaveisCopyC3(item.texto, fatos);
  const validacao = validarCopyV2({
    textoGerado: textoFinal,
    contexto: { fatosPermitidos: fatosValidatorCopyLocalV2(fatos.sinais) }
  });
  return {
    item,
    textoFinal,
    validacao
  };
}

function candidatosValidosCopyC3(pool = [], fatos = {}) {
  const avaliados = pool
    .filter(item => !PADRAO_COPY_C3_INELEGIVEL.test(textoMinusculo(item.texto)))
    .map(item => avaliarCandidatoCopyC3(item, fatos));
  return {
    aprovados: avaliados.filter(candidato => candidato.validacao.valida === true),
    barrados: avaliados.filter(candidato => candidato.validacao.valida !== true)
  };
}

function escolherFraseCopyC3({ fatos = {}, decisao = {}, oferta = {}, clienteId = "admin" } = {}) {
  const poolOriginal = FRASES_COPY_C3[decisao.intencao] || FRASES_COPY_C3.fallback;
  const candidatosIntencao = candidatosValidosCopyC3(poolOriginal, fatos);
  const candidatosFallback = candidatosIntencao.aprovados.length
    ? { aprovados: [], barrados: [] }
    : candidatosValidosCopyC3(FRASES_COPY_C3.fallback, fatos);
  const pool = candidatosIntencao.aprovados.length ? candidatosIntencao.aprovados : candidatosFallback.aprovados;
  const barrados = [...candidatosIntencao.barrados, ...candidatosFallback.barrados];
  if (!pool.length) {
    return {
      fraseId: "",
      texto: "",
      candidatosBarradosContrato: barrados.length,
      motivosBarradosContrato: [...new Set(barrados.map(candidato => candidato.validacao.motivoCodigo).filter(Boolean))]
    };
  }
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
  const indice = indiceDeterministicoCopyC3(assinatura, pool.length);
  const escolhida = pool[indice];
  return {
    fraseId: escolhida.item.id,
    texto: escolhida.textoFinal,
    candidatosBarradosContrato: barrados.length,
    motivosBarradosContrato: [...new Set(barrados.map(candidato => candidato.validacao.motivoCodigo).filter(Boolean))]
  };
}

function resolverCopyC3({ oferta = {}, destino = {}, clienteId = "admin", plano = {} } = {}) {
  if (!destinoIaAtivo(destino)) return { ok: false, motivoFallback: "destino_original" };
  if (!recursoCopyC3Ativo(plano)) return { ok: false, motivoFallback: "copy_c3_desabilitada" };

  const fatos = extrairFatosCopyC3(oferta);
  const decisao = escolherFatoCopyC3(fatos);
  const categoriaUtil = fatos.categoria && fatos.categoria !== "Diversos" && fatos.categoriaApresentacao;
  if (decisao.intencao === "fallback" && !fatos.tituloFactual && !categoriaUtil && !fatos.precoFormatado) {
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
    candidatosBarradosContrato: frase.candidatosBarradosContrato || 0,
    motivosBarradosContrato: frase.motivosBarradosContrato || [],
    cacheHit: false
  };
}

module.exports = {
  FONTE_COPY_C3,
  FRASES_COPY_C3,
  TERMOS_PROIBIDOS_COPY_C3,
  PADRAO_COPY_C3_INELEGIVEL,
  contemTermoProibidoCopyC3,
  extrairFatosCopyC3,
  escolherFatoCopyC3,
  aplicarVariaveisCopyC3,
  avaliarCandidatoCopyC3,
  candidatosValidosCopyC3,
  escolherFraseCopyC3,
  resolverCopyC3,
  formatarMoedaCopyC3
};
