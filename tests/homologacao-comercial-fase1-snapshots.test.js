"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-homologacao-fase1-"));

const {
  CLASSES_BLOCOS_COMERCIAIS,
  classificarBlocoComercial,
  listarCatalogoLinksComerciais,
  papelLinkComercialOficial,
  togglePodeOcultarBloco
} = require("../modules/templates-clientes/politica-blocos-comerciais");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");
const {
  construirEspelhoComercialV24,
  montarTemplateEspelhoPorBlocosV26
} = require("../modules/ofc-v2/espelho-comercial");

function texto(valor = "") {
  return String(valor || "").replace(/\u00A0/g, " ").trim();
}

function normalizar(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function contem(mensagem = "", trecho = "") {
  return normalizar(mensagem).includes(normalizar(trecho));
}

function ocorrencias(mensagem = "", trecho = "") {
  const alvo = normalizar(trecho);
  if (!alvo) return 0;
  return normalizar(mensagem).split(alvo).length - 1;
}

function emOrdem(mensagem = "", trechos = []) {
  const fonte = normalizar(mensagem);
  let cursor = -1;
  for (const trecho of trechos) {
    const indice = fonte.indexOf(normalizar(trecho), cursor + 1);
    if (indice < 0) return false;
    cursor = indice;
  }
  return true;
}

function urlsDistintas(mensagem = "", urls = []) {
  return urls.every(url => ocorrencias(mensagem, url) === 1) &&
    new Set(urls.map(texto)).size === urls.length;
}

function criarSnapshotRecorder() {
  const resultados = [];
  return {
    check(nome, descricao, passou, detalhe = "") {
      resultados.push({ nome, descricao, passou: passou === true, detalhe });
    },
    resumo() {
      const agrupado = new Map();
      for (const item of resultados) {
        const atual = agrupado.get(item.nome) || { nome: item.nome, passou: true, divergencias: [] };
        if (!item.passou) {
          atual.passou = false;
          atual.divergencias.push({ descricao: item.descricao, detalhe: item.detalhe });
        }
        agrupado.set(item.nome, atual);
      }
      return [...agrupado.values()];
    },
    falhas() {
      return this.resumo().filter(item => !item.passou);
    }
  };
}

function assertPoliticaOficial() {
  assert.strictEqual(
    classificarBlocoComercial("titulo").classe,
    CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_OBRIGATORIO
  );
  assert.strictEqual(
    classificarBlocoComercial("preco_por").classe,
    CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_OBRIGATORIO
  );
  assert.strictEqual(
    classificarBlocoComercial("link").classe,
    CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_OBRIGATORIO
  );
  assert.strictEqual(
    classificarBlocoComercial("cupom", { condicionaPreco: true }).classe,
    CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO
  );
  assert.strictEqual(
    togglePodeOcultarBloco("link_resgate", { essencial: true }),
    false
  );
  assert.deepStrictEqual(
    listarCatalogoLinksComerciais().map(item => item.papel),
    ["link_produto", "link_resgate", "link_app", "link_moedas", "link_pc"]
  );
  assert.strictEqual(papelLinkComercialOficial("link_moedas"), "link_moedas");
}

function mensagemPadrao(oferta = {}) {
  return montarMensagemOferta(oferta, {
    clienteId: "snapshot_fase1",
    destino: { tipo: "whatsapp", templateId: "padrao_optimus" },
    plano: { recursos: { templatePersonalizado: true } }
  });
}

function criarEspelho({ textoOriginal = "", oferta = {}, ofertaEntrada = {}, comercialNormalizado = {} } = {}) {
  return construirEspelhoComercialV24({
    evento: { texto_original: textoOriginal },
    job: {
      id: 101,
      cliente_id: "snapshot_fase1",
      marketplace_detectado: oferta.marketplace || ofertaEntrada.marketplace || "mercadolivre"
    },
    oferta: {
      titulo: oferta.titulo || "Titulo capturado",
      marketplace: oferta.marketplace || "mercadolivre",
      preco: oferta.preco ?? oferta.precoAtual ?? 100,
      linkAfiliado: oferta.linkAfiliado || "",
      ...oferta
    },
    ofertaEntrada,
    comercialNormalizado: {
      marketplace: oferta.marketplace || ofertaEntrada.marketplace || "mercadolivre",
      precoAtual: oferta.preco ?? oferta.precoAtual ?? 100,
      precoConfiavel: true,
      ...comercialNormalizado
    }
  });
}

function linksAliExpress({ app = "", moedas = "", pc = "" } = {}) {
  return [
    app ? {
      papel: "link_app",
      urlOriginal: "https://a.aliexpress.com/_appOriginal",
      urlAfiliada: app,
      renderizavel: true,
      seguro: true,
      convertidoWorkspace: true
    } : null,
    moedas ? {
      papel: "link_moedas",
      urlOriginal: "https://a.aliexpress.com/_moedasOriginal",
      urlAfiliada: moedas,
      renderizavel: true,
      seguro: true,
      convertidoWorkspace: true
    } : null,
    pc ? {
      papel: "link_pc",
      urlOriginal: "https://a.aliexpress.com/_pcOriginal",
      urlAfiliada: pc,
      renderizavel: true,
      seguro: true,
      convertidoWorkspace: true
    } : null
  ].filter(Boolean);
}

function renderizarAliExpress({
  textoOriginal = "",
  titulo = "SSD AliExpress 512GB",
  preco = 83,
  categoria = "Informatica",
  linksComerciais = [],
  imagem = "",
  template = {}
} = {}) {
  const espelho = criarEspelho({
    textoOriginal,
    oferta: {
      titulo,
      marketplace: "aliexpress",
      categoria,
      preco,
      imagem,
      linksComerciais
    },
    comercialNormalizado: { marketplace: "aliexpress", precoAtual: preco, categoria, precoConfiavel: true }
  });
  const resultado = montarTemplateEspelhoPorBlocosV26(
    espelho.espelhoComercial,
    espelho.documentoComercialCanonico,
    { template }
  );
  return { espelho, resultado, mensagem: resultado.mensagem };
}

function renderizarAmazon({
  textoOriginal = "",
  titulo = "Produto Amazon",
  preco = 100,
  categoria = "Eletronicos",
  linkAfiliado = "https://amzn.to/oferta-amazon",
  oferta = {},
  ofertaEntrada = {},
  template = {}
} = {}) {
  const espelho = criarEspelho({
    textoOriginal,
    oferta: {
      titulo,
      marketplace: "amazon",
      categoria,
      preco,
      linkAfiliado,
      ...oferta
    },
    ofertaEntrada,
    comercialNormalizado: { marketplace: "amazon", precoAtual: preco, categoria, precoConfiavel: true }
  });
  const resultado = montarTemplateEspelhoPorBlocosV26(
    espelho.espelhoComercial,
    espelho.documentoComercialCanonico,
    { template }
  );
  return { espelho, resultado, mensagem: resultado.mensagem };
}

function renderizarMercadoLivre({
  textoOriginal = "",
  titulo = "Produto Mercado Livre",
  preco = 100,
  categoria = "Moda",
  linkAfiliado = "https://meli.la/oferta-ml",
  oferta = {},
  ofertaEntrada = {},
  template = {}
} = {}) {
  const espelho = criarEspelho({
    textoOriginal,
    oferta: {
      titulo,
      marketplace: "mercadolivre",
      categoria,
      preco,
      linkAfiliado,
      ...oferta
    },
    ofertaEntrada,
    comercialNormalizado: { marketplace: "mercadolivre", precoAtual: preco, categoria, precoConfiavel: true }
  });
  const resultado = montarTemplateEspelhoPorBlocosV26(
    espelho.espelhoComercial,
    espelho.documentoComercialCanonico,
    { template }
  );
  return { espelho, resultado, mensagem: resultado.mensagem };
}

function renderizarKabumAwin({
  textoOriginal = "",
  titulo = "Produto KaBuM",
  preco = 100,
  categoria = "Gamer e Hardware",
  marketplace = "kabum",
  linkAfiliado = "https://www.awin1.com/cread.php?awinmid=17729&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F123",
  oferta = {},
  ofertaEntrada = {},
  template = {}
} = {}) {
  const espelho = criarEspelho({
    textoOriginal,
    oferta: {
      titulo,
      marketplace,
      categoria,
      preco,
      linkAfiliado,
      ...oferta
    },
    ofertaEntrada,
    comercialNormalizado: { marketplace, precoAtual: preco, categoria, precoConfiavel: true }
  });
  const resultado = montarTemplateEspelhoPorBlocosV26(
    espelho.espelhoComercial,
    espelho.documentoComercialCanonico,
    { template }
  );
  return { espelho, resultado, mensagem: resultado.mensagem };
}

assertPoliticaOficial();

const recorder = criarSnapshotRecorder();

const amazonCaso1 = renderizarAmazon({
  textoOriginal: [
    "Amazon / Amazon",
    "Por: R$ 739,99 No Pix",
    "Pix: R$ 2,00 No Pix",
    "10x de R$ 94,17 sem juros",
    "Cupons: HEYCUPOM ou HEYCUPOMRESGATE",
    "Resgate no anuncio",
    "R$20 OFF no cupom/pagina"
  ].join("\n"),
  titulo: "Amazon / Amazon",
  preco: 739.99,
  linkAfiliado: "https://amzn.to/amazon-caso1"
});
const amazonMensagem = amazonCaso1.mensagem;
recorder.check("amazon_template_padrao", "preserva ordem oficial Amazon no OFC", emOrdem(amazonMensagem, [
  "Amazon / Amazon",
  "Amazon",
  "Eletronicos",
  "Por: R$ 739,99 No Pix",
  "10x de R$ 94,17 sem juros",
  "Cupom: HEYCUPOM",
  "resgate no anuncio",
  "R$20 OFF no cupom/pagina",
  "https://amzn.to/amazon-caso1",
  "Oferta sujeita"
]), amazonMensagem);
recorder.check("amazon_template_padrao", "falso Pix R$2,00 nao renderiza e preco no Pix nao duplica bloco Pix", !contem(amazonMensagem, "Pix: R$ 2,00") && ocorrencias(amazonMensagem, "No Pix") === 1, amazonMensagem);
recorder.check("amazon_template_padrao", "HEYCUPOMRESGATE nao vira codigo publico e HEYCUPOM permanece codigo", contem(amazonMensagem, "Cupom: HEYCUPOM") && !contem(amazonMensagem, "Cupons: HEYCUPOM ou HEYCUPOMRESGATE"), amazonMensagem);
recorder.check("amazon_template_padrao", "resgate aparece uma vez e beneficio real permanece separado", ocorrencias(amazonMensagem, "resgate no anuncio") === 1 && contem(amazonMensagem, "R$20 OFF no cupom/pagina"), amazonMensagem);
recorder.check("amazon_template_padrao", "aviso editorial aparece uma vez e marcado no documento", ocorrencias(amazonMensagem, "Oferta sujeita") === 1 && amazonCaso1.espelho.documentoComercialCanonico.blocos.some(bloco => bloco.tipo === "aviso" && bloco.origem === "editorial_sistema"), JSON.stringify(amazonCaso1.espelho.documentoComercialCanonico.blocos));

const amazonCaso2 = renderizarAmazon({
  textoOriginal: [
    "Monitor Gamer Philips",
    "Por: R$ 539,00",
    "12x de R$ 58,36 sem juros",
    "Resgate o cupom no anuncio",
    "R$20 OFF no cupom/pagina"
  ].join("\n"),
  titulo: "Monitor Gamer Philips",
  preco: 539,
  linkAfiliado: "https://amzn.to/monitor-philips"
});
recorder.check("amazon_resgate_sem_codigo", "somente resgate nao cria bloco Cupom e nao duplica frase", !contem(amazonCaso2.mensagem, "Cupom:") && ocorrencias(amazonCaso2.mensagem, "Resgate o cupom no anuncio") === 1, amazonCaso2.mensagem);
recorder.check("amazon_resgate_sem_codigo", "parcelamento e beneficio real permanecem separados", contem(amazonCaso2.mensagem, "12x de R$ 58,36 sem juros") && contem(amazonCaso2.mensagem, "R$20 OFF no cupom/pagina"), amazonCaso2.mensagem);

const amazonCaso3 = renderizarAmazon({
  textoOriginal: [
    "Produto Amazon coerente",
    "Por: R$ 199,00",
    "Cupom: HEYCUPOM",
    "Use cupom: HEYCUPOM ou resgate no anuncio",
    "R$20 OFF no cupom/pagina"
  ].join("\n"),
  titulo: "Produto Amazon coerente",
  preco: 199,
  linkAfiliado: "https://amzn.to/produto-coerente"
});
recorder.check("amazon_cupom_resgate_coerente", "preserva combinacao capturada de cupom real e resgate", contem(amazonCaso3.mensagem, "Cupom: HEYCUPOM") && contem(amazonCaso3.mensagem, "Use cupom: HEYCUPOM ou resgate no anuncio") && contem(amazonCaso3.mensagem, "R$20 OFF no cupom/pagina"), amazonCaso3.mensagem);

const amazonFretePrime = renderizarAmazon({
  textoOriginal: [
    "Produto Amazon Prime",
    "Por: R$ 89,90",
    "Frete gratis",
    "Prime"
  ].join("\n"),
  titulo: "Produto Amazon Prime",
  preco: 89.9,
  linkAfiliado: "https://amzn.to/prime-frete"
});
recorder.check("amazon_frete_prime", "frete e Prime capturados permanecem", contem(amazonFretePrime.mensagem, "Frete gratis") && contem(amazonFretePrime.mensagem, "Prime") && contem(amazonFretePrime.mensagem, "https://amzn.to/prime-frete"), amazonFretePrime.mensagem);

const mlCasoPix10 = renderizarMercadoLivre({
  textoOriginal: [
    "AQUELE BASICO QUE NAO TEM COMO ERRAR",
    "Mercado Livre",
    "Tenis e Chinelos",
    "De: R$ 239,99",
    "Por: R$ 117,20 no Pix",
    "Pix: R$ 10,00 no Pix",
    "Cupom: OFICIALMODA",
    "Aplique o cupom OFICIALMODA + Pix para chegar neste valor."
  ].join("\n"),
  titulo: "AQUELE BASICO QUE NAO TEM COMO ERRAR",
  preco: 117.2,
  categoria: "Tenis e Chinelos",
  linkAfiliado: "https://meli.la/oficialmoda-tenis"
});
const mlPix10Mensagem = mlCasoPix10.mensagem;
recorder.check("mercadolivre_preco_pix_cupom", "preserva ordem oficial Mercado Livre no OFC", emOrdem(mlPix10Mensagem, [
  "AQUELE BASICO QUE NAO TEM COMO ERRAR",
  "Mercado Livre",
  "Tenis e Chinelos",
  "De: R$ 239,99",
  "Por: R$ 117,20 no Pix",
  "Cupom: OFICIALMODA",
  "Aplique o cupom OFICIALMODA + Pix para chegar neste valor.",
  "Confira aqui",
  "https://meli.la/oficialmoda-tenis",
  "Oferta sujeita"
]), mlPix10Mensagem);
recorder.check("mercadolivre_preco_pix_cupom", "Por no Pix nao duplica bloco Pix de economia", !contem(mlPix10Mensagem, "Pix: R$ 10,00 no Pix") && ocorrencias(mlPix10Mensagem, "Pix") === 2, mlPix10Mensagem);
recorder.check("mercadolivre_preco_pix_cupom", "instrucao capturada aparece uma vez e aviso editorial unico", ocorrencias(mlPix10Mensagem, "Aplique o cupom OFICIALMODA + Pix") === 1 && ocorrencias(mlPix10Mensagem, "Oferta sujeita") === 1, mlPix10Mensagem);

const mlCasoPix3 = renderizarMercadoLivre({
  textoOriginal: [
    "Kit com 3 Calca Sarja Alfaiataria Slim",
    "De: R$ 249,00",
    "Por: R$ 126,00 no Pix",
    "Pix: R$ 3,00 no Pix",
    "Cupom: OFICIALMODA",
    "Aplique o cupom OFICIALMODA + Pix para chegar neste valor."
  ].join("\n"),
  titulo: "Kit com 3 Calca Sarja Alfaiataria Slim",
  preco: 126,
  categoria: "Moda",
  linkAfiliado: "https://meli.la/oficialmoda-calca"
});
recorder.check("mercadolivre_pix_economia_bloqueado", "R$3 de economia nao vira preco Pix separado", contem(mlCasoPix3.mensagem, "Por: R$ 126,00 no Pix") && !contem(mlCasoPix3.mensagem, "Pix: R$ 3,00 no Pix"), mlCasoPix3.mensagem);

const mlDeValido = renderizarMercadoLivre({
  textoOriginal: "Produto ML desconto real\nDe: R$ 700,00\nPor: R$ 599,00",
  titulo: "Produto ML desconto real",
  preco: 599,
  categoria: "Eletronicos",
  linkAfiliado: "https://meli.la/de-valido"
});
recorder.check("mercadolivre_preco_de_valido", "De maior que Por permanece", contem(mlDeValido.mensagem, "De: R$ 700,00") && contem(mlDeValido.mensagem, "Por: R$ 599,00"), mlDeValido.mensagem);

const mlDeInvalido = renderizarMercadoLivre({
  textoOriginal: "Produto ML sem desconto real\nDe: R$ 700,00\nPor: R$ 810,00",
  titulo: "Produto ML sem desconto real",
  preco: 810,
  categoria: "Eletronicos",
  linkAfiliado: "https://meli.la/de-invalido"
});
recorder.check("mercadolivre_preco_de_invalido", "De menor ou igual a Por nao renderiza desconto falso", !contem(mlDeInvalido.mensagem, "De: R$ 700,00") && contem(mlDeInvalido.mensagem, "Por: R$ 810,00"), mlDeInvalido.mensagem);
recorder.check("mercadolivre_preco_de_invalido", "inconsistencia fica em auditoria interna", mlDeInvalido.espelho.documentoComercialCanonico.auditoriaComercial?.avisosInternos?.includes("preco_de_menor_ou_igual_preco_por_omitido"), JSON.stringify(mlDeInvalido.espelho.documentoComercialCanonico.auditoriaComercial));

const mlMultiplosCupons = renderizarMercadoLivre({
  textoOriginal: [
    "Kit Mercado Livre com multiplos cupons",
    "Por: R$ 198,80",
    "Cupons: CUPOM10 ou MODASEMPRE"
  ].join("\n"),
  titulo: "Kit Mercado Livre com multiplos cupons",
  preco: 198.8,
  categoria: "Moda",
  linkAfiliado: "https://meli.la/oferta-multicupom"
});
recorder.check("mercadolivre_multiplos_cupons", "preserva codigos reais sem frase generica inventada", contem(mlMultiplosCupons.mensagem, "Cupons: CUPOM10 • MODASEMPRE") && !contem(mlMultiplosCupons.mensagem, "Aplique um dos cupons"), mlMultiplosCupons.mensagem);
recorder.check("mercadolivre_multiplos_cupons", "link afiliado e aviso editorial permanecem unicos", ocorrencias(mlMultiplosCupons.mensagem, "https://meli.la/oferta-multicupom") === 1 && ocorrencias(mlMultiplosCupons.mensagem, "Oferta sujeita") === 1, mlMultiplosCupons.mensagem);

const shopeeMensagem = mensagemPadrao({
  titulo: "Fone Bluetooth Shopee",
  marketplace: "shopee",
  categoria: "Audio",
  precoAtual: 89.9,
  linksComerciais: [
    { tipo: "resgate", afiliado: "https://s.shopee.com.br/resgate-afiliado", original: "https://s.shopee.com.br/resgate-original" },
    { tipo: "produto", afiliado: "https://s.shopee.com.br/produto-afiliado", original: "https://s.shopee.com.br/produto-original" }
  ],
  linkAfiliado: "https://s.shopee.com.br/produto-afiliado"
});
recorder.check("shopee_links_distintos", "produto e resgate ficam separados", emOrdem(shopeeMensagem, [
  "Resgate",
  "https://s.shopee.com.br/resgate-afiliado",
  "Confira aqui",
  "https://s.shopee.com.br/produto-afiliado"
]), shopeeMensagem);
recorder.check("shopee_links_distintos", "nao duplica URLs de produto e resgate", urlsDistintas(shopeeMensagem, [
  "https://s.shopee.com.br/resgate-afiliado",
  "https://s.shopee.com.br/produto-afiliado"
]), shopeeMensagem);

const aliEspelho = criarEspelho({
  textoOriginal: [
    "SSD AliExpress 512GB",
    "Por R$ 83,00",
    "Cupom: BRAE1 ou IFPZKUPM",
    "Resgate o cupom da loja + 821 moedas no APP",
    "Link APP: https://a.aliexpress.com/_appOriginal",
    "Link PC: https://a.aliexpress.com/_pcOriginal"
  ].join("\n"),
  oferta: {
    titulo: "SSD AliExpress 512GB",
    marketplace: "aliexpress",
    categoria: "Informatica",
    preco: 83,
    linksComerciais: [
      {
        papel: "link_app",
        urlOriginal: "https://a.aliexpress.com/_appOriginal",
        urlAfiliada: "https://s.click.aliexpress.com/e/_appAfiliado",
        renderizavel: true,
        seguro: true,
        convertidoWorkspace: true
      },
      {
        papel: "link_pc",
        urlOriginal: "https://a.aliexpress.com/_pcOriginal",
        urlAfiliada: "https://s.click.aliexpress.com/e/_pcAfiliado",
        renderizavel: true,
        seguro: true,
        convertidoWorkspace: true
      }
    ]
  },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 83, categoria: "Informatica", precoConfiavel: true }
});
const aliMensagem = montarTemplateEspelhoPorBlocosV26(
  aliEspelho.espelhoComercial,
  aliEspelho.documentoComercialCanonico
).mensagem;
recorder.check("aliexpress_app_moedas_pc", "ordem estrutural titulo marketplace categoria preco cupons links", emOrdem(aliMensagem, [
  "SSD AliExpress 512GB",
  "AliExpress",
  "Informatica",
  "Por:",
  "BRAE1",
  "IFPZKUPM",
  "APP",
  "https://s.click.aliexpress.com/e/_appAfiliado",
  "PC",
  "https://s.click.aliexpress.com/e/_pcAfiliado"
]), aliMensagem);
recorder.check("aliexpress_app_moedas_pc", "usa somente URLs afiliadas seguras", !contem(aliMensagem, "https://a.aliexpress.com/_appOriginal") && !contem(aliMensagem, "https://a.aliexpress.com/_pcOriginal"), aliMensagem);
recorder.check("aliexpress_app_moedas_pc", "APP/moedas e PC aparecem uma vez e separados", urlsDistintas(aliMensagem, [
  "https://s.click.aliexpress.com/e/_appAfiliado",
  "https://s.click.aliexpress.com/e/_pcAfiliado"
]), aliMensagem);
recorder.check("aliexpress_app_moedas_pc", "preserva frase capturada de cupom loja + moedas", contem(aliMensagem, "Resgate o cupom da loja") && contem(aliMensagem, "821 moedas no APP"), aliMensagem);
recorder.check("aliexpress_app_moedas_pc", "nao duplica condicao de cupom loja/moedas como beneficio", ocorrencias(aliMensagem, "Resgate o cupom da loja") === 1, aliMensagem);
recorder.check("aliexpress_app_moedas_pc", "moeda aparece uma vez e nao entra em cupons", ocorrencias(aliMensagem, "821 moedas") === 1 && ocorrencias(aliMensagem, "Cupons: BRAE1 ou IFPZKUPM") === 1, aliMensagem);
recorder.check("aliexpress_app_moedas_pc", "preve aviso editorial separado dos dados comerciais", contem(aliMensagem, "Oferta sujeita") && ocorrencias(aliMensagem, "Oferta sujeita") === 1, aliMensagem);
recorder.check("aliexpress_app_moedas_pc", "marca aviso como editorial_sistema no documento", aliEspelho.documentoComercialCanonico.blocos.some(bloco => bloco.tipo === "aviso" && bloco.origem === "editorial_sistema" && contem(bloco.textoOriginal, "Oferta sujeita")), JSON.stringify(aliEspelho.documentoComercialCanonico.blocos));

