#!/usr/bin/env node
/**
 * 天枢台 · Windows 打包驱动
 * ---------------------------------------------------------------
 * 由项目根目录的「打包.bat」调用，也可以直接运行：node build/package.js
 *
 * 流程：装依赖 → 生成图标 → 构建前端(vite) → 打包(electron-builder) → 输出产物到 release/
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);

const APP_NAME = '天枢台';
const OUT_DIR = path.join(root, 'release');
const ICON = path.join(root, 'build', 'icon.ico');

const WIN = process.platform === 'win32';
const npmCmd = WIN ? 'npm.cmd' : 'npm';
const ebBin = path.join(root, 'node_modules', '.bin', WIN ? 'electron-builder.cmd' : 'electron-builder');
const ebArg = ebBin.includes(' ') ? '"' + ebBin + '"' : ebBin;

// 国内网络兜底：默认线路失败后改用 npmmirror 镜像
const MIRROR_ENV = {
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

function hr() {
  console.log('==========================================================');
}

function step(msg) {
  console.log('');
  console.log('[打包] ' + msg);
}

function run(cmd, args, extraEnv) {
  const env = extraEnv ? Object.assign({}, process.env, extraEnv) : process.env;
  // Windows 下 npm / electron-builder 都是 .cmd，必须经 shell 执行。
  // 这里把命令拼成整串（而不是传 args 数组）以避开 Node 的 DEP0190 警告。
  const result = WIN
    ? spawnSync([cmd].concat(args || []).join(' '), { stdio: 'inherit', cwd: root, env: env, shell: true })
    : spawnSync(cmd, args, { stdio: 'inherit', cwd: root, env: env });
  if (result.error) {
    console.log('[打包] 无法执行命令：' + cmd + ' — ' + result.error.message);
    return 1;
  }
  return typeof result.status === 'number' ? result.status : 1;
}

function abort(msg) {
  console.log('');
  console.log('[打包] ' + msg);
  console.log('[打包] 请把上方报错信息截图反馈。');
  hr();
  process.exit(1);
}

function humanSize(bytes) {
  return (bytes / 1024 / 1024).toFixed(0) + ' MB';
}

function listArtifacts() {
  if (!fs.existsSync(OUT_DIR)) return [];
  return fs
    .readdirSync(OUT_DIR)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .map((name) => ({
      name,
      size: fs.statSync(path.join(OUT_DIR, name)).size,
    }))
    .sort((a, b) => b.size - a.size);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 优先使用 electron 包自带的「已解压 Electron」（node_modules/electron/dist）。
 * 好处：
 *  1) 跳过 electron-builder「解压到 xxx.tmp 再重命名」这一步 —— 部分杀毒软件（火绒/360 等）
 *     会拦截对含大量 exe/dll 目录的重命名，导致 EPERM/拒绝访问，打包直接失败；
 *  2) 少一次 200MB 解压，打包更快；不需要联网下载 Electron。
 * 找不到时返回 null，自动回退到 electron-builder 默认流程。
 */
function resolveElectronDist() {
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  const exe = path.join(dist, process.platform === 'win32' ? 'electron.exe' : 'electron');
  try {
    if (fs.existsSync(exe)) return dist;
  } catch (error) {
    /* 忽略 */
  }
  return null;
}

function buildArgs() {
  const args = ['--win'];
  const dist = resolveElectronDist();
  if (dist) {
    args.push('-c.electronDist="' + dist.replace(/\\/g, '/') + '"');
  }
  return args;
}

/** 清理上次产物；被占用时重试几次，仍失败则返回 false */
function cleanOutputDir() {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      fs.rmSync(OUT_DIR, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
      return true;
    } catch (error) {
      sleep(1500);
    }
  }
  return false;
}

