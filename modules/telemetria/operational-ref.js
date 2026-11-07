"use strict";

const { createHmac, randomBytes } = require("node:crypto");

// Ephemeral process-local authority shared by operational read models. The
// value is stable only for the lifetime of this backend process and cannot be
// reversed into a workspace, session, group or message identifier.
const secret = randomBytes(32);

function operationalRef(kind = "", ...parts) {
  const type = String(kind || "").trim();
  const values = parts.map(value => String(value ?? "").trim());
  if (!/^[a-z_]{1,32}$/.test(type) || values.some(value => !value || value.length > 200)) return null;
  return createHmac("sha256", secret)
    .update(`${type}\0${values.join("\0")}`)
    .digest("hex")
    .slice(0, 16);
}

module.exports = { operationalRef };
