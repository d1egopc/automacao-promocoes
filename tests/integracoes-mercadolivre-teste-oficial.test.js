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
        cookies: "cookie-funcional-sem-validacao-paralela"
      },
      urlTeste: "https://produto.mercadolivre.com.br/MLB-123456-produto-teste-_JM"
    },
    {
      getIntegracaoCliente: (clienteId, marketplace) => {
        assert.strictEqual(clienteId, "cliente_ml");
        assert.strictEqual(marketplace, "mercadolivre");
        return { credenciais: { cookies: "cookie-funcional-sem-validacao-paralela" } };
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

  const semTagMasImportadorOk = await testarIntegracaoMarketplace(
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

  assert.strictEqual(semTagMasImportadorOk.ok, true, "não deve falhar por tag ausente antes do importador");
  assert.strictEqual(semTagMasImportadorOk.status, "ok");

  const falhaImportador = await testarIntegracaoMarketplace(
    "cliente_ml_falha",
    "mercadolivre",
    { credenciais: { cookies: "cookie" } },
    {
      getIntegracaoCliente: () => ({ credenciais: { cookies: "cookie" } }),
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

  const semImportador = await testarIntegracaoMarketplace("cliente_ml_sem_importador", "mercadolivre", {});
  assert.strictEqual(semImportador.ok, false);
  assert.strictEqual(semImportador.status, "importador_ml_indisponivel");

  console.log("integracoes-mercadolivre-teste-oficial: ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
