const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-templates-clientes-"));
process.env.DATA_DIR = dataDir;

const {
  criarTemplate,
  buscarTemplate,
  duplicarTemplate,
  listarTemplates,
  previewTemplate
} = require("../modules/templates-clientes/service");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const { listarCatalogoBlocos } = require("../modules/templates-clientes/catalogo-blocos");
const { obterOfertaPreviewOficial } = require("../modules/templates-clientes/oferta-preview");
const { lerStorageTemplates } = require("../modules/templates-clientes/storage");
const { gerarTemplateUniversal, apresentarScore } = require("../modules/template-universal");
const { prepararDadosOficiaisTemplate } = require("../modules/templates-clientes/dados-oficiais");

function assertThrowsCodigo(fn, codigo) {
  assert.throws(fn, erro => erro && (erro.codigo === codigo || erro.message === codigo));
}

const blocosBase = [
  { tipo: "titulo", ativo: true, ordem: 10 },
  { tipo: "preco_de", ativo: true, ordem: 20 },
  { tipo: "preco_por", ativo: true, ordem: 30 },
  { tipo: "cupom", ativo: true, ordem: 40 },
  { tipo: "economia", ativo: true, ordem: 50 },
  { tipo: "cta", ativo: true, ordem: 60 },
  { tipo: "link", ativo: true, ordem: 70 }
];

const payloadValido = {
  clienteId: "cliente_malicioso",
  nome: "Grupo VIP",
  descricao: "Template do grupo",
  canais: ["whatsapp", "telegram"],
  blocos: blocosBase,
  rodape: { ativo: true, texto: "Linha 1\nLinha 2 #promo @optimus" }
};

const criado = criarTemplate("cliente_a", payloadValido).template;
assert.ok(criado.id.startsWith("tpl_"), "cria template valido com ID backend");
assert.strictEqual(criado.clienteId, "cliente_a", "nao aceita clienteId do body");
assert.strictEqual(criado.nome, "Grupo VIP");
assert.strictEqual(criado.blocos.length, blocosBase.length);
assert.ok(!criado.blocos.some(bloco => bloco.tipo === "avaliacao"), "template antigo/salvo sem avaliacao continua sem adicionar bloco silenciosamente");

assertThrowsCodigo(() => criarTemplate("cliente_a", { ...payloadValido, nome: " " }), "template_nome_invalido");
assertThrowsCodigo(() => criarTemplate("cliente_a", { ...payloadValido, blocos: [{ tipo: "html_livre", ativo: true, ordem: 1 }] }), "template_bloco_invalido");

const ofertaOriginal = {
  titulo: "Produto Teste",
  precoOriginal: "",
  precoAtual: 29.9,
  economia: 0,
  cupom: "",
  linkAfiliado: "https://example.com/oferta"
};
const snapshotOferta = JSON.stringify(ofertaOriginal);
const render = renderizarTemplatePersonalizado({ oferta: ofertaOriginal, template: criado, canal: "whatsapp" });

assert.strictEqual(render.ok, true);
assert.ok(!render.mensagem.includes("undefined"), "remove undefined");
assert.ok(!render.mensagem.includes("null"), "remove null");
assert.ok(!render.mensagem.includes("NaN"), "remove NaN");
assert.ok(!render.mensagem.includes("Cupom:"), "remove cupom vazio");
assert.ok(!render.mensagem.includes("De:"), "remove preco DE vazio");
assert.ok(!render.mensagem.includes("Economia:"), "remove economia zero");
assert.ok(render.mensagem.includes("Por:"), "preserva preco POR");
assert.ok(render.mensagem.includes("https://example.com/oferta"), "preserva link");
assert.ok(render.mensagem.includes("Linha 1\nLinha 2"), "adiciona rodape com quebra de linha");
assert.deepStrictEqual(JSON.stringify(ofertaOriginal), snapshotOferta, "nao altera oferta original");

const ordem = render.blocosRenderizados.filter(tipo => tipo !== "rodape");
assert.deepStrictEqual(ordem, ["titulo", "preco_por", "cta", "link"], "respeita ordem e ignora blocos vazios");

assertThrowsCodigo(() => buscarTemplate("cliente_b", criado.id), "template_nao_encontrado");
const duplicado = duplicarTemplate("cliente_a", criado.id).template;
assert.notStrictEqual(duplicado.id, criado.id, "duplica com novo ID");
assert.strictEqual(duplicado.clienteId, "cliente_a");

const preview = previewTemplate("cliente_a", { canal: "whatsapp", template: { ...payloadValido, id: "tpl_id_injetado_pelo_body" } });
assert.strictEqual(preview.ok, true, "preview usa renderer personalizado");
assert.strictEqual(preview.template.id, "preview_template", "preview ignora id enviado pelo body");
assert.strictEqual(preview.templateIdUsado, "preview_template", "templateIdUsado do preview e controlado pelo backend");
assert.ok(preview.mensagem.includes("PROMO10"));
assert.ok(preview.blocosRenderizados.includes("link"));

const storage = lerStorageTemplates("cliente_a");
assert.ok(!storage.templates.some(template => template.id === "padrao_optimus"), "Template padrao nao aparece no storage do cliente");
assert.strictEqual(listarTemplates("cliente_a").padrao.id, "padrao_optimus");

