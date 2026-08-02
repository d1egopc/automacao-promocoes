"use strict";

const assert = require("assert");
const {
  WORKSPACE_D1EGOPC_OFICIAL,
  obterConfiguracaoEspelhoPiloto,
  selecionarTemplateEspelhoPiloto,
  selecionarImagemEspelhoPiloto
} = require("../modules/ofc-v2/espelho-piloto");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");
const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");

const WORKSPACE_D1 = "user_40qdblgt";
const WORKSPACE_ROGER = "user_9hqs434h";
const WORKSPACE_WOLF = "user_n0o5p99m";

function capturarLogs(fn) {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.map(String).join(" "));
  try {
    const retorno = fn();
    return { retorno, logs };
  } finally {
    console.log = originalLog;
  }
}

function metadataEspelho({ mensagem, imagemComercial = {}, espelhoExtra = {}, documentoComercialCanonico = null } = {}) {
  const espelhoComercial = {
    marketplace: "mercadolivre",
    precoPorTexto: "R$ 73,79",
    precoDeTexto: "R$ 299,99",
    formaPagamentoTexto: "Pix",
    cupomCodigo: "FASHIONML",
    instrucaoComercial: "Aplique o cupom FASHIONML + Pix para chegar neste valor.",
    linkProdutoOriginal: "https://meli.la/produto",
    linkResgateOriginal: null,
    linkAfiliado: "https://afiliado.test/produto",
    ...espelhoExtra
  };
  if (documentoComercialCanonico) espelhoComercial.documentoComercialCanonico = documentoComercialCanonico;
  return {
    ofcV24: {
      espelhoComercial,
      documentoComercialCanonico,
      templateEspelhoShadow: {
        ok: true,
        modo: "shadow",
        aplicouMudancas: false,
        mensagem,
        linhas: String(mensagem || "").split(/\n\n/).filter(Boolean).length
      },
      imagemComercial: {
        urlSelecionada: "https://cdn.marketplace.test/produto-limpo.jpg",
        origemSelecionada: "canonical.product.image",
        imagemOficial: true,
        imagemLimpa: true,
        possuiMarcaFonte: false,
        ...imagemComercial
      }
    }
  };
}

function ofertaBase(workspaceId = WORKSPACE_D1, metadata = metadataEspelho({ mensagem: mensagemMlCompleta() })) {
  return {
    id: 901,
    job_id: 1901,
    clienteId: workspaceId,
    cliente_id: workspaceId,
    marketplace: "mercadolivre",
    titulo: "Titulo produtivo atual",
    nome: "Titulo produtivo atual",
    preco: 120.5,
    precoAtual: 120.5,
    precoOriginal: 299.99,
    linkAfiliado: "https://afiliado.test/produto",
    linkFinal: "https://afiliado.test/produto",
    link: "https://afiliado.test/produto",
    categoria: "geral",
    metadata
  };
}

function mensagemMlCompleta() {
  return [
    "Bolsa Esportiva adidas Preto",
    "De: R$ 299,99\nPor: R$ 73,79 no Pix",
    "Cupom: FASHIONML",
    "Confira aqui: https://afiliado.test/produto",
    "Aplique o cupom FASHIONML + Pix para chegar neste valor."
  ].join("\n\n");
}

function blocoCanonico(tipo, textoOriginal, extras = {}) {
  return {
    tipo,
    textoOriginal,
    valorEstruturado: extras.valorEstruturado || (String(textoOriginal || "").startsWith("http") ? { url: textoOriginal } : null),
    origem: extras.origem || "fixture",
    confianca: extras.confianca || "alta",
    essencial: extras.essencial === true,
    requisitos: extras.requisitos || [],
    ordemSugerida: extras.ordemSugerida || 10,
    visibilidadePadrao: extras.visibilidadePadrao || (extras.essencial ? "obrigatorio" : "padrao"),
    dedupeKey: extras.dedupeKey || `${tipo}:${String(textoOriginal || "").toLowerCase()}`,
    avisos: extras.avisos || [],
    metadata: extras.metadata || {}
  };
}

