const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { criarGerarLinkAliExpress } = require("../modules/marketplaces/conversores/aliexpress.converter");
const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
const {
  criarProvaAfiliacaoWorkspaceAliExpress,
  validarOfertaAfiliacaoWorkspaceAliExpress
} = require("../modules/marketplaces/aliexpress/afiliacao-workspace");
const { enviarOfertaManualV2 } = require("../modules/manual-v2/manual-dispatcher");

const CREDENCIAIS = { appKey: "app_workspace", secret: "segredo", trackingId: "tracking_workspace" };

function prova(url, status = "convertida", workspaceId = "workspace_a") {
  return {
    workspaceId,
    appKey: CREDENCIAIS.appKey,
    trackingIdEnviado: CREDENCIAIS.trackingId,
    origemConversao: "workspace_api",
    conversaoStatus: status,
    urlAfiliadaWorkspace: status === "convertida" ? url : "",
    motivoConversao: status === "convertida" ? "link_api_convertido" : "link_api_sem_retorno"
  };
}

function provaAssinada(url, status = "convertida", papel = "produto") {
  return criarProvaAfiliacaoWorkspaceAliExpress({
    clienteId: "workspace_a",
    credenciais: CREDENCIAIS,
    urlOriginal: "https://a.aliexpress.com/_original",
    urlAfiliadaWorkspace: status === "convertida" ? url : "",
    papel,
    conversaoStatus: status,
    motivoConversao: "fixture_workspace_api"
  });
}

function linksAppPc() {
  return [
    { url_original: "https://a.aliexpress.com/_appOriginal", ordemCaptura: 1, ocorrenciaId: "ali:app" },
    { url_original: "https://a.aliexpress.com/_pcOriginal", ordemCaptura: 2, ocorrenciaId: "ali:pc" }
  ];
}

function produto({ url, papel, status = "convertida", workspaceId = "workspace_a" }) {
  return {
    marketplace: "aliexpress",
    titulo: "Produto AliExpress",
    precoAtual: "99.90",
    precoOriginal: "199.90",
    imagem: "https://ae01.alicdn.com/produto.jpg",
    categoria: "Eletronicos",
    linkOriginal: url,
    linkAfiliado: status === "convertida" ? `https://s.click.aliexpress.com/e/_${papel}` : "",
    metadata: {
      papelLink: papel,
      afiliacaoWorkspace: prova(`https://s.click.aliexpress.com/e/_${papel}`, status, workspaceId)
    }
  };
}

async function testarConversorNuncaDevolveOriginal() {
  const gerar = criarGerarLinkAliExpress({
    fetch: async () => ({ status: 200, json: async () => ({}) }),
    timestampGMT8: () => "2026-09-17 12:00:00",
    assinar: () => "assinatura"
  });
  const original = "https://a.aliexpress.com/_afiliadoTerceiro";
  assert.strictEqual(await gerar(original, CREDENCIAIS, { clienteId: "workspace_a" }), "");
}

async function executarCenarioAppPc({ appStatus, pcStatus, jobId }) {
  const links = linksAppPc();
  return importarAliExpressEngine({
    job: { id: jobId, evento_id: jobId + 1, cliente_id: "workspace_a", marketplace: "aliexpress" },
    evento: { marketplace: "aliexpress", texto_original: "Produto\nAPP\nhttps://a.aliexpress.com/_appOriginal\nPC\nhttps://a.aliexpress.com/_pcOriginal" },
    links,
    deps: {
      getIntegracaoCliente: () => ({ credenciais: CREDENCIAIS }),
      importarAliExpress: async (url, config = {}) => {
        const papel = config.contextoEngine?.papelLink || "link_pc";
        const status = papel === "link_pc" ? pcStatus : appStatus;
        return produto({ url, papel, status });
      }
    }
  });
}

