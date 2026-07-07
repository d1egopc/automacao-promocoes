const {
  deveIgnorarOfertaRepetida,
  registrarOfertaVista
} = require("./memoria-ofertas");

function adicionarOfertaNaFila(fila, oferta, origem = "automatico") {
  if (!oferta) return false;

  if (deveIgnorarOfertaRepetida(oferta)) {
    console.log("[INFO] Oferta ignorada por repetio:", {
      origem,
      titulo: oferta.titulo || oferta.nome,
      marketplace: oferta.marketplace
    });

    return false;
  }

  registrarOfertaVista(oferta);

  fila.push(oferta);

  return true;
}

module.exports = {
  adicionarOfertaNaFila
};