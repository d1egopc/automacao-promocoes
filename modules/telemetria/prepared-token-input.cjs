"use strict";

// Credential input only: it neither issues nor changes an existing tel_ grant.
function readPreparedToken({
  input = process.stdin,
  output = process.stdout,
  timeoutMs = 120000,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!input?.on || (input.isTTY && typeof input.setRawMode !== "function")) {
      reject(new Error("prepared_input_unavailable"));
      return;
    }
    let value = "",
      settled = false;
    const wasRaw = input.isRaw === true;
    const wasFlowing = input.readableFlowing === true;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", onError);
      if (input.isTTY) {
        try {
          input.setRawMode(wasRaw);
        } catch {
          error = new Error("prepared_input_unavailable");
        }
        output.write("\n");
      }
      if (!wasFlowing) input.pause();
      const token = value.trim();
      value = "";
      if (error) reject(error);
      else if (!/^tel_[A-Za-z0-9_-]{43}$/.test(token))
        reject(new Error("prepared_token_invalid"));
      else resolve(token);
    }
    function onData(chunk) {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u0003" || character === "\u0004")
          return finish(new Error("prepared_input_cancelled"));
        if (character === "\b" || character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        if (!/[A-Za-z0-9_\- \t]/.test(character) || value.length >= 256)
          return finish(new Error("prepared_token_invalid"));
        value += character;
      }
    }
    const onEnd = () => finish();
    const onError = () => finish(new Error("prepared_input_unavailable"));
    const timer = setTimeout(
      () => finish(new Error("prepared_input_timeout")),
      timeoutMs,
    );
    try {
      if (input.isTTY) {
        input.setRawMode(true); // No echo, including pasted text. Never write the input back.
        output.write(
          "Cole o token tel_ nesta entrada oculta e pressione ENTER (nunca no chat): ",
        );
      }
      input.on("data", onData);
      input.once("end", onEnd);
      input.once("error", onError);
      input.resume();
    } catch {
      finish(new Error("prepared_input_unavailable"));
    }
  });
}

module.exports = { readPreparedToken };
