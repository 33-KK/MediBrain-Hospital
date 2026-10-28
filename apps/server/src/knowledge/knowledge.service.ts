import {
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import neo4j, { type Driver } from 'neo4j-driver';
import { NEO4J_DRIVER } from '../neo4j/neo4j.constants';
import { withinDeadline } from '../common/within-deadline';
import { splitDocumentPassages } from './document-passages';

export { splitDocumentPassages } from './document-passages';

export const DOCUMENT_QA_LIMITS = {
  pages: 160,
  totalCharacters: 300_000,
  pageCharacters: 40_000,
  readTimeoutMs: 5_000,
} as const;

export interface KnowledgeReference {
  id: string;
  title: string;
  kind: string;
  language: string;
  publisher: string;
  url: string;
  version: string;
  topicsZh: string[];
  pageCount: number;
  reviewStatus: string;
}

export interface KnowledgeQaDocument extends KnowledgeReference {
  originalSha256: string;
  textKind: string;
  pages: {
    page: number | null;
    text: string;
    extractionStatus: string | null;
  }[];
  incomplete: boolean;
}

const collection = 'official-medical-2026-10';
const projection = `n { .id, .title, .kind, .language, .publisher, .url, .version,
  .topicsZh, .pageCount, .reviewStatus } AS document`;

function reference(value: Record<string, unknown>): KnowledgeReference {
  return {
    ...(value as unknown as KnowledgeReference),
    pageCount: Number(value.pageCount ?? 0),
  };
}

/** Original references have their own index; they never become clinical facts automatically. */
@Injectable()
export class KnowledgeService {
  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  async stats() {
    const result = await this.driver.executeQuery(
      `MATCH (n:_MediBrainKnowledgeDocument {collection: $collection})
       RETURN count(n) AS documents,
       sum(CASE WHEN n.kind = 'health-topic' THEN 1 ELSE 0 END) AS englishSummaries,
       sum(CASE WHEN n.kind = 'dietary-pdf' THEN 1 ELSE 0 END) AS chinesePdfs,
       sum(CASE WHEN n.kind = 'fact-sheet-link' THEN 1 ELSE 0 END) AS whoReferences,
       sum(n.pageCount) AS pdfPages`,
      { collection },
    );
    return Object.fromEntries(
      result.records[0].keys.map((key) => [
        key,
        Number(result.records[0].get(key)),
      ]),
    );
  }

  async search(
    kw = '',
    page = 1,
    pageSize = 20,
  ): Promise<{ total: number; list: KnowledgeReference[] }> {
    const query = kw.trim();
    // Quote every term so user input cannot introduce Lucene operators or wildcards.
    const fulltext = query
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replace(/[\\"]/g, '\\$&')}"`)
      .join(' AND ');
    const match = query
      ? `CALL db.index.fulltext.queryNodes('medibrain_knowledge_text', $fulltext) YIELD node AS n, score
         WHERE n.collection = $collection`
      : `MATCH (n:_MediBrainKnowledgeDocument {collection: $collection}) WITH n, 0.0 AS score`;
    const params = {
      collection,
      fulltext,
      skip: neo4j.int((page - 1) * pageSize),
      limit: neo4j.int(pageSize),
    };
    const count = await this.driver.executeQuery(
      `${match} RETURN count(n) AS total`,
      params,
    );
    const rows = await this.driver.executeQuery(
      `${match} RETURN ${projection} ORDER BY score DESC, n.language DESC, n.title SKIP $skip LIMIT $limit`,
      params,
    );
    return {
      total: Number(count.records[0].get('total')),
      list: rows.records.map((record) =>
        reference(record.get('document') as Record<string, unknown>),
      ),
    };
  }

  async related(names: string[]): Promise<KnowledgeReference[]> {
    if (!names.length) return [];
    const result = await this.driver.executeQuery(
      `MATCH (n:_MediBrainKnowledgeDocument {collection: $collection})
       WHERE any(name IN $names WHERE name IN n.topicsZh)
       RETURN ${projection}
       ORDER BY CASE n.kind WHEN 'dietary-pdf' THEN 0 WHEN 'fact-sheet-link' THEN 1 ELSE 2 END, n.title LIMIT 6`,
      { collection, names },
    );
    return result.records.map((record) =>
      reference(record.get('document') as Record<string, unknown>),
    );
  }

  async document(id: string, page = 1) {
    const result = await this.driver.executeQuery(
      `MATCH (n:_MediBrainKnowledgeDocument {id: $id, collection: $collection})
       OPTIONAL MATCH (n)-[:_MEDIBRAIN_HAS_PAGE]->(p:_MediBrainKnowledgePage {pageNumber: $page})
       RETURN ${projection}, n.contentText AS contentText, n.textKind AS textKind,
       n.attribution AS attribution, n.contentScope AS contentScope,
       n.reuse AS reuse, n.originalSha256 AS originalSha256,
       p.text AS pageText, p.extractionStatus AS extractionStatus`,
      { collection, id, page: neo4j.int(page) },
    );
    const row = result.records[0];
    if (!row) throw new NotFoundException('资料不存在');
    const doc = reference(row.get('document') as Record<string, unknown>);
    if (doc.pageCount && (page < 1 || page > doc.pageCount))
      throw new NotFoundException('页码不存在');
    const contentText = doc.pageCount
      ? String(row.get('pageText') ?? '')
      : String(row.get('contentText') ?? '');
    return {
      ...doc,
      contentText,
      paragraphs: splitDocumentPassages(contentText),
      page: doc.pageCount ? page : null,
      textKind: doc.pageCount
        ? 'original-page-text'
        : String(row.get('textKind') ?? 'original-summary'),
      attribution: row.get('attribution') as string | null,
      contentScope: row.get('contentScope') as string | null,
      reuse: row.get('reuse') as string | null,
      originalSha256: row.get('originalSha256') as string | null,
      extractionStatus: row.get('extractionStatus') as string | null,
    };
  }

  /** Bounded read of one already imported source, with no clinical graph writes. */
  async qaDocument(id: string): Promise<KnowledgeQaDocument> {
    const deadline = Date.now() + DOCUMENT_QA_LIMITS.readTimeoutMs;
    const read = (query: string, parameters: Record<string, unknown>) =>
      withinDeadline(
        () =>
          this.driver.executeQuery(query, parameters, {
            routing: neo4j.routing.READ,
            transactionConfig: { timeout: Math.max(1, deadline - Date.now()) },
          }),
        deadline,
      );
    const metadata = await read(
      `MATCH (n:_MediBrainKnowledgeDocument {id: $id, collection: $collection})
       RETURN ${projection}, n.originalSha256 AS originalSha256,
       n.textKind AS textKind, size(coalesce(n.contentText, '')) AS textLength,
       CASE WHEN coalesce(n.pageCount, 0) = 0
         THEN substring(coalesce(n.contentText, ''), 0, $maximumText)
         ELSE '' END AS contentText`,
      {
        id,
        collection,
        maximumText: neo4j.int(DOCUMENT_QA_LIMITS.totalCharacters + 1),
      },
    );
    const row = metadata.records[0];
    if (!row) throw new NotFoundException('资料不存在');
    const doc = reference(row.get('document') as Record<string, unknown>);
    if (doc.pageCount > DOCUMENT_QA_LIMITS.pages)
      throw new PayloadTooLargeException(
        '资料页数超出文档问答限制，请阅读原文',
      );
    const textKind = String(row.get('textKind') ?? 'original-summary');
    const originalSha256 = String(row.get('originalSha256') ?? '');
    if (!doc.pageCount) {
      if (Number(row.get('textLength')) > DOCUMENT_QA_LIMITS.totalCharacters)
        throw new PayloadTooLargeException(
          '资料正文超出文档问答限制，请阅读原文',
        );
      return {
        ...doc,
        originalSha256,
        textKind,
        pages:
          textKind === 'adapted-draft'
            ? []
            : [
                {
                  page: null,
                  text: String(row.get('contentText') ?? ''),
                  extractionStatus: null,
                },
              ],
        incomplete: false,
      };
    }
    const result = await read(
      `MATCH (n:_MediBrainKnowledgeDocument {id: $id, collection: $collection})
       MATCH (n)-[:_MEDIBRAIN_HAS_PAGE]->(p:_MediBrainKnowledgePage)
       WHERE p.collection = $collection AND p.documentId = $id
       RETURN p.pageNumber AS pageNumber, size(coalesce(p.text, '')) AS textLength,
       substring(coalesce(p.text, ''), 0, $maximumText) AS pageText,
       p.extractionStatus AS extractionStatus
       ORDER BY p.pageNumber LIMIT $maximumPages`,
      {
        id,
        collection,
        maximumText: neo4j.int(DOCUMENT_QA_LIMITS.pageCharacters + 1),
        maximumPages: neo4j.int(DOCUMENT_QA_LIMITS.pages + 1),
      },
    );
    let totalCharacters = 0;
    const seen = new Set<number>();
    const pages: KnowledgeQaDocument['pages'] = [];
    for (const pageRow of result.records) {
      const length = Number(pageRow.get('textLength'));
      totalCharacters += length;
      if (
        length > DOCUMENT_QA_LIMITS.pageCharacters ||
        totalCharacters > DOCUMENT_QA_LIMITS.totalCharacters
      )
        throw new PayloadTooLargeException(
          '资料正文超出文档问答限制，请阅读原文',
        );
      const page = Number(pageRow.get('pageNumber'));
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > doc.pageCount ||
        seen.has(page)
      )
        throw new Error('资料页码元数据不一致');
      seen.add(page);
      pages.push({
        page,
        text: String(pageRow.get('pageText') ?? ''),
        extractionStatus: pageRow.get('extractionStatus') as string | null,
      });
    }
    return {
      ...doc,
      originalSha256,
      // PDF page nodes contain extracted original text, even if n.contentText is a draft.
      textKind: 'original-page-text',
      pages,
      incomplete:
        pages.length !== doc.pageCount ||
        pages.some((page) => !page.text.trim()),
    };
  }
}
