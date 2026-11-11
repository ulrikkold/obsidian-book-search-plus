// Maps MARC 21 bibliographic records (MARCXML) to plain book fields.
//
// Elements are matched on local name rather than namespace or prefix, since
// SRU servers differ in how they qualify the MARCXML they embed.

export interface MarcBookFields {
  id: string; // 001 control number
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string;
  publishDate: string; // year only
  totalPage?: number;
  description: string;
  categories: string[];
  isbn10: string;
  isbn13: string;
  isbns: string[]; // every valid ISBN in 020 $a, as ISBN-13
  series: string;
  seriesNumber: string;
}

interface DataField {
  ind1: string;
  ind2: string;
  subfields: { code: string; value: string }[];
}

// Relator codes ($4) and terms ($e) that mean "wrote the book".
const AUTHOR_CODES = new Set(['aut', 'cre']);
const AUTHOR_TERMS = /^(author|creator|forfatter|författare|forfattar|verfasser|verfasserin)$/i;

const PAGINATION = /\[?(\d+)\]?\s*(?:sider|sidor|seiten|pages|pp?\.|s\.|S\.)/i;

export function parseMarcRecord(record: Element): MarcBookFields {
  const controlFields = new Map<string, string>();
  const dataFields = new Map<string, DataField[]>();

  for (const el of Array.from(record.children)) {
    const tag = el.getAttribute('tag') ?? '';
    if (el.localName === 'controlfield') {
      controlFields.set(tag, el.textContent ?? '');
    } else if (el.localName === 'datafield') {
      const field: DataField = {
        ind1: el.getAttribute('ind1') ?? ' ',
        ind2: el.getAttribute('ind2') ?? ' ',
        subfields: Array.from(el.children)
          .filter(sf => sf.localName === 'subfield')
          .map(sf => ({ code: sf.getAttribute('code') ?? '', value: sf.textContent ?? '' })),
      };
      dataFields.set(tag, [...(dataFields.get(tag) ?? []), field]);
    }
  }

  const fields = (tag: string) => dataFields.get(tag) ?? [];
  const isbns = parseIsbns(fields('020'));
  const series = parseSeries(fields('830')[0] ?? fields('490')[0]);
  const imprint = parseImprint(fields('264'), fields('260'), controlFields.get('008'));

  return {
    id: controlFields.get('001')?.trim() ?? '',
    ...parseTitle(fields('245')[0]),
    authors: parseAuthors([...fields('100'), ...fields('700'), ...fields('720')]),
    ...imprint,
    totalPage: parsePageCount(first(fields('300')[0], 'a')),
    description: fields('520')
      .map(f => first(f, 'a').trim())
      .filter(Boolean)
      .join('\n\n'),
    categories: parseCategories(fields('650'), fields('655')),
    ...isbns,
    ...series,
  };
}

function first(field: DataField | undefined, code: string): string {
  return field?.subfields.find(sf => sf.code === code)?.value ?? '';
}

function all(field: DataField, code: string): string[] {
  return field.subfields.filter(sf => sf.code === code).map(sf => sf.value);
}

// Removes the ISBD punctuation that MARC leaves at the end of subfields
// ("Title /", "Place :", "Publisher,", "Series ;", "Title."), but keeps the
// period after an initial ("Tolkien, J. R. R.").
export function stripIsbdPunctuation(value: string): string {
  return value
    .trim()
    .replace(/\s*[/:;,=]$/, '')
    .replace(/(?<!(?:^|[\s.])\p{Lu})\.$/u, '')
    .trim();
}

// "Dinniman, Matt" → "Matt Dinniman". Names without a comma are returned as is.
export function invertName(value: string): string {
  const name = stripIsbdPunctuation(value);
  const comma = name.indexOf(',');
  if (comma === -1) return name;
  const surname = name.slice(0, comma).trim();
  const forenames = stripIsbdPunctuation(name.slice(comma + 1));
  return forenames ? `${forenames} ${surname}` : surname;
}

function parseTitle(field: DataField | undefined): { title: string; subtitle: string } {
  if (!field) return { title: '', subtitle: '' };
  const title = [...all(field, 'a'), ...all(field, 'n'), ...all(field, 'p')]
    .map(stripIsbdPunctuation)
    .filter(Boolean)
    .join('. ');
  return { title, subtitle: stripIsbdPunctuation(first(field, 'b')) };
}

function parseAuthors(nameFields: DataField[]): string[] {
  const authors: string[] = [];
  for (const field of nameFields) {
    if (!isAuthor(field)) continue;
    const raw = first(field, 'a');
    // ind1=0 is a forename-only heading ("Elizabeth II, Queen ...").
    const name = field.ind1 === '0' ? stripIsbdPunctuation(raw) : invertName(raw);
    if (name && !authors.includes(name)) authors.push(name);
  }
  return authors;
}

