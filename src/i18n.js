import { korean } from './ko.js';

const KEY = 'daylight-language';
let language = 'ko';
try { if (typeof document !== 'undefined') language = localStorage.getItem(KEY) === 'en' ? 'en' : 'ko'; } catch { /* Language still works when storage is unavailable. */ }
export const getLanguage = () => language;
export const locale = () => language === 'ko' ? 'ko-KR' : 'en-US';
export function setLanguage(value) {
  language = value === 'en' ? 'en' : 'ko';
  try { localStorage.setItem(KEY, language); } catch { /* Keep the session preference. */ }
  updateLanguageDocument();
}
export function updateLanguageDocument() {
  document.documentElement.lang = language;
  document.title = language === 'ko' ? 'Daylight — 나의 학생 플래너' : 'Daylight — Your student planner';
}
const patterns = [
  [/^Missing Google permissions: (.+)\. Reconnect and approve these permissions\. If already approved, check your school’s app-access policy\.$/, '필요한 Google 권한이 없어요: $1. 다시 연결하고 해당 권한을 허용하세요. 이미 허용했다면 학교의 앱 접근 정책을 확인하세요.'],
  [/^\/ (\d+) tasks complete$/, '/ $1개 완료'], [/^(.+) · Browser-local storage$/, '$1 · 현재 브라우저에 저장'],
  [/^Add event on (.+) at (.+)$/, '$1 $2에 일정 추가'], [/^Open (.+)$/, '$1 열기'],
  [/^(File|Video|Form|Link) · (.+)$/, (_, kind, host) => `${korean[kind]} · ${t(host)}`],
  [/^(\d+) min$/, '$1분'], [/^(\d+) sessions$/, '일정 $1개'], [/^\+(\d+) more$/, '+$1개 더 보기'],
  [/^(\d+) of (\d+) minutes scheduled$/, '총 $2분 중 $1분 계획됨'],
  [/^(\d+) of (\d+) minutes already scheduled\. Add as many sessions as you need\.$/, '총 $2분 중 $1분을 계획했어요. 필요한 만큼 학습 시간을 추가하세요.'],
  [/^Times follow (.+)\. Events start and end on the same day\.$/, '시간대: $1. 일정은 같은 날에 시작하고 끝나야 해요.'],
  [/^Last import: (.+) · (\d+) tasks$/, '최근 가져오기: $1 · 할 일 $2개'],
  [/^Last import: (.+) · (\d+) event segments$/, '최근 가져오기: $1 · 일정 $2개'],
  [/^Last synced (.+)\. Sync to get new posts\.$/, '최근 동기화: $1. 새 게시물을 보려면 동기화하세요.'],
  [/^Imported (\d+) assignments and (\d+) Classroom posts\. You’re up to date\.$/, '과제 $1개와 클래스룸 게시물 $2개를 가져왔어요. 최신 상태예요.'],
  [/^Imported (\d+) event segments\. You’re up to date\.$/, '일정 $1개를 가져왔어요. 최신 상태예요.'],
  [/^Google returned an error \((\d+)\)\. Existing imports are unchanged; try again later\.$/, 'Google 오류($1)가 발생했어요. 기존 데이터는 유지돼요. 나중에 다시 시도하세요.'],
  [/^Delete only this occurrence\?$/, '이번 일정만 삭제할까요?'], [/^Delete this and all future occurrences\?$/, '이번 일정과 이후 반복 일정을 모두 삭제할까요?'], [/^Delete this event and its entire series\?$/, '이 반복 일정을 모두 삭제할까요?'],
  [/^Previous (day|week|month)$/, (_, unit) => `이전 ${ {day:'날',week:'주',month:'달'}[unit] }`],
  [/^Next (day|week|month)$/, (_, unit) => `다음 ${ {day:'날',week:'주',month:'달'}[unit] }`],
];
export function t(value) {
  const source = String(value ?? '');
  if (language === 'en') return source;
  const key = source.trim();
  if (Object.hasOwn(korean, key)) return source.replace(key, () => korean[key]);
  for (const [pattern, replacement] of patterns) if (pattern.test(key)) return source.replace(key, () => key.replace(pattern, replacement));
  return source;
}

// Only interface copy is localized. User entries, Google content, form values,
// links, and source identifiers are explicitly excluded at the render boundary.
const originalContent = '[translate="no"],script,style,textarea,input,.task-title,.event-title,.all-day-event,.month-event,.event-location,.agenda-item strong,.agenda-item small,.deadline-item strong,.up-next h3,.up-next>div:last-child>span,.task-meta>span:first-child,.classroom-post h3,.classroom-post-text,.classroom-attachments strong,.source-chip,.connection-account,.source-picker label span,.remote-notes,.remote-details>p:not(.field-note),.google-account-card>p,#classroom-course option:not([value=""])';
export function translateUI(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) if (!node.parentElement?.closest(originalContent)) node.nodeValue = t(node.nodeValue);
  for (const element of root.querySelectorAll('[aria-label],[placeholder],[title]')) {
    if (element.closest('[translate="no"]')) continue;
    for (const attr of ['aria-label', 'placeholder', 'title']) if (element.hasAttribute(attr)) element.setAttribute(attr, t(element.getAttribute(attr)));
  }
  for (const link of root.querySelectorAll('a[href="/google-setup.html"]')) if (language === 'ko') link.href = '/google-setup-ko.html';
}
