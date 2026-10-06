<?php
/**
 * Plugin Name: Imagen QA Test Runner
 * Description: Форма для запуска Playwright-тестов imagen-ai.com через GitHub Actions, без захода в GitHub. Вставляется шорткодом [imagen_qa_test_runner].
 * Version: 1.1.1
 */

if (!defined('ABSPATH')) {
    exit;
}

define('IMAGEN_QA_VERSION', '1.1.1');
define('IMAGEN_QA_REPO', 'iTishnikiDigital/Imagen-Website-Playwright-Tests');
define('IMAGEN_QA_WORKFLOW', 'playwright.yml');
define('IMAGEN_QA_BRANCH', 'main');

add_shortcode('imagen_qa_test_runner', 'imagen_qa_render_form');
add_action('admin_menu', 'imagen_qa_add_settings_page');
// Только wp_ajax_ (без _nopriv_): обработчик доступен только залогиненным
// пользователям WordPress. Каждый запуск — реальный прогон в CI и реальная
// отправка тестового email в CRM клиента, поэтому анонимным он не нужен.
add_action('wp_ajax_imagen_qa_run_test', 'imagen_qa_handle_run_test');

/* ---------------------------------------------------------------------------
 * Справочники: браузеры и наборы тестов. Имена файлов должны совпадать с
 * репозиторием. Если в tests/ появится новый набор — добавьте его сюда.
 * ------------------------------------------------------------------------ */

function imagen_qa_browsers() {
    return [
        'chromium' => ['label' => 'Chrome', 'hint' => 'основной, самый быстрый'],
        'firefox'  => ['label' => 'Firefox', 'hint' => ''],
        'webkit'   => ['label' => 'Safari', 'hint' => 'движок WebKit'],
    ];
}

function imagen_qa_scopes() {
    return [
        'home' => [
            'label' => 'Главная и навигация',
            'files' => ['tests/homepage.spec.ts', 'tests/navigation-links.spec.ts', 'tests/cta-buttons.spec.ts'],
        ],
        'funnel' => [
            'label' => 'Воронка: email → квиз → скачивание',
            'files' => ['tests/signup-funnel.spec.ts', 'tests/form-validation.spec.ts', 'tests/quiz-full-walkthrough.spec.ts'],
        ],
        'video' => [
            'label' => 'Видео-воронка',
            'files' => ['tests/video-funnel.spec.ts', 'tests/video-quiz-full-walkthrough.spec.ts'],
        ],
        'mobile' => [
            'label' => 'Мобильная (iPhone)',
            'files' => ['tests/mobile-funnel.spec.ts'],
        ],
        'locales' => [
            'label' => 'Локализация',
            'files' => ['tests/localization.spec.ts', 'tests/language-switcher.spec.ts', 'tests/localized-funnel.spec.ts'],
        ],
        'pricing' => [
            'label' => 'Цены и API',
            'files' => ['tests/pricing-api.spec.ts', 'tests/pricing-rendered.spec.ts'],
        ],
        'responsive' => [
            'label' => 'Адаптивность 768 / 375 px',
            'files' => ['tests/responsive.spec.ts', 'tests/tablet-sweep.spec.ts'],
        ],
        'health' => [
            'label' => 'Ошибки и медиа',
            'files' => ['tests/site-health.spec.ts', 'tests/media-video.spec.ts'],
        ],
        'widgets' => [
            'label' => 'Виджеты, скролл, баннер',
            'files' => ['tests/interactive-widgets.spec.ts', 'tests/scroll-behavior.spec.ts', 'tests/cookie-banner.spec.ts'],
        ],
        'content' => [
            'label' => 'Блог и подкаст',
            'files' => ['tests/content-templates.spec.ts', 'tests/podcast-content-template.spec.ts'],
        ],
        'realestate' => [
            'label' => 'Real Estate',
            'files' => ['tests/real-estate.spec.ts'],
        ],
    ];
}

/* ---------------------------------------------------------------------------
 * Проверка входных данных. Всё, что уходит в GitHub, проходит здесь. Воркфлоу
 * дополнительно проверяет то же самое у себя (defence in depth), потому что
 * его можно запустить и вручную.
 * ------------------------------------------------------------------------ */

// Возвращает список допустимых браузеров (пустой, если ничего не выбрано).
function imagen_qa_parse_browsers($raw) {
    $allowed = array_keys(imagen_qa_browsers());
    $picked = array_filter(array_map('trim', explode(',', (string) $raw)));
    return array_values(array_unique(array_intersect($picked, $allowed)));
}

