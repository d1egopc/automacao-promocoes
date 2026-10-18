"use strict";

const assert = require("node:assert/strict");
const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
const { importarAliExpress } = require("../marketplaces/aliexpress/importar");
const { construirEspelhoComercialV24 } = require("../modules/ofc-v2/espelho-comercial");
const { aplicarPonteIntegridadeComercial } = require("../modules/engine/importer/importer.service");
const { montarOfertaUniversalEngine, validarContratoOfertaUniversal } =
  require("../modules/engine/oferta-universal.contract");
const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
const { criarCallbackFilaUniversal } = require("../modules/engine/universal-queue-distributor.adapter");
const {
  validarProvaAfiliacaoWorkspaceAliExpress,
  validarOfertaAfiliacaoWorkspaceAliExpress
} = require("../modules/marketplaces/aliexpress/afiliacao-workspace");

const productId = "1005012689379802";
const appOriginal = "https://seuhardware.com/s/appFixture";
const pcOriginal = "https://seuhardware.com/s/pcFixture";
const appExpandido = `https://m.aliexpress.com/p/coin-index/index.html?productIds=${productId}`;
const pcOficial = `https://pt.aliexpress.com/item/${productId}.html`;
const afiliadoApp = "https://s.click.aliexpress.com/e/_APP_FIXTURE";
const afiliadoPc = "https://s.click.aliexpress.com/e/_PC_FIXTURE";
const clienteId = "workspace_fixture";
const credenciais = { appKey: "app_fixture", secret: "secret_fixture", trackingId: "tracking_fixture" };

async function executar({ pcExpandido = "", productDetailUrl = pcOficial,
  afiliacaoApp = true, afiliacaoPc = true, texto = "Headset sem variante\nR$ 136,92\nCupom: IFPENUO\n1000 moedas no APP",
  falharPrimeiroProductDetail = false, metadataEvento = {},
  clienteIdExec = clienteId, credenciaisExec = credenciais, semIntegracao = false,
  appOriginalExec = appOriginal } = {}) {
  const chamadas = [];
  let chamadasProductDetail = 0;
  const fetchAnterior = global.fetch;
  global.fetch = async (url, opcoes = {}) => {
    const body = opcoes.body instanceof URLSearchParams
      ? opcoes.body : new URLSearchParams(opcoes.body || "");
    const method = body.get("method");
    const sourceValues = body.get("source_values") || "";
    if (!method && /^https:\/\/a\.aliexpress\.com\//i.test(String(url))) {
      const expandida = String(url).includes("_PC_PRINCIPAL") ? pcOficial : appExpandido;
      return { ok: true, status: 200, url: expandida, headers: { get: () => "" },
        text: async () => "" };
    }
    chamadas.push({ method, sourceValues });
    if (method === "aliexpress.affiliate.productdetail.get") {
      chamadasProductDetail += 1;
      if (falharPrimeiroProductDetail && chamadasProductDetail === 1) {
        return { ok: true, status: 200, url: String(url), headers: { get: () => "" },
          json: async () => ({ aliexpress_affiliate_productdetail_get_response: { resp_result: {
            resp_code: "405", resp_msg: "Api access frequency exceeds the limit. this ban will last 1 seconds"
          } } }) };
      }
      return { ok: true, status: 200, url: String(url), headers: { get: () => "" },
        json: async () => ({ aliexpress_affiliate_productdetail_get_response: { resp_result: {
          resp_code: "200", result: { products: { product: {
            product_id: productId,
            product_title: "Headset Fifine H6",
            target_sale_price: "190.00",
            product_main_image_url: "//ae01.alicdn.com/kf/fifine-fixture.jpg",
            promotion_link: "https://s.click.aliexpress.com/e/_ORIGEM_API",
            product_detail_url: productDetailUrl
          } } }
        } } }) };
    }
    if (method === "aliexpress.affiliate.product.query") {
      return { ok: true, status: 200, url: String(url), headers: { get: () => "" },
        json: async () => ({ aliexpress_affiliate_product_query_response: { resp_result: {
          resp_code: "405", resp_msg: "The result is empty"
        } } }) };
    }
    if (method === "aliexpress.affiliate.link.generate") {
      const convertido = sourceValues === appExpandido || sourceValues === appOriginalExec
        ? (afiliacaoApp ? afiliadoApp : "")
        : (sourceValues === pcOficial && afiliacaoPc ? afiliadoPc : "");
      return { ok: true, status: 200, url: String(url), headers: { get: () => "" },
        json: async () => ({ aliexpress_affiliate_link_generate_response: { resp_result: {
          result: { promotion_links: { promotion_link: convertido ? [{ promotion_link: convertido }] : [] } }
        } } }) };
    }
    throw new Error(`requisição não prevista: ${method || "sem método"}`);
  };

  try {
    const evento = { texto_original: `${texto}\n🪙 ${appOriginalExec}\n⬇️ NO PC\n${pcOriginal}`,
      metadata: metadataEvento };
    const resultado = await importarAliExpressEngine({
      job: { id: 1, evento_id: 2, cliente_id: clienteIdExec, marketplace: "aliexpress" },
      evento,
      links: [
        { url_original: appOriginalExec, url_expandida: appExpandido, metadata: { papelLink: "link_app" } },
        { url_original: pcOriginal, url_expandida: pcExpandido || null,
          redirect_ok: Boolean(pcExpandido), metadata: { papelLink: "link_pc", motivoRedirectTecnico: pcExpandido ? "" : "REDIRECT_LIMIT" } }
      ],
      deps: { getIntegracaoCliente: () => semIntegracao ? null : ({ credenciais: credenciaisExec }), importarAliExpress }
    });
    return { resultado, chamadas, evento };
  } finally {
    global.fetch = fetchAnterior;
  }
}

