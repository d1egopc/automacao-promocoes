const assert = require("assert");

const { classificarLinksComerciais } = require("../modules/radar/links-comerciais");
const { resumoLinksClassificados } = require("../modules/engine/link-role.service");
const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
const { gerarTemplateUniversal } = require("../modules/template-universal");

function urls(texto) {
  return [...String(texto || "").matchAll(/https?:\/\/\S+/gi)].map(match => match[0]);
}

function linksRows(texto, marketplace = "") {
  return urls(texto).map((url, indice) => ({
    url_original: url,
    ordemCaptura: indice + 1,
    ocorrenciaId: `${marketplace || "link"}:${indice + 1}`
  }));
}

function papelPorUrl(resultado = {}, trecho = "") {
  return (resultado.metadata?.linksClassificados || []).find(item => String(item.urlOriginal || "").includes(trecho));
}

async function importarAliFixture({ titulo, texto, principal = "1005001111111111", secundario = "1005002222222222" }) {
  const chamadas = [];
  const resultado = await importarAliExpressEngine({
    job: { id: titulo.length, evento_id: titulo.length + 1000, cliente_id: "workspace_links_v2", marketplace: "aliexpress" },
    evento: { texto_original: texto, links_extraidos: urls(texto), marketplace: "aliexpress" },
    links: linksRows(texto, "ali"),
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "tracking" } }),
      importarAliExpress: async (url, config = {}) => {
        chamadas.push({ url, papel: config.contextoEngine?.papelLink || "" });
        const secundaria = /tpm/i.test(url);
        const papel = config.contextoEngine?.papelLink || "";
        const sufixo = papel === "link_pc" ? "pc" : "app";
        const id = secundaria ? secundario : principal;
        return {
          marketplace: "aliexpress",
          titulo,
          productId: id,
          precoAtual: "99.90",
          precoOriginal: "199.90",
          linkOriginal: url,
          linkExpandido: `https://www.aliexpress.com/item/${id}.html`,
          linkAfiliado: `https://s.click.aliexpress.com/e/_${titulo.replace(/[^a-z0-9]+/gi, "")}_${sufixo}`,
          tipoLinkAfiliado: papel,
          papelLink: papel,
          imagem: "https://ae01.alicdn.com/produto.jpg",
          categoria: "Eletronicos",
          metadata: { papelLink: papel, productId: id }
        };
      }
    }
  });

  return { resultado, chamadas };
}

async function testarAliExpress() {
  const fixtures = [
    {
      titulo: "MCHOSE V9 Pro",
      texto: "MCHOSE V9 Pro\nLink APP:\nhttps://a.aliexpress.com/_mchoseApp\nLink PC:\nhttps://a.aliexpress.com/_mchosePc"
    },
    {
      titulo: "Qiyida X99",
      texto: "Qiyida X99\nno APP\nhttps://a.aliexpress.com/_qiyidaApp\nNO PC\nhttps://a.aliexpress.com/_qiyidaPc"
    },
    {
      titulo: "Fosi Audio",
      texto: "Fosi Audio\nLink com moedas\nhttps://a.aliexpress.com/_fosiApp\nLink para PC\nhttps://a.aliexpress.com/_fosiPc"
    },
    {
      titulo: "Controle Sem Fio Gamesir T4 Nova Lite, Hall Effect",
      texto: "Controle Sem Fio Gamesir T4 Nova Lite, Hall Effect\nLink APP\nhttps://a.aliexpress.com/_gamesirApp\nLink PC\nhttps://a.aliexpress.com/_gamesirPc"
    },
    {
      titulo: "SSD Kootion",
      texto: "SSD Kootion\nNO APP\nhttps://a.aliexpress.com/_kootionApp\nno pc\nhttps://a.aliexpress.com/_kootionPc"
    },
    {
      titulo: "Netac",
      texto: "Netac\nLink App\nhttps://a.aliexpress.com/_netacApp\nLink para PC\nhttps://a.aliexpress.com/_netacPc"
    },
    {
      titulo: "Console RX6H com dominio s.click.aliexpress.com",
      texto: "Console RX6H\nLink APP\nhttps://s.click.aliexpress.com/e/_rx6hApp\nNO PC\nhttps://s.click.aliexpress.com/e/_rx6hPc"
    },
    {
      titulo: "Air Cooler AG400",
      texto: "Air Cooler AG400\nno APP\nhttps://a.aliexpress.com/_ag400App\nNO PC\nhttps://a.aliexpress.com/_ag400Pc"
    },
    {
      titulo: "Jungle Leopard",
      texto: "Jungle Leopard\nLink APP\nhttps://a.aliexpress.com/_jungleApp\nLink PC\nhttps://a.aliexpress.com/_junglePc"
    }
  ];

  for (const fixture of fixtures) {
    const radar = classificarLinksComerciais({ texto: fixture.texto, marketplace: "aliexpress" });
    assert.deepStrictEqual(radar.classificados.map(item => item.tipo), ["app", "pc"], `${fixture.titulo} deve preservar APP + PC no Radar`);

    const engine = resumoLinksClassificados(linksRows(fixture.texto, "ali"), { texto_original: fixture.texto, links_extraidos: urls(fixture.texto) }, "aliexpress");
    assert.deepStrictEqual(engine.map(item => item.papelLink), ["link_app", "link_pc"], `${fixture.titulo} deve preservar link_app + link_pc no Engine`);

    const { resultado } = await importarAliFixture(fixture);
    assert.strictEqual(resultado.ok, true, `${fixture.titulo} deve importar`);
    const app = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
    const pc = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
    assert.ok(app?.renderizavel, `${fixture.titulo} APP deve renderizar`);
    assert.ok(pc?.renderizavel, `${fixture.titulo} PC deve renderizar`);
    assert.notStrictEqual(app.urlAfiliada, pc.urlAfiliada, `${fixture.titulo} APP e PC precisam de redirects distintos por papel`);
  }

  const machinist = [
    "MACHINIST X99",
    "https://a.aliexpress.com/_machinistApp",
    "⬇️ NO PC",
    "https://a.aliexpress.com/_machinistPc",
    "Módulo TPM 2.0",
    "APP:",
    "https://a.aliexpress.com/_tpmApp",
    "PC:",
    "https://a.aliexpress.com/_tpmPc"
  ].join("\n");
  const { resultado: resultadoMachinist } = await importarAliFixture({ titulo: "MACHINIST X99", texto: machinist });
  assert.strictEqual(papelPorUrl(resultadoMachinist, "machinistApp").papelLink, "link_app");
  assert.strictEqual(papelPorUrl(resultadoMachinist, "machinistPc").papelLink, "link_pc");
  assert.strictEqual(papelPorUrl(resultadoMachinist, "tpmApp").renderizavel, false, "produto secundario APP nao pode contaminar produto principal");
  assert.strictEqual(papelPorUrl(resultadoMachinist, "tpmPc").renderizavel, false, "produto secundario PC nao pode contaminar produto principal");

  const machenike = [
    "Machenike G3",
    "APP:",
    "https://a.aliexpress.com/_machenikeApp",
    "APP:",
    "https://a.aliexpress.com/_machenikeApp",
    "PC:",
    "https://a.aliexpress.com/_machenikePc"
  ].join("\n");
  const { resultado: resultadoMachenike } = await importarAliFixture({ titulo: "Machenike G3", texto: machenike });
  assert.strictEqual(resultadoMachenike.metadata.linksClassificados.filter(item => item.papelLink === "link_app").length, 1, "APP repetido deve deduplicar por URL");
  assert.strictEqual(resultadoMachenike.metadata.linksClassificados.filter(item => item.papelLink === "link_pc").length, 1, "PC deve permanecer como papel distinto");
}

