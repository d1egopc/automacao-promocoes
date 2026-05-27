// ================= IMPORTADOR ALIEXPRESS =================

async function importarProdutoAliExpress(link, deps = {}) {

  try {

    console.log("🛒 Importando produto AliExpress:", link);

    return {
      titulo: "Produto AliExpress",
      precoAtual: "",
      precoAntigo: "",
      imagem: "",
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