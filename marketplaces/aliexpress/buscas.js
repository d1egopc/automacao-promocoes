// ================= BUSCAS ALIEXPRESS =================

function gerarBuscasAliExpress(deps = {}) {
  const { gerarBuscasGlobais } = deps;

const buscasBrasil = [
  // Hardware
  "ssd brasil",
  "ssd nvme brasil",
  "ssd sata brasil",
  "ssd 1tb brasil",
  "ssd 2tb brasil",
  "memoria ram ddr4 brasil",
  "memoria ram ddr5 brasil",
  "kit xeon brasil",
  "mini pc brasil",
  "placa mae brasil",
  "placa de video brasil",
  "rx 6600 brasil",
  "rx 7600 brasil",
  "rtx 4060 brasil",
  "fonte pc brasil",
  "water cooler brasil",

  // Periféricos
  "mouse gamer brasil",
  "teclado mecanico brasil",
  "headset gamer brasil",
  "microfone condensador brasil",
  "webcam full hd brasil",
  "mesa digitalizadora brasil",

  // Ferramentas
  "multimetro digital brasil",
  "multimetro profissional brasil",
  "alicate amperimetro brasil",
  "ferro de solda brasil",
  "estacao solda brasil",
  "parafusadeira brasil",
  "furadeira brasil",

  // Segurança
  "camera wifi brasil",
  "camera ip brasil",
  "video porteiro brasil",
  "alarme residencial brasil",

  // Mobile
  "smartwatch brasil",
  "fone bluetooth brasil",
  "carregador turbo brasil",
  "power bank brasil",

  // Pesca
  "carretilha pesca brasil",
  "vara pesca brasil",
  "molinete pesca brasil",

  // Casa
  "aspirador robo brasil",
  "mini projetor brasil",
  "luminaria led brasil",

  // Games
  "controle gamer brasil",
  "controle ps5 brasil",
  "controle xbox brasil"
];

const buscasInternacionais = [
  "ssd nvme",
  "ssd sata",
  "ssd 1tb",
  "ssd 2tb",
  "memoria ram ddr4",
  "memoria ram ddr5",
  "kit xeon",
  "mini pc",
  "placa mae",
  "placa de video",
  "rx 6600",
  "rx 7600",
  "rtx 4060",
  "fonte pc",
  "water cooler",

  "mouse gamer",
  "teclado mecanico",
  "headset gamer",
  "microfone condensador",
  "webcam full hd",

  "multimetro digital",
  "multimetro profissional",
  "alicate amperimetro",
  "ferro de solda",
  "estacao solda",
  "parafusadeira",
  "furadeira",

  "camera wifi",
  "camera ip",
  "video porteiro",

  "smartwatch",
  "fone bluetooth",
  "power bank",

  "carretilha pesca",
  "vara pesca",
  "molinete pesca",

  "aspirador robo",
  "mini projetor",

  "controle gamer",
  "controle ps5",
  "controle xbox"
];

  let globaisBrasil = [];

  if (typeof gerarBuscasGlobais === "function") {
    globaisBrasil = gerarBuscasGlobais(30)
      .map(t => `${t} brasil`);
  }

  return {
    brasil: [...new Set([...buscasBrasil, ...globaisBrasil])].slice(0, 60),
    internacional: [...new Set(buscasInternacionais)].slice(0, 40)
  };
}

module.exports = {
  gerarBuscasAliExpress
};
