"""Validate and combine calculator-only source files into browser data."""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source-data"
OUT = ROOT / "web" / "data" / "research.json"
TREES = {"military-iii": "Military III", "dragon-combat": "Dragon Combat"}
RESOURCES = ["Food", "Wood", "Stone", "Iron", "Scholarly Fragments", "Pale Steel",
             "Red Gold", "Glass Candle Shards", "Dragon Lore", "Dragon Secrets", "Dragon Tomes"]


def read(slug: str, suffix: str, tree: str) -> dict:
    path = SOURCE / f"{slug}-{suffix}.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("version") != 1 or document.get("tree") != tree:
        raise ValueError(f"Invalid source version or tree: {path.name}")
    return document[suffix]


def validate_values(values: list, label: str, maximum: float | None = None) -> None:
    if len(values) != 15 or any(
        isinstance(value, bool) or not isinstance(value, (int, float))
        or not math.isfinite(value) or value < 0
        or (maximum is not None and (value < 1 or value > maximum or value != int(value)))
        for value in values
    ):
        raise ValueError(f"Invalid level 1–15 values: {label}")


def main() -> None:
    output = {"version": 1, "resources": RESOURCES, "research": []}
    for slug, tree in TREES.items():
        definitions = read(slug, "research", tree)
        stats = read(slug, "stats", tree)
        costs = read(slug, "costs", tree)
        identifiers = {item["id"] for item in definitions}
        if len(identifiers) != len(definitions) or identifiers != set(stats) or identifiers != set(costs):
            raise ValueError(f"Research, stat, and cost IDs must match in {tree}")
        for item in definitions:
            research_id = item["id"]
            if item["maxLevel"] != 15:
                raise ValueError(f"Invalid maximum level: {item['name']}")
            for requirement in item["requires"]:
                if requirement["id"] not in identifiers or not 1 <= requirement["level"] <= 15:
                    raise ValueError(f"Invalid prerequisite: {item['name']}")
            levels = costs[research_id]
            validate_values(levels["maester"], item["name"] + " Maester", 40)
            if set(levels["costs"]) - set(RESOURCES):
                raise ValueError(f"Unknown cost resource: {item['name']}")
            for resource, values in levels["costs"].items():
                validate_values(values, item["name"] + " " + resource)
            properties = []
            if not stats[research_id]:
                raise ValueError(f"No stat gains: {item['name']}")
            for prop in stats[research_id]:
                validate_values(prop["values"], item["name"] + " " + prop["name"])
                if prop["unit"] not in ("percent", "count") or prop["scope"] not in ("Shared", "Infantry", "Cavalry", "Ranged"):
                    raise ValueError(f"Invalid stat unit or scope: {item['name']}")
                properties.append({"name": prop["name"], "raw": prop["statId"],
                                   "scope": prop["scope"], "unit": prop["unit"], "values": prop["values"]})
            output["research"].append({**item, "tree": tree, "maester": levels["maester"],
                                       "properties": properties, "costs": levels["costs"]})
    output["research"].sort(key=lambda item: (item["tree"], item["row"], item["column"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"Built {OUT} with {len(output['research'])} researches")


if __name__ == "__main__":
    main()
