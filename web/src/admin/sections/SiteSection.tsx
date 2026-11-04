import type { Site } from "@pho0m/content";
import { Group, LocalizedField, Select, TextField, bind } from "../fields/basic.tsx";
import { ImageField } from "../fields/ImageField.tsx";
import { SectionHead } from "./common.tsx";

export function SiteSection({ value, onChange }: { value: Site; onChange: (v: Site) => void }) {
  const f = bind(value, onChange);
  const urlOk = /^https?:\/\/[^\s/]+/i.test(value.url);
  return (
    <>
      <SectionHead title="ตั้งค่าเว็บ" en="Site settings">
        ชื่อเว็บ คำอธิบายสำหรับ Google และรูปตอนแชร์ลิงก์
      </SectionHead>
      <Group title="ทั่วไป" hint="General">
        <Select
          label="ภาษาเริ่มต้น"
          options={[
            { value: "th", label: "ไทย (th)" },
            { value: "en", label: "English (en)" },
          ]}
          hint="ภาษาที่ผู้เข้าชมเห็นครั้งแรก (ผู้ใช้เปลี่ยนเองได้)"
          {...f("defaultLang")}
        />
        <TextField
          label="URL ของเว็บ"
          type="url"
          mono
          error={urlOk ? undefined : "ต้องขึ้นต้นด้วย https://"}
          hint="ใช้สร้างลิงก์เต็มของรูปตอนแชร์ และปุ่ม 'เปิดเว็บ' หลังบันทึก"
          {...f("url")}
        />
      </Group>
      <Group title="SEO และการแชร์" hint="Title, description, share image">
        <LocalizedField label="ชื่อเว็บ (title)" required {...f("title")} />
        <LocalizedField
          label="คำอธิบาย (description)"
          multiline
          rows={3}
          required
          hint="ประมาณ 1–2 ประโยค แสดงใน Google และตอนแชร์"
          {...f("description")}
        />
        <ImageField label="รูปตอนแชร์ (og:image)" folder="site" hint="แนะนำ 1200×630" {...f("ogImage")} />
      </Group>
    </>
  );
}
