const assert = require("assert");

const { gerarTemplateUniversal } = require("../modules/template-universal");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");

const estrelas = (n) => "\u2B50".repeat(n);
const possuiLinha = (texto, linha) => String(texto).split(/\r?\n/).some(item => item.trim() === linha);

function indice(texto, trecho) {
  const pos = texto.indexOf(trecho);
  assert.ok(pos >= 0, `mensagem deve conter: ${trecho}`);
  return pos;
}

const ofertaBase = {
  titulo: "Produto Clone Visual",
  marketplace: "AliExpress",
  textoOriginal: "Produto Clone Visual\nPor R$ 140,00\nR$ 137,00 no Pix\n10x de R$ 14,00\nCupom: RADAR10\nFrete gratis",
  categoria: "Diversos",
  precoOriginal: 210,
  precoAtual: 140,
  precoPix: "R$ 137,00 no Pix",
  descontoPercentual: 33,
  parcelamento: "10x de R$ 14,00",
  cupom: "RADAR10",
  instrucaoCupom: "Aplique o cupom no carrinho.",
  beneficioTexto: "Frete gratis",
  beneficios: ["Frete gratis"],
  freteGratis: true,
  avaliacao: "4,8/5",
  quantidadeAvaliacoes: 1234,
  score: 99,
  avisoFinal: "Aviso customizado final.",
  linkAfiliado: "https://ali.workspace/produto",
  linksComerciais: [
    { tipo: "app", papel: "link_app", ordemCaptura: 1, urlAfiliada: "https://go.optimus/same", urlOptimus: "https://go.optimus/same" },
    { tipo: "app", papel: "link_app", ordemCaptura: 2, urlAfiliada: "https://go.optimus/app-extra", urlOptimus: "https://go.optimus/app-extra" },
    { tipo: "pc", papel: "link_pc", ordemCaptura: 3, urlAfiliada: "https://go.optimus/same", urlOptimus: "https://go.optimus/same" },
    { tipo: "resgate", papel: "link_resgate", ordemCaptura: 4, urlAfiliada: "https://go.optimus/resgate", urlOptimus: "https://go.optimus/resgate" },
    { tipo: "produto", papel: "link_produto", ordemCaptura: 5, urlAfiliada: "https://go.optimus/produto", urlOptimus: "https://go.optimus/produto" }
  ]
};

const padrao = gerarTemplateUniversal(ofertaBase);
assert.ok(padrao.includes("🔥 *Produto Clone Visual*"));
assert.ok(padrao.includes("🛍️ AliExpress"));
assert.ok(padrao.includes("📂 Diversos"));
assert.ok(possuiLinha(padrao, estrelas(5)));
assert.ok(!padrao.includes("Oportunidade Optimus"));
assert.ok(padrao.includes("❌ De: *R$ 210,00*"));
assert.ok(padrao.includes("✅ Por: *R$ 140,00*"));
assert.ok(padrao.includes("📉 33% OFF"));
assert.ok(!padrao.includes("Pix:"), "Template Universal nao renderiza linha Pix separada");
assert.ok(padrao.includes("💳 10x de R$ 14,00"));
assert.ok(padrao.includes("🎟️ Cupom: *RADAR10*"));
assert.ok(padrao.includes("⚡ Aplique o cupom RADAR10 para obter o valor."));
assert.ok(padrao.includes("🚚 Frete gratis"));
assert.strictEqual((padrao.match(/Frete gratis/g) || []).length, 1, "frete nao duplica como beneficio + frete");
assert.ok(padrao.includes("⭐ 4,8 • 1.234"));
assert.ok(padrao.includes("📱 *APP:*\nhttps://go.optimus/same\nhttps://go.optimus/app-extra"));
assert.ok(padrao.includes("🖥️ *PC:*\nhttps://go.optimus/same"));
assert.ok(padrao.includes("🎟️ *Resgate:*\nhttps://go.optimus/resgate"));
assert.ok(padrao.includes("🔗 *Confira aqui:*\nhttps://go.optimus/produto"));
assert.strictEqual((padrao.match(/Oferta sujeita/g) || []).length, 0, "aviso custom substitui padrao");
assert.strictEqual((padrao.match(/Aviso customizado final/g) || []).length, 1, "apenas um aviso final");
assert.ok(!padrao.includes("APP / Moedas"), "APP e Moedas nao compartilham papel visual");

assert.ok(indice(padrao, "🛍️ AliExpress") < indice(padrao, "❌ De:"), "origem vem antes de preco");
assert.ok(indice(padrao, "❌ De:") < indice(padrao, "🎟️ Cupom:"), "precos ficam antes de cupom");
assert.ok(indice(padrao, "🎟️ Cupom:") < indice(padrao, "🎟️ *Resgate:*"), "condicoes ficam antes de links");
assert.ok(indice(padrao, "🔗 *Confira aqui:*") < indice(padrao, "⚠️ Aviso customizado final."), "aviso fica depois dos links");

const semAvaliacaoReal = gerarTemplateUniversal({
  titulo: "Sem avaliacao real",
  marketplace: "Amazon",
  categoria: "Diversos",
  precoAtual: 99,
  score: 100,
  linkAfiliado: "https://amzn.to/oferta"
});
assert.ok(!semAvaliacaoReal.includes("â­ 100"), "score interno nao vira avaliacao visual");

