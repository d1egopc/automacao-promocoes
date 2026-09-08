"use strict";

const assert = require("assert");

function limparModulo(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mockModulo(relativo, exports) {
  const resolvido = limparModulo(relativo);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

function restaurarModulo(relativo) {
  limparModulo(relativo);
}

async function main() {
  const erros = [];
  const chamadas = [];
  const segredo = "NAO-REGISTRAR-CUPOM-OU-LINK";
  let falharInsert = false;

  try {
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql, params = []) => {
        chamadas.push({ sql, params });
        if (/SELECT id\s+FROM engine_eventos_brutos/i.test(sql)) {
          return { ok: true, resultado: { rows: [] }, metricas: {} };
        }
        if (/INSERT INTO engine_eventos_brutos/i.test(sql)) {
          if (!falharInsert) {
            return { ok: true, resultado: { rows: [{ id: 901 }] }, metricas: {} };
          }
          return {
            ok: false,
            motivo: "query_falhou",
            erro: "invalid input syntax for type json",
            erroCodigo: "22P02",
            erroPosicao: "231",
            erroDetalhe: 'Token "[redigido]" is invalid.',
            erroConstraint: null,
            metricas: {}
          };
        }
        return { ok: true, resultado: { rows: [] }, metricas: {} };
      }
    });
    mockModulo("../modules/engine/jobs.service", { criarJobsParaClientes: async () => ({ criados: 0, existentes: 0 }) });
    mockModulo("../modules/engine/logger", {
      logEngineEventoBrutoSalvo() {},
      logEngineEventoBrutoDuplicado() {},
      logEngineEventoBrutoErro: dados => erros.push(dados)
    });
    mockModulo("../modules/radar/cobertura-v1", { registrar() {}, flagAtiva: () => false });

    const inbox = require("../modules/engine/inbox.service");
    const normal = await inbox.registrarEventoBruto({
      origem: "radar",
      origemTipo: "whatsapp",
      grupoId: "grupo-normal@g.us",
      textoOriginal: "Oferta normal",
      linksExtraidos: ["https://meli.la/normal"],
      metadata: { origem: "teste" }
    }, { clientes: ["workspace_teste"] });
    assert.strictEqual(normal.ok, true, "insert normal permanece operacional");
    const insertNormal = chamadas.find(item => /INSERT INTO engine_eventos_brutos/i.test(item.sql));
    assert.strictEqual(insertNormal.params[7], '["https://meli.la/normal"]');
    assert.strictEqual(insertNormal.params[10], '{"origem":"teste"}');

    falharInsert = true;
    const retorno = await inbox.registrarEventoBruto({
      origem: "clonador_grupos",
      origemTipo: "whatsapp",
      grupoId: "grupo@g.us",
      textoOriginal: `Oferta ${segredo}`,
      linksExtraidos: [`https://exemplo.test/${segredo}`],
      metadata: { cupom: segredo, token: segredo, nested: { segredo } }
    }, { clientes: ["workspace_teste"] });

    assert.strictEqual(retorno.ok, false);
    assert.strictEqual(retorno.motivo, "query_falhou");
    assert.strictEqual(retorno.erro, "invalid input syntax for type json");
    assert.strictEqual(chamadas.filter(item => /INSERT INTO engine_eventos_brutos/i.test(item.sql)).length, 2);

    const diagnostico = retorno.diagnostico;
    assert.deepStrictEqual(diagnostico.postgres, {
      code: "22P02",
      position: "231",
      detail: 'Token "[redigido]" is invalid.',
      constraint: null
    });
    assert.strictEqual(diagnostico.operacao, "evento_insert");
    assert.strictEqual(diagnostico.parametros.links_extraidos.tipo, "object");
    assert.strictEqual(diagnostico.parametros.links_extraidos.array, true);
    assert.strictEqual(diagnostico.parametros.metadata.tipo, "object");
    assert.strictEqual(diagnostico.parametros.metadata.array, false);
    for (const item of Object.values(diagnostico.parametros)) {
      assert.strictEqual(item.jsonStringifyOk, true);
      assert.strictEqual(item.jsonParseSerializadoOk, true);
      assert.ok(item.tamanhoSerializado > 0);
      assert.match(item.hashSerializado, /^[a-f0-9]{64}$/);
    }

    const diagnosticoSerializado = JSON.stringify({ diagnostico, erros });
    assert.ok(!diagnosticoSerializado.includes(segredo), "diagnostico nao pode incluir conteudo bruto");
    assert.ok(!diagnosticoSerializado.includes("https://exemplo.test"), "diagnostico nao pode incluir link completo");
    assert.strictEqual(erros.length, 1);
  } finally {
    restaurarModulo("../modules/engine/inbox.service");
    restaurarModulo("../modules/engine/database");
    restaurarModulo("../modules/engine/jobs.service");
    restaurarModulo("../modules/engine/logger");
    restaurarModulo("../modules/radar/cobertura-v1");
  }

  console.log("engine-inbox-json-diagnostico.test.js OK");
}

main().catch(erro => {
  console.error(erro);
  process.exit(1);
});
