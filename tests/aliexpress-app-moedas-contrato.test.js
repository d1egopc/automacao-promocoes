const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
const {
  construirEspelhoComercialV24,
  montarTemplateEspelhoShadow
} = require("../modules/ofc-v2/espelho-comercial");
const {
  montarOfertaUniversalEngine,
  validarContratoOfertaUniversal
} = require("../modules/engine/oferta-universal.contract");
const {
  criarProvaAfiliacaoWorkspaceAliExpress,
  validarProvaAfiliacaoWorkspaceAliExpress
} = require("../modules/marketplaces/aliexpress/afiliacao-workspace");
const {
  importarAliExpress
} = require("../marketplaces/aliexpress/importar");

function integracao() {
  return {
    credenciais: {
      appKey: "app_key_teste",
      secret: "secret_teste",
      trackingId: "tracking_teste"
    }
  };
}

function metadataAfiliacao(papelLink, urlAfiliada, extras = {}) {
  const credenciais = integracao().credenciais;
  return {
    ...extras,
    papelLink,
    afiliacaoWorkspace: {
      workspaceId: "cliente_ali",
      appKey: credenciais.appKey,
      trackingIdEnviado: credenciais.trackingId,
      origemConversao: "workspace_api",
      conversaoStatus: "convertida",
      urlAfiliadaWorkspace: urlAfiliada,
      motivoConversao: "fixture_convertida"
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
            metadata: metadataAfiliacao(config.contextoEngine?.papelLink || "", pcAfiliado)
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
            metadata: metadataAfiliacao("link_moedas", appAfiliado, {
              conversaoPapel: "link_moedas",
              conversaoLinkAlternativo: true
            })
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
          imagem: "https://ae01.alicdn.com/produto.jpg",
          metadata: metadataAfiliacao("produto", afiliado)
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
          metadata: metadataAfiliacao(
            config.contextoEngine?.papelLink || "",
            url === pc ? pcAfiliado : appAfiliado
          )
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
          linkAfiliado: url === produtoA ? afiliadoA : afiliadoB,
          metadata: metadataAfiliacao("produto", url === produtoA ? afiliadoA : afiliadoB)
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
          linkAfiliado: afiliadoA,
          metadata: metadataAfiliacao("produto", afiliadoA)
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

async function testarApiSemCanonicoPreservaAppPcConvertidosDoRadar() {
  const app = "https://a.aliexpress.com/_appRadarSeguro";
  const pc = "https://a.aliexpress.com/_pcRadarSeguro";
  const appAfiliado = "https://s.click.aliexpress.com/e/_APPRESGATE";
  const pcAfiliado = "https://s.click.aliexpress.com/e/_PCRESGATE";

  const resultado = await importarAliExpressEngine({
    job: { id: 181769, evento_id: 181769, cliente_id: "cliente_ali", marketplace: "aliexpress" },
    evento: {
      texto_original: [
        "(Parcelado) Processador AMD Ryzen 7 9700X Novo",
        "Por R$ 1.345",
        "Cupom: LIBRETX9700X ou ISKANDAR6",
        `Link APP: ${app}`,
        `Link PC: ${pc}`
      ].join("\n")
    },
    links: [
      { url_original: app, metadata: { papelLink: "link_app", papelLinkMotivo: "contexto_link_app_aliexpress" } },
      { url_original: pc, metadata: { papelLink: "link_pc", papelLinkMotivo: "contexto_link_pc_aliexpress" } }
    ],
    deps: {
      getIntegracaoCliente: () => integracao(),
      importarAliExpress: async (url, config = {}) => ({
        marketplace: "aliexpress",
        titulo: "Produto AliExpress",
        precoAtual: "",
        linkOriginal: url,
        linkAfiliado: url === app ? appAfiliado : pcAfiliado,
        imagem: "",
        aviso: "Erro ao consultar API AliExpress",
        erroTecnico: "aliexpress_manual_fallback_generico",
        papelLink: config.contextoEngine?.papelLink || "",
        metadata: metadataAfiliacao(config.contextoEngine?.papelLink || "", url === app ? appAfiliado : pcAfiliado, {
          conversaoPapel: config.contextoEngine?.papelLink || "",
          conversaoLinkAlternativo: true
        })
      })
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.preco, 1345);

  const appConvertido = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
  const pcConvertido = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");

  assert.strictEqual(appConvertido.renderizavel, true);
  assert.strictEqual(appConvertido.urlAfiliada, appAfiliado);
  assert.strictEqual(appConvertido.motivoConversao, "cta_app_workspace_convertido_sem_api_canonica");
  assert.strictEqual(pcConvertido.renderizavel, true);
  assert.strictEqual(pcConvertido.urlAfiliada, pcAfiliado);
  assert.strictEqual(pcConvertido.motivoConversao, "cta_pc_workspace_convertido_sem_api_canonica");
}

async function testarResgateConservadorNaoFabricaPcQuandoRadarTrouxeSoApp() {
  const app = "https://a.aliexpress.com/_appUnico";
  const appAfiliado = "https://s.click.aliexpress.com/e/_APPUNICO";

  const resultado = await importarAliExpressEngine({
    job: { id: 181903, evento_id: 181903, cliente_id: "cliente_ali", marketplace: "aliexpress" },
    evento: {
      texto_original: [
        "Xeon E5 2690v4 X99 Processador CPU 2690 v4",
        "Por R$ 96",
        "Cupom: ISKANDAR1 ou BRGM1",
        `Link APP: ${app}`
      ].join("\n")
    },
    links: [
      { url_original: app, metadata: { papelLink: "link_app", papelLinkMotivo: "contexto_link_app_aliexpress" } }
    ],
    deps: {
      getIntegracaoCliente: () => integracao(),
      importarAliExpress: async (url, config = {}) => ({
        marketplace: "aliexpress",
        titulo: "Produto AliExpress",
        precoAtual: "",
        linkOriginal: url,
        linkAfiliado: appAfiliado,
        imagem: "",
        aviso: "Landing AliExpress convertida sem productId direto.",
        papelLink: config.contextoEngine?.papelLink || "",
        metadata: metadataAfiliacao(config.contextoEngine?.papelLink || "", appAfiliado, {
          conversaoPapel: config.contextoEngine?.papelLink || "",
          conversaoLinkAlternativo: true
        })
      })
    }
  });

  assert.strictEqual(resultado.ok, true);
  const links = resultado.metadata.linksClassificados.filter(item => item.renderizavel === true);
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].papelLink, "link_app");
  assert.strictEqual(links[0].urlAfiliada, appAfiliado);
  assert.ok(!resultado.metadata.linksClassificados.some(item => item.papelLink === "link_pc"));
}

async function testarFixtures8BitDoPreservamContratoComercialPorWorkspace() {
  const produtoId = "1005011559438577";
  const titulo = "Controle 8BitDo Ultimate 2C, Analógicos Hall Effect, Sem Fio";
  const imagem = "https://ae01.alicdn.com/kf/8bitdo-ultimate-2c.jpg";
  const categoria = "Games e Acessórios";
  const fixtures = [
    {
      eventoId: 141428,
      jobId: 661858,
      workspaceId: "workspace_8bitdo_a",
      precoRadar: 129,
      moedas: 25,
      app: "https://a.aliexpress.com/_c3i0kXx5",
      pc: "https://a.aliexpress.com/_c4E58VUP"
    },
    {
      eventoId: 141430,
      jobId: 661872,
      workspaceId: "workspace_8bitdo_b",
      precoRadar: 126,
      moedas: 24,
      app: "https://a.aliexpress.com/_c3MhiHLv",
      pc: "https://a.aliexpress.com/_c3X8TGoP"
    }
  ];
  const resultados = [];

  for (const fixture of fixtures) {
    const credenciais = {
      appKey: `app_${fixture.workspaceId}`,
      secret: `secret_${fixture.workspaceId}`,
      trackingId: `tracking_${fixture.workspaceId}`
    };
    const afiliadas = {
      link_app: `https://s.click.aliexpress.com/e/_${fixture.workspaceId}_APP`,
      link_pc: `https://s.click.aliexpress.com/e/_${fixture.workspaceId}_PC`
    };
    const chamadas = [];
    const evento = {
      id: fixture.eventoId,
      texto_original: [
        titulo,
        `R$ ${fixture.precoRadar}`,
        `Cupom: BRCD1 + ${fixture.moedas} moedas no APP`,
        fixture.app,
        "NO PC",
        fixture.pc
      ].join("\n")
    };
    const job = {
      id: fixture.jobId,
      evento_id: fixture.eventoId,
      cliente_id: fixture.workspaceId,
      marketplace: "aliexpress"
    };

    const resultado = await importarAliExpressEngine({
      job,
      evento,
      links: [
        { url_original: fixture.app, metadata: { papelLink: "link_app", papelLinkMotivo: "contexto_link_app_aliexpress" } },
        { url_original: fixture.pc, metadata: { papelLink: "link_pc", papelLinkMotivo: "contexto_link_pc_aliexpress" } }
      ],
      deps: {
        getIntegracaoCliente: (clienteId) => {
          assert.strictEqual(clienteId, fixture.workspaceId);
          return { credenciais };
        },
        importarAliExpress: async (url, config = {}) => {
          const papel = config.contextoEngine?.papelLink || "";
          assert.strictEqual(config.clienteId, fixture.workspaceId);
          chamadas.push({ url, papel, trackingId: config.credenciais?.trackingId });
          const urlAfiliada = afiliadas[papel];
          assert.ok(urlAfiliada, `papel inesperado: ${papel}`);
          return {
            marketplace: "aliexpress",
            titulo,
            productId: produtoId,
            precoAtual: "199,90",
            precoOriginal: "249,90",
            linkOriginal: url,
            linkExpandido: `https://www.aliexpress.com/item/${produtoId}.html`,
            linkAfiliado: urlAfiliada,
            imagem,
            categoria,
            papelLink: papel,
            metadata: {
              afiliacaoWorkspace: criarProvaAfiliacaoWorkspaceAliExpress({
                clienteId: fixture.workspaceId,
                credenciais,
                urlOriginal: url,
                urlAfiliadaWorkspace: urlAfiliada,
                papel,
                conversaoStatus: "convertida",
                motivoConversao: "fixture_api_workspace"
              })
            }
          };
        }
      }
    });

    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(chamadas[0].papel, "link_pc", "link PC deve abastecer o enriquecimento principal");
    assert.deepStrictEqual(new Set(chamadas.map(item => item.papel)), new Set(["link_pc", "link_app"]));
    assert.ok(chamadas.every(item => item.trackingId === credenciais.trackingId));
    assert.strictEqual(resultado.metadata.produtoCanonico.produtoId, produtoId);
    assert.strictEqual(resultado.titulo, titulo);
    assert.strictEqual(resultado.imagem, imagem);
    assert.strictEqual(resultado.imagemOrigem, "aliexpress_produto_canonico_pc");
    assert.strictEqual(resultado.categoria, categoria);
    assert.strictEqual(resultado.preco, fixture.precoRadar, "preço Radar deve vencer a referência da API");
    assert.strictEqual(resultado.precoOrigem, "texto_radar");
    assert.strictEqual(resultado.precoReferenciaApi, 199.9);
    assert.strictEqual(resultado.cupom, "BRCD1");
    assert.ok(resultado.moedasTexto.includes(String(fixture.moedas)));

    const links = resultado.metadata.linksClassificados.filter(item => ["link_app", "link_pc"].includes(item.papelLink));
    assert.strictEqual(links.length, 2);
    assert.deepStrictEqual(links.map(item => item.papelLink).sort(), ["link_app", "link_pc"]);
    assert.strictEqual(links.find(item => item.papelLink === "link_app").urlOriginal, fixture.app);
    assert.strictEqual(links.find(item => item.papelLink === "link_pc").urlOriginal, fixture.pc);
    assert.strictEqual(links.find(item => item.papelLink === "link_app").urlAfiliada, afiliadas.link_app);
    assert.strictEqual(links.find(item => item.papelLink === "link_pc").urlAfiliada, afiliadas.link_pc);
    assert.ok(links.every(item => item.conversaoWorkspace.workspaceId === fixture.workspaceId));
    assert.ok(links.every(item => item.conversaoWorkspace.trackingIdEnviado === credenciais.trackingId));

    const ofertaUniversal = montarOfertaUniversalEngine({
      oferta: resultado,
      ofertaEntrada: resultado,
      job,
      evento,
      link: { url_original: fixture.pc, url_expandida: resultado.linkExpandido },
      metadata: resultado.metadata
    });
    assert.strictEqual(validarContratoOfertaUniversal(ofertaUniversal).ok, true);
    assert.strictEqual(ofertaUniversal.produto.idExterno, produtoId);
    assert.strictEqual(ofertaUniversal.comercial.precoAtual, fixture.precoRadar);
    assert.strictEqual(ofertaUniversal.comercial.cupom, "BRCD1");
    assert.strictEqual(ofertaUniversal.midia.imagemPrincipal, imagem);
    assert.strictEqual(ofertaUniversal.produto.categoriaNormalizada, categoria);
    resultados.push({ fixture, resultado, afiliadas });
  }

  const [workspaceA, workspaceB] = resultados;
  assert.ok(workspaceA.resultado.metadata.linksClassificados.every(item =>
    !item.urlAfiliada || !Object.values(workspaceB.afiliadas).includes(item.urlAfiliada)
  ), "workspace A não pode receber link convertido do workspace B");
  assert.ok(workspaceB.resultado.metadata.linksClassificados.every(item =>
    !item.urlAfiliada || !Object.values(workspaceA.afiliadas).includes(item.urlAfiliada)
  ), "workspace B não pode receber link convertido do workspace A");
}

async function testar8BitDoAtravessaImporterRealSemDespacho() {
  const app = "https://a.aliexpress.com/_c3MhiHLv";
  const pc = "https://a.aliexpress.com/_c3X8TGoP";
  const productId = "1005011559438577";
  const credenciais = { appKey: "app_integrado", secret: "secret_integrado", trackingId: "tracking_integrado" };
  const chamadas = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opcoes = {}) => {
    const body = opcoes.body instanceof URLSearchParams
      ? opcoes.body
      : new URLSearchParams(opcoes.body || "");
    const method = body.get("method");
    chamadas.push({ url: String(url), method, sourceValues: body.get("source_values") || "" });

    if (!method) {
      return {
        ok: true,
        status: 200,
        url: `https://www.aliexpress.com/item/${productId}.html`,
        headers: { get: () => "" },
        text: async () => "",
        json: async () => ({})
      };
    }
    if (method === "aliexpress.affiliate.productdetail.get") {
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: { get: () => "" },
        text: async () => "",
        json: async () => ({
          aliexpress_affiliate_productdetail_get_response: {
            resp_result: {
              resp_code: "200",
              result: {
                products: {
                  product: {
                    product_id: productId,
                    product_title: "Controle 8BitDo Ultimate 2C",
                    target_sale_price: "199.90",
                    target_original_price: "249.90",
                    product_main_image_url: "//ae01.alicdn.com/kf/8bitdo-integrado.jpg",
                    promotion_link: `https://s.click.aliexpress.com/e/_${productId}`,
                    product_detail_url: `https://www.aliexpress.com/item/${productId}.html`,
                    first_level_category_name: "Games e Acessórios"
                  }
                }
              }
            }
          }
        })
      };
    }
    if (method === "aliexpress.affiliate.link.generate") {
      const source = body.get("source_values") || "";
      const sufixo = source === app ? "APP_INTEGRADO" : "PC_INTEGRADO";
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: { get: () => "" },
        text: async () => "",
        json: async () => ({
          aliexpress_affiliate_link_generate_response: {
            resp_result: {
              result: {
                promotion_links: {
                  promotion_link: [{ promotion_link: `https://s.click.aliexpress.com/e/_${sufixo}` }]
                }
              }
            }
          }
        })
      };
    }
    throw new Error(`método AliExpress inesperado: ${method}`);
  };

  try {
    const resultado = await importarAliExpressEngine({
      job: { id: 661872, evento_id: 141430, cliente_id: "workspace_8bitdo_integrado", marketplace: "aliexpress" },
      evento: {
        texto_original: [
          "Controle 8BitDo Ultimate 2C",
          "R$ 126",
          "Cupom: BRCD1 + 24 moedas no APP",
          app,
          "NO PC",
          pc
        ].join("\n")
      },
      links: [
        { url_original: app, metadata: { papelLink: "link_app", papelLinkMotivo: "contexto_link_app_aliexpress" } },
        { url_original: pc, metadata: { papelLink: "link_pc", papelLinkMotivo: "contexto_link_pc_aliexpress" } }
      ],
      deps: {
        getIntegracaoCliente: () => ({ credenciais }),
        importarAliExpress
      }
    });

    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.produtoId, productId);
    assert.strictEqual(resultado.titulo, "Controle 8BitDo Ultimate 2C");
    assert.strictEqual(resultado.preco, 126);
    assert.strictEqual(resultado.cupom, "BRCD1");
    assert.ok(resultado.moedasTexto.includes("24"));
    assert.strictEqual(resultado.imagem, "https://ae01.alicdn.com/kf/8bitdo-integrado.jpg");
    assert.strictEqual(resultado.categoria, "Games e Acessórios");
    const appConvertido = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
    const pcConvertido = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
    assert.strictEqual(appConvertido.urlAfiliada, "https://s.click.aliexpress.com/e/_APP_INTEGRADO");
    assert.strictEqual(pcConvertido.urlAfiliada, "https://s.click.aliexpress.com/e/_PC_INTEGRADO");
    assert.ok(chamadas.some(item => item.method === "aliexpress.affiliate.productdetail.get"));
    assert.deepStrictEqual(
      chamadas.filter(item => item.method === "aliexpress.affiliate.link.generate").map(item => item.sourceValues).sort(),
      [app, pc].sort(),
      "cada ocorrência deve ser afiliada a partir de sua própria URL capturada"
    );
  } finally {
    global.fetch = fetchOriginal;
  }
}

