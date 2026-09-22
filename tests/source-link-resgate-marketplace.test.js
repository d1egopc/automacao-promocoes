"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  classificarLinksComerciais
} = require("../modules/radar/links-comerciais");
const {
  extrairLinksRadar,
  analisarBeneficiosMensagemRadar
} = require("../utils/radar-cupom-mensagem");
const {
  aplicarContratoMarketplace
} = require("../modules/ofc-v2/marketplace-contracts");
const {
  resolverContratoComercialFinal
} = require("../modules/templates-clientes/contrato-comercial-final");
const {
  gerarTemplateUniversal
} = require("../modules/template-universal");
const {
  renderizarTemplatePersonalizado
} = require("../modules/templates-clientes/renderer");
const {
  criarProvaAfiliacaoWorkspaceShopee,
  validarProvaAfiliacaoWorkspaceShopee,
  assinaturaProvaShopeeValida,
  vincularUrlFinalPublicadaShopee
} = require("../modules/marketplaces/shopee/afiliacao-workspace");

const sourceMl = "https://meli.la/2geSfvW";
const produtoMlFinal = "https://meli.la/2UHyk21";
const dataDirAnterior = process.env.DATA_DIR;
const dataDirTeste = fs.mkdtempSync(path.join(os.tmpdir(), "shopee-proof-"));
process.env.DATA_DIR = dataDirTeste;
for (const [workspaceId, secret] of [["workspace_teste", "segredo_fixture_somente_teste"], ["workspace_outro", "segredo_outro_workspace"]]) {
  const pasta = path.join(dataDirTeste, "clientes", workspaceId);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, "integracoes.json"), JSON.stringify({ shopee: { credenciais: { appId: "123456", secret } } }));
}

function provaResgateShopee(original, final) {
  const credenciais = { appId: "123456", secret: "segredo_fixture_somente_teste" };
  const prova = criarProvaAfiliacaoWorkspaceShopee({
    clienteId: "workspace_teste",
    credenciais,
    urlOriginal: original,
    urlAfiliadaWorkspace: final,
    urlFinalExpandida: "https://shopee.com.br/m/cupom-de-desconto?mmp_pid=an_123456",
    papel: "resgate",
    motivoConversao: "resgate_workspace_convertido_generate_shortlink"
  });
  assert.strictEqual(validarProvaAfiliacaoWorkspaceShopee(prova, {
    clienteId: "workspace_teste",
    credenciais,
    exigirAssinatura: true
  }).valida, true);
  return prova;
}

function linkFinal(tipo, original, final, ordem = 1, extras = {}) {
  return {
    tipo,
    papel: `link_${tipo}`,
    ordemCaptura: ordem,
    original,
    urlAfiliadaWorkspace: final,
    origemConversao: "workspace_api",
    conversaoStatus: "convertida",
    convertidoWorkspace: true,
    renderizavel: true,
    ...extras
  };
}

