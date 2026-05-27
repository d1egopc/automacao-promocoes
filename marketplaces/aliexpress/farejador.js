const { gerarBuscasAliExpress } = require("./buscas");

const { importarProdutoAliExpress } =
require("./importarProduto");

const {
  extrairLinksProdutosAliExpress
} = require("./parser");

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

   const buscas = gerarBuscasAliExpress({ gerarBuscasGlobais });

    console.log("🔎 Buscas AliExpress:", buscas.slice(0, 10));

   const produtosEncontrados = [];

for (const termo of buscas.slice(0, 5)) {
  try {
    const slug = termo.trim().replace(/\s+/g, "-");

    const url = `https://pt.aliexpress.com/w/wholesale-${encodeURIComponent(slug)}.html`;

    console.log("🌐 ALIEXPRESS URL:", url);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });

    console.log("📡 ALIEXPRESS STATUS:", response.status);

    if (!response.ok) continue;

    const html = await response.text();

    console.log("🧪 HTML AliExpress tamanho:", html.length);
    console.log("🧪 HTML AliExpress trecho:", html.slice(0, 500));

    const links = extrairLinksProdutosAliExpress(html).slice(0, 3);

    console.log("🔗 Links AliExpress encontrados:", links.length);

    for (const link of links) {
      const produto = await importarProdutoAliExpress(link, {
        config,
        integracao,
        encurtarUrl
      });

      if (produto) {
        produtosEncontrados.push(produto);
      }
    }

  } catch (e) {
    console.log("❌ erro busca AliExpress:", e.message);
  }
}

console.log("🧪 Produtos AliExpress encontrados:", produtosEncontrados.length);

    // Por enquanto só estrutura inicial
    console.log("✅ AliExpress modular carregado com sucesso.");

    return [];

  } catch (e) {
    console.log("❌ erro farejador AliExpress modular:", e.message);
    return [];
  }
}

module.exports = farejarAliExpress;