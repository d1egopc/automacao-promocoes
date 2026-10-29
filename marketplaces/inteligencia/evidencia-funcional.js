"use strict";
// Famílias funcionais, nunca títulos completos, marcas, lojas ou grupos.
const normalizar = value => typeof value === "string" || typeof value === "number"
  ? String(value).slice(0, 2400).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim() : "";
const CAMPOS = new Set(["tipo", "tipo produto", "tipoproduto", "funcao", "finalidade", "conectividade", "padrao wifi", "padraowifi", "padrao wireless", "protocolo", "frequencia", "potencia rms", "potenciarms", "potencia", "portas", "tecnologia", "aplicacao"]);
function extrairFatosFuncionais(oferta = {}, tituloNormalizado) {
  const produto = oferta.metadata?.produto || oferta.raw?.metadata?.produto || {};
  const titulo = typeof tituloNormalizado === "string" ? tituloNormalizado.slice(0,1200) : normalizar(oferta.titulo || oferta.nome || oferta.raw?.titulo || "");
  const descricao = normalizar(oferta.descricao || oferta.raw?.descricao || produto.descricao || "");
  const atributos = [];
  const raw = oferta.atributos || oferta.raw?.atributos || produto.atributos;
  if (Array.isArray(raw)) {
    for (const item of raw.slice(0,16)) {
      if (item && CAMPOS.has(normalizar(item.nome || item.name))) atributos.push(normalizar(item.valor ?? item.value));
    }
  } else if (raw && typeof raw === "object") {
    let inspected=0;
    for (const key in raw) {
      if (++inspected>32)break;
      if (Object.hasOwn(raw,key) && CAMPOS.has(normalizar(key))) atributos.push(normalizar(raw[key]));
      if (atributos.length>=16)break;
    }
  }
  const detalhes = `${descricao} ${atributos.join(" ")}`.slice(0,3000);
  return {titulo,detalhes,texto:`${titulo} ${detalhes}`.slice(0,4200),fontes:[...(titulo?["titulo"]:[]),...(descricao?["descricao"]:[]),...(atributos.length?["atributos"]:[])]};
}
function avaliarFamiliaFuncional(oferta = {}, tituloNormalizado) {
  const produto=oferta.metadata?.produto||oferta.raw?.metadata?.produto||{};
  const entrada=tituloNormalizado||oferta.titulo||oferta.nome||oferta.raw?.titulo||"";
  const temDetalhes=oferta.descricao||oferta.atributos||oferta.raw?.descricao||oferta.raw?.atributos||produto.descricao||produto.atributos;
  if (!temDetalhes && (typeof entrada!=="string" || !/\b(?:roteador|router|caixas?|alto|access|switch|tupia|fresadora)\b/i.test(entrada.slice(0,1200))))return null;
  const fatos=extrairFatosFuncionais(oferta,tituloNormalizado), {titulo,texto}=fatos;
  const naturezaMadeira=/\b(?:marcenaria|madeira|fresa|fresadora|tupia)\b/.test(titulo);
  const organizacao=/\b(?:organizadora|organizador|armazenamento|porta objetos|caixa de ferramentas)\b/.test(titulo);
  const acessorio=/^(?:(?:kit|jogo) (?:de )?)?(?:manual|livro|curso|capa|case|suporte|peca|cabo|fonte|carregador|camiseta|adesivo)\b/.test(titulo);
  if (acessorio || organizacao || /^(?:panela|frigideira|camiseta|roupa|oculos|notebook|celular|smartphone|mouse|teclado|cama|armario|escova|shampoo)\b/.test(titulo))return null;
  const rede=/\b(?:roteador|router|access point|ponto de acesso|switch de rede)\b/.test(texto) &&
    /\b(?:wi fi|wifi|802 11[a-z0-9]*|dual band|ethernet|wan|lan|gigabit|internet|rede sem fio)\b/.test(texto) && !naturezaMadeira;
  const audio=/\b(?:caixas? amplificadas?|caixas? acusticas?|caixas? de som|alto falantes?)\b/.test(texto) &&
    /\b(?:rms|audio|som|amplificada|amplificadas|acustica|acusticas|bluetooth)\b/.test(texto) && !organizacao && !naturezaMadeira;
  // Descrição de outro produto ou kit de naturezas incompatíveis exige revisão.
  if ((rede && audio) || ((rede || audio) && /\b(?:perfume|geladeira|furadeira|vestido|racao)\b/.test(titulo)))
    return {categoria:"Diversos",motivo:"familias_funcionais_conflitantes",fontes:fatos.fontes};
  if (naturezaMadeira && /\b(?:roteador|router|tupia|fresadora)\b/.test(titulo))
    return {categoria:"Ferramentas",motivo:"finalidade_marcenaria_explicita",fontes:["titulo"]};
  if (rede)return {categoria:"Periféricos",motivo:"equipamento_rede_funcional",fontes:fatos.fontes};
  if (audio)return {categoria:"Audio TV",motivo:"equipamento_audio_funcional",fontes:fatos.fontes};
  return null;
}
module.exports={avaliarFamiliaFuncional,extrairFatosFuncionais};