function testarIncidenteMercadoLivre() {
  const textoFonte = [
    "Kit 5 Camisetas Dry All Black Alpha",
    "Por R$ 106,00",
    "Cupom: MELIACHAPROMOS",
    "Resgate o cupom:",
    sourceMl,
    "Confira aqui:",
    produtoMlFinal
  ].join("\n");
  const links = extrairLinksRadar(textoFonte);
  const beneficios = analisarBeneficiosMensagemRadar(textoFonte, links);
  assert.strictEqual(beneficios.cupom, "MELIACHAPROMOS");
  assert.deepStrictEqual(beneficios.linksResgate, []);
  assert.strictEqual(beneficios.linkResgateCupom, "");

  const classificados = classificarLinksComerciais({
    texto: textoFonte,
    marketplace: "mercadolivre"
  });
  assert.deepStrictEqual(classificados.resgate, []);
  assert.strictEqual(classificados.classificados[0].tipo, "produto");
  assert.deepStrictEqual(classificados.encontrados, [produtoMlFinal]);
  assert.ok(!classificados.encontrados.includes(sourceMl));

  const contratoOFC = aplicarContratoMarketplace({
    marketplace: "mercadolivre",
    linkAfiliado: produtoMlFinal,
    linkOriginal: produtoMlFinal,
    links: [
      { url: sourceMl, tipo: "resgate", contexto: "Resgate o cupom", ordemCaptura: 1 },
      { url: produtoMlFinal, tipo: "produto", contexto: "Confira aqui", ordemCaptura: 2 }
    ]
  });
  assert.ok(!contratoOFC.links.some(item => item.papel === "link_resgate"));
  assert.ok(contratoOFC.descartes.some(item => item.motivo === "resgate_exclusivo_shopee"));

  const oferta = {
    titulo: "Kit 5 Camisetas Dry All Black Alpha",
    marketplace: "mercadolivre",
    precoAtual: 106,
    cupom: "MELIACHAPROMOS",
    cupons: ["MELIACHAPROMOS", "MODA10"],
    codigosCupom: ["MELIACHAPROMOS", "MODA10"],
    textoOriginal: textoFonte,
    linksComerciais: [
      linkFinal("resgate", sourceMl, sourceMl, 1),
      linkFinal("produto", produtoMlFinal, produtoMlFinal, 2)
    ]
  };
  const normalizada = resolverContratoComercialFinal(oferta);
  assert.deepStrictEqual(normalizada.linksResgate, []);
  assert.strictEqual(normalizada.linkResgate, "");
  assert.strictEqual(normalizada.contratoComercialFinal.precoPor, 106);
  assert.strictEqual(normalizada.contratoComercialFinal.cupomCodigo, "MELIACHAPROMOS");

  const mensagem = gerarTemplateUniversal(oferta);
  assert.ok(mensagem.includes("R$ 106,00"));
  assert.ok(mensagem.includes("MELIACHAPROMOS"));
  assert.ok(mensagem.includes(produtoMlFinal));
  assert.ok(!mensagem.includes(sourceMl));
  assert.ok(!/Resgat(?:e|ar) cupom:/i.test(mensagem));

  const personalizado = renderizarTemplatePersonalizado({
    oferta,
    template: {
      id: "tpl_source_link_leak_ml",
      canais: ["whatsapp"],
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "preco_por", ativo: true, ordem: 20 },
        { tipo: "cupom", ativo: true, ordem: 30 },
        { tipo: "link_resgate", ativo: true, ordem: 40 },
        { tipo: "link", ativo: true, ordem: 50 }
      ]
    },
    canal: "whatsapp"
  }).mensagem;
  assert.ok(personalizado.includes(produtoMlFinal));
  assert.ok(!personalizado.includes(sourceMl));
  assert.ok(!/Resgat(?:e|ar) cupom:/i.test(personalizado));
}

function testarNaoShopeeNaoPublicaResgate() {
  for (const marketplace of ["amazon", "aliexpress", "awin", "kabum", "magalu"]) {
    const origem = `https://source.invalid/${marketplace}/resgate`;
    const finalProduto = `https://go.optimus/${marketplace}/produto`;
    const mensagem = gerarTemplateUniversal({
      titulo: `Oferta ${marketplace}`,
      marketplace,
      precoAtual: 99.9,
      cupom: "TESTE10",
      linksComerciais: [
        linkFinal("resgate", origem, origem, 1),
        linkFinal("produto", `https://source.invalid/${marketplace}/produto`, finalProduto, 2)
      ]
    });
    assert.ok(mensagem.includes(finalProduto), `${marketplace}: link principal final preservado`);
    assert.ok(!mensagem.includes(origem), `${marketplace}: source rescue descartado`);
    assert.ok(!/Resgat(?:e|ar) cupom:/i.test(mensagem), `${marketplace}: CTA de resgate proibido`);
  }
}

