#!/usr/bin/env python3
"""Generate the small admin country-name dictionary from pinned local CLDR data.

This script never downloads data or changes products. Update vendor source.json
and review its source hashes before running it for another CLDR release.
"""
from hashlib import sha256
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "vendor/unicode-cldr/48.2.0"
OUTPUT = ROOT / "lib/admin/country-names-data.json"


def expand_regions(value: str) -> list[str]:
    codes = []
    for item in value.split():
        if "~" not in item:
            codes.append(item)
            continue
        start, suffix = item.split("~")
        end = start[:-len(suffix)] + suffix
        if len(start) != 2 or start[:-1] != end[:-1]:
            raise ValueError(f"Unsupported region range: {item}")
        codes.extend(start[0] + chr(code) for code in range(ord(start[-1]), ord(end[-1]) + 1))
    return codes


def generate() -> None:
    metadata = json.loads((SOURCE / "source.json").read_text())
    for filename, source in metadata["files"].items():
        if sha256((SOURCE / filename).read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError(f"Source hash mismatch: {filename}")
    ko = json.loads((SOURCE / "ko-territories.json").read_text())["main"]["ko"]["localeDisplayNames"]["territories"]
    en = json.loads((SOURCE / "en-territories.json").read_text())["main"]["en"]["localeDisplayNames"]["territories"]
    mappings = json.loads((SOURCE / "codeMappings.json").read_text())["supplemental"]["codeMappings"]
    regular = ET.parse(SOURCE / "region.xml").find(".//id[@type='region'][@idStatus='regular']")
    if regular is None or regular.text is None:
        raise ValueError("Missing regular region list")
    regions = expand_regions(regular.text)
    rows, excluded = [], []
    for code in regions:
        mapping = mappings.get(code, {})
        numeric = mapping.get("_numeric", "")
        alpha3 = mapping.get("_alpha3", "")
        if len(code) != 2 or not alpha3 or not numeric.isdigit() or int(numeric) >= 900:
            excluded.append(code)
            continue
        name, english = ko[code], en[code]
        aliases = sorted({value for names in (ko, en) for key, value in names.items()
                          if key.startswith(code + "-alt-")} - {name, english})
        rows.append({"code": code, "alpha3": alpha3, "numeric": numeric,
                     "name": name, "english": english, "aliases": aliases})
    if excluded != metadata["excludedRegular"] or len(rows) != metadata["rowCount"]:
        raise ValueError("Unexpected dictionary coverage; review the manifest")
    payload = json.dumps(rows, ensure_ascii=False, indent=2) + "\n"
    if sha256(payload.encode()).hexdigest() != metadata["generatedSha256"]:
        raise ValueError("Generated dictionary hash changed; review the manifest")
    OUTPUT.write_text(payload)
    public_license = ROOT / "public/licenses/unicode-cldr-48.2.0.txt"
    public_license.parent.mkdir(parents=True, exist_ok=True)
    public_license.write_bytes((SOURCE / "LICENSE").read_bytes())
    print(f"Generated {len(rows)} country/region names; sha256={sha256(payload.encode()).hexdigest()}")


if __name__ == "__main__":
    generate()
