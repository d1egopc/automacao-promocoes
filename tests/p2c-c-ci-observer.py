"""Only measures the explicitly named disposable Actions postgres service."""
import datetime,json,os,pathlib,subprocess,time
assert os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted'
assert os.environ.get('GITHUB_REF')=='refs/heads/validation/p2c-c-postgres17'
assert not os.environ.get('DATABASE_URL')
container=os.environ['P2C_SERVICE_CONTAINER']
assert len(container)>=12 and all(c in '0123456789abcdef' for c in container)
def run(args):
    r=subprocess.run(args,capture_output=True,text=True,timeout=10)
    return r.stdout.strip() if r.returncode==0 else None
image=run(['docker','inspect','--format','{{.Config.Image}}',container])
assert image=='postgres:17'
root=pathlib.Path(os.environ['P2C_EVIDENCE_DIR'])
root.mkdir(exist_ok=True)
with (root/'resources.jsonl').open('a') as out:
    for i in range(1800):
        if (root/'observer-stop').exists():break
        result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'dockerStats':run(['docker','stats','--no-stream','--format','{{json .}}',container]),
          'disk':run(['df','-B1','--output=avail,used',str(root)])}
        result['cgroup']=run(['docker','exec',container,'sh','-c',
          "for f in cpu.stat io.stat memory.current memory.peak memory.events; do printf '%s\\n' \"$f\"; cat /sys/fs/cgroup/\"$f\" 2>/dev/null || true; done"])
        out.write(json.dumps(result)+'\n');out.flush();time.sleep(3)