const aliComImagem = renderizarAliExpress({
  textoOriginal: [
    "Tablet AliExpress",
    "Por R$ 299,00",
    "Cupom: TABLET10",
    "Resgate o cupom da loja + 100 moedas no APP"
  ].join("\n"),
  titulo: "Tablet AliExpress",
  preco: 299,
  imagem: "https://ae01.alicdn.com/kf/tablet.jpg",
  linksComerciais: linksAliExpress({
    app: "https://s.click.aliexpress.com/e/_tabletApp?aff=1",
    pc: "https://s.click.aliexpress.com/e/_tabletPc?aff=1"
  })
});
recorder.check("aliexpress_imagem_app_pc", "imagem resolvida continua preservada no documento", aliComImagem.espelho.documentoComercialCanonico.imagemComercial?.urlSelecionada === "https://ae01.alicdn.com/kf/tablet.jpg", JSON.stringify(aliComImagem.espelho.documentoComercialCanonico.imagemComercial));
recorder.check("aliexpress_imagem_app_pc", "imagem nao interfere em APP/moedas e PC", emOrdem(aliComImagem.mensagem, [
  "Tablet AliExpress",
  "TABLET10",
  "APP",
  "https://s.click.aliexpress.com/e/_tabletApp?aff=1",
  "PC",
  "https://s.click.aliexpress.com/e/_tabletPc?aff=1"
]), aliComImagem.mensagem);

