"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const express = require("express");

// Disposable data and HTTP only. Never call the real API or marketplace in this suite.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-mlbu-listas-"));
process.env.DATA_DIR = dataDir;
const adapter = require("../optimus-capture/adapters/mercadolivre");
const contrato = require("../optimus-capture/core/product-contract");
const resolver = require("../optimus-capture/local-worker/mercadolivre-identity");
const mlContract = require("../modules/local-worker/ml-identity.contract");
const criarRotas = require("../modules/manual-v2/manual-offers.routes");
const listas = require("../modules/manual-v2/ofertas-v2-listas");
const manual = require("../modules/manual-v2/manual-offers.storage");
const { componentesIdentidadeCanonica } = require("../modules/manual-v2/ofertas-v2-identidade");

const titulo = "Conjunto Moletom Calça Unissex Paris Canguru Casaco Frio";
const samples = [
  { page: "MLBU3862120597", mlb: "MLB6524249752", image: "https://http2.mlstatic.com/D_NQ_NP_848037-MLB119040009107_102026-O.webp" },
  { page: "MLBU4760238833", mlb: "MLB5081375005", image: "https://http2.mlstatic.com/D_NQ_NP_933046-MLB117439203238_102026-O.webp" }
];
const urlPagina = s => `https://www.mercadolivre.com.br/conjunto-moletom-calca-unissex-paris-canguru-casaco-frio/up/${s.page}`;

// Minimal projection of the official fields observed on both pages, not invented MLB arithmetic.
function fixture(sample, editar = () => {}) {
  const url = urlPagina(sample);
  const contexto = { item_id: sample.mlb, pid: sample.page, user_product_id: sample.page };
  const track = () => ({ melidata_event: { event_data: { ...contexto } } });
  const state = { id: sample.page, components: {
    header: { title: titulo },
    bookmark: { item_id: sample.mlb, add: { track: track() }, delete: { track: track() } },
    track: track(),
    share: { permalink: `${url}?pdp_filters=item_id%3A${sample.mlb}&wid=${sample.mlb}`,
      action: { track: { melidata_event: { event_data: { ...contexto, object_id: sample.page } } } },
      show_track: { melidata_event: { event_data: { object_id: sample.page } } } }
  } };
  const product = { "@type": "Product", productID: sample.page, sku: sample.page,
    name: titulo, image: sample.image, offers: { url, price: 69 } };
  const f = { state, product, canonical: url, og: url, prefix: "<div>Recommendation MLB999999999 and image MLB888888888</div>" };
  editar(f);
  return `${f.prefix}<link rel="canonical" href="${f.canonical}"><meta property="og:url" content="${f.og}"><h1>${titulo}</h1>` +
    `<script type="application/ld+json">${JSON.stringify(f.product)}</script>` +
    `<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify({ appProps: { pageProps: { initialState: f.state } } })}; globalThis.MUST_NOT_EVAL=true;</script>`;
}
function response(url, body, status = 200, contentType = "text/html", location = "") {
  return { url, status, ok: status === 200, headers: { get: key => ({
    "content-type": contentType, location
  })[key.toLowerCase()] || "" }, text: async () => body, body: { cancel: async () => {} } };
}

