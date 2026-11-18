const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  limparRadarConfigSessao,
  radarConfigContemSessao,
  filtrarFontesClonadorPorSessao,
  limparColecaoDestinos,
  colecaoContemVinculo
} = require("../modules/whatsapp/session-reference-cleanup.service");

const repositorySource = fs.readFileSync(path.join(__dirname, "..", "modules", "clonador-grupos", "repository.js"), "utf8");
assert.match(repositorySource, /async function removerFontesDaSessao/);
assert.match(repositorySource, /DELETE FROM clonador_grupos_fontes[\s\S]*cliente_id = \$1 AND sessao_id = \$2/);

const target = "user_a_Claro";
const other = "user_a_Outro";

const radar = {
  monitoramentoAtivo: true,
  sessaoWhatsappId: target,
  categoriasPermitidas: ["eletronicos"],
  monitoramento: { horaInicial: "08:00", horaFinal: "22:00" },
  sessoesWhatsappMonitoradas: [
    {
      sessaoId: target,
      gruposMonitorados: [{ id: "group-a", sessaoId: target, ativo: true }]
    },
    {
      sessaoId: other,
      gruposMonitorados: [{ id: "group-b", sessaoId: other, ativo: true }]
    }
  ],
  gruposMonitorados: [
    { id: "group-a", sessaoId: target },
    { id: "group-b", sessaoId: other }
  ],
  telegramMonitorados: []
};

const cleaned = limparRadarConfigSessao(radar, target);
assert.equal(cleaned.changed, true);
assert.equal(cleaned.removedGroups, 2);
assert.equal(radarConfigContemSessao(cleaned.config, target), false);
assert.equal(cleaned.config.monitoramentoAtivo, true, "outra sessão mantém o Radar ativo");
assert.deepEqual(cleaned.config.sessoesWhatsappMonitoradas.map(item => item.sessaoId), [other]);
assert.deepEqual(cleaned.config.gruposMonitorados.map(item => item.id), ["group-b"]);
assert.deepEqual(cleaned.config.categoriasPermitidas, ["eletronicos"]);
assert.deepEqual(cleaned.config.monitoramento, { horaInicial: "08:00", horaFinal: "22:00" });
assert.equal(radarConfigContemSessao(radar, target), true, "fixture original permanece imutável");

const persistedAfterRestart = JSON.parse(JSON.stringify(cleaned.config));
assert.equal(radarConfigContemSessao(persistedAfterRestart, target), false, "restart não pode restaurar o vínculo removido");
assert.deepEqual(persistedAfterRestart.sessoesWhatsappMonitoradas.map(item => item.sessaoId), [other]);

const onlyTarget = limparRadarConfigSessao({
  monitoramentoAtivo: true,
  sessaoWhatsappId: target,
  sessoesWhatsappMonitoradas: [{ sessaoId: target, gruposMonitorados: [{ id: "only" }] }],
  gruposMonitorados: [{ id: "only" }],
  telegramMonitorados: []
}, target);
assert.equal(onlyTarget.config.monitoramentoAtivo, false);
assert.equal(onlyTarget.config.sessaoWhatsappId, "");

const emptyOther = limparRadarConfigSessao({
  monitoramentoAtivo: true,
  sessaoWhatsappId: target,
  sessoesWhatsappMonitoradas: [
    { sessaoId: target, gruposMonitorados: [{ id: "only" }] },
    { sessaoId: other, gruposMonitorados: [] }
  ],
  gruposMonitorados: [{ id: "only" }],
  telegramMonitorados: []
}, target);
assert.equal(emptyOther.config.monitoramentoAtivo, false, "sem grupos restantes o Radar deve ficar desativado");
assert.equal(emptyOther.config.sessaoWhatsappId, "");
assert.deepEqual(emptyOther.config.sessoesWhatsappMonitoradas.map(item => item.sessaoId), [other]);

const targetWithTelegram = limparRadarConfigSessao({
  monitoramentoAtivo: true,
  sessaoWhatsappId: target,
  sessoesWhatsappMonitoradas: [{ sessaoId: target, gruposMonitorados: [{ id: "only" }] }],
  gruposMonitorados: [{ id: "only" }],
  telegramMonitorados: [{ chatId: "telegram-1", ativo: true }]
}, target);
assert.equal(targetWithTelegram.config.monitoramentoAtivo, true, "Telegram independente não é desligado");

const fontes = filtrarFontesClonadorPorSessao([
  { clienteId: "user_a", sessaoId: target, grupoJid: "111@g.us" },
  { clienteId: "user_a", sessaoId: other, grupoJid: "222@g.us" },
  { clienteId: "user_b", sessaoId: target, grupoJid: "333@g.us" }
], target, "user_a");
assert.deepEqual(fontes.map(item => item.grupoJid), ["222@g.us", "333@g.us"]);

const destinos = {
  destinosInteligentes: [
    { id: "dest-a", nome: "Destino A", regras: { limiteDiario: 3 }, conexaoId: target, sessoesWhatsapp: [target, other] },
    { id: "dest-b", nome: "Destino B", conexaoId: other, sessoes: [other] }
  ],
  nested: {
    [target]: [{ id: "dest-c", sessaoId: target }]
  }
};
const ids = new Set([target]);
const changedDestinations = limparColecaoDestinos(destinos, ids);
assert.ok(changedDestinations >= 2);
assert.equal(destinos.destinosInteligentes[0].conexaoId, "");
assert.deepEqual(destinos.destinosInteligentes[0].sessoesWhatsapp, [other]);
assert.equal(destinos.destinosInteligentes[0].nome, "Destino A");
assert.deepEqual(destinos.destinosInteligentes[0].regras, { limiteDiario: 3 });
assert.equal(destinos.destinosInteligentes[1].conexaoId, other);
assert.equal(colecaoContemVinculo(destinos, ids), false);

const directDestination = { conexaoId: target, sessaoId: target, grupoJid: "111@g.us", sessoesWhatsapp: [target, other] };
assert.equal(limparColecaoDestinos(directDestination, ids), 1);
assert.equal(directDestination.conexaoId, "");
assert.equal(directDestination.sessaoId, "");
assert.equal(directDestination.grupoJid, "");
assert.deepEqual(directDestination.sessoesWhatsapp, [other]);
assert.equal(colecaoContemVinculo(directDestination, ids), false);
assert.deepEqual(
  filtrarFontesClonadorPorSessao([{ clienteId: "user_a", sessaoId: "", grupoJid: "legacy@g.us" }], "", "user_a"),
  [{ clienteId: "user_a", sessaoId: "", grupoJid: "legacy@g.us" }],
  "identidade vazia não pode apagar fonte legada"
);

console.log("whatsapp-session-reference-cleanup.test.cjs OK");
