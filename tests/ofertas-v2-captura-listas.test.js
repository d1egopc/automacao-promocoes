const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-captura-listas-"));

const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");
const listas = require("../modules/manual-v2/ofertas-v2-listas");
const manual = require("../modules/manual-v2/manual-offers.storage");
const { ordenarElegiveis } = require("../modules/manual-v2/manual-auto-dispatch");
const { criarProvaAfiliacaoWorkspaceAliExpress } =
  require("../modules/marketplaces/aliexpress/afiliacao-workspace");
const { criarProvaAfiliacaoWorkspaceMagalu, PROOF_TYPE_DETERMINISTIC_WORKSPACE } =
  require("../modules/marketplaces/magalu/afiliacao-workspace");

function ouvir(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, metodo, caminho, clienteId, body) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${caminho}`, {
    method: metodo,
    headers: {
      "x-cliente-id": clienteId,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const segredoAnterior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "segredo_captura_lista";
  const workspace = "user_captura_lista";
  const outroWorkspace = "user_captura_lista_outro";
  const credenciais = { appKey: "app_lista", trackingId: "tracking_lista", secret: "secret_lista" };
  const produtoId = "1005001234567890";
  const urlOriginal = `https://pt.aliexpress.com/item/${produtoId}.html`;
  const urlAfiliada = "https://s.click.aliexpress.com/e/_captura_lista";
  const prova = criarProvaAfiliacaoWorkspaceAliExpress({
    clienteId: workspace,
    credenciais,
    urlOriginal,
    urlAfiliadaWorkspace: urlAfiliada,
    papel: "produto",
    conversaoStatus: "convertida",
    motivoConversao: "link_aliexpress_convertido_workspace"
  });
  const oferta = {
    clienteId: outroWorkspace,
    marketplace: "aliexpress",
    produtoId,
    urlOriginal,
    urlAfiliada,
    titulo: "Produto editado na extensao",
    precoAtual: "117,00",
    cupom: "BRCD1",
    observacoes: "Brasil sem imposto adicional",
    taxa: "Impostos incluidos",
    afiliacaoWorkspaceVerificada: prova,
    fonteImportacao: { adapter: "optimus_capture_v1", marketplaceDetectado: "aliexpress" }
  };
  const app = express();
  app.use(express.json());
  app.use("/manual-v2", criarRotasManualV2({
    getClienteId: (req) => req.header("x-cliente-id") || "",
    getIntegracaoCliente: (_clienteId, marketplace) => {
      if (marketplace === "aliexpress") return { credenciais };
      if (marketplace === "magalu") return { credenciais: { promoterId: "d1egopc" } };
      return null;
    }
  }));
  const server = await ouvir(app);

  try {
    const lista = listas.criarLista(workspace, "Capturas");
    const resposta = await request(server, "POST", `/manual-v2/listas/${lista.id}/itens`, workspace, {
      origem: "captura_extensao",
      oferta
    });
    assert.strictEqual(resposta.status, 200);
    assert.strictEqual(resposta.body.ok, true);
    assert.strictEqual(resposta.body.lista.itens.length, 1);

    const itemPersistido = listas.lerListas(workspace)[0].itens[0];
    assert.strictEqual(itemPersistido.origem, "captura_extensao");
    assert.strictEqual(itemPersistido.oferta.clienteId, workspace, "workspace vem da autenticacao");
    assert.strictEqual(itemPersistido.oferta.titulo, oferta.titulo);
    assert.strictEqual(itemPersistido.oferta.cupom, oferta.cupom);
    assert.strictEqual(itemPersistido.oferta.observacoes, oferta.observacoes);
    assert.strictEqual(itemPersistido.oferta.taxa, oferta.taxa);
    assert.strictEqual(itemPersistido.oferta.urlAfiliada, urlAfiliada);

    const ofertasHttp = await request(server, "GET", "/manual-v2/ofertas", workspace);
    assert.strictEqual(ofertasHttp.status, 200);
    assert.deepStrictEqual(ofertasHttp.body.ofertas, [], "+ Lista nao cria registro em Ofertas");
    assert.deepStrictEqual(ordenarElegiveis(manual.listarOfertasManuaisV2(workspace)), [],
      "+ Lista nao cria elegivel para Auto Dispatcher");

    const duplicada = await request(server, "POST", `/manual-v2/listas/${lista.id}/itens`, workspace, {
      origem: "captura_extensao",
      oferta: { ...oferta, titulo: "Titulo alterado", precoAtual: "119,00", cupom: "OUTRO" }
    });
    assert.strictEqual(duplicada.status, 409);
    assert.strictEqual(duplicada.body.motivo, "item_ja_na_lista");
    assert.strictEqual(listas.lerListas(workspace)[0].itens.length, 1);
    assert.strictEqual(manual.listarOfertasManuaisV2(workspace).length, 0,
      "duplicidade e detectada antes de qualquer persistencia em Ofertas");
    const equivalenteCanonica = await request(server, "POST", `/manual-v2/listas/${lista.id}/itens`, workspace, {
      origem: "captura_extensao",
      oferta: { ...oferta, produtoId: "", urlOriginal: `${urlOriginal}?utm_source=extensao` }
    });
    assert.strictEqual(equivalenteCanonica.status, 409,
      "URL canonica equivalente mantem a mesma identidade sem depender de campos editaveis");
    assert.strictEqual(listas.lerListas(workspace)[0].itens.length, 1);

    const provaOutroWorkspace = criarProvaAfiliacaoWorkspaceAliExpress({
      clienteId: outroWorkspace,
      credenciais,
      urlOriginal,
      urlAfiliadaWorkspace: urlAfiliada,
      papel: "produto",
      conversaoStatus: "convertida"
    });
    const listaInvalida = listas.criarLista(workspace, "Provas invalidas");
    const workspaceInvalido = await request(server, "POST", `/manual-v2/listas/${listaInvalida.id}/itens`, workspace, {
      origem: "captura_extensao",
      oferta: { ...oferta, afiliacaoWorkspaceVerificada: provaOutroWorkspace }
    });
    assert.strictEqual(workspaceInvalido.status, 422);
    assert.strictEqual(workspaceInvalido.body.motivo, "afiliacao_workspace_incompleta");
    const provaAdulterada = await request(server, "POST", `/manual-v2/listas/${listaInvalida.id}/itens`, workspace, {
      origem: "captura_extensao",
      oferta: { ...oferta, afiliacaoWorkspaceVerificada: { ...prova, assinatura: "adulterada" } }
    });
    assert.strictEqual(provaAdulterada.status, 422);
    assert.strictEqual(listas.lerListas(workspace)[1].itens.length, 0);

    const produtoMagalu = "ja0j4j69f1";
    const originalMagalu = `https://www.magazineluiza.com.br/produto/divulgador/oferta/${produtoMagalu}/pf/copr/?promoter_id=5438968&partner_id=3440`;
    const afiliadaMagalu = `https://www.magazinevoce.com.br/d1egopc/produto/p/${produtoMagalu}/pf/copr/`;
    const provaMagalu = criarProvaAfiliacaoWorkspaceMagalu({
      clienteId: workspace,
      promoterId: "d1egopc",
      productId: produtoMagalu,
      urlOriginal: originalMagalu,
      urlAfiliadaWorkspace: afiliadaMagalu,
      proofType: PROOF_TYPE_DETERMINISTIC_WORKSPACE,
      urlConstruidaPor: "magalu_deterministic_builder_v1"
    });
    const listaMagalu = listas.criarLista(workspace, "Magalu direto");
    const capturaMagalu = {
      marketplace: "magalu",
      produtoId: produtoMagalu,
      urlOriginal: originalMagalu,
      urlAfiliada: afiliadaMagalu,
      titulo: "Produto Magalu",
      precoAtual: "15,90",
      afiliacaoWorkspaceVerificada: provaMagalu
    };
    await listas.adicionarItem(workspace, listaMagalu.id,
      { origem: "captura_extensao", oferta: capturaMagalu },
      { getIntegracaoCliente: () => ({ credenciais: { promoterId: "d1egopc" } }) });
    await assert.rejects(() => listas.adicionarItem(workspace, listaMagalu.id,
      { origem: "captura_extensao", oferta: { ...capturaMagalu, titulo: "Titulo editado" } },
      { getIntegracaoCliente: () => ({ credenciais: { promoterId: "d1egopc" } }) }), /item_ja_na_lista/);
    assert.strictEqual(listas.lerListas(workspace)[2].itens.length, 1,
      "Magalu usa productId comprovado pela prova assinada para dedupe");

    const listaLegada = listas.criarLista(workspace, "Origem Ofertas");
    const ofertaLegada = manual.criarOfertaManualV2(workspace, {
      marketplace: "amazon",
      produtoId: "B0ABC12345",
      urlOriginal: "https://www.amazon.com.br/dp/B0ABC12345",
      urlAfiliada: "https://amzn.to/B0ABC12345",
      titulo: "Oferta salva explicitamente",
      precoAtual: "99,90"
    });
    await listas.adicionarItem(workspace, listaLegada.id, { origem: "ofertas", ofertaId: ofertaLegada.id });
    assert.strictEqual(listas.lerListas(workspace)[3].itens[0].origem, "ofertas",
      "contrato Ofertas para Lista permanece intacto");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (segredoAnterior === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = segredoAnterior;
  }
}

main().then(() => {
  console.log("ofertas-v2-captura-listas.test.js: PASS");
}).catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
