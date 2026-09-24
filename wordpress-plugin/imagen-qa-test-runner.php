<?php
/**
 * Plugin Name: Imagen QA Test Runner
 * Description: Форма для запуска Playwright-тестов imagen-ai.com через GitHub Actions, без захода в GitHub. Вставляется шорткодом [imagen_qa_test_runner].
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

define('IMAGEN_QA_REPO', 'iTishnikiDigital/Imagen-Website-Playwright-Tests');
define('IMAGEN_QA_WORKFLOW', 'playwright.yml');
define('IMAGEN_QA_BRANCH', 'main');

add_shortcode('imagen_qa_test_runner', 'imagen_qa_render_form');
add_action('wp_enqueue_scripts', 'imagen_qa_enqueue_assets');
add_action('admin_menu', 'imagen_qa_add_settings_page');
// Только wp_ajax_ (без _nopriv_) — обработчик доступен исключительно
// залогиненным пользователям WordPress. Заведи клиенту отдельный аккаунт,
// чтобы ему не нужен был доступ к GitHub, но страницу нельзя было дёргать
// анонимно: каждый запуск — реальный прогон в CI и реальная отправка
// тестового email в CRM клиента (см. TEST_EMAIL в самом наборе тестов).
add_action('wp_ajax_imagen_qa_run_test', 'imagen_qa_handle_run_test');

// Токен нужен для вызова GitHub API из PHP-обработчика ниже. Без доступа
// к файлам сайта (FTP/файловый менеджер) прописать его в wp-config.php
// нельзя — поэтому основной способ хранения тут: опция в БД через эту
// страницу настроек, доступную только администраторам (manage_options).
// Если позже появится файловый доступ, можно вместо этого определить
// константу IMAGEN_QA_GITHUB_TOKEN в wp-config.php — она имеет приоритет.
function imagen_qa_add_settings_page() {
    add_options_page(
        'Imagen QA Test Runner',
        'Imagen QA Runner',
        'manage_options',
        'imagen-qa-test-runner',
        'imagen_qa_render_settings_page'
    );
}

function imagen_qa_get_github_token() {
    if (defined('IMAGEN_QA_GITHUB_TOKEN') && IMAGEN_QA_GITHUB_TOKEN) {
        return IMAGEN_QA_GITHUB_TOKEN;
    }
    return get_option('imagen_qa_github_token', '');
}

function imagen_qa_render_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }

    if (isset($_POST['imagen_qa_token_nonce']) && wp_verify_nonce($_POST['imagen_qa_token_nonce'], 'imagen_qa_save_token')) {
        $new_token = isset($_POST['imagen_qa_github_token']) ? sanitize_text_field(wp_unslash($_POST['imagen_qa_github_token'])) : '';
        if ($new_token !== '') {
            update_option('imagen_qa_github_token', $new_token);
            echo '<div class="notice notice-success"><p>Токен сохранён.</p></div>';
        }
    }

    $using_constant = defined('IMAGEN_QA_GITHUB_TOKEN') && IMAGEN_QA_GITHUB_TOKEN;
    $has_saved_option = (bool) get_option('imagen_qa_github_token', '');
    ?>
    <div class="wrap">
        <h1>Imagen QA Test Runner</h1>
        <?php if ($using_constant): ?>
            <p>Токен задан константой <code>IMAGEN_QA_GITHUB_TOKEN</code> в <code>wp-config.php</code> — поле ниже игнорируется, пока константа определена.</p>
        <?php else: ?>
            <form method="post">
                <?php wp_nonce_field('imagen_qa_save_token', 'imagen_qa_token_nonce'); ?>
                <table class="form-table">
                    <tr>
                        <th scope="row"><label for="imagen_qa_github_token">GitHub Token (fine-grained, Actions: write)</label></th>
                        <td>
                            <input type="password" id="imagen_qa_github_token" name="imagen_qa_github_token" class="regular-text" placeholder="<?php echo $has_saved_option ? 'Токен сохранён — введите новый, чтобы заменить' : 'github_pat_...'; ?>">
                        </td>
                    </tr>
                </table>
                <?php submit_button('Сохранить'); ?>
            </form>
        <?php endif; ?>
    </div>
    <?php
}

function imagen_qa_enqueue_assets() {
    wp_register_script(
        'imagen-qa-test-runner',
        plugin_dir_url(__FILE__) . 'imagen-qa-test-runner.js',
        [],
        '1.0.0',
        true
    );
    wp_localize_script('imagen-qa-test-runner', 'imagenQaRunner', [
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('imagen_qa_run_test'),
    ]);
}

function imagen_qa_render_form() {
    if (!is_user_logged_in()) {
        return '<p>Войдите на сайт, чтобы запустить тест.</p>';
    }

    wp_enqueue_script('imagen-qa-test-runner');
    ob_start();
    ?>
    <div class="imagen-qa-runner">
        <style>
            .imagen-qa-runner { max-width: 520px; }
            .imagen-qa-runner fieldset { border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
            .imagen-qa-runner legend { font-weight: 600; padding: 0 6px; }
            .imagen-qa-runner label { display: block; margin: 6px 0; font-weight: normal; }
            .imagen-qa-runner textarea { width: 100%; min-height: 60px; font-family: monospace; font-size: 13px; box-sizing: border-box; }
            .imagen-qa-runner button { background: #1F6F78; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; }
            .imagen-qa-runner button:disabled { opacity: 0.6; cursor: default; }
            .imagen-qa-runner .imagen-qa-status { margin-top: 12px; font-size: 14px; }
        </style>

        <fieldset>
            <legend>Браузеры</legend>
            <label><input type="checkbox" class="imagen-qa-browser" value="chromium" checked> Chrome (chromium)</label>
            <label><input type="checkbox" class="imagen-qa-browser" value="firefox"> Firefox</label>
            <label><input type="checkbox" class="imagen-qa-browser" value="webkit"> Safari (webkit)</label>
        </fieldset>

        <fieldset>
            <legend>Что запускать</legend>
            <label><input type="checkbox" class="imagen-qa-scope-all" checked> Весь набор тестов</label>
            <label><input type="checkbox" class="imagen-qa-scope" value="tests/homepage.spec.ts tests/navigation-links.spec.ts"> Главная и навигация</label>
            <label><input type="checkbox" class="imagen-qa-scope" value="tests/site-health.spec.ts"> Ошибки на страницах (консоль/сеть)</label>
            <label><input type="checkbox" class="imagen-qa-scope" value="tests/responsive.spec.ts tests/tablet-sweep.spec.ts"> Адаптивность (768px/375px)</label>
            <label><input type="checkbox" class="imagen-qa-scope" value="tests/localization.spec.ts tests/language-switcher.spec.ts"> Локализация</label>
            <label><input type="checkbox" class="imagen-qa-scope" value="tests/content-templates.spec.ts"> Блог/контент</label>
            <label><input type="checkbox" class="imagen-qa-scope" value="tests/real-estate.spec.ts"> Real Estate</label>
        </fieldset>

        <fieldset>
            <legend>Cookies для A/B-теста (необязательно)</legend>
            <textarea class="imagen-qa-cookies" placeholder="name1=value1; name2=value2"></textarea>
        </fieldset>

        <button type="button" class="imagen-qa-submit">Запустить тест</button>
        <div class="imagen-qa-status"></div>
    </div>
    <?php
    return ob_get_clean();
}

function imagen_qa_handle_run_test() {
    if (!is_user_logged_in()) {
        wp_send_json_error(['message' => 'Требуется вход в систему.'], 403);
    }
    check_ajax_referer('imagen_qa_run_test', 'nonce');

    $rate_limit_key = 'imagen_qa_rate_' . get_current_user_id();
    if (get_transient($rate_limit_key)) {
        wp_send_json_error(['message' => 'Подождите пару минут перед следующим запуском.'], 429);
    }

    $token = imagen_qa_get_github_token();
    if (!$token) {
        wp_send_json_error(['message' => 'GitHub-токен не настроен — зайдите в Настройки → Imagen QA Runner и сохраните токен.'], 500);
    }

    $browsers = isset($_POST['browsers']) ? sanitize_text_field(wp_unslash($_POST['browsers'])) : 'chromium';
    $spec_files = isset($_POST['spec_files']) ? sanitize_text_field(wp_unslash($_POST['spec_files'])) : '';
    $cookies = isset($_POST['cookies']) ? sanitize_text_field(wp_unslash($_POST['cookies'])) : '';

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
                    'browsers' => $browsers !== '' ? $browsers : 'chromium',
                    'raw_client_cookies' => $cookies,
                    'spec_files' => $spec_files,
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
        wp_send_json_error(['message' => 'GitHub вернул ошибку (' . $code . '): ' . wp_remote_retrieve_body($response)], 500);
    }

    set_transient($rate_limit_key, true, 120);
    wp_send_json_success(['message' => 'Тест запущен. Отчёт появится в Google Drive примерно через 20-30 минут.']);
}
