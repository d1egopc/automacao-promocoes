const assert = require("assert");

const {
  criarRadarMirror,
  compararRadarMirrorComImportador,
  mergeRadarMirrorMetadata,
  normalizarTituloComparacao
} = require("../modules/radar/radar-mirror");
const { normalizarOfertaUniversal } = require("../modules/inteligencia-universal/normalizacao.service");
const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");

function criarExtracaoBase() {
  return {
    marketplace: "mercadolivre",
    titulo: {
      valor: "Air Fryer Mondial 4L",
      confianca: "media",
      evidencia: "Air Fryer Mondial 4L por R$ 199,90"
    },
    precoAtual: {
      valor: "199,90",
      confianca: "alta",
      evidencia: "por R$ 199,90"
    },
    precoAnterior: {
      valor: "249,90",
      confianca: "media",
      evidencia: "de R$ 249,90"
    },
    cupom: {
      codigo: "PROMO20",
      beneficioTexto: "Cupom PROMO20",
      confianca: "media",
      evidencia: "use PROMO20"
    },
    imagemMensagem: {
      presente: true,
      referenciaInterna: "thumbnail:imageMessage"
    }
  };
}

function criarMirror(overrides = {}) {
  return criarRadarMirror({
    origemTipo: "whatsapp",
    clienteId: "admin",
    sessaoId: "admin_sessao1",
    grupoId: "grupo_1@g.us",
    grupoNome: "Ofertas",
    capturadaEm: "2026-07-25T10:00:00.000Z",
    textoOriginal: "Air Fryer Mondial 4L por R$ 199,90 de R$ 249,90 cupom PROMO20 https://www.mercadolivre.com.br/p/MLB123 https://cupom.exemplo/resgate",
    links: [
      "https://www.mercadolivre.com.br/p/MLB123",
      "https://cupom.exemplo/resgate"
    ],
    extracaoRadarLocal: criarExtracaoBase(),
    beneficiosMensagem: {
      cupom: "PROMO20",
      tipoCupom: "codigo",
      beneficioExtra: "Cupom PROMO20",
      linkResgateCupom: "https://cupom.exemplo/resgate",
      linksResgate: ["https://cupom.exemplo/resgate"]
    },
    raw: {
      message: {
        imageMessage: {
          jpegThumbnail: Buffer.from("fake")
        }
      }
    },
    marketplace: "mercadolivre",
    ...overrides
  });
}

function testarContratoBasico() {
  const mirror = criarMirror();
  assert.strictEqual(mirror.versao, 1);
  assert.strictEqual(mirror.origem.tipo, "whatsapp");
  assert.strictEqual(mirror.origem.clienteId, "admin");
  assert.strictEqual(mirror.texto.original.includes("Air Fryer"), true);
  assert.strictEqual(mirror.produto.tituloCapturado, "Air Fryer Mondial 4L");
  assert.strictEqual(mirror.preco.atualCapturado, 199.9);
  assert.strictEqual(mirror.preco.anteriorCapturado, 249.9);
  assert.strictEqual(mirror.cupom.codigoCapturado, "PROMO20");
  assert.strictEqual(mirror.evidencias.possuiPreco, true);
  assert.strictEqual(mirror.evidencias.possuiCupom, true);
}

function testarLinksClassificados() {
  const mirror = criarMirror();
  assert.deepStrictEqual(mirror.links.encontrados, [
    "https://www.mercadolivre.com.br/p/MLB123",
    "https://cupom.exemplo/resgate"
  ]);
  assert.strictEqual(mirror.links.produtoOriginal, "https://www.mercadolivre.com.br/p/MLB123");
  assert.strictEqual(mirror.links.resgateCupom, "https://cupom.exemplo/resgate");
  assert.deepStrictEqual(mirror.links.adicionais, []);
  assert.strictEqual(mirror.evidencias.possuiDoisLinks, true);
  assert.strictEqual(mirror.evidencias.possuiLinkResgate, true);
}

