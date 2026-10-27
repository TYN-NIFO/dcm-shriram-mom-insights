"""Run Azure Document Intelligence (prebuilt-layout) on the sample minutes.

Saves, per PDF: the raw analyze result (JSON), the markdown output, and
per-page plain text (pages/<stem>/p001.txt ...) for comparison with other engines.
"""
import json
import os
import sys
import time
from pathlib import Path

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest, DocumentContentFormat
from azure.core.credentials import AzureKeyCredential
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "01_Client_Inputs" / "Sample_Minutes"
OUT = Path(__file__).resolve().parent / "outputs" / "azure_di"

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
client = DocumentIntelligenceClient(os.environ["AZURE_DI_ENDPOINT"], AzureKeyCredential(os.environ["AZURE_DI_KEY"]))


def stem(pdf: Path) -> str:
    # "Board Meeting - 06.05.2024 (Page 2291-2328)" -> "2024-05-06"
    d = pdf.stem.split(" - ")[1].split(" ")[0]
    dd, mm, yyyy = d.split(".")
    return f"{yyyy}-{mm}-{dd}"


def run(pdf: Path) -> None:
    name = stem(pdf)
    out_json = OUT / f"{name}.json"
    if out_json.exists():
        print(f"skip {name} (done)")
        return
    t0 = time.time()
    poller = client.begin_analyze_document(
        "prebuilt-layout",
        AnalyzeDocumentRequest(bytes_source=pdf.read_bytes()),
        output_content_format=DocumentContentFormat.MARKDOWN,
    )
    result = poller.result()
    elapsed = time.time() - t0
    data = result.as_dict()
    out_json.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / f"{name}.md").write_text(result.content, encoding="utf-8")

    page_dir = OUT / "pages" / name
    page_dir.mkdir(parents=True, exist_ok=True)
    confs = []
    for page in result.pages:
        lines = [ln.content for ln in (page.lines or [])]
        (page_dir / f"p{page.page_number:03d}.txt").write_text("\n".join(lines), encoding="utf-8")
        confs += [w.confidence for w in (page.words or [])]
    low = sum(c < 0.8 for c in confs)
    print(f"{name}: {len(result.pages)} pages, {len(confs)} words, "
          f"mean conf {sum(confs) / max(len(confs), 1):.3f}, <0.8: {low}, "
          f"tables {len(result.tables or [])}, {elapsed:.0f}s")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(SAMPLES.glob("*.pdf"))
    if not pdfs:
        sys.exit(f"no PDFs in {SAMPLES}")
    for pdf in pdfs:
        run(pdf)
