"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { montarOfertaVitrine } = require("../modules/vitrine/hook");
const {
  capturarOfertaComercialConfirmadaVitrine,
  montarOfertaParaVitrinePosEnvio,
  urlsCtaVitrineOferta
} = require("../utils/vitrine-handoff-pos-envio");

const raiz = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(raiz, "index.js"), "utf8");

function ofertaFinalizadaMercadoLivre() {
  return {
    id: "101187",
    ofertaId: "101187",
    status: "enviado",
    enviadoEm: "2026-08-17T22:53:44.294Z",
    marketplace: "mercadolivre",
    titulo: "Kit com 2 Polo Manga Longa Com Zíper",
    cupom: "COMPENSAML",
    linkAfiliado: "https://meli.la/16Vazrx",
    linkFinal: "https://meli.la/16Vazrx",
    linksComerciais: [
      {
        tipo: "produto",
        papel: "link_produto",
        urlOptimus: "",
        urlAfiliadaWorkspace: "https://meli.la/16Vazrx",
        renderizavel: true
      }
    ]
  };
}

const redirectMl = "https://go.optimuspromo.com.br/r/ml-172669";
const ofertaEnviadaMercadoLivre = {
  ...ofertaFinalizadaMercadoLivre(),
  linkAfiliado: redirectMl,
  linkFinal: redirectMl,
  link: redirectMl,
  urlAfiliada: redirectMl,
  urlOptimus: redirectMl,
  linksComerciais: [
    {
      tipo: "produto",
      papel: "link_produto",
      urlOptimus: redirectMl,
      urlAfiliadaWorkspace: redirectMl,
      renderizavel: true,
      conversaoStatus: "convertida",
      token: "NAO_PODE_VAZAR",
      cookie: "NAO_PODE_VAZAR",
      credencial: "NAO_PODE_VAZAR",
      sessao: "NAO_PODE_VAZAR"
    }
  ]
};

let captura = capturarOfertaComercialConfirmadaVitrine(null, ofertaEnviadaMercadoLivre, {
  clienteId: "workspace-a",
  ofertaId: "101187",
  marketplace: "mercadolivre",
  destinoId: "wa-1",
  destinoTipo: "whatsapp",
  capturadaEm: "2026-08-17T22:53:44.294Z"
});

assert.ok(captura, "envio confirmado com CTA Optimus deve ser capturado");
assert.deepStrictEqual(urlsCtaVitrineOferta(captura.oferta), [redirectMl]);

const ofertaParaVitrineMl = montarOfertaParaVitrinePosEnvio(
  ofertaFinalizadaMercadoLivre(),
  captura,
  { destinosEnviados: 1 }
);

assert.strictEqual(ofertaParaVitrineMl.status, "enviado", "estado final da fila deve vencer");
assert.strictEqual(ofertaParaVitrineMl.enviadoEm, "2026-08-17T22:53:44.294Z");
assert.strictEqual(ofertaParaVitrineMl.linkAfiliado, redirectMl, "CTA real usado na mensagem deve chegar ao hook");
assert.strictEqual(ofertaParaVitrineMl.linkFinal, redirectMl);
assert.strictEqual(ofertaParaVitrineMl.linksComerciais[0].urlOptimus, redirectMl);
assert.strictEqual(JSON.stringify(ofertaParaVitrineMl).includes("NAO_PODE_VAZAR"), false, "segredos nao podem ser repassados no handoff");

const vitrineMl = montarOfertaVitrine(ofertaParaVitrineMl);
assert.deepStrictEqual(vitrineMl.linksComerciais.map(link => link.papel), ["link_produto"], "Mercado Livre CTA principal deve virar Abrir produto");
assert.strictEqual(vitrineMl.linksComerciais[0].urlOptimus, redirectMl);

const ofertaParaVitrineMlListaLegada = montarOfertaParaVitrinePosEnvio(
  ofertaFinalizadaMercadoLivre(),
  capturarOfertaComercialConfirmadaVitrine(null, {
    ...ofertaEnviadaMercadoLivre,
    linksComerciais: ofertaFinalizadaMercadoLivre().linksComerciais
  }),
  { destinosEnviados: 1 }
);
assert.strictEqual(
  montarOfertaVitrine(ofertaParaVitrineMlListaLegada).linksComerciais[0].urlOptimus,
  redirectMl,
  "caso 172669: scalar Optimus do envio deve sobreviver mesmo com lista legada sem urlOptimus"
);

const semRedirect = capturarOfertaComercialConfirmadaVitrine(null, ofertaFinalizadaMercadoLivre(), {
  clienteId: "workspace-a",
  ofertaId: "101187"
});
assert.strictEqual(semRedirect, null, "handoff nao deve reconverter nem inventar redirect ausente");

