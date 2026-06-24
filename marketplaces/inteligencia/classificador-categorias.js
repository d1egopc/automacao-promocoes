let categoriasDestinos = {};

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
  const encontrados = [];

  for (const palavra of palavras) {
    if (termoExiste(texto, palavra)) {
      encontrados.push(normalizarTextoLocal(palavra));
    }
  }

  return [...new Set(encontrados)];
}

function palavrasDosDestinos(nomeCategoria) {
  return Object.values(categoriasDestinos || {})
    .filter((item) => item?.nome === nomeCategoria)
    .flatMap((item) => item.palavras || []);
}

function regra(categoria, opcoes = {}) {
  return {
    categoria,
    prioridade: opcoes.prioridade || 0,
    fortes: opcoes.fortes || [],
    palavras: [
      ...(opcoes.palavras || []),
      ...palavrasDosDestinos(categoria)
    ],
    negativas: opcoes.negativas || []
  };
}

const REGRAS = [
  regra(CATEGORIA.beleza, {
    prioridade: 120,
    fortes: [
      "perfume", "parfum", "eau de parfum", "eau de toilette", "deo colonia",
      "colonia", "body splash", "malbec", "lattafa", "yara", "azzaro",
      "boticario", "natura", "eudora", "hidratante", "skincare",
      "protetor solar", "fps", "shampoo", "condicionador", "maquiagem",
      "mascara capilar", "hidratante labial", "skincare",
      "batom", "gloss", "serum", "sabonete liquido", "creme facial",
      "vitamina c", "maquina de cortar cabelo", "barbeador",
      "aparador de barba", "depilador", "escova secadora", "prancha de cabelo",
      "pressao arterial", "monitor de pressao", "monitor pressao arterial",
      "aparelho de pressao", "soro fisiologico", "pasta de dente",
      "creme dental", "alicate de cuticula", "cortador de unha",
      "irrigador oral", "nebulizador", "inalador", "seringa insulina", "escova progressiva", "renovador facial", "corretivo", "base maquiagem", "base corretivo", "base liquida", "base facial", "maquiagem", "luva nitrilica"
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
      "rx 580", "rx 6600", "rx 7600", "rx 7700", "rx 7800", "rx 7900",
      "ssd nvme", "nvme", "m 2", "memoria ram", "ddr4", "ddr5",
      "placa mae", "processador", "ryzen", "intel core", "water cooler",
      "air cooler", "fonte atx", "fonte gamer", "gabinete gamer", "cadeira gamer", "kit xeon"
    ],
    palavras: [
      "b450", "b550", "b650", "a520", "a620", "x570", "x670", "h610",
      "b760", "z790", "80 plus", "pfc ativo", "cooler master", "corsair",
      "kingston fury", "xpg", "crucial", "wd black", "pasta termica",
      "controladora argb", "hub fan", "kit fan"
    ]
  }),

  regra(CATEGORIA.computadores, {
    prioridade: 95,
    fortes: [
      "notebook", "laptop", "chromebook", "macbook", "computador",
      "pc gamer", "all in one", "mini pc", "desktop", "workstation",
      "notebook gamer"
    ],
    palavras: [
      "thinkpad", "ideapad", "vivobook", "zenbook", "aspire", "acer nitro",
      "nitro 5", "predator helios", "latitude", "inspiron", "vostro",
      "galaxy book", "book4", "legion", "omen", "alienware", "avell"
    ]
  }),

  regra(CATEGORIA.perifericos, {
    prioridade: 90,
    fortes: [
      "mouse", "teclado", "mousepad", "webcam", "headset", "micro sd",
      "microsd", "cartao de memoria", "pendrive", "hub usb", "monitor gamer",
      "monitor led", "monitor curvo", "monitor ultrawide",
      "suporte para notebook", "base refrigerada", "pen drive", "sandisk", "usb", "armazenamento"
    ],
    palavras: [
      "suporte notebook", "base notebook", "cooler notebook", "base para notebook", "mesa digitalizadora",
      "xp pen", "dock station", "adaptador usb", "leitor de cartao",
      "teclado mecanico", "mouse sem fio", "webcam full hd", "hd externo",
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
      "party box"
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
      "game stick", "controle ps5", "controle xbox", "joystick"
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
      "camera seguranca", "camera de seguranca", "drone", "baba eletronica"
    ],
    palavras: [
      "amazfit", "galaxy watch", "apple watch", "mi band", "haylou",
      "huawei band", "rastreador bluetooth", "controle remoto universal",
      "camera wifi", "camera ip", "camera externa", "camera interna",
      "ring light", "mini projetor", "airpods", "hoverboard", "monitor bebe"
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
      "cafeteira", "maquina de cafe", "air fryer", "fritadeira sem oleo",
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
      "bota", "botina", "coturno", "sapato", "salto"
    ],
    palavras: [
      "mizuno", "asics", "nike", "adidas", "olympikus", "fila", "vizzano",
      "piccadilly", "puma", "reebok", "new balance", "kappa", "pegada",
      "democrata", "ferracini", "beira rio", "moleca", "molekinha",
      "via marte", "dakota", "tenis corrida", "tenis casual", "tenis esportivo"
    ]
  }),

  regra(CATEGORIA.modaFeminina, {
    prioridade: 68,
    fortes: [
      "calcinha", "sutia", "lingerie", "camisola", "pijama feminino",
      "jaqueta feminina", "puffer feminina", "jaqueta puffer feminina",
      "biquini", "camiseta feminina", "blusa feminina", "regata feminina",
      "baby look", "cropped", "tomara que caia", "vestido", "saia", "short feminino",
      "shorts feminino", "calca feminina", "legging", "body feminino", "moda feminina",
      "oculos de sol", "bolsa de viagem", "bolsa academia"
    ],
    palavras: [
      "macaquinho feminino", "macacao feminino", "conjunto feminino",
      "calca pantalona feminina", "wide leg feminina", "legging feminina", "cinta modeladora feminina", "cinta modeladora", "body modelador", "top tomara que caia",
      "moletom feminino", "jaqueta feminina", "plus size feminina",
      "tricot feminino", "wide leg", "jeans feminina", "bolsa feminina",
      "tiracolo", "tote", "carteira feminina", "meia calca", "camisa feminina",
      "blazer feminino", "kimono feminino", "cardigan", "top feminino",
      "calca flare", "calca pantalona", "pantalona feminina", "wide leg",
      "jardineira feminina", "mule feminino"
    ]
  }),

  regra(CATEGORIA.modaMasculina, {
    prioridade: 66,
    fortes: [
      "camisa polo", "camiseta masculina", "camisa masculina",
      "camisa social masculina", "moletom masculino", "jaqueta masculina",
      "calca jeans masculina", "bermuda masculina", "short masculino",
      "calca jogger masculina", "calca moletom masculina",
      "regata masculina", "cueca boxer", "cueca", "polo masculina", "moda masculina", "meia termica",
      "meia flanelada"
    ],
    palavras: [
      "kit camiseta masculina", "calca masculina", "calca sarja masculina", "kit bermudas masculinas", "bermudas masculinas", "polo masculina",
      "bermuda masculina", "shorts masculino", "camisa polo masculina",
      "calca moletom masculina", "camisa xadrez masculina", "blusa masculina",
      "casaco masculino", "colete masculino", "conjunto masculino",
      "terno masculino", "blazer masculino", "pijama masculino", "sunga",
      "carteira masculina", "cinto masculino", "meia masculina",
      "pares de meia", "pares de meias", "kit pares de meias", "kit meias"
    ]
  }),

  regra(CATEGORIA.esporte, {
    prioridade: 64,
    fortes: [
      "halter", "haltere", "kettlebell", "musculacao", "crossfit", "whey",
      "creatina", "pre treino", "albumina", "barra de proteina",
      "suplemento", "hipercalorico", "bcaa", "glutamina", "protein crush",
      "colageno", "colageno hidrolisado", "colagentek", "vitafor", "bike", "bicicleta",
      "esteira", "eliptico", "yoga", "pilates", "balanca bioimpedancia"
    ],
    palavras: [
      "faixa elastica", "short academia", "camiseta academia", "dry fit",
      "legging esportiva", "top esportivo", "bola de futebol", "luva academia",
      "corda de pular", "coqueteleira", "omega 3", "termogenico",
      "multivitaminico", "barra fixa", "roda abdominal", "hand grip",
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
      "motosserra", "eletrosserra", "serra de corte", "serra marmore",
      "serra ceramica", "serra granito", "ferramenta serralheiro"
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
      "serra para granito", "lishi", "chave lishi"
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
      "talheres", "copos", "jogo de copos", "marmitas", "potes",
      "cobertor", "manta", "toalha de banho", "colcha", "tapete",
      "bacia retratil", "tabua de corte", "pote vidro", "copo",
      "cortina", "almofada", "espelho", "sofa", "rack", "painel tv",
      "guarda roupa", "mesa", "cadeira", "penteadeira", "armario",
      "kit toalete", "toalete casamento", "jogo americano", "copo termico", "travesseiro", "lencol", "edredom", "fronha", "cuba", "louca", "pote", "fechadura inteligente",
      "cabide", "marmita", "tapete banheiro", "porta escova",
      "garrafa termica", "panos de copa", "pano de copa", "gabinete banheiro"
    ],
    palavras: [
      "cortador de legumes", "ralador", "assadeira", "garrafa termica",
      "garrafa termica inox", "garrafa termica cafe", "copo termico inox",
      "cadeira de escritorio", "escrivaninha", "nicho", "prateleira",
      "sapateira", "cabeceira", "poltrona", "estante", "aparador",
      "revestimento ripado", "autocolante", "alicate aplicador", "botao de pressao",
      "varal", "lixeira", "torneira", "banheiro", "cozinha", "organizador",
      "caixa organizadora", "escorredor", "misturador monocomando", "rede de dormir", "utensilios churrasco", "conjunto churrasco",
      "pote de vidro", "potes de vidro", "pote plastico", "pote hermetico", "porta escova banheiro", "organizador cozinha", "organizador banheiro", "jogo de cama", "roupa de cama", "cuba banheiro", "louca banheiro", "fechadura digital", "fechadura eletronica",
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
      "fio eletrico", "cabo eletrico"
    ],
    palavras: [
      "arandela", "trilho eletrificado", "perfil led", "fonte led",
      "driver led", "mangueira led", "pisca pisca", "luminaria solar",
      "painel solar", "fotocelula", "quadro distribuicao", "contator",
      "rele", "campainha", "canaleta eletrica", "adaptador tomada",
      "regua energia"
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
      "molinete", "vara de pesca", "carretilha", "anzol", "isca artificial",
      "linha de pesca", "pesca", "camping", "barraca", "saco de dormir",
      "fogareiro camping", "lanterna camping", "caixa termica"
    ],
    palavras: [
      "alicate de pesca", "colchonete", "mochila camping", "cooler",
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
      "pulverizador automotivo", "chave de roda", "palheta limpador",
      "oleo motor", "rack teto", "bagageiro teto"
    ]
  }),

  regra(CATEGORIA.limpeza, {
    prioridade: 46,
    fortes: [
      "mop", "esfregao", "rodo", "vassoura", "multiuso", "desinfetante",
      "detergente", "desengordurante", "amaciante", "sabao liquido",
      "sabao em po", "lava roupas", "tira manchas", "alvejante",
      "agua sanitaria", "limpa vidro", "limpa piso", "papel higienico",
      "odorizante ambiente", "aromatizador ambiente", "coala odorizante"
    ],
    palavras: [
      "downy", "omo", "ype", "veja", "cloro", "removedor", "lustra moveis",
      "pano microfibra", "esponja limpeza", "kit limpeza", "refil mop"
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

function classificarCategoriaOferta(oferta = {}, termo = "") {
  const texto = textoOferta(oferta, termo);

  if (!texto) {
    return CATEGORIA.diversos;
  }

  const categoriaManual = categoriaDeclaradaValida(oferta);
  if (categoriaManual && !termo) {
    return categoriaManual;
  }

  const resultados = REGRAS
    .map((item) => pontuarRegra(texto, item))
    .filter(Boolean)
    .sort(desempatar);

  if (!resultados.length) {
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
  normalizarTextoLocal
};

