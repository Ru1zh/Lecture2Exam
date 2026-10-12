"""Lecture2Exam bank validation and small, atomic JSON file store (stdlib only)."""
import copy
from contextlib import contextmanager
import hashlib
import json
import math
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path, PurePosixPath

MAX_JSON_BYTES = 16 * 1024 * 1024
ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$')
KINDS = {'pdf', 'ppt', 'pptx', 'doc', 'docx', 'md', 'ipynb', 'txt'}
LOCATORS = {'page', 'slide', 'section', 'line', 'cell'}


class AppError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def require(condition, message):
    if not condition:
        raise AppError(message)


def identifier(value, label):
    require(isinstance(value, str) and ID_RE.fullmatch(value) and value not in {'__proto__', 'constructor', 'prototype'}, label + ' 必须是稳定的字母、数字、点、下划线或短横线标识。')


def number(value, label, minimum=0, integer=False):
    require(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= minimum and (not integer or isinstance(value, int)), label + ' 数值无效。')


def text(value, label, empty=False):
    require(isinstance(value, str) and (empty or bool(value.strip())), label + ' 不能为空。')


def safe_relative(value):
    text(value, '来源文件名')
    path = PurePosixPath(value)
    require(not path.is_absolute() and '..' not in path.parts and '\\' not in value and '\x00' not in value, '来源文件必须是 sources/ 内的相对路径。')


def validate_bank(bank, questions):
    require(isinstance(bank, dict) and bank.get('schemaVersion') == 1, '题库 schemaVersion 必须为 1。')
    identifier(bank.get('id'), '题库 id')
    text(bank.get('name'), '题库名称')
    text(bank.get('course', ''), '课程名称', empty=True)
    groups = bank.get('groups')
    sources = bank.get('sources')
    require(isinstance(groups, list) and isinstance(sources, list) and isinstance(questions, list), 'groups、sources 和 questions 必须是数组。')
    group_ids, source_ids, question_ids = set(), set(), set()
    for group in groups:
        require(isinstance(group, dict), '分组格式无效。')
        identifier(group.get('id'), '分组 id')
        text(group.get('label'), '分组名称')
        require(group['id'] not in group_ids, '分组 id 重复。')
        group_ids.add(group['id'])
    for source in sources:
        require(isinstance(source, dict), '来源格式无效。')
        identifier(source.get('id'), '来源 id')
        require(source['id'] not in source_ids, '来源 id 重复。')
        source_ids.add(source['id'])
        safe_relative(source.get('file'))
        require(source.get('kind') in KINDS, '不支持的来源格式。')
        require(source.get('groupId') in group_ids, '来源引用了不存在的分组。')
        number(source.get('order'), '来源 order', 0, True)
        require(isinstance(source.get('examEligible'), bool), '来源 examEligible 必须为布尔值。')
    for q in questions:
        require(isinstance(q, dict), '题目必须是对象。')
        identifier(q.get('id'), '题目 id')
        require(q['id'] not in question_ids, '题目 id 重复：' + q['id'])
        question_ids.add(q['id'])
        require(q.get('type') in {'mcq', 'multi', 'tf'}, '支持单选题 mcq、多选题 multi 和判断题 tf。')
        require(q.get('sourceId') in source_ids, '题目来源不存在：' + q['id'])
        locator = q.get('locator')
        require(isinstance(locator, dict) and locator.get('kind') in LOCATORS, '题目必须有有效的来源定位：' + q['id'])
        text(locator.get('value'), '来源定位 value')
        for field in ('prompt', 'explanationZh', 'knowledgeZh'):
            text(q.get(field), q['id'] + ' 的 ' + field)
        options = q.get('options')
        require(isinstance(options, list) and 2 <= len(options) <= 8, '选项数量必须为 2–8：' + q['id'])
        option_ids = set()
        for option in options:
            require(isinstance(option, dict), '选项格式无效。')
            identifier(option.get('id'), '选项 id')
            text(option.get('text'), '选项文本')
            require(option['id'] not in option_ids, '选项 id 重复：' + q['id'])
            option_ids.add(option['id'])
        if q['type'] == 'multi':
            answers=q.get('answerIds')
            require(isinstance(answers,list) and len(answers)>=2 and all(isinstance(a,str) for a in answers) and len(set(answers))==len(answers) and set(answers)<=option_ids, '多选题 answerIds 必须引用至少两个不同的实际选项：'+q['id'])
        else:
            require(q.get('answerId') in option_ids, '答案必须引用实际选项：' + q['id'])
        if q['type'] == 'tf':
            require(option_ids == {'true', 'false'}, '判断题必须有 true 和 false 两个选项。')
    exam = bank.get('exam')
    require(isinstance(exam, dict), '缺少 exam 配置。')
    number(exam.get('durationMinutes'), '考试时长', 0.01)
    require(exam.get('sampling') in {'random', 'balanced'}, 'sampling 必须是 random 或 balanced。')
    sections = exam.get('sections')
    require(isinstance(sections, list) and 1 <= len(sections) <= 3, 'exam.sections 必须有 1–3 个题型。')
    types = set()
    for section in sections:
        require(isinstance(section, dict) and section.get('type') in {'mcq', 'multi', 'tf'}, '考试题型无效。')
        require(section['type'] not in types, '考试题型重复。')
        types.add(section['type'])
        number(section.get('count'), '题型数量', 1, True)
        number(section.get('points'), '每题分值', 0.01)
    coverage = exam.get('coverage', [])
    require(isinstance(coverage, list), 'coverage 必须是数组。')
    covered = set()
    eligible = {s['id'] for s in sources if s['examEligible']}
    for item in coverage:
        require(isinstance(item, dict) and item.get('sourceId') in eligible, 'coverage 来源不存在或不允许考试。')
        require(item['sourceId'] not in covered, 'coverage 来源重复。')
        covered.add(item['sourceId'])
        for field in ('minimum', 'maximum'):
            require(isinstance(item.get(field, {}), dict), 'coverage 配额必须是对象。')
            for kind, count in item.get(field, {}).items():
                require(kind in types, 'coverage 题型不在考试配置中。')
                number(count, 'coverage 配额', 0, True)
        for kind, count in item.get('minimum', {}).items():
            require(count <= item.get('maximum', {}).get(kind, math.inf), '最低配额超过最高配额。')
    for section in sections:
        require(sum(x.get('minimum', {}).get(section['type'], 0) for x in coverage) <= section['count'], '最低配额之和超过考试题数。')
    mastery = bank.get('mastery', {'wrongThreshold': 3, 'correctStreak': 2})
    require(isinstance(mastery, dict), 'mastery 格式无效。')
    number(mastery.get('wrongThreshold'), '易错题阈值', 1, True)
    number(mastery.get('correctStreak'), '掌握连续正确次数', 1, True)
    return bank, questions


