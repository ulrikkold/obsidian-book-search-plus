import { apiGetText, BaseBooksApiImpl } from '@apis/base_api';
import { Book } from '@models/book.model';
import { ISBN_REGEX, isbn13To10, toIsbn13 } from '@utils/isbn';
import { MarcBookFields, parseMarcRecord } from './marcxml';
import { SruPreset } from './sru_presets';

// How many results a search asks for, unless the server caps it lower.
const DEFAULT_MAXIMUM_RECORDS = 20;

// Backslash, quote and the CQL masking characters (*, ?, ^). Escaped so a
// title like "Do Androids Dream of Electric Sheep?" is searched literally.
const CQL_SPECIAL = /[\\"*?^]/g;

export interface CqlQuery {
  cql: string;
  isbn13?: string; // set when the query is an ISBN search
}

export function buildCqlQuery(preset: SruPreset, query: string): CqlQuery {
  const compact = query.replace(/[\s-]/g, '').toUpperCase();
  if (ISBN_REGEX.test(compact)) {
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
  const children = Array.from(recordData.children);
  const record = children.find(el => el.localName === 'record');
  if (record) return record;
  if (children.length) return undefined; // a surrogate diagnostic, not a record
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
      if (!isbn13) return fields.map(f => this.createBookItem(f));

      // ISBN indexes can return records that don't carry the ISBN (Alma
      // matches "0000000000" placeholders, for instance), so keep only exact
      // matches and report the searched ISBN rather than the record's first.
      return fields.filter(f => f.isbns.includes(isbn13)).map(f => this.createBookItem(f, isbn13));
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
