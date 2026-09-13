"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const express = require("express");
const storageManual = require("../modules/manual-v2/manual-offers.storage");
const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");

const arquivos = new Map();
let sequencia = 0;
let agora = "2026-09-12T12:00:00.000Z";
const deps = {
  normalizarClienteId: (clienteId) => String(clienteId || "admin"),
  readClienteJson: (clienteId, arquivo, fallback) => {
    const valor = arquivos.get(`${clienteId}/${arquivo}`);
    return valor === undefined ? JSON.parse(JSON.stringify(fallback)) : JSON.parse(JSON.stringify(valor));
  },
  writeClienteJson: (clienteId, arquivo, valor) => {
    arquivos.set(`${clienteId}/${arquivo}`, JSON.parse(JSON.stringify(valor)));
  },
  now: () => agora,
  idFactory: () => `oferta_${++sequencia}`
};

async function requisicaoJson(baseUrl, path, body, chave = "") {
    const resposta = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(chave ? { "Idempotency-Key": chave } : {}) },
      body: JSON.stringify(body)
    });
    return { status: resposta.status, body: await resposta.json() };
}

async function executar() {
const oferta = {
  titulo: "Produto idempotente",
  marketplace: "shopee",
  preco: "99,90",
  produtoId: "sku-123",
  ean: "7890000000000",
  links: ["https://exemplo.test/a", "https://exemplo.test/b"]
};
const chaveSalvar = "a".repeat(64);

const primeira = storageManual.criarOfertaManualV2Idempotente("workspace_a", oferta, chaveSalvar, deps);
const retryAposRespostaPerdida = storageManual.criarOfertaManualV2Idempotente("workspace_a", oferta, chaveSalvar, deps);
assert.strictEqual(primeira.idempotencyReplayed, false);
assert.strictEqual(retryAposRespostaPerdida.idempotencyReplayed, true);
assert.strictEqual(retryAposRespostaPerdida.oferta.id, primeira.oferta.id, "retry deve recuperar a mesma oferta");
assert.strictEqual(storageManual.listarOfertasManuaisV2("workspace_a", deps).length, 1, "uma chave cria uma unica oferta");

const simultaneas = await Promise.all([
  Promise.resolve().then(() => storageManual.criarOfertaManualV2Idempotente("workspace_a", oferta, "b".repeat(64), deps)),
  Promise.resolve().then(() => storageManual.criarOfertaManualV2Idempotente("workspace_a", oferta, "b".repeat(64), deps))
]);
assert.strictEqual(simultaneas.filter((resultado) => !resultado.idempotencyReplayed).length, 1, "duas chamadas da mesma chave reservam uma criacao");
assert.strictEqual(simultaneas[0].oferta.id, simultaneas[1].oferta.id);

const reordenada = { ean: oferta.ean, links: oferta.links, preco: oferta.preco, marketplace: oferta.marketplace, titulo: oferta.titulo, produtoId: oferta.produtoId };
const replayReordenado = storageManual.criarOfertaManualV2Idempotente("workspace_a", reordenada, chaveSalvar, deps);
assert.strictEqual(replayReordenado.idempotencyReplayed, true, "ordem de chaves nao pode alterar fingerprint");
const conflito = storageManual.criarOfertaManualV2Idempotente("workspace_a", { ...oferta, preco: "89,90" }, chaveSalvar, deps);
assert.strictEqual(conflito.idempotencyConflict, true, "mesma chave com preco diferente deve conflitar");
assert.strictEqual(storageManual.listarOfertasManuaisV2("workspace_a", deps).length, 2, "conflito nao cria oferta");

const fingerprintBase = storageManual.fingerprintPayloadComercialManualV2({
  marketplace: "Mercado Livre", titulo: " Produto ", precoAtual: "R$ 99,90", observacoes: null, produtoId: "00123", precoPix: "99.9", taxa: "R$ 12,50"
});
for (const equivalente of [
  { titulo: "Produto", marketplace: "mercadolivre", precoAtual: 99.9, produtoId: "00123", precoPix: "R$ 99,90", taxa: "12,50" },
  { produtoId: "00123", marketplace: "ML", titulo: "Produto", precoAtual: "99,90", observacoes: undefined, precoPix: "99,90", taxa: 12.5 },
  { marketplace: "mercadolivre", titulo: "Produto", precoAtual: "99.90", produtoId: "00123", precoPix: "R$ 99,90", taxa: "R$ 12,50" }
]) {
  assert.strictEqual(storageManual.fingerprintPayloadComercialManualV2(equivalente), fingerprintBase, "representacoes comerciais equivalentes devem ter o mesmo fingerprint");
}
assert.notStrictEqual(storageManual.fingerprintPayloadComercialManualV2({ marketplace: "mercadolivre", titulo: "Produto", precoAtual: "99,90", produtoId: "123", precoPix: "99,90", taxa: "12,50" }), fingerprintBase, "identificador com zero a esquerda e comercialmente distinto");
assert.notStrictEqual(storageManual.fingerprintPayloadComercialManualV2({ marketplace: "mercadolivre", titulo: "Produto", precoAtual: "99,90", produtoId: "00123", precoPix: "98,90", taxa: "12,50" }), fingerprintBase, "preco Pix diferente conflita");
assert.notStrictEqual(storageManual.fingerprintPayloadComercialManualV2({ marketplace: "mercadolivre", titulo: "Produto", precoAtual: "99,90", produtoId: "00123", precoPix: "99,90", taxa: "13,50" }), fingerprintBase, "taxa diferente conflita");
assert.notStrictEqual(storageManual.fingerprintPayloadComercialManualV2({ marketplace: "mercadolivre", titulo: "Produto", precoAtual: "99,90", produtoId: "00123", precoPix: "99,90", taxa: "12,50", urlAfiliada: "https://exemplo.test/?tag=a" }), storageManual.fingerprintPayloadComercialManualV2({ marketplace: "mercadolivre", titulo: "Produto", precoAtual: "99,90", produtoId: "00123", precoPix: "99,90", taxa: "12,50", urlAfiliada: "https://exemplo.test/?tag=b" }), "tag afiliada diferente conflita");

const ofertaPix = { ...oferta, titulo: "Pix e taxa", precoPix: "R$ 90,00", taxa: "R$ 12,50", observacoes: "Observacao comercial" };
const pixPrimeira = storageManual.criarOfertaManualV2Idempotente("workspace_a", ofertaPix, "f".repeat(64), deps);
const pixReplay = storageManual.criarOfertaManualV2Idempotente("workspace_a", { ...ofertaPix, precoPix: "90.0", taxa: 12.5 }, "f".repeat(64), deps);
assert.strictEqual(pixReplay.idempotencyReplayed, true, "preco Pix equivalente faz replay");
assert.strictEqual(pixReplay.oferta.precoPix, "R$ 90,00");
assert.strictEqual(pixReplay.oferta.taxa, "R$ 12,50");
assert.strictEqual(storageManual.criarOfertaManualV2Idempotente("workspace_a", { ...ofertaPix, observacoes: "Outra observacao" }, "f".repeat(64), deps).idempotencyConflict, true, "observacao diferente conflita");
assert.strictEqual(storageManual.criarOfertaManualV2Idempotente("workspace_a", { ...ofertaPix, taxa: "R$ 13,50" }, "f".repeat(64), deps).idempotencyConflict, true, "taxa diferente retorna conflito");

const condicional = storageManual.criarOfertaManualV2("workspace_a", {
  ...oferta, titulo: "Condicional", precoPix: "R$ 90,00", taxa: "R$ 12,50", observacoes: "  Compra internacional  ", produtoId: "00123"
}, deps);
const condicionalRecuperada = storageManual.buscarOfertaManualV2("workspace_a", condicional.id, deps);
assert.strictEqual(condicionalRecuperada.precoPix, "R$ 90,00");
assert.strictEqual(condicionalRecuperada.taxa, "R$ 12,50");
assert.strictEqual(condicionalRecuperada.observacoes, "Compra internacional");
const semPixTaxa = storageManual.criarOfertaManualV2("workspace_a", { ...oferta, titulo: "Sem Pix Taxa", precoPix: null, taxa: null }, deps);
assert.strictEqual(semPixTaxa.precoPix, "", "ausencia de Pix nao vira zero");
assert.strictEqual(semPixTaxa.taxa, "", "ausencia de taxa nao vira zero");

const outroWorkspace = storageManual.criarOfertaManualV2Idempotente("workspace_b", oferta, chaveSalvar, deps);
assert.notStrictEqual(outroWorkspace.oferta.id, primeira.oferta.id, "a chave e isolada por workspace");

const reservaEnvio = storageManual.reservarEnvioManualV2Idempotente("workspace_a", primeira.oferta.id, "c".repeat(64), deps);
const retryEnvio = storageManual.reservarEnvioManualV2Idempotente("workspace_a", primeira.oferta.id, "c".repeat(64), deps);
assert.strictEqual(reservaEnvio.idempotencyReplayed, false);
assert.strictEqual(retryEnvio.idempotencyReplayed, true, "retry de envio nao pode solicitar novo envio");
assert.strictEqual(retryEnvio.envioEmAndamento, true);
assert.ok(reservaEnvio.oferta.idempotencia.enviar.attemptId, "tentativa deve ter attemptId");
assert.ok(reservaEnvio.oferta.idempotencia.enviar.leaseExpiraEm, "tentativa deve ter lease");

const falhaConfirmada = storageManual.marcarFalhaConfirmadaEnvioManualV2Idempotente(
  "workspace_a", primeira.oferta.id, reservaEnvio.oferta.idempotencia.enviar.attemptId, "falha_antes_do_dispatcher", deps
);
assert.strictEqual(falhaConfirmada.idempotencia.enviar.estado, "falha_confirmada");
const novaTentativa = storageManual.reservarEnvioManualV2Idempotente("workspace_a", primeira.oferta.id, "c".repeat(64), deps);
assert.notStrictEqual(novaTentativa.oferta.idempotencia.enviar.attemptId, reservaEnvio.oferta.idempotencia.enviar.attemptId);
assert.ok(storageManual.iniciarProcessamentoEnvioManualV2Idempotente(
  "workspace_a", primeira.oferta.id, novaTentativa.oferta.idempotencia.enviar.attemptId, deps
));
agora = "2026-09-12T12:03:00.000Z";
const expirada = storageManual.reservarEnvioManualV2Idempotente("workspace_a", primeira.oferta.id, "c".repeat(64), deps);
assert.strictEqual(expirada.motivo, "manual_v2_envio_resultado_indeterminado", "lease apos inicio externo nao pode reenviar");

const ofertaConcorrente = storageManual.criarOfertaManualV2("workspace_a", { ...oferta, titulo: "Envio concorrente" }, deps);
const reservasConcorrentes = await Promise.all([
  Promise.resolve().then(() => storageManual.reservarEnvioManualV2Idempotente("workspace_a", ofertaConcorrente.id, "e".repeat(64), deps)),
  Promise.resolve().then(() => storageManual.reservarEnvioManualV2Idempotente("workspace_a", ofertaConcorrente.id, "e".repeat(64), deps))
]);
assert.strictEqual(reservasConcorrentes.filter((resultado) => !resultado.idempotencyReplayed).length, 1, "duas reservas simultaneas produzem uma unica tentativa");
assert.strictEqual(reservasConcorrentes.filter((resultado) => resultado.idempotencyReplayed).length, 1);

const app = express();
app.use(express.json());
app.use(criarRotasManualV2({ getClienteId: () => "workspace_http", storageOptions: deps }));
const chaveHttp = "d".repeat(64);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolve) => servidor.once("listening", resolve));
try {
  const endereco = servidor.address();
  const baseUrl = `http://127.0.0.1:${endereco.port}`;
  const [primeiraHttp, replayHttp] = await Promise.all([
    requisicaoJson(baseUrl, "/ofertas", { oferta }, chaveHttp),
    requisicaoJson(baseUrl, "/ofertas", { oferta }, chaveHttp)
  ]);
  assert.deepStrictEqual([primeiraHttp.status, replayHttp.status].sort(), [200, 201], "uma rota cria e a outra faz replay");
  assert.strictEqual(primeiraHttp.body.oferta.id, replayHttp.body.oferta.id, "rotas simultaneas recuperam a mesma oferta");
  assert.strictEqual(storageManual.listarOfertasManuaisV2("workspace_http", deps).length, 1, "HTTP simultaneo persiste uma oferta");
  const conflitoHttp = await requisicaoJson(baseUrl, "/ofertas", { oferta: { ...oferta, cupom: "MUDOU" } }, chaveHttp);
  const clienteLegado = await requisicaoJson(baseUrl, "/ofertas", { oferta: { ...oferta, titulo: "Cliente legado" } });
  assert.strictEqual(conflitoHttp.status, 409);
  assert.strictEqual(conflitoHttp.body.erro, "idempotency_conflict");
  assert.strictEqual(clienteLegado.status, 201, "cliente sem Idempotency-Key permanece compativel");
} finally {
  await new Promise((resolve) => servidor.close(resolve));
}

