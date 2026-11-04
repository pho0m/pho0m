import { useMemo, useState } from "react";
import { PROJECT_GROUPS, type Project } from "@pho0m/content";
import { autoId } from "../validate.ts";
import { Grid, IdField, LocalizedField, Select, TagsField, TextField, Toggle, bind } from "../fields/basic.tsx";
import { ImageField } from "../fields/ImageField.tsx";
import { ListEditor } from "../fields/ListEditor.tsx";
import { Chip, SectionHead } from "./common.tsx";

const GROUP_LABEL: Record<Project["group"], string> = {
  utotech: "Utotech",
  personal: "ส่วนตัว",
  teaching: "สอน / แบ่งปัน",
  school: "งานเรียน",
  coop: "สหกิจ",
};
const GROUP_OPTIONS = PROJECT_GROUPS.map((g) => ({ value: g, label: `${GROUP_LABEL[g]} (${g})` }));

function ProjectEditor({ value, onChange }: { value: Project; onChange: (v: Project) => void }) {
  const f = bind(value, onChange);
  return (
    <>
      <Grid>
        <TextField label="ชื่อโปรเจกต์" required error={value.name.trim() ? undefined : "ต้องกรอกชื่อ"} {...f("name")} />
        <IdField auto={autoId(value.name, "project")} {...f("id")} />
      </Grid>
      <Grid cols={3}>
        <Select label="กลุ่ม" options={GROUP_OPTIONS} {...f("group")} />
        <TextField label="ปี" placeholder="2025" inputMode="numeric" {...f("year")} />
        <div className="toggles">
          <Toggle label="แสดงบนเว็บ" {...f("published")} />
          <Toggle label="เด่น (featured)" {...f("featured")} />
        </div>
      </Grid>
      <LocalizedField label="คำอธิบาย" multiline rows={3} required {...f("description")} />
      <Grid>
        <TextField label="ลิงก์เว็บ / เดโม" type="url" mono placeholder="https://…" {...f("url")} />
        <TextField label="ลิงก์ซอร์สโค้ด (repo)" type="url" mono placeholder="https://github.com/…" {...f("repo")} />
      </Grid>
      <TagsField label="เทคโนโลยี / แท็ก" {...f("tags")} />
      <ImageField label="รูปประกอบ" folder="projects" {...f("image")} />
    </>
  );
}

export function ProjectsSection({ value, onChange }: { value: Project[]; onChange: (v: Project[]) => void }) {
  const [filter, setFilter] = useState<Project["group"] | "all">("all");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    value.forEach((p) => m.set(p.group, (m.get(p.group) ?? 0) + 1));
    return m;
  }, [value]);
  return (
    <>
      <SectionHead title="โปรเจกต์" en="Projects">
        งานส่วนตัว งานสอน งานเรียน และโปรเจกต์ที่ทำให้ Utotech · ลำดับในรายการ = ลำดับบนเว็บ
      </SectionHead>
      <div className="filter-row" role="group" aria-label="กรองตามกลุ่ม">
        <button type="button" className={`chip-btn${filter === "all" ? " is-on" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          ทั้งหมด {value.length}
        </button>
        {PROJECT_GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            className={`chip-btn${filter === g ? " is-on" : ""}`}
            aria-pressed={filter === g}
            onClick={() => setFilter(g)}
          >
            {GROUP_LABEL[g]} {counts.get(g) ?? 0}
          </button>
        ))}
      </div>
      <ListEditor
        label="รายการโปรเจกต์"
        path="projects"
        items={value}
        onChange={onChange}
        create={() => ({
          id: "",
          name: "",
          description: { th: "", en: "" },
          url: "",
          repo: "",
          tags: [],
          group: filter === "all" ? "personal" : filter,
          year: String(new Date().getFullYear()),
          featured: false,
          published: false,
        })}
        addLabel="เพิ่มโปรเจกต์"
        collapsed
        filter={filter === "all" ? undefined : (p) => p.group === filter}
        title={(p) => (
          <>
            {p.name} <Chip>{GROUP_LABEL[p.group]}</Chip> {p.year ? <small className="muted">{p.year}</small> : null}{" "}
            {!p.published ? <Chip tone="warn">ซ่อน</Chip> : null}
            {p.featured ? <Chip tone="ok">เด่น</Chip> : null}
          </>
        )}
        render={(p, set) => <ProjectEditor value={p} onChange={set} />}
      />
    </>
  );
}
