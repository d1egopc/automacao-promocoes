const assert = require("assert");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-magalu-"));
process.env.JWT_SECRET = "manual_magalu_test_secret";

const storage = require("../modules/manual-v2/manual-offers.storage");
const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");
const { gerarPreviewCaptureManualV2 } = require("../modules/manual-v2/manual-capture.service");
const { enviarOfertaManualV2 } = require("../modules/manual-v2/manual-dispatcher");
const {
  validarOfertaAfiliacaoWorkspaceMagalu,
  PROOF_TYPE_DETERMINISTIC_WORKSPACE
} = require("../modules/marketplaces/magalu/afiliacao-workspace");
const { imagemMagaluPublicaSegura } = require("../modules/manual-v2/manual-offers.contract");

const urlOriginal = "https://www.magazineluiza.com.br/smart-tv-teste/p/afh3e1g80j/";
const baseEntrada = {
  marketplace: "magalu",
  urlOriginal,
  titulo: "Titulo corrigido pelo usuario",
  precoAtual: "999,90",
  precoAnterior: "1.299,90",
  precoPix: "899,90",
  cupom: "MAGALU10",
  categoria: "Eletronicos",
  seller: "Loja Oficial",
  parcelamento: "10x de R$ 99,90",
  imagem: "https://a-static.mlcdn.com.br/produto.jpg"
};

function integracao(promoterId) {
  return { credenciais: { promoterId } };
}

function depsPara(promoterId) {
  return {
    getIntegracaoCliente: () => integracao(promoterId),
    now: () => "2026-09-19T12:00:00.000Z",
    clienteId: "workspace_a"
  };
}

