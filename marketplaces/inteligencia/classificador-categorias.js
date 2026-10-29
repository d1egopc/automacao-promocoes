let categoriasDestinos = {};
const { avaliarFamiliaFuncional } = require("./evidencia-funcional");

try {
  ({ CATEGORIAS_DESTINOS: categoriasDestinos = {} } = require("./categorias-destinos"));
} catch (e) {
  categoriasDestinos = {};
}

const CATEGORIA = {
  alimentos: "Alimentos e Mercearia",
  audioTv: "Audio TV",
  automotivo: "Automotivo",
  bebes: "Beb\u00eas e Acess\u00f3rios",
  bebidas: "Bebidas",
  celulares: "Celulares e Smartphones",
  computadores: "Computadores e Notebook",
  brinquedos: "Brinquedos e Artigos Infantis",
  casa: "Casa, M\u00f3veis e Decora\u00e7\u00e3o",
  eletrodomesticos: "Eletrodom\u00e9sticos",
  eletroportateis: "Eletroport\u00e1teis",
  eletronicos: "Eletr\u00f4nicos",
  esporte: "Esporte e Suplementos",
  ferramentas: "Ferramentas",
  games: "Games e Console",
  hardware: "Gamer e Hardware",
  iluminacao: "Ilumina\u00e7\u00e3o e El\u00e9trica",
  infantil: "Roupas e Cal\u00e7ados Infantil",
  limpeza: "Limpeza",
  modaFeminina: "Roupas e Moda Feminina",
  modaMasculina: "Roupas e Moda Masculina",
  perifericos: "Perif\u00e9ricos",
  papelariaLivros: "Papelaria e Livros",
  pesca: "Pesca e Camping",
  pet: "Pet Shop e Fazendinha",
  beleza: "Perfumaria, Farm\u00e1cia e Beleza",
  tenis: "T\u00eanis e Chinelos",
  diversos: "Diversos"
};

