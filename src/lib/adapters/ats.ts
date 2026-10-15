/**
 * Adapters for the applicant-tracking systems companies host their own boards
 * on. These are the earliest public signal for a role: a posting lands here the
 * moment recruiting opens it, typically days to weeks before it is syndicated
 * out to LinkedIn / Bayt / GulfTalent.
 *
 * Every one of these endpoints is the same public JSON the company's own
 * careers page calls from the browser.
 */
import { getJson, getText, htmlToText, mapLimit, toIso } from "../http";
import type { RawJob, SourceDefinition } from "../types";

export type Adapter = (source: SourceDefinition) => Promise<RawJob[]>;

/* ---------------------------------- Greenhouse --------------------------- */

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  content?: string;
  location?: { name?: string };
  departments?: Array<{ name?: string }>;
}

export const greenhouse: Adapter = async (source) => {
  const data = await getJson<{ jobs?: GhJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${source.handle}/jobs?content=true`,
  );
  return (data.jobs ?? []).map((j) => ({
    sourceId: source.id,
    externalId: String(j.id),
    title: j.title,
    company: source.company ?? source.label,
    locationText: j.location?.name ?? "",
    // Greenhouse double-encodes the description HTML.
    descriptionText: htmlToText(decodeEntities(j.content ?? "")),
    url: j.absolute_url,
    postedAt: toIso(j.updated_at),
    department: j.departments?.[0]?.name ?? null,
  }));
};

/* ------------------------------------ Lever ------------------------------ */

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  descriptionPlain?: string;
  lists?: Array<{ text?: string; content?: string }>;
  categories?: { location?: string; team?: string; commitment?: string };
}

export const lever: Adapter = async (source) => {
  const data = await getJson<LeverJob[]>(
    `https://api.lever.co/v0/postings/${source.handle}?mode=json`,
  );
  return (data ?? []).map((j) => ({
    sourceId: source.id,
    externalId: j.id,
    title: j.text,
    company: source.company ?? source.label,
    locationText: j.categories?.location ?? "",
    descriptionText: [
      j.descriptionPlain ?? "",
      ...(j.lists ?? []).map((l) => `${l.text ?? ""} ${htmlToText(l.content)}`),
    ].join(" "),
    url: j.hostedUrl,
    postedAt: toIso(j.createdAt),
    department: j.categories?.team ?? null,
    employmentType: j.categories?.commitment ?? null,
  }));
};

/* ------------------------------------ Ashby ------------------------------ */

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  jobUrl: string;
  publishedAt?: string;
  descriptionPlain?: string;
  department?: string;
  employmentType?: string;
  isListed?: boolean;
}

export const ashby: Adapter = async (source) => {
  const data = await getJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${source.handle}`,
  );
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      sourceId: source.id,
      externalId: j.id,
      title: j.title,
      company: source.company ?? source.label,
      locationText: j.location ?? "",
      descriptionText: j.descriptionPlain ?? "",
      url: j.jobUrl,
      postedAt: toIso(j.publishedAt),
      department: j.department ?? null,
      employmentType: j.employmentType ?? null,
    }));
};

/* -------------------------------- SmartRecruiters ------------------------ */

interface SrPosting {
  id: string;
  name: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string };
  department?: { label?: string };
  typeOfEmployment?: { label?: string };
}

export const smartrecruiters: Adapter = async (source) => {
  const out: RawJob[] = [];
  // Paginate; most Saudi employers sit well under 500 open roles.
  for (let offset = 0; offset < 600; offset += 100) {
    const data = await getJson<{ content?: SrPosting[]; totalFound?: number }>(
      `https://api.smartrecruiters.com/v1/companies/${source.handle}/postings?limit=100&offset=${offset}`,
    );
    const batch = data.content ?? [];
    for (const j of batch) {
      out.push({
        sourceId: source.id,
        externalId: j.id,
        title: j.name,
        company: source.company ?? source.label,
        locationText: [j.location?.city, j.location?.region, j.location?.country]
          .filter(Boolean)
          .join(", "),
        descriptionText: "",
        url: `https://jobs.smartrecruiters.com/${source.handle}/${j.id}`,
        postedAt: toIso(j.releasedDate),
        department: j.department?.label ?? null,
        employmentType: j.typeOfEmployment?.label ?? null,
      });
    }
    if (batch.length < 100) break;
  }

  // The list endpoint omits the description, which the classifier needs for
  // experience + track. Pull detail only for postings that look Saudi.
  const saudi = out.filter((j) => /saudi|ksa|riyadh|jeddah|dammam|khobar|dhahran|neom/i.test(j.locationText ?? "") || !(j.locationText ?? "").trim());
  await mapLimit(saudi.slice(0, 200), 4, async (job) => {
    try {
      const detail = await getJson<{ jobAd?: { sections?: Record<string, { text?: string }> } }>(
        `https://api.smartrecruiters.com/v1/companies/${source.handle}/postings/${job.externalId}`,
      );
      const sections = detail.jobAd?.sections ?? {};
      job.descriptionText = htmlToText(
        Object.values(sections)
          .map((s) => s?.text ?? "")
          .join(" "),
      );
    } catch {
      /* detail is best-effort; the listing row still counts */
    }
  });

  return out;
};

