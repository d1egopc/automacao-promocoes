"use strict";

const assert = require("assert");

const templateUniversalPath = require.resolve("../modules/template-universal");
const mensagensOfertasPath = require.resolve("../utils/mensagens-ofertas");
const templateUniversalOriginal = require(templateUniversalPath);

function carregarMontadorComTemplateUniversal(gerarTemplateUniversal) {
  require.cache[templateUniversalPath].exports = {
    ...templateUniversalOriginal,
    gerarTemplateUniversal
  };
  delete require.cache[mensagensOfertasPath];
  return require("../utils/mensagens-ofertas").montarMensagemOferta;
}

function restaurarModulos() {
  require.cache[templateUniversalPath].exports = templateUniversalOriginal;
  delete require.cache[mensagensOfertasPath];
}

function capturarLogs(fn) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const logs = [];
  console.log = (...args) => logs.push(args.map(String).join(" "));
  console.warn = (...args) => logs.push(args.map(String).join(" "));
  try {
    const retorno = fn();
    return { retorno, logs };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

function ofertaBase(extras = {}) {
  return {
    clienteId: "cliente_isolamento",
    marketplace: "shopee",
    titulo: "Produto que o legado reconstruiria",
    precoAtual: 99.9,
    preco: 99.9,
    cupom: "LEGADO10",
    linkAfiliado: "https://afiliado.test/produto",
    ...extras
  };
}

const destinoComTemplateLegado = {
  tipo: "whatsapp",
  mensagemOferta: {
    modo: "personalizado",
    template: "LEGADO {titulo}\nPor {preco}\nCupom {cupom}\n{link}"
  }
};

try {
  process.env.ENGINE_V2_MODO = "shadow";
  let chamadasUniversal = 0;
  const montarMensagemOfertaUniversal = carregarMontadorComTemplateUniversal(() => {
    chamadasUniversal += 1;
    return "TEMPLATE UNIVERSAL OFICIAL";
  });
  const { retorno: mensagemUniversal, logs: logsUniversal } = capturarLogs(() => montarMensagemOfertaUniversal(ofertaBase(), {
    clienteId: "cliente_isolamento",
    destino: destinoComTemplateLegado,
    plano: { recursos: { templatePersonalizado: true } }
  }));
  assert.strictEqual(chamadasUniversal, 1, "Template Universal Oficial e chamado mesmo em shadow");
  assert.strictEqual(mensagemUniversal, "TEMPLATE UNIVERSAL OFICIAL");
  assert.ok(!mensagemUniversal.includes("LEGADO"), "template comercial legado nao renderiza quando Universal funciona");
  assert.ok(logsUniversal.some(linha => linha.includes('"rendererEscolhido":"template_universal"')), "renderer final registra Template Universal");

  const mensagemExistente = "MENSAGEM EXISTENTE JA PRONTA";
  const montarMensagemOfertaUniversalVazio = carregarMontadorComTemplateUniversal(() => "");
  const { retorno: fallbackExistente, logs: logsExistente } = capturarLogs(() => montarMensagemOfertaUniversalVazio(ofertaBase({
    mensagem: mensagemExistente
  }), {
    clienteId: "cliente_isolamento",
    destino: destinoComTemplateLegado,
    plano: { recursos: { templatePersonalizado: true } }
  }));
  assert.strictEqual(fallbackExistente, mensagemExistente, "Universal vazio reutiliza mensagem existente");
  assert.ok(!fallbackExistente.includes("Produto que o legado reconstruiria"), "fallback nao reconstrói mensagem comercial legada");
  assert.ok(logsExistente.some(linha => linha.includes('"rendererEscolhido":"renderer_oficial"')), "fallback usa renderer oficial");
  assert.ok(logsExistente.some(linha => linha.includes("mensagem_existente_sem_reconstrucao")), "fallback informa isolamento do legado");

  const montarMensagemOfertaUniversalErro = carregarMontadorComTemplateUniversal(() => {
    throw new Error("falha_controlada_universal");
  });
  const { retorno: fallbackSemExistente } = capturarLogs(() => montarMensagemOfertaUniversalErro(ofertaBase(), {
    clienteId: "cliente_isolamento",
    destino: destinoComTemplateLegado,
    plano: { recursos: { templatePersonalizado: true } }
  }));
  assert.strictEqual(
    fallbackSemExistente,
    "Oferta recebida. Renderizacao oficial indisponivel no momento.",
    "sem mensagem existente, fallback oficial continua nao vazio"
  );
  assert.ok(!fallbackSemExistente.includes("Produto que o legado reconstruiria"), "fallback minimo nao reconstroi conteudo comercial");
} finally {
  restaurarModulos();
}

console.log("ofc-renderer-oficial-isolamento.test.js OK");
