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

  if (contemAlgum(texto, [
    "calcinha", "sutia", "sutiã", "lingerie", "cueca feminina",
    "calcinha boxer", "short sem costura", "she by mash",
    "segunda pele", "anagua", "anágua", "camisola",
    "pijama feminino", "biquini", "bíquini", "maio natacao", "maiô natação"
  ])) return "Roupas e Moda Feminina";

  if (contemAlgum(texto, [
    "camisa polo", "polo piquet", "camiseta masculina", "camisetas masculina",
    "camiseta henley", "henley", "camiseta basica", "camiseta básica",
    "camiseta premium", "camiseta algodao", "camiseta algodão",
    "kit camiseta", "kit camisetas", "camisa masculina",
    "camisa social masculina", "moletom masculino", "calca jeans masculina",
    "calça jeans masculina", "bermuda masculina", "cueca boxer",
    "cuecas boxer", "boxer masculina", "boxer masculino"
  ])) return "Roupas e Moda Masculina";

  if (contemAlgum(texto, [
    "tenis", "tênis", "chinelo", "havaianas", "sandalia", "sandália",
    "rasteira", "rasteirinha", "tamanco", "sapatilha", "sapatenis",
    "sapatênis", "crocs", "mizuno", "asics", "nike", "adidas",
    "olympikus", "fila", "vizzano", "piccadilly", "calcado feminino",
    "calçado feminino", "calcado masculino", "calçado masculino"
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
    "racao", "ração", "cachorro", "gato", "petisco", "bifinho",
    "pedigree", "quatree", "tapete higienico", "tapete higiênico",
    "coleira", "comedouro", "bebedouro pet", "bebedouro para cachorro",
    "bebedouro para gato", "chalesco"
  ])) return "Pet Shop e Fazendinha";

  if (contemAlgum(texto, [
    "fralda", "huggies", "pampers", "lenco umedecido", "lenço umedecido",
    "lencos umedecidos", "lenços umedecidos", "mamadeira", "chupeta",
    "berco", "berço", "mosquiteiro", "carrinho de bebe", "carrinho de bebê",
    "bebe conforto", "bebê conforto", "tapete infantil", "tatame infantil"
  ])) return "Bebês e Acessórios";

  if (contemAlgum(texto, [
    "placa de video", "placa de vídeo", "placa grafica", "placa gráfica",
    "rtx", "gtx", "rx 580", "rx 6600", "rx 7600", "rx 9070",
    "ssd", "nvme", "m.2", "memoria ram", "memória ram", "ddr4", "ddr5",
    "placa mae", "placa mãe", "processador ryzen", "intel core",
    "water cooler", "air cooler", "gabinete gamer", "fonte gamer",
    "geforce", "radeon"
  ])) return "Gamer e Hardware";

  if (contemAlgum(texto, [
    "mouse", "teclado", "mousepad", "webcam", "headset", "micro sd",
    "microsd", "cartao de memoria", "cartão de memória", "pendrive",
    "hub usb", "monitor gamer", "monitor aoc", "suporte para notebook",
    "suporte notebook", "base notebook", "cooler notebook"
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
    "smart tv", "tv 43", "tv 50", "tv 55", "tv 65", "roku tv",
    "google tv", "qled", "oled", "soundbar", "home theater",
    "caixa de som", "fone bluetooth", "fone de ouvido", "headphone",
    "tws", "jbl", "anker", "soundcore", "subwoofer", "projetor",
    "echo dot", "alexa", "mesa de som", "mixer profissional"
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
  "tapete", "cortina", "almofada",
  "sofa", "sofá", "rack",
  "painel tv", "painel de tv",
  "guarda roupa", "guarda-roupa",
  "roupeiro", "mesa", "cadeira",
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
    "moto", "motocicleta", "capacete", "pro tork", "kit led",
    "osram", "h1 osram", "pneu", "carplay", "multimidia",
    "multimídia", "som automotivo", "radio automotivo", "rádio automotivo",
    "camera de re", "câmera de ré", "envelopamento automotivo",
    "vinil automotivo", "adesivo vinil", "bomba de ar", "inflador de pneus"
  ])) return "Automotivo";


  if (contemAlgum(texto, [
    "lego", "boneco", "boneca", "hot wheels", "hasbro",
    "marvel", "vingadores", "homem aranha", "homem de ferro",
    "brinquedo", "quebra cabeca", "quebra cabeça", "triciclo infantil",
    "patinete infantil"
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

  return "Diversos";
}

module.exports = {
  classificarCategoriaOferta
};