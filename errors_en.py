"""English diagnostics for the local HTTP interface; original Chinese stays available."""
import re

MESSAGES = {
    '只允许本机访问。': 'Only local access is allowed.',
    '拒绝跨站请求。': 'Cross-site requests are not allowed.',
    '请求令牌失效，请刷新页面。': 'The request token has expired. Refresh the page.',
    '请求大小无效或超过 16 MB。': 'Invalid request size or request exceeds 16 MB.',
    '请求必须是 JSON。': 'The request must use JSON.',
    '请求 JSON 格式无效。': 'Invalid request JSON.',
    '文件不存在。': 'File not found.',
    '接口不存在。': 'Endpoint not found.',
    '数据结构无效，请检查题库或记录文件。': 'Invalid data structure. Check the bank or records file.',
    '示例不存在。': 'Sample not found.',
    '当前系统请使用浏览器选择题库 JSON 包。': 'Use the browser file input to choose a bank JSON package on this system.',
    '文件夹路径无效。': 'Invalid directory path.',
    '文件选择已超时，请重试。': 'File selection timed out. Try again.',
    '无法打开系统文件选择器，请重试。': 'Unable to open the system file picker. Try again.',
    '请选择题库 JSON 文件。': 'Choose a bank JSON file.',
    '题库包必须包含 bank 与 questions。': 'The package must contain bank and questions.',
    '当前系统请直接填写文件夹的完整路径。': 'Enter the full folder path on this system.',
    '文件夹选择已超时，请重试。': 'Folder selection timed out. Try again.',
    '来源文件必须是 sources/ 内的相对路径。': 'Source files must use safe relative paths inside sources/.',
    '题库 schemaVersion 必须为 1。': 'Bank schemaVersion must be 1.',
    'groups、sources 和 questions 必须是数组。': 'groups, sources and questions must be arrays.',
    '分组格式无效。': 'Invalid group.', '分组 id 重复。': 'Duplicate group ID.',
    '来源格式无效。': 'Invalid source.', '来源 id 重复。': 'Duplicate source ID.',
    '不支持的来源格式。': 'Unsupported source format.',
    '来源引用了不存在的分组。': 'A source references a missing group.',
    '来源 examEligible 必须为布尔值。': 'Source examEligible must be a boolean.',
    '题目必须是对象。': 'Questions must be objects.',
    '支持单选题 mcq、多选题 multi 和判断题 tf。': 'Supported question types: mcq, multi, tf.',
    '选项格式无效。': 'Invalid option.',
    '判断题必须有 true 和 false 两个选项。': 'True/false questions must have exactly the true and false option IDs.',
    '缺少 exam 配置。': 'Missing exam configuration.',
    'sampling 必须是 random 或 balanced。': 'sampling must be random or balanced.',
    'exam.sections 必须有 1–3 个题型。': 'exam.sections must contain 1–3 question types.',
    '考试题型无效。': 'Invalid exam question type.', '考试题型重复。': 'Duplicate exam question type.',
    'coverage 必须是数组。': 'coverage must be an array.',
    'coverage 来源不存在或不允许考试。': 'A coverage source is missing or not exam eligible.',
    'coverage 来源重复。': 'Duplicate coverage source.',
    'coverage 配额必须是对象。': 'Coverage quotas must be objects.',
    'coverage 题型不在考试配置中。': 'A coverage type is missing from the exam configuration.',
    '最低配额超过最高配额。': 'A minimum quota exceeds its maximum.',
    '最低配额之和超过考试题数。': 'Minimum quotas exceed the exam question count.',
    'mastery 格式无效。': 'Invalid mastery configuration.',
    'JSON 文件超过 16 MB。': 'JSON file exceeds 16 MB.',
    '数据不能序列化为有效 JSON。': 'Data cannot be serialized as valid JSON.',
    'JSON 文件超过 16 MB，未写入；请导出并缩减记录。': 'JSON exceeds 16 MB and was not written. Export and reduce the records.',
    '记录版本或格式不支持。': 'Unsupported records version or format.',
    '记录缺少必要字段。': 'Required record fields are missing.',
    '记录集合格式无效。': 'Invalid record collections.',
    '收藏记录格式无效。': 'Invalid favorite records.',
    '错题记录无效。': 'Invalid mastery record.', '错题状态无效。': 'Invalid mastery status.',
    '练习或考试会话无效。': 'Invalid practice or exam session.',
    '练习题目列表无效。': 'Invalid practice question list.',
    '练习作答集合无效。': 'Invalid practice answer collection.',
    '练习作答记录无效。': 'Invalid practice answer record.',
    '当前考试缺少完整题目快照。': 'The active exam lacks complete question snapshots.',
    '当前考试缺少答案、选项顺序或评分快照。': 'The active exam lacks answers, option order or scoring snapshots.',
    '当前考试题目快照无效。': 'Invalid active exam question snapshot.',
    '试卷选项无效。': 'Invalid paper options.', '试卷答案无效。': 'Invalid paper answer.',
    '试卷作答选项无效。': 'Invalid selected paper options.',
    '试卷选项顺序无效。': 'Invalid paper option order.',
    '考试截止时间无效。': 'Invalid exam deadline.',
    '考试题号超出试卷。': 'The exam question index is out of bounds.',
    '考试统计状态无效。': 'Invalid exam statistics state.',
    '已提交考试缺少成绩。': 'A submitted exam lacks its score.',
    '考试记录无效。': 'Invalid exam history record.',
    '同一考试 id 有不同内容。': 'Conflicting contents share an exam ID.',
    '题库登记文件损坏。': 'The bank registry is damaged.',
    '题库名称不能超过 200 个字符。': 'Bank names must be 200 characters or fewer.',
    '题库文件已更新，请刷新后再修改名称。': 'The bank files have changed. Refresh before renaming.',
    '题库未登记，请先打开题库文件夹。': 'Bank not registered. Open its folder first.',
    '请选择删除题库记录或删除整个题库。': 'Choose removal from recent banks or entire-bank deletion.',
    '删除操作需要确认。': 'Deletion requires explicit confirmation.',
    '彻底删除需要确认。': 'Permanent deletion requires explicit confirmation.',
    '回收站目录不能是符号链接。': 'The recycle bin directory must not be a symbolic link.',
    '回收站条目无效。': 'Invalid recycle bin item.',
    '回收站条目不能是符号链接。': 'A recycle bin item must not be a symbolic link.',
    '回收站条目不存在或已处理。': 'Recycle bin item missing or already processed.',
    '回收站信息无效。': 'Invalid recycle bin metadata.',
    '恢复路径无效。': 'Invalid restoration path.',
    '原文件夹已存在，无法恢复。请先移走该文件夹后重试；不会覆盖已有文件。': 'The original folder already exists. Move it aside and try again; existing files will not be overwritten.',
    '回收站题库文件夹无效。': 'Invalid bank folder in the recycle bin.',
    '题库不能包含应用数据目录。': 'The bank must not contain the app data directory.',
    'records 不能是符号链接。': 'records must not be a symbolic link.',
    '题库文件夹已移动或不存在，请重新打开题库文件夹。': 'Bank folder moved or missing. Open its folder again.',
    '请指定一个新文件夹或空文件夹；已有内容不会覆盖。': 'Choose a new or empty folder. Existing contents will not be overwritten.',
    '请选择 Lecture2Exam 导出的题库 JSON 包。': 'Choose a Lecture2Exam bank JSON package.',
    'records 中已有文件但缺少 progress.json；请先检查或恢复记录。': 'records contains files but lacks progress.json. Inspect or restore the records first.',
    '其他标签页已保存新记录。请先导出本页记录，再刷新；本次未覆盖磁盘记录。': 'Another tab has saved newer records. Export this page, then refresh. Saved records were not overwritten.',
    '题库文件已更新。请先导出本页记录，再刷新载入新题库。': 'The bank files have changed. Export this page, then refresh to load the updated bank.',
}
PREFIXES = {
    '题目 id 重复：': 'Duplicate question ID: ', '题目来源不存在：': 'Missing source for question: ',
    '题目必须有有效的来源定位：': 'Missing valid source locator for question: ',
    '选项数量必须为 2–8：': 'Options must number 2–8 for question: ',
    '选项 id 重复：': 'Duplicate option ID for question: ',
    '多选题 answerIds 必须引用至少两个不同的实际选项：': 'answerIds must reference at least two distinct valid options for question: ',
    '答案必须引用实际选项：': 'Answer must reference an actual option for question: ',
    '文件读写失败：': 'File operation failed: ',
}
LABELS = {'题库': 'bank', '来源': 'source', '分组': 'group', '题目': 'question', '选项': 'option',
          '课程名称': 'course name', '名称': 'name', '文件夹路径': 'folder path', '定位': 'locator',
          '题干': 'prompt', '解析': 'explanation', '知识点': 'concept', '记录': 'record', '考试': 'exam',
          '练习': 'practice', '收藏': 'favorite', '答案': 'answer', '时长': 'duration', '分值': 'points',
          '最低配额': 'minimum quota', '最高配额': 'maximum quota', '课程': 'course'}

def english_error(message):
    if message in MESSAGES:
        return MESSAGES[message]
    for prefix, english in PREFIXES.items():
        if message.startswith(prefix):
            return english + message[len(prefix):]
    for suffix, english in [(' 必须是稳定的字母、数字、点、下划线或短横线标识。', ' must be a stable identifier using letters, digits, dots, underscores or hyphens.'), (' 数值无效。', ' has an invalid numeric value.'), (' 不能为空。', ' must not be empty.')]:
        if message.endswith(suffix):
            label = message[:-len(suffix)]
            for term in sorted(LABELS, key=len, reverse=True):
                label = label.replace(term, LABELS[term] + ' ')
            label = re.sub(r'[\u3400-\u9fff]+', 'field ', label).strip()
            return label + english
    match = re.fullmatch(r'无法读取 (.+)；原文件未被重置。请检查格式或恢复备份。', message)
    if match:
        return 'Unable to read ' + match[1] + '. Original files were preserved. Check the format or restore a backup.'
    return 'Invalid bank or records. Check the JSON fields, sources, answer IDs and exam configuration.'
