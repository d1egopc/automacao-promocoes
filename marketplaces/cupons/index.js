const {
  escolherMelhorCupom,
  cupomEstaValido
} = require("./motorCupons");

const {
  CUPONS_ATIVOS
} = require("./cuponsAtivos");

module.exports = {
  CUPONS_ATIVOS,
  escolherMelhorCupom,
  cupomEstaValido
};