const aliSemImagem = renderizarAliExpress({
  textoOriginal: [
    "Produto AliExpress sem imagem",
    "Por R$ 59,00",
    "Cupom: SEMIMG",
    "Resgate o cupom da loja + 50 moedas no APP"
  ].join("\n"),
  titulo: "Produto AliExpress sem imagem",
  preco: 59,
  linksComerciais: linksAliExpress({
    app: "https://s.click.aliexpress.com/e/_semImagemApp",
    pc: "https://s.click.aliexpress.com/e/_semImagemPc"
  })
});
recorder.check("aliexpress_sem_imagem_textual", "produto sem imagem continua renderizando texto", !aliSemImagem.espelho.documentoComercialCanonico.imagemComercial?.urlSelecionada && contem(aliSemImagem.mensagem, "Produto AliExpress sem imagem") && contem(aliSemImagem.mensagem, "https://s.click.aliexpress.com/e/_semImagemApp"), aliSemImagem.mensagem);

const aliSomentePc = renderizarAliExpress({
  textoOriginal: "Produto AliExpress somente PC\nPor R$ 120,00",
  titulo: "Produto AliExpress somente PC",
  preco: 120,
  linksComerciais: linksAliExpress({ pc: "https://s.click.aliexpress.com/e/_somentePc" })
});
recorder.check("aliexpress_somente_pc", "somente PC renderiza sem placeholder APP", contem(aliSomentePc.mensagem, "PC") && contem(aliSomentePc.mensagem, "https://s.click.aliexpress.com/e/_somentePc") && !contem(aliSomentePc.mensagem, "APP / Moedas"), aliSomentePc.mensagem);

