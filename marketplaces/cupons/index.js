// ================= MOTOR UNIVERSAL DE CUPONS =================

async function buscarCupomMercadoLivre(oferta = {}) {
  try {

 console.log("🎟️ BUSCADOR ML CUPOM ATIVO:", {
  nome: oferta.nome || oferta.titulo,
  link: oferta.link || "",
  linkOriginal: oferta.linkOriginal || ""
 });
    
     // FASE 1:
    // Aqui ainda NÃO inventa cupom.
    // Depois vamos buscar cupom real do Mercado Livre.

    return null;
  } catch (e) {
    console.log("⚠️ Erro ao buscar cupom Mercado Livre:", e.message);
    return null;
  }
}

async function aplicarCuponsAutomaticos(oferta = {}) {
  try {

    console.log("🎟️ MOTOR CUPONS RECEBEU:", {
      marketplace: oferta.marketplace || oferta.loja,
      nome: oferta.nome || oferta.titulo,
      cupomAtual: oferta.cupom || ""
    });

    const marketplace = String(
      oferta.marketplace || oferta.loja || ""
    ).toLowerCase();

    let cupomEncontrado = null;

    if (
      marketplace === "mercadolivre" ||
      marketplace === "mercado_livre" ||
      marketplace === "ml"
    ) {
      cupomEncontrado = await buscarCupomMercadoLivre(oferta);
    }

    if (!cupomEncontrado) {
      return {
        ...oferta,
        cupom: oferta.cupom || "",
        tipoCupom: oferta.tipoCupom || "",
        avisoCupom: oferta.avisoCupom || "",
        cupomMarketplace: oferta.cupomMarketplace || marketplace || "",
        cupomValor: oferta.cupomValor || "",
        cupomPercentual: oferta.cupomPercentual || ""
      };
    }

    return {
      ...oferta,
      cupom: cupomEncontrado.cupom || "",
      tipoCupom: cupomEncontrado.tipoCupom || "",
      avisoCupom:
        cupomEncontrado.avisoCupom ||
        cupomEncontrado.descricao ||
        "",
      cupomMarketplace: marketplace,
      cupomValor: cupomEncontrado.cupomValor || "",
      cupomPercentual: cupomEncontrado.cupomPercentual || ""
    };
  } catch (e) {
    console.log("⚠️ Erro no motor universal de cupons:", e.message);
    return oferta;
  }
}

module.exports = {
  aplicarCuponsAutomaticos,
  buscarCupomMercadoLivre
};