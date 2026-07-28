const assert = require("assert");
const {
  resolverBlocoComercialCanonico
} = require("../modules/radar/bloco-comercial-canonico");
const {
  montarOfertaRadarEspelhoComercial
} = require("../modules/radar/espelho-comercial");
const {
  prepararDadosOficiaisTemplate
} = require("../modules/templates-clientes/dados-oficiais");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");

function mirror(textoOriginal, extras = {}) {
  const linksEncontrados = extras.linksEncontrados || Array.from(textoOriginal.matchAll(/https?:\/\/[^\s]+/g)).map(match => match[0]);
  return {
    texto: { original: textoOriginal, limpo: textoOriginal },
    produto: { tituloCapturado: extras.tituloCapturado || "" },
    preco: {
      atualCapturado: extras.precoAtual ?? null,
      anteriorCapturado: extras.precoAnterior ?? null,
      confianca: "alta"
    },
    cupom: {
      codigoCapturado: extras.cupom || "",
      codigosCapturados: extras.codigosCupom || [],
      condicaoCapturada: extras.instrucaoCupom || "",
      confianca: "alta"
    },
    links: {
      encontrados: linksEncontrados,
      produtoOriginal: extras.produtoOriginal || linksEncontrados[0] || "",
      resgateCupom: extras.resgateCupom || null,
      adicionais: []
    },
    comercial: {
      links: {
        produto: extras.produtoOriginal || linksEncontrados[0] || "",
        resgate: extras.resgateCupom || null,
        classificados: extras.linksClassificados || []
      },
      cupom: {
        codigo: extras.cupom || "",
        codigos: extras.codigosCupom || [],
        instrucao: extras.instrucaoCupom || "",
        texto: extras.instrucaoCupom || extras.cupom || ""
      }
    }
  };
}

function resolver(textoOriginal, extras = {}) {
  return resolverBlocoComercialCanonico(mirror(textoOriginal, extras));
}

{
  const resultado = resolver([
    "Chapa Gloss Rose 230C Bivolt Taiff",
    "De: R$ 359,90",
    "Por: R$ 152,32",
    "Cupom: MELI26TODOSITE",
    "https://meli.la/17UvmFr"
  ].join("\n"));

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.bloco.titulo, "Chapa Gloss Rose 230C Bivolt Taiff");
  assert.strictEqual(resultado.bloco.precoAnterior, 359.9);
  assert.strictEqual(resultado.bloco.precoAtual, 152.32);
  assert.deepStrictEqual(resultado.bloco.cupons, ["MELI26TODOSITE"]);
}

{
  const resultado = resolver([
    "Chapa Gloss Rose 230C Bivolt Taiff",
    "De R$ 359,90",
    "Por R$ 152,32",
    "Cupom: MELI26TODOSITE",
    "https://meli.la/17UvmFr"
  ].join("\n"));

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.bloco.precoAnterior, 359.9);
  assert.strictEqual(resultado.bloco.precoAtual, 152.32);
}

{
  const resultado = resolver([
    "Produto Separado Por Linhas",
    "",
    "De: R$ 200,00",
    "Por: R$ 129,00",
    "",
    "Cupom: PROMO10",
    "",
    "https://meli.la/produto-separado"
  ].join("\n"));

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.bloco.titulo, "Produto Separado Por Linhas");
  assert.strictEqual(resultado.bloco.precoAtual, 129);
  assert.deepStrictEqual(resultado.bloco.cupons, ["PROMO10"]);
}

{
  const resgate = "https://s.shopee.com.br/resgate-cupom";
  const produto = "https://s.shopee.com.br/produto-real";
  const resultado = resolver([
    "Produto Shopee Oficial",
    "DE 199,90 | POR 99,90",
    "Resgate os cupons aqui:",
    resgate,
    "Produto:",
    produto
  ].join("\n"), {
    linksEncontrados: [resgate, produto],
    produtoOriginal: produto,
    resgateCupom: resgate,
    linksClassificados: [
      { link: resgate, tipo: "resgate" },
      { link: produto, tipo: "produto" }
    ]
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.bloco.links.resgate, [resgate]);
  assert.deepStrictEqual(resultado.bloco.links.produto, [produto]);
}

{
  const resgate = "https://s.shopee.com.br/cupom-real";
  const produto = "https://s.shopee.com.br/item-real";
  const resultado = resolver([
    "Produto Shopee Especial",
    "Por R$ 59,90",
    "Cupom: SHOPEE10",
    "Resgate:",
    resgate,
    "Compre:",
    produto
  ].join("\n"), {
    linksEncontrados: [resgate, produto],
    produtoOriginal: produto,
    resgateCupom: resgate,
    linksClassificados: [
      { link: resgate, tipo: "resgate" },
      { link: produto, tipo: "produto" }
    ]
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.bloco.cupons, ["SHOPEE10"]);
  assert.deepStrictEqual(resultado.bloco.links.resgate, [resgate]);
  assert.deepStrictEqual(resultado.bloco.links.produto, [produto]);
}

{
  const resultado = resolver([
    "Produto Multicondicao",
    "Por R$ 100,00",
    "",
    "ou 5x de R$ 20,00 sem juros",
    "",
    "R$ 90,00 no Pix",
    "",
    "https://meli.la/pix-parcela"
  ].join("\n"));

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.bloco.precoAtual, 100);
  assert.ok(resultado.bloco.condicoes.pix.includes("Pix"));
  assert.ok(resultado.bloco.condicoes.parcelamento.includes("5x"));
}

{
  const resultado = resolver([
    "Produto Entrega Especial",
    "Por R$ 88,00",
    "",
    "Frete gratis para todo Brasil",
    "",
    "https://meli.la/frete"
  ].join("\n"));

  assert.strictEqual(resultado.ok, true);
  assert.ok(resultado.bloco.condicoes.frete.toLowerCase().includes("frete"));
}

{
  const resultado = resolver([
    "Produto Com Dois Cupons",
    "Por R$ 150,00",
    "Cupom: MODALIVRE ou MODAPRAVC",
    "https://meli.la/cupons"
  ].join("\n"));

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.bloco.cupons, ["MODALIVRE", "MODAPRAVC"]);
}