async function main() {
  const previewA = await gerarPreviewCaptureManualV2(baseEntrada, depsPara("d1egopc"));
  assert.strictEqual(previewA.ok, true);
  assert.strictEqual(previewA.oferta.titulo, baseEntrada.titulo, "valor humano deve sobreviver ao preview");
  assert.strictEqual(previewA.oferta.precoAnterior, "1.299,90");
  assert.strictEqual(previewA.oferta.precoPix, "899,90");
  assert.strictEqual(previewA.oferta.cupom, "MAGALU10");
  assert.strictEqual(previewA.oferta.categoria, "Eletronicos");
  assert.strictEqual(previewA.oferta.seller, "Loja Oficial");
  assert.strictEqual(previewA.oferta.parcelamento, "10x de R$ 99,90");
  assert.strictEqual(previewA.oferta.produtoId, "afh3e1g80j");
  assert.strictEqual(previewA.oferta.afiliacaoWorkspaceVerificada.proofType, PROOF_TYPE_DETERMINISTIC_WORKSPACE);
  assert.strictEqual(previewA.oferta.afiliacaoWorkspaceVerificada.paginaValidada, false);
  assert.ok(previewA.oferta.afiliacaoWorkspaceVerificada.assinatura);
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceMagalu(previewA.oferta, {
    clienteId: "workspace_a",
    promoterId: "d1egopc"
  }).ok, true);

  const faixaPreview = await gerarPreviewCaptureManualV2({
    ...baseEntrada,
    precoAtual: "",
    precoMin: "10,00",
    precoMax: "20,00",
    temVariacaoPreco: true
  }, depsPara("d1egopc"));
  assert.strictEqual(faixaPreview.oferta.precoAtual, "");
  assert.strictEqual(faixaPreview.oferta.precoMin, "10");
  assert.strictEqual(faixaPreview.oferta.precoMax, "20");
  assert.strictEqual(faixaPreview.oferta.temVariacaoPreco, true);

  assert.strictEqual(imagemMagaluPublicaSegura("https://a-static.mlcdn.com.br/produto.jpg"), true);
  assert.strictEqual(imagemMagaluPublicaSegura("https://mlcdn.com.br/produto.jpg"), true);
  assert.strictEqual(imagemMagaluPublicaSegura("https://evilmlcdn.com.br/produto.jpg"), false);
  assert.strictEqual(imagemMagaluPublicaSegura("https://mlcdn.com.br.evil.com/produto.jpg"), false);
  assert.strictEqual(imagemMagaluPublicaSegura("http://a-static.mlcdn.com.br/produto.jpg"), false);
  await assert.rejects(
    () => gerarPreviewCaptureManualV2({ ...baseEntrada, imagem: "https://images.example/externa.jpg" }, depsPara("d1egopc")),
    (erro) => erro.codigo === "imagem_magalu_invalida"
  );

  const previewB = await gerarPreviewCaptureManualV2(baseEntrada, {
    ...depsPara("outro_workspace"),
    clienteId: "workspace_b"
  });
  assert.strictEqual(previewB.ok, true);
  assert.notStrictEqual(previewA.oferta.urlAfiliada, previewB.oferta.urlAfiliada, "workspace deve definir afiliado distinto");
  assert.ok(previewA.oferta.urlAfiliada.includes("magazined1egopc"));
  assert.ok(previewB.oferta.urlAfiliada.includes("magazineoutro_workspace"));

  await assert.rejects(
    () => gerarPreviewCaptureManualV2(baseEntrada, {
      clienteId: "workspace_sem_integracao",
      getIntegracaoCliente: () => null
    }),
    (erro) => erro.codigo === "conversao_afiliada_indisponivel"
  );

  const storageOptions = {
    now: () => "2026-09-19T12:00:00.000Z",
    idFactory: () => "magalu_manual_1"
  };
  const salva = storage.criarOfertaManualV2("workspace_a", previewA.oferta, storageOptions);
  const recarregada = storage.buscarOfertaManualV2("workspace_a", salva.id, storageOptions);
  assert.strictEqual(recarregada.afiliacaoWorkspaceVerificada.productId, "afh3e1g80j");
  assert.strictEqual(recarregada.precoPix, "899,90");
  assert.strictEqual(recarregada.cupom, "MAGALU10");

  const app = express();
  app.use(express.json());
  app.use("/manual-v2", criarRotasManualV2({
    getClienteId: () => "workspace_a",
    exigirClienteAutenticado: () => "workspace_a",
    storageOptions,
    getIntegracaoCliente: () => integracao("d1egopc")
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const respostaSave = await fetch(`http://127.0.0.1:${server.address().port}/manual-v2/ofertas`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cliente-id": "workspace_a" },
      body: JSON.stringify({ oferta: { ...previewA.oferta, id: "magalu_route_save" } })
    });
    const corpoSave = await respostaSave.json();
    assert.strictEqual(respostaSave.status, 201);
    assert.strictEqual(corpoSave.oferta.afiliacaoWorkspaceVerificada.productId, "afh3e1g80j");
    assert.strictEqual(corpoSave.oferta.precoAnterior, "1.299,90");

    const respostaImagemInvalida = await fetch(`http://127.0.0.1:${server.address().port}/manual-v2/ofertas`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cliente-id": "workspace_a" },
      body: JSON.stringify({ oferta: { ...previewA.oferta, id: "magalu_route_bad_image", imagem: "https://images.example/externa.jpg" } })
    });
    const corpoImagemInvalida = await respostaImagemInvalida.json();
    assert.strictEqual(respostaImagemInvalida.status, 422);
    assert.strictEqual(corpoImagemInvalida.erro, "imagem_magalu_invalida");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  let envios = 0;
  const resultado = await enviarOfertaManualV2({
    clienteId: "workspace_a",
    ofertaId: salva.id,
    destinosIds: ["wa_magalu"]
  }, {
    buscarOfertaManualV2: storage.buscarOfertaManualV2,
    storageOptions,
    getIntegracaoCliente: () => integracao("d1egopc"),
    destinosPorCliente: {
      workspace_a: [{
        id: "wa_magalu",
        nome: "Grupo Magalu",
        tipo: "whatsapp",
        ativo: true,
        conexaoId: "sessao_a",
        gruposWhatsapp: ["grupo@g.us"]
      }]
    },
    sessoes: { sessao_a: {} },
    statusSessao: { sessao_a: "open" },
    plano: { recursos: { whatsapp: true } },
    usuarioTemCreditos: () => true,
    debitarCreditos: () => true,
    enviarWhatsApp: async () => { envios += 1; },
    montarMensagemOferta: (oferta) => oferta.titulo
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(envios, 1);

  const semProva = storage.criarOfertaManualV2("workspace_a", {
    ...baseEntrada,
    id: "magalu_sem_prova",
    urlAfiliada: urlOriginal,
    afiliacaoWorkspaceVerificada: null
  }, storageOptions);
  const semLink = storage.criarOfertaManualV2("workspace_a", {
    ...baseEntrada,
    id: "magalu_sem_link",
    urlAfiliada: "",
    afiliacaoWorkspaceVerificada: null
  }, storageOptions);
  assert.strictEqual(semLink.urlAfiliada, "", "Magalu sem afiliação não pode receber URL original como fallback");
  const bloqueada = await enviarOfertaManualV2({
    clienteId: "workspace_a",
    ofertaId: semProva.id,
    destinosIds: ["wa_magalu"]
  }, {
    buscarOfertaManualV2: storage.buscarOfertaManualV2,
    storageOptions,
    getIntegracaoCliente: () => integracao("d1egopc"),
    destinosPorCliente: { workspace_a: [{ id: "wa_magalu", nome: "Grupo", tipo: "whatsapp", ativo: true, conexaoId: "sessao_a", gruposWhatsapp: ["grupo@g.us"] }] },
    sessoes: { sessao_a: {} },
    statusSessao: { sessao_a: "open" },
    plano: { recursos: { whatsapp: true } },
    usuarioTemCreditos: () => true,
    debitarCreditos: () => true,
    enviarWhatsApp: async () => { throw new Error("sender_nao_deve_ser_chamado"); },
    montarMensagemOferta: () => "nao deveria"
  });
  assert.strictEqual(bloqueada.ok, false);
  assert.strictEqual(bloqueada.resultados[0].erro, "afiliacao_workspace_incompleta");
  console.log("manual-v2-magalu.test.js: ok");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
