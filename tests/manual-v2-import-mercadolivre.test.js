const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-ml-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const {
  importarMercadoLivreManualV2,
  precoAnteriorManualMercadoLivre,
  origemPrecoAnteriorComprovada
} = require("../modules/manual-v2/adapters/mercadolivre.manual.adapter");

const agora = "2026-08-14T12:30:00.000Z";
const idFactory = () => "manual_v2_ml";

function criarDeps(produto, chamadas = []) {
  return {
    clienteId: "cliente_ml",
    now: agora,
    idFactory,
    getIntegracaoCliente(clienteId, marketplace) {
      chamadas.push({ tipo: "getIntegracaoCliente", clienteId, marketplace });
      return {
        credenciais: {
          cookies: "cookie_teste",
          tag: "tag_teste"
        }
      };
    },
    async gerarLinkAfiliadoMercadoLivre(url, integracao, contexto) {
      chamadas.push({
        tipo: "gerarLinkAfiliadoMercadoLivre",
        url,
        temIntegracao: Boolean(integracao),
        clienteId: contexto?.clienteId || ""
      });
      return "https://meli.la/afiliado";
    },
    async importarMercadoLivre(url, clienteId, deps) {
      chamadas.push({
        tipo: "importarMercadoLivre",
        url,
        clienteId,
        temGetIntegracaoCliente: typeof deps.getIntegracaoCliente === "function",
        temGerarLink: typeof deps.gerarLinkAfiliadoMercadoLivre === "function",
        chavesDeps: Object.keys(deps).sort()
      });
      return produto;
    }
  };
}

(async function main() {
{
  assert.strictEqual(origemPrecoAnteriorComprovada({ precoAntigoOrigem: "html.price.original" }), true);
  assert.strictEqual(origemPrecoAnteriorComprovada({ precoAntigoOrigem: "calculado_por_desconto" }), false);
  assert.strictEqual(precoAnteriorManualMercadoLivre({ precoAnterior: "199,90" }), "199,90");
  assert.strictEqual(precoAnteriorManualMercadoLivre({ precoAntigo: "199,90" }), "");
  assert.strictEqual(precoAnteriorManualMercadoLivre({
    precoAntigo: "199,90",
    precoAntigoOrigem: "html_price_original"
  }), "199,90");
}

{
  const chamadas = [];
  const oferta = await importarMercadoLivreManualV2("https://produto.mercadolivre.com.br/MLB-123", criarDeps({
    marketplace: "mercadolivre",
    linkOriginal: "https://produto.mercadolivre.com.br/MLB-123",
    linkAfiliado: "https://meli.la/afiliado",
    titulo: "Produto ML",
    precoAtual: "129,90",
    precoAnterior: "199,90",
    imagem: "https://http2.mlstatic.com/produto.jpg",
    categoriaProduto: "Celulares",
    cupom: "PROMO10",
    parcelamento: "10x de R$ 12,99 sem juros"
  }, chamadas));

  assert.strictEqual(oferta.id, "manual_v2_ml");
  assert.strictEqual(oferta.clienteId, "cliente_ml");
  assert.strictEqual(oferta.marketplace, "mercadolivre");
  assert.strictEqual(oferta.status, "salva");
  assert.strictEqual(oferta.precoAtual, "129,90");
  assert.strictEqual(oferta.precoAnterior, "199,90");
  assert.strictEqual(oferta.urlOriginal, "https://produto.mercadolivre.com.br/MLB-123");
  assert.strictEqual(oferta.urlAfiliada, "https://meli.la/afiliado");
  assert.strictEqual(oferta.titulo, "Produto ML");
  assert.strictEqual(oferta.imagem, "https://http2.mlstatic.com/produto.jpg");
  assert.strictEqual(oferta.categoria, "Celulares");
  assert.strictEqual(oferta.cupom, "PROMO10");
  assert.strictEqual(oferta.parcelamento, "10x de R$ 12,99 sem juros");
  assert.strictEqual(oferta.fonteImportacao.marketplaceDetectado, "mercadolivre");
  assert.strictEqual(oferta.fonteImportacao.adapter, "mercadolivre.manual.adapter");
  assert.strictEqual(oferta.fonteImportacao.parseOnly, true);
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAnterior"));
  assert.deepStrictEqual(chamadas[0], {
    tipo: "importarMercadoLivre",
    url: "https://produto.mercadolivre.com.br/MLB-123",
    clienteId: "cliente_ml",
    temGetIntegracaoCliente: true,
    temGerarLink: true,
    chavesDeps: ["gerarLinkAfiliadoMercadoLivre", "getIntegracaoCliente"]
  });
}

{
  const oferta = await importarMercadoLivreManualV2("https://produto.mercadolivre.com.br/MLB-456", criarDeps({
    marketplace: "mercadolivre",
    linkOriginal: "https://produto.mercadolivre.com.br/MLB-456",
    titulo: "Produto sem de",
    precoAtual: "89,90",
    precoAntigo: "149,90",
    descontoPercentual: 40,
    imagem: ""
  }));

  assert.strictEqual(oferta.precoAtual, "89,90");
  assert.strictEqual(oferta.precoAnterior, "", "preco antigo sem origem comprovada nao entra no Manual V2");
  assert.ok(oferta.fonteImportacao.avisos.includes("preco_anterior_ignorado_sem_origem_comprovada"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAnterior"));
  assert.strictEqual(oferta.imagem, "");
}

{
  const oferta = await importarMercadoLivreManualV2("https://produto.mercadolivre.com.br/MLB-789", criarDeps({
    marketplace: "mercadolivre",
    linkOriginal: "https://produto.mercadolivre.com.br/MLB-789",
    titulo: "",
    precoAtual: "",
    imagem: "",
    categoria: "Mercado Livre",
    cupomOrigem: "texto_manual",
    cupom: "TEXTO10"
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.categoria, "");
  assert.strictEqual(oferta.cupom, "");
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("titulo"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("imagem"));
}

{
  const resultado = await importarMercadoLivreManualV2(
    "https://produto.mercadolivre.com.br/MLB-000",
    criarDeps(null)
  );

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "mercadolivre_importacao_sem_dados_confiaveis");
  assert.strictEqual(resultado.marketplaceDetectado, "mercadolivre");
  assert.strictEqual(resultado.parseOnly, true);
  assert.strictEqual(resultado.titulo, undefined, "falha do importador nao pode preencher windows como titulo");
  assert.strictEqual(resultado.imagem, undefined, "falha do importador nao pode inventar imagem");
}

{
  const arquivoManual = getClienteJsonPath("cliente_ml", "manual_ofertas_v2.json");
  const arquivoFila = getClienteJsonPath("cliente_ml", "fila.json");
  assert.strictEqual(fs.existsSync(arquivoManual), false, "adapter parse-only nao salva oferta manual");
  assert.strictEqual(fs.existsSync(arquivoFila), false, "adapter parse-only nao escreve fila");
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "adapters", "mercadolivre.manual.adapter.js"),
    "utf8"
  );
  const proibidos = [
    "utils/fila-ofertas",
    "processarFila",
    "prepararOfertaGlobal",
    "adicionarOfertaInicioFila",
    "Distributor",
    "Oferta Universal",
    "oferta-universal",
    "inteligencia-universal",
    "memoria-ofertas",
    "radar-ofertas",
    "/fila",
    "/enviar-manual",
    "manual-offers.storage"
  ];

  for (const termo of proibidos) {
    assert.ok(!fonte.includes(termo), `Adapter ML Manual V2 nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-import-mercadolivre.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
