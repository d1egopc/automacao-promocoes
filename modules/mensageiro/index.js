const service = require("./service");
const storage = require("./storage");

module.exports = {
  ...service,
  ...storage
};