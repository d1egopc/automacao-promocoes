const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-aliexpress-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const {
  importarAliExpressManualV2,
  productIdManualAliExpress,
  retornoGenericoAliExpress,
  precoAnteriorManualAliExpress,
  urlAfiliadaGeradaAliExpress
} = require("../modules/manual-v2/adapters/aliexpress.manual.adapter");

const agora = "2026-08-14T13:25:00.000Z";
const idFactory = () => "manual_v2_aliexpress";

function criarDeps(produto, chamadas = []) {
  return {
    clienteId: "cliente_aliexpress",
    now: agora,
    idFactory,
    getIntegracaoCliente(clienteId, marketplace) {
      chamadas.push({ tipo: "getIntegracaoCliente", clienteId, marketplace });
      return {
        credenciais: {
          appKey: "app_ali",
          secret: "secret_ali",
          trackingId: "track_ali"
        }
      };
    },
    async importarAliExpress(url, config) {
      chamadas.push({
        tipo: "importarAliExpress",
        url,
        clienteId: config?.clienteId || "",
        trackingId: config?.credenciais?.trackingId || "",
        temGeradorAli: typeof config?.gerarLinkCurtoAliExpress === "function",
        temGeradorOptimus: typeof config?.gerarLinkOptimus === "function",
        temContextoAutomatico: Boolean(config?.contextoEngine || config?.contextoRadar || config?.textoRadar)
      });
      return produto;
    }
  };
}

function criarDepsComImportador(importarAliExpress, chamadas = []) {
  const deps = criarDeps({}, chamadas);
  deps.importarAliExpress = importarAliExpress;
  return deps;
}

(async function main() {
{
  assert.strictEqual(
    productIdManualAliExpress({}, "https://www.aliexpress.com/item/1005001234567890.html"),
    "1005001234567890"
  );
  assert.strictEqual(
    retornoGenericoAliExpress({
      titulo: "Produto AliExpress",
      erroTecnico: "aliexpress_manual_fallback_generico"
    }, "https://sale.aliexpress.com/landing"),
    true
  );
  assert.strictEqual(precoAnteriorManualAliExpress({
    productId: "1005001234567890",
    precoAntigo: "199,90"
  }), "199,90");
  assert.strictEqual(precoAnteriorManualAliExpress({
    precoAntigo: "199,90",
    precoAntigoOrigem: "calculado_por_desconto"
  }), "");
  assert.strictEqual(urlAfiliadaGeradaAliExpress({
    linkAfiliado: "https://s.click.aliexpress.com/e/_DlPromo123"
  }), "https://s.click.aliexpress.com/e/_DlPromo123");
  assert.strictEqual(urlAfiliadaGeradaAliExpress({
    linkAfiliado: "https://www.aliexpress.com/item/1005001234567890.html"
  }), "");
}

{
  const chamadas = [];
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005001111111111.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005001111111111",
    linkOriginal: "https://www.aliexpress.com/item/1005001111111111.html",
    linkAfiliado: "https://s.click.aliexpress.com/e/_SHORT111",
    titulo: "Produto AliExpress Real",
    precoAtual: "129,90",
    precoAntigo: "199,90",
    imagem: "https://ae01.alicdn.com/produto.jpg",
    categoriaProduto: "Casa e Jardim",
    avisoCupom: "Compra internacional. Pode haver imposto/taxa. Confira cupom ou desconto com moedas na pagina."
  }, chamadas));

  assert.strictEqual(oferta.id, "manual_v2_aliexpress");
  assert.strictEqual(oferta.clienteId, "cliente_aliexpress");
  assert.strictEqual(oferta.marketplace, "aliexpress");
  assert.strictEqual(oferta.status, "salva");
  assert.strictEqual(oferta.urlOriginal, "https://www.aliexpress.com/item/1005001111111111.html");
  assert.strictEqual(oferta.urlAfiliada, "https://s.click.aliexpress.com/e/_SHORT111");
  assert.strictEqual(oferta.titulo, "Produto AliExpress Real");
  assert.strictEqual(oferta.precoAtual, "129,90");
  assert.strictEqual(oferta.precoAnterior, "199,90");
  assert.strictEqual(oferta.imagem, "https://ae01.alicdn.com/produto.jpg");
  assert.strictEqual(oferta.categoria, "Casa e Jardim");
  assert.strictEqual(oferta.cupom, "");
  assert.strictEqual(oferta.fonteImportacao.marketplaceDetectado, "aliexpress");
  assert.strictEqual(oferta.fonteImportacao.adapter, "aliexpress.manual.adapter");
  assert.strictEqual(oferta.fonteImportacao.parseOnly, true);
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAnterior"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("urlAfiliada"));
  assert.deepStrictEqual(chamadas, [
    {
      tipo: "getIntegracaoCliente",
      clienteId: "cliente_aliexpress",
      marketplace: "aliexpress"
    },
    {
      tipo: "importarAliExpress",
      url: "https://www.aliexpress.com/item/1005001111111111.html",
      clienteId: "cliente_aliexpress",
      trackingId: "track_ali",
      temGeradorAli: false,
      temGeradorOptimus: false,
      temContextoAutomatico: false
    }
  ]);
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005002222222222.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005002222222222",
    linkOriginal: "https://www.aliexpress.com/item/1005002222222222.html",
    linkAfiliado: "https://www.aliexpress.com/item/1005002222222222.html",
    titulo: "Produto Parcial AliExpress",
    precoAtual: "",
    precoAntigo: "",
    imagem: "",
    categoria: "AliExpress",
    aviso: "Dados parciais retornados pela API AliExpress."
  }));

  assert.strictEqual(oferta.titulo, "Produto Parcial AliExpress");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.categoria, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("url_afiliada_ignorada_sem_shortlink_confirmado"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("imagem"));
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005003333333333.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005003333333333",
    linkOriginal: "https://www.aliexpress.com/item/1005003333333333.html",
    linkAfiliado: "https://s.click.aliexpress.com/e/_SHORT333",
    titulo: "Produto sem de",
    precoAtual: "89,90",
    imagem: ""
  }));

  assert.strictEqual(oferta.precoAtual, "89,90");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAnterior"));
}