// A name with no relator counts as an author (common in older records); a
// name/title entry ($t) refers to another work and never does.
function isAuthor(field: DataField): boolean {
  if (all(field, 't').length) return false;
  const codes = all(field, '4').map(c => c.trim().toLowerCase());
  const terms = all(field, 'e').map(stripIsbdPunctuation);
  if (!codes.length && !terms.length) return true;
  return codes.some(c => AUTHOR_CODES.has(c)) || terms.some(t => AUTHOR_TERMS.test(t));
}

// Publisher and year: 264 with ind2=1 (publication) first, then 260, then any
// other 264 except copyright (ind2=4). The year falls back to the copyright
// date and then to 008/07-10.
function parseImprint(
  f264: DataField[],
  f260: DataField[],
  f008: string | undefined,
): { publisher: string; publishDate: string } {
  const candidates = [
    ...f264.filter(f => f.ind2 === '1'),
    ...f260,
    ...f264.filter(f => f.ind2 !== '1' && f.ind2 !== '4'),
  ];
  const publisher = candidates.map(f => stripIsbdPunctuation(first(f, 'b'))).find(Boolean) ?? '';
  const year =
    [...candidates, ...f264.filter(f => f.ind2 === '4')].map(f => extractYear(first(f, 'c'))).find(Boolean) ??
    extractYear(f008?.slice(7, 11) ?? '') ??
    '';
  return { publisher, publishDate: year };
}

function extractYear(value: string): string | undefined {
  return value.match(/\d{4}/)?.[0];
}

export function parsePageCount(value: string): number | undefined {
  const match = value.match(PAGINATION);
  return match ? Number(match[1]) : undefined;
}

// 650 subjects (except ind2=6, the French-language Canadian thesaurus) and
// 655 genres, deduplicated after punctuation is stripped.
function parseCategories(f650: DataField[], f655: DataField[]): string[] {
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const field of [...f650.filter(f => f.ind2 !== '6'), ...f655]) {
    const term = stripIsbdPunctuation(first(field, 'a'));
    if (term && !seen.has(term.toLowerCase())) {
      seen.add(term.toLowerCase());
      categories.push(term);
    }
  }
  return categories;
}

function parseSeries(field: DataField | undefined): { series: string; seriesNumber: string } {
  if (!field) return { series: '', seriesNumber: '' };
  return {
    series: stripIsbdPunctuation(first(field, 'a')),
    seriesNumber: parseSeriesNumber(first(field, 'v')),
  };
}

// "bog 2", "bk. 5", "[1]" → the number; anything without a number as is.
export function parseSeriesNumber(value: string): string {
  const number = value.match(/\d+(?:[.,]\d+)?/)?.[0];
  return number ?? stripIsbdPunctuation(value.replace(/[[\]]/g, ''));
}

function parseIsbns(f020: DataField[]): { isbn10: string; isbn13: string; isbns: string[] } {
  const found = f020.map(f => normalizeIsbn(first(f, 'a'))).filter((isbn): isbn is string => !!isbn);
  const isbns = [...new Set(found.map(isbn => (isbn.length === 10 ? isbn10To13(isbn) : isbn)))];
  const isbn13 = isbns[0] ?? '';
  const isbn10 = found.find(isbn => isbn.length === 10) ?? (isbn13 ? isbn13To10(isbn13) : undefined) ?? '';
  return { isbn10, isbn13, isbns };
}

// Extracts a checksum-valid ISBN-10 or ISBN-13 from a 020 $a value such as
// "978-87-85539-00-7" or "8799088932 (hf.)". Returns undefined otherwise,
// including for placeholder values like "0000000000".
export function normalizeIsbn(value: string): string | undefined {
  const candidate = value
    .match(/[\dXx][\dXx-]{8,16}[\dXx]/)?.[0]
    ?.replace(/-/g, '')
    .toUpperCase();
  if (!candidate || /^0+$/.test(candidate)) return undefined;
  if (/^\d{9}[\dX]$/.test(candidate) && isbn10CheckDigit(candidate.slice(0, 9)) === candidate[9]) return candidate;
  if (/^\d{13}$/.test(candidate) && isbn13CheckDigit(candidate.slice(0, 12)) === candidate[12]) return candidate;
  return undefined;
}

export function isbn10To13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`;
  return body + isbn13CheckDigit(body);
}

export function isbn13To10(isbn13: string): string | undefined {
  if (!isbn13.startsWith('978')) return undefined;
  const body = isbn13.slice(3, 12);
  return body + isbn10CheckDigit(body);
}

function isbn10CheckDigit(body: string): string {
  const sum = [...body].reduce((acc, digit, i) => acc + Number(digit) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? 'X' : String(check);
}

function isbn13CheckDigit(body: string): string {
  const sum = [...body].reduce((acc, digit, i) => acc + Number(digit) * (i % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}
