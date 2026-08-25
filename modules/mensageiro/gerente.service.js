const {
  getMensageiroCliente,
  resolverPerfilMensageiro,
  registrarHistoricoAtendimento,
  registrarInfracaoGerente,
  atualizarInfracaoGerenteCliente,
  registrarUltimoMotivoGerente,
  referenciaGrupoGerente
} = require("./storage");
const {
  usuarioAtivo,
  logUsuarioInativoIgnorado
} = require("../../utils/usuarios-atividade");
const { agendarExclusaoMensagemTemporaria } = require("./service");
const { resolverBotAdminGerente } = require("./gerente-identidade");

const JANELAS_GERENTE_MS = 10 * 60 * 1000;
const resultadosMensagemGerente = new Map();
const janelasGerente = new Map();

function limparMapRecente(map, ttlMs = JANELAS_GERENTE_MS) {
  const agora = Date.now();
  for (const [chave, item] of map.entries()) {
    const ts = Array.isArray(item)
      ? Math.max(0, ...item.map(registro => Number(registro?.ts || 0) || 0))
      : typeof item === "number"
        ? item
        : Number(item?.ts || item?.ultima || 0) || 0;
    if (agora - ts > ttlMs) map.delete(chave);
  }
}

function normalizarJid(valor = "") {
  return String(valor || "").trim();
}

function jidGrupo(valor = "") {
  return normalizarJid(valor).endsWith("@g.us");
}

function principalJid(valor = "") {
  const jid = normalizarJid(valor);
  const [usuario, sufixo = ""] = jid.split("@");
  const principal = usuario.split(":")[0];
  return sufixo ? `${principal}@${sufixo}` : principal;
}

function jidEquivalente(a = "", b = "") {
  const jidA = normalizarJid(a);
  const jidB = normalizarJid(b);
  return Boolean(jidA && jidB && (jidA === jidB || principalJid(jidA) === principalJid(jidB)));
}