{
  const oferta = await importarAliExpressManualV2("https://sale.aliexpress.com/coins-land.htm", criarDeps({
    marketplace: "aliexpress",
    titulo: "Produto AliExpress",
    precoAtual: "",
    precoAntigo: "",
    linkOriginal: "https://sale.aliexpress.com/coins-land.htm",
    linkAfiliado: "https://sale.aliexpress.com/coins-land.htm",
    imagem: "",
    categoria: "AliExpress",
    erroTecnico: "aliexpress_manual_fallback_generico",
    motivoErroAliExpress: "product_id_ausente"
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.categoria, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("aliexpress_product_id_ausente_sem_produto_fabricado"));
  assert.ok(oferta.fonteImportacao.avisos.includes("aliexpress_retorno_generico_ignorado_no_manual_v2"));
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005004444444444.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005004444444444",
    linkOriginal: "https://www.aliexpress.com/item/1005004444444444.html",
    linkAfiliado: "",
    titulo: "",
    precoAtual: "",
    imagem: ""
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.strictEqual(oferta.imagem, "");
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("titulo"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("urlAfiliada"));
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005005555555555.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005005555555555",
    linkOriginal: "https://www.aliexpress.com/item/1005005555555555.html",
    linkAfiliado: "https://s.click.aliexpress.com/e/_SHORT555",
    titulo: "Produto com preco unico",
    precoAtual: "399,68",
    precoAntigo: "868,87",
    target_sale_price: "399,68",
    target_original_price: "868,87",
    imagem: "https://ae01.alicdn.com/unico.jpg",
    categoriaProduto: "Eletronicos"
  }));

  assert.strictEqual(oferta.precoAtual, "399,68");
  assert.strictEqual(oferta.precoAnterior, "868,87");
  assert.strictEqual(oferta.precoMin, "");
  assert.strictEqual(oferta.precoMax, "");
  assert.strictEqual(oferta.temVariacaoPreco, false);
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.usadoPara.precoAtual, "target_sale_price");
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.usadoPara.precoAnterior, "target_original_price");
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.origem, "resposta_importer");
  assert.deepStrictEqual(oferta.fonteImportacao.precoAliExpress.camposBrutos, {
    target_sale_price: "399,68",
    target_original_price: "868,87"
  });
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005006666666666.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005006666666666",
    linkOriginal: "https://www.aliexpress.com/item/1005006666666666.html",
    linkAfiliado: "https://s.click.aliexpress.com/e/_SHORT666",
    titulo: "Produto com faixa real",
    precoAtual: "265,99",
    precoAntigo: "868,87",
    target_min_sale_price: "265,99",
    target_max_sale_price: "604,52",
    target_original_price: "868,87",
    imagem: "https://ae01.alicdn.com/faixa.jpg",
    categoriaProduto: "Eletronicos"
  }));

  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "868,87");
  assert.strictEqual(oferta.precoMin, "265,99");
  assert.strictEqual(oferta.precoMax, "604,52");
  assert.strictEqual(oferta.temVariacaoPreco, true);
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.temFaixaReal, true);
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.usadoPara.precoMin, "target_min_sale_price");
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.usadoPara.precoMax, "target_max_sale_price");
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoMin"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoMax"));
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005007777777777.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005007777777777",
    linkOriginal: "https://www.aliexpress.com/item/1005007777777777.html",
    linkAfiliado: "https://s.click.aliexpress.com/e/_SHORT777",
    titulo: "Produto com minimo sem maximo",
    precoAtual: "265,99",
    target_min_sale_price: "265,99",
    imagem: "https://ae01.alicdn.com/minimo.jpg",
    categoriaProduto: "Eletronicos"
  }));

  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoMin, "265,99");
  assert.strictEqual(oferta.precoMax, "");
  assert.strictEqual(oferta.temVariacaoPreco, false);
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.somenteMinimoSemMaximo, true);
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.usadoPara.precoAtual, "");
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.usadoPara.precoMin, "target_min_sale_price");
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005007878787878.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005007878787878",
    linkOriginal: "https://www.aliexpress.com/item/1005007878787878.html",
    linkAfiliado: "https://s.click.aliexpress.com/e/_SHORT878",
    titulo: "Produto com faixa e preco atual bruto",
    precoAtual: "399,68",
    precoAntigo: "868,87",
    target_sale_price: "399,68",
    target_min_sale_price: "265,99",
    target_max_sale_price: "604,52",
    target_original_price: "868,87",
    imagem: "https://ae01.alicdn.com/faixa-com-atual.jpg",
    categoriaProduto: "Eletronicos"
  }));

  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoMin, "265,99");
  assert.strictEqual(oferta.precoMax, "604,52");
  assert.strictEqual(oferta.temVariacaoPreco, true);
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.usadoPara.precoAtual, "target_sale_price");
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.temFaixaReal, true);
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005007979797979.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005007979797979",
    linkOriginal: "https://www.aliexpress.com/item/1005007979797979.html",
    linkAfiliado: "https://s.click.aliexpress.com/e/_SHORT979",
    titulo: "Produto sem campos brutos",
    precoAtual: "399,68",
    precoAntigo: "868,87",
    imagem: "https://ae01.alicdn.com/limitado.jpg",
    categoriaProduto: "Eletronicos"
  }));

  assert.strictEqual(oferta.precoAtual, "399,68");
  assert.strictEqual(oferta.precoAnterior, "868,87");
  assert.deepStrictEqual(oferta.fonteImportacao.precoAliExpress.camposBrutos, {});
  assert.strictEqual(oferta.fonteImportacao.precoAliExpress.origem, "limitada_importer_normalizado");
  assert.ok(oferta.fonteImportacao.precoAliExpress.observacao.includes("Importer atual nao preservou"));
}

