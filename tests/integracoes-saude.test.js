const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-saude-integracoes-"));
process.env.DATA_DIR = dataDir;

const saude = require("../modules/integracoes/saude");
const { ARQUIVO_SAUDE_INTEGRACOES } = require("../modules/integracoes/saude/storage");

function arquivoCliente(clienteId) {
  return path.join(dataDir, "clientes", clienteId, ARQUIVO_SAUDE_INTEGRACOES);
}

function lerArquivo(clienteId) {
  return fs.readFileSync(arquivoCliente(clienteId), "utf8");
}

let ml = saude.registrarResultadoTesteIntegracao("cliente_ml_ok", "mercadolivre", {
  ok: true,
  status: "ok",
  mensagem: "Integração válida.",
  detalhes: { linkAfiliado: "https://meli.la/teste" }
});
assert.strictEqual(ml.estado, "ok");
assert.strictEqual(ml.codigo, "link_convertido");
assert.ok(ml.ultimoSucessoEm);
assert.strictEqual(ml.falhasConsecutivas, 0);

ml = saude.registrarResultadoTesteIntegracao("cliente_ml_cookie", "mercadolivre", {
  ok: false,
  status: "cookie_ausente",
  mensagem: "Cookies ausentes.",
  detalhes: { faltandoCookies: true }
});
assert.strictEqual(ml.estado, "invalida");
assert.strictEqual(ml.codigo, "cookie_ausente");
assert.strictEqual(ml.falhasConsecutivas, 1);

ml = saude.registrarResultadoTesteIntegracao("cliente_ml_cookie_exp", "mercadolivre", {
  ok: false,
  status: "cookie_expirado",
  mensagem: "Cookies expirados.",
  detalhes: { httpStatus: 403 }
});
assert.strictEqual(ml.estado, "invalida");

ml = saude.registrarResultadoTesteIntegracao("cliente_ml_bloqueio", "mercadolivre", {
  ok: false,
  status: "bloqueio_ml",
  mensagem: "Suspicious traffic.",
  detalhes: { httpStatus: 200 }
});
assert.strictEqual(ml.estado, "ok");
assert.strictEqual(ml.codigo, "bloqueio_temporario");

ml = saude.registrarResultadoTesteIntegracao("cliente_ml_timeout", "mercadolivre", {
  ok: false,
  status: "falha_teste",
  mensagem: "timeout",
  detalhes: { erro: "ETIMEDOUT" }
});
assert.strictEqual(ml.estado, "ok");
assert.strictEqual(ml.codigo, "timeout");

ml = saude.registrarResultadoTesteIntegracao("cliente_ml_falha", "mercadolivre", {
  ok: false,
  status: "falha_teste",
  mensagem: "Sem link curto válido.",
  detalhes: { httpStatus: 200 }
});
assert.strictEqual(ml.estado, "ok");

let amazon = saude.registrarResultadoTesteIntegracao("cliente_amz_ok", "amazon", {
  ok: true,
  status: "ok",
  mensagem: "Integração válida.",
  detalhes: { httpStatus: 200, linkAfiliado: "https://www.amazon.com.br/dp/B07PGL2ZSL?tag=abc-20" }
});
assert.strictEqual(amazon.estado, "ok");
assert.strictEqual(amazon.codigo, "produto_consultado");

amazon = saude.registrarResultadoTesteIntegracao("cliente_amz_cookie", "amazon", {
  ok: false,
  status: "cookie_ausente",
  mensagem: "Cookies ausentes.",
  detalhes: { faltandoCookies: true }
});
assert.strictEqual(amazon.estado, "invalida");

amazon = saude.registrarResultadoTesteIntegracao("cliente_amz_auth", "amazon", {
  ok: false,
  status: "cookie_expirado",
  mensagem: "Autenticação inválida.",
  detalhes: { httpStatus: 401 }
});
assert.strictEqual(amazon.estado, "invalida");

amazon = saude.registrarResultadoTesteIntegracao("cliente_amz_robot", "amazon", {
  ok: false,
  status: "cookie_expirado",
  mensagem: "Robot check.",
  detalhes: { httpStatus: 503 }
});
assert.strictEqual(amazon.estado, "ok");
assert.strictEqual(amazon.codigo, "bloqueio_temporario");