function documentoComBlocos(blocos, extra = {}) {
  return {
    tituloOriginal: "Oferta por blocos",
    marketplace: "mercadolivre",
    precoPorTexto: "R$ 73,79 via Pix",
    linkAfiliado: "https://afiliado.test/produto",
    confianca: { motivos: ["texto_comercial_capturado"] },
    avisos: [],
    blocos,
    ...extra
  };
}

const configD1 = obterConfiguracaoEspelhoPiloto(WORKSPACE_D1);
assert.strictEqual(configD1.ativo, true);
assert.strictEqual(configD1.workspaceId, WORKSPACE_D1EGOPC_OFICIAL);
assert.strictEqual(obterConfiguracaoEspelhoPiloto(WORKSPACE_ROGER).ativo, false);
assert.strictEqual(obterConfiguracaoEspelhoPiloto(WORKSPACE_WOLF).ativo, false);

{
  const { retorno, logs } = capturarLogs(() => selecionarTemplateEspelhoPiloto({
    workspaceId: WORKSPACE_D1,
    oferta: ofertaBase(),
    mensagemAtual: "mensagem atual"
  }));
  assert.strictEqual(retorno.usarEspelho, true);
  assert.strictEqual(retorno.mensagem, mensagemMlCompleta());
  assert(logs.some(linha => linha.includes("[OFC-V2.4-ESPELHO-PILOTO-ATIVO]")));
  assert(logs.some(linha => linha.includes("[OFC-V2.4-TEMPLATE-ESPELHO-SELECIONADO]")));
  assert(!logs.join("\n").includes("Aplique o cupom FASHIONML"), "logs nao devem expor texto completo");
}

{
  const invalida = ofertaBase(WORKSPACE_D1, metadataEspelho({ mensagem: "Produto\n\nundefined" }));
  const { retorno, logs } = capturarLogs(() => selecionarTemplateEspelhoPiloto({
    workspaceId: WORKSPACE_D1,
    oferta: invalida,
    mensagemAtual: "mensagem atual"
  }));
  assert.strictEqual(retorno.usarEspelho, false);
  assert.strictEqual(retorno.mensagem, "mensagem atual");
  assert(logs.some(linha => linha.includes("[OFC-V2.4-TEMPLATE-ATUAL-FALLBACK]")));
}

{
  const roger = selecionarTemplateEspelhoPiloto({ workspaceId: WORKSPACE_ROGER, oferta: ofertaBase(WORKSPACE_ROGER), mensagemAtual: "atual" });
  const wolf = selecionarTemplateEspelhoPiloto({ workspaceId: WORKSPACE_WOLF, oferta: ofertaBase(WORKSPACE_WOLF), mensagemAtual: "atual" });
  assert.strictEqual(roger.usarEspelho, false);
  assert.strictEqual(wolf.usarEspelho, false);
  assert.strictEqual(roger.motivo, "workspace_fora_do_piloto");
  assert.strictEqual(wolf.motivo, "workspace_fora_do_piloto");
}

{
  const ofertaFalha = Object.defineProperty({ clienteId: WORKSPACE_D1, marketplace: "mercadolivre" }, "metadata", {
    get() { throw new Error("falha_controlada_metadata"); }
  });
  const { retorno, logs } = capturarLogs(() => selecionarTemplateEspelhoPiloto({
    workspaceId: WORKSPACE_D1,
    oferta: ofertaFalha,
    mensagemAtual: "mensagem atual"
  }));
  assert.strictEqual(retorno.usarEspelho, false);
  assert.strictEqual(retorno.mensagem, "mensagem atual");
  assert.strictEqual(retorno.motivo, "erro_selecao_template_espelho");
  assert(logs.some(linha => linha.includes("[OFC-V2.4-ESPELHO-PILOTO-ERRO]")));
}

{
  const { retorno: mensagem } = capturarLogs(() => montarMensagemOferta(ofertaBase(), { clienteId: WORKSPACE_D1 }));
  assert.strictEqual(mensagem, mensagemMlCompleta());
}

