const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-ofertas-v2-"));

const { readClienteJson, writeClienteJson } = require("../utils/storage");
const manual = require("../modules/manual-v2/manual-offers.storage");
const achados = require("../modules/manual-v2/ofertas-v2-achados");
const listas = require("../modules/manual-v2/ofertas-v2-listas");
const { ordenarElegiveis } = require("../modules/manual-v2/manual-auto-dispatch");
const { selecionarConteudoVivo } = require("../modules/engine/auto-clean/gc-reference-index");
const { criarProvaAfiliacaoWorkspaceShopee } = require("../modules/marketplaces/shopee/afiliacao-workspace");
const { criarProvaAfiliacaoWorkspaceAliExpress } = require("../modules/marketplaces/aliexpress/afiliacao-workspace");
const { resolverContratoComercialFinal } = require("../modules/templates-clientes/contrato-comercial-final");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");

const agora = Date.now();
const workspace = "user_ofertas_v2";
const outro = "user_outro_v2";
function universal(id, marketplace = "amazon", extras = {}) {
  return { ofertaId: id, workspaceId: workspace, marketplace,
    produto: { titulo: `Produto ${id}`, idExterno: `P${id}`, categoriaNormalizada: "Games e Console",
      urlCanonica: `https://www.amazon.com.br/dp/${id}` },
    comercial: { precoAtual: 99.9, precoAnterior: 120, cupom: extras.cupom || "",
      parcelamento: "2x sem juros", frete: "Frete grátis", beneficios: ["R$ 10 OFF no carrinho"] },
    midia: { imagemPrincipal: `https://exemplo.test/${id}.png` },
    afiliacao: { urlAfiliada: `https://amzn.to/${id}` },
    criadoEm: new Date(agora - (extras.idadeMs || 0)).toISOString() };
}
function registrar(id, mk = "amazon", extras = {}) {
  const u = universal(id, mk, extras);
  return achados.registrarAchado({ clienteId: workspace, ofertaId: id, ofertaUniversal: u,
    metadata: { ofertaUniversalValidacao: { ok: true } }, capturedAt: u.criadoEm });
}
function criarManual(id, produtoId = id, titulo = id) {
  return manual.criarOfertaManualV2(workspace, {
    id, marketplace: "amazon", produtoId, titulo,
    precoAtual: "99,90", urlOriginal: `https://www.amazon.com.br/dp/${produtoId}`,
    urlAfiliada: `https://amzn.to/${produtoId}`
  });
}
function depsDestinos(ids) {
  return { now: () => agora, listarDestinosManuaisV2Async: async () => ids.map((id) => ({
    id, nome: id, tipo: "telegram", utilizavel: true
  })) };
}

