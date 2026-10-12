import json
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from subprocess import CompletedProcess
import urllib.request
import urllib.error
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_store import bundle
try:
    from server import make_server
except ImportError:
    make_server = None

class ServerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(make_server, 'HTTP service implementation is required')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.server = make_server(port=0, data_dir=self.root/'data')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.token = self.request('/api/session')['token']

    def stop(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def request(self, path, data=None, method=None, token=True, origin=None):
        headers={}
        if hasattr(self,'token') and token: headers['X-L2E-Token']=self.token
        if origin: headers['Origin']=origin
        if data is not None: headers['Content-Type']='application/json'
        req=urllib.request.Request(self.url+path, None if data is None else json.dumps(data).encode(), headers, method=method)
        with urllib.request.urlopen(req) as result:
            return json.load(result)

    def test_import_open_and_save_are_real_file_operations(self):
        entry=self.request('/api/banks/import', {'path':str(self.root/'course'), 'bundle':bundle()})
        loaded=self.request('/api/banks/'+entry['key'])
        loaded['state']['favoriteIds']=['q1']
        self.request('/api/banks/'+entry['key']+'/state', {'revision':0,'bankRevision':loaded['bankRevision'],'state':loaded['state']}, 'PUT')
        again=self.request('/api/banks/'+entry['key'])
        self.assertEqual(again['state']['favoriteIds'],['q1'])
        self.assertEqual(again['revision'],1)

    def test_post_requires_token_and_rejects_foreign_origin(self):
        for kwargs in [{'token':False},{'origin':'https://evil.example'}]:
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                self.request('/api/banks/create',{'path':str(self.root/'bad'),'name':'bad'},**kwargs)
            self.assertEqual(ctx.exception.code,403)
        self.assertFalse((self.root/'bad').exists())

    def test_static_server_does_not_expose_bank_records_or_application_code(self):
        for path in ['/../bank_store.py','/bank_store.py','/data/banks.json']:
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(self.url+path)
            self.assertEqual(ctx.exception.code,404)

    def test_record_preview_rejects_bad_state_without_writing(self):
        entry=self.request('/api/banks/import',{'path':str(self.root/'course'),'bundle':bundle()})
        loaded=self.request('/api/banks/'+entry['key'])
        state=loaded['state'];state['masteryById']={'q1':None}
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.request('/api/validate-state',{'state':state})
        self.assertEqual(ctx.exception.code,400)
        self.assertEqual(self.request('/api/banks/'+entry['key'])['revision'],0)

    def test_package_picker_starts_at_selected_directory_and_loads_real_json(self):
        folder=self.root/'目录 with spaces " quote'
        folder.mkdir()
        package=folder/'课程.json';package.write_text(json.dumps(bundle()))
        def choose(command, **kwargs):
            self.assertTrue(Path(command[-1]).samefile(folder))
            return CompletedProcess(command,0,str(package)+'\n','')
        with patch('server.sys.platform','darwin'),patch('server.subprocess.run',side_effect=choose):
            selected=self.request('/api/pick-bank-package',{'directory':str(folder/'new-bank')})
        self.assertEqual(selected['bundle']['questions'][0]['answerId'],'b')
        self.assertEqual(selected['path'],str(package))
        self.assertFalse((folder/'new-bank').exists())

    def test_package_picker_cancel_keeps_files_untouched_and_invalid_json_is_rejected(self):
        package=self.root/'bad.json';package.write_text('{invalid')
        with patch('server.sys.platform','darwin'),patch('server.subprocess.run',return_value=CompletedProcess([],1,'','User canceled. (-128)')):
            self.assertEqual(self.request('/api/pick-bank-package',{'directory':str(self.root)}),{'path':None})
        with patch('server.sys.platform','darwin'),patch('server.subprocess.run',return_value=CompletedProcess([],0,str(package),' ')):
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                self.request('/api/pick-bank-package',{'directory':str(self.root)})
        self.assertEqual(ctx.exception.code,422)
        self.assertEqual(package.read_text(),'{invalid')

    def test_delete_endpoint_requires_confirmation_and_keeps_other_bank(self):
        entry=self.request('/api/banks/import',{'path':str(self.root/'course'),'bundle':bundle()})
        endpoint='/api/banks/'+entry['key']+'/delete'
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.request(endpoint,{'scope':'bank'})
        self.assertEqual(ctx.exception.code,400)
        error=json.load(ctx.exception)
        self.assertIn('confirmation',error['errorEn'])
        self.assertTrue((self.root/'course').exists())
        before=(self.root/'course'/'records'/'progress.json').read_bytes()
        self.request(endpoint,{'scope':'registration'})
        self.assertEqual(self.request('/api/banks')['banks'],[])
        self.assertEqual((self.root/'course'/'records'/'progress.json').read_bytes(),before)
        reopened=self.request('/api/banks/open',{'path':str(self.root/'course')})
        self.request('/api/banks/'+reopened['key']+'/delete',{'scope':'bank','confirmed':True})
        self.assertFalse((self.root/'course').exists())

    def test_trash_endpoints_restore_and_purge_require_local_authorization(self):
        entry = self.request('/api/banks/import', {'path': str(self.root / 'course'), 'bundle': bundle()})
        item = self.request('/api/banks/' + entry['key'] + '/delete', {'scope': 'bank', 'confirmed': True})['archiveId']
        self.assertEqual(self.request('/api/trash')['items'][0]['id'], item)
        restored = self.request('/api/trash/' + item + '/restore', {})
        self.assertNotEqual(restored['key'], entry['key'])
        self.assertEqual(self.request('/api/trash')['items'], [])
        item = self.request('/api/banks/' + restored['key'] + '/delete', {'scope': 'bank', 'confirmed': True})['archiveId']
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.request('/api/trash/' + item + '/purge', {})
        self.assertEqual(ctx.exception.code, 400)
        self.assertIn('confirmation', json.load(ctx.exception)['errorEn'])
        self.request('/api/trash/' + item + '/purge', {'confirmed': True})
        self.assertEqual(self.request('/api/trash')['items'], [])
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.request('/api/trash/' + item + '/restore', {})
        self.assertEqual(ctx.exception.code, 404)

    def test_actual_open_endpoint_updates_recency_but_read_only_get_does_not(self):
        entry=self.request('/api/banks/import',{'path':str(self.root/'course'),'bundle':bundle()})
        initial=self.request('/api/banks')['banks'][0]['lastOpenedAt']
        with patch('bank_store.time.time',return_value=initial/1000+10):
            self.request('/api/banks/'+entry['key'])
            self.assertEqual(self.request('/api/banks')['banks'][0]['lastOpenedAt'],initial)
            self.request('/api/banks/'+entry['key']+'/open',{})
        self.assertEqual(self.request('/api/banks')['banks'][0]['lastOpenedAt'],initial+10000)

    def test_changed_bank_revision_is_rejected(self):
        entry=self.request('/api/banks/import',{'path':str(self.root/'course'),'bundle':bundle()})
        loaded=self.request('/api/banks/'+entry['key'])
        content=bundle()['questions'];content[0]['prompt']='Changed'
        (self.root/'course'/'questions.json').write_text(json.dumps(content))
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.request('/api/banks/'+entry['key']+'/state',{'revision':0,'bankRevision':loaded['bankRevision'],'state':loaded['state']},'PUT')
        self.assertEqual(ctx.exception.code,409)

if __name__=='__main__': unittest.main()