async function testarPcFalhaAppConverte() {
  const resultado = await executarCenarioAppPc({ appStatus: "convertida", pcStatus: "falhou", jobId: 1 });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  const app = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
  const pc = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
  assert.strictEqual(app.renderizavel, true);
  assert.strictEqual(app.conversaoStatus, "convertida");
  assert.strictEqual(pc.renderizavel, false);
  assert.strictEqual(pc.conversaoStatus, "falhou");
  assert.strictEqual(app.papelLink, "link_app");
  assert.strictEqual(pc.papelLink, "link_pc");
  assert.deepStrictEqual(resultado.metadata.linksFalhosWorkspace.map(item => item.papelLink), ["link_pc"]);
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceAliExpress({ marketplace: "aliexpress", metadata: resultado.metadata }, {
    clienteId: "workspace_a",
    credenciais: CREDENCIAIS
  }).ok, false, "APP convertido nao autoriza publicar sem o PC capturado");
  assert.strictEqual(app.urlOriginal, "https://a.aliexpress.com/_appOriginal");
  assert.strictEqual(pc.urlOriginal, "https://a.aliexpress.com/_pcOriginal");
  assert.strictEqual(pc.urlAfiliadaWorkspace, "", "nunca reutilizar o PC capturado da fonte");
}

async function testarAppFalhaPcConverte() {
  const resultado = await executarCenarioAppPc({ appStatus: "falhou", pcStatus: "convertida", jobId: 11 });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  const app = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
  const pc = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
  assert.strictEqual(app.renderizavel, false);
  assert.strictEqual(pc.renderizavel, true);
  assert.strictEqual(pc.conversaoStatus, "convertida");
  assert.strictEqual(app.papelLink, "link_app");
  assert.strictEqual(pc.papelLink, "link_pc");
  assert.deepStrictEqual(resultado.metadata.linksFalhosWorkspace.map(item => item.papelLink), ["link_app"]);
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceAliExpress({ marketplace: "aliexpress", metadata: resultado.metadata }, {
    clienteId: "workspace_a",
    credenciais: CREDENCIAIS
  }).ok, false, "PC convertido nao autoriza publicar sem o APP capturado");
  assert.strictEqual(app.urlAfiliadaWorkspace, "", "nunca reutilizar o APP capturado da fonte");
}

async function testarAppEPcConvertem() {
  const resultado = await executarCenarioAppPc({ appStatus: "convertida", pcStatus: "convertida", jobId: 21 });

  assert.strictEqual(resultado.ok, true);
  const app = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
  const pc = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
  assert.strictEqual(app.renderizavel, true);
  assert.strictEqual(pc.renderizavel, true);
  assert.notStrictEqual(app.urlAfiliadaWorkspace, pc.urlAfiliadaWorkspace);
  assert.strictEqual(app.urlOriginal, "https://a.aliexpress.com/_appOriginal");
  assert.strictEqual(pc.urlOriginal, "https://a.aliexpress.com/_pcOriginal");
  assert.strictEqual(app.papelLink, "link_app");
  assert.strictEqual(pc.papelLink, "link_pc");
  assert.strictEqual(resultado.imagem, "https://ae01.alicdn.com/produto.jpg", "o PC pode enriquecer a imagem sem desaparecer da saida");
}

async function testarAppEPcFalham() {
  const resultado = await executarCenarioAppPc({ appStatus: "falhou", pcStatus: "falhou", jobId: 31 });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(resultado.metadata.linksClassificados.length, 2);
  assert.ok(resultado.metadata.linksClassificados.every(item => item.renderizavel === false));
}

