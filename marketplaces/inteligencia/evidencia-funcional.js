"use strict";
// Famílias funcionais, nunca títulos completos, marcas, lojas ou grupos.
const normalizar = value => typeof value === "string" || typeof value === "number"
  ? String(value).slice(0, 2400).replace(/([a-zà-ÿ])([A-ZÀ-Ý])/g,"$1 $2").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim() : "";
const CAMPOS = new Set(["tipo", "tipo produto", "tipoproduto", "funcao", "finalidade", "material", "uso", "publico", "publico alvo", "genero", "conectividade", "padrao wifi", "padraowifi", "padrao wireless", "protocolo", "frequencia", "potencia rms", "potenciarms", "potencia", "portas", "tecnologia", "aplicacao"]);
function extrairFatosFuncionais(oferta = {}, tituloNormalizado) {
  const produto = oferta.metadata?.produto || oferta.raw?.metadata?.produto || {};
  const titulo = normalizar(oferta.titulo || oferta.nome || oferta.raw?.titulo || tituloNormalizado || "").slice(0,1200);
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
    /\b(?:wi fi\d*[a-z]?|wifi\d*[a-z]?|802 11[a-z0-9]*|dual band|ethernet|wan|lan|gigabit|internet|rede sem fio)\b/.test(texto) && !naturezaMadeira;
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
// Natureza primária + finalidade verificável. Nunca utiliza marca, origem,
// workspace, preço ou nome de destino como prova; descrições só complementam
// um tipo no título (ou um título explicitamente genérico).
function avaliarNaturezaFuncional(oferta = {}, tituloNormalizado) {
  const produto=oferta.metadata?.produto||oferta.raw?.metadata?.produto||{};
  if(typeof tituloNormalizado==="string"&&!oferta.descricao&&!oferta.atributos&&!oferta.raw?.descricao&&!oferta.raw?.atributos&&!produto.descricao&&!produto.atributos&&
     !/\b(?:produto|equipamento|modelo|item|kit|impressoras?|tanquinhos?|porta|boias?|facas?|facoes|facao|canivetes?|lanternas?|refletores?|fogao|fogareiro|cortador|earpods|ear|terno|t shirt|camisas?|camisetas?|calcas?|pants|sabonetes?|oleos?|mascaras?|nadadeiras?|snorkel|snorkeling|meias?|blocos?|panettones?|panetones?|chocottones?|chocotones?|arvores?|malas?|base|stand|suporte)\b/.test(tituloNormalizado))return null;
  const fatos=extrairFatosFuncionais(oferta,tituloNormalizado),t=fatos.titulo;
  const generico=/^(?:produto|equipamento|modelo|item|kit)(?: [a-z0-9]+){0,2}$/.test(t);
  const tipo=generico?fatos.texto:t;
  const contexto=fatos.texto;
  const prefixo=/^(?:(?:kit|jogo|conjunto|pacote) (?:\d+ )?(?:de )?)?(?:manual|curso|livro|capa|case|peca|refil de tinta|cartucho|toner|tinta|adesivo|miniatura|brinquedo|fantasia)\b/;
  if(prefixo.test(t))return null;
  const categorias=new Map();
  const add=(categoria,motivo)=>categorias.set(categoria,motivo);
  const pesca=/\b(?:pesca|camping|acampamento|trilha)\b/.test(contexto);
  const roupa=/\b(?:camisas?|camisetas?|calcas?|bermudas?|shorts?)\b/.test(tipo);
  const decorativa=/\b(?:estampa|estampada|estampado|desenho|frase|tema|decorativa|decorativo)\b/.test(tipo);
  const infantil=/\b(?:infantil|juvenil|crianca|bebe|boneca)\b/.test(contexto);
  const roupaPesca=roupa&&/\bpesca\b/.test(tipo)&&!decorativa&&!infantil&&
    /\b(?:uv\s*50|uv50|fpu\s*50|upf\s*50|poliamida|capuz|buff|touca|tube|secagem rapida)\b/.test(contexto);
  if(roupaPesca)add("Pesca e Camping","vestuario_tecnico_finalidade_pesca");
  if(/\bporta varas?\b/.test(tipo)&&!(/\b(?:cortina|rosca|aterramento|solda)\b/.test(contexto)))
    add("Pesca e Camping","acessorio_porta_varas");
  if(/\bboias?\b/.test(tipo)&&/\b(?:arremesso|cevadeira|pesca|anzol)\b/.test(tipo)&&!(/\b(?:piscina|natacao|infantil|caixa d agua)\b/.test(tipo)))
    add("Pesca e Camping","boia_finalidade_pesca");
  const faca=/\b(?:facas?|facoes|facao|canivetes?)\b/.test(tipo);
  const cozinha=/\b(?:cozinha|churrasco|churrasqueira|picanheira|desossar|chef|culinaria)\b/.test(contexto);
  if(faca&&cozinha)add("Casa, Móveis e Decoração","utensilio_culinario_explicito");
  if(faca&&pesca&&/\b(?:camping|acampamento|sobrevivencia|filetar peixes|limpar peixes)\b/.test(contexto))
    add("Pesca e Camping","lamina_finalidade_outdoor_explicita");
  const lanterna=/\blanternas?\b/.test(tipo);
  if(/\brefletores?\b/.test(tipo)&&/\b(?:fotografico|fotografia)\b/.test(tipo)&&/\bpassiv[oa]\b/.test(tipo))
    add("Diversos","refletor_passivo_sem_finalidade_eletrica");
  if(lanterna&&!/\b(?:automotiva|automotivo|traseira|veicular|farol|bicicleta)\b/.test(contexto))
    add(pesca?"Pesca e Camping":"Iluminação e Elétrica",pesca?"lanterna_finalidade_outdoor":"lanterna_iluminacao");
  if(/\brefletores?\b/.test(tipo)&&/\b(?:led|bivolt|iluminacao|luz|\d+\s*w)\b/.test(contexto)&&!(/\b(?:automotivo|fotografico|fotografia|passivo|bicicleta)\b/.test(tipo)))
    add("Iluminação e Elétrica","refletor_iluminacao_eletrica");
  if(/\b(?:fogao|fogareiro)\b/.test(tipo)&&pesca&&/\b(?:gas|portatil|arado|camping)\b/.test(tipo)&&
     !/\b(?:forno|embutir|industrial|residencial|[456] bocas)\b/.test(tipo))
    add("Pesca e Camping","fogareiro_finalidade_outdoor");
  if(/\bimpressoras?\b/.test(tipo)&&!(/\b(?:3d|peca|cabecote|cartucho|toner|refil|filamento|linha)\b/.test(tipo)))
    add("Periféricos","equipamento_impressao");
  if(/\btanquinhos?\b/.test(tipo)&&!(/\b(?:peca|motor|correia|tampa|agitador|brinquedo)\b/.test(tipo)))
    add("Eletrodomésticos","lavadora_semiautomatica");
  if(/\bcortador(?:es)? de grama\b/.test(tipo)&&/\b(?:eletrico|eletrica|motor|\d+\s*w)\b/.test(contexto))
    add("Ferramentas","ferramenta_jardinagem");
  if(/\b(?:earpods|ear pods)\b/.test(tipo)&&!(/\b(?:capa|case|adaptador|cabo|estojo|suporte)\b/.test(tipo)))
    add("Audio TV","fone_audio_identidade");
  if(!infantil&&!roupaPesca&&!(/\b(?:pet|cachorro|gato|boneco)\b/.test(tipo))&&
      /\b(?:terno|t shirt|camisetas?|camisas?|calcas?|pants)\b/.test(tipo)){
    const masc=/\b(?:masculin[oa]s?|homem|homens|men s)\b/.test(tipo),fem=/\b(?:feminin[oa]s?|mulher|mulheres|women s)\b/.test(tipo);
    if(masc)add("Roupas e Moda Masculina","vestuario_publico_explicito");
    if(fem)add("Roupas e Moda Feminina","vestuario_publico_explicito");
  }
  const pet=/\b(?:pet|cachorro|gato|veterinario|canino|felino)\b/.test(contexto);
  if(pet&&/\b(?:sabonetes?|shampoo)\b/.test(tipo)&&/\b(?:veterinario|canino|felino|para cachorro|para gato)\b/.test(contexto))
    add("Pet Shop e Fazendinha","higiene_finalidade_veterinaria");
  if(!pet&&(/\bsabonetes? liquidos?\b|\boleos? (?:de |para )?banho\b/.test(tipo)||
     (/\bmascaras?\b/.test(tipo)&&(/\b(?:capilar|cabelos?|tonalizante)\b/.test(contexto)||/\btonaliza\b/.test(contexto)&&/\bhidrata\b/.test(contexto)))))
    add("Perfumaria, Farmácia e Beleza","higiene_cuidado_pessoal_explicito");
  if(/\b(?:nadadeiras?|snorkel|snorkeling|meias? de mergulho)\b/.test(tipo)&&!(/\b(?:brinquedo|aquario|peixe ornamental|adesivo)\b/.test(tipo)))
    add("Esporte e Suplementos","equipamento_esporte_aquatico");
  if(/\bblocos?\b/.test(tipo)&&/\b(?:educacao artistica|desenho|papel|folhas)\b/.test(tipo)&&!(/\b(?:construcao|concreto|motor)\b/.test(tipo)))
    add("Papelaria e Livros","material_artistico_papelaria");
  if(/\b(?:panetones?|panettones?|chocotones?|chocottones?)\b/.test(tipo)&&!(/\b(?:forma|embalagem|caixa vazia|sabonete|essencia|receita|livro)\b/.test(tipo)))
    add("Alimentos e Mercearia","alimento_panificacao");
  if(/\barvores? de natal\b/.test(tipo))add("Casa, Móveis e Decoração","decoracao_natalina");
  if(/\bmalas?\b/.test(tipo)&&/\b(?:viagem|bordo|\d+\s*kg)\b/.test(tipo)&&!(/\b(?:ferramentas|medica|maquiagem|brinquedo)\b/.test(tipo)))
    add("Casa, Móveis e Decoração","bagagem_viagem");
  if(/\b(?:base|stand|suporte)\b/.test(tipo)&&/\b(?:wheels|rodas|rodizios)\b/.test(tipo)&&/\b(?:refrigerator|geladeira|dishwasher|lava loucas)\b/.test(tipo))
    add("Casa, Móveis e Decoração","suporte_movel_domestico");
  if(!categorias.size)return null;
  if(/\+/.test(String(oferta.titulo||oferta.nome||"")) || /\b(?:kit|combo|conjunto)\b/.test(tipo)&&/\b(?:e|com)\b/.test(tipo)){
    if(/\b(?:notebook|laptop)\b/.test(tipo))add("Computadores e Notebook","produto_distinto_no_kit");
    if(/\b(?:smartphone|celular)\b/.test(tipo))add("Celulares e Smartphones","produto_distinto_no_kit");
    if(/\bperfume\b/.test(tipo))add("Perfumaria, Farmácia e Beleza","produto_distinto_no_kit");
    if(/\b(?:furadeira|parafusadeira)\b/.test(tipo))add("Ferramentas","produto_distinto_no_kit");
    if(/\b(?:sabao em po|detergente|desinfetante|limpa pisos)\b/.test(tipo))add("Limpeza","produto_distinto_no_kit");
  }
  // Naturezas incompatíveis no mesmo kit não ganham destino por prioridade.
  if(categorias.size>1)return {categoria:"Diversos",motivo:"naturezas_funcionais_conflitantes",fontes:fatos.fontes};
  const [[categoria,motivo]]=categorias;
  return {categoria,motivo,fontes:fatos.fontes};
}
module.exports={avaliarFamiliaFuncional,avaliarNaturezaFuncional,extrairFatosFuncionais};
