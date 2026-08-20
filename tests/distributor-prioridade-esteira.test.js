const assert = require("assert");

const databasePath = require.resolve("../modules/engine/database");
const servicePath = require.resolve("../modules/engine/distributor/distributor.service");

delete require.cache[servicePath];

const database = require(databasePath);
const consultas = [];

database.getEnginePool = () => ({
  query: async (sql, params = []) => {
    consultas.push({ sql, params });
    if (/information_schema\.columns/i.test(sql)) {
      return { rows: [{ existe: true }], rowCount: 1 };
    }
    return {
      rows: [
        { id: 1, titulo: "Cupom Turbo", prioridade: 100, score: 80, status: "importada" },
        { id: 2, titulo: "Cupom forte", prioridade: 90, score: 75, status: "importada" },
        { id: 3, titulo: "Oferta comum", prioridade: 50, score: 50, status: "importada" },
        { id: 4, titulo: "Prioridade reduzida deliberadamente", prioridade: 10, score: 95, status: "importada" },
        { id: 5, titulo: "Score zero valido", prioridade: 0, score: 0, status: "importada" },
        { id: 6, titulo: "Score dezenove valido", prioridade: 19, score: 19, status: "importada" },
        { id: 7, titulo: "Score baixo valido", prioridade: 1, score: 1, status: "importada" }
      ],
      rowCount: 7
    };
  }
});
database.engineDbHabilitado = () => true;

const { buscarOfertasDistribuiveis } = require("../modules/engine/distributor/distributor.service");

(async () => {
  const resultado = await buscarOfertasDistribuiveis({ limite: 10 });
  assert.strictEqual(resultado.ok, true, "consulta deve retornar ofertas distribuiveis");

  const consultaOfertas = consultas.find(item => /FROM engine_ofertas o/i.test(item.sql));
  assert(consultaOfertas, "deve consultar engine_ofertas");
  assert(/o\.prioridade/i.test(consultaOfertas.sql), "prioridade deve ser selecionada");
  assert(/ROW_NUMBER\(\) OVER/i.test(consultaOfertas.sql), "query deve aplicar fairness por janela");
  assert(/PARTITION BY LOWER\(COALESCE\(o\.marketplace, ''\)\), j\.cliente_id/i.test(consultaOfertas.sql), "workspace nao pode monopolizar o topo do Distributor");
  assert(/PARTITION BY LOWER\(COALESCE\(o\.marketplace, ''\)\)/i.test(consultaOfertas.sql), "marketplace nao pode monopolizar a selecao global");
  assert(/ORDER BY ordem_workspace_marketplace ASC/i.test(consultaOfertas.sql), "fairness por workspace deve preceder prioridade global bruta");
  assert(/COALESCE\(e\.capturado_em,\s*o\.criada_em,\s*o\.atualizada_em,\s*NOW\(\)\)\s+DESC/i.test(consultaOfertas.sql), "agua nova deve preceder FIFO antigo na selecao");
  assert(/COALESCE\(o\.prioridade,\s*o\.score,\s*0\)\s+DESC/i.test(consultaOfertas.sql), "prioridade deve ranquear ofertas dentro da faixa fresca e score permanece fallback");
  assert(!/GREATEST/i.test(consultaOfertas.sql), "score alto nao pode anular prioridade deliberadamente reduzida");
  assert(!/o\.atualizada_em\s+ASC\s+NULLS\s+FIRST/i.test(consultaOfertas.sql), "FIFO antigo nao deve superar agua nova");
  assert(/o\.id\s+ASC/i.test(consultaOfertas.sql), "id deve permanecer como desempate deterministico");
  assert(/o\.status IN \('importada', 'oferta_criada'\)/i.test(consultaOfertas.sql), "somente ofertas validas importadas entram na esteira");
  assert(!/score\s*[<>]=?\s*\d+/i.test(consultaOfertas.sql), "score nao pode filtrar ou bloquear oferta valida");
  assert.strictEqual(resultado.ofertas.length, 7, "ofertas validas de baixa prioridade continuam circulaveis");

  console.log("distributor-prioridade-esteira.test.js OK");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
