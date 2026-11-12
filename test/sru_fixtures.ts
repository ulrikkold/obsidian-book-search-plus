// Test-only helper: it runs under Jest in Node, never in Obsidian, so the
// mobile-safety rule against Node built-ins doesn't apply.
/* eslint-disable obsidianmd/no-nodejs-modules */
/* global __dirname */
import { readFileSync } from 'fs';
import { join } from 'path';

// Recorded SRU responses from the Royal Danish Library's catalogue
// (https://kbdk-kgl.alma.exlibrisgroup.com/view/sru/45KBDK_KGL), November 2026.
// Saved verbatim, except isbn_spurious_matches.xml, which was trimmed to its
// first two records.
export function loadSruFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', 'sru', name), 'utf8');
}

const MARC_NS = 'http://www.loc.gov/MARC21/slim';

// All MARC records in a fixture, keyed by their 001 control number.
export function marcRecordsById(name: string): Map<string, Element> {
  const doc = new DOMParser().parseFromString(loadSruFixture(name), 'application/xml');
  const records = new Map<string, Element>();
  for (const record of Array.from(doc.getElementsByTagNameNS(MARC_NS, 'record'))) {
    const id = Array.from(record.children).find(
      el => el.localName === 'controlfield' && el.getAttribute('tag') === '001',
    )?.textContent;
    if (id) records.set(id, record);
  }
  return records;
}