const raiz = path.join(__dirname, "..");
const rotas = fs.readFileSync(path.join(raiz, "modules", "manual-v2", "manual-offers.routes.js"), "utf8");
const api = fs.readFileSync(path.join(raiz, "optimus-capture", "services", "api.js"), "utf8");
const painel = fs.readFileSync(path.join(raiz, "optimus-capture", "sidepanel", "panel.js"), "utf8");
assert.ok(rotas.includes('req?.get?.("Idempotency-Key")'), "backend deve ler Idempotency-Key");
assert.ok(rotas.includes("idempotencyReplayed"), "backend deve sinalizar replay");
assert.ok(api.includes('"Idempotency-Key"'), "extensao deve enviar o header");
assert.ok(painel.includes("saveIdempotencyKey"), "save deve reutilizar chave da captura");
assert.ok(painel.includes("envioIdempotencyKey"), "enviar agora deve reutilizar chave da tentativa");
assert.ok(painel.includes("Nao foi possivel confirmar o salvamento. Verificando..."), "falha ambigua deve verificar antes de declarar falha");
assert.ok(painel.includes("Os dados da oferta mudaram durante o salvamento"), "conflito deve ter mensagem especifica na extensao");

console.log("manual-v2-idempotency.test.js OK");
}

executar().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
