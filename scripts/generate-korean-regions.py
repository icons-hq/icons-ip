#!/usr/bin/env python3
"""Extract only origin-picker provinces and districts from the pinned public CSV.

Offline and deterministic. No product data, runtime API or database is involved.
Review source.json, its permission evidence and coverage before updating the input.
"""
import csv
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "vendor/korean-legal-regions/20260729"
OUTPUT = ROOT / "lib/admin/korean-regions-data.json"


def generate() -> None:
    metadata = json.loads((SOURCE / "source.json").read_text())
    source = SOURCE / metadata["sourceFile"]
    if sha256(source.read_bytes()).hexdigest() != metadata["sourceSha256"]:
        raise ValueError("Source hash mismatch")
    with source.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    by_code = {row["법정동코드"]: row for row in rows}
    if len(rows) != metadata["rowCount"] or len(by_code) != len(rows):
        raise ValueError("Unexpected source count or duplicate code")
    if any(not re.fullmatch(r"[0-9]{10}", code) for code in by_code):
        raise ValueError("Invalid legal-region code")
    provinces = {code: {"code": code, "name": row["시도명"], "districts": []}
                 for code, row in by_code.items() if code[2:] == "00000000"}
    count = 0
    for code, row in sorted(by_code.items()):
        name = row["시군구명"]
        if not name or row["읍면동명"] or row["리명"] or not name.endswith(("시", "군", "구")):
            continue
        if code == metadata["excludedRepeatedSejongCode"]:
            continue
        province = provinces[code[:2] + "00000000"]
        if province["name"] != row["시도명"] or code[5:] != "00000":
            raise ValueError("Unexpected district hierarchy")
        # The CSV omits the space between a city and its general district.
        # Derive that boundary from the parent city in this same licensed CSV.
        parent = by_code.get(code[:4] + "000000")
        if parent and parent["법정동코드"] != code and name.endswith("구"):
            city = parent["시군구명"]
            if not city.endswith("시") or not name.startswith(city):
                raise ValueError("Unrecognized general-district parent")
            name = city + " " + name[len(city):].strip()
        province["districts"].append({"code": code, "name": name})
        count += 1
    if len(provinces) != metadata["provinceCount"] or count != metadata["districtCount"]:
        raise ValueError("Unexpected coverage; review the manifest")
    payload = json.dumps([provinces[code] for code in sorted(provinces)], ensure_ascii=False, indent=2) + "\n"
    digest = sha256(payload.encode()).hexdigest()
    if digest != metadata["generatedSha256"]:
        raise ValueError(f"Generated dictionary changed; review source.json: {digest}")
    OUTPUT.write_text(payload)
    print(f"Generated {len(provinces)} provinces and {count} districts; sha256={digest}")


if __name__ == "__main__":
    generate()
