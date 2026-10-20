const assert = require("assert");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-achados-actions-"));

const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");
const storage = require("../modules/manual-v2/manual-offers.storage");
const { getClienteJsonPath } = require("../utils/storage");

const clienteId = "cliente_a";
const achadoId = "achado-amazon-1";
const destinoId = "wa_a";
const linkAfiliado = "https://go.optimus.test/amazon/1";

const achado = {
  id: achadoId,
  clienteId,
  marketplace: "amazon",
  titulo: "Oferta teste Achados",
  produtoId: "asin-1",
  identidadeProdutoVerificada: { marketplace: "amazon", id: "asin-1" },
  categoria: "Informática",
  precoAtual: 99.9,
  cupom: "CUPOM10",
  imagem: "https://img.optimus.test/1.png",
  urlOriginal: "https://amazon.test/dp/asin-1",
  urlAfiliada: linkAfiliado,
  afiliacaoWorkspace: {
    workspaceId: clienteId,
    urlAfiliadaWorkspace: linkAfiliado,
    conversaoStatus: "convertida"
  },
  capturadoEm: new Date().toISOString(),
  ultimaObservacaoEm: new Date().toISOString()
};
fs.mkdirSync(path.dirname(getClienteJsonPath(clienteId, "manual_achados_v2.json")), { recursive: true });
fs.writeFileSync(getClienteJsonPath(clienteId, "manual_achados_v2.json"), JSON.stringify([achado]));

const destinosPorCliente = {
  [clienteId]: [{
    id: destinoId,
    nome: "Destino A",
    tipo: "whatsapp",
    ativo: true,
    conexaoId: "sessao_a",
    gruposWhatsapp: ["grupo-a@g.us"]
  }]
};
let chamadasDispatcher = 0;
const app = express();
app.use(express.json());
app.use("/manual-v2", criarRotasManualV2({
  getClienteId: (req) => req.header("x-cliente-id") || clienteId,
  destinosPorCliente,
  sessoes: { sessao_a: {} },
  statusSessao: { sessao_a: "open" },
  getPlanoUsuario: () => ({ recursos: { whatsapp: true } }),
  enviarOfertaManualV2: async (entrada) => {
    chamadasDispatcher += 1;
    return {
      ok: true,
      ofertaId: entrada.ofertaId,
      enviados: 1,
      erros: 0,
      creditosDebitados: 1,
      resultados: [{ destinoId, nome: "Destino A", tipo: "whatsapp", status: "enviado", enviadoEm: new Date().toISOString() }]
    };
  },
  usuarioTemCreditos: () => true,
  storageOptions: { now: () => new Date().toISOString() }
}));

function ouvir() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function requisitar(server, method, url, body, headers = {}) {
  const resposta = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    method,
    headers: { "content-type": "application/json", "x-cliente-id": clienteId, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: resposta.status, body: await resposta.json() };
}

(async () => {
  const server = await ouvir();
  try {
    const produto = await requisitar(server, "GET", `/manual-v2/achados/${achadoId}/produto`);
    assert.strictEqual(produto.status, 200);
    assert.strictEqual(produto.body.produto.urlAfiliada, linkAfiliado);

    fs.writeFileSync(getClienteJsonPath(clienteId, "manual_achados_v2.json"),
      JSON.stringify([{ ...achado, urlAfiliada: "not-a-url" }]));
    const linkIndisponivel = await requisitar(server, "GET", `/manual-v2/achados/${achadoId}/produto`);
    assert.strictEqual(linkIndisponivel.status, 422, "link ausente ou inválido não abre destino");
    fs.writeFileSync(getClienteJsonPath(clienteId, "manual_achados_v2.json"), JSON.stringify([achado]));

    const chave = "achado-action-test-0001";
    const primeiro = await requisitar(server, "POST", `/manual-v2/achados/${achadoId}/enviar-agora`,
      { destinosIds: [destinoId] }, { "Idempotency-Key": chave });
    assert.strictEqual(primeiro.status, 200);
    assert.strictEqual(primeiro.body.envio.enviados, 1);
    assert.strictEqual(chamadasDispatcher, 1, "o primeiro envio usa o dispatcher existente");

    const repetido = await requisitar(server, "POST", `/manual-v2/achados/${achadoId}/enviar-agora`,
      { destinosIds: [destinoId] }, { "Idempotency-Key": chave });
    assert.strictEqual(repetido.status, 200);
    assert.strictEqual(repetido.body.idempotencyReplayed, true);
    assert.strictEqual(chamadasDispatcher, 1, "retry idempotente não dispara novamente");

    const outroCliente = await requisitar(server, "GET", `/manual-v2/achados/${achadoId}/produto`, undefined,
      { "x-cliente-id": "cliente_b" });
    assert.strictEqual(outroCliente.status, 404, "Achado não atravessa workspaces");
    assert.strictEqual(storage.listarOfertasManuaisV2IncluindoTecnicas(clienteId).length, 1);
    console.log("manual-v2-achados-actions.test.js ok");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
