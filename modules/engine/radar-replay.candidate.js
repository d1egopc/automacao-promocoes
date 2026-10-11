"use strict";

// The caller must provide the already-resolved, operational workspace IDs; this module
// never chooses a tenant from message text or an arbitrary payload.
const { avaliarFrescorPreImporter } = require("./frescor-pre-importer.service");
const { verificarCapturaIngressReal } = require("./universal-ingress-fence");

function validarCaptura(entrada = {}) {
  const hash = String(entrada.hashEvento || "").trim();
  const capturadoEm = new Date(entrada.capturadoEm || "");
  const clientes = [...new Set((entrada.clientes || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (typeof entrada.validarWorkspace !== "function" ||
      clientes.some(id => entrada.validarWorkspace(id) !== true)) {
    throw new Error("radar_intent_workspace_unverified");
  }
  if (!hash || !Number.isFinite(capturadoEm.getTime()) || !clientes.length) {
    throw new Error("radar_intent_capture_incomplete");
  }
  return { hash, capturadoEm, clientes };
}

async function persistirCapturaComIntencoes(client, entrada = {}, hooks = {}) {
  const { hash, capturadoEm, clientes } = validarCaptura(entrada);
  let transacao = false;
  try {
    await client.query("BEGIN");
    transacao = true;
    // Preserve the existing five-minute content dedupe before hash insertion.
    // A capture-time bucket can change while an earlier event is still inside
    // that window; hash conflict alone is not equivalent to the old contract.
    const byContent = await client.query(`SELECT id,capturado_em
      FROM engine_eventos_brutos
      WHERE COALESCE(origem,'')='radar'
        AND COALESCE(grupo_id,'')=COALESCE($1,'')
        AND COALESCE(texto_original,'')=COALESCE($2,'')
        AND links_extraidos=$3::jsonb
        AND criado_em>=NOW()-interval '5 minutes'
      ORDER BY id DESC LIMIT 1`, [String(entrada.grupoId || ""),
      String(entrada.textoOriginal || ""),
      JSON.stringify(entrada.linksExtraidos || [])]);
    const inserido = byContent.rowCount ? { rowCount: 0, rows: [] }
      : await client.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo,sessao_id,grupo_id,grupo_nome,
       hash_evento,texto_original,links_extraidos,marketplace_detectado,
       metadata,capturado_em)
      VALUES ('radar','radar',$1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10)
      ON CONFLICT (hash_evento) WHERE hash_evento IS NOT NULL DO NOTHING
      RETURNING id`, [String(entrada.origemTipo || "whatsapp"),
      String(entrada.sessaoId || ""), String(entrada.grupoId || ""),
      String(entrada.grupoNome || ""), hash, String(entrada.textoOriginal || ""),
      JSON.stringify(entrada.linksExtraidos || []),
      String(entrada.marketplaceDetectado || ""),
      JSON.stringify(entrada.metadata || {}), capturadoEm]);
    const evento = byContent.rows[0] || inserido.rows[0] || (await client.query(`SELECT id,capturado_em
      FROM engine_eventos_brutos WHERE hash_evento=$1`, [hash])).rows[0];
    if (!evento) throw new Error("radar_intent_event_missing");
    if (hooks.afterEvent) await hooks.afterEvent(evento);
    const intents = await client.query(`INSERT INTO engine_radar_replay_intents_candidate
      (evento_id,cliente_id,capturado_em)
      SELECT $1,cliente_id,$2
        FROM unnest($3::text[]) AS cliente_id
      ON CONFLICT (evento_id,cliente_id) DO NOTHING
      RETURNING cliente_id`, [evento.id, inserido.rowCount ? capturadoEm : evento.capturado_em,
      clientes]);
    if (hooks.afterIntent) await hooks.afterIntent(evento);
    if (inserido.rowCount === 1 && hooks.persistLinks) {
      await hooks.persistLinks(client, evento.id);
    }
    await client.query("COMMIT");
    transacao = false;
    return { eventoId: evento.id, novoEvento: inserido.rowCount === 1,
      intencoesNovas: intents.rowCount };
  } catch (error) {
    if (transacao) await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function promoverProximaIntencao(client, {
  agoraMs = Date.now(), eventoId = null, clienteId = null,
  criarJob = null, hooks = {}, ignorarPares = [], reportErrors = false
} = {}) {
  let transacao = false;
  let selectedIntent = null;
  try {
    await client.query("BEGIN");
    transacao = true;
    const selected = await client.query(`SELECT i.evento_id,i.cliente_id,i.capturado_em,
             e.metadata,e.links_extraidos,e.marketplace_detectado
        FROM engine_radar_replay_intents_candidate i
        JOIN engine_eventos_brutos e ON e.id=i.evento_id
       WHERE i.status='pendente'
         AND ($1::bigint IS NULL OR i.evento_id=$1)
         AND ($2::text IS NULL OR i.cliente_id=$2)
         AND (i.evento_id::text || ':' || i.cliente_id) <> ALL($3::text[])
       ORDER BY i.criado_em,i.evento_id,i.cliente_id
       LIMIT 1 FOR UPDATE OF i SKIP LOCKED`, [eventoId,clienteId,ignorarPares]);
    const intent = selected.rows[0];
    if (!intent) {
      await client.query("COMMIT");
      transacao = false;
      return { estado: "vazio" };
    }
    selectedIntent = intent;
    // The epoch is the durable operational boundary, not a new capture clock.
    // A pre-epoch intent must never be retried as post-epoch work.
    const epoch = verificarCapturaIngressReal(intent.capturado_em);
    if (epoch.mode === "UNIVERSAL" && epoch.reason === "pre_epoch_capture") {
      await client.query(`UPDATE engine_radar_replay_intents_candidate
        SET status='rejected_pre_epoch',atualizado_em=now()
        WHERE evento_id=$1 AND cliente_id=$2`, [intent.evento_id,intent.cliente_id]);
      await client.query("COMMIT");
      transacao = false;
      return { estado: "rejected_pre_epoch", eventoId: intent.evento_id,
        clienteId: intent.cliente_id };
    }
    if (!epoch.ok) throw new Error(`radar_intent_epoch_ambiguous:${epoch.reason}`);
    const frescor = avaliarFrescorPreImporter({
      evento_capturado_em: intent.capturado_em,
      evento_origem: "radar",
      evento_metadata: intent.metadata || {}
    }, { agoraMs });
    if (frescor.expirada === true) {
      await client.query(`UPDATE engine_radar_replay_intents_candidate
        SET status='expirada',atualizado_em=now()
        WHERE evento_id=$1 AND cliente_id=$2`, [intent.evento_id,intent.cliente_id]);
      await client.query("COMMIT");
      transacao = false;
      return { estado: "expirada", eventoId: intent.evento_id,
        clienteId: intent.cliente_id };
    }
    let criado = null;
    if (typeof criarJob === "function") {
      const result = await criarJob(intent);
      if (result?.motivo === "hot_admission_denied") {
        await client.query("ROLLBACK");
        transacao = false;
        return { estado: "admission_negada", eventoId: intent.evento_id,
          clienteId: intent.cliente_id };
      }
      if (result?.ok === false && Number(result?.criados || 0) === 0 &&
          Number(result?.existentes || 0) === 0) {
        throw new Error(`radar_intent_job_rejected:${String(result.motivo || "unknown")}`);
      }
      criado = Number(result?.criados || 0) > 0;
    } else {
      const inserted = await client.query(`INSERT INTO engine_jobs_cliente
        (evento_id,cliente_id,marketplace_detectado,marketplace,status,metadata)
        VALUES ($1,$2,$3,$3,'pendente',$4::jsonb)
        ON CONFLICT (evento_id,cliente_id) DO NOTHING RETURNING id`,
      [intent.evento_id,intent.cliente_id,intent.marketplace_detectado || "",
        JSON.stringify({ metadataEvento: intent.metadata || {} })]);
      criado = inserted.rowCount === 1;
    }
    const jobId = (await client.query(`SELECT id
      FROM engine_jobs_cliente WHERE evento_id=$1 AND cliente_id=$2`,
    [intent.evento_id,intent.cliente_id])).rows[0]?.id;
    if (!jobId) throw new Error("radar_intent_job_missing");
    if (hooks.afterJob) await hooks.afterJob({ intent, jobId });
    await client.query(`UPDATE engine_radar_replay_intents_candidate
      SET status='concluida',job_id=$3,atualizado_em=now()
      WHERE evento_id=$1 AND cliente_id=$2`,
    [intent.evento_id,intent.cliente_id,jobId]);
    await client.query("COMMIT");
    transacao = false;
    return { estado: criado ? "criada" : "existente",
      eventoId: intent.evento_id, clienteId: intent.cliente_id, jobId };
  } catch (error) {
    if (transacao) await client.query("ROLLBACK").catch(() => {});
    if (String(error.message || "").includes("UF_HOT_ADMISSION_DENIED")) {
      return { estado: "admission_negada", eventoId: selectedIntent?.evento_id,
        clienteId: selectedIntent?.cliente_id };
    }
    if (reportErrors && selectedIntent) {
      return { estado: "erro_ambiguo", eventoId: selectedIntent.evento_id,
        clienteId: selectedIntent.cliente_id,
        motivo: String(error.message || error).slice(0, 160) };
    }
    throw error;
  }
}

module.exports = { persistirCapturaComIntencoes, promoverProximaIntencao };
