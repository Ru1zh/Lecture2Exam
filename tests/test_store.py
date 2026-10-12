import copy
import json
import sys
import tempfile
import threading
import time
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bank_store
try:
    from bank_store import BankStore, AppError, validate_bank
except ImportError:
    BankStore = AppError = validate_bank = None


def bundle():
    return {
        'bank': {'schemaVersion': 1, 'id': 'sample-course', 'name': '示例课', 'course': 'COURSE',
                 'groups': [{'id': 'g', 'label': '第一章'}],
                 'sources': [{'id': 's', 'file': 'notes.md', 'kind': 'md', 'groupId': 'g', 'order': 1, 'examEligible': True}],
                 'exam': {'durationMinutes': 10, 'sampling': 'balanced', 'sections': [{'type': 'mcq', 'count': 1, 'points': 2}], 'coverage': []},
                 'mastery': {'wrongThreshold': 3, 'correctStreak': 2}},
        'questions': [{'id': 'q1', 'type': 'mcq', 'sourceId': 's', 'locator': {'kind': 'line', 'value': '4–6'},
                       'prompt': 'What is the answer?', 'options': [{'id': 'a', 'text': 'One'}, {'id': 'b', 'text': 'Two'}],
                       'answerId': 'b', 'explanationZh': '答案是二。', 'knowledgeZh': '示例知识点'}]}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(BankStore, 'BankStore implementation is required')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.store = BankStore(self.root / 'app-data')

    def imported(self, name='course'):
        return self.store.import_bank(str(self.root / name), bundle())['key']

    def test_rename_updates_name_without_changing_identity_or_records(self):
        key = self.imported()
        loaded = self.store.load(key)
        before = (self.root / 'course' / 'records' / 'progress.json').read_bytes()
        questions = (self.root / 'course' / 'questions.json').read_bytes()
        renamed = self.store.rename(key, '  New course 中文  ', loaded['bankRevision'])
        self.assertEqual(renamed['bank']['name'], 'New course 中文')
        self.assertEqual(renamed['key'], key)
        self.assertEqual(renamed['path'], loaded['path'])
        self.assertEqual(renamed['bank']['id'], loaded['bank']['id'])
        self.assertEqual(renamed['revision'], loaded['revision'])
        self.assertEqual((self.root / 'course' / 'records' / 'progress.json').read_bytes(), before)
        self.assertEqual((self.root / 'course' / 'questions.json').read_bytes(), questions)
        self.assertEqual(BankStore(self.root / 'app-data').list()[0]['name'], 'New course 中文')
        self.assertNotEqual(renamed['bankRevision'], loaded['bankRevision'])
        with self.assertRaises(AppError):
            self.store.save(key, loaded['revision'], loaded['state'], loaded['bankRevision'])
        renamed['state']['favoriteIds'] = ['q1']
        self.store.save(key, renamed['revision'], renamed['state'], renamed['bankRevision'])
        self.assertEqual(self.store.load(key)['state']['favoriteIds'], ['q1'])

    def test_rename_rejects_invalid_names_and_stale_bank_versions(self):
        key = self.imported()
        loaded = self.store.load(key)
        before = (self.root / 'course' / 'bank.json').read_bytes()
        for name in ['', '   ', None, 123, 'x' * 201]:
            with self.subTest(name=name), self.assertRaises(AppError):
                self.store.rename(key, name, loaded['bankRevision'])
        self.assertEqual((self.root / 'course' / 'bank.json').read_bytes(), before)
        with self.assertRaises(AppError) as ctx:
            self.store.rename(key, 'New', 'stale')
        self.assertEqual(ctx.exception.status, 409)
        self.assertEqual((self.root / 'course' / 'bank.json').read_bytes(), before)

    def test_failed_rename_registry_write_rolls_back_bank_name(self):
        key = self.imported()
        loaded = self.store.load(key)
        before = (self.root / 'course' / 'bank.json').read_bytes()
        original_write = bank_store.atomic_write
        def fail_registry(path, *args, **kwargs):
            if path == self.store.registry_path:
                raise OSError('registry write failed')
            return original_write(path, *args, **kwargs)
        with patch('bank_store.atomic_write', side_effect=fail_registry), self.assertRaises(OSError):
            self.store.rename(key, 'New', loaded['bankRevision'])
        self.assertEqual((self.root / 'course' / 'bank.json').read_bytes(), before)
        self.assertEqual(self.store.load(key)['bankRevision'], loaded['bankRevision'])

    def test_trash_restore_preserves_files_records_and_rejects_old_tab(self):
        key = self.imported()
        loaded = self.store.load(key)
        loaded['state']['favoriteIds'] = ['q1']
        self.store.save(key, loaded['revision'], loaded['state'], loaded['bankRevision'])
        source = self.root / 'course' / 'sources' / 'notes.md'
        source.write_text('Material')
        before = (self.root / 'course' / 'records' / 'progress.json').read_bytes()
        deleted = self.store.delete(key, 'bank', True)
        entries = BankStore(self.root / 'app-data').list_trash()
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]['id'], deleted['archiveId'])
        self.assertEqual(entries[0]['name'], '示例课')
        restored = self.store.restore_trash(deleted['archiveId'])
        self.assertNotEqual(restored['key'], key)
        self.assertEqual(self.store.list_trash(), [])
        self.assertEqual(source.read_text(), 'Material')
        self.assertEqual((self.root / 'course' / 'records' / 'progress.json').read_bytes(), before)
        self.assertEqual(self.store.load(restored['key'])['state']['favoriteIds'], ['q1'])
        with self.assertRaises(AppError):
            self.store.save(key, loaded['revision'], loaded['state'], loaded['bankRevision'])

    def test_trash_conflict_keeps_both_copies_and_permanent_delete_needs_confirmation(self):
        key = self.imported()
        other = self.imported('other')
        item = self.store.delete(key, 'bank', True)['archiveId']
        occupied = self.root / 'course'
        occupied.mkdir()
        (occupied / 'keep.txt').write_text('Unrelated')
        with self.assertRaises(AppError):
            self.store.restore_trash(item)
        self.assertEqual(len(self.store.list_trash()), 1)
        with self.assertRaises(AppError):
            self.store.purge_trash(item)
        self.assertEqual(len(self.store.list_trash()), 1)
        self.store.purge_trash(item, True)
        self.assertEqual(self.store.list_trash(), [])
        self.assertFalse((self.root / 'app-data' / 'deleted' / item).exists())
        self.assertEqual((occupied / 'keep.txt').read_text(), 'Unrelated')
        self.assertEqual(self.store.load(other)['bank']['name'], '示例课')
        with self.assertRaises(AppError):
            self.store.restore_trash(item)

    def test_trash_legacy_metadata_and_path_guards(self):
        key = self.imported()
        item = self.store.delete(key, 'bank', True)['archiveId']
        archive = self.root / 'app-data' / 'deleted' / item
        (archive / 'info.json').write_text(json.dumps({'scope': 'bank', 'originalPath': str(self.root / 'course'), 'bankId': 'sample-course'}))
        self.assertEqual(self.store.list_trash()[0]['name'], '示例课')
        for invalid in ['../course', '..', str(self.root), None]:
            with self.subTest(invalid=invalid), self.assertRaises(AppError):
                self.store.purge_trash(invalid, True)
        external = self.root / 'external'
        external.mkdir()
        (external / 'keep.txt').write_text('safe')
        fake = self.root / 'app-data' / 'deleted' / '00000000-0000-0000-0000-000000000000'
        fake.symlink_to(external, target_is_directory=True)
        with self.assertRaises(AppError):
            self.store.purge_trash(fake.name, True)
        self.assertEqual((external / 'keep.txt').read_text(), 'safe')
        self.assertEqual(len(self.store.list_trash()), 1)

    def test_failed_trash_restore_registration_rolls_folder_back(self):
        item = self.store.delete(self.imported(), 'bank', True)['archiveId']
        original_write = bank_store.atomic_write
        def fail_registry(path, *args, **kwargs):
            if path == self.store.registry_path:
                raise OSError('registry write failed')
            return original_write(path, *args, **kwargs)
        with patch('bank_store.atomic_write', side_effect=fail_registry), self.assertRaises(OSError):
            self.store.restore_trash(item)
        self.assertFalse((self.root / 'course').exists())
        self.assertEqual(len(self.store.list_trash()), 1)
        self.assertEqual(self.store.list(), [])

    def test_bad_trash_timestamp_does_not_hide_other_items(self):
        first = self.store.delete(self.imported(), 'bank', True)['archiveId']
        self.store.delete(self.imported('other'), 'bank', True)
        info_path = self.root / 'app-data' / 'deleted' / first / 'info.json'
        info = json.loads(info_path.read_text())
        for invalid in ['2026-10-05', {}, float('inf'), True]:
            with self.subTest(invalid=invalid):
                info['deletedAt'] = invalid
                info_path.write_text(json.dumps(info))
                entries = self.store.list_trash()
                self.assertEqual(len(entries), 2)
                self.assertIsNone(next(x for x in entries if x['id'] == first)['deletedAt'])

    def test_exam_presets_persist_and_reject_malformed_edits_without_replacing_records(self):
        key = self.imported()
        loaded = self.store.load(key)
        settings = {'durationMinutes': 5, 'groupIds': ['g'], 'sections': [{'type': 'mcq', 'count': 1, 'points': 2}]}
        preset = {'id': 'preset-1', 'name': 'Midterm', 'settings': settings}
        loaded['state']['examPresets'] = [preset]
        self.store.save(key, loaded['revision'], loaded['state'], loaded['bankRevision'])
        self.assertEqual(self.store.load(key)['state']['examPresets'], [preset])
        before = (self.root / 'course' / 'records' / 'progress.json').read_bytes()
        for invalid in [None, [preset, preset], [{**preset, 'name': ''}], [{**preset, 'settings': None}],
                        [{**preset, 'settings': {**settings, 'groupIds': []}}],
                        [preset, {**preset, 'id': 'preset-2', 'name': 'midterm'}]]:
            with self.subTest(presets=invalid):
                loaded = self.store.load(key); loaded['state']['examPresets'] = invalid
                with self.assertRaises(AppError):
                    self.store.save(key, loaded['revision'], loaded['state'], loaded['bankRevision'])
                self.assertEqual((self.root / 'course' / 'records' / 'progress.json').read_bytes(), before)

    def test_exam_review_flags_are_validated_against_the_paper_snapshot(self):
        key = self.imported(); loaded = self.store.load(key)
        loaded['state']['examSession'] = {'id': 'flag-exam', 'questionIds': ['q1'], 'questions': bundle()['questions'],
            'answers': {}, 'optionOrder': {'q1': ['a', 'b']}, 'pointsByType': {'mcq': 2}, 'startedAt': 1000,
            'deadline': 601000, 'currentIndex': 0, 'maxScore': 2, 'statsApplied': False, 'submittedAt': None, 'flaggedIds': ['q1']}
        self.store.save(key, loaded['revision'], loaded['state'], loaded['bankRevision'])
        before = (self.root / 'course' / 'records' / 'progress.json').read_bytes()
        for flags in [None, 'q1', ['missing'], ['q1', 'q1'], [1]]:
            loaded = self.store.load(key); loaded['state']['examSession']['flaggedIds'] = flags
            with self.assertRaises(AppError):
                self.store.save(key, loaded['revision'], loaded['state'], loaded['bankRevision'])
            self.assertEqual((self.root / 'course' / 'records' / 'progress.json').read_bytes(), before)

    def test_create_empty_bank_is_explicit_and_does_not_overwrite(self):
        entry = self.store.create(str(self.root / 'new'), '新课程', 'ABC')
        loaded = self.store.load(entry['key'])
        self.assertEqual(loaded['questions'], [])
        self.assertEqual(loaded['bank']['name'], '新课程')
        self.assertTrue((self.root / 'new' / 'records' / 'exams').is_dir())
        with self.assertRaises(AppError):
            self.store.create(str(self.root / 'new'), '覆盖', 'BAD')

    def test_exam_settings_are_bank_specific_and_invalid_edits_preserve_records(self):
        a, b = self.imported('a'), self.imported('b')
        loaded = self.store.load(a)
        settings = {'durationMinutes': 12.5, 'groupIds': ['g'], 'sections': [{'type': 'mcq', 'count': 1, 'points': 2.5}]}
        loaded['state']['examSettings'] = settings
        self.store.save(a, loaded['revision'], loaded['state'], loaded['bankRevision'])
        self.assertEqual(self.store.load(a)['state']['examSettings'], settings)
        self.assertIsNone(self.store.load(b)['state'].get('examSettings'))
        before = (self.root / 'a' / 'records' / 'progress.json').read_bytes()
        invalid_settings = [
            {**settings, 'durationMinutes': 0}, {**settings, 'durationMinutes': 1e307}, {**settings, 'groupIds': []},
            {**settings, 'groupIds': ['g', 'g']}, {**settings, 'sections': []},
            {**settings, 'sections': [{'type': 'mcq', 'count': 0, 'points': 2}]},
            {**settings, 'sections': [{'type': 'mcq', 'count': True, 'points': 2}]},
            {**settings, 'sections': [{'type': 'mcq', 'count': 1, 'points': 0}]},
            {**settings, 'sections': settings['sections'] * 2},
            {**settings, 'sections': [{'type': 'mcq', 'count': 2, 'points': 1e308}]},
        ]
        for invalid in invalid_settings:
            with self.subTest(settings=invalid):
                loaded = self.store.load(a)
                loaded['state']['examSettings'] = invalid
                with self.assertRaises(AppError):
                    self.store.save(a, loaded['revision'], loaded['state'], loaded['bankRevision'])
                self.assertEqual((self.root / 'a' / 'records' / 'progress.json').read_bytes(), before)

    def test_switching_banks_with_identical_question_ids_keeps_records_separate(self):
        a, b = self.imported('a'), self.imported('b')
        state = self.store.load(a)['state']
        state['favoriteIds'] = ['q1']
        self.store.save(a, 0, state)
        self.assertEqual(self.store.load(b)['state']['favoriteIds'], [])
        self.assertEqual(self.store.load(a)['state']['favoriteIds'], ['q1'])
        reopened = BankStore(self.root / 'app-data')
        self.assertEqual(reopened.open(str(self.root / 'a'))['key'], a)

    def test_malformed_practice_answer_is_rejected_before_save(self):
        key = self.imported()
        state = self.store.load(key)['state']
        state['practiceSession'] = {'mode': 'bank', 'questionIds': ['q1'], 'index': 0, 'answered': {'q1': None}, 'optionOrder': {}}
        with self.assertRaises(AppError):
            self.store.save(key, 0, state)
        self.assertEqual(self.store.load(key)['revision'], 0)

    def test_multi_select_schema_validates_answer_sets_and_exam_sections(self):
        data=bundle();q=data['questions'][0];q['type']='multi';q.pop('answerId')
        q['answerIds']=['a','b'];data['bank']['exam']['sections']=[{'type':'multi','count':1,'points':3}]
        key=self.store.import_bank(str(self.root/'multi'),data)['key']
        self.assertEqual(self.store.load(key)['questions'][0]['answerIds'],['a','b'])
        for bad in [[],['a'],['a','a'],['a','x'],'a']:
            q['answerIds']=bad
            with self.assertRaises(AppError):validate_bank(data['bank'],data['questions'])

    def test_forget_bank_keeps_files_and_other_bank_registration(self):
        a=self.imported('a');b=self.imported('b')
        path=self.root/'a'/'records'/'progress.json';before=path.read_bytes()
        self.store.forget(a)
        self.assertEqual(path.read_bytes(),before)
        self.assertEqual([item['key'] for item in self.store.list()],[b])
        reopened=self.store.open(str(self.root/'a'))['key'];self.assertEqual(self.store.load(reopened)['state']['favoriteIds'],[])

    def test_delete_registration_needs_no_confirmation_and_preserves_all_files(self):
        key=self.imported();state=self.store.load(key)['state'];state['favoriteIds']=['q1'];self.store.save(key,0,state)
        root=self.root/'course';before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
        self.store.delete(key,'registration')
        after={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
        self.assertEqual(before,after);self.assertEqual(self.store.list(),[])
        reopened=self.store.open(str(root))['key'];self.assertEqual(self.store.load(reopened)['state']['favoriteIds'],['q1'])
        with self.assertRaises(AppError):self.store.delete(reopened,'records',True)

    def test_recent_banks_sort_by_actual_open_and_deduplicate_practice_counts(self):
        with patch('bank_store.time.time',return_value=1):a=self.imported('a')
        with patch('bank_store.time.time',return_value=2):b=self.imported('b')
        self.assertEqual([x['key'] for x in self.store.list()],[b,a])
        loaded=self.store.load(a);q=bundle()['questions'][0];fingerprint=json.dumps([q['prompt'],q['type'],q['options'],q['answerId']],ensure_ascii=False,separators=(',',':'))
        answer={'selectedId':'b','correct':True,'fingerprint':fingerprint}
        session={'mode':'bank','questionIds':['q1'],'index':0,'answered':{'q1':answer},'optionOrder':{'q1':['a','b']}}
        loaded['state']['practiceSession']=copy.deepcopy(session)
        loaded['state']['practiceSessionsByKey']={'bank':session,'source:g':{**copy.deepcopy(session),'mode':'source','sourceGroup':'g'}}
        loaded['state']['examHistory']=[{'id':'exam-a','submittedAt':100,'score':2},{'id':'exam-b','submittedAt':200,'score':0}]
        self.store.save(a,0,loaded['state'])
        with patch('bank_store.time.time',return_value=3):self.store.load(a,mark_opened=True)
        rows=self.store.list();self.assertEqual([x['key'] for x in rows],[a,b])
        self.assertEqual((rows[0]['questionCount'],rows[0]['practicedCount'],rows[0]['examCount']),(1,1,2))
        self.assertEqual(rows[0]['lastOpenedAt'],3000)
        # Merely listing/loading does not count as an explicit opening.
        self.store.load(b);self.assertEqual([x['key'] for x in self.store.list()],[a,b])
        changed=bundle()['questions'];changed[0]['prompt']='Changed'
        (self.root/'a'/'questions.json').write_text(json.dumps(changed))
        self.assertEqual(self.store.list()[0]['practicedCount'],0)

    def test_recent_list_keeps_unavailable_bank_without_misleading_zero_counts(self):
        a=self.imported('a');b=self.imported('b');(self.root/'a'/'questions.json').write_text('{broken')
        rows={item['key']:item for item in self.store.list()}
        self.assertIsNone(rows[a]['questionCount']);self.assertFalse(rows[a]['statsAvailable'])
        self.assertEqual(rows[b]['questionCount'],1)

    def test_delete_whole_bank_requires_confirmation_and_preserves_other_bank(self):
        a=self.imported('a');b=self.imported('b');other=BankStore(self.root/'app-data')
        with self.assertRaises(AppError):self.store.delete(a,'bank',False)
        self.assertTrue((self.root/'a').exists())
        result=self.store.delete(a,'bank',True)
        self.assertFalse((self.root/'a').exists())
        self.assertTrue((self.root/'app-data'/'deleted'/result['archiveId']/'bank'/'questions.json').exists())
        self.assertEqual([entry['key'] for entry in self.store.list()],[b])
        with self.assertRaises(AppError):other.load(a)

    def test_recreated_bank_cannot_accept_old_tab_saves(self):
        old_key=self.imported();loaded=self.store.load(old_key)
        self.store.delete(old_key,'bank',True)
        new_key=self.imported()
        self.assertNotEqual(old_key,new_key)
        loaded['state']['favoriteIds']=['q1']
        with self.assertRaises(AppError):self.store.save(old_key,0,loaded['state'],loaded['bankRevision'])
        self.assertEqual(self.store.load(new_key)['state']['favoriteIds'],[])

    def test_open_and_delete_are_serialized_across_services(self):
        key=self.imported();other=BankStore(self.root/'app-data');original=bank_store.validate_bank
        started=threading.Event()
        def slow_validate(*args):
            result=original(*args)
            if threading.current_thread().name.startswith('open-bank'):
                started.set();time.sleep(.15)
            return result
        results=[]
        thread=threading.Thread(name='open-bank',target=lambda:results.append(other.open(str(self.root/'course'))))
        with patch.object(bank_store,'validate_bank',slow_validate):
            thread.start();self.assertTrue(started.wait(2));self.store.delete(key,'bank',True);thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertFalse((self.root/'course').exists())
        self.assertEqual(self.store.list(),[])

    def test_atomic_save_and_previous_backup(self):
        key = self.imported()
        state = self.store.load(key)['state']
        state['favoriteIds'] = ['q1']
        self.store.save(key, 0, state)
        saved = self.root / 'course' / 'records' / 'progress.json'
        self.assertEqual(json.loads(saved.read_text())['revision'], 1)
        self.assertEqual(json.loads(saved.with_suffix('.json.bak').read_text())['revision'], 0)
        self.assertEqual(list(saved.parent.glob('*.tmp')), [])

    def test_stale_revision_cannot_erase_newer_answers(self):
        key = self.imported()
        state = self.store.load(key)['state']
        self.store.save(key, 0, state)
        with self.assertRaises(AppError) as ctx:
            self.store.save(key, 0, state)
        self.assertEqual(ctx.exception.status, 409)

    def test_corrupt_records_are_not_silently_reset(self):
        key = self.imported()
        path = self.root / 'course' / 'records' / 'progress.json'
        path.write_text('{broken')
        with self.assertRaises(AppError):
            self.store.load(key)
        self.assertEqual(path.read_text(), '{broken')

    def test_exam_snapshot_is_individual_file_and_same_id_is_not_counted_twice(self):
        key = self.imported()
        data = self.store.load(key)
        attempt = {'id': 'exam-1', 'submittedAt': 100, 'score': 2, 'maxScore': 2,
                   'questions': bundle()['questions'], 'questionIds': ['q1'], 'answers': {'q1': 'b'},
                   'optionOrder': {'q1': ['a', 'b']}}
        data['state']['examHistory'] = [attempt, copy.deepcopy(attempt)]
        self.store.save(key, 0, data['state'])
        self.assertEqual(len(self.store.load(key)['state']['examHistory']), 1)
        self.assertTrue((self.root / 'course' / 'records' / 'exams' / 'exam-1.json').exists())

    def test_question_edits_do_not_change_saved_paper(self):
        key = self.imported()
        state = self.store.load(key)['state']
        state['examHistory'] = [{'id': 'exam-1', 'submittedAt': 100, 'score': 2, 'questions': bundle()['questions']}]
        self.store.save(key, 0, state)
        questions = bundle()['questions']
        questions[0]['prompt'] = 'Changed'
        (self.root / 'course' / 'questions.json').write_text(json.dumps(questions))
        loaded = self.store.load(key)
        self.assertEqual(loaded['questions'][0]['prompt'], 'Changed')
        self.assertEqual(loaded['state']['examHistory'][0]['questions'][0]['prompt'], 'What is the answer?')

    def test_validate_rejects_wrong_answer_duplicate_ids_and_unsafe_source_path(self):
        for mutate in [lambda x: x['questions'][0].update(answerId='missing'),
                       lambda x: x['questions'].append(copy.deepcopy(x['questions'][0])),
                       lambda x: x['bank']['sources'][0].update(file='../secret.md')]:
            data = bundle()
            mutate(data)
            with self.assertRaises(AppError):
                validate_bank(data['bank'], data['questions'])

    def test_validation_accepts_all_material_formats(self):
        for kind, loc in [('pdf', 'page'), ('pptx', 'slide'), ('ppt', 'slide'), ('docx', 'section'),
                          ('doc', 'section'), ('md', 'line'), ('ipynb', 'cell')]:
            data = bundle()
            data['bank']['sources'][0]['kind'] = kind
            data['questions'][0]['locator'] = {'kind': loc, 'value': '1'}
            validate_bank(data['bank'], data['questions'])

    def test_malformed_active_exam_is_rejected_before_import_replaces_records(self):
        data = bundle()
        data['state'] = {'version': 1, 'masteryById': {}, 'favoriteIds': [], 'practiceSession': None,
                         'practiceSessionsByKey': {}, 'examHistory': [], 'examSession': {'questionIds': ['q1']}}
        with self.assertRaises(AppError):
            self.store.import_bank(str(self.root / 'malformed'), data)
        self.assertFalse((self.root / 'malformed').exists())

    def test_too_large_formatted_record_is_rejected_before_journal_or_progress_write(self):
        key = self.imported()
        state = self.store.load(key)['state']
        state['notes'] = ['x'] * 200
        self.assertLess(len(json.dumps({'revision': 1, 'state': state}, separators=(',', ':')).encode()), 1800)
        with patch.object(bank_store, 'MAX_JSON_BYTES', 1800):
            with self.assertRaises(AppError):
                self.store.save(key, 0, state)
        self.assertEqual(self.store.load(key)['revision'], 0)
        self.assertFalse((self.root/'course'/'records'/'pending-save.json').exists())

    def test_separate_service_instances_cannot_both_accept_the_same_revision(self):
        key = self.imported()
        other = BankStore(self.root/'app-data')
        state = self.store.load(key)['state']
        read = bank_store.read_json
        first_read = threading.Event()
        count = [0]
        guard = threading.Lock()
        def slow_read(path):
            result = read(path)
            if path.name == 'progress.json':
                with guard:
                    count[0] += 1
                    first = count[0] == 1
                if first:
                    first_read.set()
                    time.sleep(.15)
            return result
        def save(store):
            try:
                store.save(key, 0, state)
                return 'accepted'
            except AppError as exc:
                return exc.status
        with patch.object(bank_store, 'read_json', slow_read), ThreadPoolExecutor(2) as pool:
            a = pool.submit(save, self.store)
            self.assertTrue(first_read.wait(2))
            b = pool.submit(save, other)
            results = [a.result(), b.result()]
        self.assertCountEqual(results, ['accepted', 409])
        self.assertEqual(self.store.load(key)['revision'], 1)

    def test_pending_save_recovers_partial_multi_file_commit(self):
        key = self.imported()
        data = self.store.load(key)
        data['state']['favoriteIds'] = ['q1']
        records = self.root / 'course' / 'records'
        (records / 'pending-save.json').write_text(json.dumps({'revision': 1, 'state': data['state']}))
        self.assertEqual(self.store.load(key)['state']['favoriteIds'], ['q1'])
        self.assertFalse((records / 'pending-save.json').exists())


if __name__ == '__main__':
    unittest.main()