function testarShopeeResgateConvertido() {
  const sourceResgate = "https://s.shopee.com.br/source-resgate";
  const finalResgate = "https://s.shopee.com.br/final-resgate-workspace";
  const sourceProduto = "https://s.shopee.com.br/source-produto";
  const finalProduto = "https://s.shopee.com.br/final-produto-workspace";
  const ofertaShopee = {
    titulo: "Shopee com resgate seguro",
    marketplace: "shopee",
    workspaceId: "workspace_teste",
    precoAtual: 79.9,
    cupom: "SHOPEE10",
    linksComerciais: [
      linkFinal("resgate", sourceResgate, finalResgate, 1, {
        afiliacaoWorkspace: provaResgateShopee(sourceResgate, finalResgate)
      }),
      linkFinal("produto", sourceProduto, finalProduto, 2)
    ]
  };
  const mensagem = gerarTemplateUniversal(ofertaShopee);
  assert.ok(mensagem.includes("Resgatar cupom"));
  assert.ok(mensagem.includes(finalResgate));
  assert.ok(mensagem.includes(finalProduto));
  assert.ok(!mensagem.includes(sourceResgate));
  assert.ok(!mensagem.includes(sourceProduto));
  const personalizado = renderizarTemplatePersonalizado({
    oferta: ofertaShopee,
    template: {
      id: "tpl_source_link_leak_shopee",
      canais: ["whatsapp"],
      blocos: [
        { tipo: "link_resgate", ativo: true, ordem: 10 },
        { tipo: "link", ativo: true, ordem: 20 }
      ]
    },
    canal: "whatsapp"
  }).mensagem;
  assert.ok(personalizado.includes(finalResgate));
  assert.ok(personalizado.includes(finalProduto));
  assert.ok(!personalizado.includes(sourceResgate));

  const contratoOFC = aplicarContratoMarketplace({
    marketplace: "shopee",
    workspaceId: "workspace_teste",
    linkAfiliado: finalProduto,
    linkOriginal: sourceProduto,
    links: [
      {
        url: sourceResgate,
        tipo: "resgate",
        contexto: "Resgate o cupom",
        urlAfiliadaWorkspace: finalResgate,
        conversaoStatus: "convertida",
        convertidoWorkspace: true,
        renderizavel: true,
        afiliacaoWorkspace: provaResgateShopee(sourceResgate, finalResgate),
        ordemCaptura: 1
      },
      {
        url: sourceProduto,
        tipo: "produto",
        contexto: "Produto",
        urlAfiliadaWorkspace: finalProduto,
        origemConversao: "workspace_api",
        conversaoStatus: "convertida",
        ordemCaptura: 2
      }
    ]
  });
  const resgateOFC = contratoOFC.links.find(item => item.papel === "link_resgate");
  assert.strictEqual(resgateOFC.urlAfiliadaWorkspace, finalResgate);
  assert.strictEqual(resgateOFC.renderizavel, true);
  assert.strictEqual(resgateOFC.conversaoStatus, "convertida");
  assert.deepStrictEqual(resgateOFC.afiliacaoWorkspace, provaResgateShopee(sourceResgate, finalResgate));

  const mesmaUrlSemProva = gerarTemplateUniversal({
    titulo: "Shopee raw repetido",
    marketplace: "shopee",
    precoAtual: 79.9,
    linksComerciais: [linkFinal("resgate", sourceResgate, sourceResgate, 1)]
  });
  assert.ok(!mesmaUrlSemProva.includes(sourceResgate));
  assert.ok(!mesmaUrlSemProva.includes("Resgatar cupom"));

  const dominioValidoSemProva = gerarTemplateUniversal({
    titulo: "Shopee sem prova",
    marketplace: "shopee",
    precoAtual: 79.9,
    linksComerciais: [linkFinal("resgate", sourceResgate, "https://s.shopee.com.br/outro-link", 1)]
  });
  assert.ok(!dominioValidoSemProva.includes("outro-link"));
  assert.ok(!dominioValidoSemProva.includes("Resgatar cupom"));
  const personalizadoSemProva = renderizarTemplatePersonalizado({
    oferta: {
      titulo: "Shopee sem prova no personalizado",
      marketplace: "shopee",
      linksComerciais: [linkFinal("resgate", sourceResgate, "https://s.shopee.com.br/outro-link", 1)]
    },
    template: {
      id: "tpl_shopee_sem_prova",
      canais: ["whatsapp"],
      blocos: [{ tipo: "link_resgate", ativo: true, ordem: 10 }]
    },
    canal: "whatsapp"
  }).mensagem;
  assert.ok(!personalizadoSemProva.includes(sourceResgate));
  assert.ok(!personalizadoSemProva.includes("outro-link"));

  const redirectCruApesarDaProva = gerarTemplateUniversal({
    titulo: "Shopee redirect cru",
    marketplace: "shopee",
    precoAtual: 79.9,
    linksComerciais: [linkFinal("resgate", sourceResgate, finalResgate, 1, {
      urlOptimus: sourceResgate,
      afiliacaoWorkspace: provaResgateShopee(sourceResgate, finalResgate)
    })]
  });
  assert.ok(!redirectCruApesarDaProva.includes(sourceResgate));
  assert.ok(!redirectCruApesarDaProva.includes("Resgatar cupom"));

  const invalida = gerarTemplateUniversal({
    titulo: "Shopee com resgate invalido",
    marketplace: "shopee",
    precoAtual: 79.9,
    linksComerciais: [
      linkFinal("resgate", "https://meli.la/origem-invalida", "https://meli.la/final-invalido", 1),
      linkFinal("produto", sourceProduto, finalProduto, 2)
    ]
  });
  assert.ok(!invalida.includes("final-invalido"));
  assert.ok(!invalida.includes("Resgatar cupom"));
}

