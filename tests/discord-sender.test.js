const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DISCORD_MESSAGE_LIMIT,
  baixarImagemDiscord,
  enviarDiscord
} = require("../modules/discord/discord-sender");

const ENV = {
  DISCORD_BOT_TOKEN: "bot_token_nao_vaza",
  DISCORD_IMAGE_ALLOWED_HOSTS: "m.media-amazon.com,images-na.ssl-images-amazon.com,http2.mlstatic.com,cf.shopee.com.br,ae01.alicdn.com,images.kabum.com.br,a-static.mlcdn.com.br"
};

function criarHttp({ postStatus = 200, postData = {}, getData, getHeaders, postError, getError, getResponses = [] } = {}) {
  const chamadas = [];
  const respostas = getResponses.slice();
  return {
    chamadas,
    client: {
      async get(url, options) {
        chamadas.push({ metodo: "GET", url, options });
        if (getError) throw getError;
        if (respostas.length) {
          const proxima = respostas.shift();
          if (proxima.error) throw proxima.error;
          return proxima;
        }
        return {
          status: 200,
          data: getData || Buffer.from("imagem"),
          headers: getHeaders || { "content-type": "image/png", "content-length": "6" }
        };
      },
      async post(url, body, options) {
        chamadas.push({ metodo: "POST", url, body, options });
        if (postError) throw postError;
        return {
          status: postStatus,
          data: postData === null
            ? null
            : {
              id: "msg_123",
              timestamp: "2026-08-15T12:00:00.000Z",
              ...postData
            }
        };
      }
    }
  };
}

function erroHttp(status, data = {}, headers = {}) {
  const erro = new Error(`HTTP ${status}`);
  erro.response = { status, data, headers };
  return erro;
}

function textoJson(valor) {
  return JSON.stringify(valor);
}

function criarResolverPlatformVariables(valores = {}) {
  return async (nome) => {
    if (Object.prototype.hasOwnProperty.call(valores, nome)) {
      return {
        ok: true,
        source: "platform_variables",
        nome,
        value: valores[nome]
      };
    }
    return { ok: false, source: "missing", nome, value: null };
  };
}