amazon = saude.registrarResultadoTesteIntegracao("cliente_amz_429", "amazon", {
  ok: false,
  status: "cookie_expirado",
  mensagem: "Too many requests.",
  detalhes: { httpStatus: 429 }
});
assert.strictEqual(amazon.estado, "ok");

amazon = saude.registrarResultadoTesteIntegracao("cliente_amz_timeout", "amazon", {
  ok: false,
  status: "falha_teste",
  mensagem: "timeout",
  detalhes: { erro: "timeout" }
});
assert.strictEqual(amazon.estado, "ok");
assert.strictEqual(amazon.codigo, "timeout");

amazon = saude.registrarResultadoTesteIntegracao("cliente_amz_api", "amazon", {
  ok: false,
  status: "teste_nao_implementado",
  mensagem: "Teste API pendente.",
  detalhes: { modo: "api" }
});
assert.strictEqual(amazon.estado, "ok");

const clienteStorage = "cliente_storage";
let registro = saude.registrarConfiguracaoIntegracao(clienteStorage, "mercadolivre", {
  credenciais: { cookies: "cookie-secreto", tag: "tag-secreta" }
});
assert.strictEqual(registro.estado, "ok", "salvar config mantém o painel operacional simples");
assert.strictEqual(registro.configurada, true);

registro = saude.registrarResultadoTesteIntegracao(clienteStorage, "mercadolivre", {
  ok: true,
  status: "ok",
  mensagem: "ok",
  detalhes: { linkAfiliado: "https://meli.la/abc" }
});
const ultimoSucessoEm = registro.ultimoSucessoEm;
assert.ok(ultimoSucessoEm);

registro = saude.registrarResultadoTesteIntegracao(clienteStorage, "mercadolivre", {
  ok: false,
  status: "bloqueio_ml",
  mensagem: "captcha",
  detalhes: { httpStatus: 200 }
});
assert.strictEqual(registro.estado, "ok");
assert.strictEqual(registro.ultimoSucessoEm, ultimoSucessoEm, "ultimo sucesso deve ser preservado após atenção");
assert.strictEqual(registro.falhasConsecutivas, 1);

registro = saude.registrarResultadoTesteIntegracao(clienteStorage, "mercadolivre", {
  ok: true,
  status: "ok",
  mensagem: "ok",
  detalhes: { linkAfiliado: "https://meli.la/abc" }
});
assert.strictEqual(registro.falhasConsecutivas, 0, "sucesso zera falhas consecutivas");

registro = saude.registrarResultadoTesteIntegracao(clienteStorage, "mercadolivre", {
  ok: false,
  status: "cookie_expirado",
  mensagem: "cookie expirado",
  detalhes: { httpStatus: 401 }
});
assert.strictEqual(registro.estado, "invalida", "falha confirmada invalida a integracao");

registro = saude.registrarResultadoTesteIntegracao(clienteStorage, "mercadolivre", {
  ok: false,
  status: "bloqueio_ml",
  mensagem: "bloqueio temporario",
  detalhes: { httpStatus: 429 }
});
assert.strictEqual(registro.estado, "invalida", "falha temporaria nao recupera integracao invalida");

registro = saude.registrarResultadoTesteIntegracao(clienteStorage, "mercadolivre", {
  ok: true,
  status: "ok",
  mensagem: "ok",
  detalhes: { linkAfiliado: "https://meli.la/abc" }
});
assert.strictEqual(registro.estado, "ok", "sucesso real recupera integracao invalida");

registro = saude.registrarConfiguracaoIntegracao(clienteStorage, "mercadolivre", {
  credenciais: { cookies: "cookie-novo", tag: "tag-secreta" }
});
assert.strictEqual(registro.estado, "ok", "credencial alterada permanece sem estado intermediario visual");
assert.ok(registro.ultimoSucessoEm, "historico de sucesso permanece");

const conteudo = lerArquivo(clienteStorage);
assert.ok(!conteudo.includes("cookie-secreto"));
assert.ok(!conteudo.includes("cookie-novo"));
assert.ok(!conteudo.includes("tag-secreta"));
assert.ok(!registro.credenciaisHash, "hash nao deve retornar ao frontend");

const antigo = saude.obterSaudeIntegracao("cliente_antigo", "amazon", {
  modo: "cookies",
  credenciais: { cookies: "x", tag: "tag-20" }
});
assert.strictEqual(antigo.estado, "ok", "config antiga sem falha oficial nao deve criar estado intermediario");

console.log("integracoes-saude: ok");

