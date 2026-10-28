import copy,importlib.util,json,os,pathlib,stat,tempfile,time,unittest
ROOT=pathlib.Path(__file__).resolve().parent.parent
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
g=load('guard','garimpei-infra-guard.py');c=load('cleanup','garimpei-journal-cleanup.py')
class ComposeTests(unittest.TestCase):
 def setUp(self):
  self.before={'services':{'backend':{'image':'previous','environment':{'FIXTURE':'same'},'volumes':[{'type':'bind','source':'/opt/optimus/data','target':'/data','bind':{}}]},'postgres':{'image':'postgres:17','volumes':['pg:/var/lib/postgresql/data']}},'networks':{'default':{}}}
 def candidate(self):
  after=copy.deepcopy(self.before);after['services']['backend']['image']='candidate';return after
 def test_image_only_preserves_guard(self):g.compare(self.before,self.candidate())
 def test_new_mount_requires_optin_and_exact_shape(self):
  after=self.candidate();after['services']['backend']['volumes'].append(copy.deepcopy(g.MOUNT))
  with self.assertRaises(ValueError):g.compare(self.before,after)
  g.compare(self.before,after,True)
  for field,value in [('source','/opt/optimus/data'),('target','/data'),('read_only',True),('bind',{'create_host_path':True})]:
   bad=copy.deepcopy(after);bad['services']['backend']['volumes'][-1][field]=value
   with self.assertRaises(ValueError):g.compare(self.before,bad,True)
 def test_no_unrelated_mutation_even_optin(self):
  for modify in [lambda x:x['services']['backend']['environment'].update(FIXTURE='changed'),lambda x:x['services']['backend']['volumes'][0].update(source='/other'),lambda x:x['services']['postgres'].update(image='other'),lambda x:x.update(secrets={'new':{}}),lambda x:x['services']['backend'].update(ports=['3001:3000'])]:
   after=self.candidate();after['services']['backend']['volumes'].append(copy.deepcopy(g.MOUNT));modify(after)
   with self.assertRaises(ValueError):g.compare(self.before,after,True)
 def test_preserve_mount_future_deploy_and_no_duplicates(self):
  self.before['services']['backend']['volumes'].append(copy.deepcopy(g.MOUNT));after=self.candidate();g.compare(self.before,after)
  after['services']['backend']['volumes'].append(copy.deepcopy(g.MOUNT))
  with self.assertRaises(ValueError):g.compare(self.before,after,True)
  after=self.candidate();after['services']['backend']['volumes'].pop()
  with self.assertRaises(ValueError):g.compare(self.before,after,True)
 def test_live_mounts_exact_addition_only(self):
  before=[{'Type':'bind','Source':'/opt/optimus/data','Destination':'/data','RW':True}]
  extra={'Type':'bind','Source':g.SOURCE,'Destination':g.TARGET,'RW':True}
  g.live(before,before)
  with self.assertRaises(ValueError):g.live(before,before+[extra])
  g.live(before,before+[extra],True)
  with self.assertRaises(ValueError):g.live(before,[extra],True)
  with self.assertRaises(ValueError):g.live(before,before+[extra,extra],True)
  bad=copy.deepcopy(before);bad[0]['RW']=False
  with self.assertRaises(ValueError):g.live(before,bad+[extra],True)
@unittest.skipUnless(hasattr(os,'O_NOFOLLOW')and hasattr(os,'O_DIRECTORY'),'POSIX descriptor tests run in Linux CI')
class CleanupTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);os.chmod(self.root,0o700);self.file=self.root/'sensor-v1.jsonl';self.now=time.time();self.started=self.now-72*3600-1
 def tearDown(self):self.tmp.cleanup()
 def clean(self):return c.clean(str(self.root),self.now,os.getuid(),os.getgid())
 def write(self,kind='start',started=None):
  self.file.write_text(json.dumps({'kind':kind,'at':int((self.started if started is None else started)*1000)})+'\n');os.chmod(self.file,0o600);os.utime(self.file,(self.started+24*3600,self.started+24*3600))
 def test_only_expired_exact_file_removed(self):
  self.write();unrelated=self.root/'backup';unrelated.write_text('protected');self.assertEqual(self.clean(),'expired_removed');self.assertTrue(unrelated.exists())
 def test_recent_and_malformed_preserved(self):
  self.write(started=self.now-2*3600);self.assertEqual(self.clean(),'protected');self.assertTrue(self.file.exists());self.file.write_text('invalid')
  with self.assertRaises(Exception):self.clean()
  self.assertTrue(self.file.exists())
 def test_symlink_and_hardlink_blocked(self):
  outside=self.root/'private';outside.write_text('protected');self.file.symlink_to(outside)
  with self.assertRaises(Exception):self.clean()
  self.file.unlink();self.write();os.link(self.file,self.root/'alias')
  with self.assertRaises(Exception):self.clean()
  self.assertTrue(outside.exists());self.assertTrue(self.file.exists())
 def test_parent_symlink_and_permissions_blocked(self):
  self.write();alias=self.root/'aliasdir';alias.symlink_to(self.root,target_is_directory=True)
  with self.assertRaises(Exception):c.clean(str(alias),self.now,os.getuid(),os.getgid())
  os.chmod(self.file,0o644)
  with self.assertRaises(Exception):self.clean()
 def test_oversize_and_future_blocked(self):
  self.write();self.file.write_bytes(b'x'*(2*1024*1024+1))
  with self.assertRaises(Exception):self.clean()
  self.write(started=self.now+3600)
  with self.assertRaises(Exception):self.clean()
if __name__=='__main__':unittest.main()
