"use strict";

// Independent, fail-closed releases. Existing execute flags alone never
// authorize deletion, including calls made directly to a stage or media GC.
const DB_RELEASE = "OPTIMUS_AUTO_CLEAN_DB_DELETE_RELEASE";
const FILE_RELEASE = "OPTIMUS_AUTO_CLEAN_FILE_DELETE_RELEASE";
const MEDIA_RELEASE = "OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE";
const released = name => process.env[name] === "approved";

function requireRelease(name) {
  if (released(name)) return;
  const error = new Error("auto_clean_delete_release_required");
  error.code = "AUTO_CLEAN_DELETE_LOCKED";
  throw error;
}

module.exports = { DB_RELEASE, FILE_RELEASE, MEDIA_RELEASE, released, requireRelease };
