const assert = require("assert");

const {
  montarDiagnosticoGateImagemMercadoLivreLocalWorker
} = require("../modules/engine/importer/importer.service");

{
  const diagnostico = montarDiagnosticoGateImagemMercadoLivreLocalWorker({
    engineOfertaId: 44551,
    jobId: 118873,
    eventoId: 40843,
    marketplace: "mercadolivre",
    sourceUrl: "https://www.mercadolivre.com.br/produto/p/MLB37809946?token-nao-deve-aparecer=1",
    identidade: { produtoIdDetectado: "MLB37809946", tipoIdentidade: "mlb" },
    mlbsMetadata: ["MLB37809946"],
    imagem: "",
    imagemEnviavel: false,
    imagemStatus: "nao_resolvida",
    localWorkerDisponivel: true,
    cacheLookupDisponivel: true,
    taskCreatorDisponivel: true,
    cacheLookupExecutado: true,
    cacheHit: false,
    decisao: "task_criada",
    taskId: 17
  });

  assert.strictEqual(diagnostico.decisao, "task_criada");
  assert.strictEqual(diagnostico.identidade.produtoIdDetectado, "MLB37809946");
  assert.strictEqual(diagnostico.sourceUrl.host, "www.mercadolivre.com.br");
  assert.strictEqual(diagnostico.sourceUrl.path, "/produto/p/MLB37809946");
  assert.strictEqual(diagnostico.sourceUrl.possuiQuery, true);
  assert.strictEqual(JSON.stringify(diagnostico).includes("token-nao-deve-aparecer"), false);
  assert.strictEqual(diagnostico.taskId, 17);
}

{
  const diagnostico = montarDiagnosticoGateImagemMercadoLivreLocalWorker({
    marketplace: "mercadolivre",
    sourceUrl: "https://www.mercadolivre.com.br/produto/p/MLB37809946",
    identidade: { produtoIdDetectado: "", tipoIdentidade: "link_normalizado" },
    mlbsMetadata: ["MLB37809946"],
    imagemStatus: "nao_resolvida",
    localWorkerDisponivel: true,
    cacheLookupDisponivel: true,
    taskCreatorDisponivel: true,
    motivoTaskNaoCriada: "mlb_nao_detectado"
  });

  assert.strictEqual(diagnostico.decisao, "task_nao_criada");
  assert.strictEqual(diagnostico.motivoTaskNaoCriada, "mlb_nao_detectado");
  assert.deepStrictEqual(diagnostico.identidade, { produtoIdDetectado: "", tipoIdentidade: "link_normalizado" });
}

{
  const entrada = {
    marketplace: "mercadolivre",
    imagem: "https://http2.mlstatic.com/D_Q_NP_123.webp",
    imagemEnviavel: true,
    imagemStatus: "imagem_oficial_ml",
    identidade: { produtoIdDetectado: "MLB37809946", tipoIdentidade: "mlb" }
  };
  const diagnostico = montarDiagnosticoGateImagemMercadoLivreLocalWorker({
    ...entrada,
    motivoTaskNaoCriada: "imagem_ja_resolvida"
  });

  assert.strictEqual(diagnostico.decisao, "task_nao_criada");
  assert.strictEqual(diagnostico.motivoTaskNaoCriada, "imagem_ja_resolvida");
  assert.strictEqual(diagnostico.imagemAtual.host, "http2.mlstatic.com");
  assert.strictEqual(diagnostico.imagemEnviavel, true);
  assert.strictEqual(diagnostico.imagemStatus, "imagem_oficial_ml");
  assert.strictEqual(entrada.imagem, "https://http2.mlstatic.com/D_Q_NP_123.webp");
}

console.log("mercadolivre-local-worker-gate-observability.test.js ok");
