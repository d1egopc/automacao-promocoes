"use strict";

const assert = require("node:assert/strict");
const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
const { validarProvaAfiliacaoWorkspaceAliExpress } = require("../modules/marketplaces/aliexpress/afiliacao-workspace");

const workspaceId = "workspace_seuhardware_best_fixture";
const credenciais = { appKey: "app_fixture", secret: "secret_fixture", trackingId: "tracking_fixture" };
const productId = "1005010148896613";
const app = "https://seuhardware.com/s/app-best";
const pc = "https://seuhardware.com/s/pc-best";
const appExpandido = `https://best.aliexpress.com/p/coin-index/index.html?productIds=${productId}`;
const pcExpandido = `https://www.aliexpress.com/item/${productId}.html`;

function prova(url, papel) {
  return {
    workspaceId,
    appKey: credenciais.appKey,
    trackingIdEnviado: credenciais.trackingId,
    papel,
    urlOriginal: url,
    urlAfiliadaWorkspace: `https://s.click.aliexpress.com/e/_${papel === "link_app" ? "APP" : "PC"}_BEST_FIXTURE`,
    origemConversao: "workspace_api",
    conversaoStatus: "convertida",
    motivoConversao: "fixture_convertida"
  };
}

async function main() {
  const chamadas = [];
  const resultado = await importarAliExpressEngine({
    job: { id: "job-seuhardware-best", evento_id: 204613, cliente_id: workspaceId, marketplace: "aliexpress" },
    evento: {
      texto_original: [
        "SSD NVMe 4 TB",
        "Por R$ 32,00",
        `Link com moedas: ${app}`,
        `Link para PC: ${pc}`
      ].join("\n")
    },
    links: [
      { url_original: app, url_expandida: appExpandido, marketplace_detectado: "aliexpress", metadata: {} },
      { url_original: pc, url_expandida: pcExpandido, marketplace_detectado: "aliexpress", metadata: {} }
    ],
    deps: {
      getIntegracaoCliente: cliente => cliente === workspaceId ? { credenciais } : null,
      importarAliExpress: async (url, config = {}) => {
        const papel = config.contextoEngine?.papelLink || "produto";
        chamadas.push({ url, papel });
        return {
          marketplace: "aliexpress",
          titulo: "SSD NVMe 4 TB",
          productId,
          precoAtual: "2532.73",
          linkOriginal: pcExpandido,
          linkExpandido: url,
          linkAfiliado: `https://s.click.aliexpress.com/e/_${papel === "link_app" ? "APP" : "PC"}_BEST_FIXTURE`,
          imagem: "https://ae01.alicdn.com/kf/ssd-best-fixture.jpg",
          categoria: "Computadores e escritório",
          metadata: { afiliacaoWorkspace: prova(url, papel) }
        };
      }
    }
  });

  assert.equal(resultado.ok, true, "landing best com productIds único deve manter a oferta elegível");
  assert.equal(resultado.preco, 32, "preço factual do Radar prevalece sobre o importador");
  const links = Object.fromEntries(resultado.metadata.linksClassificados.map(item => [item.papelLink, item]));
  assert.equal(links.link_app.renderizavel, true);
  assert.equal(links.link_pc.renderizavel, true);
  assert.equal(links.link_app.sourceValuesUsado, appExpandido);
  // O papel PC conserva a URL original do resolvedor homologado como source_values;
  // a identidade é comprovada pelo URL expandido antes da conversão.
  assert.equal(links.link_pc.sourceValuesUsado, pc);
  assert.equal(links.link_app.urlOriginal, app);
  assert.equal(links.link_pc.urlOriginal, pc);
  assert.equal(links.link_app.afiliacaoWorkspace.workspaceId, workspaceId);
  assert.equal(validarProvaAfiliacaoWorkspaceAliExpress(links.link_app.afiliacaoWorkspace, {
    clienteId: workspaceId, credenciais, exigirAssinatura: true
  }).valida, true);
  assert.deepEqual(chamadas.map(item => item.papel).sort(), ["link_app", "link_pc"]);

  const ambigua = await importarAliExpressEngine({
    job: { id: "job-seuhardware-best-ambiguous", evento_id: 204617, cliente_id: workspaceId, marketplace: "aliexpress" },
    evento: { texto_original: `APP: ${app}\nPC: ${pc}` },
    links: [
      { url_original: app, url_expandida: `https://best.aliexpress.com/p/coin-index/index.html?productIds=${productId},1005010999999999`, marketplace_detectado: "aliexpress", metadata: {} },
      { url_original: pc, url_expandida: pcExpandido, marketplace_detectado: "aliexpress", metadata: {} }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais }),
      importarAliExpress: async (url, config = {}) => ({
        marketplace: "aliexpress", titulo: "SSD NVMe 4 TB", productId,
        precoAtual: "10", linkOriginal: pcExpandido, linkExpandido: url,
        linkAfiliado: "https://s.click.aliexpress.com/e/_PC_ONLY",
        imagem: "https://ae01.alicdn.com/kf/ssd-best-fixture.jpg", categoria: "Computadores",
        metadata: { afiliacaoWorkspace: prova(url, config.contextoEngine?.papelLink || "produto") }
      })
    }
  });
  assert.equal(ambigua.ok, false, "productIds múltiplos não podem ser tratados como identidade única");
  assert.equal(ambigua.motivo, "afiliacao_workspace_incompleta");

  console.log("aliexpress-seuhardware-best-landing.test.cjs OK");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
