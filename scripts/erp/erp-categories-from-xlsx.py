#!/usr/bin/env python3
"""ERP(K-System) 품목대중소분류정의 시트 → 분류 동기화 JSON.

입력은 ai-icons 의 `2026-08-04_ksystem-품목정보-마스터.xlsx` 「분류체계(제상품)」 시트(열: 대분류·대분류순서·중분류·
중분류순서·중분류사용여부·소분류·중분류_최초출현)다. 분류 이름표에는 개인정보가 없어서 결과 JSON 은 저장소에 둬도 된다.

출력 한 줄 = 노드 하나: {id, key, parentKey, name, level, position}
- id 는 순서에서 만든다(`erp-02`, `erp-02-01`, `erp-02-01-03`) — 한 번 만들어진 뒤로는 동기화가 key(이름 경로)로 맞추므로
  ERP 가 순서를 바꿔도 id 는 그대로다.
- key 는 이름 경로 `문구 > 노트 > 스프링노트`. ERP 에는 분류 코드가 없어서 이름 경로가 자연키다.

사용: python3 scripts/erp/erp-categories-from-xlsx.py <xlsx> > scripts/erp/erp-categories.json
"""
import json
import sys

import openpyxl


def main(path: str) -> None:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook['분류체계(제상품)']
    rows = [row for row in sheet.iter_rows(values_only=True)][1:]
    rows = [row for row in rows if row and row[0] and not str(row[0]).startswith('출처')]

    nodes: list[dict] = []
    seen: set[str] = set()
    l2_index: dict[tuple[str, str], int] = {}
    l3_counter: dict[str, int] = {}

    def add(node: dict) -> None:
        if node['key'] in seen:
            return
        seen.add(node['key'])
        nodes.append(node)

    for row in rows:
        l1, l1_order, l2, l2_order, _in_use, l3, _first = (list(row) + [None] * 7)[:7]
        l1 = str(l1).strip()
        l2 = str(l2).strip() if l2 else None
        l3 = str(l3).strip() if l3 else None
        l1_id = f'erp-{int(l1_order) + 1:02d}'
        add({'id': l1_id, 'key': l1, 'parentKey': None, 'name': l1, 'level': 1, 'position': int(l1_order)})
        if not l2:
            continue
        l2_key = f'{l1} > {l2}'
        l2_id = f'{l1_id}-{int(l2_order) + 1:02d}'
        if (l1, l2) not in l2_index:
            l2_index[(l1, l2)] = int(l2_order)
        add({'id': l2_id, 'key': l2_key, 'parentKey': l1, 'name': l2, 'level': 2, 'position': int(l2_order)})
        if not l3:
            continue
        l3_key = f'{l2_key} > {l3}'
        if l3_key in seen:
            continue
        l3_counter[l2_key] = l3_counter.get(l2_key, -1) + 1
        add({
            'id': f'{l2_id}-{l3_counter[l2_key] + 1:02d}',
            'key': l3_key,
            'parentKey': l2_key,
            'name': l3,
            'level': 3,
            'position': l3_counter[l2_key],
        })

    ids = [node['id'] for node in nodes]
    if len(ids) != len(set(ids)):
        raise SystemExit('id 충돌 — 대분류/중분류 순서가 같은 형제가 있다')
    json.dump(nodes, sys.stdout, ensure_ascii=False, indent=0)
    sys.stdout.write('\n')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
