# -*- coding: utf-8 -*-
# 一次性脚本：从用户文档抽取手艺小课堂 01/02/03 内容为数据文件。
# 用法：python scripts/gen-craft-lessons-doc.py
# 输出：miniprogram/data/craft-lessons-doc.js
import zipfile, re, json, sys, os
import xml.etree.ElementTree as ET

DOC = r'C:\Users\Lenovo\Desktop\”手艺小课堂“的01，02和03要改成的内容.docx'
OUT = os.path.join(os.path.dirname(__file__), '..', 'miniprogram', 'data', 'craft-lessons-doc.js')

def read_paras(path):
    z = zipfile.ZipFile(path)
    xml = z.read('word/document.xml').decode('utf8')
    root = ET.fromstring(xml)
    paras = []
    for el in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
        texts = [t.text for t in el.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t') if t.text]
        paras.append(''.join(texts))
    return paras

def strip_md(s):
    return s.replace('**', '').strip()

def parse_section(lines, kind):
    # lines: 该 section 内的正文（不含 **0X 标题 与 **内容正文** 头）
    # kind: 'ingredients' | 'steps' | 'reflection'
    # 返回 (lead, items)  ingredients/reflection -> [{name,detail}] ; steps -> [text]
    items = []
    lead_parts = []
    mode = 'lead'
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        if s.startswith('*'):
            mode = 'item'
            raw = s.lstrip('*').strip()
            if kind == 'steps':
                # 02（学手艺）里的子弹是步骤文本（可能带加粗小标题），按步骤串处理
                items.append(strip_md(raw))
            else:
                # 01/03 子弹：名称取 **加粗部分**，详情取加粗后的剩余文字（去前导标点）
                mb = re.match(r'^\*\*(.+?)\*\*\s*(.*)$', raw)
                if mb:
                    name = mb.group(1).strip()
                    detail = re.sub(r'^[。：\s]+', '', mb.group(2).strip())
                else:
                    body = strip_md(raw)
                    m = re.match(r'^([^。：]+)[。：]\s*(.*)$', body)
                    name = m.group(1).strip() if m else body
                    detail = m.group(2).strip() if m else ''
                items.append({'name': name, 'detail': detail})
        elif re.match(r'^\d+[\.、]\s*', s):
            mode = 'item'
            body = strip_md(re.sub(r'^\d+[\.、]\s*', '', s))
            items.append(body)
        else:
            # 正文行：lead 阶段累积；item 阶段作为上一 item 的续行
            if mode == 'lead':
                lead_parts.append(s)
            elif items:
                if isinstance(items[-1], dict):
                    items[-1]['detail'] = (items[-1]['detail'] + s).strip()
                else:
                    items[-1] = (items[-1] + s).strip()
    lead = '\n'.join(lead_parts).strip()
    return lead, items

def main():
    paras = read_paras(DOC)
    season = None
    prod = None
    sec = None
    buf = []  # 当前 section 的行
    # product -> {ingredientLead, ingredients, stepLead, steps, reflectionLead, reflection}
    data = {}
    order = []

    def flush():
        nonlocal prod, sec, buf
        if prod and sec and buf:
            if sec == '01':
                lead, items = parse_section(buf, 'ingredients')
                data[prod]['ingredientLead'] = lead
                data[prod]['ingredients'] = items
            elif sec == '02':
                lead, items = parse_section(buf, 'steps')
                data[prod]['stepLead'] = lead
                data[prod]['steps'] = items
            elif sec == '03':
                lead, items = parse_section(buf, 'reflection')
                data[prod]['reflectionLead'] = lead
                data[prod]['reflection'] = items
        buf = []

    for ln in paras:
        m = re.match(r'^[“”]?([春夏秋冬])季[”"]?[:：]', ln)
        if m:
            flush(); season = m.group(1); prod = None; sec = None; continue
        m = re.match(r'^###\s*\d+\.\s*(一罐.+)$', ln)
        if m:
            flush()
            prod = m.group(1).replace('一罐', '', 1).strip()
            if prod not in data:
                data[prod] = {}
                order.append(prod)
            sec = None
            continue
        if ln.startswith('**01'):
            flush(); sec = '01'; buf = []; continue
        if ln.startswith('**02'):
            flush(); sec = '02'; buf = []; continue
        if ln.startswith('**03'):
            flush(); sec = '03'; buf = []; continue
        if ln.strip() == '**内容正文**：':
            buf = []; continue
        if sec and ln.strip():
            buf.append(ln.strip())
    flush()

    # 组装输出对象（去掉空字段）
    out = {}
    for k in order:
        v = data[k]
        o = {}
        if v.get('ingredientLead'):
            o['ingredientLead'] = v['ingredientLead']
        if v.get('ingredients'):
            o['ingredients'] = v['ingredients']
        if v.get('stepLead'):
            o['stepLead'] = v['stepLead']
        if v.get('steps'):
            o['steps'] = v['steps']
        if v.get('reflectionLead'):
            o['reflectionLead'] = v['reflectionLead']
        if v.get('reflection'):
            o['reflection'] = v['reflection']
        out[k] = o

    # 校验：与代码 craftProduct 对应
    code_products = set()
    with open(os.path.join(os.path.dirname(__file__), '..', 'miniprogram', 'data', 'world-fruit-culture.js'), encoding='utf8') as f:
        for line in f:
            m = re.search(r"craftProduct:\s*'([^']+)'", line)
            if m:
                code_products.add(m.group(1))
    doc_keys = set(out.keys())
    missing_in_code = doc_keys - code_products
    code_without_doc = code_products - doc_keys
    print('文档产品数:', len(doc_keys))
    print('代码 craftProduct 数:', len(code_products))
    print('文档有但代码无(应空):', sorted(missing_in_code))
    print('代码有但文档无(应=8个缺失项):', sorted(code_without_doc))
    print('--- 抽样校验 ---')
    for sample in ['释迦果肉杯', '木瓜果杯', '甘蔗汁', '葡萄果酱']:
        if sample in out:
            o = out[sample]
            print(sample, '| 01引子:', (o.get('ingredientLead') or '')[:20], '| 食材条数:', len(o.get('ingredients', [])), '| 步骤数:', len(o.get('steps', [])), '| 03条数:', len(o.get('reflection', [])))

    js = "// 手艺小课堂 01/02/03 内容（源自用户文档，按 craftProduct 索引）。\n"
    js += "// 由 scripts/gen-craft-lessons-doc.py 从文档抽取生成；引子(lead)为可选开场白。\n"
    js += "'use strict';\nmodule.exports = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n"
    with open(OUT, 'w', encoding='utf8') as f:
        f.write(js)
    print('已写入:', os.path.abspath(OUT))

if __name__ == '__main__':
    main()
