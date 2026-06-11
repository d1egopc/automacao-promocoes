function normalizarTextoLocal(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function contemAlgum(texto, palavras = []) {
  return palavras.some(palavra =>
    texto.includes(normalizarTextoLocal(palavra))
  );
}

function classificarCategoriaOferta(oferta = {}, termo = "") {
  const marketplace = normalizarTextoLocal(oferta.marketplace || "");

  const texto = normalizarTextoLocal(`
    ${termo}
    ${oferta.titulo || ""}
    ${oferta.nome || ""}
    ${oferta.descricao || ""}
    ${oferta.categoria || ""}
    ${marketplace}
  `);

console.log("🧪 CLASSIFICANDO CATEGORIA:", texto);

// ===== PERFUMARIA / BELEZA TEM PRIORIDADE MÁXIMA =====
if (
  texto.includes("perfume") ||
  texto.includes("edp") ||
  texto.includes("edt") ||
  texto.includes("eau de parfum") ||
  texto.includes("eau de toilette") ||
  texto.includes("colonia") ||
  texto.includes("colônia") ||
  texto.includes("deo colonia") ||
  texto.includes("malbec") ||
  texto.includes("lattafa") ||
  texto.includes("yara") ||
  texto.includes("body splash") ||
  texto.includes("maquiagem") ||
  texto.includes("skincare") ||
  texto.includes("hidratante") ||
  texto.includes("protetor solar") ||
  texto.includes("shampoo") ||
  texto.includes("condicionador")
) {
console.log("✅ CAIU EM PERFUMARIA PRIORIDADE:", oferta.titulo || oferta.nome);
  return "Perfumaria, Farmácia e Beleza";
}


  // ===== CORREÇÕES FORTES ANTES DE TUDO =====

  if (contemAlgum(texto, [
    "ventilador", "ventilador de mesa", "ventilador de coluna",
    "ventilador de teto", "circulador de ar", "ar condicionado",
    "ar-condicionado", "climatizador", "umidificador",
    "desumidificador", "aquecedor", "exaustor", "purificador de ar"
  ])) return "Climatização e Ventilação";

if (contemAlgum(texto, [
    "bebedouro esmaltec", "purificador de agua", "purificador de água",
    "agua gelada", "água gelada", "bebedouro de mesa", "bebedouro coluna"
  ])) return "Eletrodomésticos";

  if (contemAlgum(texto, [
    "maquina de cortar cabelo", "máquina de cortar cabelo",
    "maquininha de cortar cabelo", "maquina de barbear", "máquina de barbear",
    "barbeador", "aparador de pelos", "aparador de barba",
    "kemei", "kemel", "barbearia", "shaver", "depilador"
  ])) return "Perfumaria, Farmácia e Beleza";


// ===== INFANTIL / ROUPAS E CALÇADOS INFANTIL =====

if (contemAlgum(texto, [
  "infantil", "juvenil", "menino", "menina", "kids", "kid",

  "bota infantil",
  "coturno infantil",
  "botina infantil",

  "camisa infantil",
  "camisa xadrez infantil",

  "calca moletom infantil",
  "calça moletom infantil",

  "moletom infantil",
  "roupa infantil",

  "patins infantil",

  "sandalia infantil",
  "sandália infantil",

  "chinelo infantil",

  "tenis infantil",
  "tênis infantil",

  "conjunto infantil",

  "vestido infantil",

  "pijama infantil",

  "body infantil",

  "fantasia infantil",

  "sereia com led",

  "1 a 16 anos",

  "criança",
  "crianca",

  "bebê infantil",
  "moda infantil"
])) return "Roupas e Calçados Infantil";


if (contemAlgum(texto, [
  "calcinha", "sutia", "sutiã", "lingerie", "cueca feminina",
  "calcinha boxer", "short sem costura", "she by mash",
  "segunda pele", "anagua", "anágua", "camisola",
  "pijama feminino", "baby doll", "babydoll",
  "biquini", "bíquini", "maio natacao", "maiô natação",

  "camiseta feminina",
  "camiseta oversized",
  "camiseta oversized feminina",
  "blusa feminina",
  "regata feminina",
  "t-shirt feminina",
  "baby look",
  "babylook",
  "cropped",
  "cropped feminino",

  "vestido",
  "saia",

  "short feminino",
  "shorts feminino",

  "calca feminina",
  "calça feminina",

  "legging",
  "legging feminina",

  "body feminino",

  "macaquinho feminino",
  "macacao feminino",
  "macacão feminino",

  "conjunto feminino",

  "moletom feminino",
  "jaqueta feminina",

  "gola alta",
  "strass",
  "camiseta gola alta",

  "moda feminina",

  "plus size feminino",
  "plus size feminina",

  // ===== NOVOS =====

  "blusa brasil",
  "blusa do brasil",

  "tricot feminino",
  "tricô feminino",

  "wide leg",
  "calca wide leg",
  "calça wide leg",

  "jeans feminina",

  "bolsa feminina",
  "bolsas femininas",

  "tiracolo",
  "tote",

  "carteira feminina",

  "meia calca",
  "meia-calca",
  "meia-calça",

  "peluciada",

  "look feminino",

  "camisa xadrez feminina",
  "xadrez feminina",

  "moda evangelica",
  "moda evangélica",
   
   // ===== REFORÇO =====

  "camisa feminina",
  "camisete feminina",

  "blazer feminino",

  "kimono feminino",

  "cardigan",
  "cardigã",

  "top feminino",
  "top cropped",

  "conjunto moletom feminino",

  "calca flare",
  "calça flare",

  "calca pantalona",
  "calça pantalona",

  "jardineira feminina",

  "colete feminino",

  "sobretudo feminino",

  "casaco feminino",

  "parka feminina",

  "anorak feminino",

  "jaqueta jeans feminina",

  "camisa jeans feminina",

  "bermuda feminina",

  "mule feminino",

  "sapatilha feminina",

  "tamanco feminino"
  
])) return "Roupas e Moda Feminina";

if (contemAlgum(texto, [
  "camisa polo", "polo piquet", "camiseta masculina", "camisetas masculina",
  "camiseta henley", "henley", "camiseta basica", "camiseta básica",
  "camiseta premium", "camiseta algodao", "camiseta algodão",
  "camiseta oversized masculina", "camiseta masculina oversized",
  "kit camiseta masculina", "kit camisetas masculinas",
  "kit camiseta", "kit camisetas",
  "camisa masculina", "camisa social masculina",
  "moletom masculino", "jaqueta masculina",
  "calca jeans masculina", "calça jeans masculina",
  "bermuda masculina", "short masculino", "shorts masculino",
  "regata masculina", "cueca boxer", "cuecas boxer",
  "boxer masculina", "boxer masculino",
  "moda masculina", "plus size masculino",

  "calca masculina",
  "calça masculina",

  "calca sarja masculina",
  "calça sarja masculina",

  "calca moletom masculina",
  "calça moletom masculina",

  "camisa xadrez masculina",
  "camisa jeans masculina",

  "blusa masculina",
  "blusao masculino",
  "blusão masculino",

  "casaco masculino",
  "colete masculino",

  "jaqueta jeans masculina",
  "jaqueta couro masculina",

  "conjunto masculino",
  "conjunto moletom masculino",

  "terno masculino",
  "blazer masculino",

  "pijama masculino",

  "sunga",
  "short praia masculino",
  "bermuda tactel masculina",

  "carteira masculina",
  "cinto masculino",

  "meia masculina",
  "meias masculinas"
  
])) return "Roupas e Moda Masculina";

if (contemAlgum(texto, [
  "tenis", "tênis",
  "chinelo",
  "havaianas",

  "sandalia", "sandália",
  "rasteira", "rasteirinha",

  "tamanco",
  "sapatilha",

  "sapatenis", "sapatênis",

  "crocs",
  "papete",

  "mocassim",
  "loafer",

  "bota",
  "botina",
  "coturno",

  "sapato",
  "salto",
  "salto alto",

  "mizuno",
  "asics",
  "nike",
  "adidas",
  "olympikus",
  "olympicus",
  "fila",
  "vizzano",
  "piccadilly",
  "puma",
  "reebok",
  "new balance",
  "kappa",

  // reforço

  "pegada",
  "democrata",
  "ferracini",
  "beira rio",
  "moleca",
  "molekinha",
  "molekinho",

  "via marte",
  "dakota",

  "sandalia plataforma",
  "sandália plataforma",

  "tenis corrida",
  "tênis corrida",

  "tenis casual",
  "tênis casual",

  "tenis esportivo",
  "tênis esportivo",

  "calcado feminino",
  "calçado feminino",

  "calcado masculino",
  "calçado masculino"
])) return "Tênis e Chinelos";

if (contemAlgum(texto, [
  "smartwatch", "smart watch",
  "relogio inteligente", "relógio inteligente",
  "smart band", "smartband",
  "pulseira inteligente",
  "monitor cardiaco", "monitor cardíaco",

  "amazfit", "galaxy watch",
  "apple watch", "mi band",
  "haylou", "huawei band",

  "rastreador bluetooth",
  "airtag", "smart tag", "galaxy smarttag",

  "controle remoto universal",
  "controle smart",
  "tomada inteligente",
  "lampada inteligente", "lâmpada inteligente",
  "interruptor inteligente",
  "sensor inteligente",
  "camera inteligente", "câmera inteligente"
])) return "Eletrônicos";

if (contemAlgum(texto, [
  "halter", "haltere", "kettlebell", "musculacao", "musculação",
  "peso livre", "crossfit", "whey", "creatina", "pre treino",
  "pré treino", "albumina", "barra de proteina", "barra de proteína",
  "barra proteica", "faixa elastica", "faixa elástica",

  "bike", "bicicleta", "spinning", "esteira", "eliptico", "elíptico",
  "ergometrica", "ergométrica",

  "tapete yoga", "tapete para yoga", "yoga", "pilates",

  "short academia", "camiseta academia", "dry fit",
  "legging esportiva", "top esportivo", "bermuda esportiva",

  "bola de futebol", "bola futebol", "bola futsal",
  "bola volei", "bola vôlei", "bola basquete",

  "luva academia", "caneleira", "corda de pular",
  "saco de pancada", "kimono", "tatame",

  "suplemento", "hipercalorico", "hipercalórico",
  "bcaa", "glutamina", "coqueteleira", "shakeira",

  "tenis corrida", "tênis corrida", "tenis esportivo",
  "tênis esportivo", "corrida", "caminhada",

  "garrafa termica esportiva", "garrafa esportiva",
  "squeeze", "mochila hidratacao", "mochila hidratação"
])) return "Esporte e Suplementos";


if (contemAlgum(texto, [
  "perfume", "parfum",
  "eau de toilette", "eau de parfum",

  "calvin klein", "eternity",
  "hugo boss", "azzaro",
  "gabriela sabatini",
  "malbec", "lattafa",
  "yara", "body splash",
  "invictus", "montblanc",
  "paco rabanne",
  "armani",

  "eudora", "siage", "siàge",

  "shampoo",
  "condicionador",
  "máscara capilar",
  "mascara capilar",

  "secador",
  "chapinha",
  "prancha",
  "escova secadora",
  "modelador",
  "babyliss",

  "hidratante",
  "protetor solar",
  "skincare",
  "maquiagem",

  "creme facial",
  "creme corporal",
  "sabonete facial",
  "serum",
  "sérum",

  "pomada",
  "massageadora",
  "arnica",
  "mentol",

  "principia",

  "magnesio", "magnésio",
  "vitamina",
  "multivitaminico",
  "multivitamínico",

  "capsulas",
  "cápsulas",

  "fio dental",
  "enxaguante",
  "colutorio",
  "colutório",

  "termometro",
  "termômetro",

  "medidor de pressao",
  "medidor de pressão",

  "balanca corporal",
  "balança corporal",

  "nivea",
  "loreal", "l'oréal",
  "elseve",
  "pantene",
  "tresemme", "trésemme",
  "dove",

  "vichy",
  "la roche",
  "la roche-posay",
  "cerave", "ceravee",

  "avon",
  "natura",
  "boticario", "boticário",
  "o boticario", "o boticário",

  "granado",
  "bio extratus",
  "wella",
  "eucerin"

])) return "Perfumaria, Farmácia e Beleza";


  if (contemAlgum(texto, [
  "furadeira", "parafusadeira", "esmerilhadeira",
  "serra marmore", "serra mármore", "serra circular",
  "serra tico tico", "martelete", "lixadeira",
  "trena", "nivel laser", "nível laser",
  "kit ferramenta", "kit ferramentas",
  "jogo de ferramentas", "maleta de ferramentas",
  "caixa de ferramentas",
  "chave inglesa", "chave ajustavel", "chave ajustável",
  "chave grifo", "chave allen", "chave combinada",
  "chave soquete", "soquete", "adaptador soquete",
  "alicate pressão", "alicate pressao",
  "alicate universal", "alicate corte",
  "alicate bico", "alicate bomba d agua",
  "alicate bomba d'agua", "alicate grifo",
  "vonder", "makita", "bosch", "dewalt",
  "gedore", "fertak", "tramontina pro",
  "macaco hidraulico", "macaco hidráulico",
  "compressor de ar", "pistola pintura",
  "soprador termico", "soprador térmico",
  
// ===== REFORÇO =====

  "micro retifica",
  "micro retífica",
  "retifica",
  "retífica",

  "serra sabre",
  "serra meia esquadria",
  "esmeril",

  "inversora solda",
  "maquina solda",
  "máquina solda",
  "soldadora",

  "lavadora alta pressao",
  "lavadora alta pressão",
  "wap",

  "gerador energia",
  "gerador portátil",
  "gerador portatil",

  "multimetro",
  "multímetro",

  "detector metal",
  "detector de metal",

  "grampeador pneumático",
  "grampeador pneumatico",

  "pregador pneumático",
  "pregador pneumatico",

  "torquimetro",
  "torquímetro",

  "carrinho ferramenta",
  "carrinho de ferramentas",

  "bateria makita",
  "bateria dewalt",
  "bateria bosch",

  "disco corte",
  "disco diamantado",

  "broca",
  "jogo brocas",
  "kit brocas",

  "chave catraca",
  "catraca"
])) return "Ferramentas";

  
if (contemAlgum(texto, [
  // Cozinha
  "jogo de panelas", "kit panela", "frigideira",
  "panela", "caçarola", "caçarola", "fervedor",
  "faqueiro", "tramontina", "talheres",
  "copos", "taças", "tacas", "jogo de copos",
  "cortador de legumes", "ralador", "fatiador",
  "marmitas", "potes", "travas hermeticas", "travas herméticas",
  "formas assadeiras", "assadeira", "forma antiaderente",
  "crepeira", "maquina de crepe", "máquina de crepe",
  "garrafa inox", "garrafa termica", "garrafa térmica",

  // Cama e Banho
  "cobertor", "manta",
  "toalhas de banho", "toalha de banho",
  "colcha", "cobre leito",

  // Decoração
  "tapete", "cortina", "almofada",
  "espelho", "adnet",

  // Móveis
  "sofa", "sofá",
  "rack",
  "painel tv", "painel de tv",
  "guarda roupa", "guarda-roupa",
  "roupeiro",
  "mesa", "cadeira",

  "cadeira de escritorio",
  "cadeira de escritório",
  "cadeira ergonomica",
  "cadeira ergonômica",
  "cadeira executiva",
  "cadeira presidente",

  "penteadeira",
  "comoda", "cômoda",
  "armario", "armário",

  "escrivaninha",
  "nicho",
  "prateleira",
  "sapateira",
  "cabideiro",
  "cabeceira",
  "poltrona",
  "estante",
  "aparador",
  "buffet",
  "criado mudo",
  "criado-mudo",

  // Casa
  "varal",
  "lixeira",
  "guarda chuva",
  "torneira",
  "banheiro",
  "cozinha",

  // Churrasco
  "kit churrasco",

  // Utilidades
  "utensilios cozinha",
  "utensílios cozinha"
])) return "Casa, Móveis e Decoração";if (contemAlgum(texto, [
  // Cozinha
  "jogo de panelas", "kit panela", "frigideira",
  "panela", "caçarola", "caçarola", "fervedor",
  "faqueiro", "tramontina", "talheres",
  "copos", "taças", "tacas", "jogo de copos",
  "cortador de legumes", "ralador", "fatiador",
  "marmitas", "potes", "travas hermeticas", "travas herméticas",
  "formas assadeiras", "assadeira", "forma antiaderente",
  "crepeira", "maquina de crepe", "máquina de crepe",
  "garrafa inox", "garrafa termica", "garrafa térmica",

  // Cama e Banho
  "cobertor", "manta",
  "toalhas de banho", "toalha de banho",
  "colcha", "cobre leito",

  // Decoração
  "tapete", "cortina", "almofada",
  "espelho", "adnet",

  // Móveis
  "sofa", "sofá",
  "rack",
  "painel tv", "painel de tv",
  "guarda roupa", "guarda-roupa",
  "roupeiro",
  "mesa", "cadeira",

  "cadeira de escritorio",
  "cadeira de escritório",
  "cadeira ergonomica",
  "cadeira ergonômica",
  "cadeira executiva",
  "cadeira presidente",

  "penteadeira",
  "comoda", "cômoda",
  "armario", "armário",

  "escrivaninha",
  "nicho",
  "prateleira",
  "sapateira",
  "cabideiro",
  "cabeceira",
  "poltrona",
  "estante",
  "aparador",
  "buffet",
  "criado mudo",
  "criado-mudo",

  // Casa
  "varal",
  "lixeira",
  "guarda chuva",
  "torneira",
  "banheiro",
  "cozinha",

  // Churrasco
  "kit churrasco",

  // Utilidades
  "utensilios cozinha",
  "utensílios cozinha"
])) return "Casa, Móveis e Decoração";


if (contemAlgum(texto, [
    "luminaria", "luminária", "lustre", "pendente", "pendente led",
    "refletor", "refletor led", "holofote", "lampada", "lâmpada",
    "painel led", "plafon", "spot", "spot led", "fita led",
    "led strip", "tomada", "interruptor", "extensao", "extensão",
    "disjuntor", "sensor de presenca", "sensor de presença",
    "soquete", "bocal", "fio eletrico", "fio elétrico", "cabo eletrico",
    "cabo elétrico"
  ])) return "Iluminação e Elétrica";


if (contemAlgum(texto, [
  "racao",
  "ração",
  "cachorro",
  "gato",
  "petisco",
  "bifinho",
  "pedigree",
  "quatree",
  "tapete higienico",
  "tapete higiênico",

  "coleira",
  "guia para cachorro",
  "peitoral para cachorro",

  "comedouro",
  "bebedouro pet",
  "bebedouro para cachorro",
  "bebedouro para gato",

  "chalesco",
  "petlove",

  "avert",
  "macrogard",
  "pet sticks",
  "pet stick",

  "brinquedo para cachorro",
  "brinquedo para gato",

  "areia para gato",

  "antipulgas",
  "anti pulgas",
  "vermifugo",
  "vermífugo",

  "arranhador",
  "casinha pet",
  "cama pet",
  "caminha pet",
  "transportadora pet",
    // ===== REFORÇO =====

  "whiskas",
  "golden",
  "premier pet",
  "granplus",
  "special dog",
  "special cat",

  "royal canin",
  "farmina",

  "petisco cachorro",
  "petisco gato",

  "osso mastigavel",
  "osso mastigável",

  "mordedor cachorro",

  "roupa pet",
  "fantasia pet",

  "shampoo pet",
  "condicionador pet",

  "escova pet",

  "caixa transporte",
  "caixa de transporte",

  "gaiola",
  "viveiro",

  "aquario",
  "aquário",

  "fonte pet",
  "fonte para gato",

  "comedouro automatico",
  "comedouro automático",

  "bebedouro automatico",
  "bebedouro automático",

  "educador sanitario",
  "educador sanitário",

  "granulado higienico",
  "granulado higiênico",

  "areia higienica",
  "areia higiênica"
])) return "Pet Shop e Fazendinha";

  if (contemAlgum(texto, [
    "fralda", "huggies", "pampers", "lenco umedecido", "lenço umedecido",
    "lencos umedecidos", "lenços umedecidos", "mamadeira", "chupeta",
    "berco", "berço", "mosquiteiro", "carrinho de bebe", "carrinho de bebê",
    "bebe conforto", "bebê conforto", "tapete infantil", "tatame infantil",
      
// ===== REFORÇO =====

  "formula infantil",
  "fórmula infantil",

  "nan",
  "aptamil",
  "nestogeno",
  "nestogênio",

  "kit maternidade",

  "saida maternidade",
  "saída maternidade",

  "body bebe",
  "body bebê",

  "macacao bebe",
  "macacão bebê",
  "macacao infantil",
  "macacão infantil",

  "babador",

  "prato infantil",
  "talher infantil",

  "cadeira alimentacao",
  "cadeira alimentação",

  "banheira bebe",
  "banheira bebê",

  "almofada amamentacao",
  "almofada amamentação",

  "extrator leite",
  "bomba tira leite",

  "andador bebe",
  "andador bebê",

  "berco portatil",
  "berço portátil",

  "ninho bebe",
  "ninho bebê",

  "kit higiene bebe",
  "kit higiene bebê",

  "termometro infantil",
  "termômetro infantil",

  "aspirador nasal",

  "mordedor",

  "brinquedo educativo",

  "tapete atividades",
  "tapete de atividades"
  ])) return "Bebês e Acessórios";

if (contemAlgum(texto, [
  "placa de video",
  "placa de vídeo",
  "placa grafica",
  "placa gráfica",
  "rtx",
  "gtx",
  "rx 580",
  "rx 6600",
  "rx 7600",
  "rx 9070",
  "geforce",
  "radeon",

  "ssd",
  "ssd nvme",
  "nvme",
  "m.2",
  "ssd sata",

  "memoria ram",
  "memória ram",
  "ddr4",
  "ddr5",

  "placa mae",
  "placa mãe",

  "processador",
  "processador amd",
  "processador intel",
  "ryzen",
  "ryzen 3",
  "ryzen 5",
  "ryzen 7",
  "ryzen 9",
  "intel core",
  "core i3",
  "core i5",
  "core i7",
  "core i9",
  "soquete am4",
  "soquete am5",
  "soquete lga",

  "water cooler",
  "air cooler",
  "cooler para processador",
  "fan argb",
  "ventoinha",

  "gabinete gamer",
  "fonte gamer",
  "fonte atx",

  "kit xeon",
  "xeon",

  "monitor gamer",
    // ===== REFORÇO =====

  "placa-mae",
  "placa-mãe",

  "b450",
  "b550",
  "b650",
  "a520",
  "a620",
  "x570",
  "x670",
  "h610",
  "b760",
  "z790",

  "rx 570",
  "rx 6750",
  "rx 7700",
  "rx 7800",
  "rx 7900",

  "rtx 3050",
  "rtx 3060",
  "rtx 4060",
  "rtx 4070",
  "rtx 4080",
  "rtx 4090",
  "rtx 5060",
  "rtx 5070",
  "rtx 5080",
  "rtx 5090",

  "memoria ddr4",
  "memória ddr4",
  "memoria ddr5",
  "memória ddr5",

  "fonte 500w",
  "fonte 550w",
  "fonte 600w",
  "fonte 650w",
  "fonte 750w",
  "fonte 850w",

  "80 plus",
  "pfc ativo",

  "cooler master",
  "corsair",
  "kingston fury",
  "xpg",
  "crucial",
  "western digital",
  "wd black",
  "seagate",

  "pasta termica",
  "pasta térmica",

  "controladora argb",
  "hub fan",
  "kit fan",

  "cadeira gamer",
  "mesa gamer"
])) return "Gamer e Hardware";

 if (contemAlgum(texto, [
  "mouse",
  "teclado",
  "mousepad",

  "webcam",

  "headset",

  "micro sd",
  "microsd",
  "cartao de memoria",
  "cartão de memória",

  "pendrive",

  "hub usb",

  "monitor gamer",
  "monitor aoc",

  "suporte para notebook",
  "suporte notebook",
  "base notebook",
  "cooler notebook",

  "mesa digitalizadora",
  "xp-pen",
  "xppen",
  "deco 640",
  "deco",
  "mesa grafica",
  "mesa gráfica",
  "caneta digital",

  "dock station",
  "adaptador usb",
  "adaptador usb-c",
  "adaptador usb c",

  "leitor de cartão",
  "leitor de cartao",

  "trackball",

  "apoio ergonômico",
  "apoio ergonomico",
    // ===== REFORÇO =====

  "mouse gamer",
  "teclado gamer",

  "combo gamer",
  "kit gamer",

  "teclado mecanico",
  "teclado mecânico",

  "teclado sem fio",
  "mouse sem fio",

  "webcam full hd",

  "monitor",
  "monitor led",
  "monitor curvo",
  "monitor ultrawide",

  "braço articulado monitor",
  "suporte monitor",

  "hd externo",
  "ssd externo",

  "case hd",
  "case ssd",

  "placa captura",
  "placa de captura",

  "stream deck",

  "switch hdmi",

  "cabo hdmi",
  "displayport",

  "adaptador displayport",

  "repetidor wifi",
  "repetidor wi-fi",

  "placa rede usb",
  "adaptador wifi",
  "adaptador wi-fi",

  "roteador usb",

  "logitech",
  "redragon",
  "hyperx",
  "razer"
])) return "Periféricos";

 if (contemAlgum(texto, [
  "notebook",
  "laptop",
  "chromebook",
  "macbook",

  "computador",

  "pc gamer",

  "all in one",

  // reforço

  "ultrabook",

  "imac",

  "mini pc",
  "mini computador",

  "desktop",

  "workstation",

  "notebook gamer",

  "thinkpad",
  "ideapad",

  "vivobook",
  "zenbook",

  "aspire",
  "acer nitro",
  "nitro 5",

  "acer predator",
  "predator helios",

  "latitude",
  "inspiron",
  "vostro",

  "surface laptop",
    "book4",
  "galaxy book",

  "expertbook",

  "legion",

  "omen",

  "alienware",

  "avell",

  "positivo master",

  "celeron",
  "core i3",
  "core i5",
  "core i7",
  "core ultra",

  "ryzen 3",
  "ryzen 5",
  "ryzen 7",
  "ryzen 9"
])) return "Computadores e Notebook";

if (contemAlgum(texto, [
  "smart tv",
  "tv 43",
  "tv 50",
  "tv 55",
  "tv 65",
  "roku tv",
  "google tv",
  "qled",
  "oled",
  "soundbar",
  "home theater",
  "caixa de som",
  "party box",
  "fone bluetooth",
  "fone de ouvido",
  "headphone",
  "headset",
  "earbuds",
  "tws",
  "jbl",
  "anker",
  "soundcore",
  "subwoofer",
  "projetor",
  "echo dot",
  "alexa",
  "mesa de som",
  "mixer profissional",
  "microfone",
  "microfone sem fio",
  "karaoke",
  "speaker",
  "aiwa",
  "som portátil",
  "som portatil",
    // ===== REFORÇO =====

  "smarttv",

  "tv led",
  "tv 32",
  "tv 40",
  "tv 42",
  "tv 70",
  "tv 75",

  "android tv",

  "mini system",
  "receiver",

  "caixa bluetooth",
  "caixa bluetooth portátil",
  "caixa bluetooth portatil",

  "caixa amplificada",

  "monitor audio",
  "monitor de áudio",
  "monitor de audio",

  "mixer audio",
  "mixer áudio",

  "web radio",
  "web rádio",

  "radio portatil",
  "rádio portátil",

  "amplificador",

  "kit karaoke",
  "kit karaokê",

  "podcast",
  "microfone condensador",

  "ring light com microfone",

  "fire tv stick",
  "chromecast",

  "tv box"
])) return "Audio TV";

if (contemAlgum(texto, [
  "cafeteira",
  "maquina de cafe", "máquina de café",

  "air fryer",
  "fritadeira sem oleo",
  "fritadeira sem óleo",
  "fritadeira eletrica", "fritadeira elétrica",

  "microondas",

  "liquidificador",
  "mixer",
  "processador alimentos",
  "processador de alimentos",

  "batedeira",

  "sanduicheira",
  "grill",

  "panela eletrica",
  "panela elétrica",
  "panela pressao eletrica",
  "panela pressão elétrica",
  "cooker",

  "aspirador robo",
  "robô aspirador",
  "robo aspirador",

  "aspirador de po",
  "aspirador de pó",
  "aspirador vertical",
  "aspirador sem fio",

  "escova secadora",
  "escova rotativa",

  "chapinha",
  "prancha cabelo",
  "prancha de cabelo",

  "secador cabelo",
  "secador de cabelo",

  "ferro passar",
  "ferro de passar",

  "vaporizador roupas",
  "passadeira vapor"
])) return "Eletroportáteis";

if (contemAlgum(texto, [
  "geladeira", "refrigerador",
  "freezer",

  "maquina de lavar", "máquina de lavar",
  "lavadora de roupas",
  "lava e seca",
  "tanquinho",

  "fogao", "fogão",
  "cooktop",

  "forno eletrico", "forno elétrico",
  "forno embutir",
  "forno de embutir",

  "depurador",
  "coifa",

  "climatizador",

  "ar condicionado",
  "ar-condicionado",
  "split inverter",
  "split",

  "ventilador",
  "ventilador de mesa",
  "ventilador coluna",
  "ventilador de coluna",
  "ventilador torre",
  "ventilador de teto",

  "adega climatizada",
  "cervejeira",

  "lava loucas",
  "lava-louças",
  "lava louça",

  "secadora de roupas",
  "secadora"
])) return "Eletrodomésticos";
 
  if (contemAlgum(texto, [
  "mop", "esfregao", "esfregão",
  "rodo", "vassoura",
  "pá de lixo", "pa de lixo",

  "limpeza geral",
  "multiuso",
  "desinfetante",
  "detergente",

  "amaciante", "downy",
  "sabao liquido", "sabão líquido",
  "sabao em po", "sabão em pó",
  "lava roupas",
  "lava louças", "lava louca",

  "alvejante",
  "agua sanitaria", "água sanitária",
  "cloro",

  "limpa vidro",
  "limpa piso",
  "limpa porcelanato",
  "limpa banheiro",

  "saponaceo", "saponáceo",
  "removedor",
  "lustra moveis", "lustra móveis",

  "pano microfibra",
  "microfibra",
  "esponja limpeza",
  "esponja multiuso",

  "limpeza pesada",
  "kit limpeza",
  "refil mop"
])) return "Limpeza";

  if (contemAlgum(texto, [
  "molinete", "vara de pesca", "vara telescopica",
  "vara telescópica", "carretilha", "anzol",
  "isca artificial", "isca", "linha de pesca",
  "pescaria", "pesca", "pesqueiro",

  "alicate de pesca", "pega peixe",
  "tira anzol", "removedor de anzol",

  "camping", "acampamento",
  "barraca", "barraca camping",
  "fogareiro", "saco de dormir",
  "colchonete", "lanterna camping",
  "mochila camping",

  "cooler", "caixa termica",
  "caixa térmica", "ice box",
  "caixa termolar", "termolar",
  "coleman", "nautika",

  "caixa termica praia",
  "caixa termica camping",
  "caixa termica pesca",
  "caixa térmica praia",
  "caixa térmica camping",
  "caixa térmica pesca"
])) return "Pesca e Camping";

  if (contemAlgum(texto, [
    "moto", "motocicleta", "capacete", "pro tork", "kit led",
    "osram", "h1 osram", "pneu", "carplay", "multimidia",
    "multimídia", "som automotivo", "radio automotivo", "rádio automotivo",
    "camera de re", "câmera de ré", "envelopamento automotivo",
    "vinil automotivo", "adesivo vinil", "bomba de ar", "inflador de pneus"
  ])) return "Automotivo";


if (contemAlgum(texto, [
  "lego",
  "boneco",
  "boneca",
  "hot wheels",
  "hasbro",
  "marvel",
  "vingadores",
  "homem aranha",
  "homem de ferro",

  "brinquedo",
  "brinquedo infantil",
  "pista de brinquedo",

  "carrinho",
  "carrinho dinossauro",
  "carrinho bate e volta",
  "carrinho controle remoto",

  "bebê reborn",
  "bebe reborn",

  "quebra cabeca",
  "quebra cabeça",

  "triciclo infantil",
  "patinete infantil",

  "fisher price",
  "fisher-price",

  "montessori",

  "play doh",
  "play-doh",

  "nerf",

  "massinha",

  "casinha infantil",

  "blocos de montar",

  "pista hot wheels",

  "kit brinquedo",

  "brinquedo educativo",

  "jogo educativo"
])) return "Brinquedos e Artigos Infantis";

  if (contemAlgum(texto, [
    "game stick", "playstation", "xbox", "nintendo", "controle ps5",
    "controle xbox", "console", "jogo ps5", "jogo xbox"
  ])) return "Games e Console";

if (contemAlgum(texto, [
  "azeite",

  "arroz",
  "feijao", "feijão",

  "leite",

  "cafe", "café",

  "chocolate",

  "biscoito",
  "bolacha",

  "sal grosso",
  "sal marinho",

  "tempero",

  "gourmet",

  "alimento",
  "mercearia",

  // reforço

  "capsula nespresso",
  "cápsula nespresso",

  "capsula dolce gusto",
  "cápsula dolce gusto",

  "nespresso",
  "dolce gusto",

  "nescafe", "nescafé",

  "achocolatado",

  "barra cereal",
  "barra de cereal",

  "granola",

  "wafers",

  "amendoim",

  "castanha",
  "castanhas",

  "pasta amendoim",
  "pasta de amendoim",

  "geleia", "geléia",

  "mel",

  "macarrao",
  "macarrão",

  "molho tomate",
  "molho de tomate",

  "farinha",

  "acucar", "açúcar",

  "adocante",

  "cha", "chá",

  "suco",

  "energetico", "energético",

  "kit churrasco gourmet",

  "cesta basica",
  "cesta básica"
])) return "Alimentos e Mercearia";

console.log("🧠 CATEGORIA NAO IDENTIFICADA:", texto);

  return "Diversos";
}

module.exports = {
  classificarCategoriaOferta
};