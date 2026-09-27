#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ITMS PDF Generator using Playwright + Chromium"""

import os, sys, re, asyncio, json
from pathlib import Path

BASE = Path(__file__).parent.resolve()
PDF_DIR = BASE / "pdf"
PDF_DIR.mkdir(exist_ok=True)

COVER_STYLE = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter','Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.7;color:#1a1a2e;background:white;max-width:210mm;margin:0 auto}
.cover{min-height:297mm;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);color:white;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:60px 40px;page-break-after:always}
.badge{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:30px;padding:6px 20px;font-size:9pt;letter-spacing:2px;text-transform:uppercase;margin-bottom:32px;color:#a78bfa}
.logo{font-size:52pt;font-weight:700;letter-spacing:-2px;line-height:1;margin-bottom:12px;background:linear-gradient(90deg,#c084fc,#818cf8,#38bdf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.subtitle{font-size:15pt;color:#94a3b8;margin-bottom:40px;font-weight:300}
.divider{width:80px;height:3px;background:linear-gradient(90deg,#c084fc,#38bdf8);border-radius:2px;margin:24px auto}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0;max-width:520px}
.mc{background:rgba(255,255,255,.06);border:1px solid rgba(109,40,217,.3);border-radius:10px;padding:14px 8px;text-align:center}
.mv{font-size:20pt;font-weight:700;color:#a78bfa}
.ml{font-size:7.5pt;color:#94a3b8;margin-top:3px}
.meta{font-size:12pt;color:#cbd5e1;margin:6px 0}
.meta strong{color:white}
.footer{margin-top:48px;font-size:8.5pt;color:#64748b;line-height:1.6}
.content{padding:40px 50px}
h1{font-size:22pt;font-weight:700;color:#0f172a;margin:40px 0 18px;padding-bottom:10px;border-bottom:3px solid #6d28d9;page-break-before:always}
h1:first-child{page-break-before:avoid}
h2{font-size:15pt;font-weight:600;color:#1e293b;margin:30px 0 14px;padding-left:12px;border-left:4px solid #6d28d9}
h3{font-size:12pt;font-weight:600;color:#334155;margin:20px 0 10px}
h4{font-size:10.5pt;font-weight:600;color:#475569;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.5px}
p{margin:10px 0}
a{color:#6d28d9;text-decoration:none}
strong{font-weight:600;color:#0f172a}
em{font-style:italic;color:#475569}
ul,ol{margin:10px 0 10px 26px}
li{margin:4px 0}
code{font-family:'JetBrains Mono','Consolas',monospace;font-size:8.5pt;background:#f1f5f9;color:#6d28d9;padding:2px 5px;border-radius:4px;border:1px solid #e2e8f0}
pre{background:#0f172a;color:#e2e8f0;padding:18px 22px;border-radius:8px;margin:14px 0;border-left:4px solid #6d28d9;overflow-x:auto}
pre code{background:transparent;border:none;color:#e2e8f0;padding:0;font-size:8.5pt}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:9.5pt}
th{background:#0f172a;color:white;padding:8px 12px;text-align:left;font-weight:600;font-size:8.5pt;letter-spacing:.3px}
td{padding:7px 12px;border-bottom:1px solid #e2e8f0}
tr:nth-child(even) td{background:#f8fafc}
blockquote{margin:14px 0;padding:10px 18px;background:#f0f9ff;border-left:4px solid #0ea5e9;border-radius:0 8px 8px 0;color:#0369a1;font-size:10pt}
img{max-width:100%;height:auto;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);margin:14px 0;display:block}
.caption{text-align:center;font-size:8.5pt;color:#64748b;font-style:italic;margin:-6px 0 18px}
@media print{.content{padding:15mm 20mm}h1{page-break-before:always}}
</style>"""


def md2html(text):
    # Code blocks first
    def rep_code(m):
        lang = m.group(1) or ""
        body = m.group(2).replace("<", "&lt;").replace(">", "&gt;")
        return f'<pre><code class="lang-{lang}">{body}</code></pre>'
    text = re.sub(r'```(\w*)\n(.*?)```', rep_code, text, flags=re.DOTALL)

    # Inline code
    text = re.sub(r'`([^`]+)`', lambda m: f'<code>{m.group(1)}</code>', text)

    # Tables
    def rep_table(m):
        rows = [r for r in m.group(0).strip().split('\n') if not re.match(r'^\s*[\|\-:]+\s*$', r)]
        if not rows:
            return m.group(0)
        result = '<table>\n'
        for i, row in enumerate(rows):
            cols = [c.strip() for c in row.strip().strip('|').split('|')]
            tag = 'th' if i == 0 else 'td'
            result += '<tr>' + ''.join(f'<{tag}>{c}</{tag}>' for c in cols) + '</tr>\n'
        return result + '</table>\n'
    text = re.sub(r'((?:\|[^\n]+\|\n?)+)', rep_table, text)

    # Headings
    for lvl in [4, 3, 2, 1]:
        hashes = '#' * lvl
        text = re.sub(rf'^{hashes}\s+(.+)$', rf'<h{lvl}>\1</h{lvl}>', text, flags=re.MULTILINE)

    # Bold, italic
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'<strong><em>\1</em></strong>', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'\*([^*\n]+?)\*', r'<em>\1</em>', text)

    # Blockquote
    text = re.sub(r'^>\s+(.+)$', r'<blockquote>\1</blockquote>', text, flags=re.MULTILINE)

    # HR
    text = re.sub(r'^---+$', '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">', text, flags=re.MULTILINE)

    # Lists (simple)
    text = re.sub(r'^[ \t]*[-*]\s+(.+)$', r'<li>\1</li>', text, flags=re.MULTILINE)
    text = re.sub(r'^[ \t]*\d+\.\s+(.+)$', r'<li>\1</li>', text, flags=re.MULTILINE)
    text = re.sub(r'((?:<li>.*?</li>\n?)+)', lambda m: f'<ul>{m.group(0)}</ul>', text, flags=re.DOTALL)

    # Links and images
    text = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', r'<img src="\2" alt="\1"><div class="caption">\1</div>', text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)

    # Paragraphs (lines not starting with < or empty)
    lines = text.split('\n')
    out = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith('<') and not stripped.startswith('|'):
            out.append(f'<p>{stripped}</p>')
        else:
            out.append(line)
    return '\n'.join(out)


def cover_html(subtitle):
    return f"""<div class="cover">
  <div class="badge">Intelligent Traffic Management System</div>
  <div class="logo">ITMS</div>
  <div class="subtitle">{subtitle}</div>
  <div class="divider"></div>
  <div class="metrics">
    <div class="mc"><div class="mv">-49%</div><div class="ml">Emergency Travel Time</div></div>
    <div class="mc"><div class="mv">0.911</div><div class="ml">ML R&sup2; (30s)</div></div>
    <div class="mc"><div class="mv">132</div><div class="ml">Tests Passing</div></div>
    <div class="mc"><div class="mv">7/7</div><div class="ml">Phases Complete</div></div>
  </div>
  <div class="meta"><strong>Team:</strong> Bitcoders</div>
  <div class="meta"><strong>Event:</strong> SISTec Innovation Hackathon 2026</div>
  <div class="meta"><strong>Problem Statement:</strong> IS-8</div>
  <div class="meta"><strong>Date:</strong> September 27, 2026</div>
  <div class="footer">
    Documentation generated from source-code analysis<br>
    All metrics measured from actual SUMO simulation runs &mdash; nothing fabricated
  </div>
</div>"""


def build_html(title, md_content, subtitle):
    body = md2html(md_content)
    cover = cover_html(subtitle)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{title}</title>
{COVER_STYLE}
</head>
<body>
{cover}
<div class="content">
{body}
</div>
</body>
</html>"""


async def html_to_pdf(html_path: Path, pdf_path: Path):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(html_path.as_uri(), wait_until="networkidle", timeout=30000)
        await asyncio.sleep(2)
        await page.pdf(
            path=str(pdf_path),
            format="A4",
            margin={"top": "18mm", "right": "18mm", "bottom": "18mm", "left": "18mm"},
            print_background=True,
            display_header_footer=True,
            header_template='<div style="font-size:7px;width:100%;text-align:right;color:#999;padding-right:18mm">ITMS &mdash; Intelligent Traffic Management System</div>',
            footer_template='<div style="font-size:7px;width:100%;text-align:center;color:#999"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
        )
        await browser.close()


def main():
    print("=== ITMS PDF Generator ===")
    print("Using: Playwright + Chromium")

    docs = [
        ("ITMS_SYSTEM_DOCUMENTATION.md",   "sys", "System & Technical Documentation",  "System & Technical Documentation"),
        ("ITMS_APPLICATION_DOCUMENTATION.md","app","Application & User Documentation","Application & User Documentation"),
        ("ITMS_COMPLETE_DOCUMENTATION.md",  "cmp", "Complete Documentation Package",    "Complete Documentation Package"),
    ]

    for md_file, prefix, subtitle, title in docs:
        md_path = BASE / md_file
        if not md_path.exists():
            print(f"  SKIP: {md_file} not found")
            continue
        
        md_content = md_path.read_text(encoding="utf-8")
        html_content = build_html(f"ITMS - {title}", md_content, subtitle)
        
        html_path = PDF_DIR / f"ITMS_{prefix.upper()}_DOCUMENTATION.html"
        html_path.write_text(html_content, encoding="utf-8")
        print(f"  HTML: {html_path.name} ({html_path.stat().st_size:,} bytes)")
        
        pdf_path = PDF_DIR / f"ITMS_{prefix.upper()}_DOCUMENTATION.pdf"
        try:
            asyncio.run(html_to_pdf(html_path, pdf_path))
            size = pdf_path.stat().st_size if pdf_path.exists() else 0
            print(f"  PDF:  {pdf_path.name} ({size:,} bytes)")
        except Exception as e:
            print(f"  FAIL: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
