"use strict";
const Module=require("node:module"),path=require("node:path"),{execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),BASE="97b7020491c89f119e9dc09538af03f8cae87f2a";
function compile(relative,overrides={}){
 const file=path.join(root,relative),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 const native=m.require.bind(m);m.require=id=>Object.hasOwn(overrides,id)?overrides[id]:native(id);
 m._compile(execFileSync("git",["show",`${BASE}:${relative}`],{cwd:root,encoding:"utf8",windowsHide:true}),file);return m.exports;
}
const functional=compile("marketplaces/inteligencia/evidencia-funcional.js");
const classifier=compile("marketplaces/inteligencia/classificador-categorias.js",{"./evidencia-funcional":functional});
const universal=compile("modules/inteligencia-universal/categoria.service.js",{"../../marketplaces/inteligencia/classificador-categorias":classifier});
module.exports={BASE,classifier,universal};
