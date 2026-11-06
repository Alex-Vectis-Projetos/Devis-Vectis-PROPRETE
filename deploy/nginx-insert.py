"""Inserts the include line in the HTTPS server block of the Devis VECTIS vhost, and nothing else.

usage: nginx-insert.py <vhost-in> <vhost-out> <domain> <include-path>
exit codes: 0 inserted, 10 already present, 3 refused (block shared with other names), 4 HTTPS block not found
"""
import re
import sys

src_path, out_path, domain, include = sys.argv[1:5]
src = open(src_path).read()
line = "    include %s;\n" % include

# Comments must not be mistaken for configuration (same length, so offsets still match the original text).
code = re.sub(r"(?m)#.*$", lambda m: " " * len(m.group(0)), src)

# Only an ACTIVE include counts as "already present": a commented-out line does not.
if re.search(r"(?m)^\s*include\s+%s\s*;" % re.escape(include), code):
    open(out_path, "w").write(src)
    sys.exit(10)

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
    open(out_path, "w").write(src[:start] + "\n" + line + src[start:])
    sys.exit(0)

sys.stderr.write("HTTPS server block for %s not found\n" % domain)
sys.exit(4)
