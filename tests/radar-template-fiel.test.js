const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-radar-template-fiel-"));
process.env.DATA_DIR = dataDir;

const { criarTemplate } = require("../modules/templates-clientes/service");
const { resolverTemplateMensagem } = require("../modules/templates-clientes/resolver");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");

const clienteId = "cliente_radar_template_fiel";

function textoSaida(valor = "") {
  return String(valor || "").replace(/\u00a0/g, " ");
}

function assertContem(texto, trecho, mensagem) {
  assert.ok(textoSaida(texto).includes(trecho), mensagem || `esperado conter ${trecho}`);
}

function assertNaoContem(texto, trecho, mensagem) {
  assert.ok(!textoSaida(texto).includes(trecho), mensagem || `nao esperado conter ${trecho}`);
}

function comModoEngine(modo, fn) {
  const anterior = process.env.ENGINE_V2_MODO;
  process.env.ENGINE_V2_MODO = modo;
  try {
    return fn();
  } finally {
    if (anterior === undefined) delete process.env.ENGINE_V2_MODO;
    else process.env.ENGINE_V2_MODO = anterior;
  }
}

const templateSemCupom = criarTemplate(clienteId, {
  nome: "Sem Cupom Obrigatorio",
  canais: ["whatsapp"],
  blocos: [
    { tipo: "titulo", ativo: true, ordem: 10 },
    { tipo: "preco_de", ativo: true, ordem: 20 },
    { tipo: "preco_por", ativo: true, ordem: 30 },
    { tipo: "link", ativo: true, ordem: 40 }
  ]
}).template;

const ofertaRadarComCupomObrigatorio = {
  clienteId,
  titulo: "Chapa Gloss Rose 230°C Bivolt 110V/220V Taiff",
  marketplace: "mercadolivre",
  precoOriginal: 359.9,
  precoAtual: 152.32,
  preco: 152.32,
  cupom: "MELI26TODOSITE",
  codigoCupom: "MELI26TODOSITE",
  cupomConfirmado: true,
  instrucaoCupom: "Por: R$ 152,32 (Com Cupom)",
  fonteComercial: "radar_mirror",
  textoComercialOriginal: "Por: R$ 152,32 (Com Cupom)\nCupom: MELI26TODOSITE",
  linkAfiliado: "https://meli.la/22hdJXT",
  metadata: {
    radarMirror: {
      cupom: { codigoCapturado: "MELI26TODOSITE", condicaoCapturada: "Com Cupom" },
      preco: { condicaoTexto: "Com Cupom" }
    }
  }
};

const resolvido = resolverTemplateMensagem({
  clienteId,
  destino: { templateId: templateSemCupom.id, tipo: "whatsapp" },
  oferta: ofertaRadarComCupomObrigatorio,
  canal: "whatsapp"
});

assert.strictEqual(resolvido.usarUniversal, true, "template sem cupom obrigatorio cai no universal");
assert.strictEqual(resolvido.ok, false);
assert.strictEqual(resolvido.motivo, "template_sem_cupom_obrigatorio");

const mensagem = montarMensagemOferta(ofertaRadarComCupomObrigatorio, {
  clienteId,
  destino: { templateId: templateSemCupom.id, tipo: "whatsapp" }
});
assert.ok(mensagem.includes("MELI26TODOSITE"), "fallback universal preserva cupom obrigatorio");
assert.ok(mensagem.includes("R$ 359,90"), "fallback universal preserva preco de");
assert.ok(mensagem.includes("R$ 152,32"), "fallback universal preserva preco por");
assert.ok(/cupom/i.test(mensagem), "fallback universal preserva contexto de cupom");

const renderScoreSemAvaliacao = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Produto sem avaliacao real",
    precoAtual: 99.9,
    score: 99,
    linkAfiliado: "https://example.com/produto"
  },
  template: {
    id: "tpl_score_sem_avaliacao",
    canais: ["whatsapp"],
    blocos: [{ tipo: "avaliacao", ativo: true, ordem: 10 }]
  },
  canal: "whatsapp"
});
assert.ok(!renderScoreSemAvaliacao.mensagem.includes("Avalia"), "score interno nao gera avaliacao visual");