function linksPorPapel(resultado) {
  return Object.fromEntries(resultado.metadata.linksClassificados
    .filter(item => ["link_app", "link_pc"].includes(item.papelLink))
    .map(item => [item.papelLink, item]));
}

function prepararPonte(resultado, evento) {
  const metadata = { ...resultado.metadata, radarMirror: { comercial: { links: { classificados: [
    { urlOriginal: appOriginal, papelLink: "link_app", ordemCaptura: 1 },
    { urlOriginal: pcOriginal, papelLink: "link_pc", ordemCaptura: 2 }
  ] } } } };
  const ponte = aplicarPonteIntegridadeComercial({
    oferta: resultado, ofertaEntrada: resultado, metadata, evento,
    comercialNormalizado: { marketplace: "aliexpress", precoAtual: resultado.preco,
      precoConfiavel: true, precoOrigem: "texto_radar" }
  });
  assert.equal(ponte.integridadeComercial.guardaRadar.aplicada, true);
  return ponte;
}

function renderizar(resultado, evento) {
  const ponte = prepararPonte(resultado, evento);
  return construirEspelhoComercialV24({
    oferta: ponte.oferta,
    ofertaEntrada: resultado,
    job: { id: 1, cliente_id: clienteId, marketplace: "aliexpress" },
    evento,
    metadata: ponte.metadata,
    comercialNormalizado: { marketplace: "aliexpress", precoAtual: resultado.preco,
      precoConfiavel: true, precoOrigem: "texto_radar" }
  });
}

