#!/usr/bin/env node
/* Собирает все levels/*.json в levels/levels.bundle.js,
   чтобы игра открывалась двойным кликом по index.html (без сервера).
   Запуск из корня проекта:  node tools/build-levels.js */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'levels');
const levels = {};
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  levels[data.id || path.basename(file, '.json')] = data;
}
const banner = '/* Сгенерировано tools/build-levels.js. Не редактируйте вручную: правьте levels/*.json */\n';
fs.writeFileSync(path.join(dir, 'levels.bundle.js'), banner + 'window.NIT_LEVELS = ' + JSON.stringify(levels) + ';\n');
console.log('Собрано уровней: ' + Object.keys(levels).length + ' → levels/levels.bundle.js');