{
  const simples = ofertaBase(WORKSPACE_D1, metadataEspelho({
    mensagem: ["Oferta simples", "Por: R$ 79,90", "Confira aqui: https://afiliado.test/simples"].join("\n\n"),
    espelhoExtra: { precoDeTexto: null, precoPorTexto: "R$ 79,90", cupomCodigo: null, instrucaoComercial: null }
  }));
  const { retorno: mensagem } = capturarLogs(() => montarMensagemOferta(simples, { clienteId: WORKSPACE_D1 }));
  assert(mensagem.includes("Por: R$ 79,90"));
  assert(!mensagem.includes("De:"));
  assert(!mensagem.includes("Cupom:"));
}

{
  const documento = {
    tituloOriginal: "Oferta adaptativa D1",
    precoDeTexto: "R$ 299,99",
    precoPorTexto: "R$ 73,79 via Pix",
    cupomTexto: "FASHIONML",
    instrucaoTexto: "Aplique o cupom FASHIONML + Pix para chegar neste valor.",
    linkAfiliado: "https://afiliado.test/produto",
    marketplace: "mercadolivre",
    confianca: { motivos: ["cupom_explicito"] }
  };
  const ofertaAdaptativa = ofertaBase(WORKSPACE_D1, metadataEspelho({
    mensagem: "mensagem antiga nao deve ser prioridade",
    documentoComercialCanonico: documento
  }));
  const destino = {
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "marketplace", ativo: false, ordem: 20 },
        { tipo: "preco_de", ativo: true, ordem: 30 },
        { tipo: "preco_por", ativo: true, ordem: 40 },
        { tipo: "cupom", ativo: false, ordem: 50 },
        { tipo: "frase_cupom", ativo: true, ordem: 60 },
        { tipo: "link", ativo: true, ordem: 70 }
      ]
    }
  };
  const { retorno } = capturarLogs(() => selecionarTemplateEspelhoPiloto({
    workspaceId: WORKSPACE_D1,
    oferta: ofertaAdaptativa,
    destino,
    mensagemAtual: "mensagem atual"
  }));
  assert.strictEqual(retorno.usarEspelho, true);
  assert.strictEqual(retorno.motivo, "documento_canonico_adaptativo_valido");
  assert.ok(retorno.mensagem.includes("Oferta adaptativa D1"));
  assert.ok(retorno.mensagem.includes("De: R$ 299,99"));
  assert.ok(retorno.mensagem.includes("Por: R$ 73,79 via Pix"));
  assert.ok(retorno.mensagem.includes("Aplique o cupom FASHIONML + Pix"));
  assert.ok(retorno.mensagem.includes("Cupom: FASHIONML"), "cupom confiavel e obrigatorio mesmo com toggle desligado");
  assert.ok(!retorno.mensagem.includes("Marketplace:"), "toggle de marketplace desligado e respeitado");
  assert.ok(!retorno.mensagem.includes("mensagem antiga"), "documento canonico tem prioridade sobre template antigo");
}

