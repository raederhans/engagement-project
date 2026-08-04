#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import '../../src/i18n/diary_local.js';
import { messages } from '../../src/i18n/messages.js';

const panelSource = await readFile(new URL('../../src/routes_diary/ui_my_routes_panel.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../../src/styles/diary-map-ui.css', import.meta.url), 'utf8');

test('My Routes renders history records as containers with independent actions', () => {
  assert.match(panelSource, /createElement\('article'\)/);
  assert.match(panelSource, /handlers\.onOpen\?\.\(item\)/);
  assert.match(panelSource, /handlers\.onDeleteIntent\?\.\(item\)/);
  assert.match(panelSource, /handlers\.onDeleteConfirm\?\.\(item\)/);
  assert.match(panelSource, /handlers\.onDeleteCancel\?\.\(item\)/);
  assert.doesNotMatch(panelSource, /const row = document\.createElement\('button'\)/);
  assert.ok(
    panelSource.indexOf('container.appendChild(historyCard)')
      < panelSource.indexOf('container.appendChild(createPrivateDataCard'),
    'route history must stay ahead of secondary backup management',
  );
});

test('empty history is plain copy while populated history owns list semantics', () => {
  assert.match(panelSource, /if \(!routes\.length\)[\s\S]*?createElement\('p'\)/);
  assert.match(panelSource, /else \{[\s\S]*?list\.setAttribute\('role', 'list'\)/);
  assert.match(panelSource, /row\.setAttribute\('role', 'listitem'\)/);
  assert.doesNotMatch(panelSource, /empty\.setAttribute\('role', 'listitem'\)/);
});

test('backup import is preview-first and destructive replacement requires a second action', () => {
  assert.match(panelSource, /handlers\.onImportMerge\?\.\(\)/);
  assert.match(panelSource, /handlers\.onImportReplaceIntent\?\.\(\)/);
  assert.match(panelSource, /handlers\.onImportReplaceConfirm\?\.\(\)/);
  assert.match(panelSource, /handlers\.onImportCancel\?\.\(\)/);
  assert.match(panelSource, /state\.replaceConfirm/);
});

test('private data copy is bilingual and names sensitive backup contents', () => {
  for (const locale of ['en', 'zh-CN']) {
    assert.ok(messages[locale]['diary.localDataPrivacy']);
    assert.ok(messages[locale]['diary.replaceConfirmWarning']);
    assert.ok(messages[locale]['diary.deleteConfirmPrompt']);
  }
  assert.match(messages.en['diary.localDataPrivacy'], /ratings, route geometry, notes, and unfinished drafts/i);
  assert.match(messages['zh-CN']['diary.localDataPrivacy'], /评分、路线几何、备注和未完成草稿/);
  assert.match(messages.en['diary.importEntriesSummary'], /\{removed\} removed/i);
  assert.match(messages['zh-CN']['diary.importEntriesSummary'], /删除 \{removed\}/);
});

test('local data operations expose bilingual live-status copy', () => {
  const statusKeys = [
    'diary.storageRowsSkipped',
    'diary.backupReady',
    'diary.backupPreparing',
    'diary.backupImporting',
    'diary.backupExporting',
    'diary.routeDeleting',
    'diary.backupExported',
    'diary.backupMerged',
    'diary.backupReplaced',
    'diary.backupCancelled',
    'diary.routeDeleted',
    'diary.routeDeleteFailed',
    'diary.backupOperationFailed',
    'diary.localCommitRequired',
  ];
  for (const key of statusKeys) {
    assert.ok(messages.en[key], `missing English status: ${key}`);
    assert.ok(messages['zh-CN'][key], `missing Chinese status: ${key}`);
  }
});

test('history actions have route-specific bilingual accessible names', () => {
  for (const locale of ['en', 'zh-CN']) {
    assert.ok(messages[locale]['diary.openRouteLabel']);
    assert.ok(messages[locale]['diary.deleteRouteLabel']);
  }
  assert.match(panelSource, /setTranslatedAttribute\(open, 'diary\.openRouteLabel', 'aria-label', \{ label:/);
  assert.match(panelSource, /setTranslatedAttribute\(remove, 'diary\.deleteRouteLabel', 'aria-label', \{ label:/);
});

test('data feedback is announced and action targets meet the 44/48px policy', () => {
  assert.match(panelSource, /setAttribute\('aria-live', 'polite'\)/);
  assert.match(panelSource, /setAttribute\('role', 'alert'\)/);
  assert.match(panelSource, /card\.setAttribute\('aria-busy'/);
  assert.match(panelSource, /state\.dataStatus\?\.tone === 'error' \? 'alert' : 'status'/);
  assert.match(panelSource, /dataDiaryFocusTarget|diaryFocusTarget/);
  assert.match(panelSource, /setAttribute\('aria-describedby', warning\.id\)/);
  assert.match(panelSource, /setAttribute\('aria-describedby', prompt\.id\)/);
  assert.match(styleSource, /\.diary-data-actions \.diary-chip,[\s\S]*?min-height: 44px/);
  assert.match(styleSource, /@media \(max-width: 480px\)[\s\S]*?min-height: 48px/);
});
