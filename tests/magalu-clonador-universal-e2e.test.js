"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const fs = require("fs");
const path = require("path");

const dataDirAnterior = process.env.DATA_DIR;
const raizTemporaria = path.join(__dirname, ".tmp-magalu-clonador-e2e");
fs.mkdirSync(raizTemporaria, { recursive: true });
const dataDirTeste = fs.mkdtempSync(path.join(raizTemporaria, "run-"));
process.env.DATA_DIR = dataDirTeste;

const { writeGlobalJson } = require("../utils/storage");
writeGlobalJson("usuarios.json", [
  { id: "user_pss60lus", ativo: true, plano: "pro" },
  { id: "workspace_isolada", ativo: true, plano: "pro" }
]);

const { criarBridgeClonadorGrupos } = require("../modules/clonador-grupos/bridge");
const {
  resolverRedirectClonador,
  resolverRedirectUniversal
} = require("../modules/radar/redirect/redirect-resolver");
const { importarProdutoMagaluEngine } = require("../modules/engine/importer/adapters/magalu.adapter");
const {
  montarOfertaUniversalEngine,
  validarContratoOfertaUniversal
} = require("../modules/engine/oferta-universal.contract");
const { validarOfertaParaDistribuicao } = require("../modules/engine/distributor/distributor.service");

const ONE_LINK = "https://magazineluiza.onelink.me/589508454/92egbh6h";
const PRODUTO = "https://www.magazineluiza.com.br/amendoim-japones-mendorato-101kg/p/238765400/me/amnd/";
const AFILIADO = "https://www.magazinevoce.com.br/magazined1egopc/amendoim-japones-mendorato/p/238765400/me/amnd/";

function transporteHttpSeguro(rotas = {}) {
  return function requestImpl(url, _opcoes, callback) {
    const req = new EventEmitter();
    req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    req.end = () => {
      const respostaDefinida = rotas[url.href] || { status: 404, body: "" };
      const res = new PassThrough();
      res.statusCode = respostaDefinida.status;
      res.headers = respostaDefinida.location ? { location: respostaDefinida.location } : {};
      res.complete = true;
      callback(res);
      process.nextTick(() => res.end(respostaDefinida.body || ""));
    };
    return req;
  };
}

function depsHttp(rotas) {
  return {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    requestImpl: transporteHttpSeguro(rotas)
  };
}

function repoMemoria() {
  const item = {
    id: "captura-tim-1",
    clienteId: "user_pss60lus",
    sessaoId: "sessao_tim",
    grupoJid: "grupo_pesca@g.us",
    grupoNome: "Grupo sanitizado",
    mensagemId: "msg-magalu-1",
    textoOriginal: `Amendoim Japonês Mendorato 1,01 kg\nPor R$ 19,99\n${ONE_LINK}`,
    links: [ONE_LINK],
    capturadoEm: "2026-11-07T01:03:27.000Z",
    status: "capturada",
    metadata: {}
  };
  return {
    item,
    async listarDestinos() { return [{ destinoId: "op-clonador" }]; },
    async reivindicarProximaCaptura() {
      if (item.status !== "capturada") return null;
      item.status = "processando";
      return JSON.parse(JSON.stringify(item));
    },
    async atualizarBufferStatus(_id, status, metadata) {
      item.status = status;
      item.metadata = { ...item.metadata, ...metadata };
      return JSON.parse(JSON.stringify(item));
    }
  };
}

function respostaFactual(clienteId) {
  const urlAfiliada = clienteId === "user_pss60lus"
    ? AFILIADO
    : "https://www.magazinevoce.com.br/outra-loja/amendoim-japones/p/238765400/me/amnd/";
  return {
    ok: true,
    produtoId: "238765400",
    fonteUsada: "magazinevoce_workspace",
    fatos: {
      urlOriginal: PRODUTO,
      urlCanonica: urlAfiliada,
      urlAfiliavelComprovada: urlAfiliada,
      magaluWorkspaceValidado: true,
      produtoId: "238765400",
      codigo: "238765400",
      titulo: "Título oficial da página",
      precoAtual: "R$ 25,90",
      imagem: "https://a-static.mlcdn.com.br/amendoim-238765400.jpg",
      categoria: "Alimentos",
      seller: "Magalu",
      avisos: [],
      metadata: { fontes: { urlCanonica: "canonical" } }
    },
    avisos: []
  };
}