{
  const documento = documentoComBlocos([
    blocoCanonico("titulo", "Bolsa Esportiva adidas Preto", { ordemSugerida: 10, essencial: true }),
    blocoCanonico("marketplace", "mercadolivre", { ordemSugerida: 20 }),
    blocoCanonico("preco_referencia", "R$ 299,99", { ordemSugerida: 40 }),
    blocoCanonico("preco_oferta", "R$ 73,79 via Pix", { ordemSugerida: 50, essencial: true }),
    blocoCanonico("cupom_codigo", "FASHIONML", { ordemSugerida: 80, essencial: true }),
    blocoCanonico("instrucao_cupom", "Aplique o cupom FASHIONML + Pix para chegar neste valor.", { ordemSugerida: 90 }),
    blocoCanonico("link_afiliado", "https://afiliado.test/produto", { ordemSugerida: 140, essencial: true })
  ]);
  const ofertaBlocos = ofertaBase(WORKSPACE_D1, metadataEspelho({
    mensagem: "mensagem plana antiga",
    documentoComercialCanonico: documento
  }));
  const { retorno, logs } = capturarLogs(() => selecionarTemplateEspelhoPiloto({
    workspaceId: WORKSPACE_D1,
    oferta: ofertaBlocos,
    destino: { template: { blocos: [{ tipo: "cupom", ativo: false, ordem: 80 }, { tipo: "frase_cupom", ativo: true, ordem: 90 }] } },
    mensagemAtual: "mensagem atual"
  }));
  assert.strictEqual(retorno.usarEspelho, true);
  assert.strictEqual(retorno.motivo, "documento_canonico_blocos_v26_valido");
  assert(retorno.mensagem.includes("🔥 Bolsa Esportiva adidas Preto"));
  assert(retorno.mensagem.includes("🛍️ Mercado Livre"));
  assert(retorno.mensagem.includes("❌ De: R$ 299,99"));
  assert(retorno.mensagem.includes("✅ Por: R$ 73,79 via Pix"));
  assert(retorno.mensagem.includes("🎟️ Cupom: FASHIONML"), "cupom essencial sobrevive ao toggle desligado");
  assert(retorno.mensagem.includes("⚡ Aplique o cupom FASHIONML + Pix para chegar neste valor."));
  assert.strictEqual((retorno.mensagem.match(/Confira aqui/g) || []).length, 1);
  assert(!/\b(?:undefined|null|NaN|Infinity)\b/.test(retorno.mensagem));
  assert(logs.some(linha => linha.includes("[OFC-V2.6-COMPOSITOR-BLOCOS-SELECIONADO]")));
  assert(!logs.join("\n").includes("FASHIONML"), "log v2.6 nao deve expor cupom/texto");
}

{
  const documento = documentoComBlocos([
    blocoCanonico("titulo", "Produto Mercado Livre Pix", { ordemSugerida: 10, essencial: true }),
    blocoCanonico("preco_oferta", "R$ 64,44", { ordemSugerida: 50, essencial: true }),
    blocoCanonico("preco_pix", "R$ 61,22 no Pix", { ordemSugerida: 55, essencial: true }),
    blocoCanonico("link_afiliado", "https://afiliado.test/ml-pix", { ordemSugerida: 140, essencial: true })
  ], { precoPorTexto: "R$ 64,44", precoPixTexto: "R$ 61,22 no Pix", linkAfiliado: "https://afiliado.test/ml-pix" });
  const ofertaPix = ofertaBase(WORKSPACE_D1, metadataEspelho({ mensagem: "mensagem antiga", documentoComercialCanonico: documento }));
  const { retorno } = capturarLogs(() => selecionarTemplateEspelhoPiloto({ workspaceId: WORKSPACE_D1, oferta: ofertaPix, mensagemAtual: "atual" }));
  assert(retorno.mensagem.includes("✅ Por: R$ 64,44"));
  assert(retorno.mensagem.includes("⚡ Pix: R$ 61,22 no Pix"));
}

{
  const documento = documentoComBlocos([
    blocoCanonico("titulo", "Produto Shopee com resgate", { ordemSugerida: 10, essencial: true }),
    blocoCanonico("marketplace", "shopee", { ordemSugerida: 20 }),
    blocoCanonico("preco_oferta", "R$ 89,90", { ordemSugerida: 50, essencial: true }),
    blocoCanonico("link_resgate", "https://s.shopee.com.br/resgate", { ordemSugerida: 120, essencial: true }),
    blocoCanonico("link_afiliado", "https://shopee.afiliado/produto?lp=aff", { ordemSugerida: 140, essencial: true })
  ], {
    marketplace: "shopee",
    precoPorTexto: "R$ 89,90",
    linkResgateOriginal: "https://s.shopee.com.br/resgate",
    linkAfiliado: "https://shopee.afiliado/produto?lp=aff"
  });
  const ofertaShopee = ofertaBase(WORKSPACE_D1, metadataEspelho({ mensagem: "mensagem antiga", documentoComercialCanonico: documento }));
  ofertaShopee.marketplace = "shopee";
  const { retorno } = capturarLogs(() => selecionarTemplateEspelhoPiloto({ workspaceId: WORKSPACE_D1, oferta: ofertaShopee, mensagemAtual: "atual" }));
  assert(retorno.mensagem.includes("🎟️ Resgate:\nhttps://s.shopee.com.br/resgate"));
  assert(retorno.mensagem.includes("🔗 Confira aqui:\nhttps://shopee.afiliado/produto?lp=aff"));
  assert(retorno.mensagem.indexOf("Resgate:") < retorno.mensagem.indexOf("Confira aqui:"));
}

