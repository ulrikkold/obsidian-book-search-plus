import { apiGetText, BaseBooksApiImpl } from '@apis/base_api';
import { Book } from '@models/book.model';
import { ISBN_REGEX, isbn13To10, normalizeIsbn, toIsbn13 } from '@utils/isbn';
import { MarcBookFields, parseMarcRecord } from './marcxml';
import { SruPreset } from './sru_presets';

// How many results a search asks for, unless the server caps it lower.
const DEFAULT_MAXIMUM_RECORDS = 20;

// Backslash, quote and the CQL masking characters (*, ?, ^). Escaped so a
// title like "Do Androids Dream of Electric Sheep?" is searched literally.
const CQL_SPECIAL = /[\\"*?^]/g;

// "ISBN", "ISBN:" or "ISBN-13" in front of a pasted number.
const ISBN_PREFIX = /^isbn(?:-1[03])?:?\s*/i;

export interface CqlQuery {
  cql: string;
  isbn13?: string; // set when the query is an ISBN search
}

export function buildCqlQuery(preset: SruPreset, query: string): CqlQuery {
  const compact = query.trim().replace(ISBN_PREFIX, '').replace(/[\s-]/g, '').toUpperCase();
  // Only a real ISBN (right shape, valid check digit, not a placeholder such
  // as 0000000000) becomes an ISBN search. Anything else is searched as words.
  if (ISBN_REGEX.test(compact) && normalizeIsbn(compact) === compact) {
    // Ask for both forms, so a match doesn't depend on the server mapping
    // ISBN-10 to ISBN-13. A 979 ISBN has no ISBN-10 form.
    const isbn13 = toIsbn13(compact);
    const other = compact.length === 10 ? isbn13 : isbn13To10(isbn13);
    const forms = other ? [compact, other] : [compact];
    return { cql: forms.map(isbn => `${preset.isbnIndex}=${isbn}`).join(' or '), isbn13 };
  }
  const escaped = query.trim().replace(CQL_SPECIAL, ch => `\\${ch}`);
  // `all` matches the words in any order. With `=`, Alma treats several
  // words as a phrase (checked against the Royal Danish Library, 2026-11-11).
  return { cql: `${preset.keywordIndex} all "${escaped}"` };
}

// Parses an SRU 1.2 searchRetrieve response and returns the embedded MARC
// records. SRU reports errors as diagnostics inside a normal 200 response.
// A diagnostic is fatal only when no records came back: one that comes with
// records (e.g. "maximumRecords reduced") is informational, and a surrogate
// diagnostic in place of a record just means that record is skipped.
export function parseSruResponse(xml: string): Element[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || root?.localName !== 'searchRetrieveResponse') {
    throw new Error('The library returned something that is not a valid SRU response.');
  }

  const records = byLocalName(root, 'recordData')
    .map(recordFromData)
    .filter((el): el is Element => !!el);

  if (records.length) return records;

  const diagnostics = Array.from(root.children).find(el => el.localName === 'diagnostics');
  const diagnostic = diagnostics && byLocalName(diagnostics, 'diagnostic')[0];
  if (diagnostic) {
    const message = byLocalName(diagnostic, 'message')[0]?.textContent?.trim();
    const uri = byLocalName(diagnostic, 'uri')[0]?.textContent?.trim();
    throw new Error(message || `SRU diagnostic ${uri ?? 'without details'}`);
  }
  return records;
}

function recordFromData(recordData: Element): Element | undefined {
  // The record is a direct child, or wrapped in a MARCXML <collection>.
  const record = byLocalName(recordData, 'record')[0];
  if (record) return record;
  if (recordData.children.length) return undefined; // a surrogate diagnostic, not a record
  // recordPacking=string: the record is escaped XML inside recordData.
  const text = recordData.textContent?.trim();
  if (!text) return undefined;
  const inner = new DOMParser().parseFromString(text, 'application/xml').documentElement;
  return inner?.localName === 'record' ? inner : undefined;
}

function byLocalName(el: Element, localName: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', localName));
}

export class SruBooksApi implements BaseBooksApiImpl {
  constructor(private readonly preset: SruPreset) {}

  async getByQuery(query: string): Promise<Book[]> {
    if (!query.trim()) return [];
    try {
      const { cql, isbn13 } = buildCqlQuery(this.preset, query);
      const params = {
        version: '1.2',
        operation: 'searchRetrieve',
        recordSchema: this.preset.recordSchema ?? 'marcxml',
        maximumRecords: Math.min(DEFAULT_MAXIMUM_RECORDS, this.preset.maximumRecords ?? DEFAULT_MAXIMUM_RECORDS),
        query: cql,
      };
      const xml = await apiGetText(this.preset.baseUrl, params, { Accept: 'application/xml, text/xml' });
      const fields = parseSruResponse(xml).map(parseMarcRecord);
      // The library's ISBN index matches every form of the ISBN, including
      // cancelled or invalid ones in 020 $z (e.g. misprints), so its results
      // are trusted. Each one reports the ISBN that was searched for.
      return fields.map(f => this.createBookItem(f, isbn13));
    } catch (error) {
      console.warn(error);
      throw error;
    }
  }

  // isbn10 is always derived from isbn13, so the pair never mixes editions.
  public createBookItem(fields: MarcBookFields, isbn13 = fields.isbns[0] ?? ''): Book {
    return {
      title: fields.title,
      subtitle: fields.subtitle,
      author: fields.authors.join(', '),
      authors: fields.authors,
      category: fields.categories.join(', '),
      categories: fields.categories,
      publisher: fields.publisher,
      publishDate: fields.publishDate,
      totalPage: fields.totalPage ?? '',
      coverUrl: '',
      coverSmallUrl: '',
      description: fields.description,
      link:
        fields.id && this.preset.recordUrl ? this.preset.recordUrl.replace('{id}', encodeURIComponent(fields.id)) : '',
      previewLink: '',
      isbn10: isbn13To10(isbn13) ?? '',
      isbn13,
    };
  }
}