const logs = [];
const redirectFanoutPrimeiro = "https://go.optimuspromo.com.br/r/fanout-primeiro";
const redirectFanoutSegundo = "https://go.optimuspromo.com.br/r/fanout-segundo";
let capturaFanout = capturarOfertaComercialConfirmadaVitrine(null, {
  id: "fanout-1",
  linksComerciais: [{ papel: "link_produto", urlOptimus: redirectFanoutPrimeiro, renderizavel: true }]
}, {
  clienteId: "workspace-a",
  ofertaId: "fanout-1",
  destinoId: "wa",
  destinoTipo: "whatsapp",
  logger: { warn: (tag, payload) => logs.push({ tag, payload }) }
});
capturaFanout = capturarOfertaComercialConfirmadaVitrine(capturaFanout, {
  id: "fanout-1",
  linksComerciais: [{ papel: "link_produto", urlOptimus: redirectFanoutSegundo, renderizavel: true }]
}, {
  clienteId: "workspace-a",
  ofertaId: "fanout-1",
  destinoId: "tg",
  destinoTipo: "telegram",
  logger: { warn: (tag, payload) => logs.push({ tag, payload }) }
});
const ofertaFanout = montarOfertaParaVitrinePosEnvio({ id: "fanout-1", status: "enviado" }, capturaFanout, { destinosEnviados: 3 });
assert.strictEqual(ofertaFanout.linksComerciais[0].urlOptimus, redirectFanoutPrimeiro, "FANOUT preserva primeiro contrato coerente");
assert.strictEqual(ofertaFanout.totalDestinosEnviados, 3);
assert.ok(logs.some(item => item.tag === "[VITRINE-HANDOFF-CTA-DIVERGENTE]"), "divergencia de CTA por destino deve ser auditada");

const ofertaAli = montarOfertaParaVitrinePosEnvio(
  { id: "ali-1", status: "enviado", marketplace: "aliexpress" },
  capturarOfertaComercialConfirmadaVitrine(null, {
    id: "ali-1",
    marketplace: "aliexpress",
    linksComerciais: [
      { tipo: "app", papel: "link_app", urlOptimus: "https://go.optimuspromo.com.br/r/ali-app", renderizavel: true },
      { tipo: "pc", papel: "link_pc", urlOptimus: "https://go.optimuspromo.com.br/r/ali-pc", renderizavel: true }
    ]
  }),
  { destinosEnviados: 1 }
);
assert.deepStrictEqual(
  montarOfertaVitrine(ofertaAli).linksComerciais.map(link => link.papel),
  ["link_app", "link_pc"],
  "AliExpress APP + PC continuam com dois CTAs"
);

const ofertaShopee = montarOfertaParaVitrinePosEnvio(
  { id: "shopee-1", status: "enviado", marketplace: "shopee" },
  capturarOfertaComercialConfirmadaVitrine(null, {
    id: "shopee-1",
    marketplace: "shopee",
    linksResgate: [
      { tipo: "resgate", papel: "link_resgate", urlOptimus: "https://go.optimuspromo.com.br/r/shopee-resgate", renderizavel: true }
    ],
    linksProduto: [
      { tipo: "produto", papel: "link_produto", urlOptimus: "https://go.optimuspromo.com.br/r/shopee-produto", renderizavel: true }
    ]
  }),
  { destinosEnviados: 1 }
);
assert.deepStrictEqual(
  montarOfertaVitrine(ofertaShopee).linksComerciais.map(link => link.papel).sort(),
  ["link_produto", "link_resgate"],
  "Shopee Resgate + Produto continuam com dois CTAs"
);

assert.ok(index.includes('require("./utils/vitrine-handoff-pos-envio")'), "executor deve importar handoff pos-envio da Vitrine");
const chamadaCapturaExecutor = index.indexOf("ofertaComercialConfirmadaVitrine = capturarOfertaComercialConfirmadaVitrine");
assert.ok(
  index.indexOf("const ofertaParaMensagem = linkOfertaDestino.oferta || oferta") <
    chamadaCapturaExecutor,
  "captura deve partir da oferta realmente usada na mensagem"
);
assert.ok(
  index.indexOf("resultadoEnvio.enviado === true") <
    chamadaCapturaExecutor,
  "captura deve acontecer apenas apos envio confirmado"
);
assert.ok(
  index.indexOf("const finalizacaoEnvio = filaOfertas.finalizarOfertaEnviadaFila") <
    index.indexOf("const ofertaParaVitrine = montarOfertaParaVitrinePosEnvio"),
  "oferta para Vitrine deve ser montada depois da finalizacao da fila"
);
assert.ok(
  index.includes("oferta: ofertaParaVitrine"),
  "hook deve receber a oferta combinada com CTA real do envio"
);

console.log("vitrine-v1-2-handoff-pos-envio.test.js OK");