async function main() {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "local-test-mlbu-receipt-only";
  const workspace = "user_mlbu_listas";
  let htmlBackend = fixture(samples[0]);
  let fetches = 0;
  const app = express();
  app.use(express.json());
  app.use("/manual-v2", criarRotas({
    getClienteId: req => req.get("authorization")?.replace(/^Bearer /, "") || "",
    logger: { log() {} },
    gerarLinkAfiliadoCliente: async () => "https://meli.la/afiliado_preservado",
    fetch: async (url, opts) => {
      fetches++;
      assert.strictEqual(opts.redirect, "manual");
      const host = new URL(url).hostname;
      if (host === "http2.mlstatic.com") return response(url, "", 200, "image/webp");
      assert.strictEqual(host, "www.mercadolivre.com.br");
      return response(url, htmlBackend);
    }
  }));
  const server = await new Promise(resolve => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  // Execute the actual extension request functions, redirected strictly to our disposable server.
  const requests = [];
  const apiContext = { setTimeout, clearTimeout, AbortController,
    fetch: async (url, opts) => {
      const remote = new URL(url);
      assert.strictEqual(remote.origin, "https://go.optimuspromo.com.br");
      requests.push({ path: remote.pathname, ...opts });
      return fetch(`http://127.0.0.1:${server.address().port}${remote.pathname}${remote.search}`, opts);
    }
  };
  apiContext.globalThis = apiContext;
  vm.createContext(apiContext);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../optimus-capture/services/api.js"), "utf8"), apiContext);
  const api = apiContext.OptimusCaptureApi;
  const previews = [];
  try {
    const lista = listas.criarLista(workspace, "MLBU variantes");
    const manifest = require("../optimus-capture/manifest.json");
    const scripts = manifest.content_scripts[0].js;
    assert.ok(scripts.indexOf("local-worker/mercadolivre-identity.js") < scripts.indexOf("adapters/mercadolivre.js"));
    for (const sample of samples) {
      const html = fixture(sample);
      htmlBackend = html;
      const original = `${urlPagina(sample)}?picker=true#tracking`;
      const capture = adapter.capturarMercadoLivreDaPagina({ documentElement: { outerHTML: html } }, { href: original });
      assert.strictEqual(capture.identidadeMlCandidata.mlb, sample.mlb);
      assert.strictEqual(capture.produtoId, undefined, "content script is a candidate, not final authority");
      const preview = await api.gerarPreviewCapture(workspace, contrato.payloadPreview(capture));
      assert.strictEqual(preview.salva, false);
      assert.strictEqual(preview.oferta.listaCaptura.elegivel, true);
      assert.strictEqual(preview.oferta.produtoId, sample.mlb);
      assert.strictEqual(mlContract.validarProvaCaptureMl(preview.oferta.identidadeMlCapture, preview.oferta), sample.mlb);
      assert.strictEqual(preview.oferta.identidadeMlCapture.urlCanonica, urlPagina(sample));
      assert.strictEqual(preview.oferta.urlOriginal, original);
      assert.strictEqual(preview.oferta.titulo, titulo);
      assert.strictEqual(preview.oferta.imagem, sample.image);
      assert.strictEqual(preview.oferta.urlAfiliada, "https://meli.la/afiliado_preservado");
      const added = await api.adicionarCapturaListaManualV2(workspace, lista.id, preview.oferta);
      assert.strictEqual(added.ok, true);
      const request = JSON.parse(requests.at(-1).body);
      assert.strictEqual(request.origem, "captura_extensao");
      assert.strictEqual(request.oferta.id, undefined);
      previews.push(preview.oferta);
      console.log(`MLBU_SAMPLE: ${sample.page} -> ${sample.mlb} / PASS`);
    }
    assert.strictEqual(global.MUST_NOT_EVAL, undefined, "Nordic statements are never executed");
    assert.strictEqual(fetches, 4, "each candidate independently revalidated by the backend");
    const persisted = listas.lerListas(workspace)[0].itens;
    assert.strictEqual(persisted.length, 2, "same-title variants do not collapse");
    assert.notStrictEqual(persisted[0].canonicalKey, persisted[1].canonicalKey);
    persisted.forEach((item, i) => {
      assert.strictEqual(item.oferta.produtoId, samples[i].mlb);
      assert.strictEqual(item.oferta.titulo, titulo);
      assert.strictEqual(item.oferta.imagem, samples[i].image);
      assert.strictEqual(item.oferta.urlOriginal, previews[i].urlOriginal);
      assert.strictEqual(item.oferta.urlAfiliada, previews[i].urlAfiliada);
      assert.strictEqual(item.status, "aguardando");
    });
    assert.strictEqual(manual.listarOfertasManuaisV2(workspace).length, 0, "no ghost Manual offer");
    await assert.rejects(api.adicionarCapturaListaManualV2(workspace, lista.id,
      { ...previews[0], titulo: "Outro titulo editado", precoAtual: 75 }), err => err.status === 409);
    assert.strictEqual(listas.lerListas(workspace)[0].itens.length, 2);

    const s = samples[0];
    const negatives = [
      ["no official context", f => { f.state = {}; }],
      ["bookmark differs", f => { f.state.components.bookmark.item_id = samples[1].mlb; }],
      ["track differs", f => { f.state.components.track.melidata_event.event_data.item_id = samples[1].mlb; }],
      ["pid differs", f => { f.state.components.bookmark.add.track.melidata_event.event_data.pid = samples[1].page; }],
      ["user_product_id differs", f => { f.state.components.track.melidata_event.event_data.user_product_id = samples[1].page; }],
      ["foreign page context", f => { f.state.id = samples[1].page; }],
      ["canonical differs", f => { f.canonical = urlPagina(samples[1]); }],
      ["og differs", f => { f.og = urlPagina(samples[1]); }],
      ["JSON-LD differs", f => { f.product.productID = samples[1].page; }],
      ["current title context differs", f => { f.state.components.header.title = "Outra identidade de produto"; }],
      ["share differs", f => { f.state.components.share.permalink = urlPagina(samples[1]); }],
      ["delete conflicts", f => { f.state.components.bookmark.delete.track.melidata_event.event_data.item_id = samples[1].mlb; }],
      ["missing track", f => { delete f.state.components.track; }],
      ["payment/wid only", f => { f.state = {}; f.prefix = `<a href="https://www.mercadolivre.com.br/checkout?item_id=${s.mlb}">Buy</a>`; }]
    ];
    const validCandidate = adapter.capturarMercadoLivreDeHtml(fixture(s), urlPagina(s));
    for (const [label, mutate] of negatives) {
      htmlBackend = fixture(s, mutate);
      assert.throws(() => resolver.extrair(htmlBackend, s.mlb, urlPagina(s)), /ml_identity_/, label);
      const capture = adapter.capturarMercadoLivreDeHtml(htmlBackend, `${urlPagina(s)}?wid=${s.mlb}`);
      assert.strictEqual(capture.identidadeMlCandidata, undefined, label);
      // Even a valid local candidate cannot overrule conflicting/missing trusted HTML.
      const preview = await api.gerarPreviewCapture(workspace, contrato.payloadPreview(validCandidate));
      assert.strictEqual(preview.oferta.listaCaptura.elegivel, false, label);
      await assert.rejects(api.adicionarCapturaListaManualV2(workspace, lista.id, preview.oferta), err => err.status === 422, label);
    }
    htmlBackend = fixture(samples[1]);
    const mismatch = await api.gerarPreviewCapture(workspace, contrato.payloadPreview(validCandidate));
    assert.strictEqual(mismatch.oferta.listaCaptura.elegivel, false, "DOM/page identity cannot overrule trusted response");
    htmlBackend = fixture(s);
    const contradictory = await api.gerarPreviewCapture(workspace,
      { ...contrato.payloadPreview(validCandidate), produtoId: samples[1].mlb });
    assert.strictEqual(contradictory.oferta.listaCaptura.elegivel, false, "verified association never overrides a conflicting product ID");
    await assert.rejects(api.adicionarCapturaListaManualV2(workspace, lista.id, contradictory.oferta), err => err.status === 422);
    const withoutCandidate = contrato.payloadPreview(validCandidate);
    delete withoutCandidate.identidadeMlCandidata;
    withoutCandidate.urlOriginal += `?wid=${s.mlb}`;
    withoutCandidate.produtoId = s.mlb;
    const widOnly = await api.gerarPreviewCapture(workspace, withoutCandidate);
    assert.strictEqual(widOnly.oferta.listaCaptura.elegivel, false);
    const saved = await api.salvarOfertaManualV2(workspace, widOnly.oferta, "manual-mlbu-only");
    assert.ok(saved.oferta.id, "unresolved ML still saves explicitly in Manual");
    assert.strictEqual(saved.oferta.urlOriginal, withoutCandidate.urlOriginal);

    const originalProof = previews[0].identidadeMlCapture;
    const tampered = [
      { ...originalProof, assinatura: "0".repeat(64) },
      { ...originalProof, mlb: samples[1].mlb },
      { ...originalProof, workspaceId: "another_workspace" },
      { ...originalProof, collectedAt: new Date(Date.now() - 11 * 60_000).toISOString() }
    ];
    for (const proof of tampered) {
      await assert.rejects(api.adicionarCapturaListaManualV2(workspace, lista.id,
        { ...previews[0], identidadeMlCapture: proof }), err => err.status === 422);
    }
    assert.strictEqual(mlContract.validarProvaCaptureMl(originalProof, previews[0],
      Date.parse(originalProof.collectedAt) + 10 * 60_000), null, "receipt TTL fails closed");
    assert.strictEqual(componentesIdentidadeCanonica({ ...previews[0], urlOriginal: urlPagina(samples[1]) }), null);
    const otherList = listas.criarLista("another_workspace", "Isolated");
    await assert.rejects(api.adicionarCapturaListaManualV2("another_workspace", otherList.id, previews[0]), err => err.status === 422);

    // Approved hosts must be validated before every redirect request.
    for (const imageRedirect of [false, true]) {
      const visited = [];
      await assert.rejects(resolver.resolver({ productId: s.mlb, sourceUrl: urlPagina(s) }, {
        fetch: async url => {
          visited.push(url);
          if (!imageRedirect || url.includes("mlstatic.com")) return response(url, "", 302, "text/html", "http://127.0.0.1/private");
          return response(url, fixture(s));
        }
      }), /redirect_invalido/);
      assert.ok(visited.every(url => !url.includes("127.0.0.1")), "no untrusted redirect is requested");
    }
    const streamed = await resolver.resolver({ productId: s.mlb, sourceUrl: urlPagina(s) }, {
      fetch: async url => new Response(url.includes("mlstatic.com") ? null : fixture(s), {
        headers: { "content-type": url.includes("mlstatic.com") ? "image/webp" : "text/html" }
      })
    });
    assert.strictEqual(mlContract.validarResultadoMlIdentity(streamed).expectedMlb, s.mlb,
      "native fetch streaming path also validates the same contract");
    await assert.rejects(resolver.resolver({ productId: s.mlb, sourceUrl: urlPagina(s) }, {
      fetch: async () => new Response("x".repeat(2_000_001))
    }), /ml_identity_html_muito_grande/, "HTML read is bounded even without content-length");
    assert.strictEqual(listas.lerListas(workspace)[0].itens.length, 2, "negative cases cannot create list ghosts");
    console.log("CAPTURE_MLBU -> VERIFIED_MLB_IDENTITY -> ADD_TO_LIST_REQUEST -> LIST_PERSISTED: PASS");
    console.log("same-title variants / dedupe / untrusted client / conflicts / Manual / workspace / redirects: PASS");
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
main().then(() => console.log("optimus-capture-mlbu-listas.test.js: PASS")).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
