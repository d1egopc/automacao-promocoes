function texto(valor = "") {
  return String(valor || "").trim();
}

async function executarConsumidorMensagemIsolado({ consumidor = "", executar, contexto = {}, logger = console } = {}) {
  if (typeof executar !== "function") {
    return { ok: false, motivo: "consumidor_sem_executor" };
  }

  try {
    return { ok: true, resultado: await executar() };
  } catch (erro) {
    const motivo = texto(erro?.message) || "erro_consumidor";
    if (typeof logger?.log === "function") {
      logger.log("[WHATSAPP-CONSUMIDOR-ERRO]", JSON.stringify({
        consumidor: texto(consumidor) || "desconhecido",
        ...contexto,
        motivo
      }));
    }
    return { ok: false, motivo, erro };
  }
}

module.exports = { executarConsumidorMensagemIsolado };