const aliSomenteApp = renderizarAliExpress({
  textoOriginal: "Produto AliExpress somente APP\nPor R$ 75,00\n+ 200 moedas no APP",
  titulo: "Produto AliExpress somente APP",
  preco: 75,
  linksComerciais: linksAliExpress({ moedas: "https://s.click.aliexpress.com/e/_somenteMoedas" })
});
recorder.check("aliexpress_somente_app_moedas", "somente APP/moedas renderiza sem placeholder PC", contem(aliSomenteApp.mensagem, "APP / Moedas") && contem(aliSomenteApp.mensagem, "https://s.click.aliexpress.com/e/_somenteMoedas") && !contem(aliSomenteApp.mensagem, "PC:"), aliSomenteApp.mensagem);

const aliUrlsDistintasQuery = renderizarAliExpress({
  textoOriginal: "Produto AliExpress query distinta\nPor R$ 88,00",
  titulo: "Produto AliExpress query distinta",
  preco: 88,
  linksComerciais: linksAliExpress({
    app: "https://s.click.aliexpress.com/e/_produto?src=app",
    pc: "https://s.click.aliexpress.com/e/_produto?src=pc"
  })
});
recorder.check("aliexpress_urls_finais_distintas", "APP e PC com query final distinta nao sao deduplicados por produto", urlsDistintas(aliUrlsDistintasQuery.mensagem, [
  "https://s.click.aliexpress.com/e/_produto?src=app",
  "https://s.click.aliexpress.com/e/_produto?src=pc"
]), aliUrlsDistintasQuery.mensagem);

