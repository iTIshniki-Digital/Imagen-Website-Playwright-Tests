import { test, expect } from './fixtures';
import localesData from '../data/locales-data.json';

// Проверка #13 (Translation review) — раньше считалась чисто ручной ("чтение
// копирайта на смысл — не для автоматизации", см. Imagen QA Coverage). Теперь
// автоматизируем ту часть, которую реально может сделать модель: не "красиво
// ли звучит", а "не потерян ли смысл, не осталась ли фраза непереведённой,
// нет ли явного мусора/плейсхолдера". Осознанно НЕ придирается к стилю —
// задача отловить явную поломку перевода, а не заменить редактора.
//
// Текст для проверки — только то, что уже проверено как стабильный локатор
// в tests/localization.spec.ts (title) и tests/localized-funnel.spec.ts
// (hero CTA без href, по структуре, не по тексту — переживает A/B и верстку).
// Намеренно не добавляем новых селекторов ради этого теста — если позже
// понадобится больше текста, лучше взять его из уже проверенных мест.
//
// Один запрос на локаль (не на фразу) — дешевле и быстрее, см.
// scripts/README-qa-dashboard.md. Требует ANTHROPIC_API_KEY — без него тест
// аккуратно пропускается (skip), не падает, чтобы не ломать прогон тем, у
// кого ключа нет (например, локальная разработка).

const HERO_CTA = 'xpath=//a[contains(@class,"elementor-button") and not(@href) and not(ancestor::header)]';

async function readSnippets(page: import('@playwright/test').Page) {
  const title = await page.title();
  const cta = await page
    .locator(HERO_CTA)
    .filter({ hasText: /\S/ })
    .first()
    .innerText()
    .catch(() => '');
  return { title: title.trim(), cta: cta.trim() };
}

async function askClaude(localeCode: string, pairs: { label: string; en: string; translated: string }[]) {
  const prompt =
    `You're reviewing this website's translations into the language with code "${localeCode}". For each pair ` +
    `(English original → translation), say whether the translation conveys the same meaning and ` +
    `whether it's actually written in the "${localeCode}" language (not accidentally left in ` +
    `English, and not an untranslated placeholder or garbage text). ` +
    `Do NOT nitpick style, choice of synonyms, minor cultural adaptations, or the fact that ` +
    `a [page title] is shorter in another language than in English — page titles are often ` +
    `deliberately shortened in other languages for SEO; that's normal practice, not an error. ` +
    `Only flag as an error: an actual loss of meaning (not length), untranslated ` +
    `(still-English) text, or nonsense/garbage/a placeholder.\n\n` +
    pairs.map((p, i) => `${i + 1}. [${p.label}] EN: "${p.en}" → ${localeCode}: "${p.translated}"`).join('\n') +
    `\n\nReply with STRICTLY a JSON array of the same length, no surrounding text and no markdown formatting:\n` +
    `[{"ok": true|false, "reason": "brief, in English, only if ok:false, otherwise an empty string"}, ...]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', // быстрая и дешёвая модель — этого достаточно, см. README
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let parsed: { ok: boolean; reason: string }[];
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Couldn't parse the model's reply as JSON: ${text.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== pairs.length) {
    throw new Error(`Model returned the wrong shape (expected an array of ${pairs.length}): ${text.slice(0, 300)}`);
  }
  return parsed;
}

test.describe('Translation review (#13)', () => {
  test.skip(!process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY is not set — check skipped, see scripts/README-qa-dashboard.md');

  for (const locale of localesData.locales) {
    if (locale.code === 'en') continue;

    test(`${locale.code} (${locale.path}) translation makes sense`, async ({ page, browserName }) => {
      // Текст не меняется от браузера к браузеру — незачем и платить за
      // проверку перевода трижды (см. тот же приём в ios-and-accessibility.spec.ts).
      test.skip(browserName !== 'chromium', 'Text check: one browser is enough');

      // Свежий английский вариант — в отдельной вкладке ТОГО ЖЕ контекста
      // (не browser.newPage(), у него нет Cloudflare bypass-заголовка —
      // тот ставится через context.setExtraHTTPHeaders() в tests/fixtures.ts
      // и наследуется только дочерними страницами того же контекста).
      // Тот же приём, что уже в tests/localization.spec.ts.
      const englishPage = await page.context().newPage();
      await englishPage.goto('/', { waitUntil: 'load' });
      const englishSnippets = await readSnippets(englishPage);
      await englishPage.close();

      await page.goto(locale.path, { waitUntil: 'load' });
      const snippets = await readSnippets(page);

      const pairs = [
        { label: 'page title', en: englishSnippets.title, translated: snippets.title },
        { label: 'hero button', en: englishSnippets.cta, translated: snippets.cta },
      ].filter((p) => p.en && p.translated); // пустые (не нашли элемент) пропускаем, не шлём мусор модели

      expect(pairs.length, `No text to compare (title/hero button) found on ${locale.path}`).toBeGreaterThan(0);

      const verdicts = await askClaude(locale.code, pairs);
      verdicts.forEach((v, i) => {
        expect(v.ok, `[${pairs[i].label}] "${pairs[i].translated}" — ${v.reason || "the translation doesn't seem to convey the original's meaning"}`).toBe(true);
      });
    });
  }
});
