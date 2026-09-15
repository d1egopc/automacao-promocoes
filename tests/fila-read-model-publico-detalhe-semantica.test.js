"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  VISAO_ENVIADAS,
  VISAO_PARCIAIS,
  VISAO_NAO_ENVIADAS,
  construirReadModelPublicoPorMarcos,
  resolverDetalhePublicoFilaPorRef,
  benchmarkDetalhePublicoFila,
  classificarUrlOferta
} = require("../modules/fila/fila-read-model-publico");

const AGORA = Date.parse("2026-09-15T15:00:00.000Z");

function iso(ms) {
  return new Date(ms).toISOString();
}

function oferta(id, extra = {}) {
  return {
    id,
    clienteId: "cliente_semantica",
    titulo: `Oferta ${id}`,
    marketplace: "amazon",
    preco: "R$ 99,90",
    categoria: "Casa",
    imagem: `https://cdn.optimus.test/${id}.jpg`,
    linkOriginal: `https://loja.test/produto/${id}`,
    dataEntradaFila: iso(AGORA - 60 * 60 * 1000),
    finalizadoEm: iso(AGORA - 30 * 60 * 1000),
    status: "erro_final",
    ...extra
  };
}

function registro(id, statusPublico, extra = {}) {
  const item = oferta(id, extra);
  return {
    chave: `chave_${id}`,
    clienteId: "cliente_semantica",
    id,
    statusPublico,
    statusOperacional: item.status,
    item
  };
}

function model(historicoLeve, visao) {
  return construirReadModelPublicoPorMarcos({
    clienteId: "cliente_semantica",
    hot: [],
    historicoLeve,
    projectionReady: true,
    agoraMs: AGORA,
    periodo: "7dias",
    visao
  });
}

{
  const todosAplicaveisEnviadosComNaoCompativel = registro("ok_nao_compativel", "parcial", {
    status: "enviado",
    enviadoEm: iso(AGORA - 20 * 60 * 1000),
    destinosEstado: [
      { destinoId: "aplicavel", destinoNome: "Aplicavel", canal: "telegram", estado: "enviado", enviadoEm: iso(AGORA) },
      { destinoId: "nao_compativel", destinoNome: "Nao compativel", canal: "discord", estado: "nao_compativel" },
      { destinoId: "nao_aplicavel", destinoNome: "Nao aplicavel", canal: "discord", estado: "nao_aplicavel" },
      { destinoId: "incompativel", destinoNome: "Incompativel", canal: "instagram", estado: "incompativel" },
      { destinoId: "bloqueado", destinoNome: "Bloqueado 2h", canal: "whatsapp", estado: "bloqueado_repeticao_2h" }
    ]
  });
  const enviadas = model([todosAplicaveisEnviadosComNaoCompativel], VISAO_ENVIADAS);
  assert.strictEqual(enviadas.metricas.enviadas, 1, "nao_compativel nao transforma envio correto em Parcial");
  assert.strictEqual(enviadas.metricas.parciais, 0);
  assert.strictEqual(enviadas.itens[0].statusPublico, "enviada", "status publico de sucesso deve ser Enviada");
}

{
  const parcialReal = registro("parcial_real", "parcial", {
    destinosEstado: [
      { destinoId: "ok", destinoNome: "OK", canal: "telegram", estado: "enviado", enviadoEm: iso(AGORA) },
      { destinoId: "erro", destinoNome: "Erro", canal: "whatsapp", estado: "erro_final" },
      { destinoId: "fora", destinoNome: "Fora", canal: "discord", estado: "nao_compativel" }
    ]
  });
  const parciais = model([parcialReal], VISAO_PARCIAIS);
  assert.strictEqual(parciais.metricas.parciais, 1, "sucesso em alguns aplicaveis e falha em outros aplicaveis vira Parcial");
  assert.strictEqual(parciais.itens[0].statusPublico, "erro", "Parcial interno deve aparecer publicamente como Erro");
}

