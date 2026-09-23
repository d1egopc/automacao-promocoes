const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { avaliarGateCapturaRadarWhatsapp, avaliarJanela } = require("../modules/radar/whatsapp-capture-gate");

const grupoId = "120363408782037034@g.us";
const base = {
  monitoramentoAtivo: true,
  monitoramentoAtivadoEm: "",
  monitoramento: { horaInicial: "08:35", horaFinal: "23:55" },
  sessoesWhatsappMonitoradas: [{ sessaoId: "sessao_a", gruposMonitorados: [{ grupoId }] }]
};
const agora = new Date("2026-09-22T12:00:00.000Z"); // 09:00 em Sao Paulo

function gate(config = base, extras = {}) {
  return avaliarGateCapturaRadarWhatsapp({
    config,
    sessaoId: "sessao_a",
    grupoId,
    agora,
    ...extras
  });
}

assert.equal(gate({ ...base, monitoramentoAtivo: false }).motivo, "radar_monitoramento_inativo");
assert.equal(gate({ ...base, monitoramentoAtivo: false }, { agora: new Date("2026-09-22T10:00:00Z") }).motivo, "radar_monitoramento_inativo");
assert.equal(gate().ok, true);
assert.equal(gate(base, { agora: new Date("2026-09-22T10:00:00Z") }).motivo, "fora_do_horario_monitoramento");
assert.equal(gate(base, { agora: new Date("2026-09-22T11:35:00Z") }).ok, true); // inicio incluso
assert.equal(gate(base, { agora: new Date("2026-09-23T02:55:59Z") }).ok, true); // fim incluso
assert.equal(gate(base, { agora: new Date("2026-09-23T02:56:00Z") }).motivo, "fora_do_horario_monitoramento");

const meiaNoite = { ...base, monitoramento: { horaInicial: "08:00", horaFinal: "00:50" } };
for (const instante of ["2026-09-22T11:00:00Z", "2026-09-23T02:59:00Z", "2026-09-23T03:00:00Z", "2026-09-23T03:50:00Z"]) {
  assert.equal(gate(meiaNoite, { agora: new Date(instante) }).ok, true, instante);
}
for (const instante of ["2026-09-23T03:51:00Z", "2026-09-23T10:59:00Z"]) {
  assert.equal(gate(meiaNoite, { agora: new Date(instante) }).motivo, "fora_do_horario_monitoramento", instante);
}
assert.equal(avaliarJanela(meiaNoite, new Date("2026-09-23T03:50:00Z")).dentroJanela, true);
assert.equal(gate(base, { sessaoId: "outra_sessao" }).motivo, "sessao_whatsapp_nao_monitorada");
assert.equal(gate(base, { grupoId: "outro@g.us" }).motivo, "grupo_whatsapp_nao_monitorado");

const evento = { exigirMensagemNova: true, upsertType: "notify", bootAtMs: Date.parse("2026-09-22T08:00:00Z") };
assert.equal(gate(base, { ...evento, mensagemTimestamp: Date.parse("2026-09-22T11:59:00Z") / 1000 }).ok, true);
assert.equal(gate(base, { ...evento, upsertType: "append", mensagemTimestamp: Date.parse("2026-09-22T11:59:00Z") / 1000 }).motivo, "whatsapp_upsert_historico");
assert.equal(gate(base, { ...evento }).motivo, "whatsapp_timestamp_ausente");
assert.equal(gate(base, { ...evento, bootAtMs: Date.parse("2026-09-22T12:00:00Z"), mensagemTimestamp: Date.parse("2026-09-22T11:59:00Z") / 1000 }).motivo, "whatsapp_mensagem_anterior_ativacao");
assert.equal(gate({ ...base, monitoramentoAtivadoEm: "2026-09-22T11:58:00Z" }, { ...evento, mensagemTimestamp: Date.parse("2026-09-22T11:57:00Z") / 1000 }).motivo, "whatsapp_mensagem_anterior_ativacao");
assert.equal(gate({ ...base, monitoramentoAtivadoEm: "2026-09-22T11:58:00Z" }, { ...evento, mensagemTimestamp: Date.parse("2026-09-22T11:59:00Z") / 1000 }).ok, true);
assert.equal(gate(meiaNoite, { ...evento, agora: new Date("2026-09-23T03:30:00Z"), mensagemTimestamp: Date.parse("2026-09-22T10:00:00Z") / 1000 }).motivo, "whatsapp_mensagem_anterior_janela");

