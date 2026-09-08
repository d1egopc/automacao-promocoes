"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDirAnterior = process.env.DATA_DIR;
const dataDirTeste = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-clonador-2b-"));
process.env.DATA_DIR = dataDirTeste;

const { writeGlobalJson } = require("../utils/storage");
writeGlobalJson("usuarios.json", [
  { id: "workspace_a", ativo: true, plano: "pro" },
  { id: "workspace_b", ativo: true, plano: "pro" }
]);

const {
  criarBridgeClonadorGrupos,
  montarComercialCapturado,
  resolverLinksClonador
} = require("../modules/clonador-grupos/bridge");
const {
  aplicarComercialCapturadoClonador
} = require("../modules/engine/importer/importer.service");
const {
  filtrarDestinosClonadorGrupos,
  validarOfertaParaDistribuicao
} = require("../modules/engine/distributor/distributor.service");

function clone(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function limparModulo(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mockModulo(relativo, exports) {
  const resolvido = limparModulo(relativo);
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports
  };
  return resolvido;
}

function criarRepoMemoria() {
  const estado = {
    buffer: [],
    destinos: new Map()
  };

  return {
    estado,
    adicionarBuffer(item = {}) {
      estado.buffer.push({
        status: "capturada",
        metadata: {},
        ...item
      });
    },
    async listarDestinos(clienteId = "") {
      return clone(estado.destinos.get(clienteId) || []);
    },
    async reivindicarProximaCaptura() {
      const item = estado.buffer.find(registro => registro.status === "capturada");
      if (!item) return null;
      item.status = "processando";
      item.metadata = {
        ...(item.metadata || {}),
        clonadorGruposBridge: { status: "processando" }
      };
      return clone(item);
    },
    async atualizarBufferStatus(bufferId = "", status = "", metadata = {}) {
      const item = estado.buffer.find(registro => String(registro.id) === String(bufferId));
      if (!item) return null;
      item.status = status;
      item.metadata = {
        ...(item.metadata || {}),
        ...(metadata || {})
      };
      return clone(item);
    }
  };
}

function itemBuffer(extra = {}) {
  return {
    id: extra.id || "101",
    clienteId: extra.clienteId || "workspace_a",
    sessaoId: extra.sessaoId || "sessao_a",
    grupoJid: extra.grupoJid || "grupo_a@g.us",
    grupoNome: extra.grupoNome || "Grupo A",
    mensagemId: extra.mensagemId || "msg_101",
    textoOriginal: extra.textoOriginal || "Produto teste\nPor: R$ 256,90\nDe R$ 449,99\nCupom: OFERTASEMPRE\nhttps://meli.la/abc",
    links: extra.links || ["https://meli.la/abc"],
    capturadoEm: extra.capturadoEm || "2026-09-06T12:00:00.000Z",
    status: "capturada",
    metadata: {}
  };
}

function destino(extra = {}) {
  return {
    id: extra.id || "destino_ok",
    nome: extra.nome || "Destino",
    ativo: extra.ativo !== false,
    tipo: "telegram",
    botToken: extra.botToken === undefined ? "bot" : extra.botToken,
    chatId: extra.chatId === undefined ? "chat" : extra.chatId,
    marketplaces: extra.marketplaces || ["mercadolivre"],
    categorias: Object.prototype.hasOwnProperty.call(extra, "categorias") ? extra.categorias : ["Calcados"],
    ...extra
  };
}

async function testarBridgeRegistraUmaVez() {
  const repo = criarRepoMemoria();
  repo.estado.destinos.set("workspace_a", [{ destinoId: "destino_ok" }]);
  repo.adicionarBuffer(itemBuffer());
  const eventos = [];
  const bridge = criarBridgeClonadorGrupos({
    repository: repo,
    resolverRedirectUniversal: async (url) => ({
      ok: true,
      urlOriginal: url,
      urlFinal: "https://www.mercadolivre.com.br/p/MLB123",
      urlExpandida: "https://www.mercadolivre.com.br/p/MLB123",
      marketplaceDetectado: "mercadolivre",
      status: "resolvido",
      chaveCanonica: "mercadolivre:MLB123"
    }),
    registrarEventoBruto: async (evento, opcoes) => {
      eventos.push({ evento, opcoes });
      return { ok: true, id: 9001, jobsCriados: 1, jobsExistentes: 0 };
    },
    logger: { log() {} }
  });

  const resultado = await bridge.processarCapturasPendentes({ limite: 1 });
  assert.strictEqual(resultado.prontas, 1);
  assert.strictEqual(eventos.length, 1);
  assert.strictEqual(eventos[0].evento.origem, "clonador_grupos");
  assert.strictEqual(eventos[0].evento.origemFluxo, "clonador_grupos");
  assert.strictEqual(eventos[0].evento.fonte, "clonador_grupos");
  assert.strictEqual(eventos[0].evento.origemTipo, "whatsapp");
  assert.deepStrictEqual(eventos[0].opcoes.clientes, ["workspace_a"]);
  assert.deepStrictEqual(eventos[0].evento.linksExtraidos, ["https://www.mercadolivre.com.br/p/MLB123"]);
  assert.strictEqual(eventos[0].evento.metadata.clonadorGrupos.bufferId, "101");
  assert.strictEqual(eventos[0].evento.metadata.origemFluxo, "clonador_grupos");
  assert.deepStrictEqual(eventos[0].evento.metadata.clonadorGrupos.destinoIds, ["destino_ok"]);
  assert.ok(!eventos[0].evento.metadata.radarMirror);
  assert.strictEqual(repo.estado.buffer[0].status, "pronta");
}

async function testarConcorrenciaNaoDuplica() {
  const repo = criarRepoMemoria();
  repo.adicionarBuffer(itemBuffer({ id: "102", mensagemId: "msg_concorrente" }));
  let chamadas = 0;
  const bridge = criarBridgeClonadorGrupos({
    repository: repo,
    resolverRedirectUniversal: async () => ({ ok: false, status: "ignorado", motivo: "dominio_redirect_nao_permitido" }),
    registrarEventoBruto: async () => {
      chamadas += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      return { ok: true, id: 9002, jobsCriados: 1 };
    },
    logger: { log() {} }
  });

  await Promise.all([
    bridge.processarCapturasPendentes({ limite: 1 }),
    bridge.processarCapturasPendentes({ limite: 1 })
  ]);
  assert.strictEqual(chamadas, 1);
  assert.strictEqual(repo.estado.buffer[0].status, "pronta");
}

async function testarFalhaRedirectPreservaOriginal() {
  const resolvido = await resolverLinksClonador(["https://amzn.to/falha"], async () => ({
    ok: false,
    status: "falhou",
    motivo: "redirect_timeout"
  }));
  assert.deepStrictEqual(resolvido.linksPreparados, ["https://amzn.to/falha"]);
  assert.strictEqual(resolvido.redirects[0].status, "falhou");
}

async function testarErroBridgeNaoDerrubaPipeline() {
  const repo = criarRepoMemoria();
  repo.adicionarBuffer(itemBuffer({ id: "105", mensagemId: "msg_erro" }));
  const bridge = criarBridgeClonadorGrupos({
    repository: repo,
    resolverRedirectUniversal: async () => ({ ok: false, status: "ignorado" }),
    registrarEventoBruto: async () => {
      throw new Error("engine_indisponivel");
    },
    logger: { log() {} }
  });

  const resultado = await bridge.processarCapturasPendentes({ limite: 1 });
  assert.strictEqual(resultado.processadas, 1);
  assert.strictEqual(resultado.erros, 1);
  assert.strictEqual(repo.estado.buffer[0].status, "erro");
}

async function testarDiagnosticoInboxPropagadoParaBuffer() {
  const repo = criarRepoMemoria();
  repo.estado.destinos.set("workspace_a", [{ destinoId: "destino_ok" }]);
  repo.adicionarBuffer(itemBuffer({ id: "105_diagnostico", mensagemId: "msg_diagnostico" }));
  const diagnostico = {
    operacao: "evento_insert",
    postgres: { code: "22P02", position: "231", detail: 'Token "[redigido]" is invalid.', constraint: null },
    parametros: {
      links_extraidos: { tipo: "object", array: true, tamanhoSerializado: 42, hashSerializado: "a".repeat(64), jsonStringifyOk: true, jsonParseSerializadoOk: true },
      metadata: { tipo: "object", array: false, tamanhoSerializado: 84, hashSerializado: "b".repeat(64), jsonStringifyOk: true, jsonParseSerializadoOk: true }
    }
  };
  const bridge = criarBridgeClonadorGrupos({
    repository: repo,
    resolverRedirectUniversal: async () => ({ ok: false, status: "ignorado" }),
    registrarEventoBruto: async () => ({ ok: false, motivo: "query_falhou", erro: "invalid input syntax for type json", diagnostico }),
    logger: { log() {} }
  });

  const resultado = await bridge.processarCapturasPendentes({ limite: 1 });
  assert.strictEqual(resultado.erros, 1);
  const buffer = repo.estado.buffer.find(item => item.id === "105_diagnostico");
  assert.strictEqual(buffer.status, "erro");
  assert.deepStrictEqual(buffer.metadata.clonadorGruposBridge.diagnostico, diagnostico);
}

async function testarWorkspaceNaoUsaDestinosDeOutroCliente() {
  const repo = criarRepoMemoria();
  repo.estado.destinos.set("workspace_a", [{ destinoId: "destino_a" }]);
  repo.estado.destinos.set("workspace_b", [{ destinoId: "destino_b" }]);
  repo.adicionarBuffer(itemBuffer({ id: "106", clienteId: "workspace_a", mensagemId: "msg_workspace_a" }));
  const eventos = [];
  const bridge = criarBridgeClonadorGrupos({
    repository: repo,
    resolverRedirectUniversal: async () => ({ ok: false, status: "ignorado" }),
    registrarEventoBruto: async (evento, opcoes) => {
      eventos.push({ evento, opcoes });
      return { ok: true, id: 9006, jobsCriados: 1 };
    },
    logger: { log() {} }
  });

  await bridge.processarCapturasPendentes({ limite: 1 });
  assert.deepStrictEqual(eventos[0].opcoes.clientes, ["workspace_a"]);
  assert.deepStrictEqual(eventos[0].evento.metadata.clonadorGrupos.destinoIds, ["destino_a"]);
}

async function testarDeduplicacaoIsoladaPorOrigem() {
  limparModulo("../modules/engine/inbox.service");
  const eventos = [];
  let proximoId = 1;

  mockModulo("../modules/engine/database", {
    queryEngine: async (sql, params = []) => {
      if (/SELECT id\s+FROM engine_eventos_brutos\s+WHERE COALESCE\(origem/i.test(sql)) {
        assert.strictEqual(params.length, 4, "dedup deve receber origem, grupo, texto e links");
        const [origem, grupoId, textoOriginal, linksJson] = params;
        const encontrado = [...eventos].reverse().find(evento =>
          evento.origem === origem &&
          evento.grupoId === grupoId &&
          evento.textoOriginal === textoOriginal &&
          JSON.stringify(evento.linksExtraidos) === linksJson
        );
        return { ok: true, resultado: { rows: encontrado ? [{ id: encontrado.id }] : [] }, metricas: {} };
      }

      if (/INSERT INTO engine_eventos_brutos/i.test(sql)) {
        const hashEvento = params[9];
        if (eventos.some(evento => evento.hashEvento === hashEvento)) {
          return { ok: true, resultado: { rows: [] }, metricas: {} };
        }
        const evento = {
          id: proximoId++,
          origem: params[0],
          grupoId: params[4],
          textoOriginal: params[6],
          linksExtraidos: JSON.parse(params[7]),
          hashEvento,
          metadata: JSON.parse(params[10])
        };
        eventos.push(evento);
        return { ok: true, resultado: { rows: [{ id: evento.id }] }, metricas: {} };
      }

      if (/SELECT id\s+FROM engine_eventos_brutos\s+WHERE hash_evento/i.test(sql)) {
        const encontrado = eventos.find(evento => evento.hashEvento === params[0]);
        return { ok: true, resultado: { rows: encontrado ? [{ id: encontrado.id }] : [] }, metricas: {} };
      }

      if (/INSERT INTO engine_links/i.test(sql)) {
        return { ok: true, resultado: { rows: [] }, metricas: {} };
      }

      throw new Error(`query_nao_esperada: ${sql}`);
    }
  });
  mockModulo("../modules/engine/jobs.service", {
    criarJobsParaClientes: async () => ({ ok: true, criados: 1, existentes: 0 })
  });

  const { registrarEventoBruto } = require("../modules/engine/inbox.service");
  const registrar = (origem, sufixo, metadata = {}) => registrarEventoBruto({
    origem,
    fonte: origem,
    origemTipo: "whatsapp",
    grupoId: `grupo_${sufixo}@g.us`,
    textoOriginal: `Oferta igual ${sufixo}`,
    linksExtraidos: [`https://meli.la/${sufixo}`],
    capturadoEm: "2026-09-07T12:00:00.000Z",
    metadata
  }, { clientes: ["workspace_a"] });

  const radar1 = await registrar("radar", "radar_mesma_origem", { radarMirror: { versao: 1 } });
  const radar2 = await registrar("radar", "radar_mesma_origem", { radarMirror: { versao: 2 } });
  assert.strictEqual(radar1.duplicado, false);
  assert.strictEqual(radar2.duplicado, true, "Radar deve continuar deduplicando Radar");
  assert.strictEqual(radar2.id, radar1.id);

  const metadataClonador = {
    clonadorGrupos: { bufferId: "buffer_1", destinoIds: ["destino_clone"] },
    comercialCapturado: { origem: "clonador_grupos", precoAtual: 99.9 }
  };
  const clonador1 = await registrar("clonador_grupos", "clonador_mesma_origem", metadataClonador);
  const clonador2 = await registrar("clonador_grupos", "clonador_mesma_origem", metadataClonador);
  assert.strictEqual(clonador1.duplicado, false);
  assert.strictEqual(clonador2.duplicado, true, "Clonador deve continuar deduplicando Clonador");
  assert.strictEqual(clonador2.id, clonador1.id);

  const radarAntes = await registrar("radar", "radar_depois_clonador", { radarMirror: { versao: 1 } });
  const clonadorDepois = await registrar("clonador_grupos", "radar_depois_clonador", metadataClonador);
  assert.strictEqual(radarAntes.duplicado, false);
  assert.strictEqual(clonadorDepois.duplicado, false, "Radar seguido de Clonador deve criar outro evento");
  assert.notStrictEqual(clonadorDepois.id, radarAntes.id);

  const clonadorAntes = await registrar("clonador_grupos", "clonador_depois_radar", metadataClonador);
  const radarDepois = await registrar("radar", "clonador_depois_radar", { radarMirror: { versao: 1 } });
  assert.strictEqual(clonadorAntes.duplicado, false);
  assert.strictEqual(radarDepois.duplicado, false, "Clonador seguido de Radar deve criar outro evento");
  assert.notStrictEqual(radarDepois.id, clonadorAntes.id);

  const eventosClonador = eventos.filter(evento => evento.origem === "clonador_grupos");
  assert(eventosClonador.every(evento => evento.metadata.clonadorGrupos));
  assert(eventosClonador.every(evento => evento.metadata.comercialCapturado));
  assert(eventosClonador.every(evento =>
    JSON.stringify(evento.metadata.clonadorGrupos.destinoIds) === JSON.stringify(["destino_clone"])
  ));

  const eventosRadar = eventos.filter(evento => evento.origem === "radar");
  assert(eventosRadar.every(evento => !evento.metadata.clonadorGrupos));
  assert(eventosRadar.every(evento => !evento.metadata.comercialCapturado));
}

function testarComercialCapturado() {
  const contrato = montarComercialCapturado({
    textoOriginal: "Azzaro Pour Homme\nDe R$ 449,99\nPor: R$ 256,90\nCupom: OFERTASEMPRE\nhttps://amzn.to/x",
    links: ["https://amzn.to/x"],
    marketplaceDetectado: "amazon"
  });
  assert.strictEqual(contrato.origem, "clonador_grupos");
  assert.strictEqual(contrato.precoAtual, 256.9);
  assert.strictEqual(contrato.precoAnterior, 449.99);
  assert.strictEqual(contrato.cupom, "OFERTASEMPRE");

  const beneficio = montarComercialCapturado({
    textoOriginal: "R$ 50 OFF a partir de R$ 249: VOLTOU50\nhttps://s.shopee.com.br/x",
    links: ["https://s.shopee.com.br/x"],
    marketplaceDetectado: "shopee"
  });
  assert.ok(beneficio.beneficioExtra.includes("R$ 50 OFF a partir de R$ 249"));
  assert.ok(!beneficio.campos.precoAtual, "valor de cupom nao deve virar preco atual");
  assert.ok(!beneficio.campos.precoAnterior, "minimo de cupom nao deve virar preco anterior isolado");

  const bermuda = montarComercialCapturado({
    textoOriginal: [
      "PRECINHO DE 107 LEVA 3 BERMUDAS",
      "",
      "Kit 3 Bermuda Masculina Sarja Short Jeans Social Brim Lisa",
      "",
      "De: R$ 183",
      "Por: R$ 106,94 no Pix",
      "",
      "Cupom: OFERTASEMPRE",
      "",
      "Confira aqui: https://meli.la/2CX5cwy",
      "",
      "Aplique o cupom OFERTASEMPRE + Pix para chegar neste valor."
    ].join("\n"),
    links: ["https://meli.la/2CX5cwy"],
    marketplaceDetectado: "mercadolivre"
  });
  assert.strictEqual(bermuda.tituloCapturado, "Kit 3 Bermuda Masculina Sarja Short Jeans Social Brim Lisa");
  assert.notStrictEqual(bermuda.tituloCapturado, "PRECINHO DE 107 LEVA 3 BERMUDAS");
  assert.strictEqual(bermuda.precoAtual, 106.94);
  assert.strictEqual(bermuda.precoAnterior, 183);
  assert.strictEqual(bermuda.cupom, "OFERTASEMPRE");
  assert.ok(bermuda.beneficioExtra.includes("OFERTASEMPRE + Pix"));
  assert.ok(!bermuda.radarMirror);

  const chamadaGenerica = montarComercialCapturado({
    textoOriginal: "Compre antes que acabe\nPor: R$ 106,94\nhttps://meli.la/x",
    links: ["https://meli.la/x"],
    marketplaceDetectado: "mercadolivre"
  });
  assert.ok(!chamadaGenerica.tituloCapturado, "CTA generico nao deve virar titulo confiavel");

  const chamadaSemelhante = montarComercialCapturado({
    textoOriginal: "Aproveite antes que acabe\nPor: R$ 106,94\nhttps://meli.la/y",
    links: ["https://meli.la/y"],
    marketplaceDetectado: "mercadolivre"
  });
  assert.ok(!chamadaSemelhante.tituloCapturado, "CTA de urgencia nao deve virar titulo confiavel");
}

function testarAplicacaoComercialNeutraImporter() {
  const contrato = {
    origem: "clonador_grupos",
    precoAtual: 256.9,
    precoAnterior: 449.99,
    cupom: "OFERTASEMPRE",
    beneficioExtra: "R$ 50 OFF a partir de R$ 249",
    campos: { precoAtual: true, precoAnterior: true, cupom: true, beneficio: true }
  };
  const aplicado = aplicarComercialCapturadoClonador({
    oferta: {
      titulo: "Azzaro Pour Homme Perfume Masculino Eau de Toilette",
      preco: 292.23,
      precoOriginal: 399.99,
      cupom: "",
      metadata: {}
    },
    ofertaEntrada: {
      titulo: "Azzaro Pour Homme Perfume Masculino Eau de Toilette",
      preco: 292.23,
      metadata: {}
    },
    evento: {
      origem: "clonador_grupos",
      metadata: {
        clonadorGrupos: { bufferId: "103", destinoIds: ["destino_ok"] },
        comercialCapturado: contrato
      }
    },
    job: { cliente_id: "workspace_a", metadata: {} }
  });

  assert.strictEqual(aplicado.oferta.titulo, "Azzaro Pour Homme Perfume Masculino Eau de Toilette");
  assert.strictEqual(aplicado.oferta.preco, 256.9);
  assert.strictEqual(aplicado.oferta.precoOriginal, 449.99);
  assert.strictEqual(aplicado.oferta.cupom, "OFERTASEMPRE");
  assert.strictEqual(aplicado.ofertaEntrada.beneficioExtra, "R$ 50 OFF a partir de R$ 249");
  assert.ok(!aplicado.metadata.radarMirror);

  const ausente = aplicarComercialCapturadoClonador({
    oferta: { titulo: "Titulo tecnico", preco: 292.23, metadata: {} },
    ofertaEntrada: { metadata: {} },
    evento: {
      origem: "clonador_grupos",
      metadata: {
        clonadorGrupos: { bufferId: "104" },
        comercialCapturado: { origem: "clonador_grupos", cupom: "OFERTASEMPRE", campos: { cupom: true } }
      }
    },
    job: { cliente_id: "workspace_a", metadata: {} }
  });
  assert.strictEqual(ausente.oferta.preco, 292.23, "importer deve completar campo ausente no Clonador");
  assert.strictEqual(ausente.oferta.cupom, "OFERTASEMPRE");
}

async function testarFiltroDestinosClonador() {
  const destinos = [
    destino({ id: "destino_ok" }),
    destino({ id: "destino_bloqueado" })
  ];
  const oferta = {
    id: 1,
    job_id: 2,
    cliente_id: "workspace_a",
    origem: "clonador_grupos",
    marketplace: "mercadolivre",
    categoria: "Calcados",
    titulo: "Tenis Puma",
    metadata: {
      clonadorGrupos: { destinoIds: ["destino_ok"] }
    }
  };

  assert.deepStrictEqual(
    filtrarDestinosClonadorGrupos(destinos, oferta).map(item => item.id),
    ["destino_ok"]
  );
  assert.deepStrictEqual(
    filtrarDestinosClonadorGrupos(destinos, {
      ...oferta,
      origem: "radar",
      metadata: { clonadorGrupos: { destinoIds: ["destino_ok"] } }
    }).map(item => item.id),
    ["destino_ok", "destino_bloqueado"],
    "metadata clonador acidental em outra origem nao deve filtrar destinos"
  );
  assert.deepStrictEqual(
    filtrarDestinosClonadorGrupos(destinos, {
      ...oferta,
      metadata: { clonadorGrupos: { destinoIds: ["destino_ok", "destino_inexistente"] } }
    }).map(item => item.id),
    ["destino_ok"]
  );
  assert.deepStrictEqual(
    filtrarDestinosClonadorGrupos(destinos, { ...oferta, metadata: { clonadorGrupos: { destinoIds: [] } } }),
    []
  );
  assert.strictEqual(filtrarDestinosClonadorGrupos(destinos, { metadata: {} }).length, 2);

  const validacaoAutorizado = await validarOfertaParaDistribuicao(oferta, {
    clientesValidos: ["workspace_a"],
    marketplacesAtivosPorCliente: { workspace_a: ["mercadolivre"] },
    destinosPorCliente: { workspace_a: destinos }
  });
  assert.strictEqual(validacaoAutorizado.ok, true);
  assert.strictEqual(validacaoAutorizado.destinosCompativeis, 1);

  const validacaoRegraDestino = await validarOfertaParaDistribuicao({
    ...oferta,
    categoria: "Eletronicos"
  }, {
    clientesValidos: ["workspace_a"],
    marketplacesAtivosPorCliente: { workspace_a: ["mercadolivre"] },
    destinosPorCliente: { workspace_a: destinos }
  });
  assert.strictEqual(validacaoRegraDestino.ok, false, "destino autorizado ainda deve obedecer categoria/marketplace");

  const validacaoSemBroadcast = await validarOfertaParaDistribuicao({
    ...oferta,
    metadata: { clonadorGrupos: { destinoIds: [] } }
  }, {
    clientesValidos: ["workspace_a"],
    marketplacesAtivosPorCliente: { workspace_a: ["mercadolivre"] },
    destinosPorCliente: { workspace_a: destinos }
  });
  assert.strictEqual(validacaoSemBroadcast.ok, false);
  assert.strictEqual(validacaoSemBroadcast.detalhes.destinosTotal, 0);

  const validacaoOrigemClonador = await validarOfertaParaDistribuicao(oferta, {
    clientesValidos: ["workspace_a"],
    marketplacesAtivosPorCliente: { workspace_a: ["mercadolivre"] },
    destinosPorCliente: { workspace_a: [destino({ id: "destino_ok", origemOfertas: "clonador" })] }
  });
  assert.strictEqual(validacaoOrigemClonador.ok, true, "destinoIds autorizado + origemOfertas=clonador segue para regras normais");
  assert.strictEqual(validacaoOrigemClonador.destinosCompativeis, 1);

  const validacaoOrigemBloqueada = await validarOfertaParaDistribuicao(oferta, {
    clientesValidos: ["workspace_a"],
    marketplacesAtivosPorCliente: { workspace_a: ["mercadolivre"] },
    destinosPorCliente: { workspace_a: [destino({ id: "destino_ok", origemOfertas: "optimus" })] }
  });
  assert.strictEqual(validacaoOrigemBloqueada.ok, false, "Clonador autorizado nao pode furar destino configurado para Optimus");
  assert.strictEqual(validacaoOrigemBloqueada.motivo, "origem_nao_permitida");

  const validacaoMetadataAcidental = await validarOfertaParaDistribuicao({
    ...oferta,
    origem: "radar",
    metadata: { clonadorGrupos: { destinoIds: ["destino_bloqueado"] } }
  }, {
    clientesValidos: ["workspace_a"],
    marketplacesAtivosPorCliente: { workspace_a: ["mercadolivre"] },
    destinosPorCliente: { workspace_a: [destino({ id: "destino_ok", origemOfertas: "optimus" })] }
  });
  assert.strictEqual(validacaoMetadataAcidental.ok, true, "metadata clonador acidental sem origem clonador_grupos nao limita destino normal");
}

function testarEscopoEstrutural() {
  const bridgeFonte = fs.readFileSync(path.join(__dirname, "..", "modules", "clonador-grupos", "bridge.js"), "utf8");
  assert.ok(!bridgeFonte.includes("registrarEventoBrutoEngineRadar"));
  assert.ok(!bridgeFonte.includes("resolverPrecedenciaComercialRadar"));
  assert.ok(!bridgeFonte.includes("debitarCreditos"));
  assert.ok(!bridgeFonte.includes("usuarioTemCreditos"));
  assert.ok(!bridgeFonte.includes("radarMirror"));
}

async function main() {
  try {
    await testarBridgeRegistraUmaVez();
    await testarConcorrenciaNaoDuplica();
    await testarFalhaRedirectPreservaOriginal();
    await testarErroBridgeNaoDerrubaPipeline();
    await testarDiagnosticoInboxPropagadoParaBuffer();
    await testarWorkspaceNaoUsaDestinosDeOutroCliente();
    await testarDeduplicacaoIsoladaPorOrigem();
    testarComercialCapturado();
    testarAplicacaoComercialNeutraImporter();
    await testarFiltroDestinosClonador();
    testarEscopoEstrutural();
    console.log("clonador-grupos-engine-bridge.test.js OK");
  } finally {
    process.env.DATA_DIR = dataDirAnterior;
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
