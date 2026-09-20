const assert = require("assert");

const {
  montarDiagnosticoGateImagemMercadoLivreLocalWorker,
  resolverIdentidadeMlWorker
} = require("../modules/engine/importer/importer.service");

{
  const resultado = resolverIdentidadeMlWorker({
    identidade: { produtoIdDetectado: "MLB37809946", tipoIdentidade: "mlb" },
    mlbsMetadata: [],
    sourceUrl: "https://www.mercadolivre.com.br/p/MLB37809946"
  });
  assert.deepStrictEqual(resultado, {
    ok: true,
    motivo: "",
    produtoId: "MLB37809946",
    origem: "detector_direto"
  });
}

{
  const resultado = resolverIdentidadeMlWorker({
    identidade: { produtoIdDetectado: "", tipoIdentidade: "sem_identidade" },
    mlbsMetadata: ["MLB37809946"],
    sourceUrl: "https://mercadolivre.com.br/social/diegopc2015"
  });
  assert.deepStrictEqual(resultado, {
    ok: true,
    motivo: "",
    produtoId: "MLB37809946",
    origem: "metadata_tecnica"
  });
}

{
  const resultado = resolverIdentidadeMlWorker({
    identidade: { produtoIdDetectado: "", tipoIdentidade: "sem_identidade" },
    mlbsMetadata: ["MLB3746504707"],
    sourceUrl: "https://produto.mercadolivre.com.br/MLB-3746504707-produto"
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.produtoId, "MLB3746504707");
  assert.strictEqual(resultado.origem, "metadata_tecnica");
}

{
  const resultado = resolverIdentidadeMlWorker({
    identidade: { produtoIdDetectado: "", tipoIdentidade: "sem_identidade" },
    mlbsMetadata: ["MLB2"],
    sourceUrl: "https://produto.mercadolivre.com.br/MLB1-produto"
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "identidade_divergente");
}

{
  const resultado = resolverIdentidadeMlWorker({
    identidade: { produtoIdDetectado: "", tipoIdentidade: "sem_identidade" },
    mlbsMetadata: ["MLB1", "MLB2"],
    sourceUrl: ""
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "identidade_ambigua");
}

{
  const resultado = resolverIdentidadeMlWorker({
    identidade: { produtoIdDetectado: "MLB1", tipoIdentidade: "mlb" },
    mlbsMetadata: ["MLB2"],
    sourceUrl: ""
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "identidade_divergente");
}

{
  const comercial = {
    productId: "MLB37809946",
    preco: 99.9,
    cupom: "PROMO10",
    linkAfiliado: "https://meli.la/mesmo-produto"
  };
  const antes = JSON.stringify(comercial);
  const resultado = resolverIdentidadeMlWorker({
    identidade: { produtoIdDetectado: "", tipoIdentidade: "sem_identidade" },
    mlbsMetadata: [comercial.productId],
    sourceUrl: ""
  });
  assert.strictEqual(resultado.produtoId, "MLB37809946");
  assert.strictEqual(JSON.stringify(comercial), antes);
}

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