// V1.1 - catalogo completo e preview fiel
const catalogoV11 = listarCatalogoBlocos();
const tiposCatalogoV11 = catalogoV11.map(item => item.tipo);
for (const tipo of [
  "titulo",
  "preco_de",
  "preco_por",
  "cupom",
  "economia",
  "cta",
  "link",
  "categoria",
  "marketplace",
  "desconto_percentual",
  "frase_cupom",
  "beneficio",
  "descricao_adicional",
  "parcelamento",
  "frete",
  "avaliacao",
  "quantidade_avaliacoes",
  "vendas",
  "aviso_preco",
  "aviso_alteracao"
]) {
  assert.ok(tiposCatalogoV11.includes(tipo), `catalogo inclui ${tipo}`);
}
assert.ok(catalogoV11.every(item => item.nomeVisual && item.descricaoVisual && item.emojiPadrao !== undefined), "catalogo expoe metadados visuais");
assert.ok(catalogoV11.every(item => item.ordemPadrao % 10 === 0), "ordem padrao usa multiplos de 10");
assert.ok(listarTemplates("cliente_a").catalogoBlocos.some(item => item.tipo === "parcelamento"), "GET expõe catalogoBlocos");

const templatePadraoNovo = criarTemplate("cliente_a", { nome: "Completo Padrao V11" }).template;
assert.ok(templatePadraoNovo.blocos.some(bloco => bloco.tipo === "frase_cupom" && bloco.ativo === true), "novo template nasce com blocos uteis ativos");
assert.ok(templatePadraoNovo.blocos.some(bloco => bloco.tipo === "avaliacao" && bloco.ativo === true), "novo template nasce com avaliacao ativa como o padrao Optimus");
assert.ok(templatePadraoNovo.blocos.some(bloco => bloco.tipo === "economia" && bloco.ativo === false), "economia nasce desligada para nao induzir recalculo");
assert.ok(templatePadraoNovo.blocos.every(bloco => bloco.id === bloco.tipo), "id final do bloco acompanha o tipo");

const blocosCompletosV11 = tiposCatalogoV11.map((tipo, indice) => ({ tipo, ativo: true, ordem: (indice + 1) * 10 }));
const ofertaPreviewV11 = obterOfertaPreviewOficial();
const renderCompletoV11 = renderizarTemplatePersonalizado({
  oferta: ofertaPreviewV11,
  template: {
    id: "tpl_v11",
    canais: ["whatsapp", "telegram", "social"],
    blocos: blocosCompletosV11,
    rodape: { ativo: true, texto: "Rodape livre\nSegunda linha" }
  },
  canal: "whatsapp"
});
assert.strictEqual(renderCompletoV11.ok, true, "preview personalizado completo renderiza");
for (const trecho of [
  "🔥 Kit 4 Caixas Sabonetes Natura Tododia",
  "🛍️ Amazon",
  "📂 Beleza e cuidados pessoais",
  "❌ De:",
  "✅ Por:",
  "📉 38% OFF",
  "🎟️ Cupom: PROMO10",
  "⚡ Aplique o cupom PROMO10 + frete grátis para pagar R$ 44,90.",
  "💳 Ou 3x de R$ 16,63 sem juros",
  "🚚 Frete gratis",
  "✰ Avaliação\n⭐⭐⭐⭐⭐",
  "👥 1.240 avaliacoes",
  "🛒 5.200 vendidos",
  "🔗 Confira aqui:",
  "https://optimuspromo.com.br/oferta/preview-template",
  "⚠️ Preco promocional por tempo limitado.",
  "⚠️ Oferta sujeita a alteracao de preco.",
  "Rodape livre\nSegunda linha"
]) {
  assert.ok(renderCompletoV11.mensagem.includes(trecho), `preview inclui: ${trecho}`);
}
assert.ok(!/[ÃÅ¢ï¿½�]/.test(renderCompletoV11.mensagem), "preview personalizado nao contem mojibake");

const semCupomV11 = renderizarTemplatePersonalizado({
  oferta: { ...ofertaPreviewV11, cupom: "", cupomCodigo: "" },
  template: {
    id: "tpl_sem_cupom",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "frase_cupom", ativo: true, ordem: 10 },
      { tipo: "cupom", ativo: true, ordem: 20 },
      { tipo: "link", ativo: true, ordem: 30 }
    ]
  },
  canal: "whatsapp"
});
assert.ok(!semCupomV11.mensagem.includes("Aplique o cupom"), "frase de cupom some sem cupom");
assert.ok(!semCupomV11.mensagem.includes("Cupom:"), "cupom some sem cupom");

const fraseCupomFallbackV11 = renderizarTemplatePersonalizado({
  oferta: { cupom: "PROMO10" },
  template: {
    id: "tpl_frase_cupom_fallback",
    canais: ["whatsapp"],
    blocos: [{ tipo: "frase_cupom", ativo: true, ordem: 10 }]
  },
  canal: "whatsapp"
});
assert.strictEqual(
  fraseCupomFallbackV11.mensagem,
  "⚡ Aplique o cupom PROMO10 para obter o desconto.",
  "frase de cupom usa fallback sem valor efetivo e beneficio oficial"
);