const personalizado = renderizarTemplatePersonalizado({
  oferta: {
    ...ofertaBase,
    oportunidadeVisual: `${estrelas(4)} Texto legado ignorado`,
    linksComerciais: [
      { tipo: "app", papel: "link_app", ordemCaptura: 1, urlAfiliada: "https://afiliado/app", urlOptimus: "https://go.optimus/app" },
      { tipo: "pc", papel: "link_pc", ordemCaptura: 2, urlAfiliada: "https://afiliado/pc", urlOptimus: "https://go.optimus/pc" },
      { tipo: "resgate", papel: "link_resgate", ordemCaptura: 3, urlAfiliada: "https://afiliado/resgate", urlOptimus: "https://go.optimus/resgate" },
      { tipo: "produto", papel: "link_produto", ordemCaptura: 4, urlAfiliada: "https://afiliado/produto", urlOptimus: "https://go.optimus/produto" }
    ]
  },
  template: {
    id: "tpl_visual",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "marketplace", ativo: true, ordem: 20 },
      { tipo: "categoria", ativo: true, ordem: 30 },
      { tipo: "oportunidade", ativo: true, ordem: 40 },
      { tipo: "preco_de", ativo: true, ordem: 50 },
      { tipo: "preco_por", ativo: true, ordem: 60 },
      { tipo: "preco_pix", ativo: true, ordem: 70 },
      { tipo: "cupom", ativo: true, ordem: 80 },
      { tipo: "link_resgate", ativo: true, ordem: 90 },
      { tipo: "link_app", ativo: true, ordem: 100 },
      { tipo: "link_pc", ativo: true, ordem: 110 },
      { tipo: "link", ativo: true, ordem: 120 },
      { tipo: "aviso_final", ativo: true, ordem: 130 },
      { tipo: "aviso_alteracao", ativo: true, ordem: 140 }
    ],
    rodape: { ativo: true, texto: "Rodape livre" }
  },
  canal: "whatsapp"
});

assert.strictEqual(personalizado.ok, true);
assert.ok(possuiLinha(personalizado.mensagem, estrelas(5)));
assert.ok(!personalizado.mensagem.includes("Oportunidade Optimus"));
assert.ok(personalizado.mensagem.includes("📱 APP:\nhttps://go.optimus/app"));
assert.ok(personalizado.mensagem.includes("🖥️ PC:\nhttps://go.optimus/pc"));
assert.ok(personalizado.mensagem.includes("🎟️ Resgate:\nhttps://go.optimus/resgate"));
assert.ok(personalizado.mensagem.includes("🔗 Confira aqui:\nhttps://go.optimus/produto"));
assert.strictEqual((personalizado.mensagem.match(/Aviso customizado final/g) || []).length, 1, "personalizado tambem tem aviso unico");
assert.ok(personalizado.mensagem.endsWith("Rodape livre"), "rodape permanece texto livre separado");

const personalizadoSemClassificacao = renderizarTemplatePersonalizado({
  oferta: ofertaBase,
  template: {
    id: "tpl_sem_estrelas",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "oportunidade", ativo: false, ordem: 10 },
      { tipo: "titulo", ativo: true, ordem: 20 },
      { tipo: "preco_por", ativo: true, ordem: 30 },
      { tipo: "link", ativo: true, ordem: 40 }
    ]
  },
  canal: "whatsapp"
});
assert.strictEqual(personalizadoSemClassificacao.ok, true);
assert.ok(!personalizadoSemClassificacao.mensagem.includes(estrelas(2)), "ocultar classificacao remove somente estrelas");
assert.ok(personalizadoSemClassificacao.mensagem.includes("Produto Clone Visual"));
assert.ok(personalizadoSemClassificacao.mensagem.includes("https://go.optimus/produto"));

const linksDesligadosContinuamCanonicos = renderizarTemplatePersonalizado({
  oferta: ofertaBase,
  template: {
    id: "tpl_links_desligados_legado",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "preco_por", ativo: true, ordem: 20 },
      { tipo: "link_resgate", ativo: false, ordem: 30 },
      { tipo: "link_app", ativo: false, ordem: 40 },
      { tipo: "link_pc", ativo: false, ordem: 50 },
      { tipo: "link", ativo: true, ordem: 60 }
    ]
  },
  canal: "whatsapp"
});
assert.ok(linksDesligadosContinuamCanonicos.mensagem.includes("🎟️ Resgate:\nhttps://go.optimus/resgate"));
assert.ok(linksDesligadosContinuamCanonicos.mensagem.includes("📱 APP:\nhttps://go.optimus/same"));
assert.ok(linksDesligadosContinuamCanonicos.mensagem.includes("🖥️ PC:\nhttps://go.optimus/same"));

assert.ok(possuiLinha(gerarTemplateUniversal({ titulo: "Oferta normal", precoAtual: 100, linkAfiliado: "https://x.test" }), estrelas(2)));
assert.ok(possuiLinha(gerarTemplateUniversal({ titulo: "Oferta boa", precoOriginal: 125, precoAtual: 100, linkAfiliado: "https://x.test" }), estrelas(3)));
assert.ok(possuiLinha(gerarTemplateUniversal({ titulo: "Oferta otima", precoOriginal: 200, precoAtual: 100, linkAfiliado: "https://x.test" }), estrelas(4)));
assert.ok(possuiLinha(gerarTemplateUniversal({ titulo: "Oferta excelente", precoOriginal: 200, precoAtual: 100, cupom: "PROMO10", freteGratis: true, linkAfiliado: "https://x.test" }), estrelas(5)));

console.log("template-universal-visual-contract.test.js OK");
