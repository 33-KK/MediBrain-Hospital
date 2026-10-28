"""Normalize NLM XML with the Python standard library; never resolve external DTDs.
The result is a review dataset, not an import into the active medical graph.
"""
import hashlib
import json
import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
TARGETS = [
    ('高血压', 'High Blood Pressure', 'related-topic'),
    ('糖尿病', 'Diabetes', 'related-topic'),
    ('2型糖尿病', 'Diabetes Type 2', 'related-topic'),
    ('1型糖尿病', 'Diabetes Type 1', 'related-topic'),
    ('冠心病', 'Coronary Artery Disease', 'related-topic'),
    ('脑卒中', 'Stroke', 'related-topic'),
    ('慢性阻塞性肺疾病', 'COPD', 'related-topic'),
    ('哮喘', 'Asthma', 'related-topic'),
    ('抑郁症', 'Depression', 'related-topic'),
    ('类风湿关节炎', 'Rheumatoid Arthritis', 'related-topic'),
    ('甲状腺功能亢进', 'Hyperthyroidism', 'related-topic'),
    ('胃溃疡', 'Peptic Ulcer', 'broader-topic-not-equivalent'),
    ('胃癌', 'Stomach Cancer', 'related-topic'),
    ('肺癌', 'Lung Cancer', 'related-topic'),
    ('肺炎', 'Pneumonia', 'related-topic'),
    ('慢性肾脏病', 'Chronic Kidney Disease', 'related-topic'),
    ('高脂血症', 'Cholesterol', 'related-topic-not-equivalent'),
    ('痛风', 'Gout', 'related-topic'),
    ('肥胖', 'Obesity', 'related-topic'),
    ('骨质疏松', 'Osteoporosis', 'related-topic'),
]

class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        if tag in ('p', 'li', 'br', 'h2', 'h3', 'tr'):
            self.parts.append('\n')
        if tag == 'li':
            self.parts.append('- ')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
        if tag in ('p', 'li', 'h2', 'h3', 'tr'):
            self.parts.append('\n')
        if tag in ('td', 'th'):
            self.parts.append(' | ')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

    def text(self):
        return '\n'.join(line for part in ''.join(self.parts).splitlines()
                         if (line := re.sub(r'\s+', ' ', part).strip()))

def plain_text(value):
    parser = PlainText()
    parser.feed(value)
    return parser.text()

def element_text(element):
    return '' if element is None else ''.join(element.itertext())

def parse_topics(payload, manifest):
    if hashlib.sha256(payload).hexdigest() != manifest['sha256']:
        raise ValueError('XML checksum does not match manifest')
    if b'<!ENTITY' in payload.upper():
        raise ValueError('Entity declarations are not accepted')
    tree = ET.fromstring(payload)
    if tree.tag != 'health-topics':
        raise ValueError('Expected health-topics XML root')
    all_topics = tree.findall('health-topic')
    if int(tree.attrib['total']) != len(all_topics):
        raise ValueError('Published topic count does not match XML')
    records, excluded = [], []
    ids = set()
    for topic in all_topics:
        if topic.get('language') != 'English':
            continue
        topic_id = topic.attrib['id']
        if topic_id in ids:
            raise ValueError('Duplicate topic ID')
        ids.add(topic_id)
        summary = plain_text(element_text(topic.find('full-summary')))
        if not summary:
            excluded.append({'id': topic_id, 'title': topic.attrib['title'], 'reason': 'missing-full-summary'})
            continue
        records.append({
            'id': 'medlineplus:' + topic_id,
            'title': topic.attrib['title'],
            'language': 'en',
            'summary': summary,
            'aliases': sorted(set(element_text(value).strip() for tag in ('also-called', 'see-reference')
                                  for value in topic.findall(tag) if element_text(value).strip())),
            'mesh': [{'id': heading.find('descriptor').get('id'),
                      'name': element_text(heading.find('descriptor'))}
                     for heading in topic.findall('mesh-heading') if heading.find('descriptor') is not None],
            'relatedTopics': [{'id': related.get('id'), 'title': element_text(related),
                               'url': related.get('url')} for related in topic.findall('related-topic')],
            'contentScope': {'type': 'patient-health-education', 'jurisdiction': 'United States',
                             'relatedTopicsAreClinicalRelations': False,
                             'localDiagnosticCriteriaVerified': False},
            'source': {**manifest, 'topicUrl': topic.attrib['url'],
                       'topicCreatedAt': topic.get('date-created'),
                       'recordSha256': hashlib.sha256(summary.encode('utf-8')).hexdigest()},
            'review': {'status': 'pending', 'required': ['clinical-applicability', 'translation-if-used-in-Chinese']},
            'publishToQa': False,
        })
    return tree, all_topics, records, excluded

def priority_candidates(records):
    by_title = {record['title'].casefold(): record for record in records}
    if len(by_title) != len(records):
        raise ValueError('Duplicate English topic title; mapping requires review')
    candidates, missing = [], []
    for name, title, mapping_scope in TARGETS:
        record = by_title.get(title.casefold())
        if not record:
            missing.append({'disease': name, 'expectedTopicTitle': title})
            continue
        candidates.append({**record, 'diseaseName': name, 'mappingScope': mapping_scope,
                           'summaryZh': None, 'targetProposal': {'label': '疾病', 'name': name, 'property': '疾病简介'},
                           'review': {'status': 'pending', 'required': ['entity-mapping', 'Chinese-translation', 'clinical-applicability']}})
    return candidates, missing

def normalize(xml_file, manifest_file, output_root=ROOT):
    payload = Path(xml_file).read_bytes()
    manifest = json.loads(Path(manifest_file).read_text(encoding='utf-8'))
    tree, all_topics, records, excluded = parse_topics(payload, manifest)
    candidates, missing = priority_candidates(records)
    staging = output_root / 'data/knowledge-staging'
    staging.mkdir(parents=True, exist_ok=True)
    with (staging / 'medlineplus-en.ndjson').open('w', encoding='utf-8') as output:
        for record in records:
            output.write(json.dumps(record, ensure_ascii=False) + '\n')
    (staging / 'priority-diseases.json').write_text(json.dumps(candidates, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    report = {
        'sourceUrl': manifest['url'], 'datasetDate': manifest['datasetDate'],
        'xmlGeneratedAt': tree.get('date-generated') or tree.get('dategenerated'),
        'downloadSha256': manifest['sha256'], 'totalPublishedTopics': len(all_topics),
        'languages': dict(Counter(topic.get('language') for topic in all_topics)),
        'excludedEnglishTopics': excluded,
        'englishSummariesCollected': len(records), 'englishSummaryCharacters': sum(len(record['summary']) for record in records),
        'priorityCandidates': len(candidates), 'missingPriorityTopics': missing,
        'candidates': [{'disease': record['diseaseName'], 'topic': record['title'], 'sourceUrl': record['source']['topicUrl'],
                        'mappingScope': record['mappingScope']} for record in candidates],
        'stagingFiles': ['data/knowledge-staging/medlineplus-en.ndjson', 'data/knowledge-staging/priority-diseases.json'],
        'databaseWrites': 0, 'qaPublishedRecords': 0, 'clinicalAcceptance': 'pending-professional-review',
    }
    reports = output_root / 'docs/knowledge-sources'
    reports.mkdir(parents=True, exist_ok=True)
    (reports / 'collection-latest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key not in ('candidates', 'stagingFiles')}, ensure_ascii=False))

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    normalize(sys.argv[1], sys.argv[2])
