"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const fixtureDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-ali-tenant-candidate-"));
process.env.DATA_DIR = fixtureDataDir;

const { writeGlobalJson } = require("../utils/storage");
const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
const {
  marketplaceAtivoClienteEngine,
  obterIntegracaoClienteEngine,
  credenciaisValidasEngine
} = require("../modules/engine/validator.service");
const distributor = require("../modules/engine/distributor/distributor.service");
const { validarProvaAfiliacaoWorkspaceAliExpress } = require("../modules/marketplaces/aliexpress/afiliacao-workspace");

const tenants = [
  { id: "tenant_a_fixture", appKey: "fixture_app_a", secret: "fixture_secret_a", trackingId: "fixture_track_a" },
  { id: "tenant_b_fixture", appKey: "fixture_app_b", secret: "fixture_secret_b", trackingId: "fixture_track_b" },
  { id: "tenant_future_fixture", appKey: "fixture_app_future", secret: "fixture_secret_future", trackingId: "fixture_track_future" }
];

const integrationsByWorkspace = Object.fromEntries(tenants.map((tenant, index) => [tenant.id, {
  aliexpress: { ativo: true, credenciais: {
    appKey: tenant.appKey,
    secret: tenant.secret,
    trackingId: tenant.trackingId
  } },
  magalu: { ativo: true, credenciais: { promoterId: `fixture_promoter_${index}` } }
}]));

const marketplacesByWorkspace = Object.fromEntries(tenants.map((tenant, index) => [tenant.id, {
  aliexpress: { ativo: true },
  magalu: { ativo: index === 2 }
}]));

const destinationsByWorkspace = Object.fromEntries(tenants.map((tenant, index) => [tenant.id, [{
  id: `dest_${tenant.id}`,
  nome: `Destination ${index + 1}`,
  ativo: true,
  tipo: "whatsapp",
  marketplaces: ["aliexpress"],
  categorias: index === 1 ? ["Casa"] : ["Eletronicos"],
  origemOfertas: "ambos"
}]]));

const magaluDestination = tenant => ({
  id: `dest_magalu_${tenant.id}`,
  nome: `Magalu destination ${tenant.id}`,
  ativo: true,
  tipo: "whatsapp",
  marketplaces: ["magalu"],
  categorias: ["Eletronicos"],
  origemOfertas: "ambos"
});

function affiliateMetadata(tenant, affiliateUrl) {
  return {
    afiliacaoWorkspace: {
      workspaceId: tenant.id,
      appKey: tenant.appKey,
      trackingIdEnviado: tenant.trackingId,
      origemConversao: "workspace_api",
      conversaoStatus: "convertida",
      urlAfiliadaWorkspace: affiliateUrl,
      motivoConversao: "fixture_workspace_api"
    }
  };
}

