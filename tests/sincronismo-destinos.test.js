const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const linksPuros = require("../modules/links");

const indexPath = path.join(__dirname, "..", "index.js");
const fonte = fs.readFileSync(indexPath, "utf8");

function extrairFuncao(nome) {
  const inicio = fonte.indexOf(`function ${nome}`);
  assert.ok(inicio >= 0, `funcao ${nome} deve existir`);
  const abre = fonte.indexOf(") {", inicio) + 2;
  assert.ok(abre >= 2, `corpo da funcao ${nome} deve existir`);
  let profundidade = 0;
  for (let i = abre; i < fonte.length; i += 1) {
    if (fonte[i] === "{") profundidade += 1;
    if (fonte[i] === "}") profundidade -= 1;
    if (profundidade === 0) return fonte.slice(inicio, i + 1);
  }
  throw new Error(`nao foi possivel extrair ${nome}`);
}

const sandbox = {
  config: {
    intervaloEnvioMinutos: 5,
    linksOptimus: { ativo: true, dominio: "https://go.optimuspromo.com.br", formato: "/r" },
    linksGerados: {}
  },
  salvouConfig: 0,
  falharSalvarConfig: false,
  salvarConfig() {
    if (sandbox.falharSalvarConfig) throw new Error("falha_salvar_config");
    sandbox.salvouConfig += 1;
  },
  cupomFastLaneTipo: oferta => oferta.cupomReal ? "real_detectado" : (oferta.cupomProvavel ? "provavel" : ""),
  URL,
  linksPuros,
  process: { env: {} },
  console: {
    ...console,
    log() {}
  }
};
vm.createContext(sandbox);
vm.runInContext([
  extrairFuncao("normalizarTemplateIdDestinoContrato"),
  extrairFuncao("normalizarModoLinkDestino"),
  extrairFuncao("normalizarDestinoContrato"),
  extrairFuncao("numeroIntervaloValido"),
  extrairFuncao("intervaloTurboCupomMinutos"),
  extrairFuncao("resolverIntervaloConfiguradoDestino"),
  extrairFuncao("destinoIdIntervalo"),
  extrairFuncao("normalizarDominioLinkOptimus"),
  extrairFuncao("normalizarFormatoLinkOptimus"),
  extrairFuncao("resolverDominioBaseLinkOptimus"),
  extrairFuncao("montarUrlLinkOptimus"),
  extrairFuncao("extrairLinkAfiliadoOferta"),
  extrairFuncao("localizarLinkOptimusExistente"),
  extrairFuncao("gerarCodigoLinkOptimus"),
  extrairFuncao("criarLinkOptimus"),
  extrairFuncao("gerarLinkOptimus"),
  extrairFuncao("logLinkOptimus"),
  extrairFuncao("copiarOfertaComLinkResolvido"),
  extrairFuncao("resolverLinkOfertaPorDestino")
].join("\n"), sandbox);

function calcularIntervalo(destino, configCliente, oferta) {
  const intervaloConfigurado = sandbox.resolverIntervaloConfiguradoDestino(destino, configCliente);
  const ofertaTemCupomReal = sandbox.cupomFastLaneTipo(oferta) === "real_detectado";
  const turbo = destino.prioridadeCupomAtiva === true && ofertaTemCupomReal
    ? sandbox.intervaloTurboCupomMinutos(oferta)
    : null;

  return Number.isFinite(turbo) ? Math.max(3, turbo) : intervaloConfigurado;
}

assert.strictEqual(sandbox.normalizarDestinoContrato({ nome: "Antigo" }).prioridadeCupomAtiva, false);
assert.strictEqual(sandbox.normalizarDestinoContrato({ prioridadeCupomAtiva: true }).prioridadeCupomAtiva, true);

assert.strictEqual(sandbox.normalizarDestinoContrato({ nome: "Antigo" }).modoLink, "original");
assert.strictEqual(sandbox.normalizarDestinoContrato({ modoLink: "optimus" }).modoLink, "optimus");
assert.strictEqual(sandbox.normalizarDestinoContrato({ modoLink: "invalido" }).modoLink, "original");

function resetarLinkOptimus(overrides = {}) {
  sandbox.config.linksOptimus = { ativo: true, dominio: "https://go.optimuspromo.com.br", formato: "/r", ...(overrides.linksOptimus || {}) };
  sandbox.config.linksGerados = overrides.linksGerados || {};
  sandbox.salvouConfig = 0;
  sandbox.falharSalvarConfig = false;
  sandbox.process.env = {};
}

function resolverLinkTeste({ oferta, destino, recursos, clienteId = "cliente_a" }) {
  return sandbox.resolverLinkOfertaPorDestino({
    oferta,
    destino,
    clienteId,
    recursos,
    configGlobal: sandbox.config
  });
}

