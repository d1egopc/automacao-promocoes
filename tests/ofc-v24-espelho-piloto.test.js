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
