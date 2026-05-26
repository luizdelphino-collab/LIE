import sys
import re

file_path = 'lib/consolidarProjeto.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'return await respProxy.arrayBuffer();async function obterPdfPublicoCacheado',
    'return await respProxy.arrayBuffer();\n}\n\nasync function obterPdfPublicoCacheado'
)

content = content.replace(
    'const resp = await fetch(funcUrl, {etch(funcUrl, {',
    'const resp = await fetch(funcUrl, {'
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
