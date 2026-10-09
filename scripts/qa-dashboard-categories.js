// Сопоставление spec-файлов с категориями клиентского ручного чек-листа
// (дашборд marketing-server/services/qa-dashboard). Категории, их порядок
// и группировка взяты оттуда буквально (прочитано вживую 2026-10-08/09,
// см. память проекта) — чтобы наш автоматический дашборд читался как
// прямое продолжение того же списка, а не как система с другой
// таксономией. Где у клиента пункт чисто ручной (нет и не может быть
// Playwright-теста — перевод на глаз, еженедельная ручная проверка
// Safari/Firefox) — он просто не появится в автоматическом прогоне,
// это нормально, не "пропавший" пункт.
//
// Тот же список (слова в слово) должен быть и в
// wordpress-plugin/imagen-qa-test-runner.php (функция imagen_qa_scopes) —
// команда на сайте и колонки в дашборде должны совпадать. Поменяли один —
// поменяйте и другой.
//
// Файл используется и в scripts/publish-qa-dashboard-run.js (Node, CJS),
// поэтому — module.exports, без TypeScript/ESM.
//
// Порядок ключей в CATEGORIES — порядок отображения в дашборде.
const CATEGORIES = {
  'homepage-nav': {
    name: 'Homepage & Navigation (Desktop 1600px)',
    files: ['tests/homepage.spec.ts'],
  },
  'signup-flow': {
    name: 'Desktop Signup Flow (full)',
    files: ['tests/signup-funnel.spec.ts', 'tests/quiz-full-walkthrough.spec.ts'],
  },
  'multi-language': {
    name: 'Multi-Language Signup (Rotate)',
    files: ['tests/localization.spec.ts', 'tests/localized-funnel.spec.ts'],
  },
  'video-page': {
    name: 'Video Page (full flow)',
    files: ['tests/video-funnel.spec.ts', 'tests/video-quiz-full-walkthrough.spec.ts'],
  },
  mobile: {
    name: 'Mobile (real phone or emulation)',
    files: ['tests/mobile-funnel.spec.ts'],
  },
  ios: {
    name: 'iOS / Apple Devices',
    // "iPhone Safari flow" и "Mac Safari layout" у клиента — это наши
    // browserstack/ прогоны (реальное устройство и Selenium на Mac),
    // отдельные от основного набора — сюда не попадают, см. browserstack/README.
    files: ['tests/ios-and-accessibility.spec.ts'],
  },
  pricing: {
    name: 'Pricing (Rotate regions)',
    files: ['tests/pricing-api.spec.ts', 'tests/pricing-rendered.spec.ts'],
  },
  'console-sweep': {
    name: 'Cross-page Console/HTTP Sweep',
    files: ['tests/site-health.spec.ts'],
  },
  'functional-gaps': {
    name: 'Functional Gaps',
    files: [
      'tests/form-validation.spec.ts',
      'tests/navigation-links.spec.ts',
      'tests/cta-buttons.spec.ts',
      'tests/language-switcher.spec.ts',
      'tests/content-templates.spec.ts',
      'tests/podcast-content-template.spec.ts',
      'tests/cookie-banner.spec.ts',
    ],
  },
  'visual-ux': {
    name: 'Visual / UX Gaps',
    files: [
      'tests/responsive.spec.ts',
      'tests/tablet-sweep.spec.ts',
      'tests/media-video.spec.ts',
      'tests/interactive-widgets.spec.ts',
      'tests/scroll-behavior.spec.ts',
    ],
  },
  'real-estate': {
    name: 'Real Estate Webapp',
    files: ['tests/real-estate.spec.ts'],
  },
};

// 'example.spec.ts' — заготовка Playwright, не часть чек-листа, пропускаем.
const UNCATEGORIZED_SLUG = 'other';
const UNCATEGORIZED_NAME = 'Other / Uncategorized';

// Playwright в JSON-репортере пишет spec.file ОТНОСИТЕЛЬНО testDir (значит,
// без префикса "tests/": "homepage.spec.ts", не "tests/homepage.spec.ts") —
// подтверждено вживую 2026-10-09. Сравниваем по имени файла, а не по
// полному пути, чтобы не зависеть от того, какой именно префикс вернёт
// конкретная версия репортера.
function basename(p) {
  const normalized = p.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function categoryForFile(filePath) {
  const base = basename(filePath);
  if (base === 'example.spec.ts') return null; // заготовка Playwright, осознанно пропускаем
  for (const [slug, cat] of Object.entries(CATEGORIES)) {
    if (cat.files.some((f) => basename(f) === base)) return slug;
  }
  return UNCATEGORIZED_SLUG;
}

function categoryName(slug) {
  if (slug === UNCATEGORIZED_SLUG) return UNCATEGORIZED_NAME;
  return CATEGORIES[slug]?.name ?? slug;
}

module.exports = { CATEGORIES, categoryForFile, categoryName, UNCATEGORIZED_SLUG, UNCATEGORIZED_NAME };
