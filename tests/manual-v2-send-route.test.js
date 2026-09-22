const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-send-route-"));

const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");
const { enviarOfertaManualV2: enviarOfertaManualV2Real } = require("../modules/manual-v2/manual-dispatcher");
const {
  criarProvaAfiliacaoWorkspaceShopee
} = require("../modules/marketplaces/shopee/afiliacao-workspace");
const {
  criarProvaAfiliacaoWorkspaceAliExpress
} = require("../modules/marketplaces/aliexpress/afiliacao-workspace");
const storage = require("../modules/manual-v2/manual-offers.storage");
const {
  getClienteJsonPath
} = require("../utils/storage");

const destinosPorCliente = {
  cliente_a: [
    {
      id: "wa_ok",
      nome: "WA Ofertas",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_a",
      gruposWhatsapp: ["120363@g.us"]
    },
    {
      id: "tg_ok",
      nome: "TG Ofertas",
      tipo: "telegram",
      ativo: true,
      telegramDestinos: ["chat_ok"]
    },
    {
      id: "dc_ok",
      nome: "Discord Ofertas",
      tipo: "discord",
      ativo: true,
      conexaoId: "discord_a",
      channelId: "canal_discord"
    },
    {
      id: "wa_power_off",
      nome: "WA Power OFF",
      tipo: "whatsapp",
      ativo: false,
      conexaoId: "sessao_a",
      gruposWhatsapp: ["off@g.us"]
    }
  ],
  cliente_b: [
    {
      id: "wa_b",
      nome: "WA Cliente B",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_b",
      gruposWhatsapp: ["cliente_b@g.us"]
    }
  ]
};

const configsPorCliente = {
  cliente_a: {
    telegram: {
      destinos: [{
        id: "bot_ok",
        botToken: "123456:SEGREDO",
        chatId: "chat_ok",
        ativo: true
      }]
    }
  }
};

function criarApp(dispatcher, storageOptions, extraDeps = {}) {
  const app = express();
  app.use(express.json());
  app.use("/manual-v2", criarRotasManualV2({
    getClienteId: (req) => req.header("x-cliente-id") || "cliente_a",
    storageOptions,
    destinosPorCliente,
    configsPorCliente,
    sessoes: {
      sessao_a: {},
      sessao_b: {}
    },
    statusSessao: {
      sessao_a: "open",
      sessao_b: "aberto"
    },
    getPlanoUsuario: () => ({
      recursos: {
        whatsapp: true,
        telegram: true,
        discord: true
      }
    }),
    discordConexoes: [{
      id: "discord_a",
      guildId: "guild_a",
      guildName: "Servidor A",
      ativo: true
    }],
    discordCanaisPorConexao: {
      discord_a: [{
        id: "canal_discord",
        nome: "ofertas",
        utilizavel: true
      }]
    },
    discordSenderDisponivel: true,
    enviarOfertaManualV2: dispatcher,
    ...extraDeps
  }));
  return app;
}

function ouvir(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, metodo, caminho, clienteId, body, headersExtras = {}) {
  const headers = {
    "x-cliente-id": clienteId,
    ...headersExtras
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${server.address().port}${caminho}`, {
    method: metodo,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

function arquivoCliente(clienteId, arquivo) {
  return getClienteJsonPath(clienteId, arquivo);
}

function assertSemSegredos(valor) {
  const serializado = JSON.stringify(valor);
  for (const termo of ["SEGREDO", "botToken", "token", "secret", "cookie", "chat_ok", "Authorization", "headers", "payloadBruto", "responseCompleto"]) {
    assert.ok(!serializado.includes(termo), `resposta/storage nao pode expor ${termo}`);
  }
}

function criarOferta(clienteId, id, extra = {}) {
  return storage.criarOfertaManualV2(clienteId, {
    id,
    marketplace: "amazon",
    urlOriginal: `https://example.com/${id}`,
    titulo: `Oferta ${id}`,
    precoAtual: "99,90",
    ...extra
  }, {
    now: () => "2026-08-15T10:00:00.000Z",
    idFactory: () => id
  });
}

