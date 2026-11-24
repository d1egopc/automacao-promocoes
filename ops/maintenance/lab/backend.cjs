"use strict";

const http = require("node:http");
const { readFileSync } = require("node:fs");
const healthy = readFileSync("/app/fixture-health", "utf8").trim() === "healthy";
http.createServer((_req, res) => {
  res.writeHead(healthy ? 200 : 503);
  res.end("fixture");
}).listen(3000, "0.0.0.0");
