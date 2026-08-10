const assert = require("assert");

const {
  normalizarApresentacaoComercial
} = require("../modules/templates-clientes/normalizador-apresentacao-comercial");
const {
  prepararDadosOficiaisTemplate
} = require("../modules/templates-clientes/dados-oficiais");
const { gerarTemplateUniversal } = require("../modules/template-universal");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");

function ocorrencias(texto = "", busca = "") {
  return (String(texto).match(new RegExp(busca.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
}

function ofertaBase(extra = {}) {
  return {
    origem: "radar",
    radar: true,
    fonteComercial: "radar_espelho_comercial",
    titulo: "Produto Teste",
    marketplace: "shopee",
    precoAtual: 99.9,
    linkAfiliado: "https://produto.example/oferta",
    linksComerciais: [
      { tipo: "produto", original: "https://produto.example/oferta", afiliado: "https://produto.example/oferta" }
    ],
    ...extra
  };
}

const cupomQuatroAliases = ofertaBase({
  cupom: "MODALIVRE",
  codigoCupom: "modalivre",
  cupons: ["MODALIVRE"],
  codigosCupom: ["MODALIVRE"],
  instrucaoCupom: "Cupom: MODALIVRE"
});
const dadosCupomUnico = prepararDadosOficiaisTemplate(cupomQuatroAliases, { modo: "universal" });
const mensagemCupomUnico = gerarTemplateUniversal(dadosCupomUnico);
assert.deepStrictEqual(dadosCupomUnico.codigosCupom, ["MODALIVRE"]);
assert.strictEqual(ocorrencias(mensagemCupomUnico, "Cupom: *MODALIVRE*"), 1, "linha de cupom unico aparece uma vez");
assert.ok(!mensagemCupomUnico.includes("MODALIVRE ou MODALIVRE"), "nao concatena aliases redundantes");
assert.ok(!mensagemCupomUnico.includes("Cupom: MODALIVRE\n"), "instrucao redundante nao e renderizada");

const doisCupons = prepararDadosOficiaisTemplate(ofertaBase({
  cupom: "MODALIVRE ou AMOCUPOM",
  codigosCupom: ["modalivre", "AMOCUPOM"]
}), { modo: "universal" });
const mensagemDoisCupons = gerarTemplateUniversal(doisCupons);
assert.deepStrictEqual(doisCupons.codigosCupom, ["MODALIVRE", "AMOCUPOM"]);
assert.strictEqual(ocorrencias(mensagemDoisCupons, "Cupom: *MODALIVRE ou AMOCUPOM*"), 1);
assert.ok(!mensagemDoisCupons.includes("MODALIVRE ou MODALIVRE"));

const aliCupomSemMoedas = prepararDadosOficiaisTemplate(ofertaBase({
  marketplace: "aliexpress",
  cupom: "IFPC5HAQ",
  codigosCupom: ["IFPC5HAQ"],
  imagem: "https://img.example/aliexpress.jpg",
  linkAfiliado: "https://s.click.aliexpress.com/e/_pcSeguro"
}), { modo: "universal" });
const msgAliCupomSemMoedas = gerarTemplateUniversal(aliCupomSemMoedas);
assert.deepStrictEqual(aliCupomSemMoedas.codigosCupom, ["IFPC5HAQ"], "AliExpress preserva cupom sem moedas");
assert.strictEqual(aliCupomSemMoedas.imagem, "https://img.example/aliexpress.jpg", "AliExpress preserva imagem na composicao");
assert.ok(msgAliCupomSemMoedas.includes("Cupom: *IFPC5HAQ*"), "AliExpress renderiza cupom sem moedas");
assert.ok(!msgAliCupomSemMoedas.includes("Aplique um dos cupons acima"), "AliExpress nao inventa CTA comercial generico");
assert.ok(!msgAliCupomSemMoedas.includes("Aplique o cupom IFPC5HAQ"), "AliExpress nao usa cupom como frase");

const aliCuponsMoedas = prepararDadosOficiaisTemplate(ofertaBase({
  marketplace: "aliexpress",
  cupom: "IFPC5HAQ ou IFPRWL57 ou 732MOEDAS",
  codigosCupom: ["IFPC5HAQ", "IFPRWL57", "732MOEDAS"],
  moedasTexto: "+732 moedas",
  linkAfiliado: "https://s.click.aliexpress.com/e/_pcSeguro"
}), { modo: "universal" });
const msgAliCuponsMoedas = gerarTemplateUniversal(aliCuponsMoedas);
assert.deepStrictEqual(aliCuponsMoedas.codigosCupom, ["IFPC5HAQ", "IFPRWL57"], "AliExpress nao transforma moedas em cupom");
assert.ok(aliCuponsMoedas.condicoes.includes("732 moedas no APP"), "AliExpress apresenta moedas como condicao comercial");
assert.ok(msgAliCuponsMoedas.includes("Cupom: *IFPC5HAQ ou IFPRWL57*"), "AliExpress renderiza varios cupons sem moedas");
assert.ok(msgAliCuponsMoedas.includes("732 moedas no APP"), "AliExpress renderiza moedas separadas dos cupons");
assert.ok(!msgAliCuponsMoedas.includes("732MOEDAS"), "AliExpress nao renderiza moedas como codigo");
assert.ok(!msgAliCuponsMoedas.includes("IFPC5HAQ ou IFPRWL57 ou 732"), "AliExpress nao concatena moedas com ou");

const aliSomenteMoedas = gerarTemplateUniversal(prepararDadosOficiaisTemplate(ofertaBase({
  marketplace: "aliexpress",
  cupom: "",
  codigosCupom: [],
  cupons: [],
  moedasTexto: "+732 moedas",
  linkAfiliado: "https://s.click.aliexpress.com/e/_pcSeguro"
}), { modo: "universal" }));
assert.ok(aliSomenteMoedas.includes("732 moedas no APP"), "AliExpress somente moedas continua renderizando beneficio");
assert.ok(!aliSomenteMoedas.includes("Cupom:"), "AliExpress somente moedas nao cria cupom");
assert.ok(!aliSomenteMoedas.includes("Aplique um dos cupons"), "AliExpress somente moedas nao cria CTA de cupom");

const instrucaoResgate = prepararDadosOficiaisTemplate(ofertaBase({
  cupom: "",
  codigoCupom: "",
  cupons: [],
  codigosCupom: [],
  instrucaoCupom: "Resgate todos os cupons desta pagina"
}), { modo: "universal" });
assert.deepStrictEqual(instrucaoResgate.codigosCupom, []);
assert.strictEqual(instrucaoResgate.instrucaoCupom, "Resgate todos os cupons desta pagina");
const mensagemInstrucaoResgate = gerarTemplateUniversal(instrucaoResgate);
for (const falsoCupom of ["TODOS", "CUPONS", "DESTA", "PAGINA"]) {
  assert.ok(!mensagemInstrucaoResgate.includes(`Cupom: *${falsoCupom}*`), `nao cria cupom ${falsoCupom}`);
}

const umLink = gerarTemplateUniversal(prepararDadosOficiaisTemplate(ofertaBase(), { modo: "universal" }));
assert.ok(umLink.includes("Confira aqui:"), "um link mostra chamada principal");
assert.ok(umLink.includes("https://produto.example/oferta"), "um link preserva produto");
assert.ok(!umLink.includes("Resgate os cupons"), "um link de produto nao mostra resgate");

const resgate = "https://resgate.example/cupons";
const produto = "https://produto.example/item";
const ofertaComResgate = ofertaBase({
  linkAfiliado: produto,
  linksComerciais: [
    { tipo: "resgate", original: resgate },
    { tipo: "produto", original: produto, afiliado: produto }
  ],
  linksProduto: [{ tipo: "produto", original: produto, afiliado: produto }],
  linksResgate: [{ tipo: "resgate", original: resgate }]
});
const mensagemComResgate = gerarTemplateUniversal(prepararDadosOficiaisTemplate(ofertaComResgate, { modo: "universal" }));
assert.ok(mensagemComResgate.includes("Resgate:"), "renderiza bloco de resgate");
assert.ok(mensagemComResgate.indexOf(resgate) < mensagemComResgate.indexOf(produto), "resgate vem antes do produto");

const personalizadoComDoisLinks = renderizarTemplatePersonalizado({
  oferta: ofertaComResgate,
  template: {
    id: "tpl_dois_links",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "cta", ativo: true, ordem: 10 },
      { tipo: "link_resgate", ativo: true, ordem: 20 },
      { tipo: "link", ativo: true, ordem: 30 }
    ]
  },
  canal: "whatsapp"
});
assert.ok(personalizadoComDoisLinks.mensagem.includes(`Resgate:\n${resgate}`), "personalizado renderiza resgate em bloco proprio");
assert.ok(personalizadoComDoisLinks.mensagem.includes(`Confira aqui:\n${produto}`), "personalizado renderiza produto em bloco proprio");
assert.ok(personalizadoComDoisLinks.mensagem.indexOf(resgate) < personalizadoComDoisLinks.mensagem.indexOf(produto), "personalizado coloca resgate antes do produto");
assert.ok(!personalizadoComDoisLinks.mensagem.includes(`Confira aqui:\n🎟️ Resgate os cupons`), "personalizado nao mistura resgate dentro do link");

const templateLinks = {
  id: "tpl_links",
  canais: ["whatsapp"],
  blocos: [
    { tipo: "link_resgate", ativo: false, ordem: 10 },
    { tipo: "link", ativo: true, ordem: 20 }
  ]
};
const semResgate = renderizarTemplatePersonalizado({ oferta: ofertaComResgate, template: templateLinks, canal: "whatsapp" });
assert.ok(semResgate.mensagem.includes(resgate), "toggle link_resgate desligado nao oculta resgate essencial");
assert.ok(semResgate.mensagem.includes(produto), "toggle link ativo preserva produto");

const somenteResgate = renderizarTemplatePersonalizado({
  oferta: ofertaComResgate,
  template: {
    ...templateLinks,
    blocos: [
      { tipo: "link_resgate", ativo: true, ordem: 10 },
      { tipo: "link", ativo: false, ordem: 20 }
    ]
  },
  canal: "whatsapp"
});
assert.ok(somenteResgate.mensagem.includes(resgate), "toggle link_resgate ativo preserva resgate");
assert.ok(somenteResgate.mensagem.includes(produto), "toggle link desligado nao oculta produto essencial");

const somenteResgateComCtaPadrao = renderizarTemplatePersonalizado({
  oferta: ofertaComResgate,
  template: {
    id: "tpl_somente_resgate_cta",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "cta", ativo: true, ordem: 10 },
      { tipo: "link_resgate", ativo: true, ordem: 20 },
      { tipo: "link", ativo: false, ordem: 30 }
    ]
  },
  canal: "whatsapp"
});
assert.ok(somenteResgateComCtaPadrao.mensagem.includes(resgate), "link desligado com resgate ligado preserva resgate");
assert.ok(somenteResgateComCtaPadrao.mensagem.includes(produto), "link desligado com resgate ligado preserva produto essencial");
assert.ok(somenteResgateComCtaPadrao.mensagem.includes("Confira aqui"), "cta padrao aparece com link de produto essencial");

