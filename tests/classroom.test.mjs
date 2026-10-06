import test from 'node:test';
import assert from 'node:assert/strict';
import { classroomAttachments, classroomPosts, mergeClassroomFeed, safeAttachmentLink, validClassroomFeed } from '../src/classroom.js';
import { GoogleConnection } from '../src/google.js';
import { SCOPES } from '../src/google-data.js';
const course = { id: 'science', name: 'Science 101' };
const post = (kind, extra = {}, account = 'student') => classroomPosts([{ id: 'same-id', state: 'PUBLISHED', ...extra }], kind, course, account)[0];

test('Classroom attachments include nested Drive files, videos, forms, and teacher links', () => {
  const files = classroomAttachments([
    { driveFile: { driveFile: { title: 'Lab notes.pdf', alternateLink: 'https://drive.google.com/file/d/123/view' } } },
    { youtubeVideo: { title: 'Lesson', alternateLink: 'https://www.youtube.com/watch?v=123' } },
    { form: { title: 'Quiz', formUrl: 'https://docs.google.com/forms/d/123/viewform', responseUrl: 'https://docs.google.com/private-results' } },
    { link: { title: 'Reading', url: 'https://school.example/reading' } },
  ]);
  assert.deepEqual(files.map(f => f.kind), ['File', 'Video', 'Form', 'Link']);
  assert.ok(files[2].url.endsWith('/viewform'));
  assert.equal(files[0].title, 'Lab notes.pdf');
});
test('attachment URLs reject active content and credentials but allow HTTPS teacher websites', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///test', 'http://example.com', 'https://user:password@example.com']) assert.equal(safeAttachmentLink(url), '');
  assert.equal(safeAttachmentLink('https://school.example/'), 'https://school.example/');
  assert.equal(classroomAttachments([{ link: { title: 'Unsafe', url: 'javascript:alert(1)' } }])[0].url, '');
});
test('posts preserve announcement text and assignment attachments, excluding unpublished records', () => {
  const posts = classroomPosts([{ id: '1', text: 'Bring your lab coat.\nRoom 3.', state: 'PUBLISHED' }, { id: '2', state: 'DRAFT' }, { id: '3', state: 'DELETED' }], 'announcement', course, 'student');
  assert.equal(posts.length, 1); assert.equal(posts[0].text, 'Bring your lab coat.\nRoom 3.');
  assert.equal(post('assignment', { materials: [{ link: { url: 'https://example.com', title: 'Worksheet' } }] }).attachments.length, 1);
  assert.equal(post('material', { updateTime: 'invalid' }).updatedAt, '');
});
test('feed refresh is newest-first, deduplicates by post type, retains identity, and removes deleted items', () => {
  const old = post('announcement'), material = post('material', { updateTime: '2026-10-06T12:00:00Z' });
  const updated = post('announcement', { text: 'New text', updateTime: '2026-10-05T12:00:00Z' });
  const feed = mergeClassroomFeed([old, post('assignment')], [updated, updated, material]);
  assert.equal(feed.length, 2); assert.equal(feed[0].kind, 'material'); assert.equal(feed[1].id, old.id); assert.equal(feed[1].text, 'New text');
  const switched = post('announcement', {}, 'different-account');
  assert.equal(mergeClassroomFeed([old], [switched])[0].id, switched.id);
});
test('feed backups validate shape and timestamps before rendering', () => {
  const item = post('announcement');
  assert.equal(validClassroomFeed([item]), true);
  for (const feed of [null, {}, [null], [item, item], [{ ...item, updatedAt: 'invalid' }], [{ ...item, attachments: [null] }], [{ ...item, remote: null }]]) assert.equal(validClassroomFeed(feed), false);
});
test('announcement and material APIs paginate with published-only filters and read-only scopes', async () => {
  const requests = [];
  const api = new GoogleConnection({ fetcher: async url => {
    const u = new URL(url); requests.push(u);
    const field = u.pathname.endsWith('/announcements') ? 'announcements' : 'courseWorkMaterial';
    return { ok: true, json: async () => ({ [field]: [{ id: u.searchParams.has('pageToken') ? 'second' : 'first' }], ...(u.searchParams.has('pageToken') ? {} : { nextPageToken: 'next' }) }) };
  } });
  api.sessions.classroom = { token: 'fixture', expires: Date.now() + 60000 };
  assert.equal((await api.announcements('course/one')).length, 2);
  assert.equal((await api.courseMaterials('course/one')).length, 2);
  assert.ok(requests.every(u => u.pathname.includes('course%2Fone')));
  assert.equal(requests[1].searchParams.get('announcementStates'), 'PUBLISHED');
  assert.equal(requests[3].searchParams.get('courseWorkMaterialStates'), 'PUBLISHED');
  assert.ok(SCOPES.classroom.includes('https://www.googleapis.com/auth/classroom.announcements.readonly'));
  assert.ok(SCOPES.classroom.includes('https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly'));
});
