import { useEffect, useId, useMemo, useState } from "react";
import {
  ICON_NAMES,
  SortDate,
  frameDateLabel,
  frameStamp,
  type Frame,
  type IconName,
} from "@pho0m/content";
import { useJump } from "../context.tsx";
import { dateOrder, insertItem, removeItem, replaceItem } from "../list.ts";
import { FRAME_ASPECT } from "../darkroom.ts";
import { autoId } from "../validate.ts";
import { DRAFT_HINT, UPLOADS_PUBLIC } from "../notices.ts";
import { ConfirmButton, Grid, IdField, LocalizedField, TagsField, TextField, Toggle, bind } from "../fields/basic.tsx";
import { PrintCanvas, PrintControls, SpriteIcon, useDarkroomPrint } from "../fields/canvas.tsx";
import { ImagesField } from "../fields/ImageField.tsx";
import { LinksEditor } from "../fields/LinksEditor.tsx";
import { Chip, SectionHead } from "./common.tsx";

const ICON_LABEL: Record<IconName, string> = {
  laptop: "แล็ปท็อป",
  note: "โน้ตเพลง",
  chedi: "เจดีย์",
  eye: "ดวงตา",
  check: "เช็กลิสต์",
  drop: "หยดน้ำ",
  board: "กระดาน",
  bubble: "แชต",
  rocket: "จรวด",
  brief: "กระเป๋างาน",
  star: "ดาว",
  cap: "หมวกรับปริญญา",
  code: "โค้ด",
  flag: "ธง",
};

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function newFrame(): Frame {
  return {
    id: "",
    date: thisMonth(),
    dateLabel: "",
    title: { th: "", en: "" },
    summary: { th: "", en: "" },
    body: { th: "", en: "" },
    icon: "star",
    tags: [],
    images: [],
    links: [],
    published: false,
  };
}

