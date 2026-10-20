// DEF-006: KeyboardAvoider inset re-measures when the layout above it changes (Reconnecting… bar).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeyboardInsetController, keyboardInset } from '../src/lib/keyboardInset.js';

test('keyboardInset: wrapper bottom below keyboard top, else 0', () => {
  assert.equal(keyboardInset({ y: 80, height: 720 }, 500), 300);
  assert.equal(keyboardInset({ y: 80, height: 400 }, 500), 0); // window already resized: no double count
  assert.equal(keyboardInset({ y: 80, height: 720 }, null), 0);
  assert.equal(keyboardInset({ y: 80, height: 720 }, 0), 0); // iOS cross-fade reports screenY 0
  assert.equal(keyboardInset({ y: NaN, height: 720 }, 500), 0);
  assert.equal(keyboardInset(null, 500), 0);
});

// Fake screen: bar (24) above the wrapper; the wrapper always ends at the window bottom (800).
function rig({ async = false } = {}) {
  const screen = { top: 80, bottom: 800 };
  const pending = [];
  const insets = [];
  const ctl = createKeyboardInsetController({
    measure: (cb) => {
      const frame = { y: screen.top, height: screen.bottom - screen.top };
      if (async) pending.push(() => cb(frame));
      else cb(frame);
    },
    onInset: (v) => insets.push(v),
  });
  const flush = () => pending.splice(0).forEach((f) => f());
  return { screen, ctl, insets, flush };
}

test('keyboard up, bar appears then clears: inset recomputed on layout, stays flush', () => {
  const { screen, ctl, insets } = rig();
  ctl.keyboardShown(500);
  assert.equal(ctl.inset, 300); // composer bottom = 800 - 300 = 500 = keyboard top
  screen.top = 104; // Reconnecting… bar appears: wrapper moves down / shrinks
  ctl.layout();
  assert.equal(ctl.inset, 300, 'still flush (wrapper bottom unchanged)');
  assert.equal(800 - ctl.inset, 500);
  screen.top = 80; // bar clears
  ctl.layout();
  assert.equal(800 - ctl.inset, 500, 'no gap after the bar clears');
  assert.deepEqual(insets, [300]);
});

test('wrapper bottom moves (e.g. bottom bar) with keyboard up: inset follows', () => {
  const { screen, ctl } = rig();
  ctl.keyboardShown(500);
  screen.bottom = 776;
  ctl.layout();
  assert.equal(ctl.inset, 276);
  screen.bottom = 800;
  ctl.layout();
  assert.equal(ctl.inset, 300);
});

test('keyboard down: bar toggles never add padding', () => {
  const { screen, ctl, insets } = rig();
  ctl.layout();
  screen.top = 104;
  ctl.layout();
  screen.top = 80;
  ctl.layout();
  assert.equal(ctl.inset, 0);
  assert.deepEqual(insets, []);
});

test('keyboard height change (emoji panel) and hide', () => {
  const { ctl } = rig();
  ctl.keyboardShown(500);
  ctl.keyboardShown(450);
  assert.equal(ctl.inset, 350);
  ctl.keyboardHidden();
  assert.equal(ctl.inset, 0);
});

test('async measure: stale results after hide or a newer layout are ignored', () => {
  const { screen, ctl, flush } = rig({ async: true });
  ctl.keyboardShown(500);
  ctl.keyboardHidden();
  flush();
  assert.equal(ctl.inset, 0, 'measure resolving after hide does not re-add padding');
  ctl.keyboardShown(500);
  flush();
  assert.equal(ctl.inset, 300);
  screen.bottom = 776;
  ctl.layout(); // measure 1 (bottom 776) in flight
  screen.bottom = 800;
  ctl.layout(); // measure 2 (bottom 800)
  flush();
  assert.equal(ctl.inset, 300, 'latest measure wins');
});
