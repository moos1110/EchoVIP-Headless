import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env'), quiet: true });

const domain = String(process.env.PANEL_DOMAIN ?? '').trim().toLowerCase().replace(/\.$/, '');
if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
  throw new Error('请先在 .env 中填写有效的 PANEL_DOMAIN（只写域名，不带协议或路径）');
}

const templatePath = path.resolve('deploy/nginx-echovip.conf.example');
const outputPath = path.resolve(process.argv[2] ?? 'deploy/nginx-echovip.conf');
const template = await readFile(templatePath, 'utf8');
const rendered = template.replaceAll('{{PANEL_DOMAIN}}', domain);
await writeFile(outputPath, rendered, { encoding: 'utf8', mode: 0o600 });
console.log(`Nginx 配置已生成：${outputPath}`);
