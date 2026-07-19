
 // ====================== CATEGORIAS DESTINO ===========================

const CATEGORIAS_DESTINOS = {
  modaMasculina: {
    nome: "Roupas e Moda Masculina",
    palavras: [
      "camiseta", "camisa", "regata", "oversized", "algodao", "algodão",
      "malhao", "malhão", "cueca", "kit cuecas", "bermuda", "caterpillar",
      "calca masculina", "calça", "moletom", "bermuda", "kit cuecas", "corta vento",
      "carteira", "cinto", "jaqueta", "capa de chuva", "bone", "canguru",
      "cueca", "cuecas", "boxer", "cueca boxer", "microfibra", "blusa de frio",
      "jaqueta de couro feminina", "conjunto moletom"
    ]
  },

  modaFeminina: {
    nome: "Roupas e Moda Feminina",
    palavras: [
      "blusinha", "lingerie", "calcinha", "biquini", "biquíni", "saia",
      "vestido", "sandalia", "sandália", "sueter", "casaco", "saia",
      "shorts feminino", "calca", "calça", "canguru", "corta vento",
      "calça jeans", "colar", "top", "top", "blusa de frio", "blusa de frio",
      "sutia", "sutiã", "cropped", "legging", "Kit 2 Moletons", "cacharrel",
      "vestido longo vermelho", "bolsa mulher"
    ]
  },

  infantil: {
    nome: "Roupas e Calçados Infantil",
    palavras: [
      "tenis infantil", "tênis infantil", "camisa infantil",
      "sandalia infantil", "sandália infantil", "roupa infantil",
      "moda infantil", "bebe", "bebê", "infantil verão menino", "body infantil"
    ]
  },

  tenis: {
    nome: "Tênis e Chinelos",
    palavras: [
      "tenis", "tênis", "chinelo", "sandalia", "sandália", "botina com solado",
      "havaianas", "papete", "salto alto", "loafer", "puma", "tenis puma",
      "rider", "reebok", "under armor", "new balance", "adidas", "rasteira",
      "mocassim", "mizuno", "asics", "nike", "olympikus", "penalty",
      "bota", "botina", "coturno", "sapato", "sapatenis", "sapatenis", "casual unissex"
    ]
  },

  hardware: {
    nome: "Gamer e Hardware",
    palavras: [
      "ssd", "nvme", "placa de video", "placa de vídeo", "fonte gamer",
      "memoria ram", "memória ram", "gabinete gamer", "fonte de alimentacao",
      "headset gamer", "teclado mecanico", "teclado mecânico",
      "mouse gamer", "amd", "nvidia", "pny", "kingston", "memória ram",
      "seagate", "western digital", "asus", "asrock", "netac",
      "redragon", "gigabyte", "intel", "hyperx"
    ]
  },

  computadores: {
    nome: "Computadores e Notebook",
    palavras: [
      "notebook", "laptop", "pc gamer", "computador",
      "all in one", "desktop", "macbook", "ipad", "tablet", "monitor"
    ]
  },

  celulares: {
    nome: "Celulares e Smartphones",
    palavras: [
      "iphone", "samsung galaxy", "xiaomi", "motorola",
      "redmi", "poco", "realme", "smartphone", "celular",
      "galaxy s", "moto g", "infinix"
    ]
  },

 perifericos: {
  nome: "Periféricos",
  palavras: [
    "mouse", "teclado", "mousepad", "webcam gamer",
    "headphone", "fone gamer", "controle pc", "adaptador usb",
    "headset", "hub usb", "microfone gamer", "cadeira gamer",
    "monitor gamer", "microsd", "micro sd", "webcam full hd 1080p",
    "cartao de memoria", "cartão de memória",
    "sdxc", "sdhc", "pendrive", "usb flash"
  ]
},

  audioTv: {
    nome: "Audio TV",
    palavras: [
      "smart tv", "televisor", "televisao", "televisão",
      "tv 32", "tv 40", "tv 43", "tv 50", "tv 55", "tv 65", "tv 75",
      "caixa de som", "soundbar", "boombox", "radio", "rádio",
      "conversor digital", "AIWA", "iptv"
    ]
  },

  eletronicos: {
    nome: "Eletrônicos",
    palavras: [
      "smartwatch", "fone bluetooth", "caixa bluetooth",
      "ring light", "drone", "camera wifi", "câmera wifi",
      "camera ip", "câmera ip", "webcam", "projetor",
      "mini projetor", "echo dot", "alexa", "fone sem fio",
      "fone bluetooth", "fone de ouvido", "fones de ouvido",
      "ear hook", "headphone", "tws", "bluetooth 5.3", "airpods",
      "smartwatch", "relogio inteligente", "relógio inteligente",
      "smart watch", "smart band", "amplificador de áudio", "soundcore"
    ]
  },

  eletroportateis: {
    nome: "Eletroportáteis",
    palavras: [
      "air fryer", "fritadeira eletrica", "fritadeira elétrica",
      "liquidificador", "cafeteira", "batedeira", "mixer", "cozedor de ovos",
      "sanduicheira", "grill", "aspirador", "panela eletrica", "escova secadora",
      "panela elétrica", "processador de alimentos", "aspirador robo",
      "aspirador robô", "robo aspirador", "robô aspirador", "bebedor eletrico",
      "robô aspirador"
    ]
  },

  eletrodomesticos: {
    nome: "Eletrodomésticos",
    palavras: [
      "geladeira", "freezer", "microondas", "micro-ondas", "purificador de água",
      "fogao", "fogão", "lava e seca", "ar condicionado",
      "lava loucas", "lava louças", "secadora",
      "electrolux", "consul", "brastemp", "philco", "hisense", "elgin", "gree"
    ]
  },


  climatizacao: {
    nome: "Climatização e Ventilação",
    palavras: [
      "ventilador", "ventilador de mesa", "ventilador de coluna",
      "ventilador de teto", "circulador de ar", "ar condicionado",
      "ar condicionado split", "climatizador", "umidificador",
      "desumidificador", "aquecedor", "purificador de ar",
      "adega climatizada", "exaustor", "split inverter", "ventilador torre"
    ]
  },
  ferramentas: {
    nome: "Ferramentas",
    palavras: [
      "furadeira", "parafusadeira", "martelete", "caixa para ferramentas",
      "chave de impacto", "serra marmore", "serra mármore", "maleta de ferramentas",
      "makita", "dewalt", "bosch", "vonder", "jogo de chave de fenda",
      "jogo de ferramentas", "maleta de ferramentas",
      "manifold", "bomba de vacuo", "bomba de vácuo",
      "alicate amperimetro", "alicate amperímetro", "canivete multiuso",
      "capacimetro", "capacímetro", "bota de pvc", "compressor de ar"
    ]
  },

  automotivo: {
    nome: "Automotivo",
    palavras: [
      "multimidia", "multimídia", "som automotivo", "compressor de ar automotivo",
      "camera de re", "câmera de ré", "farol", "rádio automotivo",
      "lampada automotiva", "lâmpada automotiva",
      "taramps", "pioneer", "retrovisor", "cadeira de carro"
    ]
  },

  pesca: {
  nome: "Pesca e Camping",
  palavras: [
    "vara de pesca", "molinete", "carretilha", "anzol", "anzuol", "isca artificial",
    "isca silicone", "shad", "chumbada", "linha multifilamento", "linha monofilamento", "leader fluorcarbono",
    "caixa de pesca", "caixa de isca", "bolsa de pesca", "alicate pesca", "passagua", "passaguá",
    "girador", "snap pesca", "boia pesca", "boia cevadeira", "kit pesca", "kit isca",
    "nelson nakamura", "daiwa", "marine sports", "albatroz fishing", "shimano pesca", "pesca esportiva",

    "camisa pesca", "camiseta uv", "camisa uv", "oculos polarizado", "óculos polarizado", "oculos de pesca",
    "óculos de pesca", "luva pesca", "buff pesca", "chapéu pesca", "bone pesca", "protetor solar",

    "camping", "barraca", "barraca camping", "saco de dormir", "colchonete camping", "isolante termico",
    "isolante térmico", "lanterna camping", "lanterna led", "lampiao", "lampião", "fogareiro", "mochila de caping",
    "fogareiro camping", "cartucho gas", "cartucho gás", "caixa termica", "caixa térmica", "cooler termico",
    "cooler térmico", "mochila trilha", "mochila cargueira", "cadeira camping", "mesa camping", "rede camping",

    "canivete", "bússola", "bussola", "kit sobrevivencia", "kit sobrevivência", "aventura", "fogão elétrico portátil"
  ]
},

  casaDecoracao: {
    nome: "Casa, Móveis e Decoração",
    palavras: [
      "sofa", "sofá", "mesa", "cadeira", "guarda roupa", "cantinho do cafe",
      "armario", "armário", "espelho", "torneira", "cantinho do café", "rack banheiro",
      "painel tv", "penteadeira", "comoda", "cômoda", "decoracao", "xícara decorativa",
      "barraca", "rede de dormir", "sofá retrátil", "decoração", "xicara decorativa",
      "organizador banheiro", "porta shampoo", "porta sabonete", "cortina", "pote plastico",
      "potes plásticos", "cobertor casal", "cobertor casal", "manta", "unidades manta",
      "jogo de lençol", "Xícaras Bebidas Fria", "top e legging", "fechadura digital",
      "formas assadeiras", "amolador de facas", "torneira gourmet", "faca de chef",
      "tapete sala"
    ]
  },

  limpeza: {
    nome: "Limpeza",
    palavras: [
      "amaciante", "sabao em po", "sabão em pó", "amaciante concentrado",
      "desinfetante", "detergente", "papel higienico", "DOWNY",
      "papel higiênico", "limpeza pesada",
      "multiuso", "veja", "omo", "ypê", "vonixx BACTRAN",
      "candida", "cândida", "agua sanitaria", "água sanitaria", "água sanitária"
    ]
  },

  alimentos: {
    nome: "Alimentos e Mercearia",
    palavras: [
      "chocolate", "cafe", "café", "capsula de cafe", "cápsula de café",
      "arroz", "feijao", "feijão", "biscoito", "bolacha", "creme crocante",
      "bombom", "salgadinho", "temperos", "salame", "cereal", "barra de proteína",
      "neslac comfor"
    ]
  },

  bebidas: {
    nome: "Bebidas",
    palavras: [
      "heineken", "cerveja", "whisky", "vodka", "vinho rose",
      "energetico", "energético", "gatorade", "vinho chileno",
      "red label", "old par", "chopp", "amstel",
      "coca cola", "tnt", "monster", "ipa", "burn"
    ]
  },

  beleza: {
    nome: "Perfumaria, Farmácia e Beleza",
    palavras: [
      "perfume", "shampoo", "condicionador", "hidratante", "eau de toilette",
      "desodorante", "sabonete", "protetor solar", "creme dental", "montblanc",
      "carolina herrera", "ferrari", "sundown", "neutrogena", "perfume natura",
      "boticario", "boticário", "azzaro", "armani", "natura", "deo parfum",
      "malbec", "kit body splash", "deo parfum", "hydra lipgloss", "perfume",
      "gloss", "eau de toilette", "máquina de Cortar", "máquina de Cortar",
      "NAUTICA BLUE"
    ]
  },

  petshop: {
    nome: "Pet Shop e Fazendinha",
    palavras: [
      "racao", "ração", "coleira", "comedouro", "cama arranhadora",
      "bebedouro", "aquario", "aquário", "WHISKAS ração", "pet coleira peitoral",
      "areia gato", "ração cachorro", "ração gato"
    ]
  },

  esporte: {
    nome: "Esporte e Suplementos",
    palavras: [
      "creatina", "whey", "suplemento", "massageador", "massageador muscular",
      "academia", "camisa time", "roupa academia", "pistola de massagem",
      "beta alanina", "pre treino", "pré treino", "liberacao miofascial",
      "halter", "anilha", "bike", "bicicleta", "liberação miofascial", "macacão fitness ",
      "recuperacao muscular", "recuperação muscular", "Whey", "bicicleta spinning",
      "garrafa térmica", "ARENA Mochila", "bolsa térmica"
    ]
  },

  games: {
    nome: "Games e Console",
    palavras: [
      "xbox", "playstation", "ps5", "ps4", "cadeira ergonomica gamer",
      "nintendo switch", "controle xbox",
      "joystick", "game stick", "fliperama"
    ]
  },

bebes: {
  nome: "Bebês e Acessórios",
  palavras: [
    "bebe", "bebê", "bebes", "bebês", "carrinho de bebe", "carrinho de bebê",
    "cadeirinha", "cadeirinha de bebe", "cadeirinha de bebê",
    "mamae bebe", "mamãe bebê", "mamadeira", "chupeta",
    "berco", "berço", "banheira bebe", "banheira bebê", "lenços umedecidos",
    "fralda", "lenço umedecido", "lenco umedecido"
  ]
},

  brinquedos: {
    nome: "Brinquedos e Artigos Infantis",
    palavras: [
      "lego", "carrinho", "helicoptero", "helicóptero", "losa mágica",
      "controle remoto", "boneca", "quebra cabeca", "lousa mágica infantil",
      "quebra cabeça", "domino", "dominó", "trator brinquedo", "lousa mágica infantil",
      "carro transformável", "bulldozer de controle", "controle remoto 2,4 Ghz"
    ]
  }
};



module.exports = {
  CATEGORIAS_DESTINOS
};
