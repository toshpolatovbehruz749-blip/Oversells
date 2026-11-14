#!/usr/bin/env python3
"""Fills the empty [captions] of babel's Uzbek locale files (uz-Latn, uz-Cyrl).

TeX Live's babel-uz-Latn.ini and babel-uz-Cyrl.ini leave every caption empty,
so \\contentsname, \\figurename, \\indexname ... come out as "?contents?" and
similar. Run at compiler image build: python3 captions.py
"""
import subprocess
from pathlib import Path

CAPTIONS = {
    "uz-Latn": {
        "preface": "Soʻzboshi", "ref": "Adabiyotlar", "abstract": "Annotatsiya", "bib": "Foydalanilgan adabiyotlar",
        "chapter": "Bob", "appendix": "Ilova", "contents": "Mundarija", "listfigure": "Rasmlar roʻyxati",
        "listtable": "Jadvallar roʻyxati", "index": "Koʻrsatkich", "figure": "Rasm", "table": "Jadval", "part": "Qism",
        "encl": "Ilova", "cc": "Nusxa", "headto": "Kimga", "page": "bet", "see": "qarang", "also": "shuningdek qarang",
        "proof": "Isbot", "glossary": "Atamalar lugʻati",
    },
    "uz-Cyrl": {
        "preface": "Сўзбоши", "ref": "Адабиётлар", "abstract": "Аннотация", "bib": "Фойдаланилган адабиётлар",
        "chapter": "Боб", "appendix": "Илова", "contents": "Мундарижа", "listfigure": "Расмлар рўйхати",
        "listtable": "Жадваллар рўйхати", "index": "Кўрсаткич", "figure": "Расм", "table": "Жадвал", "part": "Қисм",
        "encl": "Илова", "cc": "Нусха", "headto": "Кимга", "page": "бет", "see": "қаранг", "also": "шунингдек қаранг",
        "proof": "Исбот", "glossary": "Атамалар луғати",
    },
}


def main() -> None:
    for locale, captions in CAPTIONS.items():
        path = Path(subprocess.check_output(["kpsewhich", f"babel-{locale}.ini"], text=True).strip())
        lines = path.read_text(encoding="utf-8").split("\n")
        section = None
        for i, line in enumerate(lines):
            if line.startswith("["):
                section = line.strip()
                continue
            if section == "[captions]" and "=" in line:
                key, value = (part.strip() for part in line.split("=", 1))
                if not value and key in captions:
                    lines[i] = f"{key} = {captions[key]}"
        path.write_text("\n".join(lines), encoding="utf-8")
        print(f"{path}: captions filled")


if __name__ == "__main__":
    main()