const templateAntigoSemResgate = renderizarTemplatePersonalizado({
  oferta: ofertaComResgate,
  template: {
    id: "tpl_antigo_sem_resgate",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "link", ativo: true, ordem: 20 }
    ]
  },
  canal: "whatsapp"
});
assert.ok(templateAntigoSemResgate.mensagem.includes(resgate), "template antigo sem link_resgate recebe fallback passivo de resgate");
assert.ok(templateAntigoSemResgate.mensagem.includes(produto), "template antigo sem link_resgate preserva produto");
assert.ok(templateAntigoSemResgate.mensagem.indexOf(resgate) < templateAntigoSemResgate.mensagem.indexOf(produto), "fallback passivo coloca resgate antes do produto");

const blocosVazios = renderizarTemplatePersonalizado({
  oferta: { titulo: "" },
  template: {
    id: "tpl_vazio",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "link_resgate", ativo: true, ordem: 10 },
      { tipo: "cupom", ativo: true, ordem: 20 },
      { tipo: "frase_cupom", ativo: true, ordem: 30 },
      { tipo: "link", ativo: true, ordem: 40 }
    ]
  },
  canal: "whatsapp"
});
assert.strictEqual(blocosVazios.mensagem, "", "blocos sem conteudo nao geram labels vazios");
for (const termoTecnico of ["modoCupom", "tipoCupom", "linksResgate", "linksProduto"]) {
  assert.ok(!blocosVazios.mensagem.includes(termoTecnico), `nao renderiza ${termoTecnico}`);
}

