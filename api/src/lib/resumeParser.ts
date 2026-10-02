/**
 * Resume / LinkedIn-PDF text → application draft suggestions.
 *
 * Honest scope: this is a heuristic reader for the two document shapes
 * applicants actually upload — LinkedIn's "Save to PDF" export and ordinary
 * CVs with conventional headings. It only PRE-FILLS the onboarding form; the
 * applicant reviews and edits every field before anything is saved, and the
 * admin always sees the original PDF. Nothing here is treated as verified.
 */

export interface ParsedLanguage { name: string; level: string }
export interface ParsedEducation { school: string; degree: string; year: string }
export interface ParsedCertification { name: string; issuer: string; year: string }
export interface ParsedExperience { title: string; company: string; start: string; end: string; description: string }

export interface ResumeSuggestions {
  title: string;
  about: string;
  locationCity: string;
  website: string;
  skills: string[];
  languages: ParsedLanguage[];
  certifications: ParsedCertification[];
  education: ParsedEducation[];
  experience: ParsedExperience[];
  /** Which fields were found — the UI tells the applicant what still needs typing. */
  found: string[];
  /** Best guess at document type. */
  source: 'linkedin' | 'cv';
}

type SectionKey =
  | 'contact' | 'skills' | 'languages' | 'certifications' | 'honors' | 'summary'
  | 'experience' | 'education' | 'projects' | 'references' | 'publications' | 'interests' | 'other';

const HEADINGS: Array<[RegExp, SectionKey]> = [
  [/^contact( information| details)?$/i, 'contact'],
  [/^(top )?skills?( & expertise| and expertise)?$/i, 'skills'],
  [/^(technical|core|key|professional) (skills|competencies)$/i, 'skills'],
  [/^(areas of expertise|competencies|expertise|tools( & technologies)?)$/i, 'skills'],
  [/^languages?$/i, 'languages'],
  [/^(licenses? (&|and) )?certifications?( (&|and) licenses?)?$/i, 'certifications'],
  [/^(courses|training( & certifications)?)$/i, 'certifications'],
  [/^(honou?rs?([ -]awards)?|awards( & honou?rs)?)$/i, 'honors'],
  [/^(summary|professional summary|profile|professional profile|about( me)?|objective|career objective|personal statement|bio)$/i, 'summary'],
  [/^((work|professional|employment|relevant) )?(experience|history)$/i, 'experience'],
  [/^(career history|employment history|work history)$/i, 'experience'],
  [/^education( (&|and) training| (&|and) qualifications| history)?$/i, 'education'],
  [/^(academic (background|qualifications)|qualifications)$/i, 'education'],
  [/^(projects|selected projects|personal projects|portfolio)$/i, 'projects'],
  [/^(references?|referees)( available on request)?$/i, 'references'],
  [/^publications?$/i, 'publications'],
  [/^(interests|hobbies( & interests)?|volunteering|volunteer experience)$/i, 'interests'],
];

const ROLE_WORDS = /\b(developer|designer|engineer|manager|consultant|specialist|analyst|writer|photographer|videographer|editor|architect|accountant|lawyer|marketer|strategist|coordinator|director|founder|co-founder|lead|head|officer|administrator|assistant|technician|teacher|tutor|trainer|nurse|doctor|pharmacist|chef|stylist|planner|producer|artist|illustrator|animator|copywriter|freelancer|professional|expert)\b/i;

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_TOKEN = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}`;
const DATE_RANGE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(${DATE_TOKEN}|present|current|now|till date|date)`, 'i');
const YEAR = /(?:19|20)\d{2}/;
const SCHOOL_WORDS = /\b(university|college|school|polytechnic|institute|academy|faculty|seminary|conservatory)\b/i;

