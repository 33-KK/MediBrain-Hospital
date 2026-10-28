"""Check archived reference PDF titles and render covers for visual inspection.
Requires pypdf and a Poppler pdftoppm executable; never modifies source PDFs.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]

def compact(value):
    return re.sub(r'\s+', '', value).translate(str.maketrans({'（': '(', '）': ')', '《': '', '》': ''}))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--renderer', default='pdftoppm')
    args = parser.parse_args()
    catalog = json.loads((ROOT / 'docs/knowledge-sources/source-catalog.json').read_text(encoding='utf-8'))
    references = json.loads((ROOT / 'docs/knowledge-sources/references-latest.json').read_text(encoding='utf-8'))
    by_id = {source['id']: source for source in catalog['sources']}
    preview_dir = ROOT / 'data/knowledge-staging/pdf-previews'
    preview_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for item in references['records']:
        if item['status'] != 'archived':
            continue
        source = by_id[item['id']]
        file = ROOT / item['localFile']
        if hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('PDF checksum mismatch: ' + source['id'])
        pdf = PdfReader(file)
        first_page = pdf.pages[0].extract_text() or ''
        verified = compact(source['title']) in compact(first_page[:1000])
        if not verified:
            raise ValueError('PDF cover title or edition mismatch: ' + source['id'])
        prefix = preview_dir / source['id']
        subprocess.run([args.renderer, '-f', '1', '-l', '1', '-singlefile', '-scale-to', '900',
                        '-png', str(file), str(prefix)], check=True, capture_output=True, timeout=45)
        records.append({'id': source['id'], 'title': source['title'], 'pages': len(pdf.pages),
                        'titleAndEditionVerified': verified, 'documentType': 'guideline-qa' if '问答' in source['title'] else 'dietary-guideline',
                        'localFile': item['localFile'], 'sha256': item['sha256'],
                        'coverPreview': str(prefix.relative_to(ROOT)).replace('\\', '/') + '.png',
                        'clinicalContentReviewed': False, 'publishToQa': False})
    report = {'pdfsInspected': len(records), 'records': records, 'clinicalAcceptance': 'pending-professional-review'}
    (ROOT / 'docs/knowledge-sources/pdf-inspection-latest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
