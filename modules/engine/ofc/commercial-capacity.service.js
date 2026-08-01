const { readGlobalJson } = require("../../../utils/storage");
const { listarClientesAtivos } = require("../../../utils/usuarios-atividade");
const destinosUtils = require("../../../utils/destinos");

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarMapaDestinos(valor = {}) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  return valor;
}

function destinosDoCliente(mapa = {}, clienteId = "") {
  const bruto = mapa?.[clienteId];
  if (Array.isArray(bruto)) return bruto;
  if (bruto && typeof bruto === "object") {
    return Object.values(bruto).filter(Array.isArray).flat();
  }
  return [];
}

function numeroIntervaloDestino(destino = {}) {
  const candidatos = [
    destino.intervaloMinutos,
    destino.intervalo,
    destino.intervaloEnvioMinutos,
    destino.intervaloConfiguradoMinutos
  ];
  for (const candidato of candidatos) {
    const numero = Number(candidato);
    if (Number.isFinite(numero) && numero > 0) return numero;
  }
  return 5;
}

function destinoPossuiIntegracaoBasica(destino = {}) {
  const tipo = String(destino.tipo || destino.canal || "").toLowerCase();
  if (tipo === "telegram") {
    return Boolean(destino.botToken && (destino.chatId || destino.id || destino.destinoId));
  }
  if (tipo === "whatsapp") {
    return Boolean(destino.id || destino.jid || destino.value || destino.destinoId);
  }
  return Boolean(tipo && destino.ativo !== false);
}

function calcularCapacidadeComercialTeorica(opcoes = {}) {
  try {
    const clientesAtivos = typeof opcoes.listarClientesAtivos === "function"
      ? opcoes.listarClientesAtivos()
      : listarClientesAtivos();
    const destinosGlobais = opcoes.destinosPorCliente ||
      normalizarMapaDestinos(readGlobalJson("destinos_clientes.json", readGlobalJson("destinos.json", {})));

    let destinosAtivos = 0;
    let destinosAptosAgora = 0;
    let capacidadeComercialTeoricaPorMinuto = 0;

    for (const clienteId of lista(clientesAtivos)) {
      for (const destino of destinosDoCliente(destinosGlobais, clienteId)) {
        if (!destino || destino.ativo === false) continue;
        destinosAtivos += 1;
        if (!destinoPossuiIntegracaoBasica(destino)) continue;
        if (!destinosUtils.destinoDentroHorario(destino)) continue;
        destinosAptosAgora += 1;
        capacidadeComercialTeoricaPorMinuto += 1 / numeroIntervaloDestino(destino);
      }
    }

    return {
      ok: true,
      workspacesAptosAgora: lista(clientesAtivos).length,
      destinosAtivos,
      destinosAptosAgora,
      capacidadeComercialTeoricaPorMinuto: Math.round(capacidadeComercialTeoricaPorMinuto * 100) / 100
    };
  } catch (e) {
    return {
      ok: false,
      workspacesAptosAgora: null,
      destinosAtivos: null,
      destinosAptosAgora: null,
      capacidadeComercialTeoricaPorMinuto: null,
      motivo: "capacidade_comercial_indisponivel",
      erro: e?.message || ""
    };
  }
}

module.exports = {
  calcularCapacidadeComercialTeorica,
  destinoPossuiIntegracaoBasica,
  numeroIntervaloDestino
};
