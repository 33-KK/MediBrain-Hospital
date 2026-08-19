$env:NODE_PATH = "D:\MediBrain-Hospital\apps\server\node_modules"
Set-Location "D:\MediBrain-Hospital\scripts\embedding"
node index-graph.js 2>&1 | Out-File -FilePath "index-run.log" -Append -Encoding utf8
