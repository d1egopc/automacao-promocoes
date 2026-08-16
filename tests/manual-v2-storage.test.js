const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-storage-"));

const {
  getClienteJsonPath,
  readClienteJson
} = require("../utils/storage");
const {
  ARQUIVO_OFERTAS_MANUAL_V2,
  listarOfertasManuaisV2,
  buscarOfertaManualV2,
  criarOfertaManualV2,
  atualizarOfertaManualV2,
  excluirOfertaManualV2,
  atualizarMetadadosEnvioManualV2
} = require("../modules/manual-v2/manual-offers.storage");

let tick = 0;
function now() {
  tick += 1;
  return `2026-08-14T12:00:0${tick}.000Z`;
}

function idFactory() {
  return `manual_v2_${tick}`;
}

function arquivoCliente(clienteId, arquivo) {
  return getClienteJsonPath(clienteId, arquivo);
}

function assertSemSegredos(valor) {
  const serializado = JSON.stringify(valor);
  for (const termo of ["BOT_TOKEN", "Authorization", "headers", "payloadBruto", "responseCompleto"]) {
    assert.ok(!serializado.includes(termo), `storage nao pode persistir ${termo}`);
  }
}

{
  const criada = criarOfertaManualV2("cliente_a", {
    marketplace: "Amazon",
    urlOriginal: "https://amazon.com.br/produto",
    titulo: "Produto A",
    precoAtual: "99,90",
    status: "enviada"
  }, { now, idFactory });

  assert.strictEqual(criada.clienteId, "cliente_a");
  assert.strictEqual(criada.status, "salva", "criacao do Patch 2 sempre inicia como salva");
  assert.strictEqual(criada.criadoEm, "2026-08-14T12:00:01.000Z");
  assert.strictEqual(criada.atualizadoEm, "2026-08-14T12:00:01.000Z");

  const lista = listarOfertasManuaisV2("cliente_a");
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].id, criada.id);
  assert.strictEqual(buscarOfertaManualV2("cliente_a", criada.id).titulo, "Produto A");
}

{
  const original = buscarOfertaManualV2("cliente_a", "manual_v2_1");
  const editada = atualizarOfertaManualV2("cliente_a", original.id, {
    titulo: "Produto A editado pelo usuario",
    precoAtual: "89,90",
    observacoes: "Campo manual pertence so ao Manual V2"
  }, { now });

  assert.strictEqual(editada.id, original.id);
  assert.strictEqual(editada.clienteId, "cliente_a");
  assert.strictEqual(editada.criadoEm, original.criadoEm, "update preserva criadoEm");
  assert.strictEqual(editada.atualizadoEm, "2026-08-14T12:00:02.000Z");
  assert.strictEqual(editada.titulo, "Produto A editado pelo usuario");
  assert.strictEqual(editada.observacoes, "Campo manual pertence so ao Manual V2");
}

{
  const ofertaA = buscarOfertaManualV2("cliente_a", "manual_v2_1");
  const ofertaB = criarOfertaManualV2("cliente_b", {
    marketplace: "Shopee",
    urlOriginal: "https://shopee.com.br/produto-i.1.2",
    titulo: "Produto B",
    precoMin: "10,00",
    precoMax: "20,00"
  }, { now, idFactory });

  assert.strictEqual(listarOfertasManuaisV2("cliente_a").length, 1);
  assert.strictEqual(listarOfertasManuaisV2("cliente_b").length, 1);
  assert.strictEqual(buscarOfertaManualV2("cliente_b", ofertaA.id), null, "cliente B nao le oferta A");
  assert.strictEqual(buscarOfertaManualV2("cliente_a", ofertaB.id), null, "cliente A nao le oferta B");
  assert.strictEqual(atualizarOfertaManualV2("cliente_b", ofertaA.id, { titulo: "invasao" }, { now }), null);
  assert.strictEqual(excluirOfertaManualV2("cliente_b", ofertaA.id), false);
  assert.strictEqual(buscarOfertaManualV2("cliente_a", ofertaA.id).titulo, "Produto A editado pelo usuario");
}

