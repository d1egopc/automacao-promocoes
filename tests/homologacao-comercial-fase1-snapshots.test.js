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

assertPoliticaOficial();

const recorder = criarSnapshotRecorder();

const amazonMensagem = mensagemPadrao({
  titulo: "Echo Dot 5a geracao",
  marketplace: "amazon",
  categoria: "Eletronicos",
  precoAtual: 279,
  precoOriginal: 299,
  precoPix: "R$ 2,00 No Pix",
  cupom: "HEYCUPOMRESGATE",
  beneficioTexto: "R$20 OFF",
  linkAfiliado: "https://amzn.to/echo-afiliado"
});
recorder.check("amazon_template_padrao", "preserva titulo, preco e link capturados", emOrdem(amazonMensagem, [
  "Echo Dot 5a geracao",
  "Por:",
  "HEYCUPOMRESGATE",
  "https://amzn.to/echo-afiliado"
]), amazonMensagem);
recorder.check("amazon_template_padrao", "nao renderiza preco Pix ambiguo R$ 2,00 como preco", !contem(amazonMensagem, "R$ 2,00 No Pix"), amazonMensagem);
recorder.check("amazon_template_padrao", "nao inventa frase generica para HEYCUPOMRESGATE", !contem(amazonMensagem, "Aplique o cupom HEYCUPOMRESGATE"), amazonMensagem);
recorder.check("amazon_template_padrao", "preserva beneficio capturado R$20 OFF sem duplicar resgate", contem(amazonMensagem, "R$20 OFF"), amazonMensagem);

const mlMensagem = mensagemPadrao({
  titulo: "Kit Mercado Livre com multiplos cupons",
  marketplace: "mercadolivre",
  categoria: "Moda",
  precoAtual: 198.8,
  cupons: ["MODASEMPRE", "ML15", "APP10"],
  beneficioTexto: "Aplique os cupons exibidos antes de finalizar.",
  linkAfiliado: "https://meli.la/oferta-multicupom"
});
recorder.check("mercadolivre_template_padrao", "preserva todos os codigos reais", ["MODASEMPRE", "ML15", "APP10"].every(cupom => contem(mlMensagem, cupom)), mlMensagem);
recorder.check("mercadolivre_template_padrao", "nao substitui varios codigos por frase generica", !contem(mlMensagem, "Aplique o cupom MODASEMPRE ou ML15 ou APP10"), mlMensagem);
recorder.check("mercadolivre_template_padrao", "beneficio nao duplica instrucao de cupom", ocorrencias(mlMensagem, "Aplique") <= 1, mlMensagem);

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
recorder.check("aliexpress_app_moedas_pc", "preve aviso editorial separado dos dados comerciais", contem(aliMensagem, "Oferta sujeita") || contem(aliMensagem, "aviso"), aliMensagem);

const kabumMensagem = mensagemPadrao({
  titulo: "Placa Mae MSI Pro B650M-P",
  marketplace: "kabum",
  categoria: "Gamer e Hardware",
  precoAtual: 899.9,
  frete: "Frete varia por estado",
  linkAfiliado: "https://www.awin1.com/cread.php?awinmid=17729&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F123"
});
recorder.check("kabum_awin_template_padrao", "preserva contrato comercial e link afiliado AWIN", contem(kabumMensagem, "Placa Mae MSI Pro B650M-P") && contem(kabumMensagem, "https://www.awin1.com/cread.php"), kabumMensagem);
recorder.check("kabum_awin_template_padrao", "nao renderiza URL original de terceiro", !contem(kabumMensagem, "clickref=terceiro"), kabumMensagem);
recorder.check("kabum_awin_template_padrao", "frete capturado permanece textual", contem(kabumMensagem, "Frete varia por estado"), kabumMensagem);

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
if (falhas.length) {
  console.error(`[SNAPSHOT-COMERCIAL-F1] ${falhas.length} snapshot(s) com divergencia atual`);
  process.exitCode = 1;
} else {
  console.log("[SNAPSHOT-COMERCIAL-F1] todos os snapshots comerciais passaram");
}
