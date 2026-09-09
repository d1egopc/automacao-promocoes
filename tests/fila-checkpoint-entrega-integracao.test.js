"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function trecho(inicio, fim) {
  const de = fonte.indexOf(inicio);
  assert(de >= 0, `trecho ausente: ${inicio}`);
  const ate = fonte.indexOf(fim, de + inicio.length);
  assert(ate >= 0, `fim ausente: ${fim}`);
  return fonte.slice(de, ate);
}

assert.match(fonte, /fila-checkpoint-entrega\.service/);
assert.match(fonte, /criarCheckpointEntregaFuncional/);
assert.match(fonte, /checkpointEntregaFuncionalFila\.executar/);
assert.match(fonte, /advisoryHandle:\s*opcoes\.advisoryHandle/);
assert.match(fonte, /advisoryHandle:\s*advisoryFuncionalFila\.handle/);

const whatsapp = trecho('const enviarTextoWhatsapp', '// ================= ENVIO DISCORD');
assert.match(whatsapp, /canal:\s*"whatsapp"/);
assert.match(whatsapp, /providerMessageId:\s*resposta\?\.key\?\.id/);
assert.match(whatsapp, /registrarCreditoCheckpoint\(checkpointEnvioWhatsapp\)/);

const discord = trecho('// ================= ENVIO DISCORD', '// ================= ENVIO TELEGRAM');
assert.match(discord, /canal:\s*"discord"/);
assert.match(discord, /providerMessageId:\s*resultadoDiscord\.messageId/);
assert.match(discord, /resultadoDiscord\?\.checkpointClassificacao === "falha_confirmada"/);
assert.match(discord, /\[FILA-DISCORD-CHECKPOINT\]/);
assert.match(discord, /registrarCreditoCheckpoint\(checkpointDiscord\)/);

const telegram = trecho('// ================= ENVIO TELEGRAM', '  } catch (e) {');
assert.match(telegram, /canal:\s*"telegram"/);
assert.match(telegram, /providerMessageId:\s*resposta\?\.data\?\.result\?\.message_id/);
assert.match(telegram, /permitirNovaTentativaAposFalhaConfirmada:\s*true/);
assert.match(telegram, /if \(!checkpointEnvioTelegram\?\.ok\) throw erroCheckpoint/);
assert.match(telegram, /registrarCreditoCheckpoint\(checkpointEnvioTelegram\)/);

console.log("fila-checkpoint-entrega-integracao.test.js OK");
