"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { Client } = require("pg");
const { importarAwinEngine } = require("../modules/engine/importer/adapters/awin.adapter");
const { normalizarOfertaImportada } = require("../modules/engine/importer/importer.service");

const ORIGINAL = "https://seuhardware.com/s/c7M6DTd";
const OFICIAL = "https://www.kabum.com.br/produto/609953/processador-amd-ryzen-9-5900xt";
const IMAGEM = "https://images.kabum.com.br/produtos/fotos/609953/ryzen.jpg";
const AFILIADO = "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=222&ued=" +
  encodeURIComponent(OFICIAL);

function deps() {
  return {
    importarProdutoKabumViaAwin: async () => ({
      marketplace: "kabum",
      titulo: "Processador AMD Ryzen 9 5900XT",
      tituloFonteOficial: "kabum_html.title",
      produtoIdCanonico: "609953",
      linkOriginal: OFICIAL,
      linkExpandido: OFICIAL,
      linkAfiliado: AFILIADO,
      imagem: IMAGEM,
      preco: 1779,
      precoOriginal: 1999,
      cupom: "FARMOU",
      categoria: "Gamer e Hardware"
    }),
    gerarDeepLinkAwin: async () => AFILIADO,
    getIntegracaoCliente: (_workspace, marketplace) => marketplace === "awin"
      ? { credenciais: { publisherId: "222" } }
      : null
  };
}

test("PG17 preserva a prova seuhardware redirect_ok até o SKU oficial KaBuM", async () => {
  const dir = process.env.KABUM_PG_FIXTURE_DIR;
  assert.ok(dir, "KABUM_PG_FIXTURE_DIR must identify the disposable cluster");
  const config = { host: "127.0.0.1", port: 55433, user: "postgres",
    database: "optimus_kabum_ci_fixture", connectionTimeoutMillis: 5000 };
  const schema = "kabum_shortlink_" + randomUUID().replaceAll("-", "");
  const client = new Client(config);
  let created = false;
  try {
    await client.connect();
    const { rows: [db] } = await client.query(`SELECT current_database() db,
      current_setting('server_version_num')::int version, current_setting('data_directory') dir`);
    assert.equal(db.db, config.database);
    assert.equal(Math.floor(db.version / 10000), 17);
    assert.equal(db.dir.replaceAll("\\", "/"), dir.replaceAll("\\", "/"));
    await client.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await client.query(`SET search_path TO ${schema},public`);
    await client.query(fs.readFileSync(require.resolve("../modules/engine/schema.sql"), "utf8"));
    await client.query(`INSERT INTO engine_eventos_brutos
      (id,origem,fonte,marketplace_detectado,texto_original)
      VALUES (239129,'radar','clonador','kabum','Processador AMD Ryzen 9 5900XT')`);
    await client.query(`INSERT INTO engine_links
      (id,evento_id,url_original,url_normalizada,url_expandida,dominio_original,dominio_final,
       redirect_ok,motivo_redirect,marketplace_detectado,metadata)
      VALUES (271653,239129,$1,$1,$2,'seuhardware.com','www.kabum.com.br',true,'resolvido','kabum',
       '{"papelLink":"produto","papelLinkMotivo":"kabum_id_produto_url","papelLinkConfianca":"alta"}')`,
    [ORIGINAL, OFICIAL]);
    const { rows: [link] } = await client.query(`SELECT * FROM engine_links WHERE id=271653`);
    const job = { id: 1167194, evento_id: 239129, cliente_id: "user_pss60lus", marketplace: "kabum" };
    const evento = { id: 239129, texto_original: "Processador AMD Ryzen 9 5900XT" };
    const bruto = await importarAwinEngine({ job, evento, links: [link], deps: deps() });
    assert.equal(bruto.ok, true, bruto.motivo);
    const oferta = normalizarOfertaImportada(bruto, job);
    assert.equal(oferta.titulo, "Processador AMD Ryzen 9 5900XT");
    assert.equal(oferta.metadata.provaTituloTecnicoRejeitada, false);
    assert.equal(oferta.metadata.provaTituloTecnicoValidada.ocorrenciaLink.id, "271653");
    assert.equal(oferta.metadata.provaTituloTecnicoValidada.ocorrenciaLink.urlOriginal, ORIGINAL);
    assert.equal(oferta.metadata.clienteId, "user_pss60lus");
    assert.equal(oferta.linkAfiliado, AFILIADO);
    assert.equal(oferta.imagem, IMAGEM);
    assert.equal(oferta.preco, 1779);
    assert.equal(oferta.precoOriginal, 1999);
    assert.equal(oferta.cupom, "FARMOU");
  } finally {
    try {
      if (created) await client.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await client.end();
    }
  }
});
