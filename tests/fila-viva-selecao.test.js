"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const {
  calcularScoreFilaViva,
  laneFrescorFilaViva,
  ordenarOfertasFilaViva
} = require("../modules/executor/fila-viva.service");

const agora = Date.parse("2026-08-19T15:00:00.000Z");

function minutosAtras(minutos) {
  return new Date(agora - minutos * 60 * 1000).toISOString();
}

function oferta(id, minutos, overrides = {}) {
  return {
    id,
    status: "pendente",
    dataEntradaFila: minutosAtras(minutos),
    prioridadeEnvio: 40,
    score: 60,
    marketplace: "mercadolivre",
    categoria: "eletronicos",
    ...overrides
  };
}

{
  const antigas = Array.from({ length: 30 }, (_, indice) =>
    oferta(`antiga_${indice}`, 24 + indice * 0.1, { score: 100, prioridadeEnvio: 90 })
  );
  const novas = Array.from({ length: 10 }, (_, indice) =>
    oferta(`nova_${indice}`, 1 + indice * 0.1, { score: 55, prioridadeEnvio: 40 })
  );

  const ordenadas = ordenarOfertasFilaViva(
    [...antigas, ...novas].map(item => ({
      oferta: item,
      ranking: calcularScoreFilaViva(item, {
        agora,
        destinosCompativeis: 1,
        destinosDisponiveis: 1
      })
    })),
    { agora }
  );

  assert(
    ordenadas.slice(0, 10).every(item => String(item.oferta.id).startsWith("nova_")),
    "agua nova deve furar estoque antigo ainda pendente na fila"
  );
}

{
  const comum = oferta("comum", 2, { prioridadeEnvio: 40, score: 85 });
  const prioridade = oferta("prioridade_100", 2, { prioridadeEnvio: 100, score: 85 });

  const [primeira] = ordenarOfertasFilaViva([
    {
      oferta: comum,
      ranking: calcularScoreFilaViva(comum, { agora, destinosCompativeis: 1, destinosDisponiveis: 1 })
    },
    {
      oferta: prioridade,
      ranking: calcularScoreFilaViva(prioridade, { agora, destinosCompativeis: 1, destinosDisponiveis: 1 })
    }
  ], { agora });

  assert.strictEqual(
    primeira.oferta.id,
    "prioridade_100",
    "prioridade comercial deve vencer comum dentro da mesma agua fresca"
  );
}

{
  const cupomRadar = oferta("cupom_radar", 3, {
    cupom: "TUDOAMAZON",
    cupomTipo: "real",
    prioridadeEnvio: 80
  });
  const comum = oferta("comum_fresco", 3, { prioridadeEnvio: 80 });

  const [primeira] = ordenarOfertasFilaViva([
    {
      oferta: comum,
      ranking: calcularScoreFilaViva(comum, { agora, destinosCompativeis: 1, destinosDisponiveis: 1 })
    },
    {
      oferta: cupomRadar,
      ranking: calcularScoreFilaViva(cupomRadar, { agora, destinosCompativeis: 1, destinosDisponiveis: 1 })
    }
  ], { agora });

  assert.strictEqual(
    primeira.oferta.id,
    "cupom_radar",
    "cupom comercial deve ganhar peso sem alterar valor do cupom"
  );
}

{
  assert.strictEqual(laneFrescorFilaViva(31 * 60 * 1000), "expirada");
  assert.strictEqual(laneFrescorFilaViva(2 * 60 * 1000), "agua_nova");
  assert.strictEqual(laneFrescorFilaViva(25 * 60 * 1000), "fresca_em_risco");
}

{
  const variosWorkspaces = [5, 20, 100].map(total => {
    return Array.from({ length: total }, (_, indice) => {
      const item = oferta(`ws_${indice}_nova`, 1, {
        clienteId: `workspace_${indice}`,
        prioridadeEnvio: indice % 2 === 0 ? 100 : 40
      });
      return calcularScoreFilaViva(item, {
        agora,
        destinosCompativeis: 2,
        destinosDisponiveis: 1
      });
    });
  });

  assert(
    variosWorkspaces.every(resultados => resultados.every(r => r.destinosDisponiveis === 1 && r.lane === "agua_nova")),
    "ranking deve ser calculado por oferta/workspace sem estado global compartilhado"
  );
}

