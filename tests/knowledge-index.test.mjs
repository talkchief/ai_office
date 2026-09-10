import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeStore } from '../knowledge.mjs';
import { KnowledgeIndex, chunk, terms } from '../knowledge-index.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-index-'));
const TOPICS = [
  ['Company/refunds.md', 'Refund policy', 'Refunds are paid within fourteen days when a sailing is cancelled by the operator.', ['refund cancelled sailing', 'fourteen days refund']],
  ['Company/prices.md', 'Ticket prices', 'Adult harbour tickets cost 45 euros and children under twelve travel free on weekdays.', ['adult ticket euros', 'children travel free']],
  ['Projects/sunset.md', 'Sunset cruise launch', 'The sunset cruise launches in October with a paid social campaign.', ['sunset cruise october', 'social campaign launch']],
  ['Company/fleet.md', 'Fleet', 'Our fleet has three catamarans named Aurora, Borealis and Celeste.', ['catamarans aurora']],
  ['Company/safety.md', 'Safety drills', 'Crew run a lifejacket drill before every departure and log it in the safety book.', ['lifejacket drill departure', 'safety book log']],
  ['Status/q3-revenue.md', 'Q3 revenue', 'Third quarter revenue reached 1.2 million, driven by private charters.', ['third quarter revenue', 'private charters revenue']],
  ['Company/charters.md', 'Private charters', 'Private charters seat up to forty guests and include a skipper and catering.', ['charter forty guests skipper']],
  ['Company/catering.md', 'Catering partner', 'Catering is supplied by Salt and Lemon, who need seventy two hours notice.', ['catering salt lemon', 'seventy two hours notice']],
  ['Company/weather.md', 'Weather policy', 'Sailings are cancelled when wind exceeds thirty knots at the harbour mouth.', ['wind thirty knots']],
  ['Departments/sales.md', 'Sales playbook', 'Sales reps follow up every quote within two working days with a call.', ['quote follow up call']],
  ['Departments/marketing.md', 'Brand voice', 'The brand voice is warm, local and never uses exclamation marks.', ['brand voice exclamation', 'warm local voice']],
  ['Company/accessibility.md', 'Accessibility', 'Wheelchair users board by the ramp on pier four with a crew escort.', ['wheelchair ramp pier', 'crew escort boarding']],
  ['Company/loyalty.md', 'Loyalty scheme', 'The loyalty card gives a free trip after nine paid trips in one year.', ['loyalty card free trip', 'nine paid trips']],
  ['Projects/website.md', 'Website redesign', 'The website redesign moves booking to a single page checkout in November.', ['website redesign checkout', 'single page booking']],
  ['Company/insurance.md', 'Insurance', 'Passenger liability insurance is renewed every March with Harbour Mutual.', ['liability insurance march']],
  ['Company/staff.md', 'Staff rota', 'The staff rota is published every Thursday for the following fortnight.', ['staff rota thursday', 'fortnight rota']],
  ['Company/suppliers.md', 'Fuel supplier', 'Marine diesel comes from Northern Fuels with a monthly invoice.', ['marine diesel fuel', 'northern fuels invoice']],
  ['Status/complaints.md', 'Complaints log', 'Most complaints in August concerned queues at the ticket kiosk.', ['complaints august queues', 'ticket kiosk queues']],
  ['Company/gift.md', 'Gift vouchers', 'Gift vouchers are valid for eighteen months from the date of purchase.', ['gift voucher eighteen months']],
  ['Projects/events.md', 'Wedding events', 'Wedding events on board need a licence from the city council.', ['wedding licence council', 'wedding events on board']],
];

for (const backend of ['zvec', 'sqlite']) {
  test(`${backend}: notes are searchable, replaced, removed and caught up after edits outside the office`, async () => {
    const dir = temp(), store = new KnowledgeStore(path.join(dir, 'brain')), index = await new KnowledgeIndex({ dir: path.join(dir, 'index'), store, backend }).open();
    index.attach();
    try {
      assert.equal(index.kind, backend);
      for (const [id, title, text] of TOPICS) await store.writeNote(id, `# ${title}\n\n${text}\n`);
      let hits = 0, total = 0;
      for (const [id, , , queries] of TOPICS) for (const q of queries) { total++; if (index.search(q, { k: 3 }).some(h => h.path === id)) hits++; }
      assert.ok(total >= 30); assert.ok(hits / total >= 0.9, `top-3 hit rate ${hits}/${total}`);
      assert.deepEqual(index.search('launch campaign', { folder: 'Projects' }).map(h => h.path).slice(0, 1), ['Projects/sunset.md']);
      assert.doesNotThrow(() => index.search('budget: 5k (campaign) "quote'));
      const hit = index.search('catamarans')[0]; assert.equal(hit.heading, 'Fleet'); assert.match(hit.snippet, /Aurora/);
      await store.upload({ folder: 'Company', name: 'fleet.md', content: 'We now run two ferries.' });
      assert.equal(index.search('catamarans').length, 0); assert.equal(index.search('ferries')[0].path, 'Company/fleet.md');
      await store.archive('Company/fleet.md'); assert.equal(index.search('ferries').length, 0);
      fs.writeFileSync(path.join(dir, 'brain', 'Company', 'outside.md'), '# Outside\n\nEdited by hand: the pier cafe opens at seven.');
      fs.rmSync(path.join(dir, 'brain', 'Company', 'gift.md'));
      const synced = index.sync(); assert.equal(synced.indexed, 1); assert.equal(synced.removed, 1);
      assert.equal(index.search('pier cafe')[0].path, 'Company/outside.md'); assert.equal(index.search('gift voucher').length, 0);
      index.close();
      const reopened = await new KnowledgeIndex({ dir: path.join(dir, 'index'), store, backend }).open();
      assert.equal(reopened.search('pier cafe')[0].path, 'Company/outside.md'); assert.equal(reopened.sync().indexed, 0); reopened.close();
    } finally { index.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('long documents are split by heading with overlap and the largest readable document indexes well within a minute', async () => {
  const parts = chunk('# A\nshort\n## B\n' + 'x'.repeat(7000));
  assert.deepEqual(parts.map(p => [p.heading, p.text.length]), [['A', 9], ['B', 3200], ['B', 3200], ['B', 1405]]);
  assert.deepEqual(terms('Budget: 5k (Q3) "launch"'), ['budget', '5k', 'q3', 'launch']);
  const dir = temp(), store = new KnowledgeStore(path.join(dir, 'brain')), index = await new KnowledgeIndex({ dir: path.join(dir, 'index'), store }).open();
  index.attach();
  try {
    const words = ['harbour', 'cruise', 'ticket', 'sailing', 'catering', 'charter', 'weather', 'refund'];
    // A 5 MB PDF yields at most 2,000,000 characters of text (the extractor's limit); index the largest possible note.
    let big = '# Handbook\n'; while (big.length < 1_990_000) big += `Section ${big.length}: ${words[big.length % 8]} guidance for the crew and the office.\n`;
    const started = Date.now(); await store.writeNote('Company/handbook.md', big);
    assert.ok(Date.now() - started < 60000); assert.ok(index.status().passages > 600);
    assert.equal(index.search('catering guidance')[0].path, 'Company/handbook.md');
  } finally { index.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
