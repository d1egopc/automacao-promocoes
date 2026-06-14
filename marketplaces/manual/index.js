const {
  normalizarOfertaManual
} = require("./normalizar-oferta");

const {
  adicionarManualNaFila
} = require("./fila-manual");

const {
  detectarMarketplaceManual,
  importarProdutoManual
} = require("./importar-produto");

module.exports = {
  normalizarOfertaManual,
  adicionarManualNaFila,
  detectarMarketplaceManual,
  importarProdutoManual
};