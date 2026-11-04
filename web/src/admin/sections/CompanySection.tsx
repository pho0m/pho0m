import type { Company, CompanyProject, CompanyService, Customer } from "@pho0m/content";
import { autoId } from "../validate.ts";
import { Grid, Group, IdField, LocalizedField, TextField, Toggle, bind } from "../fields/basic.tsx";
import { ImageField, ImagesField } from "../fields/ImageField.tsx";
import { LinksEditor } from "../fields/LinksEditor.tsx";
import { ListEditor } from "../fields/ListEditor.tsx";
import { Chip, SectionHead } from "./common.tsx";

const L = () => ({ th: "", en: "" });

function ServiceEditor({ value, onChange }: { value: CompanyService; onChange: (v: CompanyService) => void }) {
  const f = bind(value, onChange);
  return (
    <>
      <IdField auto={autoId(value.title.en, "service")} {...f("id")} />
      <LocalizedField label="ชื่อบริการ" required {...f("title")} />
      <LocalizedField label="คำโปรย (subtitle)" {...f("subtitle")} />
      <LocalizedField label="รายละเอียด" multiline rows={4} required {...f("description")} />
      <LocalizedField label="ราคา" hint="เช่น เริ่มต้น 50,000 บาท / Starts at 50,000 THB" {...f("price")} />
      <ImageField label="รูปประกอบ" folder="utotech" {...f("image")} />
    </>
  );
}

function ProjectEditor({
  value,
  onChange,
  path,
}: {
  value: CompanyProject;
  onChange: (v: CompanyProject) => void;
  path: string;
}) {
  const f = bind(value, onChange);
  return (
    <>
      <Grid>
        <TextField label="ชื่อโปรเจกต์" required error={value.name.trim() ? undefined : "ต้องกรอกชื่อ"} {...f("name")} />
        <TextField label="หมวด (category)" placeholder="Platform / Web Application" {...f("category")} />
      </Grid>
      <Grid>
        <IdField auto={autoId(value.name, "project")} {...f("id")} />
        <TextField label="ลิงก์เว็บไซต์" type="url" mono placeholder="https://…" {...f("url")} />
      </Grid>
      <div className="toggles">
        <Toggle label="แสดงบนเว็บ" {...f("published")} />
        <Toggle label="โปรเจกต์เด่น (featured)" {...f("featured")} />
      </div>
      <LocalizedField label="สรุปสั้น" required {...f("summary")} />
      <LocalizedField label="รายละเอียด" multiline rows={4} {...f("description")} />
      <ImageField label="รูปปก (cover)" folder="utotech" {...f("cover")} />
      <ListEditor
        label="ฟีเจอร์ (พร้อมภาพหน้าจอ)"
        path={`${path}.features`}
        items={value.features}
        onChange={f("features").onChange}
        create={() => ({ title: L(), description: L() })}
        addLabel="เพิ่มฟีเจอร์"
        collapsed
        title={(ft) => (
          <span className="img-title">
            {ft.image?.url ? <img src={ft.image.url} alt="" loading="lazy" /> : null}
            <span>{ft.title.th || ft.title.en}</span>
          </span>
        )}
        render={(ft, set) => {
          const g = bind(ft, set);
          return (
            <>
              <LocalizedField label="ชื่อฟีเจอร์" required {...g("title")} />
              <LocalizedField label="คำอธิบาย" multiline rows={3} {...g("description")} />
              <ImageField label="ภาพหน้าจอ" folder="utotech" {...g("image")} />
            </>
          );
        }}
      />
    </>
  );
}

function CustomerEditor({ value, onChange }: { value: Customer; onChange: (v: Customer) => void }) {
  const f = bind(value, onChange);
  return (
    <>
      <Grid>
        <TextField label="ชื่อลูกค้า" required error={value.name.trim() ? undefined : "ต้องกรอกชื่อ"} {...f("name")} />
        <TextField label="เว็บไซต์" type="url" mono placeholder="https://…" {...f("url")} />
      </Grid>
      <ImageField label="โลโก้" folder="utotech" {...f("logo")} />
    </>
  );
}

