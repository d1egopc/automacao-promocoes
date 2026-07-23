const assert = require("assert");

const radarCupomMensagem = require("../utils/radar-cupom-mensagem");
const {
  extrairEvidenciasRadarLocal,
  gerarComparacaoPassivaRadarLocal,
  normalizarPrecoBrasileiro
} = require("../modules/radar/extrator-local");

function extrair(texto, extra = {}) {
  return extrairEvidenciasRadarLocal({
    textoOriginal: texto,
    links: extra.links || [],
    marketplaceDetectado: extra.marketplaceDetectado || "",
    origemTipo: "whatsapp",
    grupoId: "grupo_teste",
    grupoNome: "Grupo Teste",
    capturadaEm: "2026-07-23T12:00:00.000Z",
    metadadosMidia: extra.metadadosMidia || null
  }, { radarCupomMensagem });
}

function assertPreco(resultado, campo, esperado, mensagem) {
  assert.strictEqual(resultado[campo].valor, esperado, mensagem);
}

function testarPrecosDePor() {
  const resultado = extrair("Produto Teste\nDe R$ 199,90 por R$ 129,90");
  assertPreco(resultado, "precoAnterior", 199.90);
  assertPreco(resultado, "precoAtual", 129.90);
  assert.strictEqual(resultado.precoAtual.confianca, "alta");
  assert.strictEqual(resultado.precoAtual.tipo, "final");
  assert.strictEqual(resultado.desconto.percentual, 35);

  const eraAgora = extrair("Produto Teste\nEra 199,90 agora 129,90");
  assertPreco(eraAgora, "precoAnterior", 199.90);
  assertPreco(eraAgora, "precoAtual", 129.90);
}

function testarPixCartaoEParcelamento() {
  const resultado = extrair("Produto Teste\nR$ 119,90 no Pix ou R$ 129,90 no cartao");
  assertPreco(resultado, "precoAtual", 119.90);
  assert.strictEqual(resultado.precoAtual.tipo, "pix");

  const parcelamento = extrair("Produto Teste\n10x de R$ 12,99");
  assert.strictEqual(parcelamento.parcelamento.quantidade, 10);
  assert.strictEqual(parcelamento.parcelamento.valorParcela, 12.99);
  assert.strictEqual(parcelamento.precoAtual.valor, null);

  const totalMaisParcela = extrair("Produto Teste\nR$ 119,90 no Pix\n10x de R$ 12,99");
  assertPreco(totalMaisParcela, "precoAtual", 119.90);
  assert.strictEqual(totalMaisParcela.parcelamento.valorParcela, 12.99);

  const parcelamentoSemDe = extrair("Produto Teste\n10x R$ 12,99 sem juros");
  assert.strictEqual(parcelamentoSemDe.parcelamento.quantidade, 10);
  assert.strictEqual(parcelamentoSemDe.parcelamento.valorParcela, 12.99);
  assert.strictEqual(parcelamentoSemDe.precoAtual.valor, null);

  const totalComParcelaSemDe = extrair("Produto Teste\nR$ 129,90 ou 10x R$ 12,99 sem juros");
  assertPreco(totalComParcelaSemDe, "precoAtual", 129.90);
  assert.strictEqual(totalComParcelaSemDe.parcelamento.quantidade, 10);
  assert.strictEqual(totalComParcelaSemDe.parcelamento.valorParcela, 12.99);
}

function testarCupons() {
  const cupomDireto = extrair("Produto Teste\nCupom: PROMO20");
  assert.strictEqual(cupomDireto.cupom.codigo, "PROMO20");
  assert.strictEqual(cupomDireto.cupom.confianca, "alta");

  const cupomPercentual = extrair("Produto Teste\nUse CASA15 e ganhe 15%");
  assert.strictEqual(cupomPercentual.cupom.codigo, "CASA15");
  assert.strictEqual(cupomPercentual.cupom.percentual, 15);

  const cupomCondicionado = extrair("Produto Teste\nCupom de R$ 20 acima de R$ 150");
  assert.strictEqual(cupomCondicionado.cupom.codigo, null);
  assert.strictEqual(cupomCondicionado.cupom.valor, 20);
  assert.strictEqual(cupomCondicionado.precoAtual.valor, null);

  const provavel = extrair("Produto Teste\ntem cupom disponivel no carrinho");
  assert.strictEqual(provavel.cupom.codigo, null);
  assert.strictEqual(provavel.cupom.confianca, "baixa");
}

function testarFreteEconomiaAmbiguidade() {
  const resultado = extrair("Produto Teste\nR$ 99,90\nFrete R$ 9,90\nEconomize R$ 50");
  assert.strictEqual(resultado.precoAtual.valor, 99.90);
  assert.strictEqual(resultado.desconto.valorEconomia, 50);

  const doisProdutos = extrair("Produto A R$ 99,90\nProduto B R$ 149,90\nhttps://loja.test/a\nhttps://loja.test/b", {
    links: ["https://loja.test/a", "https://loja.test/b"]
  });
  assert.strictEqual(doisProdutos.precoAtual.valor, null);
  assert.ok(doisProdutos.ambiguidades.some(item => item.tipo === "multiplos_precos_sem_marcador"));
}

