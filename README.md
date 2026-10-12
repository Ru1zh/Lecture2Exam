[中文（默认）](https://github.com/Ru1zh/Lecture2Exam/blob/main/README.md) · [English](https://github.com/Ru1zh/Lecture2Exam/blob/main/README.en.md)

# Lecture2Exam

轻量、本地运行的课程练习与模拟考试工具。课程内容和考试规则都由题库文件配置，支持**单选、多选、判断题**，可以切换中文或英文界面。运行只需 Python 3.9+，使用 JSON 文件保存少量个人学习记录，无需数据库、Docker 或模型 API。

与 **[question-bank-builder](https://github.com/Ru1zh/question-bank-builder)** 配套使用：skill 在 Codex 中读取 PDF、PPT/PPTX、Word、Markdown、Jupyter 等课程材料，生成题库；Lecture2Exam 负责练习、考试和保存记录。二者可以分别下载，skill 的 CLI 可通过 `--app` 指定应用目录。

## 本地启动

- macOS：双击 `start.command`。
- Windows：安装 Python 后双击 `start.bat`，确保 `python` 可调用。
- Linux／其他系统：在项目目录执行 `python3 server.py --open`。
- 默认地址：`http://127.0.0.1:8765/`。端口占用时执行 `python3 server.py --port 8766 --open`。
- 关闭启动终端或按 Ctrl+C 停止服务。不要直接打开 `web/index.html`。

应用只监听本机。题目、公式显示与记录保存可离线使用；使用 Codex 生成题库时，联网和模型额度由出题工具管理。界面语言在右上角选择并保存在当前浏览器，默认中文；切换界面语言不会翻译题库内容。

## 项目目录结构

```text
Lecture2Exam/
├── server.py          # 本地服务入口
├── bank_store.py      # 题库与学习记录管理
├── bank_cli.py        # 题库命令行工具
├── start.command / start.bat  # 启动脚本
├── web/               # 网页界面与离线公式资源
├── examples/          # 示例题库
├── tests/             # 自动化测试
└── data/              # 本地运行数据，Git 忽略
```

## 题库位置

建议放在 **`~/Documents/Lecture2Exam-banks/课程题库/`（文档目录）**，与应用源码分开。创建／导入表单的路径默认为空，必须由用户主动选择文件夹或填写完整路径后才能初始化题库。

```text
课程题库/
├── bank.json          # 课程、分组、来源、考试规则
├── questions.json     # 题目、答案、解析、来源定位
├── sources/           # 原材料，可选
└── records/
    ├── progress.json  # 进度、错题、收藏、考试历史
    ├── progress.json.bak
    └── exams/         # 每次考试的独立快照
```

每个题库使用独立文件夹。切换现有题库时可直接打开，无需反复创建。

## 创建、打开、导入和删除

- **创建题库**：指定名称和新文件夹／空文件夹，创建后显示可复制给 Codex 的出题提示。skill 填充题目后点击“重新载入题库”。
- **打开题库文件夹**：打开已准备好的 `bank.json`、`questions.json` 和记录，继续学习。
- **导入题库**：将 `{bank,questions}` JSON 包导入新文件夹／空文件夹。已有内容不会覆盖。macOS 的 JSON 选择器从已填写的题库目录打开；目录尚不存在时使用最近的已有父目录，取消选择保留表单。其他平台选择 JSON 文件并填写目录路径。
- **最近使用的题库**：显示总题量、已练习题数（当前有效作答按题目去重）和考试记录次数，按最近打开时间从新到旧排列；可按名称片段搜索，不区分英文字母大小写，并显示所有匹配结果。查看列表／搜索不修改打开时间。旧登记没有时间戳时，下一次打开后开始记录。
- **删除题库记录**：直接从最近列表移除登记，不需要确认，题库文件和做题记录均保留；之后可重新打开原文件夹。
- **重命名**：在题库列表点击“重命名”，或在题库首页点击名称旁的铅笔图标。保存后同步更新名称，保留文件夹、题库标识和做题记录。其他打开旧版本的页面需刷新后继续保存记录。
- **删除整个题库**：需要确认，将整个题库及做题记录移入应用内回收站，从最近列表移除。
- **回收站**：在题库列表页打开，可恢复或彻底删除。恢复会放回原文件夹，保留课程材料、练习记录和历史试卷；原位置已有文件时会提示冲突，不覆盖。彻底删除需要再次确认，删除后无法恢复。此前保存在 `data/deleted/<archiveId>/` 的整库归档也会显示在回收站；回收站中的文件仍占磁盘空间。
- 首屏只有通用的多格式示例（8 题）。示例中的来源文件和定位用于展示格式，不代表已核查真实课程材料。

正常学习界面和最近列表不显示绝对路径；创建／打开／导入时保留路径输入以便选择目录。目录登记存于应用 `data/banks.json`；学习记录存于题库内。

## 用配套 skill 设置课程

将 `question-bank-builder` 下载到自己的 skills 位置，或在 Codex 中直接指定其 `SKILL.md` 路径。本项目不会自动安装 skill、修改全局配置或在网页内调用出题 CLI。

示例请求：

> 使用 question-bank-builder，为 COURSE101 的指定材料创建 120 题：60 单选、20 多选、40 判断；英文题干、中文解析。题库放入我指定的文档目录。考试抽取 20 单选、5 多选、10 判断，45 分钟，每类分值由我指定。附上可靠的来源定位，保留现有 records/。

可先用 skill 准备完整题库，再打开文件夹或导入 JSON 包；也可先在应用创建空题库，再由 skill 填充。两种方式都不需要给应用配置模型 API。旧 `.ppt`／`.doc` 的读取可能需要出题环境的转换工具，应用本身无需这些依赖。

配套 skill 自带题库格式说明，并在生成后校验格式。考试题量、时长、分值、材料排除和覆盖配额均可配置，不限定题量或满分 100。

```sh
python3 bank_cli.py create "/path/to/new-bank" --name "课程题库" --course "COURSE101"
python3 bank_cli.py validate "/path/to/bank"
python3 bank_cli.py export "/path/to/bank" --output "/path/to/course-bank.json"
python3 bank_cli.py import "/path/to/course-bank.json" --folder "/path/to/new-bank"
```

CLI 只校验和管理文件，不调用模型。

## 练习与考试

- 顺序／乱序、材料分组、错题、易错题、收藏分别保存进度。分组列表显示当前题号／总题数与已作答数量；导入记录后继续显示已恢复的进度。
- 单选／判断点击后判分。多选使用 `type:"multi"` 和 `answerIds`，选择完成后提交答案；**全部选对才得分，漏选、多选、错选均不得分**。考试中可修改选项，交卷后判分。
- 选项使用稳定 ID，显示顺序可随机。题干、选项、解释、知识点支持离线 KaTeX：文本用 `\(...\)`／`\[...\]`，JSON 需要转义反斜杠。
- 随机／均衡抽题、来源最低／最高配额。题数不足显示原因，不会悄悄减少考试题数。
- “开始模拟考试”弹窗右上角的**考试设置**可调整单选／多选／判断题的数量和每题分值、按分组选择范围及设置考试时间。数量设为 0 可不考该题型；实时显示总题数、满分和可用题量。自定义范围包括所选组内所有材料，并取代默认材料配额；设置按题库保存在做题记录中，刷新后保留，可恢复题库默认。已开始的考试和历史试卷不受影响。
- **考试方案**：在考试设置中输入名称，保存当前配置为方案；点击已保存的方案可一键应用，也可删除。方案按题库独立保存，修改当前设置或删除方案不会改写已保存的其他方案或试卷；同名方案不会覆盖。
- **待检查标记**：考试中可独立标记／取消标记题目，题号导航保留作答状态并显示标记；“检查待检查题”按题号循环跳转，交卷前提示剩余标记数。刷新后保留，标记不影响判分，到期仍自动交卷。
- 考试提交前隐藏答案；使用绝对截止时间，刷新、返回首页和切换题库不会暂停，到期自动提交。
- 练习与考试的错误次数共用；默认错三次进入易错题，易错题模式连续答对两次后清除累计错误。阈值可配置。
- 每次考试保留原题、选项、作答和分值快照，支持结果、整张试卷、错题、得分趋势及材料／知识点统计。当前题库修改不会改写历史试卷。
- 刷新恢复当前界面，浏览器返回／前进可以导航，重新选择题库默认显示首页。

## 记录和备份

磁盘 JSON 是正式记录。串行保存、跨进程文件锁、版本检查、原子替换、上一份 `.bak` 和恢复日志保护写入；旧标签页不能覆盖新记录或写入删除后重建的题库。保存失败时可重试、导出本页记录，浏览器尽力保留恢复草稿。单个 JSON 上限 16 MB，适合小型个人题库及少量考试历史。

- 修改题目时保留题库 ID 和 `records/`。重大概念／答案改变应使用新题目 ID。题目修改会使旧练习答案失效；历史和进行中的考试仍使用快照。
- 题库新增题目后，可重新开始相关练习，将新题加入已保存的题目顺序。
- 同一题库首页可导入导出的记录，确认后替换当前记录。导入旧的裸 `version:1` 文件会检查题目 ID，但没有题库 ID，用户必须确认属于该课程；不能仅凭相同 ID 判断课程。缺失的历史试卷不会被伪造。
- 分享题库用“导出题库”，不包含个人记录或原材料；整体备份则在停止服务后复制整个题库文件夹。
- 文件损坏不会自动重置。先备份损坏文件与可能存在的 `pending-save.json`，核查后再恢复完整的 `progress.json.bak`。

本工具面向个人学习，答案保存在本地可读文件中，不提供监考功能。

## 开发验证与许可证

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.js
# 可选：开发环境需要 Playwright 和 Chrome
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-smoke.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-features.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-manager.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-exam-settings.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-presets-flags.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-trash.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-rename.js
```

运行仅依赖 Python；Node／Playwright 仅用于开发测试。后端为 `bank_store.py`、`server.py` 和 `bank_cli.py`；前端为原生 HTML/CSS/JavaScript，`web/i18n.js` 管理界面语言。

采用 [MIT License](https://github.com/Ru1zh/Lecture2Exam/blob/main/LICENSE)。离线 KaTeX 及其原许可证保留于 `web/vendor/katex/`。