const simples = gerarTemplateUniversal(prepararDadosOficiaisTemplate(ofertaBase({
  cupom: "",
  codigosCupom: [],
  cupons: [],
  instrucaoCupom: ""
}), { modo: "universal" }));
assert.ok(!simples.includes("De:"), "oferta simples nao inventa preco anterior");
assert.ok(!simples.includes("Economia:"), "oferta simples nao inventa economia");
assert.ok(!simples.includes("Pix"), "oferta simples nao inventa pix");
assert.ok(!simples.includes("Avalia"), "oferta simples nao inventa avaliacao");

const rica = gerarTemplateUniversal(prepararDadosOficiaisTemplate(ofertaBase({
  precoOriginal: 199.9,
  precoAtual: 99.9,
  precoPix: "R$ 99,90 no Pix",
  parcelamento: "R$ 109,90 em ate 4x",
  cupom: "RICO10",
  codigosCupom: ["RICO10"],
  instrucaoCupom: "Aplique no carrinho.",
  linksComerciais: [
    { tipo: "resgate", original: resgate },
    { tipo: "produto", original: produto, afiliado: produto }
  ],
  linksProduto: [{ tipo: "produto", original: produto, afiliado: produto }],
  linksResgate: [{ tipo: "resgate", original: resgate }]
}), { modo: "universal" }));
for (const trecho of ["De:", "Por:", "Pix", "R$ 109,90 em ate 4x", "RICO10", "Aplique no carrinho.", resgate, produto]) {
  assert.ok(rica.includes(trecho), `oferta rica preserva ${trecho}`);
}