{
  const indexPath = path.join(__dirname, "..", "index.js");
  const fonteIndex = fs.readFileSync(indexPath, "utf8");
  const inicioCore = fonteIndex.indexOf("function selecionarProximaOfertaFilaCore");
  const fimCore = fonteIndex.indexOf("function selecionarProximaOfertaFila(", inicioCore);
  const inicioWrapper = fonteIndex.indexOf("function selecionarProximaOfertaFila");
  const fimWrapper = fonteIndex.indexOf("function aplicarDiversidadeFila", inicioWrapper);
  assert(inicioCore >= 0 && fimCore > inicioCore, "trecho selecionarProximaOfertaFilaCore deve existir");
  assert(inicioWrapper >= 0 && fimWrapper > inicioWrapper, "trecho selecionarProximaOfertaFila deve existir");
  const trechoCore = fonteIndex.slice(inicioCore, fimCore);
  const trechoWrapper = fonteIndex.slice(inicioWrapper, fimWrapper);

  assert(trechoCore.includes("avaliarOfertaParaSelecaoFilaViva"), "executor deve avaliar destinos liberados antes de escolher oferta");
  assert(trechoCore.includes("ordenarOfertasFilaViva"), "executor deve usar ranking vivo em vez de FIFO puro");
  assert(trechoWrapper.includes("selecionarProximaOfertaFilaCore"), "wrapper oficial deve delegar ao core read-only");
  assert(trechoWrapper.includes("compararSelecao"), "wrapper oficial deve registrar dual-read de selecao");
  assert(
    !trechoCore.includes("proximaTentativaEnvioEm) && proxima > Date.now()) return false"),
    "projecao historica nao deve bloquear selecao viva"
  );
}

{
  const indexPath = path.join(__dirname, "..", "index.js");
  const fonteIndex = fs.readFileSync(indexPath, "utf8");
  const inicioDestinoSeguro = fonteIndex.indexOf("function destinoOperacionalValido");
  const fimDestinoSeguro = fonteIndex.indexOf("function dataIsoIntervalo", inicioDestinoSeguro);
  const inicioChaveControle = fonteIndex.indexOf("function destinoChaveControle");
  const fimChaveControle = fonteIndex.indexOf("function limiteDiarioDestino", inicioChaveControle);

  assert(inicioDestinoSeguro >= 0 && fimDestinoSeguro > inicioDestinoSeguro, "helpers seguros de destino devem existir");
  assert(inicioChaveControle >= 0 && fimChaveControle > inicioChaveControle, "destinoChaveControle deve existir");

  const sandbox = {};
  vm.runInNewContext(`
    ${fonteIndex.slice(inicioDestinoSeguro, fimDestinoSeguro)}
    ${fonteIndex.slice(inicioChaveControle, fimChaveControle)}
    resultado = {
      destinoIdIntervalo,
      canalDestinoIntervalo,
      destinoChaveControle
    };
  `, sandbox);

  assert.doesNotThrow(
    () => sandbox.resultado.destinoChaveControle("user_40qdblgt", null),
    "destino null nao deve quebrar selecao ao montar chave de intervalo"
  );
  assert.strictEqual(
    sandbox.resultado.destinoChaveControle("user_40qdblgt", null),
    "user_40qdblgt_destino",
    "destino null usa chave neutra sem promover destino invalido"
  );
  assert.strictEqual(
    sandbox.resultado.destinoIdIntervalo(null),
    "destino",
    "destino null usa id neutro nos diagnosticos"
  );
  assert.strictEqual(
    sandbox.resultado.canalDestinoIntervalo(null),
    "",
    "destino null nao inventa canal"
  );
  assert.strictEqual(
    sandbox.resultado.destinoChaveControle("cliente", { id: "destino_1", nome: "Grupo A" }),
    "cliente_destino_1",
    "destino valido preserva chave por id"
  );
}

{
  const indexPath = path.join(__dirname, "..", "index.js");
  const fonteIndex = fs.readFileSync(indexPath, "utf8");
  const inicioAvaliacao = fonteIndex.indexOf("function avaliarOfertaParaSelecaoFilaViva");
  const fimAvaliacao = fonteIndex.indexOf("function selecionarProximaOfertaFilaCore", inicioAvaliacao);
  assert(inicioAvaliacao >= 0 && fimAvaliacao > inicioAvaliacao, "avaliacao de selecao viva deve existir");

  const trechoAvaliacao = fonteIndex.slice(inicioAvaliacao, fimAvaliacao);
  const posGuardaDestino = trechoAvaliacao.indexOf("!destinoOperacionalValido(destino)");
  const posFanout = trechoAvaliacao.indexOf("destinoJaEnviadoFanout(oferta, destino)");
  const posIntervalo = trechoAvaliacao.indexOf("intervaloDestinoInfo(clienteIdOferta, destino");

  assert(posGuardaDestino >= 0, "destino invalido deve ser bloqueado antes da avaliacao operacional");
  assert(posFanout > posGuardaDestino, "fanout so deve avaliar destino valido");
  assert(posIntervalo > posGuardaDestino, "intervalo so deve avaliar destino valido");
  assert(
    trechoAvaliacao.includes('motivoBloqueio = motivoBloqueio || "destino_invalido"'),
    "destino invalido deve registrar motivo sem selecionar/remover/duplicar oferta"
  );
}
