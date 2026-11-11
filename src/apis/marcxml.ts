// Maps MARC 21 bibliographic records (MARCXML) to plain book fields.
//
// Elements are matched on local name rather than namespace or prefix, since
// SRU servers differ in how they qualify the MARCXML they embed.

import { normalizeIsbn, toIsbn13 } from '@utils/isbn';

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
  isbns: string[]; // every valid ISBN in 020 $a, as ISBN-13, in record order
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
const AUTHOR_TERMS = /^(author|joint author|co-?author|creator|forfatter|författare|forfattar|verfasser|verfasserin)$/i;

const PAGE_UNIT = /\b(?:sider|sidor|seiten|pages|pp?\.|s\.)/i;

// Cataloguer placeholders for an unknown publisher, e.g. "[s.n.]" or
// "[publisher not identified]". A real name in brackets is kept.
const PUBLISHER_PLACEHOLDER = /^\[(?:s\.\s?n\.?|sine nomine|.*(?:not identified|nicht ermittelt).*)\]$/i;

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
      const existing = dataFields.get(tag);
      if (existing) existing.push(field);
      else dataFields.set(tag, [field]);
    }
  }

  const fields = (tag: string) => dataFields.get(tag) ?? [];

  return {
    id: controlFields.get('001')?.trim() ?? '',
    ...parseTitle(fields('245')[0]),
    authors: parseAuthors([...fields('100'), ...fields('700'), ...fields('720')]),
    ...parseImprint(fields('264'), fields('260'), controlFields.get('008')),
    totalPage: parsePageCount(first(fields('300')[0], 'a')),
    description: fields('520')
      .map(f => first(f, 'a').trim())
      .filter(Boolean)
      .join('\n\n'),
    categories: parseCategories(fields('650'), fields('655')),
    isbns: parseIsbns(fields('020')),
    ...parseSeries(fields('830')[0], fields('490')[0]),
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
// period after an initial ("Tolkien, J. R. R.") and an ellipsis ("And then...").
//
// No regex lookbehind here or elsewhere in the plugin: iOS before 16.4 can't
// parse it, and a syntax error in the bundle stops the whole plugin loading.
export function stripIsbdPunctuation(value: string): string {
  let result = value.trim().replace(/\s*[/:;,=]$/, '');
  if (result.endsWith('.') && !result.endsWith('..') && !/(?:^|[\s.])\p{Lu}\.$/u.test(result)) {
    result = result.slice(0, -1);
  }
  return result.trim();
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
  // Subfields in record order, so repeated part numbers ($n) stay with their names ($p).
  const title = field.subfields
    .filter(sf => sf.code === 'a' || sf.code === 'n' || sf.code === 'p')
    .map(sf => stripIsbdPunctuation(sf.value))
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
// name/title entry ($t) refers to another work and never does. $4 can hold a
// code ("aut") or a URI ("http://id.loc.gov/vocabulary/relators/aut").
function isAuthor(field: DataField): boolean {
  if (field.subfields.some(sf => sf.code === 't')) return false;
  const codes = all(field, '4').map(c => c.trim().toLowerCase().split('/').pop() ?? '');
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
  const publisher =
    candidates.map(f => stripIsbdPunctuation(first(f, 'b'))).find(name => name && !PUBLISHER_PLACEHOLDER.test(name)) ??
    '';
  const year =
    [...candidates, ...f264.filter(f => f.ind2 === '4')].map(f => extractYear(first(f, 'c'))).find(Boolean) ??
    extractYear(f008?.slice(7, 11) ?? '') ??
    '';
  return { publisher, publishDate: year };
}

function extractYear(value: string): string | undefined {
  return value.match(/\d{4}/)?.[0];
}

// The largest number before the page unit, so "xii, 406, [2] sider" gives 406.
// "1,088" and "1.088" are read as thousands.
export function parsePageCount(value: string): number | undefined {
  const text = value.replace(/(\d)[,.](\d{3})(?!\d)/g, '$1$2');
  const unit = text.search(PAGE_UNIT);
  if (unit === -1) return undefined;
  const numbers = text.slice(0, unit).match(/\d+/g);
  return numbers ? Math.max(...numbers.map(Number)) : undefined;
}

// 650 subjects and 655 genres, deduplicated after punctuation is stripped.
// French-language headings from the Canadian RVM thesaurus are left out:
// 650 with ind2=6, and any field whose $2 source is rvm or rvmgf.
function parseCategories(f650: DataField[], f655: DataField[]): string[] {
  const isFrench = (f: DataField) => f.ind2 === '6' || all(f, '2').some(src => /^rvm/i.test(src.trim()));
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const field of [...f650, ...f655].filter(f => !isFrench(f))) {
    const term = stripIsbdPunctuation(first(field, 'a'));
    const key = term.toLowerCase();
    if (term && !seen.has(key)) {
      seen.add(key);
      categories.push(term);
    }
  }
  return categories;
}

// The authorised series heading (830) first, then the series statement (490).
// Name and number are taken separately, because an 830 often has no number.
function parseSeries(
  f830: DataField | undefined,
  f490: DataField | undefined,
): { series: string; seriesNumber: string } {
  return {
    series: stripIsbdPunctuation(first(f830, 'a') || first(f490, 'a')),
    seriesNumber: parseSeriesNumber(first(f830, 'v') || first(f490, 'v')),
  };
}

// "bog 2", "bk. 5", "[1]" → the number; anything without a number as is.
export function parseSeriesNumber(value: string): string {
  const number = value.match(/\d+(?:[.,]\d+)?/)?.[0];
  return number ?? stripIsbdPunctuation(value.replace(/[[\]]/g, ''));
}

function parseIsbns(f020: DataField[]): string[] {
  const found = f020.map(f => normalizeIsbn(first(f, 'a'))).filter((isbn): isbn is string => !!isbn);
  return [...new Set(found.map(toIsbn13))];
}
