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
    { id: "c3_cupom_001", texto: "Quando tem cupom no meio, vale olhar duas vezes." },
    { id: "c3_cupom_002", texto: "Esse aqui ganhou um empurrao por causa do cupom." },
    { id: "c3_cupom_003", texto: "Eu nao passaria reto sem olhar o cupom primeiro." },
    { id: "c3_cupom_004", texto: "Cupom muda a leitura dessa oferta." },
    { id: "c3_cupom_005", texto: "Essa ficou mais interessante com cupom na jogada." },
    { id: "c3_cupom_006", texto: "Olha esse aqui com calma antes de fechar a compra." },
    { id: "c3_cupom_007", texto: "O produto ja chamou; o cupom ajuda na decisao." },
    { id: "c3_cupom_008", texto: "Essa e daquelas em que o cupom pede uma segunda olhada." }
  ],
  desconto_real: [
    { id: "c3_desconto_real_001", texto: "Aqui a diferenca no valor chama atencao." },
    { id: "c3_desconto_real_002", texto: "Esse caiu bem em relacao ao preco anterior." },
    { id: "c3_desconto_real_003", texto: "Aqui a comparacao com o valor anterior ficou interessante." },
    { id: "c3_desconto_real_004", texto: "A conta ficou melhor do que parecia de primeira." },
    { id: "c3_desconto_real_005", texto: "Quando o valor muda assim, eu paro para olhar." },
    { id: "c3_desconto_real_006", texto: "A diferenca vem de uma referencia real de preco." },
    { id: "c3_desconto_real_007", texto: "A diferenca aqui nao passou batida." },
    { id: "c3_desconto_real_008", texto: "Esse merece a olhada justamente pela mudanca no valor." }
  ],
  valor_efetivo: [
    { id: "c3_valor_efetivo_001", texto: "A conta final aqui fica mais interessante que a vitrine." },
    { id: "c3_valor_efetivo_002", texto: "Tem uma condicao na conta que vale olhar com calma." },
    { id: "c3_valor_efetivo_003", texto: "O numero final mudou a historia dessa oferta." },
    { id: "c3_valor_efetivo_004", texto: "Antes de comparar, vale olhar a conta completa." },
    { id: "c3_valor_efetivo_005", texto: "Essa fica melhor quando voce considera o valor efetivo." },
    { id: "c3_valor_efetivo_006", texto: "Aqui nao e so preco de vitrine; tem conta final envolvida." },
    { id: "c3_valor_efetivo_007", texto: "A parte boa aparece quando fecha a conta." },
    { id: "c3_valor_efetivo_008", texto: "Esse detalhe na conta muda o jeito de avaliar." }
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
    categoriaApresentacao: categoriaApresentacaoCopyC3(categoria),
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
    .replace(/\{marca\}/g, fatos.marca || "")
    .replace(/\{categoria\}/g, fatos.categoriaApresentacao || "")
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
  const indice = indiceDeterministicoCopyC3(assinatura, pool.length);
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