function testarLinksNaoClassificaveis() {
  const mirror = criarRadarMirror({
    textoOriginal: "texto com dois links sem contexto",
    links: ["https://encurtador.exemplo/a", "https://outro.exemplo/b"],
    extracaoRadarLocal: {},
    beneficiosMensagem: {},
    marketplace: ""
  });
  assert.strictEqual(mirror.links.produtoOriginal, null);
  assert.strictEqual(mirror.links.resgateCupom, null);
  assert.deepStrictEqual(mirror.links.adicionais, ["https://encurtador.exemplo/a", "https://outro.exemplo/b"]);
}

function testarMidiaOriginal() {
  const mirror = criarMirror();
  assert.strictEqual(mirror.midia.imagemOriginal, "thumbnail:imageMessage");
  assert.strictEqual(mirror.midia.imagemOrigem, "mensagem");
  assert.strictEqual(mirror.evidencias.possuiImagem, true);
}

function testarComparacaoImportador() {
  const mirror = criarMirror();
  const comparado = compararRadarMirrorComImportador(mirror, {
    titulo: "Air Fryer Mondial 4L",
    precoAtual: 219.9,
    precoOriginal: 249.9,
    cupom: "PROMO20",
    imagem: "https://cdn.exemplo/produto.jpg"
  });
  assert.strictEqual(comparado.comparacaoImportador.precoImportador, 219.9);
  assert.strictEqual(comparado.comparacaoImportador.divergenciaPreco, true);
  assert.strictEqual(comparado.comparacaoImportador.divergenciaCupom, false);
  assert.strictEqual(comparado.comparacaoImportador.divergenciaTitulo, false);
}

function testarDivergenciaConservadora() {
  const mirror = criarMirror();
  const comparado = compararRadarMirrorComImportador(mirror, {
    titulo: "AIR-FRYER Mondial 4L!!!",
    precoAtual: 199.904,
    cupom: "PROMO20"
  });
  assert.strictEqual(normalizarTituloComparacao("AIR-FRYER Mondial 4L!!!"), "air fryer mondial 4l");
  assert.strictEqual(comparado.comparacaoImportador.divergenciaPreco, false);
  assert.strictEqual(comparado.comparacaoImportador.divergenciaTitulo, false);
}

function testarDivergenciaCupom() {
  const mirror = criarMirror();
  const comparado = compararRadarMirrorComImportador(mirror, {
    titulo: "Air Fryer Mondial 4L",
    precoAtual: 199.9,
    cupom: "OUTRO20"
  });
  assert.strictEqual(comparado.comparacaoImportador.divergenciaCupom, true);
}

function testarBlocoCapturadoPreservado() {
  const mirror = criarMirror();
  const antes = JSON.stringify({
    origem: mirror.origem,
    texto: mirror.texto,
    produto: mirror.produto,
    preco: mirror.preco,
    cupom: mirror.cupom,
    links: mirror.links,
    midia: mirror.midia,
    evidencias: mirror.evidencias
  });
  const comparado = compararRadarMirrorComImportador(mirror, { titulo: "Outro Produto", precoAtual: 10 });
  const depois = JSON.stringify({
    origem: comparado.origem,
    texto: comparado.texto,
    produto: comparado.produto,
    preco: comparado.preco,
    cupom: comparado.cupom,
    links: comparado.links,
    midia: comparado.midia,
    evidencias: comparado.evidencias
  });
  assert.strictEqual(depois, antes);
  assert.notDeepStrictEqual(comparado.comparacaoImportador, mirror.comparacaoImportador);
}

function testarMergeMetadataPreservaExistente() {
  const mirror = criarMirror();
  const comparado = compararRadarMirrorComImportador(mirror, { titulo: "Air Fryer Mondial 4L", precoAtual: 199.9 });
  const metadata = mergeRadarMirrorMetadata({ origem: "teste", produto: { sku: "abc" } }, comparado);
  assert.strictEqual(metadata.origem, "teste");
  assert.deepStrictEqual(metadata.produto, { sku: "abc" });
  assert.strictEqual(metadata.radarMirror.produto.tituloCapturado, "Air Fryer Mondial 4L");
  assert.strictEqual(metadata.radarMirror.comparacaoImportador.divergenciaPreco, false);
}

