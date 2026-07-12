const criarRotasTemplatesClientes = require("./routes");
const service = require("./service");
const renderer = require("./renderer");
const storage = require("./storage");
const validator = require("./validator");
const catalogo = require("./catalogo-blocos");
const preview = require("./oferta-preview");
const resolver = require("./resolver");

module.exports = {
  criarRotasTemplatesClientes,
  ...service,
  ...renderer,
  ...storage,
  ...validator,
  ...catalogo,
  ...preview,
  ...resolver
};
