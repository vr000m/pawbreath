import test from 'node:test';
import assert from 'node:assert/strict';
import { manualDialogAction } from '../dist/data.mjs';

test('manual dialog policy covers every cancel, close and confirm state', () => {
  const rows = [
    // event, dirty, cancelable, confirmOpen, dialogOpen, discard -> action
    ['cancel', true, true, false, true, false, 'confirm'],
    ['cancel', false, true, false, true, false, 'finish'],
    ['cancel', true, false, false, true, false, 'none'],
    ['cancel', false, false, false, true, false, 'none'],
    ['cancel', true, true, true, true, false, 'none'],
    ['cancel', true, false, true, true, false, 'none'],
    ['close', true, false, false, false, false, 'reopen'],
    ['close', true, false, true, false, false, 'none'],
    ['close', false, false, false, false, false, 'clear'],
    ['close', false, false, true, false, false, 'clear'],
    ['confirmed', true, false, false, true, true, 'finish'],
    ['confirmed', true, false, false, false, true, 'finish'],
    ['confirmed', true, false, false, true, false, 'none'],
    ['confirmed', true, false, false, false, false, 'reopen'],
  ];
  for (const [event, dirty, cancelable, confirmOpen, dialogOpen, discard, expected] of rows) {
    assert.equal(manualDialogAction({ event, dirty, cancelable, confirmOpen, dialogOpen, discard }), expected,
      JSON.stringify({ event, dirty, cancelable, confirmOpen, dialogOpen, discard }));
  }
  assert.throws(() => manualDialogAction({ event: 'unknown', dirty: true }));
});

// A model of the browser's modal stack driving the same handlers as dist/app.js.
function simulate() {
  const s = { stack: ['manual'], dirty: true, draft: true, confirming: false, saved: false };
  const top = () => s.stack.at(-1);
  const close = name => { s.stack = s.stack.filter(item => item !== name); };
  const finish = () => { s.draft = false; s.dirty = false; close('manual'); };
  const onClose = () => {
    const action = manualDialogAction({ event: 'close', dirty: s.dirty && s.draft, confirmOpen: s.confirming });
    if (action === 'reopen') s.stack.push('manual');
    else if (action === 'clear') s.draft = false;
  };
  const resolveConfirm = discard => {
    close('confirm');
    s.confirming = false;
    const action = manualDialogAction({ event: 'confirmed', dirty: s.dirty, discard, dialogOpen: s.stack.includes('manual') });
    if (action === 'finish') finish();
    else if (action === 'reopen' && s.draft) s.stack.push('manual');
  };
  const askDiscard = () => {
    if (s.confirming) return;
    if (!s.dirty) { finish(); return; }
    s.confirming = true;
    s.stack.push('confirm');
  };
  return {
    s,
    escape(cancelable) {
      if (top() === 'confirm') { resolveConfirm(false); return; }
      if (top() !== 'manual') return;
      const action = manualDialogAction({ event: 'cancel', dirty: s.dirty, cancelable, confirmOpen: s.confirming });
      if (action === 'confirm') askDiscard();
      else if (action === 'finish') finish();
      if (!cancelable && s.stack.includes('manual')) { close('manual'); onClose(); }
    },
    clickClose() { if (top() === 'manual') askDiscard(); },
    choose(discard) { if (top() === 'confirm') resolveConfirm(discard); },
    save() { if (top() === 'manual') { s.saved = true; finish(); } },
  };
}

function sequences(length) {
  if (!length) return [[]];
  return sequences(length - 1).flatMap(rest => [[true, ...rest], [false, ...rest]]);
}

test('any Escape sequence on a dirty draft keeps one modal on top and leaves Save and Discard reachable', () => {
  for (let length = 1; length <= 5; length++) {
    for (const presses of sequences(length)) {
      const label = presses.map(c => (c ? 'C' : 'N')).join('');
      const run = () => { const sim = simulate(); for (const cancelable of presses) sim.escape(cancelable); return sim; };
      const after = run();
      const { stack } = after.s;
      assert.ok(after.s.draft && after.s.dirty, `${label}: draft lost`);
      assert.equal(new Set(stack).size, stack.length, `${label}: a dialog is stacked twice`);
      assert.ok(stack.includes('manual'), `${label}: draft hidden`);
      if (stack.includes('confirm')) assert.deepEqual(stack, ['manual', 'confirm'], `${label}: confirm is not on top`);

      // Discard is reachable: answer an open confirm, or ask via Cancel/×.
      const discard = run();
      if (discard.s.stack.at(-1) !== 'confirm') discard.clickClose();
      discard.choose(true);
      assert.deepEqual(discard.s.stack, [], `${label}: Discard unreachable`);
      assert.ok(!discard.s.draft, `${label}: Discard kept the draft`);

      // Save is reachable, and no stale discard prompt remains afterwards.
      const save = run();
      save.escape(true); // An Escape on an open confirm keeps the draft.
      while (save.s.stack.at(-1) === 'confirm') save.choose(false);
      save.save();
      assert.ok(save.s.saved, `${label}: Save unreachable`);
      assert.deepEqual(save.s.stack, [], `${label}: stale dialog after Save`);
    }
  }
});
