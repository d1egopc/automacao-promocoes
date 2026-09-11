async function detectarOportunidade() {
  // Não há fonte pública estável homologada nesta V1; nunca inventa sinal.
  return null;
}

module.exports = {
  marketplace: "aliexpress",
  ttlMs: 7 * 60 * 1000,
  detectarOportunidade
};
