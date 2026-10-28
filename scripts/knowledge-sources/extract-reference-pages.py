"""Extract archived PDFs by page for the reference library; retain original page numbers.
Plain-text extraction is not a clinical interpretation or a replacement for the PDF layout.
"""
import hashlib
import json
import sys
from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]

def main():
    report = json.loads((ROOT / 'docs/knowledge-sources/references-latest.json').read_text(encoding='utf-8'))
    records = []
    for source in report['records']:
        if source['status'] != 'archived':
            continue
        file = (ROOT / source['localFile']).resolve()
        if not file.is_relative_to(ROOT) or hashlib.sha256(file.read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('Reference path or checksum mismatch')
        pdf = PdfReader(file)
        for number, page in enumerate(pdf.pages, 1):
            text = (page.extract_text() or '').strip()
            records.append({'id': source['id'] + ':page:' + str(number), 'documentId': source['id'],
                            'pageNumber': number, 'text': text,
                            'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
                            'originalFileSha256': source['sha256'], 'layoutSensitive': True,
                            'extractionStatus': 'text-extracted' if text else 'no-text-layer'})
    target = ROOT / 'data/knowledge-staging/reference-pages.ndjson'
    with target.open('w', encoding='utf-8') as output:
        for record in records:
            output.write(json.dumps(record, ensure_ascii=False) + '\n')
    print(json.dumps({'pdfPages': len(records), 'emptyPages': sum(not item['text'] for item in records),
                      'databaseWrites': 0, 'clinicalReview': 'pending'}))

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
