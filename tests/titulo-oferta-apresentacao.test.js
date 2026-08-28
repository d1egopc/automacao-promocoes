const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-titulo-oferta-"));
process.env.DATA_DIR = dataDir;

const { criarTemplate } = require("../modules/templates-clientes/service");
const {
  montarMensagemOferta,
  resolverTituloApresentacaoOferta,
  resolverTituloProdutoApresentacao,
  resolverEmojiSemanticoTitulo
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
assert.ok(mensagemIa.includes("*Produto Original Oficial*"), "destino IA usa titulo factual em destaque");

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
assert.ok(mensagemFanoutIa.includes("*Produto Original Oficial*"), "fanout destino IA inclui titulo factual sem mutar a oferta");
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

const tituloCurto = resolverTituloProdutoApresentacao({
  titulo: "Samsung Galaxy A56 5G 256GB",
  tituloIa: "Celular interessante para ficar de olho."
});
assert.strictEqual(tituloCurto.titulo, "Samsung Galaxy A56 5G 256GB", "titulo curto factual fica inalterado");
assert.strictEqual(tituloCurto.tituloProdutoLimpo, false, "titulo curto nao marca limpeza artificial");

const tituloLongo = resolverTituloProdutoApresentacao({
  titulo: "Cabo USB-C 60W Trancado 2M reforcado para notebook celular tablet compativel com iPhone Samsung Motorola Xiaomi Lenovo Acer Dell HP e outros modelos",
  tituloIa: "Achado simples no radar."
});
assert.ok(tituloLongo.titulo.length < 96, "titulo longo fica compacto");
assert.ok(tituloLongo.titulo.includes("USB-C"), "compactacao preserva USB-C");
assert.ok(tituloLongo.titulo.includes("60W"), "compactacao preserva potencia");
assert.ok(tituloLongo.titulo.includes("2M"), "compactacao preserva tamanho");
assert.strictEqual(tituloLongo.tituloProdutoLimpo, true, "titulo longo marca limpeza quando remove cauda");

for (const esperado of [
  "Notebook Lenovo Ideapad 15 Ryzen 5 8GB 512GB",
  "Panela Inox Itatiaia 40L",
  "Tênis Nike Revolution 7 Masculino 42"
]) {
  assert.strictEqual(
    resolverTituloProdutoApresentacao({ titulo: esperado, tituloIa: "Gancho humano curto" }).titulo,
    esperado,
    `preserva marca/modelo/capacidade/tamanho: ${esperado}`
  );
}

assert.deepStrictEqual(
  resolverTituloProdutoApresentacao({ tituloIa: "Achado simples no radar para quem gosta de novidade." }),
  {
    titulo: "Oferta",
    fonteTituloProduto: "fallback_factual",
    tituloProdutoLimpo: false,
    modoTituloProduto: "fallback"
  },
  "tituloIa sozinho nao vira identidade factual"
);

const tituloIaNaoIdentidade = renderizar({
  ...ofertaBase(),
  titulo: "Achado simples no radar para quem gosta de novidade.",
  tituloIa: "Achado simples no radar para quem gosta de novidade.",
  nome: "Teclado Gamer Redragon Kumara RGB"
}, { tituloOferta: "ia" }, { tituloIa: true });
assert.ok(tituloIaNaoIdentidade.includes("*Teclado Gamer Redragon Kumara RGB*"), "tituloIa preexistente nao vira identidade factual");
assert.ok(tituloIaNaoIdentidade.includes("Achado simples no radar para quem gosta de novidade."), "tituloIa preexistente continua como gancho");

assert.deepStrictEqual(
  resolverEmojiSemanticoTitulo({ categoria: "Gamer e Hardware", titulo: "Teclado Gamer RGB" }),
  { emoji: "🎮", origem: "familia_gamer" },
  "emoji semantico segue familia reconhecida"
);

const TAG_TITULO = "[TITULO-APRESENTACAO-OBS]";
const TAG_RENDE_FINAL = "[OFC-V2.5-RENDERER-FINAL]";

function comC3SemResultado(fn) {
  const originalC3 = copy.resolverCopyC3;
  try {
    copy.resolverCopyC3 = () => ({ ok: false, motivoFallback: "sem_fatos_c3" });
    return fn();
  } finally {
    copy.resolverCopyC3 = originalC3;
  }
}

function renderizarComObsSemantica(extra = {}) {
  copy.limparCacheCopyLocalV2();
  const oferta = {
    ...ofertaBase(),
    id: extra.id || "semantica_render",
    engineOfertaId: extra.engineOfertaId || extra.id || "semantica_render",
    tituloIa: "",
    cupom: "",
    precoOriginal: "",
    descontoPercentual: "",
    ...extra
  };
  const capturado = comC3SemResultado(() =>
    capturarLogs(() => renderizar(oferta, { tituloOferta: "ia" }, { tituloIa: true }))
  );
  return {
    mensagem: capturado.resultado,
    final: extrairLog(capturado.logs, TAG_RENDE_FINAL)
  };
}

let chamadasC3CopyOff = 0;
const originalC3CopyOff = copy.resolverCopyC3;
try {
  copy.resolverCopyC3 = (...args) => {
    chamadasC3CopyOff += 1;
    return originalC3CopyOff(...args);
  };
  renderizar({
    ...ofertaBase(),
    tituloIa: "",
    tituloFactual: "Produto factual com cupom"
  }, { tituloOferta: "original" }, { tituloIa: true });
} finally {
  copy.resolverCopyC3 = originalC3CopyOff;
}
assert.strictEqual(chamadasC3CopyOff, 0, "Copy OFF nao chama C3");

let chamadasC3TituloIaOff = 0;
const originalC3TituloIaOff = copy.resolverCopyC3;
try {
  copy.resolverCopyC3 = (...args) => {
    chamadasC3TituloIaOff += 1;
    return originalC3TituloIaOff(...args);
  };
  renderizar({
    ...ofertaBase(),
    tituloIa: "",
    tituloFactual: "Produto factual com cupom"
  }, { tituloOferta: "ia" }, { tituloIa: false });
} finally {
  copy.resolverCopyC3 = originalC3TituloIaOff;
}
assert.strictEqual(chamadasC3TituloIaOff, 0, "tituloIa=false nao chama C3");

const logsC3Padrao = capturarLogs(() => renderizar({
  ...ofertaBase(),
  id: "c3_padrao_copy_on",
  engineOfertaId: "c3_padrao_copy_on",
  tituloIa: "",
  tituloFactual: "Lava e Seca Philco 10kg",
  categoria: "Eletrodomésticos"
}, { tituloOferta: "ia" }, { tituloIa: true })).logs;
const obsC3Padrao = extrairLog(logsC3Padrao, TAG_TITULO);
assert.strictEqual(obsC3Padrao.fonteTitulo, "copy_c3", "Copy ON com tituloIa usa C3 como motor padrao");
assert.ok(obsC3Padrao.fraseIdC3, "C3 registra fraseId quando vence");

const renderNotebook = renderizarComObsSemantica({
  id: "semantica_notebook",
  categoria: "Computadores e Informatica",
  titulo: "Notebook Lenovo IdeaPad Intel Core i5 16GB 512GB SSD",
  nome: "Notebook Lenovo IdeaPad Intel Core i5 16GB 512GB SSD"
});
assert.ok(renderNotebook.mensagem.startsWith("💻 *Notebook Lenovo IdeaPad Intel Core i5 16GB 512GB SSD*"), "notebook usa emoji computadores");
assert.strictEqual(renderNotebook.final.familiaGancho, "computadores", "notebook usa gancho computadores");
assert.strictEqual(renderNotebook.final.emojiSemanticoOrigem, "familia_computadores", "notebook registra emoji computadores");

const renderComputadorGamerIncidental = renderizarComObsSemantica({
  id: "semantica_pc_gamer_incidental",
  categoria: "Computadores e Informatica",
  titulo: "Notebook Lenovo gamer Intel Core i5 16GB 512GB SSD",
  nome: "Notebook Lenovo gamer Intel Core i5 16GB 512GB SSD"
});
assert.ok(renderComputadorGamerIncidental.mensagem.startsWith("💻 *Notebook Lenovo gamer Intel Core i5 16GB 512GB SSD*"), "termo gamer incidental nao muda emoji computadores");
assert.strictEqual(renderComputadorGamerIncidental.final.familiaGancho, "computadores", "termo gamer incidental nao muda gancho computadores");

const renderCaboUsb = renderizarComObsSemantica({
  id: "semantica_cabo_usb",
  categoria: "Informatica",
  titulo: "Cabo USB-C 60W trancado 2m para celular e notebook",
  nome: "Cabo USB-C 60W trancado 2m para celular e notebook"
});
assert.ok(renderCaboUsb.mensagem.startsWith("💻 *Cabo USB-C 60W trancado 2m para celular e notebook*"), "cabo USB-C de informatica nao vira celulares por palavra incidental");
assert.strictEqual(renderCaboUsb.final.familiaGancho, "computadores", "cabo USB-C preserva familia informatica/computadores");

const renderSmartphone = renderizarComObsSemantica({
  id: "semantica_smartphone",
  categoria: "Celulares e Smartphones",
  titulo: "Smartphone Samsung Galaxy A56 5G 256GB",
  nome: "Smartphone Samsung Galaxy A56 5G 256GB"
});
assert.ok(renderSmartphone.mensagem.startsWith("📱 *Smartphone Samsung Galaxy A56 5G 256GB*"), "smartphone usa emoji celulares");
assert.strictEqual(renderSmartphone.final.familiaGancho, "celulares", "smartphone usa gancho celulares");

const renderGamer = renderizarComObsSemantica({
  id: "semantica_gamer",
  categoria: "Gamer e Hardware",
  titulo: "SSD NVMe para setup gamer",
  nome: "SSD NVMe para setup gamer"
});
assert.ok(renderGamer.mensagem.startsWith("🎮 *SSD NVMe para setup gamer*"), "gamer oficial usa emoji gamer");
assert.strictEqual(renderGamer.final.familiaGancho, "gamer", "gamer oficial usa gancho gamer");

const renderCasaCozinha = renderizarComObsSemantica({
  id: "semantica_casa_cozinha",
  categoria: "Casa, Móveis e Decoração",
  titulo: "Panela de pressao inox 4,5L",
  nome: "Panela de pressao inox 4,5L"
});
assert.ok(renderCasaCozinha.mensagem.startsWith("🍳 *Panela de pressao inox 4,5L*"), "casa com panela refina emoji cozinha");
assert.strictEqual(renderCasaCozinha.final.familiaGancho, "casa", "casa com panela preserva familia casa");

const renderDiversosIndicativo = renderizarComObsSemantica({
  id: "semantica_diversos_indicativo",
  categoria: "Diversos",
  titulo: "Smartphone Samsung Galaxy A56 5G 256GB",
  nome: "Smartphone Samsung Galaxy A56 5G 256GB"
});
assert.ok(renderDiversosIndicativo.mensagem.startsWith("🔥 *Smartphone Samsung Galaxy A56 5G 256GB*"), "Diversos indicativo mantem fallback seguro de emoji");
assert.strictEqual(renderDiversosIndicativo.final.familiaGancho, "oportunidade", "Diversos indicativo mantem familia oportunidade");

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
const logsLocalV2 = comC3SemResultado(() => capturarLogs(() => renderizar({
  ...ofertaBase(),
  tituloIa: "",
  titulo: "Teclado mecanico gamer",
  nome: "Teclado mecanico gamer",
  cupom: "",
  categoria: "Gamer e Hardware"
}, { tituloOferta: "ia" }, { tituloIa: true }))).logs;
const obsLocalV2 = extrairLog(logsLocalV2, TAG_TITULO);
const finalLocalV2 = extrairLog(logsLocalV2, TAG_RENDE_FINAL);
assert.strictEqual(obsLocalV2.fonteTitulo, "local_v2", "local_v2 normal registra fonte");
assert.ok(obsLocalV2.fraseIdLocalV2, "local_v2 registra fraseId");
assert.strictEqual(obsLocalV2.familiaLocalV2, "gamer", "local_v2 registra familia");
assert.strictEqual(obsLocalV2.intencaoLocalV2, "familia", "local_v2 registra intencao");
assert.strictEqual(obsLocalV2.categoriaRecebidaLocalV2, "Gamer e Hardware", "local_v2 registra categoria recebida");
assert.strictEqual(finalLocalV2.fonteTitulo, "local_v2", "renderer final registra fonte local_v2");
assert.strictEqual(finalLocalV2.fonteTituloProduto, "titulo", "renderer final registra fonte do titulo factual");
assert.strictEqual(finalLocalV2.tituloProdutoLimpo, false, "renderer final registra se titulo factual foi limpo");
assert.strictEqual(finalLocalV2.fonteGancho, "local_v2", "renderer final registra fonte do gancho");
assert.ok(finalLocalV2.fraseIdGancho, "renderer final registra fraseId do gancho");
assert.strictEqual(finalLocalV2.familiaGancho, "gamer", "renderer final registra familia do gancho");
assert.strictEqual(finalLocalV2.intencaoGancho, "familia", "renderer final registra intencao do gancho");
assert.strictEqual(finalLocalV2.emojiSemanticoOrigem, "familia_gamer", "renderer final registra origem do emoji");

const originalLocal = copy.resolverCopyLocalV2;
const originalV1 = copy.resolverCopyInteligente;
const originalC3 = copy.resolverCopyC3;
try {
  copy.resolverCopyC3 = () => ({ ok: false, motivoFallback: "sem_fatos_c3" });
  copy.resolverCopyLocalV2 = () => ({ ok: false, motivoFallback: "local_forcado" });
  copy.resolverCopyInteligente = () => ({ ok: true, tituloIa: "V1 curto", fonte: "banco_frases_v1", cacheHit: false, intencao: "cupom" });
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
  copy.resolverCopyC3 = originalC3;
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
assert.strictEqual(finalDivergente.fonteTituloProduto, "titulo", "categoria divergente preserva fonte factual rastreavel");

console.log("titulo-oferta-apresentacao.test.js OK");
