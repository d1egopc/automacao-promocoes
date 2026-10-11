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

  async function adquirir({ clienteId = "", oferta = {}, destinoId = "" } = {}) {
    const filaItemId = chaveClaimProdutoDestino({ clienteId, oferta, destinoId });
    if (!filaItemId) return { resultado: "identidade_operacional_ausente", handle: null, filaItemId: "" };
    const estado = await advisory.adquirir({
      clienteId,
      oferta: { id: filaItemId, clienteId, origemFluxo: "optimus" }
    });
    if (estado?.resultado !== "adquirido") return estado;
    try {
      const chaveReserva = filaItemId.replace("ofertas-v2-par:", "ofertas-v2-duravel:");
      if (await reserva.consultar(estado.handle?.client, clienteId, chaveReserva)) {
        await advisory.finalizar(estado, { statusFinal: "envio_recente_ou_indeterminado" });
        return { resultado: "ocupado_recente", filaItemId };
      }
      return { ...estado, filaItemId, chaveReserva, clienteId, reservaToken: "", advisoryLiberado: false };
    } catch {
      await advisory.finalizar(estado, { statusFinal: "reserva_indisponivel" });
      return { resultado: "reserva_indisponivel", filaItemId };
    }
  }

  async function prepararTransporte(estado) {
    if (estado?.resultado !== "adquirido" || !estado.chaveReserva) return false;
    let token = "";
    try {
      token = await reserva.preparar(estado.handle?.client, estado.clienteId,
        estado.chaveReserva, new Date(now() + JANELA_MS).toISOString());
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
    if (!estado?.reservaToken) return;
    await reserva.descartar(null, estado.clienteId, estado.chaveReserva, estado.reservaToken);
    estado.reservaToken = "";
  }

  async function finalizar(estado, dados = {}) {
    if (estado?.advisoryLiberado) return { liberacao: "liberado" };
    return advisory.finalizar(estado, dados);
  }

  return { adquirir, prepararTransporte, descartarSemTransporte, finalizar, chaveClaimProdutoDestino };
}

module.exports = { chaveClaimProdutoDestino, criarCoordenadorEnvioProdutoDestino };
