const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-captura-listas-"));

const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");
const listas = require("../modules/manual-v2/ofertas-v2-listas");
const manual = require("../modules/manual-v2/manual-offers.storage");
const { componentesIdentidadeCanonica, identidadeCanonica, idProdutoPorUrl } =
  require("../modules/manual-v2/ofertas-v2-identidade");
const { urlMercadoLivreSegura } = require("../modules/manual-v2/manual-capture.service");
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

    const urlMlbCatalogo = "https://www.mercadolivre.com.br/produto/p/MLB24000050";
    const urlMlbDireta = "https://produto.mercadolivre.com.br/MLB-5287366788-produto-_JM";
    const urlMlbSemHifen = "https://produto.mercadolivre.com.br/MLB5287366788-produto-_JM";
    assert.strictEqual(idProdutoPorUrl("mercadolivre", urlMlbCatalogo), "mlb24000050");
    assert.strictEqual(idProdutoPorUrl("mercadolivre", urlMlbDireta), "mlb5287366788");
    assert.strictEqual(urlMercadoLivreSegura(urlMlbDireta).ok, true);
    const mlBase = { marketplace: "mercadolivre", urlOriginal: urlMlbDireta,
      urlAfiliada: "https://meli.la/captura-ml", titulo: "Produto ML", precoAtual: "59,90" };
    assert.strictEqual(componentesIdentidadeCanonica({ ...mlBase, produtoId: "MLB-5287366788" }).identidadeProduto,
      "mlb5287366788");
    assert.strictEqual(identidadeCanonica({ ...mlBase, produtoId: "MLB-5287366788" }),
      identidadeCanonica({ ...mlBase, urlOriginal: urlMlbSemHifen, produtoId: "MLB5287366788" }));
    assert.strictEqual(componentesIdentidadeCanonica({ ...mlBase, produtoId: "MLB24000050" }), null);
    assert.strictEqual(componentesIdentidadeCanonica({ ...mlBase, identidadeProdutoVerificada:
      { origem: "engine_importer", marketplace: "mercadolivre", id: "MLB-5287366788" } }).identidadeProduto,
      "mlb5287366788");
    assert.strictEqual(componentesIdentidadeCanonica({ ...mlBase, identidadeProdutoVerificada:
      { origem: "engine_importer", marketplace: "mercadolivre", id: "MLB24000050" } }), null);
    assert.strictEqual(componentesIdentidadeCanonica({ ...mlBase, urlAfiliada:
      "https://produto.mercadolivre.com.br/MLB-24000050-outro-_JM" }), null);
    assert.strictEqual(componentesIdentidadeCanonica({ ...mlBase, urlOriginal:
      "https://www.mercadolivre.com.br/produto-sem-id", produtoId: "MLB5287366788" }), null);
    assert.strictEqual(componentesIdentidadeCanonica({ ...mlBase, urlOriginal:
      "https://www.mercadolivre.com.br/produto-sem-id", produtoId: "",
      urlAfiliada: "https://produto.mercadolivre.com.br/MLB-5287366788-produto-_JM" }), null);
    assert.strictEqual(idProdutoPorUrl("mercadolivre",
      "https://www.mercadolivre.com.br/social?item=MLB5287366788"), "");

    const listaMl = listas.criarLista(workspace, "Mercado Livre direto");
    const capturaMl = await request(server, "POST", `/manual-v2/listas/${listaMl.id}/itens`, workspace, {
      origem: "captura_extensao", oferta: { ...mlBase, produtoId: "MLB-5287366788" }
    });
    assert.strictEqual(capturaMl.status, 200);
    assert.strictEqual(capturaMl.body.lista.itens.length, 1);
    const mlDuplicada = await request(server, "POST", `/manual-v2/listas/${listaMl.id}/itens`, workspace, {
      origem: "captura_extensao", oferta: { ...mlBase, urlOriginal: urlMlbSemHifen,
        produtoId: "MLB5287366788" }
    });
    assert.strictEqual(mlDuplicada.status, 409);
    assert.strictEqual(mlDuplicada.body.motivo, "item_ja_na_lista");
    const mlDivergente = await request(server, "POST", `/manual-v2/listas/${listaMl.id}/itens`, workspace, {
      origem: "captura_extensao", oferta: { ...mlBase, produtoId: "MLB24000050" }
    });
    assert.strictEqual(mlDivergente.status, 422);
    assert.strictEqual(mlDivergente.body.motivo, "produto_sem_identidade_operacional");
    assert.strictEqual(listas.lerListas(workspace).find((item) => item.id === listaMl.id).itens.length, 1);
    assert.strictEqual(manual.listarOfertasManuaisV2(workspace).length, 1,
      "+ Lista ML nao cria Oferta alem da Oferta legada salva explicitamente");
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