function IconPicker({ value, onChange }: { value: IconName; onChange: (v: IconName) => void }) {
  const id = useId();
  return (
    <fieldset className="field">
      <legend id={id}>ไอคอนพิกเซล (ใช้เมื่อไม่มีรูป)</legend>
      <div className="icon-grid" role="radiogroup" aria-labelledby={id}>
        {ICON_NAMES.map((icon) => (
          <button
            key={icon}
            type="button"
            role="radio"
            aria-checked={value === icon}
            className={`icon-btn px${value === icon ? " is-on" : ""}`}
            title={`${ICON_LABEL[icon]} (${icon})`}
            onClick={() => onChange(icon)}
            onKeyDown={(e) => {
              const i = ICON_NAMES.indexOf(icon);
              const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = ICON_NAMES[(i + step + ICON_NAMES.length) % ICON_NAMES.length]!;
              onChange(next);
              const sib = (e.currentTarget.parentElement?.children[ICON_NAMES.indexOf(next)] as HTMLElement | undefined);
              sib?.focus();
            }}
            tabIndex={value === icon ? 0 : -1}
          >
            <SpriteIcon icon={icon} scale={2} />
            <span className="sr-only">{ICON_LABEL[icon]}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The frame as it will look on the film: the clear print by default, the developing
 * dither (replayable) or the safelight negative, with the date imprint.
 */
function FramePreview({ frame, t, seed }: { frame: Frame; t: number; seed: number }) {
  const p = useDarkroomPrint({ url: frame.images[0]?.url, icon: frame.icon, t, seed });
  const dateOk = SortDate.safeParse(frame.date).success;
  return (
    <figure className="film-preview">
      <div className="film px">
        <div className="film-holes" aria-hidden="true" />
        <div className="film-gate">
          <PrintCanvas p={p} icon label={`พรีวิวเฟรม ${frame.title.th || frame.title.en}`} className="film-canvas">
            {dateOk ? <span className="film-stamp lcd">{frameStamp(frame)}</span> : null}
          </PrintCanvas>
        </div>
        <div className="film-holes" aria-hidden="true" />
      </div>
      <figcaption>
        <span className="lcd">{dateOk ? frameDateLabel(frame) : "----"}</span> {frame.title.th || frame.title.en || "(ไม่มีชื่อ)"}
        {p.usingIcon && p.status !== "error" ? <small className="muted"> · ไม่มีรูป ใช้ภาพไอคอน</small> : null}
      </figcaption>
      <PrintControls p={p} slider />
    </figure>
  );
}

function FrameEditor({
  frame,
  onChange,
  index,
  t,
}: {
  frame: Frame;
  onChange: (f: Frame) => void;
  index: number;
  t: number;
}) {
  const f = bind(frame, onChange);
  const dateErr = SortDate.safeParse(frame.date).success ? undefined : "ใช้รูปแบบ YYYY หรือ YYYY-MM เช่น 2023 หรือ 2023-05";
  return (
    <div className="frame-editor">
      <div className="frame-top">
        <div className="frame-fields">
          <Grid>
            <TextField
              label="วันที่ (เรียงลำดับ)"
              mono
              required
              placeholder="2023-05"
              inputMode="numeric"
              error={dateErr}
              {...f("date")}
            />
            <TextField label="ป้ายวันที่ (แทนวันที่)" placeholder="เช่น ~2020 หรือ NOW" hint="เว้นว่าง = ใช้วันที่" {...f("dateLabel")} />
          </Grid>
          <IdField auto={autoId(frame.title.en, "frame")} {...f("id")} />
          <Toggle label="เผยแพร่บนเว็บ" hint={DRAFT_HINT} {...f("published")} />
        </div>
        <FramePreview frame={frame} t={t} seed={index * 7 + 3} />
      </div>
      <LocalizedField label="หัวข้อ" required {...f("title")} />
      <LocalizedField label="สรุปสั้น (summary)" multiline rows={3} required {...f("summary")} />
      <LocalizedField label="รายละเอียด (body)" multiline rows={6} hint="แสดงเมื่อเปิดดูเฟรม เว้นว่างได้" {...f("body")} />
      <IconPicker {...f("icon")} />
      <TagsField label="แท็ก" {...f("tags")} />
      <ImagesField
        label="รูปในเฟรม"
        folder="timeline"
        path={`timeline.${index}.images`}
        hint="รูปแรกใช้เป็นภาพบนฟิล์ม"
        aspect={FRAME_ASPECT}
        {...f("images")}
      />
      <LinksEditor path={`timeline.${index}.links`} {...f("links")} />
    </div>
  );
}

export function TimelineSection({ value, onChange }: { value: Frame[]; onChange: (v: Frame[]) => void }) {
  const order = useMemo(() => dateOrder(value), [value]);
  const [selected, setSelected] = useState<number>(() => order[order.length - 1] ?? 0);
  const sel = Math.min(selected, value.length - 1);
  const frame = value[sel];

  const jump = useJump();
  useEffect(() => {
    if (!jump?.path.startsWith("timeline.")) return;
    const idx = Number(jump.path.split(".")[1]);
    if (Number.isInteger(idx) && idx < value.length) setSelected(idx);
  }, [jump]);

  const add = () => {
    onChange(insertItem(value, value.length, newFrame()));
    setSelected(value.length);
  };
  const duplicate = () => {
    if (!frame) return;
    onChange(insertItem(value, sel + 1, { ...structuredClone(frame), id: "", published: false }));
    setSelected(sel + 1);
  };
  const remove = () => {
    const pos = order.indexOf(sel);
    const neighbour = order[pos + 1] ?? order[pos - 1];
    onChange(removeItem(value, sel));
    if (neighbour === undefined) setSelected(0);
    else setSelected(neighbour > sel ? neighbour - 1 : neighbour);
  };

  const tOf = (i: number) => {
    const pos = order.indexOf(i);
    return order.length > 1 ? pos / (order.length - 1) : 0.4;
  };

  return (
    <>
      <SectionHead title="ฟิล์ม Timeline" en="Film frames">
        แต่ละเฟรมคือหนึ่งช่วงชีวิต เรียงตามวันที่อัตโนมัติ · เฟรมร่างไม่แสดงบนเว็บ และไม่อยู่ในไฟล์สาธารณะ {UPLOADS_PUBLIC}
      </SectionHead>
      <div className="tl">
        <nav className="tl-list px" aria-label="รายการเฟรม">
          <ol>
            {order.map((i) => {
              const fr = value[i]!;
              const bad = !SortDate.safeParse(fr.date).success;
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={`tl-item${i === sel ? " is-on" : ""}`}
                    aria-current={i === sel ? "true" : undefined}
                    onClick={() => setSelected(i)}
                  >
                    <SpriteIcon icon={fr.icon} scale={2} />
                    <span className="tl-date lcd">{bad ? "????" : frameDateLabel(fr)}</span>
                    <span className="tl-title">{fr.title.th || fr.title.en || "(ไม่มีชื่อ)"}</span>
                    {!fr.published ? <Chip tone="warn">ร่าง</Chip> : null}
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" className="btn btn-sm tl-add" onClick={add}>
            + เพิ่มเฟรม
          </button>
        </nav>
        <div className="tl-detail">
          {frame ? (
            <>
              <div className="tl-detail-head">
                <h2>
                  เฟรม <span className="lcd">{frame.id || "(ใหม่)"}</span>
                </h2>
                <div className="btnrow">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={duplicate}>
                    ทำสำเนา
                  </button>
                  <ConfirmButton label="ลบเฟรม" question="ลบเฟรมนี้?" onConfirm={remove} />
                </div>
              </div>
              <FrameEditor
                key={sel}
                frame={frame}
                index={sel}
                t={tOf(sel)}
                onChange={(next) => onChange(replaceItem(value, sel, next))}
              />
            </>
          ) : (
            <p className="empty">ยังไม่มีเฟรม — กด “เพิ่มเฟรม”</p>
          )}
        </div>
      </div>
    </>
  );
}
