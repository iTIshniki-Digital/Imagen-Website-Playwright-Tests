<?php
/**
 * Plugin Name: Imagen QA Test Runner
 * Description: Форма для запуска Playwright-тестов imagen-ai.com через GitHub Actions, без захода в GitHub. Вставляется шорткодом [imagen_qa_test_runner].
 * Version: 1.3.0
 */

if (!defined('ABSPATH')) {
    exit;
}

define('IMAGEN_QA_VERSION', '1.3.0');
define('IMAGEN_QA_REPO', 'iTishnikiDigital/Imagen-Website-Playwright-Tests');
define('IMAGEN_QA_WORKFLOW', 'playwright.yml');
define('IMAGEN_QA_BRANCH', 'main');

add_shortcode('imagen_qa_test_runner', 'imagen_qa_render_form');
add_action('admin_menu', 'imagen_qa_add_settings_page');
// Только wp_ajax_ (без _nopriv_): обработчик доступен только залогиненным
// пользователям WordPress. Каждый запуск — реальный прогон в CI и реальная
// отправка тестового email в CRM клиента, поэтому анонимным он не нужен.
add_action('wp_ajax_imagen_qa_run_test', 'imagen_qa_handle_run_test');

// Второй вход — для дашборда (claude.ai Artifact), который не может держать
// сессию WordPress: свой ключ вместо логина, см. imagen_qa_handle_run_test_rest()
// и блок REST / CORS ниже.
add_action('rest_api_init', 'imagen_qa_register_rest_route');
add_filter('rest_pre_serve_request', 'imagen_qa_rest_cors_headers', 10, 4);

/* ---------------------------------------------------------------------------
 * Справочники: браузеры и наборы тестов. Имена файлов должны совпадать с
 * репозиторием. Если в tests/ появится новый набор — добавьте его сюда.
 * ------------------------------------------------------------------------ */

function imagen_qa_browsers() {
    return [
        'chromium' => ['label' => 'Chrome', 'hint' => 'main, fastest'],
        'firefox'  => ['label' => 'Firefox', 'hint' => ''],
        'webkit'   => ['label' => 'Safari', 'hint' => 'WebKit engine'],
    ];
}

