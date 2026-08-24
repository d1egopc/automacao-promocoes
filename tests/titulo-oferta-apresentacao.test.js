const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-titulo-oferta-"));
process.env.DATA_DIR = dataDir;

const { criarTemplate } = require("../modules/templates-clientes/service");
const {
  montarMensagemOferta,
  resolverTituloApresentacaoOferta
} = require("../utils/mensagens-ofertas");

function ofertaBase(marketplace = "amazon") {
  return {
    clienteId: "cliente_titulo_oferta",
    marketplace,
    titulo: "Produto Original Oficial",
    nome: "Nome Original Fallback",
    tituloIa: "Titulo IA Curto",
    precoAtual: 100,
    precoOriginal: 129.9,
    cupom: "PROMO10",
    linkAfiliado: "https://go.example/oferta",
    imagem: "https://img.example/oferta.jpg"
  };
}

function renderizar(oferta, destino = {}, opcoes = {}) {
  return montarMensagemOferta(oferta, {
    clienteId: "cliente_titulo_oferta",
    destino: { tipo: "whatsapp", ...destino },
    plano: { recursos: { templatePersonalizado: true, tituloIa: opcoes.tituloIa === true } }
  });
}

const original = ofertaBase();
const snapshotOriginal = JSON.parse(JSON.stringify(original));

const mensagemSemCampoNovo = renderizar(original, {});
const mensagemOriginal = renderizar(original, { tituloOferta: "original" });
assert.ok(mensagemSemCampoNovo.includes("Produto Original Oficial"), "destino antigo usa titulo original");
assert.ok(mensagemOriginal.includes("Produto Original Oficial"), "destino original usa titulo original");
assert.ok(!mensagemOriginal.includes("Titulo IA Curto"), "destino original nao usa titulo IA");

const semTitulo = {
  ...ofertaBase(),
  titulo: "",
  nome: "Nome Original do Produto"
};
assert.ok(
  renderizar(semTitulo, { tituloOferta: "original" }).includes("Nome Original do Produto"),
  "fallback original usa nome quando titulo falta"
);

const mensagemIaSemFeature = renderizar(original, { tituloOferta: "ia" });
assert.ok(mensagemIaSemFeature.includes("Produto Original Oficial"), "destino IA sem feature usa titulo original");
assert.ok(!mensagemIaSemFeature.includes("Titulo IA Curto"), "destino IA sem feature nao usa tituloIa");

const mensagemIa = renderizar(original, { tituloOferta: "ia" }, { tituloIa: true });
assert.ok(mensagemIa.includes("Titulo IA Curto"), "destino IA usa tituloIa valido");
assert.ok(!mensagemIa.includes("Produto Original Oficial"), "titulo original nao substitui tituloIa valido");

for (const tituloIa of ["", " ", "undefined", "null", "NaN"]) {
  const mensagem = renderizar({ ...ofertaBase(), tituloIa }, { tituloOferta: "ia" }, { tituloIa: true });
  assert.ok(
    mensagem.includes("Produto Original Oficial") || mensagem.includes("Tem cupom nessa oferta") || mensagem.includes("Opa, essa veio com cupom"),
    `titulo IA invalido cai para original ou motor seguro: ${tituloIa}`
  );
}

for (const trecho of ["R$ 100,00", "PROMO10", "https://go.example/oferta"]) {
  assert.ok(mensagemOriginal.includes(trecho), `original preserva trecho comercial: ${trecho}`);
  assert.ok(mensagemIa.includes(trecho), `IA preserva trecho comercial: ${trecho}`);
}

assert.deepStrictEqual(original, snapshotOriginal, "renderer nao muta oferta/fila compartilhada");

const mensagemFanoutOriginal = renderizar(original, { id: "destino_original", tituloOferta: "original" });
const mensagemFanoutIa = renderizar(original, { id: "destino_ia", tituloOferta: "ia" }, { tituloIa: true });
assert.ok(mensagemFanoutOriginal.includes("Produto Original Oficial"), "fanout destino original mantem original");
assert.ok(mensagemFanoutIa.includes("Titulo IA Curto"), "fanout destino IA usa IA sem mutar a oferta");
assert.deepStrictEqual(original, snapshotOriginal, "fanout nao muta objeto compartilhado");

const template = criarTemplate("cliente_titulo_oferta", {
  nome: "Template Titulo",
  canais: ["whatsapp"],
  blocos: [
    { tipo: "titulo", ativo: true, ordem: 10 },
    { tipo: "preco_por", ativo: true, ordem: 20 },
    { tipo: "cupom", ativo: true, ordem: 30 },
    { tipo: "link", ativo: true, ordem: 40 }
  ]
}).template;

const mensagemPersonalizadaIa = renderizar(ofertaBase(), {
  templateId: template.id,
  tituloOferta: "ia"
}, { tituloIa: true });
assert.ok(mensagemPersonalizadaIa.includes("Titulo IA Curto"), "template personalizado recebe copia com titulo IA");
assert.ok(mensagemPersonalizadaIa.includes("PROMO10"), "template personalizado preserva cupom");
assert.ok(mensagemPersonalizadaIa.includes("https://go.example/oferta"), "template personalizado preserva link");

for (const marketplace of ["mercadolivre", "shopee", "amazon", "aliexpress", "awin", "kabum"]) {
  const mensagem = renderizar(ofertaBase(marketplace), { tituloOferta: "ia" }, { tituloIa: true });
  assert.ok(mensagem.includes("Titulo IA Curto"), `marketplace ${marketplace} aceita apresentacao IA`);
}

assert.deepStrictEqual(
  resolverTituloApresentacaoOferta(
    { titulo: "Original", tituloIa: "IA" },
    { tituloOferta: "ia" },
    { plano: { recursos: { tituloIa: true } } }
  ),
  { titulo: "IA", modo: "ia", usouTituloIa: true, fallbackOriginal: false },
  "resolver expõe decisao IA sem efeito colateral"
);

console.log("titulo-oferta-apresentacao.test.js OK");
