const assert = require("assert");

const databasePath = require.resolve("../modules/engine/database");
const inteligenciaPath = require.resolve("../modules/inteligencia-universal");

const estado = {
  consultasMemoria: [],
  avaliacoes: [],
  falharMemoria: false,
  atrasoConsultaMs: 0,
  totalRows: 1
};

function resetarEstado() {
  estado.consultasMemoria = [];
  estado.avaliacoes = [];
  estado.falharMemoria = false;
  estado.atrasoConsultaMs = 0;
  estado.totalRows = 1;
}

function linhaMemoria(clienteId, ofertaId, indice = 0) {
  return {
    id: Number(ofertaId || 1000) + indice + 1,
    marketplace: "mercadolivre",
    titulo: `Historico ${clienteId} ${ofertaId} ${indice}`,
    titulo_normalizado: `historico ${clienteId} ${ofertaId} ${indice}`,
    preco: 130,
    preco_original: 160,
    cupom: "",
    tipo_cupom: "",
    beneficio_extra: "",
    link_original: `https://produto.mercadolivre.com.br/MLB-${ofertaId || 123456}-historico-${indice}`,
    link_expandido: "",
    link_afiliado: "",
    categoria: "Eletronicos",
    score: 70,
    prioridade: 70,
    metadata: {},
    status: "fila",
    capturada_em: "2026-10-05T20:00:00.000Z",
    criada_em: "2026-10-05T20:00:00.000Z",
    memoria_em: "2026-10-05T20:00:00.000Z",
    cliente_id: clienteId
  };
}

require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    queryEngine: async (sql, params = []) => {
      if (/information_schema\.columns/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ existe: true }] } };
      }

      if (/COALESCE\(publicacao\.publicada_em, o\.criada_em\)/i.test(sql)) {
        const [clienteId, marketplace, ofertaId] = params;
        estado.consultasMemoria.push({ clienteId, marketplace, ofertaId });
        if (estado.atrasoConsultaMs > 0) {
          await new Promise(resolve => setTimeout(resolve, estado.atrasoConsultaMs));
        }
        if (estado.falharMemoria) {
          return { ok: false, motivo: "query_falhou", erro: "falha_controlada" };
        }
        return {
          ok: true,
          resultado: {
            rows: Array.from({ length: estado.totalRows }, (_, indice) => linhaMemoria(clienteId, ofertaId, indice))
          }
        };
      }

      return { ok: true, resultado: { rows: [] } };
    }
  }
};

require.cache[inteligenciaPath] = {
  id: inteligenciaPath,
  filename: inteligenciaPath,
  loaded: true,
  exports: {
    detectarIdentidadeProdutoUniversal: oferta => ({
      produtoIdDetectado: String(oferta.produtoIdDetectado || oferta.itemId || "MLB123456"),
      tipoIdentidade: "mlb"
    }),
    avaliarOfertaUniversal: (oferta, contexto) => {
      estado.avaliacoes.push({
        clienteId: contexto.clienteId,
        preco: oferta.precoAtual,
        titulo: oferta.titulo,
        memoria: contexto.memoriaAnteriores,
        memoriaDisponivel: contexto.memoriaDisponivel,
        memoriaMotivoIndisponivel: contexto.memoriaMotivoIndisponivel
      });

      const memoriaDisponivel = contexto.memoriaDisponivel === true;
      const prioridade = Number(oferta.precoAtual) <= 80 ? 90 : 70;
      return {
        ok: memoriaDisponivel,
        status: memoriaDisponivel ? "aprovada" : "retida",
        motivo: memoriaDisponivel ? `preco_${oferta.precoAtual}` : contexto.memoriaMotivoIndisponivel,
        categoria: oferta.categoria || "Eletronicos",
        score: prioridade,
        prioridade,
        ofertaUniversal: {
          ...oferta,
          categoria: oferta.categoria || "Eletronicos"
        },
        memoria: {
          memoriaDisponivel,
          memoriaOficialStatus: memoriaDisponivel ? "neutra" : "indisponivel",
          memoriaOficialMotivo: memoriaDisponivel ? "teste" : contexto.memoriaMotivoIndisponivel,
          totalMemoriaCandidatos: contexto.memoriaAnteriores.length,
          totalMemoriaCompativeis: contexto.memoriaAnteriores.length,
          totalMemoriaJanela2h: contexto.memoriaAnteriores.length
        },
        destino: {},
        templateInput: {},
        logs: [],
        valorEfetivo: Number(oferta.precoAtual),
        valorEfetivoCentavos: Number(oferta.precoAtual) * 100,
        valorEfetivoOrigem: "preco",
        valorEfetivoDetalhes: { comprovado: true }
      };
    }
  }
};