function testarProvaShopeeAdversarial() {
  const original = "https://s.shopee.com.br/origem-resgate";
  const urlA = "https://s.shopee.com.br/workspace-url-a";
  const urlB = "https://s.shopee.com.br/origem-url-b";
  const provaA = provaResgateShopee(original, urlA);
  const base = linkFinal("resgate", original, urlA, 1, { afiliacaoWorkspace: provaA });
  const render = (link, workspaceId = "workspace_teste") => gerarTemplateUniversal({
    titulo: "Prova Shopee adversarial", marketplace: "shopee", workspaceId,
    precoAtual: 50, linksComerciais: [link]
  });
  const rejeitar = (link, workspaceId = "workspace_teste") => {
    const mensagem = render(link, workspaceId);
    assert.ok(!mensagem.includes("Resgatar cupom"));
    assert.ok(!mensagem.includes(urlB));
    const personalizado = renderizarTemplatePersonalizado({
      oferta: { titulo: "Prova Shopee adversarial", marketplace: "shopee", workspaceId, linksComerciais: [link] },
      template: { id: "tpl_prova_adversarial", canais: ["whatsapp"], blocos: [{ tipo: "link_resgate", ativo: true, ordem: 1 }] },
      canal: "whatsapp"
    }).mensagem;
    assert.ok(!personalizado.includes("Resgatar cupom"));
    assert.ok(!personalizado.includes(urlB));
  };

  assert.ok(render(base).includes(urlA), "H: prova legítima deve publicar URL assinada");
  const redirect = "https://go.optimuspromo.com.br/r/resgate-workspace-a";
  const provaRedirect = vincularUrlFinalPublicadaShopee(provaA, {
    clienteId: "workspace_teste", credenciais: { appId: "123456", secret: "segredo_fixture_somente_teste" },
    urlAtual: urlA, urlFinal: redirect
  });
  assert.ok(provaRedirect && render({ ...base, urlOptimus: redirect, afiliacaoWorkspace: provaRedirect }).includes(redirect));
  const contratoRedirect = aplicarContratoMarketplace({
    marketplace: "shopee", workspaceId: "workspace_teste",
    links: [{ ...base, tipo: "resgate", url: original, urlOptimus: redirect, afiliacaoWorkspace: provaRedirect }]
  });
  assert.ok(contratoRedirect.links.some(item => item.papel === "link_resgate" && item.renderizavel === true && item.urlOptimus === redirect));
  rejeitar({ ...base, urlOptimus: urlB, afiliacaoWorkspace: provaRedirect });
  assert.strictEqual(vincularUrlFinalPublicadaShopee(provaA, {
    clienteId: "workspace_outro", credenciais: { appId: "123456", secret: "segredo_outro_workspace" },
    urlAtual: urlA, urlFinal: redirect
  }), null);
  rejeitar({ ...base, afiliacaoWorkspace: { ...provaA, assinatura: "assinatura_inventada" } }); // A
  rejeitar({ ...base, urlOptimus: urlB }); // B: URL publicada diferente da assinada
  rejeitar(base, "workspace_outro"); // C
  const workspaceDeclaradoPeloPayload = gerarTemplateUniversal({
    titulo: "Workspace divergente", marketplace: "shopee", clienteId: "workspace_outro",
    workspaceId: "workspace_teste", precoAtual: 50, linksComerciais: [base]
  });
  assert.ok(!workspaceDeclaradoPeloPayload.includes(urlA));
  assert.ok(!workspaceDeclaradoPeloPayload.includes("Resgatar cupom"));
  const provaProduto = criarProvaAfiliacaoWorkspaceShopee({
    clienteId: "workspace_teste", credenciais: { appId: "123456", secret: "segredo_fixture_somente_teste" },
    urlOriginal: original, urlAfiliadaWorkspace: urlA,
    urlFinalExpandida: "https://shopee.com.br/m/cupom-de-desconto?mmp_pid=an_123456", papel: "produto"
  });
  assert.ok(assinaturaProvaShopeeValida(provaProduto, { secret: "segredo_fixture_somente_teste" }));
  rejeitar({ ...base, afiliacaoWorkspace: provaProduto }); // D

  const provaOutroMarketplace = { ...provaA, marketplace: "aliexpress" };
  const payload = {
    marketplace: provaOutroMarketplace.marketplace, workspaceId: provaOutroMarketplace.workspaceId,
    appId: provaOutroMarketplace.appId, affiliateIdEsperado: provaOutroMarketplace.affiliateIdEsperado,
    affiliateIdDetectado: provaOutroMarketplace.affiliateIdDetectado, papel: provaOutroMarketplace.papel,
    urlOriginal: provaOutroMarketplace.urlOriginal, urlAfiliadaWorkspace: provaOutroMarketplace.urlAfiliadaWorkspace,
    urlFinalPublicada: provaOutroMarketplace.urlFinalPublicada, urlFinalExpandida: provaOutroMarketplace.urlFinalExpandida,
    origemConversao: provaOutroMarketplace.origemConversao, conversaoStatus: provaOutroMarketplace.conversaoStatus,
    motivoConversao: provaOutroMarketplace.motivoConversao
  };
  provaOutroMarketplace.assinatura = crypto.createHmac("sha256", "segredo_fixture_somente_teste").update(JSON.stringify(payload), "utf8").digest("hex");
  assert.ok(assinaturaProvaShopeeValida(provaOutroMarketplace, { secret: "segredo_fixture_somente_teste" }));
  rejeitar({ ...base, afiliacaoWorkspace: provaOutroMarketplace }); // E
  rejeitar({ ...base, afiliacaoWorkspace: null }); // F: domínio Shopee sem prova
  rejeitar({ ...base, renderizavel: true, afiliacaoWorkspace: null }); // G
}

