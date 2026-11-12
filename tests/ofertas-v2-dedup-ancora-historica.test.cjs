"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { Pool } = require("pg");
const { criarCoordenadorEnvioProdutoDestino, chaveClaimProdutoDestino, reservaPostgres } = require("../modules/manual-v2/ofertas-v2-envio-claim");
const { criarCatracaAdvisoryFuncionalFila } = require("../modules/fila/fila-advisory-functional.service");
const locks = require("../modules/fila/fila-claims.repository");
const { avaliarMemoriaUniversal } = require("../modules/inteligencia-universal/memoria.service");

const catalog = "MLB12345001";
const a = "MLB9876500001";
const b = "MLB9876500002";
const workspace = "fixture-a";
const destination = "fixture-d";
const mercado = "mercadolivre";

function oferta(id, listing = a, { old = false, variant = "", ws = workspace } = {}) {
  const link = "https://www.mercadolivre.com.br/fixture/p/" + catalog + "?pdp_filters=item_id%3A" + listing;
  const titulo = "Carretilha Fixture Pesca";
  const metadata = { jobId: id, eventoId: id + 100, ofertaUniversalValidacao: { ok: true },
    ofertaUniversal: { workspaceId: ws, marketplace: mercado,
      produto: { idExterno: old ? catalog : listing, urlCanonica: link, urlOriginal: link } } };
  if (!old) {
    metadata.provaTituloTecnicoValidada = { versao: 1, validacao: "confirmada_pelo_importador",
      marketplace: mercado, workspaceId: ws, jobId: id, eventoId: id + 100,
      ocorrenciaLink: { id: id + 200, urlOriginal: link },
      titulo: { valor: titulo }, produto: { produtoIdCanonico: listing, urlCanonica: link } };
    metadata.identidadeCanonicaMl = { status: "consistente", mlbForteConfirmado: true, catalogId: catalog,
      mlbProduto: listing, mlbRevalidado: listing, urlOriginal: link, urlCanonicaRevalidada: link, variationId: variant };
  }
  return { id, clienteId: ws, marketplace: mercado, titulo, linkOriginal: link, linkExpandido: link,
    linkAfiliado: "https://meli.la/fixture-" + ws, precoAtual: 90, precoOriginal: 120,
    cupom: "FIX10", instrucaoCupom: "Use FIX10 no carrinho", criadaEm: new Date(Date.now() - 60_000).toISOString(), metadata };
}

const args = (oferta, destinoId = destination) => ({ oferta, clienteId: oferta.clienteId, destinoId });
const reservaKey = o => chaveClaimProdutoDestino(args(o)).replace("ofertas-v2-par:", "ofertas-v2-duravel:");

test("memória usa o mesmo seletor persistido e preserva benefício e janela", () => {
  const old = oferta(1, a, { old: true });
  const atual = oferta(2);
  const avaliar = (other, input = atual) => avaliarMemoriaUniversal(input, { memoriaAnteriores: [other] });
  assert.equal(avaliar(old).bloquear, true);
  assert.equal(avaliar(oferta(3, b, { old: true })).bloquear, false);
  assert.equal(avaliar(oferta(4, a, { variant: "2" }), oferta(5, a, { variant: "1" })).bloquear, false);
  assert.equal(avaliar(old, { ...atual, precoAtual: 80 }).bloquear, false);
  assert.equal(avaliar({ ...old, criadaEm: new Date(Date.now() - 121 * 60_000).toISOString() }).bloquear, false);
  assert.equal(avaliar(oferta(6, a, { old: true, ws: "fixture-b" })).bloquear, false);
});