function testarLinksShortlinkImagemTitulo() {
  const doisLinks = extrair("Produto Teste\nhttps://loja.test/a\nhttps://loja.test/b", {
    links: ["https://loja.test/a", "https://loja.test/b"],
    marketplaceDetectado: "mercadolivre"
  });
  assert.strictEqual(doisLinks.links.length, 2);
  assert.strictEqual(doisLinks.marketplace.valor, "mercadolivre");
  assert.strictEqual(doisLinks.marketplace.confianca, "alta");

  const shortlink = extrair("Produto Teste\nhttps://meli.la/abc", {
    links: ["https://meli.la/abc"]
  });
  assert.strictEqual(shortlink.marketplace.confianca, "baixa");
  assert.ok(shortlink.avisos.some(item => item.tipo === "shortlink_sem_resolucao"));

  const imagem = extrair("Produto Teste\nR$ 99,90", {
    metadadosMidia: { imagemPresente: true, referenciaInterna: "mensagem" }
  });
  assert.strictEqual(imagem.imagemMensagem.presente, true);
  assert.strictEqual(imagem.imagemMensagem.confianca, "alta");

  const promocional = extrair("corre\noferta imperdivel\naproveite");
  assert.strictEqual(promocional.titulo.valor, null);
}

function testarNormalizacaoEValidade() {
  assert.strictEqual(normalizarPrecoBrasileiro("1.299,90"), 1299.90);
  assert.strictEqual(normalizarPrecoBrasileiro("1.299"), 1299);
  assert.strictEqual(normalizarPrecoBrasileiro("129,90"), 129.90);
  assert.strictEqual(normalizarPrecoBrasileiro("129"), 129);
  assert.strictEqual(normalizarPrecoBrasileiro("-10,00"), null);

  const validade = extrair("Produto Teste\nR$ 99,90\nvalido ate 23/07");
  assert.strictEqual(validade.validade.valorTexto.toLowerCase(), "valido ate 23/07");

  const semPreco = extrair("Produto Teste\nhttps://loja.test/produto", {
    links: ["https://loja.test/produto"]
  });
  assert.strictEqual(semPreco.precoAtual.valor, null);

  const milharInteiro = extrair("Produto Teste\nPor R$ 1.299");
  assert.strictEqual(milharInteiro.precoAtual.valor, 1299);
  assert.strictEqual(milharInteiro.precoAtual.confianca, "alta");

  const inteiroMarcado = extrair("Produto Teste\nPor R$ 129");
  assert.strictEqual(inteiroMarcado.precoAtual.valor, 129);

  const inteiroIsolado = extrair("Produto incrivel 129");
  assert.strictEqual(inteiroIsolado.precoAtual.valor, null);

  const dePorInteiroMilhar = extrair("Produto Teste\nDe R$ 1.999 por R$ 1.299");
  assert.strictEqual(dePorInteiroMilhar.precoAnterior.valor, 1999);
  assert.strictEqual(dePorInteiroMilhar.precoAtual.valor, 1299);
  assert.ok(dePorInteiroMilhar.desconto.percentual > 0);
}

function testarDescontoNaoCalculavelEComparacao() {
  const resultado = extrair("Produto Teste\nDe R$ 99,90 por R$ 129,90");
  assert.strictEqual(resultado.desconto.percentual, null);
  assert.strictEqual(resultado.desconto.confianca, "ausente");

  const comparacao = gerarComparacaoPassivaRadarLocal(
    extrair("Produto Teste\nR$ 129,90\nCupom: PROMO20", { marketplaceDetectado: "shopee" }),
    { marketplace: "shopee", titulo: "Produto Teste", precoAtual: 139.90, imagem: "https://cdn.test/a.jpg" }
  );
  assert.ok(comparacao.camposDivergentes.includes("precoAtual"));
  assert.ok(comparacao.camposPreencheriamVazio.includes("cupom"));
}

function testarLimitesDefensivos() {
  const textoLongo = `${"Produto Teste R$ 99,90\n".repeat(600)}somente hoje`;
  const resultadoLongo = extrair(textoLongo);
  assert.ok(resultadoLongo.avisos.some(item => item.tipo === "texto_limitado"));
  assert.ok(resultadoLongo.ambiguidades.length <= 10);

  const muitosLinks = Array.from({ length: 40 }, (_, indice) => `https://loja.test/produto-${indice}`);
  const muitosValores = Array.from({ length: 60 }, (_, indice) => `R$ ${100 + indice},90`).join("\n");
  const resultadoMuitos = extrair(`Produto Teste\n${muitosValores}\n${muitosLinks.join("\n")}`, {
    links: muitosLinks
  });

  assert.strictEqual(resultadoMuitos.links.length, 20);
  assert.ok(resultadoMuitos.avisos.some(item => item.tipo === "links_limitados"));
  assert.ok(resultadoMuitos.ambiguidades.length <= 10);
}

testarPrecosDePor();
testarPixCartaoEParcelamento();
testarCupons();
testarFreteEconomiaAmbiguidade();
testarLinksShortlinkImagemTitulo();
testarNormalizacaoEValidade();
testarDescontoNaoCalculavelEComparacao();
testarLimitesDefensivos();

console.log("radar-extrator-local: ok");
