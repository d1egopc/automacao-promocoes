"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { importarAwinEngine } = require("../modules/engine/importer/adapters/awin.adapter");
const { normalizarOfertaImportada } = require("../modules/engine/importer/importer.service");
const { montarOfertaUniversalEngine, validarContratoOfertaUniversal } =
  require("../modules/engine/oferta-universal.contract");
const { criarPreflightFilaUniversal } = require("../modules/engine/universal-queue-preflight");

const JOB = { id: 1167194, evento_id: 239129, cliente_id: "user_pss60lus", marketplace: "kabum" };
const EVENTO = { id: 239129, texto_original: "Processador AMD Ryzen 9 5900XT\nR$ 1.779\nCupom FARMOU" };
const ORIGINAL = "https://seuhardware.com/s/c7M6DTd";
const OFICIAL = "https://www.kabum.com.br/produto/609953/processador-amd-ryzen-9-5900xt";
const IMAGEM = "https://images.kabum.com.br/produtos/fotos/609953/ryzen.jpg";
const AFILIADO = "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=222&ued=" + encodeURIComponent(OFICIAL);
const LINK = {
  id: 271653,
  evento_id: 239129,
  url_original: ORIGINAL,
  url_normalizada: ORIGINAL,
  url_expandida: OFICIAL,
  dominio_original: "seuhardware.com",
  dominio_final: "www.kabum.com.br",
  redirect_ok: true,
  motivo_redirect: "resolvido",
  marketplace_detectado: "kabum",
  metadata: { papelLink: "produto", papelLinkMotivo: "kabum_id_produto_url", papelLinkConfianca: "alta" }
};

function deps() {
  return {
    importarProdutoKabumViaAwin: async () => ({
      marketplace: "kabum",
      titulo: "Processador AMD Ryzen 9 5900XT",
      tituloFonteOficial: "kabum_html.title",
      produtoIdCanonico: "609953",
      linkOriginal: OFICIAL,
      linkExpandido: OFICIAL,
      linkAfiliado: AFILIADO,
      imagem: IMAGEM,
      preco: 1779,
      precoOriginal: 1999,
      cupom: "FARMOU",
      categoria: "Gamer e Hardware",
      categoriaOrigem: "padrao_importador_kabum"
    }),
    gerarDeepLinkAwin: async () => AFILIADO,
    getIntegracaoCliente: (_workspace, marketplace) => marketplace === "awin"
      ? { credenciais: { publisherId: "222" } }
      : null
  };
}

async function importar(link = LINK, job = JOB) {
  const bruto = await importarAwinEngine({ job, evento: EVENTO, links: [link], deps: deps() });
  assert.equal(bruto.ok, true, bruto.motivo);
  return { bruto, oferta: normalizarOfertaImportada(bruto, job) };
}

function preflight() {
  const ok = async () => ({ ok: true });
  return criarPreflightFilaUniversal({
    pool: { connect() {} },
    now: () => Date.parse("2026-11-15T14:20:00.000Z"),
    readClock: async () => null,
    resolveDestination: async () => ({ ok: true, destination: {
      id: "destino-hardware", tipo: "whatsapp", intervaloMinutos: 2.5
    } }),
    checkWindow: ok,
    checkDailyLimit: ok,
    checkSession: ok,
    checkCredits: ok,
    checkMedia: async ({ oferta }) => ({ ok: oferta.midia?.imagemPrincipal === IMAGEM }),
    checkLinks: async ({ oferta }) => ({ ok: oferta.afiliacao?.urlAfiliada === AFILIADO }),
    checkDedup: ok,
    renderMessage: async () => ({ ok: true, message: "dry-run" })
  });
}

test("job 1167194 preserva shortlink e aceita somente o transporte persistido até SKU 609953", async () => {
  const { oferta } = await importar();
  assert.equal(oferta.titulo, "Processador AMD Ryzen 9 5900XT");
  assert.equal(oferta.metadata.provaTituloTecnicoRejeitada, false);
  assert.equal(oferta.metadata.provaTituloTecnicoValidada.ocorrenciaLink.id, "271653");
  assert.equal(oferta.metadata.provaTituloTecnicoValidada.ocorrenciaLink.urlOriginal, ORIGINAL);
  assert.equal(oferta.imagem, IMAGEM);
  assert.equal(oferta.preco, 1779);
  assert.equal(oferta.precoOriginal, 1999);
  assert.equal(oferta.cupom, "FARMOU");
  assert.equal(oferta.linkOriginal, OFICIAL);
  assert.equal(oferta.linkAfiliado, AFILIADO);
  assert.equal(oferta.metadata.clienteId, "user_pss60lus");

  const universal = montarOfertaUniversalEngine({
    oferta: { ...oferta, engineOfertaId: 991 }, ofertaEntrada: oferta,
    job: JOB, evento: EVENTO, link: LINK, metadata: oferta.metadata
  });
  assert.equal(validarContratoOfertaUniversal(universal).ok, true);
  assert.equal(universal.workspaceId, "user_pss60lus");
  assert.equal(universal.produto.idExterno, "609953");
  assert.equal(universal.produto.urlOriginal, OFICIAL);
  assert.equal(universal.midia.imagemPrincipal, IMAGEM);
  assert.equal(universal.comercial.precoAtual, 1779);
  assert.equal(universal.comercial.precoAnterior, 1999);
  assert.equal(universal.comercial.cupom, "FARMOU");
  assert.equal(universal.afiliacao.urlAfiliada, AFILIADO);

  universal.engineOfertaId = 991;
  universal.clienteId = "user_pss60lus";
  const resultado = await preflight()({
    workspace_id: "user_pss60lus",
    destination_id: "destino-hardware",
    capturado_em: "2026-11-15T14:18:15.158Z",
    operationEpochStartedAt: "2026-11-15T14:00:00.000Z",
    evento_id: 239129,
    oferta_id: 991,
    origem_fluxo: "optimus",
    item_payload: universal
  });
  assert.equal(resultado.ready, true, JSON.stringify(resultado));
});

test("transporte sem prova, SKU, ocorrência ou workspace divergentes permanecem bloqueados", async () => {
  for (const alterar of [
    link => { link.redirect_ok = false; },
    link => { link.motivo_redirect = "falhou"; },
    link => { link.url_expandida = link.url_expandida.replace("609953", "999999"); }
  ]) {
    const link = structuredClone(LINK);
    alterar(link);
    const { oferta } = await importar(link);
    assert.equal(oferta.titulo, "");
    assert.equal(oferta.metadata.provaTituloTecnicoRejeitada, true);
  }

  const { bruto } = await importar();
  const ocorrenciaDivergente = structuredClone(bruto);
  ocorrenciaDivergente.metadata.linksComerciais[0].id = 271654;
  const ofertaOcorrencia = normalizarOfertaImportada(ocorrenciaDivergente, JOB);
  assert.equal(ofertaOcorrencia.titulo, "");
  assert.equal(ofertaOcorrencia.metadata.provaTituloTecnicoRejeitada, true);

  const ofertaWorkspace = normalizarOfertaImportada(bruto, { ...JOB, cliente_id: "workspace-divergente" });
  assert.equal(ofertaWorkspace.titulo, "");
  assert.equal(ofertaWorkspace.metadata.provaTituloTecnicoRejeitada, true);
});