async function testarMouse144302HandoffPcAppSemCodigoInventado() {
  const productId = "1005012689379802";
  const app = "https://seuhardware.com/s/9MOH2U7";
  const pc = "https://seuhardware.com/s/Gfdisrw";
  const appExpandido = `https://m.aliexpress.com/p/coin-index/index.html?productIds=${productId}`;
  const pcExpandido = `https://pt.aliexpress.com/item/${productId}.html`;
  const workspaceId = "workspace_mouse_fixture";
  const credenciais = { appKey: "app_mouse_fixture", secret: "secret_mouse_fixture", trackingId: "tracking_mouse_fixture" };
  const chamadas = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opcoes = {}) => {
    const body = opcoes.body instanceof URLSearchParams
      ? opcoes.body : new URLSearchParams(opcoes.body || "");
    const method = body.get("method");
    const sourceValues = body.get("source_values") || "";
    chamadas.push({ method, sourceValues });
    if (method === "aliexpress.affiliate.productdetail.get") {
      return {
        ok: true, status: 200, url: String(url), headers: { get: () => "" },
        json: async () => ({ aliexpress_affiliate_productdetail_get_response: { resp_result: {
          resp_code: "200", result: { products: { product: {
            product_id: productId,
            product_title: "Mouse Delux M900 Pro",
            target_sale_price: "199.90",
            product_main_image_url: "//ae01.alicdn.com/kf/mouse-fixture.jpg",
            promotion_link: "https://s.click.aliexpress.com/e/_mouse-base",
            product_detail_url: pcExpandido,
            first_level_category_name: "Mouses"
          } } }
        } } })
      };
    }
    if (method === "aliexpress.affiliate.link.generate") {
      assert.ok([appExpandido, pcExpandido].includes(sourceValues), "a API recebe somente cada URL oficial expandida");
      const papel = sourceValues === appExpandido ? "APP" : "PC";
      return {
        ok: true, status: 200, url: String(url), headers: { get: () => "" },
        json: async () => ({ aliexpress_affiliate_link_generate_response: { resp_result: { result: {
          promotion_links: { promotion_link: [{ promotion_link: `https://s.click.aliexpress.com/e/_mouse_${papel}` }] }
        } } } })
      };
    }
    throw new Error(`método inesperado: ${method}`);
  };

  try {
    const resultado = await importarAliExpressEngine({
      job: { id: "fixture_144302", evento_id: 144302, cliente_id: workspaceId, marketplace: "aliexpress" },
      evento: { texto_original: [
        "Mouse Delux M900 Pro, PAW3395, 8000 Hz, com dock",
        "R$ 176 + 967 moedas",
        "Cupom: seguir a loja e resgatar; nenhum código explícito",
        `APP: ${app}`, `PC: ${pc}`
      ].join("\n") },
      links: [
        { url_original: app, url_expandida: appExpandido, metadata: { papelLink: "link_app" } },
        { url_original: pc, url_expandida: pcExpandido, metadata: { papelLink: "link_pc" } }
      ],
      deps: { getIntegracaoCliente: clienteId => clienteId === workspaceId ? { credenciais } : null, importarAliExpress }
    });

    assert.equal(resultado.ok, true);
    assert.equal(resultado.produtoId, productId);
    assert.equal(resultado.titulo, "Mouse Delux M900 Pro");
    assert.equal(resultado.imagem, "https://ae01.alicdn.com/kf/mouse-fixture.jpg");
    assert.equal(resultado.categoria, "Mouses");
    assert.equal(resultado.preco, 176);
    assert.equal(resultado.cupom, "", "orientação de resgate não é código de cupom");
    assert.ok(resultado.beneficioComercial.includes("seguir a loja"), "instrução do Radar permanece textual");
    assert.ok(resultado.moedasTexto.includes("967"));
    const links = resultado.metadata.linksClassificados;
    const porPapel = Object.fromEntries(links.map(item => [item.papelLink, item]));
    assert.equal(porPapel.link_app.urlOriginal, app);
    assert.equal(porPapel.link_pc.urlOriginal, pc);
    assert.equal(porPapel.link_app.sourceValuesUsado, appExpandido);
    assert.equal(porPapel.link_pc.sourceValuesUsado, pcExpandido);
    assert.notEqual(porPapel.link_app.urlAfiliada, porPapel.link_pc.urlAfiliada);
    for (const [papel, original] of [["link_app", app], ["link_pc", pc]]) {
      assert.equal(porPapel[papel].renderizavel, true);
      assert.equal(porPapel[papel].afiliacaoWorkspace.urlOriginal, original);
      assert.equal(porPapel[papel].afiliacaoWorkspace.papel, papel);
      assert.equal(validarProvaAfiliacaoWorkspaceAliExpress(porPapel[papel].afiliacaoWorkspace,
        { clienteId: workspaceId, credenciais, exigirAssinatura: true }).valida, true);
    }
    assert.equal(chamadas.filter(item => item.method === "aliexpress.affiliate.productdetail.get").length, 1);
    assert.deepEqual(chamadas.filter(item => item.method === "aliexpress.affiliate.link.generate")
      .map(item => item.sourceValues).sort(), [appExpandido, pcExpandido].sort());

    const divergente = await importarAliExpressEngine({
      job: { id: "fixture_144302_divergente", evento_id: 144302, cliente_id: workspaceId, marketplace: "aliexpress" },
      evento: { texto_original: `Mouse Delux M900 Pro\nR$ 176\nAPP: ${app}\nPC: ${pc}` },
      links: [
        { url_original: app, url_expandida: "https://m.aliexpress.com/p/coin-index/index.html?productIds=1005012689379803", metadata: { papelLink: "link_app" } },
        { url_original: pc, url_expandida: pcExpandido, metadata: { papelLink: "link_pc" } }
      ],
      deps: { getIntegracaoCliente: () => ({ credenciais }), importarAliExpress }
    });
    assert.equal(divergente.ok, false, "APP divergente impede a oferta comercial inteira");
    assert.equal(divergente.motivo, "afiliacao_workspace_incompleta");
    const appDivergente = divergente.metadata.linksClassificados.find(item => item.papelLink === "link_app");
    assert.equal(appDivergente.renderizavel, false);
    assert.equal(appDivergente.motivoConversao, "link_app_produto_nao_comprovado");
  } finally {
    global.fetch = fetchOriginal;
  }
}

