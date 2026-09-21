"use strict";

const { createTeleRadarService } = require("./teleradar.service");
const { createRadarIngressAdapter } = require("./radar-ingress.adapter");

module.exports = Object.freeze({ createTeleRadarService, createRadarIngressAdapter });
