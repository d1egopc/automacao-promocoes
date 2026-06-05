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

  if (contemAlgum(texto, [
    "smartwatch", "smart watch", "relogio inteligente",
    "smart band", "amazfit", "galaxy watch"
  ])) {
    return "Eletrônicos";
  }


// ===== CORREÇÕES FORTES OPTIMUS 1 =====

if (contemAlgum(texto, [
  "kit led", "osram", "h1 osram", "capacete", "pro tork",
  "pneu pretinho", "v-floc", "vonixx", "carnauba",
  "envelopamento automotivo", "vinil automotivo", "adesivo vinil"
])) return "Automotivo";

if (contemAlgum(texto, [
  "patinete", "bola puma", "puma prestige", "brinquedo infantil"
])) return "Brinquedos e Artigos Infantis";

if (contemAlgum(texto, [
  "berco", "berço", "mosquiteiro", "toalhas umedecidas",
  "lenços baby", "lencos baby", "baby free"
])) return "Bebês e Acessórios";

if (contemAlgum(texto, [
  "mop", "esfregao", "esfregão", "rodo magico", "rodo mágico",
  "limpa seca", "shampoo v-floc"
])) return "Limpeza";

if (contemAlgum(texto, [
  "cesto organizadora", "caixa organizadora", "rattan",
  "jogo de tacas", "jogo de taças", "copos", "taças",
  "talheres", "inoxidable", "cozinha", "tapete", "felpudo",
  "garrafa termica", "garrafa térmica", "torneira", "banheiro"
])) return "Casa, Móveis e Decoração";

if (contemAlgum(texto, [
  "calca jeans masculina", "calça jeans masculina", "jeans masculina",
  "calca de inverno", "calça de inverno", "flanelada",
  "cueca", "cuecas", "boxer", "meias algodao", "meias algodão",
  "jaqueta puffer", "bobojaco", "corta vento"
])) return "Roupas e Moda Masculina";

if (contemAlgum(texto, [
  "pijama feminino", "pijamas feminino", "camisola",
  "calca jeans feminina", "calça jeans feminina", "blusa feminina",
  "vestido feminino"
])) return "Roupas e Moda Feminina";

if (contemAlgum(texto, [
  "eudora", "siage", "siàge", "gabriela sabatini",
  "eau de toilette", "eau de parfum", "perfume",
  "mascara capilar", "máscara capilar", "fio dental",
  "medidor de pressao", "medidor de pressão",
  "pressao arterial", "pressão arterial", "gel hidratante",
  "locao hidratante", "loção hidratante", "termometro", "termômetro"
])) return "Perfumaria, Farmácia e Beleza";

if (contemAlgum(texto, [
  "caixa amplificada", "subwoofer", "jbl", "soundcore",
  "anker", "fone bluetooth", "fone de ouvido", "headphone",
  "tws", "mixer profissional", "mesa de som", "microfone lapela",
  "microfone celular", "karaoke"
])) return "Audio TV";

if (contemAlgum(texto, [
  "depurador", "coifa", "suggar", "climatizador", "ar condicionado"
])) return "Eletrodomésticos";

if (contemAlgum(texto, [
  "pre treino", "pré treino", "creatina", "whey", "albumina",
  "mochila camping", "trilha", "academia", "bike", "bicicleta"
])) return "Esporte e Suplementos";

// ===== CORREÇÕES FORTES OPTIMUS 2 =====

if (contemAlgum(texto, [
  "tapete", "felpudo", "sala quarto", "cortina", "almofada",
  "garrafa termica", "garrafa térmica", "copo termico", "copo térmico",
  "torneira", "banheiro", "lavatório"
])) {
  return "Casa, Móveis e Decoração";
}

if (contemAlgum(texto, [
  "calca jeans masculina", "calça jeans masculina", "jeans masculino",
  "cueca", "boxer masculina", "jaqueta puffer", "bobojaco",
  "corta vento", "moletom masculino"
])) {
  return "Roupas e Moda Masculina";
}

if (contemAlgum(texto, [
  "pijama feminino", "pijamas feminino", "calca jeans feminina",
  "calça jeans feminina", "blusa feminina", "vestido feminino"
])) {
  return "Roupas e Moda Feminina";
}

if (contemAlgum(texto, [
  "gabriela sabatini", "eau de toilette", "eau de parfum",
  "perfume", "colonia", "colônia", "eudora", "siage",
  "máscara capilar", "mascara capilar", "fio dental", "gel hidratante",
  "loção hidratante", "locao hidratante"
])) {
  return "Perfumaria, Farmácia e Beleza";
}

if (contemAlgum(texto, [
  "caixa amplificada", "subwoofer", "jbl", "soundcore",
  "anker", "fone bluetooth", "fone de ouvido", "headphone",
  "tws", "mixer profissional", "mesa de som"
])) {
  return "Audio TV";
}

if (contemAlgum(texto, [
  "depurador", "coifa", "suggar", "climatizador", "ar condicionado"
])) {
  return "Eletrodomésticos";
}

if (contemAlgum(texto, [
  "patinete infantil", "patinete", "berco", "berço", "mosquiteiro",
  "bebe", "bebê", "carrinho de bebe", "carrinho de bebê"
])) {
  return "Bebês e Acessórios";
}

if (contemAlgum(texto, [
  "bola", "puma prestige", "mochila camping", "trilha",
  "academia", "bike", "bicicleta"
])) {
  return "Esporte e Suplementos";
}