function main() {
  hr();
  console.log('                ' + APP_NAME + ' · Windows 一键打包');
  hr();
  console.log('');
  if (!WIN) {
    console.log('[打包] 提示：当前不是 Windows 系统，仍会尝试按 Windows 目标打包。');
  }

  // ---------- 1. 项目依赖 ----------
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    step('首次运行，正在安装项目依赖（可能需要几分钟）...');
    if (run(npmCmd, ['install', '--no-audit', '--no-fund']) !== 0) {
      abort('依赖安装失败，请检查网络后重试。');
    }
  }

  // ---------- 2. 打包工具 ----------
  if (!fs.existsSync(path.join(root, 'node_modules', 'electron-builder'))) {
    step('正在安装打包工具 electron-builder ...');
    if (run(npmCmd, ['install', '--save-dev', 'electron-builder', '--no-audit', '--no-fund']) !== 0) {
      abort('electron-builder 安装失败，请检查网络后重试。');
    }
  }

  // ---------- 3. 应用图标 ----------
  if (!fs.existsSync(ICON)) {
    step('生成应用图标...');
    if (run('node', [path.join('build', 'make-icon.js')]) !== 0) {
      abort('应用图标生成失败。');
    }
  }

  // ---------- 4. 构建前端界面 ----------
  step('正在构建前端界面...');
  if (run(npmCmd, ['run', 'build']) !== 0) {
    abort('前端构建失败。');
  }

  // ---------- 5. 打包 Windows 程序 ----------
  // 先清掉上次产物：资源管理器若开着 release 目录会锁住里面的 exe，导致覆盖失败
  if (!cleanOutputDir()) {
    console.log('');
    console.log('[打包] 旧产物 release 目录被占用，无法清理，已停止打包。');
    console.log('[打包] 常见原因：资源管理器正打开着 release 文件夹（或杀毒软件正在扫描）。');
    console.log('[打包] 处理办法：关闭该文件夹窗口后，重新运行本程序即可。');
    hr();
    process.exit(1);
  }
  step('正在打包 Windows 程序（首次运行需下载打包组件，请耐心等待）...');
  // 杀毒软件（火绒/360/Defender）会实时扫描刚解压出来的 Electron 二进制，
  // 偶发导致 electron-builder 重命名目录失败（EPERM）。这里做多轮重试兜底。
  const attempts = [
    { label: '默认线路', env: null },
    { label: '默认线路（重试）', env: null },
    { label: '国内镜像', env: MIRROR_ENV },
    { label: '国内镜像（重试）', env: MIRROR_ENV },
  ];
  let code = 1;
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) {
      step('第 ' + (i + 1) + ' 次尝试（' + attempts[i].label + '）...');
      // 清掉上一轮残留的中间目录，等杀毒扫描结束再试
      try {
        fs.rmSync(OUT_DIR, { recursive: true, force: true, maxRetries: 2, retryDelay: 300 });
      } catch (error) {
        /* 清不掉就交给下一次尝试覆盖 */
      }
      sleep(4000);
    }
    code = run(ebArg, buildArgs(), attempts[i].env);
    if (code === 0) break;
    console.log('');
    console.log('[打包] 本次尝试失败（' + attempts[i].label + '）。');
    console.log('[打包] 若提示 EPERM / 文件被占用，通常是杀毒软件正在扫描，稍后重试即可。');
  }
  if (code !== 0) {
    abort('打包失败。');
  }

  // ---------- 6. 汇报结果 ----------
  const artifacts = listArtifacts();
  console.log('');
  hr();
  console.log('  打包完成！产物已输出到 ' + path.relative(root, OUT_DIR) + ' 文件夹：');
  console.log('----------------------------------------------------------');
  for (const item of artifacts) {
    console.log('  ' + item.name + '   （' + humanSize(item.size) + '）');
  }
  console.log('----------------------------------------------------------');
  console.log('  · 安装版：双击安装到电脑，自动创建桌面 / 开始菜单快捷方式');
  console.log('  · 便携版：免安装，双击即用，可放 U 盘携带');
  console.log('');
  console.log('  产物目录：' + OUT_DIR);
  console.log('  （复制上面这行路径，粘贴到资源管理器地址栏即可打开）');
  hr();
  console.log('');
}

try {
  main();
} catch (error) {
  console.log('');
  console.log('[打包] 发生异常：' + (error && error.stack ? error.stack : error));
  process.exit(1);
}