// null — если формат не подходит; [] — если список пуст (весь набор).
function imagen_qa_parse_specs($raw) {
    $raw = trim((string) $raw);
    if ($raw === '') {
        return [];
    }
    $parts = preg_split('/\s+/', $raw);
    if (count($parts) > 12) {
        return null;
    }
    foreach ($parts as $part) {
        if (!preg_match('#^tests/[A-Za-z0-9._-]+\.spec\.ts$#', $part)) {
            return null;
        }
    }
    return array_values(array_unique($parts));
}

// null — если символы недопустимы; '' — если фильтр не задан.
function imagen_qa_parse_grep($raw) {
    $raw = trim((string) $raw);
    if ($raw === '') {
        return '';
    }
    if (!preg_match('/^[A-Za-z0-9 _.,:()\/|-]{1,120}$/', $raw)) {
        return null;
    }
    return $raw;
}

// null — если строка не похожа на cookie-строку; '' — если cookies не нужны.
function imagen_qa_parse_cookies($raw) {
    $raw = trim((string) $raw);
    if ($raw === '') {
        return '';
    }
    if (strlen($raw) > 2000 || preg_match('/[\r\n]/', $raw) || strpos($raw, '=') === false) {
        return null;
    }
    return $raw;
}

/* ---------------------------------------------------------------------------
 * Токен GitHub. Основной способ — опция в БД, которую задаёт администратор на
 * странице настроек. Константа в wp-config.php, если она есть, важнее.
 * ------------------------------------------------------------------------ */

function imagen_qa_get_github_token() {
    if (defined('IMAGEN_QA_GITHUB_TOKEN') && IMAGEN_QA_GITHUB_TOKEN) {
        return IMAGEN_QA_GITHUB_TOKEN;
    }
    return get_option('imagen_qa_github_token', '');
}

function imagen_qa_add_settings_page() {
    add_options_page(
        'Imagen QA Test Runner',
        'Imagen QA Runner',
        'manage_options',
        'imagen-qa-test-runner',
        'imagen_qa_render_settings_page'
    );
}

function imagen_qa_render_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }

    $notice = '';
    if (isset($_POST['imagen_qa_token_nonce']) && wp_verify_nonce($_POST['imagen_qa_token_nonce'], 'imagen_qa_save_token')) {
        if (!empty($_POST['imagen_qa_reset'])) {
            delete_option('imagen_qa_github_token');
            $notice = '<div class="notice notice-warning"><p>Токен удалён.</p></div>';
        } else {
            $new_token = isset($_POST['imagen_qa_github_token']) ? sanitize_text_field(wp_unslash($_POST['imagen_qa_github_token'])) : '';
            if ($new_token !== '') {
                update_option('imagen_qa_github_token', $new_token);
                $notice = '<div class="notice notice-success"><p>Токен сохранён.</p></div>';
            }
        }
    }

    $using_constant = defined('IMAGEN_QA_GITHUB_TOKEN') && IMAGEN_QA_GITHUB_TOKEN;
    $has_saved_option = (bool) get_option('imagen_qa_github_token', '');
    ?>
    <div class="wrap">
        <h1>Imagen QA Test Runner</h1>
        <?php echo $notice; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- собственная разметка выше ?>
        <p>Версия плагина: <?php echo esc_html(IMAGEN_QA_VERSION); ?>.
            Статус токена:
            <?php if ($using_constant): ?>
                <strong>задан константой в wp-config.php</strong> (поле ниже игнорируется).
            <?php elseif ($has_saved_option): ?>
                <strong>сохранён</strong>.
            <?php else: ?>
                <strong>не задан</strong> — форма не сможет запускать тесты.
            <?php endif; ?>
        </p>
        <?php if (!$using_constant): ?>
            <form method="post">
                <?php wp_nonce_field('imagen_qa_save_token', 'imagen_qa_token_nonce'); ?>
                <table class="form-table">
                    <tr>
                        <th scope="row"><label for="imagen_qa_github_token">GitHub-токен</label></th>
                        <td>
                            <input type="password" id="imagen_qa_github_token" name="imagen_qa_github_token" class="regular-text" autocomplete="off" placeholder="<?php echo $has_saved_option ? 'Токен сохранён — введите новый, чтобы заменить' : 'ghp_… (classic) или github_pat_… (fine-grained)'; ?>">
                            <p class="description">Classic token с правом <code>repo</code> (проверено, работает). Fine-grained подойдёт, если в нём есть доступ к репозиторию с правом Actions: Read and write.</p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Сохранить', 'primary', 'submit', false); ?>
                <?php if ($has_saved_option): ?>
                    <?php submit_button('Удалить токен', 'secondary', 'imagen_qa_reset', false); ?>
                <?php endif; ?>
            </form>
        <?php endif; ?>
    </div>
    <?php
}

/* ---------------------------------------------------------------------------
 * Форма на странице.
 * ------------------------------------------------------------------------ */

