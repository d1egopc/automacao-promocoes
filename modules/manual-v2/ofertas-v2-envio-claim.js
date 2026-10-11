"use strict";

const crypto = require("crypto");
const { getEnginePool } = require("../engine/database");
const { identidadeCanonica, identidadeIsoladaObservacao } = require("./ofertas-v2-identidade");

const JANELA_MS = 2 * 60 * 60 * 1000;

function texto(valor) { return String(valor ?? "").trim(); }

function chaveClaimProdutoDestino({ clienteId = "", oferta = {}, destinoId = "" } = {}) {
  const workspace = texto(clienteId || oferta.clienteId || oferta.workspaceId);
  const produto = identidadeCanonica(oferta) || identidadeIsoladaObservacao({ ...oferta, clienteId: workspace });
  const destino = texto(destinoId);
  if (!workspace || !produto || !destino) return "";
  const hash = crypto.createHash("sha256")
    .update(JSON.stringify([workspace, produto, destino]))
    .digest("hex");
  return `ofertas-v2-par:${hash}`;
}

function reservaPostgres() {
  return {
    async consultar(client, clienteId, filaItemId) {
      const r = await client.query(
        "SELECT lease_expires_at FROM fila_claims_ativos WHERE cliente_id = $1 AND fila_item_id = $2 AND lease_expires_at > NOW()",
        [clienteId, filaItemId]
      );
      return Boolean(r.rows?.length);
    },
    async consultarDetalhe(client, clienteId, filaItemId) {
      const r = await client.query(
        `SELECT claim_token,lease_expires_at FROM fila_claims_ativos
         WHERE cliente_id=$1 AND fila_item_id=$2 AND lease_expires_at>NOW()`,
        [clienteId, filaItemId]
      );
      return r.rows?.[0] || null;
    },
    async carregarOwnerTarget(client, { ownerId, clienteId, destinoId,
      targetId, leaseToken, smokeGateId = null }) {
      const r = await client.query(
        `SELECT o.owner_id,o.commercial_reservation_key,o.reservation_token
           FROM engine_universal_fanout_owners o
           JOIN engine_universal_queue_destinations d
             ON d.fanout_owner_id=o.owner_id
            AND d.queue_item_id=o.queue_item_id
            AND d.operation_epoch_started_at=o.operation_epoch_started_at
            AND d.workspace_id=o.workspace_id
            AND d.destination_id=o.destination_id
          WHERE o.owner_id=$1 AND o.workspace_id=$2 AND o.destination_id=$3
            AND d.id=$4 AND d.lease_token=$5 AND d.status='claimed'
            AND d.lease_until>clock_timestamp()
            AND (o.operation_epoch_started_at=(
              SELECT operation_epoch_started_at FROM engine_operation_state
              WHERE id=1 AND mode='UNIVERSAL')
              OR ($6::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM engine_universal_one_shot_smoke g
                JOIN engine_operation_state s ON s.id=1
                  AND s.mode='CUTOVER_PREPARED'
                  AND s.operation_epoch_started_at IS NULL
                WHERE g.id=$6::uuid AND g.smoke_epoch_at=o.operation_epoch_started_at
                  AND g.queue_item_id=o.queue_item_id
                  AND g.queue_destination_id=d.id
                  AND g.workspace_id=o.workspace_id
                  AND g.destination_id=o.destination_id
                  AND g.target_key=d.target_key AND g.channel=d.channel
                  AND g.state IN ('armed','claimed')
                  AND g.provider_call_count=0
                  AND g.expires_at>clock_timestamp()
              )))`,
        [ownerId, clienteId, destinoId, targetId, leaseToken, smokeGateId]
      );
      return r.rows?.[0] || null;
    },
    async vincularOwner(client, { ownerId, clienteId, chaveReserva, token }) {
      const r = await client.query(
        `UPDATE engine_universal_fanout_owners
            SET commercial_reservation_key=$3,reservation_token=$4,
                updated_at=clock_timestamp()
          WHERE owner_id=$1 AND workspace_id=$2
            AND commercial_reservation_key IS NULL
            AND reservation_token IS NULL
          RETURNING owner_id`,
        [ownerId, clienteId, chaveReserva, token]
      );
      return r.rowCount === 1;
    },
    async desvincularOwner(client, { ownerId, clienteId, token }) {
      const r = await client.query(
        `UPDATE engine_universal_fanout_owners
            SET commercial_reservation_key=NULL,reservation_token=NULL,
                updated_at=clock_timestamp()
          WHERE owner_id=$1 AND workspace_id=$2 AND reservation_token=$3
          RETURNING owner_id`,
        [ownerId, clienteId, token]
      );
      return r.rowCount === 1;
    },
    async preparar(client, clienteId, filaItemId, leaseExpiresAt) {
      const token = crypto.randomUUID();
      const r = await client.query(
        `INSERT INTO fila_claims_ativos (cliente_id, fila_item_id, claim_token, lease_expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cliente_id, fila_item_id) DO UPDATE
           SET claim_token = EXCLUDED.claim_token, claimed_at = NOW(), lease_expires_at = EXCLUDED.lease_expires_at
         WHERE fila_claims_ativos.lease_expires_at <= NOW()
         RETURNING claim_token`,
        [clienteId, filaItemId, token, leaseExpiresAt]
      );
      // Retencao limitada por envio: o indice existente em lease_expires_at
      // evita transformar a reserva em historico crescente de produtos.
      try {
        await client.query(
          `DELETE FROM fila_claims_ativos WHERE ctid IN (
             SELECT ctid FROM fila_claims_ativos
              WHERE lease_expires_at <= NOW() AND fila_item_id LIKE 'ofertas-v2-duravel:%'
              ORDER BY lease_expires_at LIMIT 32
           )`
        );
      } catch { /* a reserva confirmada prevalece sobre manutencao oportunista */ }
      return r.rows?.[0]?.claim_token === token ? token : "";
    },
    async descartar(client, clienteId, filaItemId, token) {
      const executor = client || await getEnginePool().connect();
      try {
        await executor.query(
          "DELETE FROM fila_claims_ativos WHERE cliente_id = $1 AND fila_item_id = $2 AND claim_token = $3",
          [clienteId, filaItemId, token]
        );
      } finally {
        if (!client) executor.release();
      }
    }
  };
}

