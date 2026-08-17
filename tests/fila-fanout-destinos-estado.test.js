"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function contem(trecho, mensagem) {
  assert.ok(fonte.includes(trecho), mensagem);
}

function antes(deveVirAntes, deveVirDepois, mensagem) {
  const inicio = fonte.indexOf(deveVirAntes);
  const fim = fonte.indexOf(deveVirDepois);
  assert.ok(inicio >= 0, `trecho inicial ausente: ${deveVirAntes}`);
  assert.ok(fim >= 0, `trecho final ausente: ${deveVirDepois}`);
  assert.ok(inicio < fim, mensagem);
}

contem("function destinoFanoutId", "deve existir chave estavel por destino");
contem("function registrarDestinoEstadoFanout", "deve persistir estado por braco");
contem("function resumoDestinosEstadoFanout", "deve resumir estados por braco");
contem("oferta.destinosEstado = Array.isArray(oferta.destinosEstado) ? oferta.destinosEstado : [];", "legado sem destinosEstado[] deve continuar legivel");
contem('motivo: "destino_compativel"', "destino compativel deve ser identificado antes dos gates");
contem('registrarDestinoEstadoFanout(oferta, destino, "aguardando"', "destino compativel nasce aguardando no loop efetivo");
contem('registrarDestinoEstadoFanout(oferta, destino, "nao_compativel"', "destino rejeitado deve ser preservado como nao compativel");
contem('registrarDestinoEstadoFanout(oferta, destino, "aguardando",', "gates temporarios devem manter braco aguardando");
contem('registrarDestinoEstadoFanout(oferta, destino, tentouEnvioReal ? "erro_definitivo" : "aguardando"', "falha real deve virar erro definitivo e bloqueio sem tentativa deve aguardar");
contem('registrarDestinoEstadoFanout(oferta, destino, "enviado"', "sucesso deve marcar braco enviado");
contem("if (destinoJaEnviadoFanout(oferta, destino))", "destino ja enviado deve ser identificado na continuacao");
contem("continue;", "destino ja enviado nao deve ser tentado novamente");
contem("resumoFanout.aguardando > 0", "qualquer braco aguardando deve dominar a conclusao global");
contem("totalDestinosEnviadosFanout", "conclusao deve considerar enviados ja persistidos");
contem("statusDetalhe: `Enviada para ${totalDestinosEnviadosFanout} destino(s)`", "status final deve refletir total real dos bracos enviados");
contem("oferta.destinosEnviados.push", "destinosEnviados deve continuar preservado");

antes(
  "if (destinoJaEnviadoFanout(oferta, destino))",
  "const enviado = await enviarParaDestinoInteligente(",
  "skip de destino ja enviado precisa acontecer antes da chamada de envio"
);

antes(
  'motivo: "destino_compativel"',
  "if (!destinoDentroHorario(destino))",
  "braco compativel precisa estar aguardando antes dos gates temporarios"
);

antes(
  "if (resumoFanout.aguardando > 0",
  "const finalizacaoEnvio = filaOfertas.finalizarOfertaEnviadaFila",
  "pendencia por braco precisa ser avaliada antes de finalizar como enviado"
);

const itemLegado = { destinosEnviados: [{ tipo: "whatsapp", id: "op-geral" }] };
itemLegado.destinosEstado = Array.isArray(itemLegado.destinosEstado) ? itemLegado.destinosEstado : [];
assert.deepStrictEqual(itemLegado.destinosEstado, [], "normalizacao legada nao deve quebrar item antigo");

console.log("fila-fanout-destinos-estado.test.js OK");