test("PG17: reserva histórica, variantes, TTL, locks e isolamento reais", { skip: !process.env.OPTIMUS_TEST_PG17 }, async () => {
  const cfg = { host: "127.0.0.1", port: 55433, user: "postgres", database: "optimus_universal_fixture" };
  const schema = "dedup_anchor_" + randomUUID().replaceAll("-", "");
  const admin = new Pool(cfg);
  let pool;
  try {
    const server = (await admin.query("SELECT version(), current_setting('data_directory') AS dir")).rows[0];
    assert.match(server.version, /^PostgreSQL 17\./);
    const dir = server.dir.replaceAll("\\", "/");
    if (process.env.CI === "true") assert.equal(dir, "/var/lib/postgresql/data");
    else assert.match(dir, /\/baseline\/\.local-postgres\/data$/);
    await admin.query("CREATE SCHEMA " + schema);
    pool = new Pool({ ...cfg, options: "-c search_path=" + schema, max: 5 });
    await pool.query(locks.SQL_SCHEMA_FILA_CLAIMS);
    await pool.query("CREATE TABLE engine_universal_queue_items(id bigint PRIMARY KEY, workspace_id text, operation_epoch_started_at timestamptz, item_payload jsonb); " +
      "CREATE TABLE engine_universal_fanout_owners(owner_id text PRIMARY KEY, queue_item_id bigint, workspace_id text, operation_epoch_started_at timestamptz, destination_id text, commercial_reservation_key text, reservation_token uuid, updated_at timestamptz)");
    await pool.query("CREATE TABLE engine_universal_queue_destinations(id bigint PRIMARY KEY, fanout_owner_id text, queue_item_id bigint, operation_epoch_started_at timestamptz, workspace_id text, destination_id text, lease_token text, status text, lease_until timestamptz, target_key text, channel text); " +
      "CREATE TABLE engine_operation_state(id int PRIMARY KEY, mode text, operation_epoch_started_at timestamptz); " +
      "CREATE TABLE engine_universal_one_shot_smoke(id uuid, smoke_epoch_at timestamptz, queue_item_id bigint, queue_destination_id bigint, workspace_id text, destination_id text, target_key text, channel text, state text, provider_call_count int, expires_at timestamptz); " +
      "INSERT INTO engine_operation_state VALUES(1,'UNIVERSAL','2026-01-01')");
    const index = readFileSync(require.resolve("../modules/engine/universal-queue.additive.sql"), "utf8")
      .match(/CREATE INDEX IF NOT EXISTS engine_uq_owners_reserva_idx[\s\S]*?;/)?.[0];
    assert.ok(index);
    await pool.query(index);
    const indexEscopo = readFileSync(require.resolve("../modules/engine/universal-queue.additive.sql"), "utf8")
      .match(/CREATE INDEX IF NOT EXISTS engine_uq_claims_catalogo_idx[\s\S]*?;/)?.[0];
    assert.ok(indexEscopo);
    await pool.query(indexEscopo);
    const advisory = criarCatracaAdvisoryFuncionalFila({ logger: { log() {} }, repository: {
      adquirirAdvisoryLockFila: (entrada, opcoes) => locks.adquirirAdvisoryLockFila(entrada, { ...opcoes, pool }),
      liberarAdvisoryLockFila: locks.liberarAdvisoryLockFila
    } });
    const reserva = reservaPostgres();
    const consultar = reserva.consultarVinculoHistorico;
    let explicou = false;
    reserva.consultarVinculoHistorico = (client, filtro) => consultar({
      async query(sql, params) {
        if (!explicou) {
          const plano = await client.query("EXPLAIN " + sql, params);
          assert.match(plano.rows.map(row => row["QUERY PLAN"]).join("\n"), /engine_uq_owners_reserva_idx/);
          explicou = true;
        }
        return client.query(sql, params);
      }
    }, filtro);
    const consultarEscopo = reserva.consultarAncoradasAtivas;
    let explicouEscopo = false;
    reserva.consultarAncoradasAtivas = (client, filtro) => consultarEscopo({
      async query(sql, params) {
        if (!explicouEscopo) {
          const plano = await client.query("EXPLAIN " + sql, params);
          assert.match(plano.rows.map(row => row["QUERY PLAN"]).join("\n"), /engine_uq_claims_catalogo_idx/);
          explicouEscopo = true;
        }
        return client.query(sql, params);
      }
    }, filtro);
    const coordenador = criarCoordenadorEnvioProdutoDestino({ advisory, reserva });
    const old = oferta(1, a, { old: true });
    const nova = oferta(2);
    const v1 = oferta(3, a, { variant: "1" });
    const v2 = oferta(4, a, { variant: "2" });
    const snapshot = structuredClone(nova);
    const historica = reservaKey(old);
    const token = randomUUID();
    await pool.query("INSERT INTO fila_claims_ativos(cliente_id,fila_item_id,claim_token,lease_expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '1 hour')", [workspace, historica, token]);
    await pool.query("INSERT INTO engine_universal_queue_items VALUES(1,$1,'2026-01-01',$2)", [workspace, old]);
    await pool.query("INSERT INTO engine_universal_fanout_owners VALUES('fixture-owner',1,$1,'2026-01-01',$2,$3,$4,NULL)", [workspace, destination, historica, token]);
    await pool.query("INSERT INTO engine_universal_fanout_owners SELECT id::text,1,'outro-workspace','2026-01-01','outro-destino',id::text,NULL,NULL FROM generate_series(2,5000) AS id");
    await pool.query("ANALYZE engine_universal_fanout_owners");
    await pool.query("INSERT INTO fila_claims_ativos(cliente_id,fila_item_id,claim_token,lease_expires_at) SELECT 'outro-workspace','ofertas-v2-duravel:'||md5(i::text)||md5(i::text),gen_random_uuid(),NOW()+INTERVAL '1 hour' FROM generate_series(1,5000) i");
    await pool.query("ANALYZE fila_claims_ativos");
    const checar = async (o, esperado, destino) => {
      const resultado = await coordenador.adquirir(args(o, destino));
      try { assert.equal(resultado.resultado, esperado); }
      finally { if (resultado.resultado === "adquirido") await coordenador.finalizar(resultado); }
    };
    await checar(nova, "ocupado_recente");
    await checar({ ...nova, precoAtual: 80 }, "ocupado_recente");
    await checar(oferta(5, b), "adquirido");
    await checar(oferta(6, a, { ws: "fixture-b" }), "adquirido");
    await checar(nova, "adquirido", "fixture-other-destination");
    await checar(v1, "ocupado_recente");
    await pool.query("UPDATE engine_universal_queue_items SET item_payload=$1 WHERE id=1", [v1]);
    await checar(v1, "ocupado_recente");
    await checar(v2, "adquirido");
    assert.notEqual(reservaKey(v1), reservaKey(v2));
    await pool.query("UPDATE engine_universal_queue_items SET item_payload=$1 WHERE id=1", [{ ...old, metadata: {} }]);
    await checar(oferta(7, b), "ocupado_recente");
    await pool.query("UPDATE fila_claims_ativos SET claimed_at=NOW()-INTERVAL '2 hours', lease_expires_at=NOW()-INTERVAL '1 second' WHERE fila_item_id=$1", [historica]);
    const estados = await Promise.all([coordenador.adquirir(args(nova)), coordenador.adquirir(args(nova))]);
    try {
      assert.equal(estados.filter(r => r.resultado === "adquirido").length, 1);
      assert.equal(await coordenador.prepararTransporte(estados.find(r => r.resultado === "adquirido")), true);
    } finally {
      await Promise.all(estados.filter(r => r.resultado === "adquirido").map(r => coordenador.finalizar(r)));
    }
    await checar(nova, "ocupado_recente");
    await checar(old, "ocupado_recente");
    await checar(oferta(8, b, { old: true }), "ocupado_recente"); // sem owner recuperável

    async function reservarComOwner(oferta, destino) {
      const id = oferta.id;
      const owner = "fixture-owner-" + id;
      await pool.query("INSERT INTO engine_universal_queue_items VALUES($1,$2,'2026-01-01',$3)", [id, workspace, oferta]);
      await pool.query("INSERT INTO engine_universal_fanout_owners VALUES($1,$2,$3,'2026-01-01',$4,NULL,NULL,NULL)", [owner, id, workspace, destino]);
      await pool.query("INSERT INTO engine_universal_queue_destinations VALUES($1,$2,$1,'2026-01-01',$3,$4,'fixture-lease','claimed',NOW()+INTERVAL '10 minutes','fixture-target','whatsapp')", [id, owner, workspace, destino]);
      const entrada = { ...args(oferta, destino), fanoutOwnerId: owner, targetId: id, targetLeaseToken: "fixture-lease" };
      const estado = await coordenador.adquirir(entrada);
      try {
        assert.equal(estado.resultado, "adquirido");
        assert.equal(await coordenador.prepararTransporte(estado), true);
        const irmao = await coordenador.adquirir(entrada);
        assert.equal(irmao.ownerContinuation, true);
        assert.equal(irmao.reservaToken, estado.reservaToken);
      } finally { await coordenador.finalizar(estado); }
    }
    await reservarComOwner(oferta(20), "fixture-owner-destino");
    await checar(old, "ocupado_recente", "fixture-owner-destino");
    await checar(oferta(21, b, { old: true }), "adquirido", "fixture-owner-destino");
    const opaca = oferta(22, a, { old: true });
    opaca.linkOriginal = opaca.linkOriginal.split("?")[0];
    opaca.metadata.ofertaUniversal.produto.urlOriginal = opaca.linkOriginal;
    opaca.metadata.ofertaUniversal.produto.urlCanonica = opaca.linkOriginal;
    await checar(opaca, "ocupado_recente", "fixture-owner-destino");
    await reservarComOwner(oferta(30, a, { variant: "1" }), "fixture-variants");
    await checar(v1, "ocupado_recente", "fixture-variants");
    await checar(v2, "adquirido", "fixture-variants");
    await checar(old, "ocupado_recente", "fixture-variants");
    for (const [i, ordem] of [[0, [old, nova]], [1, [nova, old]]]) {
      const destino = "fixture-race-" + i;
      const disputas = await Promise.all(ordem.map(item => coordenador.adquirir(args(item, destino))));
      try {
        const ganhadores = disputas.filter(item => item.resultado === "adquirido");
        assert.equal(ganhadores.length, 1);
        assert.equal(await coordenador.prepararTransporte(ganhadores[0]), true);
        await checar(ordem[1 - disputas.indexOf(ganhadores[0])], "ocupado_recente", destino);
      } finally { await Promise.all(disputas.map(estado => coordenador.finalizar(estado))); }
    }
    for (const [i, primeiro, segundo] of [[0, old, nova], [1, nova, old]]) {
      const destino = "fixture-lock-order-" + i;
      const primeiroEstado = await coordenador.adquirir(args(primeiro, destino));
      try {
        assert.equal(primeiroEstado.resultado, "adquirido");
        await checar(segundo, "ocupado", destino);
        assert.equal(await coordenador.prepararTransporte(primeiroEstado), true);
        await checar(segundo, "ocupado_recente", destino);
      } finally { await coordenador.finalizar(primeiroEstado); }
    }
    assert.match(reservaKey(nova), /^ofertas-v2-duravel:[a-f0-9]{64}$/);
    assert.equal(explicou, true);
    assert.equal(explicouEscopo, true);
    assert.deepEqual(nova, snapshot);
  } finally {
    if (pool) {
      await pool.end();
      await admin.query("DROP SCHEMA " + schema + " CASCADE");
    }
    await admin.end();
  }
});
