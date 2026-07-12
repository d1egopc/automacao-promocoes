const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-instagram-"));
process.env.DATA_DIR = dataDir;
process.env.INSTAGRAM_APP_ID = "app_optimus";
process.env.INSTAGRAM_APP_SECRET = "secret_optimus";
process.env.INSTAGRAM_REDIRECT_URI = "https://api.optimus.test/social/instagram/callback";
process.env.INSTAGRAM_OAUTH_STATE_SECRET = "state_secret_optimus";

const instagram = require("../modules/social/instagram");
const socialStorage = require("../modules/social/storage");
const { writeClienteJson } = require("../utils/storage");
const routesFonte = fs.readFileSync(path.join(__dirname, "..", "modules", "social", "routes.js"), "utf8");
const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const POLLING_TESTE = { primeiraEsperaMs: 0, intervaloMs: 0, maxTentativas: 3 };

function clienteFile(clienteId, arquivo) {
  return path.join(dataDir, "clientes", clienteId, arquivo);
}

function mockHttpClient(opcoes = {}) {
  const chamadas = [];
  const statuses = Array.isArray(opcoes.statusesContainer) && opcoes.statusesContainer.length
    ? [...opcoes.statusesContainer]
    : ["FINISHED"];
  return {
    chamadas,
    async post(url, body, config) {
      chamadas.push({ metodo: "post", url, body, config });
      if (url.endsWith("/media")) {
        if (opcoes.erroContainer) {
          const erro = new Error("meta_container_falhou");
          erro.response = { data: { error: { message: "Container recusado pela Meta", code: 190, type: "OAuthException" } } };
          throw erro;
        }
        return { data: { id: `container_${opcoes.sufixo || "token"}` } };
      }
      if (url.endsWith("/media_publish")) {
        if (opcoes.erroPublish) {
          const erro = new Error("meta_publish_falhou");
          erro.response = { data: { error: { message: "Publicacao recusada pela Meta", code: 10, type: "OAuthException" } } };
          throw erro;
        }
        return { data: { id: `media_${opcoes.sufixo || "token"}` } };
      }
      if (opcoes.erroTokenCurto) throw new Error("token_curto_falhou");
      return {
        data: {
          access_token: `short_${opcoes.sufixo || "token"}`,
          token_type: "bearer"
        }
      };
    },
    async get(url, config) {
      chamadas.push({ metodo: "get", url, config });
      if (url.includes("graph.instagram.com/container_")) {
        const status = statuses.length > 1 ? statuses.shift() : statuses[0];
        return {
          data: {
            status_code: status,
            status: status === "ERROR" ? "Container recusado pela Meta" : status
          }
        };
      }
      if (url.endsWith("/access_token")) {
        if (opcoes.erroTokenLongo) throw new Error("token_longo_falhou");
        return {
          data: {
            access_token: `long_${opcoes.sufixo || "token"}`,
            token_type: "bearer",
            expires_in: 5184000
          }
        };
      }
      if (url.endsWith("/me")) {
        if (opcoes.erroMe) throw new Error("me_falhou");
        return {
          data: {
            user_id: `ig_${opcoes.sufixo || "user"}`,
            username: `optimus_${opcoes.sufixo || "user"}`,
            account_type: "BUSINESS",
            profile_picture_url: "https://cdn.optimus.test/profile.jpg"
          }
        };
      }
      throw new Error(`url_inesperada:${url}`);
    }
  };
}

async function conectarCliente(clienteId, sufixo = clienteId) {
  const inicio = instagram.iniciarConexaoInstagram({ clienteId });
  const httpClient = mockHttpClient({ sufixo });
  const conexao = await instagram.concluirCallbackInstagram({
    code: `code_${sufixo}`,
    state: inicio.state,
    httpClient
  });
  return { inicio, httpClient, conexao };
}

function salvarFilaCliente(clienteId, itens) {
  writeClienteJson(clienteId, "fila.json", itens.map(item => ({
    clienteId,
    marketplace: "amazon",
    titulo: "Echo Dot 5",
    precoAtual: 199.9,
    precoOriginal: 299.9,
    cupom: "PROMO10",
    imagem: "https://cdn.optimus.test/echo.jpg",
    linkAfiliado: `https://go.optimus.test/${clienteId}/echo`,
    ofertaUniversal: true,
    versaoOfertaUniversal: "v2-oficial",
    ...item
  })));
}

