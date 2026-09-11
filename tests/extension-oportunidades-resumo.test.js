const assert = require("assert");
const fs = require("fs");
const path = require("path");

const resumo = require("../modules/extension/oportunidades-resumo.service");
const oportunidadesClient = require("../optimus-capture/services/oportunidades");

const agora = new Date("2026-09-10T12:00:00.000Z");
const sinais = [
  {
    marketplace: "mercadolivre",
    quantidade: 3,
    mensagem: "Oportunidades disponíveis agora",
    urlDestino: "https://www.mercadolivre.com.br/ofertas",
    validoAte: "2026-09-10T12:10:00.000Z"
  },
  {
    marketplace: "shopee",
    quantidade: 4,
    urlDestino: "https://shopee.com.br/m/ofertas",
    validoAte: "2026-09-10T12:10:00.000Z"
  },
  {
    marketplace: "amazon",
    quantidade: 2,
    urlDestino: "https://www.amazon.com.br/deals",
    validoAte: "2026-09-10T12:10:00.000Z"
  },
  {
    marketplace: "aliexpress",
    quantidade: 0,
    urlDestino: "https://pt.aliexpress.com/",
    validoAte: "2026-09-10T12:10:00.000Z"
  },
  {
    marketplace: "kabum_awin",
    quantidade: 1,
    urlDestino: "https://evil.example/oferta",
    validoAte: "2026-09-10T12:10:00.000Z"
  },
  {
    marketplace: "amazon",
    quantidade: 1,
    urlDestino: "https://www.amazon.com.br/deals",
    validoAte: "2026-09-10T11:59:00.000Z"
  }
];

(async () => {
  const lista = await resumo.listarOportunidadesAtivas("cliente_a", {
    agora,
    listarSinais: () => sinais
  });
  assert.deepStrictEqual(lista.map((item) => item.marketplace).sort(), ["amazon", "mercadolivre", "shopee"]);
  assert.strictEqual(lista.find((item) => item.marketplace === "mercadolivre").quantidade, 3);
  assert.strictEqual(resumo.urlDestinoAutorizada("https://evil.example", "mercadolivre"), "");
  assert.strictEqual(resumo.urlDestinoAutorizada("http://www.amazon.com.br/deals", "amazon"), "");

  let agoraMs = 1_000;
  let chamadas = 0;
  const cliente = oportunidadesClient.criarClienteOportunidades({
    agora: () => agoraMs,
    api: {
      async listarResumoOportunidades() {
        chamadas += 1;
        return { ok: true, geradoEm: "2026-09-10T12:00:00.000Z", oportunidades: lista };
      }
    }
  });
  const primeira = await cliente.carregar("token");
  const segunda = await cliente.carregar("token");
  assert.strictEqual(primeira.cache, false);
  assert.strictEqual(segunda.cache, true);
  assert.strictEqual(chamadas, 1, "cache de 60s deve evitar chamada repetida");
  agoraMs += cliente.ttlMs + 1;
  await cliente.carregar("token");
  assert.strictEqual(chamadas, 2, "cache expirado deve consultar novamente");

  const expirado = oportunidadesClient.criarClienteOportunidades({
    api: {
      async listarResumoOportunidades() {
        const erro = new Error("sessao_expirada");
        erro.status = 401;
        throw erro;
      }
    }
  });
  assert.deepStrictEqual(await expirado.carregar("token"), {
    ok: false,
    sessaoExpirada: true,
    oportunidades: []
  });

  const urlsAbertas = [];
  assert.strictEqual(
    await oportunidadesClient.abrirUrlOportunidade({ create: async (opcoes) => urlsAbertas.push(opcoes) }, lista[0].urlDestino),
    true
  );
  assert.deepStrictEqual(urlsAbertas, [{ url: lista[0].urlDestino, active: true }]);
  assert.strictEqual(await oportunidadesClient.abrirUrlOportunidade({ create: async () => undefined }, "http://evil.example"), false);

  const raiz = path.join(__dirname, "..", "optimus-capture");
  const html = fs.readFileSync(path.join(raiz, "sidepanel", "panel.html"), "utf8");
  const painel = fs.readFileSync(path.join(raiz, "sidepanel", "panel.js"), "utf8");
  const api = fs.readFileSync(path.join(raiz, "services", "api.js"), "utf8");
  const index = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(html.includes('id="botaoOportunidades"'));
  assert.ok(html.includes('id="popoverOportunidades"'));
  assert.ok(painel.includes("chrome.tabs.create"));
  assert.ok(api.includes('"/extension/oportunidades/resumo"'));
  assert.ok(index.includes('app.get("/extension/oportunidades/resumo"'));
  console.log("extension-oportunidades-resumo.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
