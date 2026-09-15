"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  FILA_VIVA_ARQUIVO,
  FILA_HISTORICO_ARQUIVO,
  FILA_PROJECAO_LEVE_ARQUIVO,
  projetarItemFilaLeve,
  projetarFilaLeve,
  atualizarItemProjecaoLeveFila,
  compararProjecaoLeveComLegado,
  benchmarkProjecaoLeveFila,
  projetarFilaV2Shadow
} = require("../modules/fila/fila-v2-shadow");
const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");

const AGORA = Date.parse("2026-09-14T12:00:00.000Z");

function oferta(extra = {}) {
  return {
    id: extra.id || "oferta_1",
    ofertaId: extra.ofertaId || "oferta_1",
    engineOfertaId: extra.engineOfertaId || "engine_1",
    clienteId: extra.clienteId || "cliente_a",
    titulo: extra.titulo || "Produto Teste",
    marketplace: extra.marketplace || "mercadolivre",
    preco: extra.preco ?? "99,90",
    imagem: extra.imagem || "https://img.example/produto.jpg",
    status: extra.status || "pendente",
    criadoEm: extra.criadoEm || "2026-09-14T10:00:00.000Z",
    updatedAt: extra.updatedAt || "2026-09-14T10:05:00.000Z",
    destinosEstado: extra.destinosEstado,
    motivo: extra.motivo,
    proximaTentativaEnvioEm: extra.proximaTentativaEnvioEm,
    metadata: {
      ofcV24: { payload: "x".repeat(2048) },
      radarMirror: { bruto: "y".repeat(2048) },
      ofertaUniversal: { bruto: "z".repeat(2048) },
      inteligenciaUniversalV2: { bruto: "w".repeat(2048) },
      token: "nao_deve_aparecer"
    },
    radarMirror: { payload: "fora_metadata" },
    ofertaUniversal: { payload: "fora_metadata" },
    inteligenciaUniversalV2: { payload: "fora_metadata" },
    payloadBruto: "nao_deve_aparecer",
    diagnostico: { bruto: "nao_deve_aparecer" },
    ...extra
  };
}

function destino(destinoId, estado, extra = {}) {
  return {
    destinoId,
    id: destinoId,
    nome: extra.nome || destinoId,
    canal: extra.canal || "whatsapp",
    estado,
    enviadoEm: extra.enviadoEm
  };
}

function assertSemCamposPesados(projecao) {
  const serializado = JSON.stringify(projecao);
  for (const proibido of [
    "ofcV24",
    "radarMirror",
    "ofertaUniversal",
    "inteligenciaUniversalV2",
    "payloadBruto",
    "diagnostico",
    "nao_deve_aparecer"
  ]) {
    assert(!serializado.includes(proibido), `projecao leve nao pode conter ${proibido}`);
  }
}

function memoriaStorage() {
  const dados = new Map();
  return {
    dados,
    writeClienteJson(cliente, arquivo, conteudo) {
      dados.set(`${cliente}/${arquivo}`, JSON.parse(JSON.stringify(conteudo)));
      return true;
    },
    getClienteJsonPath(cliente, arquivo) {
      return path.join("mem", cliente, arquivo);
    }
  };
}