const precoMercadoLivreRealV11 = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Kit 3 Calca Sarja Masculina",
    marketplace: "mercadolivre",
    categoria: "Moda",
    precoOriginal: "225.91",
    precoAtual: "198.80",
    cupom: "MODASEMPRE",
    linkAfiliado: "https://meli.la/1Raac5j",
    avisoAlteracao: "Oferta sujeita a alteracao de preco."
  },
  template: {
    id: "tpl_preco_ml",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "marketplace", ativo: true, ordem: 20 },
      { tipo: "categoria", ativo: true, ordem: 30 },
      { tipo: "preco_de", ativo: true, ordem: 40 },
      { tipo: "preco_por", ativo: true, ordem: 50 },
      { tipo: "cupom", ativo: true, ordem: 60 },
      { tipo: "cta", ativo: true, ordem: 70 },
      { tipo: "link", ativo: true, ordem: 80 },
      { tipo: "aviso_alteracao", ativo: true, ordem: 90 }
    ]
  },
  canal: "whatsapp"
});
assert.ok(precoMercadoLivreRealV11.mensagem.includes("❌ De: R$ 225,91"), "preco original decimal com ponto nao vira centavos");
assert.ok(precoMercadoLivreRealV11.mensagem.includes("✅ Por: R$ 198,80"), "preco atual decimal com ponto nao vira centavos");
assert.ok(!precoMercadoLivreRealV11.mensagem.includes("22.591"), "nao multiplica preco original por 100");
assert.ok(!precoMercadoLivreRealV11.mensagem.includes("19.880"), "nao multiplica preco atual por 100");
assert.ok(
  precoMercadoLivreRealV11.mensagem.includes("🔗 Confira aqui:\nhttps://meli.la/1Raac5j"),
  "CTA e link permanecem juntos"
);
assert.ok(
  precoMercadoLivreRealV11.mensagem.includes("🎟️ Cupom: MODASEMPRE\n\n🔗 Confira aqui:"),
  "cupom e CTA ficam em grupos separados"
);
assert.ok(
  precoMercadoLivreRealV11.mensagem.includes("https://meli.la/1Raac5j\n\n⚠️ Oferta sujeita"),
  "aviso final fica separado"
);

const precoDecimalNumeroV11 = renderizarTemplatePersonalizado({
  oferta: { precoAtual: 79.9 },
  template: { id: "tpl_preco_decimal", canais: ["whatsapp"], blocos: [{ tipo: "preco_por", ativo: true, ordem: 10 }] },
  canal: "whatsapp"
});
assert.strictEqual(precoDecimalNumeroV11.mensagem, "✅ Por: R$ 79,90", "preco decimal numerico continua correto");

const precoStringBrasilV11 = renderizarTemplatePersonalizado({
  oferta: { precoAtual: "198,80" },
  template: { id: "tpl_preco_br", canais: ["whatsapp"], blocos: [{ tipo: "preco_por", ativo: true, ordem: 10 }] },
  canal: "whatsapp"
});
assert.strictEqual(precoStringBrasilV11.mensagem, "✅ Por: R$ 198,80", "preco string brasileira continua aceito");

const precoFormatadoV11 = renderizarTemplatePersonalizado({
  oferta: { precoAtual: "R$ 198,80" },
  template: { id: "tpl_preco_formatado", canais: ["whatsapp"], blocos: [{ tipo: "preco_por", ativo: true, ordem: 10 }] },
  canal: "whatsapp"
});
assert.strictEqual(precoFormatadoV11.mensagem, "✅ Por: R$ 198,80", "preco ja formatado nao e formatado duas vezes");

function moedaLegivel(texto) {
  return String(texto || "").replace(/\u00A0/g, " ");
}

const templatePrecoCupomShopeeV11 = {
  id: "tpl_shopee_preco_cupom",
  canais: ["whatsapp"],
  blocos: [
    { tipo: "preco_de", ativo: true, ordem: 10 },
    { tipo: "preco_por", ativo: true, ordem: 20 },
    { tipo: "cupom", ativo: true, ordem: 30 },
    { tipo: "frase_cupom", ativo: true, ordem: 40 },
    { tipo: "link", ativo: true, ordem: 50 }
  ]
};

const shopeeIphoneParidadeV11 = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "iPhone Shopee",
    marketplace: "shopee",
    precoAtual: 8735,
    preco: 8735,
    valorEfetivo: 84.57,
    valorEfetivoOrigem: "desconto_pix_valor_fixo",
    valorCupom: 84.57,
    cupomCodigo: "PROMO10",
    cupom: "PROMO10",
    beneficioTexto: "Pix com cupom",
    beneficios: ["Pix com cupom"],
    linkAfiliado: "https://shopee.test/iphone",
    inteligenciaUniversalV2: {
      valorEfetivo: 8185,
      valorEfetivoOrigem: "preco_pix_cupom",
      beneficios: ["Pix com cupom"]
    }
  },
  template: templatePrecoCupomShopeeV11,
  canal: "whatsapp"
});
const msgIphoneShopeeV11 = moedaLegivel(shopeeIphoneParidadeV11.mensagem);
assert.ok(msgIphoneShopeeV11.includes("Por: R$ 8.185,00"), "Shopee iPhone usa valor efetivo oficial V2");
assert.ok(!msgIphoneShopeeV11.includes("R$ 84,57"), "valor de desconto nao vira preco final");
assert.ok(msgIphoneShopeeV11.includes("Cupom:"), "cupom valido aparece");
assert.ok(msgIphoneShopeeV11.includes("PROMO10"), "cupom oficial e preservado");