(async () => {
  {
    const http = criarHttp();
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Oferta renderizada pelo Optimus",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, true, "Texto deve enviar com sucesso");
    assert.strictEqual(resultado.messageId, "msg_123");
    assert.strictEqual(resultado.imagemEnviada, false);
    assert.strictEqual(http.chamadas.length, 1);
    assert.ok(http.chamadas[0].url.endsWith("/channels/canal_1/messages"));
    assert.deepStrictEqual(http.chamadas[0].body, { content: "Oferta renderizada pelo Optimus" });
  }

  {
    const http = criarHttp({ postData: { id: "" } });
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Oferta sem id",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_resposta_sem_message_id");
    assert.strictEqual(resultado.statusHttp, 200);
  }

  {
    const http = criarHttp({ postStatus: 204, postData: null });
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Oferta sem corpo",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_resposta_sem_message_id");
    assert.strictEqual(resultado.statusHttp, 204);
  }

  {
    const http = criarHttp({ postStatus: 302 });
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Redirect inesperado",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_status_http_invalido");
    assert.strictEqual(resultado.statusHttp, 302);
  }

  {
    const http = criarHttp({ postData: { channel_id: "canal_errado" } });
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Canal divergente",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_channel_resposta_divergente");
    assert.strictEqual(resultado.statusHttp, 200);
  }

  {
    const http = criarHttp({ postData: { channel_id: "canal_1" } });
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Canal confirmado",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.messageId, "msg_123");
    assert.strictEqual(resultado.statusHttp, 200);
  }

  {
    const http = criarHttp();
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Oferta com imagem",
      imagemUrl: "https://m.media-amazon.com/produto.png",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, true, "Texto + imagem permitida deve enviar");
    assert.strictEqual(resultado.imagemEnviada, true);
    assert.strictEqual(http.chamadas[0].metodo, "GET");
    assert.strictEqual(http.chamadas[1].metodo, "POST");
  }

  {
    const http = criarHttp();
    const imagem = await baixarImagemDiscord({
      imagemUrl: "https://outro-host.test/produto.png",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(imagem.ok, false);
    assert.strictEqual(imagem.erro, "discord_imagem_url_invalida");
    assert.strictEqual(http.chamadas.length, 0, "Host fora da allowlist nao deve ser baixado");
  }

  {
    const hosts = [
      "https://m.media-amazon.com/produto.jpg",
      "https://images-na.ssl-images-amazon.com/produto.jpg",
      "https://http2.mlstatic.com/produto.jpg",
      "https://cf.shopee.com.br/produto.jpg",
      "https://ae01.alicdn.com/produto.jpg",
      "https://images.kabum.com.br/produto.jpg",
      "https://a-static.mlcdn.com.br/produto.jpg"
    ];
    for (const imagemUrl of hosts) {
      const http = criarHttp({ getHeaders: { "content-type": "image/jpeg", "content-length": "6" } });
      const imagem = await baixarImagemDiscord({ imagemUrl, env: ENV, httpClient: http.client });
      assert.strictEqual(imagem.ok, true, `Host comprovado deve ser permitido: ${imagemUrl}`);
      assert.strictEqual(http.chamadas.length, 1);
    }
  }

  {
    const http = criarHttp();
    const imagem = await baixarImagemDiscord({
      imagemUrl: "http://m.media-amazon.com/produto.png",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(imagem.ok, false);
    assert.strictEqual(imagem.erro, "discord_imagem_url_invalida");
    assert.strictEqual(http.chamadas.length, 0, "HTTP nao deve ser baixado");
  }

  {
    const http = criarHttp();
    const imagem = await baixarImagemDiscord({
      imagemUrl: "https://host-nao-comprovado.test/produto.png",
      env: { DISCORD_IMAGE_ALLOWED_HOSTS: "host-nao-comprovado.test,*" },
      httpClient: http.client
    });
    assert.strictEqual(imagem.ok, false);
    assert.strictEqual(imagem.erro, "discord_imagem_host_nao_permitido");
    assert.strictEqual(http.chamadas.length, 0, "Wildcard/host nao comprovado nao entram na allowlist efetiva");
  }

  {
    const http = criarHttp({
      getResponses: [
        { status: 302, data: Buffer.alloc(0), headers: { location: "https://images-na.ssl-images-amazon.com/final.jpg" } },
        { status: 200, data: Buffer.from("imagem"), headers: { "content-type": "image/jpeg", "content-length": "6" } }
      ]
    });
    const imagem = await baixarImagemDiscord({
      imagemUrl: "https://m.media-amazon.com/produto.jpg",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(imagem.ok, true, "Redirect para host permitido deve baixar imagem");
    assert.deepStrictEqual(http.chamadas.map((c) => c.url), [
      "https://m.media-amazon.com/produto.jpg",
      "https://images-na.ssl-images-amazon.com/final.jpg"
    ]);
  }

  {
    const http = criarHttp({
      getResponses: [
        { status: 302, data: Buffer.alloc(0), headers: { location: "https://evil.example/final.jpg" } }
      ]
    });
    const imagem = await baixarImagemDiscord({
      imagemUrl: "https://m.media-amazon.com/produto.jpg",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(imagem.ok, false);
    assert.strictEqual(imagem.erro, "discord_imagem_redirect_nao_permitido");
    assert.strictEqual(http.chamadas.length, 1, "Redirect para host nao permitido nao deve ser seguido");
  }

  {
    const http = criarHttp({ getHeaders: { "content-type": "text/html", "content-length": "12" } });
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Oferta",
      imagemUrl: "https://m.media-amazon.com/pagina.html",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_imagem_tipo_invalido");
    assert.strictEqual(http.chamadas.filter((c) => c.metodo === "POST").length, 0, "Imagem invalida nao envia texto por decisao automatica");
  }

  {
    const http = criarHttp({ getHeaders: { "content-type": "image/png", "content-length": String(9 * 1024 * 1024) } });
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Oferta",
      imagemUrl: "https://m.media-amazon.com/grande.png",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_imagem_muito_grande");
  }

  {
    const casos = [
      [403, "discord_sem_permissao"],
      [404, "discord_canal_nao_encontrado"],
      [500, "discord_api_indisponivel"]
    ];
    for (const [status, esperado] of casos) {
      const http = criarHttp({ postError: erroHttp(status) });
      const resultado = await enviarDiscord({
        channelId: "canal_1",
        mensagem: "Oferta",
        env: ENV,
        httpClient: http.client
      });
      assert.strictEqual(resultado.ok, false);
      assert.strictEqual(resultado.erro, esperado);
      assert.strictEqual(resultado.statusHttp, status);
    }
  }

  {
    const http = criarHttp({ postError: erroHttp(429, { retry_after: 1.5 }, { "retry-after": "1" }) });
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Oferta",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_rate_limit");
    assert.strictEqual(resultado.retryAfterMs, 1500);
  }

  {
    const http = criarHttp();
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "x".repeat(DISCORD_MESSAGE_LIMIT + 1),
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_mensagem_muito_longa");
    assert.strictEqual(http.chamadas.length, 0);
  }

  {
    const http = criarHttp();
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Oferta",
      env: { DISCORD_IMAGE_ALLOWED_HOSTS: "m.media-amazon.com" },
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_bot_token_ausente");
  }

  {
    const http = criarHttp();
    const resultado = await enviarDiscord({
      channelId: "",
      mensagem: "Oferta",
      env: ENV,
      httpClient: http.client
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_channel_id_ausente");
  }

  {
    const http = criarHttp();
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Oferta",
      env: ENV,
      httpClient: http.client,
      now: () => new Date("2026-08-15T15:00:00.000Z")
    });
    assert.ok(!textoJson(resultado).includes("bot_token_nao_vaza"));
    assert.ok(!textoJson(resultado).match(/Authorization|Bot /i));
  }

  {
    const http = criarHttp();
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Oferta via painel",
      env: {
        DISCORD_BOT_TOKEN: "bot_env_antigo",
        DISCORD_IMAGE_ALLOWED_HOSTS: "evil.example"
      },
      httpClient: http.client,
      getPlatformVariableImpl: criarResolverPlatformVariables({
        DISCORD_BOT_TOKEN: "bot_painel_nao_vaza",
        DISCORD_IMAGE_ALLOWED_HOSTS: "m.media-amazon.com"
      })
    });
    assert.strictEqual(resultado.ok, true);
    const post = http.chamadas.find((c) => c.metodo === "POST");
    assert.strictEqual(post.options.headers.Authorization, "Bot bot_painel_nao_vaza", "Bot token do painel deve ter precedencia sobre ENV");
    assert.ok(!textoJson(resultado).includes("bot_painel_nao_vaza"), "Resultado nao deve vazar bot token do painel");
  }

  {
    const http = criarHttp();
    const imagem = await baixarImagemDiscord({
      imagemUrl: "https://m.media-amazon.com/produto.png",
      env: { DISCORD_IMAGE_ALLOWED_HOSTS: "evil.example" },
      httpClient: http.client,
      getPlatformVariableImpl: criarResolverPlatformVariables({
        DISCORD_IMAGE_ALLOWED_HOSTS: "m.media-amazon.com,host-nao-comprovado.test,*"
      })
    });
    assert.strictEqual(imagem.ok, true, "Host comprovado vindo do painel deve ser permitido");

    const httpBloqueado = criarHttp();
    const imagemBloqueada = await baixarImagemDiscord({
      imagemUrl: "https://host-nao-comprovado.test/produto.png",
      env: { DISCORD_IMAGE_ALLOWED_HOSTS: "m.media-amazon.com" },
      httpClient: httpBloqueado.client,
      getPlatformVariableImpl: criarResolverPlatformVariables({
        DISCORD_IMAGE_ALLOWED_HOSTS: "host-nao-comprovado.test,*"
      })
    });
    assert.strictEqual(imagemBloqueada.ok, false, "Painel nao pode ampliar allowlist alem dos hosts comprovados");
    assert.strictEqual(imagemBloqueada.erro, "discord_imagem_host_nao_permitido");
    assert.strictEqual(httpBloqueado.chamadas.length, 0);
  }

  {
    const http = criarHttp();
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Fallback ENV",
      env: ENV,
      httpClient: http.client,
      getPlatformVariableImpl: criarResolverPlatformVariables({})
    });
    assert.strictEqual(resultado.ok, true, "ENV deve seguir como fallback temporario");
    const post = http.chamadas.find((c) => c.metodo === "POST");
    assert.strictEqual(post.options.headers.Authorization, `Bot ${ENV.DISCORD_BOT_TOKEN}`);
  }

  {
    const http = criarHttp();
    const resultado = await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Sem token",
      env: {},
      httpClient: http.client,
      getPlatformVariableImpl: criarResolverPlatformVariables({})
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "discord_bot_token_ausente");
    assert.strictEqual(http.chamadas.length, 0, "Ausencia de painel e ENV deve falhar sem chamar Discord");
  }

  {
    const http = criarHttp();
    let tokenAtual = "bot_runtime_1";
    const resolverRuntime = async (nome) => {
      if (nome === "DISCORD_BOT_TOKEN") {
        return { ok: true, source: "platform_variables", nome, value: tokenAtual };
      }
      return { ok: false, source: "missing", nome, value: null };
    };
    await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Runtime 1",
      env: {},
      httpClient: http.client,
      getPlatformVariableImpl: resolverRuntime
    });
    tokenAtual = "bot_runtime_2";
    await enviarDiscord({
      channelId: "canal_1",
      mensagem: "Runtime 2",
      env: {},
      httpClient: http.client,
      getPlatformVariableImpl: resolverRuntime
    });
    const autorizacoes = http.chamadas
      .filter((c) => c.metodo === "POST")
      .map((c) => c.options.headers.Authorization);
    assert.deepStrictEqual(autorizacoes, ["Bot bot_runtime_1", "Bot bot_runtime_2"], "Mudanca runtime do token deve valer sem restart");
  }

  {
    const fonte = fs.readFileSync(path.resolve(__dirname, "../modules/discord/discord-sender.js"), "utf8");
    assert.ok(!/processarFila|adicionarOfertaInicioFila|prepararOfertaGlobal|Distributor|Radar|Engine|Oferta Universal|manual-v2|manual-dispatcher|credit/i.test(fonte), "Sender Discord deve permanecer primitivo e isolado");
  }

  console.log("discord-sender.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
