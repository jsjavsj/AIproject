import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'favicon.svg', 'src']) {
  await cp(file, `dist/${file}`, { recursive: true });
}
console.log('Built Daylight into dist/ — ready for Vercel.');
