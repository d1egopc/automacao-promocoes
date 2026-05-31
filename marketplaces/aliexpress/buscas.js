// ================= BUSCAS ALIEXPRESS =================

function gerarBuscasAliExpress(deps = {}) {
  const { gerarBuscasGlobais } = deps;

  const buscasBrasil = [
    "ssd brasil",
    "ssd nvme brasil",
    "ssd 1tb brasil",
    "ssd 2tb brasil",
    "memoria ram brasil",
    "placa de video brasil",
    "rx 6600 brasil",
    "rx 7600 brasil",
    "rtx 4060 brasil",
    "mini pc brasil",
    "kit xeon brasil",
    "mouse gamer brasil",
    "teclado mecanico brasil",
    "controle gamer brasil",
    "headset gamer brasil",
    "carretilha pesca brasil",
    "vara pesca brasil",
    "molinete pesca brasil",
    "blusa frio brasil",
    "jaqueta masculina brasil",
    "fone bluetooth brasil",
    "smartwatch brasil",
    "camera wifi brasil"
  ];

  const buscasInternacionais = [
    "ssd nvme",
    "ssd 1tb",
    "ssd 2tb",
    "memoria ram",
    "placa de video",
    "rx 6600",
    "rx 7600",
    "rtx 4060",
    "mini pc",
    "kit xeon",
    "mouse gamer",
    "teclado mecanico",
    "controle gamer",
    "headset gamer",
    "carretilha pesca",
    "vara pesca",
    "molinete pesca",
    "fone bluetooth",
    "smartwatch",
    "camera wifi"
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