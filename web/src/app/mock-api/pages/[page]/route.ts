// GET /mock-api/pages/{minute_book_page}.png
// The mock returns an SVG placeholder (Content-Type: image/svg+xml) at the .png path.
// The real backend returns the scanned page as image/png after checking access.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ page: string }> };

function placeholderSvg(page: number): string {
  // Deterministic pseudo-random line widths so each page looks a little different.
  let seed = page * 9301 + 49297;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const lines: string[] = [];
  let y = 260;
  for (let i = 0; i < 26; i++) {
    if (i % 7 === 6) {
      y += 22; // paragraph gap
      continue;
    }
    const indent = i % 7 === 0 ? 120 : 90;
    const w = 520 + Math.floor(rnd() * 180);
    lines.push(`<rect x="${indent}" y="${y}" width="${Math.min(w, 760 - indent)}" height="9" rx="3" fill="#c9c6bd"/>`);
    y += 30;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1100" viewBox="0 0 850 1100">
  <rect width="850" height="1100" fill="#fbfaf6"/>
  <rect x="24" y="24" width="802" height="1052" fill="none" stroke="#d8d4c8" stroke-width="2"/>
  <text x="425" y="70" text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="#55524a">${page}</text>
  <text x="425" y="130" text-anchor="middle" font-family="Georgia, serif" font-size="26" fill="#2f2d28">Minute book page ${page}</text>
  <text x="425" y="170" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#77736a">Sample Co Ltd · Synthetic placeholder, not a real scan</text>
  <line x1="90" y1="205" x2="760" y2="205" stroke="#d8d4c8" stroke-width="2"/>
  ${lines.join("\n  ")}
  <rect x="690" y="980" width="90" height="60" fill="none" stroke="#b9b5aa" stroke-dasharray="4 4"/>
  <text x="735" y="1015" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#9a968c">initials</text>
</svg>`;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { page } = await params;
  const m = /^(\d{1,6})(?:\.png|\.svg)?$/.exec(page);
  if (!m) return Response.json({ detail: "Page not found" }, { status: 404 });
  return new Response(placeholderSvg(Number(m[1])), {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}
