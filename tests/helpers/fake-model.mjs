// A scripted chat model for engine tests: decides its reply from the conversation, supports tools and streaming.
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';

let ids = 0;
export const call = (name, args = {}) => ({ id: `call-${++ids}`, name, args });
const lastOf = messages => { const m = messages.at(-1), c = m?.content; return { type: m?._getType?.() || m?.type, text: typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => typeof p === 'string' ? p : p?.text || '').join('') : JSON.stringify(c ?? ''), name: m?.name, message: m }; };

export class ScriptedModel extends BaseChatModel {
  // script(context) → { text?, calls? } where context = { messages, last, turn, system }
  constructor(name, script, { meter = null } = {}) { super({}); this.label = name; this.script = script; this.meter = meter; this.turns = 0; this.seen = []; }
  _llmType() { return 'scripted'; }
  bindTools() { return this; }
  reply(messages) {
    this.turns++;
    const system = messages.find(m => (m._getType?.() || m.type) === 'system');
    const text = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => typeof part === 'string' ? part : part?.text || '').join('') : String(content ?? '');
    const context = { messages, last: lastOf(messages), turn: this.turns, system: messages.filter(m => (m._getType?.() || m.type) === 'system').map(m => text(m.content)).join('\n') };
    this.seen.push(context);
    const out = this.script(context) || {};
    return { text: out.text || '', calls: out.calls || [], wait: out.wait };
  }
  async pause(wait) {
    if (!wait) return;
    this.meter?.start?.(this.label);
    try { await (typeof wait === 'number' ? new Promise(r => setTimeout(r, wait)) : wait); } finally { this.meter?.end?.(this.label); }
  }
  async _generate(messages) {
    const { text, calls, wait } = this.reply(messages); await this.pause(wait);
    const message = new AIMessage({ content: text, tool_calls: calls });
    return { generations: [{ text, message }] };
  }
  async *_streamResponseChunks(messages) {
    const { text, calls, wait } = this.reply(messages); await this.pause(wait);
    const pieces = text ? text.match(/.{1,40}/gs) : [];
    for (const piece of pieces) yield new ChatGenerationChunk({ text: piece, message: new AIMessageChunk({ content: piece }) });
    if (calls.length) yield new ChatGenerationChunk({ text: '', message: new AIMessageChunk({ content: '', tool_call_chunks: calls.map((c, index) => ({ id: c.id, name: c.name, args: JSON.stringify(c.args), index })) }) });
    if (!pieces.length && !calls.length) yield new ChatGenerationChunk({ text: '', message: new AIMessageChunk({ content: '' }) });
  }
}
