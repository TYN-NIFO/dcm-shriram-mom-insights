"""Run the draft check on the synthetic test drafts in test_drafts/ and print each item. Expected results are in
test_drafts/expected.json. Run: ..\.venv-api\Scripts\python test_check.py"""
import json
import os
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent


def run(path):
    t0, ev, first, items = time.time(), None, None, []
    mime = "text/plain" if path.suffix == ".txt" else "application/octet-stream"
    with httpx.Client(timeout=300) as c, c.stream("POST", os.environ.get("DCM_API", "http://127.0.0.1:8000") + "/check",
                                                  files={"file": (path.name, path.open("rb"), mime)}) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: "):
                d = json.loads(line[6:])
                if ev == "item":
                    first = first or time.time() - t0
                    items.append(d)
                elif ev in ("done", "error"):
                    print(f"{path.name}: {ev} {d} | first item {first or 0:.1f}s, total {time.time() - t0:.1f}s")
    return items


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    expected = json.loads((HERE / "test_drafts" / "expected.json").read_text(encoding="utf-8"))
    ok = total = 0
    for f in sorted((HERE / "test_drafts").glob("draft_*")):
        for it in run(f):
            exp = next((v for k, v in expected[f.name].items() if k.lower() in it["proposal"].lower()), None)
            total += exp is not None
            ok += exp is not None and it["status"] in exp
            gov = "; ".join(f"{s['meeting_date']} {s['item']}" + (" (Syn)" if s["source_type"] == "synopsis" else "")
                            for s in it["governing"])
            print(f"  [{it['status']}] {'OK ' if exp and it['status'] in exp else 'EXP ' + str(exp)} | {it['proposal'][:80]}\n"
                  f"      {it['comparison'] or ''} | gov: {gov}\n      {it['finding'][:220]}")
    print(f"\n{ok}/{total} items as expected")