{
  const chamadas = [];
  const oferta = await importarAliExpressManualV2(
    "https://www.aliexpress.com/item/1005008985393267.html",
    {
      ...criarDepsComImportador(async (url, config) => {
        chamadas.push({
          tipo: "importarAliExpressRuntime",
          temGeradorAli: typeof config.gerarLinkCurtoAliExpress === "function",
          temGeradorOptimus: typeof config.gerarLinkOptimus === "function"
        });
        const sourceValues = "https://s.click.aliexpress.com/s/pyFri10M6ltAv61YZY9TfrxiDaaFXRreuZWJMeLtD8jig1wPxn51K2eq59ds8iT5";
        const linkAli = await config.gerarLinkCurtoAliExpress(sourceValues, config.credenciais);
        const linkFinal = config.gerarLinkOptimus(linkAli, "aliexpress", { clienteId: config.clienteId });
        return {
          marketplace: "aliexpress",
          productId: "1005008985393267",
          linkOriginal: url,
          linkAfiliado: linkFinal,
          titulo: "Produto AliExpress Caso Real",
          target_sale_price: "399,68",
          target_original_price: "868,87",
          imagem: "https://ae01.alicdn.com/caso-real.jpg",
          categoriaProduto: "Eletronicos"
        };
      }, chamadas),
      gerarLinkCurtoAliExpress: async () => "https://s.click.aliexpress.com/s/pyAfiliadoReal",
      gerarLinkOptimus: (link) => `https://go.optimuspromo.com.br/r/aliexpress?url=${encodeURIComponent(link)}`
    }
  );

  assert.strictEqual(
    oferta.urlAfiliada,
    "https://go.optimuspromo.com.br/r/aliexpress?url=https%3A%2F%2Fs.click.aliexpress.com%2Fs%2FpyAfiliadoReal"
  );
  assert.strictEqual(oferta.fonteImportacao.linkAfiliadoAliExpress.deeplinkGerado, true);
  assert.strictEqual(oferta.fonteImportacao.linkAfiliadoAliExpress.sourceValuesUsado, "informado_ao_gerador");
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("urlAfiliada"));
  assert.deepStrictEqual(chamadas, [
    {
      tipo: "getIntegracaoCliente",
      clienteId: "cliente_aliexpress",
      marketplace: "aliexpress"
    },
    {
      tipo: "importarAliExpressRuntime",
      temGeradorAli: true,
      temGeradorOptimus: true
    }
  ]);
}