// Те же ключи, названия и группы файлов, слово в слово, что и в
// scripts/qa-dashboard-categories.js (там подробный комментарий, откуда они
// взяты — это категории клиентского ручного чек-листа). Ключи здесь совпадают
// с category-slug оттуда специально: дашборд шлёт сюда ровно эти slug'и в
// поле scope, и колонки на обеих сторонах остаются одними и теми же без
// перевода туда-обратно. Поменяли один файл — поменяйте и другой.
function imagen_qa_scopes() {
    return [
        'homepage-nav' => [
            'label' => 'Homepage & Navigation (Desktop 1600px)',
            'files' => ['tests/homepage.spec.ts'],
        ],
        'signup-flow' => [
            'label' => 'Desktop Signup Flow (full)',
            'files' => ['tests/signup-funnel.spec.ts', 'tests/quiz-full-walkthrough.spec.ts'],
        ],
        'multi-language' => [
            'label' => 'Multi-Language Signup (Rotate)',
            'files' => ['tests/localization.spec.ts', 'tests/localized-funnel.spec.ts'],
        ],
        'video-page' => [
            'label' => 'Video Page (full flow)',
            'files' => ['tests/video-funnel.spec.ts', 'tests/video-quiz-full-walkthrough.spec.ts'],
        ],
        'mobile' => [
            'label' => 'Mobile (real phone or emulation)',
            'files' => ['tests/mobile-funnel.spec.ts'],
        ],
        'ios' => [
            'label' => 'iOS / Apple Devices',
            'files' => ['tests/ios-and-accessibility.spec.ts'],
        ],
        'pricing' => [
            'label' => 'Pricing (Rotate regions)',
            'files' => ['tests/pricing-api.spec.ts', 'tests/pricing-rendered.spec.ts'],
        ],
        'console-sweep' => [
            'label' => 'Cross-page Console/HTTP Sweep',
            'files' => ['tests/site-health.spec.ts'],
        ],
        'functional-gaps' => [
            'label' => 'Functional Gaps',
            'files' => [
                'tests/form-validation.spec.ts',
                'tests/navigation-links.spec.ts',
                'tests/cta-buttons.spec.ts',
                'tests/language-switcher.spec.ts',
                'tests/content-templates.spec.ts',
                'tests/podcast-content-template.spec.ts',
                'tests/cookie-banner.spec.ts',
            ],
        ],
        'visual-ux' => [
            'label' => 'Visual / UX Gaps',
            'files' => [
                'tests/responsive.spec.ts',
                'tests/tablet-sweep.spec.ts',
                'tests/media-video.spec.ts',
                'tests/interactive-widgets.spec.ts',
                'tests/scroll-behavior.spec.ts',
            ],
        ],
        'real-estate' => [
            'label' => 'Real Estate Webapp',
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
            $notice = '<div class="notice notice-warning"><p>Token removed.</p></div>';
        } else {
            $new_token = isset($_POST['imagen_qa_github_token']) ? sanitize_text_field(wp_unslash($_POST['imagen_qa_github_token'])) : '';
            if ($new_token !== '') {
                update_option('imagen_qa_github_token', $new_token);
                $notice = '<div class="notice notice-success"><p>Token saved.</p></div>';
            }
        }
    }

    $key_notice = '';
    if (isset($_POST['imagen_qa_key_nonce']) && wp_verify_nonce($_POST['imagen_qa_key_nonce'], 'imagen_qa_regen_key')) {
        delete_option('imagen_qa_dashboard_key');
        $key_notice = '<div class="notice notice-success"><p>Dashboard key regenerated. Update it in the dashboard page too — the old one stops working immediately.</p></div>';
    }

    $using_constant = defined('IMAGEN_QA_GITHUB_TOKEN') && IMAGEN_QA_GITHUB_TOKEN;
    $has_saved_option = (bool) get_option('imagen_qa_github_token', '');
    $dashboard_key = imagen_qa_get_dashboard_key();
    $dashboard_rest_url = rest_url('imagen-qa/v1/run');
    ?>
    <div class="wrap">
        <h1>Imagen QA Test Runner</h1>
        <?php echo $notice; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- собственная разметка выше ?>
        <p>Plugin version: <?php echo esc_html(IMAGEN_QA_VERSION); ?>.
            Token status:
            <?php if ($using_constant): ?>
                <strong>set by a constant in wp-config.php</strong> (the field below is ignored).
            <?php elseif ($has_saved_option): ?>
                <strong>saved</strong>.
            <?php else: ?>
                <strong>not set</strong> — the form cannot start tests.
            <?php endif; ?>
        </p>
        <?php if (!$using_constant): ?>
            <form method="post">
                <?php wp_nonce_field('imagen_qa_save_token', 'imagen_qa_token_nonce'); ?>
                <table class="form-table">
                    <tr>
                        <th scope="row"><label for="imagen_qa_github_token">GitHub token</label></th>
                        <td>
                            <input type="password" id="imagen_qa_github_token" name="imagen_qa_github_token" class="regular-text" autocomplete="off" placeholder="<?php echo $has_saved_option ? 'Token saved — enter a new one to replace it' : 'ghp_… (classic) or github_pat_… (fine-grained)'; ?>">
                            <p class="description">Classic token with the <code>repo</code> scope (tested, works). A fine-grained token also works if it has access to the repository with Actions: Read and write.</p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Save', 'primary', 'submit', false); ?>
                <?php if ($has_saved_option): ?>
                    <?php submit_button('Remove token', 'secondary', 'imagen_qa_reset', false); ?>
                <?php endif; ?>
            </form>
        <?php endif; ?>

        <h2>QA Dashboard access (currently unused)</h2>
        <p>The QA Dashboard (a separate page, not on this site) opens the form above in a new tab, prefilled, instead of calling this endpoint — its own page can't reach any outside URL directly. Kept working in case something else needs it later; nothing needs these two values right now.</p>
        <?php echo $key_notice; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- собственная разметка выше ?>
        <table class="form-table">
            <tr>
                <th scope="row">Endpoint URL</th>
                <td><code><?php echo esc_html($dashboard_rest_url); ?></code></td>
            </tr>
            <tr>
                <th scope="row">Dashboard key</th>
                <td>
                    <code><?php echo esc_html($dashboard_key); ?></code>
                    <p class="description">Anyone with this key can start a test run (rate-limited to once every 2 minutes) — nothing more: it has no access to the GitHub token, the repository, or anything else. Treat it like a shared password, not like the GitHub token above.</p>
                </td>
            </tr>
        </table>
        <form method="post" onsubmit="return confirm('This invalidates the current key immediately. The dashboard needs the new one before it can start runs again.');">
            <?php wp_nonce_field('imagen_qa_regen_key', 'imagen_qa_key_nonce'); ?>
            <?php submit_button('Regenerate key', 'secondary', 'submit', false); ?>
        </form>
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
        'Last run: %s · %s · %s',
        esc_html(wp_date('d.m.Y H:i', (int) $last['time'])),
        esc_html($last['user'] ?? ''),
        esc_html($last['summary'] ?? '')
    );
}

