import { z } from "zod";

/**
 * Single content contract shared by the site, the admin, the API and the README generator.
 * Every user-facing string that can be translated is a `Localized` pair; the UI falls back to
 * the other language when one side is empty.
 */

export const LANGS = ["th", "en"] as const;
export type Lang = (typeof LANGS)[number];

export const Localized = z.object({
  th: z.string().default(""),
  en: z.string().default(""),
});
export type Localized = z.infer<typeof Localized>;
const emptyL = () => ({ th: "", en: "" });

/** 16x16 pixel sprites available for timeline frames (drawn by web/src/lib/sprites.ts and the README tool). */
export const ICON_NAMES = [
  "laptop",
  "note",
  "chedi",
  "eye",
  "check",
  "drop",
  "board",
  "bubble",
  "rocket",
  "brief",
  "star",
  "cap",
  "code",
  "flag",
] as const;
export const IconName = z.enum(ICON_NAMES);
export type IconName = z.infer<typeof IconName>;

/** `url` is absolute (https://…) or site-relative (/media/…, /img/…). */
export const ImageRef = z.object({
  url: z.string().min(1),
  alt: Localized.default(emptyL),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type ImageRef = z.infer<typeof ImageRef>;

export const LINK_KINDS = [
  "website",
  "github",
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "youtube",
  "tiktok",
  "line",
  "email",
  "phone",
  "document",
  "demo",
  "other",
] as const;
export const LinkKind = z.enum(LINK_KINDS);
export const Link = z.object({
  kind: LinkKind.default("website"),
  label: z.string().default(""),
  url: z.string().min(1),
});
export type Link = z.infer<typeof Link>;

export const ContactValue = z.object({
  value: z.string().default(""),
  visible: z.boolean().default(false),
});

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, numbers and dashes");

/** YYYY or YYYY-MM — used for sorting the timeline. */
export const SortDate = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "use YYYY or YYYY-MM");

export const Profile = z.object({
  name: Localized,
  nickname: z.string().default(""),
  handle: z.string().default(""),
  role: Localized,
  headline: Localized,
  bio: Localized,
  dream: Localized.default(emptyL),
  location: Localized.default(emptyL),
  avatar: ImageRef.optional(),
  email: ContactValue,
  phone: ContactValue,
  links: z.array(Link).default([]),
  education: z
    .array(
      z.object({
        school: Localized,
        program: Localized,
        period: z.string().default(""),
      }),
    )
    .default([]),
  /** Year the person started programming (for "years coding" stats). */
  codingSince: z.number().int().min(1990).max(2100).optional(),
});
export type Profile = z.infer<typeof Profile>;

export const Frame = z.object({
  id,
  date: SortDate,
  /** Optional label shown instead of the date, e.g. "~2020" or "NOW". */
  dateLabel: z.string().default(""),
  title: Localized,
  summary: Localized,
  body: Localized.default(emptyL),
  icon: IconName.default("star"),
  tags: z.array(z.string()).default([]),
  images: z.array(ImageRef).default([]),
  links: z.array(Link).default([]),
  published: z.boolean().default(true),
});
export type Frame = z.infer<typeof Frame>;

export const CompanyService = z.object({
  id,
  title: Localized,
  subtitle: Localized.default(emptyL),
  description: Localized,
  price: Localized.default(emptyL),
  image: ImageRef.optional(),
});
export type CompanyService = z.infer<typeof CompanyService>;

export const CompanyProject = z.object({
  id,
  name: z.string().min(1),
  category: z.string().default(""),
  summary: Localized,
  description: Localized.default(emptyL),
  url: z.string().default(""),
  cover: ImageRef.optional(),
  features: z
    .array(
      z.object({
        title: Localized,
        description: Localized.default(emptyL),
        image: ImageRef.optional(),
      }),
    )
    .default([]),
  featured: z.boolean().default(false),
  published: z.boolean().default(true),
});
export type CompanyProject = z.infer<typeof CompanyProject>;

export const Customer = z.object({
  name: z.string().min(1),
  logo: ImageRef.optional(),
  url: z.string().default(""),
});
export type Customer = z.infer<typeof Customer>;

export const Company = z.object({
  name: Localized,
  shortName: z.string().default(""),
  role: Localized,
  tagline: Localized.default(emptyL),
  slogan: Localized.default(emptyL),
  founded: z.string().default(""),
  foundedNote: Localized.default(emptyL),
  teamSize: z.string().default(""),
  logo: ImageRef.optional(),
  cover: ImageRef.optional(),
  about: Localized,
  mission: Localized.default(emptyL),
  vision: Localized.default(emptyL),
  story: Localized.default(emptyL),
  highlights: z
    .array(z.object({ title: Localized, description: Localized, image: ImageRef.optional() }))
    .default([]),
  workWithUs: z
    .array(
      z.object({
        title: Localized,
        heading: Localized,
        description: Localized,
        image: ImageRef.optional(),
      }),
    )
    .default([]),
  services: z.array(CompanyService).default([]),
  projects: z.array(CompanyProject).default([]),
  customers: z.array(Customer).default([]),
  gallery: z.array(ImageRef).default([]),
  contact: z.object({
    email: z.string().default(""),
    ceoEmail: z.string().default(""),
    phone: z.string().default(""),
    officeAddress: Localized.default(emptyL),
    registeredAddress: Localized.default(emptyL),
    taxId: z.string().default(""),
  }),
  links: z.array(Link).default([]),
});
export type Company = z.infer<typeof Company>;

export const PROJECT_GROUPS = ["utotech", "personal", "teaching", "school", "coop"] as const;
export const Project = z.object({
  id,
  name: z.string().min(1),
  description: Localized,
  url: z.string().default(""),
  repo: z.string().default(""),
  tags: z.array(z.string()).default([]),
  group: z.enum(PROJECT_GROUPS).default("personal"),
  year: z.string().default(""),
  featured: z.boolean().default(false),
  image: ImageRef.optional(),
  published: z.boolean().default(true),
});
export type Project = z.infer<typeof Project>;

export const SkillItem = z.object({
  name: z.string().min(1),
  /** simple-icons slug; empty → monogram badge. */
  slug: z.string().default(""),
});
export const SkillGroup = z.object({
  id,
  /** 3 = work-ready, 2 = side-project ready, 1 = have tried. */
  level: z.number().int().min(1).max(3),
  title: Localized,
  description: Localized.default(emptyL),
  items: z.array(SkillItem).default([]),
});
export type SkillGroup = z.infer<typeof SkillGroup>;

export const DiaryEntry = z.object({
  id,
  month: Localized,
  period: z.string().default(""),
  title: Localized,
  body: Localized,
  images: z.array(ImageRef).default([]),
});
export type DiaryEntry = z.infer<typeof DiaryEntry>;

export const Diary = z.object({
  title: Localized,
  intro: Localized.default(emptyL),
  company: z.object({
    name: Localized,
    legalName: z.string().default(""),
    type: Localized.default(emptyL),
    address: Localized.default(emptyL),
    about: Localized.default(emptyL),
    website: z.string().default(""),
    facebook: z.string().default(""),
    logo: ImageRef.optional(),
  }),
  duties: z.array(z.object({ title: Localized, description: Localized })).default([]),
  entries: z.array(DiaryEntry).default([]),
  sheetUrl: z.string().default(""),
  slidesUrl: z.string().default(""),
});
export type Diary = z.infer<typeof Diary>;

export const DocumentItem = z.object({
  id,
  title: Localized,
  description: Localized.default(emptyL),
  /** Empty url → hidden on the site until a file is uploaded. */
  url: z.string().default(""),
  image: ImageRef.optional(),
});
export type DocumentItem = z.infer<typeof DocumentItem>;

export const Site = z.object({
  defaultLang: z.enum(LANGS).default("th"),
  url: z.string().default("https://kiattiphoom-pho0m.web.app"),
  title: Localized,
  description: Localized,
  ogImage: ImageRef.optional(),
});
export type Site = z.infer<typeof Site>;

export const Content = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().default(""),
  site: Site,
  profile: Profile,
  timeline: z.array(Frame),
  company: Company,
  projects: z.array(Project).default([]),
  skills: z.array(SkillGroup).default([]),
  diary: Diary,
  documents: z.array(DocumentItem).default([]),
});
export type Content = z.infer<typeof Content>;
export type ContentInput = z.input<typeof Content>;