async function main() {
  writeGlobalJson("usuarios.json", tenants.map(tenant => ({ id: tenant.id, ativo: true, plano: "pro" })));

  for (let index = 0; index < tenants.length; index += 1) {
    const tenant = tenants[index];
    const link = `https://s.click.aliexpress.com/e/_Fixture${index + 1}`;
    const affiliateUrl = `https://s.click.aliexpress.com/e/_Affiliated${index + 1}`;
    const fetched = [];
    const integration = obterIntegracaoClienteEngine(integrationsByWorkspace, tenant.id, "aliexpress");

    assert.equal(marketplaceAtivoClienteEngine(tenant.id, "aliexpress", marketplacesByWorkspace), true);
    assert.equal(credenciaisValidasEngine(integration, "aliexpress"), true);
    assert.deepEqual(integration.credenciais, {
      appKey: tenant.appKey,
      secret: tenant.secret,
      trackingId: tenant.trackingId
    });

    const evento = { marketplace: "aliexpress", texto_original: `Produto de teste\nPor R$ 32,00\n${link}` };
    const result = await importarAliExpressEngine({
      job: { id: `job_${tenant.id}`, evento_id: 700 + index, cliente_id: tenant.id, marketplace: "aliexpress" },
      evento,
      links: [{ url_original: link, url_normalizada: link, url_expandida: "", marketplace_detectado: "aliexpress", metadata: {} }],
      deps: {
        getIntegracaoCliente: (clienteId, marketplace) => {
          assert.equal(clienteId, tenant.id, "lookup must use the commercial workspace from the job");
          assert.equal(marketplace, "aliexpress");
          return integrationsByWorkspace[clienteId]?.[marketplace] || null;
        },
        importarAliExpress: async (receivedLink, config) => {
          fetched.push({ receivedLink, clienteId: config.clienteId, credenciais: config.credenciais });
          assert.equal(config.contextoEngine?.clienteId, tenant.id);
          return {
            marketplace: "aliexpress",
            titulo: `Fixture product ${index + 1}`,
            productId: `1005001234567${index}`,
            precoAtual: "2920.00",
            precoOriginal: "3000.00",
            linkOriginal: `https://www.aliexpress.com/item/1005001234567${index}.html`,
            linkExpandido: `https://www.aliexpress.com/item/1005001234567${index}.html`,
            linkAfiliado: affiliateUrl,
            imagem: "https://ae01.alicdn.com/kf/fixture.jpg",
            categoria: "Eletronicos",
            metadata: affiliateMetadata(tenant, affiliateUrl)
          };
        }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.clienteId, tenant.id);
    assert.equal(result.precoAtual, 32, "captured Radar commercial price stays authoritative");
    assert.equal(result.linkAfiliado, affiliateUrl, "affiliation is generated for this workspace only");
    assert.equal(result.metadata.afiliacaoWorkspace.workspaceId, tenant.id);
    assert.equal(validarProvaAfiliacaoWorkspaceAliExpress(result.metadata.afiliacaoWorkspace, {
      clienteId: tenant.id,
      credenciais: integration.credenciais,
      exigirAssinatura: true
    }).valida, true, "final affiliation proof is signed for the requesting workspace");
    assert.deepEqual(fetched, [{ receivedLink: link, clienteId: tenant.id, credenciais: integration.credenciais }]);

    const activeMagalu = marketplaceAtivoClienteEngine(tenant.id, "magalu", marketplacesByWorkspace);
    assert.equal(activeMagalu, index === 2, "a workspace's Magalu flag must not leak to other workspaces");

    const ownCategory = index === 1 ? "Casa" : "Eletronicos";
    const ownDestinationResult = await distributor.validarOfertaParaDistribuicao({
      id: `offer_${tenant.id}`,
      job_id: `job_${tenant.id}`,
      cliente_id: tenant.id,
      marketplace: "aliexpress",
      titulo: "Fixture product",
      categoria: ownCategory,
      preco: 32,
      link_original: link,
      link_afiliado: affiliateUrl,
      metadata: {}
    }, {
      clientesValidos: tenants.map(item => item.id),
      marketplacesAtivosPorCliente: marketplacesByWorkspace,
      destinosPorCliente: destinationsByWorkspace,
      validarCreditos: () => ({ ok: true })
    });
    assert.equal(ownDestinationResult.ok, true, "each tenant uses its own authorized category destination");

    const crossTenantCategory = index === 1 ? "Eletronicos" : "Casa";
    const crossTenantDestination = await distributor.validarOfertaParaDistribuicao({
      id: `cross_offer_${tenant.id}`,
      job_id: `cross_job_${tenant.id}`,
      cliente_id: tenant.id,
      marketplace: "aliexpress",
      titulo: "Fixture product",
      categoria: crossTenantCategory,
      preco: 32,
      link_original: link,
      link_afiliado: affiliateUrl,
      metadata: {}
    }, {
      clientesValidos: tenants.map(item => item.id),
      marketplacesAtivosPorCliente: marketplacesByWorkspace,
      destinosPorCliente: destinationsByWorkspace,
      validarCreditos: () => ({ ok: true })
    });
    assert.equal(crossTenantDestination.ok, false, "another tenant's category selection cannot authorize distribution");
    assert.equal(crossTenantDestination.motivo, "categoria_incompativel");

    const magaluResult = await distributor.validarOfertaParaDistribuicao({
      id: `magalu_offer_${tenant.id}`,
      job_id: `magalu_job_${tenant.id}`,
      cliente_id: tenant.id,
      marketplace: "magalu",
      titulo: "Fixture Magalu product",
      categoria: "Eletronicos",
      preco: 32,
      link_original: "https://www.magazineluiza.com.br/produto-fixture",
      link_afiliado: "https://www.magazineluiza.com.br/produto-fixture",
      metadata: {}
    }, {
      clientesValidos: tenants.map(item => item.id),
      marketplacesAtivosPorCliente: marketplacesByWorkspace,
      destinosPorCliente: { [tenant.id]: [magaluDestination(tenant)] },
      validarCreditos: () => ({ ok: true })
    });
    assert.equal(magaluResult.ok, index === 2, "Magalu eligibility follows the current tenant flag and own destinations");
    if (index < 2) assert.equal(magaluResult.motivo, "marketplace_bloqueado");
  }

  const absentTenant = "tenant_without_integration_fixture";
  assert.equal(obterIntegracaoClienteEngine(integrationsByWorkspace, absentTenant, "aliexpress"), null);
  assert.equal(credenciaisValidasEngine(null, "aliexpress"), false, "missing tenant integration cannot authenticate from another tenant");
  console.log("aliexpress-shortlink-multitenancy-candidate.test.cjs OK (3 isolated tenants)");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => fs.rmSync(fixtureDataDir, { recursive: true, force: true }));