const shopeeGabineteParidadeV11 = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Gabinete Shopee",
    marketplace: "shopee",
    precoAtual: 275.99,
    preco: 275.99,
    cupomCodigo: "GAB10",
    cupom: "GAB10",
    beneficioTexto: "Pix com cupom",
    beneficios: ["Pix com cupom"],
    linkAfiliado: "https://shopee.test/gabinete",
    inteligenciaUniversalV2: {
      valorEfetivo: 234.60,
      valorEfetivoOrigem: "preco_pix_cupom",
      beneficios: ["Pix com cupom"]
    }
  },
  template: templatePrecoCupomShopeeV11,
  canal: "whatsapp"
});
const msgGabineteShopeeV11 = moedaLegivel(shopeeGabineteParidadeV11.mensagem);
assert.ok(msgGabineteShopeeV11.includes("Por: R$ 234,60"), "Shopee gabinete usa valor efetivo oficial");
assert.ok(!msgGabineteShopeeV11.includes("Por: R$ 275,99"), "Shopee gabinete nao cai no preco sem cupom quando valor efetivo oficial existe");

const shopeeClassificacaoNaoCupomV11 = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Oferta Shopee Classificada",
    marketplace: "shopee",
    precoAtual: 199.9,
    cupom: "EXCELENTE",
    nivel: "excelente",
    linkAfiliado: "https://shopee.test/classificacao"
  },
  template: templatePrecoCupomShopeeV11,
  canal: "whatsapp"
});
assert.ok(!shopeeClassificacaoNaoCupomV11.mensagem.includes("Cupom: EXCELENTE"), "classificacao EXCELENTE nao vira cupom");

for (const ofertaMarketplace of [
  { marketplace: "mercadolivre", precoAtual: 198.8, linkAfiliado: "https://meli.la/teste" },
  { marketplace: "amazon", precoAtual: 79.9, linkAfiliado: "https://amzn.to/teste" },
  { marketplace: "kabum", precoAtual: 299.9, linkAfiliado: "https://kabum.test/oferta" },
  { marketplace: "awin", precoAtual: 299.9, linkAfiliado: "https://awin.test/oferta" },
  { marketplace: "aliexpress", precoAtual: 59.9, linkAfiliado: "https://ali.test/oferta" }
]) {
  const renderMarketplace = renderizarTemplatePersonalizado({
    oferta: { titulo: `Oferta ${ofertaMarketplace.marketplace}`, ...ofertaMarketplace },
    template: { id: `tpl_${ofertaMarketplace.marketplace}`, canais: ["whatsapp"], blocos: [{ tipo: "preco_por", ativo: true, ordem: 10 }, { tipo: "link", ativo: true, ordem: 20 }] },
    canal: "whatsapp"
  });
  assert.strictEqual(renderMarketplace.ok, true, `${ofertaMarketplace.marketplace} continua renderizando`);
  assert.ok(renderMarketplace.mensagem.includes("Por:"), `${ofertaMarketplace.marketplace} preserva preco`);
  assert.ok(renderMarketplace.mensagem.includes(ofertaMarketplace.linkAfiliado), `${ofertaMarketplace.marketplace} preserva link`);
}

const semBuracoV11 = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Produto sem buraco",
    precoAtual: 79.9,
    linkAfiliado: "https://example.com"
  },
  template: {
    id: "tpl_sem_buraco",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "cupom", ativo: false, ordem: 20 },
      { tipo: "preco_por", ativo: true, ordem: 30 },
      { tipo: "link", ativo: true, ordem: 40 }
    ]
  },
  canal: "whatsapp"
});
assert.ok(!/\n{3,}/.test(semBuracoV11.mensagem), "bloco desabilitado nao deixa buraco");
assert.ok(semBuracoV11.mensagem.includes("Produto sem buraco\n\n✅ Por:"), "grupos diferentes recebem uma linha vazia");

const economiaInvalidaV11 = renderizarTemplatePersonalizado({
  oferta: { ...ofertaPreviewV11, precoOriginal: 100, precoAtual: 50, economia: "" },
  template: {
    id: "tpl_economia",
    canais: ["whatsapp"],
    blocos: [{ tipo: "economia", ativo: true, ordem: 10 }]
  },
  canal: "whatsapp"
});
assert.ok(!economiaInvalidaV11.mensagem.includes("Economia:"), "economia nao e recalculada no template personalizado");

const blocoDesabilitadoV11 = renderizarTemplatePersonalizado({
  oferta: ofertaPreviewV11,
  template: {
    id: "tpl_desabilitado",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: false, ordem: 10 },
      { tipo: "link", ativo: true, ordem: 20 }
    ]
  },
  canal: "whatsapp"
});
assert.ok(!blocoDesabilitadoV11.mensagem.includes("Kit 4 Caixas"), "bloco desabilitado some do preview");

