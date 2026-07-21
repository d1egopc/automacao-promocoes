const assert = require("assert");

const { testarIntegracaoMarketplace } = require("../utils/testar-integracao-marketplace");

(async () => {
  let chamadasImportador = 0;
  let recebeuDepsOficiais = false;

  const sucesso = await testarIntegracaoMarketplace(
    "cliente_ml",
    "mercadolivre",
    {
      credenciais: {
        cookies: "cookie-funcional-sem-validacao-paralela",
        tag: "tag-oficial"
      },
      urlTeste: "https://produto.mercadolivre.com.br/MLB-123456-produto-teste-_JM"
    },
    {
      getIntegracaoCliente: (clienteId, marketplace) => {
        assert.strictEqual(clienteId, "cliente_ml");
        assert.strictEqual(marketplace, "mercadolivre");
        return { credenciais: { cookies: "cookie-funcional-sem-validacao-paralela", tag: "tag-oficial" } };
      },
      gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/oficial",
      importarMercadoLivre: async (url, clienteId, deps) => {
        chamadasImportador += 1;
        assert.strictEqual(url, "https://produto.mercadolivre.com.br/MLB-123456-produto-teste-_JM");
        assert.strictEqual(clienteId, "cliente_ml");
        recebeuDepsOficiais =
          typeof deps.getIntegracaoCliente === "function" &&
          typeof deps.gerarLinkAfiliadoMercadoLivre === "function";
        return {
          titulo: "Produto Mercado Livre",
          precoAtual: "199,90",
          imagem: "https://http2.mlstatic.com/teste.jpg",
          linkAfiliado: "https://meli.la/oficial"
        };
      }
    }
  );

  assert.strictEqual(chamadasImportador, 1, "deve chamar o importador oficial uma única vez");
  assert.strictEqual(recebeuDepsOficiais, true, "deve repassar dependências oficiais ao importador");
  assert.strictEqual(sucesso.ok, true);
  assert.strictEqual(sucesso.status, "ok");
  assert.strictEqual(sucesso.detalhes.origem, "importador_oficial");

  const semTagNaoTestaFluxo = await testarIntegracaoMarketplace(
    "cliente_ml_sem_tag",
    "mercadolivre",
    { credenciais: { cookies: "cookie-existe" } },
    {
      getIntegracaoCliente: () => ({ credenciais: { cookies: "cookie-existe" } }),
      gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/sem-tag",
      importarMercadoLivre: async () => ({
        titulo: "Produto",
        precoAtual: "99,90",
        linkAfiliado: "https://meli.la/sem-tag"
      })
    }
  );

  assert.strictEqual(semTagNaoTestaFluxo.ok, false, "Tag ID ausente nao comprova fluxo oficial");
  assert.strictEqual(semTagNaoTestaFluxo.status, "tag_ausente");

  const falhaImportador = await testarIntegracaoMarketplace(
    "cliente_ml_falha",
    "mercadolivre",
    { credenciais: { cookies: "cookie", tag: "tag-oficial" } },
    {
      getIntegracaoCliente: () => ({ credenciais: { cookies: "cookie", tag: "tag-oficial" } }),
      gerarLinkAfiliadoMercadoLivre: async () => "",
      importarMercadoLivre: async () => ({
        titulo: "Produto",
        motivo: "cookie_invalido_retorno_importador",
        linkAfiliado: ""
      })
    }
  );

  assert.strictEqual(falhaImportador.ok, false);
  assert.strictEqual(falhaImportador.status, "cookie_invalido_retorno_importador");
  assert.strictEqual(falhaImportador.mensagem, "cookie_invalido_retorno_importador");

  let geradorTentadoComCookieAleatorio = false;
  const cookieAleatorioSemAfiliado = await testarIntegracaoMarketplace(
    "cliente_ml_cookie_aleatorio",
    "mercadolivre",
    {
      credenciais: {
        cookies: "fdfdfdfdfds43343ererererer",
        tag: "optimus-teste"
      },
      urlTeste: "https://www.mercadolivre.com.br/produto-publico-teste"
    },
    {
      getIntegracaoCliente: () => ({
        credenciais: {
          cookies: "fdfdfdfdfds43343ererererer",
          tag: "optimus-teste"
        }
      }),
      gerarLinkAfiliadoMercadoLivre: async () => {
        geradorTentadoComCookieAleatorio = true;
        return "";
      },
      importarMercadoLivre: async (url, clienteId, deps) => {
        const linkGerado = await deps.gerarLinkAfiliadoMercadoLivre(url, {}, { clienteId });
        return {
          titulo: "Produto publico Mercado Livre",
          precoAtual: "299,90",
          linkOriginal: url,
          urlFinal: url,
          link: url,
          linkAfiliado: linkGerado,
          linkFinal: linkGerado
        };
      }
    }
  );

  assert.strictEqual(geradorTentadoComCookieAleatorio, true, "deve tentar o gerador oficial");
  assert.strictEqual(cookieAleatorioSemAfiliado.ok, false);
  assert.strictEqual(cookieAleatorioSemAfiliado.status, "link_afiliado_ausente");
  assert.strictEqual(cookieAleatorioSemAfiliado.detalhes.temTitulo, true);
  assert.strictEqual(cookieAleatorioSemAfiliado.detalhes.temPreco, true);

  const linkPublicoNoCampoAfiliado = await testarIntegracaoMarketplace(
    "cliente_ml_link_publico",
    "mercadolivre",
    {
      credenciais: {
        cookies: "cookie",
        tag: "optimus-teste"
      },
      urlTeste: "https://www.mercadolivre.com.br/produto-publico-teste"
    },
    {
      getIntegracaoCliente: () => ({ credenciais: { cookies: "cookie", tag: "optimus-teste" } }),
      gerarLinkAfiliadoMercadoLivre: async () => "https://www.mercadolivre.com.br/produto-publico-teste",
      importarMercadoLivre: async (url) => ({
        titulo: "Produto publico Mercado Livre",
        precoAtual: "299,90",
        linkOriginal: url,
        urlFinal: url,
        linkAfiliado: url,
        linkFinal: url
      })
    }
  );

  assert.strictEqual(linkPublicoNoCampoAfiliado.ok, false, "link publico nao comprova afiliacao");
  assert.strictEqual(linkPublicoNoCampoAfiliado.status, "link_afiliado_ausente");

  const semImportador = await testarIntegracaoMarketplace(
    "cliente_ml_sem_importador",
    "mercadolivre",
    { credenciais: { cookies: "cookie", tag: "tag-oficial" } }
  );
  assert.strictEqual(semImportador.ok, false);
  assert.strictEqual(semImportador.status, "importador_ml_indisponivel");

  console.log("integracoes-mercadolivre-teste-oficial: ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