function normalizarTextoLocal(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textoOferta(oferta = {}, termo = "") {
  return normalizarTextoLocal([
    termo,
    oferta.titulo,
    oferta.nome,
    oferta.descricao,
    oferta.categoria,
    oferta.categoriaProduto,
    oferta.marca,
    oferta.marketplace,
    oferta.loja
  ].filter(Boolean).join(" "));
}

function termoExiste(texto, termo) {
  const termoNormalizado = normalizarTextoLocal(termo);
  if (!termoNormalizado) return false;

  const alvo = ` ${texto} `;
  const busca = ` ${termoNormalizado} `;
  return alvo.includes(busca);
}

function contemAlgum(texto, palavras = []) {
  return palavras.some((palavra) => termoExiste(texto, palavra));
}

function termosEncontrados(texto, palavras = []) {
  const alvo = ` ${texto} `;
  return palavras.filter(palavra => alvo.includes(` ${palavra} `));
}

function palavrasDosDestinos(nomeCategoria) {
  const ignoradasPorCategoria = {
    [CATEGORIA.pesca]: new Set([
      "cooler",
      "lanterna led",
      "protetor solar",
      "canivete",
      "aventura"
    ])
  };
  const ignoradas = ignoradasPorCategoria[nomeCategoria] || new Set();

  return Object.values(categoriasDestinos || {})
    .filter((item) => item?.nome === nomeCategoria)
    .flatMap((item) => item.palavras || [])
    .filter((palavra) => !ignoradas.has(normalizarTextoLocal(palavra)));
}

function regra(categoria, opcoes = {}) {
  // Mesma comparação e deduplicação do legado, compiladas uma vez no boot.
  // Evita normalizar centenas de palavras novamente para cada oferta.
  const compilar = itens => [...new Set(itens.map(normalizarTextoLocal).filter(Boolean))];
  return {
    categoria,
    prioridade: opcoes.prioridade || 0,
    fortes: compilar(opcoes.fortes || []),
    palavras: compilar([
      ...(opcoes.palavras || []),
      ...palavrasDosDestinos(categoria)
    ]),
    negativas: compilar(opcoes.negativas || [])
  };
}

const REGRAS = [
  regra(CATEGORIA.beleza, {
    prioridade: 120,
    fortes: [
      "perfume", "parfum", "eau de parfum", "eau de toilette", "deo colonia",
      "colonia", "body splash", "malbec", "lattafa", "yara", "azzaro",
      "rayhaan", "maison alhambra", "armaf", "nautica classic men red",
      "boticario", "natura", "eudora", "hidratante", "skincare",
      "protetor solar", "fps", "shampoo", "condicionador", "maquiagem",
      "mascara capilar", "hidratante labial", "skincare",
      "batom", "gloss", "serum", "sabonete liquido", "creme facial",
      "vitamina c", "maquina de cortar cabelo", "barbeador",
      "aparador de barba", "depilador", "escova secadora", "prancha de cabelo",
      "pressao arterial", "monitor de pressao", "monitor pressao arterial",
      "aparelho de pressao", "soro fisiologico", "pasta de dente",
      "creme dental", "alicate de cuticula", "cortador de unha",
      "irrigador oral", "nebulizador", "inalador", "seringa insulina", "escova progressiva", "renovador facial",
      "creme renovador para os pes", "creme para os pes", "reconstrutor capilar",
      "limpador facial", "antioleosidade", "creamy", "corretivo", "base maquiagem", "base corretivo",
      "base liquida", "base facial", "maquiagem", "luva nitrilica",
      "limpeza facial", "gel de limpeza facial", "actine"
    ],
    palavras: [
      "chapinha", "secador cabelo", "secador de cabelo", "mascara capilar", "pomada", "arnica",
      "oleo de coco", "lo\u00e7ao", "lotion", "la vie est belle", "elixir",
      "fisiogel", "creme maos", "creme para maos", "cerave", "la roche", "vichy", "nivea", "loreal", "elseve",
      "pantene", "tresemme", "dove", "granado", "wella", "eucerin",
      "termometro", "medidor de pressao", "balanca corporal", "fio dental",
      "manicure", "pedicure", "kit manicure", "kit pedicure",
      "alicate de unha", "alicate cuticula", "esmalte", "removedor esmalte",
      "unha gel", "unha em gel", "solucao fisiologica", "marroquina liss",
      "marroquina", "liss", "luva descartavel", "aparelho inalador", "mascara nebulizacao", "seringa para insulina", "seringa de insulina"
    ]
  }),

  regra(CATEGORIA.bebes, {
    prioridade: 115,
    fortes: [
      "fralda", "pampers", "huggies", "lenco umedecido", "mamadeira",
      "chupeta", "berco", "carrinho de bebe", "bebe conforto",
      "formula infantil", "aptamil", "nan", "nestogeno", "banheira bebe"
    ],
    palavras: [
      "body bebe", "macacao bebe", "saida maternidade", "kit maternidade",
      "babador", "cadeira alimentacao", "almofada amamentacao",
      "bomba tira leite", "andador bebe", "ninho bebe", "aspirador nasal"
    ]
  }),

  regra(CATEGORIA.infantil, {
    prioridade: 110,
    fortes: [
      "roupa infantil", "moda infantil", "tenis infantil",
      "sandalia infantil", "camisa infantil", "conjunto infantil",
      "camiseta infantil", "blusa infantil", "short infantil",
      "calca infantil", "vestido infantil", "pijama infantil", "body infantil", "camiseta menino", "juvenil", "macacao plush infantil", "pantufa infantil"
    ],
    palavras: [
      "bota infantil", "coturno infantil", "moletom infantil", "fantasia infantil",
      "roupa para menino", "roupa para menina", "calcado infantil", "1 a 16 anos", "camiseta menino", "camiseta juvenil", "blusa juvenil", "macacao infantil", "macacao plush", "pantufa infantil", "conjunto juvenil"
    ],
    negativas: [
      "boneca", "boneco", "brinquedo", "carrinho", "lego", "hot wheels",
      "quebra cabeca", "patinete", "triciclo"
    ]
  }),

  regra(CATEGORIA.celulares, {
    prioridade: 105,
    fortes: [
      "iphone", "smartphone", "celular", "samsung galaxy", "galaxy s",
      "galaxy a", "moto g", "motorola", "xiaomi", "redmi", "poco",
      "realme", "infinix"
    ],
    palavras: [
      "carregador iphone", "cabo iphone", "capa celular", "pelicula celular",
      "pelicula iphone", "power bank", "bateria externa"
    ],
    negativas: [
      "porta celular", "bolso porta celular"
    ]
  }),

  regra(CATEGORIA.hardware, {
    prioridade: 100,
    fortes: [
      "placa de video", "placa grafica", "rtx", "gtx", "radeon", "geforce",
      "rx 5500", "rx 580", "rx 6600", "rx 7600", "rx 7700", "rx 7800", "rx 7900",
      "ssd", "ssd sata", "ssd sata3", "ssd nvme", "nvme", "m 2", "memoria ram", "ddr4", "ddr5",
      "placa mae", "processador", "ryzen", "intel core", "water cooler",
      "air cooler", "cooler 360mm", "cooler 240mm", "cooler 120mm",
      "cooler para processador", "ventoinha", "ventoinhas", "fan argb",
      "fan rgb", "argb", "am4", "am5", "lga", "xeon",
      "fonte atx", "fonte gamer", "gabinete gamer", "cadeira gamer", "kit xeon"
    ],
    palavras: [
      "b450", "b550", "b650", "a520", "a620", "x99", "x570", "x670", "h610",
      "b760", "z790", "80 plus", "pfc ativo", "cooler master", "corsair",
      "kingston fury", "xpg", "crucial", "wd black", "netac", "pasta termica",
      "controladora argb", "hub fan", "kit fan", "jungle leopard"
    ]
  }),

  regra(CATEGORIA.computadores, {
    prioridade: 95,
    fortes: [
      "notebook", "laptop", "chromebook", "macbook", "computador",
      "pc gamer", "all in one", "mini pc", "desktop", "workstation",
      "notebook gamer", "mochila notebook"
    ],
    palavras: [
      "thinkpad", "ideapad", "vivobook", "zenbook", "aspire", "acer nitro",
      "nitro 5", "predator helios", "latitude", "inspiron", "vostro",
      "galaxy book", "book4", "legion", "omen", "alienware", "avell",
      "mochila escolar", "bolsa escolar", "mochila impermeavel"
    ]
  }),

  regra(CATEGORIA.perifericos, {
    prioridade: 90,
    fortes: [
      "mouse", "teclado", "mousepad", "webcam", "headset", "micro sd",
      "microsd", "cartao de memoria", "pendrive", "hub usb", "monitor gamer",
      "monitor led", "monitor curvo", "monitor ultrawide",
      "suporte para notebook", "base refrigerada", "pen drive", "sandisk", "usb", "armazenamento",
      "teclado gamer", "teclado magnetico", "mouse gamer", "mchose", "atk"
    ],
    palavras: [
      "suporte notebook", "base notebook", "cooler notebook", "base para notebook", "mesa digitalizadora",
      "xp pen", "dock station", "adaptador usb", "leitor de cartao",
      "teclado mecanico", "mouse sem fio", "webcam full hd", "acinaci", "hd externo",
      "ssd externo", "placa captura", "stream deck", "switch hdmi",
      "cabo hdmi", "displayport", "repetidor wifi", "adaptador wifi",
      "logitech", "redragon", "hyperx", "razer", "pendrive usb", "pen drive usb", "memoria usb", "armazenamento usb", "sandisk ultra"
    ]
  }),

  regra(CATEGORIA.audioTv, {
    prioridade: 85,
    fortes: [
      "smart tv", "smarttv", "tv led", "tv 32", "tv 40", "tv 43", "tv 50",
      "tv 55", "tv 65", "tv 70", "tv 75", "qled", "oled", "soundbar",
      "home theater", "caixa de som", "caixa bluetooth", "fone bluetooth",
      "fone de ouvido", "headphone", "headphone bluetooth", "earbuds", "tws", "jbl",
      "party box", "tv stick", "android tv stick", "streaming stick"
    ],
    palavras: [
      "roku tv", "google tv", "android tv", "aiwa", "edifier", "boombox",
      "anker", "soundcore", "subwoofer", "alto falante", "projetor",
      "echo dot", "alexa", "fire tv stick", "chromecast", "tv box",
      "microfone", "karaoke", "mesa de som", "amplificador", "receiver"
    ]
  }),

  regra(CATEGORIA.games, {
    prioridade: 82,
    fortes: [
      "playstation", "ps5", "ps4", "xbox", "nintendo switch", "console",
      "game stick", "controle ps5", "controle xbox", "controle sem fio",
      "gamepad", "joystick", "gamesir", "8bitdo", "machenike"
    ],
    palavras: [
      "jogo ps5", "jogo xbox", "jogo nintendo", "fliperama", "controle gamer"
    ]
  }),

  regra(CATEGORIA.eletronicos, {
    prioridade: 78,
    fortes: [
      "smartwatch", "smart watch", "relogio inteligente", "smart band",
      "smartband", "pulseira inteligente", "airtag", "smart tag",
      "tomada inteligente", "lampada inteligente", "interruptor inteligente",
      "sensor inteligente", "camera inteligente", "camera de vigilancia",
      "camera seguranca", "camera de seguranca", "drone", "baba eletronica",
      "camera instax", "instax mini"
    ],
    palavras: [
      "amazfit", "galaxy watch", "apple watch", "mi band", "haylou",
      "huawei band", "rastreador bluetooth", "controle remoto universal",
      "camera wifi", "camera ip", "camera externa", "camera interna",
      "ring light", "mini projetor", "airpods", "hoverboard", "monitor bebe",
      "fujifilm instax"
    ]
  }),

  regra(CATEGORIA.eletrodomesticos, {
    prioridade: 74,
    fortes: [
      "geladeira", "refrigerador", "frigobar", "freezer", "microondas",
      "micro ondas", "fogao", "cooktop", "lava roupas", "maquina de lavar",
      "lavadora", "lava e seca", "secadora", "lava loucas",
      "ventilador", "ventilador de mesa", "ventilador de coluna",
      "ventilador de teto", "circulador de ar", "ar condicionado",
      "ar condicionado split", "climatizador", "umidificador",
      "desumidificador", "aquecedor", "purificador de ar"
    ],
    palavras: [
      "forno eletrico", "forno embutir", "coifa", "depurador", "bebedouro",
      "purificador de agua", "adega climatizada", "cervejeira", "consul",
      "brastemp", "electrolux", "midea", "panasonic", "philco", "eos",
      "exaustor", "split inverter", "ventilador torre", "elgin", "gree"
    ]
  }),

  regra(CATEGORIA.eletroportateis, {
    prioridade: 72,
    fortes: [
      "cafeteira", "maquina de cafe", "air fryer", "airfryer", "fritadeira sem oleo",
      "liquidificador", "mixer", "processador de alimentos", "batedeira",
      "sanduicheira", "grill", "panela eletrica", "aspirador robo",
      "robo aspirador", "aspirador de po", "ferro de passar", "omeleteira",
      "panificadora", "maquina de pao", "fogareiro eletrico", "panela pressao digital",
      "panela de pressao digital", "multi cook", "multicook", "vaporizador", "escova eletrica giratoria"
    ],
    palavras: [
      "pipoqueira", "chaleira eletrica", "torradeira", "maquina waffle",
      "multicooker", "cooktop eletrico", "aspirador vertical", "vaporizador roupas",
      "passadeira vapor", "panela eletrica pressao", "vaporizador roupas", "vaporizador portatil", "chaleira eletrica", "escova giratoria", "escova rotativa", "escova eletrica"
    ]
  }),

  regra(CATEGORIA.tenis, {
    prioridade: 70,
    fortes: [
      "tenis", "chinelo", "havaianas", "sandalia", "rasteira", "rasteirinha",
      "tamanco", "sapatilha", "sapatenis", "crocs", "papete", "mocassim",
      "chuteira",
      "bota", "botina", "coturno", "sapato", "salto"
    ],
    palavras: [
      "mizuno", "asics", "nike", "adidas", "olympikus", "fila", "vizzano",
      "piccadilly", "puma", "reebok", "new balance", "kappa", "pegada",
      "democrata", "ferracini", "beira rio", "moleca", "molekinha",
      "via marte", "dakota", "tenis corrida", "tenis casual", "tenis esportivo"
    ],
    negativas: [
      "camiseta masculina", "camisa masculina", "camisa social masculina",
      "polo masculina", "short masculino", "short virgulado",
      "bermuda masculina", "regata masculina", "moletom masculino",
      "jaqueta masculina", "calca masculina", "calca jogger masculina",
      "calca moletom masculina", "moda masculina", "camisa polo masculina"
    ]
  }),

  regra(CATEGORIA.modaFeminina, {
    prioridade: 68,
    fortes: [
      "calcinha", "sutia", "lingerie", "camisola", "pijama feminino",
      "jaqueta feminina", "puffer feminina", "jaqueta puffer feminina",
      "biquini", "camiseta feminina", "blusa feminina", "regata feminina",
      "baby tee feminina", "macaquinho feminino",
      "baby look", "cropped", "tomara que caia", "vestido", "saia", "short feminino",
      "shorts feminino", "calca feminina", "legging", "body feminino", "moda feminina",
      "oculos de sol", "bolsa de viagem", "bolsa academia", "sobretudo feminino"
    ],
    palavras: [
      "macaquinho feminino", "macacao feminino", "conjunto feminino",
      "calca pantalona feminina", "wide leg feminina", "legging feminina", "cinta modeladora feminina", "cinta modeladora", "body modelador", "top tomara que caia",
      "moletom feminino", "jaqueta feminina", "plus size feminina",
      "tricot feminino", "wide leg", "jeans feminina", "bolsa feminina",
      "tiracolo", "tote", "carteira feminina", "meia calca", "camisa feminina",
      "blazer feminino", "kimono feminino", "cardigan", "top feminino",
      "calca flare", "calca pantalona", "pantalona feminina", "wide leg",
      "jardineira feminina", "mule feminino", "la batida feminina"
    ]
  }),

  regra(CATEGORIA.modaMasculina, {
    prioridade: 66,
    fortes: [
      "camisa polo", "camiseta", "camisetas", "camiseta masculina", "camisa masculina",
      "camisa social masculina", "moletom masculino", "jaqueta masculina",
      "calca jeans masculina", "bermuda masculina", "short", "shorts", "short masculino",
      "short virgulado",
      "calca jogger masculina", "calca dry fit masculina", "calca moletom masculina",
      "regata masculina", "cueca boxer", "cueca", "polo masculina", "moda masculina", "meia termica",
      "meia flanelada", "t shirt insider",
      "camisa adidas masculina", "camisa nike masculina", "camisa puma masculina",
      "sandrini dry fit masculina",
      "camiseta adidas masculina", "camiseta nike masculina", "camiseta puma masculina",
      "polo adidas masculina", "polo nike masculina", "polo puma masculina",
      "short adidas masculino", "short nike masculino", "short puma masculino"
    ],
    palavras: [
      "kit camiseta masculina", "calca masculina", "calca sarja masculina", "kit bermudas masculinas", "bermudas masculinas", "polo masculina",
      "bermuda masculina", "shorts masculino", "camisa polo masculina",
      "calca moletom masculina", "camisa xadrez masculina", "blusa masculina", "short virgulado",
      "casaco masculino", "colete masculino", "conjunto masculino",
      "terno masculino", "blazer masculino", "pijama masculino", "sunga",
      "carteira masculina", "cinto masculino", "meia masculina",
      "pares de meia", "pares de meias", "kit pares de meias", "kit meias",
      "sportee insider", "camiseta insider", "kit camisetas masculinas",
      "camisetas masculinas"
    ]
  }),

  regra(CATEGORIA.esporte, {
    prioridade: 64,
    fortes: [
      "halter", "haltere", "kettlebell", "musculacao", "crossfit", "whey",
      "creatina", "pre treino", "albumina", "barra de proteina",
      "suplemento", "hipercalorico", "bcaa", "glutamina", "protein crush",
      "colageno", "colageno hidrolisado", "colagentek", "vitafor", "bike", "bicicleta",
      "esteira", "eliptico", "yoga", "pilates", "balanca bioimpedancia",
      "sodio potassio magnesio", "bebida isotonica", "vitamina d3", "vitamina k2"
    ],
    palavras: [
      "faixa elastica", "short academia", "camiseta academia", "dry fit",
      "legging esportiva", "top esportivo", "bola de futebol", "luva academia",
      "corda de pular", "coqueteleira", "omega 3", "termogenico",
      "multivitaminico", "barra fixa", "roda abdominal", "hand grip",
      "suplemento de eletrolitos", "eletrólitos para hidratacao",
      "repositor eletrolitico", "repositor hidroeletrolitico",
      "isotonico", "isotonica", "snack proteico",
      "garmin", "integralmedica", "max titanium", "growth supplements", "patins"
    ]
  }),

  regra(CATEGORIA.ferramentas, {
    prioridade: 62,
    fortes: [
      "furadeira", "parafusadeira", "esmerilhadeira", "serra marmore",
      "serra circular", "serra tico tico", "martelete", "lixadeira",
      "trena", "nivel laser", "kit ferramenta", "jogo de ferramentas",
      "maleta de ferramentas", "caixa de ferramentas", "jogo de soquetes", "kit soquetes",
      "kit ferramentas", "maleta ferramentas", "chave de fenda",
      "ferramentas profissional", "profissional eletricista", "eletricista",
      "conjunto de chaves", "chaves de extensao", "chave catraca",
      "alicate de ponta fina", "alicate diagonal", "alicate eletronico",
      "alicate de fio", "alicate de ponta aberta", "alicate de anel", "ferramentas de reparo",
      "motosserra", "eletrosserra", "serra de corte", "serra marmore",
      "serra ceramica", "serra granito", "ferramenta serralheiro",
      "conjunto de chave", "jogo de chaves", "maquina assentar pisos",
      "assentar pisos"
    ],
    palavras: [
      "chave inglesa", "chave allen", "chave soquete", "soquete", "soquetes", "alicate universal",
      "kit de ferramentas",
      "alicate de pressao", "alicate profissional", "alicate eletricista",
      "alicate corte", "vonder",
      "makita", "bosch", "dewalt", "gedore", "tramontina pro", "compressor de ar",
      "pistola pintura", "soprador termico", "micro retifica", "inversora solda",
      "maquina solda", "lavadora alta pressao", "multimetro", "broca",
      "parafuso", "escada aluminio", "paquimetro", "estilete", "rebitadeira",
      "caixa multiuso ferramentas", "serra para marmore", "serra para ceramica",
      "serra para granito", "lishi", "chave lishi", "chave de deslocamento",
      "alcance estreito"
    ],
    negativas: [
      "manicure", "pedicure", "unha", "cuticula", "esmalte",
      "alicate de unha", "alicate aplicador", "botao de pressao", "botoes de pressao", "costura", "artesanato", "manicure", "pedicure",
    ]
  }),

  regra(CATEGORIA.casa, {
    prioridade: 58,
    fortes: [
      "jogo de panelas", "kit panela", "frigideira", "panela", "kit churrasco", "churrasco mestre", "faqueiro",
      "talheres", "copos", "jogo de copos", "jogo de pratos", "bolas de natal", "marmitas", "potes",
      "cobertor", "manta", "toalha de banho", "colcha", "tapete",
      "bacia retratil", "tabua de corte", "pote vidro", "copo",
      "cortina", "almofada", "espelho", "sofa", "rack", "painel tv",
      "guarda roupa", "mesa", "cadeira", "penteadeira", "armario",
      "kit toalete", "toalete casamento", "jogo americano", "copo termico", "travesseiro", "lencol", "edredom", "fronha", "cuba", "louca", "pote", "fechadura inteligente",
      "cabide", "cabides", "marmita", "tapete banheiro", "porta escova",
      "garrafa termica", "panos de copa", "pano de copa", "gabinete banheiro",
      "jogo de toalhas", "espremedor de alho", "molde para bolo",
      "mala de viagem", "cama box", "colchao", "colchao casal"
    ],
    palavras: [
      "cortador de legumes", "ralador", "assadeira", "garrafa termica",
      "garrafa termica inox", "garrafa termica cafe", "copo termico inox",
      "cadeira de escritorio", "escrivaninha", "nicho", "prateleira",
      "sapateira", "cabeceira", "poltrona", "estante", "aparador",
      "conjunto sala de jantar", "sala de jantar", "kit motor portao",
      "motor de portao", "motor para portao", "motor rossi", "portao dz",
      "revestimento ripado", "autocolante", "alicate aplicador", "botao de pressao",
      "varal", "lixeira", "torneira", "banheiro", "cozinha", "organizador",
      "caixa organizadora", "escorredor", "misturador monocomando", "rede de dormir", "utensilios churrasco", "conjunto churrasco",
      "pote de vidro", "potes de vidro", "pote plastico", "pote hermetico", "porta escova banheiro", "organizador cozinha", "organizador banheiro", "jogo de cama", "roupa de cama", "cuba banheiro", "louca banheiro", "fechadura digital", "fechadura eletronica",
      "jogo de toalha", "toalhas banho", "molde ajustavel", "molde ajustavel para bolo",
      "mala polipropileno", "utensilio cozinha", "conjunto bistro", "bistro", "varanda", "sacada", "area gourmet", "arara para roupas", "arara de roupas", "arara roupas",
      "ducha higienica",
    ],
    negativas: [
      "tapete higienico", "tapete higienico pet", "pet", "gato", "cachorro"
    ]
  }),

  regra(CATEGORIA.iluminacao, {
    prioridade: 56,
    fortes: [
      "luminaria", "lustre", "pendente led", "refletor", "refletor led",
      "lampada", "painel led", "plafon", "spot led", "fita led",
      "tomada", "interruptor", "disjuntor", "sensor de presenca",
      "fio eletrico", "cabo eletrico", "chuveiro eletrico",
      "chuveiro eletronico", "ducha eletrica", "ducha eletronica",
      "maxi ducha"
    ],
    palavras: [
      "arandela", "trilho eletrificado", "perfil led", "fonte led",
      "driver led", "mangueira led", "pisca pisca", "luminaria solar",
      "painel solar", "fotocelula", "quadro distribuicao", "contator",
      "rele", "campainha", "canaleta eletrica", "adaptador tomada",
      "regua energia", "lorenzetti"
    ]
  }),

  regra(CATEGORIA.pet, {
    prioridade: 54,
    fortes: [
      "racao", "cachorro", "gato", "petisco", "pedigree", "tapete higienico",
      "coleira", "guia para cachorro", "peitoral", "comedouro pet",
      "bebedouro pet", "areia para gato", "areia sanitaria", "tapete higienico pet", "tapete higienico", "antipulgas", "vermifugo",
      "arranhador", "casinha pet", "cama pet", "shampoo pet"
    ],
    palavras: [
      "whiskas", "golden", "premier pet", "granplus", "special dog",
      "special cat", "royal canin", "farmina", "mordedor pet",
      "roupa pet", "caixa transporte", "aquario", "fonte pet",
      "comedouro automatico", "granulado higienico", "fralda pet", "sanitario gato", "areia sanitaria gato"
    ]
  }),

  regra(CATEGORIA.brinquedos, {
    prioridade: 52,
    fortes: [
      "lego", "boneco", "boneca", "hot wheels", "brinquedo",
      "pista de brinquedo", "carrinho controle remoto", "bebe reborn",
      "quebra cabeca", "triciclo infantil", "patinete infantil",
      "fisher price", "massinha", "blocos de montar", "nerf", "patins infantil"
    ],
    palavras: [
      "hasbro", "marvel", "homem aranha", "spider man", "vingadores",
      "montessori", "play doh", "casinha infantil", "jogo educativo",
      "dinossauro", "t rex", "action figure", "brinquedo stem",
      "patins crianca", "patins infantil", "batman sunny",
      "jogo de xadrez", "xadrez", "mandala jogos", "figurinhas copa do mundo",
      "figurinha copa", "figurinhas copa", "album copa", "album figurinha", "album de figurinha", "kit figurinhas", "album copa do mundo"
    ]
  }),

  regra(CATEGORIA.pesca, {
    prioridade: 50,
    fortes: [
      "molinete", "vara de pesca", "carretilha", "anzol", "isca artificial", "iscas artificiais",
      "linha de pesca", "pesca", "camping", "barraca", "saco de dormir",
      "fogareiro camping", "lanterna camping", "caixa termica",
      "boia cevadeira", "boias cevadeira", "boias cevadeiras", "vara albatroz", "tucunare",
      "isca frog", "iscas frog", "jumping jig", "massa mafish"
    ],
    palavras: [
      "alicate de pesca", "colchonete", "mochila camping",
      "termolar", "nautika", "coleman", "cadeira camping", "mesa camping"
    ]
  }),

  regra(CATEGORIA.automotivo, {
    prioridade: 48,
    fortes: [
      "moto", "motocicleta", "capacete", "pneu", "roda automotiva",
      "macaco hidraulico", "macaco jacare", "auxiliar partida", "partida automotivo", "partida automotiva",
      "carplay", "android auto", "multimidia", "som automotivo",
      "camera de re", "sensor estacionamento", "farol", "lanterna automotiva",
      "bateria automotiva", "suporte veicular", "snow foam",
      "pulverizador lavagem carro", "calibrador de pneu", "compressor 12v", "calibrador"
    ],
    palavras: [
      "pro tork", "calota", "radio automotivo", "lampada automotiva",
      "carro", "veicular", "pneu", "partida automotiva",
      "tapete automotivo", "capa banco", "volante esportivo", "bomba de ar",
      "inflador de pneus", "bomba calibrador", "bomba para pneu",
      "compressor veicular", "compressor de ar 12v", "auxiliar de partida",
      "pulverizador automotivo", "chave de roda", "palheta limpador", "pneus",
      "oleo motor", "rack teto", "bagageiro teto"
    ]
  }),

  regra(CATEGORIA.limpeza, {
    prioridade: 46,
    fortes: [
      "mop", "esfregao", "rodo", "vassoura", "multiuso", "desinfetante",
      "detergente", "desengordurante", "amaciante", "amaciantes", "sabao liquido",
      "sabao em po", "lava roupas", "tira manchas", "alvejante",
      "agua sanitaria", "limpa vidro", "limpa piso", "papel higienico",
      "odorizante ambiente", "aromatizador ambiente", "coala odorizante",
      "coala home"
    ],
    palavras: [
      "downy", "omo", "ype", "veja", "cloro", "removedor", "lustra moveis",
      "pano microfibra", "esponja limpeza", "kit limpeza", "refil mop",
      "kit coala home"
    ],
    negativas: [
      "ferramentas", "eletricista", "caixa de ferramentas"
    ]
  }),

  regra(CATEGORIA.bebidas, {
    prioridade: 44,
    fortes: [
      "cerveja", "whisky", "vodka", "vinho", "espumante", "energetico",
      "coca cola", "refrigerante", "suco", "agua de coco", "chopp"
    ],
    palavras: [
      "heineken", "red label", "old par", "amstel", "monster", "tnt",
      "burn", "ipa", "vinho tinto", "vinho branco", "vinho rose"
    ]
  }),

  regra(CATEGORIA.alimentos, {
    prioridade: 42,
    fortes: [
      "azeite", "arroz", "feijao", "leite", "cafe", "chocolate",
      "biscoito", "bolacha", "tempero", "mercearia", "nespresso",
      "dolce gusto", "achocolatado", "granola", "amendoim", "castanha",
      "macarrao", "molho tomate", "farinha", "acucar", "cesta basica", "drip coffee", "sache cafe", "sache de cafe"
    ],
    palavras: [
      "barra cereal", "barra de cereal", "pasta amendoim", "geleia", "mel",
      "cha", "bananinha", "molho barbecue", "azeitona", "cappuccino", "cafe drip", "cafe em sache", "cafe soluvel",
      "bala", "bombom", "doce de leite", "pacoca", "cookies"
    ]
  })
];

const ALIASES_CATEGORIA = new Map(
  Object.values(CATEGORIA).map((categoria) => [normalizarTextoLocal(categoria), categoria])
);

// Identidades de produto inequívocas que o classificador legado ainda não cobre.
// Aplicadas apenas quando nenhuma regra existente reconheceu a oferta.
const IDENTIDADES_CONFIAVEIS = [
  [CATEGORIA.beleza, /\b(?:oleo capilar|finalizador capilar|creme de pentear|tonalizante capilar|cronograma capilar|hair care|knut ultra silver|oleo 10 em 1 absolut repair|truss (?:night spa|uso obrigatorio)|fitagem para cabelos|gel fixador charming|mousse desembaracante|mascara blond expert|ck one calvin klein \d+ ?ml)\b/],
  [CATEGORIA.casa, /\b(?:protetores? de ralo|formas? de pastel|puff gigante|banquetas? altas?|canecas?|mala de (?:\d+ ?kg )?bordo|cestos? organizadores?|travesseiros?|cadeiras? escritorio|tela mosquiteiro|jogo (?:de )?panelas|conjunto panelas|cacarola tefal|conj de 0?6 pratos|kit silicone para panelas|jogo de facas tramontina|cortador mandoline?)\b/],
  [CATEGORIA.limpeza, /\bglade difusor de ambiente\b/],
  [CATEGORIA.esporte, /\b(?:maca peruana|energy gel(?: atlhetica)?|palatinose|z2 saltz|taurina essencial lab)\b|(?=.*\beletrolitos?\b)(?=.*\b(?:hidratacao|sodio|potassio|magnesio|saltz|endurance|ocean drop)\b)/],
  [CATEGORIA.papelariaLivros, /\b(?:hidrografica com \d+ cores|murdoku)\b/],
  [CATEGORIA.alimentos, /\b(?:yopro bebida lactea|ketchup|maionese|molho de tomate)\b/],
  [CATEGORIA.bebidas, /\b(?:bourbon whiskey|jim beam|gin (?:bombay|ingles)|beefeater|casillero del diablo|rum bacardi|red bull)\b/],
  [CATEGORIA.tenis, /\bunder armour tribase cross\b/],
  [CATEGORIA.iluminacao, /\bluminarias? de emergencia\b/],
  [CATEGORIA.perifericos, /\bsuporte articulado(?: a gas)? para \d+ monitores?\b/],
  [CATEGORIA.eletronicos, /\b(?:cameras? (?:de )?seguranca|camera de acao dji|starlink mini)\b/],
  [CATEGORIA.pesca, /(?=.*\bsuporte de vara\b)(?=.*\b(?:praia|pesqueiro|pesca)\b)/]
];

function categoriaPorIdentidadeConfiavel(oferta = {}, termo = "") {
  const identidade = normalizarTextoLocal(oferta.titulo || oferta.nome || termo || "");
  if (!identidade) return "";
  const encontradas = new Set(
    IDENTIDADES_CONFIAVEIS.filter(([, padrao]) => padrao.test(identidade)).map(([categoria]) => categoria)
  );
  return encontradas.size === 1 ? [...encontradas][0] : "";
}

function categoriaDeclaradaValida(oferta = {}) {
  const categoria = normalizarTextoLocal(oferta.categoria || oferta.categoriaProduto || "");

  if (!categoria) return "";

  const categoriasInvalidas = [
    "geral", "todos", "todas", "amazon", "aliexpress", "shopee",
    "mercadolivre", "mercado livre", "magalu", "awin", "kabum",
    "computador", "computadores", "escritorio"
  ];

  if (categoriasInvalidas.some((item) => categoria === item || categoria.includes(item))) {
    return "";
  }

  return ALIASES_CATEGORIA.get(categoria) || "";
}

function pontuarRegra(texto, regraCategoria) {
  const fortes = termosEncontrados(texto, regraCategoria.fortes);
  const palavras = termosEncontrados(texto, regraCategoria.palavras);
  const negativas = termosEncontrados(texto, regraCategoria.negativas);

  if (!fortes.length && !palavras.length) {
    return null;
  }

  const pontuacao =
    regraCategoria.prioridade +
    fortes.reduce((total, termo) => total + 18 + termo.split(" ").length, 0) +
    palavras.reduce((total, termo) => total + 6 + Math.min(termo.split(" ").length, 3), 0) -
    negativas.length * 20;

  return {
    categoria: regraCategoria.categoria,
    pontuacao,
    fortes,
    palavras
  };
}

function desempatar(a, b) {
  if (b.pontuacao !== a.pontuacao) return b.pontuacao - a.pontuacao;

  const fortes = b.fortes.length - a.fortes.length;
  if (fortes !== 0) return fortes;

  return b.palavras.length - a.palavras.length;
}

function categoriaPorNaturezaExplicita(oferta = {}, termo = "") {
  const titulo = normalizarTextoLocal(oferta.titulo || oferta.nome || termo || "");
  return /^brinquedos? (?:bancada|oficina)\b/.test(titulo) ? CATEGORIA.brinquedos : "";
}

// Proveniência em memória: JSON recebido de cliente ou reidratado de disco não
// consegue se apresentar como resposta oficial. Não é uma permissão comercial.
const EVIDENCIAS_MARKETPLACE = new WeakSet();
const FONTES_CATEGORIA = Object.freeze({
  "aliexpress.affiliate.productdetail.get": "aliexpress",
  "aliexpress.affiliate.product.query": "aliexpress",
  mercadolivre_api_items: "mercadolivre",
  shopee_affiliate_graphql: "shopee",
  amazon_product_api: "amazon",
  magalu_product_jsonld: "magalu",
  kabum_product_jsonld: "kabum",
  awin_feed: "awin"
});
const MAPA_CATEGORIAS_EXTERNAS = [
  [CATEGORIA.pesca, /^(?:iscas? artificiais?|artificial fishing baits|fishing (?:lures?|rods?|lines?|reels?|hooks?)|varas? de pesca|linhas? de pesca|carretilhas?|molinetes?|anz[oó]is|pesca|fishing|camping|barracas? de camping)$/],
  [CATEGORIA.ferramentas, /^(?:ferramentas(?: eletricas)?|power tools|hand tools|tools)$/],
  [CATEGORIA.beleza, /^(?:perfumes?|perfumaria|fragrances|skin care|hair care)$/],
  [CATEGORIA.computadores, /^(?:notebooks?|laptops|desktop computers|computers)$/],
  [CATEGORIA.perifericos, /^(?:computer peripherals|perifericos|keyboards|mice)$/],
  [CATEGORIA.modaMasculina, /^(?:men s clothing|roupas masculinas|moda masculina)$/],
  [CATEGORIA.modaFeminina, /^(?:women s clothing|roupas femininas|moda feminina)$/],
  [CATEGORIA.infantil, /^(?:children s clothing|roupas infantis|moda infantil)$/],
  [CATEGORIA.brinquedos, /^(?:toys(?: and games)?|brinquedos)$/],
  [CATEGORIA.tenis, /^(?:sneakers|tenis|chinelos)$/],
  [CATEGORIA.eletrodomesticos, /^(?:home appliances|eletrodomesticos|refrigerators)$/],
  [CATEGORIA.iluminacao, /^(?:electrical equipment|power strips|lighting|iluminacao|material eletrico|filtros? de linha)$/],
  [CATEGORIA.automotivo, /^(?:automotive|automotivo|auto parts)$/]
];

function criarEvidenciaCategoriaMarketplace({ marketplace, fonte, produtoId, categoriaId = "", hierarquia = [], tipoProduto = "" } = {}) {
  if (FONTES_CATEGORIA[fonte] !== marketplace || !/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/i.test(String(produtoId || "")) || String(produtoId).length > 80) return null;
  const itens = Array.isArray(hierarquia) ? hierarquia.slice(0, 8) : [];
  const evidencia = Object.freeze({ marketplace, fonte, produtoId: String(produtoId),
    categoriaId: String(categoriaId || "").slice(0, 80), tipoProduto: String(tipoProduto || "").slice(0, 120),
    hierarquia: Object.freeze(itens.filter(item => item != null).map(item => String(typeof item === "object" ? item?.nome || "" : item).slice(0, 120)).filter(Boolean)) });
  EVIDENCIAS_MARKETPLACE.add(evidencia);
  return evidencia;
}

function categoriaMarketplaceComprovada(oferta = {}) {
  const raw = oferta.raw || {};
  const produto = oferta.metadata?.produto || raw.metadata?.produto || {};
  const evidencia = oferta.categoriaMarketplace || raw.categoriaMarketplace || produto.categoriaMarketplace;
  const identidade = String(oferta.produtoId || oferta.productId || oferta.produtoIdDetectado || raw.produtoId || raw.productId || raw.produtoIdDetectado || produto.produtoId || produto.productId || "");
  const marketplace = String(oferta.marketplace || raw.marketplace || "").toLowerCase();
  if (!evidencia || !EVIDENCIAS_MARKETPLACE.has(evidencia) || evidencia.produtoId !== identidade || evidencia.marketplace !== marketplace) return null;
  if (/\b(?:sex toy|sex shop|vibrador|dildo|masturbador|erotico|erotica)\b/.test(normalizarTextoLocal(evidencia.tipoProduto)))
    return { categoria: CATEGORIA.diversos, fonte: evidencia.fonte, adulto: true };
  const tipo = MAPA_CATEGORIAS_EXTERNAS.find(([, padrao]) => padrao.test(normalizarTextoLocal(evidencia.tipoProduto)))?.[0];
  for (let i = evidencia.hierarquia.length - 1; i >= 0; i--) {
    const nome = normalizarTextoLocal(evidencia.hierarquia[i]);
    const match = MAPA_CATEGORIAS_EXTERNAS.find(([, padrao]) => padrao.test(nome));
    if (match) return { categoria: tipo || match[0], fonte: evidencia.fonte, conflito: Boolean(tipo && tipo !== match[0]) };
  }
  return tipo ? { categoria: tipo, fonte: evidencia.fonte } : null; // ID opaco ou ramo amplo não inventam taxonomia.
}

// Reutilização apenas do cache técnico em memória já validado; não revalida JSON
// de disco/cliente nem copia afiliação. Dois caminhos fixos, sem varredura geral.
function preservarEvidenciaCategoriaMarketplace(origem, copia) {
  if (!origem || !copia) return copia;
  if (EVIDENCIAS_MARKETPLACE.has(origem.categoriaMarketplace)) copia.categoriaMarketplace = origem.categoriaMarketplace;
  if (origem.fatos && copia.fatos && EVIDENCIAS_MARKETPLACE.has(origem.fatos.categoriaMarketplace)) copia.fatos.categoriaMarketplace = origem.fatos.categoriaMarketplace;
  return copia;
}

function finalidadePesqueiraExplicita(titulo) {
  // Identidade e finalidade no produto; origem, loja e workspace não são prova.
  // Vara técnica exige comprimento E libragem, sem depender de marca/modelo.
  if (/\bvaras?\b/.test(titulo) &&
      /\b\d+(?: \d+)? ?(?:m|mts|metros|cm)\b/.test(titulo) && /\b\d+ ?lbs?\b/.test(titulo) &&
      !/\b(?:cortina|rosqueada|roscada|rosca|aterramento|solda|academia|musculacao|capa|suporte|camisa|camiseta|brinquedo|manual)\b/.test(titulo)) return "vara_tecnica_comprimento_libragem";
  // Ração para nutrição/criação continua Pet. Pesqueiro sozinho não prova isca.
  if (/\bracao\b/.test(titulo) && /\bpesca\b/.test(titulo) &&
      /\b(?:furadinha|furada|anzol|isca|cevadeira)\b/.test(titulo) &&
      !/\b(?:aquario|ornamentais|ornamental|criacao|alevinos|aquicultura|cachorro|gato|aves|roedores)\b/.test(titulo)) return "racao_isca_finalidade_pesca";
  // Tipo isca + identidade dedicada ou atributos/finalidade de uma isca física.
  // Rapala isolada não é evidência; veneno, pet e vestuário nunca herdam a marca.
  if (/\biscas?\b/.test(titulo) &&
      (/\b(?:rapala|corrico|trolling|meia agua|superficie|garateias?)\b/.test(titulo) ||
       (/\b\d+(?: \d+)? ?(?:cm|mm)\b/.test(titulo) && /\b\d+(?: \d+)? ?(?:g|gr|gramas)\b/.test(titulo))) &&
      !/\b(?:veneno|raticida|formicida|inseticida|ratos?|camundongos?|formigas?|baratas?|cupins?|moscas?|mosquitos?|pragas?|empanada|congelada|frita|frango|carne|culinaria|alimenticia|petisco|brinquedo|cachorro|gato|camisa|camiseta|blusa|regata|calca|bermuda|shorts|vestido|bone|oculos|livro|manual)\b/.test(titulo)) return "isca_identidade_finalidade_pesca";
  return "";
}

function avaliarEvidenciaCategoria(oferta = {}, termo = "") {
  const titulo = normalizarTextoLocal(String(oferta.titulo || oferta.nome || termo || "").slice(0, 1200));
  const oficial = categoriaMarketplaceComprovada(oferta);
  const declarada = categoriaDeclaradaValida(oferta);
  let categoria = "", motivo = "natureza_produto_explicita", finalidadePesca = "", funcional = null;
  if (oficial?.adulto || /\b(?:sex shop|vibrador(?:es)?|dildos?|masturbador(?:es)?|estimulador sexual|eroticos?|eroticas?)\b/.test(titulo) ||
      (/\badultos?\b/.test(titulo) && (/\b(?:infantil|bebe|juvenil|crianca|meninos?|meninas?)\b/.test(titulo) ||
        [CATEGORIA.bebes, CATEGORIA.infantil, CATEGORIA.brinquedos].includes(oficial?.categoria || declarada)))) {
    categoria = CATEGORIA.diversos;
    motivo = "conteudo_adulto_sem_categoria_habilitada";
  } else if (/\bbrinquedos?\b/.test(titulo) && /\b(?:pesca|molinetes?|bancada|oficina|ferramentas?|lavadora|inversora|solda|alicate|parafusadeira|furadeira)\b/.test(titulo)) {
    categoria = CATEGORIA.brinquedos;
  } else if (/\b(?:calcas?|camisas?|camisetas?|bermudas?|shorts?)\b/.test(titulo) && /\bpesca\b/.test(titulo)) {
    categoria = /\b(?:infantil|juvenil|crianca)\b/.test(titulo) ? CATEGORIA.infantil
      : /\b(?:feminina|feminino|mulher)\b/.test(titulo) ? CATEGORIA.modaFeminina
      : /\b(?:masculina|masculino|homem)\b/.test(titulo) ? CATEGORIA.modaMasculina
      : [CATEGORIA.modaFeminina, CATEGORIA.modaMasculina, CATEGORIA.infantil].includes(oficial?.categoria || declarada)
        ? oficial?.categoria || declarada : CATEGORIA.diversos;
  } else if (/\blinha\b/.test(titulo) && /\b(?:monofilamento|multifilamento)\b/.test(titulo) && /\bimpressora 3d\b/.test(titulo)) {
    categoria = CATEGORIA.diversos;
    motivo = "finalidade_nao_pesqueira_explicita";
  } else if (!/^(?:(?:kit|jogo) (?:de )?)?(?:manual|curso|capa|mangueira|adaptador|bico|peca|placa|cabo)\b/.test(titulo) &&
      (/\b(?:maquina (?:inversora )?(?:de )?solda|inversora (?:para |de )?solda)\b/.test(titulo) ||
       /\blavadora (?:de )?alta pressao\b/.test(titulo) ||
       /\b(?:parafusadeira|furadeira)\b/.test(titulo) ||
       (/\balicate\b/.test(titulo) && !/\b(?:cuticula|unha|manicure|pedicure)\b/.test(titulo) &&
        (/\b(?:relojoeiro|(?:reparo|conserto) de relogios?)\b/.test(titulo) ||
         (/\b(?:fabricacao|reparo|conserto|montagem)\b/.test(titulo) && /\b(?:joias|bijuterias)\b/.test(titulo)))))) {
    categoria = CATEGORIA.ferramentas;
  } else if (/\b(?:edt|edp)\b/.test(titulo) &&
      /\b(?:perfume|fragrancia|eau de toilette|eau de parfum|hugo boss|giorgio armani)\b|\b\d+(?: \d+)?\s*ml\b/.test(titulo) &&
      !/\b(?:frasco|vazio|vazia|limpador|limpeza|refil de tinta|relogio|camiseta|monitor)\b/.test(titulo)) {
    // Concentração + volume ou identidade de perfumaria, nunca marca/EDT isolados.
    categoria = CATEGORIA.beleza;
  } else if (/\b(?:regua de tomadas|filtro de linha|regua de energia)\b/.test(titulo)) {
    categoria = CATEGORIA.iluminacao;
  } else if (/\b(?:lampadas? automotivas?|oleo de motor automotivo)\b/.test(titulo)) {
    categoria = CATEGORIA.automotivo;
  } else if ((funcional = avaliarFamiliaFuncional(oferta, titulo))) {
    categoria = funcional.categoria;
    motivo = funcional.motivo;
  } else if ((finalidadePesca = finalidadePesqueiraExplicita(titulo))) {
    categoria = CATEGORIA.pesca;
    motivo = finalidadePesca;
  } else if (/\biscas?\b.{0,60}\b(?:artificial|artificiais|camarao|camaroes|frog|sapo|jig)\b/.test(titulo) ||
      /\blinha shimano kairiki\b|\bvara lori rampage\b/.test(titulo) ||
      (/\blinha\b/.test(titulo) && /\b(?:pesca|fluorocarbono|multifilamento|monofilamento)\b/.test(titulo)) ||
      /\bvara (?:de |para )?pesca\b/.test(titulo) ||
      (/\bgarateias?\b/.test(titulo) && /\b(?:rapala|fish fighter|pesca|tripla|anzol|isca artificial)\b/.test(titulo)) ||
      (/\bregua\b/.test(titulo) && /\bmedir\b/.test(titulo) && /\bpeixes?\b/.test(titulo)) ||
      (/\b(?:graxa|oleo)\b/.test(titulo) && /\b(?:carretilhas?|molinetes?)\b/.test(titulo))) {
    categoria = CATEGORIA.pesca;
  }
  if ((categoria === CATEGORIA.pesca && /\b(?:notebook|smartphone|furadeira|parafusadeira|geladeira|perfume)\b/.test(titulo)) ||
      (categoria === CATEGORIA.ferramentas && (/\biscas? (?:artificial|artificiais|frog|sapo|jig)\b/.test(titulo) || finalidadePesqueiraExplicita(titulo)))) {
    categoria = CATEGORIA.diversos;
    motivo = "naturezas_produto_conflitantes";
  }
  // Contradições inequívocas com fonte externa também são verificadas; não
  // reclassificam toda categoria declarada apenas por uma palavra no título.
  if (!categoria && oficial) {
    if (/\b(?:notebook|laptop|macbook)\b/.test(titulo)) categoria = CATEGORIA.computadores;
    else if (/\b(?:smartphone|iphone)\b/.test(titulo)) categoria = CATEGORIA.celulares;
    else if (/\b(?:furadeira|parafusadeira)\b/.test(titulo) && !/\bbrinquedo\b/.test(titulo)) categoria = CATEGORIA.ferramentas;
  }
  if (categoria || oficial) {
    const final = categoria || (oficial.conflito ? CATEGORIA.diversos : oficial.categoria);
    const divergencia = Boolean(oficial?.conflito || (oficial && oficial.categoria !== final) || (declarada && declarada !== CATEGORIA.diversos && declarada !== final));
    return { categoria: final, origem: categoria && !oficial?.adulto ? "identidade_produto" : "marketplace_oficial",
      fonteEvidencia: categoria && !oficial?.adulto ? funcional ? "campos_funcionais_disponiveis" : "titulo_tipo_modelo" : oficial.fonte,
      motivo: categoria ? motivo : oficial.conflito ? "tipo_hierarquia_divergentes" : "hierarquia_oficial_mapeada", confianca: final === CATEGORIA.diversos ? "baixa" : "alta",
      divergencia, baixaConfianca: final === CATEGORIA.diversos };
  }
  return null;
}

function classificarCategoriaOferta(oferta = {}, termo = "") {
  const evidencia = avaliarEvidenciaCategoria(oferta, termo);
  if (evidencia) return evidencia.categoria;
  return classificarCategoriaLegada(oferta, termo);
}

function classificarCategoriaLegada(oferta = {}, termo = "") {
  const texto = textoOferta(oferta, termo);

  if (!texto) {
    return CATEGORIA.diversos;
  }

  // Conteúdo adulto explícito permanece em Diversos nesta versão; nunca o
  // encaminha a uma categoria infantil por sinais conflitantes no título.
  const conteudoAdultoExplicito = /\b(?:sex shop|vibrador(?:es)?|dildo(?:s)?|masturbador(?:es)?|estimulador sexual|eroticos?|eroticas?)\b/.test(texto);
  const faixaEtariaConflitante = /\badultos?\b/.test(texto) && /\b(?:infantil|bebe|juvenil|crianca|meninos?|meninas?)\b/.test(texto);
  if (conteudoAdultoExplicito || faixaEtariaConflitante) {
    return CATEGORIA.diversos;
  }

  const categoriaManual = categoriaDeclaradaValida(oferta);
  if (categoriaManual && !termo) {
    return categoriaManual;
  }

  // A natureza explícita de brinquedo no título vence os nomes das ferramentas imitadas.
  const categoriaNatureza = categoriaPorNaturezaExplicita(oferta, termo);
  if (categoriaNatureza) return categoriaNatureza;

  const resultados = REGRAS
    .map((item) => pontuarRegra(texto, item))
    .filter(Boolean)
    .sort(desempatar);

  if (!resultados.length) {
    if (categoriaManual && categoriaManual !== CATEGORIA.diversos) return categoriaManual;
    const categoriaIdentidade = categoriaPorIdentidadeConfiavel(oferta, termo);
    if (categoriaIdentidade) return categoriaIdentidade;
    console.log("[INFO] CATEGORIA NAO IDENTIFICADA:", texto);
    return categoriaManual || CATEGORIA.diversos;
  }

  const melhor = resultados[0];

  console.log("[INFO] Categoria classificada:", {
    categoria: melhor.categoria,
    pontos: melhor.pontuacao,
    fortes: melhor.fortes.slice(0, 5),
    palavras: melhor.palavras.slice(0, 5),
    titulo: oferta.titulo || oferta.nome || termo || ""
  });

  return melhor.categoria;
}

module.exports = {
  classificarCategoriaOferta,
  avaliarEvidenciaCategoria,
  criarEvidenciaCategoriaMarketplace,
  preservarEvidenciaCategoriaMarketplace,
  categoriaPorNaturezaExplicita,
  normalizarTextoLocal
};
