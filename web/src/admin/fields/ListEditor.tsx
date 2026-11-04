import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { insertItem, moveItem, removeItem, replaceItem, syncKeys } from "../list.ts";
import { useJump } from "../context.tsx";
import { ConfirmButton } from "./basic.tsx";

export type ListEditorProps<T> = {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  create: () => NoInfer<T>;
  render: (item: T, onChange: (next: T) => void, index: number) => ReactNode;
  /** One-line preview shown in the item header (also used when collapsed). */
  title: (item: T, index: number) => ReactNode;
  /** Content path of this list, e.g. "company.projects" — used to open items from the issue list. */
  path?: string;
  addLabel?: string;
  hint?: string;
  empty?: string;
  /** Collapsed by default (default: more than 3 items). */
  collapsed?: boolean;
  /** Small inline rows without collapse (links, skill items…). */
  compact?: boolean;
  /** Extra buttons next to "add" (e.g. bulk upload). */
  actions?: ReactNode;
  /** Show only matching items (indexes and order stay those of the full list). */
  filter?: (item: T) => boolean;
};

/**
 * Generic list editor: add, remove (inline confirm), move up/down, collapse,
 * title preview. Items keep stable React keys while they are moved.
 */
export function ListEditor<T>(p: ListEditorProps<T>) {
  const headingId = useId();
  const nextKey = useRef(1);
  const newKey = () => nextKey.current++;
  const keysRef = useRef<number[]>([]);
  keysRef.current = syncKeys(keysRef.current, p.items.length, newKey);
  const keys = keysRef.current;

  // decided once at mount so adding a 4th item does not suddenly collapse the others
  const [defaultOpen] = useState(() => (p.compact ? true : !(p.collapsed ?? p.items.length > 3)));
  // keys whose open state differs from the default
  const [flipped, setFlipped] = useState<Set<number>>(() => new Set());
  const isOpen = (k: number) => (p.compact ? true : defaultOpen !== flipped.has(k));
  const setOpen = (k: number, open: boolean) =>
    setFlipped((s) => {
      const n = new Set(s);
      if (open === defaultOpen) n.delete(k);
      else n.add(k);
      return n;
    });

  const focusKey = useRef<number | null>(null);
  const itemRefs = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    const k = focusKey.current;
    if (k === null) return;
    focusKey.current = null;
    const el = itemRefs.current.get(k);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.querySelector<HTMLElement>(".item-body input, .item-body textarea, .item-body select, .item-row input")?.focus();
  });

  // open + scroll to the item an issue points at
  const jump = useJump();
  useEffect(() => {
    if (!jump || !p.path) return;
    const prefix = `${p.path}.`;
    if (!jump.path.startsWith(prefix)) return;
    const idx = Number(jump.path.slice(prefix.length).split(".")[0]);
    const k = keysRef.current[idx];
    if (!Number.isInteger(idx) || k === undefined) return;
    setOpen(k, true);
    requestAnimationFrame(() => {
      const el = itemRefs.current.get(k);
      if (!el) return;
      // open any collapsed <details> group around the list
      for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, [jump]);

  const add = () => {
    const k = newKey();
    keysRef.current = [...keys, k];
    if (!defaultOpen) setOpen(k, true);
    focusKey.current = k;
    p.onChange(insertItem(p.items, p.items.length, p.create()));
  };
  const move = (i: number, to: number) => {
    keysRef.current = moveItem(keys, i, to);
    p.onChange(moveItem(p.items, i, to));
  };
  const remove = (i: number) => {
    keysRef.current = removeItem(keys, i);
    p.onChange(removeItem(p.items, i));
  };

  return (
    <section className={`list${p.compact ? " list-compact" : ""}`} aria-labelledby={headingId}>
      <header className="list-head">
        <h3 id={headingId}>
          {p.label}{" "}
          <span className="count lcd">
            {p.filter ? `${p.items.filter(p.filter).length}/${p.items.length}` : p.items.length}
          </span>
        </h3>
        {!p.compact && p.items.length > 1 ? (
          <div className="list-tools">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFlipped(new Set(defaultOpen ? [] : keys))}>
              กางทั้งหมด
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFlipped(new Set(defaultOpen ? keys : []))}>
              พับทั้งหมด
            </button>
          </div>
        ) : null}
      </header>
      {p.hint ? <p className="hint">{p.hint}</p> : null}
      {p.items.length === 0 ? <p className="empty">{p.empty ?? "ยังไม่มีรายการ"}</p> : null}
      <ol className="items">
        {p.items.map((item, i) => {
          const k = keys[i]!;
          if (p.filter && !p.filter(item)) return null;
          const open = isOpen(k);
          const bodyId = `${headingId}-b${k}`;
          const onItem = (next: T) => p.onChange(replaceItem(p.items, i, next));
          const controls = (
            <div className="item-ctl">
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label={`เลื่อนรายการที่ ${i + 1} ขึ้น`}
                title="เลื่อนขึ้น"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                ▲
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label={`เลื่อนรายการที่ ${i + 1} ลง`}
                title="เลื่อนลง"
                disabled={i === p.items.length - 1}
                onClick={() => move(i, i + 1)}
              >
                ▼
              </button>
              <ConfirmButton
                label="ลบ"
                ariaLabel={`ลบรายการที่ ${i + 1}`}
                question="ลบรายการนี้?"
                onConfirm={() => remove(i)}
              />
            </div>
          );
          const setRef = (el: HTMLLIElement | null) => {
            if (el) itemRefs.current.set(k, el);
            else itemRefs.current.delete(k);
          };
          if (p.compact) {
            return (
              <li key={k} ref={setRef} className="item item-compact">
                <div className="item-row">{p.render(item, onItem, i)}</div>
                {controls}
              </li>
            );
          }
          return (
            <li key={k} ref={setRef} className={`item px${open ? " is-open" : ""}`}>
              <div className="item-head">
                <button
                  type="button"
                  className="item-toggle"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => setOpen(k, !open)}
                >
                  <span className="chev" aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="item-no lcd">#{i + 1}</span>
                  <span className="item-title">{p.title(item, i) || <em className="muted">(ยังไม่มีชื่อ)</em>}</span>
                </button>
                {controls}
              </div>
              {open ? (
                <div className="item-body" id={bodyId}>
                  {p.render(item, onItem, i)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="list-foot">
        <button type="button" className="btn btn-sm" onClick={add}>
          + {p.addLabel ?? "เพิ่มรายการ"}
        </button>
        {p.actions}
      </div>
    </section>
  );
}
