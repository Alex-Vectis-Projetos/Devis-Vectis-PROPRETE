#!/usr/bin/env python3
"""Static guarantees about the GitHub workflows (what can be verified without running them on GitHub)."""
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WF = ROOT / ".github" / "workflows"
passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
        print("ok -", name)
    else:
        failed += 1
        print("not ok -", name)


def load(name):
    return yaml.safe_load((WF / name).read_text())


def on_of(doc):
    # PyYAML parses the key `on` as boolean True
    return doc.get("on", doc.get(True))


deploy, ci, verify = load("deploy.yml"), load("ci.yml"), load("verify-ci-chain.yml")
deploy_text = re.sub(r"(?m)^\s*#.*$", "", (WF / "deploy.yml").read_text())  # comments are not commands

# --- deploy.yml : tests obligatoires avant tout déploiement ---
jobs = deploy["jobs"]
check("deploy.yml : job `test` = appel réutilisable de ci.yml", jobs["test"].get("uses") == "./.github/workflows/ci.yml")
check("deploy.yml : le fichier appelé existe", (ROOT / ".github/workflows/ci.yml").is_file())
need = jobs["deploy"].get("needs")
check("deploy.yml : `deploy` dépend de `test`", need == "test" or need == ["test"])
check("deploy.yml : aucun `if` sur le job deploy (pas de contournement de needs)", "if" not in jobs["deploy"])
check("deploy.yml : aucun continue-on-error nulle part", "continue-on-error" not in deploy_text)
ifs = [(sname, st["if"]) for st in [s for j in jobs.values() for s in j.get("steps", [])] for sname in [st.get("name")] if "if" in st]
check("deploy.yml : seul le nettoyage de la clé SSH utilise `if: always()`", ifs == [("Remove SSH key", "always()")])
check("deploy.yml : déclenché uniquement par un push sur main", on_of(deploy) == {"push": {"branches": ["main"]}})
check("deploy.yml : permissions en lecture seule", deploy.get("permissions") == {"contents": "read"})
check("deploy.yml : un seul déploiement à la fois (concurrency)", deploy.get("concurrency", {}).get("group") == "devis-vectis-production")
check("deploy.yml : aucun sudo, aucune commande root", not re.search(r"\bsudo\b|ssh [^\n]*root@", deploy_text))
ssh_calls = re.findall(r"ssh -i [^\n]*", deploy_text)
check("deploy.yml : chaque appel ssh impose StrictHostKeyChecking=yes", len(ssh_calls) == 2 and deploy_text.count("StrictHostKeyChecking=yes") == deploy_text.count("ssh -i"))
check("deploy.yml : seules commandes distantes = git pull --ff-only et post-deploy.sh",
      sorted(re.findall(r"^\s+'([^']+)'$", deploy_text, re.M)) == sorted(["cd /opt/devis-vectis && git pull --ff-only origin main", "bash /opt/devis-vectis/deploy/post-deploy.sh"]))
check("deploy.yml : la clé SSH est supprimée même en cas d'échec", "rm -f ~/.ssh/deploy_key" in deploy_text)

# --- ci.yml : lecture seule, appelable, sans secret ---
ci_text = re.sub(r"(?m)^\s*#.*$", "", (WF / "ci.yml").read_text())
ci_on = on_of(ci)
check("ci.yml : appelable (workflow_call)", "workflow_call" in ci_on)
check("ci.yml : permissions en lecture seule, aucune écriture", ci.get("permissions") == {"contents": "read"} and "write" not in ci_text.replace("write-all", "").split("permissions:")[1].split("jobs:")[0])
check("ci.yml : aucun secret utilisé", "secrets." not in ci_text)
check("ci.yml : ne s'exécute pas sur main en propre (évite le doublon avec deploy.yml)", ci_on["push"]["branches-ignore"] == ["main"])
check("ci.yml : n'écrit pas dans le dépôt (pas de git push/commit)", not re.search(r"git (push|commit)", ci_text))
check("ci.yml : l'échec simulé n'est actif que via l'entrée force_fail (défaut false)", ci_on["workflow_call"]["inputs"]["force_fail"]["default"] is False)
check("ci.yml : npm ci strict (lockfile commité)", "npm ci --no-audit --no-fund" in ci_text and "npm install" not in ci_text)

# --- verify-ci-chain.yml : aucune capacité de déploiement ---
v_text = re.sub(r"(?m)^\s*#.*$", "", (WF / "verify-ci-chain.yml").read_text())
check("verify : appelle ci.yml comme deploy.yml", verify["jobs"]["test"].get("uses") == "./.github/workflows/ci.yml")
check("verify : le déploiement simulé dépend de test", verify["jobs"]["deploy-sim"].get("needs") == "test")
check("verify : aucun secret, aucun SSH, aucun sudo", not re.search(r"secrets\.|\bssh\b|\bsudo\b|VPS_", v_text))
check("verify : permissions en lecture seule", verify.get("permissions") == {"contents": "read"})
check("verify : jamais déclenché par main", on_of(verify)["push"]["branches-ignore"] == ["main"])

# --- tous les workflows ---
all_text = "".join(re.sub(r"(?m)^\s*#.*$", "", p.read_text()) for p in WF.glob("*.yml"))
check("aucune écriture de contenu accordée (contents: write)", "contents: write" not in all_text)
check("aucun déclencheur pull_request_target / workflow_run (pas d'exécution de code non fiable avec secrets)", not re.search(r"pull_request_target|workflow_run", all_text))
secret_uses = {p.name for p in WF.glob("*.yml") if "secrets." in re.sub(r"(?m)^\s*#.*$", "", p.read_text())}
check("les secrets ne sont référencés que par deploy.yml", secret_uses == {"deploy.yml"})

print("# pass", passed)
print("# fail", failed)
sys.exit(1 if failed else 0)