const previewPadrao = previewTemplate("cliente_a", { canal: "whatsapp", templateId: "padrao_optimus" });
assert.strictEqual(previewPadrao.ok, true, "preview padrao funciona");
assert.strictEqual(previewPadrao.templateIdUsado, "padrao_optimus");
assert.deepStrictEqual(previewPadrao.blocosRenderizados, []);
assert.strictEqual(previewPadrao.mensagem, gerarTemplateUniversal(obterOfertaPreviewOficial()), "preview padrao usa Template Universal real");
assert.ok(!/[ÃÅ¢ï¿½�]/.test(previewPadrao.mensagem), "preview padrao nao contem mojibake");

function scoreUniversalReferencia(valor) {
  if (valor && typeof valor === "object") {
    return valor.score ?? valor.valor ?? valor.total ?? null;
  }

  return valor ?? null;
}

function beneficiosUniversaisReferencia(oferta = {}, v2 = {}) {
  const logs = Array.isArray(v2.logs) ? v2.logs : [];
  const beneficios = [];

  if (Array.isArray(oferta.beneficios)) beneficios.push(...oferta.beneficios);
  if (Array.isArray(v2.beneficios)) beneficios.push(...v2.beneficios);
  if (oferta.beneficioTexto) beneficios.push(oferta.beneficioTexto);
  if (oferta.avisoCupom) beneficios.push(oferta.avisoCupom);
  if (oferta.aviso) beneficios.push(oferta.aviso);

  logs.forEach(item => {
    if (typeof item === "string") beneficios.push(item);
    else if (item?.mensagem) beneficios.push(item.mensagem);
    else if (item?.motivo) beneficios.push(item.motivo);
  });

  return [...new Set(beneficios.map(valor => String(valor || "").trim()).filter(Boolean))].slice(0, 5);
}

function montarEntradaUniversalReferencia(oferta = {}) {
  const v2 = oferta.inteligenciaUniversalV2 || {};

  return {
    titulo: oferta.titulo || oferta.nome || "",
    marketplace: oferta.marketplace || "",
    precoAtual: oferta.precoAtual ?? oferta.preco,
    precoOriginal: oferta.precoOriginal ?? oferta.precoAntigo,
    economia: oferta.economia ?? oferta.economiaValor ?? oferta.valorEconomia,
    descontoPercentual: oferta.descontoPercentual ?? oferta.desconto,
    categoria: v2.categoria || oferta.categoria || "",
    cupom: oferta.cupom || oferta.cupomCodigo || "",
    cupomTipo: oferta.cupomTipo || oferta.tipoCupom || "",
    beneficios: beneficiosUniversaisReferencia(oferta, v2),
    valorEfetivo: v2.valorEfetivo ?? oferta.valorEfetivo,
    valorEfetivoOrigem: v2.valorEfetivoOrigem || oferta.valorEfetivoOrigem || "",
    prioridade: v2.prioridade ?? oferta.prioridadeEnvio ?? oferta.prioridadeFila ?? oferta.prioridade,
    score: scoreUniversalReferencia(v2.score),
    linkAfiliado: oferta.linkAfiliado || oferta.linkFinal || oferta.link || "",
    imagem: oferta.imagem || ""
  };
}

const ofertaUniversalBaseParidade = {
  titulo: "Oferta Paridade Universal",
  marketplace: "shopee",
  categoria: "Categoria Top Level",
  precoOriginal: 1000,
  precoAtual: 900,
  preco: 900,
  valorEfetivo: 850,
  valorEfetivoOrigem: "cupom_valor_fixo",
  cupom: "PROMO10",
  cupomCodigo: "PROMOCODIGO",
  beneficios: ["Pix com cupom"],
  beneficioTexto: "Beneficio top level",
  avisoCupom: "Aviso cupom",
  desconto: 10,
  economiaValor: 100,
  score: 99,
  prioridadeEnvio: 80,
  linkAfiliado: "https://example.com/paridade",
  imagem: "https://example.com/paridade.jpg"
};