delete require.cache[require.resolve("../modules/engine/importer/importer.service")];
const { aplicarSombraInteligenciaUniversalV2 } = require("../modules/engine/importer/importer.service");
const { compararRadarMirrorComImportador } = require("../modules/radar/radar-mirror");
const { resolverPrecedenciaComercialRadar } = require("../modules/radar/comercial-precedencia");

function ofertaBase(extras = {}) {
  return {
    marketplace: "mercadolivre",
    titulo: "Produto Importador",
    preco: 120,
    precoOriginal: 150,
    cupom: "",
    cupomTipo: "",
    categoria: "Eletronicos",
    produtoIdDetectado: "MLB123456",
    linkOriginal: "https://produto.mercadolivre.com.br/MLB-123456-produto",
    linkExpandido: "https://produto.mercadolivre.com.br/MLB-123456-produto",
    linkAfiliado: "https://meli.la/afiliado123",
    ...extras
  };
}

function radarMirror() {
  const linkProduto = "https://produto.mercadolivre.com.br/MLB-123456-produto";
  return {
    versao: 1,
    origem: { clienteId: "workspace_a", tipo: "whatsapp" },
    texto: { original: `Produto Radar\nPor R$ 80\nCupom RADAR20\n${linkProduto}` },
    produto: { tituloCapturado: "Produto Radar" },
    preco: {
      atualCapturado: 80,
      anteriorCapturado: 150,
      confianca: "alta",
      condicionado: false,
      tipoCapturado: "final",
      evidenciaCapturada: "Por R$ 80",
      marcadorComercial: "por"
    },
    cupom: {
      codigoCapturado: "RADAR20",
      textoCapturado: "Cupom RADAR20",
      condicaoCapturada: "Use RADAR20",
      confianca: "alta"
    },
    links: {
      encontrados: [linkProduto],
      produtoOriginal: linkProduto,
      resgateCupom: "",
      adicionais: [],
      quantidadeEncontrada: 1
    },
    comercial: {
      precoAtual: { valor: 80, confianca: "alta", evidencia: "Por R$ 80", tipo: "final" },
      precoAntigo: { valor: 150, confianca: "media", evidencia: "De R$ 150" },
      cupom: { codigo: "RADAR20", texto: "Cupom RADAR20", instrucao: "Use RADAR20", confianca: "alta", provavel: false },
      links: { produto: linkProduto, resgate: "" }
    }
  };
}

async function executarDuasAvaliacoes({ job, contextoExecucao }) {
  const entrada = ofertaBase({ metadata: { produto: { produtoId: "MLB123456" } } });
  const primeira = await aplicarSombraInteligenciaUniversalV2(ofertaBase(), entrada, job, contextoExecucao);
  const comparado = compararRadarMirrorComImportador(radarMirror(), primeira.oferta);
  const precedencia = resolverPrecedenciaComercialRadar({
    ofertaImportador: primeira.oferta,
    radarMirror: comparado,
    metadata: {},
    clienteId: job.cliente_id,
    marketplace: "mercadolivre"
  });
  assert.strictEqual(precedencia.oferta.preco, 80);
  assert.strictEqual(precedencia.oferta.cupom, "RADAR20");
  const segunda = await aplicarSombraInteligenciaUniversalV2(precedencia.oferta, entrada, job, contextoExecucao);
  return { primeira, segunda };
}

async function testeRadarMirrorUmaConsultaDuasAvaliacoes() {
  resetarEstado();
  const contextoExecucao = {};
  const resultado = await executarDuasAvaliacoes({
    job: { id: 1, oferta_id: 1001, cliente_id: "workspace_a" },
    contextoExecucao
  });

  assert.strictEqual(estado.consultasMemoria.length, 1);
  assert.strictEqual(estado.avaliacoes.length, 2);
  assert.strictEqual(estado.avaliacoes[0].preco, 120);
  assert.strictEqual(estado.avaliacoes[1].preco, 80);
  assert.notStrictEqual(resultado.primeira.metadata.inteligenciaUniversalV2.prioridade, resultado.segunda.metadata.inteligenciaUniversalV2.prioridade);
  assert.strictEqual(estado.avaliacoes[0].memoria, estado.avaliacoes[1].memoria);
  assert.strictEqual(estado.avaliacoes[0].memoria.length, 1);
  assert.strictEqual(estado.avaliacoes[0].memoria[0].clienteId, "workspace_a");
  assert.strictEqual(estado.avaliacoes[0].memoria[0].linkOriginal, "https://produto.mercadolivre.com.br/MLB-1001-historico-0");
}

