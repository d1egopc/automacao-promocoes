"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");

const AGORA = Date.parse("2026-09-14T12:00:00.000Z");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "optimus-fila-historico-leve-"));
}

function deps(root, extras = {}) {
  return {
    getClientePath: clienteId => path.join(root, clienteId),
    getClienteJsonPath: (clienteId, arquivo) => path.join(root, clienteId, arquivo),
    readClienteJson(clienteId, arquivo, fallback) {
      const file = path.join(root, clienteId, arquivo);
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, "utf8"));
    },
    writeClienteJson(clienteId, arquivo, valor) {
      const dir = path.join(root, clienteId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, arquivo), JSON.stringify(valor), "utf8");
      return true;
    },
    logger: { log() {} },
    ...extras
  };
}

function oferta(id, extra = {}) {
  return {
    id,
    ofertaId: id,
    engineOfertaId: id.replace(/\D/g, "") || id,
    clienteId: extra.clienteId || "cliente_hist_leve",
    titulo: extra.titulo || `Produto ${id}`,
    marketplace: extra.marketplace || "amazon",
    preco: extra.preco || "99.90",
    imagem: extra.imagem || "https://cdn.optimus.test/produto.jpg",
    criadoEm: extra.criadoEm || "2026-09-14T10:00:00.000Z",
    updatedAt: extra.updatedAt || "2026-09-14T12:00:00.000Z",
    ...extra
  };
}

function linhasHistoricoLeve(root, clienteId) {
  const dir = path.join(root, clienteId, filaOperacionalV2.HISTORICO_LEVE_INCREMENTAL_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(nome => nome.endsWith(".jsonl"))
    .flatMap(nome => fs.readFileSync(path.join(dir, nome), "utf8").trim().split(/\r?\n/).filter(Boolean))
    .map(linha => JSON.parse(linha));
}

function bytesHistoricoLeve(root, clienteId) {
  const dir = path.join(root, clienteId, filaOperacionalV2.HISTORICO_LEVE_INCREMENTAL_DIR);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir)
    .filter(nome => nome.endsWith(".jsonl"))
    .reduce((total, nome) => total + fs.statSync(path.join(dir, nome)).size, 0);
}

