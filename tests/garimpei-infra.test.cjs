"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,"..");
test("closed Compose delta and POSIX-safe cleanup fixtures",()=>{
 const result=spawnSync(process.platform==="win32"?"python":"python3",["-B","tests/garimpei-infra-fixtures.py"],{cwd:root,encoding:"utf8"});
 assert.equal(result.status,0,result.stdout+result.stderr);
});
test("official workflow opt-in defaults false; mount, env and rollback guards stay enforced",()=>{
 const script=fs.readFileSync(path.join(root,"scripts/deploy-backend-vps-manual.sh"),"utf8");
 const workflow=fs.readFileSync(path.join(root,".github/workflows/deploy-backend-vps.yml"),"utf8");
 assert.match(workflow,/garimpei_sensor_mount:[\s\S]*?default: false/);
 assert.match(script,/sensor_mount_approved="\$\{GARIMPEI_SENSOR_MOUNT_APPROVED:-false\}"/);
 assert.match(script,/python3 "\$sensor_guard" compose/);assert.match(script,/python3 "\$sensor_guard" live/);
 assert.match(script,/test "\$\(env_fingerprint optimus-backend\)" = "\$baseline_env"/);
 assert.match(script,/test "\$\(mount_fingerprint optimus-backend\)" = "\$baseline_mounts"/);
 assert.match(script,/711f864885710e03324735abbdef708d2f6f6d19/);
 assert.match(script,/systemctl is-active --quiet garimpei-sensor-cleanup.timer/);
 assert.match(script,/cp -p -- "\$backup" "\$release"/);
 assert.match(script,/--no-deps --no-build --force-recreate backend/);
 assert.doesNotMatch(script,/compose .*down/);
});
test("retention units are dedicated, unprivileged and not automatically installed by deploy",()=>{
 const service=fs.readFileSync(path.join(root,"docs/infra/garimpei-sensor-cleanup.service"),"utf8");
 assert.match(service,/User=optimus/);assert.match(service,/ProtectSystem=strict/);
 assert.match(service,/ReadWritePaths=\/opt\/optimus\/observability\/garimpei-sensor/);
 const script=fs.readFileSync(path.join(root,"scripts/deploy-backend-vps-manual.sh"),"utf8");
 assert.doesNotMatch(script,/systemctl (?:enable|start|restart)/);
});