async function testeSemRadarMirrorPreservado() {
  resetarEstado();
  const resultado = await aplicarSombraInteligenciaUniversalV2(
    ofertaBase(),
    ofertaBase(),
    { id: 2, oferta_id: 1002, cliente_id: "workspace_a" },
    {}
  );
  assert.strictEqual(estado.consultasMemoria.length, 1);
  assert.strictEqual(estado.avaliacoes.length, 1);
  assert.strictEqual(resultado.metadata.inteligenciaUniversalV2.prioridade, 70);
}

async function testeParidadeComercialAntesDepois() {
  resetarEstado();
  const job = { id: 3, oferta_id: 1003, cliente_id: "workspace_a" };
  const baseline = await executarDuasAvaliacoes({ job, contextoExecucao: null });
  assert.strictEqual(estado.consultasMemoria.length, 2);

  resetarEstado();
  const otimizado = await executarDuasAvaliacoes({ job, contextoExecucao: {} });
  assert.strictEqual(estado.consultasMemoria.length, 1);
  const semTimestampOperacional = resultado => {
    const copia = structuredClone(resultado);
    delete copia?.segunda?.oferta?.metadata?.precedenciaComercial?.aplicadoEm;
    return copia;
  };
  assert.deepStrictEqual(semTimestampOperacional(otimizado), semTimestampOperacional(baseline));
}

async function testeRetryConsultaSnapshotNovo() {
  resetarEstado();
  const job = { id: 4, oferta_id: 1004, cliente_id: "workspace_a" };
  await executarDuasAvaliacoes({ job, contextoExecucao: {} });
  await executarDuasAvaliacoes({ job, contextoExecucao: {} });
  assert.strictEqual(estado.consultasMemoria.length, 2);
  assert.notStrictEqual(estado.avaliacoes[0].memoria, estado.avaliacoes[2].memoria);
}

async function testeIsolamentoMultiworkspace() {
  resetarEstado();
  await Promise.all([
    executarDuasAvaliacoes({
      job: { id: 5, oferta_id: 1005, cliente_id: "workspace_a" },
      contextoExecucao: {}
    }),
    executarDuasAvaliacoes({
      job: { id: 6, oferta_id: 1006, cliente_id: "workspace_b" },
      contextoExecucao: {}
    })
  ]);

  assert.strictEqual(estado.consultasMemoria.length, 2);
  const referencias = new Map();
  for (const avaliacao of estado.avaliacoes) {
    if (!referencias.has(avaliacao.clienteId)) referencias.set(avaliacao.clienteId, avaliacao.memoria);
    assert.strictEqual(avaliacao.memoria, referencias.get(avaliacao.clienteId));
    assert.strictEqual(avaliacao.memoria[0].clienteId, avaliacao.clienteId);
  }
  assert.notStrictEqual(referencias.get("workspace_a"), referencias.get("workspace_b"));
}

async function testeDoisJobsSimultaneosSemContaminacao() {
  resetarEstado();
  const avaliarJob = async (id, ofertaId) => {
    const contextoExecucao = {};
    await aplicarSombraInteligenciaUniversalV2(ofertaBase(), ofertaBase(), {
      id,
      oferta_id: ofertaId,
      cliente_id: "workspace_a"
    }, contextoExecucao);
    await aplicarSombraInteligenciaUniversalV2(ofertaBase({ preco: 90 }), ofertaBase(), {
      id,
      oferta_id: ofertaId,
      cliente_id: "workspace_a"
    }, contextoExecucao);
  };

  await Promise.all([avaliarJob(7, 1007), avaliarJob(8, 1008)]);
  assert.strictEqual(estado.consultasMemoria.length, 2);
  const referenciasPorOferta = new Map();
  for (const avaliacao of estado.avaliacoes) {
    const ofertaId = avaliacao.memoria[0].linkOriginal.match(/MLB-(\d+)/)?.[1];
    assert(ofertaId === "1007" || ofertaId === "1008");
    if (!referenciasPorOferta.has(ofertaId)) {
      referenciasPorOferta.set(ofertaId, avaliacao.memoria);
    }
    assert.strictEqual(avaliacao.memoria, referenciasPorOferta.get(ofertaId));
  }
  assert.strictEqual(referenciasPorOferta.size, 2);
  assert.notStrictEqual(referenciasPorOferta.get("1007"), referenciasPorOferta.get("1008"));
}

