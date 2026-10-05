const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-copy-c3-publica-"));
process.env.DATA_DIR = dataDir;

const copy = require("../modules/copy-inteligente");
const { criarTemplate } = require("../modules/templates-clientes/service");
const { montarMensagemOferta, resolverTituloApresentacaoOferta } = require("../utils/mensagens-ofertas");

const planoC3 = { recursos: { tituloIa: true, templatePersonalizado: true } };
const destinoUniversal = { id: "destino_c3_publico", tipo: "whatsapp", tituloOferta: "ia" };

function ofertaBase(extra = {}) {
  return {
    id: "oferta_c3_publica",
    engineOfertaId: "engine_c3_publica",
    clienteId: "cliente_c3_publico",
    marketplace: "mercadolivre",
    titulo: "Monitor Gamer 27 polegadas",
    tituloFactual: "Monitor Gamer 27 polegadas",
    categoria: "Gamer e Hardware",
    precoOriginal: 150,
    precoAtual: 100,
    preco: 100,
    descontoPercentual: 33,
    descontoPercentualOrigem: "marketplace",
    linkOriginal: "https://produto.mercadolivre.com.br/MLB-1-monitor",
    linkAfiliado: "https://meli.la/monitor",
    imagem: "https://img.example/monitor.jpg",
    ...extra
  };
}

function tituloResolvido(oferta, destino = destinoUniversal, plano = planoC3) {
  return resolverTituloApresentacaoOferta(oferta, destino, {
    clienteId: oferta.clienteId,
    plano
  });
}

function mensagemFinal(oferta, destino = destinoUniversal, plano = planoC3) {
  return montarMensagemOferta(oferta, {
    clienteId: oferta.clienteId,
    destino,
    plano
  });
}

function assertGanchoPublicoSeguro(oferta, destino = destinoUniversal) {
  const titulo = tituloResolvido(oferta, destino);
  const mensagem = mensagemFinal(oferta, destino);
  assert.ok(titulo.titulo, "caminho completo resolve um gancho publico");
  assert.ok(mensagem.includes(titulo.titulo), "renderer final recebe exatamente o gancho resolvido");
  assert.ok(!/(?:R\$|US\$|\$|€|£)\s*\d|\b\d+[,.]\d{2}\b/.test(titulo.titulo), "gancho final nao publica preco literal");
  assert.ok(!/\d+\s*%/.test(titulo.titulo), "gancho final nao publica percentual numerico");
  return { titulo, mensagem };
}

const ofertaMarketplace = ofertaBase({ id: "c3_marketplace", engineOfertaId: "c3_marketplace" });
const c3Marketplace = copy.resolverCopyC3({ oferta: ofertaMarketplace, destino: destinoUniversal, clienteId: ofertaMarketplace.clienteId, plano: planoC3 });
assert.strictEqual(c3Marketplace.ok, true);
assert.strictEqual(c3Marketplace.intencao, "desconto_real");
assert.ok(c3Marketplace.candidatosBarradosContrato >= 4, "C3 informa candidatos numericos barrados");
assert.ok(c3Marketplace.motivosBarradosContrato.includes("preco_detectado"));
assert.ok(c3Marketplace.motivosBarradosContrato.includes("percentual_detectado"));
assert.match(c3Marketplace.ganchoComercialC3, /desconto|nesse pre[cç]o/i, "desconto marketplace continua produzindo copy semantica");
const universalMarketplace = assertGanchoPublicoSeguro(ofertaMarketplace);
assert.match(universalMarketplace.mensagem, /R\$\s*100[,.]00/, "preco permanece no campo proprio do template universal");
assert.match(universalMarketplace.mensagem, /33\s*%/, "percentual comprovado permanece no campo proprio do template universal");

const ofertaManual = ofertaBase({
  id: "c3_manual",
  engineOfertaId: "c3_manual",
  descontoPercentualOrigem: "manual"
});
const c3Manual = copy.resolverCopyC3({ oferta: ofertaManual, destino: destinoUniversal, clienteId: ofertaManual.clienteId, plano: planoC3 });
assert.strictEqual(c3Manual.intencao, "desconto_real");
assertGanchoPublicoSeguro(ofertaManual);

for (const ofertaSemOrigem of [
  ofertaBase({ id: "c3_sem_origem", engineOfertaId: "c3_sem_origem", descontoPercentualOrigem: "" }),
  ofertaBase({ id: "c3_de_por", engineOfertaId: "c3_de_por", descontoPercentual: undefined, descontoPercentualOrigem: "" })
]) {
  const resultado = copy.resolverCopyC3({ oferta: ofertaSemOrigem, destino: destinoUniversal, clienteId: ofertaSemOrigem.clienteId, plano: planoC3 });
  assert.notStrictEqual(resultado.intencao, "desconto_real", "percentual ou De/Por sem origem nao cria desconto publico");
  assertGanchoPublicoSeguro(ofertaSemOrigem);
}