function escreverHistoricoTecnico(root, clienteId, itens) {
  const dir = path.join(root, clienteId, filaOperacionalV2.HISTORICO_INCREMENTAL_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "2026-09-14.jsonl");
  const linhas = itens.map((item, posicaoLegada) => JSON.stringify({
    versao: 1,
    chave: `tecnico_${item.id}`,
    chaveLegada: `legado_${item.id}`,
    clienteId,
    id: item.id,
    status: item.status,
    posicaoLegada,
    motivoBucket: "status_terminal",
    registradoEm: "2026-09-14T12:00:00.000Z",
    item
  }));
  fs.writeFileSync(file, `${linhas.join("\n")}\n`, "utf8");
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_terminal_status";

  for (const item of [
    oferta("enviado", { clienteId: cliente, status: "enviado", enviadoEm: "2026-09-14T11:00:00.000Z" }),
    oferta("erro", { clienteId: cliente, status: "erro_final", erroEm: "2026-09-14T11:01:00.000Z" }),
    oferta("falha", { clienteId: cliente, status: "falha_final", erroEm: "2026-09-14T11:01:30.000Z" }),
    oferta("expirada", { clienteId: cliente, status: "expirada_operacional", expiradoEm: "2026-09-14T11:02:00.000Z" }),
    oferta("cancelada", { clienteId: cliente, status: "cancelada", finalizadoEm: "2026-09-14T11:03:00.000Z" }),
    oferta("descartada", { clienteId: cliente, status: "descartada", finalizadoEm: "2026-09-14T11:04:00.000Z" }),
    oferta("sem_destino", { clienteId: cliente, status: "retida", retidaTerminal: true, motivo: "sem_destino", finalizadoEm: "2026-09-14T11:05:00.000Z" })
  ]) {
    const res = filaOperacionalV2.appendHistoricoLeveIncremental(cliente, item, { ...d, agora: AGORA });
    assert.strictEqual(res.ok, true);
  }

  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, { limite: 20 }, d);
  assert.strictEqual(lista.total, 7);
  assert.deepStrictEqual(
    new Set(lista.itens.map(item => item.statusPublico)),
    new Set(["enviado", "nao_enviado"])
  );
  assert(lista.itens.every(item => !Object.prototype.hasOwnProperty.call(item, "metadata")));
  assert(lista.itens.every(item => !Object.prototype.hasOwnProperty.call(item, "radarMirror")));
  assert(lista.itens.every(item => !Object.prototype.hasOwnProperty.call(item, "ofertaUniversal")));
  assert(lista.itens.every(item => !Object.prototype.hasOwnProperty.call(item, "inteligenciaUniversalV2")));
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_multidestino";
  const item = oferta("multi_1", {
    clienteId: cliente,
    status: "erro_final",
    destinosEstado: [
      { destinoId: "a", destinoNome: "A", canal: "whatsapp", estado: "enviado", enviadoEm: "2026-09-14T11:00:00.000Z" },
      { destinoId: "b", destinoNome: "B", canal: "telegram", estado: "enviado", enviadoEm: "2026-09-14T11:01:00.000Z" },
      { destinoId: "c", destinoNome: "C", canal: "discord", estado: "erro_final" }
    ]
  });

  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, item, { ...d, agora: AGORA });
  const [registro] = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, d).itens;

  assert.strictEqual(registro.statusPublico, "parcial");
  assert.deepStrictEqual(registro.progresso, { enviados: 2, total: 3, pendentes: 0, erros: 1 });
  assert.deepStrictEqual(
    registro.destinos.map(destino => [destino.destinoId, destino.estado]),
    [["a", "enviado"], ["b", "enviado"], ["c", "erro_final"]]
  );
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_retry";
  const erro = oferta("retry_1", { clienteId: cliente, status: "erro_final", erroEm: "2026-09-14T11:00:00.000Z" });
  const sucesso = oferta("retry_1", { clienteId: cliente, status: "enviado", enviadoEm: "2026-09-14T11:05:00.000Z" });

  const primeiro = filaOperacionalV2.appendHistoricoLeveIncremental(cliente, erro, { ...d, agora: AGORA });
  const repetido = filaOperacionalV2.appendHistoricoLeveIncremental(cliente, erro, { ...d, agora: AGORA + 1000 });
  const final = filaOperacionalV2.appendHistoricoLeveIncremental(cliente, sucesso, { ...d, agora: AGORA + 2000 });
  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, d);

  assert.strictEqual(primeiro.ok, true);
  assert.strictEqual(repetido.idempotente, true, "mesmo resultado publico nao duplica");
  assert.strictEqual(final.upsert, true, "resultado publico novo substitui logicamente o anterior");
  assert.strictEqual(linhasHistoricoLeve(root, cliente).length, 2, "JSONL preserva auditoria tecnica leve");
  assert.strictEqual(lista.total, 1, "listagem publica deduplica por oferta");
  assert.strictEqual(lista.itens[0].statusPublico, "enviado");
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_identidade_execucao";
  const baseProduto = {
    clienteId: cliente,
    ofertaId: "oferta_real_mesmo_produto",
    engineOfertaId: "engine_real_mesmo_produto",
    produtoId: "produto_canonico_123",
    titulo: "Produto Reofertado",
    marketplace: "amazon",
    preco: "99.90"
  };

  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("execucao_1", {
    ...baseProduto,
    status: "enviado",
    criadoEm: "2026-09-14T08:00:00.000Z",
    enviadoEm: "2026-09-14T08:05:00.000Z"
  }), { ...d, agora: AGORA });
  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("execucao_2", {
    ...baseProduto,
    status: "enviado",
    criadoEm: "2026-09-14T16:00:00.000Z",
    enviadoEm: "2026-09-14T16:05:00.000Z"
  }), { ...d, agora: AGORA });

  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, d);
  const contagem = filaOperacionalV2.contarHistoricoLeveHoje(cliente, { data: "2026-09-14" }, d);

  assert.strictEqual(lista.total, 2, "mesmo produto em nova execucao no mesmo dia gera novo registro publico");
  assert.strictEqual(contagem.totalHoje, 2, "contagem diaria considera execucoes publicas, nao produto unico");
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_identidade_execucao_dia";
  const baseProduto = {
    clienteId: cliente,
    ofertaId: "oferta_real_dia",
    engineOfertaId: "engine_real_dia",
    produtoId: "produto_canonico_dia",
    titulo: "Produto Reofertado Dia Seguinte",
    marketplace: "amazon",
    preco: "79.90"
  };

  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("execucao_dia_1", {
    ...baseProduto,
    status: "enviado",
    criadoEm: "2026-09-14T08:00:00.000Z",
    enviadoEm: "2026-09-14T08:05:00.000Z"
  }), { ...d, agora: AGORA });
  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("execucao_dia_2", {
    ...baseProduto,
    status: "enviado",
    criadoEm: "2026-09-15T08:00:00.000Z",
    enviadoEm: "2026-09-15T08:05:00.000Z",
    updatedAt: "2026-09-15T08:05:00.000Z"
  }), { ...d, agora: Date.parse("2026-09-15T12:00:00.000Z") });

  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, d);
  const contagemDia14 = filaOperacionalV2.contarHistoricoLeveHoje(cliente, { data: "2026-09-14" }, d);
  const contagemDia15 = filaOperacionalV2.contarHistoricoLeveHoje(cliente, { data: "2026-09-15" }, d);

  assert.strictEqual(lista.total, 2, "mesmo produto em nova execucao no dia seguinte permanece distinto");
  assert.strictEqual(contagemDia14.totalHoje, 1);
  assert.strictEqual(contagemDia15.totalHoje, 1);
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_identidade_sem_id";
  const baseProduto = {
    id: "",
    filaItemId: "",
    itemFilaId: "",
    clienteId: cliente,
    ofertaId: "oferta_real_sem_id_estavel",
    engineOfertaId: "engine_real_sem_id_estavel",
    produtoId: "produto_sem_id_estavel",
    titulo: "Produto Sem Id de Fila",
    marketplace: "amazon",
    preco: "49.90"
  };

  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("", {
    ...baseProduto,
    status: "enviado",
    criadoEm: "2026-09-14T08:00:00.000Z",
    enviadoEm: "2026-09-14T08:05:00.000Z"
  }), { ...d, agora: AGORA });
  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("", {
    ...baseProduto,
    status: "enviado",
    criadoEm: "2026-09-14T16:00:00.000Z",
    enviadoEm: "2026-09-14T16:05:00.000Z"
  }), { ...d, agora: AGORA });

  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, d);
  assert.strictEqual(lista.total, 2, "fallback sem id de fila usa nascimento operacional e nao produto eterno");
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_identidade_bootstrap_incremental";
  const erro = oferta("exec_boot_inc", {
    clienteId: cliente,
    ofertaId: "oferta_boot_inc",
    produtoId: "produto_boot_inc",
    status: "erro_final",
    criadoEm: "2026-09-14T08:00:00.000Z",
    erroEm: "2026-09-14T08:05:00.000Z",
    updatedAt: "2026-09-14T08:05:00.000Z"
  });
  const sucesso = oferta("exec_boot_inc", {
    clienteId: cliente,
    ofertaId: "oferta_boot_inc",
    produtoId: "produto_boot_inc",
    status: "enviado",
    criadoEm: "2026-09-14T08:00:00.000Z",
    enviadoEm: "2026-09-14T08:10:00.000Z",
    updatedAt: "2026-09-14T08:10:00.000Z"
  });

  escreverHistoricoTecnico(root, cliente, [erro]);
  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, sucesso, {
    ...d,
    agora: AGORA,
    bootstrapHistoricoLeveSincrono: true
  });

  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, d);
  assert.strictEqual(lista.total, 1, "bootstrap e incremental preservam a mesma identidade da execucao");
  assert.strictEqual(lista.itens[0].statusPublico, "enviado");
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_contadores";

  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("ok", {
    clienteId: cliente,
    status: "enviado",
    enviadoEm: "2026-09-14T08:00:00.000Z"
  }), { ...d, agora: AGORA });
  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("nok", {
    clienteId: cliente,
    status: "erro_final",
    erroEm: "2026-09-14T08:01:00.000Z"
  }), { ...d, agora: AGORA });
  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("parcial", {
    clienteId: cliente,
    status: "erro_final",
    destinosEstado: [
      { destinoId: "a", estado: "enviado" },
      { destinoId: "b", estado: "erro_final" }
    ],
    erroEm: "2026-09-14T08:02:00.000Z"
  }), { ...d, agora: AGORA });

  const contagem = filaOperacionalV2.contarHistoricoLeveHoje(cliente, { data: "2026-09-14" }, d);
  assert.strictEqual(contagem.totalHoje, 3);
  assert.strictEqual(contagem.enviadosHoje, 1);
  assert.strictEqual(contagem.naoEnviadosHoje, 1);
  assert.strictEqual(contagem.parciaisHoje, 1);
}

