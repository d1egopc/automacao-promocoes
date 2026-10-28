#!/usr/bin/env python3
"""Closed infrastructure guard. No Docker calls, writes, or secret output."""
import copy,json,os,stat,sys
SOURCE='/opt/optimus/observability/garimpei-sensor'
TARGET='/var/log/optimus/garimpei-sensor'
MOUNT={'type':'bind','source':SOURCE,'target':TARGET,'bind':{'create_host_path':False}}
def sensor(volumes):
    hits=[v for v in volumes if v.get('target')==TARGET or v.get('source')==SOURCE]
    if len(hits)>1:raise ValueError('duplicate_sensor_mount')
    if hits and hits[0]!=MOUNT:raise ValueError('unapproved_sensor_mount')
    return bool(hits)
def compare(before,after,approved=False):
    old=copy.deepcopy(before);new=copy.deepcopy(after)
    a=old['services']['backend'];b=new['services']['backend']
    had=sensor(a.get('volumes',[]));has=sensor(b.get('volumes',[]))
    if had and not has:raise ValueError('sensor_mount_removed')
    if has and not had:
        if not approved:raise ValueError('sensor_mount_not_authorized')
        b['volumes'].remove(MOUNT)
        if not b['volumes'] and 'volumes' not in a:b.pop('volumes')
    b['image']=a['image']
    if old!=new:raise ValueError('compose_delta_outside_approved_scope')
def live(before,after,approved=False):
    def rows(items):return sorted((m['Type'],m['Source'],m['Destination'],m['RW'])for m in items)
    expected=rows(before);actual=rows(after)
    approved_tuple=('bind',SOURCE,TARGET,True)
    if approved_tuple not in expected and approved:expected=sorted(expected+[approved_tuple])
    if actual!=expected:raise ValueError('runtime_mount_delta_outside_approved_scope')
def validate_path():
    for p in ['/opt','/opt/optimus','/opt/optimus/observability',SOURCE]:
        s=os.lstat(p)
        if not stat.S_ISDIR(s.st_mode) or stat.S_ISLNK(s.st_mode) or os.path.realpath(p)!=p:raise ValueError('unsafe_sensor_path')
        if p in ['/opt/optimus/observability',SOURCE] and (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))!=(1000,1000,0o700):raise ValueError('unsafe_sensor_permissions')
def main():
    action=sys.argv[1]
    if action=='path':validate_path();return
    with open(sys.argv[2])as f:before=json.load(f)
    if action=='mode':print('present'if sensor(before['services']['backend'].get('volumes',[]))else'absent');return
    with open(sys.argv[3])as f:after=json.load(f)
    approved=len(sys.argv)>4 and sys.argv[4]=='true'
    if action=='compose':compare(before,after,approved)
    elif action=='live':live(before,after,approved)
    else:raise ValueError('invalid_action')
if __name__=='__main__':
    try:main()
    except Exception as e:
        print('GARIMPEI_INFRA_GUARD_BLOCKED:'+type(e).__name__,file=sys.stderr);sys.exit(1)
