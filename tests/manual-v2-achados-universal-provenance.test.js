const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-achados-universal-provenance-"));

const achados = require("../modules/manual-v2/ofertas-v2-achados");
const listas = require("../modules/manual-v2/ofertas-v2-listas");
const { getClienteJsonPath, writeClienteJson } = require("../utils/storage");

const workspace = "workspace_provenance";
const agora = new Date().toISOString();

function universal(id, marketplace, urlOriginal, urlAfiliada) {
  return {
    ofertaId: id, workspaceId: workspace, marketplace,
    produto: { idExterno: id, titulo: `Produto ${marketplace}`, urlOriginal, urlCanonica: urlOriginal },
    comercial: { precoAtual: 42.5, precoAnterior: null, cupom: "", parcelamento: null, frete: null, beneficios: [] },
    midia: { imagemPrincipal: "https://img.example.test/produto.png" },
    afiliacao: { urlAfiliada, statusConversao: "convertida" }, criadoEm: agora
  };
}

function registrar(id, marketplace, original, afiliada, metadata = {}) {
  return achados.registrarAchado({
    clienteId: workspace, ofertaId: id,
    ofertaUniversal: universal(id, marketplace, original, afiliada),
    metadata: { ofertaUniversalValidacao: { ok: true }, ...metadata }, capturedAt: agora
  });
}

const casos = [
  ["amazon-asin", "amazon", "https://www.amazon.com.br/dp/B09SJT773X", "https://www.amazon.com.br/dp/B09SJT773X?tag=workspace-20"],
  ["meli-mlb", "mercadolivre", "https://www.mercadolivre.com.br/MLB123", "https://meli.la/workspace-mlb"],
  ["kabum-produto", "kabum", "https://www.kabum.com.br/produto/123", "https://redir.example.test/kabum-workspace"]
];

for (const [id, marketplace, original, afiliada] of casos) {
  assert.strictEqual(registrar(id, marketplace, original, afiliada).ok, true);
  const achado = achados.buscarAchado(workspace, id);
  assert.strictEqual(achado.afiliacaoWorkspace.workspaceId, workspace);
  assert.strictEqual(achado.afiliacaoWorkspace.urlAfiliadaWorkspace, afiliada);
  assert.strictEqual(achado.afiliacaoWorkspace.origemConversao, "oferta_universal_validada");
  const link = listas.linkAfiliadoAchado(achado, workspace);
  assert.strictEqual(link.urlAfiliada, afiliada, `${marketplace} reutiliza o link convertido`);
}

const listaPublica = achados.listarAchados(workspace, {
  resolverLinkProduto: (item) => listas.linkAfiliadoAchado(item, workspace)
});
for (const [, marketplace, , afiliada] of casos) {
  const item = listaPublica.find((entrada) => entrada.marketplace === marketplace);
  assert.strictEqual(item.urlProduto, afiliada);
}

function legado(marketplace, urlOriginal, urlAfiliada, produtoId) {
  return {
    id: `legado-${marketplace}`, clienteId: workspace, marketplace, produtoId,
    identidadeProdutoVerificada: { origem: "engine_importer", marketplace, id: produtoId },
    urlOriginal, urlAfiliada, capturadoEm: agora, ultimaObservacaoEm: agora
  };
}
const legadoAmazon = legado("amazon", "https://www.amazon.com.br/dp/LEGADO?tag=workspace-20",
  "https://www.amazon.com.br/dp/LEGADO?tag=workspace-20", "LEGADO");
assert.strictEqual(listas.linkAfiliadoAchado(legadoAmazon, workspace, {
  getIntegracaoCliente: () => ({ credenciais: { trackingId: "workspace-20" } })
}).urlAfiliada, legadoAmazon.urlAfiliada,
  "Achado Amazon legado reutiliza a tag afiliada da própria workspace");
assert.strictEqual(listas.linkAfiliadoAchado(legadoAmazon, workspace, {
  getIntegracaoCliente: () => ({ credenciais: { trackingId: "outra-workspace" } })
}), null, "tag Amazon de outra workspace continua bloqueada");
const legadoMeli = legado("mercadolivre", "https://www.mercadolivre.com.br/MLBLEGADO",
  "https://meli.la/workspace-legado", "MLBLEGADO");
assert.strictEqual(listas.linkAfiliadoAchado(legadoMeli, workspace).urlAfiliada, legadoMeli.urlAfiliada);
const legadoKabum = legado("kabum", "https://www.kabum.com.br/produto/LEGADO",
  "https://www.awin1.com/cread.php?s=workspace-legado", "LEGADO");
assert.strictEqual(listas.linkAfiliadoAchado(legadoKabum, workspace).urlAfiliada, legadoKabum.urlAfiliada);

const originalOnly = universal("amazon-original-only", "amazon",
  "https://www.amazon.com.br/dp/ORIGINAL", "https://www.amazon.com.br/dp/ORIGINAL");
assert.strictEqual(achados.registrarAchado({
  clienteId: workspace, ofertaId: originalOnly.ofertaId, ofertaUniversal: originalOnly,
  metadata: { ofertaUniversalValidacao: { ok: true } }, capturedAt: agora
}).ok, true);
assert.strictEqual(listas.linkAfiliadoAchado(achados.buscarAchado(workspace, originalOnly.ofertaId), workspace), null,
  "URL original sem conversão não libera a seta");

const magaluOriginal = "https://www.magazineluiza.com.br/produto/sem-prova";
const magaluAfiliada = "https://www.magazinevoce.com.br/workspace/produto";
const magalu = universal("magalu-sem-prova", "magalu", magaluOriginal, magaluAfiliada);
assert.strictEqual(achados.registrarAchado({
  clienteId: workspace, ofertaId: magalu.ofertaId, ofertaUniversal: magalu,
  metadata: { ofertaUniversalValidacao: { ok: true } }, capturedAt: agora
}).ok, true);
assert.strictEqual(listas.linkAfiliadoAchado(achados.buscarAchado(workspace, magalu.ofertaId), workspace), null,
  "Magalu continua exigindo sua prova própria");

const adulterado = achados.buscarAchado(workspace, "amazon-asin");
const adulteradoPersistido = {
  ...adulterado,
  afiliacaoWorkspace: { ...adulterado.afiliacaoWorkspace, workspaceId: "workspace_outro" }
};
writeClienteJson(workspace, achados.ARQUIVO_ACHADOS, [adulteradoPersistido]);
assert.strictEqual(listas.linkAfiliadoAchado(achados.buscarAchado(workspace, "amazon-asin"), workspace), null,
  "prova de outra workspace continua bloqueada");

const antes = JSON.stringify(require("../utils/storage").readClienteJson(workspace, achados.ARQUIVO_ACHADOS, []));
assert.strictEqual(listas.linkAfiliadoAchado(adulteradoPersistido, workspace, {
  gerarLinkAfiliadoCliente: () => { throw new Error("recaptura proibida"); }
}), null);
const depois = JSON.stringify(require("../utils/storage").readClienteJson(workspace, achados.ARQUIVO_ACHADOS, []));
assert.strictEqual(depois, antes, "a leitura não recaptura nem altera dados");

console.log("manual-v2-achados-universal-provenance.test.js ok");
