const assert = require("assert");
const fs = require("fs");
const path = require("path");

const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function trechoEntre(inicio, fim) {
  const start = fonteIndex.indexOf(inicio);
  assert.ok(start >= 0, `Nao encontrou marcador inicial: ${inicio}`);
  const end = fonteIndex.indexOf(fim, start);
  assert.ok(end > start, `Nao encontrou marcador final: ${fim}`);
  return fonteIndex.slice(start, end);
}

const importsManualV2 = trechoEntre(
  'const criarRotasManualV2 = require("./modules/manual-v2/manual-offers.routes");',
  'const {'
);

assert.ok(
  fonteIndex.includes('} = require("./modules/manual-v2/manual-retention.runner");'),
  "index.js deve importar o runner de retencao Manual V2"
);
assert.ok(
  fonteIndex.includes('} = require("./modules/manual-v2/manual-retention");'),
  "index.js deve importar a politica de retencao Manual V2"
);
assert.ok(
  importsManualV2.includes('manual-offers.routes'),
  "marcador de imports Manual V2 deve permanecer localizavel"
);

const bootRetention = trechoEntre(
  "function iniciarManualV2RetentionOperacional()",
  'app.use("/manual-v2"'
);

const obrigatorios = [
  "iniciarManualV2Retention({",
  "listClientes",
  "limparRetencaoManualV2Cliente",
  "retentionDays: process.env.MANUAL_V2_RETENTION_DAYS",
  "intervalMs: process.env.MANUAL_V2_RETENTION_INTERVAL_MS",
  "logger: console",
  "[MANUAL-V2-RETENTION] inicializacao"
];

for (const termo of obrigatorios) {
  assert.ok(bootRetention.includes(termo), `Boot retention deve conter ${termo}`);
}

const proibidos = [
  "destinosPorCliente",
  "configsPorCliente",
  "sessoes",
  "statusSessao",
  "usuarioTemCreditos",
  "debitarCreditos",
  "montarMensagemOferta",
  "enviarWhatsApp",
  "enviarTelegram",
  "enviarOfertaManualV2",
  "enviarOfertaManualV2Dispatcher",
  "iniciarManualV2Scheduler",
  "processarFila",
  "prepararOfertaGlobal",
  "adicionarOfertaInicioFila",
  "Distributor",
  "Oferta Universal",
  "oferta-universal",
  "Engine",
  "Radar",
  "radar-ofertas",
  "fila.json",
  "/fila",
  "/enviar-manual"
];

for (const termo of proibidos) {
  assert.ok(!bootRetention.includes(termo), `Boot retention nao pode receber ${termo}`);
}

const appListen = trechoEntre(
  "app.listen(PORT, () => {",
  "decairConfiancaCupons();"
);

assert.ok(appListen.includes("iniciarManualV2SchedulerOperacional();"), "scheduler de envio Manual V2 continua no boot");
assert.ok(appListen.includes("iniciarManualV2RetentionOperacional();"), "retention Manual V2 entra no boot");
assert.notStrictEqual(
  appListen.indexOf("iniciarManualV2SchedulerOperacional();"),
  appListen.indexOf("iniciarManualV2RetentionOperacional();"),
  "scheduler de envio e retention usam chamadas separadas"
);

console.log("manual-v2-retention-composition.test.js ok");
