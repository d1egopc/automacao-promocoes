function normalizarAliasJidGerente(valor = "") {
  const texto = String(valor || "").trim();
  if (!texto) return "";
  const [usuario = "", dominio = ""] = texto.split("@");
  const usuarioBase = usuario.split(":")[0];
  return dominio ? `${usuarioBase}@${dominio}` : usuarioBase;
}

function coletarAliasesJidGerente(...valores) {
  return [...new Set(
    valores
      .map(normalizarAliasJidGerente)
      .filter(Boolean)
  )];
}

function aliasesBotGerente(sock = {}) {
  return coletarAliasesJidGerente(
    sock?.user?.id,
    sock?.user?.jid,
    sock?.user?.lid,
    sock?.authState?.creds?.me?.id,
    sock?.authState?.creds?.me?.jid,
    sock?.authState?.creds?.me?.lid
  );
}

function aliasesParticipanteGerente(participante = {}) {
  return coletarAliasesJidGerente(
    participante?.id,
    participante?.jid,
    participante?.lid,
    participante?.phoneNumber,
    participante?.phoneNumberJid
  );
}

function participanteAdminGerente(participante = {}) {
  const admin = String(participante?.admin || "").toLowerCase();
  return admin === "admin" || admin === "superadmin";
}

function participanteRepresentaBotGerente(participante = {}, aliasesBot = []) {
  const idsBot = new Set(aliasesBot);
  const campos = [
    ["id", participante?.id],
    ["jid", participante?.jid],
    ["lid", participante?.lid],
    ["phone", participante?.phoneNumber],
    ["phone", participante?.phoneNumberJid]
  ];

  for (const [tipo, valor] of campos) {
    const alias = normalizarAliasJidGerente(valor);
    if (alias && idsBot.has(alias)) return { match: true, tipoAliasMatch: tipo };
  }

  return { match: false, tipoAliasMatch: "" };
}

function resolverBotAdminGerente(sock, metadata = {}) {
  const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const aliasesBot = aliasesBotGerente(sock);

  for (const participante of participantes) {
    const match = participanteRepresentaBotGerente(participante, aliasesBot);
    if (!match.match) continue;
    return {
      botEncontrado: true,
      botAdmin: participanteAdminGerente(participante),
      tipoAliasMatch: match.tipoAliasMatch,
      adminTipo: String(participante?.admin || "")
    };
  }

  return {
    botEncontrado: false,
    botAdmin: false,
    tipoAliasMatch: "",
    adminTipo: ""
  };
}

module.exports = {
  normalizarAliasJidGerente,
  coletarAliasesJidGerente,
  aliasesBotGerente,
  aliasesParticipanteGerente,
  participanteRepresentaBotGerente,
  participanteAdminGerente,
  resolverBotAdminGerente
};
