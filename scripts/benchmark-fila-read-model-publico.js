"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  benchmarkReadModelPublico,
  reconciliarProjecaoHotDaFila
} = require("../modules/fila/fila-read-model-publico");

const AGORA = Date.parse("2026-09-15T15:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function hot(id, indice) {
  return {
    id,
    clienteId: "bench",
    titulo: `Oferta hot ${id}`,
    marketplace: indice % 2 ? "amazon" : "mercadolivre",
    preco: `R$ ${99 + indice},90`,
    imagem: `https://img.example/${id}.jpg`,
    dataEntradaFila: iso(AGORA - (indice % 400) * 60 * 1000),
    statusPublico: "em_distribuicao",
    statusOperacional: indice % 5 === 0 ? "processando" : "pendente",
    canal: indice % 3 === 0 ? "whatsapp" : "telegram",
    destinoNome: `Destino ${indice % 20}`,
    progresso: {
      enviados: indice % 4 === 0 ? 1 : 0,
      total: 2,
      pendentes: 1,
      erros: 0
    }
  };
}

function statusHistorico(indice) {
  if (indice % 5 === 0) return "nao_enviado";
  if (indice % 4 === 0) return "parcial";
  return "enviado";
}

function historico(id, indice, statusPublico) {
  const finalizadoEm = iso(AGORA - (indice % 700) * 45 * 1000);
  const total = statusPublico === "parcial" ? 2 : 1;
  const enviados = statusPublico === "nao_enviado" ? 0 : statusPublico === "parcial" ? 1 : 1;
  return {
    chave: `chave_${id}`,
    clienteId: "bench",
    id,
    statusPublico,
    statusOperacional: statusPublico === "nao_enviado" ? "expirada_operacional" : "enviado",
    item: {
      id,
      clienteId: "bench",
      titulo: `Oferta historico ${id}`,
      marketplace: indice % 2 ? "amazon" : "mercadolivre",
      preco: `R$ ${199 + indice},90`,
      imagem: `https://img.example/${id}.jpg`,
      dataEntradaFila: iso(AGORA - (indice % 500) * 60 * 1000),
      finalizadoEm,
      enviadoEm: statusPublico === "enviado" ? finalizadoEm : "",
      status: statusPublico === "nao_enviado" ? "expirada_operacional" : "enviado",
      canal: indice % 3 === 0 ? "whatsapp" : "telegram",
      destinoNome: `Destino ${indice % 20}`,
      motivo: statusPublico === "nao_enviado" ? "sem_destino_compativel" : "",
      progresso: {
        enviados,
        total,
        pendentes: Math.max(0, total - enviados),
        erros: statusPublico === "nao_enviado" ? 1 : 0
      },
      destinosEstado: Array.from({ length: total }, (_, destinoIndice) => ({
        destinoId: `d${destinoIndice}`,
        destinoNome: `Destino ${destinoIndice}`,
        canal: "telegram",
        estado: destinoIndice < enviados ? "enviado" : "erro"
      }))
    }
  };
}

function criarHistoricos(total, overlap) {
  return Array.from({ length: total }, (_, indice) =>
    historico(indice < overlap ? `exec_${indice}` : `hist_${indice}`, indice, statusHistorico(indice))
  );
}

function criarHot(total) {
  return Array.from({ length: total }, (_, indice) => hot(`exec_${indice}`, indice));
}

function imprimir(nome, resultado) {
  console.log(JSON.stringify({
    nome,
    reconcileMs: resultado.reconcileMs,
    hot: resultado.hot,
    historico: resultado.historico,
    leiturasFisicas: resultado.leiturasFisicas,
    bytesLidos: resultado.bytesLidos,
    leituraMs: resultado.leituraMs,
    readModelMs: resultado.readModelMs,
    totalMs: resultado.totalMs,
    maiorTrechoSyncMs: resultado.maiorTrechoSyncMs,
    bytesResposta: resultado.bytesResposta,
    metricas: resultado.metricas,
    pagina: resultado.pagina
  }));
}

function medirReconcile(hotItens) {
  const inicio = process.hrtime.bigint();
  const reconciliacao = reconciliarProjecaoHotDaFila(hotItens, {
    clienteId: "bench",
    agoraMs: AGORA
  });
  return {
    reconcileMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6),
    projectionReady: reconciliacao.projectionReady === true,
    hotProjetado: reconciliacao.projecao.total
  };
}

function benchmarkMemoria(nome, hotTotal, historicoTotal, overlap, visao = "processadas", filtros = {}) {
  const hotItens = criarHot(hotTotal);
  const reconcile = medirReconcile(hotItens);
  imprimir(nome, {
    ...benchmarkReadModelPublico({
    clienteId: "bench",
    hot: hotItens,
    historicoLeve: criarHistoricos(historicoTotal, overlap),
    agoraMs: AGORA,
    limit: 50,
      visao,
      filtros
    }),
    reconcileMs: reconcile.reconcileMs
  });
}

function benchmarkFs(nome, hotTotal, historicoTotal, overlap, visao = "processadas", filtros = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-read-model-bench-"));
  try {
    const hotItens = criarHot(hotTotal);
    const reconcile = medirReconcile(hotItens);
    const histDir = path.join(dir, "historico");
    fs.mkdirSync(histDir, { recursive: true });
    const porDia = new Map();
    for (const [indice, registro] of criarHistoricos(historicoTotal, overlap).entries()) {
      const dia = iso(AGORA - (indice % 7) * DIA_MS).slice(0, 10);
      const linhas = porDia.get(dia) || [];
      linhas.push(JSON.stringify(registro));
      porDia.set(dia, linhas);
    }
    for (const [dia, linhas] of porDia.entries()) {
      fs.writeFileSync(path.join(histDir, `${dia}.jsonl`), `${linhas.join("\n")}\n`, "utf8");
    }
    imprimir(nome, benchmarkReadModelPublico({
      clienteId: "bench",
      hot: hotItens,
      historicoDir: histDir,
      agoraMs: AGORA,
      limit: 50,
      visao,
      filtros
    }));
    imprimir(`${nome}_com_reconcile`, {
      ...benchmarkReadModelPublico({
        clienteId: "bench",
        hot: hotItens,
        historicoDir: histDir,
        agoraMs: AGORA,
        limit: 50,
        visao,
        filtros
      }),
      reconcileMs: reconcile.reconcileMs
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

benchmarkMemoria("producao_like_memoria_processadas_827_753_overlap_289", 827, 753, 289, "processadas");
benchmarkFs("producao_like_fs_processadas_827_753_overlap_289", 827, 753, 289, "processadas");
benchmarkFs("producao_like_fs_enviadas_827_753_overlap_289", 827, 753, 289, "enviadas");
benchmarkFs("producao_like_fs_filtro_marketplace_827_753_overlap_289", 827, 753, 289, "processadas", { marketplace: "amazon", q: "Oferta" });
benchmarkFs("stress_fs_processadas_1500_hot_5000_historicos", 1500, 5000, 500, "processadas");
benchmarkFs("stress_fs_enviadas_1500_hot_5000_historicos", 1500, 5000, 500, "enviadas");
