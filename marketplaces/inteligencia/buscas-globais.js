// =================== BUSCAS GLOBAIS ===================

const BUSCAS_GLOBAIS = {
 pesca: [
  "vara de pesca oferta", "vara telescópica", "vara de carretilha",
  "molinete pesca promocao", "carretilha de pesca", "anzol",
  "iscas artificiais pesca", "linha de pesca", "caixa pesca organizadora",
  "mochila de pesca", "fogareiro", "fogao portatil", "chaira",
  "tenis nautico", "bota de pescador", "rede de dormir", "caixa termica",
  "barraca", "linha multifilamento", "linha fluorcarbono", "linha de pesca",
  "kit de pesca", "marine sports", "abu garcia", "lori fishing", "venza",
  "daiwa", "shimano", "nelson nakamura", "vexter", "brava", "mochila de pesca",
  "jogá", "joga", "mochila joga", "mochila de pesca com suporte", "faca de pesca"
],

  beleza: [
    "perfume masculino promocao", "kit malbec","promocao boticario",
    "perfume feminino promocao",  "kit natura","promocao natura",
    "shampoo promocao",  "kit perfume","kit locao", "kit shampoo",
    "desodorante promocao", "kit creme", "promocao de creme",
    "hidratante promocao", "kit hidratante", "sabonete", "eudora",
    "maquiagem", "esmalt", "glos labial", "baton", "pulseira" 
  ], 
 
  hardware: [
    "nvme 1tb m2", "nvme", "ssd 500 gb", "ssd kingston",
    "ssd 1tb promocao", "ssd 1tb kootion", "hd exos",
    "mouse gamer oferta", "attack shark", "redragom",
    "teclado mecanico oferta", "monitor curvo",
    "placa de video promocao", "monitor gamer",
    "headset gamer oferta", "monitor gamer oferta",
    "netac", "m2 movespeed", "movespeed", "sandisk",
    "fonte gamer", "fonte gamer promocao", "corsair", 
    "knup", "revengers", "master cool", "deep cool",
    "air cooler gamer", "water cooler", "water gamer",
    "teclado magnetico", "mini teclado", "rise mode",
    "headset promocao", "headset barato", "mouse sem fio",
    "headset rise", "headset havit", "headset headset binnune",
    "tgt", "corsair", "montech", "gabinte gamer", "binnune", 
    "nvidia", "amd", "ryzen", "intel", "redragon", "rise"  
  ],

  tenis: [
    "tenis masculino oferta", "tenis masculino adidas", "tenis masculino fila",
    "tenis feminino promocao", "tenis feminino adidas", "tenis feminino fila",
    "mizuno promocao", "fila promocao", "adidas promocao", "mizuno promocao",
    "nike promocao", "olympicus promocao", "puma promocao", "asics promocao", "fila",
    "new balance promocao", "chinelo promocao", "kappa promocao", "reebok promocao",
    "chinelo nike", "chinelo promocao", "chinelo rider", "sandalha", "rasteirinha",
    "chinelo cropped masculino", "chinelo cropped feminino", "chinelo havaianas",
    "nike", "olympicus", "mizuno", "kappa", "new balance", "havaianas", "asics"   
  ],

  casa: [
    "air fryer promocao", "condicionador de ar", "ar split",
    "liquidificador promocao", "ar condicionado", "espelho",
    "cafeteira promocao", "torneira automatica", "torneira",
    "ventilador promocao", "torneira de pia gourmet",
    "cadeira escritorio", "torneira de banheiro", "luminaria",
    "refletor externo", "refletor", "varal de chão",  "varal",
    "varal de parede", "varal versatil", "lixeira",  "campainha",
    "abajur", "fechadura eletrônica", "lustre",  "campainha sem fio"
  ],

  automotivo: [
  "central multimidia", "som automotivo", "pneu promocao",
  "oleo motor", "kit xenon", "lampada led automotiva",
  "camera de re", "multimidia android", "tapete automotivo",
  "carregador veicular", "compressor automotivo", "macaco hidraulico",
  "pelicula automotiva", "alarme automotivo", "sensor de estacionamento",
  "calota", "volante esportivo", "retrovisor automotivo",
  "caixa trio automotiva", "subwoofer", "corneta automotiva",
  "modulo taramps", "stetsom", "pioneer", "jbl selenium"
],

eletrodomesticos: [
  "geladeira promocao", "maquina de lavar", "microondas",
  "fogao promocao", "cooktop", "forno eletrico", "ar split",
  "lava e seca", "aspirador de po", "robo aspirador",
  "air fryer", "frigobar", "purificador de agua",
  "bebedouro", "freezer horizontal", "coifa cozinha",
  "depurador", "centrifuga roupa", "maquina lava louca"
],

eletroportateis: [
  "escova secadora", "secador de cabelo", "chapinha", "multi cook philco",
  "barbeador eletrico", "maquina cortar cabelo", "massageador eletrico", 
  "cafeteira", "liquidificador", "batedeira", "multi cook", "grill",
  "espremedor", "panela eletrica", "grill eletrico", "sanduicheira",
  "fritadeira eletrica", "vaporizador", "passadeira vapor",
  "aspirador portatil", "multi cook philco antiaderente" 
],

limpeza: [
  "sabao liquido", "amaciante promocao", "desinfetante",
  "detergente", "papel higienico", "kit limpeza",
  "mop giratorio", "rodo magico", "vassoura eletrica",
  "limpa piso", "alcool limpeza", "esponja limpeza",
  "lava roupas", "produto limpeza pesada", "kit lavanderia",
  "amo 4 kg", "omo", "ype", "tira mancha venesh", "venesh",
  "limpador multiuso", "veja", "downy", "cif multiuso",
  "brilhante", "downy amaciante ", "dwayne ", "bom ar"
],  

notebooksPc: [
  "notebook gamer", "notebook promocao", "pc gamer",
  "gabinete gamer", "cadeira gamer", "mesa gamer",
  "monitor gamer", "notebook lenovo", "notebook dell",
  "notebook samsung", "macbook", "mini pc",
  "all in one", "chromebook", "kit upgrade pc"
],

perifericos: [
  "mouse gamer", "mouse sem fio", "teclado mecanico",
  "headset gamer", "webcam", "microfone gamer",
  "mousepad gamer", "controle gamer", "adaptador usb",
  "hub usb", "fonte notebook", "cooler notebook",
  "cadeira gamer", "suporte notebook", "mesa digitalizadora"
],

mercearia: [
  "cafe promocao", "capsula dolce gusto", "whey protein",
  "creatina", "barra proteina", "suplemento", "olho de coco",
  "arroz promocao", "feijao promocao", "azeite", "sal marinho",
  "kit churrasco", "kit cozinha", "temperos", "sal integral",
  "chocolate promocao", "biscoito promocao", "snack fit"
],

modaFeminina: [
  "vestido feminino", "cropped",
  "conjunto feminino", "legging feminina",
  "calca feminina", "short feminino",
  "blusa feminina", "baby doll",
  "pijama feminino", "lingerie",
  "sutia", "calcinha",
  "moda evangelica feminina",
  "bolsa feminina", "sandalia feminina",
  "salto feminino", "tenis feminino",
  "jaqueta feminina", "moletom feminino",
  "roupa fitness feminina",
  "saia feminina", "biquini",
  "maio feminino", "camiseta feminina",
  "plus size feminina"
],

modaMasculina: [
  "camiseta masculina", "camisa polo",
  "bermuda masculina", "calca jeans masculina",
  "cueca", "carteira masculina",
  "tenis masculino", "chinelo masculino",
  "moletom masculino", "jaqueta masculina",
  "camisa social masculina",
  "roupa fitness masculina",
  "regata masculina",
  "short masculino",
  "bone masculino",
  "relogio masculino",
  "perfume masculino",
  "roupa evangelica masculina",
  "camisa time futebol",
  "roupa termica masculina"
],

perfumariaBeleza: [
  "perfume importado", "perfume promocao", "perfume masculino",
  "perfume feminino", "azzaro", "ferrari black",
  "eternity", "212", "armani", "hugo boss",
  "lattafa", "asad", "malbec", "natura",
  "eudora", "boticario", "kaiak",
  "essencial", "club 6", "zaad",
  "coffee woman", "quasar", "perfume arabe",
  "pomada para dor", "gel para dor muscular",
  "gelo reutilizavel", "protetor solar",
  "creme dental", "pasta de dente",
  "listerine", "enxaguante bucal",
  "fio dental", "lenco umedecido",
  "hipoglos", "vick vaporub",
  "pastilha garganta", "doralgina",
  "omeprazol", "pantoprazol",
  "vitamina c", "colageno",
  "creatina", "whey protein",
  "termogenico", "multivitaminico",
  "melzinho", "massageador corporal"
],

bebes: [
  "fralda promocao", "kit bebe",
  "mamadeira", "fralda pampers",
  "fralda huggies", "carrinho bebe",
  "berco", "banheira bebe",
  "kit fralda pampers", "roupa bebe",
  "cadeira alimentacao", "fralda",
  "chupeta", "brinquedo educativo",
  "pomada assadura", "pomada pra assadura",
  "tapete de bebe", "brinquedo infantil",
  "shampoo de bebe", "lenco umedecido",
  "kit maternidade", "saida maternidade",
  "babador", "berco portatil",
  "cadeirinha bebe", "andador bebe",
  "banho bebe", "nan", "aptamil"
],

petshop: [
  "racao cachorro", "racao gato", "areia gato",
  "brinquedo pet", "coleira cachorro",
  "tapete higienico", "casinha cachorro",
  "arranhador gato", "petisco cachorro"
],

esporte: [
  // ACADEMIA
  "halter", "kit halter",
  "barra musculacao", "anilha",
  "luva academia", "cinto musculacao",
  "corda pular", "colchonete yoga",
  "tapete yoga", "faixa elastica",
  "mini band", "garrafinha academia",
  "squeeze termica", "bolsa academia",
  "equipamento academia",
  "bicicleta ergometrica",
  "esteira eletrica",
  "smartwatch esportivo",

  // SUPLEMENTOS
  "whey protein", "creatina",
  "pre treino", "bcaa",
  "albumina", "hipercalorico",
  "termogenico", "multivitaminico",
  "colageno", "glutamina",
  "coqueteleira", "suplemento",

  // ESPORTES
  "camisa futebol",
  "bola futebol",
  "chuteira",
  "joelheira",
  "cotoveleira",
  "kimono",
  "bicicleta promocao",
  "patins",
  "skate",
  "raquete beach tennis"
],


brinquedos: [
  "lego promocao", "boneca infantil", "caminhao de controle",
  "carrinho controle remoto", "hot wheels", "lancha de controle",
  "piscina infantil", "patinete", "trator de controle remoto", 
  "bola de futebol", "skate infantil", "brinquedo educativo",
  "losa magica", "motoca", "kit de carrinho", "brinquedo educativo",
  "boneca", "boneco", "pistola de agua", "caminhao de terra",
  "batman", "homem aranha", "hulk", "robo", "homem de ferro" 
],


 ferramentas: [
    "furadeira oferta", "kit ferramentas", "parafusadeira de impacto",
    "parafusadeira promocao", "chave de impacato", "lixadeira",
    "kit ferramentas promocao", "moto serra portatil", "bomba de veneno",
    "macaco jacaré", "macaco hidraulico", "extitor automotivo", "chave philips",
    "kit parafusadeira", "extintor de incendio veicular", "chave de fenda",
    "jogo de chave combinada", "kit chave de fenda", "kit chave philips",
    "combo chave de impacto", "compressor de ar", "chave inglesa"    
  ], 

  celulares: [
    "smartphone promocao", "smartphone promocao relâmpago",
    "iphone oferta", "smartphone barato", "smartphone cupom",
    "samsung galaxy promocao", "smartphone xiaomi", "nokia",
    "xiaomi promocao", "smartphone pocophone", "smartphone galax",
     "xiaomi", "samsumg", "lg", "xiaomi", "caterpillar", "sony"
  ],

  audioTv: [
    "smart tv promocao",
    "tv 43 promocao", "tv monitor", "suporte para tv",
    "tv 55 promocao", "tv oled 144hz", "home theater",
    "tv 65 oferta", "conversor digital", "tv stick wi-fi",
    "tv 75 oferta", "box ip tv", "tv stick adroid", 
    "caixa de som bluetooth", "caixa de som jbl", "cabo hdmi",
    "caixa de som aiwa", "soundbar promocao", "samsung",
    "lg", "philco", "philips", "tcl", "roku","panassonic"
  ]
};

function gerarBuscasGlobais(limite = 30) {
  return Object.values(BUSCAS_GLOBAIS)
    .flat()
    .sort(() => Math.random() - 0.5)
    .slice(0, limite);
}

module.exports = {
  BUSCAS_GLOBAIS,
  gerarBuscasGlobais
}
