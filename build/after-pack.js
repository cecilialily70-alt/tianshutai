/**
 * electron-builder afterPack 钩子
 * ---------------------------------------------------------------
 * 打包使用自定义 electronDist（node_modules/electron/dist 的已解压副本）时，
 * electron-builder 会跳过默认的清理步骤，导致产物里残留 Electron 的默认应用文件。
 * 这里手动对齐默认行为，避免带上多余的 default_app.asar 与 version 文件。
 */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;

  const extra = [
    path.join(appOutDir, 'resources', 'default_app.asar'),
    path.join(appOutDir, 'version'),
  ];

  for (const file of extra) {
    try {
      fs.rmSync(file, { recursive: true, force: true });
    } catch (error) {
      console.warn('[afterPack] 清理失败：' + file + ' — ' + (error.message || error));
    }
  }
};
