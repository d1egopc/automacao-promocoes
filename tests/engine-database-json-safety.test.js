const assert = require("assert");

const {
  jsonbParam,
  sanitizarJsonbValor
} = require("../modules/engine/jobs.service");

function contemSurrogateIsolado(valor) {
  for (let indice = 0; indice < valor.length; indice += 1) {
    const codigo = valor.charCodeAt(indice);
    if (codigo >= 0xD800 && codigo <= 0xDBFF) {
      const proximo = valor.charCodeAt(indice + 1);
      if (!(proximo >= 0xDC00 && proximo <= 0xDFFF)) return true;
      indice += 1;
    } else if (codigo >= 0xDC00 && codigo <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function testarUnicodeValidoEPayloadDeJob() {
  const parSurrogateValido = String.fromCharCode(0xD83D, 0xDE00);
  const payload = {
    fase: "1.1",
    imagemEnviavel: true,
    metadataEvento: {
      textoOriginal: "Oferta 😀",
      emoji: "🚀",
      parSurrogateValido,
      highSurrogateIsolado: String.fromCharCode(0xD83D),
      lowSurrogateIsolado: String.fromCharCode(0xDE00),
      links: [{ papelLink: "link_pc", url: "https://a.aliexpress.com/_pc" }]
    }
  };

  const sanitizado = sanitizarJsonbValor(payload);
  assert.strictEqual(sanitizado.metadataEvento.textoOriginal, "Oferta 😀");
  assert.strictEqual(sanitizado.metadataEvento.emoji, "🚀");
  assert.strictEqual(sanitizado.metadataEvento.parSurrogateValido, parSurrogateValido);
  assert.strictEqual(sanitizado.metadataEvento.highSurrogateIsolado, "\uFFFD");
  assert.strictEqual(sanitizado.metadataEvento.lowSurrogateIsolado, "\uFFFD");
  assert.strictEqual(contemSurrogateIsolado(JSON.stringify(sanitizado)), false);

  const serializado = jsonbParam(payload, {});
  const reidratado = JSON.parse(serializado);
  assert.strictEqual(reidratado.metadataEvento.emoji, "🚀");
  assert.strictEqual(reidratado.metadataEvento.parSurrogateValido, parSurrogateValido);
  assert.strictEqual(reidratado.metadataEvento.highSurrogateIsolado, "\uFFFD");
  assert.strictEqual(reidratado.metadataEvento.lowSurrogateIsolado, "\uFFFD");
}

async function testarFalhaSqlPreservaErroOriginal() {
  process.env.DATABASE_URL = "postgres://teste.invalid/optimus";
  const pg = require("pg");
  class PoolFalso {
    constructor() {
      this.options = { max: 10 };
      this.totalCount = 0;
      this.idleCount = 0;
      this.waitingCount = 0;
    }

    on() {
      return this;
    }

    async connect() {
      const erro = new Error("invalid input syntax for type json");
      erro.code = "22P02";
      erro.detail = "Unicode low surrogate must follow a high surrogate.";
      throw erro;
    }
  }

  pg.Pool = PoolFalso;
  const { queryEngine } = require("../modules/engine/database");
  const resultado = await queryEngine("INSERT INTO engine_jobs_cliente (metadata) VALUES ($1::jsonb)", [jsonbParam({ texto: String.fromCharCode(0xDC00) }, {})]);

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "query_falhou");
  assert.strictEqual(resultado.erro, "invalid input syntax for type json");
  assert.strictEqual(resultado.erroCodigo, "22P02");
  assert.match(resultado.erroDetalhe, /low surrogate/i);
}

(async () => {
  testarUnicodeValidoEPayloadDeJob();
  await testarFalhaSqlPreservaErroOriginal();
  console.log("engine-database-json-safety.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