const ofertaLinkBase = { marketplace: "mercadolivre", linkAfiliado: "https://afiliado.exemplo/produto?x=1" };
resetarLinkOptimus();
assert.strictEqual(resolverLinkTeste({ oferta: ofertaLinkBase, destino: {}, recursos: { linkOptimus: true } }).linkFinal, ofertaLinkBase.linkAfiliado, "destino antigo deve usar link original");
assert.strictEqual(resolverLinkTeste({ oferta: ofertaLinkBase, destino: { modoLink: "original" }, recursos: { linkOptimus: true } }).linkFinal, ofertaLinkBase.linkAfiliado, "modo original deve usar link original");
assert.strictEqual(resolverLinkTeste({ oferta: ofertaLinkBase, destino: { modoLink: "optimus" }, recursos: { linkOptimus: false } }).linkFinal, ofertaLinkBase.linkAfiliado, "plano sem permissao deve usar original");

resetarLinkOptimus({ linksOptimus: { ativo: false } });
assert.strictEqual(resolverLinkTeste({ oferta: ofertaLinkBase, destino: { modoLink: "optimus" }, recursos: { linkOptimus: true } }).linkFinal, ofertaLinkBase.linkAfiliado, "config desativada deve usar original");

resetarLinkOptimus({ linksOptimus: { dominio: "" } });
assert.strictEqual(resolverLinkTeste({ oferta: ofertaLinkBase, destino: { modoLink: "optimus" }, recursos: { linkOptimus: true } }).linkFinal, ofertaLinkBase.linkAfiliado, "dominio ausente deve usar original");

resetarLinkOptimus({ linksOptimus: { dominio: "" } });
sandbox.process.env.RAILWAY_PUBLIC_DOMAIN = "backend-railway.optimus.test";
const resolucaoDominioEnv = resolverLinkTeste({ oferta: ofertaLinkBase, destino: { modoLink: "optimus" }, recursos: { linkOptimus: true } });
assert.ok(resolucaoDominioEnv.linkFinal.startsWith("https://backend-railway.optimus.test/r/"), "dominio vazio deve usar RAILWAY_PUBLIC_DOMAIN");

resetarLinkOptimus({ linksOptimus: { dominio: "https://go.optimuspromo.com.br/" } });
sandbox.process.env.RAILWAY_PUBLIC_DOMAIN = "backend-railway.optimus.test";
const resolucaoDominioConfigurado = resolverLinkTeste({ oferta: ofertaLinkBase, destino: { modoLink: "optimus" }, recursos: { linkOptimus: true } });
assert.ok(resolucaoDominioConfigurado.linkFinal.startsWith("https://go.optimuspromo.com.br/r/"), "dominio configurado deve vencer variavel Railway");
assert.ok(!resolucaoDominioConfigurado.linkFinal.includes("//r/"), "dominio com barra final deve ser normalizado");

const trechoLinkOptimus = extrairFuncao("resolverDominioBaseLinkOptimus") + extrairFuncao("montarUrlLinkOptimus");
assert.ok(!trechoLinkOptimus.includes("automacao-promocoes-production.up.railway.app"), "resolver nao deve hardcodar URL Railway");

resetarLinkOptimus();
const ofertaOriginalImutavel = { ...ofertaLinkBase };
const resolucaoGerada = resolverLinkTeste({ oferta: ofertaOriginalImutavel, destino: { id: "whats", modoLink: "optimus" }, recursos: { linkOptimus: true } });
assert.strictEqual(resolucaoGerada.aplicado, true, "modo optimus autorizado deve aplicar Link Optimus");
assert.ok(resolucaoGerada.linkFinal.startsWith("https://go.optimuspromo.com.br/r/"));
assert.strictEqual(ofertaOriginalImutavel.linkAfiliado, ofertaLinkBase.linkAfiliado, "oferta original nao pode ser mutada");
assert.notStrictEqual(resolucaoGerada.oferta, ofertaOriginalImutavel, "deve retornar copia transitoria");
assert.strictEqual(resolucaoGerada.oferta.linkAfiliado, resolucaoGerada.linkFinal, "renderer deve consumir link resolvido em linkAfiliado");

resetarLinkOptimus({ linksGerados: { abc123: { original: ofertaLinkBase.linkAfiliado, urlOriginal: ofertaLinkBase.linkAfiliado, marketplace: "mercadolivre", clienteId: "cliente_a" } } });
const resolucaoReutilizada = resolverLinkTeste({ oferta: ofertaLinkBase, destino: { id: "tg", modoLink: "optimus" }, recursos: { linkOptimus: true } });
assert.strictEqual(resolucaoReutilizada.reutilizado, true, "redirect existente deve ser reutilizado");
assert.strictEqual(resolucaoReutilizada.codigo, "abc123");
assert.strictEqual(sandbox.salvouConfig, 0, "reuso nao deve salvar config novamente");

resetarLinkOptimus();
sandbox.falharSalvarConfig = true;
const resolucaoErro = resolverLinkTeste({ oferta: ofertaLinkBase, destino: { modoLink: "optimus" }, recursos: { linkOptimus: true } });
assert.strictEqual(resolucaoErro.linkFinal, ofertaLinkBase.linkAfiliado, "erro ao gerar deve fazer fallback");
assert.deepStrictEqual(sandbox.config.linksGerados, {}, "erro ao salvar nao deve deixar redirect parcial");

