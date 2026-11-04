import type { Diary, DiaryEntry } from "@pho0m/content";
import { autoId } from "../validate.ts";
import { Grid, Group, IdField, LocalizedField, TextField, bind } from "../fields/basic.tsx";
import { ImageField, ImagesField } from "../fields/ImageField.tsx";
import { ListEditor } from "../fields/ListEditor.tsx";
import { SectionHead } from "./common.tsx";

const L = () => ({ th: "", en: "" });

function EntryEditor({ value, onChange, path }: { value: DiaryEntry; onChange: (v: DiaryEntry) => void; path: string }) {
  const f = bind(value, onChange);
  return (
    <>
      <Grid cols={3}>
        <IdField auto={autoId(value.title.en, "entry")} {...f("id")} />
        <TextField label="ช่วงเวลา" placeholder="1 May - 1 June 2023" {...f("period")} />
      </Grid>
      <LocalizedField label="เดือน" required {...f("month")} />
      <LocalizedField label="หัวข้อ" required {...f("title")} />
      <LocalizedField label="บันทึก" multiline rows={8} required {...f("body")} />
      <ImagesField label="รูปประกอบ" folder="diary" path={`${path}.images`} {...f("images")} />
    </>
  );
}

export function DiarySection({ value, onChange }: { value: Diary; onChange: (v: Diary) => void }) {
  const f = bind(value, onChange);
  const co = bind(value.company, (company) => onChange({ ...value, company }));
  return (
    <>
      <SectionHead title="บันทึกสหกิจ" en="Co-op diary">
        บันทึกฝึกงานสหกิจศึกษา 6 เดือน: บริษัท หน้าที่ และบันทึกรายเดือน
      </SectionHead>
      <Group title="หัวเรื่อง" hint="Title & intro">
        <LocalizedField label="ชื่อหัวข้อ" required {...f("title")} />
        <LocalizedField label="บทนำ" multiline rows={4} {...f("intro")} />
        <Grid>
          <TextField label="ลิงก์ตารางบันทึก (Sheets)" type="url" mono {...f("sheetUrl")} />
          <TextField label="ลิงก์สไลด์" type="url" mono {...f("slidesUrl")} />
        </Grid>
      </Group>
      <Group title="สถานประกอบการ" hint="Company" defaultOpen={false}>
        <LocalizedField label="ชื่อบริษัท" required {...co("name")} />
        <Grid>
          <TextField label="ชื่อนิติบุคคล" {...co("legalName")} />
          <TextField label="เว็บไซต์" type="url" mono {...co("website")} />
        </Grid>
        <TextField label="Facebook" type="url" mono {...co("facebook")} />
        <LocalizedField label="ประเภทธุรกิจ" {...co("type")} />
        <LocalizedField label="ที่อยู่" multiline rows={3} {...co("address")} />
        <LocalizedField label="เกี่ยวกับบริษัท" multiline rows={4} {...co("about")} />
        <ImageField label="โลโก้บริษัท" folder="diary" {...co("logo")} />
      </Group>
      <Group title="หน้าที่ที่ได้รับมอบหมาย" hint={`Duties · ${value.duties.length}`} defaultOpen={false}>
        <ListEditor
          label="หน้าที่"
          path="diary.duties"
          items={value.duties}
          onChange={f("duties").onChange}
          create={() => ({ title: L(), description: L() })}
          addLabel="เพิ่มหน้าที่"
          title={(d) => d.title.th || d.title.en}
          render={(d, set) => {
            const g = bind(d, set);
            return (
              <>
                <LocalizedField label="หน้าที่" required {...g("title")} />
                <LocalizedField label="รายละเอียด" multiline rows={3} required {...g("description")} />
              </>
            );
          }}
        />
      </Group>
      <Group title="บันทึกรายเดือน" hint={`Entries · ${value.entries.length}`}>
        <ListEditor
          label="บันทึก"
          path="diary.entries"
          items={value.entries}
          onChange={f("entries").onChange}
          create={() => ({ id: "", month: L(), period: "", title: L(), body: L(), images: [] })}
          addLabel="เพิ่มบันทึก"
          collapsed
          title={(e) => (
            <>
              <span className="lcd">{e.month.th || e.month.en}</span> {e.title.th || e.title.en}
            </>
          )}
          render={(e, set, i) => <EntryEditor value={e} onChange={set} path={`diary.entries.${i}`} />}
        />
      </Group>
    </>
  );
}