function criarCoordenadorEnvioProdutoDestino({ advisory, reserva = reservaPostgres(), now = () => Date.now() } = {}) {
  if (!advisory || typeof advisory.adquirir !== "function" || typeof advisory.finalizar !== "function") {
    throw new Error("ofertas_v2_advisory_invalido");
  }

  async function adquirir({ clienteId = "", oferta = {}, destinoId = "",
    fanoutOwnerId = "", targetId = null, targetLeaseToken = "",
    smokeGateId = null } = {}) {
    const filaItemId = chaveClaimProdutoDestino({ clienteId, oferta, destinoId });
    if (!filaItemId) return { resultado: "identidade_operacional_ausente", handle: null, filaItemId: "" };
    const estado = await advisory.adquirir({
      clienteId,
      oferta: { id: filaItemId, clienteId, origemFluxo: "optimus" }
    });
    if (estado?.resultado !== "adquirido") return estado;
    try {
      const chaveReserva = filaItemId.replace("ofertas-v2-par:", "ofertas-v2-duravel:");
      const ownerRequested = Boolean(fanoutOwnerId || targetId || targetLeaseToken);
      if (ownerRequested && (!fanoutOwnerId || !targetId || !targetLeaseToken ||
          typeof reserva.carregarOwnerTarget !== "function" ||
          typeof reserva.consultarDetalhe !== "function")) {
        await advisory.finalizar(estado, { statusFinal: "owner_incompleto" });
        return { resultado: "owner_incompleto", filaItemId };
      }
      const owner = ownerRequested ? await reserva.carregarOwnerTarget(
        estado.handle?.client, { ownerId: fanoutOwnerId, clienteId, destinoId,
          targetId, leaseToken: targetLeaseToken, smokeGateId }) : null;
      if (ownerRequested && !owner) {
        await advisory.finalizar(estado, { statusFinal: "owner_target_invalido" });
        return { resultado: "owner_target_invalido", filaItemId };
      }
      const active = ownerRequested
        ? await reserva.consultarDetalhe(estado.handle?.client, clienteId,
          chaveReserva)
        : await reserva.consultar(estado.handle?.client, clienteId, chaveReserva);
      if (active && ownerRequested &&
          owner.commercial_reservation_key === chaveReserva &&
          String(owner.reservation_token) === String(active.claim_token)) {
        await advisory.finalizar(estado, { statusFinal: "mesmo_fanout_owner" });
        return { resultado: "adquirido", filaItemId, chaveReserva, clienteId,
          destinoId,
          fanoutOwnerId, ownerContinuation: true,
          reservaToken: String(active.claim_token), advisoryLiberado: true,
          handle: null };
      }
      if (active) {
        await advisory.finalizar(estado, { statusFinal: "envio_recente_ou_indeterminado" });
        return { resultado: "ocupado_recente", filaItemId };
      }
      // A previously bound owner without its matching live reservation must
      // not silently create another commercial dispatch.
      if (ownerRequested && owner.reservation_token) {
        await advisory.finalizar(estado, { statusFinal: "owner_reservation_missing" });
        return { resultado: "owner_reservation_missing", filaItemId };
      }
      return { ...estado, filaItemId, chaveReserva, clienteId, destinoId,
        fanoutOwnerId: ownerRequested ? fanoutOwnerId : "",
        ownerContinuation: false, reservaToken: "", advisoryLiberado: false };
    } catch {
      await advisory.finalizar(estado, { statusFinal: "reserva_indisponivel" });
      return { resultado: "reserva_indisponivel", filaItemId };
    }
  }

  async function prepararTransporte(estado) {
    if (estado?.resultado !== "adquirido" || !estado.chaveReserva) return false;
    if (estado.ownerContinuation === true) return Boolean(estado.reservaToken);
    let token = "";
    try {
      const client = estado.handle?.client;
      if (estado.fanoutOwnerId) await client.query("BEGIN");
      try {
        token = await reserva.preparar(client, estado.clienteId,
          estado.chaveReserva, new Date(now() + JANELA_MS).toISOString());
        if (estado.fanoutOwnerId) {
          if (!token || typeof reserva.vincularOwner !== "function" ||
              !await reserva.vincularOwner(client, { ownerId: estado.fanoutOwnerId,
                clienteId: estado.clienteId, chaveReserva: estado.chaveReserva,
                token })) throw new Error("fanout_owner_binding_failed");
          await client.query("COMMIT");
        }
      } catch (error) {
        if (estado.fanoutOwnerId) await client.query("ROLLBACK").catch(() => {});
        token = "";
        if (estado.fanoutOwnerId) throw error;
      }
      estado.reservaToken = token;
    } finally {
      // A reserva duravel, nao o lock de sessao, protege o par durante rede.
      const liberacao = await advisory.finalizar(estado, { statusFinal: token ? "reservado" : "reserva_indisponivel" });
      estado.advisoryLiberado = liberacao?.liberacao === "liberado" || liberacao?.liberado === true;
      estado.handle = null;
    }
    return Boolean(token && estado.advisoryLiberado);
  }

  async function descartarSemTransporte(estado) {
    if (!estado?.reservaToken || estado.ownerContinuation === true) return;
    if (estado.fanoutOwnerId) {
      const client = await getEnginePool().connect();
      try {
        await client.query("BEGIN");
        await reserva.descartar(client, estado.clienteId, estado.chaveReserva,
          estado.reservaToken);
        if (!await reserva.desvincularOwner(client, {
          ownerId: estado.fanoutOwnerId, clienteId: estado.clienteId,
          token: estado.reservaToken })) throw new Error("fanout_owner_release_failed");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { client.release(); }
    } else {
      await reserva.descartar(null, estado.clienteId, estado.chaveReserva,
        estado.reservaToken);
    }
    estado.reservaToken = "";
  }

  async function validarTitularidade(estado, { targetId, targetLeaseToken,
    smokeGateId = null } = {}) {
    if (!estado?.fanoutOwnerId || !estado.reservaToken ||
        !targetId || !targetLeaseToken ||
        typeof reserva.carregarOwnerTarget !== "function" ||
        typeof reserva.consultarDetalhe !== "function") return false;
    const client = await getEnginePool().connect();
    try {
      const owner = await reserva.carregarOwnerTarget(client, {
        ownerId: estado.fanoutOwnerId, clienteId: estado.clienteId,
        destinoId: estado.destinoId, targetId,
        leaseToken: targetLeaseToken, smokeGateId });
      if (!owner || owner.commercial_reservation_key !== estado.chaveReserva ||
          String(owner.reservation_token) !== String(estado.reservaToken)) return false;
      const active = await reserva.consultarDetalhe(client, estado.clienteId,
        estado.chaveReserva);
      return Boolean(active &&
        String(active.claim_token) === String(estado.reservaToken));
    } finally { client.release(); }
  }

  async function finalizar(estado, dados = {}) {
    if (estado?.advisoryLiberado) return { liberacao: "liberado" };
    return advisory.finalizar(estado, dados);
  }

  return { adquirir, prepararTransporte, descartarSemTransporte,
    validarTitularidade, finalizar, chaveClaimProdutoDestino };
}

module.exports = { chaveClaimProdutoDestino, criarCoordenadorEnvioProdutoDestino,
  reservaPostgres };
