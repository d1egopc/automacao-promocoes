const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-routes-"));

const {
  getClienteJsonPath,
  readClienteJson,
  writeClienteJson
} = require("../utils/storage");
const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");
const {
  importarUrlManualV2
} = require("../modules/manual-v2/manual-import.adapters");
const {
  normalizarOfertaManualV2
} = require("../modules/manual-v2/manual-offers.contract");
const {
  resetImportacoesMagaluManualV2
} = require("../modules/manual-v2/magalu-factual-jobs.service");

const DATA_DIR_TESTE = process.env.DATA_DIR;

function criarAdapters(chamadas = []) {
  const adapters = {};
  for (const marketplace of ["mercadolivre", "amazon", "shopee", "aliexpress", "kabum", "magalu"]) {
    adapters[marketplace] = async (url, opcoes = {}) => {
      chamadas.push({
        marketplace,
        url,
        clienteId: opcoes.clienteId || "",
        marketplaceDetectado: opcoes.marketplaceDetectado || ""
      });
      return normalizarOfertaManualV2(
        {
          marketplace,
          urlOriginal: url,
          titulo: `Produto ${marketplace}`,
          precoAtual: "99,90",
          fonteImportacao: {
            marketplaceDetectado: marketplace,
            adapter: `${marketplace}.fake.adapter`,
            parseOnly: true
          }
        },
        {
          clienteId: opcoes.clienteId,
          now: "2026-08-14T15:00:00.000Z",
          idFactory: () => `manual_v2_import_${marketplace}`
        }
      );
    };
  }
  return adapters;
}

function criarApp(chamadasImportacao = [], storageOptions = {}, overrides = {}) {
  const app = express();
  const adapters = criarAdapters(chamadasImportacao);
  app.use(express.json());
  app.use("/manual-v2", criarRotasManualV2({
    ...overrides,
    getClienteId: (req) => req.header("x-cliente-id") || "cliente_a",
    storageOptions,
    importarUrlManualV2: (url, opcoes = {}) => importarUrlManualV2(url, {
      ...opcoes,
      adapters
    })
  }));
  return app;
}