{
  const root = tmpRoot();
  const d = deps(root);
  filaOperacionalV2.appendHistoricoLeveIncremental("cliente_a", oferta("a1", { clienteId: "cliente_a", status: "enviado" }), { ...d, agora: AGORA });
  filaOperacionalV2.appendHistoricoLeveIncremental("cliente_b", oferta("b1", { clienteId: "cliente_b", status: "enviado" }), { ...d, agora: AGORA });

  assert.strictEqual(filaOperacionalV2.listarHistoricoLeveIncremental("cliente_a", {}, d).total, 1);
  assert.strictEqual(filaOperacionalV2.listarHistoricoLeveIncremental("cliente_b", {}, d).total, 1);
  assert.strictEqual(filaOperacionalV2.listarHistoricoLeveIncremental("cliente_a", {}, d).itens[0].clienteId, "cliente_a");
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_hook_v2";
  const vivo = oferta("vivo_hook", { clienteId: cliente, status: "processando" });
  d.writeClienteJson(cliente, "fila-viva.json", [filaOperacionalV2.normalizarEntradasViva([vivo], AGORA)[0]]);

  const update = filaOperacionalV2.atualizarItemFilaVivaIncremental(cliente, {
    ...vivo,
    status: "enviado",
    enviadoEm: "2026-09-14T08:00:00.000Z"
  }, { ...d, agora: AGORA });
  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, d);

  assert.strictEqual(update.removeuDaViva, true, "terminal no fast path V2 deve sair da viva");
  assert.strictEqual(update.historico.historicoLeve.ok, true, "fast path V2 deve registrar historico leve");
  assert.strictEqual(lista.total, 1);
  assert.strictEqual(lista.itens[0].statusPublico, "enviado");
}

