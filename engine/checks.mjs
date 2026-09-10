// Deterministic checks that must pass on a final deliverable, and review coverage of every criterion.
const clean = value => String(value ?? '').trim();
export function checkOutput(output, checks = []) {
  const text = String(output || '');
  return checks.map(check => ({ ...check, passed: check.type === 'contains' ? text.toLowerCase().includes(String(check.value).toLowerCase())
    : check.type === 'not_contains' ? !text.toLowerCase().includes(String(check.value).toLowerCase())
    : check.type === 'min_length' ? text.length >= check.value : text.length <= check.value,
    evidence: check.type.includes('length') ? `${text.length} characters` : `Checked the final deliverable for “${check.value}”.` }));
}
// Every criterion must appear exactly once, marked passed, with evidence.
export function coveredCriteria(count, criteria) {
  const list = Array.isArray(criteria) ? criteria : [], missing = [];
  for (let i = 1; i <= count; i++) {
    const id = `criterion-${i}`, matches = list.filter(c => c && c.id === id);
    if (matches.length !== 1 || matches[0].passed !== true || !clean(matches[0].evidence)) missing.push(id);
  }
  return { ok: !missing.length, missing };
}