async function importarShopeeFixture(titulo) {
  const slug = titulo.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  const resgate = `https://s.shopee.com.br/${slug}Resgate`;
  const produto = `https://s.shopee.com.br/${slug}Produto`;
  const texto = [
    titulo,
    "Resgate todos os cupons desta página",
    resgate,
    "Link do produto",
    produto
  ].join("\n");
  const afiliadoProduto = `https://s.shopee.com.br/${slug}ProdutoAfiliado`;
  const afiliadoResgate = `https://s.shopee.com.br/${slug}ResgateAfiliado`;
  const resultado = await importarShopeeEngine({
    job: { id: slug.length, evento_id: slug.length + 2000, cliente_id: "workspace_links_v2" },
    evento: { texto_original: texto, links_extraidos: urls(texto), marketplace: "shopee" },
    links: [
      { url_original: resgate, url_expandida: "https://shopee.com.br/m/cupom-de-desconto", ordemCaptura: 1, ocorrenciaId: `${slug}:resgate` },
      { url_original: produto, url_expandida: "https://shopee.com.br/product/111/222", ordemCaptura: 2, ocorrenciaId: `${slug}:produto` }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      gerarShortLinkShopee: async () => ({ ok: true, shortLink: afiliadoResgate }),
      expandirShortlinkShopee: async () => "https://shopee.com.br/m/cupom-de-desconto",
      importarShopee: async (url) => {
        assert.strictEqual(url, produto, `${titulo}: resgate nunca deve substituir produto no importador`);
        return {
          ok: true,
          titulo,
          precoAtual: "1524.00",
          preco: "1524.00",
          imagem: "https://cf.shopee.com.br/produto.jpg",
          linkAfiliado: afiliadoProduto,
          linkFinal: afiliadoProduto,
          link: afiliadoProduto,
          linkOriginal: produto,
          linkExpandido: "https://shopee.com.br/product/111/222",
          shopId: "111",
          itemId: "222",
          categoria: "Audio TV"
        };
      }
    }
  });

  return { resultado, afiliadoProduto, afiliadoResgate };
}

async function testarShopee() {
  for (const titulo of [
    "Smart TV Philco",
    "Principia",
    "Heineken",
    "Creamy",
    "Mondial"
  ]) {
    const { resultado, afiliadoProduto, afiliadoResgate } = await importarShopeeFixture(titulo);
    assert.strictEqual(resultado.ok, true, `${titulo} deve importar`);
    assert.deepStrictEqual(resultado.linksComerciais.map(item => item.tipo), ["resgate", "produto"], `${titulo} deve preservar Resgate + Produto`);
    assert.strictEqual(resultado.linksComerciais.find(item => item.tipo === "produto").urlAfiliadaWorkspace, afiliadoProduto);
    assert.strictEqual(resultado.linksComerciais.find(item => item.tipo === "resgate").urlAfiliadaWorkspace, afiliadoResgate);

    const mensagem = gerarTemplateUniversal({
      ...resultado,
      linksComerciais: resultado.linksComerciais.map(item => ({
        ...item,
        urlOptimus: item.tipo === "produto"
          ? "https://go.optimuspromo.com.br/r/produto"
          : "https://go.optimuspromo.com.br/r/resgate"
      }))
    });
    assert.ok(mensagem.includes("🛒 *Produto:*\nhttps://go.optimuspromo.com.br/r/produto"), `${titulo} deve renderizar Produto como CTA principal`);
    assert.ok(mensagem.includes("🎟️ *Resgatar cupom:*\nhttps://go.optimuspromo.com.br/r/resgate"), `${titulo} deve renderizar Resgate como beneficio`);
  }
}

(async () => {
  await testarAliExpress();
  await testarShopee();
  console.log("links-comerciais-v2-aliexpress-shopee.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