{
  const documento = documentoComBlocos([
    blocoCanonico("titulo", "Produto Shopee unico", { ordemSugerida: 10, essencial: true }),
    blocoCanonico("preco_oferta", "R$ 79,90", { ordemSugerida: 50, essencial: true }),
    blocoCanonico("link_afiliado", "https://shopee.afiliado/unico?lp=aff", { ordemSugerida: 140, essencial: true })
  ], { marketplace: "shopee", precoPorTexto: "R$ 79,90", linkAfiliado: "https://shopee.afiliado/unico?lp=aff" });
  const ofertaShopee = ofertaBase(WORKSPACE_D1, metadataEspelho({ mensagem: "mensagem antiga", documentoComercialCanonico: documento }));
  ofertaShopee.marketplace = "shopee";
  const { retorno } = capturarLogs(() => selecionarTemplateEspelhoPiloto({ workspaceId: WORKSPACE_D1, oferta: ofertaShopee, mensagemAtual: "atual" }));
  assert(retorno.mensagem.includes("Confira aqui:\nhttps://shopee.afiliado/unico?lp=aff"));
  assert(!retorno.mensagem.includes("Resgate:"));
}

{
  const documento = documentoComBlocos([
    blocoCanonico("titulo", "Shopee com produtos ambiguos", { ordemSugerida: 10, essencial: true }),
    blocoCanonico("preco_oferta", "R$ 59,90", { ordemSugerida: 50, essencial: true }),
    blocoCanonico("link_resgate", "https://s.shopee.com.br/resgate", { ordemSugerida: 120, essencial: true }),
    blocoCanonico("links_produto_alternativos", "https://s.shopee.com.br/produto-a", { ordemSugerida: 130, avisos: ["links_produto_ambiguos"] }),
    blocoCanonico("links_produto_alternativos", "https://s.shopee.com.br/produto-b", { ordemSugerida: 131, avisos: ["links_produto_ambiguos"] })
  ], {
    marketplace: "shopee",
    linkAfiliado: "",
    avisos: ["links_produto_ambiguos"]
  });
  const ofertaAmbigua = ofertaBase(WORKSPACE_D1, metadataEspelho({ mensagem: "template plano seguro", documentoComercialCanonico: documento }));
  ofertaAmbigua.marketplace = "shopee";
  const { retorno, logs } = capturarLogs(() => selecionarTemplateEspelhoPiloto({
    workspaceId: WORKSPACE_D1,
    oferta: ofertaAmbigua,
    mensagemAtual: "mensagem atual"
  }));
  assert.notStrictEqual(retorno.motivo, "documento_canonico_blocos_v26_valido");
  assert(!retorno.mensagem.includes("produto-a"));
  assert(!retorno.mensagem.includes("produto-b"));
  assert(logs.some(linha => linha.includes("[OFC-V2.6-COMPOSITOR-BLOCOS-FALLBACK]")));
}

