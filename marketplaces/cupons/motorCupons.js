const { CUPONS_ATIVOS } =
require("./cuponsAtivos");

// ================= HELPERS =================

function normalizarCupomTexto(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function cupomEstaValido(cupom) {
  if (!cupom?.ativo) {
    return false;
  }

  if (!cupom.validade) {
    return true;
  }

  const hoje = new Date();

  const validade = new Date(
    cupom.validade + "T23:59:59"
  );

  return validade >= hoje;
}

// ================= MOTOR =================

function escolherMelhorCupom({
  marketplace = "",
  titulo = "",
  categoria = ""
}) {

  const mp =
    normalizarCupomTexto(marketplace);

  const tituloNorm =
    normalizarCupomTexto(titulo);

  const categoriaNorm =
    normalizarCupomTexto(categoria);

  const candidatos =
    CUPONS_ATIVOS
      .filter(cupomEstaValido)
      .filter(c =>
        normalizarCupomTexto(
          c.marketplace
        ) === mp
      )
      .filter(c => {

        const bateCategoria =
          (c.categorias || []).some(cat =>
            categoriaNorm.includes(
              normalizarCupomTexto(cat)
            )
          );

        const batePalavra =
          (c.palavras || []).some(p =>
            tituloNorm.includes(
              normalizarCupomTexto(p)
            )
          );

        return (
          bateCategoria ||
          batePalavra
        );
      })
      .sort(
        (a, b) =>
          (b.prioridade || 0) -
          (a.prioridade || 0)
      );

  return candidatos[0] || null;
}

module.exports = {
  escolherMelhorCupom,
  cupomEstaValido
};