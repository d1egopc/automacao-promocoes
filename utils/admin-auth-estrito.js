"use strict";

function criarAdminMasterEstrito({
  jwt,
  getJwtSecret,
  getUsuarios,
  usuarioEhAdminMaster
} = {}) {
  if (!jwt || typeof jwt.verify !== "function") {
    throw new Error("jwt_obrigatorio");
  }
  if (typeof getJwtSecret !== "function") {
    throw new Error("getJwtSecret_obrigatorio");
  }
  if (typeof getUsuarios !== "function") {
    throw new Error("getUsuarios_obrigatorio");
  }
  if (typeof usuarioEhAdminMaster !== "function") {
    throw new Error("usuarioEhAdminMaster_obrigatorio");
  }

  return function exigirAdminMasterEstrito(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return res.status(401).json({
        ok: false,
        erro: "Token obrigatorio"
      });
    }

    try {
      const decoded = jwt.verify(token, getJwtSecret());
      const clienteId = String(decoded?.clienteId || "").trim();

      if (!clienteId) {
        return res.status(401).json({
          ok: false,
          erro: "Token invalido"
        });
      }

      const usuarios = getUsuarios() || [];
      const usuario = usuarios.find(u => String(u.id) === clienteId);

      if (!usuario || usuario.ativo === false) {
        return res.status(401).json({
          ok: false,
          erro: "Usuario nao existe ou foi desativado"
        });
      }

      req.usuario = usuario;
      req.clienteId = clienteId;

      if (!usuarioEhAdminMaster(usuario)) {
        return res.status(403).json({
          ok: false,
          erro: "Acesso restrito ao Admin Master"
        });
      }

      return next();
    } catch {
      return res.status(401).json({
        ok: false,
        erro: "Token invalido"
      });
    }
  };
}

module.exports = {
  criarAdminMasterEstrito
};
