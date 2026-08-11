const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-img-canonica-"));

const { writeGlobalJson } = require("../utils/storage");

writeGlobalJson("usuarios.json", [
  { id: "d1_teste", nome: "D1", ativo: true, plano: "pro" },
  { id: "roger_teste", nome: "Roger", ativo: true, plano: "pro" },
  { id: "wolff_teste", nome: "Wolff", ativo: true, plano: "pro" }
]);
writeGlobalJson("planos.json", {
  pro: {
    nome: "pro",
    ativo: true,
    marketplaces: ["mercadolivre", "shopee", "amazon", "aliexpress"],
    recursos: { automacao: true }
  }
});

function limparModulo(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mockModulo(relativo, exports) {
  const resolvido = limparModulo(relativo);
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports
  };
}

function url(nome) {
  return `https://cdn.exemplo.com/produtos/${nome}.jpg`;
}

function mmg(nome = "img") {
  return `https://mmg.whatsapp.net/o1/v/t24/f2/m239/${nome}?ccb=9-4&oh=assinatura&oe=6AA02255`;
}

function pngMinimo() {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfab6d0000000049454e44ae426082",
    "hex"
  );
}

function fetchImagemOk(contador) {
  return async () => {
    contador.count += 1;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => pngMinimo()
    };
  };
}

function fetchImagemInvalida(contador) {
  return async () => {
    contador.count += 1;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from("<html>expirada</html>")
    };
  };
}

function storageDuravel(contador, nome = "radar-materializada") {
  return {
    detectarMime(buffer) {
      assert(Buffer.isBuffer(buffer));
      return "image/png";
    },
    salvar({ buffer, mimeType }) {
      contador.count += 1;
      assert(Buffer.isBuffer(buffer));
      assert.strictEqual(mimeType, "image/png");
      return { ok: true, url: url(nome), mimeType, bytes: buffer.length };
    }
  };
}

function storageSemImagem() {
  return {
    detectarMime() {
      return "";
    },
    salvar() {
      throw new Error("storage_nao_deveria_salvar");
    }
  };
}

async function fanoutComImagemCanonica({ metadataEvento, depsImagemCanonica, links = ["https://produto.mercadolivre.com.br/MLB-4987473341-produto"] } = {}) {
  limparModulo("../modules/imagens/cache-canonico-evento");
  limparModulo("../modules/engine/jobs.service");
  const metadatas = [];

  mockModulo("../modules/engine/database", {
    queryEngine: async (sql, params = []) => {
      if (/WITH jobs_admin/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ jobs_ignorados: 0, ofertas_retidas: 0 }] } };
      }
      if (/INSERT INTO engine_jobs_cliente/i.test(sql)) {
        metadatas.push(JSON.parse(params[4]));
        return { ok: true, resultado: { rows: [{ id: 1000 + metadatas.length }] } };
      }
      return { ok: true, resultado: { rows: [] } };
    }
  });

  const jobs = require("../modules/engine/jobs.service");
  const retorno = await jobs.criarJobsParaClientes({
    eventoId: 9100,
    marketplaceDetectado: "mercadolivre",
    linksExtraidos: links,
    clientes: ["d1_teste", "roger_teste", "wolff_teste"],
    metadataEvento,
    deps: { imagemCanonica: depsImagemCanonica }
  });

  return { retorno, metadatas };
}

