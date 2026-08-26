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
const copy = require("../modules/copy-inteligente");

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

function capturarLogs(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args);
  try {
    return { resultado: fn(), logs };
  } finally {
    console.log = original;
  }
}

function extrairLog(logs, tag) {
  const linha = logs.find(args => args[0] === tag);
  if (!linha) return null;
  return JSON.parse(linha[1]);
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
    mensagem.includes("Produto Original Oficial") || mensagem.toLowerCase().includes("cupom"),
    `titulo IA invalido cai para original ou motor seguro: ${tituloIa}`
  );
  if (tituloIa.trim()) {
    assert.ok(!mensagem.includes(tituloIa.trim()), `titulo IA invalido nao deve ser usado: ${tituloIa}`);
  }
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

const TAG_TITULO = "[TITULO-APRESENTACAO-OBS]";
const TAG_RENDE_FINAL = "[OFC-V2.5-RENDERER-FINAL]";

const sensivel = {
  ...ofertaBase(),
  titulo: "Contato 5511999999999 token=segredo user@s.whatsapp.net",
  nome: "Contato 5511999999999 token=segredo user@s.whatsapp.net"
};
const logsSensiveis = capturarLogs(() => renderizar(sensivel, { tituloOferta: "ia" }, { tituloIa: true })).logs;
const obsSensivel = extrairLog(logsSensiveis, TAG_TITULO);
assert.strictEqual(obsSensivel.fonteTitulo, "tituloIa_explicito", "tituloIa preexistente aponta fonte correta");
assert.strictEqual(obsSensivel.tituloIaPreExistente, true, "tituloIa preexistente registrado");
assert.ok(!JSON.stringify(obsSensivel).includes("5511999999999"), "observabilidade nao expõe telefone");
assert.ok(!JSON.stringify(obsSensivel).includes("token=segredo"), "observabilidade nao expõe token");
assert.ok(!JSON.stringify(obsSensivel).includes("user@s.whatsapp.net"), "observabilidade nao expõe JID");

copy.limparCacheCopyLocalV2();
const logsLocalV2 = capturarLogs(() => renderizar({
  ...ofertaBase(),
  tituloIa: "",
  titulo: "Teclado mecanico gamer",
  nome: "Teclado mecanico gamer",
  cupom: "",
  categoria: "Gamer e Hardware"
}, { tituloOferta: "ia" }, { tituloIa: true })).logs;
const obsLocalV2 = extrairLog(logsLocalV2, TAG_TITULO);
const finalLocalV2 = extrairLog(logsLocalV2, TAG_RENDE_FINAL);
assert.strictEqual(obsLocalV2.fonteTitulo, "local_v2", "local_v2 normal registra fonte");
assert.ok(obsLocalV2.fraseIdLocalV2, "local_v2 registra fraseId");
assert.strictEqual(obsLocalV2.familiaLocalV2, "gamer", "local_v2 registra familia");
assert.strictEqual(obsLocalV2.intencaoLocalV2, "familia", "local_v2 registra intencao");
assert.strictEqual(obsLocalV2.categoriaRecebidaLocalV2, "Gamer e Hardware", "local_v2 registra categoria recebida");
assert.strictEqual(finalLocalV2.fonteTitulo, "local_v2", "renderer final registra fonte local_v2");

const originalLocal = copy.resolverCopyLocalV2;
const originalV1 = copy.resolverCopyInteligente;
try {
  copy.resolverCopyLocalV2 = () => ({ ok: false, motivoFallback: "local_forcado" });
  copy.resolverCopyInteligente = () => ({ ok: true, tituloIa: "V1 curto", fonte: "copy_inteligente_v1", cacheHit: false, intencao: "cupom" });
  const logsV1 = capturarLogs(() => renderizar({
    ...ofertaBase(),
    tituloIa: ""
  }, { tituloOferta: "ia" }, { tituloIa: true })).logs;
  const obsV1 = extrairLog(logsV1, TAG_TITULO);
  const finalV1 = extrairLog(logsV1, TAG_RENDE_FINAL);
  assert.strictEqual(obsV1.fonteTitulo, "v1", "fallback V1 registra fonte");
  assert.strictEqual(obsV1.cacheHit, false, "fallback V1 registra cache");
  assert.strictEqual(finalV1.fonteTitulo, "v1", "renderer final registra fonte V1");
} finally {
  copy.resolverCopyLocalV2 = originalLocal;
  copy.resolverCopyInteligente = originalV1;
}

const logsOriginal = capturarLogs(() => renderizar({
  ...ofertaBase(),
  tituloIa: ""
}, { tituloOferta: "original" })).logs;
const obsOriginal = extrairLog(logsOriginal, TAG_TITULO);
const finalOriginal = extrairLog(logsOriginal, TAG_RENDE_FINAL);
assert.strictEqual(obsOriginal.fonteTitulo, "original", "destino original registra fonte original");
assert.strictEqual(obsOriginal.tituloIaPreExistente, false, "destino original sem tituloIa preexistente registra falso");
assert.strictEqual(finalOriginal.fonteTitulo, "original", "renderer final registra fonte original");

const logsCategoriaDivergente = capturarLogs(() => renderizar({
  ...ofertaBase(),
  tituloIa: "",
  categoria: "Diversos",
  inteligenciaUniversalV2: { categoria: "Gamer e Hardware" }
}, { tituloOferta: "ia" }, { tituloIa: true })).logs;
const obsDivergente = extrairLog(logsCategoriaDivergente, TAG_TITULO);
const finalDivergente = extrairLog(logsCategoriaDivergente, TAG_RENDE_FINAL);
assert.strictEqual(obsDivergente.categoriaRecebidaLocalV2, "Diversos", "copy registra categoria recebida");
assert.strictEqual(finalDivergente.categoriaExibidaTemplate, "Gamer e Hardware", "renderer registra categoria exibida");

console.log("titulo-oferta-apresentacao.test.js OK");
