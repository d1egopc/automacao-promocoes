const assert = require("node:assert/strict");
const {
  CONFIG_PADRAO,
  criarPayloadRenderer,
  dataPublicacaoSaoPaulo,
  normalizarTemplateVisual,
  sanitizarAvisoPreco
} = require("../modules/social/post-visual-template.contract");
const { normalizarPayloadRenderer } = require("../optimus-social-art-renderer/src/contract");
const { htmlPreview } = require("../optimus-social-art-renderer/src/renderer.service");

const dados = { imagem: "https://example.test/product.jpg", preco: "100", titulo: "Produto" };
const instante = "2026-10-18T02:59:59.000Z";
assert.equal(dataPublicacaoSaoPaulo(instante), "2026-10-17");
assert.equal(dataPublicacaoSaoPaulo("2026-10-18T03:00:00.000Z"), "2026-10-18");

const padrao = criarPayloadRenderer({ clienteIdInterno: "cliente_a", ofertaId: "oferta_a", template: CONFIG_PADRAO, dados, dataPublicacao: instante });
const retry = criarPayloadRenderer({ clienteIdInterno: "cliente_a", ofertaId: "oferta_a", template: CONFIG_PADRAO, dados, dataPublicacao: instante });
const outroDia = criarPayloadRenderer({ clienteIdInterno: "cliente_a", ofertaId: "oferta_a", template: CONFIG_PADRAO, dados, dataPublicacao: "2026-10-18T03:00:00.000Z" });
assert.equal(padrao.hash, retry.hash);
assert.notEqual(padrao.hash, outroDia.hash);
assert.equal(padrao.dataPublicacao, "2026-10-17");
const normal = normalizarPayloadRenderer(padrao);
assert.equal(normal.template.mostrarDataAvisoPreco, true);
assert.equal(normal.template.avisoPrecoCorFundo, "#ffffff");
assert.equal(normal.template.avisoPrecoCorTexto, "#0f172a");
assert.equal(normal.template.avisoPrecoTransparencia, 0.86);
const html = htmlPreview({ template: normal.template, dados: normal.dados, dataPublicacao: normal.dataPublicacao, imagemSrc: "data:image/png;base64,AAAA" });
assert.match(html, /Oferta do dia · 17\/10\/2026/);
assert.match(html, /Preços sujeitos a alteração\./);

const antigo = normalizarTemplateVisual({ faixaSuperiorTexto: "LEGADO" });
assert.equal(antigo.mostrarDataAvisoPreco, false);
assert.equal(normalizarPayloadRenderer({ ...padrao, template: antigo }).template.mostrarDataAvisoPreco, false);
assert.equal(sanitizarAvisoPreco("<script>Preço\n mudou</script>"), "script Preço mudou /script");
const personalizado = normalizarPayloadRenderer({ ...padrao, template: { ...antigo, mostrarDataAvisoPreco: true, textoAvisoPreco: "Aviso <privado>\n" } });
const htmlPersonalizado = htmlPreview({ template: personalizado.template, dados: personalizado.dados, dataPublicacao: personalizado.dataPublicacao });
assert.match(htmlPersonalizado, /Aviso privado/);
assert.doesNotMatch(htmlPersonalizado, /<privado>/);
assert.equal(personalizado.template.avisoPrecoCorFundo, "#ffffff");
assert.equal(personalizado.template.avisoPrecoCorTexto, "#0f172a");
assert.equal(normalizarTemplateVisual({ mostrarDataAvisoPreco: false }).mostrarDataAvisoPreco, false);
console.log("social-price-notice: PASS");