// Exercita a persistencia real do Radar em memoria isolada e simula novo processo.
const index = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
function trecho(inicio, fim) {
  const a = index.indexOf(inicio);
  const b = index.indexOf(fim, a + inicio.length);
  assert.ok(a >= 0 && b > a, inicio);
  return index.slice(a, b);
}
const funcoesConfig = [
  trecho("function radarConfigPadrao()", "function getRadarConfigFile("),
  trecho("function carregarRadarConfigCliente(", "function obterGrupoWhatsappIdTecnicoRadar("),
  trecho("function numeroRadarConfig(", "function salvarRadarConfigCliente("),
  trecho("function salvarRadarConfigCliente(", "function textoRadarId(")
].join("\n");
let persistido = null;
function processo() {
  const contexto = {
    readClienteJson: (_id, _arquivo, fallback) => persistido === null ? fallback : JSON.parse(JSON.stringify(persistido)),
    writeClienteJson: (_id, _arquivo, dados) => { persistido = JSON.parse(JSON.stringify(dados)); },
    normalizarSessoesWhatsappMonitoradasRadar: () => [],
    achatarGruposWhatsappMonitoradosRadar: () => [],
    mesclarSessoesWhatsappMonitoradasRadar: () => [],
    textoRadarId: valor => String(valor || "").trim(),
    logDebug: () => {},
    console
  };
  return vm.runInNewContext(`${funcoesConfig}\n({ carregarRadarConfigCliente, salvarRadarConfigCliente })`, contexto);
}
let radar = processo();
assert.equal(radar.carregarRadarConfigCliente("admin", { falharFechado: true }).monitoramentoAtivo, false);
radar.salvarRadarConfigCliente("admin", { monitoramentoAtivo: false, monitoramento: { horaInicial: "08:35", horaFinal: "23:55" } });
assert.equal(persistido.monitoramentoAtivo, false);
radar = processo(); // restart
assert.equal(radar.carregarRadarConfigCliente("admin").monitoramentoAtivo, false);
assert.equal(radar.carregarRadarConfigCliente("admin").monitoramento.horaInicial, "08:35");
radar.salvarRadarConfigCliente("admin", { categoriasPermitidas: [] });
assert.equal(persistido.monitoramentoAtivo, false);
radar.salvarRadarConfigCliente("admin", { monitoramentoAtivo: true });
assert.equal(persistido.monitoramentoAtivo, true);
assert.ok(Number.isFinite(Date.parse(persistido.monitoramentoAtivadoEm)));
radar = processo();
assert.equal(radar.carregarRadarConfigCliente("admin").monitoramentoAtivo, true);
assert.equal(radar.carregarRadarConfigCliente("admin").monitoramentoAtivadoEm, persistido.monitoramentoAtivadoEm);

// As duas entradas WhatsApp e a boundary compartilhada avaliam o gate antes do evento Engine.
const auto = trecho("async function processarMensagemRadarAutomatica(", "function normalizarMensagemTelegramRadar(");
const ingresso = trecho("async function processarMensagemRadar({", "registerRadarIngressHandler(processarMensagemRadar);");
assert.ok(auto.indexOf("avaliarCapturaRadarWhatsappAtual(") < auto.indexOf("extrairTextoMensagemRadar(mensagem)"));
assert.ok(ingresso.indexOf("avaliarCapturaRadarWhatsappAtual(") < ingresso.indexOf("registrarEventoBrutoEngineRadar({"));
assert.ok(ingresso.lastIndexOf("avaliarCapturaRadarWhatsappAtual(", ingresso.indexOf("registrarEventoBrutoEngineRadar({")) > ingresso.indexOf("criarRadarMirror({"));
assert.ok(index.includes("upsertType: type"));
assert.ok(index.includes("registerRadarIngressHandler(processarMensagemRadar)")); // TeleRadar conserva boundary
const rotaGrupos = trecho('app.post("/radar/debug/salvar-whatsapp"', 'app.get("/radar/debug/');
assert.ok(rotaGrupos.includes('Object.prototype.hasOwnProperty.call(body, "monitoramentoAtivo")'));
const rotaConfig = trecho('app.get("/radar/config"', 'app.post("/radar/config"');
assert.ok(rotaConfig.includes('carregarRadarConfigCliente(clienteId, { falharFechado: true })'));
console.log("radar-whatsapp-capture-gate.test.js PASS");
