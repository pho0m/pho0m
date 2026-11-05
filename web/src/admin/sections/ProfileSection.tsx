import type { Profile } from "@pho0m/content";
import { ContactField, Grid, Group, LocalizedField, NumberField, TextField, bind } from "../fields/basic.tsx";
import { ImageField } from "../fields/ImageField.tsx";
import { LinksEditor } from "../fields/LinksEditor.tsx";
import { ListEditor } from "../fields/ListEditor.tsx";
import { SectionHead } from "./common.tsx";

export function ProfileSection({ value, onChange }: { value: Profile; onChange: (v: Profile) => void }) {
  const f = bind(value, onChange);
  return (
    <>
      <SectionHead title="โปรไฟล์" en="Profile">
        ข้อมูลส่วนตัวที่แสดงหน้าแรกและในส่วนติดต่อ
      </SectionHead>
      <Group title="ชื่อและตำแหน่ง" hint="Name & role">
        <LocalizedField label="ชื่อ-นามสกุล" required {...f("name")} />
        <Grid cols={3}>
          <TextField label="ชื่อเล่น" {...f("nickname")} />
          <TextField label="Handle" mono hint="เช่น pho0m" {...f("handle")} />
          <NumberField
            label="เริ่มเขียนโค้ดปี (ค.ศ.)"
            min={1990}
            max={2100}
            hint="ใช้คำนวณจำนวนปีที่เขียนโค้ด"
            {...f("codingSince")}
          />
        </Grid>
        <LocalizedField label="ตำแหน่ง (role)" required {...f("role")} />
        <LocalizedField label="พาดหัว (headline)" required {...f("headline")} />
        <LocalizedField label="ที่อยู่ (location)" {...f("location")} />
      </Group>
      <Group title="แนะนำตัว" hint="Bio & dream">
        <LocalizedField label="แนะนำตัว (bio)" multiline rows={6} required {...f("bio")} />
        <LocalizedField label="ความฝัน (dream)" multiline rows={4} {...f("dream")} />
      </Group>
      <Group title="รูปโปรไฟล์" hint="Avatar">
        <ImageField label="รูปโปรไฟล์" folder="profile" aspect={4 / 5} {...f("avatar")} />
      </Group>
      <Group title="ช่องทางติดต่อ" hint="Contact">
        <Grid>
          <ContactField label="อีเมล" type="email" {...f("email")} />
          <ContactField label="โทรศัพท์" type="tel" {...f("phone")} />
        </Grid>
        <LinksEditor label="ลิงก์โซเชียล" path="profile.links" {...f("links")} />
      </Group>
      <Group title="การศึกษา" hint="Education">
        <ListEditor
          label="ประวัติการศึกษา"
          path="profile.education"
          items={value.education}
          onChange={f("education").onChange}
          create={() => ({ school: { th: "", en: "" }, program: { th: "", en: "" }, period: "" })}
          addLabel="เพิ่มสถานศึกษา"
          title={(e) => [e.school.th || e.school.en, e.period].filter(Boolean).join(" · ")}
          render={(e, set) => {
            const g = bind(e, set);
            return (
              <>
                <LocalizedField label="สถานศึกษา" required {...g("school")} />
                <LocalizedField label="หลักสูตร / สาขา" required {...g("program")} />
                <TextField label="ช่วงเวลา" placeholder="2019 - 2021" {...g("period")} />
              </>
            );
          }}
        />
      </Group>
    </>
  );
}