function imagen_qa_render_form() {
    if (!is_user_logged_in()) {
        return '<div class="imagen-qa-runner imagen-qa-runner--locked"><p>Log in to run tests. <a href="' . esc_url(wp_login_url(get_permalink())) . '">Log in</a></p></div>';
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
                <h2 class="iqr-title">Run imagen-ai.com tests</h2>
                <p class="iqr-lead">The run goes through GitHub Actions. The report arrives in Google Drive in about 20–30 minutes.</p>
            </div>
        </header>

        <form class="iqr-form" novalidate>
            <section class="iqr-section">
                <h3 class="iqr-label">1 · Browsers</h3>
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
                <h3 class="iqr-label">2 · What to check</h3>
                <div class="iqr-chips">
                    <label class="iqr-chip iqr-chip--all">
                        <input type="checkbox" name="scope_all" checked>
                        <span>Full suite</span>
                    </label>
                    <?php foreach ($scopes as $key => $scope): ?>
                        <label class="iqr-chip">
                            <input type="checkbox" name="scope" value="<?php echo esc_attr(implode(' ', $scope['files'])); ?>">
                            <span><?php echo esc_html($scope['label']); ?></span>
                        </label>
                    <?php endforeach; ?>
                </div>

                <details class="iqr-advanced">
                    <summary>Advanced settings</summary>
                    <div class="iqr-field">
                        <label for="iqr-grep">Filter by test name</label>
                        <input type="text" id="iqr-grep" name="grep" maxlength="120" placeholder="for example: pricing|cookie" autocomplete="off">
                        <small>Latin letters, digits, spaces and _ . , : ( ) / | - only. Leave empty for no filter.</small>
                    </div>
                    <div class="iqr-field">
                        <label for="iqr-specs">Custom test files</label>
                        <input type="text" id="iqr-specs" name="spec_files" maxlength="600" placeholder="tests/homepage.spec.ts tests/pricing-api.spec.ts" autocomplete="off">
                        <small>If filled in, the checkboxes above are ignored. Paths separated by spaces, up to 12 files.</small>
                    </div>
                    <label class="iqr-check">
                        <input type="checkbox" name="retries" value="true">
                        <span>Retry failed tests once <small>— tells a real bug from a random network glitch</small></span>
                    </label>
                </details>
            </section>

            <section class="iqr-section">
                <h3 class="iqr-label">3 · A/B test cookies <span class="iqr-optional">optional</span></h3>
                <textarea class="iqr-cookies" name="cookies" rows="2" maxlength="2000" placeholder="name1=value1; name2=value2"></textarea>
            </section>

            <div class="iqr-summary" aria-live="polite"></div>

            <div class="iqr-actions">
                <button type="submit" class="iqr-submit">Start run</button>
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
 * Общая отправка запуска в GitHub. Используется и формой на сайте (WP-логин,
 * см. imagen_qa_handle_run_test ниже), и дашбордом (ключ, см.
 * imagen_qa_handle_run_test_rest ниже) — один и тот же путь к GitHub API,
 * одна и та же проверка входных данных, разная только проверка личности
 * вызывающего.
 *
 * Возвращает ['ok' => true, 'message' => ...] или
 * ['ok' => false, 'message' => ..., 'status' => <HTTP код>].
 * ------------------------------------------------------------------------ */

function imagen_qa_dispatch_run($raw_browsers, $raw_specs, $raw_grep, $raw_cookies, $raw_retries, $actor_label, $rate_limit_key) {
    if (get_transient($rate_limit_key)) {
        return ['ok' => false, 'message' => 'The previous run was just sent. Wait a couple of minutes.', 'status' => 429];
    }

    $token = imagen_qa_get_github_token();
    if (!$token) {
        return ['ok' => false, 'message' => 'The GitHub token is not set. A site administrator can save it under Settings → Imagen QA Runner.', 'status' => 500];
    }

    $browsers = imagen_qa_parse_browsers($raw_browsers);
    if (empty($browsers)) {
        return ['ok' => false, 'message' => 'Select at least one browser.', 'status' => 400];
    }

    $specs = imagen_qa_parse_specs($raw_specs);
    if ($specs === null) {
        return ['ok' => false, 'message' => 'Test file paths are invalid. Use paths like tests/name.spec.ts separated by spaces, at most 12.', 'status' => 400];
    }

    $grep = imagen_qa_parse_grep($raw_grep);
    if ($grep === null) {
        return ['ok' => false, 'message' => 'The name filter has invalid characters. Allowed: Latin letters, digits, spaces and _ . , : ( ) / | -.', 'status' => 400];
    }

    $cookies = imagen_qa_parse_cookies($raw_cookies);
    if ($cookies === null) {
        return ['ok' => false, 'message' => 'Cookies are invalid. Use a string like name1=value1; name2=value2, on one line.', 'status' => 400];
    }

    $retries = $raw_retries === 'true' ? 'true' : 'false';
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
        return ['ok' => false, 'message' => 'Could not reach GitHub: ' . $response->get_error_message(), 'status' => 500];
    }

    $code = wp_remote_retrieve_response_code($response);
    if ($code !== 204) {
        $details = trim((string) wp_remote_retrieve_body($response));
        return ['ok' => false, 'message' => 'GitHub returned an error (' . $code . ')' . ($details !== '' ? ': ' . $details : '.'), 'status' => 500];
    }

    set_transient($rate_limit_key, true, 120);

    $summary = implode(', ', array_map(function ($b) use ($browsers) {
        return imagen_qa_browsers()[$b]['label'];
    }, $browsers));
    $summary .= $specs ? ' · custom set (' . count($specs) . ')' : ' · ' . ($specs_str === '' ? 'full suite' : $specs_str);
    if ($grep !== '') {
        $summary .= ' · filter "' . $grep . '"';
    }
    if ($retries === 'true') {
        $summary .= ' · with retry';
    }

    update_option('imagen_qa_last_run', [
        'time' => time(),
        'user' => $actor_label,
        'summary' => $summary,
    ], false);

    return ['ok' => true, 'message' => 'Run started: ' . $summary . '. The report will appear in Google Drive in about 20–30 minutes.'];
}

/* ---------------------------------------------------------------------------
 * Обработчик запуска через форму на сайте (AJAX, нужен вход в WordPress).
 * ------------------------------------------------------------------------ */

function imagen_qa_post($key) {
    return isset($_POST[$key]) ? wp_unslash($_POST[$key]) : '';
}

function imagen_qa_handle_run_test() {
    if (!is_user_logged_in()) {
        wp_send_json_error(['message' => 'Log in is required.'], 403);
    }
    check_ajax_referer('imagen_qa_run_test', 'nonce');

    $user = wp_get_current_user();
    $result = imagen_qa_dispatch_run(
        imagen_qa_post('browsers'),
        imagen_qa_post('spec_files'),
        imagen_qa_post('grep'),
        imagen_qa_post('cookies'),
        imagen_qa_post('retries'),
        $user->display_name ?: $user->user_login,
        'imagen_qa_rate_' . get_current_user_id()
    );

    if ($result['ok']) {
        wp_send_json_success(['message' => $result['message']]);
    }
    wp_send_json_error(['message' => $result['message']], $result['status']);
}

/* ---------------------------------------------------------------------------
 * Обработчик запуска через дашборд (REST, ключ вместо логина в WordPress).
 *
 * ПОКА НЕ ИСПОЛЬЗУЕТСЯ дашбордом (claude.ai Artifact) — оставлено рабочим
 * на будущее. Выяснилось (2026-10-13), что страница Artifact не может
 * сделать fetch()/XHR ни на один внешний хост — её JS физически не может
 * дёрнуть этот (или любой другой) REST-эндпоинт напрямую. Дашборд вместо
 * этого открывает настоящую форму на сайте новой вкладкой с префиллом
 * (см. imagen-qa-test-runner.js, applyPrefillFromQuery) — отправка идёт
 * через imagen_qa_handle_run_test ниже, как и раньше. Маршрут ниже рабочий
 * и покрыт тестами, просто сейчас его некому вызвать; может пригодиться
 * для другого клиента запросов (отдельный MCP-коннектор, Zapier и т.п.).
 *
 * Дашборд — страница на claude.ai (Artifact), у неё не бывает сессии
 * WordPress и нет способа безопасно хранить GitHub-токен на своей стороне
 * (её JS виден любому с доступом к странице). Поэтому здесь — отдельный
 * общий секрет (imagen_qa_dashboard_key, см. настройки плагина), известный
 * только этому эндпоинту. Его компрометация позволяет только ЗАПУСКАТЬ
 * прогоны тестов (с лимитом раз в 2 минуты) — не читает и не пишет ничего
 * в GitHub и не имеет доступа к токену.
 * ------------------------------------------------------------------------ */

function imagen_qa_get_dashboard_key() {
    $key = get_option('imagen_qa_dashboard_key', '');
    if (!$key) {
        $key = wp_generate_password(40, false, false);
        update_option('imagen_qa_dashboard_key', $key, false);
    }
    return $key;
}

function imagen_qa_register_rest_route() {
    register_rest_route('imagen-qa/v1', '/run', [
        'methods' => 'POST',
        'callback' => 'imagen_qa_handle_run_test_rest',
        'permission_callback' => '__return_true', // проверка — в самом колбэке, по ключу, не по правам WP
    ]);
}

// Разрешаем кросс-доменные запросы только для нашего REST-неймспейса —
// остальной REST API сайта CORS-политику не меняет. Origin не проверяем:
// ворота — это ключ в заголовке, а не домен, с которого пришёл запрос.
function imagen_qa_rest_cors_headers($served, $result, $request, $server) {
    if (strpos($request->get_route(), '/imagen-qa/v1/') === 0) {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-Imagen-QA-Key');
    }
    return $served;
}

function imagen_qa_handle_run_test_rest(WP_REST_Request $request) {
    $expected_key = imagen_qa_get_dashboard_key();
    $given_key = $request->get_header('x-imagen-qa-key') ?: '';
    if (!$given_key || !hash_equals($expected_key, $given_key)) {
        return new WP_REST_Response(['success' => false, 'data' => ['message' => 'Invalid or missing dashboard key.']], 403);
    }

    $params = $request->get_json_params() ?: $request->get_params();
    $actor = isset($params['triggered_by']) ? sanitize_text_field((string) $params['triggered_by']) : '';
    $actor_label = $actor !== '' ? 'QA Dashboard — ' . mb_substr($actor, 0, 60) : 'QA Dashboard';

    $result = imagen_qa_dispatch_run(
        $params['browsers'] ?? '',
        $params['spec_files'] ?? '',
        $params['grep'] ?? '',
        $params['cookies'] ?? '',
        $params['retries'] ?? '',
        $actor_label,
        'imagen_qa_rate_dashboard'
    );

    return new WP_REST_Response(['success' => $result['ok'], 'data' => ['message' => $result['message']]], $result['ok'] ? 200 : $result['status']);
}
