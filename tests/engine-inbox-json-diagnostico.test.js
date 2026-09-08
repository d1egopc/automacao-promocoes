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

    const highIsolado = String.fromCharCode(0xD800);
    const lowIsolado = String.fromCharCode(0xDC00);
    const emojiValido = "🚀";
    const entradaComSurrogates = {
      ascii: "Oferta ASCII",
      acentos: "Ação promoção São Paulo",
      emojiValido,
      emojis: `🔥 ${emojiValido} ✅`,
      highIsolado: `antes${highIsolado}depois`,
      lowIsolado: `antes${lowIsolado}depois`,
      nested: {
        valor: `n${highIsolado}x${lowIsolado}fim`,
        [`chave${lowIsolado}`]: "valor"
      },
      lista: ["normal", `a${highIsolado}b`, emojiValido]
    };
    const sanitizado = await inbox.registrarEventoBruto({
      origem: "clonador_grupos",
      origemTipo: "whatsapp",
      grupoId: "grupo-surrogate@g.us",
      textoOriginal: "Oferta com Unicode",
      linksExtraidos: ["https://meli.la/valido", `https://meli.la/${highIsolado}`],
      metadata: entradaComSurrogates
    }, { clientes: ["workspace_teste"] });
    assert.strictEqual(sanitizado.ok, true, "surrogates isolados devem ser sanitizados antes do INSERT JSONB");
    const insertSanitizado = chamadas.filter(item => /INSERT INTO engine_eventos_brutos/i.test(item.sql))[1];
    const linksSanitizados = JSON.parse(insertSanitizado.params[7]);
    const metadataSanitizada = JSON.parse(insertSanitizado.params[10]);
    assert.deepStrictEqual(linksSanitizados, ["https://meli.la/valido", "https://meli.la/�"]);
    assert.strictEqual(metadataSanitizada.ascii, "Oferta ASCII");
    assert.strictEqual(metadataSanitizada.acentos, "Ação promoção São Paulo");
    assert.strictEqual(metadataSanitizada.emojiValido, emojiValido, "par válido deve permanecer idêntico");
    assert.strictEqual(metadataSanitizada.emojis, `🔥 ${emojiValido} ✅`, "múltiplos emojis válidos devem permanecer idênticos");
    assert.strictEqual(metadataSanitizada.highIsolado, "antes�depois");
    assert.strictEqual(metadataSanitizada.lowIsolado, "antes�depois");
    assert.strictEqual(metadataSanitizada.nested.valor, "n�x�fim", "texto restante deve ser preservado");
    assert.strictEqual(metadataSanitizada.nested["chave�"], "valor", "chaves JSON também devem ser seguras");
    assert.deepStrictEqual(metadataSanitizada.lista, ["normal", "a�b", emojiValido]);
    assert.strictEqual(JSON.parse(JSON.stringify(metadataSanitizada)).emojiValido, emojiValido, "resultado final deve continuar JSON válido");

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
    assert.strictEqual(chamadas.filter(item => /INSERT INTO engine_eventos_brutos/i.test(item.sql)).length, 3);

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
