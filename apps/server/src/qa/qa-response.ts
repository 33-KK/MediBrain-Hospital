import type { AnswerSource } from './grounded-answer';
import type { KnowledgeReference } from '../knowledge/knowledge.service';

export interface AnswerSection {
  title: string;
  items: { text: string; sourceIds: string[] }[];
}

export interface DocumentEvidence {
  id: string;
  documentId: string;
  title: string;
  page: number | null;
  paragraph: number;
  text: string;
  url: string;
  originalSha256: string;
  textKind: string;
  language: string;
}

export interface QaResponse {
  answer: string;
  entities: { name: string; type: string }[];
  dimension: string | null;
  sources: AnswerSource[];
  provider: string;
  graphMatched: boolean;
  vectorMatched?: boolean;
  vectorCandidates?: { name: string; type: string; score: number }[];
  knowledgeUnavailable?: boolean;
  reviewEntities?: string[];
  references?: KnowledgeReference[];
  sections?: AnswerSection[];
  documentEvidence?: DocumentEvidence[];
  conversationId?: string;
  recordId?: string;
  resolvedQuestion?: string;
  context?: { inheritedEntities: string[]; needsClarification: boolean };
  grounding: {
    mode: 'graph-facts' | 'reference-library' | 'document-excerpts';
    modelAccepted: boolean;
    omitted: number;
  };
}
