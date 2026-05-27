// ================= BUSCAS ALIEXPRESS =================

function gerarBuscasAliExpress(deps = {}) {
  const { gerarBuscasGlobais } = deps;

  const buscasBase = [
    "produto no brasil",
    "estoque no brasil",
    "envio do brasil",
    "oferta aliexpress brasil",
    "cupom aliexpress",
    "fone bluetooth",
    "smartwatch",
    "mini pc",
    "ssd nvme",
    "controle gamer",
    "kit xeon",
    "mouse gamer",
    "teclado mecanico"
  ];

  if (typeof gerarBuscasGlobais === "function") {
    const globais = gerarBuscasGlobais(30);
    return [...new Set([...buscasBase, ...globais])].slice(0, 40);
  }

  return buscasBase;
}

module.exports = {
  gerarBuscasAliExpress
};