for (const [nome, ofertaParidade] of [
  ["v2.score presente", { ...ofertaUniversalBaseParidade, inteligenciaUniversalV2: { score: { score: 91 } } }],
  ["somente oferta.score top-level", { ...ofertaUniversalBaseParidade, inteligenciaUniversalV2: {} }],
  ["cupom e cupomCodigo diferentes", { ...ofertaUniversalBaseParidade, cupom: "CUPOM_A", cupomCodigo: "CUPOM_B" }],
  ["somente cupom", { ...ofertaUniversalBaseParidade, cupomCodigo: "" }],
  ["somente cupomCodigo", { ...ofertaUniversalBaseParidade, cupom: "" }],
  ["cupom EXCELENTE", { ...ofertaUniversalBaseParidade, cupom: "EXCELENTE", cupomCodigo: "PROMO10" }],
  ["categoria v2 versus top-level", { ...ofertaUniversalBaseParidade, inteligenciaUniversalV2: { categoria: "Categoria V2" } }],
  ["valorEfetivo v2 versus top-level", { ...ofertaUniversalBaseParidade, inteligenciaUniversalV2: { valorEfetivo: 777, valorEfetivoOrigem: "preco_pix" } }],
  ["beneficios", { ...ofertaUniversalBaseParidade, beneficios: ["Beneficio A"], inteligenciaUniversalV2: { beneficios: ["Beneficio B"], logs: [{ mensagem: "Beneficio C" }] } }],
  ["oferta completa", { ...ofertaUniversalBaseParidade, inteligenciaUniversalV2: { categoria: "Categoria V2", score: 88, valorEfetivo: 820, valorEfetivoOrigem: "cupom_valor_fixo", prioridade: 95, beneficios: ["Beneficio V2"] } }]
]) {
  const entradaReferencia = montarEntradaUniversalReferencia(ofertaParidade);
  const entradaAtual = prepararDadosOficiaisTemplate(ofertaParidade, { modo: "universal" });
  assert.deepStrictEqual(entradaAtual, entradaReferencia, `modo universal preserva objeto antigo: ${nome}`);
  assert.strictEqual(
    gerarTemplateUniversal(entradaAtual),
    gerarTemplateUniversal(entradaReferencia),
    `modo universal preserva string final: ${nome}`
  );
}

assert.throws(
  () => prepararDadosOficiaisTemplate(ofertaUniversalBaseParidade),
  /modo_template_invalido/,
  "helper exige modo explicito"
);

const previewSemNome = previewTemplate("cliente_a", {
  canal: "whatsapp",
  template: {
    canais: ["whatsapp"],
    blocos: [{ tipo: "titulo", ativo: true, ordem: 10 }]
  }
});
assert.strictEqual(previewSemNome.template.nome, "Preview do template", "preview usa nome temporario valido");

assertThrowsCodigo(() => criarTemplate("cliente_a", { blocos: [{ tipo: "titulo", ativo: true, ordem: 10 }] }), "template_nome_invalido");

const incompat = renderizarTemplatePersonalizado({
  oferta: { titulo: "Teste", precoAtual: 10, linkAfiliado: "https://example.com" },
  template: { ...criado, canais: ["telegram"] },
  canal: "whatsapp"
});
assert.strictEqual(incompat.ok, false, "canal incompativel retorna erro controlado");
assert.strictEqual(incompat.erro, "canal_incompativel");

const sujo = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "undefined",
    precoOriginal: "null",
    precoAtual: 19.9,
    economia: "NaN",
    cupom: "undefined",
    linkAfiliado: "https://example.com/limpo"
  },
  template: criado,
  canal: "whatsapp"
});
assert.ok(!sujo.mensagem.includes("undefined"));
assert.ok(!sujo.mensagem.includes("null"));
assert.ok(!sujo.mensagem.includes("NaN"));


// Fase 2 - integracao backend com resolver e montarMensagemOferta
const { resolverTemplateMensagem } = require("../modules/templates-clientes/resolver");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");
const { salvarTemplatesCliente } = require("../modules/templates-clientes/storage");

const ofertaIntegracao = {
  clienteId: "cliente_a",
  titulo: "Produto Integracao",
  marketplace: "amazon",
  categoria: "Casa",
  precoOriginal: 199.9,
  precoAtual: 149.9,
  economia: 50,
  cupom: "PROMO10",
  linkAfiliado: "https://example.com/integracao"
};

function assertUniversal(resultado, mensagem) {
  assert.strictEqual(resultado.usarUniversal, true, mensagem);
  assert.strictEqual(resultado.ok, false, mensagem);
}

assertUniversal(
  resolverTemplateMensagem({ clienteId: "cliente_a", destino: {}, oferta: ofertaIntegracao, canal: "whatsapp" }),
  "sem templateId usa universal"
);

assertUniversal(
  resolverTemplateMensagem({ clienteId: "cliente_a", destino: { templateId: "padrao_optimus" }, oferta: ofertaIntegracao, canal: "whatsapp" }),
  "template padrao usa universal"
);

const resolvidoValido = resolverTemplateMensagem({
  clienteId: "cliente_a",
  destino: { templateId: criado.id, tipo: "whatsapp" },
  oferta: ofertaIntegracao
});
assert.strictEqual(resolvidoValido.ok, true, "template valido resolve personalizado");
assert.strictEqual(resolvidoValido.templateIdUsado, criado.id);
assert.ok(resolvidoValido.mensagem.includes("Linha 1\nLinha 2"));

const mensagemPersonalizada = montarMensagemOferta(ofertaIntegracao, {
  clienteId: "cliente_a",
  destino: { templateId: criado.id, tipo: "whatsapp" }
});
assert.ok(mensagemPersonalizada.includes("Linha 1\nLinha 2"), "montarMensagemOferta usa renderer personalizado");

assertUniversal(
  resolverTemplateMensagem({ clienteId: "cliente_a", destino: { templateId: "tpl_inexistente" }, oferta: ofertaIntegracao, canal: "whatsapp" }),
  "template inexistente cai no universal"
);

