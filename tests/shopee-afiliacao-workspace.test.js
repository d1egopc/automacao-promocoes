const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  criarProvaAfiliacaoWorkspaceShopee,
  validarOfertaAfiliacaoWorkspaceShopee
} = require("../modules/marketplaces/shopee/afiliacao-workspace");
const { expandirShortlinkAfiliadoShopee } = require("../modules/engine/importer/adapters/shopee.adapter");
const { enviarOfertaManualV2 } = require("../modules/manual-v2/manual-dispatcher");

const clienteId = "workspace_shopee";
const credenciais = { appId: "18362140789", secret: "nao_exibir" };
const original = "https://shopee.com.br/product/111/222";
const afiliado = "https://s.shopee.com.br/link-workspace";

function prova(url = afiliado, expandida = "https://shopee.com.br/product/111/222?mmp_pid=an_18362140789&utm_source=an_18362140789", papel = "produto") {
  return criarProvaAfiliacaoWorkspaceShopee({
    clienteId,
    credenciais,
    urlOriginal: original,
    urlAfiliadaWorkspace: url,
    urlFinalExpandida: expandida,
    papel,
    motivoConversao: "fixture_workspace_api"
  });
}

function oferta(comProva = true) {
  return {
    id: "shopee_oferta",
    clienteId,
    marketplace: "shopee",
    urlOriginal: original,
    urlAfiliada: afiliado,
    metadata: comProva ? { afiliacaoWorkspace: prova() } : {}
  };
}

function ofertaManualComProva(provaVerificada = null) {
  return {
    id: "shopee_manual",
    clienteId,
    marketplace: "shopee",
    urlOriginal: original,
    urlAfiliada: afiliado,
    afiliacaoWorkspaceVerificada: provaVerificada
  };
}

function testarProvaDoWorkspaceEAnDetectado() {
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee(oferta(), { clienteId, credenciais }).ok, true);
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee(oferta(), { clienteId: "outro_workspace", credenciais }).ok, false);

  const divergente = prova(afiliado, "https://shopee.com.br/product/111/222?mmp_pid=an_18128840006&utm_source=an_18128840006");
  assert.strictEqual(divergente.conversaoStatus, "falhou");
  assert.strictEqual(divergente.affiliateIdEsperado, "an_18362140789");
  assert.strictEqual(divergente.affiliateIdDetectado, "an_18128840006");
}

function testarOwnershipPositivoObrigatorio() {
  const semDetectado = prova(afiliado, "");
  assert.strictEqual(semDetectado.conversaoStatus, "falhou");
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee({ ...oferta(false), metadata: { afiliacaoWorkspace: semDetectado } }, { clienteId, credenciais }).ok, false);

  for (const terceiro of ["an_18179570003", "an_18197860005"]) {
    const divergente = prova(afiliado, `https://shopee.com.br/product/111/222?mmp_pid=${terceiro}`);
    assert.strictEqual(divergente.conversaoStatus, "falhou");
    assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee({ ...oferta(false), metadata: { afiliacaoWorkspace: divergente } }, { clienteId, credenciais }).ok, false);
  }
}

async function testarExpansaoComRetryLimitado() {
  let chamadas = 0;
  const resultado = await expandirShortlinkAfiliadoShopee(afiliado, {
    expandirShortlinkShopee: async () => {
      chamadas += 1;
      return chamadas === 1 ? "" : "https://shopee.com.br/product/111/222?mmp_pid=an_18362140789";
    }
  });
  assert.strictEqual(chamadas, 2);
  assert.ok(resultado.includes("an_18362140789"));

  chamadas = 0;
  assert.strictEqual(await expandirShortlinkAfiliadoShopee(afiliado, {
    expandirShortlinkShopee: async () => { chamadas += 1; return ""; }
  }), "");
  assert.strictEqual(chamadas, 2);
}

