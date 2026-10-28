"use strict";
const { fail } = require("./model");
const { normalizeModule } = require("./module-contract");
const NICHES = Object.freeze({
  general:{name:"Geral", topic:"nossa comunidade", terms:["regras","ajuda"]},
  tools:{name:"Ferramentas", topic:"ferramentas e manutenção", terms:["ferramentas","manutenção"]},
  refrigeration:{name:"Refrigeração", topic:"refrigeração e ar-condicionado", terms:["refrigeração","ar-condicionado"]},
  fishing:{name:"Pesca e Camping", topic:"pesca e camping", terms:["pesca","camping"]},
  beauty:{name:"Perfumaria e Beleza", topic:"perfumaria e beleza", terms:["perfumes","beleza"]},
  custom:{name:"Criar do zero", topic:"", terms:[]}
});
function catalog() {return Object.entries(NICHES).map(([id,n])=>({id,name:n.name,version:1}));}
function template(id, destinations = []) {
  const n = NICHES[id]; if(!n) fail("modelo_nao_encontrado");
  const content = {
    welcome:{responses:[{text:`Bem-vindo(a), {nome}! Este é nosso grupo de ${n.topic || "conversa"}. Consulte !regras e !ajuda.`}]},
    farewell:{responses:[{text:"Até a próxima, {nome}!"}]},
    commands:{commands:id === "custom" ? [] : [
      {id:"rules",triggers:["!regras"],responses:[{text:`Respeite os participantes. Mantenha o assunto em ${n.topic}. Não publique spam.`}]},
      {id:"help",triggers:["!ajuda"],responses:[{text:"Para falar com uma pessoa, envie uma mensagem privada com a palavra atendente."}]},
      {id:"morning",triggers:["!bomdia"],responses:[{text:"Bom dia! Que seja um ótimo dia para todos."}]}]},
    attendance:{rules:id === "custom" ? [] : [{id:"topic",terms:n.terms,match:"contains",responses:[{text:`Como podemos ajudar com ${n.topic}?`}]}],
      greeting:id === "custom" ? undefined : [{text:`Olá! Como podemos ajudar com ${n.topic}?`}],
      humanTerms:["humano","atendente"]},
    groupManager:{rules:id === "custom" ? [] : [{id:"spam",category:"spam",enabled:false,action:"observe",threshold:5,windowSeconds:30}]},
    scheduled:{}
  };
  return {id,version:1,niche:n.name,modules:Object.fromEntries(Object.entries(content).map(([k,v])=>[k,normalizeModule(k,v,destinations)]))};
}
module.exports = { catalog, template };