const aliAppMoedasDistintos = renderizarAliExpress({
  textoOriginal: "Produto AliExpress APP e moedas distintos\nPor R$ 93,00\n+ 300 moedas no APP",
  titulo: "Produto AliExpress APP e moedas distintos",
  preco: 93,
  linksComerciais: linksAliExpress({
    app: "https://s.click.aliexpress.com/e/_appDistinto",
    moedas: "https://s.click.aliexpress.com/e/_moedasDistinto"
  })
});
recorder.check("aliexpress_app_moedas_distintos", "APP e moedas distintos preservam papeis sem repetir rotulo agrupado", emOrdem(aliAppMoedasDistintos.mensagem, [
  "APP:",
  "https://s.click.aliexpress.com/e/_appDistinto",
  "Moedas:",
  "https://s.click.aliexpress.com/e/_moedasDistinto"
]) && !contem(aliAppMoedasDistintos.mensagem, "APP / Moedas"), aliAppMoedasDistintos.mensagem);

const aliUrlsIguais = renderizarAliExpress({
  textoOriginal: "Produto AliExpress URL igual\nPor R$ 91,00",
  titulo: "Produto AliExpress URL igual",
  preco: 91,
  linksComerciais: linksAliExpress({
    app: "https://s.click.aliexpress.com/e/_mesmaUrl",
    pc: "https://s.click.aliexpress.com/e/_mesmaUrl"
  })
});
recorder.check("aliexpress_urls_finais_iguais", "URLs finais iguais nao duplicam CTA", ocorrencias(aliUrlsIguais.mensagem, "https://s.click.aliexpress.com/e/_mesmaUrl") === 1, aliUrlsIguais.mensagem);

