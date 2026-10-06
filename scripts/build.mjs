import { mkdir, cp, writeFile } from 'node:fs/promises';
import { validClientId } from '../src/google.js';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'favicon.svg', 'google-setup.html', 'google-setup-ko.html', 'src']) {
  await cp(file, `dist/${file}`, { recursive: true });
}
const clientId = process.env.GOOGLE_CLIENT_ID || '';
if (clientId && !validClientId(clientId)) throw Error('GOOGLE_CLIENT_ID must be a Google OAuth web client ID, not a client secret.');
await writeFile('dist/config.js', `window.DAYLIGHT_CONFIG = ${JSON.stringify({ googleClientId: clientId })};\n`);
console.log('Built Daylight into dist/ — ready for Vercel.');
