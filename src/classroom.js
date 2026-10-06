import { uid } from './model.js';
import { remoteKey, safeGoogleLink } from './google-data.js';

export function safeAttachmentLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function classroomAttachments(materials = []) {
  return materials.map(material => {
    const file = material.driveFile?.driveFile;
    const video = material.youtubeVideo, link = material.link, form = material.form;
    const kind = file ? 'File' : video ? 'Video' : form ? 'Form' : 'Link';
    const source = file || video || form || link;
    if (!source) return null;
    const url = safeAttachmentLink(source.alternateLink || source.formUrl || source.url);
    return { kind, title: String(source.title || `${kind} attachment`).slice(0, 300), url };
  }).filter(Boolean);
}

export function classroomPosts(items, kind, course, account) {
  return items.filter(item => item.state === 'PUBLISHED' || !item.state).map(item => ({
    id: uid(), kind,
    title: String(kind === 'announcement' ? 'Class announcement' : item.title || 'Class material').slice(0, 300),
    text: String(item.text || item.description || '').slice(0, 30000),
    updatedAt: Number.isFinite(Date.parse(item.updateTime || item.creationTime)) ? new Date(item.updateTime || item.creationTime).toISOString() : '',
    attachments: classroomAttachments(item.materials),
    remote: { service: 'classroom', account, container: course.id, id: item.id, segment: kind, label: course.name || 'Classroom', url: safeGoogleLink(item.alternateLink, 'classroom') },
  }));
}

export function mergeClassroomFeed(existing, incoming) {
  const previous = new Map(existing.map(item => [remoteKey(item), item.id]));
  return [...new Map(incoming.map(item => [remoteKey(item), item])).values()]
    .map(item => ({ ...item, id: previous.get(remoteKey(item)) || item.id }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function validClassroomFeed(feed) {
  const text = (value, max = 2000) => typeof value === 'string' && value.length <= max;
  return Array.isArray(feed) && feed.length <= 5000 && feed.every(post => post &&
    text(post.id, 100) && /^[a-zA-Z0-9_-]+$/.test(post.id) && ['announcement', 'material', 'assignment'].includes(post.kind) &&
    text(post.title, 300) && text(post.text, 30000) && text(post.updatedAt, 100) && (!post.updatedAt || Number.isFinite(Date.parse(post.updatedAt))) &&
    post.remote?.service === 'classroom' && ['account', 'container', 'id', 'label', 'url'].every(key => text(post.remote[key])) &&
    post.remote.segment === post.kind && Array.isArray(post.attachments) && post.attachments.length <= 100 &&
    post.attachments.every(file => file && ['File', 'Video', 'Form', 'Link'].includes(file.kind) && text(file.title, 300) && text(file.url, 10000))) &&
    new Set(feed.map(post => post.id)).size === feed.length;
}
