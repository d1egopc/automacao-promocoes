const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-amazon-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const {
  importarAmazonManualV2,
  precoAnteriorManualAmazon,
  origemPrecoAnteriorComprovadaAmazon,
  detectarBloqueioAmazon,
  limparLinkAmazonManual
} = require("../modules/manual-v2/adapters/amazon.manual.adapter");

const agora = "2026-08-14T12:45:00.000Z";
const idFactory = () => "manual_v2_amazon";

function criarDeps(produto, chamadas = []) {
  return {
    clienteId: "cliente_amazon",
    now: agora,
    idFactory,
    getIntegracaoCliente(clienteId, marketplace) {
      chamadas.push({ tipo: "getIntegracaoCliente", clienteId, marketplace });
      return {
        credenciais: {
          cookies: "cookie_amazon",
          trackingId: "tag-20"
        }
      };
    },
    async importarAmazon(url, config) {
      chamadas.push({
        tipo: "importarAmazon",
        url,
        clienteId: config?.clienteId || "",
        trackingId: config?.credenciais?.trackingId || "",
        temContextoRadar: Boolean(config?.contextoRadar || config?.radar || config?.textoRadar)
      });
      return produto;
    }
  };
}

(async function main() {
{
  assert.strictEqual(origemPrecoAnteriorComprovadaAmazon({ precoAntigoOrigem: "a-text-price .a-offscreen" }), true);
  assert.strictEqual(origemPrecoAnteriorComprovadaAmazon({ precoAntigoOrigem: "calculado_por_desconto" }), false);
  assert.strictEqual(precoAnteriorManualAmazon({ precoAnterior: "299,90" }), "299,90");
  assert.strictEqual(precoAnteriorManualAmazon({ precoAntigo: "299,90" }), "");
  assert.strictEqual(precoAnteriorManualAmazon({
    precoAntigo: "299,90",
    precoAntigoOrigem: "a-text-price .a-offscreen"
  }), "299,90");
  assert.strictEqual(detectarBloqueioAmazon({ aviso: "captcha solicitado" }), true);
  assert.strictEqual(limparLinkAmazonManual("https://www.amazon.com.br/Produto/dp/B0ABCDEF12?tag=tag-20&ref=x"), "https://www.amazon.com.br/dp/B0ABCDEF12?tag=tag-20");
}

{
  const chamadas = [];
  const oferta = await importarAmazonManualV2("https://www.amazon.com.br/dp/B0ABCDEF12", criarDeps({
    marketplace: "amazon",
    linkOriginal: "https://www.amazon.com.br/dp/B0ABCDEF12?tag=tag-20",
    linkAfiliado: "https://www.amazon.com.br/dp/B0ABCDEF12?tag=tag-20",
    titulo: "Produto Amazon Real",
    precoAtual: "129,90",
    precoAntigo: "199,90",
    precoAntigoOrigem: "a-text-price .a-offscreen",
    imagem: "https://images-na.ssl-images-amazon.com/produto.jpg",
    categoria: "Amazon",
    cupom: "PROMO10",
    tipoCupom: "confirmado_amazon",
    parcelamento: "10x de R$ 12,99 sem juros"
  }, chamadas));

  assert.strictEqual(oferta.id, "manual_v2_amazon");
  assert.strictEqual(oferta.clienteId, "cliente_amazon");
  assert.strictEqual(oferta.marketplace, "amazon");
  assert.strictEqual(oferta.status, "salva");
  assert.strictEqual(oferta.precoAtual, "129,90");
  assert.strictEqual(oferta.precoAnterior, "199,90");
  assert.strictEqual(oferta.urlOriginal, "https://www.amazon.com.br/dp/B0ABCDEF12?tag=tag-20");
  assert.strictEqual(oferta.urlAfiliada, "https://www.amazon.com.br/dp/B0ABCDEF12?tag=tag-20");
  assert.strictEqual(oferta.titulo, "Produto Amazon Real");
  assert.strictEqual(oferta.imagem, "https://images-na.ssl-images-amazon.com/produto.jpg");
  assert.strictEqual(oferta.categoria, "Amazon");
  assert.strictEqual(oferta.cupom, "PROMO10");
  assert.strictEqual(oferta.parcelamento, "10x de R$ 12,99 sem juros");
  assert.strictEqual(oferta.fonteImportacao.marketplaceDetectado, "amazon");
  assert.strictEqual(oferta.fonteImportacao.adapter, "amazon.manual.adapter");
  assert.strictEqual(oferta.fonteImportacao.parseOnly, true);
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAnterior"));
  assert.deepStrictEqual(chamadas, [
    {
      tipo: "getIntegracaoCliente",
      clienteId: "cliente_amazon",
      marketplace: "amazon"
    },
    {
      tipo: "importarAmazon",
      url: "https://www.amazon.com.br/dp/B0ABCDEF12",
      clienteId: "cliente_amazon",
      trackingId: "tag-20",
      temContextoRadar: false
    }
  ]);
}

{
  const oferta = await importarAmazonManualV2("https://www.amazon.com.br/dp/B0NOOLDPRC", criarDeps({
    marketplace: "amazon",
    linkOriginal: "https://www.amazon.com.br/dp/B0NOOLDPRC?tag=tag-20",
    titulo: "Produto sem preco anterior",
    precoAtual: "89,90",
    precoAntigo: "149,90",
    imagem: ""
  }));

  assert.strictEqual(oferta.precoAtual, "89,90");
  assert.strictEqual(oferta.precoAnterior, "", "preco antigo sem origem comprovada nao entra no Manual V2");
  assert.ok(oferta.fonteImportacao.avisos.includes("preco_anterior_ignorado_sem_origem_comprovada"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAnterior"));
  assert.strictEqual(oferta.imagem, "");
}

{
  const oferta = await importarAmazonManualV2("https://www.amazon.com.br/dp/B0CAPTCHA1", criarDeps({
    marketplace: "amazon",
    aviso: "Amazon retornou captcha / robot check",
    temCaptcha: true,
    titulo: "Produto Amazon",
    precoAtual: "",
    precoAntigo: "",
    imagem: ""
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.cupom, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("amazon_bloqueio_ou_captcha_sem_dados_fabricados"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("titulo"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
}

{
  const oferta = await importarAmazonManualV2("https://www.amazon.com.br/dp/B0EMPTY000", criarDeps({
    marketplace: "amazon",
    linkOriginal: "https://www.amazon.com.br/dp/B0EMPTY000",
    titulo: "Produto Amazon",
    precoAtual: "",
    imagem: "",
    tipoCupom: "texto_radar",
    cupom: "TEXTO10"
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.cupom, "");
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("titulo"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("imagem"));
}

{
  const arquivoManual = getClienteJsonPath("cliente_amazon", "manual_ofertas_v2.json");
  const arquivoFila = getClienteJsonPath("cliente_amazon", "fila.json");
  assert.strictEqual(fs.existsSync(arquivoManual), false, "adapter parse-only nao salva oferta manual");
  assert.strictEqual(fs.existsSync(arquivoFila), false, "adapter parse-only nao escreve fila");
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "adapters", "amazon.manual.adapter.js"),
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
    "manual-offers.storage",
    "registrarRadarCupons"
  ];

  for (const termo of proibidos) {
    assert.ok(!fonte.includes(termo), `Adapter Amazon Manual V2 nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-import-amazon.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
