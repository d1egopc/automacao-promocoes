"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/deploy-backend-vps.yml"), "utf8");
const deploy = fs.readFileSync(path.join(root, "scripts/deploy-backend-vps-manual.sh"), "utf8");
const guardian = fs.readFileSync(path.join(root, "scripts/guardian-v1.cjs"), "utf8");
const manifest = fs.readFileSync(path.join(root, "scripts/full-image-runtime-manifest.cjs"), "utf8");

test("workflow exige escolha explícita de estratégia e deriva plano pelo Guardião", () => {
  assert.match(workflow, /image_strategy:[\s\S]*?options:[\s\S]*?- overlay[\s\S]*?- full_image/);
  assert.match(workflow, /--release-mode "\$IMAGE_STRATEGY"/);
  assert.match(workflow, /IMAGE_STRATEGY: \$\{\{ inputs\.image_strategy \}\}/);
  assert.match(workflow, /timeout-minutes: 60/);
});

test("perfil de observabilidade não pode ser publicado por overlay nem variar os arquivos permitidos", () => {
  assert.match(guardian, /continuousIngressFullImage[\s\S]*?full_image_strategy_required/);
  assert.match(guardian, /exact_full_image_runtime_set_required/);
  assert.match(guardian, /exact_full_image_change_types_required/);
  assert.match(guardian, /unapproved_full_image_content/);
});

test("equivalência integral e estado da imagem base são verificados antes da troca", () => {
  const activeImageCheck = deploy.indexOf('test "$active_id" = "$BASE_IMAGE"');
  const manifestGate = deploy.indexOf("deploy_stage=verify_full_image_runtime_equivalence");
  const switchBackend = deploy.indexOf("deploy_stage=switch_backend");
  assert.ok(activeImageCheck >= 0 && manifestGate > activeImageCheck && switchBackend > manifestGate);
  assert.match(deploy, /active-runtime\.json/);
  assert.match(deploy, /base-runtime\.json/);
  assert.match(deploy, /candidate-runtime\.json/);
  assert.match(manifest, /dependencyTreeSha256/);
  assert.match(deploy, /Destination.*\/app/);
});

test("build herda dependências sem npm/postinstall e preserva rollback sem sobrescrever tag", () => {
  assert.match(guardian, /! -name node_modules -exec rm -rf/);
  assert.match(guardian, /COPY --chown=node:node \. \/app/);
  assert.doesNotMatch(guardian, /renderFullImageDockerfile[\s\S]{0,900}npm ci/);
  assert.match(deploy, /if docker image inspect "\$recovery_tag"[\s\S]{0,250}test "\$\(docker image inspect -f '\{\{\.Id\}\}' "\$recovery_tag"\)" = "\$BASE_IMAGE"/);
  assert.match(deploy, /Refusing to replace an existing build tag/);
  assert.match(deploy, /docker image inspect -f '\{\{\.Id\}\}' "\$recovery_tag"\)" = "\$BASE_IMAGE"/);
});

test("ferramentas de equivalência são release tooling, não runtime alterado", () => {
  assert.match(deploy, /scripts\/full-image-runtime-manifest\.cjs\|scripts\/verify-full-image-equivalence\.cjs/);
  assert.match(manifest, /"scripts\/full-image-runtime-manifest\.cjs"/);
  assert.match(manifest, /"scripts\/verify-full-image-equivalence\.cjs"/);
});