function testarPapelResgateIncompativelDescartado() {
  const casos = [
    ["aliexpress", "https://a.aliexpress.com/_resgateSource", "https://s.click.aliexpress.com/e/_resgateFinal"],
    ["kabum", "https://www.kabum.com.br/produto/resgate-source", "https://www.awin1.com/cread.php?resgate-final"],
    ["awin", "https://www.awin1.com/cread.php?resgate-source", "https://www.awin1.com/cread.php?resgate-final"]
  ];

  for (const [marketplace, original, final] of casos) {
    const contrato = aplicarContratoMarketplace({
      marketplace,
      linkAfiliado: final,
      linkOriginal: original,
      links: [{
        url: original,
        tipo: "resgate",
        contexto: "Resgate o cupom",
        urlAfiliadaWorkspace: final,
        convertidoWorkspace: true,
        conversaoStatus: "convertida"
      }]
    });
    assert.deepStrictEqual(contrato.links, [], `${marketplace}: resgate incompatível deve ser descartado`);
    assert.ok(contrato.descartes.some(item => item.motivo === "resgate_exclusivo_shopee"));

    const mensagem = gerarTemplateUniversal({
      titulo: `Papel incompatível ${marketplace}`,
      marketplace,
      precoAtual: 50,
      linksComerciais: contrato.links
    });
    assert.ok(!mensagem.includes(original), `${marketplace}: source não pode aparecer`);
    assert.ok(!mensagem.includes(final), `${marketplace}: resgate não pode virar produto`);
    assert.ok(!/APP:\*|PC:\*|Confira aqui:/i.test(mensagem), `${marketplace}: resgate não pode mudar de papel`);
  }
}

function testarAliExpressMantemAppPc() {
  const app = "https://s.click.aliexpress.com/e/_appWorkspace";
  const pc = "https://s.click.aliexpress.com/e/_pcWorkspace";
  const mensagem = gerarTemplateUniversal({
    titulo: "AliExpress APP e PC",
    marketplace: "aliexpress",
    precoAtual: 120,
    linksComerciais: [
      linkFinal("app", "https://a.aliexpress.com/_appSource", app, 1),
      linkFinal("pc", "https://a.aliexpress.com/_pcSource", pc, 2)
    ]
  });
  assert.ok(mensagem.includes(`APP:*\n${app}`));
  assert.ok(mensagem.includes(`PC:*\n${pc}`));
  assert.ok(!/Resgat(?:e|ar) cupom:/i.test(mensagem));
}

try {
  testarIncidenteMercadoLivre();
  testarNaoShopeeNaoPublicaResgate();
  testarShopeeResgateConvertido();
  testarProvaShopeeAdversarial();
  testarAliExpressMantemAppPc();
  testarPapelResgateIncompativelDescartado();
} finally {
  if (dataDirAnterior === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = dataDirAnterior;
  fs.rmSync(dataDirTeste, { recursive: true, force: true });
}

console.log("source-link-resgate-marketplace: ok");
