"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classificarLinkEngine } = require("../modules/engine/link-role.service");
const { normalizarMotivoTecnicoRedirect } = require("../modules/radar/redirect/redirect-diagnostic-code");

const fonte = fs.readFileSync(path.join(__dirname, "../modules/engine/inbox.service.js"), "utf8");
const inicio = fonte.indexOf("function listarRedirectsEvento(");
const fim = fonte.indexOf("// Opt-in local candidate.", inicio);
assert.ok(inicio >= 0 && fim > inicio);
const salvarLinksEvento = new Function(
  "normalizarUrl", "normalizarMotivoTecnicoRedirect", "detectarMarketplaceLink",
  "classificarLinkEngine", "dominioUrl", "jsonbParam", "logEngineEventoBrutoErro", "queryEngine",
  `${fonte.slice(inicio, fim)}; return salvarLinksEvento;`
)(
  url => url,
  normalizarMotivoTecnicoRedirect,
  url => { try { return /(^|\.)aliexpress\.com$/i.test(new URL(url).hostname) ? "aliexpress" : ""; } catch { return ""; } },
  classificarLinkEngine,
  url => new URL(url).hostname,
  JSON.stringify,
  () => {},
  async () => ({ ok: true })
);

async function persistir({ papeisRadar, marketplaceContexto = "aliexpress", linkAdicional = "" }) {
  const app = "https://seuhardware.com/s/appFixture";
  const pc = "https://seuhardware.com/s/pcFixture";
  const destinoApp = "https://m.aliexpress.com/p/coin-index/index.html?productIds=1005001111111111";
  const consultas = [];
  const metadata = {
    redirectsRadar: [
      { linkOriginalCapturado: app, linkResolvido: destinoApp, status: "resolvido" },
      { linkOriginalCapturado: pc, status: "falhou", motivo: "promozone_redirect_bloqueado", motivoRedirectTecnico: "REDIRECT_LIMIT" }
    ],
    radarMirror: { links: { classificados: papeisRadar || [
      { link: app, tipo: "moedas", ordemCaptura: 1 },
      { link: pc, tipo: "pc", ordemCaptura: 2 }
    ] } }
  };
  await salvarLinksEvento(1, [...[destinoApp, pc], ...(linkAdicional ? [linkAdicional] : [])], metadata, {
    textoOriginal: `🪙 ${app}\n⬇️ NO PC\n${pc}`
  }, { marketplaceContexto, query: async (_sql, params) => {
    consultas.push(params);
    return { ok: true };
  } });
  return { app, pc, consultas };
}

(async () => {
  const { app, pc, consultas } = await persistir({});
  assert.equal(consultas.length, 2);
  assert.deepEqual(consultas.map(item => item[1]), [app, pc], "URL original e ordem não podem mudar");
  assert.equal(consultas[1][3], null, "redirect falho não cria URL expandida");
  assert.equal(consultas[1][6], false);
  assert.equal(consultas[1][7], "promozone_redirect_bloqueado");
  assert.equal(consultas[1][8], "", "papel Radar não prova marketplace pela URL");
  assert.equal(JSON.parse(consultas[0][9]).papelLink, "link_app");
  assert.equal(JSON.parse(consultas[1][9]).papelLink, "link_pc");
  assert.equal(JSON.parse(consultas[1][9]).motivoRedirectTecnico, "REDIRECT_LIMIT");
  assert.equal(JSON.parse(consultas[1][9]).urlProduto, "", "papel PC não prova identidade");

  const semContexto = await persistir({ marketplaceContexto: "" });
  assert.equal(JSON.parse(semContexto.consultas[1][9]).papelLink, "desconhecido");
  const contraditorio = await persistir({ papeisRadar: [
    { link: pc, tipo: "pc" }, { link: pc, tipo: "app" }
  ] });
  assert.equal(JSON.parse(contraditorio.consultas[1][9]).papelLink, "desconhecido");
  const outroProduto = "https://www.aliexpress.com/item/1005002222222222.html";
  const comAdicional = await persistir({ linkAdicional: outroProduto });
  assert.equal(comAdicional.consultas.length, 3, "link adicional não pode desaparecer");
  assert.equal(comAdicional.consultas[2][1], outroProduto);
  assert.notEqual(JSON.parse(comAdicional.consultas[2][9]).papelLink, "link_pc",
    "papel PC não pode contaminar produto adicional");
  console.log("aliexpress-pc-redirect-role-persistencia.test.js ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