function imagen_qa_assets_url($file) {
    return plugins_url($file, __FILE__);
}

function imagen_qa_last_run_text() {
    $last = get_option('imagen_qa_last_run');
    if (!is_array($last) || empty($last['time'])) {
        return '';
    }
    return sprintf(
        'Последний запуск: %s · %s · %s',
        esc_html(wp_date('d.m.Y H:i', (int) $last['time'])),
        esc_html($last['user'] ?? ''),
        esc_html($last['summary'] ?? '')
    );
}

function imagen_qa_render_form() {
    if (!is_user_logged_in()) {
        return '<div class="imagen-qa-runner imagen-qa-runner--locked"><p>Войдите на сайт, чтобы запустить тест. <a href="' . esc_url(wp_login_url(get_permalink())) . '">Войти</a></p></div>';
    }

    wp_enqueue_style('imagen-qa-test-runner', imagen_qa_assets_url('imagen-qa-test-runner.css'), [], IMAGEN_QA_VERSION);
    wp_enqueue_script('imagen-qa-test-runner', imagen_qa_assets_url('imagen-qa-test-runner.js'), [], IMAGEN_QA_VERSION, true);
    wp_localize_script('imagen-qa-test-runner', 'imagenQaRunner', [
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('imagen_qa_run_test'),
    ]);

    $browsers = imagen_qa_browsers();
    $scopes = imagen_qa_scopes();
    $last_run = imagen_qa_last_run_text();

    ob_start();
    ?>
    <div class="imagen-qa-runner">
        <header class="iqr-head">
            <div>
                <h2 class="iqr-title">Запуск тестов imagen-ai.com</h2>
                <p class="iqr-lead">Прогон идёт в GitHub Actions. Отчёт придёт в Google Drive примерно через 20–30 минут.</p>
            </div>
        </header>

        <form class="iqr-form" novalidate>
            <section class="iqr-section">
                <h3 class="iqr-label">1 · Браузеры</h3>
                <div class="iqr-chips">
                    <?php foreach ($browsers as $value => $info): ?>
                        <label class="iqr-chip">
                            <input type="checkbox" name="browsers" value="<?php echo esc_attr($value); ?>" <?php checked($value, 'chromium'); ?>>
                            <span><?php echo esc_html($info['label']); ?></span>
                        </label>
                    <?php endforeach; ?>
                </div>
            </section>

            <section class="iqr-section">
                <h3 class="iqr-label">2 · Что проверять</h3>
                <div class="iqr-chips">
                    <label class="iqr-chip iqr-chip--all">
                        <input type="checkbox" name="scope_all" checked>
                        <span>Весь набор</span>
                    </label>
                    <?php foreach ($scopes as $key => $scope): ?>
                        <label class="iqr-chip">
                            <input type="checkbox" name="scope" value="<?php echo esc_attr(implode(' ', $scope['files'])); ?>">
                            <span><?php echo esc_html($scope['label']); ?></span>
                        </label>
                    <?php endforeach; ?>
                </div>

                <details class="iqr-advanced">
                    <summary>Расширенные настройки</summary>
                    <div class="iqr-field">
                        <label for="iqr-grep">Фильтр по названию теста</label>
                        <input type="text" id="iqr-grep" name="grep" maxlength="120" placeholder="например: pricing|cookie" autocomplete="off">
                        <small>Только латинские буквы, цифры, пробел и символы _ . , : ( ) / | -. Пусто — без фильтра.</small>
                    </div>
                    <div class="iqr-field">
                        <label for="iqr-specs">Свои файлы тестов</label>
                        <input type="text" id="iqr-specs" name="spec_files" maxlength="600" placeholder="tests/homepage.spec.ts tests/pricing-api.spec.ts" autocomplete="off">
                        <small>Если заполнено, галочки выше не учитываются. Пути через пробел, до 12 файлов.</small>
                    </div>
                    <label class="iqr-check">
                        <input type="checkbox" name="retries" value="true">
                        <span>Повторить упавшие тесты один раз <small>— отличает настоящий баг от случайного сбоя сети</small></span>
                    </label>
                </details>
            </section>

            <section class="iqr-section">
                <h3 class="iqr-label">3 · Cookies A/B-теста <span class="iqr-optional">необязательно</span></h3>
                <textarea class="iqr-cookies" name="cookies" rows="2" maxlength="2000" placeholder="name1=value1; name2=value2"></textarea>
            </section>

            <div class="iqr-summary" aria-live="polite"></div>

            <div class="iqr-actions">
                <button type="submit" class="iqr-submit">Запустить прогон</button>
            </div>

            <div class="iqr-status" role="status" aria-live="polite"></div>
            <?php if ($last_run !== ''): ?>
                <p class="iqr-last"><?php echo $last_run; // уже экранировано в imagen_qa_last_run_text() ?></p>
            <?php endif; ?>
        </form>
    </div>
    <?php
    return ob_get_clean();
}

