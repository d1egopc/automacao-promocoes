const assert = require("assert");

const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
const {
  construirEspelhoComercialV24,
  montarTemplateEspelhoShadow
} = require("../modules/ofc-v2/espelho-comercial");

function integracao() {
  return {
    credenciais: {
      appKey: "app_key_teste",
      secret: "secret_teste",
      trackingId: "tracking_teste"
    }
  };
}

async function testarPrecoRadarVenceApiELinkMoedasConverte() {
  const app = "https://a.aliexpress.com/_appMoedas";
  const pc = "https://a.aliexpress.com/_pcCanonico";
  const appAfiliado = "https://s.click.aliexpress.com/e/_APPWORKSPACE";
  const pcAfiliado = "https://s.click.aliexpress.com/e/_PCWORKSPACE";

  const resultado = await importarAliExpressEngine({
    job: {
      id: 10,
      evento_id: 20,
      cliente_id: "cliente_ali",
      marketplace: "aliexpress"
    },
    evento: {
      texto_original: [
        "Produto AliExpress com moedas",
        "Preço anunciado: R$ 83 + 678 moedas",
        `Link com moedas: ${app}`,
        `Pelo PC: ${pc}`
      ].join("\n")
    },
    links: [
      { url_original: app, metadata: { papelLink: "link_moedas", papelLinkMotivo: "teste_moedas" } },
      { url_original: pc, metadata: { papelLink: "link_pc", papelLinkMotivo: "teste_pc" } }
    ],
    deps: {
      getIntegracaoCliente: () => integracao(),
      importarAliExpress: async (url, config = {}) => {
        if (url === pc) {
          return {
            marketplace: "aliexpress",
            titulo: "Produto AliExpress com moedas",
            productId: "1005001111111111",
            precoAtual: "140,66",
            precoOriginal: "199,90",
            linkOriginal: pc,
            linkAfiliado: pcAfiliado,
            imagem: "https://ae01.alicdn.com/produto.jpg",
            categoria: "Eletronicos",
            metadata: { papelLink: config.contextoEngine?.papelLink || "" }
          };
        }
        if (url === app) {
          return {
            marketplace: "aliexpress",
            titulo: "Produto AliExpress",
            precoAtual: "",
            linkOriginal: app,
            linkAfiliado: appAfiliado,
            tipoLinkAfiliado: "link_moedas",
            papelLink: "link_moedas",
            metadata: {
              papelLink: "link_moedas",
              conversaoPapel: "link_moedas",
              conversaoLinkAlternativo: true
            }
          };
        }
        throw new Error(`url inesperada: ${url}`);
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.preco, 83, "preco efetivo deve vir do Radar");
  assert.strictEqual(resultado.precoOrigem, "texto_radar");
  assert.strictEqual(resultado.metadata.precoReferenciaApi, 140.66);
  assert.strictEqual(resultado.metadata.precoAuditoria.precoRadar, 83);
  assert.strictEqual(resultado.metadata.precoAuditoria.precoApi, 140.66);
  assert.strictEqual(resultado.cupom, "", "palavra Produto nao deve virar cupom");

  const linkMoedas = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
  const linkPc = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");

  assert.strictEqual(linkMoedas.renderizavel, true, "link com moedas deve renderizar como APP");
  assert.strictEqual(linkMoedas.urlAfiliada, appAfiliado);
  assert.strictEqual(linkPc.renderizavel, true, "PC convertido deve renderizar");
  assert.strictEqual(linkPc.urlAfiliada, pcAfiliado);
  assert.notStrictEqual(linkMoedas.urlAfiliada, linkPc.urlAfiliada);
}

function testarEspelhoUsaAfiliadaENaoOriginal() {
  const appOriginal = "https://a.aliexpress.com/_appOriginal";
  const pcOriginal = "https://a.aliexpress.com/_pcOriginal";
  const appAfiliado = "https://s.click.aliexpress.com/e/_APPFINAL";
  const pcAfiliado = "https://s.click.aliexpress.com/e/_PCFINAL";

  const resultado = construirEspelhoComercialV24({
    oferta: {
      marketplace: "aliexpress",
      titulo: "Produto AliExpress com moedas",
      preco: 83,
      precoAtual: 83,
      linkAfiliado: pcAfiliado,
      linksComerciais: [
        { tipo: "moedas", url: appOriginal, urlAfiliada: appAfiliado, renderizavel: true, convertidoWorkspace: true },
        { tipo: "pc", url: pcOriginal, urlAfiliada: pcAfiliado, renderizavel: true, convertidoWorkspace: true },
        { tipo: "app", url: "https://linktr.ee/oferta-insegura", renderizavel: false }
      ]
    },
    ofertaEntrada: {},
    job: { id: 1, cliente_id: "cliente_ali", marketplace: "aliexpress" },
    evento: {
      texto_original: [
        "Produto AliExpress com moedas",
        "Por R$ 83",
        "Cupom: IFPZKUPM ou BRAE1",
        "+ 678 moedas no APP",
        `Link com moedas: ${appOriginal}`,
        `Pelo PC: ${pcOriginal}`
      ].join("\n")
    },
    metadata: {},
    comercialNormalizado: { marketplace: "aliexpress", precoAtual: 83, precoConfiavel: true }
  });

  assert.strictEqual(resultado.ok, true);
  const links = resultado.documentoComercialCanonico.linksComerciais;
  assert.ok(links.some(item => item.tipo === "moedas" && item.url === appAfiliado), "APP/moedas deve usar URL afiliada");
  assert.ok(links.some(item => item.tipo === "pc" && item.url === pcAfiliado), "PC deve usar URL afiliada");
  assert.ok(!links.some(item => (item.url === appOriginal || item.url === pcOriginal) && item.renderizavel !== false), "URL original capturada nao deve virar CTA");

  const mensagem = resultado.templateEspelhoShadow.mensagem;
  assert.ok(mensagem.includes(appAfiliado), "renderer deve renderizar afiliada APP/moedas");
  assert.ok(mensagem.includes(pcAfiliado), "renderer deve renderizar afiliada PC");
  assert.ok(!mensagem.includes(appOriginal), "renderer nao deve renderizar original APP/moedas");
  assert.ok(!mensagem.includes("linktr.ee"), "link externo inseguro nao deve renderizar");
}

function testarMesmoLinkAppPcNaoDuplica() {
  const urlAfiliada = "https://s.click.aliexpress.com/e/_MESMO";
  const documento = {
    marketplace: "aliexpress",
    tituloOriginal: "Produto AliExpress",
    precoPorTexto: "R$ 83",
    linkAfiliado: urlAfiliada,
    linksComerciais: [
      { tipo: "app", papel: "link_app", url: urlAfiliada, renderizavel: true },
      { tipo: "pc", papel: "link_pc", url: urlAfiliada, renderizavel: true }
    ],
    blocos: [
      { tipo: "titulo", textoOriginal: "Produto AliExpress", ordemSugerida: 10, essencial: true },
      { tipo: "preco_oferta", textoOriginal: "R$ 83", ordemSugerida: 20, essencial: true },
      { tipo: "link_app", textoOriginal: urlAfiliada, ordemSugerida: 30, essencial: true },
      { tipo: "link_pc", textoOriginal: urlAfiliada, ordemSugerida: 40, essencial: true }
    ]
  };

  const render = montarTemplateEspelhoShadow({ documentoComercialCanonico: documento }, documento);
  const ocorrencias = render.mensagem.split(urlAfiliada).length - 1;

  assert.strictEqual(render.ok, true);
  assert.strictEqual(ocorrencias, 2, "mesma URL APP/PC preserva duas ocorrencias comerciais");
  assert.ok(render.mensagem.includes("PC:"), "PC canonico deve permanecer");
}

async function testarProdutoDuplicadoReutilizaConversaoEPreservaOcorrencias() {
  const produto = "https://www.aliexpress.com/item/1005001111111111.html";
  const afiliado = "https://s.click.aliexpress.com/e/_PRODUTOD1";
  const chamadas = [];

  const resultado = await importarAliExpressEngine({
    job: { id: 30, evento_id: 40, cliente_id: "cliente_ali", marketplace: "aliexpress" },
    evento: {
      texto_original: [
        "Produto AliExpress duplicado",
        "Por R$ 99",
        `Produto: ${produto}`,
        `Produto: ${produto}`
      ].join("\n")
    },
    links: [
      { url_original: produto, metadata: { papelLink: "produto", papelLinkMotivo: "produto_1" } },
      { url_original: produto, metadata: { papelLink: "produto", papelLinkMotivo: "produto_2" } }
    ],
    deps: {
      getIntegracaoCliente: () => integracao(),
      importarAliExpress: async (url) => {
        chamadas.push(url);
        return {
          marketplace: "aliexpress",
          titulo: "Produto AliExpress duplicado",
          productId: "1005001111111111",
          precoAtual: "99.00",
          linkOriginal: url,
          linkAfiliado: afiliado,
          imagem: "https://ae01.alicdn.com/produto.jpg"
        };
      }
    }
  });

  const produtos = resultado.metadata.linksClassificados.filter(item => item.papelLink === "produto");
  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadas, [produto], "duplicado reutiliza a conversao tecnica do produto principal");
  assert.strictEqual(produtos.length, 2);
  assert.ok(produtos.every(item => item.renderizavel === true));
  assert.deepStrictEqual(produtos.map(item => item.urlAfiliada), [afiliado, afiliado]);
  assert.deepStrictEqual(produtos.map(item => item.conversaoStatus), ["convertida", "convertida"]);
}

async function testarAppDuplicadoReutilizaConversaoEPreservaOcorrencias() {
  const app = "https://a.aliexpress.com/_appDuplicado";
  const pc = "https://a.aliexpress.com/_pcCanonicoDuplicado";
  const appAfiliado = "https://s.click.aliexpress.com/e/_APPDUPD1";
  const pcAfiliado = "https://s.click.aliexpress.com/e/_PCDUPD1";
  const chamadas = [];

  const resultado = await importarAliExpressEngine({
    job: { id: 31, evento_id: 41, cliente_id: "cliente_ali", marketplace: "aliexpress" },
    evento: {
      texto_original: [
        "Produto AliExpress APP duplicado",
        "Por R$ 120",
        `APP: ${app}`,
        `APP: ${app}`,
        `PC: ${pc}`
      ].join("\n")
    },
    links: [
      { url_original: app, metadata: { papelLink: "link_app", papelLinkMotivo: "app_1" } },
      { url_original: app, metadata: { papelLink: "link_app", papelLinkMotivo: "app_2" } },
      { url_original: pc, metadata: { papelLink: "link_pc", papelLinkMotivo: "pc" } }
    ],
    deps: {
      getIntegracaoCliente: () => integracao(),
      importarAliExpress: async (url, config = {}) => {
        chamadas.push(url);
        return {
          marketplace: "aliexpress",
          titulo: "Produto AliExpress APP duplicado",
          productId: "1005002222222222",
          precoAtual: "120.00",
          linkOriginal: url,
          linkExpandido: "https://www.aliexpress.com/item/1005002222222222.html",
          linkAfiliado: url === pc ? pcAfiliado : appAfiliado,
          papelLink: config.contextoEngine?.papelLink || "",
          metadata: { papelLink: config.contextoEngine?.papelLink || "" }
        };
      }
    }
  });

  const apps = resultado.metadata.linksClassificados.filter(item => item.papelLink === "link_app");
  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadas, [pc, app], "APP duplicado chama a conversao alternativa uma vez e replica o resultado");
  assert.strictEqual(apps.length, 1);
  assert.deepStrictEqual(apps.map(item => item.urlAfiliada), [appAfiliado]);
  assert.ok(apps.every(item => item.renderizavel === true));
}

async function testarProdutosDistintosNaoUsamAfiliadoGlobal() {
  const produtoA = "https://www.aliexpress.com/item/1005003333333333.html";
  const produtoB = "https://www.aliexpress.com/item/1005004444444444.html";
  const afiliadoA = "https://s.click.aliexpress.com/e/_PRODUTOA";
  const afiliadoB = "https://s.click.aliexpress.com/e/_PRODUTOB";
  const chamadas = [];

  const resultado = await importarAliExpressEngine({
    job: { id: 32, evento_id: 42, cliente_id: "cliente_ali", marketplace: "aliexpress" },
    evento: {
      texto_original: [
        "Dois produtos AliExpress",
        "Por R$ 88",
        `Produto: ${produtoA}`,
        `Produto: ${produtoB}`
      ].join("\n")
    },
    links: [
      { url_original: produtoA, metadata: { papelLink: "produto", papelLinkMotivo: "produto_a" } },
      { url_original: produtoB, metadata: { papelLink: "produto", papelLinkMotivo: "produto_b" } }
    ],
    deps: {
      getIntegracaoCliente: () => integracao(),
      importarAliExpress: async (url) => {
        chamadas.push(url);
        return {
          marketplace: "aliexpress",
          titulo: "Dois produtos AliExpress",
          productId: url === produtoA ? "1005003333333333" : "1005004444444444",
          precoAtual: "88.00",
          linkOriginal: url,
          linkAfiliado: url === produtoA ? afiliadoA : afiliadoB
        };
      }
    }
  });

  const produtos = resultado.metadata.linksClassificados.filter(item => item.papelLink === "produto");
  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadas, [produtoA, produtoB], "produto distinto exige conversao propria");
  assert.deepStrictEqual(produtos.map(item => item.urlAfiliada), [afiliadoA, afiliadoB]);
}

