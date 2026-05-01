const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const fs = require("fs");
const path = require("path");
const { validateIntegracao, salvarIntegracoes, carregarIntegracoes } = require("./helpers");

// Variáveis para armazenar dados em memória (para facilitar o deploy futuro)
let integracoesPorCliente = {};
let destinosPorCliente = {};
let gruposPorCliente = {};
let automacoesPorCliente = {};

// Carregar as integrações persistidas
carregarIntegracoes();

// Middleware para body parsing
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Definir proxy para garantir que as requisições HTTP vão funcionar corretamente
app.set("trust proxy", 1);

// Rota para adicionar ou atualizar integração
app.post("/integracoes/:marketplace", (req, res) => {
  const clienteId = req.body.user_id;
  const marketplace = req.params.marketplace;
  const credenciais = req.body;

  const integracao = validateIntegracao(marketplace, credenciais);

  if (integracao.ok) {
    if (!integracoesPorCliente[clienteId]) {
      integracoesPorCliente[clienteId] = {};
    }

    integracoesPorCliente[clienteId][marketplace] = integracao.clean;
    salvarIntegracoes();
    return res.json({ ok: true, message: `Integração ${marketplace} salva!` });
  }

  return res.json({ ok: false, erro: integracao.erro });
});// Rota para obter todas as integrações do cliente
app.get("/integracoes", (req, res) => {
  const clienteId = req.query.user_id;
  if (integracoesPorCliente[clienteId]) {
    return res.json(integracoesPorCliente[clienteId]);
  }
  return res.json([]);
});

// Função para salvar as integrações no arquivo (persistência em JSON)
function salvarIntegracoes() {
  try {
    fs.writeFileSync(path.join(__dirname, "integracoes.json"), JSON.stringify(integracoesPorCliente, null, 2), "utf8");
    console.log("Integrações salvas com sucesso!");
  } catch (error) {
    console.error("Erro ao salvar as integrações:", error.message);
  }
}

// Carregar as integrações de um arquivo ao iniciar o servidor
function carregarIntegracoes() {
  try {
    if (fs.existsSync(path.join(__dirname, "integracoes.json"))) {
      const data = fs.readFileSync(path.join(__dirname, "integracoes.json"), "utf8");
      integracoesPorCliente = JSON.parse(data);
      console.log("Integrações carregadas com sucesso!");
    }
  } catch (error) {
    console.error("Erro ao carregar as integrações:", error.message);
  }
}// Rota para excluir uma integração
app.delete("/integracoes/:marketplace", (req, res) => {
  const clienteId = req.query.user_id;
  const marketplace = req.params.marketplace;

  if (integracoesPorCliente[clienteId] && integracoesPorCliente[clienteId][marketplace]) {
    delete integracoesPorCliente[clienteId][marketplace];
    salvarIntegracoes();
    return res.json({ ok: true, message: `Integração ${marketplace} excluída com sucesso!` });
  }
  return res.json({ ok: false, erro: "Integração não encontrada" });
});

// Rota para salvar/atualizar a automação
app.post("/automacao", (req, res) => {
  const clienteId = req.body.user_id;
  const automacao = req.body;

  if (!automacoesPorCliente[clienteId]) {
    automacoesPorCliente[clienteId] = {};
  }

  automacoesPorCliente[clienteId] = automacao;
  return res.json({ ok: true, message: "Automação configurada com sucesso!" });
});// Rota para buscar produtos na plataforma e ajustar os preços
app.post("/importar-produto", (req, res) => {
  const { marketplace, link } = req.body;

  // Aqui você pode definir como buscar os dados de cada marketplace
  if (marketplace === "mercadolivre") {
    buscarProdutoMercadoLivre(link, (produto) => {
      const precoAtual = normalizarPreco(produto.precoAtual);
      const precoAntigo = normalizarPreco(produto.precoAntigo);
      return res.json({ ok: true, produto, precoAtual, precoAntigo });
    });
  } else {
    return res.json({ ok: false, erro: "Marketplace não suportado" });
  }
});

// Função para normalizar preços
function normalizarPreco(valor) {
  if (!valor) return "";
  let texto = String(valor).trim();
  texto = texto.replace("R$", "").replace(/\s/g, "").replace(",", "."); // Remover R$ e espaço
  return Number(texto).toFixed(2).replace(".", ",");
}// Definindo porta do servidor
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

// Adicionando função de buscar produto no Mercado Livre
function buscarProdutoMercadoLivre(link, callback) {
  // Adicionar o código de integração com Mercado Livre aqui
  // Para buscar os dados reais de preço, imagem e título do produto
  // Passando para a função callback o produto com os dados já ajustados

  const produto = {
    titulo: "Produto Exemplo",
    precoAtual: "R$ 150,00",
    precoAntigo: "R$ 200,00",
    imagem: "https://link-da-imagem.com",
    linkProduto: link,
  };

  callback(produto);
}