const template = criarTemplate("cliente_c3_publico", {
  nome: "C3 contrato publico",
  canais: ["whatsapp"],
  blocos: [
    { tipo: "titulo", ativo: true, ordem: 10 },
    { tipo: "preco_de", ativo: true, ordem: 20 },
    { tipo: "preco_por", ativo: true, ordem: 30 },
    { tipo: "desconto_percentual", ativo: true, ordem: 40 },
    { tipo: "cupom", ativo: true, ordem: 50 },
    { tipo: "frase_cupom", ativo: true, ordem: 60 },
    { tipo: "link", ativo: true, ordem: 70 }
  ]
}).template;
const destinoPersonalizado = { ...destinoUniversal, id: "destino_c3_personalizado", templateId: template.id };
const personalizado = assertGanchoPublicoSeguro(ofertaMarketplace, destinoPersonalizado);
assert.match(personalizado.mensagem, /R\$\s*100[,.]00/, "preco permanece no campo proprio do template personalizado");
assert.match(personalizado.mensagem, /33\s*%/, "percentual comprovado permanece no campo proprio do template personalizado");

const localV2 = tituloResolvido(
  ofertaBase({ id: "local_v2_preservado", engineOfertaId: "local_v2_preservado", descontoPercentual: undefined, descontoPercentualOrigem: "", precoOriginal: undefined }),
  destinoUniversal,
  { recursos: { tituloIa: true } }
);
assert.strictEqual(localV2.fonte, copy.FONTE_COPY_LOCAL_V2, "Local V2 permanece como fallback quando C3 esta desabilitado");

const original = tituloResolvido(ofertaMarketplace, { ...destinoUniversal, tituloOferta: "original" });
assert.strictEqual(original.modo, "original");
assert.strictEqual(original.titulo, ofertaMarketplace.titulo, "modo original permanece intacto");

const cenariosRenderizados = [
  ["Monitor Gamer 27 polegadas", "Gamer e Hardware", "desconto"],
  ["Furadeira de Impacto 650 W", "Ferramentas", "desconto"],
  ["Smart TV 4K 50 polegadas", "Audio TV", "desconto"],
  ["Caixa de Som Bluetooth 35 W", "Audio TV", "cupom"],
  ["Vestido Midi Feminino", "Roupas e Moda Feminina", "cupom"],
  ["Perfume Floral 100 ml", "Perfumaria, Farmácia e Beleza", "desconto"],
  ["Panela de Pressão 4,5 L", "Casa, Móveis e Decoração", "desconto"],
  ["SSD NVMe 1 TB", "Computadores e Notebook", "desconto"],
  ["Smartphone Galaxy A56", "Celulares e Smartphones", "cupom"],
  ["Notebook Lenovo 16 GB", "Computadores e Notebook", "preco"],
  ["Tênis Casual Masculino", "Tênis e Chinelos", "cupom"],
  ["Creme Hidratante 1 kg", "Perfumaria, Farmácia e Beleza", "preco"],
  ["Aspirador Robô Inteligente", "Casa, Móveis e Decoração", "desconto"],
  ["Cabo USB-C 2 metros", "Eletrônicos", "preco"],
  ["Furadeira Profissional 1500 W", "Ferramentas", "cupom"],
  ["Caixa de Som Bluetooth 120 W", "Audio TV", "desconto"],
  ["Smart TV Full HD 43 polegadas", "Eletrônicos", "cupom"],
  ["Blusa Feminina Manga Longa", "Roupas e Moda Feminina", "desconto"],
  ["Kit Organizador Multiuso", "Casa, Móveis e Decoração", "preco"],
  ["Monitor Gamer Full HD", "Gamer e Hardware", "cupom"]
];
const logOriginal = console.log;
console.log = () => {};
const mensagensRenderizadas = cenariosRenderizados.map(([titulo, categoria, tipo], indice) => {
  const desconto = tipo === "desconto";
  const cupom = tipo === "cupom";
  const oferta = ofertaBase({
    id: `c3_render_final_${indice}`,
    engineOfertaId: `c3_render_final_${indice}`,
    titulo,
    tituloFactual: titulo,
    categoria,
    precoAtual: 100 + indice,
    preco: 100 + indice,
    precoOriginal: desconto ? 150 + indice : undefined,
    descontoPercentual: desconto ? 20 + indice : undefined,
    descontoPercentualOrigem: desconto ? "marketplace" : "",
    cupom: cupom ? `OFERTA${indice + 10}` : "",
    cupomTipo: cupom ? "real" : "",
    cupomConfirmado: cupom
  });
  const destino = indice % 2 === 0 ? destinoUniversal : destinoPersonalizado;
  const { titulo: gancho, mensagem } = assertGanchoPublicoSeguro(oferta, destino);
  assert.match(mensagem, /R\$\s*\d+/, `mensagem ${indice + 1}: preco permanece no bloco comercial`);
  if (desconto) assert.match(mensagem, new RegExp(`${20 + indice}\\s*%`), `mensagem ${indice + 1}: desconto fica no bloco comercial`);
  return {
    numero: indice + 1,
    tipo,
    renderer: indice % 2 === 0 ? "universal" : "personalizado",
    gancho: gancho.titulo,
    mensagem
  };
});
console.log = logOriginal;
assert.strictEqual(mensagensRenderizadas.length, 20);
console.log(`C3-PUBLIC-MESSAGES ${JSON.stringify(mensagensRenderizadas)}`);

console.log("copy-c3-contrato-publico.test.js OK");