async function main() {
  assert.strictEqual(registrar("old", "amazon", { idadeMs: 49 * 3600000 }).ok, true);
  assert.strictEqual(achados.listarAchados(workspace).length, 0, "48h exclui achado velho");
  for (let n = 1; n <= 41; n += 1) registrar(String(n), "amazon", { cupom: n === 41 ? "CUPOM" : "" });
  assert.strictEqual(achados.listarAchados(workspace).length, 40, "máximo 40");
  assert(achados.listarAchados(workspace).some((item) => item.id === "41"), "cupom novo vence substituição");
  registrar("shop1", "shopee");
  assert.strictEqual(achados.listarAchados(workspace).length, 41, "marketplaces separados");
  assert.strictEqual(achados.listarAchados(workspace, { marketplace: "shopee" }).length, 1);
  assert.strictEqual(achados.listarAchados(workspace, { categoria: "Games e Console" }).length, 41);
  assert.strictEqual(achados.listarAchados(workspace, { busca: "produto shop1" }).length, 1);
  assert.strictEqual(achados.listarAchados(outro).length, 0, "workspace não vaza");
  assert.strictEqual(achados.registrarAchado({ clienteId: outro, ofertaId: "a",
    ofertaUniversal: universal("a"), metadata: { ofertaUniversalValidacao: { ok: true } } }).ok, false);

  const shopeeCred = { appId: "12345", secret: "segredo_teste_shopee" };
  const shopeeProduto = "https://s.shopee.com.br/produto_workspace";
  const shopeeResgate = "https://s.shopee.com.br/resgate_workspace";
  const shopeeProva = (original, afiliado, papel) => criarProvaAfiliacaoWorkspaceShopee({
    clienteId: workspace, credenciais: shopeeCred, urlOriginal: original,
    urlAfiliadaWorkspace: afiliado, urlFinalExpandida: `https://shopee.com.br/item?mmp_pid=an_${shopeeCred.appId}`,
    papel, motivoConversao: "teste_workspace_api"
  });
  const shopeeAchado = {
    id: "s1", marketplace: "shopee", titulo: "Produto Shopee", produtoId: "S1", precoAtual: 50,
    urlOriginal: "https://shopee.com.br/item", urlAfiliada: shopeeProduto,
    afiliacaoWorkspace: shopeeProva("https://shopee.com.br/item", shopeeProduto, "produto"),
    linksComerciais: [{ papel: "resgate", urlOriginal: "https://s.shopee.com.br/resgate_fonte",
      urlAfiliadaWorkspace: shopeeResgate, renderizavel: true, conversaoStatus: "convertida",
      afiliacaoWorkspace: shopeeProva("https://s.shopee.com.br/resgate_fonte", shopeeResgate, "resgate") }]
  };
  const depsShop = { getIntegracaoCliente: () => ({ credenciais: shopeeCred }) };
  const ofertaShop = await listas.ofertaDoAchado(shopeeAchado, workspace, depsShop);
  assert.strictEqual(ofertaShop.linkResgate, shopeeResgate, "resgate convertido preservado");
  const universalShop = universal("shop_assinado", "shopee");
  universalShop.produto.urlCanonica = shopeeAchado.urlOriginal;
  universalShop.afiliacao.urlAfiliada = shopeeProduto;
  assert.strictEqual(achados.registrarAchado({ clienteId: workspace, ofertaId: "shop_assinado",
    ofertaUniversal: universalShop, metadata: { ofertaUniversalValidacao: { ok: true },
      afiliacaoWorkspace: shopeeAchado.afiliacaoWorkspace,
      linksComerciais: shopeeAchado.linksComerciais } }).ok, true);
  const shopProjetado = await listas.ofertaDoAchado(achados.buscarAchado(workspace, "shop_assinado"), workspace, depsShop);
  assert.strictEqual(shopProjetado.linkResgate, shopeeResgate, "projeção compacta preserva HMAC");
  writeClienteJson(workspace, "integracoes.json", { shopee: { credenciais: shopeeCred } });
  assert.strictEqual(resolverContratoComercialFinal(ofertaShop).linksResgate[0]?.urlAfiliadaWorkspace,
    shopeeResgate, "renderer aceita resgate com HMAC válido");
  const textoShop = montarMensagemOferta(ofertaShop, { clienteId: workspace });
  assert(textoShop.includes(shopeeResgate),
    "mensagem final Shopee inclui resgate do workspace");
  assert(!textoShop.includes("resgate_fonte"), "mensagem final não reutiliza resgate da fonte");
  const landingResgate = "https://shopee.com.br/m/cupom-teste";
  const shopeeExpandido = await listas.ofertaDoAchado({ ...shopeeAchado, linksComerciais: [{
    ...shopeeAchado.linksComerciais[0], destinoFuncionalOriginal: { url: landingResgate },
    afiliacaoWorkspace: shopeeProva(landingResgate, shopeeResgate, "resgate")
  }] }, workspace, depsShop);
  assert.strictEqual(resolverContratoComercialFinal(shopeeExpandido).linksResgate[0]?.urlAfiliadaWorkspace,
    shopeeResgate, "shortlink fonte com landing expandida mantém prova HMAC");
  const shopPersistida = manual.criarOfertaManualV2(workspace, { ...ofertaShop, origemAgendamento: "lista_v2" });
  assert.strictEqual(resolverContratoComercialFinal(manual.buscarOfertaManualV2(workspace, shopPersistida.id))
    .linksResgate[0]?.urlAfiliadaWorkspace, shopeeResgate,
  "normalização/persistência Manual preserva a prova do resgate");
  assert.strictEqual(resolverContratoComercialFinal({ ...ofertaShop, linksComerciais: [] }).linksResgate.length,
    0, "linkResgate isolado não contorna o HMAC");
  await assert.rejects(() => listas.ofertaDoAchado(shopeeAchado, outro, depsShop),
    /afiliacao_workspace_incompleta/, "prova de outro workspace não autoriza CTA");
  await assert.rejects(() => listas.ofertaDoAchado({ ...shopeeAchado,
    linksComerciais: [{ ...shopeeAchado.linksComerciais[0],
      afiliacaoWorkspace: shopeeProva("https://s.shopee.com.br/resgate_fonte", shopeeResgate, "produto") }]
  }, workspace, depsShop), /achado_cta_contextual_incompleto/, "papel produto não autoriza resgate");
  await assert.rejects(() => listas.ofertaDoAchado({ ...shopeeAchado,
    linksComerciais: [{ ...shopeeAchado.linksComerciais[0], urlAfiliadaWorkspace: "https://s.shopee.com.br/fonte_crua" }]
  }, workspace, depsShop), /achado_cta_contextual_incompleto/, "link da fonte não é reutilizado");

  const aliCred = { appKey: "key_test", secret: "segredo_teste_ali", trackingId: "workspace_track" };
  const aliProva = (original, afiliado, papel) => criarProvaAfiliacaoWorkspaceAliExpress({
    clienteId: workspace, credenciais: aliCred, urlOriginal: original, urlAfiliadaWorkspace: afiliado,
    papel, conversaoStatus: "convertida", motivoConversao: "teste_workspace_api"
  });
  const aliAchado = { id: "a1", marketplace: "aliexpress", titulo: "Produto Ali", produtoId: "A1", precoAtual: 50,
    urlOriginal: "https://aliexpress.com/item/1", urlAfiliada: "https://a.aliexpress.com/_workspace_produto",
    afiliacaoWorkspace: aliProva("https://aliexpress.com/item/1", "https://a.aliexpress.com/_workspace_produto", "produto"),
    linksComerciais: [
      { papel: "app", urlOriginal: "https://a.aliexpress.com/_fonte_app", urlAfiliadaWorkspace: "https://a.aliexpress.com/_workspace_app",
        renderizavel: true, conversaoStatus: "convertida", afiliacaoWorkspace: aliProva("https://a.aliexpress.com/_fonte_app", "https://a.aliexpress.com/_workspace_app", "link_app") },
      { papel: "pc", urlOriginal: "https://a.aliexpress.com/_fonte_pc", urlAfiliadaWorkspace: "https://a.aliexpress.com/_workspace_pc",
        renderizavel: true, conversaoStatus: "convertida", afiliacaoWorkspace: aliProva("https://a.aliexpress.com/_fonte_pc", "https://a.aliexpress.com/_workspace_pc", "link_pc") }
    ] };
  const ofertaAli = await listas.ofertaDoAchado(aliAchado, workspace, {
    getIntegracaoCliente: () => ({ credenciais: aliCred })
  });
  const universalAli = universal("ali_assinado", "aliexpress");
  universalAli.produto.urlCanonica = aliAchado.urlOriginal;
  universalAli.afiliacao.urlAfiliada = aliAchado.urlAfiliada;
  achados.registrarAchado({ clienteId: workspace, ofertaId: "ali_assinado",
    ofertaUniversal: universalAli, metadata: { ofertaUniversalValidacao: { ok: true },
      afiliacaoWorkspace: aliAchado.afiliacaoWorkspace, linksComerciais: aliAchado.linksComerciais } });
  const aliProjetado = await listas.ofertaDoAchado(achados.buscarAchado(workspace, "ali_assinado"), workspace,
    { getIntegracaoCliente: () => ({ credenciais: aliCred }) });
  assert.strictEqual(aliProjetado.linkApp, ofertaAli.linkApp);
  assert.strictEqual(aliProjetado.linkPC, ofertaAli.linkPC);
  assert.strictEqual(ofertaAli.linkApp, "https://a.aliexpress.com/_workspace_app");
  assert.strictEqual(ofertaAli.linkPC, "https://a.aliexpress.com/_workspace_pc");
  assert.notStrictEqual(ofertaAli.linkApp, ofertaAli.linkPC);
  const aliPcPrincipal = await listas.ofertaDoAchado({ ...aliAchado,
    urlAfiliada: "https://a.aliexpress.com/_workspace_pc", afiliacaoWorkspace: {},
  }, workspace, { getIntegracaoCliente: () => ({ credenciais: aliCred }) });
  assert.strictEqual(aliPcPrincipal.linkApp, ofertaAli.linkApp, "APP não some quando PC é principal técnico");
  assert.strictEqual(aliPcPrincipal.linkPC, ofertaAli.linkPC, "PC preserva seu papel como CTA");
  assert.strictEqual(aliPcPrincipal.afiliacaoWorkspaceVerificada.principal.papel, "link_pc",
    "PC não é rebatizado como Produto para salvar oferta");
  const urlCompartilhada = "https://a.aliexpress.com/_workspace_compartilhada";
  const originalCompartilhado = "https://a.aliexpress.com/_fonte_compartilhada";
  const aliMesmaUrl = await listas.ofertaDoAchado({ ...aliAchado, linksComerciais: [
    { papel: "app", urlOriginal: originalCompartilhado, urlAfiliadaWorkspace: urlCompartilhada,
      renderizavel: true, conversaoStatus: "convertida",
      afiliacaoWorkspace: aliProva(originalCompartilhado, urlCompartilhada, "link_app") },
    { papel: "pc", urlOriginal: originalCompartilhado, urlAfiliadaWorkspace: urlCompartilhada,
      renderizavel: true, conversaoStatus: "convertida",
      afiliacaoWorkspace: aliProva(originalCompartilhado, urlCompartilhada, "link_pc") }
  ] }, workspace, { getIntegracaoCliente: () => ({ credenciais: aliCred }) });
  assert.strictEqual(aliMesmaUrl.linksComerciais.filter((item) => ["link_app", "link_pc"].includes(item.papel)).length,
    2, "mesma URL em papéis diferentes não é deduplicada por URL");
  const contratoAli = resolverContratoComercialFinal(ofertaAli);
  assert.strictEqual(contratoAli.contratoComercialFinal.linksApp.length, 1, "APP permanece no contrato final");
  assert.strictEqual(contratoAli.contratoComercialFinal.linksPc.length, 1, "PC permanece no contrato final");
  const textoAli = montarMensagemOferta(ofertaAli, { clienteId: workspace });
  assert(textoAli.includes(ofertaAli.linkApp) && textoAli.includes(ofertaAli.linkPC),
    "mensagem final AliExpress mantém APP e PC");
  assert(!textoAli.includes("_fonte_app") && !textoAli.includes("_fonte_pc"),
    "mensagem final AliExpress não reutiliza tracking da fonte");
  const meliAchado = await listas.ofertaDoAchado({ id: "meli", marketplace: "mercadolivre",
    titulo: "Produto Meli", produtoId: "MLB123456", precoAtual: 80,
    urlOriginal: "https://www.mercadolivre.com.br/MLB123456",
    urlAfiliada: "https://meli.la/principal-workspace", cupom: "MELI10",
    linksComerciais: [{ papel: "resgate", urlOriginal: "https://meli.la/fonte-crua",
      renderizavel: true, conversaoStatus: "convertida" }]
  }, workspace);
  assert.strictEqual(meliAchado.linkResgate, "", "Meli não ganha resgate incompatível");
  assert.strictEqual(meliAchado.urlAfiliada, "https://meli.la/principal-workspace");
  const aliPersistida = manual.criarOfertaManualV2(workspace, { ...ofertaAli, origemAgendamento: "lista_v2" });
  const contratoAliPersistido = resolverContratoComercialFinal(manual.buscarOfertaManualV2(workspace, aliPersistida.id));
  assert.strictEqual(contratoAliPersistido.contratoComercialFinal.linksApp.length, 1);
  assert.strictEqual(contratoAliPersistido.contratoComercialFinal.linksPc.length, 1);

  const l1 = listas.criarLista(workspace, "Hardware");
  assert.strictEqual(l1.nome, "Hardware");
  listas.renomearLista(workspace, l1.id, "Hardware 2");
  assert.strictEqual(listas.listarListas(workspace)[0].nome, "Hardware 2");
  const ofertaX = criarManual("manual_x", "B0ABCD0001", "Título A");
  await listas.adicionarItem(workspace, l1.id, { origem: "ofertas", ofertaId: ofertaX.id });
  assert.strictEqual(listas.listarListas(workspace)[0].itens.length, 1);
  const achado = achados.buscarAchado(workspace, "41");
  assert(achado);
  assert.strictEqual(achado.parcelamento, "2x sem juros");
  assert.strictEqual(achado.frete, "Frete grátis");
  await listas.adicionarItem(workspace, l1.id, { origem: "achados", ofertaId: "41" });
  assert.strictEqual(listas.listarListas(workspace)[0].itens[1].origem, "achados");
  assert.strictEqual(listas.lerListas(workspace)[0].itens[1].oferta.beneficioTexto, "R$ 10 OFF no carrinho");
  assert.strictEqual(listas.listarListas(outro).length, 0);
  const itemId = listas.listarListas(workspace)[0].itens[1].id;
  listas.removerItem(workspace, l1.id, itemId);
  assert.strictEqual(listas.listarListas(workspace)[0].itens.length, 1);
  for (let n = 0; n < 5; n += 1) listas.criarLista(workspace, `Lista ${n}`);
  assert.throws(() => listas.criarLista(workspace, "Excedente"), /limite_de_6_listas/);
  assert.strictEqual(listas.listarListas(workspace).length, 6, "reload/restart lê persistência");

  const l2 = listas.listarListas(workspace)[1];
  const ofertaMesmoProduto = criarManual("manual_x2", "B0ABCD0001", "Outro título");
  await listas.adicionarItem(workspace, l2.id, { origem: "ofertas", ofertaId: ofertaMesmoProduto.id });
  const l3 = listas.listarListas(workspace)[2];
  const ofertaOutroProduto = criarManual("manual_y", "B0ABCD0002", "Título A");
  await listas.adicionarItem(workspace, l3.id, { origem: "ofertas", ofertaId: ofertaOutroProduto.id });
  assert.strictEqual(listas.identidadeCanonica(ofertaX), listas.identidadeCanonica(ofertaMesmoProduto),
    "URL oficial com ID valido une o mesmo produto");
  assert.notStrictEqual(listas.identidadeCanonica(ofertaX), listas.identidadeCanonica(ofertaOutroProduto), "título igual não colide");
  assert.strictEqual(listas.identidadeCanonica({ marketplace: "amazon", produtoId: "B0ABC12345",
    urlOriginal: "https://www.amazon.com.br/dp/B0ABC12345?tag=fonte" }),
  listas.identidadeCanonica({ marketplace: "amazon", urlOriginal: "https://amazon.com.br/dp/B0ABC12345?utm_source=extensao" }),
  "URL canônica une extensão sem ID e Achado com ID");

  await listas.reservarDestinos(workspace, l1.id, ["A"], 240000, depsDestinos(["A", "B"]));
  await assert.rejects(() => listas.reservarDestinos(workspace, l2.id, ["A"], 240000, depsDestinos(["A", "B"])),
    /destino_em_uso_pela_lista/);
  await listas.reservarDestinos(workspace, l2.id, ["B"], 300000, depsDestinos(["A", "B"]));
  let chamadas = 0;
  const enviar = async ({ destinosIds }) => {
    chamadas += 1;
    return { enviados: destinosIds.length, erros: 0, creditosDebitados: destinosIds.length,
      resultados: destinosIds.map((destinoId) => ({ destinoId, nome: destinoId, tipo: "telegram", status: "enviado",
        enviadoEm: new Date(agora).toISOString() })) };
  };
  await Promise.all([
    listas.processarLista(workspace, l1.id, { now: () => agora, enviarOfertaManualV2: enviar }),
    listas.processarLista(workspace, l2.id, { now: () => agora, enviarOfertaManualV2: enviar })
  ]);
  assert.strictEqual(chamadas, 2, "listas simultâneas em destinos distintos");
  assert.strictEqual(listas.listarListas(workspace)[0].itens[0].status, "enviado");
  assert(manual.listarOfertasManuaisV2(workspace).some((item) => item.status === "enviada"), "histórico Manual existente");
  assert.strictEqual(ordenarElegiveis([{ status: "salva", origemAgendamento: "lista_v2" }]).length, 0,
    "clone salvo por crash não entra no auto-dispatch");
  assert.strictEqual(ordenarElegiveis([{ status: "salva" }]).length, 1, "manual normal permanece elegível");
  assert.strictEqual(selecionarConteudoVivo([
    { capturadoEm: new Date(agora - 49 * 3600000).toISOString(), imagem: "velha" },
    { capturadoEm: new Date(agora).toISOString(), imagem: "viva" }
  ], "manual_achados_v2.json", "manual", agora).length, 1, "GC não protege Achado expirado");
  assert.strictEqual(selecionarConteudoVivo([{ itens: [
    { status: "aguardando", oferta: { imagem: "viva" } },
    { status: "enviado", terminalEm: agora - 8 * 86400000, oferta: { imagem: "velha" } }
  ] }], "manual_listas_v2.json", "manual", agora)[0].itens.length, 1,
  "GC preserva intenção ativa e deixa terminal antigo expirar");

  listas.interromperLista(workspace, l1.id, "pausada");
  await listas.reservarDestinos(workspace, l3.id, ["A"], 240000, depsDestinos(["A", "B"]));
  const pulou = await listas.processarLista(workspace, l3.id, { now: () => agora, enviarOfertaManualV2: enviar });
  assert.strictEqual(pulou.motivo, "despachado", "produto diferente no mesmo destino passa");

  // O mesmo produto, vindo de outra lista, no mesmo destino, é pulado; destino B permanece permitido.
  listas.interromperLista(workspace, l3.id, "pausada");
  await listas.reservarDestinos(workspace, l2.id, ["A"], 240000, depsDestinos(["A", "B"]));
  const repetido = await listas.processarLista(workspace, l2.id, { now: () => agora, enviarOfertaManualV2: enviar });
  assert.strictEqual(repetido.motivo, "repetido");
  assert.strictEqual(chamadas, 3, "repetido não envia");

  listas.interromperLista(workspace, l2.id, "parada");
  listas.esvaziarLista(workspace, l2.id);
  assert.strictEqual(listas.listarListas(workspace)[1].itens.length, 0, "lista vazia reutilizável");
  listas.excluirLista(workspace, l2.id);
  assert.strictEqual(listas.listarListas(workspace).length, 5);

  // Integração local: Lista alimenta o Dispatcher Manual real, sem segundo emissor.
  const workspaceDispatcher = "user_lista_dispatcher";
  const ofertaDispatcher = manual.criarOfertaManualV2(workspaceDispatcher, {
    marketplace: "amazon", produtoId: "B0ABC12345", titulo: "Produto no destino atual",
    precoAtual: 99, urlOriginal: "https://www.amazon.com.br/dp/B0ABC12345",
    urlAfiliada: "https://amzn.to/workspace-dispatcher"
  });
  const listaDispatcher = listas.criarLista(workspaceDispatcher, "Envio real mockado");
  await listas.adicionarItem(workspaceDispatcher, listaDispatcher.id,
    { origem: "ofertas", ofertaId: ofertaDispatcher.id });
  await listas.reservarDestinos(workspaceDispatcher, listaDispatcher.id, ["wa_lista"], 240000,
    depsDestinos(["wa_lista"]));
  const mensagensMock = [];
  const destinoAtual = { id: "wa_lista", nome: "WA atual", tipo: "whatsapp", ativo: true,
    conexaoId: "sessao_lista", gruposWhatsapp: ["grupo-teste@g.us"], tipoMidia: "texto" };
  const resultadoReal = await listas.processarLista(workspaceDispatcher, listaDispatcher.id, {
    now: () => agora,
    getDestinosPorCliente: () => ({ [workspaceDispatcher]: [destinoAtual] }),
    sessoes: { sessao_lista: {} }, statusSessao: { sessao_lista: "open" },
    resolverPlanoManualV2: () => ({ recursos: { whatsapp: true } }),
    usuarioTemCreditos: () => true, debitarCreditos: () => true,
    montarMensagemOferta: (oferta, contexto) => `${contexto.destino.nome}: ${oferta.linkAfiliado}`,
    enviarWhatsApp: async (envio) => { mensagensMock.push(envio); }
  });
  assert.strictEqual(resultadoReal.resultado?.enviados, 1, "Dispatcher Manual enviou a destino atual");
  assert.strictEqual(mensagensMock.length, 1, "exatamente um envio mockado, sem rede");
  assert.match(mensagensMock[0].mensagem, /WA atual: https:\/\/amzn\.to\/workspace-dispatcher/);
  const depoisDuasHoras = agora + listas.DEDUPE_MS + 1;
  await listas.reservarDestinos(workspaceDispatcher, listaDispatcher.id, ["wa_lista"], 240000,
    { ...depsDestinos(["wa_lista"]), now: () => depoisDuasHoras });
  const segundaRodada = await listas.processarLista(workspaceDispatcher, listaDispatcher.id, {
    now: () => depoisDuasHoras,
    getDestinosPorCliente: () => ({ [workspaceDispatcher]: [destinoAtual] }),
    sessoes: { sessao_lista: {} }, statusSessao: { sessao_lista: "open" },
    resolverPlanoManualV2: () => ({ recursos: { whatsapp: true } }),
    usuarioTemCreditos: () => true, debitarCreditos: () => true,
    montarMensagemOferta: (oferta, contexto) => `${contexto.destino.nome}: ${oferta.linkAfiliado}`,
    enviarWhatsApp: async (envio) => { mensagensMock.push(envio); }
  });
  assert.strictEqual(segundaRodada.resultado?.enviados, 1, "após 2h o produto volta a ser elegível");
  assert.strictEqual(mensagensMock.length, 2);
  const simularRestart = listas.lerListas(workspaceDispatcher);
  simularRestart[0].status = "enviando";
  simularRestart[0].destinosIds = ["wa_lista"];
  simularRestart[0].itens[0].status = "aguardando";
  simularRestart[0].inFlight = { attemptId: "crash", itemId: simularRestart[0].itens[0].id,
    destinosIds: ["wa_lista"], manualId: "manual_crash" };
  writeClienteJson(workspaceDispatcher, listas.ARQUIVO_LISTAS, simularRestart);
  const recuperadas = listas.recuperarExecucoes(workspaceDispatcher);
  assert.strictEqual(recuperadas[0].status, "pausada", "restart pausa envio incerto");
  assert.deepStrictEqual(recuperadas[0].destinosIds, [], "restart libera reserva sem replay");
  assert.match(recuperadas[0].itens[0].motivo, /resultado_indeterminado/);
  await assert.rejects(() => listas.reservarDestinos(workspaceDispatcher, listaDispatcher.id,
    ["wa_lista"], 240000, depsDestinos(["wa_lista"])), /lista_resultado_indeterminado_requer_reconciliacao/);

  // JSON corrompido falha fechado, sem sobrescrever silenciosamente.
  const corrupto = path.join(process.env.DATA_DIR, "clientes", outro, listas.ARQUIVO_LISTAS);
  fs.writeFileSync(corrupto, "{invalid");
  assert.throws(() => listas.listarListas(outro), /listas_storage_corrompido/);
  assert.strictEqual(readClienteJson(workspace, listas.ARQUIVO_LISTAS, []).length, 5);
  assert.strictEqual(readClienteJson(workspace, achados.ARQUIVO_ACHADOS, []).length, 43);
  console.log("ofertas-v2-achados-listas.test.js ok");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
