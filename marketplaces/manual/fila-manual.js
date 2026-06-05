const {
  normalizarOfertaManual,
  agoraBR
} = require("./normalizar-oferta");

function ofertaJaExisteNaFila(fila = [], oferta = {}, clienteId = "admin", normalizarTexto) {
  const normalizar =
    typeof normalizarTexto === "function"
      ? normalizarTexto
      : (t) => String(t || "").toLowerCase().trim();

  return fila.some(o =>
    String(o.clienteId || "admin") === String(clienteId) &&
    (
      String(o.linkOriginal || o.link || o.linkAfiliado || "") ===
      String(oferta.linkOriginal || oferta.link || oferta.linkAfiliado || "") ||
      normalizar(o.titulo || o.nome || "") ===
      normalizar(oferta.titulo || oferta.nome || "")
    )
  );
}

function adicionarManualNaFila(body = {}, deps = {}) {
  const {
    fila,
    clienteId = "admin",
    salvarFila,
    classificarCategoriaOferta,
    normalizarTexto,
    deveIgnorarOfertaRepetida,
    registrarOfertaVista,
    prepararOfertaGlobal
  } = deps;

  let oferta = normalizarOfertaManual(body, {
    clienteId,
    classificarCategoriaOferta
  });

  oferta.status = "pendente";
  oferta.statusDetalhe = "Na fila";
  oferta.dataEntradaFila = agoraBR();

  if (typeof prepararOfertaGlobal === "function") {
    oferta = prepararOfertaGlobal(oferta);
  }

  if (ofertaJaExisteNaFila(fila, oferta, clienteId, normalizarTexto)) {
    return {
      ok: true,
      ignorada: true,
      motivo: "Essa oferta já está salva ou já está na fila.",
      oferta
    };
  }

  if (
    typeof deveIgnorarOfertaRepetida === "function" &&
    deveIgnorarOfertaRepetida(oferta)
  ) {
    return {
      ok: true,
      ignorada: true,
      motivo: "Oferta repetida recentemente sem queda relevante de preço ou cupom novo.",
      oferta
    };
  }

  if (typeof registrarOfertaVista === "function") {
    registrarOfertaVista(oferta);
  }

  fila.unshift(oferta);

  if (typeof salvarFila === "function") {
    salvarFila(clienteId);
  }

  return {
    ok: true,
    mensagem: "Oferta adicionada à fila",
    oferta
  };
}

module.exports = {
  ofertaJaExisteNaFila,
  adicionarManualNaFila
};