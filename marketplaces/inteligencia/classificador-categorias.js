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
  "moda evangélica"
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
  "moda masculina", "plus size masculino"
])) return "Roupas e Moda Masculina";

if (contemAlgum(texto, [
  "tenis", "tênis", "chinelo", "havaianas", "sandalia", "sandália",
  "rasteira", "rasteirinha", "tamanco", "sapatilha",
  "sapatenis", "sapatênis", "crocs", "papete",
  "mocassim", "loafer", "bota", "botina", "coturno",
  "sapato", "salto", "salto alto",
  "mizuno", "asics", "nike", "adidas", "olympikus",
  "olympicus", "fila", "vizzano", "piccadilly",
  "puma", "reebok", "new balance", "kappa",
  "calcado feminino", "calçado feminino",
  "calcado masculino", "calçado masculino"
])) return "Tênis e Chinelos";

  if (contemAlgum(texto, [
    "smartwatch", "smart watch", "relogio inteligente", "relógio inteligente",
    "smart band", "amazfit", "galaxy watch"
  ])) return "Eletrônicos";

  if (contemAlgum(texto, [
    "halter", "haltere", "kettlebell", "musculacao", "musculação",
    "peso livre", "crossfit", "whey", "creatina", "pre treino",
    "pré treino", "albumina", "barra de proteina", "barra de proteína",
    "barra proteica", "faixa elastica", "faixa elástica", "bike",
    "bicicleta", "spinning", "tapete yoga", "tapete para yoga",
    "short academia", "camiseta academia", "dry fit", "bola de futebol"
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
  "balança corporal"
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
  "soprador termico", "soprador térmico"
])) return "Ferramentas";

  
// ===== COZINHA / UTILIDADES DOMÉSTICAS =====

if (contemAlgum(texto, [
  "jogo de panelas", "kit panela", "frigideira",
  "panela", "caçarola", "caçarola", "fervedor",
  "faqueiro", "tramontina", "talheres",
  "copos", "taças", "tacas", "jogo de copos",
  "cortador de legumes", "ralador", "fatiador",
  "marmitas", "potes", "travas hermeticas", "travas herméticas",
  "formas assadeiras", "assadeira", "forma antiaderente",
  "crepeira", "maquina de crepe", "máquina de crepe",
  "garrafa inox", "garrafa termica", "garrafa térmica",
  "lixeira", "guarda chuva", "cobertor", "manta",
  "toalhas de banho", "toalha de banho"
])) return "Casa, Móveis e Decoração";

if (contemAlgum(texto, [
  "tapete", "cortina", "almofada",
  "sofa", "sofá", "rack",
  "painel tv", "painel de tv",
  "guarda roupa", "guarda-roupa",
  "roupeiro", "mesa", "cadeira",
  "cadeira de escritorio", "cadeira de escritório",
  "cadeira ergonomica", "cadeira ergonômica",
  "cadeira executiva", "cadeira presidente",
  "penteadeira", "comoda", "cômoda",
  "armário", "armario",
  "varal", "colcha", "cobre leito",
  "torneira", "banheiro", "cozinha",
  "kit churrasco",
  "utensilios cozinha",
  "utensílios cozinha",
  "espelho", "adnet",

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
  "criado-mudo"
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
  "transportadora pet"
])) return "Pet Shop e Fazendinha";

  if (contemAlgum(texto, [
    "fralda", "huggies", "pampers", "lenco umedecido", "lenço umedecido",
    "lencos umedecidos", "lenços umedecidos", "mamadeira", "chupeta",
    "berco", "berço", "mosquiteiro", "carrinho de bebe", "carrinho de bebê",
    "bebe conforto", "bebê conforto", "tapete infantil", "tatame infantil"
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

  "monitor gamer"
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
  "apoio ergonomico"
])) return "Periféricos";

  if (contemAlgum(texto, [
    "notebook", "laptop", "chromebook", "macbook", "computador",
    "pc gamer", "all in one"
  ])) return "Computadores e Notebook";

  if (contemAlgum(texto, [
    "iphone", "smartphone", "celular", "galaxy", "motorola",
    "xiaomi", "redmi", "poco", "realme", "nokia"
  ])) return "Celulares e Smartphones";

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
  "som portatil"
])) return "Audio TV";

  if (contemAlgum(texto, [
    "cafeteira", "air fryer", "fritadeira sem oleo", "fritadeira sem óleo",
    "microondas", "liquidificador", "batedeira", "sanduicheira",
    "grill", "panela eletrica", "panela elétrica", "aspirador robo",
    "robô aspirador", "robo aspirador", "escova secadora"
  ])) return "Eletroportáteis";

  if (contemAlgum(texto, [
    "geladeira", "freezer", "maquina de lavar", "máquina de lavar",
    "lava e seca", "fogao", "fogão", "cooktop", "forno eletrico",
    "forno elétrico", "depurador", "coifa", "climatizador",
    "ar condicionado", "ventilador", "ventilador de mesa"
  ])) return "Eletrodomésticos";

 
  if (contemAlgum(texto, [
    "mop", "esfregao", "esfregão", "rodo", "limpeza geral",
    "desinfetante", "multiuso", "amaciante", "downy", "sabao liquido",
    "sabão líquido", "lava roupas"
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
    "azeite", "arroz", "feijao", "feijão", "leite", "cafe", "café",
    "chocolate", "biscoito", "bolacha", "sal grosso", "sal marinho",
    "tempero", "gourmet", "alimento", "mercearia", "gin", "bebida"
  ])) return "Alimentos e Mercearia";

console.log("🧠 CATEGORIA NAO IDENTIFICADA:", texto);

  return "Diversos";
}

module.exports = {
  classificarCategoriaOferta
};