#!/usr/bin/env python3
"""Seed multi-language experiment code templates into the database."""
import subprocess, sys, json

# Map experiment name -> { language -> (starter_code, reference_solution) }
TEMPLATES = {}

def add(exp_name, lang, starter, reference):
    if exp_name not in TEMPLATES:
        TEMPLATES[exp_name] = {}
    TEMPLATES[exp_name][lang] = (starter, reference)

# Helper to get experiment id by name
def get_exp_id(name):
    sql = f"SELECT id FROM experiments WHERE name='{name}'"
    r = subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-t','-A','-c',sql],
                       capture_output=True, text=True)
    return r.stdout.strip()

def upsert(exp_name, lang, starter, reference):
    exp_id = get_exp_id(exp_name)
    if not exp_id:
        print(f'  SKIP {exp_name}: not found')
        return
    # Use parameterized query via psql with escaped strings
    def esc(s):
        if s is None: return 'NULL'
        return "'" + s.replace("'", "''") + "'"
    sql = f"""INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published, updated_at)
VALUES ('{exp_id}', '{lang}', {esc(starter)}, {esc(reference)}, true, NOW())
ON CONFLICT (experiment_id, language) DO UPDATE SET starter_code=EXCLUDED.starter_code, reference_solution=EXCLUDED.reference_solution, updated_at=NOW();"""
    r = subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-c',sql],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f'  ERROR {exp_name}/{lang}: {r.stderr.strip()}')
    else:
        print(f'  OK {exp_name}/{lang}')

def run():
    total = 0
    for exp_name, langs in TEMPLATES.items():
        for lang, (starter, ref) in langs.items():
            upsert(exp_name, lang, starter, ref)
            total += 1
    print(f'\nDone: {total} templates inserted')

if __name__ == '__main__':
    run()