if (contemAlgum(texto, [
  "capacete", "pro tork", "moto", "motocicleta",
  "kit led", "osram", "h1", "envelopamento automotivo",
  "vinil automotivo", "adesivo vinil"
])) {
  return "Automotivo";
}

  if (contemAlgum(texto, [
    "guarda roupa", "guarda-roupa", "roupeiro", "painel tv",
    "rack", "sofa", "mesa", "cadeira", "penteadeira",
    "comoda", "armario", "cortina", "tapete sala"
  ])) {
    return "Casa, Móveis e Decoração";
  }

  if (contemAlgum(texto, [
    "mouse", "teclado", "mousepad", "webcam", "micro sd",
    "microsd", "cartao de memoria", "pendrive", "hub usb",
    "headset", "monitor gamer"
  ])) {
    return "Periféricos";
  }

  if (contemAlgum(texto, [
    "perfume", "colonia", "deo colonia", "malbec", "lattafa", "yara",
    "eau de parfum", "body splash", "maquiagem", "skincare",
    "hidratante", "protetor solar", "shampoo", "condicionador"
  ])) {
    return "Perfumaria, Farmácia e Beleza";
  }

  if (contemAlgum(texto, [
    "memoria ram", "memoria kingston", "ram ddr", "ddr4", "ddr5",
    "ssd", "nvme", "m.2", "placa de video", "placa mae",
    "fonte gamer", "rx 580", "rx 6600", "rx 7600", "rx 9070",
    "gtx", "rtx", "water cooler", "processador ryzen"
  ])) {
    return "Gamer e Hardware";
  }

  if (contemAlgum(texto, [
    "iphone", "smartphone", "celular", "galaxy", "motorola",
    "xiaomi", "redmi", "poco", "realme"
  ])) {
    return "Celulares e Smartphones";
  }

  if (contemAlgum(texto, [
    "smart tv", "roku tv", "google tv", "qled", "oled",
    "soundbar", "caixa de som", "fone bluetooth",
    "fone de ouvido", "projetor", "echo dot", "alexa"
  ])) {
    return "Audio TV";
  }

  if (contemAlgum(texto, [
    "cafeteira", "air fryer", "microondas", "liquidificador",
    "batedeira", "sanduicheira", "grill", "aspirador robo",
    "robo aspirador", "escova secadora", "panela eletrica"
  ])) {
    return "Eletroportáteis";
  }

  if (contemAlgum(texto, [
    "ventilador", "climatizador", "geladeira", "freezer",
    "maquina de lavar", "lava e seca", "fogao", "ar condicionado"
  ])) {
    return "Eletrodomésticos";
  }

  if (contemAlgum(texto, [
    "furadeira", "parafusadeira", "kit ferramenta", "jogo de ferramentas",
    "esmerilhadeira", "serra marmore", "trena", "martelete",
    "makita", "dewalt", "bosch", "vonder"
  ])) {
    return "Ferramentas";
  }

  if (contemAlgum(texto, [
    "fralda", "huggies", "pampers", "formula infantil",
    "aptamil", "mamadeira", "chupeta", "bebe conforto",
    "cadeira de carro infantil", "isofix", "carrinho de bebe"
  ])) {
    return "Bebês e Acessórios";
  }

  if (contemAlgum(texto, [
    "racao", "cachorro", "gato", "petisco", "bifinho",
    "pedigree", "quatree", "formula natural", "pet shop",
    "coleira", "comedouro", "bebedouro"
  ])) {
    return "Pet Shop e Fazendinha";
  }

  if (contemAlgum(texto, [
    "whey", "creatina", "pre treino", "albumina",
    "bicicleta ergometrica", "spinning", "bola de futebol",
    "camiseta academia", "dry fit treino", "academia",
    "bike", "bicicleta"
  ])) {
    return "Esporte e Suplementos";
  }

  if (contemAlgum(texto, [
    "molinete", "vara de pesca", "carretilha", "anzol",
    "isca artificial", "pescaria", "camping", "barraca",
    "fogareiro", "saco de dormir", "caixa termica"
  ])) {
    return "Pesca e Camping";
  }

  if (contemAlgum(texto, [
    "vestido", "sandalia feminina", "salto feminino", "vizzano",
    "bolsa feminina", "blusa feminina", "cropped", "saia feminina",
    "calcinha", "sutia", "lingerie"
  ])) {
    return "Roupas e Moda Feminina";
  }

  if (contemAlgum(texto, [
    "moletom masculino", "calca moletom", "camiseta masculina",
    "bermuda masculina", "cueca", "carteira masculina"
  ])) {
    return "Roupas e Moda Masculina";
  }

if (contemAlgum(texto, [
  "chinelo", "havaianas", "cartago", "rider",
  "tenis", "tênis", "sapatenis", "sapatênis",
  "sapatilha", "sandalia", "sandália",
  "crocs", "mizuno", "asics", "nike",
  "adidas", "olympikus", "wayke",
  "rixxon", "o2x", "runway",
  "caminhada", "sneaker", "calcado masculino",
  "calçado masculino", "calcado feminino",
  "calçado feminino"
])) {
  return "Tênis e Chinelos";
}

  if (contemAlgum(texto, [
    "boneco", "boneca", "lego", "avengers", "homem de ferro",
    "hasbro", "marvel", "vingadores", "controle remoto",
    "quebra cabeca", "lousa magica"
  ])) {
    return "Brinquedos e Artigos Infantis";
  }

  if (contemAlgum(texto, [
    "azeite", "andorinha", "alimento", "mercearia",
    "flor de sal", "cafe", "arroz", "feijao", "leite",
    "chocolate", "biscoito", "bolacha"
  ])) {
    return "Alimentos e Mercearia";
  }

  if (contemAlgum(texto, [
    "moto", "motocicleta", "honda cg", "titan", "fan 160",
    "filtro de oleo", "carplay moto", "multimidia para moto",
    "som automotivo", "camera de re"
  ])) {
    return "Automotivo";
  }

  return "Diversos";
}

module.exports = {
  classificarCategoriaOferta
};