def read_json(path):
    try:
        require(path.stat().st_size <= MAX_JSON_BYTES, 'JSON 文件超过 16 MB。')
        return json.loads(path.read_text(encoding='utf-8'))
    except AppError:
        raise
    except (OSError, ValueError) as exc:
        raise AppError('无法读取 ' + path.name + '；原文件未被重置。请检查格式或恢复备份。', 422) from exc


def serialized_json(data):
    try:
        serialized = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    except (ValueError, TypeError) as exc:
        raise AppError('数据不能序列化为有效 JSON。') from exc
    require(len(serialized.encode('utf-8')) <= MAX_JSON_BYTES, 'JSON 文件超过 16 MB，未写入；请导出并缩减记录。')
    return serialized


@contextmanager
def file_lock(path):
    """Serialize access across both threads and separate local services."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as handle:
        if os.name == 'nt':
            import msvcrt
            if path.stat().st_size == 0:
                handle.write(b'0')
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def atomic_write(path, data, backup=True):
    """Replace only complete, fsynced JSON; keep the prior complete version."""
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = serialized_json(data)
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '-', suffix='.tmp', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        if backup and path.exists():
            old = read_json(path)
            atomic_write(path.with_suffix(path.suffix + '.bak'), old, backup=False)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def default_state():
    return {'version': 1, 'masteryById': {}, 'favoriteIds': [], 'practiceSession': None,
            'practiceSessionsByKey': {}, 'examSession': None, 'examHistory': [], 'examSettings': None, 'examPresets': []}


def validate_exam_settings(settings):
    require(isinstance(settings, dict), '考试设置格式无效。')
    number(settings.get('durationMinutes'), '考试时长', .01)
    group_ids = settings.get('groupIds')
    require(isinstance(group_ids, list) and group_ids, '请至少选择一个考试分组。')
    for group_id in group_ids:
        identifier(group_id, '考试分组 id')
    require(len(set(group_ids)) == len(group_ids), '考试分组重复。')
    sections = settings.get('sections')
    require(isinstance(sections, list) and 1 <= len(sections) <= 3, '考试设置必须包含 1–3 个题型。')
    types = set()
    for section in sections:
        require(isinstance(section, dict) and section.get('type') in {'mcq', 'multi', 'tf'}, '考试题型无效。')
        require(section['type'] not in types, '考试题型重复。')
        types.add(section['type'])
        number(section.get('count'), '题型数量', 1, True)
        number(section.get('points'), '每题分值', .01)
    number(settings['durationMinutes'] * 60000, '考试时长')
    number(sum(s['count'] * s['points'] for s in sections), '考试总分', .01)

def validate_state(state):
    require(isinstance(state, dict) and state.get('version') == 1, '记录版本或格式不支持。')
    require(isinstance(state.get('masteryById'), dict) and isinstance(state.get('favoriteIds'), list)
            and isinstance(state.get('practiceSessionsByKey'), dict) and isinstance(state.get('examHistory'), list), '记录集合格式无效。')
    require(all(isinstance(x, str) for x in state['favoriteIds']), '收藏记录格式无效。')
    settings = state.get('examSettings')
    if settings is not None:
        validate_exam_settings(settings)
    presets = state.get('examPresets', [])
    require(isinstance(presets, list), '考试方案格式无效。')
    preset_ids, preset_names = set(), set()
    for preset in presets:
        require(isinstance(preset, dict), '考试方案格式无效。')
        identifier(preset.get('id'), '考试方案 id')
        text(preset.get('name'), '考试方案名称')
        require(len(preset['name'].strip()) <= 80, '考试方案名称过长。')
        name = preset['name'].strip().lower()
        require(preset['id'] not in preset_ids and name not in preset_names, '考试方案 id 或名称重复。')
        preset_ids.add(preset['id']); preset_names.add(name)
        validate_exam_settings(preset.get('settings'))
    for record in state['masteryById'].values():
        require(isinstance(record, dict), '错题记录无效。')
        for field in ('wrongCount', 'masteryStreak'):
            number(record.get(field), field, 0, True)
        require(isinstance(record.get('inWrongSet'), bool) and isinstance(record.get('errorProne'), bool), '错题状态无效。')
    for session in [state.get('practiceSession'), state.get('examSession')] + list(state['practiceSessionsByKey'].values()):
        if session is not None:
            require(isinstance(session, dict) and isinstance(session.get('questionIds'), list), '练习或考试会话无效。')
    for session in [state.get('practiceSession')] + list(state['practiceSessionsByKey'].values()):
        if session is None:
            continue
        require(all(isinstance(qid, str) for qid in session['questionIds']), '练习题目列表无效。')
        require(isinstance(session.get('answered', {}), dict) and isinstance(session.get('optionOrder', {}), dict), '练习作答集合无效。')
        for answer in session.get('answered', {}).values():
            require(isinstance(answer, dict) and (isinstance(answer.get('selectedId'),str) or (isinstance(answer.get('selectedIds'),list) and answer['selectedIds'] and all(isinstance(a,str) for a in answer['selectedIds']) and len(set(answer['selectedIds']))==len(answer['selectedIds']))), '练习作答记录无效。')
    exam = state.get('examSession')
    if exam is not None:
        identifier(exam.get('id'), '当前考试 id')
        flags = exam.get('flaggedIds', [])
        require(isinstance(flags, list) and all(isinstance(x, str) for x in flags)
                and len(set(flags)) == len(flags) and set(flags) <= set(exam['questionIds']), '待检查标记必须引用当前试卷题目。')
        snapshots = exam.get('questions')
        require(isinstance(snapshots, list) and snapshots and len(snapshots) == len(exam['questionIds']) and len(set(exam['questionIds'])) == len(exam['questionIds']), '当前考试缺少完整题目快照。')
        require(isinstance(exam.get('answers'), dict) and isinstance(exam.get('optionOrder'), dict) and isinstance(exam.get('pointsByType'), dict), '当前考试缺少答案、选项顺序或评分快照。')
        for q, qid in zip(snapshots, exam['questionIds']):
            require(isinstance(q, dict) and q.get('id') == qid and q.get('type') in {'mcq', 'multi', 'tf'}, '当前考试题目快照无效。')
            identifier(qid, '试卷题目 id')
            text(q.get('prompt'), '试卷题干')
            options = q.get('options')
            require(isinstance(options, list) and len(options) >= 2 and all(isinstance(o, dict) and isinstance(o.get('id'), str) and isinstance(o.get('text'), str) for o in options), '试卷选项无效。')
            ids = [o['id'] for o in options]
            expected=q.get('answerIds') if q['type']=='multi' else [q.get('answerId')]
            require(len(set(ids))==len(ids) and isinstance(expected,list) and all(isinstance(a,str) for a in expected) and len(expected)>=(2 if q['type']=='multi' else 1) and len(set(expected))==len(expected) and set(expected)<=set(ids), '试卷答案无效。')
            selected=exam['answers'].get(qid)
            require(selected is None or (isinstance(selected,list) and q['type']=='multi' and all(isinstance(a,str) for a in selected) and len(set(selected))==len(selected) and set(selected)<=set(ids)) or (q['type']!='multi' and selected in ids), '试卷作答选项无效。')
            order = exam['optionOrder'].get(qid)
            require(isinstance(order, list) and len(order) == len(ids) and all(isinstance(x, str) for x in order) and set(order) == set(ids), '试卷选项顺序无效。')
            number(exam['pointsByType'].get(q['type']), '试卷分值', .01)
        number(exam.get('startedAt'), '考试开始时间')
        number(exam.get('deadline'), '考试截止时间')
        require(exam['deadline'] > exam['startedAt'], '考试截止时间无效。')
        number(exam.get('currentIndex'), '考试题号', 0, True)
        require(exam['currentIndex'] < len(snapshots), '考试题号超出试卷。')
        number(exam.get('maxScore'), '试卷满分', .01)
        require(isinstance(exam.get('statsApplied'), bool), '考试统计状态无效。')
        if exam.get('submittedAt') is not None:
            number(exam.get('submittedAt'), '考试提交时间')
            require(isinstance(exam.get('score'), dict), '已提交考试缺少成绩。')
    seen, history = set(), []
    for attempt in state['examHistory']:
        require(isinstance(attempt, dict), '考试记录无效。')
        identifier(attempt.get('id'), '考试 id')
        number(attempt.get('submittedAt'), '提交时间')
        number(attempt.get('score'), '考试成绩')
        if attempt['id'] in seen:
            require(next(x for x in history if x['id'] == attempt['id']) == attempt, '同一考试 id 有不同内容。')
        else:
            seen.add(attempt['id'])
            history.append(attempt)
    state = copy.deepcopy(state)
    state['examHistory'] = history
    return state


class BankStore:
    def __init__(self, data_dir):
        self.data_dir = Path(data_dir).resolve()
        self.registry_path = self.data_dir / 'banks.json'
        self.lock = threading.RLock()
        self.registry = read_json(self.registry_path) if self.registry_path.exists() else {'banks': {}}
        require(isinstance(self.registry, dict) and isinstance(self.registry.get('banks'), dict), '题库登记文件损坏。')

    def _register_unlocked(self, root, bank):
        self.registry = read_json(self.registry_path) if self.registry_path.exists() else {'banks': {}}
        # Keep an opened bank's key stable, but never reuse a deleted registration.
        # A replacement at the same path must not accept writes from an old tab.
        key = next((key for key, entry in self.registry['banks'].items() if entry['path'] == str(root)), uuid.uuid4().hex[:24])
        self.registry['banks'][key] = {'key': key, 'path': str(root), 'name': bank['name'], 'course': bank.get('course', ''), 'bankId': bank['id'], 'lastOpenedAt': int(time.time() * 1000)}
        atomic_write(self.registry_path, self.registry)
        return self.registry['banks'][key]

    def list(self):
        with self.lock, file_lock(self.data_dir / '.registry.lock'):
            if self.registry_path.exists():
                self.registry = read_json(self.registry_path)
            entries = [dict(entry) for entry in self.registry['banks'].values()]
            # Sorting/querying the list never changes an opening timestamp.
            entries.reverse()  # Old registries have no timestamps; newest registration first.
            entries.sort(key=lambda entry: entry.get('lastOpenedAt', 0), reverse=True)
            for entry in entries:
                entry.update(questionCount=None, practicedCount=None, examCount=None, statsAvailable=False)
                try:
                    root = self._root(entry['key'])
                    with file_lock(root / 'records' / '.write.lock'):
                        loaded = self._load_unlocked(entry['key'])
                    entry.update(name=loaded['bank']['name'], course=loaded['bank'].get('course', ''))
                    by_id = {q['id']: q for q in loaded['questions']}
                    practiced = set()
                    state = loaded['state']
                    sessions = [state.get('practiceSession')] + list(state['practiceSessionsByKey'].values())
                    for session in sessions:
                        if not session:
                            continue
                        for qid, response in session.get('answered', {}).items():
                            q = by_id.get(qid)
                            if not q:
                                continue
                            correct = sorted(q['answerIds']) if q['type'] == 'multi' else q['answerId']
                            try:
                                if json.loads(response.get('fingerprint', 'null')) != [q['prompt'], q['type'], q['options'], correct]:
                                    continue
                            except (TypeError, ValueError):
                                continue
                            selected = response.get('selectedIds', response.get('selectedId'))
                            choices = selected if isinstance(selected, list) else [selected]
                            if choices and all(choice in {o['id'] for o in q['options']} for choice in choices):
                                practiced.add(qid)
                    entry.update(questionCount=len(by_id), practicedCount=len(practiced), examCount=len(state['examHistory']), statsAvailable=True)
                except (AppError, OSError, KeyError, TypeError, ValueError):
                    # One moved/damaged bank must not hide the rest of the registry.
                    pass
            return entries

    def forget(self, key):
        # Remove only the registry entry; personal folders and records stay intact.
        with self.lock, file_lock(self.data_dir / '.registry.lock'):
            self.registry=read_json(self.registry_path) if self.registry_path.exists() else {'banks':{}}
            if key not in self.registry['banks']:
                raise AppError('题库未登记，请先打开题库文件夹。',404)
            del self.registry['banks'][key]
            atomic_write(self.registry_path,self.registry)
        return {'removed':True}

    def delete(self, key, scope, confirmed=False):
        require(scope in {'registration', 'bank'}, '请选择删除题库记录或删除整个题库。')
        if scope == 'registration':
            return self.forget(key)
        require(confirmed is True, '删除操作需要确认。')
        # All readers/writers share the registry lock across service processes.
        # Release the bank file lock before moving its directory (Windows-safe).
        with self.lock, file_lock(self.data_dir / '.registry.lock'):
            root = self._root(key)
            require(not self.data_dir.is_relative_to(root), '题库不能包含应用数据目录。')
            require(not (root / 'records').is_symlink(), 'records 不能是符号链接。')
            with file_lock(root / 'records' / '.write.lock'):
                loaded = self._load_unlocked(key)
            archive_id = str(uuid.uuid4())
            trash = self.data_dir / 'deleted'
            require(not trash.is_symlink(), '回收站目录不能是符号链接。')
            archive = trash / archive_id
            archive.mkdir(parents=True)
            atomic_write(archive / 'info.json', {'scope': scope, 'originalPath': str(root), 'bankId': loaded['bank']['id'],
                         'name': loaded['bank']['name'], 'course': loaded['bank'].get('course', ''),
                         'deletedAt': int(time.time() * 1000)}, False)
            destination = archive / 'bank'
            shutil.move(str(root), str(destination))
            try:
                del self.registry['banks'][key]
                atomic_write(self.registry_path, self.registry)
            except Exception:
                shutil.move(str(destination), str(root))
                raise
            return {'deleted': scope, 'archiveId': archive_id}

    def _trash_archive(self, item_id):
        require(isinstance(item_id, str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', item_id), '回收站条目无效。')
        trash = self.data_dir / 'deleted'
        require(not trash.is_symlink(), '回收站目录不能是符号链接。')
        archive = trash / item_id
        require(not archive.is_symlink(), '回收站条目不能是符号链接。')
        if not archive.is_dir():
            raise AppError('回收站条目不存在或已处理。', 404)
        return archive

    def list_trash(self):
        with self.lock, file_lock(self.data_dir / '.registry.lock'):
            trash = self.data_dir / 'deleted'
            require(not trash.is_symlink(), '回收站目录不能是符号链接。')
            entries = []
            for archive in trash.iterdir() if trash.exists() else []:
                try:
                    archive = self._trash_archive(archive.name)
                    if not (archive / 'bank').is_dir() or (archive / 'bank').is_symlink():
                        continue
                    info = read_json(archive / 'info.json')
                    require(isinstance(info, dict), '回收站信息无效。')
                    bank = read_json(archive / 'bank' / 'bank.json')
                    deleted_at = info.get('deletedAt')
                    if not isinstance(deleted_at, (int, float)) or isinstance(deleted_at, bool) or not math.isfinite(deleted_at) or deleted_at < 0:
                        deleted_at = None
                    entries.append({'id': archive.name, 'name': bank.get('name', info.get('name', archive.name)),
                                    'course': bank.get('course', info.get('course', '')),
                                    'originalPath': info.get('originalPath', ''), 'deletedAt': deleted_at})
                except (AppError, OSError, KeyError, TypeError, ValueError, AttributeError):
                    # Damaged metadata must not hide other deleted banks.
                    continue
            entries.sort(key=lambda entry: entry.get('deletedAt') or 0, reverse=True)
            return entries

    def restore_trash(self, item_id):
        with self.lock, file_lock(self.data_dir / '.registry.lock'):
            archive = self._trash_archive(item_id)
            info = read_json(archive / 'info.json')
            require(isinstance(info, dict) and isinstance(info.get('originalPath'), str), '回收站信息无效。')
            root = Path(info['originalPath'])
            require(root.is_absolute() and root == root.resolve() and not self.data_dir.is_relative_to(root), '恢复路径无效。')
            if root.exists() or root.is_symlink():
                raise AppError('原文件夹已存在，无法恢复。请先移走该文件夹后重试；不会覆盖已有文件。', 409)
            source = archive / 'bank'
            require(source.is_dir() and not source.is_symlink() and not (source / 'records').is_symlink(), '回收站题库文件夹无效。')
            bank, _ = validate_bank(read_json(source / 'bank.json'), read_json(source / 'questions.json'))
            root.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(root))
            try:
                entry = self._register_unlocked(root, bank)
            except Exception:
                shutil.move(str(root), str(source))
                self.registry = read_json(self.registry_path) if self.registry_path.exists() else {'banks': {}}
                raise
            # Restored files are already safely registered; empty archive cleanup
            # must not turn a successful restore into a misleading failure.
            try:
                shutil.rmtree(archive)
            except OSError:
                pass
            return entry

    def purge_trash(self, item_id, confirmed=False):
        require(confirmed is True, '彻底删除需要确认。')
        with self.lock, file_lock(self.data_dir / '.registry.lock'):
            archive = self._trash_archive(item_id)
            shutil.rmtree(archive)
            return {'purged': True}

    def _root(self, key):
        self.registry = read_json(self.registry_path) if self.registry_path.exists() else {'banks': {}}
        entry = self.registry['banks'].get(key)
        if not entry:
            raise AppError('题库未登记，请先打开题库文件夹。', 404)
        root = Path(entry['path'])
        if not root.is_dir():
            raise AppError('题库文件夹已移动或不存在，请重新打开题库文件夹。', 404)
        return root

    def _prepare_target(self, path):
        text(path, '题库文件夹路径')
        root = Path(path).expanduser().resolve()
        require(not root.exists() or (root.is_dir() and not any(root.iterdir())), '请指定一个新文件夹或空文件夹；已有内容不会覆盖。')
        root.mkdir(parents=True, exist_ok=True)
        (root / 'sources').mkdir()
        (root / 'records' / 'exams').mkdir(parents=True)
        return root

    def create(self, path, name, course=''):
        text(name, '题库名称')
        text(course, '课程', empty=True)
        data = {'schemaVersion': 1, 'id': 'bank-' + str(uuid.uuid4()), 'name': name, 'course': course,
                'description': '', 'groups': [], 'sources': [],
                'exam': {'durationMinutes': 60, 'sampling': 'random', 'sections': [{'type': 'mcq', 'count': 20, 'points': 4}, {'type': 'tf', 'count': 20, 'points': 1}], 'coverage': []},
                'mastery': {'wrongThreshold': 3, 'correctStreak': 2}}
        return self.import_bank(path, {'bank': data, 'questions': []})

    def import_bank(self, path, bundle):
        require(isinstance(bundle, dict), '请选择 Lecture2Exam 导出的题库 JSON 包。')
        bank, questions = validate_bank(bundle.get('bank'), bundle.get('questions'))
        state = validate_state(bundle['state']) if 'state' in bundle else default_state()
        for payload in [bank, questions, {'revision': 0, 'state': state}]:
            serialized_json(payload)
        with self.lock, file_lock(self.data_dir / '.registry.lock'):
            root = self._prepare_target(path)
            atomic_write(root / 'bank.json', bank, False)
            atomic_write(root / 'questions.json', questions, False)
            atomic_write(root / 'records' / 'progress.json', {'revision': 0, 'state': state}, False)
            for attempt in state['examHistory']:
                atomic_write(root / 'records' / 'exams' / (attempt['id'] + '.json'), attempt, False)
            return self._register_unlocked(root, bank)

    def open(self, path):
        with self.lock, file_lock(self.data_dir / '.registry.lock'):
            root = Path(path).expanduser().resolve()
            bank, questions = validate_bank(read_json(root / 'bank.json'), read_json(root / 'questions.json'))
            # Opening imported material never resets existing records.
            if not (root / 'records' / 'progress.json').exists():
                if (root / 'records').exists() and any((root / 'records').iterdir()):
                    raise AppError('records 中已有文件但缺少 progress.json；请先检查或恢复记录。', 422)
                (root / 'records' / 'exams').mkdir(parents=True, exist_ok=True)
                atomic_write(root / 'records' / 'progress.json', {'revision': 0, 'state': default_state()}, False)
            return self._register_unlocked(root, bank)

    def _finish_commit(self, root, envelope):
        number(envelope.get('revision'), '记录 revision', 0, True)
        state = validate_state(envelope.get('state'))
        for attempt in state['examHistory']:
            path = root / 'records' / 'exams' / (attempt['id'] + '.json')
            if not path.exists() or read_json(path) != attempt:
                atomic_write(path, attempt)
        atomic_write(root / 'records' / 'progress.json', {'revision': envelope['revision'], 'state': state})

    def _recover(self, root):
        pending = root / 'records' / 'pending-save.json'
        if pending.exists():
            envelope = read_json(pending)
            self._finish_commit(root, envelope)
            pending.unlink()

    def load(self, key, mark_opened=False):
        with self.lock, file_lock(self.data_dir / '.registry.lock'), file_lock(self._root(key) / 'records' / '.write.lock'):
            loaded = self._load_unlocked(key)
            if mark_opened:
                self.registry['banks'][key].update(name=loaded['bank']['name'], course=loaded['bank'].get('course', ''), lastOpenedAt=int(time.time() * 1000))
                atomic_write(self.registry_path, self.registry)
            return loaded

    def _load_unlocked(self, key):
        root = self._root(key)
        bank, questions = validate_bank(read_json(root / 'bank.json'), read_json(root / 'questions.json'))
        self._recover(root)
        envelope = read_json(root / 'records' / 'progress.json')
        number(envelope.get('revision'), '记录 revision', 0, True)
        state = validate_state(envelope.get('state'))
        signature = hashlib.sha256(json.dumps([bank, questions], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        return {'key': key, 'path': str(root), 'bank': bank, 'questions': questions, 'revision': envelope['revision'], 'bankRevision': signature, 'state': state}


    def save(self, key, revision, state, bank_revision=None):
        with self.lock, file_lock(self.data_dir / '.registry.lock'), file_lock(self._root(key) / 'records' / '.write.lock'):
            loaded = self._load_unlocked(key)
            if revision != loaded['revision']:
                raise AppError('其他标签页已保存新记录。请先导出本页记录，再刷新；本次未覆盖磁盘记录。', 409)
            if bank_revision is not None and bank_revision != loaded['bankRevision']:
                raise AppError('题库文件已更新。请先导出本页记录，再刷新载入新题库。', 409)
            state = validate_state(state)
            root = self._root(key)
            envelope = {'revision': revision + 1, 'state': state}
            atomic_write(root / 'records' / 'pending-save.json', envelope, False)
            self._finish_commit(root, envelope)
            (root / 'records' / 'pending-save.json').unlink()
            return {'revision': revision + 1}