(async () => {
  {
    const fetchCount = { count: 0 };
    const saveCount = { count: 0 };
    const { retorno, metadatas } = await fanoutComImagemCanonica({
      metadataEvento: {
        radarMirror: {
          midia: {
            imagemOrigem: "mensagem",
            imagemOriginal: mmg("fanout-valida")
          }
        }
      },
      depsImagemCanonica: {
        fetchImpl: fetchImagemOk(fetchCount),
        storage: storageDuravel(saveCount)
      }
    });

    assert.strictEqual(retorno.criados, 3);
    assert.strictEqual(fetchCount.count, 1);
    assert.strictEqual(saveCount.count, 1);
    assert.strictEqual(metadatas.length, 3);
    for (const metadata of metadatas) {
      assert.strictEqual(metadata.imagemCanonicaDuravel, url("radar-materializada"));
      assert.strictEqual(metadata.imagemEnviavel, true);
      assert.strictEqual(metadata.metadataEvento.imagemCanonicaDuravel, url("radar-materializada"));
      assert.strictEqual(metadata.metadataEvento.radarMirror.midia.imagemMaterializada, url("radar-materializada"));
      assert.strictEqual(metadata.imagemCacheCanonico.materializacoes, 1);
    }
  }

  {
    const fetchCount = { count: 0 };
    const { retorno, metadatas } = await fanoutComImagemCanonica({
      metadataEvento: {
        radarMirror: {
          midia: {
            imagemOrigem: "mensagem",
            imagemOriginal: mmg("fanout-invalida")
          }
        }
      },
      depsImagemCanonica: {
        fetchImpl: fetchImagemInvalida(fetchCount),
        storage: storageSemImagem(),
        buscarImagemHistorica: async () => ({ imagem: "", motivo: "historico_mesmo_mlb_sem_imagem" }),
        buscarImagemOficialMl: async () => ({ imagem: "", motivo: "api_oficial_mlb_sem_imagem" })
      }
    });

    assert.strictEqual(retorno.criados, 3);
    assert.strictEqual(fetchCount.count, 1);
    assert.strictEqual(metadatas.length, 3);
    for (const metadata of metadatas) {
      assert.strictEqual(metadata.imagemEnviavel, false);
      assert.strictEqual(metadata.imagemCanonicaDuravel, "");
      assert.strictEqual(metadata.imagemStatus, "radar_falhou_enriquecimento_pendente");
      assert.strictEqual(metadata.imagemCacheCanonico.motivo, "fonte_radar_imagem_falhou");
      assert.strictEqual(metadata.imagemCacheCanonico.enriquecimentoPendente, true);
      assert.strictEqual(metadata.imagemCacheCanonico.imagemCanonicaFinal, false);
      assert.strictEqual(metadata.imagemCacheCanonico.materializacoes, 1);
      assert.strictEqual(metadata.imagemCacheCanonico.bloquearRematerializacaoRadar, true);
      assert.strictEqual(metadata.imagemCacheCanonico.radarMirrorMaterializacao.status, "falha");
      assert.strictEqual(metadata.imagemCacheCanonico.radarMirrorMaterializacao.motivo, "mime_nao_imagem");
    }
  }

  {
    limparModulo("../modules/engine/importer/importer.service");
    const { materializarImagemRadarMirrorSeNecessario } = require("../modules/engine/importer/importer.service");
    let fetchChamado = false;
    const resultado = await materializarImagemRadarMirrorSeNecessario({
      metadata: {
        radarMirror: {
          midia: {
            imagemOrigem: "mensagem",
            imagemOriginal: mmg("nao-repetir")
          }
        }
      }
    }, {
      job: {
        metadata: {
          imagemCacheCanonico: {
            chave: "9100:mercadolivre:MLB4987473341",
            produtoId: "MLB4987473341",
            status: "nao_resolvida",
            motivo: "mime_nao_imagem",
            imagemEnviavel: false,
            materializacoes: 1,
            bloquearRematerializacaoRadar: true,
            radarMirrorMaterializacao: {
              status: "falha",
              origem: "radar_mirror/mensagem",
              urlOriginal: mmg("nao-repetir"),
              motivo: "mime_nao_imagem",
              materializacoes: 1,
              cacheCanonico: true
            }
          }
        }
      },
      fetchImpl: async () => {
        fetchChamado = true;
        throw new Error("nao_deveria_baixar_mmg_no_filho");
      }
    });

    assert.strictEqual(fetchChamado, false);
    assert.strictEqual(resultado.status, "cache_canonico_evento_falha");
    assert.strictEqual(resultado.motivo, "mime_nao_imagem");
    assert.strictEqual(resultado.oferta.metadata.imagemCacheCanonico.bloquearRematerializacaoRadar, true);
  }

  {
    const fetchCount = { count: 0 };
    const { retorno, metadatas } = await fanoutComImagemCanonica({
      metadataEvento: {
        radarMirror: {
          midia: {
            imagemOrigem: "mensagem",
            imagemOriginal: mmg("fanout-jsonld")
          }
        },
        jsonLd: { image: url("jsonld-fanout-ml") }
      },
      depsImagemCanonica: {
        fetchImpl: fetchImagemInvalida(fetchCount),
        storage: storageSemImagem(),
        buscarImagemHistorica: async () => { throw new Error("historico_nao_deveria_ser_usado"); },
        buscarImagemOficialMl: async () => { throw new Error("api_nao_deveria_ser_usada"); }
      }
    });

    assert.strictEqual(retorno.criados, 3);
    assert.strictEqual(fetchCount.count, 1);
    for (const metadata of metadatas) {
      assert.strictEqual(metadata.imagemCanonicaDuravel, url("jsonld-fanout-ml"));
      assert.strictEqual(metadata.imagemOrigem, "jsonLd.image");
      assert.strictEqual(metadata.imagemEnviavel, true);
      assert.strictEqual(metadata.imagemCacheCanonico.materializacoes, 1);
      assert.strictEqual(metadata.imagemCacheCanonico.radarMirrorMaterializacao.status, "falha");
    }
  }

  {
    const {
      resolverImagemCanonicaEvento,
      _limparCacheImagemCanonicaEvento
    } = require("../modules/imagens/cache-canonico-evento");
    _limparCacheImagemCanonicaEvento();
    const resultado = await resolverImagemCanonicaEvento({
      eventoId: 9200,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-3696123026-la-roche"],
      metadataEvento: {
        radarMirror: { midia: { imagemOrigem: "mensagem", imagemOriginal: mmg("expirada") } },
        jsonLd: { image: url("jsonld-ml") }
      }
    }, {
      fetchImpl: async () => ({ ok: false, status: 403 }),
      buscarImagemHistorica: async () => { throw new Error("historico_nao_deveria_ser_usado"); },
      buscarImagemOficialMl: async () => { throw new Error("api_nao_deveria_ser_usada"); }
    });

    assert.strictEqual(resultado.imagemCanonicaDuravel, url("jsonld-ml"));
    assert.strictEqual(resultado.imagemOrigem, "jsonLd.image");
    assert.strictEqual(resultado.materializacoes, 1);
  }

  {
    const {
      resolverImagemCanonicaEvento,
      _limparCacheImagemCanonicaEvento
    } = require("../modules/imagens/cache-canonico-evento");
    _limparCacheImagemCanonicaEvento();
    const fetchCount = { count: 0 };
    const deps = {
      fetchImpl: fetchImagemInvalida(fetchCount),
      storage: storageSemImagem(),
      buscarImagemHistorica: async () => ({ imagem: "", motivo: "historico_mesmo_mlb_sem_imagem" }),
      buscarImagemOficialMl: async () => ({ imagem: "", motivo: "api_oficial_mlb_sem_imagem" })
    };
    const entradaBase = {
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-3696123026-la-roche"],
      metadataEvento: {
        radarMirror: { midia: { imagemOrigem: "mensagem", imagemOriginal: mmg("novo-evento") } }
      }
    };
    const primeiro = await resolverImagemCanonicaEvento({ ...entradaBase, eventoId: 9210 }, deps);
    const segundo = await resolverImagemCanonicaEvento({ ...entradaBase, eventoId: 9211 }, deps);

    assert.strictEqual(fetchCount.count, 2);
    assert.notStrictEqual(primeiro.chave, segundo.chave);
    assert.strictEqual(primeiro.radarMirrorMaterializacao.status, "falha");
    assert.strictEqual(segundo.radarMirrorMaterializacao.status, "falha");
  }

  {
    const {
      resolverImagemCanonicaEvento,
      _limparCacheImagemCanonicaEvento
    } = require("../modules/imagens/cache-canonico-evento");
    _limparCacheImagemCanonicaEvento();
    const resultado = await resolverImagemCanonicaEvento({
      eventoId: 9300,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-3284064025-vodka"],
      metadataEvento: {
        radarMirror: { midia: { imagemOrigem: "mensagem", imagemOriginal: mmg("expirada") } }
      }
    }, {
      fetchImpl: async () => ({ ok: false, status: 410 }),
      buscarImagemHistorica: async () => ({ imagem: url("historico-mlb"), origem: "engine_ofertas.imagem:123" }),
      buscarImagemOficialMl: async () => { throw new Error("api_nao_deveria_ser_usada"); }
    });

    assert.strictEqual(resultado.imagemCanonicaDuravel, url("historico-mlb"));
    assert.strictEqual(resultado.imagemOrigem, "engine_ofertas.imagem:123");
    assert.strictEqual(resultado.imagemStatus, "historico_mesmo_mlb");
  }

  {
    const {
      resolverImagemCanonicaEvento,
      _limparCacheImagemCanonicaEvento
    } = require("../modules/imagens/cache-canonico-evento");
    _limparCacheImagemCanonicaEvento();
    const resultado = await resolverImagemCanonicaEvento({
      eventoId: 9350,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-4987473341-produto-novo"],
      metadataEvento: {
        radarMirror: { midia: { imagemOrigem: "mensagem", imagemOriginal: mmg("expirada-oficial") } }
      }
    }, {
      fetchImpl: async () => ({ ok: false, status: 410 }),
      buscarImagemHistorica: async () => ({ imagem: "", motivo: "historico_mesmo_mlb_sem_imagem" }),
      buscarImagemOficialMl: async () => ({ imagem: url("api-oficial-mlb"), origem: "api_mercadolibre.items.pictures[0].secure_url" })
    });

    assert.strictEqual(resultado.imagemCanonicaDuravel, url("api-oficial-mlb"));
    assert.strictEqual(resultado.imagemOrigem, "api_mercadolibre.items.pictures[0].secure_url");
    assert.strictEqual(resultado.imagemStatus, "api_oficial_mlb");
  }

  {
    const {
      resolverImagemCanonicaEvento,
      resolverImagemCanonicaFinalEvento,
      _limparCacheImagemCanonicaEvento
    } = require("../modules/imagens/cache-canonico-evento");
    _limparCacheImagemCanonicaEvento();
    const preliminar = await resolverImagemCanonicaEvento({
      eventoId: 9400,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-1111111111-sem-imagem"],
      metadataEvento: {
        radarMirror: { midia: { imagemOrigem: "mensagem", imagemOriginal: mmg("sem-fonte") } }
      }
    }, {
      preliminar: true,
      fetchImpl: async () => ({ ok: false, status: 404 }),
      buscarImagemHistorica: async () => ({ imagem: "", motivo: "historico_mesmo_mlb_sem_imagem" }),
      buscarImagemOficialMl: async () => ({ imagem: "", motivo: "api_oficial_mlb_sem_imagem" })
    });

    assert.strictEqual(preliminar.ok, false);
    assert.strictEqual(preliminar.imagemCanonicaDuravel, "");
    assert.strictEqual(preliminar.imagemEnviavel, false);
    assert.strictEqual(preliminar.imagemStatus, "radar_falhou_enriquecimento_pendente");
    assert.strictEqual(preliminar.motivo, "fonte_radar_imagem_falhou");

    const resultado = await resolverImagemCanonicaFinalEvento({
      eventoId: 9400,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-1111111111-sem-imagem"],
      metadataEvento: {
        radarMirror: { midia: { imagemOrigem: "mensagem", imagemOriginal: mmg("sem-fonte") } }
      },
      ofertaEnriquecida: {
        marketplace: "mercadolivre",
        titulo: "SEM IMAGEM FINAL",
        produtoIdDetectado: "MLB1111111111",
        linkOriginal: "https://produto.mercadolivre.com.br/MLB-1111111111-sem-imagem"
      }
    }, {
      buscarImagemHistorica: async () => ({ imagem: "", motivo: "historico_mesmo_mlb_sem_imagem" }),
      buscarImagemOficialMl: async () => ({ imagem: "", motivo: "api_oficial_mlb_sem_imagem" })
    });

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.imagemStatus, "nao_resolvida");
    assert.strictEqual(resultado.imagemCanonicaFinal, true);
    assert.strictEqual(resultado.enriquecimentoPendente, false);
    assert.strictEqual(resultado.motivo, "api_oficial_mlb_sem_imagem");
  }

  {
    const {
      resolverImagemCanonicaEvento,
      _limparCacheImagemCanonicaEvento
    } = require("../modules/imagens/cache-canonico-evento");
    _limparCacheImagemCanonicaEvento();
    const fetchCount = { count: 0 };
    const storage = {
      detectarMime: () => "image/png",
      salvar: ({ buffer, mimeType }) => ({
        ok: true,
        url: url(`produto-${fetchCount.count}`),
        mimeType,
        bytes: buffer.length
      })
    };
    const deps = { fetchImpl: fetchImagemOk(fetchCount), storage };
    const primeiro = await resolverImagemCanonicaEvento({
      eventoId: 9500,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-2222222222-a"],
      metadataEvento: { radarMirror: { midia: { imagemOrigem: "mensagem", imagemOriginal: mmg("a") } } }
    }, deps);
    const segundo = await resolverImagemCanonicaEvento({
      eventoId: 9500,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://produto.mercadolivre.com.br/MLB-3333333333-b"],
      metadataEvento: { radarMirror: { midia: { imagemOrigem: "mensagem", imagemOriginal: mmg("b") } } }
    }, deps);

    assert.notStrictEqual(primeiro.chave, segundo.chave);
    assert.notStrictEqual(primeiro.imagemCanonicaDuravel, segundo.imagemCanonicaDuravel);
    assert.strictEqual(fetchCount.count, 2);
  }

  {
    const {
      aplicarImagemCanonicaMetadata
    } = require("../modules/imagens/cache-canonico-evento");
    const metadata = {
      precoDe: "R$ 289",
      precoPor: "R$ 132",
      precoPix: "R$ 132",
      cupom: "QUEROCUPOM",
      linksComerciais: [
        { papel: "produto", urlAfiliada: "https://meli.la/workspace-a" },
        { papel: "resgate", urlAfiliada: "https://meli.la/cupom-a" }
      ]
    };
    const saida = aplicarImagemCanonicaMetadata(metadata, {
      chave: "9600:mercadolivre:MLB4444444444",
      produtoId: "MLB4444444444",
      imagemCanonicaDuravel: url("sem-mexer-comercial"),
      imagemOrigem: "api_oficial_mlb",
      imagemStatus: "api_oficial_mlb",
      imagemEnviavel: true
    });

    assert.strictEqual(saida.precoDe, metadata.precoDe);
    assert.strictEqual(saida.precoPor, metadata.precoPor);
    assert.strictEqual(saida.precoPix, metadata.precoPix);
    assert.strictEqual(saida.cupom, metadata.cupom);
    assert.deepStrictEqual(saida.linksComerciais, metadata.linksComerciais);
  }

  {
    const {
      resolverImagemCanonicaEvento,
      resolverImagemCanonicaFinalEvento,
      _limparCacheImagemCanonicaEvento
    } = require("../modules/imagens/cache-canonico-evento");
    _limparCacheImagemCanonicaEvento();
    const fetchCount = { count: 0 };
    const base = {
      eventoId: 9650,
      marketplace: "mercadolivre",
      linksExtraidos: ["https://meli.la/2hPouUu"],
      metadataEvento: {
        radarMirror: { midia: { imagemOrigem: "mensagem", imagemOriginal: mmg("tv-quarto") } },
        textoOriginal: "TV PARA VOCÊ COLOCAR NO QUARTO\nDe: 2399\nPor: 1340\nCupom: VIPNOML"
      }
    };
    const preliminar = await resolverImagemCanonicaEvento(base, {
      preliminar: true,
      fetchImpl: fetchImagemInvalida(fetchCount),
      storage: storageSemImagem()
    });
    assert.strictEqual(preliminar.imagemStatus, "radar_falhou_enriquecimento_pendente");
    assert.strictEqual(fetchCount.count, 1);

    const linksAfiliados = [
      "https://meli.la/workspace-a",
      "https://meli.la/workspace-b",
      "https://meli.la/workspace-c"
    ];
    const resultados = [];
    for (const linkAfiliado of linksAfiliados) {
      resultados.push(await resolverImagemCanonicaFinalEvento({
        ...base,
        ofertaEnriquecida: {
          marketplace: "mercadolivre",
          titulo: "TV PARA VOCÊ COLOCAR NO QUARTO",
          preco: 1340,
          precoOriginal: 2399,
          cupom: "VIPNOML",
          produtoIdDetectado: "MLB2222222222",
          linkOriginal: "https://meli.la/2hPouUu",
          linkExpandido: "https://produto.mercadolivre.com.br/MLB-2222222222-tv-para-quarto-_JM",
          linkAfiliado,
          jsonLd: { image: url("tv-quarto-jsonld") },
          metadata: {
            produto: {
              imagemCandidatos: [url("tv-quarto-jsonld")],
              pictures: [{ secure_url: url("tv-quarto-picture") }]
            }
          }
        }
      }, {
        buscarImagemHistorica: async () => { throw new Error("historico_nao_deveria_ser_usado"); },
        buscarImagemOficialMl: async () => { throw new Error("api_nao_deveria_ser_usada"); }
      }));
    }

    assert.deepStrictEqual(resultados.map(item => item.imagemCanonicaDuravel), [
      url("tv-quarto-jsonld"),
      url("tv-quarto-jsonld"),
      url("tv-quarto-jsonld")
    ]);
    assert(resultados.slice(1).every(item => item.cacheHit === true));
    assert.strictEqual(resultados[0].imagemOrigem, "jsonLd.image");
    assert.strictEqual(resultados[0].imagemCanonicaFinal, true);
    assert.strictEqual(resultados[0].enriquecimentoPendente, false);
    assert.deepStrictEqual(linksAfiliados, [
      "https://meli.la/workspace-a",
      "https://meli.la/workspace-b",
      "https://meli.la/workspace-c"
    ]);
  }

  {
    const {
      resolverImagemCanonicaFinalEvento,
      _limparCacheImagemCanonicaEvento
    } = require("../modules/imagens/cache-canonico-evento");
    _limparCacheImagemCanonicaEvento();
    const imagemPolycard = "https://http2.mlstatic.com/D_Q_NP_766763-MLB102163177100_122025-V.webp";
    const linksAfiliados = [
      "https://meli.la/polycard-a",
      "https://meli.la/polycard-b",
      "https://meli.la/polycard-c"
    ];
    const resultados = [];
    for (const linkAfiliado of linksAfiliados) {
      resultados.push(await resolverImagemCanonicaFinalEvento({
        eventoId: 9560,
        marketplace: "mercadolivre",
        linksExtraidos: ["https://meli.la/2nKnMEm"],
        metadataEvento: {},
        ofertaEnriquecida: {
          marketplace: "mercadolivre",
          titulo: "Kit Growth Whey Protein Basic Chocolate 1kg Creatina",
          produtoIdDetectado: "MLB4387463577",
          linkOriginal: "https://meli.la/2nKnMEm",
          linkExpandido: "https://produto.mercadolivre.com.br/MLB4387463577",
          linkAfiliado,
          imagem: imagemPolycard,
          imagemUrl: imagemPolycard,
          imagemOrigem: "polycard.picture_template",
          imagemStatus: "imagem_canonica_evento"
        }
      }, {
        buscarImagemHistorica: async () => { throw new Error("historico_nao_deveria_ser_usado"); },
        buscarImagemOficialMl: async () => { throw new Error("api_nao_deveria_ser_usada"); }
      }));
    }

    assert.deepStrictEqual(resultados.map(item => item.imagemCanonicaDuravel), [
      imagemPolycard,
      imagemPolycard,
      imagemPolycard
    ]);
    assert.strictEqual(resultados[0].imagemOrigem, "polycard.picture_template");
    assert(resultados.slice(1).every(item => item.cacheHit === true));
    assert.deepStrictEqual(linksAfiliados, [
      "https://meli.la/polycard-a",
      "https://meli.la/polycard-b",
      "https://meli.la/polycard-c"
    ]);
  }

  {
    const {
      resolverImagemCanonicaFinalEvento,
      _limparCacheImagemCanonicaEvento
    } = require("../modules/imagens/cache-canonico-evento");
    _limparCacheImagemCanonicaEvento();
    const fixtures = [
      ["CHEIROSÃO DE 212", "MLB3333333333", "https://meli.la/1y2uJcP", url("cheirosao-jsonld")],
      ["ESSE COMPRESSOR FAZ TUDO E MAIS UM POUCO", "MLB4444444444", "https://meli.la/2WEQqho", url("compressor-og")],
      ["MUITOS KITS JOICO", "MLB5181827144", "https://meli.la/2Z29syn", url("joico-picture")],
      ["NOTEBOOK EM PROMO", "MLB5356528958", "https://meli.la/1Q4WTgR", url("notebook-thumbnail")],
      ["Adidas Adizero", "MLB3999119695", "https://produto.mercadolivre.com.br/MLB-3999119695-adidas-_JM", url("adidas-jsonld")],
      ["Shorts Esportivo", "MLB5159817994", "https://produto.mercadolivre.com.br/MLB-5159817994-shorts-_JM", url("shorts-jsonld")],
      ["Pote Marmita", "MLB5974804996", "https://produto.mercadolivre.com.br/MLB-5974804996-pote-_JM", url("pote-jsonld")],
      ["SENTE A PRESSÃO", "MLB5555555555", "https://meli.la/sente-a-pressao", url("pressao-jsonld")]
    ];

    for (const [titulo, mlb, linkOriginal, imagem] of fixtures) {
      const resultado = await resolverImagemCanonicaFinalEvento({
        eventoId: `fixture-${mlb}`,
        marketplace: "mercadolivre",
        linksExtraidos: [linkOriginal],
        metadataEvento: {},
        ofertaEnriquecida: {
          marketplace: "mercadolivre",
          titulo,
          produtoIdDetectado: mlb,
          linkOriginal,
          linkExpandido: linkOriginal.includes("produto.mercadolivre.com.br")
            ? linkOriginal
            : `https://produto.mercadolivre.com.br/${mlb}-${titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-_JM`,
          metadata: {
            produto: {
              imagemCandidatos: [imagem]
            }
          }
        }
      });
      assert.strictEqual(resultado.imagemCanonicaDuravel, imagem, titulo);
      assert.strictEqual(resultado.imagemCanonicaFinal, true, titulo);
    }
  }

  {
    const { retorno, metadatas } = await fanoutComImagemCanonica({
      metadataEvento: {
        radarMirror: {
          midia: {
            imagemOrigem: "mensagem",
            imagemOriginal: mmg("fail-open")
          }
        }
      },
      depsImagemCanonica: {
        fetchImpl: async () => ({ ok: false, status: 410 }),
        buscarImagemHistorica: async () => { throw new Error("historico_indisponivel"); }
      }
    });

    assert.strictEqual(retorno.criados, 3);
    assert.strictEqual(metadatas[0].imagemEnviavel, false);
    assert.strictEqual(metadatas[0].imagemCacheCanonico.status, "radar_falhou_enriquecimento_pendente");
    assert.strictEqual(metadatas[0].imagemCacheCanonico.motivo, "fonte_radar_imagem_falhou");
    assert.strictEqual(metadatas[0].imagemCacheCanonico.enriquecimentoPendente, true);
  }

  {
    const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
    const itemFila = montarItemFilaEngine({
      id: 9700,
      job_id: 9701,
      cliente_id: "d1_teste",
      marketplace: "mercadolivre",
      titulo: "Oferta com cache canonico",
      preco: 99,
      link_afiliado: "https://meli.la/workspace-d1",
      metadata: {
        imagemCanonicaDuravel: url("fila-cache-canonico"),
        imagemOrigem: "imagem_canonica_evento",
        imagemStatus: "api_oficial_mlb",
        imagemEnviavel: true
      }
    });

    assert.strictEqual(itemFila.imagem, url("fila-cache-canonico"));
    assert.strictEqual(itemFila.imagemUrl, url("fila-cache-canonico"));
    assert.strictEqual(itemFila.imagemEnviavel, true);
    assert.strictEqual(itemFila.linkAfiliado, "https://meli.la/workspace-d1");
  }

  console.log("imagem-canonica-fanout.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