/* ---------------------------------- Workable ----------------------------- */

interface WorkableJob {
  id?: string;
  shortcode?: string;
  title: string;
  shortlink?: string;
  url?: string;
  created_at?: string;
  published_on?: string;
  description?: string;
  requirements?: string;
  department?: string;
  employment_type?: string;
  location?: { city?: string; region?: string; country?: string };
  /* The widget API returns these flat, alongside (not inside) `location`. */
  city?: string;
  state?: string;
  country?: string;
  locations?: Array<{ city?: string; region?: string; country?: string } | string>;
}

/**
 * Where a Workable posting says it is.
 *
 * The widget API returns city, state and country as FLAT fields on the job -
 * not the nested `location` object this adapter was reading. `j.location?.city`
 * is simply undefined, so every Workable posting arrived with no location and
 * 151 of them sat on the board as "not stated" while the API was returning
 * `{ country: "Saudi Arabia", city: "Riyadh" }` all along.
 *
 * The nested shape and the `locations` array are both kept as fallbacks: this
 * endpoint is undocumented and has changed shape before.
 */
function workableLocation(j: WorkableJob): string {
  const flat = [j.city, j.state, j.country].filter(Boolean).join(", ");
  if (flat) return flat;

  const nested = [j.location?.city, j.location?.region, j.location?.country]
    .filter(Boolean)
    .join(", ");
  if (nested) return nested;

  const first = Array.isArray(j.locations) ? j.locations[0] : undefined;
  if (first) {
    if (typeof first === "string") return first;
    return [first.city, first.region, first.country].filter(Boolean).join(", ");
  }
  return "";
}

export const workable: Adapter = async (source) => {
  const data = await getJson<{ jobs?: WorkableJob[] }>(
    `https://apply.workable.com/api/v1/widget/accounts/${source.handle}?details=true`,
  );
  return (data.jobs ?? []).map((j) => ({
    sourceId: source.id,
    externalId: String(j.shortcode ?? j.id ?? j.title),
    title: j.title,
    company: source.company ?? source.label,
    locationText: workableLocation(j),
    descriptionText: htmlToText(`${j.description ?? ""} ${j.requirements ?? ""}`),
    url: j.shortlink ?? j.url ?? `https://apply.workable.com/${source.handle}/`,
    postedAt: toIso(j.published_on ?? j.created_at),
    department: j.department ?? null,
    employmentType: j.employment_type ?? null,
  }));
};

/* ---------------------------------- Recruitee ---------------------------- */

interface RecruiteeOffer {
  id: number;
  title: string;
  city?: string;
  country?: string;
  location?: string;
  careers_url?: string;
  careers_apply_url?: string;
  created_at?: string;
  published_at?: string;
  description?: string;
  requirements?: string;
  department?: string;
  employment_type_code?: string;
}

