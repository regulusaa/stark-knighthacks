// Only the contract parses or formats Steer programs. User text is never executed.
let parser;
export async function loadDsl() {
  if (!parser) parser = import('/contract/steer-dsl.js').catch(() => null);
  return parser;
}
export async function checkSyntax(code) {
  const dsl = await loadDsl();
  return dsl ? dsl.parse(code) : { ok: null, message: 'Syntax check available after sync' };
}