{
  const documento = documentoComBlocos([
    blocoCanonico("titulo", "Oferta AliExpress APP PC", { ordemSugerida: 10, essencial: true }),
    blocoCanonico("marketplace", "aliexpress", { ordemSugerida: 20 }),
    blocoCanonico("preco_oferta", "US$ 19.99", { ordemSugerida: 50, essencial: true }),
    blocoCanonico("moedas", "Moedas disponiveis", { ordemSugerida: 80 }),
    blocoCanonico("link_moedas", "https://s.click.aliexpress.com/moedas", { ordemSugerida: 90, essencial: true }),
    blocoCanonico("link_app", "https://s.click.aliexpress.com/app", { ordemSugerida: 110, essencial: true, dedupeKey: "link_app:ali-app" }),
    blocoCanonico("link_app", "https://s.click.aliexpress.com/app", { ordemSugerida: 111, essencial: true, dedupeKey: "link_app:ali-app" }),
    blocoCanonico("link_pc", "https://s.click.aliexpress.com/pc", { ordemSugerida: 120, essencial: true }),
    blocoCanonico("link_afiliado", "https://s.click.aliexpress.com/oficial", { ordemSugerida: 140, essencial: true })
  ], { marketplace: "aliexpress", precoPorTexto: "US$ 19.99", linkAfiliado: "https://s.click.aliexpress.com/oficial" });
  const ofertaAli = ofertaBase(WORKSPACE_D1, metadataEspelho({ mensagem: "mensagem antiga", documentoComercialCanonico: documento }));
  ofertaAli.marketplace = "aliexpress";
  const { retorno } = capturarLogs(() => selecionarTemplateEspelhoPiloto({ workspaceId: WORKSPACE_D1, oferta: ofertaAli, mensagemAtual: "atual" }));
  assert(retorno.mensagem.includes("🪙 Moedas disponiveis"));
  assert.strictEqual((retorno.mensagem.match(/APP:/g) || []).length, 1);
  assert(retorno.mensagem.includes("🖥️ PC:\nhttps://s.click.aliexpress.com/pc"));
  assert(retorno.mensagem.includes("🔗 Confira aqui:\nhttps://s.click.aliexpress.com/oficial"));
}

{
  const documento = documentoComBlocos([
    blocoCanonico("titulo", "Amazon RTX 5060 Ti", { ordemSugerida: 10, essencial: true }),
    blocoCanonico("marketplace", "amazon", { ordemSugerida: 20 }),
    blocoCanonico("preco_oferta", "R$ 2.499 no Pix", { ordemSugerida: 50, essencial: true }),
    blocoCanonico("parcelamento", "10x de R$ 317,70 sem juros", { ordemSugerida: 60 }),
    blocoCanonico("cupom_codigo", "EBACUPOM", { ordemSugerida: 80, essencial: true }),
    blocoCanonico("cupom_sem_codigo", "Resgate cupom no anuncio", { ordemSugerida: 82 }),
    blocoCanonico("instrucao_cupom", "Resgate no anuncio", { ordemSugerida: 90 }),
    blocoCanonico("link_afiliado", "https://amzn.to/produto", { ordemSugerida: 140, essencial: true })
  ], { marketplace: "amazon", precoPorTexto: "R$ 2.499 no Pix", linkAfiliado: "https://amzn.to/produto" });
  const ofertaAmazon = ofertaBase(WORKSPACE_D1, metadataEspelho({ mensagem: "mensagem antiga", documentoComercialCanonico: documento }));
  ofertaAmazon.marketplace = "amazon";
  const { retorno } = capturarLogs(() => selecionarTemplateEspelhoPiloto({ workspaceId: WORKSPACE_D1, oferta: ofertaAmazon, mensagemAtual: "atual" }));
  assert(retorno.mensagem.includes("💳 10x de R$ 317,70 sem juros"));
  assert(retorno.mensagem.includes("🎟️ Cupom: EBACUPOM"));
  assert(!retorno.mensagem.includes("Resgate:\nhttps://amzn"));
}