const aliCupomMoedasSeparados = renderizarAliExpress({
  textoOriginal: [
    "Produto AliExpress cupom e moedas",
    "Por R$ 65,00",
    "Cupom: BRAE1",
    "Resgate o cupom da loja + 678 moedas no APP"
  ].join("\n"),
  titulo: "Produto AliExpress cupom e moedas",
  preco: 65,
  linksComerciais: linksAliExpress({ app: "https://s.click.aliexpress.com/e/_cupomMoedasApp" })
});
recorder.check("aliexpress_cupom_moedas_separados", "cupom da loja e moeda aparecem uma vez", ocorrencias(aliCupomMoedasSeparados.mensagem, "cupom da loja") === 1 && ocorrencias(aliCupomMoedasSeparados.mensagem, "678 moedas") === 1, aliCupomMoedasSeparados.mensagem);

const aliOriginalInsegura = renderizarAliExpress({
  textoOriginal: [
    "Produto AliExpress original insegura",
    "Por R$ 77,00",
    "Link APP: https://a.aliexpress.com/_originalInsegura"
  ].join("\n"),
  titulo: "Produto AliExpress original insegura",
  preco: 77,
  linksComerciais: [
    {
      papel: "link_app",
      urlOriginal: "https://a.aliexpress.com/_originalInsegura",
      urlAfiliada: "https://s.click.aliexpress.com/e/_afiliadaSegura",
      renderizavel: true,
      seguro: true,
      convertidoWorkspace: true
    }
  ]
});
recorder.check("aliexpress_url_original_nunca_renderiza", "URL original capturada nunca vira CTA final", contem(aliOriginalInsegura.mensagem, "https://s.click.aliexpress.com/e/_afiliadaSegura") && !contem(aliOriginalInsegura.mensagem, "https://a.aliexpress.com/_originalInsegura"), aliOriginalInsegura.mensagem);

