/**
 * 界面上所有的文案，集中一处。
 *
 * 现在只有英文。将来要加中英切换时，这里再加一个同形状的对象、按语言取一份就行 ——
 * 不用回头翻遍 index.html / ui.ts / main.ts 去捞散落的字符串。
 */

import { type PobErrorCode } from './core/pob.js';

export const COPY = {
  errors: {
    empty: 'Paste a Path of Building code first.',
    'is-url': 'That link can’t be read from here — paste the build code itself.',
    'bad-base64': 'That isn’t valid base64. Check you copied the whole string.',
    'no-decompression':
      'This browser is too old — it has no DecompressionStream. Try a current Chrome, Edge or Firefox.',
    'inflate-failed': 'That doesn’t decode as a Path of Building code.',
    'bad-xml': 'That decoded, but it isn’t a Path of Building save.',
    'no-items': 'That build has no items in it.',
  } satisfies Record<PobErrorCode, string>,

  status: {
    loading: 'Loading the stat tables…',
    tablesFailed: (why: string) => `Couldn’t load the stat tables: ${why}`,
    notReady: 'Still loading the stat tables — one moment.',
    importing: 'Fetching the build from the link…',
    decoding: 'Decoding…',
  },

  summary: {
    items: 'items',
    matched: 'mods matched',
    unmatched: 'unrecognised',
  },

  buttons: {
    generate: 'Build the list',
    copyAll: (n: number) => `Copy all ${n} links`,
    copyAllIdle: 'Copy all links',
    search: 'Search',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Failed',
  },

  copyAll: {
    nothing: 'Nothing to copy yet.',
    done: (n: number) => `Copied ${n} links.`,
    failed: 'Copy failed — your browser blocked clipboard access.',
  },

  card: {
    implicit: 'Implicit',
    noFilter: 'No filter',
    noFilterReason: 'not in the trade stat list',
    unequipped: '(not equipped)',
    treeJewel: (nodeId: string) => `Tree jewel · ${nodeId}`,
    baseUnknown: 'Base type unknown — searching without it rather than returning nothing',
    hintUnique: 'Uniques search by name and base. Tick a mod only to narrow the roll.',
    hintOther: (n: number) =>
      `${n} mods picked automatically, explicit before implicit. Thresholds are the original rolls, relaxed by the tolerance.`,
  },
} as const;