{
  const root = tmpRoot();
  const cliente = "cliente_falha_leve";
  const d = deps(root);
  const fsFalhaLeve = {
    ...fs,
    appendFileSync(file, conteudo, enc) {
      if (String(file).includes(filaOperacionalV2.HISTORICO_LEVE_INCREMENTAL_DIR)) {
        throw new Error("historico_leve_indisponivel");
      }
      return fs.appendFileSync(file, conteudo, enc);
    }
  };
  const enviado = oferta("terminal_falha_leve", {
    clienteId: cliente,
    status: "enviado",
    enviadoEm: "2026-09-14T09:00:00.000Z"
  });

  const res = filaOperacionalV2.appendHistoricoIncremental(cliente, enviado, {
    ...d,
    fs: fsFalhaLeve,
    agora: AGORA
  });

  assert.strictEqual(res.ok, true, "falha do historico leve nao quebra historico tecnico");
  assert.strictEqual(res.historicoLeve.ok, false);
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_bootstrap_auto";
  const antigos = Array.from({ length: 376 }, (_, i) => oferta(`antigo_${i}`, {
    clienteId: cliente,
    status: i % 2 === 0 ? "enviado" : "expirada_operacional",
    enviadoEm: i % 2 === 0 ? "2026-09-14T08:00:00.000Z" : "",
    expiradoEm: i % 2 === 0 ? "" : "2026-09-14T08:30:00.000Z"
  }));
  escreverHistoricoTecnico(root, cliente, antigos);
  assert.strictEqual(fs.existsSync(path.join(root, cliente, filaOperacionalV2.HISTORICO_LEVE_INCREMENTAL_DIR)), false);

  const novo = filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("novo_terminal", {
    clienteId: cliente,
    status: "enviado",
    enviadoEm: "2026-09-14T09:00:00.000Z"
  }), { ...d, agora: AGORA, bootstrapHistoricoLeveSincrono: true });
  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, { limite: 400 }, d);

  assert.strictEqual(novo.bootstrap.ok, true);
  assert.strictEqual(novo.bootstrap.processados, 376);
  assert.strictEqual(novo.bootstrap.writes, 1, "bootstrap deve consolidar em um append por arquivo/dia");
  assert.strictEqual(lista.total, 377, "primeiro terminal novo deve reconciliar historico antigo tambem");
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_bootstrap_restart";
  const antigos = Array.from({ length: 20 }, (_, i) => oferta(`restart_${i}`, {
    clienteId: cliente,
    status: "enviado",
    enviadoEm: "2026-09-14T08:00:00.000Z"
  }));
  escreverHistoricoTecnico(root, cliente, antigos);
  const parcial = filaOperacionalV2.bootstrapHistoricoLeveCliente(cliente, { itens: antigos.slice(0, 7), agora: AGORA }, d);
  filaOperacionalV2.limparCacheHistoricoLeve();

  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("restart_novo", {
    clienteId: cliente,
    status: "enviado",
    enviadoEm: "2026-09-14T09:00:00.000Z"
  }), { ...d, agora: AGORA, bootstrapHistoricoLeveSincrono: true });

  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, { limite: 50 }, d);
  assert.strictEqual(parcial.writes, 1);
  assert.strictEqual(lista.total, 21, "reexecucao pos-restart nao duplica visao publica e completa faltantes");
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_bootstrap_completo_restart";
  const antigos = Array.from({ length: 1000 }, (_, i) => oferta(`complete_${i}`, {
    clienteId: cliente,
    status: "enviado",
    enviadoEm: "2026-09-14T08:00:00.000Z"
  }));
  escreverHistoricoTecnico(root, cliente, antigos);
  const primeiro = filaOperacionalV2.bootstrapHistoricoLeveCliente(cliente, { itens: antigos, agora: AGORA }, d);
  const bytesAntes = bytesHistoricoLeve(root, cliente);
  filaOperacionalV2.limparCacheHistoricoLeve();
  const segundo = filaOperacionalV2.appendHistoricoLeveIncremental(cliente, oferta("complete_novo", {
    clienteId: cliente,
    status: "enviado",
    enviadoEm: "2026-09-14T09:00:00.000Z"
  }), { ...d, agora: AGORA, bootstrapHistoricoLeveSincrono: true });
  const bytesDepoisBootstrap = bytesHistoricoLeve(root, cliente) - segundo.bytesAppend;

  assert.strictEqual(primeiro.writes, 1);
  assert.strictEqual(segundo.bootstrap.idempotentes, 1000);
  assert.strictEqual(segundo.bootstrap.writes, 0, "restart com historico completo nao regrava os mesmos 1000");
  assert.strictEqual(bytesDepoisBootstrap, bytesAntes, "bootstrap idempotente nao dobra o tamanho fisico");
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_bootstrap_nao_sobrescreve_novo";
  const antigoErro = oferta("same", {
    clienteId: cliente,
    status: "erro_final",
    erroEm: "2026-09-14T08:00:00.000Z",
    updatedAt: "2026-09-14T08:00:00.000Z"
  });
  escreverHistoricoTecnico(root, cliente, [antigoErro]);
  const sucessoNovo = oferta("same", {
    clienteId: cliente,
    status: "enviado",
    enviadoEm: "2026-09-14T09:00:00.000Z",
    updatedAt: "2026-09-14T09:00:00.000Z"
  });

  filaOperacionalV2.appendHistoricoLeveIncremental(cliente, sucessoNovo, {
    ...d,
    agora: AGORA,
    bootstrapHistoricoLeve: false
  });
  filaOperacionalV2.limparCacheHistoricoLeve();
  const bootstrap = filaOperacionalV2.bootstrapHistoricoLeveCliente(cliente, { itens: [antigoErro], agora: AGORA }, d);
  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, d);

  assert.strictEqual(bootstrap.escritos, 0, "bootstrap antigo nao deve materializar estado mais velho");
  assert.strictEqual(lista.total, 1);
  assert.strictEqual(lista.itens[0].statusPublico, "enviado");
}

