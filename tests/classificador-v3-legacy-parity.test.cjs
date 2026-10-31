"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
test("pré-compilação mantém a pontuação das regras em 2.500 combinações determinísticas", () => {
  const root = path.resolve(__dirname, ".."), file = path.join(root,"marketplaces/inteligencia/classificador-categorias.js");
  const tail = "module.exports.__parity={REGRAS,pontuarRegra,desempatar,normalizarTextoLocal};";
  const compiledModule = new Module(file, module); compiledModule.filename=file; compiledModule.paths=Module._nodeModulePaths(path.dirname(file));
  compiledModule._compile(fs.readFileSync(file,"utf8")+"\n"+tail,file);
  const { REGRAS, pontuarRegra, desempatar, normalizarTextoLocal } = compiledModule.exports.__parity;
  const termos = REGRAS.flatMap(r=>[...r.fortes,...r.palavras,...r.negativas]);
  let seed=20261027; const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const matches = (normalizedText, phrases) => phrases.map(normalizarTextoLocal)
    .filter((phrase) => normalizedText.includes(` ${phrase} `));
  const scoreDynamically = (normalizedText, rule) => {
    const fortes = matches(normalizedText, rule.fortes);
    const palavras = matches(normalizedText, rule.palavras);
    const negativas = matches(normalizedText, rule.negativas);
    if (!fortes.length && !palavras.length) return null;
    return {
      categoria: rule.categoria,
      pontuacao: rule.prioridade +
        fortes.reduce((total, term) => total + 18 + term.split(" ").length, 0) +
        palavras.reduce((total, term) => total + 6 + Math.min(term.split(" ").length, 3), 0) -
        negativas.length * 20,
      fortes,
      palavras
    };
  };
  for(let i=0;i<2500;i++) {
    const titulo=`${termos[next()%termos.length]} / ${termos[next()%termos.length]} ${i%2?"promoção":"ORIGINAL"}`;
    const normalizedText=` ${normalizarTextoLocal(titulo)} `;
    const compiled=REGRAS.map((rule)=>pontuarRegra(normalizedText,rule)).filter(Boolean).sort(desempatar);
    const dynamic=REGRAS.map((rule)=>scoreDynamically(normalizedText,rule)).filter(Boolean).sort(desempatar);
    assert.deepEqual(compiled,dynamic,`divergência de pontuação compilada: ${titulo}`);
  }
});