async function main() {
  const rotas = {
    [ONE_LINK]: { status: 302, location: PRODUTO },
    [PRODUTO]: { status: 200, body: "<html><title>produto oficial</title></html>" }
  };
  const safeHttpDeps = depsHttp(rotas);

  const resolucao = await resolverRedirectClonador(ONE_LINK, { safeHttpDeps });
  assert.strictEqual(resolucao.ok, true);
  assert.strictEqual(resolucao.marketplaceDetectado, "magalu");
  assert.strictEqual(resolucao.urlExpandida, PRODUTO);
  assert.strictEqual(resolucao.provaProduto.chave, "magalu:238765400");
  const resolucaoUniversal = await resolverRedirectUniversal(ONE_LINK, { safeHttpDeps });
  assert.strictEqual(resolucaoUniversal.ok, true);
  assert.strictEqual(resolucaoUniversal.urlExpandida, PRODUTO);

  const repo = repoMemoria();
  let eventoRegistrado = null;
  const bridge = criarBridgeClonadorGrupos({
    repository: repo,
    resolverRedirectUniversal: url => resolverRedirectClonador(url, { safeHttpDeps }),
    registrarEventoBruto: async evento => {
      eventoRegistrado = evento;
      return { ok: true, id: 217119, jobsCriados: 1, jobsExistentes: 0 };
    },
    logger: { log() {} }
  });
  const bridgeResultado = await bridge.processarCapturasPendentes({ limite: 1 });
  assert.strictEqual(bridgeResultado.prontas, 1);
  assert.deepStrictEqual(eventoRegistrado.linksExtraidos, [PRODUTO]);
  assert.strictEqual(eventoRegistrado.marketplaceDetectado, "magalu");
  assert.strictEqual(eventoRegistrado.metadata.clonadorGrupos.redirects[0].status, "resolvido");
  assert.strictEqual(eventoRegistrado.metadata.comercialCapturado.precoAtual, 19.99);

  const link = {
    id: 1,
    url_original: ONE_LINK,
    url_normalizada: ONE_LINK,
    url_expandida: PRODUTO,
    marketplace_detectado: "magalu",
    redirect_ok: true,
    metadata: {}
  };
  const evento = {
    id: 217119,
    origem: "clonador_grupos",
    origem_tipo: "whatsapp",
    texto_original: repo.item.textoOriginal,
    links_extraidos: [PRODUTO],
    metadata: eventoRegistrado.metadata
  };
  const importada = await importarProdutoMagaluEngine({
    job: { id: 1077564, evento_id: 217119, cliente_id: "user_pss60lus", marketplace: "magalu" },
    evento,
    links: [link],
    deps: {
      getIntegracaoCliente(clienteId, marketplace) {
        assert.strictEqual(clienteId, "user_pss60lus");
        assert.strictEqual(marketplace, "magalu");
        return { credenciais: { promoterId: "d1egopc" } };
      },
      resolverFatosMagalu: async () => respostaFactual("user_pss60lus")
    }
  });
  assert.strictEqual(importada.ok, true);
  assert.strictEqual(importada.preco, 19.99, "preço capturado deve prevalecer sobre a página");
  assert.strictEqual(importada.titulo, "Amendoim Japonês Mendorato 1,01 kg");
  assert.strictEqual(importada.linkAfiliado, AFILIADO);
  assert.strictEqual(importada.metadata.afiliacaoWorkspace.workspaceId, "user_pss60lus");

  const universal = montarOfertaUniversalEngine({
    oferta: { ...importada, id: 7001, origem: "clonador_grupos", origemFluxo: "clonador_grupos" },
    ofertaEntrada: importada,
    job: { id: 1077564, evento_id: 217119, cliente_id: "user_pss60lus", marketplace: "magalu" },
    evento,
    link,
    metadata: { ...importada.metadata, origemFluxo: "clonador_grupos" }
  });
  assert.deepStrictEqual(validarContratoOfertaUniversal(universal), { ok: true, status: "validada", motivos: [] });
  assert.strictEqual(universal.comercial.precoAtual, 19.99);
  assert.strictEqual(universal.afiliacao.urlAfiliada, AFILIADO);

  const ofertaDistribuicao = {
    id: 7001,
    job_id: 1077564,
    evento_id: 217119,
    cliente_id: "user_pss60lus",
    marketplace: "magalu",
    titulo: importada.titulo,
    categoria: "Alimentos",
    origem: "clonador_grupos",
    origemFluxo: "clonador_grupos",
    preco: importada.preco,
    link_afiliado: importada.linkAfiliado,
    metadata: eventoRegistrado.metadata
  };
  const destino = {
    id: "op-clonador",
    nome: "OP Clonador",
    ativo: true,
    tipo: "whatsapp",
    marketplaces: ["mercadolivre", "shopee", "amazon", "aliexpress", "awin", "magalu"],
    categorias: ["Alimentos"],
    origemOfertas: "clonador",
    sessaoId: "sessao_tim",
    grupos: ["grupo_destino@g.us"]
  };
  const elegibilidade = await validarOfertaParaDistribuicao(ofertaDistribuicao, {
    clientesValidos: ["user_pss60lus"],
    marketplacesAtivosPorCliente: { user_pss60lus: ["magalu"] },
    destinosPorCliente: { user_pss60lus: [destino] },
    validarCreditos: async () => ({ ok: true })
  });
  assert.strictEqual(elegibilidade.ok, true);
  assert.strictEqual(elegibilidade.destinosCompativeis, 1);

  const isolamento = await importarProdutoMagaluEngine({
    job: { id: 1077565, evento_id: 217120, cliente_id: "workspace_isolada", marketplace: "magalu" },
    evento,
    links: [link],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { promoterId: "outra-loja" } }),
      resolverFatosMagalu: async () => respostaFactual("workspace_isolada")
    }
  });
  assert.strictEqual(isolamento.ok, true);
  assert.notStrictEqual(isolamento.linkAfiliado, AFILIADO);
  assert.strictEqual(isolamento.metadata.afiliacaoWorkspace.workspaceId, "workspace_isolada");

  const malicioso = await resolverRedirectUniversal(ONE_LINK, {
    safeHttpDeps: depsHttp({
      [ONE_LINK]: { status: 302, location: "http://127.0.0.1/admin" }
    })
  });
  assert.strictEqual(malicioso.ok, false);
  assert.strictEqual(malicioso.urlExpandida, "");

  const semProduto = await resolverRedirectUniversal(ONE_LINK, {
    safeHttpDeps: depsHttp({
      [ONE_LINK]: { status: 302, location: "https://www.magazineluiza.com.br/categoria/cozinha/" },
      "https://www.magazineluiza.com.br/categoria/cozinha/": { status: 200, body: "categoria" }
    })
  });
  assert.strictEqual(semProduto.ok, false);
  assert.strictEqual(semProduto.motivo, "magalu_onelink_sem_produto_confirmado");

  console.log("MAGALU_CLONADOR_UNIVERSAL_E2E_PASS");
}

main()
  .finally(() => {
    if (dataDirAnterior === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = dataDirAnterior;
    fs.rmSync(raizTemporaria, { recursive: true, force: true });
  })
  .catch(erro => {
    console.error(erro);
    process.exitCode = 1;
  });