function ouvir(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, metodo, caminho, clienteId, body) {
  const url = `http://127.0.0.1:${server.address().port}${caminho}`;
  const headers = {
    "x-cliente-id": clienteId
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, {
    method: metodo,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

async function aguardarJobMagalu(server, jobId, clienteId) {
  for (let i = 0; i < 20; i += 1) {
    const resposta = await request(server, "GET", `/manual-v2/importacoes/magalu/${jobId}`, clienteId);
    if (resposta.status === 200 && resposta.body.status !== "processando") return resposta;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return request(server, "GET", `/manual-v2/importacoes/magalu/${jobId}`, clienteId);
}

function arquivoCliente(clienteId, nome) {
  return getClienteJsonPath(clienteId, nome);
}

(async function main() {
resetImportacoesMagaluManualV2();
const chamadasImportacao = [];
const tempos = [
  "2026-08-14T15:01:00.000Z",
  "2026-08-14T15:02:00.000Z",
  "2026-08-14T15:03:00.000Z",
  "2026-08-14T15:04:00.000Z",
  "2026-08-14T15:05:00.000Z"
];
let idSeq = 0;
const app = criarApp(chamadasImportacao, {
  now: () => tempos.shift() || "2026-08-14T15:59:00.000Z",
  idFactory: () => `manual_v2_http_${++idSeq}`
});
const server = await ouvir(app);

try {
  {
    const casos = [
      ["https://www.mercadolivre.com.br/produto/p/MLB123", "mercadolivre"],
      ["https://www.amazon.com.br/dp/B0ABCDEF12", "amazon"],
      ["https://shopee.com.br/product/111/222", "shopee"],
      ["https://www.aliexpress.com/item/1005001234567890.html", "aliexpress"],
      ["https://www.kabum.com.br/produto/944475/produto", "kabum"]
    ];

    for (const [url, marketplace] of casos) {
      const antes = chamadasImportacao.length;
      const resposta = await request(server, "POST", "/manual-v2/importar", "cliente_a", { urlOriginal: url });
      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.oferta.marketplace, marketplace);
      assert.strictEqual(resposta.body.oferta.clienteId, "cliente_a");
      assert.strictEqual(resposta.body.oferta.fonteImportacao.parseOnly, true);
      assert.deepStrictEqual(chamadasImportacao.slice(antes).map(item => item.marketplace), [marketplace]);
    }

    const listaA = await request(server, "GET", "/manual-v2/ofertas", "cliente_a");
    assert.strictEqual(listaA.status, 200);
    assert.deepStrictEqual(listaA.body.ofertas, [], "importacao parse-only nao salva oferta");
    assert.strictEqual(fs.existsSync(arquivoCliente("cliente_a", "manual_ofertas_v2.json")), false);
  }

  {
    const antes = chamadasImportacao.length;
    const resposta = await request(server, "POST", "/manual-v2/importar", "cliente_a", {
      urlOriginal: "https://www.magazineluiza.com.br/smart-tv/p/abc123/"
    });
    assert.strictEqual(resposta.status, 202);
    assert.strictEqual(resposta.body.ok, true);
    assert.strictEqual(resposta.body.assinc, true);
    assert.ok(resposta.body.job.jobId);
    assert.strictEqual(resposta.body.job.status, "processando");
    assert.strictEqual(resposta.body.job.interfaceResolucao.polling, true);
    assert.strictEqual(resposta.body.job.interfaceResolucao.timeoutMs, 60000);

    const status = await aguardarJobMagalu(server, resposta.body.job.jobId, "cliente_a");
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.body.status, "concluido");
    assert.strictEqual(status.body.oferta.marketplace, "magalu");
    assert.strictEqual(status.body.oferta.clienteId, "cliente_a");
    assert.deepStrictEqual(chamadasImportacao.slice(antes).map(item => item.marketplace), ["magalu"]);

    const outroCliente = await request(server, "GET", `/manual-v2/importacoes/magalu/${resposta.body.job.jobId}`, "cliente_b");
    assert.strictEqual(outroCliente.status, 404, "status do job nao pode vazar para outro cliente");

    const metricas = await request(server, "GET", "/manual-v2/importacoes/magalu/metricas", "cliente_a");
    assert.strictEqual(metricas.status, 200);
    assert.ok(metricas.body.metricas.total >= 1);

    const listaA = await request(server, "GET", "/manual-v2/ofertas", "cliente_a");
    assert.deepStrictEqual(listaA.body.ofertas, [], "job factual Magalu nao salva oferta automaticamente");
  }

  {
    const resposta = await request(server, "POST", "/manual-v2/importar", "cliente_a", {
      urlOriginal: "https://www.awin1.com/cread.php?awinmid=1"
    });
    assert.strictEqual(resposta.status, 400);
    assert.strictEqual(resposta.body.ok, false);
    assert.strictEqual(resposta.body.motivo, "awin_sem_destino_kabum_comprovado");
  }

  let ofertaA;
  let ofertaB;
  {
    const criada = await request(server, "POST", "/manual-v2/ofertas", "cliente_a", {
      clienteId: "cliente_b",
      marketplace: "amazon",
      urlOriginal: "https://www.amazon.com.br/dp/B0HTTPA111",
      titulo: "Oferta Cliente A",
      precoAtual: "123,45",
      status: "enviada"
    });

    assert.strictEqual(criada.status, 201);
    assert.strictEqual(criada.body.ok, true);
    ofertaA = criada.body.oferta;
    assert.strictEqual(ofertaA.clienteId, "cliente_a", "clienteId do body nao pode ser confiado");
    assert.strictEqual(ofertaA.status, "salva");

    const criadaB = await request(server, "POST", "/manual-v2/ofertas", "cliente_b", {
      marketplace: "shopee",
      urlOriginal: "https://shopee.com.br/product/1/2",
      titulo: "Oferta Cliente B",
      precoAtual: "54,32"
    });
    assert.strictEqual(criadaB.status, 201);
    ofertaB = criadaB.body.oferta;
    assert.strictEqual(ofertaB.clienteId, "cliente_b");
  }

  {
    const listaA = await request(server, "GET", "/manual-v2/ofertas", "cliente_a");
    const listaB = await request(server, "GET", "/manual-v2/ofertas", "cliente_b");
    assert.deepStrictEqual(listaA.body.ofertas.map(oferta => oferta.id), [ofertaA.id]);
    assert.deepStrictEqual(listaB.body.ofertas.map(oferta => oferta.id), [ofertaB.id]);
  }

  {
    const bloqueado = await request(server, "PUT", `/manual-v2/ofertas/${ofertaB.id}`, "cliente_a", {
      titulo: "Tentativa A em B"
    });
    assert.strictEqual(bloqueado.status, 404);

    const editada = await request(server, "PUT", `/manual-v2/ofertas/${ofertaA.id}`, "cliente_a", {
      titulo: "Oferta Cliente A Editada",
      precoAtual: "111,11",
      cupom: "MANUAL10",
      clienteId: "cliente_b"
    });
    assert.strictEqual(editada.status, 200);
    assert.strictEqual(editada.body.oferta.clienteId, "cliente_a");
    assert.strictEqual(editada.body.oferta.titulo, "Oferta Cliente A Editada");
    assert.strictEqual(editada.body.oferta.precoAtual, "111,11");
    assert.strictEqual(editada.body.oferta.cupom, "MANUAL10");
    assert.strictEqual(editada.body.oferta.criadoEm, ofertaA.criadoEm);
    assert.notStrictEqual(editada.body.oferta.atualizadoEm, ofertaA.atualizadoEm);

    const listaB = await request(server, "GET", "/manual-v2/ofertas", "cliente_b");
    assert.strictEqual(listaB.body.ofertas[0].titulo, "Oferta Cliente B");
  }

  {
    const bloqueado = await request(server, "DELETE", `/manual-v2/ofertas/${ofertaB.id}`, "cliente_a");
    assert.strictEqual(bloqueado.status, 404);

    const removida = await request(server, "DELETE", `/manual-v2/ofertas/${ofertaA.id}`, "cliente_a");
    assert.strictEqual(removida.status, 200);
    assert.strictEqual(removida.body.excluida, true);

    const listaA = await request(server, "GET", "/manual-v2/ofertas", "cliente_a");
    const listaB = await request(server, "GET", "/manual-v2/ofertas", "cliente_b");
    assert.deepStrictEqual(listaA.body.ofertas, []);
    assert.deepStrictEqual(listaB.body.ofertas.map(oferta => oferta.id), [ofertaB.id]);
  }

  {
    assert.strictEqual(fs.existsSync(arquivoCliente("cliente_a", "fila.json")), false, "rotas Manual V2 nao escrevem fila do cliente A");
    assert.strictEqual(fs.existsSync(arquivoCliente("cliente_b", "fila.json")), false, "rotas Manual V2 nao escrevem fila do cliente B");
  }

  {
    const chamadasVitrine = [];
    let seqVitrine = 0;
    const appVitrine = criarApp([], {
      now: () => "2026-08-14T16:00:00.000Z",
      idFactory: () => `manual_v2_vitrine_${++seqVitrine}`
    }, {
      clienteTemRecurso: (clienteId, recurso) => clienteId === "cliente_vitrine" && recurso === "vitrine",
      montarOfertaVitrine: (oferta) => ({
        idPublico: oferta.id,
        ofertaId: oferta.id,
        titulo: oferta.titulo,
        marketplace: oferta.marketplace,
        precoAtual: oferta.precoAtual
      }),
      upsertOfertaVitrine: (clienteId, oferta) => {
        chamadasVitrine.push({ clienteId, oferta });
        return { ok: true, motivo: "publicada", oferta };
      }
    });
    const serverVitrine = await ouvir(appVitrine);

    try {
      const configInicial = await request(serverVitrine, "GET", "/manual-v2/config", "cliente_vitrine");
      assert.strictEqual(configInicial.status, 200);
      assert.deepStrictEqual(configInicial.body.config, {
        automacoesNovasOfertas: {
          vitrine: {
            ativa: false
          }
        }
      });

      const ofertaFlagOff = await request(serverVitrine, "POST", "/manual-v2/ofertas", "cliente_vitrine", {
        marketplace: "mercadolivre",
        titulo: "Oferta sem vitrine",
        precoAtual: "10,00"
      });
      assert.strictEqual(ofertaFlagOff.status, 201);
      assert.strictEqual(ofertaFlagOff.body.vitrinePublicacao, undefined, "flag OFF nao altera contrato de criacao");
      assert.strictEqual(chamadasVitrine.length, 0, "flag OFF nao publica na vitrine");

      const configSalva = await request(serverVitrine, "PUT", "/manual-v2/config", "cliente_vitrine", {
        automacoesNovasOfertas: {
          vitrine: { ativa: true },
          social: { ativa: true }
        }
      });
      assert.strictEqual(configSalva.status, 200);
      assert.strictEqual(configSalva.body.config.automacoesNovasOfertas.vitrine.ativa, true);
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(configSalva.body.config.automacoesNovasOfertas, "social"),
        false,
        "Social fica fora desta fase"
      );

      const criadaComVitrine = await request(serverVitrine, "POST", "/manual-v2/ofertas", "cliente_vitrine", {
        clienteId: "cliente_forjado",
        marketplace: "kabum",
        titulo: "Oferta com vitrine",
        precoAtual: "99,90"
      });
      assert.strictEqual(criadaComVitrine.status, 201);
      assert.strictEqual(criadaComVitrine.body.oferta.clienteId, "cliente_vitrine", "workspace vem do request autenticado");
      assert.deepStrictEqual(criadaComVitrine.body.vitrinePublicacao, {
        ok: true,
        motivo: "publicada"
      });
      assert.strictEqual(chamadasVitrine.length, 1);
      assert.strictEqual(chamadasVitrine[0].clienteId, "cliente_vitrine");
      assert.strictEqual(chamadasVitrine[0].oferta.ofertaId, criadaComVitrine.body.oferta.id);

      const editadaComFlagOn = await request(serverVitrine, "PUT", `/manual-v2/ofertas/${criadaComVitrine.body.oferta.id}`, "cliente_vitrine", {
        titulo: "Oferta editada nao duplica"
      });
      assert.strictEqual(editadaComFlagOn.status, 200);
      assert.strictEqual(chamadasVitrine.length, 1, "edicao nao deriva nova oferta para vitrine");

      await request(serverVitrine, "PUT", "/manual-v2/config", "cliente_sem_vitrine", {
        automacoesNovasOfertas: {
          vitrine: { ativa: true }
        }
      });
      const criadaSemRecurso = await request(serverVitrine, "POST", "/manual-v2/ofertas", "cliente_sem_vitrine", {
        marketplace: "amazon",
        titulo: "Oferta sem recurso",
        precoAtual: "55,55"
      });
      assert.strictEqual(criadaSemRecurso.status, 201);
      assert.strictEqual(criadaSemRecurso.body.vitrinePublicacao.ok, false);
      assert.strictEqual(criadaSemRecurso.body.vitrinePublicacao.motivo, "recurso_indisponivel");
      assert.strictEqual(chamadasVitrine.length, 1, "sem recurso oficial vitrine nao chama upsert");
    } finally {
      await new Promise(resolve => serverVitrine.close(resolve));
    }
  }

  {
    const chamadasStorageVitrine = [];
    let seqVitrineReal = 0;
    const vitrineStorageOptions = {
      readClienteJson: (clienteId, arquivo, fallback) => {
        chamadasStorageVitrine.push({ tipo: "read", clienteId, arquivo });
        return readClienteJson(clienteId, arquivo, fallback);
      },
      writeClienteJson: (clienteId, arquivo, dados) => {
        chamadasStorageVitrine.push({ tipo: "write", clienteId, arquivo });
        return writeClienteJson(clienteId, arquivo, dados);
      }
    };
    const appVitrineReal = criarApp([], {
      now: () => "2026-08-14T16:20:00.000Z",
      idFactory: () => `manual_v2_vitrine_real_${++seqVitrineReal}`
    }, {
      clienteTemRecurso: (clienteId, recurso) =>
        ["cliente_vitrine_real", "cliente_vitrine_inativa"].includes(clienteId) && recurso === "vitrine",
      vitrineStorageOptions
    });
    const serverVitrineReal = await ouvir(appVitrineReal);

    try {
      writeClienteJson("cliente_vitrine_real", "vitrine.json", {
        config: {
          ativa: true,
          slug: "cliente-vitrine-real",
          nomePublico: "Cliente Vitrine Real"
        },
        ofertas: []
      });
      await request(serverVitrineReal, "PUT", "/manual-v2/config", "cliente_vitrine_real", {
        automacoesNovasOfertas: {
          vitrine: { ativa: true }
        }
      });

      const criadaComStorageReal = await request(serverVitrineReal, "POST", "/manual-v2/ofertas", "cliente_vitrine_real", {
        marketplace: "mercadolivre",
        titulo: "Oferta com storage real",
        precoAtual: "88,88",
        linkAfiliado: "https://go.optimuspromo.com.br/r/manual-v2-vitrine-real"
      });
      assert.strictEqual(criadaComStorageReal.status, 201);
      assert.deepStrictEqual(criadaComStorageReal.body.vitrinePublicacao, {
        ok: true,
        motivo: "publicada"
      });
      assert.ok(
        chamadasStorageVitrine.some((chamada) =>
          chamada.tipo === "read" &&
          chamada.clienteId === "cliente_vitrine_real" &&
          chamada.arquivo === "vitrine.json"
        ),
        "readClienteJson oficial deve chegar ao upsert real da Vitrine"
      );
      assert.ok(
        chamadasStorageVitrine.some((chamada) =>
          chamada.tipo === "write" &&
          chamada.clienteId === "cliente_vitrine_real" &&
          chamada.arquivo === "vitrine.json"
        ),
        "writeClienteJson oficial deve chegar ao upsert real da Vitrine"
      );

      await request(serverVitrineReal, "PUT", "/manual-v2/config", "cliente_vitrine_inativa", {
        automacoesNovasOfertas: {
          vitrine: { ativa: true }
        }
      });
      const criadaComVitrineInativa = await request(serverVitrineReal, "POST", "/manual-v2/ofertas", "cliente_vitrine_inativa", {
        marketplace: "amazon",
        titulo: "Oferta com vitrine inativa",
        precoAtual: "44,44"
      });
      assert.strictEqual(criadaComVitrineInativa.status, 201);
      assert.deepStrictEqual(criadaComVitrineInativa.body.vitrinePublicacao, {
        ok: false,
        motivo: "vitrine_inativa"
      });
    } finally {
      await new Promise(resolve => serverVitrineReal.close(resolve));
    }
  }

  {
    const appFalhaVitrine = criarApp([], {
      now: () => "2026-08-14T16:30:00.000Z",
      idFactory: () => "manual_v2_vitrine_falha"
    }, {
      clienteTemRecurso: () => true,
      montarOfertaVitrine: (oferta) => ({ idPublico: oferta.id, ofertaId: oferta.id, titulo: oferta.titulo }),
      upsertOfertaVitrine: () => {
        throw new Error("falha_storage_vitrine_teste");
      }
    });
    const serverFalhaVitrine = await ouvir(appFalhaVitrine);

    try {
      await request(serverFalhaVitrine, "PUT", "/manual-v2/config", "cliente_falha_vitrine", {
        automacoesNovasOfertas: {
          vitrine: { ativa: true }
        }
      });
      const resposta = await request(serverFalhaVitrine, "POST", "/manual-v2/ofertas", "cliente_falha_vitrine", {
        marketplace: "shopee",
        titulo: "Oferta preservada mesmo com falha de vitrine",
        precoAtual: "77,77"
      });
      assert.strictEqual(resposta.status, 201);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.vitrinePublicacao.ok, false);
      assert.strictEqual(resposta.body.vitrinePublicacao.motivo, "manual_v2_vitrine_derivacao_falhou");

      const lista = await request(serverFalhaVitrine, "GET", "/manual-v2/ofertas", "cliente_falha_vitrine");
      assert.deepStrictEqual(lista.body.ofertas.map(oferta => oferta.id), ["manual_v2_vitrine_falha"]);
    } finally {
      await new Promise(resolve => serverFalhaVitrine.close(resolve));
    }
  }

  {
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "modules", "manual-v2", "manual-offers.routes.js"),
      "utf8"
    );
    const proibidos = [
      "utils/fila-ofertas",
      "importarKabumManualRequest",
      "adicionarOfertaNaFila",
      "salvarFila",
      "processarFila",
      "prepararOfertaGlobal",
      "Distributor",
      "Engine",
      "Oferta Universal",
      "oferta-universal",
      "inteligencia-universal",
      "memoria-ofertas",
      "radar-ofertas",
      "/kabum/importar",
      "/fila",
      "/enviar-manual",
      "registrarRadarCupons"
    ];

    for (const termo of proibidos) {
      assert.ok(!fonte.includes(termo), `Rotas Manual V2 nao podem referenciar ${termo}`);
    }
  }

  assert.ok(fs.existsSync(DATA_DIR_TESTE), "DATA_DIR temporario deve existir");
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log("manual-v2-routes.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
