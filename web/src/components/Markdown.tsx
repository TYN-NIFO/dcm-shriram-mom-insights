import { Fragment, type ReactNode } from "react";

/**
 * Tiny, safe markdown renderer: paragraphs, bullet and numbered lists,
 * **bold** and *italic*. Builds React elements (no raw HTML), so streamed
 * model output can't inject markup.
 */

type Cite = (n: number, key: string) => ReactNode;

function inline(text: string, keyPrefix: string, cite?: Cite): ReactNode[] {
  // "[S4], [S5]" -> "[S4][S5]": adjacent markers sit together without the comma
  if (cite) text = text.replace(/\]\s*,\s*\[(?=S?\d)/g, "][").replace(/\s+(\[S?\d+(?:\s*,\s*S?\d+)*\])/g, "$1");
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*|\[(S?\d+(?:\s*,\s*S?\d+)*)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[3] !== undefined) {
      const nums = m[3].split(",").map((x) => Number(x.trim().replace(/^S/, "")));
      out.push(
        cite ? (
          <sup key={`${keyPrefix}-c${i++}`} className="ml-0.5 whitespace-nowrap">
            {nums.map((n, k) => cite(n, `${keyPrefix}-c${i}-${k}`))}
          </sup>
        ) : (
          m[0]
        ),
      );
    } else if (m[1] !== undefined)
      out.push(
        <strong key={`${keyPrefix}-b${i++}`} className="font-semibold">
          {m[1]}
        </strong>,
      );
    else out.push(<em key={`${keyPrefix}-i${i++}`}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[]; start: number };

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
    } else if (ul) {
      if (cur?.kind !== "ul") {
        flush();
        cur = { kind: "ul", items: [] };
      }
      cur.items.push(ul[1]);
    } else if (ol) {
      if (cur?.kind !== "ol") {
        flush();
        cur = { kind: "ol", items: [], start: Number(ol[1]) };
      }
      cur.items.push(ol[2]);
    } else if ((cur?.kind === "ul" || cur?.kind === "ol") && /^\s{2,}/.test(raw)) {
      // continuation of a list item
      cur.items[cur.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (cur?.kind !== "p") {
        flush();
        cur = { kind: "p", lines: [] };
      }
      cur.lines.push(line);
    }
  }
  flush();
  return blocks;
}

export default function Markdown({ text, className = "", cite }: { text: string; className?: string; cite?: Cite }) {
  const blocks = parse(text);
  return (
    <div className={`space-y-3 leading-relaxed ${className}`}>
      {blocks.map((b, bi) => {
        if (b.kind === "p")
          return (
            <p key={bi}>
              {b.lines.map((l, li) => (
                <Fragment key={li}>
                  {li > 0 && <br />}
                  {inline(l, `${bi}-${li}`, cite)}
                </Fragment>
              ))}
            </p>
          );
        const items = b.items.map((it, ii) => <li key={ii}>{inline(it, `${bi}-${ii}`, cite)}</li>);
        return b.kind === "ul" ? (
          <ul key={bi} className="list-disc space-y-1 pl-5 marker:text-zinc-400">
            {items}
          </ul>
        ) : (
          <ol key={bi} start={b.start} className="list-decimal space-y-1 pl-5 marker:text-zinc-500">
            {items}
          </ol>
        );
      })}
    </div>
  );
}