{
  const nenhumAplicavel = registro("sem_aplicavel", "parcial", {
    destinosEstado: [
      { destinoId: "fora_1", destinoNome: "Fora 1", canal: "telegram", estado: "nao_compativel" },
      { destinoId: "fora_2", destinoNome: "Fora 2", canal: "discord", estado: "nao_compativel" }
    ]
  });
  const naoEnviadas = model([nenhumAplicavel], VISAO_NAO_ENVIADAS);
  assert.strictEqual(naoEnviadas.metricas.naoEnviadas, 1, "nenhum destino aplicavel nao pode virar Parcial");
  assert.strictEqual(naoEnviadas.itens[0].statusPublico, "erro", "Nao enviada interna deve aparecer publicamente como Erro");
}

{
  const falhaReal = registro("falha_real", "nao_enviado", {
    motivo: "erro_envio",
    destinosEstado: [
      { destinoId: "erro", destinoNome: "Erro", canal: "telegram", estado: "erro_final" },
      { destinoId: "fora", destinoNome: "Fora", canal: "discord", estado: "nao_compativel" }
    ]
  });
  const naoEnviadas = model([falhaReal], VISAO_NAO_ENVIADAS);
  assert.strictEqual(naoEnviadas.metricas.naoEnviadas, 1, "falha real sem aplicavel enviado vira Nao enviada");
}

{
  const hot = oferta("em_distribuicao", {
    status: "processando",
    finalizadoEm: "",
    enviadoEm: "",
    dataEntradaFila: iso(AGORA - 1000)
  });
  const readModel = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_semantica",
    hot: [hot],
    historicoLeve: [],
    projectionReady: true,
    agoraMs: AGORA
  });
  assert.strictEqual(readModel.metricas.processadas, 1);
  assert.strictEqual(readModel.metricas.emDistribuicao, 1, "sem terminal fica somente em distribuicao");
}

{
  const hotStale = oferta("stale_terminal", {
    status: "processando",
    finalizadoEm: "",
    enviadoEm: "",
    dataEntradaFila: iso(AGORA - 1000)
  });
  const terminal = registro("stale_terminal", "enviado", {
    status: "enviado",
    enviadoEm: iso(AGORA - 1000)
  });
  const readModel = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_semantica",
    hot: [hotStale],
    historicoLeve: [terminal],
    projectionReady: true,
    agoraMs: AGORA
  });
  assert.strictEqual(readModel.metricas.enviadas, 1);
  assert.strictEqual(readModel.metricas.emDistribuicao, 0, "historico terminal vence HOT stale");
}

