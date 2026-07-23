function gerarLinkMagalu(linkOriginal, promoterId) {
  if (!linkOriginal || !promoterId) return linkOriginal;

  const urlLimpa = String(linkOriginal).trim();
  const loja = String(promoterId).trim();

  // Se jÃ¡ for link da loja do influenciador, mantÃ©m
  if (urlLimpa.includes("magazinevoce.com.br")) {
    return urlLimpa;
  }

  // Converte link comum do Magalu para link da loja
  return urlLimpa.replace(
    "https://www.magazineluiza.com.br",
    `https://www.magazinevoce.com.br/${loja}`
  );
}

module.exports = {
  gerarLinkMagalu
};
