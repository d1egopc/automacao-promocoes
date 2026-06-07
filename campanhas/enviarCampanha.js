async function enviarCampanhaManual({
  clienteId,
  mensagem,
  imagemUrl = "",
  destinosIds = [],
  destinosPorCliente,
  sessoes,
  usuarioTemCreditos,
  debitarCreditos,
  corrigirImagemUrl
}) {
  if (!clienteId) {
    throw new Error("clienteId obrigatório");
  }

  if (!mensagem || !String(mensagem).trim()) {
    throw new Error("Mensagem obrigatória");
  }

  const destinosCliente =
    destinosPorCliente?.[clienteId] || [];

  const destinosSelecionados = destinosIds.length
    ? destinosCliente.filter(d => destinosIds.includes(d.id))
    : [];

  if (!destinosSelecionados.length) {
    throw new Error("Nenhum destino selecionado");
  }

  const resultado = {
    clienteId,
    totalDestinos: destinosSelecionados.length,
    enviados: 0,
    erros: 0,
    detalhes: []
  };

  for (const destino of destinosSelecionados) {
    try {
      if (String(destino.tipo || "").toLowerCase() !== "whatsapp") {
        resultado.detalhes.push({
          destino: destino.nome,
          tipo: destino.tipo,
          status: "ignorado",
          motivo: "Tipo ainda não suportado nesta fase"
        });
        continue;
      }

      const sock = sessoes[destino.conexaoId];

      if (!sock) {
        resultado.erros++;
        resultado.detalhes.push({
          destino: destino.nome,
          tipo: "whatsapp",
          status: "erro",
          motivo: "Sessão não encontrada"
        });
        continue;
      }

      const grupos = destino.gruposWhatsapp || [];

      if (!grupos.length) {
        resultado.erros++;
        resultado.detalhes.push({
          destino: destino.nome,
          tipo: "whatsapp",
          status: "erro",
          motivo: "Destino sem grupos"
        });
        continue;
      }

      for (const grupo of grupos) {
        if (!usuarioTemCreditos(clienteId, 1)) {
          resultado.erros++;
          resultado.detalhes.push({
            destino: destino.nome,
            grupo,
            status: "erro",
            motivo: "Sem créditos"
          });
          continue;
        }

        if (imagemUrl) {
          await sock.sendMessage(grupo, {
            image: {
              url: corrigirImagemUrl(imagemUrl) || imagemUrl
            },
            caption: mensagem
          });
        } else {
          await sock.sendMessage(grupo, {
            text: mensagem
          });
        }

        debitarCreditos(clienteId, 1);

        resultado.enviados++;

        resultado.detalhes.push({
          destino: destino.nome,
          grupo,
          status: "enviado",
          creditos: 1
        });

        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) {
      resultado.erros++;
      resultado.detalhes.push({
        destino: destino.nome,
        status: "erro",
        motivo: e.message
      });
    }
  }

  return resultado;
}

module.exports = {
  enviarCampanhaManual
};