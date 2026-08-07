from __future__ import annotations

import base64
import gzip
import json
import shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "no-alibi-build"
TARGET = ROOT / "no-alibi-3000-literal"

encoded = "".join(path.read_text(encoding="utf-8").strip() for path in sorted(SOURCE.glob("expansion-*.b64")))
cards = json.loads(gzip.decompress(base64.b64decode(encoded)).decode("utf-8"))

if len(cards) != 2000:
    raise SystemExit(f"Expansion count is {len(cards)}, expected 2000")

ids = [card.get("id") for card in cards]
texts = [" ".join(str(card.get("text", "")).lower().split()) for card in cards]
if len(set(ids)) != 2000:
    raise SystemExit("Expansion contains duplicate IDs")
if len(set(texts)) != 2000:
    raise SystemExit("Expansion contains duplicate wording")
if any("{" in text or "}" in text for text in texts):
    raise SystemExit("Expansion contains template placeholders")

counts = Counter((card.get("type"), int(card.get("intensity", 0))) for card in cards)
for card_type in ("truth", "dare"):
    for level in range(1, 6):
        if counts[(card_type, level)] != 200:
            raise SystemExit(f"Bad distribution for {card_type} level {level}: {counts[(card_type, level)]}")

TARGET.mkdir(parents=True, exist_ok=True)
for name in ("index.html", "style.css", "app.js"):
    shutil.copyfile(SOURCE / name, TARGET / name)

payload = json.dumps(cards, ensure_ascii=False, separators=(",", ":"))
(TARGET / "cards-expansion.js").write_text(
    "window.NO_ALIBI_EXPANSION=" + payload + ";\n",
    encoding="utf-8",
)

report = {
    "total": len(cards),
    "truths": sum(1 for card in cards if card["type"] == "truth"),
    "dares": sum(1 for card in cards if card["type"] == "dare"),
    "unique_ids": len(set(ids)),
    "unique_texts": len(set(texts)),
    "distribution": {f"{kind}-{level}": counts[(kind, level)] for kind in ("truth", "dare") for level in range(1, 6)},
}
(TARGET / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