{
  assert.strictEqual(excluirOfertaManualV2("cliente_a", "manual_v2_1"), true);
  assert.strictEqual(buscarOfertaManualV2("cliente_a", "manual_v2_1"), null);
  assert.deepStrictEqual(listarOfertasManuaisV2("cliente_a"), []);
  assert.strictEqual(listarOfertasManuaisV2("cliente_b").length, 1, "excluir A nao afeta B");
}

{
  const arquivoManualA = arquivoCliente("cliente_a", ARQUIVO_OFERTAS_MANUAL_V2);
  const arquivoManualB = arquivoCliente("cliente_b", ARQUIVO_OFERTAS_MANUAL_V2);
  const arquivoFilaA = arquivoCliente("cliente_a", "fila.json");
  const arquivoFilaB = arquivoCliente("cliente_b", "fila.json");

  assert.ok(fs.existsSync(arquivoManualA), "storage manual cria arquivo proprio do cliente A");
  assert.ok(fs.existsSync(arquivoManualB), "storage manual cria arquivo proprio do cliente B");
  assert.strictEqual(fs.existsSync(arquivoFilaA), false, "Manual V2 nao escreve fila.json do cliente A");
  assert.strictEqual(fs.existsSync(arquivoFilaB), false, "Manual V2 nao escreve fila.json do cliente B");
  assert.deepStrictEqual(readClienteJson("cliente_a", "fila.json", []), [], "Manual V2 nao depende de leitura da fila");
}

{
  fs.writeFileSync(
    arquivoCliente("cliente_c", ARQUIVO_OFERTAS_MANUAL_V2),
    JSON.stringify([
      {
        id: "oferta_certa",
        clienteId: "cliente_c",
        status: "salva",
        titulo: "Oferta certa"
      },
      {
        id: "oferta_errada",
        clienteId: "cliente_d",
        status: "salva",
        titulo: "Oferta errada"
      }
    ], null, 2)
  );

  const lista = listarOfertasManuaisV2("cliente_c");
  assert.deepStrictEqual(lista.map((oferta) => oferta.id), ["oferta_certa"]);
}

{
  const oferta = criarOfertaManualV2("cliente_envio", {
    id: "oferta_discord_sucesso",
    marketplace: "amazon",
    urlOriginal: "https://amazon.com.br/produto",
    titulo: "Produto Discord"
  }, { now, idFactory: () => "oferta_discord_sucesso" });

  const atualizada = atualizarMetadadosEnvioManualV2("cliente_envio", oferta.id, {
    status: "enviada",
    enviadoEm: "2026-08-14T13:00:00.000Z",
    envioManual: {
      solicitadoEm: "2026-08-14T12:59:00.000Z",
      concluidoEm: "2026-08-14T13:00:00.000Z",
      destinosEscolhidos: [{
        id: "discord_1",
        nome: "Discord Ofertas",
        tipo: "discord",
        ativo: true,
        utilizavel: true,
        identificacaoVisual: "Servidor / #ofertas",
        botToken: "BOT_TOKEN_NAO_SAIR"
      }],
      resultados: [{
        destinoId: "discord_1",
        nome: "Discord Ofertas",
        tipo: "discord",
        status: "enviado",
        enviadoEm: "2026-08-14T13:00:00.000Z",
        erro: "",
        messageId: "msg_discord_123",
        statusHttp: 200,
        imagemEnviada: true,
        headers: { Authorization: "Bot BOT_TOKEN_NAO_SAIR" },
        payloadBruto: { token: "BOT_TOKEN_NAO_SAIR" },
        responseCompleto: { id: "msg_discord_123" }
      }],
      enviados: 1,
      erros: 0,
      creditosDebitados: 1
    }
  }, { now });

  assert.strictEqual(atualizada.status, "enviada");
  assert.strictEqual(atualizada.envioManual.resultados[0].messageId, "msg_discord_123");
  assert.strictEqual(atualizada.envioManual.resultados[0].statusHttp, 200);
  assert.strictEqual(atualizada.envioManual.resultados[0].imagemEnviada, true);
  assert.strictEqual(atualizada.envioManual.creditosDebitados, 1);
  assertSemSegredos(atualizada);
}

