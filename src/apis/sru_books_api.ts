import { apiGetText, BaseBooksApiImpl } from '@apis/base_api';
import { Book } from '@models/book.model';
import { isbn10To13, isbn13To10, MarcBookFields, parseMarcRecord } from './marcxml';
import { SruPreset } from './sru_presets';

const ISBN_REGEX = /^(97[89])?\d{9}[\dX]$/;

export interface CqlQuery {
  cql: string;
  isbn?: string; // set when the query is an ISBN search
}

export function buildCqlQuery(preset: SruPreset, query: string): CqlQuery {
  const compact = query.replace(/[\s-]/g, '').toUpperCase();
  if (ISBN_REGEX.test(compact)) {
    return { cql: `${preset.isbnIndex}=${compact}`, isbn: compact };
  }
  const escaped = query.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return { cql: `${preset.keywordIndex}="${escaped}"` };
}

// Parses an SRU 1.2 searchRetrieve response and returns the embedded MARC
// records. SRU reports errors as diagnostics inside a normal 200 response,
// so those are turned into exceptions here.
export function parseSruResponse(xml: string): { total: number; records: Element[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || root?.localName !== 'searchRetrieveResponse') {
    throw new Error('The library returned something that is not a valid SRU response.');
  }

  const diagnostic = descendants(root, 'diagnostic')[0];
  if (diagnostic) {
    const message = descendants(diagnostic, 'message')[0]?.textContent?.trim();
    const uri = descendants(diagnostic, 'uri')[0]?.textContent?.trim();
    throw new Error(message || `SRU diagnostic ${uri ?? 'without details'}`);
  }

  const total = Number(descendants(root, 'numberOfRecords')[0]?.textContent ?? 0) || 0;
  const records = descendants(root, 'recordData')
    .map(recordData => {
      const element = Array.from(recordData.children).find(el => el.localName === 'record');
      if (element) return element;
      // recordPacking=string: the record is escaped XML inside recordData.
      const text = recordData.textContent?.trim();
      if (!text) return undefined;
      const inner = new DOMParser().parseFromString(text, 'application/xml').documentElement;
      return inner?.localName === 'record' ? inner : undefined;
    })
    .filter((el): el is Element => !!el);

  return { total, records };
}

function descendants(el: Element, localName: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter(child => child.localName === localName);
}

export class SruBooksApi implements BaseBooksApiImpl {
  constructor(private readonly preset: SruPreset) {}

  public buildSearchParams(query: string): { params: Record<string, string | number>; isbn?: string } {
    const { cql, isbn } = buildCqlQuery(this.preset, query);
    return {
      params: {
        version: '1.2',
        operation: 'searchRetrieve',
        recordSchema: 'marcxml',
        maximumRecords: this.preset.maximumRecords,
        query: cql,
      },
      isbn,
    };
  }

  async getByQuery(query: string): Promise<Book[]> {
    if (!query.trim()) return [];
    try {
      const { params, isbn } = this.buildSearchParams(query);
      const xml = await apiGetText(this.preset.baseUrl, params, { Accept: 'application/xml, text/xml' });
      const fields = parseSruResponse(xml).records.map(parseMarcRecord);
      if (!isbn) return fields.map(f => this.createBookItem(f));

      // ISBN indexes can return records that don't carry the ISBN (Alma
      // matches "0000000000" placeholders, for instance), so keep only exact
      // matches and report the searched ISBN rather than the record's first.
      const isbn13 = isbn.length === 10 ? isbn10To13(isbn) : isbn;
      return fields
        .filter(f => f.isbns.includes(isbn13))
        .map(f => this.createBookItem({ ...f, isbn13, isbn10: isbn13To10(isbn13) ?? '' }));
    } catch (error) {
      console.warn(error);
      throw error;
    }
  }

  public createBookItem(fields: MarcBookFields): Book {
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
      link: fields.id && this.preset.recordUrl ? this.preset.recordUrl(fields.id) : '',
      previewLink: '',
      isbn10: fields.isbn10,
      isbn13: fields.isbn13,
    };
  }
}
