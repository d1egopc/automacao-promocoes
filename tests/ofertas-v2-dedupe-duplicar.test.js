const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-achados-listas-v2-"));

const achados = require("../modules/manual-v2/ofertas-v2-achados");
const listas = require("../modules/manual-v2/ofertas-v2-listas");
const identidade = require("../modules/manual-v2/ofertas-v2-identidade");
const { writeClienteJson } = require("../utils/storage");

const agora = Date.now();

function universal({ workspaceId, ofertaId, marketplace, produtoId = "", titulo, url, cupom = "", imagem = "",
  imagemOrigem = "", categoria = "Moda", precoAtual = 100, precoAnterior = null }) {
  return {
    ofertaId,
    workspaceId,
    marketplace,
    produto: { titulo, idExterno: produtoId, categoriaNormalizada: categoria, urlCanonica: url },
    comercial: { precoAtual, precoAnterior, cupom, beneficios: [] },
    midia: { imagemPrincipal: imagem, origemImagem: imagemOrigem },
    afiliacao: { urlAfiliada: `${url}${url.includes("?") ? "&" : "?"}workspace=1` },
    criadoEm: new Date(agora).toISOString()
  };
}

function registrar(workspaceId, entrada, deslocamento = 0) {
  const ofertaUniversal = universal({ workspaceId, ...entrada });
  return achados.registrarAchado({
    clienteId: workspaceId,
    ofertaId: entrada.ofertaId,
    ofertaUniversal,
    metadata: { ...(entrada.metadata || {}), ofertaUniversalValidacao: { ok: true } },
    capturedAt: new Date(agora + deslocamento).toISOString()
  });
}

