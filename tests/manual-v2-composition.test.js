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

const trechoManualV2 = trechoEntre(
  "// =============== ROTAS MANUAL V2 =================",
  "// =============== ROTA ADMIN DO STORAGE MANAGER ================="
);

const dependenciasObrigatorias = [
  "getClienteId",
  "importOptions",
  "getIntegracaoCliente",
  "importarAmazon: importarAmazonManualV2ComWorkspace",
  "importarShopee: importarShopeeManualV2ComWorkspace",
  "gerarLinkAfiliadoMercadoLivre: gerarLinkAfiliadoMercadoLivreManualV2",
  "gerarDeepLinkAwin: gerarDeepLinkAwinManualV2",
  "gerarLinkCurtoAliExpress: gerarLinkCurtoAliExpressManualV2",
  "gerarLinkOptimus: gerarLinkOptimusManualV2",
  "resolverLinkOfertaPorDestino",
  "obterProgramaAwin: obterProgramaAwinManualV2",
  "registrarSucessoIntegracao: registrarSucessoIntegracaoManualV2",
  "registrarAlertaIntegracao: registrarAlertaIntegracaoManualV2"
];

for (const termo of dependenciasObrigatorias) {
  assert.ok(
    trechoManualV2.includes(termo),
    `Composicao real Manual V2 deve injetar ${termo}`
  );
}

const wrappersObrigatorios = [
  "function importarAmazonManualV2ComWorkspace",
  "function importarShopeeManualV2ComWorkspace",
  "function gerarLinkAfiliadoMercadoLivreManualV2",
  "function gerarDeepLinkAwinManualV2",
  "function gerarLinkCurtoAliExpressManualV2",
  "function gerarLinkOptimusManualV2",
  "function obterProgramaAwinManualV2",
  "function registrarSucessoIntegracaoManualV2",
  "function registrarAlertaIntegracaoManualV2"
];

for (const termo of wrappersObrigatorios) {
  assert.ok(trechoManualV2.includes(termo), `Wrapper preguicoso ausente: ${termo}`);
}

const proibidosRioAutomatico = [
  "utils/fila-ofertas",
  "processarFila",
  "prepararOfertaGlobal",
  "adicionarOfertaInicioFila",
  "adicionarOfertaNaFila",
  "Distributor",
  "Engine",
  "Oferta Universal",
  "oferta-universal",
  "inteligencia-universal",
  "memoria-ofertas",
  "radar-ofertas",
  "/fila",
  "/enviar-manual",
  "/kabum/importar"
];

for (const termo of proibidosRioAutomatico) {
  assert.ok(
    !trechoManualV2.includes(termo),
    `Composicao Manual V2 nao pode receber dependencia do rio automatico: ${termo}`
  );
}

console.log("manual-v2-composition.test.js ok");