function normalizarTexto(texto = "") {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extrairTextoMensagem(mensagem = {}) {
  const conteudo = mensagem.message || {};
  return (
    conteudo.conversation ||
    conteudo.extendedTextMessage?.text ||
    conteudo.imageMessage?.caption ||
    conteudo.videoMessage?.caption ||
    conteudo.buttonsResponseMessage?.selectedDisplayText ||
    conteudo.listResponseMessage?.title ||
    ""
  );
}

function extrairTipoMidia(mensagem = {}) {
  const conteudo = mensagem.message || {};
  if (conteudo.imageMessage) return "imagem";
  if (conteudo.videoMessage) return "video";
  if (conteudo.audioMessage) return "audio";
  if (conteudo.documentMessage) return "documento";
  if (conteudo.stickerMessage) return "sticker";
  return "";
}

function extrairParticipante(mensagem = {}) {
  return normalizarJid(
    mensagem?.key?.participant ||
    mensagem?.participant ||
    mensagem?.key?.senderPn ||
    mensagem?.senderPn ||
    ""
  );
}

function nomeParticipante(participante = "", mensagem = {}) {
  const nome = String(mensagem?.pushName || mensagem?.verifiedBizName || "").trim();
  return nome || String(participante || "").split("@")[0] || "Participante";
}

function extrairUrls(texto = "") {
  const fonte = String(texto || "");
  const matches = fonte.match(/https?:\/\/[^\s<>"']+|www\.[a-z0-9.-]+\.[a-z]{2,}[^\s<>"']*/gi) || [];
  return matches.map(url => url.replace(/[),.;]+$/g, ""));
}

function extrairConvitesWhatsapp(texto = "") {
  const fonte = String(texto || "");
  const matches = fonte.match(/(?:https?:\/\/)?(?:chat\.whatsapp\.com|wa\.me\/(?:invite|join)|whatsapp\.com\/channel)\/[a-z0-9_-]+/gi) || [];
  return matches.map(url => url.replace(/[),.;]+$/g, ""));
}

function dominioUrl(url = "") {
  try {
    const urlFinal = String(url || "").startsWith("http")
      ? String(url)
      : `https://${String(url || "")}`;
    return new URL(urlFinal).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function dominioPermitido(dominio = "", permitidos = []) {
  if (!dominio) return false;
  return (Array.isArray(permitidos) ? permitidos : []).some(item => {
    const permitido = String(item || "").replace(/^www\./, "").toLowerCase();
    return permitido && (dominio === permitido || dominio.endsWith(`.${permitido}`));
  });
}

function contemPalavraDeterministica(textoNormalizado = "", palavras = []) {
  if (!textoNormalizado || !Array.isArray(palavras) || !palavras.length) return "";
  for (const palavra of palavras) {
    const termo = normalizarTexto(palavra);
    if (!termo) continue;
    if (termo.includes(" ")) {
      if (textoNormalizado.includes(termo)) return palavra;
      continue;
    }
    const seguro = termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9_])${seguro}([^a-z0-9_]|$)`, "i");
    if (re.test(textoNormalizado)) return palavra;
  }
  return "";
}

function chaveJanela({ clienteId, perfilId, sessaoId, grupoId, participante, regraId, escopo }) {
  return `gerente:${escopo}:${clienteId}:${perfilId}:${sessaoId}:${grupoId}:${participante}:${regraId}`;
}

function registrarJanela(chave, item, janelaMs) {
  const agora = Date.now();
  const atual = janelasGerente.get(chave) || [];
  const limpa = atual.filter(registro => agora - registro.ts <= janelaMs);
  limpa.push({ ...item, ts: agora });
  janelasGerente.set(chave, limpa);
  return limpa;
}

function regraAtiva(regra = {}) {
  return regra?.ativo === true && regra?.tipo && regra?.id;
}

function avaliarRegraDeterministica({ regra, texto, textoNormalizado, tipoMidia, contexto }) {
  const parametros = regra.parametros || {};

  if (regra.tipo === "palavras_proibidas" || regra.tipo === "palavroes") {
    const termo = contemPalavraDeterministica(textoNormalizado, parametros.palavras);
    return termo
      ? { violada: true, motivo: regra.tipo === "palavroes" ? "palavra personalizada nao permitida" : "palavra proibida", evidencia: String(termo).slice(0, 80) }
      : { violada: false };
  }

  if (regra.tipo === "convite_whatsapp") {
    const convites = extrairConvitesWhatsapp(texto);
    return convites.length
      ? { violada: true, motivo: "convite de grupo WhatsApp nao permitido", evidencia: convites[0] }
      : { violada: false };
  }

  if (regra.tipo === "links_externos") {
    const urls = extrairUrls(texto);
    const externo = urls.find(url => !dominioPermitido(dominioUrl(url), parametros.dominiosPermitidos));
    return externo
      ? { violada: true, motivo: "link externo nao permitido", evidencia: externo }
      : { violada: false };
  }

  if (regra.tipo === "divulgacao") {
    const termo = contemPalavraDeterministica(textoNormalizado, parametros.palavras);
    const convites = extrairConvitesWhatsapp(texto);
    const urls = extrairUrls(texto).filter(url => !dominioPermitido(dominioUrl(url), parametros.dominiosPermitidos));
    if (termo) return { violada: true, motivo: "divulgacao nao permitida", evidencia: String(termo).slice(0, 80) };
    if (convites.length) return { violada: true, motivo: "divulgacao de grupo nao permitida", evidencia: convites[0] };
    if (urls.length) return { violada: true, motivo: "divulgacao por link nao permitida", evidencia: urls[0] };
    return { violada: false };
  }

  if (regra.tipo === "midia_bloqueada") {
    const tipos = Array.isArray(parametros.tiposMidia) ? parametros.tiposMidia : [];
    return tipoMidia && tipos.includes(tipoMidia)
      ? { violada: true, motivo: `${tipoMidia} nao permitida`, evidencia: tipoMidia }
      : { violada: false };
  }

  if (regra.tipo === "flood" || regra.tipo === "excesso_mensagens") {
    const janelaMs = Math.max(3, Number(parametros.janelaSegundos || 10) || 10) * 1000;
    const limite = Math.max(2, Number(parametros.maxMensagens || 5) || 5);
    const chave = chaveJanela({ ...contexto, regraId: regra.id, escopo: "flood" });
    const janela = registrarJanela(chave, { messageId: contexto.messageId }, janelaMs);
    return janela.length > limite
      ? { violada: true, motivo: "excesso de mensagens em curto periodo", evidencia: `${janela.length}/${limite}` }
      : { violada: false };
  }

  if (regra.tipo === "repeticao") {
    if (!textoNormalizado || textoNormalizado.length < Math.max(1, Number(parametros.minCaracteres || 8) || 8)) {
      return { violada: false };
    }
    const janelaMs = Math.max(3, Number(parametros.janelaSegundos || 30) || 30) * 1000;
    const limite = Math.max(2, Number(parametros.repeticoes || 3) || 3);
    const chave = chaveJanela({ ...contexto, regraId: regra.id, escopo: `repeticao:${textoNormalizado}` });
    const janela = registrarJanela(chave, { messageId: contexto.messageId }, janelaMs);
    return janela.length >= limite
      ? { violada: true, motivo: "mensagem repetida", evidencia: `${janela.length}/${limite}` }
      : { violada: false };
  }

  return { violada: false };
}

function encontrarViolacaoDeterministica({ regras, texto, tipoMidia, contexto }) {
  const textoNormalizado = normalizarTexto(texto);
  for (const regra of regras) {
    if (!regraAtiva(regra)) continue;
    const resultado = avaliarRegraDeterministica({
      regra,
      texto,
      textoNormalizado,
      tipoMidia,
      contexto
    });
    if (resultado?.violada === true) {
      return { regra, ...resultado };
    }
  }
  return null;
}

async function obterPermissoesGrupo({ sock, grupoId, participante }) {
  if (!sock || typeof sock.groupMetadata !== "function") {
    return { ok: false, codigo: "metadata_indisponivel" };
  }

  const metadata = await sock.groupMetadata(grupoId);
  const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const bot = resolverBotAdminGerente(sock, metadata);
  const alvo = participantes.find(item => jidEquivalente(item?.id, participante));

  if (!bot.botEncontrado || !alvo) return { ok: false, codigo: "participante_nao_confirmado" };

  return {
    ok: true,
    botAdmin: bot.botAdmin,
    alvoAdmin: alvo.admin === "admin" || alvo.admin === "superadmin",
    alvoDono: alvo.admin === "superadmin",
    botAdminTipo: bot.adminTipo || "",
    alvoAdminTipo: alvo.admin || ""
  };
}

function participanteNaLista(participante = "", lista = []) {
  return (Array.isArray(lista) ? lista : []).some(item =>
    jidEquivalente(item, participante) ||
    String(item || "") === String(participante || "").split("@")[0]
  );
}

function participanteIsento({ participante, permissao, configuracao }) {
  if (configuracao.isentarDono !== false && permissao.alvoDono) return "dono";
  if (configuracao.isentarAdmins !== false && permissao.alvoAdmin) return "admin";
  if (participanteNaLista(participante, configuracao.autorizados)) return "autorizado";
  if (participanteNaLista(participante, configuracao.moderadores)) return "moderador";
  return "";
}

function formatarAviso({ regra, participante, nome, motivo, contador = 1, limite = 1 }) {
  const numero = String(participante || "").split("@")[0];
  const textoCustom = String(regra.avisoTexto || "").trim();
  const base = textoCustom || "⚠️ @{numero}, sua mensagem foi removida.\nMotivo: {motivo}.\nAviso {contador} de {limite}.";
  return base
    .replaceAll("{numero}", numero)
    .replaceAll("{participante}", nome || numero)
    .replaceAll("{motivo}", motivo)
    .replaceAll("{contador}", String(contador))
    .replaceAll("{limite}", String(limite));
}

function payloadAvisoGrupo({ texto, participante }) {
  const mencaoSegura = participante.endsWith("@s.whatsapp.net") || participante.endsWith("@lid");
  const payload = { text: texto };
  if (mencaoSegura && texto.includes("@")) payload.mentions = [participante];
  return payload;
}

function registrarHistoricoGerente(clienteId, evento = {}) {
  try {
    registrarHistoricoAtendimento(clienteId, {
      tipo: "moderacao",
      origem: "grupo",
      ...evento
    });
  } catch (e) {
    console.log("[MENSAGEIRO-GERENTE-HISTORICO-ERRO]", e?.message || e);
  }
}

function logGerenteOperacional(tag, dados = {}) {
  try {
    console.log(tag, JSON.stringify({
      clienteId: String(dados.clienteId || ""),
      sessaoId: String(dados.sessaoId || ""),
      grupoRef: referenciaGrupoGerente(dados.grupoId || ""),
      perfilId: String(dados.perfilId || ""),
      regraId: String(dados.regraId || ""),
      tipoRegra: String(dados.tipoRegra || ""),
      acao: String(dados.acao || ""),
      codigo: String(dados.codigo || ""),
      erro: dados.erro ? String(dados.erro).slice(0, 180) : ""
    }));
  } catch {}
}

function registrarMotivoOperacionalGerente(clienteId, evento = {}, tag = "[GERENTE-GATE]") {
  if (!eventoTemGrupo(evento)) return;
  try {
    registrarUltimoMotivoGerente(clienteId, evento);
  } catch (e) {
    logGerenteOperacional("[GERENTE-DIAGNOSTICO-ERRO]", {
      ...evento,
      clienteId,
      erro: e?.message || "erro_diagnostico"
    });
  }
  logGerenteOperacional(tag, { ...evento, clienteId });
}

function eventoTemGrupo(evento = {}) {
  return Boolean(String(evento.grupoId || "").trim());
}

function resultadoGerente(patch = {}) {
  return {
    processada: false,
    bloqueada: false,
    regraId: "",
    acao: "",
    codigo: "permitida",
    ...patch
  };
}

async function enviarAvisoGerente({ sock, grupoId, participante, texto, clienteId, sessaoId, regra, configuracao }) {
  if (!texto || !sock || typeof sock.sendMessage !== "function") return false;
  const enviada = await sock.sendMessage(grupoId, payloadAvisoGrupo({ texto, participante }));
  const temporario = regra.temporizarAviso === undefined
    ? configuracao.avisoTemporario === true
    : regra.temporizarAviso === true;
  if (temporario && enviada?.key) {
    agendarExclusaoMensagemTemporaria({
      sock,
      grupoId,
      mensagemKey: enviada.key,
      segundos: regra.apagarAvisoAposSegundos || configuracao.apagarAvisoAposSegundos,
      clienteId,
      sessaoId,
      acao: "gerente_aviso",
      participante
    });
  }
  return true;
}

async function tratarMensagemGrupoGerente({
  clienteId,
  sessaoId,
  sock,
  mensagem,
  planoLiberado = false
} = {}) {
  try {
    limparMapRecente(resultadosMensagemGerente);
    limparMapRecente(janelasGerente);

    if (!usuarioAtivo(clienteId)) {
      logUsuarioInativoIgnorado({ clienteId, fluxo: "mensageiro_gerente_grupo" });
      return resultadoGerente({ codigo: "usuario_inativo" });
    }
    if (planoLiberado !== true) return resultadoGerente({ codigo: "plano_sem_mensageiro" });
    if (mensagem?.key?.fromMe) return resultadoGerente({ codigo: "from_me" });

    const grupoId = normalizarJid(mensagem?.key?.remoteJid || "");
    if (!jidGrupo(grupoId)) return resultadoGerente({ codigo: "nao_grupo" });
    const registrarOperacional = (codigo, extras = {}, tag = "[GERENTE-GATE]") => {
      registrarMotivoOperacionalGerente(clienteId, {
        sessaoId,
        grupoId,
        codigo,
        ...extras
      }, tag);
    };
    const retornarOperacional = (codigo, patch = {}, extras = {}, tag = "[GERENTE-GATE]") => {
      registrarOperacional(codigo, extras, tag);
      return resultadoGerente({ codigo, ...patch });
    };

    const messageId = String(mensagem?.key?.id || "");
    const chaveResultado = messageId ? `gerente:msg:${clienteId}:${sessaoId}:${grupoId}:${messageId}` : "";
    const resultadoAnterior = chaveResultado ? resultadosMensagemGerente.get(chaveResultado) : null;
    if (resultadoAnterior) return resultadoAnterior.resultado;

    const participante = extrairParticipante(mensagem);
    if (!participante) return retornarOperacional("participante_nao_resolvido");
    if (!mensagem?.key || !mensagem.key.id || !mensagem.key.remoteJid) {
      return retornarOperacional("key_incompleta");
    }

    const config = getMensageiroCliente(clienteId);
    if (config?.ativo !== true) return retornarOperacional("mensageiro_inativo");

    const resolucao = resolverPerfilMensageiro({
      clienteId,
      sessaoId,
      grupoId,
      modulo: "gerente",
      config
    });
    if (!resolucao?.ok || resolucao.legado === true) {
      return retornarOperacional(resolucao?.codigo || "perfil_nao_resolvido");
    }

    const perfil = resolucao.perfil || {};
    const gerente = perfil.modulos?.gerente || {};
    if (gerente.ativo !== true) return retornarOperacional("gerente_inativo", {}, { perfilId: perfil.id });
    registrarOperacional("gerente_ativo", { perfilId: perfil.id });

    const configuracao = gerente.configuracao || {};
    const regrasAtivas = Array.isArray(configuracao.regras)
      ? configuracao.regras.filter(regraAtiva)
      : [];
    if (!regrasAtivas.length) return retornarOperacional("sem_regras_ativas", {}, { perfilId: perfil.id });

    const texto = extrairTextoMensagem(mensagem);
    const tipoMidia = extrairTipoMidia(mensagem);
    const contexto = { clienteId, perfilId: perfil.id, sessaoId, grupoId, participante, messageId };
    const violacao = encontrarViolacaoDeterministica({
      regras: regrasAtivas,
      texto,
      tipoMidia,
      contexto
    });
    if (!violacao) return retornarOperacional("sem_violacao", { processada: true }, { perfilId: perfil.id });

    const regra = violacao.regra;
    registrarOperacional("violacao_detectada", {
      perfilId: perfil.id,
      regraId: regra.id,
      tipoRegra: regra.tipo,
      acao: regra.acao
    }, "[GERENTE-REGRA-MATCH]");
    const permissao = await obterPermissoesGrupo({ sock, grupoId, participante });
    if (!permissao.ok) {
      return retornarOperacional(permissao.codigo || "metadata_indisponivel", { processada: true }, { perfilId: perfil.id });
    }

    const isencao = participanteIsento({ participante, permissao, configuracao });
    if (isencao) {
      registrarHistoricoGerente(clienteId, {
        contato: participante,
        contatoNome: nomeParticipante(participante, mensagem),
        grupo: grupoId,
        grupoNome: grupoId,
        perfilId: perfil.id,
        perfilNome: perfil.nome,
        gatilhoId: regra.id,
        gatilhoNome: regra.nome,
        status: "ignorado",
        resultado: "isento",
        resumo: `🛡️ ${nomeParticipante(participante, mensagem)} • isento`,
        detalhe: `Regra ignorada por isencao: ${isencao}`
      });
      return retornarOperacional(`isento_${isencao}`, { processada: true }, { perfilId: perfil.id });
    }

    if (!permissao.botAdmin) {
      registrarOperacional("bot_sem_admin", { perfilId: perfil.id }, "[GERENTE-SEM-ADMIN]");
      registrarHistoricoGerente(clienteId, {
        contato: participante,
        contatoNome: nomeParticipante(participante, mensagem),
        grupo: grupoId,
        grupoNome: grupoId,
        perfilId: perfil.id,
        perfilNome: perfil.nome,
        gatilhoId: regra.id,
        gatilhoNome: regra.nome,
        status: "sem_permissao",
        resultado: "sem_permissao_admin",
        resumo: "❌ Agente sem permissao de administrador",
        detalhe: "Optimus precisa ser administrador para apagar mensagens ou remover participantes"
      });
      return resultadoGerente({ processada: true, codigo: "bot_sem_admin" });
    }
    registrarOperacional("bot_admin", { perfilId: perfil.id });

    try {
      await sock.sendMessage(grupoId, { delete: mensagem.key });
      registrarOperacional("delete_ok", {
        perfilId: perfil.id,
        regraId: regra.id,
        tipoRegra: regra.tipo,
        acao: regra.acao
      }, "[GERENTE-DELETE-OK]");
    } catch (e) {
      registrarOperacional("delete_falhou", {
        perfilId: perfil.id,
        regraId: regra.id,
        tipoRegra: regra.tipo,
        acao: regra.acao,
        erro: e?.message || "delete_falhou"
      }, "[GERENTE-DELETE-ERRO]");
      registrarHistoricoGerente(clienteId, {
        contato: participante,
        contatoNome: nomeParticipante(participante, mensagem),
        grupo: grupoId,
        grupoNome: grupoId,
        perfilId: perfil.id,
        perfilNome: perfil.nome,
        gatilhoId: regra.id,
        gatilhoNome: regra.nome,
        status: "erro",
        resultado: "delete_falhou",
        resumo: "❌ Agente nao conseguiu apagar",
        detalhe: e?.message || "Falha ao apagar mensagem original"
      });
      return resultadoGerente({ processada: true, codigo: "delete_falhou" });
    }

    const deveContar = regra.acao !== "apagar";
    const limite = Math.max(1, Math.min(4, Number(regra.limiteInfracoes || 3) || 3));
    const infracao = deveContar
      ? registrarInfracaoGerente(clienteId, {
        perfilId: perfil.id,
        perfilNome: perfil.nome,
        sessaoId,
        grupoId,
        grupoNome: grupoId,
        participante,
        participanteNome: nomeParticipante(participante, mensagem),
        regraId: regra.id,
        regraNome: regra.nome,
        tipoRegra: regra.tipo,
        ultimoMotivo: violacao.motivo,
        ultimaMensagemId: messageId
      }, { resetInfracoesDias: configuracao.resetInfracoesDias })
      : null;
    if (deveContar) {
      registrarOperacional("infracao_registrada", {
        perfilId: perfil.id,
        regraId: regra.id,
        tipoRegra: regra.tipo,
        acao: regra.acao
      }, "[GERENTE-INFRACAO]");
    }
    const contador = infracao?.contador || 1;
    const deveRemover =
      regra.acao === "remover_imediato" ||
      (regra.acao === "avisos_depois_remover" && contador >= limite);
    const deveAvisar =
      regra.acao === "apagar_avisar" ||
      (regra.acao === "avisos_depois_remover" && !deveRemover);

    if (deveAvisar) {
      const textoAviso = formatarAviso({
        regra,
        participante,
        nome: nomeParticipante(participante, mensagem),
        motivo: violacao.motivo,
        contador,
        limite
      });
      try {
        await enviarAvisoGerente({ sock, grupoId, participante, texto: textoAviso, clienteId, sessaoId, regra, configuracao });
        registrarOperacional("aviso_ok", {
          perfilId: perfil.id,
          regraId: regra.id,
          tipoRegra: regra.tipo,
          acao: regra.acao
        }, "[GERENTE-AVISO-OK]");
      } catch (e) {
        registrarOperacional("aviso_falhou", {
          perfilId: perfil.id,
          regraId: regra.id,
          tipoRegra: regra.tipo,
          acao: regra.acao,
          erro: e?.message || "aviso_falhou"
        }, "[GERENTE-AVISO-ERRO]");
        registrarHistoricoGerente(clienteId, {
          contato: participante,
          contatoNome: nomeParticipante(participante, mensagem),
          grupo: grupoId,
          grupoNome: grupoId,
          perfilId: perfil.id,
          perfilNome: perfil.nome,
          gatilhoId: regra.id,
          gatilhoNome: regra.nome,
          status: "erro",
          resultado: "aviso_falhou",
          resumo: "❌ Agente nao conseguiu avisar",
          detalhe: e?.message || "Falha ao enviar aviso"
        });
      }
    }

    let removeu = false;
    if (deveRemover) {
      try {
        await sock.groupParticipantsUpdate(grupoId, [participante], "remove");
        removeu = true;
        registrarOperacional("remocao_ok", {
          perfilId: perfil.id,
          regraId: regra.id,
          tipoRegra: regra.tipo,
          acao: regra.acao
        });
        if (infracao?.id) {
          atualizarInfracaoGerenteCliente(clienteId, { id: infracao.id }, {
            status: "removido",
            removidoEm: new Date().toISOString()
          });
        }
      } catch (e) {
        registrarOperacional("remocao_falhou", {
          perfilId: perfil.id,
          regraId: regra.id,
          tipoRegra: regra.tipo,
          acao: regra.acao,
          erro: e?.message || "remocao_falhou"
        });
        registrarHistoricoGerente(clienteId, {
          contato: participante,
          contatoNome: nomeParticipante(participante, mensagem),
          grupo: grupoId,
          grupoNome: grupoId,
          perfilId: perfil.id,
          perfilNome: perfil.nome,
          gatilhoId: regra.id,
          gatilhoNome: regra.nome,
          status: "erro",
          resultado: "remocao_falhou",
          resumo: "❌ Agente nao conseguiu remover",
          detalhe: e?.message || "Falha ao remover participante"
        });
      }
    }

    const resumo = removeu
      ? `🚫 ${nomeParticipante(participante, mensagem)} removido do grupo`
      : `🛡️ ${nomeParticipante(participante, mensagem)} • mensagem removida`;
    const detalhe = deveContar
      ? `${violacao.motivo} • Aviso ${contador}/${limite}`
      : violacao.motivo;

    registrarHistoricoGerente(clienteId, {
      contato: participante,
      contatoNome: nomeParticipante(participante, mensagem),
      grupo: grupoId,
      grupoNome: grupoId,
      perfilId: perfil.id,
      perfilNome: perfil.nome,
      gatilhoId: regra.id,
      gatilhoNome: regra.nome,
      mensagemRecebida: String(texto || tipoMidia || "").slice(0, 500),
      status: removeu ? "removido" : "removida",
      resultado: removeu ? "participante_removido" : "mensagem_removida",
      resumo,
      detalhe
    });

    const resultadoFinal = resultadoGerente({
      processada: true,
      bloqueada: true,
      regraId: regra.id,
      acao: regra.acao,
      codigo: removeu ? "participante_removido" : "mensagem_removida"
    });
    if (chaveResultado) {
      resultadosMensagemGerente.set(chaveResultado, { ts: Date.now(), resultado: resultadoFinal });
    }
    registrarOperacional(resultadoFinal.codigo, {
      perfilId: perfil.id,
      regraId: regra.id,
      tipoRegra: regra.tipo,
      acao: regra.acao
    });
    return resultadoFinal;
  } catch (e) {
    console.log("[MENSAGEIRO-GERENTE-ERRO]", JSON.stringify({
      clienteId,
      sessaoId,
      grupoRef: referenciaGrupoGerente(mensagem?.key?.remoteJid || ""),
      erro: e?.message || String(e || "erro_desconhecido")
    }));
    return resultadoGerente({ codigo: "erro_interno" });
  }
}

module.exports = {
  tratarMensagemGrupoGerente,
  _internals: {
    encontrarViolacaoDeterministica,
    extrairUrls,
    extrairConvitesWhatsapp,
    normalizarTexto,
    resolverBotAdminGerente,
    resultadosMensagemGerente,
    janelasGerente
  }
};