function storageArquivo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-projecao-leve-"));
  const writes = [];
  return {
    dir,
    writes,
    getClienteJsonPath(cliente, arquivo) {
      return path.join(dir, cliente, arquivo);
    },
    writeClienteJson(cliente, arquivo, conteudo) {
      fs.mkdirSync(path.join(dir, cliente), { recursive: true });
      fs.writeFileSync(path.join(dir, cliente, arquivo), JSON.stringify(conteudo), "utf8");
      writes.push({ cliente, arquivo });
      return true;
    },
    read(cliente, arquivo) {
      return JSON.parse(fs.readFileSync(path.join(dir, cliente, arquivo), "utf8"));
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function filaGrande(total = 500, clienteId = "cliente_grande") {
  return Array.from({ length: total }, (_, indice) => oferta({
    id: `grande_${indice}`,
    ofertaId: `grande_${indice}`,
    engineOfertaId: `engine_grande_${indice}`,
    clienteId,
    titulo: `Produto Grande ${indice}`,
    status: indice % 11 === 0 ? "enviado" : "pendente",
    enviadoEm: indice % 11 === 0 ? "2026-09-14T11:00:00.000Z" : "",
    destinosEstado: indice % 5 === 0
      ? [
          destino("a", "enviado", { enviadoEm: "2026-09-14T10:01:00.000Z" }),
          destino("b", "aguardando"),
          destino("c", "aguardando")
        ]
      : undefined
  }));
}

function wait(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  {
    const fonteShadow = fs.readFileSync(path.join(__dirname, "..", "modules", "fila", "fila-v2-shadow.js"), "utf8");
    const inicio = fonteShadow.indexOf("function projetarFilaV2Shadow");
    const fim = fonteShadow.indexOf("function lerEntradasShadow", inicio);
    const corpo = fonteShadow.slice(inicio, fim);
    assert(!corpo.includes("compararProjecaoLeveComLegado("), "comparador pesado nao pode rodar no runtime normal do shadow");
  }

  {
    const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    assert(
      fonteIndex.includes("devePularShadowCompleto: ({ clienteId }) => filaOperacionalV2.deveUsarFilaV2Operacional(clienteId)"),
      "fast path V2 deve continuar pulando shadow completo"
    );
    const fonteOperacional = fs.readFileSync(path.join(__dirname, "..", "modules", "fila", "fila-operacional-v2.js"), "utf8");
    assert(
      fonteOperacional.includes("atualizarProjecaoLeveIncremental(clienteId, resultado.item || item, deps)"),
      "hook V2 deve atualizar projecao leve sem reativar shadow completo"
    );
  }

  {
    const item = projetarItemFilaLeve(oferta({ status: "pendente" }), { agora: AGORA });
    assert.strictEqual(item.statusPublico, "em_distribuicao");
    assert.strictEqual(item.statusOperacional, "pendente");
    assert.strictEqual(item.progresso.enviados, 0);
    assertSemCamposPesados(item);
  }

  {
    const item = projetarItemFilaLeve(oferta({ status: "processando" }), { agora: AGORA });
    assert.strictEqual(item.statusPublico, "em_distribuicao");
    assert.strictEqual(item.statusOperacional, "processando");
  }

  {
    const item = projetarItemFilaLeve(oferta({
      status: "enviado",
      enviadoEm: "2026-09-14T11:00:00.000Z"
    }), { agora: AGORA });
    assert.strictEqual(item.statusPublico, "enviado");
    assert.strictEqual(item.progresso.enviados, 1);
    assert.strictEqual(item.progresso.total, 1);
  }

  {
    const item = projetarItemFilaLeve(oferta({
      status: "erro",
      retry: false,
      recuperavel: false,
      motivo: "erro_final"
    }), { agora: AGORA });
    assert.strictEqual(item.statusPublico, "nao_enviado");
  }

  {
    const item = projetarItemFilaLeve(oferta({
      status: "retida",
      motivo: "aguardando intervalo",
      proximaTentativaEnvioEm: "2026-09-14T12:10:00.000Z"
    }), { agora: AGORA });
    assert.strictEqual(item.statusPublico, "em_distribuicao");
  }

  for (const [enviados, esperadoStatus] of [
    [1, "em_distribuicao"],
    [2, "em_distribuicao"],
    [3, "enviado"]
  ]) {
    const estados = [
      destino("destino_a", enviados >= 1 ? "enviado" : "aguardando", { enviadoEm: enviados >= 1 ? "2026-09-14T10:01:00.000Z" : "" }),
      destino("destino_b", enviados >= 2 ? "enviado" : "aguardando", { enviadoEm: enviados >= 2 ? "2026-09-14T10:02:00.000Z" : "" }),
      destino("destino_c", enviados >= 3 ? "enviado" : "aguardando", { enviadoEm: enviados >= 3 ? "2026-09-14T10:03:00.000Z" : "" })
    ];
    const item = projetarItemFilaLeve(oferta({ status: enviados === 3 ? "enviado" : "processando", destinosEstado: estados }), { agora: AGORA });
    assert.strictEqual(item.progresso.enviados, enviados);
    assert.strictEqual(item.progresso.total, 3);
    assert.strictEqual(item.statusPublico, esperadoStatus);
  }

  {
    const fila = [
      oferta({ id: "a1", clienteId: "cliente_a" }),
      oferta({ id: "b1", clienteId: "cliente_b" })
    ];
    const projecao = projetarFilaLeve(fila, { clienteId: "cliente_a", agora: AGORA });
    assert.strictEqual(projecao.total, 1);
    assert.strictEqual(projecao.itens[0].clienteId, "cliente_a");
    assert.strictEqual(projecao.itens[0].id, "a1");
  }

  {
    const inicial = projetarFilaLeve([oferta({ id: "dup", status: "pendente" })], { clienteId: "cliente_a", agora: AGORA });
    const atualizada = atualizarItemProjecaoLeveFila(inicial, oferta({ id: "dup", status: "enviado", enviadoEm: "2026-09-14T11:00:00.000Z" }), { agora: AGORA });
    assert.strictEqual(atualizada.total, 1, "update do mesmo item nao pode duplicar entrada logica");
    assert.strictEqual(atualizada.itens[0].statusPublico, "enviado");
  }

  {
    const fila = [
      oferta({ id: "pendente", status: "pendente" }),
      oferta({ id: "enviada", status: "enviado", enviadoEm: "2026-09-14T11:00:00.000Z" })
    ];
    const projecao = projetarFilaLeve(fila, { clienteId: "cliente_a", agora: AGORA });
    const comparacao = compararProjecaoLeveComLegado(fila, projecao, { clienteId: "cliente_a", agora: AGORA });
    assert.strictEqual(comparacao.ok, true);
    assert.strictEqual(comparacao.divergencias, 0);
  }

  {
    const fila = Array.from({ length: 40 }, (_, indice) => oferta({
      id: `bench_${indice}`,
      status: indice % 3 === 0 ? "enviado" : "pendente",
      enviadoEm: indice % 3 === 0 ? "2026-09-14T11:00:00.000Z" : ""
    }));
    const benchmark = benchmarkProjecaoLeveFila(fila, { clienteId: "cliente_a", agora: AGORA });
    assert(benchmark.bytesMediosProjecao < benchmark.bytesMediosLegado, "projecao deve ser menor que item legado");
    assert(benchmark.reducaoPercentual > 50, "benchmark deve mostrar reducao relevante");
    assert.strictEqual(benchmark.listagem20, 20);
    assert.strictEqual(benchmark.contadores.emDistribuicao + benchmark.contadores.enviados + benchmark.contadores.naoEnviados, 40);
  }

  {
    const escritos = [];
    const resultado = projetarFilaV2Shadow({
      fila: [oferta({ id: "shadow_ok" })],
      clienteId: "cliente_a",
      agora: AGORA,
      writeClienteJson(clienteId, arquivo, conteudo) {
        escritos.push({ clienteId, arquivo, conteudo });
        if (arquivo === FILA_PROJECAO_LEVE_ARQUIVO) {
          throw new Error("falha_projecao_leve");
        }
      },
      getClienteJsonPath(clienteId, arquivo) {
        return `/tmp/${clienteId}/${arquivo}`;
      },
      logger: { log() {} }
    });
    assert.strictEqual(resultado.ok, true, "falha da projecao leve nao pode interromper shadow legado");
    assert.strictEqual(resultado.projecaoLeveEscrita, false);
    assert.strictEqual(resultado.projecaoLeveErro, "falha_projecao_leve");
    assert(escritos.some(item => item.arquivo === FILA_VIVA_ARQUIVO), "fila-viva continua sendo escrita");
    assert(escritos.some(item => item.arquivo === FILA_HISTORICO_ARQUIVO), "fila-historico continua sendo escrita");
  }

  {
    const store = memoriaStorage();
    const cliente = "cliente_fast_path";
    const base = oferta({ id: "progressiva", clienteId: cliente, status: "pendente" });
    for (const [status, enviados] of [
      ["pendente", 0],
      ["processando", 0],
      ["processando", 1],
      ["processando", 2]
    ]) {
      filaOperacionalV2.atualizarProjecaoLeveIncremental(cliente, oferta({
        ...base,
        status,
        destinosEstado: [
          destino("a", enviados >= 1 ? "enviado" : "aguardando", { enviadoEm: enviados >= 1 ? "2026-09-14T10:01:00.000Z" : "" }),
          destino("b", enviados >= 2 ? "enviado" : "aguardando", { enviadoEm: enviados >= 2 ? "2026-09-14T10:02:00.000Z" : "" }),
          destino("c", enviados >= 3 ? "enviado" : "aguardando", { enviadoEm: enviados >= 3 ? "2026-09-14T10:03:00.000Z" : "" })
        ],
        motivo: enviados === 2 ? "parcial" : "",
        enviadoEm: enviados === 3 ? "2026-09-14T10:03:00.000Z" : ""
      }), {
        ...store,
        agora: AGORA,
        flushProjecaoLeveSincrono: true
      });
    }
    const projecao = store.dados.get(`${cliente}/${FILA_PROJECAO_LEVE_ARQUIVO}`);
    assert.strictEqual(projecao.itens.length, 1, "atualizacao progressiva deve ser idempotente por oferta");
    assert.strictEqual(projecao.itens[0].statusPublico, "em_distribuicao");
    assert.strictEqual(projecao.itens[0].progresso.enviados, 2);
    assert.strictEqual(projecao.itens[0].progresso.total, 3);

    filaOperacionalV2.atualizarProjecaoLeveIncremental(cliente, oferta({
      ...base,
      status: "enviado",
      statusPublico: "enviado",
      enviadoEm: "2026-09-14T10:03:00.000Z",
      destinosEstado: [
        destino("a", "enviado", { enviadoEm: "2026-09-14T10:01:00.000Z" }),
        destino("b", "enviado", { enviadoEm: "2026-09-14T10:02:00.000Z" }),
        destino("c", "enviado", { enviadoEm: "2026-09-14T10:03:00.000Z" })
      ]
    }), {
      ...store,
      agora: AGORA,
      flushProjecaoLeveSincrono: true
    });
    assert.strictEqual(store.dados.get(`${cliente}/${FILA_PROJECAO_LEVE_ARQUIVO}`).itens.length, 0, "terminal sai da projecao HOT");
  }

  {
    const store = memoriaStorage();
    filaOperacionalV2.atualizarProjecaoLeveIncremental("cliente_a", oferta({ id: "a", clienteId: "cliente_a" }), {
      ...store,
      agora: AGORA,
      flushProjecaoLeveSincrono: true
    });
    filaOperacionalV2.atualizarProjecaoLeveIncremental("cliente_b", oferta({ id: "b", clienteId: "cliente_b" }), {
      ...store,
      agora: AGORA,
      flushProjecaoLeveSincrono: true
    });
    assert.strictEqual(store.dados.get(`cliente_a/${FILA_PROJECAO_LEVE_ARQUIVO}`).itens[0].id, "a");
    assert.strictEqual(store.dados.get(`cliente_b/${FILA_PROJECAO_LEVE_ARQUIVO}`).itens[0].id, "b");
  }

  for (const total of [500, 1000]) {
    const store = storageArquivo();
    const cliente = `cliente_boot_${total}`;
    const fila = filaGrande(total, cliente);
    const bootstrap = filaOperacionalV2.bootstrapProjecaoLeveCliente(cliente, { fila, agora: AGORA }, {
      getClienteJsonPath: store.getClienteJsonPath,
      writeClienteJson: store.writeClienteJson,
      logger: { log() {} }
    });
    assert.strictEqual(bootstrap.ok, true);
    assert.strictEqual(store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO).itens.length, total);

    const alterada = oferta({ id: "grande_10", clienteId: cliente, titulo: "Produto Grande 10 atualizado", status: "processando" });
    filaOperacionalV2.atualizarProjecaoLeveIncremental(cliente, alterada, {
      getClienteJsonPath: store.getClienteJsonPath,
      writeClienteJson: store.writeClienteJson,
      flushProjecaoLeveSincrono: true,
      logger: { log() {} }
    });
    const aposUpdate = store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO);
    const totalHotAposNormalizacao = aposUpdate.itens.length;
    assert(totalHotAposNormalizacao <= total, "update normaliza projecao para HOT-only");
    assert.strictEqual(aposUpdate.itens.find(item => item.id === "grande_10").titulo, "Produto Grande 10 atualizado");

    filaOperacionalV2.atualizarProjecaoLeveIncremental(cliente, oferta({ id: "nova", clienteId: cliente }), {
      getClienteJsonPath: store.getClienteJsonPath,
      writeClienteJson: store.writeClienteJson,
      flushProjecaoLeveSincrono: true,
      logger: { log() {} }
    });
    assert.strictEqual(store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO).itens.length, totalHotAposNormalizacao + 1, "insert em projecao HOT adiciona uma entrada");
    store.cleanup();
  }

  {
    const store = storageArquivo();
    const cliente = "cliente_auto_boot";
    const fila = filaGrande(20, cliente);
    store.writeClienteJson(cliente, FILA_VIVA_ARQUIVO, fila.map((item, indice) => ({
      posicaoLegada: indice,
      bucket: "viva",
      motivoBucket: "status_operacional",
      status: item.status,
      id: item.id,
      item
    })));
    filaOperacionalV2.atualizarProjecaoLeveIncremental(cliente, oferta({ id: "grande_3", clienteId: cliente, titulo: "Produto alterado no primeiro evento" }), {
      getClienteJsonPath: store.getClienteJsonPath,
      writeClienteJson: store.writeClienteJson,
      flushProjecaoLeveSincrono: true,
      logger: { log() {} }
    });
    const projecao = store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO);
    assert.strictEqual(projecao.itens.length, 1, "primeiro evento nao usa fila-viva como autoridade publica");
    assert.strictEqual(projecao.itens.find(item => item.id === "grande_3").titulo, "Produto alterado no primeiro evento");
    store.cleanup();
  }

  {
    const store = storageArquivo();
    const cliente = "cliente_restart";
    const v1 = ["A", "B", "C"].map(id => oferta({ id, clienteId: cliente, titulo: `${id}=v1` }));
    const v2 = ["A", "B", "C"].map(id => oferta({ id, clienteId: cliente, titulo: `${id}=v2` }));
    store.writeClienteJson(cliente, FILA_PROJECAO_LEVE_ARQUIVO, projetarFilaLeve(v1, { clienteId: cliente, agora: AGORA }));
    store.writeClienteJson(cliente, FILA_VIVA_ARQUIVO, v2.map((item, indice) => ({
      posicaoLegada: indice,
      bucket: "viva",
      motivoBucket: "status_operacional",
      status: item.status,
      id: item.id,
      item
    })));
    filaOperacionalV2.resetarEstadoProjecaoLeveParaTeste(cliente);
    let leiturasViva = 0;
    const fsContador = {
      ...fs,
      readFileSync(file, ...args) {
        if (String(file).endsWith(FILA_VIVA_ARQUIVO)) leiturasViva += 1;
        return fs.readFileSync(file, ...args);
      }
    };
    filaOperacionalV2.atualizarProjecaoLeveIncremental(cliente, oferta({ id: "C", clienteId: cliente, titulo: "C=v3" }), {
      getClienteJsonPath: store.getClienteJsonPath,
      writeClienteJson: store.writeClienteJson,
      fs: fsContador,
      flushProjecaoLeveSincrono: true,
      logger: { log() {} }
    });
    const aposRestart = store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO);
    assert.strictEqual(aposRestart.itens.find(item => item.id === "A").titulo, "A=v1");
    assert.strictEqual(aposRestart.itens.find(item => item.id === "B").titulo, "B=v1");
    assert.strictEqual(aposRestart.itens.find(item => item.id === "C").titulo, "C=v3");

    filaOperacionalV2.atualizarProjecaoLeveIncremental(cliente, oferta({ id: "A", clienteId: cliente, titulo: "A=v4" }), {
      getClienteJsonPath: store.getClienteJsonPath,
      writeClienteJson: store.writeClienteJson,
      fs: fsContador,
      flushProjecaoLeveSincrono: true,
      logger: { log() {} }
    });
    const aposIncremental = store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO);
    assert.strictEqual(aposIncremental.itens.find(item => item.id === "A").titulo, "A=v4");
    assert.strictEqual(aposIncremental.itens.find(item => item.id === "B").titulo, "B=v1");
    assert.strictEqual(leiturasViva, 0, "primeiro evento nao deve reler fila-viva como autoridade publica");
    store.cleanup();
  }

  {
    const store = storageArquivo();
    const cliente = "cliente_coalesce";
    filaOperacionalV2.bootstrapProjecaoLeveCliente(cliente, { fila: filaGrande(10, cliente), agora: AGORA }, {
      getClienteJsonPath: store.getClienteJsonPath,
      writeClienteJson: store.writeClienteJson,
      logger: { log() {} }
    });
    const writesAntes = store.writes.length;
    for (let i = 0; i < 10; i += 1) {
      filaOperacionalV2.atualizarProjecaoLeveIncremental(cliente, oferta({ id: "grande_1", clienteId: cliente, titulo: `Ultimo ${i}` }), {
        getClienteJsonPath: store.getClienteJsonPath,
        writeClienteJson: store.writeClienteJson,
        logger: { log() {} }
      });
    }
    for (let i = 0; i < 10; i += 1) {
      filaOperacionalV2.atualizarProjecaoLeveIncremental(cliente, oferta({ id: `novo_${i}`, clienteId: cliente }), {
        getClienteJsonPath: store.getClienteJsonPath,
        writeClienteJson: store.writeClienteJson,
        logger: { log() {} }
      });
    }
    filaOperacionalV2.atualizarProjecaoLeveIncremental("cliente_coalesce_b", oferta({ id: "b1", clienteId: "cliente_coalesce_b" }), {
      getClienteJsonPath: store.getClienteJsonPath,
      writeClienteJson: store.writeClienteJson,
      logger: { log() {} }
    });
    await wait(10);
    const writesDepois = store.writes.slice(writesAntes).filter(item => item.arquivo === FILA_PROJECAO_LEVE_ARQUIVO);
    assert.strictEqual(writesDepois.filter(item => item.cliente === cliente).length, 1, "mudancas do mesmo cliente no mesmo tick devem consolidar um flush");
    assert.strictEqual(writesDepois.filter(item => item.cliente === "cliente_coalesce_b").length, 1, "cliente diferente tem flush isolado");
    const projecaoA = store.read(cliente, FILA_PROJECAO_LEVE_ARQUIVO);
    assert.strictEqual(projecaoA.itens.find(item => item.id === "grande_1").titulo, "Ultimo 9", "ultimo estado da mesma oferta vence");
    assert.strictEqual(new Set(projecaoA.itens.map(item => item.id)).size, projecaoA.itens.length, "sem duplicacao logica");
    store.cleanup();
  }

  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-projecao-leve-"));
    const cliente = "cliente_boot";
    const clienteDir = path.join(dir, cliente);
    fs.mkdirSync(clienteDir, { recursive: true });
    fs.writeFileSync(path.join(clienteDir, "fila-viva.json"), JSON.stringify([
      { item: oferta({ id: "boot_1", clienteId: "cliente_boot", status: "pendente" }), bucket: "viva", id: "boot_1", status: "pendente" }
    ]), "utf8");
    const resultado = filaOperacionalV2.bootstrapProjecaoLeveCliente("cliente_boot", { usarFilaViva: true, agora: AGORA }, {
      getClienteJsonPath(clienteId, arquivo) {
        return path.join(dir, clienteId, arquivo);
      },
      writeClienteJson(clienteId, arquivo, conteudo) {
        fs.mkdirSync(path.join(dir, clienteId), { recursive: true });
        fs.writeFileSync(path.join(dir, clienteId, arquivo), JSON.stringify(conteudo), "utf8");
        return true;
      },
      logger: { log() {} }
    });
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.fonte, "fila_viva");
    const projecao = JSON.parse(fs.readFileSync(path.join(clienteDir, FILA_PROJECAO_LEVE_ARQUIVO), "utf8"));
    assert.strictEqual(projecao.itens.length, 1);
    assertSemCamposPesados(projecao);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log("fila-projecao-leve-shadow.test.js OK");
})().catch((erro) => {
  console.error(erro.stack || erro.message || erro);
  process.exitCode = 1;
});
