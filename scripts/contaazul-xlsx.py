"""Read Conta Azul's OOXML exports (named .xls) without evaluating formulas.

Some exports have ZIP padding rejected by the JS streaming unzipper. Python's
ZIP central-directory reader handles that format. Only local files are read.
"""
import hashlib
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_book(filename):
    data = Path(filename).read_bytes()
    with zipfile.ZipFile(filename) as book:
        if sum(i.file_size for i in book.infolist()) > 50_000_000:
            raise ValueError("Exportação excede o limite de leitura")
        strings = []
        if "xl/sharedStrings.xml" in book.namelist():
            strings = ["".join(t.text or "" for t in si.findall(".//s:t", NS))
                       for si in ET.fromstring(book.read("xl/sharedStrings.xml")).findall("s:si", NS)]
        rows = []
        for row in ET.fromstring(book.read("xl/worksheets/sheet1.xml")).findall("s:sheetData/s:row", NS):
            values = {"row": int(row.attrib["r"])}
            for cell in row.findall("s:c", NS):
                if cell.find("s:f", NS) is not None:
                    raise ValueError("Fórmula inesperada no export original")
                col = "".join(c for c in cell.attrib["r"] if c.isalpha())
                value = cell.find("s:v", NS)
                text = value.text if value is not None and value.text else ""
                if cell.attrib.get("t") == "s":
                    text = strings[int(text)]
                elif cell.attrib.get("t") == "inlineStr":
                    text = "".join(t.text or "" for t in cell.findall(".//s:t", NS))
                values[col] = text
            rows.append(values)
    return {"filename": Path(filename).name, "sha256": hashlib.sha256(data).hexdigest(), "rows": rows}


if __name__ == "__main__":
    print(json.dumps([read_book(path) for path in sys.argv[1:]], ensure_ascii=False))
