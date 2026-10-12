#!/usr/bin/env python3
"""Loopback-only Lecture2Exam service. Python 3.9+, no third-party packages."""
import argparse
import json
import mimetypes
from errors_en import english_error
import secrets
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from bank_store import AppError, BankStore, MAX_JSON_BYTES, require, validate_state, serialized_json, validate_bank, read_json

ROOT = Path(__file__).resolve().parent


def make_server(port=8765, data_dir=None):
    store = BankStore(data_dir or ROOT / 'data')
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            if self.command != 'GET' or self.path.startswith('/api/'):
                super().log_message(fmt, *args)

        def send_bytes(self, content, content_type, status=200):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(content)

        def send_json(self, value, status=200):
            self.send_bytes(json.dumps(value, ensure_ascii=False, allow_nan=False).encode(), 'application/json; charset=utf-8', status)

        def check_origin(self, mutation=False):
            expected = '127.0.0.1:' + str(self.server.server_port)
            host = self.headers.get('Host')
            require(host in {expected, 'localhost:' + str(self.server.server_port)}, '只允许本机访问。')
            origin = self.headers.get('Origin')
            if origin and origin != 'http://' + host:
                raise AppError('拒绝跨站请求。', 403)
            if mutation and self.headers.get('X-L2E-Token') != token:
                raise AppError('请求令牌失效，请刷新页面。', 403)

        def body(self):
            try:
                size = int(self.headers.get('Content-Length', '0'))
                require(0 < size <= MAX_JSON_BYTES, '请求大小无效或超过 16 MB。')
                require(self.headers.get('Content-Type', '').startswith('application/json'), '请求必须是 JSON。')
                return json.loads(self.rfile.read(size))
            except (ValueError, UnicodeDecodeError) as exc:
                raise AppError('请求 JSON 格式无效。') from exc

        def do_GET(self):
            self.dispatch('GET')

        def do_POST(self):
            self.dispatch('POST')

        def do_PUT(self):
            self.dispatch('PUT')

        def dispatch(self, method):
            try:
                self.check_origin(method != 'GET')
                path = unquote(urlsplit(self.path).path)
                if path.startswith('/api/'):
                    self.api(method, path)
                elif method == 'GET':
                    static = (ROOT / 'web' / (path.lstrip('/') or 'index.html')).resolve()
                    if not static.is_relative_to(ROOT / 'web') or not static.is_file():
                        raise AppError('文件不存在。', 404)
                    mime = mimetypes.guess_type(str(static))[0] or 'application/octet-stream'
                    self.send_bytes(static.read_bytes(), mime)
                else:
                    raise AppError('接口不存在。', 404)
            except AppError as exc:
                self.send_json({'error': str(exc), 'errorEn': english_error(str(exc))}, exc.status)
            except OSError as exc:
                self.send_json({'error': '文件读写失败：' + str(exc), 'errorEn': 'File operation failed: ' + str(exc)}, 422)
            except (KeyError, TypeError, ValueError, AttributeError):
                self.send_json({'error': '数据结构无效，请检查题库或记录文件。', 'errorEn': 'Invalid data structure. Check the bank or records file.'}, 400)

        def api(self, method, path):
            if method == 'GET' and path == '/api/session':
                self.send_json({'token': token, 'nativePicker': sys.platform == 'darwin', 'defaultParent': str(Path.home() / 'Documents' / 'Lecture2Exam-banks')})
                return
            if method == 'GET' and path.startswith('/api/examples/'):
                slug = path.rsplit('/', 1)[-1]
                if slug not in {'multi-format'}:
                    raise AppError('示例不存在。', 404)
                self.send_json(read_json(ROOT / 'examples' / (slug + '.json')))
                return
            if method == 'GET' and path == '/api/banks':
                self.send_json({'banks': store.list()})
                return
            if method == 'GET' and path == '/api/trash':
                self.send_json({'items': store.list_trash()})
                return
            if method == 'POST' and path == '/api/validate-state':
                state = validate_state(self.body().get('state'))
                serialized_json({'revision': 0, 'state': state})
                self.send_json({'state': state})
                return
            if method == 'POST' and path == '/api/pick-bank-package':
                if sys.platform != 'darwin':
                    raise AppError('当前系统请使用浏览器选择题库 JSON 包。')
                picker_data = self.body()
                directory = picker_data.get('directory', '')
                picker_prompt = 'Choose bank JSON package' if picker_data.get('language') == 'en' else '选择题库 JSON 包'
                require(isinstance(directory, str), '文件夹路径无效。')
                start = Path(directory).expanduser().resolve() if directory.strip() else Path.home()
                while not start.is_dir() and start != start.parent:
                    start = start.parent
                # A fixed script receives the directory as argv, never as script text.
                script = '''on run argv
set startFolder to POSIX file (item 2 of argv) as alias
set chosenFile to choose file with prompt (item 1 of argv) of type {"public.json"} default location startFolder
return POSIX path of chosenFile
end run'''
                try:
                    result = subprocess.run(['osascript', '-e', script, picker_prompt, str(start)], capture_output=True, text=True, timeout=120)
                except subprocess.TimeoutExpired:
                    raise AppError('文件选择已超时，请重试。')
                if result.returncode:
                    if '-128' in result.stderr:
                        self.send_json({'path': None})
                        return
                    raise AppError('无法打开系统文件选择器，请重试。', 422)
                selected = Path(result.stdout.strip())
                require(selected.is_file() and selected.suffix.lower() == '.json', '请选择题库 JSON 文件。')
                package = read_json(selected)
                require(isinstance(package, dict), '题库包必须包含 bank 与 questions。')
                bank, questions = validate_bank(package.get('bank'), package.get('questions'))
                self.send_json({'path': str(selected), 'bundle': {'bank': bank, 'questions': questions}})
                return
            if method == 'POST' and path == '/api/pick-directory':
                if sys.platform != 'darwin':
                    raise AppError('当前系统请直接填写文件夹的完整路径。')
                picker_data = self.body()
                picker_prompt = 'Choose a bank folder or a parent for a new bank' if picker_data.get('language') == 'en' else '选择题库文件夹或新题库的父目录'
                # Fixed AppleScript receives the prompt as argv.
                try:
                    result = subprocess.run(['osascript', '-e', 'on run argv\nreturn POSIX path of (choose folder with prompt (item 1 of argv))\nend run', picker_prompt], capture_output=True, text=True, timeout=120)
                except subprocess.TimeoutExpired:
                    raise AppError('文件夹选择已超时，请重试。')
                if result.returncode:
                    self.send_json({'path': None})
                else:
                    self.send_json({'path': result.stdout.strip().rstrip('/') or '/'})
                return
            if method == 'POST' and path in {'/api/banks/create', '/api/banks/open', '/api/banks/import'}:
                data = self.body()
                if path.endswith('/create'):
                    result = store.create(data.get('path'), data.get('name'), data.get('course', ''))
                elif path.endswith('/open'):
                    result = store.open(data.get('path'))
                else:
                    result = store.import_bank(data.get('path'), data.get('bundle'))
                self.send_json(result)
                return
            parts = path.strip('/').split('/')
            if method == 'POST' and len(parts) == 4 and parts[:2] == ['api', 'trash']:
                data = self.body()
                if parts[3] == 'restore':
                    self.send_json(store.restore_trash(parts[2]))
                    return
                if parts[3] == 'purge':
                    self.send_json(store.purge_trash(parts[2], data.get('confirmed')))
                    return
            if len(parts) in {3, 4} and parts[:2] == ['api', 'banks']:
                key = parts[2]
                if method == 'GET' and len(parts) == 3:
                    self.send_json(store.load(key))
                    return
                if method == 'POST' and len(parts) == 4 and parts[3] == 'open':
                    self.body()
                    self.send_json(store.load(key, mark_opened=True))
                    return
                if method == 'POST' and len(parts) == 4 and parts[3] == 'delete':
                    data = self.body()
                    self.send_json(store.delete(key, data.get('scope'), data.get('confirmed')))
                    return
                if method == 'POST' and len(parts) == 4 and parts[3] == 'rename':
                    data = self.body()
                    self.send_json(store.rename(key, data.get('name'), data.get('bankRevision')))
                    return
                if method == 'PUT' and len(parts) == 4 and parts[3] == 'state':
                    data = self.body()
                    self.send_json(store.save(key, data.get('revision'), data.get('state'), data.get('bankRevision')))
                    return
            raise AppError('接口不存在。', 404)

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def main():
    parser = argparse.ArgumentParser(description='Lecture2Exam 本地学习工具')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--open', action='store_true', help='启动后打开浏览器')
    args = parser.parse_args()
    try:
        server = make_server(args.port, args.data_dir)
    except OSError as exc:
        print('无法启动本地服务：' + str(exc) + '\n端口已占用时，请选择其他端口，例如 --port 8766。', file=sys.stderr)
        return 1
    url = 'http://127.0.0.1:' + str(server.server_port)
    print('Lecture2Exam: ' + url + '\n按 Ctrl+C 停止。题库和记录保存在用户选择的文件夹中。', flush=True)
    if args.open:
        threading.Timer(.3, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0

if __name__ == '__main__':
    sys.exit(main())
