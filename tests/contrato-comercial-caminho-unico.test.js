const assert = require("assert");

const { montarMensagemOferta } = require("../utils/mensagens-ofertas");

const WORKSPACE_D1 = "user_40qdblgt";

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

function bloco(tipo, textoOriginal, extras = {}) {
  return {
    tipo,
    textoOriginal,
    valorEstruturado: extras.url ? { url: extras.url } : extras.valorEstruturado,
    origem: extras.origem || "fixture",
    confianca: extras.confianca || "alta",
    essencial: extras.essencial === true,
    ordemSugerida: extras.ordemSugerida || 10,
    dedupeKey: `${tipo}:${String(textoOriginal || "").toLowerCase()}`
  };
}

function ofertaComOfcPresente() {
  const documentoComercialCanonico = {
    tituloOriginal: "DIA DE LAVAR A CALCADA",
    marketplace: "mercadolivre",
    precoDeTexto: "R$ 483,00",
    precoPorTexto: "R$ 220,00",
    precoPixTexto: "R$ 483,00 no Pix",
    cupomTexto: "QUEROCUPOM",
    instrucaoTexto: "Aplique o cupom QUEROCUPOM para obter o desconto.",
    linkAfiliado: "https://meli.la/oferta",
    blocos: [
      bloco("titulo", "DIA DE LAVAR A CALCADA", { essencial: true, ordemSugerida: 10 }),
      bloco("marketplace", "mercadolivre", { ordemSugerida: 20 }),
      bloco("categoria", "Casa, Moveis e Decoracao", { ordemSugerida: 30 }),
      bloco("preco_referencia", "R$ 483,00", { ordemSugerida: 40 }),
      bloco("preco_oferta", "R$ 220,00", { essencial: true, ordemSugerida: 50 }),
      bloco("preco_pix", "R$ 483,00 no Pix", { essencial: true, ordemSugerida: 55 }),
      bloco("cupom_codigo", "QUEROCUPOM", { essencial: true, ordemSugerida: 80 }),
      bloco("instrucao_cupom", "Aplique o cupom QUEROCUPOM para obter o desconto.", { ordemSugerida: 90 }),
      bloco("link_afiliado", "https://meli.la/oferta", { url: "https://meli.la/oferta", essencial: true, ordemSugerida: 140 })
    ]
  };

  return {
    id: "oferta_pix_contaminado",
    engineOfertaId: "oferta_pix_contaminado",
    clienteId: WORKSPACE_D1,
    marketplace: "mercadolivre",
    titulo: "DIA DE LAVAR A CALCADA",
    textoOriginal: "De R$ 483 por R$ 220 com cupom QUEROCUPOM",
    precoOriginal: 483,
    precoAtual: 220,
    precoPix: "R$ 483,00 no Pix",
    cupom: "QUEROCUPOM",
    categoria: "Casa, Moveis e Decoracao",
    score: 95,
    linkAfiliado: "https://meli.la/oferta",
    linkFinal: "https://meli.la/oferta",
    link: "https://meli.la/oferta",
    metadata: {
      ofcV24: {
        espelhoComercial: {
          marketplace: "mercadolivre",
          precoDeTexto: "R$ 483,00",
          precoPorTexto: "R$ 220,00",
          precoPixTexto: "R$ 483,00 no Pix",
          formaPagamentoTexto: "Pix",
          cupomCodigo: "QUEROCUPOM",
          instrucaoComercial: "Aplique o cupom QUEROCUPOM para obter o desconto.",
          linkAfiliado: "https://meli.la/oferta",
          documentoComercialCanonico
        },
        documentoComercialCanonico,
        templateEspelhoShadow: {
          ok: true,
          mensagem: [
            "DIA DE LAVAR A CALCADA",
            "De: R$ 483,00\nPor: R$ 220,00\nPix: R$ 483,00 no Pix",
            "Cupom: QUEROCUPOM",
            "Confira aqui: https://meli.la/oferta"
          ].join("\n\n")
        }
      }
    }
  };
}

const { retorno: mensagem, logs } = capturarLogs(() => montarMensagemOferta(ofertaComOfcPresente(), {
  clienteId: WORKSPACE_D1
}));

const saidaLogs = logs.join("\n");

assert(mensagem.includes("De: *R$ 483,00*"));
assert(mensagem.includes("Por: *R$ 220,00*"));
assert(!mensagem.includes("Pix: *R$ 483,00 no Pix*"), "precoDe contaminado nao pode virar linha Pix");
assert(!mensagem.includes("Pix: R$ 483,00 no Pix"), "OFC shadow nao pode bypassar contrato final");
assert(mensagem.includes("Cupom: *QUEROCUPOM*"));
assert(mensagem.includes("Casa, Moveis e Decoracao") || mensagem.includes("Casa, M"));
assert(saidaLogs.includes("[OFC-V2.4-ESPELHO-PILOTO-SHADOW]"));
assert(saidaLogs.includes('"contratoFinalAplicado":true'));
assert(saidaLogs.includes('"rendererEscolhido":"template_universal"'));
assert(saidaLogs.includes("[TEMPLATE-UNIVERSAL-OFICIAL-ENVIADO]"));
assert(!saidaLogs.includes('"templateTipo":"ofc_v24_espelho_piloto"'), "OFC nao pode ser autoridade final da mensagem enviada");

console.log("contrato-comercial-caminho-unico.test.js OK");