{
  const oferta = await importarAliExpressManualV2(
    "https://www.aliexpress.com/item/1005008985393268.html",
    {
      ...criarDepsComImportador(async (url, config) => {
        const linkAli = await config.gerarLinkCurtoAliExpress(url, config.credenciais);
        const linkFinal = config.gerarLinkOptimus(linkAli, "aliexpress", { clienteId: config.clienteId });
        return {
          marketplace: "aliexpress",
          productId: "1005008985393268",
          linkOriginal: url,
          linkAfiliado: linkFinal,
          titulo: "Produto com retorno nao afiliado",
          target_sale_price: "99,90",
          imagem: "https://ae01.alicdn.com/retorno-nao-afiliado.jpg",
          categoriaProduto: "Eletronicos"
        };
      }),
      gerarLinkCurtoAliExpress: async () => "https://example.com/link-diferente",
      gerarLinkOptimus: (link) => `https://go.optimuspromo.com.br/r/aliexpress?url=${encodeURIComponent(link)}`
    }
  );

  assert.strictEqual(oferta.urlAfiliada, "");
  assert.strictEqual(oferta.fonteImportacao.linkAfiliadoAliExpress.deeplinkGerado, false);
  assert.ok(oferta.fonteImportacao.avisos.includes("url_afiliada_ignorada_sem_shortlink_confirmado"));
}

{
  const oferta = await importarAliExpressManualV2(
    "https://www.aliexpress.com/item/1005008888888888.html",
    criarDeps({
      marketplace: "aliexpress",
      productId: "1005008888888888",
      linkOriginal: "https://www.aliexpress.com/item/1005008888888888.html",
      linkAfiliado: "https://www.aliexpress.com/item/1005008888888888.html",
      titulo: "Produto sem prova afiliada",
      target_sale_price: "99,90",
      imagem: "https://ae01.alicdn.com/sem-prova.jpg",
      categoriaProduto: "Eletronicos"
    })
  );

  assert.strictEqual(oferta.urlAfiliada, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("url_afiliada_ignorada_sem_shortlink_confirmado"));
}

{
  const arquivoManual = getClienteJsonPath("cliente_aliexpress", "manual_ofertas_v2.json");
  const arquivoFila = getClienteJsonPath("cliente_aliexpress", "fila.json");
  assert.strictEqual(fs.existsSync(arquivoManual), false, "adapter parse-only nao salva oferta manual");
  assert.strictEqual(fs.existsSync(arquivoFila), false, "adapter parse-only nao escreve fila");
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "adapters", "aliexpress.manual.adapter.js"),
    "utf8"
  );
  const proibidos = [
    "utils/fila-ofertas",
    "processarFila",
    "prepararOfertaGlobal",
    "adicionarOfertaInicioFila",
    "Distributor",
    "Engine",
    "Oferta Universal",
    "oferta-universal",
    "inteligencia-universal",
    "memoria-ofertas",
    "radar-ofertas",
    "/fila",
    "/enviar-manual",
    "manual-offers.storage",
    "registrarRadarCupons",
    "contextoEngine",
    "contextoRadar"
  ];

  for (const termo of proibidos) {
    assert.ok(!fonte.includes(termo), `Adapter AliExpress Manual V2 nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-import-aliexpress.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
