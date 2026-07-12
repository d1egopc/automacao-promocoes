const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-templates-clientes-"));
process.env.DATA_DIR = dataDir;

const {
  criarTemplate,
  buscarTemplate,
  duplicarTemplate,
  listarTemplates,
  previewTemplate
} = require("../modules/templates-clientes/service");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const { lerStorageTemplates } = require("../modules/templates-clientes/storage");

function assertThrowsCodigo(fn, codigo) {
  assert.throws(fn, erro => erro && (erro.codigo === codigo || erro.message === codigo));
}

const blocosBase = [
  { tipo: "titulo", ativo: true, ordem: 10 },
  { tipo: "preco_de", ativo: true, ordem: 20 },
  { tipo: "preco_por", ativo: true, ordem: 30 },
  { tipo: "cupom", ativo: true, ordem: 40 },
  { tipo: "economia", ativo: true, ordem: 50 },
  { tipo: "cta", ativo: true, ordem: 60 },
  { tipo: "link", ativo: true, ordem: 70 }
];

const payloadValido = {
  clienteId: "cliente_malicioso",
  nome: "Grupo VIP",
  descricao: "Template do grupo",
  canais: ["whatsapp", "telegram"],
  blocos: blocosBase,
  rodape: { ativo: true, texto: "Linha 1\nLinha 2 #promo @optimus" }
};

const criado = criarTemplate("cliente_a", payloadValido).template;
assert.ok(criado.id.startsWith("tpl_"), "cria template valido com ID backend");
assert.strictEqual(criado.clienteId, "cliente_a", "nao aceita clienteId do body");
assert.strictEqual(criado.nome, "Grupo VIP");
assert.strictEqual(criado.blocos.length, blocosBase.length);

assertThrowsCodigo(() => criarTemplate("cliente_a", { ...payloadValido, nome: " " }), "template_nome_invalido");
assertThrowsCodigo(() => criarTemplate("cliente_a", { ...payloadValido, blocos: [{ tipo: "html_livre", ativo: true, ordem: 1 }] }), "template_bloco_invalido");

const ofertaOriginal = {
  titulo: "Produto Teste",
  precoOriginal: "",
  precoAtual: 29.9,
  economia: 0,
  cupom: "",
  linkAfiliado: "https://example.com/oferta"
};
const snapshotOferta = JSON.stringify(ofertaOriginal);
const render = renderizarTemplatePersonalizado({ oferta: ofertaOriginal, template: criado, canal: "whatsapp" });

assert.strictEqual(render.ok, true);
assert.ok(!render.mensagem.includes("undefined"), "remove undefined");
assert.ok(!render.mensagem.includes("null"), "remove null");
assert.ok(!render.mensagem.includes("NaN"), "remove NaN");
assert.ok(!render.mensagem.includes("Cupom:"), "remove cupom vazio");
assert.ok(!render.mensagem.includes("De:"), "remove preco DE vazio");
assert.ok(!render.mensagem.includes("Economia:"), "remove economia zero");
assert.ok(render.mensagem.includes("Por:"), "preserva preco POR");
assert.ok(render.mensagem.includes("https://example.com/oferta"), "preserva link");
assert.ok(render.mensagem.includes("Linha 1\nLinha 2"), "adiciona rodape com quebra de linha");
assert.deepStrictEqual(JSON.stringify(ofertaOriginal), snapshotOferta, "nao altera oferta original");

const ordem = render.blocosRenderizados.filter(tipo => tipo !== "rodape");
assert.deepStrictEqual(ordem, ["titulo", "preco_por", "cta", "link"], "respeita ordem e ignora blocos vazios");

assertThrowsCodigo(() => buscarTemplate("cliente_b", criado.id), "template_nao_encontrado");
const duplicado = duplicarTemplate("cliente_a", criado.id).template;
assert.notStrictEqual(duplicado.id, criado.id, "duplica com novo ID");
assert.strictEqual(duplicado.clienteId, "cliente_a");

const preview = previewTemplate("cliente_a", { canal: "whatsapp", template: { ...payloadValido, id: "tpl_id_injetado_pelo_body" } });
assert.strictEqual(preview.ok, true, "preview usa renderer personalizado");
assert.strictEqual(preview.template.id, "preview_template", "preview ignora id enviado pelo body");
assert.strictEqual(preview.templateIdUsado, "preview_template", "templateIdUsado do preview e controlado pelo backend");
assert.ok(preview.mensagem.includes("PROMO10"));
assert.ok(preview.blocosRenderizados.includes("link"));

const storage = lerStorageTemplates("cliente_a");
assert.ok(!storage.templates.some(template => template.id === "padrao_optimus"), "Template padrao nao aparece no storage do cliente");
assert.strictEqual(listarTemplates("cliente_a").padrao.id, "padrao_optimus");

const incompat = renderizarTemplatePersonalizado({
  oferta: { titulo: "Teste", precoAtual: 10, linkAfiliado: "https://example.com" },
  template: { ...criado, canais: ["telegram"] },
  canal: "whatsapp"
});
assert.strictEqual(incompat.ok, false, "canal incompativel retorna erro controlado");
assert.strictEqual(incompat.erro, "canal_incompativel");

const sujo = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "undefined",
    precoOriginal: "null",
    precoAtual: 19.9,
    economia: "NaN",
    cupom: "undefined",
    linkAfiliado: "https://example.com/limpo"
  },
  template: criado,
  canal: "whatsapp"
});
assert.ok(!sujo.mensagem.includes("undefined"));
assert.ok(!sujo.mensagem.includes("null"));
assert.ok(!sujo.mensagem.includes("NaN"));

console.log("templates-clientes.test.js OK");
