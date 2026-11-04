import type { DocumentItem } from "@pho0m/content";
import { autoId } from "../validate.ts";
import { IdField, LocalizedField, bind } from "../fields/basic.tsx";
import { FileUrlField, ImageField } from "../fields/ImageField.tsx";
import { ListEditor } from "../fields/ListEditor.tsx";
import { Chip, SectionHead } from "./common.tsx";

function DocEditor({ value, onChange }: { value: DocumentItem; onChange: (v: DocumentItem) => void }) {
  const f = bind(value, onChange);
  return (
    <>
      <LocalizedField label="ชื่อเอกสาร" required {...f("title")} />
      <IdField auto={autoId(value.title.en, "document")} {...f("id")} />
      <LocalizedField label="คำอธิบาย" {...f("description")} />
      <FileUrlField
        label="ไฟล์ / ลิงก์"
        hint="อัปโหลด PDF หรือวางลิงก์ (Canva, Google Sheets…) · เว้นว่าง = ยังไม่แสดงบนเว็บ"
        {...f("url")}
      />
      <ImageField label="ภาพตัวอย่าง (ไม่บังคับ)" folder="docs" {...f("image")} />
    </>
  );
}

export function DocumentsSection({ value, onChange }: { value: DocumentItem[]; onChange: (v: DocumentItem[]) => void }) {
  return (
    <>
      <SectionHead title="เอกสาร" en="Documents">
        CV พอร์ตโฟลิโอ PDF และลิงก์เอกสารอื่น ๆ · รายการที่ไม่มีลิงก์จะยังไม่แสดงบนเว็บ
      </SectionHead>
      <ListEditor
        label="เอกสาร"
        path="documents"
        items={value}
        onChange={onChange}
        create={() => ({ id: "", title: { th: "", en: "" }, description: { th: "", en: "" }, url: "" })}
        addLabel="เพิ่มเอกสาร"
        title={(d) => (
          <>
            {d.title.th || d.title.en} {d.url ? <Chip tone="ok">มีไฟล์</Chip> : <Chip tone="warn">ยังไม่มีไฟล์ · ซ่อน</Chip>}
          </>
        )}
        render={(d, set) => <DocEditor value={d} onChange={set} />}
      />
    </>
  );
}
