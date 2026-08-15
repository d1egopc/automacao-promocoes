const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-routes-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");
const {
  importarUrlManualV2
} = require("../modules/manual-v2/manual-import.adapters");
const {
  normalizarOfertaManualV2
} = require("../modules/manual-v2/manual-offers.contract");

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

function criarApp(chamadasImportacao = [], storageOptions = {}) {
  const app = express();
  const adapters = criarAdapters(chamadasImportacao);
  app.use(express.json());
  app.use("/manual-v2", criarRotasManualV2({
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

function arquivoCliente(clienteId, nome) {
  return getClienteJsonPath(clienteId, nome);
}

(async function main() {
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
      ["https://www.kabum.com.br/produto/944475/produto", "kabum"],
      ["https://www.magazineluiza.com.br/smart-tv/p/abc123/", "magalu"]
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