const renderAvaliacaoReal = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Produto com avaliacao real",
    precoAtual: 99.9,
    avaliacao: "4,8/5",
    score: 99,
    linkAfiliado: "https://example.com/produto"
  },
  template: {
    id: "tpl_avaliacao_real",
    canais: ["whatsapp"],
    blocos: [{ tipo: "avaliacao", ativo: true, ordem: 10 }]
  },
  canal: "whatsapp"
});
assert.ok(renderAvaliacaoReal.mensagem.includes("Avalia"), "avaliacao real continua aparecendo");
assert.ok(renderAvaliacaoReal.mensagem.includes("⭐⭐⭐⭐⭐"), "rating real vira estrelas");

const tituloSmartTvShopee = "Smart Tv Hq Qled 50 Polegadas";
const renderSmartTvShopeeSemPapelDuplicado = renderizarTemplatePersonalizado({
  oferta: {
    titulo: tituloSmartTvShopee,
    marketplace: "Shopee",
    categoria: "Audio TV",
    precoAtual: 1442,
    cupom: "F3L1Z200",
    freteGratis: true,
    beneficios: [tituloSmartTvShopee],
    beneficioTexto: tituloSmartTvShopee,
    avaliacao: tituloSmartTvShopee,
    linkAfiliado: "https://shopee.afiliado/smart-tv"
  },
  template: {
    id: "tpl_smart_tv_sem_papel_duplicado",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "marketplace", ativo: true, ordem: 20 },
      { tipo: "categoria", ativo: true, ordem: 30 },
      { tipo: "preco_por", ativo: true, ordem: 40 },
      { tipo: "cupom", ativo: true, ordem: 50 },
      { tipo: "beneficio", ativo: true, ordem: 60 },
      { tipo: "avaliacao", ativo: true, ordem: 70 },
      { tipo: "frete", ativo: true, ordem: 80 },
      { tipo: "link", ativo: true, ordem: 90 }
    ]
  },
  canal: "whatsapp"
});
assert.strictEqual(renderSmartTvShopeeSemPapelDuplicado.mensagem.split(tituloSmartTvShopee).length - 1, 1, "titulo nao vira beneficio ou prova social");
assertContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, "Shopee");
assertContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, "Audio TV");
assertContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, "Por:");
assertContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, "R$ 1.442,00");
assertContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, "Cupom: F3L1Z200");
assertContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, "Frete gratis");
assertContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, "Confira aqui:");
assertNaoContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, `⭐ ${tituloSmartTvShopee}`);
assertNaoContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, `🎁 ${tituloSmartTvShopee}`);
assertNaoContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, "Avalia");
assertNaoContem(renderSmartTvShopeeSemPapelDuplicado.mensagem, "Benef");

const mensagemResolverOficial = comModoEngine("full", () => montarMensagemOferta(ofertaRadarComCupomObrigatorio, {
  clienteId,
  destino: { tipo: "whatsapp" }
}));
assertContem(mensagemResolverOficial, "R$ 359,90", "resolver oficial preserva preco anterior");
assertContem(mensagemResolverOficial, "R$ 152,32", "resolver oficial preserva preco atual");
assertContem(mensagemResolverOficial, "MELI26TODOSITE", "resolver oficial preserva cupom");

const ofertaPuma = {
  clienteId,
  titulo: "Tênis Puma Carina Street BDP",
  marketplace: "mercadolivre",
  precoOriginal: 75,
  precoAntigo: 75,
  precoAtual: 31,
  preco: 31,
  precoUnitario: "R$ 2,58 cada",
  condicaoPix: "no Pix",
  parcelamento: "R$ 215,83 em até 6x",
  cupons: ["FASHION", "MODACOMVC"],
  codigosCupom: ["FASHION", "MODACOMVC"],
  instrucaoCupom: "Cupom: FASHION ou MODACOMVC",
  linkAfiliado: "https://meli.la/teste-puma"
};

