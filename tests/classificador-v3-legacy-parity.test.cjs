"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const { spawnSync } = require("node:child_process");
test("pré-compilação conserva o scorer legado em 2.500 combinações determinísticas", () => {
  const root = path.resolve(__dirname, ".."), relative = "marketplaces/inteligencia/classificador-categorias.js", file = path.join(root,relative);
  const old = spawnSync("git", ["show", `3ab4f29d7812cf0f9e996f210762fd94c1296322:${relative}`], {cwd:root,encoding:"utf8",windowsHide:true});
  assert.equal(old.status,0,"baseline exata deve estar disponível; ausência é falha, não PASS");
  function compile(code, tail) {
    const m = new Module(file, module); m.filename=file; m.paths=Module._nodeModulePaths(path.dirname(file));
    m._compile(code+"\n"+tail,file); return m.exports;
  }
  const baseline = compile(old.stdout,"module.exports.regras = REGRAS;");
  const candidate = compile(fs.readFileSync(file,"utf8"),"module.exports.legado = classificarCategoriaLegada;");
  const termos = baseline.regras.flatMap(r=>[...r.fortes,...r.palavras,...r.negativas]);
  let seed=20261027; const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const log=console.log; console.log=()=>{};
  try {
    for(let i=0;i<2500;i++) {
      const titulo=`${termos[next()%termos.length]} / ${termos[next()%termos.length]} ${i%2?"promoção":"ORIGINAL"}`;
      const oferta={titulo, categoria:i%7===0?"Diversos":""};
      assert.equal(candidate.legado(oferta,titulo),baseline.classificarCategoriaOferta(oferta,titulo),`divergência do scorer: ${titulo}`);
    }
  } finally {console.log=log;}
});
