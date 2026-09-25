import re,sys
SGR=re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
def strip(l): return SGR.sub('',l).rstrip()
for path in sys.argv[1:]:
    lines=[strip(l) for l in open(path,encoding='utf8',errors='replace').read().split('\n')]
    blank_runs=[]; run=0; start=0
    for i,l in enumerate(lines):
        if l=='':
            if run==0: start=i
            run+=1
        else:
            if run>1: blank_runs.append((start,run))
            run=0
    if run>1: blank_runs.append((start,run))
    print(f"{path}: {len(lines)} rows, consecutive-blank runs: {blank_runs if blank_runs else 'none'}")