const aliTemplateProtegido = renderizarAliExpress({
  textoOriginal: "Produto AliExpress template protegido\nPor R$ 105,00",
  titulo: "Produto AliExpress template protegido",
  preco: 105,
  linksComerciais: linksAliExpress({
    app: "https://s.click.aliexpress.com/e/_templateApp",
    pc: "https://s.click.aliexpress.com/e/_templatePc"
  }),
  template: {
    blocos: [
      { tipo: "preco_por", ativo: false },
      { tipo: "link", ativo: false },
      { tipo: "link_app", ativo: false },
      { tipo: "link_pc", ativo: false }
    ]
  }
});
recorder.check("aliexpress_template_protegido", "template personalizado nao esconde links protegidos AliExpress", contem(aliTemplateProtegido.mensagem, "R$ 105,00") && contem(aliTemplateProtegido.mensagem, "https://s.click.aliexpress.com/e/_templateApp") && contem(aliTemplateProtegido.mensagem, "https://s.click.aliexpress.com/e/_templatePc"), aliTemplateProtegido.mensagem);

const kabumReferencia = renderizarKabumAwin({
  textoOriginal: [
    "Mousepad Gamer Rise Mode RGB",
    "De: R$ 149,90",
    "Por: R$ 117,64",
    "3x de R$ 39,21 sem juros",
    "Cupom: MOUSEPAD9X3",
    "Aplique o cupom MOUSEPAD9X3 para obter o desconto.",
    "Frete varia por estado"
  ].join("\n"),
  titulo: "Mousepad Gamer Rise Mode RGB",
  preco: 117.64,
  categoria: "Gamer e Hardware",
  linkAfiliado: "https://www.awin1.com/cread.php?awinmid=17729&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F123"
});
const kabumMensagem = kabumReferencia.mensagem;
recorder.check("kabum_awin_ofc", "preserva ordem comercial KaBuM/AWIN no OFC", emOrdem(kabumMensagem, [
  "Mousepad Gamer Rise Mode RGB",
  "KaBuM",
  "Gamer e Hardware",
  "De: R$ 149,90",
  "Por: R$ 117,64",
  "3x de R$ 39,21 sem juros",
  "Cupom: MOUSEPAD9X3",
  "Aplique o cupom MOUSEPAD9X3 para obter o desconto.",
  "Frete varia por estado",
  "Confira aqui",
  "https://www.awin1.com/cread.php",
  "Oferta sujeita"
]), kabumMensagem);
recorder.check("kabum_awin_ofc", "link AWIN afiliado preservado sem trocar por original KaBuM", contem(kabumMensagem, "https://www.awin1.com/cread.php") && !contem(kabumMensagem, "clickref=terceiro"), kabumMensagem);
recorder.check("kabum_awin_ofc", "frete capturado aparece uma vez e nao duplica como beneficio", ocorrencias(kabumMensagem, "Frete varia por estado") === 1, kabumMensagem);
recorder.check("kabum_awin_ofc", "instrucao capturada e aviso editorial aparecem uma vez", ocorrencias(kabumMensagem, "Aplique o cupom MOUSEPAD9X3") === 1 && ocorrencias(kabumMensagem, "Oferta sujeita") === 1, kabumMensagem);

const kabumDeEstruturado = renderizarKabumAwin({
  textoOriginal: "Produto KaBuM preco de estruturado\nPor: R$ 199,90",
  titulo: "Produto KaBuM preco de estruturado",
  preco: 199.9,
  oferta: { precoOriginal: 249.9 },
  linkAfiliado: "https://www.awin1.com/cread.php?awinmid=17729&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F654"
});
recorder.check("kabum_awin_preco_de_estruturado", "De explicito de campo estruturado confiavel renderiza sem calculo", contem(kabumDeEstruturado.mensagem, "De: R$ 249,90") && contem(kabumDeEstruturado.mensagem, "Por: R$ 199,90"), kabumDeEstruturado.mensagem);

const kabumDeInvalido = renderizarKabumAwin({
  textoOriginal: "Produto KaBuM sem desconto real\nDe: R$ 700,00\nPor: R$ 810,00",
  titulo: "Produto KaBuM sem desconto real",
  preco: 810,
  linkAfiliado: "https://www.awin1.com/cread.php?awinmid=17729&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F456"
});
recorder.check("kabum_awin_preco_de_invalido", "De menor ou igual a Por nao renderiza desconto falso", !contem(kabumDeInvalido.mensagem, "De: R$ 700,00") && contem(kabumDeInvalido.mensagem, "Por: R$ 810,00"), kabumDeInvalido.mensagem);
recorder.check("kabum_awin_preco_de_invalido", "inconsistencia fica em auditoria interna", kabumDeInvalido.espelho.documentoComercialCanonico.auditoriaComercial?.avisosInternos?.includes("preco_de_menor_ou_igual_preco_por_omitido"), JSON.stringify(kabumDeInvalido.espelho.documentoComercialCanonico.auditoriaComercial));

