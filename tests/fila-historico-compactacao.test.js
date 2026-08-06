"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const policy = require("../utils/fila-historico-policy");
const storageRepository = require("../modules/storage-manager/storage.repository");
const autoClean = require("../modules/engine/auto-clean/auto-clean.service");

const AGORA = Date.parse("2026-08-06T12:00:00.000Z");

function isoAtras(ms) {
  return new Date(AGORA - ms).toISOString();
}

function escreverJson(file, dados) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(dados, null, 2));
}

function itemBase(extra = {}) {
  return {
    id: extra.id || "item",
    filaItemId: extra.filaItemId || extra.id || "item",
    ofertaId: extra.ofertaId || `oferta_${extra.id || "item"}`,
    clienteId: "user_40qdblgt",
    workspaceId: "user_40qdblgt",
    marketplace: "kabum",
    categoria: "Gamer e Hardware",
    status: "enviado",
    criadoEm: isoAtras(3 * 24 * 60 * 60 * 1000),
    dataEntradaFila: isoAtras(3 * 24 * 60 * 60 * 1000),
    enviadoEm: isoAtras(3 * 24 * 60 * 60 * 1000),
    destinoId: "destino_kabum",
    destinoNome: "AWIN / KaBuM",
    canal: "whatsapp",
    tentativas: 2,
    preco: 1999.9,
    thumbnail: "https://img.test/t.jpg",
    linkOriginal: "https://www.kabum.com.br/produto/1",
    linkAfiliado: "https://awin1.com/cread.php?token=nao_deve_ficar",
    mensagemRenderizada: "texto comercial completo que nao deve ficar",
    payloadBruto: { html: "<html>payload pesado</html>" },
    integridadeComercial: { links: ["https://url.test/grande"] },
    metadata: { respostaApi: { bruto: "x".repeat(2000) } },
    ...extra
  };
}

(async () => {
  const vivo = policy.analisarItemHistoricoFila(itemBase({ id: "vivo", status: "pendente" }), { agoraMs: AGORA });
  assert.strictEqual(vivo.acao, "preservar_integral", "item vivo permanece integral");

  const enviadoRecente = policy.analisarItemHistoricoFila(itemBase({
    id: "recente",
    enviadoEm: isoAtras(6 * 60 * 60 * 1000)
  }), { agoraMs: AGORA });
  assert.strictEqual(enviadoRecente.acao, "preservar_integral", "enviado com menos de 24h permanece integral");

  const enviadoCompactavel = policy.analisarItemHistoricoFila(itemBase({ id: "compactavel" }), { agoraMs: AGORA });
  assert.strictEqual(enviadoCompactavel.acao, "compactar", "final entre 24h e 7d vira compacto");
  const compactoJson = JSON.stringify(enviadoCompactavel.item);
  assert(compactoJson.includes("oferta_compactavel"), "compacto preserva ofertaId para auditoria/anti-duplicacao leve");
  assert(compactoJson.includes("1999.9"), "compacto preserva preco numerico para relatorio leve");
  assert(!compactoJson.includes("linkAfiliado"), "links comerciais completos desaparecem do compacto");
  assert(!compactoJson.includes("payloadBruto"), "payload bruto desaparece do compacto");
  assert(!compactoJson.includes("mensagemRenderizada"), "texto completo desaparece do compacto");
  assert(!compactoJson.includes("integridadeComercial"), "integridade comercial pesada desaparece do compacto");
  assert(!compactoJson.includes("respostaApi"), "metadata pesada desaparece do compacto");
  assert.strictEqual(enviadoCompactavel.item.thumbnail, "https://img.test/t.jpg", "thumbnail URL pequena pode permanecer");

  const base64 = policy.analisarItemHistoricoFila(itemBase({
    id: "thumb_base64",
    thumbnail: "data:image/png;base64,AAAA"
  }), { agoraMs: AGORA });
  assert.strictEqual(base64.item.thumbnail, undefined, "thumbnail base64 e removida");

  const removivel = policy.analisarItemHistoricoFila(itemBase({
    id: "antigo",
    enviadoEm: isoAtras(8 * 24 * 60 * 60 * 1000)
  }), { agoraMs: AGORA });
  assert.strictEqual(removivel.acao, "remover", "final acima de 7d e removido da fila operacional no plano");

  const expirada = policy.analisarItemHistoricoFila(itemBase({
    id: "expirada",
    status: "expirada_operacional",
    enviadoEm: undefined,
    expiradaEm: isoAtras(2 * 24 * 60 * 60 * 1000)
  }), { agoraMs: AGORA });
  assert.strictEqual(expirada.acao, "compactar", "expirada_operacional segue politica de final");

  const retidaAcionavel = policy.analisarItemHistoricoFila(itemBase({
    id: "retida_acionavel",
    status: "retida",
    motivoRetencao: "retida_sem_destino_compativel",
    retidaEm: isoAtras(3 * 24 * 60 * 60 * 1000)
  }), { agoraMs: AGORA });
  assert.strictEqual(retidaAcionavel.acao, "preservar_integral", "retida acionavel permanece protegida");

  const retidaTerminal = policy.analisarItemHistoricoFila(itemBase({
    id: "retida_terminal",
    status: "retida",
    retidaTerminal: true,
    retidaEm: isoAtras(3 * 24 * 60 * 60 * 1000)
  }), { agoraMs: AGORA });
  assert.strictEqual(retidaTerminal.acao, "compactar", "retida terminal segue TTL");

  const fila = [
    itemBase({ id: "vivo", status: "pendente" }),
    itemBase({ id: "recente", enviadoEm: isoAtras(6 * 60 * 60 * 1000) }),
    itemBase({ id: "compactavel" }),
    itemBase({ id: "antigo", enviadoEm: isoAtras(8 * 24 * 60 * 60 * 1000) })
  ];
  const analise = policy.analisarFilaHistorico(fila, { agoraMs: AGORA });
  assert.strictEqual(analise.resumo.integrais, 2);
  assert.strictEqual(analise.resumo.compactaveis, 1);
  assert.strictEqual(analise.resumo.removiveis, 1);
  assert(analise.resumo.tamanhoJsonEstimadoDepoisBytes < analise.resumo.tamanhoJsonEstimadoAntesBytes, "compactacao reduz de fato o tamanho do JSON");

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-fila-compactacao-"));
  const filaPath = path.join(dataDir, "clientes", "user_40qdblgt", "fila.json");
  escreverJson(filaPath, fila);
  const antes = fs.readFileSync(filaPath, "utf8");
  const dryRun = await storageRepository.auditarCompactacaoFilaWorkspace(dataDir, "user_40qdblgt", { agoraMs: AGORA });
  assert.strictEqual(dryRun.ok, true);
  assert.strictEqual(dryRun.aplicouMudancas, false);
  assert.strictEqual(dryRun.compactaveis, 1);
  assert.strictEqual(dryRun.removiveis, 1);
  assert.strictEqual(fs.readFileSync(filaPath, "utf8"), antes, "dryRun nao grava");

  const shadow = autoClean.auditarFilaJson({ dataDir, agoraMs: AGORA, loteLimite: 100 });
  assert.strictEqual(shadow.politicaCentral, "fila_historico_policy_v1", "Auto-Clean reutiliza politica central");
  assert.strictEqual(shadow.compactaveis, 1);
  assert.strictEqual(shadow.removiveis, 1);
  assert.strictEqual(shadow.aplicouMudancas, false);

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("fila-historico-compactacao.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
