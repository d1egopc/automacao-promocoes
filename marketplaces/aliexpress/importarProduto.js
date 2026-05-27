// ================= IMPORTADOR ALIEXPRESS =================

async function importarProdutoAliExpress(link, deps = {}) {

  try {

    console.log("🛒 Importando produto AliExpress:", link);

    const response = await fetch(link, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language":
          "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });

    console.log("📡 PRODUTO ALIEXPRESS STATUS:", response.status);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    const titulo =
      html.match(/<title>(.*?)<\/title>/i)?.[1]
        ?.replace(/\s+-\s+AliExpress.*$/i, "")
        ?.trim() ||
      "Produto AliExpress";

    const imagem =
      html.match(/property="og:image"\s*content="([^"]+)"/i)?.[1] ||
      "";

    const precos =
      [...html.matchAll(/R\$\s*\d+[.,]\d+/g)]
        .map(v => v[0]);

    const precoAtual = precos?.[0] || "";
    const precoAntigo = precos?.[1] || "";

 console.log("🧪 HTML PRODUTO tamanho:", html.length);

 console.log("🤖 PRODUTO ALIEXPRESS:", {
  titulo,
  precoAtual,
  precoAntigo,
  imagem
  });

   return {
      titulo,
      precoAtual,
      precoAntigo,
      imagem,
      linkAfiliado: link,
      marketplace: "AliExpress"
    };

  } catch (e) {

    console.log("❌ erro importarProdutoAliExpress:", e.message);
    return null;

  }
}

module.exports = {
  importarProdutoAliExpress
};