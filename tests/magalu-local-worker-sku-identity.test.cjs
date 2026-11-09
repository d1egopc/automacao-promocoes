"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const repoRoot = process.env.OPTIMUS_REPO_ROOT || path.resolve(__dirname, "..");
const workerPath = path.join(repoRoot, "optimus-capture/local-worker/magalu-identity.js");
const { chaveIdentidadeMagalu } = require(path.join(repoRoot, "modules/local-worker/magalu-identity.contract.js"));
const {
  criarProvaAfiliacaoWorkspaceMagalu,
  validarProvaAfiliacaoWorkspaceMagalu,
  PROOF_TYPE_PAGE_VALIDATED
} = require(path.join(repoRoot, "modules/marketplaces/magalu/afiliacao-workspace.js"));
process.env.JWT_SECRET = process.env.JWT_SECRET || "magalu-sku-identity-test-only";

const sourceUrl = "https://magazineluiza.onelink.me/589508454/c7zm9t50";
const productUrl = "https://www.magazineluiza.com.br/produto-oficial/p/123456789/ud/loja/";
const image = "https://a-static.mlcdn.com.br/320x320/produto.jpg";
const identityKey = chaveIdentidadeMagalu(sourceUrl);

function instalarAmbiente({ pageProductId = "123456789", pageSku = "seller-sku-987654", pageUrl = productUrl, capturedUrl = pageUrl } = {}) {
  const state = { httpCalls: 0, captured: 0, removed: 0, httpStatus: 403 };
  global.fetch = async () => {
    state.httpCalls += 1;
    return {
      ok: false,
      status: state.httpStatus,
      redirected: false,
      url: sourceUrl,
      body: { cancel: async () => undefined }
    };
  };
  global.chrome = {
    tabs: {
      create: async () => ({ id: 711 }),
      get: async () => ({ id: 711, status: "complete", url: pageUrl }),
      sendMessage: async () => {
        state.captured += 1;
        return { produto: {
          urlOriginal: capturedUrl,
          produtoId: pageProductId,
          sku: pageSku,
          titulo: "Produto oficial Magalu com título técnico",
          imagem: image
        } };
      },
      remove: async () => { state.removed += 1; },
      onUpdated: { addListener() {}, removeListener() {} }
    }
  };
  delete require.cache[require.resolve(workerPath)];
  return { state, resolver: require(workerPath) };
}

async function main() {
  // The URL-derived product entity ID and the seller SKU are different identifiers.
  const valid = instalarAmbiente({ pageProductId: "123456789", pageSku: "seller-sku-987654" });
  const proof = await valid.resolver.resolver({ sourceUrl, identityKey });
  assert.equal(proof.observedProductId, "123456789");
  assert.equal(proof.finalUrl, productUrl);
  assert.equal(proof.provaTecnica.statusHttp, 0, "Chrome fallback does not expose the page HTTP status");
  assert.equal(valid.state.httpCalls, 1, "the blocked OneLink fetch is attempted once");
  assert.equal(valid.state.captured, 1, "the Chrome page receiver recovers official product evidence");
  assert.equal(valid.state.removed, 1, "the temporary tab is always closed");
  assert.equal(Object.hasOwn(proof, "sku"), false);
  assert.equal(Object.hasOwn(proof, "preco"), false);
  assert.equal(Object.hasOwn(proof, "cupom"), false);
  assert.equal(Object.hasOwn(proof, "clienteId"), false);
  assert.equal(Object.hasOwn(proof, "affiliate"), false);

  // The shared worker returns tenant-neutral identity; each workspace receives its own affiliate proof.
  const affiliateProofs = [
    { clienteId: "tenant-a", promoterId: "tenant-a" },
    { clienteId: "tenant-b", promoterId: "tenant-b" }
  ].map(tenant => {
    const urlAfiliadaWorkspace = `https://www.magazinevoce.com.br/${tenant.promoterId}/produto/p/${proof.observedProductId}/`;
    const affiliate = criarProvaAfiliacaoWorkspaceMagalu({
      ...tenant,
      productId: proof.observedProductId,
      urlOriginal: productUrl,
      urlAfiliadaWorkspace,
      paginaValidada: true,
      proofType: PROOF_TYPE_PAGE_VALIDATED,
      papelLink: "produto"
    });
    assert.equal(validarProvaAfiliacaoWorkspaceMagalu(affiliate, tenant).valida, true);
    return affiliate.urlAfiliadaWorkspace;
  });
  assert.notEqual(affiliateProofs[0], affiliateProofs[1], "affiliate links must remain workspace-scoped");

  // A genuinely different product ID remains rejected even when the SKU is plausible.
  const divergent = instalarAmbiente({ pageProductId: "987654321", pageSku: "seller-sku-987654" });
  await assert.rejects(
    () => divergent.resolver.resolver({ sourceUrl, identityKey }),
    /magalu_identity_produto_id_divergente/
  );
  assert.equal(divergent.state.removed, 1);

  // A page URL that resolves to another official product is still rejected.
  const wrongPage = instalarAmbiente({
    pageProductId: "123456789",
    pageSku: "seller-sku-987654",
    pageUrl: productUrl,
    capturedUrl: "https://www.magazineluiza.com.br/outro/p/987654321/ud/loja/"
  });
  await assert.rejects(
    () => wrongPage.resolver.resolver({ sourceUrl, identityKey }),
    /magalu_identity_url_trocada/
  );

  console.log("magalu-sku-identity-focal.test.cjs PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
