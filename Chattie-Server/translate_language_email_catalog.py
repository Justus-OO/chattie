import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

locales = {"es":"es","fr":"fr","de":"de","pt":"pt","ja":"ja","sw":"sw","hi":"hi","zh-CN":"zh-CN"}
english = json.loads(Path("locales/en.json").read_text(encoding="utf-8"))
protected_re = re.compile(r"(\{\{[^}]+\}\}|<[^>]+>|&lt;|&gt;|&quot;|KES)")

def protect(text):
    parts = []
    def repl(match):
        i = len(parts)
        parts.append(match.group(0))
        return " ZZXCP{}ZZ ".format(i)
    return protected_re.sub(repl, text), parts

def restore(text, parts):
    for i, value in enumerate(parts):
        text = re.sub(r"\s*ZZXCP{}ZZ\s*".format(i), lambda _m, v=value: v, text)
    return text

def translate(text, language):
    protected, parts = protect(text)
    params = urllib.parse.urlencode({"client":"dict-chrome-ex","sl":"en","tl":language,"q":protected})
    url = "https://clients5.google.com/translate_a/t?" + params
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as response:
                data = json.loads(response.read().decode("utf-8"))
            return restore(data[0], parts)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(1 + attempt)

for filename, language in locales.items():
    path = Path("locales") / (filename + ".json")
    catalog = json.loads(path.read_text(encoding="utf-8"))
    missing = [key for key, value in english.items() if key not in catalog or not str(catalog[key]).strip()]
    print(filename, "missing", len(missing), flush=True)
    for i, key in enumerate(missing, 1):
        catalog[key] = translate(english[key], language)
        if i % 25 == 0:
            print(filename, i, "/", len(missing), flush=True)
        time.sleep(0.05)
    catalog = {key: catalog[key] for key in english}
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