async function testarMouse144302ApiVaziaFalhaFechado() {
  const productId = "1005012689379802";
  const pc = "https://pt.aliexpress.com/item/1005012689379802.html";
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opcoes = {}) => {
    const body = opcoes.body instanceof URLSearchParams
      ? opcoes.body : new URLSearchParams(opcoes.body || "");
    const method = body.get("method");
    if (method === "aliexpress.affiliate.productdetail.get") {
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: { get: () => "" },
        json: async () => ({
          aliexpress_affiliate_productdetail_get_response: {
            resp_result: {
              resp_code: 200,
              resp_msg: "success",
              result: { current_record_count: 0, products: {} }
            }
          }
        })
      };
    }
    if (method === "aliexpress.affiliate.product.query") {
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: { get: () => "" },
        json: async () => ({
          aliexpress_affiliate_product_query_response: {
            resp_result: { resp_code: 405, resp_msg: "The result is empty", result: {} }
          }
        })
      };
    }
    throw new Error(`método inesperado: ${method}`);
  };

  try {
    const resultado = await importarAliExpress(pc, {
      credenciais: { appKey: "fixture", secret: "fixture", trackingId: "fixture" },
      clienteId: "workspace_mouse_fixture",
      contextoEngine: { papelLink: "link_pc", conversaoLinkAlternativo: true }
    });

    assert.equal(resultado.erroTecnico, "aliexpress_manual_fallback_generico");
    assert.equal(resultado.titulo, "Produto AliExpress");
    assert.equal(resultado.imagem, "");
    assert.equal(resultado.categoria, "AliExpress");
    assert.equal(resultado.precoAtual, "");
  } finally {
    global.fetch = fetchOriginal;
  }
}

