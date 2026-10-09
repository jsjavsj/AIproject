import test from 'node:test';
import assert from 'node:assert/strict';
import { getLanguage, locale, setLanguage, t } from '../src/i18n.js';
import { formatDate } from '../src/model.js';

test('Korean messages preserve dynamic counts and switch back to original English', () => {
  globalThis.document = { documentElement: {}, title: '' };
  const saved = new Map(); globalThis.localStorage = { setItem: (k, v) => saved.set(k, v) };
  try {
    setLanguage('ko');
    assert.equal(t('Imported 2 assignments and 3 Classroom posts. You’re up to date.'), '과제 2개와 클래스룸 게시물 3개를 가져왔어요. 최신 상태예요.');
    assert.equal(t('  Today '), '  오늘 ');
    assert.equal(t('Google returned an incomplete sign-in response. Please reconnect.'), 'Google 로그인 응답이 완전하지 않아요. 다시 연결하세요.');
    assert.equal(t('Missing Google permissions: classroom.announcements.readonly. Reconnect and approve these permissions. If already approved, check your school’s app-access policy.'), '필요한 Google 권한이 없어요: classroom.announcements.readonly. 다시 연결하고 해당 권한을 허용하세요. 이미 허용했다면 학교의 앱 접근 정책을 확인하세요.');
    assert.equal(t('Unknown teacher title'), 'Unknown teacher title');
    assert.equal(t('30 of 90 minutes scheduled'), '총 90분 중 30분 계획됨');
    assert.equal(document.documentElement.lang, 'ko');
    assert.equal(formatDate('2026-10-06', { month: 'long', day: 'numeric', year: 'numeric' }, locale()), '2026년 10월 6일');
    setLanguage('en');
    assert.equal(t('Today'), 'Today'); assert.equal(getLanguage(), 'en');
    assert.equal(saved.get('daylight-language'), 'en');
    assert.equal(formatDate('2026-10-06', { month: 'long', day: 'numeric', year: 'numeric' }, locale()), 'October 6, 2026');
  } finally { delete globalThis.document; delete globalThis.localStorage; }
});
test('language selection works even when browser storage is blocked', () => {
  globalThis.document = { documentElement: {}, title: '' };
  globalThis.localStorage = { setItem: () => { throw Error('blocked'); } };
  try { setLanguage('ko'); assert.equal(t('Cancel'), '취소'); }
  finally { delete globalThis.document; delete globalThis.localStorage; }
});