const kabumSemFreteInstrucao = renderizarKabumAwin({
  textoOriginal: [
    "Produto KaBuM sem entrega informada",
    "Por: R$ 299,90",
    "Cupom: KABUM10"
  ].join("\n"),
  titulo: "Produto KaBuM sem entrega informada",
  preco: 299.9,
  linkAfiliado: "https://www.awin1.com/cread.php?awinmid=17729&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F789"
});
recorder.check("kabum_awin_sem_frete_instrucao", "frete ausente nao e inventado", !kabumSemFreteInstrucao.mensagem.includes("🚚") && !contem(kabumSemFreteInstrucao.mensagem, "Frete gratis"), kabumSemFreteInstrucao.mensagem);
recorder.check("kabum_awin_sem_frete_instrucao", "cupom real permanece sem frase automatica inventada", contem(kabumSemFreteInstrucao.mensagem, "Cupom: KABUM10") && !contem(kabumSemFreteInstrucao.mensagem, "Aplique o cupom KABUM10"), kabumSemFreteInstrucao.mensagem);

const awinComoMarketplace = renderizarKabumAwin({
  textoOriginal: "Placa Mae MSI Pro B650M-P\nPor: R$ 899,90\nFrete varia por estado",
  titulo: "Placa Mae MSI Pro B650M-P",
  preco: 899.9,
  marketplace: "awin",
  linkAfiliado: "https://www.awin1.com/cread.php?awinmid=17729&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F321"
});
recorder.check("kabum_awin_marketplace_publico", "marketplace AWIN/KABUM aparece publicamente como KaBuM", contem(awinComoMarketplace.mensagem, "KaBuM") && !contem(awinComoMarketplace.mensagem, "KaBuM / AWIN"), awinComoMarketplace.mensagem);

const customProtegidosOff = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Oferta Protegida",
    marketplace: "amazon",
    precoAtual: 149.9,
    cupom: "PROTEGIDO10",
    instrucaoCupom: "Use o cupom capturado para obter este preco.",
    linkAfiliado: "https://amzn.to/protegido"
  },
  template: {
    id: "tpl_snapshot_protegidos_off",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: false, ordem: 10 },
      { tipo: "preco_por", ativo: false, ordem: 20 },
      { tipo: "cupom", ativo: false, ordem: 30 },
      { tipo: "frase_cupom", ativo: false, ordem: 40 },
      { tipo: "link", ativo: false, ordem: 50 },
      { tipo: "avaliacao", ativo: false, ordem: 60 },
      { tipo: "rodape", ativo: false, ordem: 70 }
    ],
    rodape: { ativo: false, texto: "Rodape desligado" }
  },
  canal: "whatsapp"
});
recorder.check("template_personalizado_protegidos", "toggle nao esconde titulo/preco/link/cupom necessario", [
  "Oferta Protegida",
  "Por:",
  "PROTEGIDO10",
  "https://amzn.to/protegido"
].every(trecho => contem(customProtegidosOff.mensagem, trecho)), customProtegidosOff.mensagem);
recorder.check("template_personalizado_protegidos", "toggle pode esconder apenas opcionais visuais", !contem(customProtegidosOff.mensagem, "Rodape desligado"), customProtegidosOff.mensagem);

const semTituloMensagem = mensagemPadrao({
  marketplace: "amazon",
  precoAtual: 49.9,
  linkAfiliado: "https://amzn.to/sem-titulo"
});
recorder.check("template_padrao_sem_titulo", "Template Universal nao cria titulo Oferta", !contem(semTituloMensagem, "Oferta"), semTituloMensagem);

const resumo = recorder.resumo();
for (const item of resumo) {
  const status = item.passou ? "PASSOU" : "FALHOU";
  console.log(`[SNAPSHOT-COMERCIAL-F1] ${status} ${item.nome}`);
  for (const divergencia of item.divergencias) {
    console.log(`  - ${divergencia.descricao}`);
    if (divergencia.detalhe) {
      console.log(`    atual=${JSON.stringify(texto(divergencia.detalhe)).slice(0, 900)}`);
    }
  }
}

const falhas = recorder.falhas();
const falhasEsperadasFase2 = new Map([
  ["template_personalizado_protegidos", "Renderer legado de template personalizado ainda permite ocultar protegidos"],
  ["template_padrao_sem_titulo", "Template padrao legado ainda cria titulo fallback Oferta"]
]);
const falhasInesperadas = falhas.filter(item => !falhasEsperadasFase2.has(item.nome));
const falhasEsperadasAusentes = [...falhasEsperadasFase2.keys()].filter(nome => !falhas.some(item => item.nome === nome));

if (falhasInesperadas.length || falhasEsperadasAusentes.length) {
  if (falhasInesperadas.length) {
    console.error(`[SNAPSHOT-COMERCIAL-F1] ${falhasInesperadas.length} snapshot(s) com divergencia inesperada`);
  }
  if (falhasEsperadasAusentes.length) {
    console.error(`[SNAPSHOT-COMERCIAL-F1] divergencia(s) esperada(s) mudaram sem homologacao: ${falhasEsperadasAusentes.join(", ")}`);
  }
  process.exitCode = 1;
} else {
  for (const [nome, motivo] of falhasEsperadasFase2) {
    console.log(`[SNAPSHOT-COMERCIAL-F1] DIVERGENCIA-ESPERADA ${nome}: ${motivo}`);
  }
  console.log("[SNAPSHOT-COMERCIAL-F1] Amazon, AliExpress, Mercado Livre e KaBuM/AWIN homologados; divergencias restantes preservadas como esperadas");
}