const NIGERIAN_CITIES = ['Lagos', 'Abuja', 'Ibadan', 'Port Harcourt', 'Kano', 'Kaduna', 'Benin City', 'Enugu', 'Owerri', 'Abeokuta', 'Ilorin', 'Jos', 'Uyo', 'Calabar', 'Warri', 'Onitsha', 'Aba', 'Akure', 'Osogbo', 'Ado Ekiti', 'Minna', 'Lokoja', 'Asaba', 'Awka', 'Yenagoa', 'Makurdi', 'Bauchi', 'Maiduguri', 'Sokoto', 'Zaria', 'Ikeja', 'Lekki', 'Ikorodu', 'Ogbomoso', 'Oyo', 'Umuahia', 'Abakaliki', 'Gombe', 'Yola', 'Jalingo', 'Lafia', 'Katsina', 'Dutse', 'Birnin Kebbi', 'Gusau', 'Damaturu', 'Ilesa', 'Ife', 'Sagamu', 'Ota'];

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/[•●▪◦‣·]+/g, '').trim();

function headingKey(line: string): SectionKey | null {
  const t = line.replace(/[:\-–—_]+$/, '').trim();
  if (!t || t.length > 42) return null;
  for (const [re, key] of HEADINGS) if (re.test(t)) return key;
  return null;
}

function isDateLine(line: string) {
  return DATE_RANGE.test(line);
}

function splitList(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    for (const part of line.split(/[,|;•●▪◦‣·]+|\s{2,}|\s\/\s/)) {
      const v = clean(part).replace(/^[-–—*]+\s*/, '');
      if (v.length >= 2 && v.length <= 40 && !/^\d+$/.test(v)) out.push(v);
    }
  }
  return Array.from(new Set(out.map((v) => v.replace(/\.$/, ''))));
}

function cityFrom(line: string): string {
  const t = clean(line);
  for (const city of NIGERIAN_CITIES) {
    if (new RegExp(`(^|[^a-z])${city.replace(/ /g, '\\s+')}([^a-z]|$)`, 'i').test(t)) return city;
  }
  if (/,\s*[A-Za-z .]+$/.test(t) && t.length <= 60 && !YEAR.test(t) && !/@|http|www\./i.test(t)) {
    const first = t.split(',')[0].trim().replace(/\b(state|area|metropolis)\b/i, '').trim();
    if (first.length >= 2 && first.length <= 30 && !/\d/.test(first)) return first;
  }
  return '';
}