(async function main() {
  let tick = 0;
  let liberarDispatcher = null;
  let sinalizarDispatcherIniciado = null;
  const storageOptions = {
    now: () => {
      tick += 1;
      return `2026-08-15T12:00:${String(tick).padStart(2, "0")}.000Z`;
    }
  };
  const chamadas = [];
  let modo = "sucesso";
  const aplicarIdentidadeVisualOferta = async () => ({
    aplicada: true,
    imagemFinal: "https://img.example/vestida.png"
  });
  const dispatcher = async (entrada, deps) => {
    chamadas.push({ entrada, deps });
    assert.deepStrictEqual(Object.keys(entrada).sort(), ["clienteId", "destinosIds", "ofertaId"].sort());
    if (modo === "falha") {
      return {
        ok: false,
        ofertaId: entrada.ofertaId,
        enviados: 0,
        erros: 1,
        creditosDebitados: 0,
        resultados: [{
          destinoId: entrada.destinosIds[0],
          nome: "WA Ofertas",
          tipo: "whatsapp",
          status: "erro",
          enviadoEm: "",
          erro: "falha_mock",
          botToken: "NAO_SAIR"
        }]
      };
    }
    if (modo === "parcial") {
      return {
        ok: true,
        ofertaId: entrada.ofertaId,
        enviados: 1,
        erros: 1,
        creditosDebitados: 1,
        resultados: [
          {
            destinoId: "wa_ok",
            nome: "WA Ofertas",
            tipo: "whatsapp",
            status: "enviado",
            enviadoEm: "2026-08-15T12:30:00.000Z",
            erro: ""
          },
          {
            destinoId: "tg_ok",
            nome: "TG Ofertas",
            tipo: "telegram",
            status: "erro",
            enviadoEm: "",
            erro: "falha_tg_mock",
            token: "NAO_SAIR"
          }
        ]
      };
    }
    if (modo === "discord_sucesso") {
      return {
        ok: true,
        ofertaId: entrada.ofertaId,
        enviados: 1,
        erros: 0,
        creditosDebitados: 1,
        resultados: [{
          destinoId: "dc_ok",
          nome: "Discord Ofertas",
          tipo: "discord",
          status: "enviado",
          enviadoEm: "2026-08-15T12:40:00.000Z",
          erro: "",
          messageId: "discord_msg_123",
          statusHttp: 200,
          imagemEnviada: true,
          headers: { Authorization: "Bot NAO_SAIR" },
          payloadBruto: { token: "NAO_SAIR" }
        }]
      };
    }
    if (modo === "discord_sem_message_id") {
      return {
        ok: true,
        ofertaId: entrada.ofertaId,
        enviados: 1,
        erros: 0,
        creditosDebitados: 1,
        resultados: [{
          destinoId: "dc_ok",
          nome: "Discord Ofertas",
          tipo: "discord",
          status: "enviado",
          enviadoEm: "2026-08-15T12:41:00.000Z",
          erro: "",
          messageId: "",
          statusHttp: 200,
          imagemEnviada: true
        }]
      };
    }
    if (modo === "discord_204") {
      return {
        ok: true,
        ofertaId: entrada.ofertaId,
        enviados: 1,
        erros: 0,
        creditosDebitados: 1,
        resultados: [{
          destinoId: "dc_ok",
          nome: "Discord Ofertas",
          tipo: "discord",
          status: "enviado",
          enviadoEm: "2026-08-15T12:42:00.000Z",
          erro: "",
          messageId: "",
          statusHttp: 204,
          imagemEnviada: false
        }]
      };
    }
    if (modo === "discord_channel_divergente") {
      return {
        ok: false,
        ofertaId: entrada.ofertaId,
        enviados: 0,
        erros: 1,
        creditosDebitados: 0,
        resultados: [{
          destinoId: "dc_ok",
          nome: "Discord Ofertas",
          tipo: "discord",
          status: "erro",
          enviadoEm: "",
          erro: "discord_channel_resposta_divergente",
          statusHttp: 200
        }]
      };
    }
    if (modo === "bloqueado") {
      return new Promise((resolve) => {
        if (sinalizarDispatcherIniciado) sinalizarDispatcherIniciado();
        liberarDispatcher = () => resolve({
          ok: true,
          ofertaId: entrada.ofertaId,
          enviados: 1,
          erros: 0,
          creditosDebitados: 1,
          resultados: [{
            destinoId: entrada.destinosIds[0],
            nome: "WA Ofertas",
            tipo: "whatsapp",
            status: "enviado",
            enviadoEm: "2026-08-15T12:20:00.000Z",
            erro: ""
          }]
        });
      });
    }
    return {
      ok: true,
      ofertaId: entrada.ofertaId,
      enviados: 1,
      erros: 0,
      creditosDebitados: 1,
      resultados: [{
        destinoId: entrada.destinosIds[0],
        nome: "WA Ofertas",
        tipo: "whatsapp",
        status: "enviado",
        enviadoEm: "2026-08-15T12:20:00.000Z",
        erro: "",
        secret: "NAO_SAIR"
      }]
    };
  };

  const server = await ouvir(criarApp(dispatcher, storageOptions, { aplicarIdentidadeVisualOferta }));
  try {
    {
      const oferta = criarOferta("cliente_a", "oferta_sucesso");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"],
        botToken: "frontend_nao_confiavel",
        chatId: "frontend_nao_confiavel"
      });

      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.oferta.status, "enviada");
      assert.ok(resposta.body.oferta.enviadoEm);
      assert.strictEqual(resposta.body.oferta.envioManual.creditosDebitados, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.enviados, 1);
      assert.strictEqual(
        chamadas[0].deps.aplicarIdentidadeVisualOferta,
        aplicarIdentidadeVisualOferta,
        "enviar agora deve encaminhar a dependencia oficial de Identidade Visual ao dispatcher"
      );
      assertSemSegredos(resposta.body);

      const persistida = storage.buscarOfertaManualV2("cliente_a", oferta.id);
      assert.strictEqual(persistida.status, "enviada");
      assert.ok(persistida.enviadoEm);
      assert.strictEqual(persistida.envioManual.creditosDebitados, 1);
      assert.deepStrictEqual(persistida.envioManual.destinosEscolhidos.map((item) => item.id), ["wa_ok"]);
      assertSemSegredos(persistida);
    }

    {
      modo = "falha";
      const oferta = criarOferta("cliente_a", "oferta_falha");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"]
      });

      assert.strictEqual(resposta.status, 409);
      assert.strictEqual(resposta.body.ok, false);
      assert.strictEqual(resposta.body.oferta.status, "erro");
      assert.strictEqual(Boolean(resposta.body.oferta.enviadoEm), false);
      assert.strictEqual(resposta.body.oferta.envioManual.creditosDebitados, 0);
      assert.strictEqual(resposta.body.oferta.envioManual.enviados, 0);
      assert.strictEqual(resposta.body.oferta.envioManual.erros, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.erroResumo, "WA Ofertas: falha_mock");
      assertSemSegredos(resposta.body);
    }

    {
      modo = "parcial";
      const oferta = criarOferta("cliente_a", "oferta_parcial");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok", "tg_ok"]
      });

      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.oferta.status, "enviada");
      assert.strictEqual(resposta.body.oferta.envioManual.enviados, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.erros, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.creditosDebitados, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.erroResumo, "TG Ofertas: falha_tg_mock");
      assert.deepStrictEqual(resposta.body.oferta.envioManual.resultados.map((item) => item.status), ["enviado", "erro"]);
      assertSemSegredos(resposta.body);
      assertSemSegredos(storage.buscarOfertaManualV2("cliente_a", oferta.id));
    }

    {
      modo = "discord_sucesso";
      const oferta = criarOferta("cliente_a", "oferta_discord_sucesso");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["dc_ok"]
      });

      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.oferta.status, "enviada");
      assert.strictEqual(resposta.body.oferta.envioManual.enviados, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.creditosDebitados, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.resultados[0].messageId, "discord_msg_123");
      assert.strictEqual(resposta.body.oferta.envioManual.resultados[0].statusHttp, 200);
      assert.strictEqual(resposta.body.oferta.envioManual.resultados[0].imagemEnviada, true);
      assertSemSegredos(resposta.body);
    }

    {
      for (const [modoFalha, erroEsperado] of [
        ["discord_sem_message_id", "discord_resposta_sem_message_id"],
        ["discord_204", "discord_resposta_sem_message_id"],
        ["discord_channel_divergente", "discord_channel_resposta_divergente"]
      ]) {
        modo = modoFalha;
        const oferta = criarOferta("cliente_a", `oferta_${modoFalha}`);
        const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
          destinosIds: ["dc_ok"]
        });
        const persistida = storage.buscarOfertaManualV2("cliente_a", oferta.id);

        assert.strictEqual(resposta.body.oferta.status, "erro", `${modoFalha} nao pode ir para historico`);
        assert.strictEqual(persistida.status, "erro");
        assert.strictEqual(Boolean(persistida.enviadoEm), false);
        assert.strictEqual(persistida.envioManual.enviados, 0);
        assert.strictEqual(persistida.envioManual.creditosDebitados, 0);
        assert.strictEqual(persistida.envioManual.resultados[0].status, "erro");
        assert.strictEqual(persistida.envioManual.resultados[0].erro, erroEsperado);
        assertSemSegredos(resposta.body);
        assertSemSegredos(persistida);
      }
    }

    {
      modo = "sucesso";
      const ofertaB = criarOferta("cliente_b", "oferta_cliente_b");
      const chamadasAntes = chamadas.length;
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${ofertaB.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"]
      });

      assert.strictEqual(resposta.status, 404);
      assert.strictEqual(chamadas.length, chamadasAntes);
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_enviando");
      storage.atualizarMetadadosEnvioManualV2("cliente_a", oferta.id, { status: "enviando" });
      const chamadasAntes = chamadas.length;
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"]
      });

      assert.strictEqual(resposta.status, 409);
      assert.strictEqual(resposta.body.motivo, "oferta_manual_v2_ja_enviando");
      assert.strictEqual(chamadas.length, chamadasAntes);
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_envio_concorrente");
      const chave = "f".repeat(64);
      const chamadasAntes = chamadas.length;
      modo = "bloqueado";
      const dispatcherIniciado = new Promise((resolve) => {
        sinalizarDispatcherIniciado = resolve;
      });
      const primeira = request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"]
      }, { "Idempotency-Key": chave });
      await dispatcherIniciado;
      assert.strictEqual(chamadas.length, chamadasAntes + 1, "somente a primeira requisicao pode iniciar o dispatcher");
      const segunda = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"]
      }, { "Idempotency-Key": chave });
      assert.strictEqual(segunda.status, 202);
      assert.strictEqual(segunda.body.idempotencyReplayed, true);
      assert.strictEqual(chamadas.length, chamadasAntes + 1, "retry concorrente nao pode iniciar segundo dispatcher");
      liberarDispatcher();
      const primeiraResposta = await primeira;
      assert.strictEqual(primeiraResposta.status, 200);
      modo = "sucesso";
      sinalizarDispatcherIniciado = null;
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_envio_indeterminado");
      const chave = "g".repeat(64);
      const reserva = storage.reservarEnvioManualV2Idempotente("cliente_a", oferta.id, chave, storageOptions);
      storage.iniciarProcessamentoEnvioManualV2Idempotente("cliente_a", oferta.id, reserva.oferta.idempotencia.enviar.attemptId, storageOptions);
      storage.atualizarMetadadosEnvioManualV2("cliente_a", oferta.id, {
        idempotenciaEnvio: { leaseExpiraEm: "2020-01-01T00:00:00.000Z" }
      }, storageOptions);
      const chamadasAntes = chamadas.length;
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"]
      }, { "Idempotency-Key": chave });
      assert.strictEqual(resposta.status, 409);
      assert.strictEqual(resposta.body.motivo, "manual_v2_envio_resultado_indeterminado");
      assert.strictEqual(chamadas.length, chamadasAntes, "resultado indeterminado nao pode iniciar dispatcher");
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_sem_destino");
      const chamadasAntes = chamadas.length;
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: []
      });

      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "manual_v2_destinos_obrigatorios");
      assert.strictEqual(chamadas.length, chamadasAntes);
      assert.strictEqual(storage.buscarOfertaManualV2("cliente_a", oferta.id).status, "salva");
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_power_off");
      const chamadasAntes = chamadas.length;
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_power_off"]
      });

      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "manual_v2_destino_indisponivel");
      assert.strictEqual(chamadas.length, chamadasAntes, "Power OFF nao deve chamar dispatcher");
      assert.strictEqual(storage.buscarOfertaManualV2("cliente_a", oferta.id).status, "salva", "Power OFF nao deve marcar enviando");
    }

    {
      assert.strictEqual(fs.existsSync(arquivoCliente("cliente_a", "fila.json")), false);
      assert.strictEqual(fs.existsSync(arquivoCliente("cliente_b", "fila.json")), false);
    }

    {
      const credenciaisShopee = { appId: "18362140789", secret: "segredo_shopee" };
      const credenciaisAli = { appKey: "ali_app", trackingId: "workspace_tracking", secret: "segredo_ali" };
      let integracoesAtuais = {};
      let enviosReais = 0;
      const serverReal = await ouvir(criarApp(enviarOfertaManualV2Real, storageOptions, {
        getIntegracaoCliente: (_clienteId, marketplace) => integracoesAtuais[marketplace] || null,
        enviarWhatsApp: async () => { enviosReais += 1; },
        montarMensagemOferta: (oferta) => `${oferta.titulo}\n${oferta.linkAfiliado || oferta.urlAfiliada}`,
        usuarioTemCreditos: () => true,
        debitarCreditos: () => true
      }));

      try {
        integracoesAtuais = { shopee: { credenciais: credenciaisShopee } };
        const ofertaShopeeOk = criarOferta("cliente_a", "oferta_shopee_workspace_ok", {
          marketplace: "shopee",
          urlOriginal: "https://shopee.com.br/product/111/222",
          urlAfiliada: "https://s.shopee.com.br/workspace-ok",
          afiliacaoWorkspaceVerificada: criarProvaAfiliacaoWorkspaceShopee({
            clienteId: "cliente_a",
            credenciais: credenciaisShopee,
            urlOriginal: "https://shopee.com.br/product/111/222",
            urlAfiliadaWorkspace: "https://s.shopee.com.br/workspace-ok",
            urlFinalExpandida: "https://shopee.com.br/product/111/222?mmp_pid=an_18362140789",
            papel: "produto",
            motivoConversao: "fixture_manual_route"
          })
        });
        const respostaShopeeOk = await request(serverReal, "POST", `/manual-v2/ofertas/${ofertaShopeeOk.id}/enviar-agora`, "cliente_a", {
          destinosIds: ["wa_ok"]
        });
        assert.strictEqual(respostaShopeeOk.status, 200);
        assert.strictEqual(respostaShopeeOk.body.ok, true);

        integracoesAtuais = {};
        const ofertaShopeeSemIntegracao = criarOferta("cliente_a", "oferta_shopee_sem_integracao", {
          marketplace: "shopee",
          urlOriginal: "https://shopee.com.br/product/111/333",
          urlAfiliada: "https://s.shopee.com.br/workspace-sem-integracao",
          afiliacaoWorkspaceVerificada: criarProvaAfiliacaoWorkspaceShopee({
            clienteId: "cliente_a",
            credenciais: credenciaisShopee,
            urlOriginal: "https://shopee.com.br/product/111/333",
            urlAfiliadaWorkspace: "https://s.shopee.com.br/workspace-sem-integracao",
            papel: "produto",
            motivoConversao: "fixture_manual_route"
          })
        });
        const respostaShopeeSemIntegracao = await request(serverReal, "POST", `/manual-v2/ofertas/${ofertaShopeeSemIntegracao.id}/enviar-agora`, "cliente_a", {
          destinosIds: ["wa_ok"]
        });
        assert.strictEqual(respostaShopeeSemIntegracao.status, 409);
        assert.strictEqual(respostaShopeeSemIntegracao.body.oferta.envioManual.motivoGlobal, "afiliacao_workspace_incompleta");
        assert.deepStrictEqual(respostaShopeeSemIntegracao.body.oferta.envioManual.resultados, []);
        assert.strictEqual(respostaShopeeSemIntegracao.body.oferta.envioManual.erroResumo, "Motivo: afiliacao_workspace_incompleta");

        integracoesAtuais = { aliexpress: { credenciais: credenciaisAli } };
        const ofertaAliOk = criarOferta("cliente_a", "oferta_ali_workspace_ok", {
          marketplace: "aliexpress",
          urlOriginal: "https://www.aliexpress.com/item/1005007871648777.html",
          urlAfiliada: "https://s.click.aliexpress.com/e/_workspaceOk",
          afiliacaoWorkspaceVerificada: criarProvaAfiliacaoWorkspaceAliExpress({
            clienteId: "cliente_a",
            credenciais: credenciaisAli,
            urlOriginal: "https://www.aliexpress.com/item/1005007871648777.html",
            urlAfiliadaWorkspace: "https://s.click.aliexpress.com/e/_workspaceOk",
            papel: "produto",
            conversaoStatus: "convertida",
            motivoConversao: "fixture_manual_route"
          })
        });
        const respostaAliOk = await request(serverReal, "POST", `/manual-v2/ofertas/${ofertaAliOk.id}/enviar-agora`, "cliente_a", {
          destinosIds: ["wa_ok"]
        });
        assert.strictEqual(respostaAliOk.status, 200);
        assert.strictEqual(respostaAliOk.body.ok, true);

        integracoesAtuais = {};
        const ofertaAliSemIntegracao = criarOferta("cliente_a", "oferta_ali_sem_integracao", {
          marketplace: "aliexpress",
          urlOriginal: "https://www.aliexpress.com/item/1005007871648778.html",
          urlAfiliada: "https://s.click.aliexpress.com/e/_workspaceSemIntegracao",
          afiliacaoWorkspaceVerificada: criarProvaAfiliacaoWorkspaceAliExpress({
            clienteId: "cliente_a",
            credenciais: credenciaisAli,
            urlOriginal: "https://www.aliexpress.com/item/1005007871648778.html",
            urlAfiliadaWorkspace: "https://s.click.aliexpress.com/e/_workspaceSemIntegracao",
            papel: "produto",
            conversaoStatus: "convertida",
            motivoConversao: "fixture_manual_route"
          })
        });
        const respostaAliSemIntegracao = await request(serverReal, "POST", `/manual-v2/ofertas/${ofertaAliSemIntegracao.id}/enviar-agora`, "cliente_a", {
          destinosIds: ["wa_ok"]
        });
        assert.strictEqual(respostaAliSemIntegracao.status, 409);
        assert.strictEqual(respostaAliSemIntegracao.body.oferta.envioManual.motivoGlobal, "afiliacao_workspace_incompleta");
        assert.deepStrictEqual(respostaAliSemIntegracao.body.oferta.envioManual.resultados, []);
        assert.strictEqual(respostaAliSemIntegracao.body.oferta.envioManual.erroResumo, "Motivo: afiliacao_workspace_incompleta");
        assert.strictEqual(enviosReais, 2, "somente ofertas com integracao valida devem chegar ao sender");
      } finally {
        await new Promise((resolve) => serverReal.close(resolve));
      }
    }

    {
      const fonte = fs.readFileSync(
        path.join(__dirname, "..", "modules", "manual-v2", "manual-offers.routes.js"),
        "utf8"
      );
      const proibidos = [
        "utils/fila-ofertas",
        "processarFila",
        "adicionarOfertaInicioFila",
        "prepararOfertaGlobal",
        "enviarParaDestinoInteligente",
        "enviarOfertaAgoraDireto",
        "enviarCampanhaManual",
        "Engine",
        "Radar",
        "Distributor",
        "Oferta Universal",
        "fila.json",
        "/enviar-manual"
      ];
      for (const termo of proibidos) {
        assert.ok(!fonte.includes(termo), `rota Manual V2 envio nao pode referenciar ${termo}`);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("manual-v2-send-route.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
