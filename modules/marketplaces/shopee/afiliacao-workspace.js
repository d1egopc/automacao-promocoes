const crypto = require("crypto");

function texto(valor = "") {
  return String(valor || "").trim();
}

function appIdShopee(credenciais = {}) {
  return texto(credenciais.appId || credenciais.app_id);
}

function afiliadoDetectadoShopee(url = "") {
  try {
    const parsed = new URL(texto(url));
    return texto(parsed.searchParams.get("mmp_pid") || parsed.searchParams.get("utm_source"));
  } catch (_) {
    return texto(texto(url).match(/(?:mmp_pid|utm_source)=((?:an_)?\d+)/i)?.[1]);
  }
}

function segredoAssinaturaShopee(credenciais = {}) {
  return texto(credenciais.secret || credenciais.appSecret || credenciais.app_secret);
}

function payloadAssinaturaShopee(prova = {}) {
  return JSON.stringify({
    marketplace: texto(prova.marketplace),
    workspaceId: texto(prova.workspaceId),
    appId: texto(prova.appId),
    affiliateIdEsperado: texto(prova.affiliateIdEsperado),
    affiliateIdDetectado: texto(prova.affiliateIdDetectado),
    papel: texto(prova.papel),
    urlOriginal: texto(prova.urlOriginal),
    urlAfiliadaWorkspace: texto(prova.urlAfiliadaWorkspace),
    urlFinalPublicada: texto(prova.urlFinalPublicada),
    urlFinalExpandida: texto(prova.urlFinalExpandida),
    origemConversao: texto(prova.origemConversao),
    conversaoStatus: texto(prova.conversaoStatus),
    motivoConversao: texto(prova.motivoConversao)
  });
}

function assinarProvaShopee(prova = {}, credenciais = {}) {
  const segredo = segredoAssinaturaShopee(credenciais);
  if (!segredo) return "";
  return crypto.createHmac("sha256", segredo).update(payloadAssinaturaShopee(prova), "utf8").digest("hex");
}

function assinaturaProvaShopeeValida(prova = {}, credenciais = {}) {
  const recebida = texto(prova.assinatura);
  const esperada = assinarProvaShopee(prova, credenciais);
  if (!/^[a-f0-9]{64}$/i.test(recebida) || !esperada) return false;
  return crypto.timingSafeEqual(Buffer.from(recebida, "hex"), Buffer.from(esperada, "hex"));
}

function criarProvaAfiliacaoWorkspaceShopee({ clienteId = "", credenciais = {}, urlOriginal = "", urlAfiliadaWorkspace = "", urlFinalExpandida = "", papel = "produto", motivoConversao = "" } = {}) {
  const appId = appIdShopee(credenciais);
  const affiliateIdEsperado = appId ? `an_${appId}` : "";
  const affiliateIdDetectado = afiliadoDetectadoShopee(urlFinalExpandida || urlAfiliadaWorkspace);
  const ownershipConfirmado = Boolean(affiliateIdDetectado && affiliateIdEsperado && affiliateIdDetectado === affiliateIdEsperado);
  const urlAfiliada = texto(urlAfiliadaWorkspace);
  const prova = {
    marketplace: "shopee", workspaceId: texto(clienteId), appId, affiliateIdEsperado, affiliateIdDetectado,
    papel: texto(papel) || "produto", urlOriginal: texto(urlOriginal),
    urlAfiliadaWorkspace: urlAfiliada, urlFinalPublicada: urlAfiliada, urlFinalExpandida: texto(urlFinalExpandida),
    origemConversao: "workspace_api",
    conversaoStatus: urlAfiliada && ownershipConfirmado ? "convertida" : "falhou",
    motivoConversao: !urlAfiliada
      ? (motivoConversao || "link_shopee_sem_conversao_workspace")
      : (!affiliateIdDetectado
        ? "afiliacao_workspace_nao_confirmada"
        : (!ownershipConfirmado ? "afiliacao_workspace_divergente" : (motivoConversao || "link_shopee_convertido_workspace")))
  };
  return { ...prova, assinatura: assinarProvaShopee(prova, credenciais) };
}