function testarTodoLinkVisivelExigeProva() {
  const semProvaResgate = oferta();
  semProvaResgate.metadata.linksComerciais = [{
    papel: "link_resgate",
    renderizavel: true,
    urlAfiliadaWorkspace: "https://s.shopee.com.br/resgate-terceiro"
  }];
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee(semProvaResgate, { clienteId, credenciais }).ok, false);

  const comProvaResgate = oferta();
  comProvaResgate.metadata.linksComerciais = [{
    papel: "link_resgate",
    renderizavel: true,
    afiliacaoWorkspace: prova("https://s.shopee.com.br/resgate-workspace", undefined, "resgate")
  }];
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee(comProvaResgate, { clienteId, credenciais }).ok, true);

  const resgateTerceiro = oferta();
  resgateTerceiro.metadata.linksComerciais = [{
    papel: "link_resgate",
    renderizavel: true,
    afiliacaoWorkspace: prova("https://s.shopee.com.br/resgate-terceiro", "https://shopee.com.br/m/cupom?mmp_pid=an_18179570003", "resgate")
  }];
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee(resgateTerceiro, { clienteId, credenciais }).ok, false, "produto aprovado nao autoriza resgate de terceiro");
}

async function testarManualNuncaEnviaNemDebitaSemProva() {
  let envios = 0;
  let creditos = 0;
  const retorno = await enviarOfertaManualV2({ clienteId, ofertaId: "shopee_oferta", destinosIds: ["destino"] }, {
    buscarOfertaManualV2: () => oferta(false),
    getIntegracaoCliente: () => ({ credenciais }),
    enviarWhatsApp: async () => { envios += 1; },
    debitarCreditos: () => { creditos += 1; return true; }
  });
  assert.strictEqual(retorno.ok, false);
  assert.strictEqual(retorno.resultados[0].erro, "afiliacao_workspace_incompleta");
  assert.strictEqual(envios, 0);
  assert.strictEqual(creditos, 0);
}

async function testarManualRejeitaProvaForjadaEAceitaProvaAssinada() {
  const forjada = {
    workspaceId: clienteId,
    appId: credenciais.appId,
    origemConversao: "workspace_api",
    conversaoStatus: "convertida",
    urlAfiliadaWorkspace: afiliado
  };
  let envios = 0;
  let creditos = 0;
  const retorno = await enviarOfertaManualV2({ clienteId, ofertaId: "shopee_manual", destinosIds: ["destino"] }, {
    buscarOfertaManualV2: () => ({ ...ofertaManualComProva(forjada), afiliacaoWorkspace: forjada }),
    getIntegracaoCliente: () => ({ credenciais }),
    enviarWhatsApp: async () => { envios += 1; },
    debitarCreditos: () => { creditos += 1; return true; }
  });
  assert.strictEqual(retorno.ok, false);
  assert.strictEqual(retorno.resultados[0].erro, "afiliacao_workspace_incompleta");
  assert.strictEqual(envios, 0);
  assert.strictEqual(creditos, 0);

  const assinada = prova();
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee(ofertaManualComProva(assinada), {
    clienteId,
    credenciais,
    exigirAssinatura: true
  }).ok, true, "prova criada no backend com segredo da integracao deve ser aceita");
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee(ofertaManualComProva({ ...assinada, workspaceId: "outro" }), {
    clienteId,
    credenciais,
    exigirAssinatura: true
  }).ok, false, "alterar qualquer campo invalida a assinatura");
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee(ofertaManualComProva({ ...assinada, urlAfiliadaWorkspace: "https://s.shopee.com.br/adulterado" }), {
    clienteId,
    credenciais,
    exigirAssinatura: true
  }).ok, false, "alterar a URL validada invalida a assinatura");
}

function testarGateCentralAntesDoCheckpoint() {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicio = fonte.indexOf("async function enviarParaDestinoInteligente");
  const trecho = fonte.slice(inicio, fonte.indexOf("const executarAlvoComCheckpoint", inicio));
  assert.ok(trecho.includes("validarOfertaAfiliacaoWorkspaceShopee"));
  assert.ok(trecho.includes("afiliacao_workspace_incompleta"));
}

(async () => {
  testarProvaDoWorkspaceEAnDetectado();
  testarOwnershipPositivoObrigatorio();
  await testarExpansaoComRetryLimitado();
  testarTodoLinkVisivelExigeProva();
  await testarManualNuncaEnviaNemDebitaSemProva();
  await testarManualRejeitaProvaForjadaEAceitaProvaAssinada();
  testarGateCentralAntesDoCheckpoint();
  console.log("shopee-afiliacao-workspace.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