async function testarFalhaConversaoMantemOcorrenciaAuditavel() {
  const produtoA = "https://www.aliexpress.com/item/1005005555555555.html";
  const produtoB = "https://www.aliexpress.com/item/1005006666666666.html";
  const afiliadoA = "https://s.click.aliexpress.com/e/_PRODUTOOK";

  const resultado = await importarAliExpressEngine({
    job: { id: 33, evento_id: 43, cliente_id: "cliente_ali", marketplace: "aliexpress" },
    evento: {
      texto_original: [
        "Produto AliExpress com falha de conversao",
        "Por R$ 77",
        `Produto: ${produtoA}`,
        `Produto: ${produtoB}`
      ].join("\n")
    },
    links: [
      { url_original: produtoA, metadata: { papelLink: "produto", papelLinkMotivo: "produto_ok" } },
      { url_original: produtoB, metadata: { papelLink: "produto", papelLinkMotivo: "produto_falha" } }
    ],
    deps: {
      getIntegracaoCliente: () => integracao(),
      importarAliExpress: async (url) => {
        if (url === produtoB) throw new Error("falha simulada");
        return {
          marketplace: "aliexpress",
          titulo: "Produto AliExpress com falha de conversao",
          productId: "1005005555555555",
          precoAtual: "77.00",
          linkOriginal: url,
          linkAfiliado: afiliadoA
        };
      }
    }
  });

  const produtos = resultado.metadata.linksClassificados.filter(item => item.papelLink === "produto");
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(produtos.length, 2);
  assert.strictEqual(produtos[0].renderizavel, true);
  assert.strictEqual(produtos[1].renderizavel, false);
  assert.strictEqual(produtos[1].urlAfiliada, "");
  assert.strictEqual(produtos[1].conversaoStatus, "falhou");
  assert.strictEqual(produtos[1].motivoConversao, "falha_tecnica_conversao_link");
}

(async () => {
  await testarPrecoRadarVenceApiELinkMoedasConverte();
  testarEspelhoUsaAfiliadaENaoOriginal();
  testarMesmoLinkAppPcNaoDuplica();
  await testarProdutoDuplicadoReutilizaConversaoEPreservaOcorrencias();
  await testarAppDuplicadoReutilizaConversaoEPreservaOcorrencias();
  await testarProdutosDistintosNaoUsamAfiliadoGlobal();
  await testarFalhaConversaoMantemOcorrenciaAuditavel();
  console.log("aliexpress-app-moedas-contrato.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
