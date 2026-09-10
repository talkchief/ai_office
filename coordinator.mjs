// Only owner messages establish follow-up intent; old model replies are not evidence.
export function delegationBrief(text, history = []) {
  const current = String(text).trim();
  const messages = (Array.isArray(history) ? history : []).filter(m => m?.who === 'user' && typeof m.text === 'string').slice(-8).map(m => m.text.trim());
  if (messages.at(-1) === current) messages.pop();
  const context = messages.join('\n\n').slice(-8000);
  return (context ? `Previous requests from the owner (context for follow-ups):\n${context}\n\nCurrent request: ${current}` : current).slice(0,12000);
}
export function coordinatorGreeting(team, agents) {
  return `I coordinate ${team.name}. My current specialists are ${agents.filter(a => a.department === team.id && a.id !== team.lead).map(a => `${a.name} (${a.does || a.role})`).join('; ')}. Send a request and I’ll plan the work, delegate to a qualified specialist, and verify the result.`;
}
