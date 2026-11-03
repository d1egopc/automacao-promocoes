"use strict";

async function listarUsuariosAdminSomenteLeitura({
  usuarios = [],
  mode,
  sanitizar,
  lerSaldo
} = {}) {
  if (!Array.isArray(usuarios)) throw new Error("admin_user_list_invalid");
  if (typeof sanitizar !== "function") {
    throw new Error("admin_user_sanitizer_required");
  }

  return Promise.all(usuarios.map(async usuario => {
    const seguro = sanitizar(usuario);
    if (mode === "UNIVERSAL" && usuario?.papel === "admin_master") {
      return { ...seguro, creditos: null };
    }
    if (mode === "LEGACY") {
      return { ...seguro, creditos: usuario?.creditos ?? null };
    }
    if (mode !== "UNIVERSAL") throw new Error("credit_mode_not_ready");
    if (typeof lerSaldo !== "function") {
      throw new Error("universal_credit_reader_required");
    }

    return { ...seguro, creditos: await lerSaldo(usuario.id, usuario) };
  }));
}

module.exports = { listarUsuariosAdminSomenteLeitura };
