"use strict";

const { createTelegramTeleRadarControlPlane } = require("./control-plane.service");
const { createTelegramTeleRadarAdminRoutes } = require("./routes");

module.exports = Object.freeze({
  createTelegramTeleRadarControlPlane,
  createTelegramTeleRadarAdminRoutes
});