{
  const documento = documentoComBlocos([
    blocoCanonico("titulo", "Fonte KaBuM XPG", { ordemSugerida: 10, essencial: true }),
    blocoCanonico("marketplace", "kabum", { ordemSugerida: 20 }),
    blocoCanonico("preco_oferta", "R$ 415,00", { ordemSugerida: 50, essencial: true }),
    blocoCanonico("garantia", "Garantia de 10 anos", { ordemSugerida: 90 }),
    blocoCanonico("frete", "Frete varia por estado", { ordemSugerida: 100 }),
    blocoCanonico("link_auxiliar", "https://youtu.be/video-review", { ordemSugerida: 120 }),
    blocoCanonico("link_afiliado", "https://www.awin1.com/produto", { ordemSugerida: 140, essencial: true })
  ], { marketplace: "kabum", precoPorTexto: "R$ 415,00", linkAfiliado: "https://www.awin1.com/produto" });
  const ofertaKabum = ofertaBase(WORKSPACE_D1, metadataEspelho({ mensagem: "mensagem antiga", documentoComercialCanonico: documento }));
  ofertaKabum.marketplace = "kabum";
  const { retorno } = capturarLogs(() => selecionarTemplateEspelhoPiloto({ workspaceId: WORKSPACE_D1, oferta: ofertaKabum, mensagemAtual: "atual" }));
  assert(retorno.mensagem.includes("🛡️ Garantia de 10 anos"));
  assert(retorno.mensagem.includes("🚚 Frete varia por estado"));
  assert(!retorno.mensagem.includes("youtu.be"), "link auxiliar sem toggle especifico nao vira CTA");
}

{
  const documento = documentoComBlocos([
    blocoCanonico("titulo", "Oferta com bloco desconhecido", { ordemSugerida: 10, essencial: true }),
    blocoCanonico("preco_oferta", "R$ 99,90", { ordemSugerida: 50, essencial: true }),
    blocoCanonico("bloco_novo_futuro", "Nao renderizar", { ordemSugerida: 60 }),
    blocoCanonico("link_afiliado", "https://afiliado.test/desconhecido", { ordemSugerida: 140, essencial: true })
  ], { precoPorTexto: "R$ 99,90", linkAfiliado: "https://afiliado.test/desconhecido" });
  const ofertaDesconhecida = ofertaBase(WORKSPACE_D1, metadataEspelho({ mensagem: "mensagem antiga", documentoComercialCanonico: documento }));
  const { retorno } = capturarLogs(() => selecionarTemplateEspelhoPiloto({ workspaceId: WORKSPACE_D1, oferta: ofertaDesconhecida, mensagemAtual: "atual" }));
  assert(retorno.mensagem.includes("Oferta com bloco desconhecido"));
  assert(!retorno.mensagem.includes("Nao renderizar"));
}

{
  const documento = documentoComBlocos([], { linkAfiliado: "" });
  const ofertaInvalida = ofertaBase(WORKSPACE_D1, metadataEspelho({
    mensagem: "template plano preservado",
    documentoComercialCanonico: documento
  }));
  const { retorno, logs } = capturarLogs(() => selecionarTemplateEspelhoPiloto({
    workspaceId: WORKSPACE_D1,
    oferta: ofertaInvalida,
    mensagemAtual: "mensagem atual"
  }));
  assert.notStrictEqual(retorno.motivo, "documento_canonico_blocos_v26_valido");
  assert(logs.some(linha => linha.includes("[OFC-V2.4-TEMPLATE-ESPELHO-SELECIONADO]")));
}

{
  const shopee = ofertaBase(WORKSPACE_D1, metadataEspelho({
    mensagem: [
      "Produto Shopee",
      "Por: R$ 89,90",
      "Resgate os cupons: https://s.shopee.com.br/resgate",
      "Confira aqui: https://shopee.afiliado/produto",
      "Resgate todos os cupons desta pagina"
    ].join("\n\n"),
    espelhoExtra: {
      marketplace: "shopee",
      linkResgateOriginal: "https://s.shopee.com.br/resgate",
      linkAfiliado: "https://shopee.afiliado/produto",
      cupomCodigo: null,
      instrucaoComercial: "Resgate todos os cupons desta pagina"
    }
  }));
  shopee.marketplace = "shopee";
  const { retorno: mensagem } = capturarLogs(() => montarMensagemOferta(shopee, { clienteId: WORKSPACE_D1 }));
  assert(mensagem.includes("Resgate os cupons: https://s.shopee.com.br/resgate"));
  assert(mensagem.includes("Confira aqui: https://shopee.afiliado/produto"));
  assert(!mensagem.includes("TODOS"));
  assert(mensagem.indexOf("Resgate os cupons") < mensagem.indexOf("Confira aqui"));
}

