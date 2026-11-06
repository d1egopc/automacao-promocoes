"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDirAnterior = process.env.DATA_DIR;
const dataDirTeste = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-magalu-aliexpress-focal-"));
process.env.DATA_DIR = dataDirTeste;

const { writeGlobalJson } = require("../utils/storage");
const { escolherProdutoPrincipal } = require("../modules/engine/link-role.service");
const { importarProdutoMagaluEngine } = require("../modules/engine/importer/adapters/magalu.adapter");
const { validarOfertaParaDistribuicao } = require("../modules/engine/distributor/distributor.service");
const {
  diagnosticarProvaAfiliacaoWorkspaceAliExpress
} = require("../modules/marketplaces/aliexpress/afiliacao-workspace");

const WORKSPACE = "user_focal_magalu_aliexpress";

function destino(extra = {}) {
  return {
    id: "destino-magalu-focal",
    generation: "g17",
    nome: "Destino sanitizado",
    ativo: true,
    marketplaces: ["mercadolivre"],
    categorias: ["Eletronicos"],
    ...extra
  };
}

async function main() {
  writeGlobalJson("usuarios.json", [{ id: WORKSPACE, ativo: true, plano: "pro" }]);

  const apenasAuxiliares = escolherProdutoPrincipal([
    { url: "https://www.magazineluiza.com.br/cupom", campo: "links_extraidos" },
    { url: "https://www.magazineluiza.com.br/categoria", campo: "links_extraidos" }
  ], "magalu", {});
  assert.strictEqual(apenasAuxiliares.url, "");
  assert.strictEqual(apenasAuxiliares.papelLinkMotivo, "sem_link_produto_entre_links_auxiliares");

  const produtoComAuxiliar = escolherProdutoPrincipal([
    { url: "https://www.magazineluiza.com.br/categoria", campo: "links_extraidos" },
    { url: "https://www.magazineluiza.com.br/produto/panelux/p/abc123", campo: "links_extraidos" }
  ], "magalu", {});
  assert.strictEqual(produtoComAuxiliar.papelLink, "produto");
  assert.match(produtoComAuxiliar.url, /\/p\/abc123$/);

  const importacaoApenasAuxiliares = await importarProdutoMagaluEngine({
    job: { id: 752, evento_id: 752, cliente_id: WORKSPACE, marketplace: "magalu" },
    evento: {
      texto_original: "Oferta sanitizada sem preco informado",
      links_extraidos: [
        "https://www.magazineluiza.com.br/cupom",
        "https://www.magazineluiza.com.br/categoria"
      ]
    },
    links: [
      { url_original: "https://www.magazineluiza.com.br/cupom" },
      { url_original: "https://www.magazineluiza.com.br/categoria" }
    ],
    deps: {}
  });
  assert.strictEqual(importacaoApenasAuxiliares.ok, false);
  assert.strictEqual(importacaoApenasAuxiliares.motivo, "sem_link_produto_entre_links_auxiliares");
  assert.ok(importacaoApenasAuxiliares.metadata.linksClassificados.some(item => item.papelLink === "categoria"));

  const elegibilidade = await validarOfertaParaDistribuicao({
    id: 216019,
    job_id: 216019,
    evento_id: 216019,
    cliente_id: WORKSPACE,
    marketplace: "magalu",
    titulo: "Produto sanitizado",
    categoria: "Eletronicos",
    origem: "optimus"
  }, {
    clientesValidos: [WORKSPACE],
    marketplacesAtivosPorCliente: { [WORKSPACE]: { magalu: true } },
    destinosPorCliente: { [WORKSPACE]: [destino()] },
    validarCreditos: () => ({ ok: true })
  });
  assert.strictEqual(elegibilidade.ok, false);
  assert.strictEqual(elegibilidade.motivo, "marketplace_bloqueado");
  assert.deepStrictEqual(elegibilidade.detalhes.elegibilidadeTrace, {
    escopo: "destinos",
    marketplace: "magalu",
    globalMarketplaceAtivo: true,
    origem: "optimus",
    categoria: "Eletronicos",
    destinos: [{
      destinoId: "destino-magalu-focal",
      geracao: "g17",
      marketplacePermitido: false,
      origemPermitida: true,
      motivo: "marketplace"
    }]
  });

  const provaIncompleta = diagnosticarProvaAfiliacaoWorkspaceAliExpress({
    workspaceId: WORKSPACE,
    appKey: "app-sanitizado",
    trackingIdEnviado: "tracking-sanitizado",
    origemConversao: "workspace_api",
    conversaoStatus: "falhou",
    urlAfiliadaWorkspace: ""
  }, {
    clienteId: WORKSPACE,
    credenciais: { appKey: "app-sanitizado", trackingId: "tracking-sanitizado" }
  });
  assert.strictEqual(provaIncompleta.valida, false);
  assert.deepStrictEqual(provaIncompleta.missing.sort(), ["conversaoStatus", "urlAfiliadaWorkspace"]);
  assert.doesNotMatch(JSON.stringify(provaIncompleta), /secret|token|appSecret/i);

  console.log("MAGALU_ALIEXPRESS_FOCAL_TEST_PASS");
}

main()
  .finally(() => {
    if (dataDirAnterior === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = dataDirAnterior;
  })
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
