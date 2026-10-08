#!/usr/bin/env python3
"""Record bounded audit execution and input/output provenance; not a correctness proof."""
from pathlib import Path
import datetime
import hashlib
import json
import platform
import subprocess
import time

root = Path(__file__).resolve().parent.parent
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

inputs = sorted((root / 'src/lib').glob('*.ts')) + [
    root / name for name in ['package-lock.json', 'audit/reproduce.mjs',
    'audit/resolve-ts.mjs', 'audit/make-fixtures.py', 'audit/run-audit.py',
    'audit/tag-in-string-117.dta', 'audit/tag-in-string-118.dta',
    'audit/tag-in-string-119.dta', 'audit/strl.dta']
]
before = {str(p.relative_to(root)): digest(p) for p in inputs}
command = ['node', '--experimental-strip-types', '--import', './audit/resolve-ts.mjs', 'audit/reproduce.mjs']
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
clock = time.monotonic()
with (root / 'audit/reproductions.log').open('w') as stream:
    run = subprocess.run(command, cwd=root, stdout=stream, stderr=subprocess.STDOUT, timeout=60)
elapsed = time.monotonic() - clock
after = {str(p.relative_to(root)): digest(p) for p in inputs}
result = json.loads((root / 'audit/reproductions.json').read_text()) if run.returncode == 0 else {}
manifest = {
    'schema_version': 1,
    'claim_id': 'hengce-bounded-software-and-numerical-review-2026-10-08',
    'repository': {'commit': 'unavailable', 'dirty': True,
        'archive_sha256': json.loads((root / 'audit/inventory-summary.json').read_text())['archive_sha256'],
        'note': 'Uploaded archive, no repository revision. Added audit artifacts and generated runtime files; original business source unchanged.'},
    'command': command,
    'environment': {'software': [
        {'name': 'node', 'version': subprocess.check_output(['node', '--version'], text=True).strip()},
        {'name': 'npm', 'version': subprocess.check_output(['npm', '--version'], text=True).strip()},
        {'name': 'python', 'version': platform.python_version()},
        {'name': 'typescript', 'version': json.loads((root / 'node_modules/typescript/package.json').read_text())['version']}
    ], 'hardware': platform.platform(), 'fixture_generator': 'pandas 2.2.3; fixtures already included'},
    'mathematics': {
        'assertion_tested': 'Bounded counterexamples for value preservation, method invariance, AHP direction, eigenpair residual, unnormalized gamma=1 Varimax objective, singular pruning and state validation.',
        'coefficient_domain': 'JavaScript IEEE-754 binary64; finite synthetic real inputs, no exact symbolic arithmetic.',
        'conventions': 'Eigenvectors stored as rows; Rv=lambda*v residual Euclidean norm; seeded Gram-normalized PSD matrices; TOPSIS complete-data missing-policy invariance; Varimax angular grid is comparison, not an exact optimum proof.',
        'inputs': [{'path': name, 'sha256_before': before[name], 'sha256_after': after[name]} for name in before],
        'bounds': {'eigen_dimensions': [12, 24, 60, 80], 'dense_gram_samples': 50,
            'eigen_reference_rotations': 16000, 'varimax_grid_points': 20001,
            'wide_screen_columns': 49, 'largest_topsis_rows': 150000,
            'stata_versions': [117, 118, 119], 'case_count': len(result.get('cases', []))},
        'non_claims': ['No proof of correctness for all inputs.', 'No population inference, full statistical validation, real deployment, security exploitation or WCAG certification.', 'The 16000-rotation comparison uses the same implementation; residual invariants provide the independent check.', 'This runner records cases rather than asserting every expected value; zero exit status means execution completed.']
    },
    'randomness': {'used': True, 'generator': 'src/lib/prng.ts mulberry32 + gauss', 'seed': 1949,
        'stream': 'Single stream continued over dimensions 12, 24, 60, 80 in that order.'},
    'run': {'started_at': started, 'runtime_seconds': elapsed, 'exit_status': run.returncode,
        'subprocess_timeout_seconds': 60},
    'outputs': [{'path': name, 'sha256': digest(root / name)} for name in ['audit/reproductions.json', 'audit/reproductions.log']],
    'checks': [{'name': 'input_hashes_unchanged_during_execution', 'passed': before == after},
        {'name': 'case_count', 'observed': len(result.get('cases', []))}],
    'result': 'Finite audit cases recorded; see report for counterexamples and evidence classification.',
    'residual_risks': ['Legacy v1 does not enforce resource limits or verify declared input hashes; this runner manually compares them.', 'No original Git commit available; archive SHA-256 identifies supplied contents.', 'Node 24 tested; Node 22 not independently verified.', 'Large-array failure depends on runtime stack/argument limits.', 'Uncovered data formats, sizes and methods remain unverified.']
}
(root / 'audit/computation-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'exit_status': run.returncode, 'runtime_seconds': elapsed, 'case_count': len(result.get('cases', [])), 'inputs_unchanged': before == after}, ensure_ascii=False))
raise SystemExit(run.returncode)
