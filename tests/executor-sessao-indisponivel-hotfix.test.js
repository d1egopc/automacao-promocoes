"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "..", "index.js");
const fonte = fs.readFileSync(indexPath, "utf8");

function trechoEntre(inicio, fim) {
  const a = fonte.indexOf(inicio);
  const b = fonte.indexOf(fim, a + inicio.length);
  assert(a >= 0, `inicio nao encontrado: ${inicio}`);
  assert(b > a, `fim nao encontrado apos ${inicio}: ${fim}`);
  return fonte.slice(a, b);
}

function pos(texto, busca) {
  const indice = texto.indexOf(busca);
  assert(indice >= 0, `trecho nao encontrado: ${busca}`);
  return indice;
}

const puloRapido = trechoEntre(
  "function avaliarPuloRapidoClienteFila",
  "async function rodarProcessadorFilaGlobal"
);
assert(
  pos(puloRapido, "workspaceEmCooldownSessaoIndisponivel(clienteId)") <
    pos(puloRapido, "fila.filter(item =>"),
  "cooldown deve impedir leitura/varredura da fila antes do filtro pesado"
);
assert(
  pos(puloRapido, "diagnosticarDisponibilidadeEnvioWorkspace(clienteId") <
    pos(puloRapido, "fila.filter(item =>"),
  "disponibilidade da sessao deve ser checada antes da varredura de pendentes"
);

const processarFila = trechoEntre(
  "async function processarFila",
  "const {"
);
assert(
  pos(processarFila, "workspaceEmCooldownSessaoIndisponivel(clienteFila)") <
    pos(processarFila, "sanearExpiradosFila(clienteFila)"),
  "processarFila deve respeitar cooldown antes de saneamento ou selecao"
);
assert(
  pos(processarFila, "diagnosticarDisponibilidadeEnvioWorkspace(clienteFila") <
    pos(processarFila, "sanearExpiradosFila(clienteFila)"),
  "processarFila deve checar sessao antes do processamento pesado"
);
assert(
  pos(processarFila, "const disponibilidadeAntesReserva = diagnosticarDisponibilidadeEnvioWorkspace") <
    pos(processarFila, "const reservaProcessamento = filaOfertas.reservarOfertaProcessandoFila"),
  "executor deve checar sessao antes de reservar item como processando"
);

const guardaAntesReserva = trechoEntre(
  "const disponibilidadeAntesReserva = diagnosticarDisponibilidadeEnvioWorkspace",
  "const reservaProcessamento = filaOfertas.reservarOfertaProcessandoFila"
);
assert(
  !guardaAntesReserva.includes("salvarFila("),
  "guarda de sessao indisponivel nao pode salvar ou regravar fila"
);
assert(
  !guardaAntesReserva.includes("JSON.stringify(fila") &&
    !guardaAntesReserva.includes("writeClienteJson") &&
    !guardaAntesReserva.includes(".tmp") &&
    !guardaAntesReserva.includes(".bak"),
  "retorno antecipado nao pode serializar, gravar, criar tmp ou backup"
);
assert(
  guardaAntesReserva.includes("[EXECUTOR-WORKSPACE-PAUSADO-SESSAO-INDISPONIVEL]") ||
    fonte.includes("[EXECUTOR-WORKSPACE-PAUSADO-SESSAO-INDISPONIVEL]"),
  "hotfix deve possuir log agregado de workspace pausado"
);

const helpers = trechoEntre(
  "const COOLDOWN_WORKSPACE_SESSAO_INDISPONIVEL_MS",
  "function logEnvioDestinoDebug"
);
assert(
  helpers.includes("const telegramDisponivel = destinosTelegram.some") &&
    helpers.includes("sessaoTelegramAptaEnvio(clienteId, destino)"),
  "Telegram deve ter aptidao propria, separada da sessao WhatsApp"
);
assert(
  helpers.includes("Boolean(sessaoWhatsappDisponivel || telegramDisponivel || destinosOutros.length)"),
  "workspace misto nao pode ser bloqueado por WhatsApp indisponivel se Telegram estiver apto"
);
assert(
  helpers.includes("proximaVerificacaoMs") &&
    !helpers.includes("setTimeout(") &&
    !helpers.includes("setInterval("),
  "cooldown deve ser por timestamp em Map, sem timers por workspace"
);
assert(
  helpers.includes("cooldownSessaoIndisponivelPorWorkspace.delete(chave)"),
  "cooldown deve ser removido quando expira ou quando a sessao volta"
);

assert(
  processarFila.includes("let filaAlterada = false"),
  "processarFila deve possuir indicador local filaAlterada"
);
assert(
  processarFila.includes("salvarFilaSeAlterada"),
  "processarFila deve salvar apenas quando houver alteracao real"
);
assert(
  pos(processarFila, "marcarFilaAlterada();") <
    pos(processarFila, "salvarFilaSeAlterada(clienteId);"),
  "salvamento operacional deve depender de marcacao previa de alteracao real"
);
assert(
  pos(processarFila, "diagnosticarDisponibilidadeEnvioWorkspace(clienteFila") <
    pos(processarFila, "selecionarProximaOfertaFila(clienteFila)"),
  "sessao indisponivel deve retornar antes da selecao pesada da oferta"
);

console.log("executor-sessao-indisponivel-hotfix.test.js OK");
