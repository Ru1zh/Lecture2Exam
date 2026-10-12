#!/bin/zsh
set -e
cd -- "${0:A:h}"
if ! command -v python3 >/dev/null 2>&1; then
  print '请先安装 Python 3.9 或更新版本，再运行此启动脚本。'
  read '?按回车退出…'
  exit 1
fi
python3 server.py --open
