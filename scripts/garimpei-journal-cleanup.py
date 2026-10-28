#!/usr/bin/env python3
"""One fixed diagnostic file. Never recurse or follow symlinks."""
import json,os,stat,time
ROOT='/opt/optimus/observability/garimpei-sensor'
RETENTION=72*60*60
def clean(directory=ROOT,now=None,expected_uid=1000,expected_gid=1000):
    now=time.time()if now is None else now
    # Open every component relative to a verified descriptor.
    dfd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in directory.strip('/').split('/'):
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=dfd);os.close(dfd);dfd=child
        ds=os.fstat(dfd)
        if (ds.st_uid,ds.st_gid,stat.S_IMODE(ds.st_mode))!=(expected_uid,expected_gid,0o700):raise ValueError('directory_permissions')
        try:fd=os.open('sensor-v1.jsonl',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=dfd)
        except FileNotFoundError:return 'absent'
        try:
            s=os.fstat(fd)
            if not stat.S_ISREG(s.st_mode)or s.st_nlink!=1 or s.st_size>2*1024*1024 or (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))!=(expected_uid,expected_gid,0o600):raise ValueError('file_permissions')
            first=os.read(fd,2048).split(b'\n')[0]
            data=json.loads(first)
            started=data.get('at')
            if data.get('kind')!='start'or type(started)is not int or started<=0 or started/1000>now:raise ValueError('start_timestamp')
            # Start fixes 72h; a recently modified file remains protected (24h maximum capture + grace).
            if now-started/1000<RETENTION or now-s.st_mtime<48*60*60-16*60:return 'protected'
            current=os.stat('sensor-v1.jsonl',dir_fd=dfd,follow_symlinks=False)
            if (current.st_dev,current.st_ino,current.st_mtime_ns)!=(s.st_dev,s.st_ino,s.st_mtime_ns):raise ValueError('file_changed')
            os.unlink('sensor-v1.jsonl',dir_fd=dfd);os.fsync(dfd)
            return 'expired_removed'
        finally:os.close(fd)
    finally:os.close(dfd)
if __name__=='__main__':
    try:print('GARIMPEI_CLEANUP='+clean())
    except Exception:print('GARIMPEI_CLEANUP=blocked');raise SystemExit(1)
