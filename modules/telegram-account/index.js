"use strict";

const { createTelegramAccountService } = require("./account.service");

// Fronteira publica: consumidores usam apenas o service. Adapter, cofre,
// StringSession e estado de autenticacao permanecem internos ao modulo.
module.exports = Object.freeze({ createTelegramAccountService });
