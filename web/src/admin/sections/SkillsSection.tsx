import type { SkillGroup } from "@pho0m/content";
import { autoId } from "../validate.ts";
import { Grid, IdField, LocalizedField, Select, TextField, bind } from "../fields/basic.tsx";
import { ListEditor } from "../fields/ListEditor.tsx";
import { Chip, SectionHead } from "./common.tsx";

const LEVELS = [
  { value: 3, label: "3 · ใช้ทำงานจริง (work-ready)" },
  { value: 2, label: "2 · ทำโปรเจกต์ส่วนตัวได้ (side projects)" },
  { value: 1, label: "1 · เคยลองใช้ (tried)" },
] as const;

function GroupEditor({ value, onChange, path }: { value: SkillGroup; onChange: (v: SkillGroup) => void; path: string }) {
  const f = bind(value, onChange);
  return (
    <>
      <Grid>
        <Select label="ระดับ" options={LEVELS} value={value.level as 1 | 2 | 3} onChange={(level) => onChange({ ...value, level })} />
        <IdField auto={autoId(value.title.en, "skills")} {...f("id")} />
      </Grid>
      <LocalizedField label="ชื่อกลุ่ม" required {...f("title")} />
      <LocalizedField label="คำอธิบาย" multiline rows={2} {...f("description")} />
      <ListEditor
        label="ทักษะในกลุ่มนี้"
        path={`${path}.items`}
        compact
        items={value.items}
        onChange={f("items").onChange}
        create={() => ({ name: "", slug: "" })}
        addLabel="เพิ่มทักษะ"
        title={(s) => s.name}
        hint="slug คือชื่อไอคอนจาก simpleicons.org เช่น typescript, nodedotjs · เว้นว่าง = ใช้อักษรย่อแทน"
        render={(s, set) => (
          <div className="skill-row">
            <TextField
              label="ชื่อ"
              value={s.name}
              error={s.name.trim() ? undefined : "ต้องกรอกชื่อ"}
              onChange={(name) => set({ ...s, name })}
            />
            <TextField
              label="slug ไอคอน"
              mono
              value={s.slug}
              placeholder="typescript"
              onChange={(slug) => set({ ...s, slug: slug.toLowerCase().trim() })}
            />
          </div>
        )}
      />
    </>
  );
}

export function SkillsSection({ value, onChange }: { value: SkillGroup[]; onChange: (v: SkillGroup[]) => void }) {
  return (
    <>
      <SectionHead title="ทักษะ" en="Skills">
        จัดกลุ่มตามระดับ 1–3 · ลำดับกลุ่มและทักษะ = ลำดับบนเว็บ
      </SectionHead>
      <ListEditor
        label="กลุ่มทักษะ"
        path="skills"
        items={value}
        onChange={onChange}
        create={() => ({ id: "", level: 2, title: { th: "", en: "" }, description: { th: "", en: "" }, items: [] })}
        addLabel="เพิ่มกลุ่ม"
        collapsed={false}
        title={(g) => (
          <>
            {g.title.th || g.title.en} <Chip tone={g.level === 3 ? "ok" : g.level === 2 ? "warn" : "muted"}>LV {g.level}</Chip>{" "}
            <small className="muted">{g.items.length} ทักษะ</small>
          </>
        )}
        render={(g, set, i) => <GroupEditor value={g} onChange={set} path={`skills.${i}`} />}
      />
    </>
  );
}