function main() {
  const workspaceMlb = "user_dedupe_mlb";
  registrar(workspaceMlb, { ofertaId: "meli-1", marketplace: "mercadolivre", produtoId: "MLB123456789",
    titulo: "Tênis Adidas Barreda*", url: "https://produto.mercadolivre.com.br/MLB123456789-item",
    cupom: "MELHORCUPOM", imagem: "https://img.test/antiga.jpg" }, 1);
  const atualizado = registrar(workspaceMlb, { ofertaId: "meli-2", marketplace: "mercadolivre", produtoId: "MLB123456789",
    titulo: "Tênis Adidas Barreda", url: "https://www.mercadolivre.com.br/MLB123456789",
    cupom: "ODESCONTOFICAMAIOR", imagem: "https://img.test/work.jpg" }, 2);
  const meli = achados.listarAchados(workspaceMlb, { nowMs: agora + 10 });
  assert.strictEqual(meli.length, 1, "mesmo MLB não cria outro card com título/asterisco/cupom diferentes");
  assert.strictEqual(meli[0].id, "meli-1", "identidade visual persistida do card permanece estável");
  assert.strictEqual(meli[0].titulo, "Tênis Adidas Barreda", "título Work/factual mais recente enriquece o card");
  assert.strictEqual(meli[0].imagem, "https://img.test/work.jpg", "imagem oficial mais recente enriquece o card");
  assert.strictEqual(meli[0].cupom, "ODESCONTOFICAMAIOR", "verdade comercial recente substitui, sem mesclar cupons");
  assert.strictEqual(atualizado.atualizado, true);
  assert.strictEqual(achados.listarAchados(workspaceMlb, { nowMs: agora + 10 }).length, 1,
    "reload da persistência mantém o dedupe");

  registrar(workspaceMlb, { ofertaId: "meli-3", marketplace: "mercadolivre", produtoId: "MLB987654321",
    titulo: "Tênis Adidas Barreda", url: "https://produto.mercadolivre.com.br/MLB987654321-item" }, 3);
  assert.strictEqual(achados.listarAchados(workspaceMlb, { nowMs: agora + 10 }).length, 2,
    "título e preço iguais não fundem MLBs diferentes");

  const workspaceMerge = "user_merge_enriquecimento";
  const urlMerge = "https://produto.mercadolivre.com.br/MLB222333444-item";
  registrar(workspaceMerge, { ofertaId: "merge-1", marketplace: "mercadolivre", produtoId: "MLB222333444",
    titulo: "Tenis Adidas Barreda*", url: urlMerge, categoria: "Diversos", precoAtual: 90,
    cupom: "ANTIGO" }, 1);
  registrar(workspaceMerge, { ofertaId: "merge-2", marketplace: "mercadolivre", produtoId: "MLB222333444",
    titulo: "Tenis Adidas Barreda", url: urlMerge, categoria: "Tênis e Chinelos", precoAtual: 100,
    cupom: "WORK10", imagem: "https://img.test/work-oficial.jpg",
    imagemOrigem: "local_worker.ml_identity_v1",
    metadata: { mlWorkEnrichmentActive: { identidadeValidada: true, tituloWorkAplicado: true } } }, 2);
  registrar(workspaceMerge, { ofertaId: "merge-3", marketplace: "mercadolivre", produtoId: "MLB222333444",
    titulo: "Tenis Adidas Barreda*", url: urlMerge, categoria: "Diversos", precoAtual: 120,
    precoAnterior: 140, cupom: "MAISNOVO", imagem: "" }, 3);
  const merge = achados.listarAchados(workspaceMerge, { nowMs: agora + 10 });
  assert.strictEqual(merge.length, 1, "observações do mesmo MLB continuam em um único card");
  assert.strictEqual(merge[0].id, "merge-1", "ID visível original permanece estável");
  assert.strictEqual(merge[0].titulo, "Tenis Adidas Barreda", "título Work não regride para versão com ruído");
  assert.strictEqual(merge[0].imagem, "https://img.test/work-oficial.jpg", "imagem oficial não regride para vazia");
  assert.strictEqual(merge[0].categoria, "Tênis e Chinelos", "categoria específica não regride para Diversos");
  assert.strictEqual(merge[0].precoAtual, 120, "preço comercial mais recente continua atualizando");
  assert.strictEqual(merge[0].precoAnterior, 140, "preço anterior comercial continua atualizando");
  assert.strictEqual(merge[0].cupom, "MAISNOVO", "cupom comercial mais recente continua atualizando");
  assert.strictEqual(achados.listarAchados(workspaceMerge, { nowMs: agora + 10 })[0].imagem,
    "https://img.test/work-oficial.jpg", "reload preserva o enriquecimento consolidado");

  const workspaceFallback = "user_dedupe_titulo";
  registrar(workspaceFallback, { ofertaId: "fallback-1", marketplace: "awin", titulo:
    "Kit 2 Camisetas Polo Manga Curta com Zíper", url: "https://loja.example/produto/a" }, 1);
  registrar(workspaceFallback, { ofertaId: "fallback-2", marketplace: "awin", titulo:
    "Kit 2 Camiseta Polo Manga Curta C/ Ziper*", url: "https://loja.example/produto/b" }, 2);
  assert.strictEqual(achados.listarAchados(workspaceFallback, { nowMs: agora + 10 }).length, 1,
    "sem identidade forte, títulos conservadoramente equivalentes compartilham um card");
  registrar(workspaceFallback, { ofertaId: "fallback-3", marketplace: "awin", titulo:
    "Kit 2 Camiseta Polo Manga Curta Premium", url: "https://loja.example/produto/c" }, 3);
  assert.strictEqual(achados.listarAchados(workspaceFallback, { nowMs: agora + 10 }).length, 2,
    "títulos apenas parecidos permanecem separados");
  assert.strictEqual(identidade.normalizarTituloConservador("Tênis Adidas Barreda*"),
    identidade.normalizarTituloConservador("Tenis Adidas Barreda"));
  assert.strictEqual(achados.TTL_ACHADOS_MS, 48 * 60 * 60 * 1000, "TTL permanece 48 horas");
  assert.strictEqual(achados.LIMITE_POR_MARKETPLACE, 40, "limite permanece 40 por marketplace");

  const workspaceLista = "user_duplicar_lista";
  const originalPublica = listas.criarLista(workspaceLista, "Lista D1EGOPC", { now: () => agora });
  const estado = listas.lerListas(workspaceLista);
  estado[0] = {
    ...estado[0], status: "enviando", destinosIds: ["destino-original"], intervaloMs: 300000,
    proximoEm: agora + 300000, pauseRequested: false,
    inFlight: { attemptId: "lease-antigo", itemId: "item-antigo", destinosIds: ["destino-original"] },
    itens: [{ id: "item-antigo", origem: "achados", origemId: "meli-1", canonicalKey: "produto-1",
      oferta: { titulo: "Produto", marketplace: "mercadolivre", precoAtual: 100 }, status: "enviado",
      motivo: "despachado", manualOfferId: "historico-antigo", terminalEm: agora - 1000 }]
  };
  writeClienteJson(workspaceLista, listas.ARQUIVO_LISTAS, estado);
  const copia = listas.duplicarLista(workspaceLista, originalPublica.id, { now: () => agora + 1000 });
  assert.strictEqual(copia.nome, "Lista D1EGOPC — cópia");
  assert.strictEqual(copia.status, "parada");
  assert.deepStrictEqual(copia.destinosIds, [], "destino original nunca é copiado");
  assert.strictEqual(copia.intervaloMs, 0);
  assert.strictEqual(copia.itens.length, 1);
  assert.strictEqual(copia.itens[0].status, "aguardando");
  const copiaInterna = listas.lerListas(workspaceLista).find((item) => item.id === copia.id);
  assert.strictEqual(copiaInterna.inFlight, undefined, "lease não é copiado");
  assert.strictEqual(copiaInterna.itens[0].manualOfferId, undefined, "histórico de envio não é copiado");
  assert.strictEqual(copiaInterna.itens[0].terminalEm, undefined, "timestamp operacional não é copiado");
  assert.notStrictEqual(copiaInterna.itens[0].id, "item-antigo", "cada item da cópia recebe novo ID");
  const segunda = listas.duplicarLista(workspaceLista, originalPublica.id, { now: () => agora + 2000 });
  assert.strictEqual(segunda.nome, "Lista D1EGOPC — cópia 2", "nomes de cópia não colidem");

  const rotas = fs.readFileSync(path.join(__dirname, "../modules/manual-v2/manual-offers.routes.js"), "utf8");
  assert(rotas.includes('router.post("/listas/:id/duplicar"'), "rota de duplicação usa o control plane existente");
  console.log("ofertas-v2-dedupe-duplicar.test.js ok");
}

main();