const inativo = criarTemplate("cliente_a", { ...payloadValido, nome: "Template Inativo", ativo: false }).template;
assertUniversal(
  resolverTemplateMensagem({ clienteId: "cliente_a", destino: { templateId: inativo.id }, oferta: ofertaIntegracao, canal: "whatsapp" }),
  "template inativo cai no universal"
);

const outroCliente = criarTemplate("cliente_b", { ...payloadValido, nome: "Outro Cliente" }).template;
assertUniversal(
  resolverTemplateMensagem({ clienteId: "cliente_a", destino: { templateId: outroCliente.id }, oferta: ofertaIntegracao, canal: "whatsapp" }),
  "template de outro cliente cai no universal"
);

const apenasTelegram = criarTemplate("cliente_a", { ...payloadValido, nome: "So Telegram", canais: ["telegram"] }).template;
assertUniversal(
  resolverTemplateMensagem({ clienteId: "cliente_a", destino: { templateId: apenasTelegram.id }, oferta: ofertaIntegracao, canal: "whatsapp" }),
  "canal incompativel cai no universal"
);

const mensagemFallbackUniversal = montarMensagemOferta(ofertaIntegracao, {
  clienteId: "cliente_a",
  destino: { templateId: "tpl_inexistente", tipo: "whatsapp" }
});
assert.ok(mensagemFallbackUniversal.includes("Produto Integracao"), "fallback Universal retorna mensagem");
assert.ok(!mensagemFallbackUniversal.includes("Linha 1\nLinha 2"), "fallback Universal nao usa template personalizado");

const mensagemUniversalPadrao = montarMensagemOferta(ofertaIntegracao, {
  clienteId: "cliente/invalido",
  destino: { templateId: "padrao_optimus", tipo: "whatsapp" }
});
const mensagemErroResolver = montarMensagemOferta(ofertaIntegracao, {
  clienteId: "cliente/invalido",
  destino: { templateId: "tpl_forca_storage", tipo: "whatsapp" }
});
assert.strictEqual(mensagemErroResolver, mensagemUniversalPadrao, "erro inesperado do resolver cai no Template Universal");

const storageAntesContrato = lerStorageTemplates("cliente_a");
assert.ok(storageAntesContrato.templates.every(template => !template.templateId), "templates nao persistem objeto de destino");
// Fase 3 - permissao de plano templatePersonalizado
const Module = require("module");
const originalModuleLoad = Module._load;
let ultimoRouterFake = null;

function criarRouterFake() {
  const rotas = [];
  const router = { rotas };
  for (const method of ["get", "post", "put", "delete"]) {
    router[method] = (path, handler) => {
      rotas.push({ method: method.toUpperCase(), path, handler });
      return router;
    };
  }
  ultimoRouterFake = router;
  return router;
}