{
  assert.deepStrictEqual(
    classificarUrlOferta("urlOriginalProduto", "https://www.amazon.com.br/dp/B0TESTE123").tipo,
    "produto original real"
  );
  assert.deepStrictEqual(
    classificarUrlOferta("produtoUrl", "https://www.mercadolivre.com.br/produto/teste").tipo,
    "produto original real"
  );
  assert.deepStrictEqual(
    classificarUrlOferta("urlProduto", "https://www.magazineluiza.com.br/p/teste/abc").tipo,
    "produto original real"
  );
  assert.deepStrictEqual(
    classificarUrlOferta("linkProduto", "https://www.kabum.com.br/produto/123/teste").tipo,
    "produto original real"
  );
  assert.deepStrictEqual(
    classificarUrlOferta("linkOriginal", "https://go.optimuspromo.com.br/r/abc").confiavel,
    true
  );
  assert.deepStrictEqual(
    classificarUrlOferta("urlOriginal", "https://amzn.to/abc").confiavel,
    true
  );
  assert.deepStrictEqual(
    classificarUrlOferta("linkAfiliado", "https://www.amazon.com.br/dp/B0AFILIADO1?tag=workspace-20").confiavel,
    true
  );
  assert.deepStrictEqual(
    classificarUrlOferta("linkFinal", "https://s.shopee.com.br/produto-real").confiavel,
    true
  );
  assert.deepStrictEqual(
    classificarUrlOferta("linkAfiliado", "https://www.awin1.com/cread.php?ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F123%2Fteste").confiavel,
    true
  );
  assert.deepStrictEqual(
    classificarUrlOferta("linkAfiliado", "https://www.amazon.com.br/").confiavel,
    false
  );
  assert.deepStrictEqual(
    classificarUrlOferta("linkOriginalRadar", "https://meli.la/abc").tipo,
    "shortlink/transport"
  );
  assert.deepStrictEqual(
    classificarUrlOferta("linkOriginalRadar", "https://meli.la/abc").confiavel,
    false
  );
  assert.deepStrictEqual(
    classificarUrlOferta("linkCapturado", "https://example.invalid/redirecionador").tipo,
    "shortlink/transport"
  );
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-detalhe-publico-"));
  const cliente = "cliente_semantica";
  const outroCliente = "cliente_outro";
  const dirCliente = path.join(root, cliente);
  const dirOutroCliente = path.join(root, outroCliente);
  const leveDir = path.join(dirCliente, "fila-historico-leve-incremental");
  const tecnicoDir = path.join(dirCliente, "fila-historico-incremental");
  const leveOutroDir = path.join(dirOutroCliente, "fila-historico-leve-incremental");
  fs.mkdirSync(leveDir, { recursive: true });
  fs.mkdirSync(tecnicoDir, { recursive: true });
  fs.mkdirSync(leveOutroDir, { recursive: true });
  try {
    const itemTecnico = oferta("detalhe_1", {
      titulo: "Produto Detalhado",
      preco: "R$ 149,90",
      imagemUsada: "https://cdn.optimus.test/detalhe-usada.jpg",
      imagemFinal: "https://cdn.optimus.test/detalhe-final.jpg",
      imagemRef: "https://cdn.optimus.test/detalhe-ref.jpg",
      urlProduto: "https://www.amazon.com.br/dp/B0DETALHE1",
      linkOriginal: "https://go.optimuspromo.com.br/r/detalhe-1",
      status: "enviado",
      enviadoEm: iso(AGORA),
      destinosEstado: [
        { destinoId: "canal_1", destinoNome: "Canal Principal", canal: "telegram", estado: "enviado", enviadoEm: iso(AGORA) }
      ],
      metadata: { pesado: true },
      radarMirror: { pesado: true },
      ofertaUniversal: { pesado: true },
      ofcV24: { pesado: true },
      logs: ["pesado"]
    });
    const registroTecnico = {
      id: "detalhe_1",
      chave: "chave_detalhe_1",
      clienteId: cliente,
      item: itemTecnico
    };
    const registroLeve = {
      id: "detalhe_1",
      chave: "chave_detalhe_1",
      clienteId: cliente,
      statusPublico: "enviado",
      item: {
        id: "detalhe_1",
        clienteId: cliente,
        titulo: "Produto Detalhado",
        marketplace: "amazon",
        precoExibivel: "R$ 149,90",
        imagemRef: "https://cdn.optimus.test/detalhe-ref.jpg",
        urlOriginal: "https://go.optimuspromo.com.br/r/detalhe-1",
        dataEntradaFila: iso(AGORA - 60 * 60 * 1000),
        finalizadoEm: iso(AGORA),
        statusPublico: "enviado",
        statusOperacional: "enviado",
        detalheRef: { arquivo: "fila-historico-incremental", id: "detalhe_1" }
      }
    };
    const registroLeveSemTecnico = {
      id: "detalhe_so_leve",
      chave: "chave_detalhe_so_leve",
      clienteId: cliente,
      statusPublico: "enviado",
      item: {
        id: "detalhe_so_leve",
        clienteId: cliente,
        titulo: "Produto Sem Tecnico",
        marketplace: "amazon",
        precoExibivel: "R$ 88,00",
        imagemRef: "https://cdn.optimus.test/leve.jpg",
        urlProduto: "https://www.amazon.com.br/dp/B0LEVESO1",
        dataEntradaFila: iso(AGORA - 60 * 60 * 1000),
        finalizadoEm: iso(AGORA),
        statusPublico: "enviado",
        statusOperacional: "enviado",
        detalheRef: { arquivo: "fila-historico-incremental", id: "detalhe_so_leve" }
      }
    };
    const registroOutroCliente = {
      id: "so_outro_cliente",
      chave: "chave_so_outro_cliente",
      clienteId: outroCliente,
      statusPublico: "enviado",
      item: {
        id: "so_outro_cliente",
        clienteId: outroCliente,
        titulo: "Produto Outro Cliente",
        dataEntradaFila: iso(AGORA - 60 * 60 * 1000),
        finalizadoEm: iso(AGORA),
        statusPublico: "enviado",
        statusOperacional: "enviado"
      }
    };
    fs.writeFileSync(path.join(leveDir, "2026-09-15.jsonl"), `${JSON.stringify(registroLeve)}\n${JSON.stringify(registroLeveSemTecnico)}\n`, "utf8");
    fs.writeFileSync(path.join(tecnicoDir, "2026-09-15.jsonl"), `${JSON.stringify(registroTecnico)}\n`, "utf8");
    fs.writeFileSync(path.join(leveOutroDir, "2026-09-15.jsonl"), `${JSON.stringify(registroOutroCliente)}\n`, "utf8");
    fs.writeFileSync(path.join(dirCliente, "fila.json"), JSON.stringify({ proibido: true }), "utf8");

    let leuFilaJson = false;
    const fsContador = {
      ...fs,
      readFileSync(file, ...args) {
        if (String(file).endsWith(`${path.sep}fila.json`) || String(file).endsWith("/fila.json")) {
          leuFilaJson = true;
        }
        return fs.readFileSync(file, ...args);
      }
    };

    const resultado = resolverDetalhePublicoFilaPorRef({
      clienteId: cliente,
      clientePath: dirCliente,
      detalheRef: { arquivo: "fila-historico-incremental", id: "detalhe_1" },
      fs: fsContador,
      agoraMs: AGORA
    });
    assert.strictEqual(resultado.ok, true, "detalhe por detalheRef retorna uma execucao");
    assert.strictEqual(resultado.detalhe.id, "detalhe_1");
    assert.strictEqual(resultado.detalhe.imagemRef, "https://cdn.optimus.test/detalhe-usada.jpg", "imagem usada vence final/ref");
    assert.strictEqual(resultado.detalhe.urlOriginal, "https://www.amazon.com.br/dp/B0DETALHE1", "detalhe usa URL real do produto");
    assert.strictEqual(resultado.detalhe.urlOriginalTipo, "produto original real");
    assert.strictEqual(leuFilaJson, false, "detalhe nao le fila.json gigante");
    const payload = JSON.stringify(resultado.detalhe);
    for (const proibido of ["metadata", "radarMirror", "ofertaUniversal", "ofcV24", "logs", "pesado"]) {
      assert(!payload.includes(proibido), `detalhe nao contem ${proibido}`);
    }

    const bench = benchmarkDetalhePublicoFila({
      clienteId: cliente,
      clientePath: dirCliente,
      detalheRef: { arquivo: "fila-historico-incremental", id: "detalhe_1" },
      fs: fsContador,
      agoraMs: AGORA
    });
    assert.strictEqual(bench.ok, true);
    assert.strictEqual(bench.leuFilaJson, false);
    assert(bench.bytesResposta > 0);

    const legadoFilaJson = resolverDetalhePublicoFilaPorRef({
      clienteId: cliente,
      clientePath: dirCliente,
      detalheRef: { arquivo: "fila.json", id: "detalhe_1" },
      fs: fsContador,
      agoraMs: AGORA
    });
    assert.strictEqual(legadoFilaJson.ok, true, "rotulo legado fila.json e aceito sem ler fila.json");
    assert.strictEqual(leuFilaJson, false, "rotulo legado fila.json nao abre arquivo pesado");

    const somenteLeve = resolverDetalhePublicoFilaPorRef({
      clienteId: cliente,
      clientePath: dirCliente,
      detalheRef: { arquivo: "fila-historico-incremental", id: "detalhe_so_leve" },
      fs: fsContador,
      agoraMs: AGORA
    });
    assert.strictEqual(somenteLeve.ok, true, "detalhe sem historico tecnico degrada com historico leve");
    assert.strictEqual(somenteLeve.fonte, "historico_leve");
    assert.strictEqual(somenteLeve.detalhe.titulo, "Produto Sem Tecnico");
    assert.strictEqual(somenteLeve.detalhe.urlOriginal, "https://www.amazon.com.br/dp/B0LEVESO1");

    const detalheComAfiliado = resolverDetalhePublicoFilaPorRef({
      clienteId: cliente,
      clientePath: dirCliente,
      detalheRef: { arquivo: "fila-historico-incremental", id: "detalhe_afiliado" },
      hot: [oferta("detalhe_afiliado", {
        linkOriginal: "",
        urlOriginal: "",
        urlProduto: "",
        linkAfiliado: "https://www.magazineluiza.com.br/p/teste/abc?partner_id=optimus",
        status: "enviado",
        enviadoEm: iso(AGORA),
        detalheRef: { arquivo: "fila-historico-incremental", id: "detalhe_afiliado" }
      })],
      fs: fsContador,
      agoraMs: AGORA
    });
    assert.strictEqual(detalheComAfiliado.ok, true, "detalhe usa link afiliado preservado quando nao ha canonico");
    assert.strictEqual(detalheComAfiliado.detalhe.urlOriginal, "https://www.magazineluiza.com.br/p/teste/abc?partner_id=optimus");
    assert.strictEqual(detalheComAfiliado.detalhe.urlOriginalTipo, "afiliado do produto");

    const detalheSemLinkConfiavel = resolverDetalhePublicoFilaPorRef({
      clienteId: cliente,
      clientePath: dirCliente,
      detalheRef: { arquivo: "fila-historico-incremental", id: "detalhe_homepage" },
      hot: [oferta("detalhe_homepage", {
        linkOriginal: "",
        urlOriginal: "",
        urlProduto: "",
        linkAfiliado: "https://www.amazon.com.br/",
        status: "enviado",
        enviadoEm: iso(AGORA),
        detalheRef: { arquivo: "fila-historico-incremental", id: "detalhe_homepage" }
      })],
      fs: fsContador,
      agoraMs: AGORA
    });
    assert.strictEqual(detalheSemLinkConfiavel.ok, true);
    assert.strictEqual(detalheSemLinkConfiavel.detalhe.urlOriginal, "", "homepage de marketplace nao vira CTA publico");

    const inexistente = resolverDetalhePublicoFilaPorRef({
      clienteId: cliente,
      clientePath: dirCliente,
      detalheRef: { arquivo: "nao-existe.jsonl", id: "detalhe_1" },
      fs: fsContador,
      agoraMs: AGORA
    });
    assert.strictEqual(inexistente.ok, false, "arquivo inexistente nao e aceito como caminho dinamico");
    assert.strictEqual(inexistente.motivo, "detalhe_ref_arquivo_nao_permitido");
    assert(!JSON.stringify(inexistente).includes(root), "resposta segura nao revela path interno");

    const traversal = resolverDetalhePublicoFilaPorRef({
      clienteId: cliente,
      clientePath: dirCliente,
      detalheRef: { arquivo: "../fila-historico-incremental", id: "detalhe_1" },
      fs: fsContador,
      agoraMs: AGORA
    });
    assert.strictEqual(traversal.ok, false);
    assert.strictEqual(traversal.motivo, "detalhe_ref_arquivo_invalido");

    const absoluto = resolverDetalhePublicoFilaPorRef({
      clienteId: cliente,
      clientePath: dirCliente,
      detalheRef: { arquivo: "C:\\data\\clientes\\outro\\2026-09-15.jsonl", id: "detalhe_1" },
      fs: fsContador,
      agoraMs: AGORA
    });
    assert.strictEqual(absoluto.ok, false);
    assert.strictEqual(absoluto.motivo, "detalhe_ref_arquivo_invalido");

    const outro = resolverDetalhePublicoFilaPorRef({
      clienteId: cliente,
      clientePath: dirCliente,
      detalheRef: { arquivo: "fila-historico-incremental", id: "so_outro_cliente" },
      fs: fsContador,
      agoraMs: AGORA
    });
    assert.strictEqual(outro.ok, false, "detalhe de outro cliente nao e acessivel pelo path do cliente autenticado");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("fila-read-model-publico-detalhe-semantica.test.js OK");