function testarMergeIdempotente() {
  const mirror = criarMirror();
  const umaVez = mergeRadarMirrorMetadata({}, mirror);
  const duasVezes = mergeRadarMirrorMetadata(umaVez, compararRadarMirrorComImportador(mirror, { precoAtual: 199.9 }));
  assert.strictEqual(duasVezes.radarMirror.texto.original, umaVez.radarMirror.texto.original);
  assert.strictEqual(duasVezes.radarMirror.preco.atualCapturado, 199.9);
}

function testarNormalizacaoNaoApagaMirror() {
  const mirror = criarMirror();
  const normalizada = normalizarOfertaUniversal({
    titulo: "Air Fryer Mondial 4L",
    marketplace: "mercadolivre",
    precoAtual: 199.9,
    metadata: mergeRadarMirrorMetadata({ produto: { categoria: "cozinha" } }, mirror)
  });
  assert.strictEqual(normalizada.metadata.produto.categoria, "cozinha");
  assert.strictEqual(normalizada.metadata.radarMirror.preco.atualCapturado, 199.9);
}

function testarFluxoManualNaoCriaMirror() {
  const manual = normalizarOfertaUniversal({
    titulo: "Oferta manual",
    marketplace: "mercadolivre",
    precoAtual: 99.9,
    origem: "manual",
    metadata: { produto: { imagemCandidatos: ["https://img.exemplo/a.jpg"] } }
  });
  assert.strictEqual(Boolean(manual.metadata?.radarMirror), false);
  assert.deepStrictEqual(manual.metadata.produto.imagemCandidatos, ["https://img.exemplo/a.jpg"]);
}

function testarOfertaAntigaSemMirrorContinuaValida() {
  const metadata = mergeRadarMirrorMetadata({ legado: true }, null);
  assert.deepStrictEqual(metadata, { legado: true });
  const normalizada = normalizarOfertaUniversal({ titulo: "Oferta antiga", marketplace: "amazon", precoAtual: 10, metadata });
  assert.strictEqual(normalizada.metadata.legado, true);
  assert.strictEqual(Boolean(normalizada.metadata.radarMirror), false);
}

function testarItemFilaPreservaMirror() {
  const mirror = criarMirror();
  const item = montarItemFilaEngine({
    id: 123,
    uuid: "uuid-123",
    job_id: 456,
    cliente_id: "user_abc",
    marketplace: "Mercado Livre",
    titulo: "Air Fryer Mondial 4L",
    preco: 199.9,
    preco_original: 249.9,
    link_original: "https://www.mercadolivre.com.br/p/MLB123",
    link_afiliado: "https://go.optimus/r/abc123",
    metadata: mergeRadarMirrorMetadata({ origem: "engine" }, mirror)
  });
  assert.strictEqual(item.metadata.origem, "engine");
  assert.strictEqual(item.metadata.radarMirror.links.produtoOriginal, "https://www.mercadolivre.com.br/p/MLB123");
}

function testarSemEvidenciasMantemNulos() {
  const mirror = criarRadarMirror({ textoOriginal: "sem preco sem cupom", links: [], extracaoRadarLocal: {}, beneficiosMensagem: {} });
  assert.strictEqual(mirror.preco.atualCapturado, null);
  assert.strictEqual(mirror.cupom.codigoCapturado, null);
  assert.strictEqual(mirror.links.quantidadeEncontrada, 0);
  assert.strictEqual(mirror.midia.imagemOrigem, "ausente");
}

async function main() {
  testarContratoBasico();
  testarLinksClassificados();
  testarLinksNaoClassificaveis();
  testarMidiaOriginal();
  testarComparacaoImportador();
  testarDivergenciaConservadora();
  testarDivergenciaCupom();
  testarBlocoCapturadoPreservado();
  testarMergeMetadataPreservaExistente();
  testarMergeIdempotente();
  testarNormalizacaoNaoApagaMirror();
  testarFluxoManualNaoCriaMirror();
  testarOfertaAntigaSemMirrorContinuaValida();
  testarItemFilaPreservaMirror();
  testarSemEvidenciasMantemNulos();
  console.log("radar-mirror-passivo.test.js OK");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
