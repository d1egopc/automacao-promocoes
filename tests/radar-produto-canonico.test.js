const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadComAxiosMock(request, parent, isMain) {
  if (request === "axios") return { get: async () => ({ status: 204, data: "" }) };
  return originalLoad.call(this, request, parent, isMain);
};

const {
  camposIdentidadeCanonicaOferta,
  compararIdentidadeCanonicaOfertas,
  extrairProdutoIdKabumUrl,
  resolverIdentidadeCanonicaOferta
} = require("../modules/radar/produto-canonico");

const {
  resolverRedirectUniversal
} = require("../modules/radar/redirect/redirect-resolver");

function criarHttpClientRedirect(urlFinal) {
  return {
    get: async (url) => ({
      status: 200,
      data: "",
      config: { url },
      request: {
        res: { responseUrl: urlFinal },
        _redirectable: { _currentUrl: urlFinal }
      }
    })
  };
}

function criarHttpClientSemDestino() {
  return {
    get: async (url) => ({
      status: 200,
      data: "<html><body>sem destino comprovado</body></html>",
      config: { url },
      request: {
        res: { responseUrl: url },
        _redirectable: { _currentUrl: url }
      }
    })
  };
}

async function testarIdentidadeKabumDireto() {
  const identidade = resolverIdentidadeCanonicaOferta({
    marketplace: "kabum",
    urlOriginal: "https://www.kabum.com.br/produto/944475/produto-teste?utm=abc"
  });

  assert.strictEqual(extrairProdutoIdKabumUrl("https://www.kabum.com.br/produto/944475/produto-teste"), "944475");
  assert.strictEqual(identidade.marketplaceCanonico, "kabum");
  assert.strictEqual(identidade.produtoIdCanonico, "944475");
  assert.strictEqual(identidade.chaveCanonica, "kabum:944475");
}

async function testarAwinKabum() {
  const destino = encodeURIComponent("https://www.kabum.com.br/produto/944475/produto-teste");
  const awin1 = `https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1062989&clickref=a&ued=${destino}`;
  const awin2 = `https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1062989&clickref=b&ued=${destino}`;

  assert.strictEqual(resolverIdentidadeCanonicaOferta({ urlOriginal: awin1 }).chaveCanonica, "kabum:944475");
  assert.strictEqual(resolverIdentidadeCanonicaOferta({ urlOriginal: awin2 }).chaveCanonica, "kabum:944475");
}

async function testarAOfertaResolvido() {
  const resultado = await resolverRedirectUniversal("https://aoferta.net/000RgjaE-Kabum", {
    httpClient: criarHttpClientRedirect("https://www.kabum.com.br/produto/944475/produto-teste")
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.chaveCanonica, "kabum:944475");
  assert.strictEqual(resultado.produtoIdCanonico, "944475");
  assert.strictEqual(resultado.marketplaceCanonico, "kabum");
}

async function testarAOfertaProdutoDiferente() {
  const resultado = await resolverRedirectUniversal("https://aoferta.net/001snQan-Kabum", {
    httpClient: criarHttpClientRedirect("https://www.kabum.com.br/produto/123456/outro-produto")
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.chaveCanonica, "kabum:123456");
  assert.notStrictEqual(resultado.chaveCanonica, "kabum:944475");
}

async function testarAOfertaSemUrlFinal() {
  const resultado = await resolverRedirectUniversal("https://aoferta.net/semfinal-Kabum", {
    httpClient: criarHttpClientSemDestino()
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.chaveCanonica || "", "");
  assert.strictEqual(resultado.produtoIdCanonico || "", "");
}

function testarDuplicidadeCanonica() {
  const nova = {
    marketplace: "awin",
    titulo: "Produto teste",
    preco: "R$ 100,00",
    chaveCanonica: "kabum:944475",
    linkAfiliado: "https://www.awin1.com/cread.php?clickref=novo"
  };
  const existente = {
    marketplace: "awin",
    titulo: "Produto teste",
    preco: "R$ 100,00",
    chaveCanonica: "kabum:944475",
    linkAfiliado: "https://www.awin1.com/cread.php?clickref=antigo"
  };
  const diferente = {
    marketplace: "awin",
    titulo: "Produto teste",
    preco: "R$ 100,00",
    chaveCanonica: "kabum:123456"
  };

  assert.deepStrictEqual(
    compararIdentidadeCanonicaOfertas(nova, existente),
    {
      duplicada: true,
      motivo: "mesma_chave_canonica",
      ambasCanonicas: true,
      chaveCanonica: "kabum:944475",
      chaveNova: "kabum:944475",
      chaveExistente: "kabum:944475"
    }
  );

  const comparacaoDiferente = compararIdentidadeCanonicaOfertas(nova, diferente);
  assert.strictEqual(comparacaoDiferente.duplicada, false);
  assert.strictEqual(comparacaoDiferente.ambasCanonicas, true);
  assert.strictEqual(comparacaoDiferente.motivo, "chave_canonica_diferente");
}

function testarFallbackLegadoERegressoes() {
  assert.strictEqual(resolverIdentidadeCanonicaOferta({ urlOriginal: "https://www.mercadolivre.com.br/produto/teste" }).chaveCanonica, "");
  assert.strictEqual(resolverIdentidadeCanonicaOferta({ urlOriginal: "https://www.amazon.com.br/dp/B000TESTE" }).chaveCanonica, "");
  assert.strictEqual(resolverIdentidadeCanonicaOferta({ urlOriginal: "https://shopee.com.br/produto-i.123.456" }).chaveCanonica, "");
  assert.strictEqual(resolverIdentidadeCanonicaOferta({ urlOriginal: "https://www.aliexpress.com/item/100500.html" }).chaveCanonica, "");

  const semChave = compararIdentidadeCanonicaOfertas(
    { titulo: "Sem chave", preco: "R$ 10,00" },
    { titulo: "Sem chave", preco: "R$ 10,00" }
  );
  assert.strictEqual(semChave.duplicada, false);
  assert.strictEqual(semChave.ambasCanonicas, false);

  const oferta = {
    linkAfiliado: "https://www.awin1.com/cread.php?clickref=preservado",
    chaveCanonica: "kabum:944475",
    produtoIdCanonico: "944475",
    marketplaceCanonico: "kabum",
    marketplaceProduto: "kabum"
  };
  const campos = camposIdentidadeCanonicaOferta(oferta);
  assert.strictEqual(oferta.linkAfiliado, "https://www.awin1.com/cread.php?clickref=preservado");
  assert.strictEqual(campos.chaveCanonica, "kabum:944475");
}

(async () => {
  await testarIdentidadeKabumDireto();
  await testarAwinKabum();
  await testarAOfertaResolvido();
  await testarAOfertaProdutoDiferente();
  await testarAOfertaSemUrlFinal();
  testarDuplicidadeCanonica();
  testarFallbackLegadoERegressoes();
  console.log("radar-produto-canonico: ok");
})();