async function testeErroConsultaFailSafePreservado() {
  resetarEstado();
  estado.falharMemoria = true;
  const contextoExecucao = {};
  const job = { id: 9, oferta_id: 1009, cliente_id: "workspace_a" };
  const primeira = await aplicarSombraInteligenciaUniversalV2(ofertaBase(), ofertaBase(), job, contextoExecucao);
  const segunda = await aplicarSombraInteligenciaUniversalV2(ofertaBase({ preco: 80 }), ofertaBase(), job, contextoExecucao);

  assert.strictEqual(estado.consultasMemoria.length, 1);
  assert.strictEqual(estado.avaliacoes.length, 2);
  assert(estado.avaliacoes.every(item => item.memoriaDisponivel === false));
  assert(estado.avaliacoes.every(item => item.memoriaMotivoIndisponivel === "erro_consulta_memoria"));
  assert.strictEqual(primeira.ok, false);
  assert.strictEqual(segunda.ok, false);
  assert.strictEqual(primeira.metadata.inteligenciaUniversalV2.status, "retida");
  assert.strictEqual(segunda.metadata.inteligenciaUniversalV2.status, "retida");
}

async function benchmarkInstrumentado() {
  resetarEstado();
  estado.totalRows = 300;
  estado.atrasoConsultaMs = 5;
  const job = { id: 10, oferta_id: 1010, cliente_id: "workspace_benchmark" };

  const inicioBaseline = process.hrtime.bigint();
  await executarDuasAvaliacoes({ job, contextoExecucao: null });
  const baselineMs = Number(process.hrtime.bigint() - inicioBaseline) / 1e6;
  const baselineQueries = estado.consultasMemoria.length;
  const baselineRows = baselineQueries * estado.totalRows;
  const baselineBytes = Buffer.byteLength(JSON.stringify(estado.avaliacoes[0].memoria)) * baselineQueries;

  resetarEstado();
  estado.totalRows = 300;
  estado.atrasoConsultaMs = 5;
  const inicioOtimizado = process.hrtime.bigint();
  await executarDuasAvaliacoes({ job, contextoExecucao: {} });
  const otimizadoMs = Number(process.hrtime.bigint() - inicioOtimizado) / 1e6;
  const otimizadoQueries = estado.consultasMemoria.length;
  const otimizadoRows = otimizadoQueries * estado.totalRows;
  const otimizadoBytes = Buffer.byteLength(JSON.stringify(estado.avaliacoes[0].memoria)) * otimizadoQueries;

  assert.strictEqual(baselineQueries, 2);
  assert.strictEqual(otimizadoQueries, 1);
  assert.strictEqual(otimizadoRows, baselineRows / 2);
  assert.strictEqual(otimizadoBytes, baselineBytes / 2);

  return {
    baseline: { queries: baselineQueries, rows: baselineRows, bytes: baselineBytes, tempoMs: Number(baselineMs.toFixed(2)) },
    otimizado: { queries: otimizadoQueries, rows: otimizadoRows, bytes: otimizadoBytes, tempoMs: Number(otimizadoMs.toFixed(2)) }
  };
}

(async () => {
  const originalLog = console.log;
  console.log = () => {};
  let benchmark;
  try {
    await testeRadarMirrorUmaConsultaDuasAvaliacoes();
    await testeSemRadarMirrorPreservado();
    await testeParidadeComercialAntesDepois();
    await testeRetryConsultaSnapshotNovo();
    await testeIsolamentoMultiworkspace();
    await testeDoisJobsSimultaneosSemContaminacao();
    await testeErroConsultaFailSafePreservado();
    benchmark = await benchmarkInstrumentado();
  } finally {
    console.log = originalLog;
  }

  console.log("engine-importer-job-history-snapshot: PASS", JSON.stringify(benchmark));
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
