import { LINK_KINDS, type Link } from "@pho0m/content";
import { Select, TextField, UrlField } from "./basic.tsx";
import { ListEditor } from "./ListEditor.tsx";

const KIND_LABEL: Record<Link["kind"], string> = {
  website: "เว็บไซต์",
  github: "GitHub",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  youtube: "YouTube",
  tiktok: "TikTok",
  line: "LINE",
  email: "อีเมล",
  phone: "โทรศัพท์",
  document: "เอกสาร",
  demo: "เดโม",
  other: "อื่น ๆ",
};
const KIND_OPTIONS = LINK_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }));

export function LinksEditor({
  label = "ลิงก์",
  value,
  onChange,
  path,
}: {
  label?: string;
  value: Link[];
  onChange: (v: Link[]) => void;
  path?: string;
}) {
  return (
    <ListEditor
      label={label}
      path={path}
      compact
      items={value}
      onChange={onChange}
      create={(): Link => ({ kind: "website", label: "", url: "" })}
      addLabel="เพิ่มลิงก์"
      empty="ยังไม่มีลิงก์"
      title={(l) => l.label || l.url}
      render={(l, set) => (
        <div className="link-row">
          <Select label="ชนิด" value={l.kind} options={KIND_OPTIONS} onChange={(kind) => set({ ...l, kind })} />
          <TextField label="ข้อความที่แสดง" value={l.label} onChange={(label) => set({ ...l, label })} />
          <UrlField
            label="URL"
            required
            value={l.url}
            placeholder={l.kind === "email" ? "mailto:…" : l.kind === "phone" ? "tel:…" : "https://…"}
            onChange={(url) => set({ ...l, url })}
          />
        </div>
      )}
    />
  );
}