/* ---------------------------------------------------------------------------
 * Обработчик запуска (AJAX).
 * ------------------------------------------------------------------------ */

function imagen_qa_post($key) {
    return isset($_POST[$key]) ? wp_unslash($_POST[$key]) : '';
}

function imagen_qa_handle_run_test() {
    if (!is_user_logged_in()) {
        wp_send_json_error(['message' => 'Нужен вход в систему.'], 403);
    }
    check_ajax_referer('imagen_qa_run_test', 'nonce');

    $rate_limit_key = 'imagen_qa_rate_' . get_current_user_id();
    if (get_transient($rate_limit_key)) {
        wp_send_json_error(['message' => 'Предыдущий запуск только что отправлен. Подождите пару минут.'], 429);
    }

    $token = imagen_qa_get_github_token();
    if (!$token) {
        wp_send_json_error(['message' => 'GitHub-токен не настроен. Администратор сайта может сохранить его в «Настройки → Imagen QA Runner».'], 500);
    }

    $browsers = imagen_qa_parse_browsers(imagen_qa_post('browsers'));
    if (empty($browsers)) {
        wp_send_json_error(['message' => 'Выберите хотя бы один браузер.'], 400);
    }

    $specs = imagen_qa_parse_specs(imagen_qa_post('spec_files'));
    if ($specs === null) {
        wp_send_json_error(['message' => 'Файлы тестов записаны неверно. Нужны пути вида tests/имя.spec.ts через пробел, не больше 12.'], 400);
    }

    $grep = imagen_qa_parse_grep(imagen_qa_post('grep'));
    if ($grep === null) {
        wp_send_json_error(['message' => 'В фильтре по названию есть недопустимые символы. Разрешены латинские буквы, цифры, пробел и _ . , : ( ) / | -.'], 400);
    }

    $cookies = imagen_qa_parse_cookies(imagen_qa_post('cookies'));
    if ($cookies === null) {
        wp_send_json_error(['message' => 'Cookies записаны неверно. Нужна строка вида name1=value1; name2=value2, без переносов строк.'], 400);
    }

    $retries = imagen_qa_post('retries') === 'true' ? 'true' : 'false';
    $browsers_csv = implode(',', $browsers);
    $specs_str = implode(' ', $specs);

    $response = wp_remote_post(
        sprintf(
            'https://api.github.com/repos/%s/actions/workflows/%s/dispatches',
            IMAGEN_QA_REPO,
            IMAGEN_QA_WORKFLOW
        ),
        [
            'headers' => [
                'Authorization' => 'Bearer ' . $token,
                'Accept' => 'application/vnd.github+json',
                'Content-Type' => 'application/json',
                'User-Agent' => 'imagen-qa-test-runner',
            ],
            'body' => wp_json_encode([
                'ref' => IMAGEN_QA_BRANCH,
                'inputs' => [
                    'browsers' => $browsers_csv,
                    'raw_client_cookies' => $cookies,
                    'spec_files' => $specs_str,
                    'grep' => $grep,
                    'retries' => $retries,
                ],
            ]),
            'timeout' => 15,
        ]
    );

    if (is_wp_error($response)) {
        wp_send_json_error(['message' => 'Не удалось связаться с GitHub: ' . $response->get_error_message()], 500);
    }

    $code = wp_remote_retrieve_response_code($response);
    if ($code !== 204) {
        $details = trim((string) wp_remote_retrieve_body($response));
        wp_send_json_error(['message' => 'GitHub вернул ошибку (' . $code . ')' . ($details !== '' ? ': ' . $details : '.')], 500);
    }

    set_transient($rate_limit_key, true, 120);

    $summary = implode(', ', array_map(function ($b) use ($browsers) {
        return imagen_qa_browsers()[$b]['label'];
    }, $browsers));
    $summary .= $specs ? ' · свой набор (' . count($specs) . ')' : ' · ' . ($specs_str === '' ? 'весь набор' : $specs_str);
    if ($grep !== '') {
        $summary .= ' · фильтр «' . $grep . '»';
    }
    if ($retries === 'true') {
        $summary .= ' · с повтором';
    }

    $user = wp_get_current_user();
    update_option('imagen_qa_last_run', [
        'time' => time(),
        'user' => $user->display_name ?: $user->user_login,
        'summary' => $summary,
    ], false);

    wp_send_json_success(['message' => 'Прогон запущен: ' . $summary . '. Отчёт появится в Google Drive примерно через 20–30 минут.']);
}
