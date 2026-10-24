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
- Keep every report image in `images/`. Use relative paths from `main.tex`; do not link report figures to files outside this folder. Give each figure, diagram, and table a numbered caption and a `\label` after its caption. Per the user's decision of 2026-10-23, do not add "Nguồn:" or other note lines under tables, figures, or diagrams, even though Mẫu 7 of the rule file mentions notes.
- Generate the table of contents, list of tables, list of diagrams, and list of figures from LaTeX commands. Never type page numbers or maintain those lists by hand. Compile `main.tex` with XeLaTeX at least twice after structural or pagination changes so references and lists update.

## Required order and presentation

Follow the official order: approval/task assignment; acknowledgements; declaration; table of contents; abbreviations; lists of tables, diagrams, and figures; introduction; group task assignment; chapters; conclusion and recommendations; references; appendices if needed.

Use A4, 3 cm left margin, 2 cm for the other page margins, 12 pt body text (13 pt only where appropriate), a consistent Times New Roman family, justified paragraphs, 3 pt before/after paragraph spacing, and 1.1–1.2 line spacing. Chapter titles are bold, uppercase, and 13–15 pt; section headings are bold and 13 pt. Use roman page numbers from acknowledgements through the figure list and Arabic numbers from the introduction through appendices. Keep the required header and footer on report pages. Figure captions go below figures. The physical red hardcover, gold lettering, and blank liner are print-production requirements and cannot be represented by LaTeX alone. This workstation has no original Times New Roman. `main.tex` uses Times New Roman when it is installed, then "SVN-Times New Roman" (installed in `~/.local/share/fonts/c48-times/` from the user's own font files; it covers all Vietnamese glyphs), and only then falls back to Liberation Serif. Run `pdffonts main.pdf` after building to confirm which font was embedded.

## Mandatory layout checklist (QĐ 449/QĐ-HV, Phụ lục 3)

Check every item after any edit; the rule file wins over the 9.2 sample.

- **Cover (Mẫu 1) and inner cover (Mẫu 2):** page border frame; "BỘ KHOA HỌC VÀ CÔNG NGHỆ" and "HỌC VIỆN CÔNG NGHỆ BƯU CHÍNH VIỄN THÔNG" in bold, a dashed rule, the PTIT logo, "ĐỒ ÁN / TỐT NGHIỆP ĐẠI HỌC" bold 36 pt, `Đề tài : “...”` bold italic 16–30 pt, "Giáo viên hướng dẫn :" with the name bold, uppercase, 13 pt, "Nhóm sinh viên thực hiện :", one `Mã SV: … Họ và tên: …` row per student, and "TP. HỒ CHÍ MINH, NĂM …" at the bottom. Do not add class, major, or cohort lines to the cover. A blank liner page separates the two covers. `\makeoutercover` and `\makeinnercover` place every element at absolute coordinates measured from the rule file's Mẫu 1 and Mẫu 2. The outer cover also draws the spine (gáy) with student names, the specialization, the 2022 – 2026 cohort, and "TP. HCM". Do not include the rule file's annotations ("(Bold, size 36)", the yellow "Gáy" label, or "Mẫu n") in the report. After any cover change, overlay the rendered page on the rule PDF page to check alignment.
- **Order:** covers → PHÊ DUYỆT, GIAO NHIỆM VỤ ĐỀ TÀI → LỜI CẢM ƠN → LỜI CAM ĐOAN → MỤC LỤC → DANH MỤC CÁC KÝ HIỆU VÀ CHỮ VIẾT TẮT → DANH MỤC CÁC BẢNG, SƠ ĐỒ, HÌNH VẼ (one combined list) → MỞ ĐẦU → BẢNG PHÂN CÔNG NHIỆM VỤ NHÓM THỰC HIỆN → CHƯƠNG 1..N → KẾT LUẬN, KIẾN NGHỊ (unnumbered, not a chapter) → DANH MỤC TÀI LIỆU THAM KHẢO → PHỤ LỤC (if any).
- **Phê duyệt, giao nhiệm vụ:** Vietnamese administrative header with the national motto, task fields (topic, advisor, specialization, student table, tasks, deliverables), and three signature columns (Trưởng khoa phê duyệt / Giáo viên hướng dẫn / Đại diện nhóm sinh viên), each with about 2.6 cm of blank space to sign. The user set all document and signing dates to 24/10/2026 through `\signdate`. Test-evidence dates stay as recorded.
- **Lời cảm ơn / Lời cam đoan (Mẫu 3–4):** titles bold 14 pt and centered; the declaration uses the rule's wording; the signature block reads `TPHCM, ngày …… tháng …… năm …….` (italic), `ĐẠI DIỆN NHÓM SINH VIÊN` (bold), `(Ký và ghi rõ họ tên)` (italic).
- **Mục lục (Mẫu 5):** a "Trang" header, chapter entries as `CHƯƠNG n: TÊN CHƯƠNG` in bold uppercase with dot leaders, and all entries in 12 pt.
- **Abbreviations (Mẫu 6):** alphabetical, two columns `ABBR: English expansion` | Vietnamese meaning, no grid. Expand every abbreviation in parentheses at its first use in the body, and only there; keep the list in sync with the body.
- **List of tables, diagrams, and figures (Mẫu 7):** a single centered 14 pt bold title with a "Trang" header; entries labeled `BẢNG n.m`, `SƠ ĐỒ n.m`, `HÌNH n.m` at 13 pt, generated by LaTeX.
- **Chapters (Mẫu 9):** `CHƯƠNG n: TÊN` bold, uppercase, 14 pt, **centered**. Sections and subsections bold 13 pt, numbered 1.1, 1.1.1. The header shows "Đồ án tốt nghiệp Đại học" on the left and the chapter number and name on the right. The footer shows the student names and class on the left and the page number on the right.
- **Tables:** full grid (vertical and horizontal rules between all cells, `|` columns + `\hline` after every row; no booktabs), caption above the table.
- **Figures and diagrams:** caption below. Draw diagrams as real TikZ diagrams (flowchart or architecture), not boxed text. Diagram 3.1 is "Luồng xử lý SOS". Chapter 3 then holds the analysis models the advisor required on 2026-10-24: use case diagrams (3.2–3.3), use case specification tables for UC-01/02/03/12/13, sequence diagrams (3.4–3.6), and state diagrams for missions and distributions (3.7–3.8); "Kiến trúc hệ thống" follows them. Keep these states and transitions in sync with `docs/backend` and the plan (Section 8.2, distribution CHECKs).
- **Advisor feedback (2026-10-24):** use "giảng viên" (not "giáo viên") everywhere except the cover wording fixed by Mẫu 1/2; keep Section 2.3 (similar systems with pros/cons), Section on legal basis (Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15, Luật Phòng, chống thiên tai 33/2013/QH13 amended by 60/2020/QH14), and the "Tính đóng góp" paragraph in Mở đầu. Report-only edits: do not change application code to fix report content.
- **Prose style:** do not write sentences that only narrate a table or figure (for example "Bảng 4.1 tóm tắt…", "Các hình dưới đây trình bày…") or phrases like "theo mô hình dữ liệu vật lý hiện tại". State the facts directly.
- **References (Mẫu 10):** title "DANH MỤC TÀI LIỆU THAM KHẢO"; group as "Tiếng Việt:", "Tiếng Anh:", "Danh mục các Website tham khảo:" (only the groups that have entries); sort alphabetically by author; number as `1.`, `2.`; do **not** add "truy cập ngày …" dates. The user also chose not to put in-text citation markers such as `[11, 3]` in the body, so do not use `\cite`.
- **Mở đầu (Mẫu 8):** cover reason, objectives, research status, scope and method, and report structure.

## Build


From this directory, run `xelatex -interaction=nonstopmode -halt-on-error main.tex` twice. Keep all source images under `images/`; replace bracketed placeholders only with verified project information.

For the current workstation, the missing TeX packages and XeLaTeX format are in a persistent user tree (it was moved out of `/tmp` because a reboot wiped it). Prefix both commands with `TEXMFHOME=~/.local/share/c48-tex/texmf TEXMFVAR=~/.local/share/c48-tex/texmf-var TEXMFCONFIG=~/.local/share/c48-tex/texmf-config`; rebuild the TeX setup if `~/.local/share/c48-tex/texmf` is removed.

If the tree is ever lost, rebuild it: run `tlmgr --usermode --usertree ~/.local/share/c48-tex/texmf init-usertree`, set the repository to `https://mirror.ctan.org/systems/texlive/tlnet`, and install `latex latex-fonts l3kernel l3backend l3packages fontspec unicode-math geometry graphics graphics-cfg graphics-def tools setspace ragged2e titlesec fancyhdr caption float newfloat url booktabs tocloft pgf xcolor hyperref etoolbox ms everysel firstaid lm babel cm hyphen-base latexconfig iftex euenc kvoptions kvsetkeys ltxcmds hyph-utf8 hyphen-english tex-ini-files`. Reduce `~/.local/share/c48-tex/texmf/tex/generic/config/language.dat` to the English entries, then run `xetex -ini -etex -jobname=xelatex -progname=xelatex xelatex.ini` inside `~/.local/share/c48-tex/texmf-var/web2c/xetex` with the same environment variables. TeX `--` ligatures do not apply with this setup, so type en dashes (`–`) directly in report text.

The workspace settings in `.vscode/settings.json` configure LaTeX Workshop to build twice with XeLaTeX on save and show its internal PDF preview. Their `env` block points to the same tree; without it, VS Code builds fail silently and the preview stays stale.