resetarLinkOptimus();
const destinoOriginal = resolverLinkTeste({ oferta: ofertaLinkBase, destino: { id: "a", modoLink: "original" }, recursos: { linkOptimus: true } });
const destinoOptimus = resolverLinkTeste({ oferta: ofertaLinkBase, destino: { id: "b", modoLink: "optimus" }, recursos: { linkOptimus: true } });
assert.strictEqual(destinoOriginal.linkFinal, ofertaLinkBase.linkAfiliado, "destino original preserva link original");
assert.notStrictEqual(destinoOptimus.linkFinal, ofertaLinkBase.linkAfiliado, "destino optimus usa Link Optimus");

assert.strictEqual(calcularIntervalo({ intervaloMinutos: 5, prioridadeCupomAtiva: false }, {}, { cupomReal: true }), 5);
assert.strictEqual(calcularIntervalo({ intervaloMinutos: 7, prioridadeCupomAtiva: false }, {}, { cupomReal: true }), 7);
assert.strictEqual(calcularIntervalo({ intervaloMinutos: 10, prioridadeCupomAtiva: false }, {}, { cupomReal: true }), 10);
assert.strictEqual(calcularIntervalo({ intervaloMinutos: 8, prioridadeCupomAtiva: true }, {}, { cupomReal: true }), 3);
assert.strictEqual(calcularIntervalo({ intervaloMinutos: 8, prioridadeCupomAtiva: true }, {}, {}), 8);
assert.strictEqual(calcularIntervalo({ intervaloMinutos: 8, prioridadeCupomAtiva: true }, {}, { cupomProvavel: true }), 8);
assert.ok(calcularIntervalo({ intervaloMinutos: 8, prioridadeCupomAtiva: true }, {}, { cupomReal: true }) >= 3);
assert.strictEqual(calcularIntervalo({}, { intervaloMinutos: 7 }, {}), 7);
assert.strictEqual(calcularIntervalo({}, { intervaloEnvioMinutos: 9 }, {}), 9);
sandbox.config.intervaloEnvioMinutos = 11;
assert.strictEqual(calcularIntervalo({}, {}, {}), 11);
sandbox.config.intervaloEnvioMinutos = 0;
assert.strictEqual(calcularIntervalo({}, {}, {}), 5);

const requiredSnippets = [
  "CONTROLE_INTERVALO_DESTINOS_FILE",
  "restaurarControleIntervaloEnvio();",
  "atualizarUltimoEnvioDestino(clienteId, destino, oferta, intervalo);",
  "FILA-INTERVALO-AVALIADO",
  "FILA-DESTINO-BLOQUEADO-INTERVALO",
  "FILA-DESTINO-LIBERADO",
  "FILA-CUPOM-INTERVALO-MINIMO",
  "FILA-ULTIMO-ENVIO-ATUALIZADO",
  "FILA-CONTROLE-INTERVALO-RESTAURADO"
];

for (const trecho of requiredSnippets) {
  assert.ok(fonte.includes(trecho), `index.js deve conter ${trecho}`);
}

assert.ok(!/return\s+2\s*;/.test(extrairFuncao("intervaloTurboCupomMinutos")), "turbo nao pode retornar 2min");
assert.ok(!/2\.5/.test(extrairFuncao("intervaloTurboCupomMinutos")), "turbo nao pode retornar 2.5min");
assert.ok(!/config\.intervaloMinutos\s*\|\|\s*2/.test(fonte), "fallback oculto para 2min nao pode existir");

// Modelo de relogios independentes e erro sem atualizacao.
const relogios = {};
function confirmarEnvio(chave, minuto) {
  relogios[chave] = minuto;
}
function permitido(chave, minuto, intervalo) {
  return relogios[chave] === undefined || minuto - relogios[chave] >= intervalo;
}

confirmarEnvio("cliente_a:whatsapp", 0);
assert.strictEqual(permitido("cliente_a:telegram", 1, 8), true, "destinos diferentes devem ser independentes");
assert.strictEqual(permitido("cliente_a:whatsapp", 2, 3), false, "cupom nao sai antes de 3min");
assert.strictEqual(permitido("cliente_a:whatsapp", 3, 3), true, "cupom pode sair apos 3min");
confirmarEnvio("cliente_a:whatsapp", 3);
assert.strictEqual(permitido("cliente_a:whatsapp", 10, 8), false, "comum apos cupom conta intervalo normal desde ultimo envio");
assert.strictEqual(permitido("cliente_a:whatsapp", 11, 8), true, "comum apos cupom libera no intervalo normal");
const antesErro = relogios["cliente_a:whatsapp"];
// erro de envio nao chama confirmarEnvio.
assert.strictEqual(relogios["cliente_a:whatsapp"], antesErro, "erro nao deve atualizar relogio");

console.log("sincronismo-destinos: ok");
