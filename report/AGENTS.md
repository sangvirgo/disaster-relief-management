# Report Agent Instructions

These instructions apply only to files under `report/`. Follow the parent C48 `AGENTS.md` as well.

## Source authority

1. Follow the user's current instructions and the official rule file `3_Phuluc_Hinh thuc va quy cach trinh bay quyen DATN-QD449-09032026.doc` as mandatory requirements. If it conflicts with a sample, the rule file wins.
2. Follow the layout and report organization in `Report Template Must Follow.pdf`, the sample the user identified as receiving 9.2 points. Adapt its chapter content to C48; do not copy its unrelated medical-system content.
3. Use `../docs/c48-project-context.md` for assigned scope and `../docs/c48-technology-and-delivery-plan.md` (including Appendix A) for C48 design decisions, implementation invariants, and open questions.
4. `Reference-1.pdf` and `Reference-2.pdf` are background references only. They do not set report rules or override C48 project documents. Cite claims drawn from them and distinguish evidence from inference.

## Report requirements

- The user selected Vietnamese for this report. Write report content and headings in Vietnamese with correct Unicode. Preserve stable identifiers and technical names such as UR, FR, NFR, UC, TC, API, and PostGIS. This choice applies to this report only.
- Keep source requirements, adopted design decisions, proposals, and unresolved policies distinct. Do not invent team roles, supervisor details, approvals, policies, measurements, or test results; leave placeholders where facts are missing.
- Preserve C48 requirement/use-case/test-case identifiers and traceability. Do not claim planned checks were run or that the demo is highly available.
- Keep every report image in `images/`. Use relative paths from `main.tex`; do not link report figures to files outside this folder. Give each figure, diagram, and table a numbered caption, source or note where needed, and a `\label` after its caption.
- Generate the table of contents, list of tables, list of diagrams, and list of figures from LaTeX commands. Never type page numbers or maintain those lists by hand. Compile `main.tex` with XeLaTeX at least twice after structural or pagination changes so references and lists update.

## Required order and presentation

Follow the official order: approval/task assignment; acknowledgements; declaration; table of contents; abbreviations; lists of tables, diagrams, and figures; introduction; group task assignment; chapters; conclusion and recommendations; references; appendices if needed.

Use A4, 3 cm left margin, 2 cm for the other page margins, 12 pt body text (13 pt only where appropriate), a consistent Times New Roman family, justified paragraphs, 3 pt before/after paragraph spacing, and 1.1–1.2 line spacing. Chapter titles are bold, uppercase, and 13–15 pt; section headings are bold and 13 pt. Use roman page numbers from acknowledgements through the figure list and Arabic numbers from the introduction through appendices. Keep the required header and footer on report pages. Figure captions go below figures. The physical red hardcover, gold lettering, and blank liner are print-production requirements and cannot be represented by LaTeX alone. This workstation has no Times New Roman font installed, so `main.tex` falls back to Liberation Serif; use a licensed Times New Roman font if exact font matching is required.

## Build

From this directory, run `xelatex -interaction=nonstopmode -halt-on-error main.tex` twice. Keep all source images under `images/`; replace bracketed placeholders only with verified project information.

For the current workstation, the missing TeX packages and XeLaTeX format are in a temporary user tree. Prefix both commands with `TEXMFHOME=/tmp/c48-texmf TEXMFVAR=/tmp/c48-texmf-var TEXMFCONFIG=/tmp/c48-texmf-config`; rebuild the TeX setup if `/tmp/c48-texmf` is removed.

The workspace settings in `.vscode/settings.json` configure LaTeX Workshop to build twice with XeLaTeX on save and show its internal PDF preview. They use the same temporary TeX tree.