{
  const casos = [
    {
      id: "discord_sem_message_id",
      resultado: {
        destinoId: "discord_1",
        nome: "Discord Ofertas",
        tipo: "discord",
        status: "enviado",
        enviadoEm: "2026-08-14T13:10:00.000Z",
        erro: "",
        messageId: "",
        statusHttp: 200,
        imagemEnviada: true
      },
      erro: "discord_resposta_sem_message_id"
    },
    {
      id: "discord_204",
      resultado: {
        destinoId: "discord_1",
        nome: "Discord Ofertas",
        tipo: "discord",
        status: "enviado",
        enviadoEm: "2026-08-14T13:10:00.000Z",
        erro: "",
        messageId: "",
        statusHttp: 204,
        imagemEnviada: false
      },
      erro: "discord_resposta_sem_message_id"
    },
    {
      id: "discord_channel_divergente",
      resultado: {
        destinoId: "discord_1",
        nome: "Discord Ofertas",
        tipo: "discord",
        status: "erro",
        enviadoEm: "",
        erro: "discord_channel_resposta_divergente",
        statusHttp: 200
      },
      erro: "discord_channel_resposta_divergente"
    }
  ];

  for (const caso of casos) {
    const oferta = criarOfertaManualV2("cliente_envio", {
      id: caso.id,
      marketplace: "amazon",
      urlOriginal: `https://amazon.com.br/${caso.id}`,
      titulo: caso.id
    }, { now, idFactory: () => caso.id });

    const atualizada = atualizarMetadadosEnvioManualV2("cliente_envio", oferta.id, {
      status: "enviada",
      enviadoEm: "2026-08-14T13:10:00.000Z",
      envioManual: {
        resultados: [caso.resultado],
        enviados: 1,
        erros: 0,
        creditosDebitados: 1
      }
    }, { now });

    assert.strictEqual(atualizada.status, "erro", `${caso.id} nao pode ir para historico como enviada`);
    assert.strictEqual(Boolean(atualizada.enviadoEm), false);
    assert.strictEqual(atualizada.envioManual.resultados[0].status, "erro");
    assert.strictEqual(atualizada.envioManual.resultados[0].erro, caso.erro);
    assert.strictEqual(atualizada.envioManual.enviados, 0);
    assert.strictEqual(atualizada.envioManual.erros, 1);
    assert.strictEqual(atualizada.envioManual.creditosDebitados, 0);
  }
}

{
  const oferta = criarOfertaManualV2("cliente_envio", {
    id: "oferta_wa_tg_intactos",
    marketplace: "amazon",
    urlOriginal: "https://amazon.com.br/wa-tg",
    titulo: "WA TG"
  }, { now, idFactory: () => "oferta_wa_tg_intactos" });

  const atualizada = atualizarMetadadosEnvioManualV2("cliente_envio", oferta.id, {
    status: "enviada",
    enviadoEm: "2026-08-14T13:20:00.000Z",
    envioManual: {
      resultados: [
        {
          destinoId: "wa_1",
          nome: "WA",
          tipo: "whatsapp",
          status: "enviado",
          enviadoEm: "2026-08-14T13:20:00.000Z",
          erro: "",
          messageId: "nao_persistir_em_wa"
        },
        {
          destinoId: "tg_1",
          nome: "TG",
          tipo: "telegram",
          status: "enviado",
          enviadoEm: "2026-08-14T13:20:01.000Z",
          erro: "",
          statusHttp: 200
        }
      ],
      enviados: 2,
      erros: 0,
      creditosDebitados: 2
    }
  }, { now });

  assert.strictEqual(atualizada.status, "enviada");
  assert.strictEqual(atualizada.envioManual.enviados, 2);
  assert.strictEqual(atualizada.envioManual.creditosDebitados, 2);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(atualizada.envioManual.resultados[0], "messageId"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(atualizada.envioManual.resultados[1], "statusHttp"), false);
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "manual-offers.storage.js"),
    "utf8"
  );
  const proibidos = [
    "utils/fila-ofertas",
    "processarFila",
    "prepararOfertaGlobal",
    "adicionarOfertaInicioFila",
    "Distributor",
    "Oferta Universal",
    "oferta-universal",
    "inteligencia-universal",
    "memoria-ofertas",
    "radar-ofertas",
    "/fila",
    "/enviar-manual"
  ];

  for (const termo of proibidos) {
    assert.ok(!fonte.includes(termo), `Manual V2 storage nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-storage.test.js ok");