{
  const resultado = resolver([
    "CORRE QUE ESTA BARATO",
    "iPhone 15 128 GB",
    "De: R$ 8.000,00",
    "Por: R$ 5.999,00",
    "https://meli.la/iphone15"
  ].join("\n"));

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.bloco.titulo, "iPhone 15 128 GB");
}

{
  const resultado = resolver([
    "Produto A",
    "R$ 100,00",
    "https://meli.la/a",
    "",
    "Produto B",
    "R$ 200,00",
    "https://meli.la/b"
  ].join("\n"));

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "multiplos_blocos_comerciais");
}

{
  const resultado = resolver([
    "Produto Sem Preco",
    "Cupom: SEMPRECO",
    "https://meli.la/sem-preco"
  ].join("\n"));

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "titulo_sem_preco");
}

{
  const resultado = resolver([
    "Tirei hoje no supermercado",
    "Por R$ 29,00",
    "https://meli.la/preco-sem-produto"
  ].join("\n"));

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "preco_sem_produto");
}

{
  const resgate = "https://s.shopee.com.br/resgate-sem-produto";
  const resultado = resolver([
    "Produto Apenas Com Resgate",
    "Por R$ 49,90",
    "Resgate o cupom aqui:",
    resgate
  ].join("\n"), {
    linksEncontrados: [resgate],
    resgateCupom: resgate,
    linksClassificados: [{ link: resgate, tipo: "resgate" }]
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "produto_sem_link");
}

{
  const resultado = resolver([
    "OLHA ISSO",
    "",
    "Produto Com Comentarios Extras",
    "Por R$ 79,90",
    "https://meli.la/comentarios",
    "",
    "Aproveita antes que acabe"
  ].join("\n"));

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.bloco.titulo, "Produto Com Comentarios Extras");
  assert.strictEqual(resultado.bloco.precoAtual, 79.9);
}

{
  const resultado = resolver([
    "Produto Sem Token Tecnico",
    "Por R$ 44,00",
    "Aplique o cupom de 10% OFF no anuncio",
    "https://meli.la/sem-token"
  ].join("\n"));

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.bloco.cupons, []);
}

{
  const textoOriginal = [
    "Chapa Gloss Rose 230C Bivolt Taiff",
    "De: R$ 359,90",
    "Por: R$ 152,32 (Com Cupom)",
    "Cupom: MELI26TODOSITE",
    "https://meli.la/17UvmFr"
  ].join("\n");
  const resultado = montarOfertaRadarEspelhoComercial({
    radarMirror: mirror(textoOriginal, {
      tituloCapturado: "Chapa Gloss Rose 230C Bivolt Taiff",
      precoAtual: 152.32,
      precoAnterior: 359.9,
      cupom: "MELI26TODOSITE",
      codigosCupom: ["MELI26TODOSITE"],
      produtoOriginal: "https://meli.la/17UvmFr"
    }),
    ofertaImportador: {
      marketplace: "mercadolivre",
      titulo: "Titulo divergente do importador",
      precoAtual: 999.99,
      precoOriginal: 1200,
      linkResolvido: "https://www.mercadolivre.com.br/p/MLB123"
    },
    metadata: {},
    clienteId: "admin",
    marketplace: "mercadolivre",
    resolucao: {
      urlCapturada: "https://meli.la/17UvmFr",
      linkOriginalRadar: "https://meli.la/17UvmFr"
    },
    contexto: { correlationId: "radar_bloco_canonico_fluxo" }
  });
  const dados = prepararDadosOficiaisTemplate(resultado.oferta, { modo: "universal" });
  const mensagem = montarMensagemOferta(resultado.oferta);

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.oferta.titulo, "Chapa Gloss Rose 230C Bivolt Taiff");
  assert.strictEqual(resultado.oferta.precoAtual, 152.32);
  assert.strictEqual(resultado.oferta.precoOriginal, 359.9);
  assert.deepStrictEqual(resultado.oferta.codigosCupom, ["MELI26TODOSITE"]);
  assert.strictEqual(dados.precoAtual, 152.32);
  assert.ok(mensagem.includes("MELI26TODOSITE"));
  assert.ok(mensagem.includes("152,32"));
}

console.log("bloco-comercial-canonico.test.js OK");
