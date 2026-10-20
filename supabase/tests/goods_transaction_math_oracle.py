"""Compare SQL pure calculators with independent Fraction design vectors.

Never opens the source postgres database; the shell wrapper passes its own
freshly created clone. No application module is imported.
"""
import json
import os
import re
from pathlib import Path
import subprocess

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
assert re.fullmatch(r'[0-9a-f]{64}', container) and re.fullmatch(r'icons_goods_transaction_[0-9a-f]{32}', database)
vectors = json.loads(Path('test/fixtures/goods-transaction-independent-math.json').read_text())


def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def query(sql):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database,
                             '-v', 'ON_ERROR_STOP=1', '-At'], input=sql, text=True, capture_output=True, check=True)
    return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]


queries = []
expected = []
for vector in vectors['discounts']:
    given = vector['input']
    lines = [{'lineId': f'line-{i}', 'goodId': 'oracle-good', 'qty': line['quantity'],
              'regularUnitPrice': line['regular'], 'unitPrice': line['effective']} for i, line in enumerate(given['lines'])]
    policy = {'id': '00000000-0000-4000-8000-000000000001', 'goodId': 'oracle-good', 'revision': 1,
              'status': 'active', 'draftValues': {}, 'terms': {'condition': given['condition'], 'threshold': given['target'],
                'discountKind': given['kind'], 'discountValue': given['value'], 'startsAt': None, 'endsAt': None}}
    queries.append(f"select private.calculate_goods_volume_discounts({literal(lines)},{literal([policy])},'2026-10-14T00:00:00Z');")
    expected.append(('discount', vector['expected']))
    split = [{**line, 'lineId': f"{line['lineId']}-{i}", 'qty': 1} for line in lines for i in range(line['qty'])]
    queries.append(f"select private.calculate_goods_volume_discounts({literal(split)},{literal([policy])},'2026-10-14T00:00:00Z');")
    expected.append(('split', vector['expected']))
for vector in vectors['repeated']:
    terms = {'kind': 'repeat', 'interval': vector['interval'], 'baseFee': vector['baseFee']}
    queries.append(f"select private.goods_quantity_delivery_fee({vector['quantity']},{literal(terms)});")
    expected.append(('scalar', vector['expected']))
for vector in vectors['tiers']:
    terms = {'kind': 'tier3', **{key: vector[key] for key in ('baseFee', 'firstLimit', 'secondLimit', 'extra1', 'extra2')}}
    queries.append(f"select private.goods_quantity_delivery_fee({vector['quantity']},{literal(terms)});")
    expected.append(('scalar', vector['expected']))
for vector in vectors['allocations']:
    for rows in (vector['rows'], list(reversed(vector['rows'])), [{**row, 'weight': row['weight'] * 7} for row in vector['rows']]):
        queries.append(f"select private.allocate_transaction_amount({vector['total']},{literal(rows)});")
        expected.append(('allocation', vector['expected']))
results = query('\n'.join(queries))
assert len(results) == len(expected)
for index, (actual, (kind, target)) in enumerate(zip(results, expected)):
    if kind in ('scalar', 'allocation'):
        assert actual == target, (index, kind, actual, target)
    else:
        assert [actual['subtotal'], actual['volumeDiscountTotal'], actual['netSubtotal']] == [target['subtotal'], target['discount'], target['net']], (index, actual, target)
        if kind == 'discount':
            assert [line['volumeUnitDiscount'] for line in actual['lines']] == target['unitDiscounts'], (index, actual, target)
print(f'PASS SQL independent Fraction oracle: {len(results)} comparisons')
