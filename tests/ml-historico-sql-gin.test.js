const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Execute the actual private helpers without bootstrapping the backend/DB.
// No test-only exports or production dependencies are added.
function carregarHelper(arquivo, nome, bindings) {
  const source = fs.readFileSync(path.join(__dirname, "..", arquivo), "utf8");
  const inicio = source.indexOf(`async function ${nome}(`);
  assert(inicio >= 0);
  const resto = source.slice(inicio);
  const fim = resto.search(/\n(?:async )?function /);
  assert(fim > 0);
  return new Function(...Object.keys(bindings), `${resto.slice(0, fim)}\nreturn ${nome};`)(...Object.values(bindings));
}

const importerArquivo = "modules/engine/importer/importer.service.js";
const canonicalArquivo = "modules/imagens/cache-canonico-evento.js";
const normalizar = valor => String(valor ?? "").trim();
const compactarSql = sql => sql.replace(/\s+/g, " ").trim();
const expressaoIndice = `UPPER(
  (CASE WHEN link_original IS NULL THEN '' ELSE link_original || ' ' END) ||
  (CASE WHEN link_expandido IS NULL THEN '' ELSE link_expandido || ' ' END) ||
  (CASE WHEN link_afiliado IS NULL THEN '' ELSE link_afiliado || ' ' END) ||
  COALESCE(metadata::text, '')
)`;
const expressaoLegada = "UPPER(CONCAT_WS(' ', link_original, link_expandido, link_afiliado, COALESCE(metadata::text, '')))";
const expressaoSemMetadata = "UPPER(CONCAT_WS(' ', link_original, link_expandido, link_afiliado, ''))";
function sqlEsperado(importer, expressao) {
  return compactarSql(`SELECT id, imagem FROM engine_ofertas
    WHERE ${importer ? "id <> $2 AND " : ""}NULLIF(TRIM(COALESCE(imagem, '')), '') IS NOT NULL
    AND LOWER(REGEXP_REPLACE(COALESCE(marketplace, ''), '[[:space:]_-]+', '', 'g')) IN ('ml', 'mercadolivre')
    AND ${expressao} LIKE '%' || $1 || '%'
    ORDER BY atualizada_em DESC NULLS LAST, id DESC LIMIT 1`);
}
const oferta = { marketplace: "mercadolivre", produtoIdDetectado: "mlb123456789" };
function criar({ metadata = true, query = async () => ({ ok: true, resultado: { rows: [] } }) } = {}) {
  const chamadas = [];
  const queryEngine = async (sql, params) => {
    chamadas.push({ sql: compactarSql(sql), params });
    return query(sql, params);
  };
  return {
    chamadas,
    importer: carregarHelper(importerArquivo, "buscarImagemAnteriorEngine", {
      queryEngine,
      engineOfertasTemMetadata: async () => metadata,
      normalizarMarketplaceMemoria: normalizar,
      detectarIdentidadeProdutoUniversal: item => ({ produtoIdDetectado: item.produtoIdDetectado }),
      normalizarTexto: normalizar
    }),
    canonical: carregarHelper(canonicalArquivo, "buscarHistoricoMesmoMlb", { queryEngine, texto: normalizar })
  };
}
let testes = 0;
async function testar(nome, fn) {
  await fn();
  testes += 1;
  console.log(`PASS ${nome}`);
}

