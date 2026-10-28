/** Read-only corpus quality audit. No clinical truth is inferred from structural checks. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { requireDependency } = require('../runtime.cjs');
const neo4j = requireDependency('neo4j-driver');
const reportDir = path.resolve(__dirname, '../../docs/acceptance');

async function main() {
  const secret = JSON.parse(execFileSync('kubectl', ['get', 'secret', 'medibrain-secret', '-n', 'medibrain', '-o', 'json'], { encoding: 'utf8' }));
  const driver = neo4j.driver('bolt://localhost:7688', neo4j.auth.basic('neo4j', Buffer.from(secret.data.NEO4J_PASSWORD, 'base64').toString()));
  const count = (value) => neo4j.isInt(value) ? value.toNumber() : value;
  const query = async (cypher, params = {}) => (await driver.executeQuery(cypher, params)).records.map((record) => Object.fromEntries(record.keys.map((key) => [key, count(record.get(key))])));
  const provenanceKeys = ['来源', '数据来源', '参考文献', 'source', 'source_url', 'sourceUrl', 'references'];
  const reviewedKeys = ['审核人', 'reviewer', 'reviewedBy'];
  const dateKeys = ['审核日期', 'reviewedAt', 'review_date'];
  const nonEmpty = (keys) => `any(k IN $${keys} WHERE n[k] IS NOT NULL AND trim(toString(n[k])) <> '')`;
  try {
    const labels = await query('MATCH (n) WHERE NOT n:_MediBrainIndexTask AND NOT n:_MediBrainKnowledgeDocument AND NOT n:_MediBrainKnowledgePage RETURN labels(n)[0] AS label,count(n) AS nodes ORDER BY nodes DESC');
    const names = await query('MATCH (n) WHERE NOT n:_MediBrainIndexTask AND NOT n:_MediBrainKnowledgeDocument AND NOT n:_MediBrainKnowledgePage RETURN count(n) AS total,sum(CASE WHEN n.名称 IS NULL OR trim(toString(n.名称))="" THEN 1 ELSE 0 END) AS missingNames');
    const duplicates = await query('MATCH (n) WHERE n.名称 IS NOT NULL WITH labels(n)[0] AS label,n.名称 AS name,count(n) AS copies WHERE copies>1 RETURN label,name,copies ORDER BY copies DESC LIMIT 20');
    const provenance = await query(`MATCH (n:疾病) RETURN count(n) AS diseases,sum(CASE WHEN ${nonEmpty('provenanceKeys')} THEN 1 ELSE 0 END) AS sourced,sum(CASE WHEN ${nonEmpty('reviewedKeys')} AND ${nonEmpty('dateKeys')} THEN 1 ELSE 0 END) AS reviewed`, { provenanceKeys, reviewedKeys, dateKeys });
    const relationships = await query("MATCH ()-[r]->() WHERE type(r) <> '_MEDIBRAIN_HAS_PAGE' RETURN type(r) AS type,count(r) AS edges ORDER BY edges DESC");
    const missingEndpoints = await query("MATCH (s)-[r]->(t) WHERE type(r) <> '_MEDIBRAIN_HAS_PAGE' AND (s.名称 IS NULL OR t.名称 IS NULL) RETURN count(r) AS missingEndpointNames");
    const referenceLibrary = await query('MATCH (n:_MediBrainKnowledgeDocument) RETURN count(n) AS documents,sum(n.pageCount) AS pdfPages');
    const selfRelations = await query('MATCH (n)-[r]->(n) RETURN type(r) AS type,count(r) AS edges');
    const selfRelationReview = await query('MATCH (n)-[r]->(n) RETURN n.名称 AS disease,type(r) AS type,elementId(r) AS relationshipId ORDER BY disease');
    const properties = await query('MATCH (n:疾病) UNWIND keys(n) AS key RETURN key,count(*) AS populated ORDER BY populated DESC');
    const importFields = ['名称', '疾病简介', '疾病病因', '预防措施', '治疗周期', '治愈概率', '疾病易感人群'];
    const imports = await query('MATCH (n:疾病) RETURN properties(n) AS props');
    const importProvenance = { verified: 0, staleOrInvalid: 0, missing: 0, scope: 'disease-properties only; no relationship or clinical certification' };
    for (const { props } of imports) {
      if (!props._medibrainImportProvenance) { importProvenance.missing++; continue; }
      try {
        const source = JSON.parse(props._medibrainImportProvenance);
        const hash = createHash('sha256').update(JSON.stringify(importFields.map((key) => props[key] ?? null))).digest('hex');
        if (source.scope === 'disease-properties' && source.matchHash === hash && /^[a-f0-9]{40}$/.test(source.commit) && /^[a-f0-9]{40}$/.test(source.blobSha)) importProvenance.verified++;
        else importProvenance.staleOrInvalid++;
      } catch { importProvenance.staleOrInvalid++; }
    }
    const sample = await query('MATCH (n:疾病) WHERE n.名称 IN $names RETURN n.名称 AS disease,n.疾病病因 AS cause,n.预防措施 AS prevention,n.治愈概率 AS cureProbability,n.治疗周期 AS treatmentPeriod', { names: ['高血压', '糖尿病', '冠心病', '胃溃疡'] });
    const report = { timestamp: new Date().toISOString(), mode: 'read-only', labels, names: names[0], duplicates, provenance: provenance[0], importProvenance, relationships, referenceLibrary: referenceLibrary[0], missingEndpoints: missingEndpoints[0], selfRelations, selfRelationReview, diseasePropertyCoverage: properties, professionalReviewQueue: sample, clinicalAcceptance: 'pending-professional-review', metadataKeysChecked: { provenanceKeys, reviewedKeys, dateKeys } };
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'corpus-quality-latest.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ labels, names: names[0], duplicates, provenance: provenance[0], importProvenance, missingEndpoints: missingEndpoints[0], selfRelations, clinicalAcceptance: report.clinicalAcceptance }));
  } finally { await driver.close(); }
}
main().catch((error) => { console.error(JSON.stringify({ contentQualityFailed: error.message })); process.exitCode = 1; });