{
  const root = tmpRoot();
  const d = deps(root);
  const cliente = "cliente_bootstrap";
  const historico = Array.from({ length: 376 }, (_, i) => oferta(`boot_${i}`, {
    clienteId: cliente,
    status: i % 2 === 0 ? "enviado" : "expirada_operacional",
    enviadoEm: i % 2 === 0 ? "2026-09-14T08:00:00.000Z" : "",
    expiradoEm: i % 2 === 0 ? "" : "2026-09-14T08:30:00.000Z"
  }));

  const primeiro = filaOperacionalV2.bootstrapHistoricoLeveCliente(cliente, { itens: historico, agora: AGORA }, d);
  const segundo = filaOperacionalV2.bootstrapHistoricoLeveCliente(cliente, { itens: historico, agora: AGORA }, d);
  const lista = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, { limite: 400 }, d);
  const contagem = filaOperacionalV2.contarHistoricoLeveHoje(cliente, { data: "2026-09-14" }, d);

  assert.strictEqual(primeiro.ok, true);
  assert.strictEqual(primeiro.processados, 376);
  assert.strictEqual(primeiro.writes, 1);
  assert.strictEqual(segundo.idempotentes, 376, "bootstrap repetido deve ser retomavel/idempotente");
  assert.strictEqual(segundo.writes, 0, "bootstrap repetido nao deve crescer JSONL fisicamente");
  assert.strictEqual(lista.total, 376);
  assert.strictEqual(contagem.enviadosHoje, 188);
  assert.strictEqual(contagem.naoEnviadosHoje, 188);
  assert.strictEqual(contagem.parciaisHoje, 0);
}

console.log("fila-historico-leve-v2.test.js OK");