const mensagemCustomLegado = comModoEngine("shadow", () => montarMensagemOferta(ofertaPuma, {
  clienteId,
  plano: { recursos: { templatePersonalizado: true } },
  destino: {
    tipo: "whatsapp",
    mensagemOferta: {
      modo: "personalizado",
      template: [
        "{titulo}",
        "De {precoAntigo}",
        "Por {preco}",
        "{condicaoPix}",
        "{precoUnitario}",
        "{parcelamento}",
        "Cupom {cupom}",
        "{instrucaoCupom}",
        "{link}"
      ].join("\n")
    }
  }
}));
assertContem(mensagemCustomLegado, "R$ 75,00", "custom legado recebe preco anterior oficial");
assertContem(mensagemCustomLegado, "R$ 31,00", "custom legado recebe preco atual oficial");
assertContem(mensagemCustomLegado, "R$ 2,58 cada", "custom legado preserva preco unitario");
assertContem(mensagemCustomLegado, "FASHION ou MODACOMVC", "custom legado preserva multiplos cupons");
assertContem(mensagemCustomLegado, "no Pix", "custom legado preserva Pix");
assertContem(mensagemCustomLegado, "R$ 215,83 em até 6x", "custom legado preserva parcelamento");
assertNaoContem(mensagemCustomLegado, "Por R$ 2,58", "preco unitario nao vira preco principal");

const mensagemFallbackFormatarOferta = comModoEngine("shadow", () => montarMensagemOferta(ofertaPuma, {
  clienteId,
  destino: { tipo: "whatsapp" }
}));
assertContem(mensagemFallbackFormatarOferta, "R$ 75,00", "formatarOfertaUniversal preserva preco anterior");
assertContem(mensagemFallbackFormatarOferta, "R$ 31,00", "formatarOfertaUniversal preserva preco atual");
assertContem(mensagemFallbackFormatarOferta, "FASHION ou MODACOMVC", "formatarOfertaUniversal preserva multiplos cupons");
assertContem(mensagemFallbackFormatarOferta, "no Pix", "formatarOfertaUniversal preserva Pix");
assertContem(mensagemFallbackFormatarOferta, "R$ 215,83 em até 6x", "formatarOfertaUniversal preserva parcelamento");
assertContem(mensagemFallbackFormatarOferta, "R$ 2,58 cada", "formatarOfertaUniversal preserva preco unitario como contexto");
assertNaoContem(mensagemFallbackFormatarOferta, "Por: R$ 2,58", "formatarOfertaUniversal nao usa unitario como preco principal");

const ofertaProgramePoupe = {
  clienteId,
  titulo: "Leve 2 unidades",
  marketplace: "mercadolivre",
  precoAtual: 66.63,
  preco: 66.63,
  precoUnitario: "R$ 33,32 cada",
  cupom: "15ACESS",
  codigoCupom: "15ACESS",
  instrucaoCupom: "selecione programe e poupe",
  linkAfiliado: "https://meli.la/teste-programe"
};

const mensagemProgramePoupe = comModoEngine("shadow", () => montarMensagemOferta(ofertaProgramePoupe, {
  clienteId,
  destino: { tipo: "whatsapp" }
}));
assertContem(mensagemProgramePoupe, "R$ 66,63", "fallback preserva preco total");
assertContem(mensagemProgramePoupe, "R$ 33,32 cada", "fallback preserva preco unitario separado");
assertContem(mensagemProgramePoupe, "15ACESS", "fallback preserva cupom unico");
assertContem(mensagemProgramePoupe, "programe e poupe", "fallback preserva instrucao do cupom");
assertNaoContem(mensagemProgramePoupe, "Por: R$ 33,32", "fallback nao substitui total por unitario");

const mensagemTemplateIncompleto = comModoEngine("shadow", () => montarMensagemOferta(ofertaRadarComCupomObrigatorio, {
  clienteId,
  plano: { recursos: { templatePersonalizado: true } },
  destino: {
    tipo: "whatsapp",
    mensagemOferta: {
      modo: "personalizado",
      template: "{titulo}\nPor {preco}\n{link}"
    }
  }
}));
assertContem(mensagemTemplateIncompleto, "MELI26TODOSITE", "custom legado incompleto cai em fallback seguro com cupom");
assertContem(mensagemTemplateIncompleto, "R$ 359,90", "custom legado incompleto nao apaga preco anterior");
assertContem(mensagemTemplateIncompleto, "Com Cupom", "custom legado incompleto preserva instrucao");

console.log("radar-template-fiel: ok");
