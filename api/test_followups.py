"""Multi-turn test of follow-up questions against the running backend (http://127.0.0.1:8000).

Each conversation is sent turn by turn in one conversation_id. A turn passes when
  - the stand-alone rewrite (read back from logs/audit.jsonl) contains every term in "rewrite", and
  - the answer contains every phrase in "expect" (case-insensitive; [] = expect "not found").
Expected facts were checked against the minutes. Run: ..\\.venv-api\\Scripts\\python test_followups.py
"""
import json
import os
import sys
from pathlib import Path

import httpx

API = os.environ.get("DCM_API", "http://127.0.0.1:8000")
AUDIT = Path(__file__).resolve().parent / "logs" / "audit.jsonl"

CONVERSATIONS = [
    [{"q": "What final dividend did the Board recommend in May 2024?", "rewrite": ["dividend"], "expect": ["2.60"]},
     {"q": "And in 2021?", "rewrite": ["final dividend", "2021"], "expect": ["3.80"]},
     {"q": "What record date was fixed for it?", "rewrite": ["record date", "2021"], "expect": ["9.7.21"]},
     {"q": "Was there an interim one that year too?", "rewrite": ["interim", "2021"], "expect": ["5.50"]}],
    [{"q": "Who chairs the Board Audit Committee after the May 2024 reconstitution?", "rewrite": ["audit committee"], "expect": ["Ramni Nirula"]},
     {"q": "Who are the other members?", "rewrite": ["audit committee"], "expect": ["Vipin Sondhi", "Pravesh Sharma", "Pranam Wahi"]},
     {"q": "Is Pradeep Dinodia still involved with it?", "rewrite": ["Dinodia", "audit committee"], "expect": ["Permanent Invitee"]}],
    [{"q": "Who is our company secretary now?", "rewrite": ["company secretary"], "expect": ["Deepak Gupta"]},
     {"q": "Since when?", "rewrite": ["Deepak Gupta"], "expect": ["2025"]},
     {"q": "Who handled the role before him?", "rewrite": ["company secretary"], "expect": ["Swati Patil Lahiri"]}],
    [{"q": "What did the Board approve for renewable power at Kota in October 2024?", "rewrite": ["Kota"], "expect": ["23", "60"]},
     {"q": "How big is the hybrid project?", "rewrite": ["Kota"], "expect": ["68 MW"]},
     {"q": "What stake are we taking in it?", "rewrite": ["Kota"], "expect": ["28%"]}],
    [{"q": "When was the hydrogen peroxide plant commissioned?", "rewrite": ["peroxide"], "expect": ["Aug"]},
     {"q": "At what rate was it running then?", "rewrite": ["H2O2"], "expect": ["60"]}],
    [{"q": "What capital commitment charges were approved for Narmada Clean Tech?", "rewrite": ["Narmada"], "expect": ["4.32", "52.27"]},
     {"q": "How much of the later one becomes equity?", "rewrite": ["Narmada"], "expect": ["15 Lakhs"]}],
    [{"q": "Which director has an interest in Hero Electronix?", "rewrite": ["Hero"], "expect": ["Munjal", "Eectronix"]},
     {"q": "How large is his holding there?", "rewrite": ["Munjal"], "expect": ["25%"]}],
    [{"q": "Did the Board approve a merger with Tata Chemicals?", "rewrite": ["Tata"], "expect": []},
     {"q": "What about with any other company?", "rewrite": ["merger"], "expect": None}],     # None: not scored
]


def ask(client, cid, q):
    text, found = [], None
    with client.stream("POST", f"{API}/chat", json={"conversation_id": cid, "question": q}, timeout=300) as r:
        r.raise_for_status()
        event = None
        for line in r.iter_lines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                d = json.loads(line[6:])
                if event == "meta":
                    cid = d["conversation_id"]
                elif event == "token":
                    text.append(d["text"])
                elif event == "done":
                    found = d["found"]
                elif event == "error":
                    raise RuntimeError(d["message"])
    return cid, "".join(text), found


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    passed = total = rw_ok = 0
    with httpx.Client() as client:
        for conv in CONVERSATIONS:
            cid = None
            print("\n---")
            for t in conv:
                cid, ans, found = ask(client, cid, t["q"])
                standalone = json.loads(AUDIT.read_text(encoding="utf-8").splitlines()[-1])["standalone"]
                rw = all(k.lower() in standalone.lower() for k in t["rewrite"])
                if t["expect"] is None:
                    ok = None
                elif t["expect"] == []:
                    ok = found is False
                else:
                    ok = bool(found) and all(e.lower() in ans.lower() for e in t["expect"])
                if ok is not None:
                    total += 1; passed += ok
                rw_ok += rw
                print(f"{'PASS' if ok else 'n/a ' if ok is None else 'FAIL'} | rewrite {'ok ' if rw else 'BAD'} | {t['q']}\n"
                      f"       -> {standalone}\n       A: {ans[:220]}")
    turns = sum(len(c) for c in CONVERSATIONS)
    print(f"\nAnswers: {passed}/{total} turns pass; rewrites: {rw_ok}/{turns} keep the topic")


if __name__ == "__main__":
    main()