function validarProvaAfiliacaoWorkspaceShopee(prova = {}, { clienteId = "", credenciais = {}, exigirAssinatura = false } = {}) {
  const appId = appIdShopee(credenciais);
  const esperado = appId ? `an_${appId}` : "";
  const detectado = texto(prova.affiliateIdDetectado || afiliadoDetectadoShopee(prova.urlFinalExpandida || prova.urlAfiliadaWorkspace));
  return {
    valida: Boolean(texto(clienteId) && prova.marketplace === "shopee" && prova.workspaceId === texto(clienteId) && prova.appId === appId && prova.origemConversao === "workspace_api" && prova.conversaoStatus === "convertida" && texto(prova.urlAfiliadaWorkspace) && texto(prova.urlFinalPublicada) && detectado && detectado === esperado && assinaturaProvaShopeeValida(prova, credenciais)),
    prova: { ...prova, affiliateIdEsperado: esperado, affiliateIdDetectado: detectado }
  };
}

function vincularUrlFinalPublicadaShopee(prova = {}, { clienteId = "", credenciais = {}, urlAtual = "", urlFinal = "" } = {}) {
  if (!texto(urlFinal) || texto(prova.urlFinalPublicada) !== texto(urlAtual) ||
      !validarProvaAfiliacaoWorkspaceShopee(prova, { clienteId, credenciais, exigirAssinatura: true }).valida) return null;
  const vinculada = { ...prova, urlFinalPublicada: texto(urlFinal) };
  return { ...vinculada, assinatura: assinarProvaShopee(vinculada, credenciais) };
}

function validarOfertaAfiliacaoWorkspaceShopee(oferta = {}, { clienteId = "", credenciais = {}, exigirAssinatura = false } = {}) {
  if (texto(oferta.marketplace || oferta.mercado).toLowerCase() !== "shopee") return { ok: true, motivo: "nao_aplicavel" };
  const metadata = oferta.metadata || {};
  const provaVerificada = metadata.afiliacaoWorkspaceVerificada || oferta.afiliacaoWorkspaceVerificada || {};
  const principal = validarProvaAfiliacaoWorkspaceShopee(
    exigirAssinatura ? (provaVerificada.principal || provaVerificada) : (metadata.afiliacaoWorkspace || oferta.afiliacaoWorkspace || {}),
    { clienteId, credenciais, exigirAssinatura }
  );
  if (!principal.valida) return { ok: false, motivo: "afiliacao_workspace_incompleta", papel: "principal", prova: principal.prova };
  const links = [...(Array.isArray(metadata.linksComerciais) ? metadata.linksComerciais : (Array.isArray(oferta.linksComerciais) ? oferta.linksComerciais : (Array.isArray(metadata.linksClassificados) ? metadata.linksClassificados : [])))];
  if (exigirAssinatura) {
    for (const [papel, urlAfiliada] of [["app", oferta.linkApp], ["pc", oferta.linkPC], ["moedas", oferta.linkMoedas], ["resgate", oferta.linkResgate]]) {
      if (texto(urlAfiliada)) links.push({ papel, urlAfiliada });
    }
  }
  const provasLinksVerificadas = Array.isArray(provaVerificada.links) ? provaVerificada.links : [];
  for (const link of links) {
    if (link.renderizavel === false) continue;
    const papel = texto(link.papel || link.papelLink || link.tipo);
    if (!["produto", "resgate", "link_produto", "link_resgate", "link_cupom", "app", "pc", "cupom"].includes(papel)) continue;
    const candidata = exigirAssinatura
      ? provasLinksVerificadas.find((item) => texto(item?.papel) === papel && texto(item?.urlAfiliadaWorkspace) === texto(link.urlAfiliada || link.linkAfiliado || link.url || link.href)) || {}
      : (link.afiliacaoWorkspace || link.conversaoWorkspace || {});
    const prova = validarProvaAfiliacaoWorkspaceShopee(candidata, { clienteId, credenciais, exigirAssinatura });
    if (!prova.valida) return { ok: false, motivo: "afiliacao_workspace_incompleta", papel, prova: prova.prova };
  }
  return { ok: true, motivo: "afiliacao_workspace_convertida", prova: principal.prova };
}

module.exports = { appIdShopee, afiliadoDetectadoShopee, criarProvaAfiliacaoWorkspaceShopee, validarProvaAfiliacaoWorkspaceShopee, validarOfertaAfiliacaoWorkspaceShopee, assinaturaProvaShopeeValida, vincularUrlFinalPublicadaShopee };
