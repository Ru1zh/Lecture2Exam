#!/usr/bin/env python3
"""Deterministic bank operations for people and the question-bank-builder skill."""
import argparse
import json
import sys
from pathlib import Path
from bank_store import BankStore, AppError, atomic_write, read_json, validate_bank
ROOT = Path(__file__).resolve().parent


def main(argv=None):
    parser=argparse.ArgumentParser(description='Lecture2Exam 题库工具（不调用模型）')
    parser.add_argument('--data-dir',type=Path,default=ROOT/'data')
    sub=parser.add_subparsers(dest='command',required=True)
    create=sub.add_parser('create',help='创建空题库，不覆盖已有内容')
    create.add_argument('folder');create.add_argument('--name',required=True);create.add_argument('--course',default='')
    for command in ('validate','open'):
        child=sub.add_parser(command);child.add_argument('folder')
    export=sub.add_parser('export',help='导出题库包，不包含做题记录或原始材料')
    export.add_argument('folder');export.add_argument('--output',required=True)
    imp=sub.add_parser('import',help='将题库包导入新文件夹')
    imp.add_argument('package');imp.add_argument('--folder',required=True)
    args=parser.parse_args(argv)
    try:
        if args.command in {'validate','export'}:
            root=Path(args.folder).expanduser().resolve()
            bank,questions=validate_bank(read_json(root/'bank.json'),read_json(root/'questions.json'))
            if args.command=='export':
                output=Path(args.output).expanduser().resolve()
                if output in {root/'bank.json',root/'questions.json'} or output.is_relative_to(root/'records'):
                    raise AppError('题库包不能覆盖题库配置、题目或 records/。')
                atomic_write(output,{'bank':bank,'questions':questions})
                print(str(output))
            else:
                counts={kind:sum(q['type']==kind for q in questions) for kind in ('mcq','multi','tf')}
                print(json.dumps({'valid':True,'name':bank['name'],'questions':len(questions),'counts':counts},ensure_ascii=False))
        else:
            store=BankStore(args.data_dir)
            if args.command=='create':result=store.create(args.folder,args.name,args.course)
            elif args.command=='open':result=store.open(args.folder)
            else:result=store.import_bank(args.folder,read_json(Path(args.package)))
            print(json.dumps(result,ensure_ascii=False))
    except (AppError,OSError) as exc:
        print(str(exc),file=sys.stderr);return 1
    return 0

if __name__=='__main__':sys.exit(main())