function testarGateFinalEIsolamentoPorWorkspace() {
  const urlA = "https://s.click.aliexpress.com/e/_workspaceA";
  const ofertaA = {
    marketplace: "aliexpress",
    metadata: {
      afiliacaoWorkspace: prova(urlA),
      linksClassificados: [{
        papelLink: "link_app",
        conversaoWorkspace: { ...prova(urlA), papel: "link_app" }
      }]
    }
  };
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceAliExpress(ofertaA, {
    clienteId: "workspace_a",
    credenciais: CREDENCIAIS
  }).ok, true);
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceAliExpress(ofertaA, {
    clienteId: "workspace_b",
    credenciais: CREDENCIAIS
  }).ok, false);

  const ofertaTerceiro = {
    marketplace: "aliexpress",
    metadata: {
      afiliacaoWorkspace: prova("https://a.aliexpress.com/_afiliadoTerceiro", "falhou")
    }
  };
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceAliExpress(ofertaTerceiro, {
    clienteId: "workspace_a",
    credenciais: CREDENCIAIS
  }).ok, false);

  const ofertaAppConvertidoPcFalhou = {
    marketplace: "aliexpress",
    metadata: {
      afiliacaoWorkspace: prova(urlA),
      linksClassificados: [
        {
          papelLink: "link_app",
          renderizavel: true,
          conversaoWorkspace: { ...prova(urlA), papel: "link_app" }
        },
        {
          papelLink: "link_pc",
          renderizavel: false,
          conversaoWorkspace: { ...prova("", "falhou"), papel: "link_pc" }
        }
      ]
    }
  };
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceAliExpress(ofertaAppConvertidoPcFalhou, {
    clienteId: "workspace_a",
    credenciais: CREDENCIAIS
  }).ok, false, "o gate final tambem bloqueia uma ocorrencia contextual capturada que falhou");

  const fonteExecutor = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicioExecutor = fonteExecutor.indexOf("async function enviarParaDestinoInteligente");
  const trechoExecutor = fonteExecutor.slice(inicioExecutor, fonteExecutor.indexOf("async function", inicioExecutor + 100));
  assert.ok(trechoExecutor.indexOf("validarOfertaAfiliacaoWorkspaceAliExpress") < trechoExecutor.indexOf("executarAlvoComCheckpoint"),
    "o gate AliExpress precisa ocorrer antes de qualquer checkpoint/sender");
}

async function testarManualRejeitaLinkForjadoEExigeTodosOsPapeis() {
  const url = "https://s.click.aliexpress.com/e/_workspaceA";
  let envios = 0;
  let creditos = 0;
  const retorno = await enviarOfertaManualV2({ clienteId: "workspace_a", ofertaId: "ali_manual", destinosIds: ["destino"] }, {
    buscarOfertaManualV2: () => ({
      id: "ali_manual",
      marketplace: "aliexpress",
      urlOriginal: "https://a.aliexpress.com/_terceiro",
      urlAfiliada: "https://a.aliexpress.com/_terceiro"
    }),
    getIntegracaoCliente: () => ({ credenciais: CREDENCIAIS }),
    enviarWhatsApp: async () => { envios += 1; },
    debitarCreditos: () => { creditos += 1; return true; }
  });
  assert.strictEqual(retorno.ok, false);
  assert.strictEqual(retorno.motivoGlobal, "afiliacao_workspace_incompleta");
  assert.deepStrictEqual(retorno.resultados, []);
  assert.strictEqual(envios, 0);
  assert.strictEqual(creditos, 0);

  const principal = provaAssinada(url);
  const ofertaCompleta = {
    marketplace: "aliexpress",
    afiliacaoWorkspaceVerificada: {
      principal,
      links: [provaAssinada("https://s.click.aliexpress.com/e/_app", "convertida", "link_app")]
    },
    linkApp: "https://s.click.aliexpress.com/e/_app"
  };
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceAliExpress(ofertaCompleta, {
    clienteId: "workspace_a",
    credenciais: CREDENCIAIS,
    exigirAssinatura: true
  }).ok, true);
  ofertaCompleta.linkPC = "https://a.aliexpress.com/_terceiro";
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceAliExpress(ofertaCompleta, {
    clienteId: "workspace_a",
    credenciais: CREDENCIAIS,
    exigirAssinatura: true
  }).ok, false, "um papel exibivel sem derivado assinado bloqueia a oferta inteira");
}

(async () => {
  await testarConversorNuncaDevolveOriginal();
  await testarPcFalhaAppConverte();
  await testarAppFalhaPcConverte();
  await testarAppEPcConvertem();
  await testarAppEPcFalham();
  testarGateFinalEIsolamentoPorWorkspace();
  await testarManualRejeitaLinkForjadoEExigeTodosOsPapeis();
  console.log("aliexpress-afiliacao-workspace.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