{
  const cashback = ofertaBase(WORKSPACE_D1, metadataEspelho({
    mensagem: ["Produto Cashback", "Por: R$ 100,00", "Beneficio: R$ 10 de cashback", "Confira aqui: https://afiliado.test/cashback"].join("\n\n"),
    espelhoExtra: { condicoesComerciais: ["R$ 10 de cashback"], precoPorTexto: "R$ 100,00", precoFinalTexto: null }
  }));
  const { retorno: mensagem } = capturarLogs(() => montarMensagemOferta(cashback, { clienteId: WORKSPACE_D1 }));
  assert(mensagem.includes("Beneficio: R$ 10 de cashback"));
  assert(!mensagem.includes("R$ 90"));
}

{
  const estrangeira = ofertaBase(WORKSPACE_D1, metadataEspelho({
    mensagem: ["Produto importado", "Por: US$ 19.99", "Cupom: ALI5", "Confira aqui: https://ali.afiliado/produto"].join("\n\n"),
    espelhoExtra: { marketplace: "aliexpress", precoPorTexto: "US$ 19.99", cupomCodigo: "ALI5" }
  }));
  const { retorno: mensagem } = capturarLogs(() => montarMensagemOferta(estrangeira, { clienteId: WORKSPACE_D1 }));
  assert(mensagem.includes("US$ 19.99"));
  assert(!mensagem.includes("R$ 19,99"));
}

{
  const ofertaImagemSegura = ofertaBase(WORKSPACE_D1, metadataEspelho({ mensagem: mensagemMlCompleta() }));
  ofertaImagemSegura.cliente_id = WORKSPACE_D1;
  ofertaImagemSegura.imagem = "https://cdn.atual.test/produtivo.jpg";
  ofertaImagemSegura.imagemOrigem = "engine_ofertas.imagem";
  const item = montarItemFilaEngine(ofertaImagemSegura);
  assert.strictEqual(item.imagem, "https://cdn.marketplace.test/produto-limpo.jpg");
  assert.strictEqual(item.imagemEspelhoPiloto.aplicada, true);

  const ofertaImagemInsegura = ofertaBase(WORKSPACE_D1, metadataEspelho({
    mensagem: mensagemMlCompleta(),
    imagemComercial: {
      urlSelecionada: "https://grupo.test/logo-whatsapp.jpg",
      imagemOficial: false,
      imagemLimpa: false,
      possuiMarcaFonte: true
    }
  }));
  ofertaImagemInsegura.cliente_id = WORKSPACE_D1;
  ofertaImagemInsegura.imagem = "https://cdn.atual.test/produtivo.jpg";
  const itemInseguro = montarItemFilaEngine(ofertaImagemInsegura);
  assert.strictEqual(itemInseguro.imagem, "https://cdn.atual.test/produtivo.jpg");
  assert.strictEqual(itemInseguro.imagemEspelhoPiloto.aplicada, false);
}

{
  const d1 = selecionarImagemEspelhoPiloto({ workspaceId: WORKSPACE_D1, oferta: ofertaBase(), imagemAtual: "https://atual.test/img.jpg" });
  const roger = selecionarImagemEspelhoPiloto({ workspaceId: WORKSPACE_ROGER, oferta: ofertaBase(WORKSPACE_ROGER), imagemAtual: "https://atual.test/img.jpg" });
  assert.strictEqual(d1.usarImagemEspelho, true);
  assert.strictEqual(roger.usarImagemEspelho, false);
}

console.log("ofc-v24-espelho-piloto.test.js OK");
