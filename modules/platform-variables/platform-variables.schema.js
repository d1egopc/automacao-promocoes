"use strict";

const SQL_SCHEMA_PLATFORM_VARIABLES_V1 = Object.freeze([
  `
  CREATE TABLE IF NOT EXISTS platform_variables (
    name TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('text', 'secret', 'url', 'number', 'boolean')),
    encrypted_value TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    sensitive BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT,
    deleted_at TIMESTAMPTZ
  )
  `,
  "CREATE INDEX IF NOT EXISTS idx_platform_variables_deleted_at ON platform_variables (deleted_at)",
  "CREATE INDEX IF NOT EXISTS idx_platform_variables_updated_at ON platform_variables (updated_at)"
]);

module.exports = {
  SQL_SCHEMA_PLATFORM_VARIABLES_V1
};