export function CompanySection({ value, onChange }: { value: Company; onChange: (v: Company) => void }) {
  const f = bind(value, onChange);
  const c = bind(value.contact, (contact) => onChange({ ...value, contact }));
  return (
    <>
      <SectionHead title="Utotech" en="Company">
        ข้อมูลบริษัท ยูโทเทค จำกัด: บริการ ผลงาน ลูกค้า และช่องทางติดต่อ
      </SectionHead>

      <Group title="ข้อมูลหลัก" hint="Names, role, founded">
        <LocalizedField label="ชื่อบริษัท" required {...f("name")} />
        <Grid cols={3}>
          <TextField label="ชื่อย่อ" placeholder="Utotech" {...f("shortName")} />
          <TextField label="ปีที่ก่อตั้ง" placeholder="2023" inputMode="numeric" {...f("founded")} />
          <TextField label="ขนาดทีม" placeholder="10+" {...f("teamSize")} />
        </Grid>
        <LocalizedField label="หมายเหตุการก่อตั้ง" {...f("foundedNote")} />
        <LocalizedField label="บทบาทของผมในบริษัท (role)" required {...f("role")} />
        <LocalizedField label="แท็กไลน์" {...f("tagline")} />
        <LocalizedField label="สโลแกน" {...f("slogan")} />
      </Group>

      <Group title="โลโก้และภาพปก" hint="Logo & cover">
        <ImageField label="โลโก้" folder="utotech" {...f("logo")} />
        <ImageField label="ภาพปก" folder="utotech" aspect={4 / 3} {...f("cover")} />
      </Group>

      <Group title="เรื่องราวบริษัท" hint="About, mission, vision, story">
        <LocalizedField label="เกี่ยวกับบริษัท (about)" multiline rows={5} required {...f("about")} />
        <LocalizedField label="พันธกิจ (mission)" multiline rows={3} {...f("mission")} />
        <LocalizedField label="วิสัยทัศน์ (vision)" multiline rows={3} {...f("vision")} />
        <LocalizedField label="เรื่องเล่า (story)" multiline rows={5} {...f("story")} />
      </Group>

      <Group title="จุดเด่น" hint="Highlights" defaultOpen={false}>
        <ListEditor
          label="จุดเด่น"
          path="company.highlights"
          items={value.highlights}
          onChange={f("highlights").onChange}
          create={() => ({ title: L(), description: L() })}
          addLabel="เพิ่มจุดเด่น"
          title={(h) => h.title.th || h.title.en}
          render={(h, set) => {
            const g = bind(h, set);
            return (
              <>
                <LocalizedField label="หัวข้อ" required {...g("title")} />
                <LocalizedField label="คำอธิบาย" multiline rows={3} required {...g("description")} />
                <ImageField label="รูป" folder="utotech" aspect={4 / 3} {...g("image")} />
              </>
            );
          }}
        />
      </Group>

      <Group title="ร่วมงานกับเรา" hint="Work with us" defaultOpen={false}>
        <ListEditor
          label="ขั้นตอน / เหตุผลที่ร่วมงาน"
          path="company.workWithUs"
          items={value.workWithUs}
          onChange={f("workWithUs").onChange}
          create={() => ({ title: L(), heading: L(), description: L() })}
          addLabel="เพิ่มหัวข้อ"
          title={(w) => w.title.th || w.title.en}
          render={(w, set) => {
            const g = bind(w, set);
            return (
              <>
                <LocalizedField label="ป้ายสั้น (title)" required {...g("title")} />
                <LocalizedField label="หัวข้อ (heading)" required {...g("heading")} />
                <LocalizedField label="คำอธิบาย" multiline rows={3} required {...g("description")} />
                <ImageField label="รูป" folder="utotech" aspect={4 / 3} {...g("image")} />
              </>
            );
          }}
        />
      </Group>

      <Group title="บริการ" hint={`Services · ${value.services.length}`} defaultOpen={false}>
        <ListEditor
          label="บริการและราคา"
          path="company.services"
          items={value.services}
          onChange={f("services").onChange}
          create={() => ({ id: "", title: L(), subtitle: L(), description: L(), price: L() })}
          addLabel="เพิ่มบริการ"
          title={(s) => (
            <>
              {s.title.th || s.title.en} {s.price.th || s.price.en ? <Chip tone="ok">{s.price.th || s.price.en}</Chip> : null}
            </>
          )}
          render={(s, set) => <ServiceEditor value={s} onChange={set} />}
        />
      </Group>

      <Group title="ผลงาน" hint={`Projects · ${value.projects.length}`} defaultOpen={false}>
        <ListEditor
          label="ผลงานของบริษัท"
          path="company.projects"
          items={value.projects}
          onChange={f("projects").onChange}
          create={() => ({
            id: "",
            name: "",
            category: "",
            summary: L(),
            description: L(),
            url: "",
            features: [],
            featured: false,
            published: false,
          })}
          addLabel="เพิ่มผลงาน"
          title={(p) => (
            <>
              {p.name} <small className="muted">{p.category}</small>{" "}
              {!p.published ? <Chip tone="warn">ซ่อน</Chip> : null}
              {p.featured ? <Chip tone="ok">เด่น</Chip> : null}
              <Chip>{p.features.length} ฟีเจอร์</Chip>
            </>
          )}
          render={(p, set, i) => <ProjectEditor value={p} onChange={set} path={`company.projects.${i}`} />}
        />
      </Group>

      <Group title="ลูกค้า" hint={`Customers · ${value.customers.length}`} defaultOpen={false}>
        <ListEditor
          label="ลูกค้า"
          path="company.customers"
          items={value.customers}
          onChange={f("customers").onChange}
          create={() => ({ name: "", url: "" })}
          addLabel="เพิ่มลูกค้า"
          title={(cu) => (
            <span className="img-title">
              {cu.logo?.url ? <img src={cu.logo.url} alt="" loading="lazy" /> : null}
              <span>{cu.name}</span>
            </span>
          )}
          render={(cu, set) => <CustomerEditor value={cu} onChange={set} />}
        />
      </Group>

      <Group title="แกลเลอรี" hint={`Gallery · ${value.gallery.length}`} defaultOpen={false}>
        <ImagesField label="รูปบรรยากาศ" folder="utotech" path="company.gallery" aspect={4 / 3} {...f("gallery")} />
      </Group>

      <Group title="ติดต่อ" hint="Contact, addresses, tax ID">
        <Grid cols={3}>
          <TextField label="อีเมลบริษัท" type="email" {...c("email")} />
          <TextField label="อีเมล CEO" type="email" {...c("ceoEmail")} />
          <TextField label="โทรศัพท์" type="tel" {...c("phone")} />
        </Grid>
        <LocalizedField label="ที่อยู่สำนักงาน" multiline rows={3} {...c("officeAddress")} />
        <LocalizedField label="ที่อยู่ตามทะเบียน" multiline rows={3} {...c("registeredAddress")} />
        <TextField label="เลขประจำตัวผู้เสียภาษี" mono inputMode="numeric" {...c("taxId")} />
        <LinksEditor label="ลิงก์ของบริษัท" path="company.links" {...f("links")} />
      </Group>
    </>
  );
}