export const recruitee: Adapter = async (source) => {
  const data = await getJson<{ offers?: RecruiteeOffer[] }>(
    `https://${source.handle}.recruitee.com/api/offers/`,
  );
  return (data.offers ?? []).map((j) => ({
    sourceId: source.id,
    externalId: String(j.id),
    title: j.title,
    company: source.company ?? source.label,
    locationText: j.location ?? [j.city, j.country].filter(Boolean).join(", "),
    descriptionText: htmlToText(`${j.description ?? ""} ${j.requirements ?? ""}`),
    url: j.careers_url ?? j.careers_apply_url ?? `https://${source.handle}.recruitee.com/`,
    postedAt: toIso(j.published_at ?? j.created_at),
    department: j.department ?? null,
    employmentType: j.employment_type_code ?? null,
  }));
};

/* ---------------------------------- BambooHR ----------------------------- */

interface BambooJob {
  id: number;
  jobOpeningName: string;
  location?: { city?: string; state?: string; country?: string };
  employmentStatusLabel?: string;
  departmentLabel?: string;
  atsLocation?: { city?: string; state?: string };
}

export const bamboohr: Adapter = async (source) => {
  const data = await getJson<{ result?: BambooJob[] }>(
    `https://${source.handle}.bamboohr.com/careers/list`,
  );
  const rows: RawJob[] = (data.result ?? []).map((j) => ({
    sourceId: source.id,
    externalId: String(j.id),
    title: j.jobOpeningName,
    company: source.company ?? source.label,
    locationText: [
      j.location?.city ?? j.atsLocation?.city,
      j.location?.state ?? j.atsLocation?.state,
      j.location?.country,
    ]
      .filter(Boolean)
      .join(", "),
    descriptionText: "",
    url: `https://${source.handle}.bamboohr.com/careers/${j.id}`,
    postedAt: null,
    department: j.departmentLabel ?? null,
    employmentType: j.employmentStatusLabel ?? null,
  }));

  /*
   * The list carries no description at all, so every BambooHR posting used to
   * be stored as a bare title: no duties, no years. The detail endpoint has
   * the whole posting; read it for the rows that could be Saudi.
   */
  const saudi = rows.filter((j) => /saudi|ksa|riyadh|jeddah|dammam|khobar/i.test(j.locationText ?? "") || !(j.locationText ?? "").trim());
  await mapLimit(saudi.slice(0, 100), 3, async (job) => {
    try {
      const detail = await getJson<{ result?: { jobOpening?: { description?: string; datePosted?: string } } }>(
        `https://${source.handle}.bamboohr.com/careers/${job.externalId}/detail`,
      );
      job.descriptionText = htmlToText(detail.result?.jobOpening?.description ?? "");
      job.postedAt = toIso(detail.result?.jobOpening?.datePosted ?? null);
    } catch {
      /* the listing row still counts */
    }
  });
  return rows;
};

/* ---------------------------------- Personio ----------------------------- */

/** Personio publishes a plain XML feed; parsed with regex to avoid a dep. */
export const personio: Adapter = async (source) => {
  const xml = await getText(`https://${source.handle}.jobs.personio.de/xml`);
  const positions = xml.match(/<position>[\s\S]*?<\/position>/g) ?? [];
  return positions.map((block) => {
    const pick = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")).trim() : "";
    };
    const id = pick("id");
    return {
      sourceId: source.id,
      externalId: id,
      title: pick("name"),
      company: source.company ?? source.label,
      locationText: [pick("office"), pick("subcompany")].filter(Boolean).join(", "),
      descriptionText: htmlToText(pick("jobDescriptions")),
      url: `https://${source.handle}.jobs.personio.de/job/${id}`,
      postedAt: toIso(pick("createdAt")),
      department: pick("department") || null,
      employmentType: pick("employmentType") || null,
    };
  });
};

/* ---------------------------------- helpers ------------------------------ */

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}