(async () => {
  const original = await executar({ pcExpandido: pcOficial });
  assert.equal(original.resultado.ok, true);
  assert.equal(original.resultado.metadata.pcCanonicoGerado, false);
  assert.deepEqual(original.chamadas.filter(item => item.method === "aliexpress.affiliate.link.generate")
    .map(item => item.sourceValues).sort(), [appExpandido, pcOficial].sort());
  assert.equal(linksPorPapel(original.resultado).link_pc.urlOriginal, pcOriginal);
  const templateOriginal = renderizar(original.resultado, original.evento);
  assert.equal(templateOriginal.ok, true);
  assert.ok(templateOriginal.templateEspelhoShadow.mensagem.includes(afiliadoApp));
  assert.ok(templateOriginal.templateEspelhoShadow.mensagem.includes(afiliadoPc));

  const fallback = await executar();
  assert.equal(fallback.resultado.ok, true);
  assert.equal(fallback.resultado.metadata.pcCanonicoGerado, true);
  assert.equal(fallback.resultado.metadata.aproveitamentoParcialApp, false);
  assert.equal(fallback.chamadas.filter(item => item.method === "aliexpress.affiliate.productdetail.get").length, 1,
    "ProductDetail deve ser reutilizado no mesmo processamento");
  assert.deepEqual(fallback.chamadas.filter(item => item.method === "aliexpress.affiliate.link.generate")
    .map(item => item.sourceValues).sort(), [appExpandido, pcOficial].sort(),
    "APP e novo PC recebem conversões independentes da workspace");
  const linksFallback = linksPorPapel(fallback.resultado);
  assert.equal(linksFallback.link_pc.pcCanonicoGerado, true);
  assert.equal(linksFallback.link_pc.urlOriginal, pcOriginal);
  assert.equal(linksFallback.link_pc.urlPcCanonicaGerada, pcOficial);
  assert.equal(linksFallback.link_pc.urlExpandida, "", "não alegar expansão do PC original");
  assert.equal(linksFallback.link_pc.sourceValuesUsado, pcOficial);
  assert.equal(linksFallback.link_pc.urlAfiliada, afiliadoPc);
  assert.equal(linksFallback.link_app.urlAfiliada, afiliadoApp);
  assert.equal(fallback.resultado.metadata.linksFalhosWorkspace[0].urlOriginal, pcOriginal);
  assert.equal(fallback.resultado.metadata.linksFalhosWorkspace[0].motivoConversao,
    "pc_original_sem_destino_validado");
  assert.deepEqual(fallback.resultado.metadata.linksClassificadosCapturados.map(item => item.urlOriginal),
    [appOriginal, pcOriginal]);
  for (const link of Object.values(linksFallback)) {
    assert.equal(validarProvaAfiliacaoWorkspaceAliExpress(link.afiliacaoWorkspace,
      { clienteId, credenciais, exigirAssinatura: true }).valida, true);
  }
  assert.equal(validarOfertaAfiliacaoWorkspaceAliExpress({ marketplace: "aliexpress", metadata: fallback.resultado.metadata },
    { clienteId, credenciais }).ok, true);
  assert.equal(validarOfertaAfiliacaoWorkspaceAliExpress({ marketplace: "aliexpress", metadata: fallback.resultado.metadata },
    { clienteId: "outra_workspace", credenciais }).ok, false);
  assert.equal(fallback.resultado.preco, 136.92);
  assert.equal(fallback.resultado.cupom, "IFPENUO");
  assert.ok(fallback.resultado.moedasTexto.includes("1000"));
  assert.equal(fallback.resultado.imagem, "https://ae01.alicdn.com/kf/fifine-fixture.jpg");
  const templateDuplo = renderizar(fallback.resultado, fallback.evento);
  assert.equal(templateDuplo.ok, true);
  assert.ok(templateDuplo.templateEspelhoShadow.mensagem.includes(afiliadoApp));
  assert.ok(templateDuplo.templateEspelhoShadow.mensagem.includes(afiliadoPc));
  assert.ok(!templateDuplo.templateEspelhoShadow.mensagem.includes(pcOriginal));

  const soApp = await executar({ productDetailUrl: "" });
  assert.equal(soApp.resultado.ok, true);
  assert.equal(soApp.resultado.metadata.aproveitamentoParcialApp, true);
  assert.equal(soApp.resultado.metadata.pcCanonicoGerado, false);
  assert.deepEqual(Object.keys(linksPorPapel(soApp.resultado)), ["link_app"]);
  assert.deepEqual(soApp.resultado.metadata.linksClassificadosCapturados.map(item => item.urlOriginal),
    [appOriginal, pcOriginal]);
  assert.deepEqual(soApp.chamadas.filter(item => item.method === "aliexpress.affiliate.link.generate")
    .map(item => item.sourceValues), [appExpandido]);
  assert.equal(validarOfertaAfiliacaoWorkspaceAliExpress({ marketplace: "aliexpress", metadata: soApp.resultado.metadata },
    { clienteId, credenciais }).ok, true);
  const templateApp = renderizar(soApp.resultado, soApp.evento);
  assert.equal(templateApp.ok, true);
  assert.ok(templateApp.templateEspelhoShadow.mensagem.includes(afiliadoApp));
  assert.ok(!templateApp.templateEspelhoShadow.mensagem.includes(afiliadoPc));
  assert.ok(!templateApp.templateEspelhoShadow.mensagem.includes(pcOriginal));

  const ponteApp = prepararPonte(soApp.resultado, soApp.evento);
  assert.deepEqual(ponteApp.metadata.linksComerciais.filter(item => item.renderizavel)
    .map(item => item.papel), ["link_app"]);
  const job = { id: 1, evento_id: 2, cliente_id: clienteId, marketplace: "aliexpress" };
  const ofertaUniversal = montarOfertaUniversalEngine({
    oferta: ponteApp.oferta, ofertaEntrada: soApp.resultado, job, evento: soApp.evento,
    metadata: ponteApp.metadata, status: "importada"
  });
  assert.equal(validarContratoOfertaUniversal(ofertaUniversal).ok, true);
  const linhaOferta = {
    id: 7, job_id: 1, cliente_id: clienteId, marketplace: "aliexpress",
    titulo: ponteApp.oferta.titulo, preco: ponteApp.oferta.preco,
    imagem: ponteApp.oferta.imagem, link_original: ponteApp.oferta.linkOriginal,
    link_afiliado: ponteApp.oferta.linkAfiliado,
    metadata: { ...ponteApp.metadata, ofcV24: { templateEspelhoShadow: templateApp.templateEspelhoShadow } }
  };
  const itemFila = montarItemFilaEngine(linhaOferta);
  assert.equal(itemFila.linkAfiliado, afiliadoApp);
  assert.deepEqual(itemFila.metadata.linksComerciais.filter(item => item.renderizavel)
    .map(item => item.papel), ["link_app"]);
  let enfileirado = null;
  const callbackFila = criarCallbackFilaUniversal({ pool: { connect() {} },
    enqueueFn: async input => { enfileirado = input; return { itemId: 9 }; } });
  const fila = await callbackFila(clienteId, itemFila, { oferta: linhaOferta,
    destinosCompativeis: [{ id: "destino_sintetico", tipo: "whatsapp",
      alvos: [{ grupoId: "grupo_sintetico", sessao: "sessao_sintetica" }] }] });
  assert.equal(fila.ok, true);
  assert.equal(enfileirado.workspaceId, clienteId);
  assert.equal(enfileirado.itemPayload.metadata.ofcV24.templateEspelhoShadow.mensagem.includes(afiliadoPc), false);

  const idConflitante = await executar({ productDetailUrl: "https://www.aliexpress.com/item/3256812689379802.html" });
  assert.equal(idConflitante.resultado.ok, true, "somente APP factual pode sobreviver ao PC inconclusivo");
  assert.equal(idConflitante.resultado.metadata.pcCanonicoGerado, false);
  assert.equal(idConflitante.chamadas.filter(item => item.method === "aliexpress.affiliate.link.generate").length, 1);

  const hostFalso = await executar({ productDetailUrl: `https://aliexpress.com.evil.example/item/${productId}.html` });
  assert.equal(hostFalso.resultado.ok, true);
  assert.equal(hostFalso.resultado.metadata.pcCanonicoGerado, false);
  assert.deepEqual(Object.keys(linksPorPapel(hostFalso.resultado)), ["link_app"]);

  const pcSemAfiliacao = await executar({ afiliacaoPc: false });
  assert.equal(pcSemAfiliacao.resultado.ok, true);
  assert.equal(pcSemAfiliacao.resultado.metadata.pcCanonicoGerado, false);
  assert.equal(pcSemAfiliacao.resultado.metadata.aproveitamentoParcialApp, true);
  assert.deepEqual(Object.keys(linksPorPapel(pcSemAfiliacao.resultado)), ["link_app"]);

  const semAfiliacaoApp = await executar({ afiliacaoApp: false });
  assert.equal(semAfiliacaoApp.resultado.ok, false, "sem afiliação própria APP não há oferta");

  const principalPcFalhaAppFactual = await executar({
    pcExpandido: "https://a.aliexpress.com/_PC_PRINCIPAL",
    appOriginalExec: "https://a.aliexpress.com/_APP_PRINCIPAL",
    productDetailUrl: "",
    falharPrimeiroProductDetail: true,
    texto: "Kit placa mãe com 16 GB de memória\nR$ 342\nCupom: IFPS7PCS\n500 moedas no APP"
  });
  assert.equal(principalPcFalhaAppFactual.resultado.ok, true,
    "APP factual não pode depender do ProductDetail falho do PC escolhido como principal");
  assert.equal(principalPcFalhaAppFactual.resultado.metadata.aproveitamentoParcialApp, true);
  assert.equal(principalPcFalhaAppFactual.resultado.produtoId, productId);
  assert.equal(principalPcFalhaAppFactual.resultado.linkAfiliado, afiliadoApp);
  assert.equal(principalPcFalhaAppFactual.resultado.titulo, "Headset Fifine H6");
  assert.equal(principalPcFalhaAppFactual.resultado.imagem, "https://ae01.alicdn.com/kf/fifine-fixture.jpg");
  assert.deepEqual(Object.keys(linksPorPapel(principalPcFalhaAppFactual.resultado)), ["link_app"]);
  assert.equal(principalPcFalhaAppFactual.chamadas
    .filter(item => item.method === "aliexpress.affiliate.productdetail.get").length, 2);
  assert.deepEqual(principalPcFalhaAppFactual.chamadas
    .filter(item => item.method === "aliexpress.affiliate.link.generate")
    .map(item => item.sourceValues), ["https://a.aliexpress.com/_APP_PRINCIPAL"]);

  const mencaoGbSemVarianteEstruturada = await executar({
    productDetailUrl: "",
    texto: "Kit placa mãe com 16 GB de memória\nR$ 342\nCupom: IFPS7PCS\n500 moedas no APP"
  });
  assert.equal(mencaoGbSemVarianteEstruturada.resultado.ok, true,
    "GB descritivo não é evidência estruturada de variante ambígua");

  const cupomNumerico = await executar({
    productDetailUrl: "",
    texto: "Oferta sem variante\nR$ 342\nCupom: 123456\n500 moedas no APP"
  });
  assert.equal(cupomNumerico.resultado.cupom, "123456",
    "cupom numerico explicitamente rotulado pelo Radar deve ser preservado");

  const varianteAmbigua = await executar({
    productDetailUrl: "",
    metadataEvento: { radarMirror: { comercialNormalizado: { variantes: ["512 GB", "1 TB"] } } },
    texto: "Memória disponível em duas capacidades\nR$ 315\nCupom: IFPIGKJ2\n584 moedas no APP"
  });
  assert.equal(varianteAmbigua.resultado.ok, false,
    "variantes estruturadas conflitantes continuam impedindo aproveitamento parcial");
  assert.notEqual(varianteAmbigua.resultado.metadata.pcCanonicoGerado, true);

  const credenciaisNovaWorkspace = {
    appKey: "app_workspace_nova", secret: "secret_workspace_nova", trackingId: "tracking_workspace_nova"
  };
  const novaWorkspace = await executar({
    productDetailUrl: "",
    clienteIdExec: "workspace_nova_sintetica",
    credenciaisExec: credenciaisNovaWorkspace
  });
  assert.equal(novaWorkspace.resultado.ok, true);
  const provaNovaWorkspace = linksPorPapel(novaWorkspace.resultado).link_app.afiliacaoWorkspace;
  assert.equal(validarProvaAfiliacaoWorkspaceAliExpress(provaNovaWorkspace, {
    clienteId: "workspace_nova_sintetica", credenciais: credenciaisNovaWorkspace, exigirAssinatura: true
  }).valida, true);
  assert.equal(validarProvaAfiliacaoWorkspaceAliExpress(provaNovaWorkspace, {
    clienteId, credenciais, exigirAssinatura: true
  }).valida, false, "prova APP não pode atravessar workspaces");
  const provaSemAssinatura = { ...provaNovaWorkspace };
  delete provaSemAssinatura.assinatura;
  assert.equal(validarProvaAfiliacaoWorkspaceAliExpress(provaSemAssinatura, {
    clienteId: "workspace_nova_sintetica", credenciais: credenciaisNovaWorkspace, exigirAssinatura: true
  }).valida, false, "APP sem assinatura própria não pode liberar oferta");

  const workspaceSemIntegracao = await executar({
    clienteIdExec: "workspace_sem_integracao",
    semIntegracao: true
  });
  assert.equal(workspaceSemIntegracao.resultado.ok, false);
  assert.equal(workspaceSemIntegracao.resultado.motivo, "integracao_ausente");

  const pcConflitante = await executar({ pcExpandido: "https://www.aliexpress.com/item/3256812689379802.html" });
  assert.equal(pcConflitante.resultado.ok, false,
    "ID divergente no PC não pode ser reconciliado por um fallback canônico");

  console.log("aliexpress-app-pc-fallback-oficial.test.js ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
