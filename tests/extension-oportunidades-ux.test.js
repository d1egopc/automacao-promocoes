const assert = require("assert");
const fs = require("fs");

const css = fs.readFileSync("optimus-capture/sidepanel/panel.css", "utf8");
const html = fs.readFileSync("optimus-capture/sidepanel/panel.html", "utf8");
const panel = fs.readFileSync("optimus-capture/sidepanel/panel.js", "utf8");

function bloco(nome, proximo) {
  const inicio = css.indexOf(`${nome} {`);
  assert.ok(inicio >= 0, `bloco CSS ausente: ${nome}`);
  const fim = css.indexOf(`${proximo} {`, inicio);
  return css.slice(inicio, fim >= 0 ? fim : css.length);
}

const popover = bloco(".popover-oportunidades", ".cabecalho-oportunidades");
const lista = bloco(".lista-oportunidades", ".item-oportunidade");
const item = bloco(".item-oportunidade", ".item-oportunidade strong");

assert.match(popover, /max-height:\s*min\(420px,\s*calc\(100vh - 84px\)\)/);
assert.match(popover, /overflow:\s*hidden/);
assert.match(lista, /max-height:\s*min\(360px,\s*calc\(100vh - 142px\)\)/);
assert.match(lista, /overflow-y:\s*auto/);
assert.match(lista, /overscroll-behavior:\s*contain/);
assert.doesNotMatch(lista, /\n\s+height\s*:/, "a lista não deve impor altura fixa");
assert.match(item, /padding:\s*7px/);

for (const quantidade of [1, 3, 6]) {
  assert.ok(/overflow-y:\s*auto/.test(lista), `lista curta ${quantidade} deve permanecer natural`);
}
for (const quantidade of [10, 15]) {
  assert.ok(/max-height:/.test(lista), `lista longa ${quantidade} deve ter limite visual`);
  assert.ok(/overflow-y:\s*auto/.test(lista), `lista longa ${quantidade} deve rolar internamente`);
}

assert.match(html, /id="botaoOportunidades"/);
assert.match(html, /id="badgeOportunidades"/);
assert.match(html, /id="listaOportunidades"/);
assert.match(panel, /state\.oportunidades = Array\.isArray\(lista\)/);
assert.doesNotMatch(panel, /state\.oportunidades\.sort\(/, "a ordem recebida deve ser preservada");
assert.match(panel, /marcarComoVistas\(escopoOportunidades\(\), state\.oportunidades\)/);
assert.match(panel, /abrirOportunidade\(urlDestino\)/);

console.log("extension-oportunidades-ux.test.js OK");
