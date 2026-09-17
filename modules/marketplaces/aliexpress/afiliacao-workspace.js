const crypto = require("crypto");

function texto(valor = "") {
  return String(valor || "").trim();
}

function segredoAssinaturaAliExpress(credenciais = {}) {
  return texto(credenciais.secret || credenciais.appSecret);
}

function payloadAssinaturaAliExpress(prova = {}) {
  return JSON.stringify({
    workspaceId: texto(prova.workspaceId),
    appKey: texto(prova.appKey),
    trackingIdEnviado: texto(prova.trackingIdEnviado),
    papel: texto(prova.papel),
    urlOriginal: texto(prova.urlOriginal),
    urlAfiliadaWorkspace: texto(prova.urlAfiliadaWorkspace),
    origemConversao: texto(prova.origemConversao),
    conversaoStatus: texto(prova.conversaoStatus),
    motivoConversao: texto(prova.motivoConversao)
  });
}

function assinarProvaAliExpress(prova = {}, credenciais = {}) {
  const segredo = segredoAssinaturaAliExpress(credenciais);
  if (!segredo) return "";
  return crypto.createHmac("sha256", segredo).update(payloadAssinaturaAliExpress(prova), "utf8").digest("hex");
}

function assinaturaProvaAliExpressValida(prova = {}, credenciais = {}) {
  const recebida = texto(prova.assinatura);
  const esperada = assinarProvaAliExpress(prova, credenciais);
  if (!recebida || !esperada || recebida.length !== esperada.length) return false;
  return crypto.timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada));
}

function criarProvaAfiliacaoWorkspaceAliExpress({ clienteId = "", credenciais = {}, urlOriginal = "", urlAfiliadaWorkspace = "", papel = "produto", conversaoStatus = "falhou", motivoConversao = "" } = {}) {
  const prova = {
    workspaceId: texto(clienteId),
    appKey: texto(credenciais.appKey),
    trackingIdEnviado: texto(credenciais.trackingId),
    papel: texto(papel) || "produto",
    urlOriginal: texto(urlOriginal),
    urlAfiliadaWorkspace: texto(urlAfiliadaWorkspace),
    origemConversao: "workspace_api",
    conversaoStatus: texto(conversaoStatus) || "falhou",
    motivoConversao: texto(motivoConversao)
  };
  return { ...prova, assinatura: assinarProvaAliExpress(prova, credenciais) };
}

function papelExigeAfiliacaoWorkspaceAliExpress(papel = "") {
  return [
    "produto",
    "link_produto",
    "link_app",
    "link_pc",
    "link_moedas",
    "link_resgate",
    "link_cupom",
    "app",
    "pc",
    "moedas",
    "resgate",
    "cupom"
  ].includes(texto(papel));
}

function validarProvaAfiliacaoWorkspaceAliExpress(prova = {}, {
  clienteId = "",
  credenciais = {},
  exigirAssinatura = false
} = {}) {
  const appKey = texto(credenciais.appKey);
  const trackingId = texto(credenciais.trackingId);
  const urlAfiliadaWorkspace = texto(prova.urlAfiliadaWorkspace);
  const valida = Boolean(
    texto(clienteId) &&
    prova.workspaceId === clienteId &&
    prova.appKey === appKey &&
    prova.trackingIdEnviado === trackingId &&
    prova.origemConversao === "workspace_api" &&
    prova.conversaoStatus === "convertida" &&
    urlAfiliadaWorkspace &&
    (!exigirAssinatura || assinaturaProvaAliExpressValida(prova, credenciais))
  );

  return {
    valida,
    prova: { ...prova, urlAfiliadaWorkspace }
  };
}

function validarOfertaAfiliacaoWorkspaceAliExpress(oferta = {}, {
  clienteId = "",
  credenciais = {},
  exigirAssinatura = false
} = {}) {
  const marketplace = texto(oferta.marketplace || oferta.mercado).toLowerCase();
  if (marketplace !== "aliexpress") return { ok: true, motivo: "nao_aplicavel" };

  const metadata = oferta.metadata || {};
  const provaVerificada = metadata.afiliacaoWorkspaceVerificada || oferta.afiliacaoWorkspaceVerificada || {};
  const principal = validarProvaAfiliacaoWorkspaceAliExpress(
    exigirAssinatura ? (provaVerificada.principal || provaVerificada) : (metadata.afiliacaoWorkspace || {}),
    { clienteId, credenciais, exigirAssinatura }
  );
  if (!principal.valida) {
    return { ok: false, motivo: "afiliacao_workspace_incompleta", papel: "principal" };
  }

  const links = [...(Array.isArray(metadata.linksClassificados)
    ? metadata.linksClassificados
    : (Array.isArray(oferta.linksComerciais) ? oferta.linksComerciais : []))];
  if (exigirAssinatura) {
    for (const [papelLink, urlAfiliada] of [["link_app", oferta.linkApp], ["link_pc", oferta.linkPC], ["link_moedas", oferta.linkMoedas], ["link_resgate", oferta.linkResgate]]) {
      if (texto(urlAfiliada)) links.push({ papelLink, urlAfiliada });
    }
  }
  const provasLinksVerificadas = Array.isArray(provaVerificada.links) ? provaVerificada.links : [];
  for (const link of links) {
    const papel = texto(link.papelLink || link.tipo);
    if (link.renderizavel === false) continue;
    if (!papelExigeAfiliacaoWorkspaceAliExpress(papel)) continue;
    const prova = validarProvaAfiliacaoWorkspaceAliExpress(
      exigirAssinatura
        ? provasLinksVerificadas.find((item) => texto(item?.papel) === papel && texto(item?.urlAfiliadaWorkspace) === texto(link.urlAfiliada || link.linkAfiliado || link.url || link.href)) || {}
        : (link.conversaoWorkspace || link.afiliacaoWorkspace || {}),
      { clienteId, credenciais, exigirAssinatura }
    );
    if (!prova.valida) {
      return { ok: false, motivo: "afiliacao_workspace_incompleta", papel };
    }
  }

  return { ok: true, motivo: "afiliacao_workspace_convertida" };
}

module.exports = {
  papelExigeAfiliacaoWorkspaceAliExpress,
  criarProvaAfiliacaoWorkspaceAliExpress,
  validarProvaAfiliacaoWorkspaceAliExpress,
  validarOfertaAfiliacaoWorkspaceAliExpress,
  assinaturaProvaAliExpressValida
};
