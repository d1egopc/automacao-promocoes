const assert = require("assert");

const { montarMensagemOferta } = require("../utils/mensagens-ofertas");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const { resolverContratoComercialFinal } = require("../modules/templates-clientes/contrato-comercial-final");

const CUPOM = "CODIGO10";
const BENEFICIO = "R$ 12 OFF no cupom/pagina";
const BENEFICIO_DISTINTO = "Frete gratis";

const LINKS = {
  amazon: "https://www.amazon.com.br/dp/B54TEST?tag=workspace-20",
  mercadolivre: "https://www.mercadolivre.com.br/MLB-B54TEST?matt_tool=workspace",
  shopee: "https://shopee.com.br/produto-b54-test.i.1.2",
  aliexpress: {
    app: "https://s.click.aliexpress.com/e/_B54APP",
    pc: "https://pt.aliexpress.com/item/B54PC.html?aff_fcid=workspace"
  },
  magalu: "https://www.magazineluiza.com.br/produto-b54-test/p/123456/",
  kabum: "https://www.kabum.com.br/produto/543210/produto-b54-test"
};

function fixtureMarketplace(marketplace) {
  const chave = marketplace.toLowerCase().replace(/[^a-z]/g, "");
  const link = chave === "aliexpress" ? LINKS.aliexpress.pc : LINKS[chave];
  const linksComerciais = chave === "aliexpress"
    ? [
        { tipo: "app", papel: "link_app", urlAfiliada: LINKS.aliexpress.app, ordemCaptura: 1 },
        { tipo: "pc", papel: "link_pc", urlAfiliada: LINKS.aliexpress.pc, ordemCaptura: 2 },
        { tipo: "produto", papel: "produto", urlAfiliada: LINKS.aliexpress.pc, ordemCaptura: 3 }
      ]
    : [
        { tipo: "produto", papel: "produto", urlAfiliada: link, ordemCaptura: 1 }
      ];

  return {
    clienteId: "workspace-b54-fixture",
    titulo: `Oferta universal ${marketplace}`,
    marketplace,
    textoOriginal: [
      `Oferta universal ${marketplace}`,
      "Por R$ 53,54",
      "2x de R$ 33,47",
      `Cupom: ${CUPOM}`,
      BENEFICIO,
      BENEFICIO_DISTINTO
    ].join("\n"),
    precoAtual: 53.54,
    parcelamento: "2x de R$ 33,47",
    cupom: CUPOM,
    cupomCodigo: CUPOM,
    cupomConfirmado: true,
    cupomOrigem: "radar",
    instrucaoCupom: `Aplique o cupom ${CUPOM} no carrinho.`,
    avisoCupom: BENEFICIO,
    beneficioExtra: BENEFICIO,
    beneficioDetectado: BENEFICIO,
    beneficios: [
      { tipo: "desconto", valor: BENEFICIO },
      { texto: BENEFICIO_DISTINTO }
    ],
    condicoes: [{ valor: BENEFICIO }, { texto: BENEFICIO_DISTINTO }],
    observacoes: [{ texto: BENEFICIO }, { texto: BENEFICIO_DISTINTO }],
    frete: BENEFICIO_DISTINTO,
    freteTexto: BENEFICIO_DISTINTO,
    linksComerciais,
    linkAfiliado: link,
    ...(chave === "aliexpress" ? {
      linkApp: LINKS.aliexpress.app,
      linkPc: LINKS.aliexpress.pc
    } : {})
  };
}

function forbiddenTokens(texto) {
  return texto.match(/\[object (?:Object|Array)\]|\bundefined\b/gi) || [];
}

function count(texto, valor) {
  return texto.split(valor).length - 1;
}

function assertMensagemFinal(mensagem, oferta, origem) {
  assert.strictEqual(typeof mensagem, "string", `${origem}: mensagem deve ser texto`);
  assert.deepStrictEqual(forbiddenTokens(mensagem), [], `${origem}: nenhum valor técnico pode vazar`);
  const comparacao = mensagem.replace(/\u00a0/g, " ");
  assert.strictEqual(count(mensagem, BENEFICIO), 1, `${origem}: benefício repetido deve aparecer uma vez`);
  assert.strictEqual(count(mensagem, BENEFICIO_DISTINTO), 1, `${origem}: benefício distinto deve ser preservado uma vez`);
  assert.ok(comparacao.includes("R$ 53,54"), `${origem}: preço comprovado ausente: ${mensagem}`);
  assert.ok(comparacao.includes("2x de R$ 33,47"), `${origem}: parcelamento comprovado ausente: ${mensagem}`);
  assert.ok(comparacao.includes(CUPOM), `${origem}: cupom comprovado ausente`);
  if (oferta.marketplace.toLowerCase() === "aliexpress") {
    assert.ok(mensagem.includes(LINKS.aliexpress.app), `${origem}: link APP AliExpress ausente`);
    assert.ok(mensagem.includes(LINKS.aliexpress.pc), `${origem}: link PC AliExpress ausente`);
  } else {
    assert.ok(mensagem.includes(oferta.linkAfiliado), `${origem}: link afiliado ausente`);
  }
}

const marketplaces = ["Amazon", "Mercado Livre", "Shopee", "AliExpress", "Magalu", "KaBuM"];

for (const marketplace of marketplaces) {
  const oferta = resolverContratoComercialFinal(fixtureMarketplace(marketplace));
  const mensagemEnviarAgora = montarMensagemOferta(oferta, {
    clienteId: oferta.clienteId,
    destino: { id: `destino-${marketplace}`, canal: "whatsapp" },
    canal: "whatsapp",
    plano: { recursos: { templatePersonalizado: false } }
  });
  assertMensagemFinal(mensagemEnviarAgora, oferta, `${marketplace} / enviar-agora / universal`);

  const personalizada = renderizarTemplatePersonalizado({
    oferta,
    template: {
      id: `template-b54-${marketplace}`,
      canais: ["whatsapp"],
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "preco_por", ativo: true, ordem: 20 },
        { tipo: "parcelamento", ativo: true, ordem: 30 },
        { tipo: "cupom", ativo: true, ordem: 40 },
        { tipo: "beneficio", ativo: true, ordem: 50 },
        { tipo: "beneficio", ativo: true, ordem: 60 },
        { tipo: "frete", ativo: true, ordem: 70 },
        { tipo: "link_app", ativo: true, ordem: 80 },
        { tipo: "link_pc", ativo: true, ordem: 90 },
        { tipo: "link", ativo: true, ordem: 100 }
      ]
    },
    canal: "whatsapp"
  });
  assert.strictEqual(personalizada.ok, true, `${marketplace}: renderer personalizado deve concluir`);
  assertMensagemFinal(personalizada.mensagem, oferta, `${marketplace} / renderer personalizado`);
}

console.log("template-marketplaces-b54.test.js ok");