const personalizadaRica = renderizarTemplatePersonalizado({
  oferta: ofertaBase({
    precoOriginal: 199.9,
    precoAtual: 99.9,
    precoPix: "R$ 99,90 no Pix",
    parcelamento: "R$ 109,90 em ate 4x",
    cupom: "RICO10",
    codigosCupom: ["RICO10"],
    instrucaoCupom: "Aplique no carrinho.",
    linksProduto: [{ tipo: "produto", original: produto, afiliado: produto }],
    linksResgate: [{ tipo: "resgate", original: resgate }]
  }),
  template: {
    id: "tpl_rica_personalizada",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "preco_de", ativo: true, ordem: 10 },
      { tipo: "preco_por", ativo: true, ordem: 20 },
      { tipo: "cupom", ativo: true, ordem: 30 },
      { tipo: "frase_cupom", ativo: true, ordem: 40 },
      { tipo: "parcelamento", ativo: true, ordem: 50 },
      { tipo: "link_resgate", ativo: true, ordem: 60 },
      { tipo: "link", ativo: true, ordem: 70 }
    ]
  },
  canal: "whatsapp"
});
for (const trecho of ["De:", "Por: R$ 99,90 no Pix", "RICO10", "Aplique no carrinho.", "R$ 109,90 em ate 4x", resgate, produto]) {
  assert.ok(personalizadaRica.mensagem.includes(trecho), `personalizado rico preserva ${trecho}`);
}

const cupomSemInstrucao = renderizarTemplatePersonalizado({
  oferta: ofertaBase({ cupom: "SEMINFO10", codigosCupom: ["SEMINFO10"], instrucaoCupom: "" }),
  template: {
    id: "tpl_cupom_sem_instrucao",
    canais: ["whatsapp"],
    blocos: [{ tipo: "frase_cupom", ativo: true, ordem: 10 }]
  },
  canal: "whatsapp"
});
assert.ok(cupomSemInstrucao.mensagem.includes("Produto Teste"), "template com frase_cupom preserva titulo essencial");
assert.ok(cupomSemInstrucao.mensagem.includes("Por: R$"), "template com frase_cupom preserva preco essencial");
assert.ok(cupomSemInstrucao.mensagem.includes("https://produto.example/oferta"), "template com frase_cupom preserva link essencial");
assert.ok(!cupomSemInstrucao.mensagem.includes("Aplique o cupom SEMINFO10"), "cupom sem instrucao nao recebe frase inventada");

const semCupomSemFrase = renderizarTemplatePersonalizado({
  oferta: ofertaBase({ cupom: "", codigosCupom: [], cupons: [], instrucaoCupom: "" }),
  template: {
    id: "tpl_sem_cupom_sem_frase",
    canais: ["whatsapp"],
    blocos: [{ tipo: "frase_cupom", ativo: true, ordem: 10 }]
  },
  canal: "whatsapp"
});
assert.ok(semCupomSemFrase.mensagem.includes("Produto Teste"), "oferta sem cupom preserva titulo essencial");
assert.ok(!semCupomSemFrase.mensagem.includes("Aplique o cupom"), "oferta sem cupom nao recebe frase padrao");

const comMetadataTecnica = gerarTemplateUniversal(prepararDadosOficiaisTemplate(ofertaBase({
  grupoNome: "Grupo Secreto",
  canalNome: "Canal VIP",
  remoteJid: "123@g.us",
  metadata: { grupoNome: "Grupo Secreto", remoteJid: "123@g.us" }
}), { modo: "universal" }));
for (const proibido of ["Grupo Secreto", "Canal VIP", "123@g.us"]) {
  assert.ok(!comMetadataTecnica.includes(proibido), `nao renderiza ${proibido}`);
}

assert.deepStrictEqual(
  normalizarApresentacaoComercial({
    cupom: "MODALIVRE",
    codigosCupom: ["modalivre", "AMOCUPOM"],
    instrucaoCupom: "Cupom: MODALIVRE"
  }).codigosCupom,
  ["MODALIVRE", "AMOCUPOM"],
  "helper deduplica case-insensitive e preserva cupons diferentes"
);

console.log("apresentacao-comercial-normalizador.test.js OK");
