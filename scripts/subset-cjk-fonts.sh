#!/usr/bin/env bash
# Regenerate the subset Noto Sans SC fonts (src/lib/payslip/fonts/NotoSansSC-*.ttf).
# The full Noto Sans SC is ~10.5MB each; we subset to GB2312 (≈6.7k common Simplified
# Chinese — safe for real employee names) + CJK punctuation + the literal chars used in
# messages/zh-CN.json. Requires fonttools (pip install fonttools). Run from repo root
# with the FULL NotoSansSC-*.ttf available (download from fonts.google.com if needed).
set -euo pipefail
python3 -m venv /tmp/ftenv && /tmp/ftenv/bin/pip install -q fonttools
/tmp/ftenv/bin/python - <<'PY'
import json
chars=set()
for hi in range(0xA1,0xF8):
    for lo in range(0xA1,0xFF):
        try: chars.add(bytes([hi,lo]).decode('gb2312'))
        except: pass
chars |= {chr(c) for c in range(0x20,0x7F)}
chars |= {chr(c) for c in range(0x3000,0x3040)}
chars |= {chr(c) for c in range(0xFF00,0xFFF0)}
def walk(o):
    if isinstance(o,str): chars.update(o)
    elif isinstance(o,dict):
        for v in o.values(): walk(v)
    elif isinstance(o,list):
        for v in o: walk(v)
walk(json.load(open('messages/zh-CN.json')))
open('/tmp/sc-charset.txt','w').write(''.join(sorted(chars)))
print('charset:', len(chars))
PY
for w in Regular Bold; do
  /tmp/ftenv/bin/pyftsubset "src/lib/payslip/fonts/NotoSansSC-$w.ttf" \
    --text-file=/tmp/sc-charset.txt --output-file="src/lib/payslip/fonts/NotoSansSC-$w.ttf" \
    --layout-features='*' --no-hinting --desubroutinize
done
echo "done"