(async () => {
  const inicio = instagram.iniciarConexaoInstagram({ clienteId: "cliente_a" });
  const estado = instagram.decodificarStateInstagram(inicio.state);
  assert.strictEqual(estado.clienteId, "cliente_a", "state deve carregar clienteId");
  assert.ok(estado.nonce, "state deve carregar nonce");
  assert.ok(estado.exp > Date.now(), "state deve carregar expiracao");
  assert.ok(inicio.authUrl.startsWith("https://www.instagram.com/oauth/authorize?"));
  assert.ok(inicio.authUrl.includes("client_id=app_optimus"));
  assert.ok(inicio.authUrl.includes("force_reauth=true"));
  assert.strictEqual(
    new URL(inicio.authUrl).searchParams.get("scope"),
    "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages"
  );
  assert.ok(!inicio.authUrl.includes("client_secret"));

  await assert.rejects(
    () => instagram.concluirCallbackInstagram({ code: "", state: inicio.state, httpClient: mockHttpClient() }),
    /code_ausente/
  );

  const expiradoPayload = Buffer.from(JSON.stringify({
    clienteId: "cliente_a",
    nonce: "nonce_expirado",
    exp: Date.now() - 1000
  })).toString("base64url");
  const crypto = require("crypto");
  const assinaturaExpirada = crypto
    .createHmac("sha256", process.env.INSTAGRAM_OAUTH_STATE_SECRET)
    .update(expiradoPayload)
    .digest("base64url");
  assert.throws(
    () => instagram.decodificarStateInstagram(`${expiradoPayload}.${assinaturaExpirada}`),
    /state_expirado/
  );

  const conectadoA = await instagram.concluirCallbackInstagram({
    code: "code_cliente_a",
    state: inicio.state,
    httpClient: mockHttpClient({ sufixo: "cliente_a" })
  });
  assert.strictEqual(conectadoA.conectado, true);
  assert.strictEqual(conectadoA.instagramUserId, "ig_cliente_a");
  assert.strictEqual(conectadoA.username, "optimus_cliente_a");
  assert.strictEqual(conectadoA.accountType, "BUSINESS");
  assert.ok(conectadoA.token.accessToken.startsWith("long_"));
  assert.deepStrictEqual(conectadoA.scopes, ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments", "instagram_business_manage_messages"]);

  await assert.rejects(
    () => instagram.concluirCallbackInstagram({
      code: "code_replay",
      state: inicio.state,
      httpClient: mockHttpClient({ sufixo: "replay" })
    }),
    /instagram_state_reutilizado/
  );

  const inicioErroToken = instagram.iniciarConexaoInstagram({ clienteId: "cliente_erro_token" });
  await assert.rejects(
    () => instagram.concluirCallbackInstagram({
      code: "code_erro",
      state: inicioErroToken.state,
      httpClient: mockHttpClient({ erroTokenCurto: true })
    }),
    /troca_token_falhou/
  );

  const inicioErroMe = instagram.iniciarConexaoInstagram({ clienteId: "cliente_erro_me" });
  await assert.rejects(
    () => instagram.concluirCallbackInstagram({
      code: "code_erro_me",
      state: inicioErroMe.state,
      httpClient: mockHttpClient({ erroMe: true })
    }),
    /consulta_conta_falhou/
  );

  const env = { ...process.env };
  delete process.env.INSTAGRAM_APP_ID;
  assert.throws(
    () => instagram.iniciarConexaoInstagram({ clienteId: "cliente_sem_config" }),
    /instagram_nao_configurado/
  );
  process.env.INSTAGRAM_APP_ID = env.INSTAGRAM_APP_ID;

  await conectarCliente("cliente_b", "cliente_b");
  const statusA = instagram.sanitizarConexaoInstagram(instagram.lerConexaoInstagram("cliente_a"));
  const statusB = instagram.sanitizarConexaoInstagram(instagram.lerConexaoInstagram("cliente_b"));
  assert.strictEqual(statusA.instagramUserId, "ig_cliente_a");
  assert.strictEqual(statusB.instagramUserId, "ig_cliente_b");
  assert.strictEqual(statusA.tokenPresente, true);
  assert.deepStrictEqual(statusA.scopes, ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments", "instagram_business_manage_messages"]);
  assert.ok(!Object.prototype.hasOwnProperty.call(statusA, "accessToken"), "status nao deve expor token");
  assert.ok(JSON.stringify(statusA).includes("long_") === false, "status nunca deve conter token");

  const persistido = JSON.parse(fs.readFileSync(clienteFile("cliente_a", "social-instagram.json"), "utf8"));
  assert.strictEqual(persistido.token.accessToken, "long_cliente_a");
  delete require.cache[require.resolve("../modules/social/instagram")];
  const instagramRecarregado = require("../modules/social/instagram");
  assert.strictEqual(instagramRecarregado.lerConexaoInstagram("cliente_a").instagramUserId, "ig_cliente_a");

  socialStorage.setConexaoMetaSocial("cliente_a", {
    conectado: true,
    token: { accessToken: "facebook_token" },
    facebook: { conectado: true, pageId: "page_1", pageName: "Pagina" },
    paginas: [{ id: "page_1", name: "Pagina", accessToken: "page_token", conectado: true }]
  });
  instagramRecarregado.limparConexaoInstagram("cliente_a");
  const instagramDesconectado = instagramRecarregado.sanitizarConexaoInstagram(
    instagramRecarregado.lerConexaoInstagram("cliente_a")
  );
  const metaDepois = socialStorage.getConexaoMetaSocial("cliente_a");
  assert.strictEqual(instagramDesconectado.conectado, false);
  assert.strictEqual(instagramDesconectado.tokenPresente, false);
  assert.strictEqual(metaDepois.token.accessToken, "facebook_token", "desconexao instagram nao remove Facebook");

  assert.ok(
    indexFonte.includes('(req.method === "GET" && req.path === "/social/instagram/callback")'),
    "callback instagram deve ser publico no auth global"
  );
  assert.ok(indexFonte.includes('erro: "Token inválido"'), "resposta Token inválido deve estar em UTF-8");
  assert.ok(!indexFonte.includes("Token invÃ"), "index.js nao deve manter Token invalido mojibake");
  assert.ok(routesFonte.includes('return res.json({\n        ok: true,\n        authUrl: inicio.authUrl\n      });'), "conectar deve retornar somente ok/authUrl");
  assert.ok(routesFonte.includes('return res.json(payloadStatusInstagram(lerConexaoInstagram(clienteId)));'), "status deve usar contrato sanitizado achatado");
  assert.ok(routesFonte.includes('return res.json({\n      ok: true,\n      conectado: false\n    });'), "desconectar deve retornar ok/conectado false");
  assert.ok(routesFonte.includes('router.post("/instagram/publicar"'), "rota publicar instagram deve existir");
  assert.ok(routesFonte.includes('router.get("/instagram/publicacoes"'), "rota listar publicacoes instagram deve existir");

  await assert.rejects(
    () => instagram.publicarImagemInstagram({
      clienteId: "cliente_sem_instagram",
      ofertaId: "oferta_1",
      templateId: "padrao-instagram",
      httpClient: mockHttpClient()
    }),
    /instagram_nao_conectado/
  );

  await conectarCliente("cliente_pub_a", "pub_a");
  await conectarCliente("cliente_pub_b", "pub_b");
  salvarFilaCliente("cliente_pub_a", [{ id: "oferta_pub_a" }]);
  salvarFilaCliente("cliente_pub_b", [{ id: "oferta_pub_b", linkAfiliado: "https://go.optimus.test/cliente_pub_b/item" }]);

  await assert.rejects(
    () => instagram.publicarImagemInstagram({
      clienteId: "cliente_pub_a",
      ofertaId: "nao_existe",
      templateId: "padrao-instagram",
      httpClient: mockHttpClient()
    }),
    /oferta_nao_encontrada/
  );
  await assert.rejects(
    () => instagram.publicarImagemInstagram({
      clienteId: "cliente_pub_a",
      ofertaId: "oferta_pub_b",
      templateId: "padrao-instagram",
      httpClient: mockHttpClient()
    }),
    /oferta_nao_encontrada/
  );

  await conectarCliente("cliente_sem_id_item", "sem_id_item");
  salvarFilaCliente("cliente_sem_id_item", [{ id: "oferta_sem_id_item", clienteId: undefined }]);
  const publicadaSemIdItem = await instagram.publicarImagemInstagram({
    clienteId: "cliente_sem_id_item",
    ofertaId: "oferta_sem_id_item",
    templateId: "padrao-instagram",
    httpClient: mockHttpClient({ sufixo: "sem_id_item" }),
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicadaSemIdItem.publicacao.status, "publicada");

  salvarFilaCliente("cliente_img_ausente", [{ id: "oferta_sem_imagem", imagem: "" }]);
  await conectarCliente("cliente_img_ausente", "img_ausente");
  await assert.rejects(
    () => instagram.publicarImagemInstagram({
      clienteId: "cliente_img_ausente",
      ofertaId: "oferta_sem_imagem",
      templateId: "padrao-instagram",
      httpClient: mockHttpClient()
    }),
    /imagem_ausente/
  );

  salvarFilaCliente("cliente_img_privada", [{ id: "oferta_img_privada", imagem: "http://localhost/imagem.jpg" }]);
  await conectarCliente("cliente_img_privada", "img_privada");
  await assert.rejects(
    () => instagram.publicarImagemInstagram({
      clienteId: "cliente_img_privada",
      ofertaId: "oferta_img_privada",
      templateId: "padrao-instagram",
      httpClient: mockHttpClient()
    }),
    /imagem_nao_publica/
  );

  const conexaoExpirada = instagram.lerConexaoInstagram("cliente_pub_a");
  writeClienteJson("cliente_pub_a", "social-instagram.json", {
    ...conexaoExpirada,
    token: {
      ...conexaoExpirada.token,
      expiresAt: "2000-01-01T00:00:00.000Z"
    }
  });
  await assert.rejects(
    () => instagram.publicarImagemInstagram({
      clienteId: "cliente_pub_a",
      ofertaId: "oferta_pub_a",
      templateId: "padrao-instagram",
      httpClient: mockHttpClient()
    }),
    /instagram_token_expirado/
  );

  await conectarCliente("cliente_pub_a", "pub_a2");
  const httpPublicada = mockHttpClient({ sufixo: "pub_a", statusesContainer: ["IN_PROGRESS", "FINISHED"] });
  const publicada = await instagram.publicarImagemInstagram({
    clienteId: "cliente_pub_a",
    ofertaId: "oferta_pub_a",
    templateId: "padrao-instagram",
    httpClient: httpPublicada,
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicada.publicacao.status, "publicada");
  assert.strictEqual(publicada.publicacao.instagramContainerId, "container_pub_a");
  assert.strictEqual(publicada.publicacao.instagramMediaId, "media_pub_a");
  assert.strictEqual(publicada.publicacao.linkAfiliadoPresente, true);
  assert.ok(!JSON.stringify(publicada.publicacao).includes("long_pub_a"), "publicacao sanitizada nao deve expor token");
  const primeiraConsultaStatus = httpPublicada.chamadas.findIndex(chamada => chamada.metodo === "get" && chamada.url.includes("/container_pub_a"));
  const chamadaPublish = httpPublicada.chamadas.findIndex(chamada => chamada.metodo === "post" && chamada.url.endsWith("/media_publish"));
  assert.ok(primeiraConsultaStatus >= 0, "status do container deve ser consultado");
  assert.ok(chamadaPublish > primeiraConsultaStatus, "media_publish deve ocorrer somente depois do status FINISHED");

  const duplicada = await instagram.publicarImagemInstagram({
    clienteId: "cliente_pub_a",
    ofertaId: "oferta_pub_a",
    templateId: "padrao-instagram",
    httpClient: mockHttpClient({ sufixo: "duplicada" })
  });
  assert.strictEqual(duplicada.duplicada, true, "clique duplicado deve retornar publicacao existente");
  assert.strictEqual(duplicada.publicacao.id, publicada.publicacao.id);

  salvarFilaCliente("cliente_meta_erro", [{ id: "oferta_meta_erro" }]);
  await conectarCliente("cliente_meta_erro", "meta_erro");
  const falhaMeta = await instagram.publicarImagemInstagram({
    clienteId: "cliente_meta_erro",
    ofertaId: "oferta_meta_erro",
    templateId: "padrao-instagram",
    httpClient: mockHttpClient({ erroContainer: true }),
    polling: POLLING_TESTE
  });
  assert.strictEqual(falhaMeta.publicacao.status, "erro");
  assert.strictEqual(falhaMeta.publicacao.erro.code, 190);
  assert.ok(!JSON.stringify(falhaMeta.publicacao).includes("accessToken"), "erro/listagem nao deve expor token");

  salvarFilaCliente("cliente_publish_erro", [{ id: "oferta_publish_erro" }]);
  await conectarCliente("cliente_publish_erro", "publish_erro");
  const falhaPublish = await instagram.publicarImagemInstagram({
    clienteId: "cliente_publish_erro",
    ofertaId: "oferta_publish_erro",
    templateId: "padrao-instagram",
    httpClient: mockHttpClient({ sufixo: "publish_erro", erroPublish: true }),
    polling: POLLING_TESTE
  });
  assert.strictEqual(falhaPublish.publicacao.status, "erro");
  assert.strictEqual(falhaPublish.publicacao.instagramContainerId, "container_publish_erro");
  assert.strictEqual(falhaPublish.publicacao.erro.code, 10);
  assert.ok(!JSON.stringify(falhaPublish.publicacao).includes("long_publish_erro"), "falha no publish nao deve expor token");

  salvarFilaCliente("cliente_container_error", [{ id: "oferta_container_error" }]);
  await conectarCliente("cliente_container_error", "container_error");
  const httpContainerError = mockHttpClient({ sufixo: "container_error", statusesContainer: ["ERROR"] });
  const falhaContainerError = await instagram.publicarImagemInstagram({
    clienteId: "cliente_container_error",
    ofertaId: "oferta_container_error",
    templateId: "padrao-instagram",
    httpClient: httpContainerError,
    polling: POLLING_TESTE
  });
  assert.strictEqual(falhaContainerError.publicacao.status, "erro");
  assert.strictEqual(falhaContainerError.publicacao.instagramContainerId, "container_container_error");
  assert.ok(falhaContainerError.publicacao.erro.message.includes("Container recusado"));
  assert.strictEqual(httpContainerError.chamadas.some(chamada => chamada.metodo === "post" && chamada.url.endsWith("/media_publish")), false);

  salvarFilaCliente("cliente_container_expired", [{ id: "oferta_container_expired" }]);
  await conectarCliente("cliente_container_expired", "container_expired");
  const falhaContainerExpired = await instagram.publicarImagemInstagram({
    clienteId: "cliente_container_expired",
    ofertaId: "oferta_container_expired",
    templateId: "padrao-instagram",
    httpClient: mockHttpClient({ sufixo: "container_expired", statusesContainer: ["EXPIRED"] }),
    polling: POLLING_TESTE
  });
  assert.strictEqual(falhaContainerExpired.publicacao.status, "erro");
  assert.strictEqual(falhaContainerExpired.publicacao.erro.message, "container_expirado");

  salvarFilaCliente("cliente_container_timeout", [{ id: "oferta_container_timeout" }]);
  await conectarCliente("cliente_container_timeout", "container_timeout");
  const httpTimeout = mockHttpClient({ sufixo: "container_timeout", statusesContainer: ["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS"] });
  const falhaTimeout = await instagram.publicarImagemInstagram({
    clienteId: "cliente_container_timeout",
    ofertaId: "oferta_container_timeout",
    templateId: "padrao-instagram",
    httpClient: httpTimeout,
    polling: POLLING_TESTE
  });
  assert.strictEqual(falhaTimeout.publicacao.status, "erro");
  assert.strictEqual(falhaTimeout.publicacao.erro.message, "processamento_midia_timeout");
  assert.strictEqual(httpTimeout.chamadas.filter(chamada => chamada.metodo === "get" && chamada.url.includes("/container_container_timeout")).length, 3);
  assert.strictEqual(httpTimeout.chamadas.some(chamada => chamada.metodo === "post" && chamada.url.endsWith("/media_publish")), false);

  const novaTentativa = await instagram.publicarImagemInstagram({
    clienteId: "cliente_container_timeout",
    ofertaId: "oferta_container_timeout",
    templateId: "padrao-instagram",
    httpClient: mockHttpClient({ sufixo: "container_timeout_retry", statusesContainer: ["FINISHED"] }),
    polling: POLLING_TESTE
  });
  assert.strictEqual(novaTentativa.publicacao.status, "publicada", "falha anterior deve permitir nova tentativa");

  const listaA = instagram.listarPublicacoesInstagram("cliente_pub_a");
  const listaB = instagram.listarPublicacoesInstagram("cliente_pub_b");
  assert.strictEqual(listaA.length, 1);
  assert.strictEqual(listaB.length, 0);
  assert.ok(!JSON.stringify(listaA).includes("long_"), "listagem nao deve expor token");
  assert.strictEqual(instagram.getPublicacaoInstagram("cliente_pub_a", publicada.publicacao.id).id, publicada.publicacao.id);
  assert.strictEqual(instagram.getPublicacaoInstagram("cliente_pub_b", publicada.publicacao.id), null, "cliente B nao ve publicacao do cliente A");

  console.log("social-instagram-fase-a: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
