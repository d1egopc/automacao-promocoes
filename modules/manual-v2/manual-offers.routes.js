const express = require("express");
const {
  importarUrlManualV2
} = require("./manual-import.adapters");
const storagePadrao = require("./manual-offers.storage");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function statusErro(e) {
  return e.statusCode || e.status || 500;
}

function payloadErro(e, fallback = "manual_v2_erro") {
  return {
    ok: false,
    erro: e.codigo || e.motivo || e.message || fallback,
    motivo: e.motivo || e.codigo || e.message || fallback
  };
}

function criarRotasManualV2(deps = {}) {
  const router = express.Router();
  const getClienteId = typeof deps.getClienteId === "function" ? deps.getClienteId : () => "admin";
  const importarManual = typeof deps.importarUrlManualV2 === "function" ? deps.importarUrlManualV2 : importarUrlManualV2;
  const storage = {
    listarOfertasManuaisV2: deps.listarOfertasManuaisV2 || storagePadrao.listarOfertasManuaisV2,
    criarOfertaManualV2: deps.criarOfertaManualV2 || storagePadrao.criarOfertaManualV2,
    atualizarOfertaManualV2: deps.atualizarOfertaManualV2 || storagePadrao.atualizarOfertaManualV2,
    excluirOfertaManualV2: deps.excluirOfertaManualV2 || storagePadrao.excluirOfertaManualV2
  };

  function cliente(req) {
    return getClienteId(req) || "admin";
  }

  router.post("/importar", async (req, res) => {
    try {
      const clienteId = cliente(req);
      const urlOriginal = texto(req.body?.urlOriginal || req.body?.url);
      if (!urlOriginal) {
        return res.status(400).json({
          ok: false,
          erro: "url_original_obrigatoria",
          motivo: "url_original_obrigatoria"
        });
      }

      const oferta = await importarManual(urlOriginal, {
        ...(deps.importOptions || {}),
        clienteId
      });

      if (!oferta || oferta.ok === false) {
        return res.status(400).json({
          ok: false,
          erro: oferta?.erro || oferta?.motivo || "manual_v2_importacao_falhou",
          motivo: oferta?.motivo || oferta?.erro || "manual_v2_importacao_falhou",
          aviso: oferta?.aviso || ""
        });
      }

      return res.json({
        ok: true,
        oferta
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_importacao_falhou"));
    }
  });

  router.get("/ofertas", (req, res) => {
    try {
      const ofertas = storage.listarOfertasManuaisV2(cliente(req), deps.storageOptions || {});
      return res.json({
        ok: true,
        ofertas
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_listagem_falhou"));
    }
  });

  router.post("/ofertas", (req, res) => {
    try {
      const oferta = storage.criarOfertaManualV2(cliente(req), req.body?.oferta || req.body || {}, deps.storageOptions || {});
      return res.status(201).json({
        ok: true,
        oferta
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_criacao_falhou"));
    }
  });

  router.put("/ofertas/:id", (req, res) => {
    try {
      const oferta = storage.atualizarOfertaManualV2(cliente(req), req.params.id, req.body?.oferta || req.body || {}, deps.storageOptions || {});
      if (!oferta) {
        return res.status(404).json({
          ok: false,
          erro: "oferta_manual_v2_nao_encontrada",
          motivo: "oferta_manual_v2_nao_encontrada"
        });
      }

      return res.json({
        ok: true,
        oferta
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_atualizacao_falhou"));
    }
  });

  router.delete("/ofertas/:id", (req, res) => {
    try {
      const excluida = storage.excluirOfertaManualV2(cliente(req), req.params.id, deps.storageOptions || {});
      if (!excluida) {
        return res.status(404).json({
          ok: false,
          erro: "oferta_manual_v2_nao_encontrada",
          motivo: "oferta_manual_v2_nao_encontrada"
        });
      }

      return res.json({
        ok: true,
        excluida: true
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_exclusao_falhou"));
    }
  });

  return router;
}

module.exports = criarRotasManualV2;
