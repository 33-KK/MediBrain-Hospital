"""Regression checks for external-data integrity, omissions and unsafe entity mapping."""
import hashlib
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('normalizer', Path(__file__).with_name('normalize-medlineplus.py'))
normalizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normalizer)

def dataset(topics, total=None, dtd=''):
    return (dtd + '<health-topics total="' + str(total if total is not None else len(topics)) + '">' + ''.join(topics) + '</health-topics>').encode()

def topic(topic_id='1', title='Test', summary='&lt;p&gt;Example&lt;/p&gt;', language='English'):
    value = '<full-summary>' + summary + '</full-summary>' if summary is not None else ''
    return f'<health-topic id="{topic_id}" title="{title}" language="{language}" url="https://medlineplus.gov/test.html">{value}</health-topic>'

def parse(payload, checksum=None):
    return normalizer.parse_topics(payload, {'sha256': checksum or hashlib.sha256(payload).hexdigest()})

class NormalizeTests(unittest.TestCase):
    def test_missing_summary_is_reported_and_never_fabricated(self):
        _, _, records, excluded = parse(dataset([topic(), topic('2', 'No summary', None), topic('3', 'Spanish', language='Spanish')]))
        self.assertEqual([record['id'] for record in records], ['medlineplus:1'])
        self.assertEqual(excluded, [{'id': '2', 'title': 'No summary', 'reason': 'missing-full-summary'}])
        self.assertFalse(records[0]['publishToQa'])
        self.assertEqual(records[0]['review']['status'], 'pending')

    def test_xml_integrity_and_duplicate_id_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'checksum'):
            parse(dataset([topic()]), '0' * 64)
        with self.assertRaisesRegex(ValueError, 'count'):
            parse(dataset([topic()], total=2))
        with self.assertRaisesRegex(ValueError, 'Duplicate topic ID'):
            parse(dataset([topic(), topic()]))

    def test_custom_entity_expansion_is_rejected(self):
        payload = dataset([topic(summary='&local;')], dtd='<!DOCTYPE health-topics [<!ENTITY local "unsafe">]>')
        with self.assertRaisesRegex(ValueError, 'Entity declarations'):
            parse(payload)

    def test_table_rows_and_conditional_operators_remain_separate(self):
        text = normalizer.plain_text('<table><tr><th>Systolic</th><th>Rule</th><th>Diastolic</th></tr><tr><td>130-139</td><td>or</td><td>80-89</td></tr></table>')
        self.assertEqual(text.splitlines(), ['Systolic | Rule | Diastolic |', '130-139 | or | 80-89 |'])
        self.assertNotIn('unsafe', normalizer.plain_text('<script>unsafe</script><p>Safe &amp; clear</p>'))

    def test_broader_topics_are_not_marked_as_equivalent_or_approved(self):
        _, _, records, _ = parse(dataset([topic(title='Peptic Ulcer'), topic('2', 'Cholesterol')]))
        candidates, _ = normalizer.priority_candidates(records)
        self.assertEqual({item['diseaseName'] for item in candidates}, {'胃溃疡', '高脂血症'})
        expected_scopes = {'胃溃疡': 'broader-topic-not-equivalent', '高脂血症': 'related-topic-not-equivalent'}
        for item in candidates:
            self.assertEqual(item['mappingScope'], expected_scopes[item['diseaseName']])
            self.assertIsNone(item['summaryZh'])
            self.assertFalse(item['publishToQa'])
            self.assertFalse(item['contentScope']['relatedTopicsAreClinicalRelations'])

    def test_duplicate_titles_block_ambiguous_mapping(self):
        _, _, records, _ = parse(dataset([topic(), topic('2')]))
        with self.assertRaisesRegex(ValueError, 'Duplicate English topic title'):
            normalizer.priority_candidates(records)

if __name__ == '__main__':
    unittest.main()
