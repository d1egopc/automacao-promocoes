// ================= BUSCAS AMAZON =================

function gerarBuscasAmazon(deps = {}) {

  const { gerarBuscasGlobais } = deps;

  const buscasBase = [
    "ssd",
    "ssd nvme",
    "mouse gamer",
    "teclado mecanico",
    "smartwatch",
    "fone bluetooth",
    "air fryer",
    "cafeteira",
    "perfume masculino",
    "perfume feminino"
  ];

  if (typeof gerarBuscasGlobais === "function") {
    const globais = gerarBuscasGlobais(30);

    return [
      ...new Set([
        ...buscasBase,
        ...globais
      ])
    ];
  }

  return buscasBase;
}

module.exports = {
  gerarBuscasAmazon
};