(async () => {
  await testar("SQL completo importer com metadata; somente a expressão mudou", async () => {
    const h = criar();
    await h.importer(oferta, { oferta_id: 71 });
    assert.equal(h.chamadas[0].sql, sqlEsperado(true, expressaoIndice));
    assert.equal(h.chamadas[0].sql.replace(compactarSql(expressaoIndice), expressaoLegada), sqlEsperado(true, expressaoLegada));
    assert.deepEqual(h.chamadas[0].params, ["MLB123456789", 71]);
  });
  await testar("SQL completo canonical; sem exclusão e sem mudar filtros/order/limit/retorno", async () => {
    const h = criar();
    await h.canonical(" mlb123456789 ");
    assert.equal(h.chamadas[0].sql, sqlEsperado(false, expressaoIndice));
    assert.equal(h.chamadas[0].sql.replace(compactarSql(expressaoIndice), expressaoLegada), sqlEsperado(false, expressaoLegada));
    assert.deepEqual(h.chamadas[0].params, ["MLB123456789"]);
  });
  await testar("ramo sem metadata produz exatamente o SQL legado", async () => {
    const h = criar({ metadata: false });
    await h.importer(oferta, {});
    assert.equal(h.chamadas[0].sql, sqlEsperado(true, expressaoSemMetadata));
    assert(!h.chamadas[0].sql.includes("metadata"));
    assert.deepEqual(h.chamadas[0].params, ["MLB123456789", 0]);
  });
  // A local model of CONCAT_WS null/separator semantics, not a PostgreSQL
  // benchmark. jsonb::text/UPPER equivalence was proved in P2C-B/P2C-C.
  await testar("NULL/vazio/separadores/ordem/caixa e metadata: 320 combinações", async () => {
    let combinacoes = 0;
    for (const a of [null, "", "mlb123", "A "])
      for (const b of [null, "", "mlb456", "B "])
        for (const c of [null, "", "mlb789", "C "])
          for (const metadata of [null, "", '{"id": "MLB123"}', '[]', '"mlb456"']) {
            const atual = [a, b, c, metadata ?? ""].filter(x => x !== null).join(" ").toUpperCase();
            const novo = ([a, b, c].map(x => x === null ? "" : `${x} `).join("") + (metadata ?? "")).toUpperCase();
            assert.equal(novo, atual);
            combinacoes += 1;
          }
    assert.equal(combinacoes, 320);
  });
  for (const [nome, resposta, esperado] of [
    ["imagem encontrada", { ok: true, resultado: { rows: [{ id: 72, imagem: " https://cdn.test/oficial.jpg " }] } },
      { imagem: "https://cdn.test/oficial.jpg", origem: "engine_ofertas.imagem:72", motivo: "imagem_historica_mesmo_mlb" }],
    ["sem linha", { ok: true, resultado: { rows: [] } }, { imagem: "", origem: "", motivo: "historico_mesmo_mlb_sem_imagem" }],
    ["imagem NULL", { ok: true, resultado: { rows: [{ id: 72, imagem: null }] } }, { imagem: "", origem: "", motivo: "historico_mesmo_mlb_sem_imagem" }],
    ["erro da consulta", { ok: false }, { imagem: "", origem: "", motivo: "consulta_historico_falhou" }]
  ]) {
    await testar(`retorno importer/canonical preservado: ${nome}`, async () => {
      const h = criar({ query: async () => resposta });
      assert.deepEqual(await h.importer(oferta, { oferta_id: 71 }), esperado);
      assert.deepEqual(await h.canonical("MLB123456789"), esperado);
      assert.equal(h.chamadas.length, 2);
    });
  }
  await testar("queries independentes enxergam persistência posterior / oferta atual", async () => {
    let persistida = false;
    const h = criar({ query: async (_sql, params) => ({ ok: true, resultado: {
      rows: persistida && params.length === 1 ? [{ id: 71, imagem: "https://cdn.test/nova.jpg" }] : []
    } }) });
    assert.equal((await h.importer(oferta, { oferta_id: 71 })).imagem, "");
    persistida = true;
    assert.equal((await h.canonical("MLB123456789")).imagem, "https://cdn.test/nova.jpg");
    assert.equal(h.chamadas.length, 2);
  });
  await testar("jobs concorrentes mantêm identidade e exclusão próprias", async () => {
    const h = criar({ query: async (_sql, params) => {
      await new Promise(resolve => setImmediate(resolve));
      return { ok: true, resultado: { rows: [{ id: params[1] + 100, imagem: `https://cdn.test/${params[0]}.jpg` }] } };
    } });
    const resultados = await Promise.all([h.importer(oferta, { oferta_id: 71 }),
      h.importer({ ...oferta, produtoIdDetectado: "MLB987654321" }, { oferta_id: 81 })]);
    assert.deepEqual(h.chamadas.map(x => x.params), [["MLB123456789", 71], ["MLB987654321", 81]]);
    assert.equal(resultados[0].origem, "engine_ofertas.imagem:171");
    assert.equal(resultados[1].imagem, "https://cdn.test/MLB987654321.jpg");
  });
  await testar("early returns e dependency override não passam a consultar SQL", async () => {
    const h = criar();
    await h.importer({ ...oferta, imagem: "https://cdn.test/ja.jpg" });
    await h.importer({ ...oferta, marketplace: "amazon" });
    await h.importer({ ...oferta, produtoIdDetectado: "invalido" });
    await h.canonical("invalido");
    assert.deepEqual(await h.canonical("MLB123456789", { buscarImagemHistorica: async () => ({ imagem: "injetada" }) }), { imagem: "injetada" });
    assert.equal(h.chamadas.length, 0);
  });
  console.log(`ML historical GIN SQL: ${testes}/${testes} PASS (sem banco/rede)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