Module._load = function carregarModuloComExpressFake(request, parent, isMain) {
  if (request === "express") {
    return { Router: criarRouterFake };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const criarRotasTemplatesClientes = require("../modules/templates-clientes/routes");
Module._load = originalModuleLoad;

function criarServidorTemplates({ clienteId = "cliente_perm", habilitado = true } = {}) {
  ultimoRouterFake = null;
  const router = criarRotasTemplatesClientes({
    getClienteId: () => clienteId,
    usuarioTemRecurso: (_req, recurso) => {
      assert.strictEqual(recurso, "templatePersonalizado", "usa permissao oficial existente");
      return habilitado === true;
    }
  });
  return Promise.resolve({ baseUrl: router, close: () => Promise.resolve() });
}

function normalizarCaminhoRota(caminho) {
  const semPrefixo = String(caminho || "").replace(/^\/templates-ofertas/, "") || "/";
  if (semPrefixo === "/" || semPrefixo === "/preview") return { path: semPrefixo, params: {} };
  const duplicar = semPrefixo.match(/^\/([^/]+)\/duplicar$/);
  if (duplicar) return { path: "/:id/duplicar", params: { id: decodeURIComponent(duplicar[1]) } };
  const id = semPrefixo.match(/^\/([^/]+)$/);
  if (id) return { path: "/:id", params: { id: decodeURIComponent(id[1]) } };
  return { path: semPrefixo, params: {} };
}

function requestJson(router, method, caminho, body) {
  const rotaInfo = normalizarCaminhoRota(caminho);
  const rota = router.rotas.find(item => item.method === method && item.path === rotaInfo.path);
  assert.ok(rota, `rota ${method} ${caminho} registrada`);

  const req = { body, params: rotaInfo.params };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  rota.handler(req, res);
  return Promise.resolve({ statusCode: res.statusCode, body: res.body });
}

async function executarTestesFase3() {
  const clientePermissao = "cliente_perm";
  const templatePermissao = criarTemplate(clientePermissao, {
    ...payloadValido,
    nome: "Template Permissao Plano"
  }).template;

  const servidorHabilitado = await criarServidorTemplates({ clienteId: clientePermissao, habilitado: true });
  try {
    const listaHabilitada = await requestJson(servidorHabilitado.baseUrl, "GET", "/templates-ofertas");
    assert.strictEqual(listaHabilitada.statusCode, 200, "GET habilitado retorna 200");
    assert.strictEqual(listaHabilitada.body.recursoHabilitado, true, "GET habilitado informa recurso ativo");
    assert.ok(listaHabilitada.body.templates.some(t => t.id === templatePermissao.id), "recurso habilitado lista templates personalizados");

    const outroCliente = await criarServidorTemplates({ clienteId: "cliente_perm_outro", habilitado: true });
    try {
      const listaOutro = await requestJson(outroCliente.baseUrl, "GET", "/templates-ofertas");
      assert.ok(!listaOutro.body.templates.some(t => t.id === templatePermissao.id), "nao expoe templates entre clientes");
      const buscaOutro = await requestJson(outroCliente.baseUrl, "GET", `/templates-ofertas/${templatePermissao.id}`);
      assert.strictEqual(buscaOutro.statusCode, 404, "outro cliente nao acessa template por id");
    } finally {
      await outroCliente.close();
    }
  } finally {
    await servidorHabilitado.close();
  }

  const servidorDesabilitado = await criarServidorTemplates({ clienteId: clientePermissao, habilitado: false });
  try {
    const listaDesabilitada = await requestJson(servidorDesabilitado.baseUrl, "GET", "/templates-ofertas");
    assert.strictEqual(listaDesabilitada.statusCode, 200, "GET desabilitado mantem 200");
    assert.strictEqual(listaDesabilitada.body.recursoHabilitado, false, "GET desabilitado informa recurso inativo");
    assert.strictEqual(listaDesabilitada.body.padrao.id, "padrao_optimus", "GET desabilitado mantem Template padrao");
    assert.deepStrictEqual(listaDesabilitada.body.templates, [], "GET desabilitado nao expoe personalizados");

    for (const caso of [
      ["POST", "/templates-ofertas", { template: payloadValido }],
      ["PUT", `/templates-ofertas/${templatePermissao.id}`, { template: { ...payloadValido, nome: "Bloqueado" } }],
      ["POST", `/templates-ofertas/${templatePermissao.id}/duplicar`, {}],
      ["DELETE", `/templates-ofertas/${templatePermissao.id}`],
      ["POST", "/templates-ofertas/preview", { template: payloadValido }],
      ["GET", `/templates-ofertas/${templatePermissao.id}`]
    ]) {
      const [method, caminho, body] = caso;
      const resposta = await requestJson(servidorDesabilitado.baseUrl, method, caminho, body);
      assert.strictEqual(resposta.statusCode, 403, `${method} ${caminho} bloqueado por permissao`);
      assert.strictEqual(resposta.body.erro, "template_personalizado_indisponivel");
    }
  } finally {
    await servidorDesabilitado.close();
  }

  assert.ok(
    lerStorageTemplates(clientePermissao).templates.some(t => t.id === templatePermissao.id),
    "templates permanecem no storage apos desabilitar"
  );

  const servidorReativado = await criarServidorTemplates({ clienteId: clientePermissao, habilitado: true });
  try {
    const listaReativada = await requestJson(servidorReativado.baseUrl, "GET", "/templates-ofertas");
    assert.ok(listaReativada.body.templates.some(t => t.id === templatePermissao.id), "ao reativar templates reaparecem");
  } finally {
    await servidorReativado.close();
  }

  const destinoComTemplate = { id: "destino_perm", templateId: templatePermissao.id, tipo: "whatsapp" };
  const templateIdAntes = destinoComTemplate.templateId;
  const planoHabilitado = { recursos: { templatePersonalizado: true } };
  const planoDesabilitado = { recursos: { templatePersonalizado: false } };

  const mensagemEnvioHabilitado = montarMensagemOferta(ofertaIntegracao, {
    clienteId: clientePermissao,
    destino: destinoComTemplate,
    plano: planoHabilitado
  });
  assert.ok(mensagemEnvioHabilitado.includes("Linha 1\nLinha 2"), "envio habilitado usa template personalizado");

  const mensagemEnvioDesabilitado = montarMensagemOferta(ofertaIntegracao, {
    clienteId: clientePermissao,
    destino: destinoComTemplate,
    plano: planoDesabilitado
  });
  const mensagemUniversalDireta = montarMensagemOferta(ofertaIntegracao, {
    clienteId: clientePermissao,
    destino: { ...destinoComTemplate, templateId: "padrao_optimus" },
    plano: planoDesabilitado
  });
  assert.strictEqual(mensagemEnvioDesabilitado, mensagemUniversalDireta, "envio desabilitado cai no Template Universal");
  assert.strictEqual(destinoComTemplate.templateId, templateIdAntes, "templateId do destino nao e alterado");

  const mensagemTelegramDesabilitado = montarMensagemOferta(ofertaIntegracao, {
    clienteId: clientePermissao,
    destino: { ...destinoComTemplate, tipo: "telegram" },
    plano: planoDesabilitado
  });
  assert.strictEqual(typeof mensagemTelegramDesabilitado, "string", "permissao desabilitada nao quebra Telegram");
  assert.ok(mensagemTelegramDesabilitado.length > 0, "permissao desabilitada nao quebra fluxo de envio/fila");
}

executarTestesFase3()
  .then(() => {
    console.log("templates-clientes.test.js OK");
  })
  .catch(erro => {
    console.error(erro);
    process.exitCode = 1;
  });
