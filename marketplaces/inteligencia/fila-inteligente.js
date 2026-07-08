const {
  deveIgnorarOfertaRepetida,
  registrarOfertaVista
} = require("./memoria-ofertas");
const filaOfertas = require("../../utils/fila-ofertas");

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

  filaOfertas.adicionarOfertaFila(fila, oferta, {
    clienteId: oferta.clienteId || "admin",
    origem,
    logger: console
  });

  return true;
}

module.exports = {
  adicionarOfertaNaFila
};