function testarRadarPreservaSomenteProductIdsFactualNaLandingApp() {
  const codigo = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicio = codigo.indexOf("function limparUrlProdutoRadar(");
  const fim = codigo.indexOf("function isUrlIntermediariaMercadoLivreRadar(", inicio);
  assert.ok(inicio >= 0 && fim > inicio);
  const limpar = new Function("normalizarMarketplaceRadar", "detectarMarketplaceRadarLink",
    `${codigo.slice(inicio, fim)}; return limparUrlProdutoRadar;`)(valor => valor, () => "aliexpress");
  assert.equal(
    limpar("https://m.aliexpress.com/p/coin-index/index.html?productIds=1005012689379802&aff_trace_key=sensivel", "aliexpress"),
    "https://m.aliexpress.com/p/coin-index/index.html?productIds=1005012689379802"
  );
  assert.equal(
    limpar("https://m.aliexpress.com/p/coin-index/index.html?productIds=outro&aff_trace_key=sensivel", "aliexpress"),
    "https://m.aliexpress.com/p/coin-index/index.html"
  );
  assert.equal(
    limpar("https://pt.aliexpress.com/item/1005012689379802.html?tracking=remover", "aliexpress"),
    "https://pt.aliexpress.com/item/1005012689379802.html"
  );
}

