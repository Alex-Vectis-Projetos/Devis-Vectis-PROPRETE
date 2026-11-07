"""Helpers for deploy/setup-server.sh. They only read the vhost and write to the paths given; they never edit it in place.

  nginx-insert.py <vhost-in> <vhost-out> <domain> <include-path>
      Inserts the include line in the HTTPS server block of the Devis VECTIS vhost, and nothing else.
      exit codes: 0 inserted, 10 already present (active line, comments ignored), 3 refused (block shared with
      other names), 4 HTTPS block not found

  nginx-insert.py headers <vhost-in> <domain> <template> <out>
      Writes <out> = the add_header lines of <template> whose header is NOT already set at server level in that
      vhost block (or in the files it includes, ours excepted), so no security header is ever sent twice.
      The skipped header names are printed on stderr. exit codes: 0 ok, 3/4 as above
"""
import glob
import re
import sys


def strip_comments(text):
    # Same length as the original, so offsets still match the original text.
    return re.sub(r"(?m)#.*$", lambda m: " " * len(m.group(0)), text)


def find_block(code, domain):
    """Returns (start, end) of the HTTPS server block whose server_name is exactly the domain."""
    for m in re.finditer(r"\bserver\s*\{", code):
        start = m.end()
        depth, j = 1, start
        while depth and j < len(code):
            depth += {"{": 1, "}": -1}.get(code[j], 0)
            j += 1
        block = code[start:j]
        names = re.search(r"server_name\s+([^;]+);", block)
        if not names or domain not in names.group(1).split():
            continue
        if not re.search(r"listen\s+[^;]*\b443\b", block):
            continue
        if set(names.group(1).split()) != {domain}:
            sys.stderr.write("server_name shared with other names (%s): refusing to touch this block\n" % names.group(1).strip())
            sys.exit(3)
        return start, j
    sys.stderr.write("HTTPS server block for %s not found\n" % domain)
    sys.exit(4)


def top_level(text):
    """Directives at depth 1 only: nested blocks (location, if...) are blanked out."""
    out, depth = [], 0
    for ch in text:
        if ch == "{":
            depth += 1
            out.append(" ")
        elif ch == "}":
            depth -= 1
            out.append(" ")
        else:
            out.append(ch if depth == 0 else (" " if ch != "\n" else "\n"))
    return "".join(out)


def insert(src_path, out_path, domain, include):
    src = open(src_path).read()
    code = strip_comments(src)
    # Only an ACTIVE include counts as "already present": a commented-out line does not.
    if re.search(r"(?m)^\s*include\s+%s\s*;" % re.escape(include), code):
        open(out_path, "w").write(src)
        sys.exit(10)
    start, _ = find_block(code, domain)
    open(out_path, "w").write(src[:start] + "\n    include %s;\n" % include + src[start:])
    sys.exit(0)


def existing_headers(vhost_path, domain):
    code = strip_comments(open(vhost_path).read())
    start, end = find_block(code, domain)
    block = top_level(code[start:end])
    found = {m.group(1).lower() for m in re.finditer(r"\badd_header\s+([A-Za-z0-9-]+)\s", block)}
    for inc in re.findall(r"\binclude\s+([^;\s]+)\s*;", block):
        if "devis-vectis" in inc:
            continue  # our own snippets are not "somebody else's header"
        for path in glob.glob(inc):
            try:
                body = top_level(strip_comments(open(path).read()))
            except OSError:
                continue
            found |= {m.group(1).lower() for m in re.finditer(r"\badd_header\s+([A-Za-z0-9-]+)\s", body)}
    return found


def headers(vhost_path, domain, template, out_path):
    present = existing_headers(vhost_path, domain)
    kept, skipped = [], []
    for line in open(template).read().splitlines():
        m = re.match(r"\s*add_header\s+([A-Za-z0-9-]+)\s", line)
        if m and m.group(1).lower() in present:
            skipped.append(m.group(1))
            kept.append("# (déjà défini ailleurs dans ce vhost, non répété) " + line.strip().split(" ")[1])
        else:
            kept.append(line)
    open(out_path, "w").write("\n".join(kept) + "\n")
    if skipped:
        sys.stderr.write("security headers already set by the vhost, not repeated: %s\n" % ", ".join(skipped))
    sys.exit(0)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "headers":
        headers(*sys.argv[2:6])
    else:
        insert(*sys.argv[1:5])
