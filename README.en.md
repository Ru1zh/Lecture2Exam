[中文（默认）](https://github.com/Ru1zh/Lecture2Exam/blob/main/README.md) · [English](https://github.com/Ru1zh/Lecture2Exam/blob/main/README.en.md)

# Lecture2Exam

A lightweight local practice and mock-exam app. Course content and exam rules live in bank files. Supports **single-choice, multiple-choice, and true/false questions**, with Chinese and English interface options. Python 3.9+ is the only runtime requirement. Small personal learning histories use JSON files; no database, Docker, or model API is required.

Use it with **[question-bank-builder](https://github.com/Ru1zh/question-bank-builder)**. The companion skill reads PDF, PowerPoint, Word, Markdown, Jupyter and text course materials in Codex and creates a grounded bank. Lecture2Exam runs practice and exams and saves learning records. Download them separately if preferred; the skill's CLI accepts `--app` to locate this checkout.

## Run locally

- macOS: double-click `start.command`.
- Windows: install Python and double-click `start.bat`; `python` must be on PATH.
- Linux / other systems: run `python3 server.py --open` from this directory.
- Default URL: `http://127.0.0.1:8765/`. For a busy port, run `python3 server.py --port 8766 --open`.
- Close the terminal or press Ctrl+C to stop. Do not open `web/index.html` directly.

The server listens only on the local machine. Study, formulas and record saving work offline. Codex manages its own network and model usage when generating a bank. Choose the interface language at the top right; it persists in your browser and defaults to Chinese. It does not translate course content.

## Project structure

```text
Lecture2Exam/
├── server.py          # Local server entry point
├── bank_store.py      # Bank and learning-record storage
├── bank_cli.py        # Bank CLI
├── start.command / start.bat  # Launchers
├── web/               # Web interface and offline formula resources
├── examples/          # Sample banks
├── tests/             # Automated tests
└── data/              # Local runtime data, ignored by Git
```

## Where should banks live?

Prefer **`~/Documents/Lecture2Exam-banks/course-bank/`**, outside the source checkout. This is a suggestion only. Create/import forms start with an empty path and require you to choose a folder or enter its full path before initialization. App updates and public source uploads stay separate from private questions and records. Other user-selected folders also work.

```text
course-bank/
├── bank.json          # Course, groups, sources, exam rules
├── questions.json     # Questions, answers, explanations, source locators
├── sources/           # Optional original materials
└── records/
    ├── progress.json  # Progress, mistakes, favorites, exam history
    ├── progress.json.bak
    └── exams/         # Independent snapshots of completed papers
```

Each bank has an independent folder. Switching back to an existing bank does not require creating another folder.

## Create, open, import and delete

- **Create bank:** choose a name and a new or empty folder. Copy the generated setup prompt into Codex, populate the bank with the skill, then reload it.
- **Open bank folder:** open prepared bank files and resume their records.
- **Import bank:** import a `{bank,questions}` JSON package into a new or empty folder. Existing contents are not overwritten. On macOS, the native JSON picker starts at the entered bank directory or its closest existing parent. Canceling preserves the form. Other platforms use a browser file input and typed directory path.
- **Recent banks:** show total questions, unique practiced questions with valid current answers, and exam-history count. Banks sort by most recent explicit opening. Case-insensitive partial-name search shows all matching banks. Listing/searching does not change opening times. Older registrations without a timestamp start tracking on their next opening.
- **Remove bank from recents:** immediately removes only its registration, without confirmation. Questions and learning records stay intact; reopen its original folder later.
- **Delete entire bank:** requires confirmation and moves the whole bank and its learning records to the app's recycle bin, removing it from recents.
- **Recycle bin:** open it from the bank manager to restore or permanently delete a bank. Restoration returns all materials, records and historical papers to the original folder. An occupied location is rejected without overwriting files. Permanent deletion requires another confirmation and cannot be undone. Previous whole-bank archives in `data/deleted/<archiveId>/` also appear here. Recycled files still use disk space.
- The only bundled sample is a generic eight-question, multi-format bank. Its source names and locators demonstrate the format and do not represent verified course materials.

Absolute paths are hidden from normal study and recent-bank views. Directory inputs remain visible where choosing a folder is necessary. App registration lives in `data/banks.json`; learning records live inside each bank.

## Use the companion skill

Download `question-bank-builder` into your chosen skills location or explicitly reference its `SKILL.md` in Codex. This app does not install skills, change global settings, or invoke an authoring CLI from the browser.

Example request:

> Use question-bank-builder for the selected COURSE101 materials. Create 120 questions: 60 single-choice, 20 multiple-choice and 40 true/false, with English prompts and Chinese explanations. Use my selected Documents folder. Sample 20 single-choice, 5 multiple-choice and 10 true/false questions for a 45-minute exam, with points I specify. Include reliable source locators and preserve existing records/.

Prepare the bank first and open/import it, or create an empty bank in the app and populate it with the skill. Neither workflow requires a model API in the app. Reading old `.ppt` / `.doc` files may require conversion tools in the authoring environment, not in the app runtime.

The companion skill includes the bank format guide and validates generated banks. Configure counts, duration, points, source exclusions and coverage in data; neither a fixed question count nor a 100-point maximum is required.

```sh
python3 bank_cli.py create "/path/to/new-bank" --name "Course bank" --course "COURSE101"
python3 bank_cli.py validate "/path/to/bank"
python3 bank_cli.py export "/path/to/bank" --output "/path/to/course-bank.json"
python3 bank_cli.py import "/path/to/course-bank.json" --folder "/path/to/new-bank"
```

The CLI validates and manages files; it does not call a model.

## Practice and exams

- Independent progress for sequential, shuffled, grouped, wrong-answer, frequent-error and favorite practice. Group rows show the current/total question position and answered count, including after record import.
- Single-choice / true-false answers are graded immediately. Multiple-choice uses `type:"multi"` and `answerIds`; select options, then submit the practice answer. **Only the exact correct set earns points; missing, extra or wrong selections earn zero.** Exam selections remain editable until paper submission.
- Stable option IDs support shuffled display order. Offline KaTeX renders formulas in prompts, options, explanations and concepts. Use `\(...\)` / `\[...\]` in text and escape backslashes in JSON.
- Random / balanced sampling respects source minima and maxima. Insufficient pools display an explanation and never silently shrink an exam.
- **Exam settings** in the upper right of the start-exam dialog lets you set single-choice, multiple-choice and true/false counts and points, select practice groups, and change the time limit. Zero counts omit a type; totals and available pools update live. Custom scope includes all materials in the selected groups and replaces default source quotas. Preferences are stored separately for each bank in learning records, survive reload, and can be reset to bank defaults. Active and historical exams retain their original snapshots.
- **Exam presets**: name and save configurations in exam settings, apply one with a click, or delete it. Presets are isolated per bank and retain independent settings snapshots. Editing current settings or deleting a preset does not alter saved papers. Duplicate names are rejected.
- **Review flags**: flag or unflag any live question independently of its answer. The navigator shows both states, the review action cycles through flagged questions, and submission reminds you about remaining flags. Flags survive refresh and remain in paper snapshots; they do not affect scoring or pause the deadline.
- Answers stay hidden until exam submission. An absolute deadline continues through reloads, navigation and bank switching, with automatic submission at expiry.
- Practice and exams share error counts. Defaults: three errors enter frequent-error training; two consecutive correct answers there clear accumulated errors. Thresholds are configurable.
- Exam snapshots retain original questions, order, selections and points. Results, full-paper / wrong-answer review, trends and source / concept statistics remain valid after bank edits.
- Reload restores the current view; browser back/forward navigates normally. Newly selecting a bank opens its home view.

## Records, backups and public-source privacy

Disk JSON is authoritative. A serialized save queue, cross-process locks, revision checks, atomic replacement, previous `.bak` files and a recovery journal protect writes. Stale tabs cannot overwrite newer records or write to a deleted bank recreated at the same path. Failed saves offer retry and record export; the browser also attempts draft recovery. Each JSON file is limited to 16 MB, suitable for small personal banks and a few exam attempts.

- Preserve the bank ID and `records/` when editing questions. Give materially different concepts/answers new question IDs. Edited questions invalidate cached practice answers; current and historical exams retain snapshots.
- Restart a practice mode to include newly added questions in its saved order.
- Import exported records on the matching bank's home page. Confirmation replaces current records. Legacy raw `version:1` files are checked against current question IDs but lack a bank ID: explicitly confirm they belong to this course. Overlapping IDs do not prove course identity. Missing historical papers are not fabricated.
- Export a bank package to share questions without personal records or raw materials. Stop the server and copy the whole bank folder for a complete backup.
- Corrupt files are not silently reset. Preserve damaged files and any `pending-save.json`, inspect them, then restore a verified `progress.json.bak`.
- `.gitignore` excludes local registration, deletion archives, private banks, materials, records, exports, caches, credentials and development artifacts. Inspect `git status` before publication. Do not upload personal data or materials you cannot share. Ignore rules do not untrack files already tracked by Git.

This is a personal study tool. Answers are readable local data; it does not provide proctoring.

## Development checks and license

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.js
# Optional: development-only Playwright and Chrome
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-smoke.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-features.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-manager.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-exam-settings.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-presets-flags.js
L2E_PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-trash.js
```

Only Python is needed at runtime. Node / Playwright are development tools. Backend: `bank_store.py`, `server.py`, `bank_cli.py`. Frontend: native HTML/CSS/JavaScript, with interface language strings in `web/i18n.js`.

[MIT License](https://github.com/Ru1zh/Lecture2Exam/blob/main/LICENSE). Offline KaTeX and its original license are retained in `web/vendor/katex/`.