function testarRegistroNoPipelineUnico() {
  const runner = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "importer", "importer.runner.js"), "utf8");
  const orchestrator = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "orchestrator.runner.js"), "utf8");
  assert.ok(runner.includes("aliexpress: importarAliExpressEngine"), "importer oficial deve registrar o adapter AliExpress");
  assert.ok(orchestrator.includes("importar_aliexpress"), "orquestrador deve importar AliExpress pelo Engine");
  assert.ok(orchestrator.includes("distribuir_aliexpress"), "orquestrador deve entregar AliExpress ao distribuidor do RIO");
}

(async () => {
  await testarPrecoRadarVenceApiELinkMoedasConverte();
  testarEspelhoUsaAfiliadaENaoOriginal();
  testarMesmoLinkAppPcNaoDuplica();
  await testarProdutoDuplicadoReutilizaConversaoEPreservaOcorrencias();
  await testarAppDuplicadoReutilizaConversaoEPreservaOcorrencias();
  await testarProdutosDistintosNaoUsamAfiliadoGlobal();
  await testarFalhaConversaoMantemOcorrenciaAuditavel();
  await testarApiSemCanonicoPreservaAppPcConvertidosDoRadar();
  await testarResgateConservadorNaoFabricaPcQuandoRadarTrouxeSoApp();
  await testarFixtures8BitDoPreservamContratoComercialPorWorkspace();
  await testar8BitDoAtravessaImporterRealSemDespacho();
  await testarMouse144302HandoffPcAppSemCodigoInventado();
  await testarMouse144302ApiVaziaFalhaFechado();
  testarRadarPreservaSomenteProductIdsFactualNaLandingApp();
  testarRegistroNoPipelineUnico();
  console.log("aliexpress-app-moedas-contrato.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
