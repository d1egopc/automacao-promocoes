"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function trecho(inicio, fim) {
  const de = fonte.indexOf(inicio);
  assert.notEqual(de, -1, `inicio ausente: ${inicio}`);
  const ate = fonte.indexOf(fim, de);
  assert.notEqual(ate, -1, `fim ausente: ${fim}`);
  return fonte.slice(de, ate);
}

const padrao = trecho("function radarConfigPadrao()", "function getRadarConfigFile");
const carregar = trecho("function carregarRadarConfigCliente", "function obterGrupoWhatsappIdTecnicoRadar");
const salvar = trecho("function salvarRadarConfigCliente", "function textoRadarId");
const processar = trecho("async function processarMensagemRadar", "registerRadarIngressHandler");
const rotaGet = trecho('app.get("/radar/config"', 'app.post("/radar/config"');
const rotaPost = trecho('app.post("/radar/config"', 'app.get("/radar/historico"');

assert.match(padrao, /solenoideAuto:\s*false/, "campo ausente deve nascer OFF/legado");
assert.match(carregar, /solenoideAuto:\s*dados\.solenoideAuto === true/, "somente true explicito ativa");
assert.match(salvar, /possuiCampo\("solenoideAuto"\)/, "save parcial preserva valor anterior");
assert.match(salvar, /writeClienteJson\(clienteId, "radar-config\.json", payload\)/, "usa persistencia Radar existente");
assert.match(rotaGet, /solenoideAuto:\s*radarConfig\.solenoideAuto === true/, "GET devolve toggle persistido");
assert.match(rotaPost, /solenoideAuto deve ser boolean/, "POST valida contrato booleano");
assert.match(rotaPost, /dadosConfig\.solenoideAuto = body\.solenoideAuto/, "POST salva no mesmo payload");
assert.match(processar, /origemAutorizadaInternamente !== true/, "handoff TeleRadar nao sofre gate Radar duplicado");
assert.match(processar, /radarPodeCapturarAgora[\s\S]+solenoideGlobal\.avaliarOrigem/, "manual e horario precedem Solenoide");
assert.match(processar, /solenoide_coleta_reduzida/, "autoridade ativa tem decisao explicita e fail-safe fora do handler");
assert.doesNotMatch(processar, /manual-v2|extensao/, "Manual e Extensao continuam fora da autoridade");

console.log("PASS tests/solenoide-radar-config.test.js (11 contratos)");
