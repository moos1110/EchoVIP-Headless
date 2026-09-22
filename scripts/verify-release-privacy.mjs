import { execFileSync } from 'node:child_process';

const projectDirectory = new URL('..', import.meta.url);
const output = execFileSync('git', ['ls-files', '-z', '--', '.'], {
  cwd: projectDirectory,
  encoding: 'utf8',
});
const files = output.split('\0').filter(Boolean);
if (files.length === 0) {
  console.error('未找到 Git 跟踪文件，请确认当前项目位于 Git 仓库中');
  process.exit(1);
}
const forbidden = files.filter((file) =>
  file === '.env'
  || file.startsWith('accounts/')
  || file.startsWith('control-data/')
  || (file.startsWith('data/') && file !== 'data/.gitkeep')
  || (file.startsWith('logs/') && file !== 'logs/.gitkeep')
  || file.endsWith('login-qr.png')
  || file.endsWith('.zip'),
);
if (forbidden.length) {
  console.error(`发现禁止进入发布包的路径：\n${forbidden.join('\n')}`);
  process.exit(1);
}
console.log(`✅ 发布隐私检查通过，共检查 ${files.length} 个 Git 跟踪文件`);
