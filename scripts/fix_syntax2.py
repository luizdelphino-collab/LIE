import sys
import re

file_path = 'lib/consolidarProjeto.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(
    r'return await respProxy\.arrayBuffer\(\);\s*async function obterPdfPublicoCacheado',
    'return await respProxy.arrayBuffer();\n}\n\nasync function obterPdfPublicoCacheado',
    content
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
