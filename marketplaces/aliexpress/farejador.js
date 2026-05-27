// ================= FAREJADOR ALIEXPRESS MODULAR =================

async function farejarAliExpress(clienteId = "admin", deps = {}) {
  const {
    config,
    integracoesPorCliente,
    fila,
    salvarFila,
    prepararOfertaGlobal,
    ofertaJaExiste,
    classificarCategoriaOferta,
    aplicarFiltrosUniversais,
    gerarBuscasGlobais,
    distribuirOfertaParaClientes,
    encurtarUrl
  } = deps;

  try {
    console.log("🛒 Farejando ofertas AliExpress modular...", { clienteId });

    const cfg = config.marketplaces?.aliexpress || {};

    if (!cfg.ativo) {
      console.log("⏸ AliExpress desativado. Farejador ignorado.");
      return [];
    }

    const integracao =
      integracoesPorCliente?.[clienteId]?.aliexpress ||
      integracoesPorCliente?.admin?.aliexpress;

    if (!integracao?.credenciais) {
      console.log("❌ AliExpress sem integração configurada:", clienteId);
      return [];
    }

    const limitePorRodada = cfg.limitePorRodada || 5;

    const buscas =
      typeof gerarBuscasGlobais === "function"
        ? gerarBuscasGlobais(30)
        : ["produto no brasil", "estoque no brasil", "fone bluetooth", "smartwatch"];

    console.log("🔎 Buscas AliExpress:", buscas.slice(0, 10));

    // Por enquanto só estrutura inicial
    console.log("✅ AliExpress modular carregado com sucesso.");

    return [];

  } catch (e) {
    console.log("❌ erro farejador AliExpress modular:", e.message);
    return [];
  }
}

module.exports = farejarAliExpress;