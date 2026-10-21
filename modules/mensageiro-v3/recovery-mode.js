"use strict";

// Recovery images keep the durable V3 fence and all non-Messenger services,
// but may intentionally stop V3 execution while an operator investigates.
// The legacy authority is never re-enabled by this switch.
function isMensageiroV3RecoveryDisabled(env = process.env) {
  return String(env?.MENSAGEIRO_V3_RECOVERY_DISABLED || "").trim().toLowerCase() === "true";
}

module.exports = { isMensageiroV3RecoveryDisabled };