function parseLanguages(lines: string[]): ParsedLanguage[] {
  const out: ParsedLanguage[] = [];
  for (const raw of lines) {
    for (const part of raw.split(/[,;|•●▪]+/)) {
      const t = clean(part);
      if (!t) continue;
      const m = t.match(/^([A-Za-zÀ-ÿ' -]{2,30})\s*(?:[\(\-–—:]\s*([^)]+?)\s*\)?)?$/);
      if (!m) continue;
      const name = m[1].trim();
      if (name.length < 2 || /\d/.test(name) || ROLE_WORDS.test(name)) continue;
      out.push({ name, level: (m[2] ?? '').trim() });
    }
  }
  return out.slice(0, 8);
}

function parseEducation(lines: string[]): ParsedEducation[] {
  const entries: ParsedEducation[] = [];
  let current: ParsedEducation | null = null;
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    const year = (line.match(/(?:19|20)\d{2}(?:\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current))?/i) ?? [''])[0];
    if (SCHOOL_WORDS.test(line) && !/^(bachelor|master|b\.?sc|m\.?sc|hnd|ond|diploma|phd)/i.test(line)) {
      current = { school: line.replace(/\s*[·(]?\s*(?:19|20)\d{2}.*$/, '').trim(), degree: '', year };
      entries.push(current);
      continue;
    }
    if (!current) {
      current = { school: line.replace(/\s*[·(]?\s*(?:19|20)\d{2}.*$/, '').trim(), degree: '', year };
      entries.push(current);
      continue;
    }
    if (!current.degree && line.length <= 160) {
      current.degree = line.replace(/\s*[·(]\s*(?:19|20)\d{2}.*$/, '').replace(/\s*[-–—]\s*$/, '').trim();
    }
    if (year && !current.year) current.year = year;
    if (current.degree && current.year && line.length > 160) current = null;
  }
  return entries.filter((e) => e.school.length >= 3).slice(0, 6);
}

function parseCertifications(lines: string[]): ParsedCertification[] {
  const out: ParsedCertification[] = [];
  for (const raw of lines) {
    const line = clean(raw);
    if (!line || line.length > 140) continue;
    const year = (line.match(YEAR) ?? [''])[0];
    const parts = line.split(/\s+[-–—|]\s+|,\s+(?=[A-Z])/);
    const name = parts[0].replace(/\(?\s*(?:19|20)\d{2}\s*\)?/, '').trim();
    if (name.length < 3) continue;
    out.push({ name, issuer: parts.length > 1 ? parts[1].replace(/\(?\s*(?:19|20)\d{2}\s*\)?/, '').trim() : '', year });
  }
  return out.slice(0, 10);
}

function parseExperience(lines: string[]): ParsedExperience[] {
  const entries: ParsedExperience[] = [];
  const cleaned = lines.map(clean).filter(Boolean);
  const dateIdx = cleaned.map((l, i) => (isDateLine(l) ? i : -1)).filter((i) => i >= 0);
  for (let d = 0; d < dateIdx.length && entries.length < 8; d += 1) {
    const i = dateIdx[d];
    const line = cleaned[i];
    const m = line.match(DATE_RANGE)!;
    const start = m[1];
    const end = /^(present|current|now|till date|date)$/i.test(m[2]) ? 'Present' : m[2];
    const remainder = clean(line.replace(DATE_RANGE, '').replace(/\(.*?\)/g, '').replace(/^[\s|,·\-–—]+|[\s|,·\-–—]+$/g, ''));
    let title = '';
    let company = '';
    const prevBoundary = d > 0 ? dateIdx[d - 1] : -1;
    if (remainder.length >= 3) {
      const bits = remainder.split(/\s*\|\s*|\s+(?:@|at)\s+|,\s*|\s+[–—-]\s+/).map((b) => b.trim()).filter(Boolean);
      title = bits[0] ?? '';
      company = bits[1] ?? '';
      if (!company && i - 1 > prevBoundary && !isDateLine(cleaned[i - 1]) && cleaned[i - 1].length <= 80) {
        company = ROLE_WORDS.test(title) ? cleaned[i - 1] : '';
        if (!company) { company = title; title = cleaned[i - 1]; }
      }
    } else {
      // LinkedIn shape: Company / Role / dates   (or Role / Company / dates in many CVs)
      const l1 = i - 1 > prevBoundary ? cleaned[i - 1] : '';
      const l2 = i - 2 > prevBoundary ? cleaned[i - 2] : '';
      const l2IsDescriptionTail = l2.length > 90;
      if (ROLE_WORDS.test(l1) || (!ROLE_WORDS.test(l2) && !l2IsDescriptionTail)) {
        title = l1; company = l2IsDescriptionTail ? '' : l2;
      } else {
        title = l2; company = l1;
      }
      if (!title) { title = l1; company = ''; }
      // several roles under one company: the company sits above an earlier role of the same block
      if (!company && d > 0) {
        const prev = entries[entries.length - 1];
        if (prev && i - dateIdx[d - 1] <= 4) company = prev.company;
      }
    }
    const nextStart = d + 1 < dateIdx.length ? dateIdx[d + 1] : cleaned.length;
    const descLines: string[] = [];
    for (let k = i + 1; k < nextStart; k += 1) {
      const l = cleaned[k];
      if (k === i + 1 && l.length <= 60 && (cityFrom(l) || /,/.test(l)) && !/[.!?]$/.test(l)) continue; // location line
      descLines.push(l);
    }
    // The last 1–2 lines before the next date line are the next entry's company/role, not description.
    const trim = nextStart < cleaned.length ? Math.min(2, descLines.length) : 0;
    const description = descLines.slice(0, descLines.length - trim).join(' ').slice(0, 400).trim();
    if (!title && !company) continue;
    entries.push({ title: title.slice(0, 80), company: company.slice(0, 80), start, end, description });
  }
  return entries;
}

export function parseResumeText(rawText: string, applicantName = ''): ResumeSuggestions {
  const lines = rawText
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\u00a0/g, ' ').trimEnd())
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^page \d+ of \d+$/i.test(l));

  const sections = new Map<SectionKey, string[]>();
  const order: SectionKey[] = [];
  let current: SectionKey = 'other';
  sections.set('other', []);
  for (const line of lines) {
    const key = headingKey(line);
    if (key) {
      current = key;
      if (!sections.has(key)) { sections.set(key, []); order.push(key); }
      continue;
    }
    sections.get(current)!.push(line);
  }
  const get = (k: SectionKey) => sections.get(k) ?? [];
  const isLinkedIn = /linkedin\.com\/in\//i.test(rawText) || (sections.has('contact') && order.indexOf('skills') < order.indexOf('summary'));

  /* ---- name → headline → location (LinkedIn lists them right before Summary/Experience) ---- */
  let title = '';
  let locationCity = '';
  const nameParts = applicantName.toLowerCase().split(/\s+/).filter((p) => p.length > 1);
  const nameIdx = nameParts.length
    ? lines.findIndex((l) => l.length <= 60 && !/@|https?:|www\.|linkedin/i.test(l) && nameParts.filter((p) => l.toLowerCase().includes(p)).length >= Math.min(2, nameParts.length))
    : -1;
  if (nameIdx >= 0) {
    const after = lines.slice(nameIdx + 1, nameIdx + 4).filter((l) => !headingKey(l));
    if (after[0] && after[0].length <= 120 && !/@|http/i.test(after[0])) title = after[0];
    for (const l of after.slice(1, 3)) { const c = cityFrom(l); if (c) { locationCity = c; break; } }
  }
  if (!title) {
    const candidate = lines.slice(0, 12).find((l) => l.length <= 90 && ROLE_WORDS.test(l) && !isDateLine(l) && !/@|http/i.test(l) && !headingKey(l));
    if (candidate) title = candidate;
  }
  if (!locationCity) {
    for (const l of lines.slice(0, 40)) { const c = cityFrom(l); if (c && !isDateLine(l)) { locationCity = c; break; } }
  }
  title = clean(title).replace(/\s*[|•·]\s*.*$/, '').slice(0, 120);

  /* ---- summary ---- */
  const about = clean(get('summary').join(' ')).slice(0, 2000);

  /* ---- skills ---- */
  let skills = splitList(get('skills')).filter((s) => !/^(top skills|skills)$/i.test(s));
  if (isLinkedIn && nameIdx >= 0) {
    // In the LinkedIn export the name/headline/location trail the last sidebar list; drop them from skills.
    const trailing = new Set(lines.slice(nameIdx, nameIdx + 3).map((l) => l.toLowerCase()));
    skills = skills.filter((s) => !trailing.has(s.toLowerCase()));
  }
  skills = skills.filter((s) => !nameParts.length || !nameParts.every((p) => s.toLowerCase().includes(p))).slice(0, 15);

  /* ---- languages / certifications / education / experience ---- */
  const stripTrailingIdentity = (arr: string[]) => {
    if (nameIdx < 0) return arr;
    const identity = new Set(lines.slice(nameIdx, nameIdx + 3));
    return arr.filter((l) => !identity.has(l));
  };
  const languages = parseLanguages(stripTrailingIdentity(get('languages')));
  const certifications = parseCertifications(stripTrailingIdentity(get('certifications')));
  const education = parseEducation(get('education'));
  const experience = parseExperience(get('experience'));

  /* ---- website (not LinkedIn, not email) ---- */
  const urlMatch = rawText.match(/\b(?:https?:\/\/|www\.)[^\s)]+/gi) ?? [];
  const website = urlMatch.map((u) => u.replace(/[.,;)]+$/, '')).find((u) => !/linkedin\.com|mailto:/i.test(u)) ?? '';

  const found: string[] = [];
  if (title) found.push('title');
  if (about) found.push('about');
  if (locationCity) found.push('locationCity');
  if (skills.length) found.push('skills');
  if (languages.length) found.push('languages');
  if (certifications.length) found.push('certifications');
  if (education.length) found.push('education');
  if (experience.length) found.push('experience');
  if (website) found.push('website');

  return { title, about, locationCity, website, skills, languages, certifications, education, experience, found, source: isLinkedIn ? 'linkedin' : 'cv' };
}

/** Extract text from a PDF buffer (pure-JS, no native dependencies). */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText } = await import('unpdf');
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text)];
  return pages.join('\n');
}
