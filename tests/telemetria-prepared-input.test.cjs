"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { spawn } = require("node:child_process");
const path = require("node:path");
const {
  readPreparedToken,
} = require("../modules/telemetria/prepared-token-input.cjs");
const fake = "tel_" + "F".repeat(43);
function terminal() {
  const input = new PassThrough(),
    output = [],
    modes = [];
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (mode) => {
    modes.push(mode);
    input.isRaw = mode;
  };
  return {
    input,
    output,
    modes,
    options: {
      input,
      output: { write: (text) => output.push(text) },
      timeoutMs: 100,
    },
  };
}
test("hidden input supports paste, restores terminal, never echoes code and removes handlers", async () => {
  const t = terminal(),
    value = readPreparedToken(t.options);
  t.input.write(fake + "x\b\r");
  assert.equal(await value, fake);
  assert.deepEqual(t.modes, [true, false]);
  assert.ok(!t.output.join("").includes(fake));
  assert.equal(t.input.listenerCount("data"), 0);
});
for (const [name, input, expected] of [
  ["invalid", "bad\n", "prepared_token_invalid"],
  ["oversized", "a".repeat(257), "prepared_token_invalid"],
  ["cancel", "\u0003", "prepared_input_cancelled"],
  ["escape", "\u001b", "prepared_token_invalid"],
]) {
  test(`hidden input ${name} fails closed without echo`, async () => {
    const t = terminal(),
      value = readPreparedToken(t.options);
    t.input.write(input);
    await assert.rejects(value, new RegExp(expected));
    assert.deepEqual(t.modes, [true, false]);
    assert.ok(!t.output.join("").includes(fake));
  });
}
test("timeout and terminal failures clear handlers and restore mode", async () => {
  const t = terminal();
  await assert.rejects(
    readPreparedToken({ ...t.options, timeoutMs: 5 }),
    /prepared_input_timeout/,
  );
  assert.deepEqual(t.modes, [true, false]);
  const bad = terminal();
  bad.input.setRawMode = () => {
    throw Error("sensitive internal detail");
  };
  await assert.rejects(
    readPreparedToken(bad.options),
    /prepared_input_unavailable/,
  );
  assert.equal(bad.input.listenerCount("data"), 0);
});
test("piped stdin is supported without logging the credential", async () => {
  const input = new PassThrough();
  const p = readPreparedToken({
    input,
    output: { write: () => assert.fail("non-TTY must not output") },
  });
  input.end(fake + "\n");
  assert.equal(await p, fake);
});
test("real child stdin and loopback HTTPS-client fixture prove prepared GET, no auth request or leaked code", async () => {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, "fixtures/telemetria-prepared-terminal.cjs")],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (data) => {
    out += data;
  });
  child.stderr.on("data", (data) => {
    err += data;
  });
  child.stdin.end(fake + "\n");
  const code = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  assert.equal(code, 0, err);
  assert.match(out, /PREAUTHORIZED_READ=PASS/);
  assert.match(out, /FIXTURE_GET=PASS/);
  assert.ok(!out.includes(fake) && !err.includes(fake));
});
